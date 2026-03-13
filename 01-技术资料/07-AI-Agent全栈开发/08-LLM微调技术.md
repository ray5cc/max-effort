# 08-LLM微调技术 — 技术资料

> 深入讲解大语言模型（LLM）的高效微调方法，涵盖参数高效微调（LoRA/QLoRA/Adapter）、基于强化学习的对齐训练（RLHF/DPO/PPO/GRPO），以及分布式 RL 训练框架，帮助开发者以最小代价定制专属模型。

## 目录

- [1. 概述](#1-概述)
- [2. 参数高效微调（PEFT）](#2-参数高效微调peft)
  - [2.1 LoRA](#21-lora)
  - [2.2 QLoRA](#22-qlora)
  - [2.3 Adapter Tuning](#23-adapter-tuning)
  - [2.4 Prefix Tuning / P-Tuning](#24-prefix-tuning--p-tuning)
  - [2.5 各方案对比](#25-各方案对比)
- [3. 基于强化学习的对齐训练](#3-基于强化学习的对齐训练)
  - [3.1 RLHF 流程](#31-rlhf-流程)
  - [3.2 PPO 算法](#32-ppo-算法)
  - [3.3 DPO：直接偏好优化](#33-dpo直接偏好优化)
  - [3.4 GRPO：组相对策略优化](#34-grpo组相对策略优化)
  - [3.5 对比小结](#35-对比小结)
- [4. 分布式 RL 训练——verl 框架](#4-分布式-rl-训练verl-框架)
- [5. 实战示例](#5-实战示例)
- [6. 最佳实践](#6-最佳实践)
- [7. 常见问题](#7-常见问题)
- [导航](#导航)

---

## 1. 概述

### 1.1 为什么需要微调

预训练大模型（如 LLaMA 3、Qwen 2.5、Mistral）在海量通用语料上学习到了丰富的世界知识，但在以下场景中需要微调：

| 场景 | 问题 | 解决方案 |
|------|------|----------|
| 垂直行业（医疗/法律/金融） | 模型缺乏领域专业词汇与推理方式 | 领域语料 SFT |
| 指令跟随能力不足 | 模型只会"续写"，不擅长"回答问题" | Instruction Tuning |
| 输出格式不稳定 | 无法稳定输出 JSON/Markdown 等结构 | SFT + Format Tuning |
| 安全与价值观对齐 | 模型可能生成有害内容 | RLHF / DPO |

### 1.2 全量微调 vs 参数高效微调

**全量微调（Full Fine-Tuning）**：更新模型所有参数。
- 优点：效果最好
- 缺点：7B 模型需要 ~28GB 显存（fp16），成本极高

**参数高效微调（PEFT, Parameter-Efficient Fine-Tuning）**：只训练少量参数（< 1% 原始参数量），冻结大部分模型权重。
- 优点：显存占用低（可在单卡 24GB 运行 65B 模型）、训练速度快、多任务复用
- 代表方案：LoRA、QLoRA、Adapter、Prefix Tuning

---

## 2. 参数高效微调（PEFT）

> 项目参考：[huggingface/peft](https://github.com/huggingface/peft)

### 2.1 LoRA

**LoRA（Low-Rank Adaptation）** 是目前最流行的 PEFT 方法，由微软研究院于 2021 年提出。

#### 核心原理

原始权重矩阵 `W ∈ R^(d×k)` 冻结不变，在旁路插入低秩分解：

```
ΔW = B × A
其中 B ∈ R^(d×r)，A ∈ R^(r×k)，r << min(d, k)
```

前向传播时：
```
h = W₀x + ΔWx = W₀x + BAx
```

**可视化理解：**

```
输入 x
  │
  ├──────────── 冻结路径 ────────────► W₀x
  │                                      │
  └── A (r×k) ──► B (d×r) ──────────► BAx
                                         │
                                    两路相加 h
```

- 训练结束后可将 `ΔW = BA` 合并到 `W₀`，**推理零额外开销**
- 典型秩 `r = 8 ~ 64`，参数量仅为原来的 0.1% ~ 1%

#### 关键代码（来自 huggingface/peft）

```python
from peft import LoraConfig, get_peft_model, TaskType
from transformers import AutoModelForCausalLM

# 加载基础模型
model = AutoModelForCausalLM.from_pretrained("meta-llama/Llama-3.2-3B")

# 配置 LoRA
lora_config = LoraConfig(
    task_type=TaskType.CAUSAL_LM,
    r=16,                          # 低秩维度
    lora_alpha=32,                 # 缩放系数 α
    lora_dropout=0.1,
    target_modules=["q_proj", "v_proj"],  # 应用到 Attention 的 Q、V 矩阵
    bias="none",
)

# 封装为 PEFT 模型
model = get_peft_model(model, lora_config)
model.print_trainable_parameters()
# 输出: trainable params: 4,194,304 || all params: 3,215,785,984 || trainable%: 0.1304
```

#### LoRA 超参数说明

| 参数 | 含义 | 推荐值 |
|------|------|--------|
| `r` | 低秩维度，越大能力越强但参数越多 | 8 ~ 64 |
| `lora_alpha` | 缩放系数，通常设为 `2r` | 16 ~ 128 |
| `lora_dropout` | Dropout 防止过拟合 | 0.05 ~ 0.1 |
| `target_modules` | 应用 LoRA 的模块名 | `q_proj, v_proj`（最少），或加上 `k_proj, o_proj` |

---

### 2.2 QLoRA

**QLoRA（Quantized LoRA）** 由华盛顿大学于 2023 年提出，在 LoRA 基础上加入 4-bit 量化，使 65B 模型可在单张 48GB 显卡上微调。

#### 核心技术栈

| 技术 | 作用 |
|------|------|
| **NF4 量化**（4-bit NormalFloat） | 将基础模型量化到 4-bit，大幅压缩显存 |
| **双重量化（Double Quantization）** | 对量化常数再次量化，节省约 0.37 bits/参数 |
| **分页优化器（Paged Optimizer）** | 将优化器状态分页存入 CPU，避免显存峰值 OOM |
| **LoRA 适配器（fp16/bf16）** | 适配器参数保持高精度，梯度通过量化权重反传 |

#### 关键代码

```python
from transformers import AutoModelForCausalLM, BitsAndBytesConfig
from peft import prepare_model_for_kbit_training, LoraConfig, get_peft_model
import torch

# 4-bit 量化配置
bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_use_double_quant=True,   # 双重量化
    bnb_4bit_quant_type="nf4",        # NF4 量化类型
    bnb_4bit_compute_dtype=torch.bfloat16,
)

# 加载量化模型
model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-3.1-8B",
    quantization_config=bnb_config,
    device_map="auto",
)

# 准备量化训练
model = prepare_model_for_kbit_training(model)

# 挂载 LoRA
lora_config = LoraConfig(r=64, lora_alpha=128, target_modules="all-linear")
model = get_peft_model(model, lora_config)
```

---

### 2.3 Adapter Tuning

在 Transformer 每层的 FFN 之后插入小型适配器模块（Adapter），每个 Adapter 包含：

```
输入 x
  │
LayerNorm
  │
线性层（d → 瓶颈维度 m，m << d）
  │
非线性激活（GELU）
  │
线性层（m → d）
  │
残差连接（+ x）
  │
输出
```

- 参数量约为模型的 1% ~ 3%
- 优点：多任务场景中每个任务只需保存各自的 Adapter，共享基础模型
- 缺点：推理时有额外的串行计算（LoRA 可合并，Adapter 不行）

```python
from peft import AdapterConfig, get_peft_model

adapter_config = AdapterConfig(
    adapter_size=64,    # 瓶颈维度
    task_type="SEQ_CLS",
)
model = get_peft_model(model, adapter_config)
```

---

### 2.4 Prefix Tuning / P-Tuning

**Prefix Tuning** 在每层 Transformer 的 Key-Value 序列前面插入可学习的"虚拟 Token"（Prefix）：

```
[PREFIX_1, PREFIX_2, ..., PREFIX_k, x₁, x₂, ..., xₙ]
```

- Prefix 参数在每层独立，通过 MLP 生成（防止训练不稳定）
- 模型主体完全冻结，只训练 Prefix 参数
- 适合生成任务（摘要、翻译）

**P-Tuning v2** 是 Prefix Tuning 的升级版，将 Prefix 深度应用到所有层，在分类任务上媲美全量微调。

---

### 2.5 各方案对比

| 方案 | 可训练参数 | 显存占用 | 推理开销 | 适用场景 |
|------|-----------|---------|---------|---------|
| 全量微调 | 100% | 极高 | 无 | 数据量大、资源充足 |
| LoRA | 0.1% ~ 1% | 低 | 无（可合并） | 通用微调首选 |
| QLoRA | < 1%（4-bit基模） | 极低 | 量化推理 | 单卡训练大模型 |
| Adapter | 1% ~ 3% | 低 | 轻微增加 | 多任务、插件化 |
| Prefix Tuning | < 0.1% | 极低 | 轻微增加 | 生成任务 |
| P-Tuning v2 | < 0.1% | 极低 | 轻微增加 | 分类/理解任务 |

---

## 3. 基于强化学习的对齐训练

> 项目参考：[huggingface/trl](https://github.com/huggingface/trl)

让模型"听话"——不仅要知识丰富，还要遵守人类偏好，这需要 **对齐训练（Alignment Training）**。

### 3.1 RLHF 流程

**RLHF（Reinforcement Learning from Human Feedback）** 是 InstructGPT 和 ChatGPT 的核心训练方法，分三个阶段：

```
阶段一：监督微调（SFT）
  人工标注的高质量问答对
  ↓ 全量微调 or LoRA
  SFT 模型（指令跟随的基础）

阶段二：奖励模型训练（RM）
  同一问题的多个回答 → 人工排序
  ↓ 训练二分类/排序模型
  奖励模型（能打分：哪个回答更好）

阶段三：PPO 强化学习
  SFT 模型 生成回答
  ↓ 奖励模型打分
  ↓ PPO 更新策略模型
  对齐后的模型（既聪明又听话）
```

**关键约束：KL 散度惩罚**

为防止模型为了获取高奖励而偏离原始分布（奖励黑客），PPO 阶段引入 KL 惩罚：

```
总奖励 = 奖励模型分数 - β × KL(策略模型 || SFT参考模型)
```

---

### 3.2 PPO 算法

PPO（Proximal Policy Optimization）是 RLHF 阶段的优化器，核心思想是"小步更新"。

```python
from trl import PPOTrainer, PPOConfig, AutoModelForCausalLMWithValueHead

# 带 Value Head 的策略模型（PPO 需要价值函数）
model = AutoModelForCausalLMWithValueHead.from_pretrained("sft_model")

ppo_config = PPOConfig(
    model_name="sft_model",
    learning_rate=1.41e-5,
    batch_size=128,
    mini_batch_size=4,
    ppo_epochs=4,
    kl_penalty="kl",       # KL 惩罚类型
    init_kl_coef=0.2,      # KL 系数 β
)

ppo_trainer = PPOTrainer(config=ppo_config, model=model, ref_model=ref_model, 
                          tokenizer=tokenizer, reward_model=reward_model)

# 训练循环
for batch in dataloader:
    # 1. 生成回答
    response_tensors = ppo_trainer.generate(batch["query_tensors"])
    # 2. 奖励模型打分
    rewards = [reward_model(q, r) for q, r in zip(batch["queries"], responses)]
    # 3. PPO 更新
    stats = ppo_trainer.step(batch["query_tensors"], response_tensors, rewards)
```

---

### 3.3 DPO：直接偏好优化

**DPO（Direct Preference Optimization）** 于 2023 年由斯坦福提出，绕过了奖励模型，直接在偏好数据上优化策略模型。

#### 核心思想

RLHF 的本质目标可以数学等价地转化为：

```
最大化：log P(y_chosen | x) - log P(y_rejected | x)
同时保持接近参考模型（KL 约束）
```

DPO 推导出闭合形式的损失函数：

```
L_DPO = -E[log σ(β × (log π(y_w|x)/π_ref(y_w|x) - log π(y_l|x)/π_ref(y_l|x)))]
```

其中 `y_w` 为偏好回答（winner），`y_l` 为被拒绝回答（loser）。

#### 关键代码

```python
from trl import DPOTrainer, DPOConfig
from datasets import load_dataset

# 偏好数据集格式: {"prompt": ..., "chosen": ..., "rejected": ...}
dataset = load_dataset("HuggingFaceH4/ultrafeedback_binarized")

dpo_config = DPOConfig(
    beta=0.1,                    # KL 约束强度（越小越激进）
    loss_type="sigmoid",         # 损失类型，可选 "hinge", "ipo"
    learning_rate=5e-7,
    per_device_train_batch_size=4,
    num_train_epochs=3,
    output_dir="./dpo_output",
)

dpo_trainer = DPOTrainer(
    model=model,
    ref_model=ref_model,         # SFT 参考模型（固定）
    args=dpo_config,
    train_dataset=dataset["train"],
    tokenizer=tokenizer,
)

dpo_trainer.train()
```

#### DPO vs RLHF 对比

| 维度 | RLHF + PPO | DPO |
|------|-----------|-----|
| 训练复杂度 | 高（需同时维护策略、参考、奖励、价值模型） | 低（只需策略+参考模型） |
| 显存占用 | 很高（4个模型） | 较低（2个模型） |
| 稳定性 | 较难调参 | 训练稳定 |
| 效果上限 | 理论更高（有奖励模型做中间件） | 略低，但工程上更实用 |
| 代表应用 | InstructGPT、早期 Claude | LLaMA-2-Chat、Zephyr |

---

### 3.4 GRPO：组相对策略优化

**GRPO（Group Relative Policy Optimization）** 由 DeepSeek 于 2024 年提出，用于 DeepSeek-R1 的推理能力训练。

#### 核心创新

GRPO 去掉了 PPO 中的价值模型（Critic），使用**组内相对奖励**估计基线：

```
对于同一个问题 x，采样 G 个回答 {y₁, y₂, ..., yG}
基线 = mean(reward(y₁), ..., reward(yG))
每个样本的优势 = reward(yᵢ) - baseline
```

这样：
- 节省了一个价值模型的显存（减少 25% 显存）
- 对于数学/代码题，可用规则验证奖励（答案对/错），无需奖励模型
- 更适合有明确验证器的推理任务

```python
from trl import GRPOTrainer, GRPOConfig

grpo_config = GRPOConfig(
    num_generations=8,       # 每个问题采样 8 个回答（G）
    max_new_tokens=512,
    temperature=0.9,
    beta=0.04,               # KL 约束系数
    learning_rate=5e-6,
)

# 验证函数（规则奖励：答案正确得 1 分，否则 0 分）
def reward_fn(completions, ground_truths, **kwargs):
    rewards = []
    for completion, gt in zip(completions, ground_truths):
        rewards.append(1.0 if extract_answer(completion) == gt else 0.0)
    return rewards

grpo_trainer = GRPOTrainer(
    model=model,
    args=grpo_config,
    reward_funcs=reward_fn,
    train_dataset=math_dataset,
)
grpo_trainer.train()
```

---

### 3.5 对比小结

| 方法 | 核心思路 | 显存需求 | 推荐场景 |
|------|---------|---------|---------|
| PPO (RLHF) | 策略梯度 + 奖励模型 | 极高（4模型） | 通用对齐，追求效果上限 |
| DPO | 直接优化偏好对 | 中等（2模型） | 工程实践首选，偏好数据充足时 |
| GRPO | 组内相对奖励，无 Critic | 低（1模型+采样） | 数学/代码推理任务 |
| KTO | 单样本奖励（无需成对数据） | 低（2模型） | 偏好数据难以配对时 |

---

## 4. 分布式 RL 训练——verl 框架

> 项目参考：[verl-project/verl](https://github.com/verl-project/verl)

verl（Volcano Engine Reinforcement Learning）是字节跳动开源的可扩展 RL 训练框架，用于大规模 LLM 的后训练。

### 4.1 核心架构

verl 的设计哲学是 **"混合控制器"**，将 RL 训练拆分为两类角色：

```
┌─────────────────────────────────────────────────────┐
│                   Driver（单节点）                    │
│  负责：RL 算法逻辑、数据调度、超参数管理               │
└─────────────────┬───────────────────────────────────┘
                  │  gRPC 通信
        ┌─────────┴──────────┐
        │                    │
┌───────▼───────┐   ┌────────▼──────┐
│ Actor Worker  │   │ Critic Worker │
│（策略模型推理） │   │（价值模型推理） │
│ N × GPU 节点  │   │ M × GPU 节点  │
└───────────────┘   └───────────────┘
```

### 4.2 关键特性

| 特性 | 说明 |
|------|------|
| **异步推理** | Actor 生成样本时，Critic 可并行评估上一批 |
| **灵活后端** | 支持 vLLM（高吞吐推理）+ Megatron（高效训练）混合 |
| **内存复用** | 推理和训练权重共享，减少 GPU 内存复制 |
| **多算法支持** | 内置 PPO、GRPO、DPO、ReMax 等 |

### 4.3 快速启动示例

```python
# verl 训练配置示例（YAML 格式）
# config/ppo_trainer.yaml

actor_rollout_ref:
  model:
    path: "Qwen/Qwen2.5-7B-Instruct"
  rollout:
    tensor_model_parallel_size: 1
    gpu_memory_utilization: 0.6
    
critic:
  model:
    path: "Qwen/Qwen2.5-7B-Instruct"
    
algorithm:
  kl_ctrl:
    type: "fixed"
    kl_coef: 0.001
  adv_estimator: "grpo"   # 使用 GRPO 优势估计
  
trainer:
  total_epochs: 2
  project_name: "my_rl_project"
```

---

## 5. 实战示例

### 端到端 QLoRA + DPO 微调流程

```bash
# 1. 环境准备
pip install transformers peft trl bitsandbytes accelerate datasets

# 2. 运行 QLoRA SFT（阶段一）
python train_sft.py \
  --model_name meta-llama/Llama-3.2-3B \
  --dataset alpaca_cleaned \
  --use_4bit \
  --lora_r 16 \
  --output_dir ./sft_output

# 3. 运行 DPO（阶段二）
python train_dpo.py \
  --model_name ./sft_output \
  --dataset HuggingFaceH4/ultrafeedback_binarized \
  --beta 0.1 \
  --output_dir ./dpo_output
```

```python
# train_sft.py 核心代码
from trl import SFTTrainer, SFTConfig
from peft import LoraConfig
from transformers import AutoModelForCausalLM, BitsAndBytesConfig

bnb_config = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4")
model = AutoModelForCausalLM.from_pretrained(model_name, quantization_config=bnb_config)

lora_config = LoraConfig(r=16, lora_alpha=32, target_modules="all-linear")

sft_config = SFTConfig(
    max_seq_length=2048,
    num_train_epochs=3,
    per_device_train_batch_size=4,
    gradient_accumulation_steps=4,   # 有效 batch_size = 16
    warmup_ratio=0.1,
    learning_rate=2e-4,
    fp16=True,
    output_dir=output_dir,
)

trainer = SFTTrainer(
    model=model,
    args=sft_config,
    train_dataset=dataset,
    peft_config=lora_config,
)
trainer.train()
trainer.save_model()
```

---

## 6. 最佳实践

### 微调策略选择流程图

```
有多少训练数据？
├── < 1000 条 → Prefix Tuning / P-Tuning（参数极少，防过拟合）
├── 1000 ~ 50000 条 → LoRA（r=8~32）
└── > 50000 条 → QLoRA（资源有限）或全量微调（资源充足）

是否需要对齐？
├── 有成对偏好数据 → DPO（工程首选）
├── 偏好数据稀少 → KTO
├── 有可验证任务（数学/代码） → GRPO
└── 追求极致效果 → RLHF + PPO
```

### 重要超参数建议

| 超参数 | SFT 推荐值 | DPO 推荐值 |
|--------|-----------|-----------|
| 学习率 | 1e-4 ~ 3e-4 | 5e-7 ~ 1e-6 |
| 批次大小 | 4 ~ 16 | 4 ~ 8 |
| 训练轮次 | 2 ~ 5 | 1 ~ 3 |
| LoRA r | 16 ~ 64 | 16 ~ 32 |
| 序列长度 | 2048 ~ 4096 | 1024 ~ 2048 |

### 防止灾难性遗忘

1. **使用较低学习率**：比全量微调低 10 倍
2. **LoRA 而非全量**：冻结主干保留通用能力
3. **混合通用数据**：在领域数据中混入 10%~20% 通用数据
4. **早停（Early Stopping）**：监控验证集困惑度，防止过拟合

---

## 7. 常见问题

**Q: LoRA 的 `r` 值越大越好吗？**
A: 不是。`r` 越大参数越多，过拟合风险越高，训练越慢。对于数千条数据，`r=8` 通常已足够；只有在数据量大且任务复杂时才需要 `r=64`。

**Q: DPO 训练时损失不下降怎么办？**
A: 常见原因：(1) `beta` 值过大，约束太强；(2) 偏好数据质量差（chosen 与 rejected 差异不明显）；(3) 学习率过高。建议先降低 `beta` 和学习率。

**Q: QLoRA 和 LoRA 效果差多少？**
A: 通常在 1%~3% 以内，在大多数任务上可忽略不计。QLoRA 的量化误差主要影响模型的数学和复杂推理能力，对通用对话影响极小。

**Q: 如何选择 `target_modules`？**
A: 最小配置：`["q_proj", "v_proj"]`；更好效果：`["q_proj", "k_proj", "v_proj", "o_proj"]`；最大覆盖：`"all-linear"`（包含 FFN 层）。覆盖越多效果越好但参数越多。

---

## 导航

- ← [技术资料总目录](../README.md)
- ↔ [对应面试题](../../02-面试指南/07-AI-Agent全栈开发面试/08-LLM微调技术面试题.md)
- → [09-多Agent系统](./09-多Agent系统.md)
