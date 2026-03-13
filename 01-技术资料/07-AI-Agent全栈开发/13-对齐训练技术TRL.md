# 对齐训练技术（RLHF / DPO / GRPO / TRL）

> **对齐训练（Alignment Training）**是让大语言模型的输出符合人类价值观与指令意图的关键技术。本文系统讲解 RLHF、PPO、DPO、GRPO 等对齐方法的原理，并以 HuggingFace TRL 库为参考实现。

## 相关链接

- 对应面试题：[13-对齐训练面试题](../../02-面试指南/07-AI-Agent全栈开发面试/13-TRL面试题.md)

---


## 1. 什么是 TRL

### 定义与定位

TRL 是 HuggingFace 开发的**大语言模型对齐训练框架**，提供从监督微调到强化学习对齐的完整工具链。

```
TRL 的核心使命：
"将 LLM 的输出与人类偏好对齐"

训练阶段支持：
  SFT    → Supervised Fine-Tuning（监督微调）
  RM     → Reward Model Training（奖励模型训练）
  PPO    → Proximal Policy Optimization（近端策略优化）
  DPO    → Direct Preference Optimization（直接偏好优化）
  GRPO   → Group Relative Policy Optimization（组相对策略优化）
  ORPO   → Odds Ratio Preference Optimization
  KTO    → Kahneman-Tversky Optimization
  SimPO  → Simple Preference Optimization
```

### TRL 与 PEFT 的关系

```
┌─────────────────────────────────────────────────┐
│                   TRL                           │
│  SFTTrainer / DPOTrainer / PPOTrainer           │
│  提供：训练流程、损失函数、数据处理             │
└─────────────────────────┬───────────────────────┘
                          │ 集成使用
┌─────────────────────────▼───────────────────────┐
│                   PEFT                          │
│  LoRA / QLoRA 适配器                           │
│  提供：高效微调（节省显存）                     │
└─────────────────────────┬───────────────────────┘
                          │ 基于
┌─────────────────────────▼───────────────────────┐
│              Transformers                       │
│  基础模型（LLaMA、Mistral、Qwen...）            │
└─────────────────────────────────────────────────┘
```

---

## 2. RLHF 完整流水线

### 三阶段流程

```
阶段 1：SFT（监督微调）
   目标：让模型学会"按指令回答"
   数据：高质量 (instruction, response) 对
   方法：标准语言模型训练（负对数似然）
        └→ 输出：SFT 模型（具备基础指令能力）

阶段 2：Reward Model（奖励模型）
   目标：学会评价哪个回答"更好"
   数据：人工标注的偏好对 (prompt, chosen, rejected)
        人类标注：哪个回答质量更高？
   方法：Bradley-Terry 偏好模型
        └→ 输出：RM（能给回答打分的模型）

阶段 3：PPO（强化学习对齐）
   目标：用 RM 的反馈优化 SFT 模型
   方法：Policy Gradient + KL 惩罚
        └→ 输出：对齐后的模型（遵循人类偏好）
```

### 详细架构图

```
                    ┌─────────────────────────┐
                    │      标注数据            │
                    │  (prompt, chosen, rejected) │
                    └──────────┬──────────────┘
                               │
            ┌──────────────────▼───────────────────┐
            │            Phase 1: SFT               │
            │  训练数据：instruction-response 对     │
            │  损失函数：CrossEntropy(y_hat, y)      │
            └──────────────────┬───────────────────┘
                               │ SFT Model
            ┌──────────────────▼───────────────────┐
            │         Phase 2: Reward Model         │
            │  输入：(prompt, response_A, response_B) │
            │  输出：r_A > r_B 的概率               │
            │  损失：-log σ(r_chosen - r_rejected)  │
            └──────────────────┬───────────────────┘
                               │ Reward Model
            ┌──────────────────▼───────────────────┐
            │            Phase 3: PPO               │
            │                                       │
            │  Policy (SFT + 可训练)                │
            │      ↓ 生成 response                  │
            │  Reward Model                         │
            │      ↓ 打分 r                         │
            │  PPO 更新：                           │
            │  Loss = -r + β×KL(policy||reference)  │
            └──────────────────┬───────────────────┘
                               │ Aligned Model
                          最终对齐模型
```

### SFT 阶段详解

```python
# SFT 损失函数（标准语言模型训练）
# 给定 (instruction, response)，最大化 response 的对数似然

def sft_loss(model, input_ids, labels):
    """
    input_ids: [instruction + response] tokens
    labels:    [-100 (mask instruction)] + [response tokens]
    """
    outputs = model(input_ids=input_ids, labels=labels)
    return outputs.loss
    # loss = -1/N × Σ log P(token_i | context)
    # 只对 response 部分计算 loss（instruction 部分 label=-100）
```

### Reward Model 阶段详解

```python
# Bradley-Terry 偏好模型
# 给定 (prompt, chosen, rejected)，学习：
# P(chosen > rejected) = σ(r_chosen - r_rejected)

def reward_loss(reward_model, prompt, chosen, rejected):
    """
    reward_model: 在 SFT 模型基础上加 scalar head
    输出：每个 response 的标量奖励分数
    """
    r_chosen   = reward_model(prompt + chosen)    # 标量
    r_rejected = reward_model(prompt + rejected)  # 标量

    # Bradley-Terry 损失
    loss = -F.logsigmoid(r_chosen - r_rejected)
    return loss
    # 训练目标：r_chosen > r_rejected（chosen 分数更高）
```

### PPO 阶段详解

```python
# PPO 的目标函数（简化版）
# 在提高 reward 的同时，不让 policy 偏离 reference 太远

def ppo_loss(policy, reference_policy, reward_model, prompt):
    # 1. 用 policy 生成 response
    response = policy.generate(prompt)

    # 2. 计算奖励
    reward = reward_model(prompt + response)

    # 3. KL 散度惩罚（防止 reward hacking）
    log_probs_policy    = policy.log_prob(response | prompt)
    log_probs_reference = reference_policy.log_prob(response | prompt)
    kl_penalty = log_probs_policy - log_probs_reference  # KL(policy || ref)

    # 4. 最终目标：最大化 reward，同时最小化 KL 偏离
    # loss = -(reward - β × kl_penalty)
    # β 是 KL 惩罚系数（通常 0.01~0.1）

    # 5. PPO Clip：限制策略更新幅度
    ratio = torch.exp(log_probs_policy - log_probs_old)
    clipped = torch.clamp(ratio, 1-ε, 1+ε)  # ε 通常 0.2
    loss = -min(ratio × advantage, clipped × advantage)
    return loss
```

---

## 3. DPO 技术详解

### 动机：为什么不需要奖励模型？

RLHF 的痛点：
```
1. 奖励模型训练复杂（额外的训练阶段）
2. PPO 训练不稳定（策略梯度方差大）
3. Reward Hacking：策略会"欺骗"奖励模型
4. 需要大量计算（同时维护 policy + reference + reward model）
```

DPO 的洞察：**直接从偏好数据中学习，无需显式奖励模型**。

### 数学推导

**从 RLHF 目标函数出发**：
```
RLHF 目标：
  max_π  E[r(x, y)] - β × KL(π(y|x) || π_ref(y|x))
  其中 π = policy，π_ref = reference policy，r = reward

这个优化问题有解析解：
  π*(y|x) = (1/Z(x)) × π_ref(y|x) × exp(r(x,y)/β)
  Z(x) = Σ_y π_ref(y|x) × exp(r(x,y)/β)  ← 归一化常数

反解 r：
  r(x, y) = β × log(π*(y|x) / π_ref(y|x)) + β × log Z(x)
```

**将 r 代入 Bradley-Terry 损失**：
```
P(y_w > y_l | x) = σ(r(x, y_w) - r(x, y_l))
                 = σ(β × log(π*(y_w|x)/π_ref(y_w|x))
                      - β × log(π*(y_l|x)/π_ref(y_l|x)))

DPO 损失（用 π_θ 代替未知的 π*）：

L_DPO(π_θ) = -E_{(x, y_w, y_l)} [
    log σ(
        β × log(π_θ(y_w|x) / π_ref(y_w|x))
        - β × log(π_θ(y_l|x) / π_ref(y_l|x))
    )
]

其中：
  y_w = chosen（人类偏好的回答）
  y_l = rejected（被拒绝的回答）
  π_θ = 待训练的策略
  π_ref = 参考策略（通常是 SFT 模型，固定不变）
  β = 温度参数（控制偏离参考模型的程度，通常 0.1~0.5）
```

### DPO 的直觉理解

```
DPO 在做什么：

对于每个偏好对 (chosen, rejected)：
  ↑ 提高 chosen 回答的相对概率
      (相对于参考模型 π_ref)
  ↓ 降低 rejected 回答的相对概率
      (相对于参考模型 π_ref)

"相对"的关键性：
  不是简单地提高 chosen 的绝对概率
  而是提高 (chosen 对 ref 的对数概率比) 与 (rejected 对 ref 的对数概率比) 的差值

β 的作用：
  β → 0：允许任意偏离参考模型（可能忘记预训练知识）
  β → ∞：严格保持接近参考模型（难以适应偏好）
  通常 β = 0.1~0.5
```

### DPO vs RLHF 对比

```
维度              RLHF (PPO)                    DPO
─────────────────────────────────────────────────────────────────
训练阶段          3 阶段（SFT→RM→PPO）           2 阶段（SFT→DPO）
奖励模型          需要单独训练                   不需要
训练稳定性        不稳定（高方差策略梯度）        稳定（监督学习范式）
内存需求          4 个模型（policy/ref/RM/critic） 2 个模型（policy/ref）
调参复杂度        高（KL 系数、clip、GAE等）      低（只有 β）
Reward Hacking    存在（需要 KL 惩罚）            不存在（无显式 RM）
效果              理论最优                       接近 RLHF，实践常更好
典型应用          GPT-4、Claude                  Llama-2 Chat、Zephyr
```

---

## 4. GRPO：DeepSeek-R1 方法

### 什么是 GRPO

GRPO（Group Relative Policy Optimization）是 DeepSeek 提出的方法，**无需 Critic 网络**的策略梯度算法，专为 LLM 推理能力优化设计。

### PPO 的问题与 GRPO 的解决

```
PPO 的 Critic 问题：
  PPO 需要一个 Critic（价值网络）来估计 baseline
  Critic 通常与 policy 同等大小（70B Policy → 70B Critic）
  内存双倍，训练复杂，Critic 本身可能不准确

GRPO 的解决方案：用"组内相对优势"代替 Critic

组采样：
  对每个 prompt，从当前 policy 采样 G 个回答
  {y₁, y₂, ..., y_G}

组内奖励归一化：
  对每个回答计算奖励 {r₁, r₂, ..., r_G}
  优势 A_i = (r_i - mean(r)) / std(r)
             ↑ 组内均值归一化（代替 Critic 的 baseline）

更新公式：
  L_GRPO = -E[A_i × min(ratio, clip(ratio, 1±ε))]
           + β × KL(π_θ || π_ref)
```

### GRPO 的奖励函数设计（DeepSeek-R1）

```python
# DeepSeek-R1 使用规则基础奖励（无需奖励模型）

def compute_reward(response: str, ground_truth: str, task: str) -> float:
    """
    GRPO 的奖励函数（基于规则，无需 RM）
    """
    reward = 0.0

    # 1. 格式奖励（Thinking 格式）
    if "<think>" in response and "</think>" in response:
        reward += 0.5  # 有推理过程
    if "<answer>" in response:
        reward += 0.5  # 有答案格式

    # 2. 正确性奖励（最重要）
    extracted_answer = extract_answer(response)
    if extracted_answer == ground_truth:
        reward += 1.0  # 完全正确

    # 3. 长度惩罚（避免冗长）
    if len(response) > 4096:
        reward -= 0.1

    return reward

# 优点：完全可验证，无 reward hacking 风险
# 适用：数学、编程等有明确答案的任务
```

### GRPO 与 PPO 对比

```
维度              PPO                           GRPO
─────────────────────────────────────────────────────────────────
Baseline 估计     Critic 网络（参数量同 Policy）   组内均值（无额外参数）
内存占用          4 个模型（Policy/Ref/RM/Critic）  2 个模型（Policy/Ref）
奖励函数          依赖训练好的 RM                  可用规则奖励
适用任务          通用对齐                         推理/代码/数学（可验证）
训练稳定性        较不稳定                         较稳定
DeepSeek-R1 用途  —                               核心训练方法
```

---

## 5. 其他对齐方法

### KTO（Kahneman-Tversky Optimization）

```
背景：行为经济学中的 Prospect Theory
  人类对损失的厌恶程度大于对同等收益的满足感

KTO 的数据格式：
  不需要 (chosen, rejected) 对
  只需要 (prompt, response, is_good) — 单条标注
  is_good = True/False（好/坏回答）

损失函数：
  对好回答：最大化 σ(r(x,y) - z₀)
  对坏回答：最小化 σ(r(x,y) - z₀)
  z₀ 是 KL 惩罚项

优势：
  数据标注成本低（无需成对比较）
  对不平衡数据鲁棒
  
使用场景：只有单条好/坏标注，没有成对偏好数据
```

### ORPO（Odds Ratio Preference Optimization）

```
创新点：将 SFT 和对齐合并为单阶段训练

损失函数：
  L_ORPO = L_SFT + λ × L_OR

  L_SFT：标准语言模型损失（学习生成 chosen）
  L_OR：Odds Ratio 损失（拉大 chosen vs rejected 的概率差）

  L_OR = -log σ(log(odds_ratio(chosen)) - log(odds_ratio(rejected)))
  odds_ratio(y|x) = P(y|x) / (1 - P(y|x))

优势：
  无需参考模型（节省内存）
  单阶段训练（更简单）
  
使用场景：资源受限，追求简单高效
```

### SimPO（Simple Preference Optimization）

```
对 DPO 的简化改进：

1. 去除参考模型（无需 π_ref，节省内存）
2. 用平均对数概率代替总对数概率：
   P(y|x) = exp(1/|y| × Σ log P(yᵢ|x, y<i))
   避免长回答被惩罚的问题

3. 加入 margin γ：
   L_SimPO = -log σ(β/|y_w| × log π(y_w|x)
                    - β/|y_l| × log π(y_l|x) - γ)

优势：
  无需参考模型
  长度归一化更公平
  γ 提供明确的分隔边界

效果：实验上常优于 DPO
```

---

## 6. 方法对比与选择

### 综合对比表

| 方法 | 数据格式 | 奖励模型 | 参考模型 | 训练阶段 | 稳定性 | 推荐场景 |
|------|---------|---------|---------|---------|--------|---------|
| SFT | (instruction, response) | ❌ | ❌ | 1 | ⭐⭐⭐⭐⭐ | 基础指令微调 |
| RLHF+PPO | (prompt, chosen, rejected) | ✅ | ✅ | 3 | ⭐⭐ | 复杂偏好对齐 |
| DPO | (prompt, chosen, rejected) | ❌ | ✅ | 2 | ⭐⭐⭐⭐ | 通用对齐首选 |
| GRPO | (prompt, ground_truth) | 规则 | ✅ | 2 | ⭐⭐⭐⭐ | 推理/代码任务 |
| KTO | (prompt, response, label) | ❌ | ✅ | 2 | ⭐⭐⭐⭐ | 单条标注数据 |
| ORPO | (prompt, chosen, rejected) | ❌ | ❌ | 1 | ⭐⭐⭐⭐⭐ | 资源受限 |
| SimPO | (prompt, chosen, rejected) | ❌ | ❌ | 2 | ⭐⭐⭐⭐⭐ | DPO 替代 |

### 决策指南

```
你的目标是什么？

├─ 让模型学会回答指令
│   └─ SFT（先做这个！）
│
├─ 让模型的回答更符合人类偏好
│   ├─ 有成对偏好数据 (chosen/rejected)
│   │   ├─ 资源充足 → DPO（推荐）
│   │   ├─ 资源受限 → ORPO / SimPO
│   │   └─ 追求最优 → PPO（复杂但可能最好）
│   │
│   └─ 只有好/坏标注（非成对）
│       └─ KTO
│
└─ 让模型具备推理/代码/数学能力
    └─ GRPO（DeepSeek-R1 方式）
       奖励函数：验证答案正确性的规则

通用推荐流程：
  SFT（1~3 epochs）→ DPO（1~2 epochs）
  这是目前最流行、最稳定的对齐方案
```

---

## 参考资料

- [TRL 官方文档](https://huggingface.co/docs/trl)
- [DPO 论文](https://arxiv.org/abs/2305.18290) - Rafailov et al., 2023
- [GRPO/DeepSeek-R1 论文](https://arxiv.org/abs/2501.12948) - DeepSeek-AI, 2025
- [KTO 论文](https://arxiv.org/abs/2402.01306) - Ethayarajh et al., 2024
- [ORPO 论文](https://arxiv.org/abs/2403.07691) - Hong et al., 2024
- [SimPO 论文](https://arxiv.org/abs/2405.14734) - Meng et al., 2024
- [InstructGPT/RLHF](https://arxiv.org/abs/2203.02155) - Ouyang et al., 2022

## 1. TRL 组件总览

### 库结构

```
trl/
├── trainer/
│   ├── sft_trainer.py         ← SFT 训练器
│   ├── reward_trainer.py      ← 奖励模型训练器
│   ├── ppo_trainer.py         ← PPO 训练器
│   ├── dpo_trainer.py         ← DPO 训练器
│   ├── grpo_trainer.py        ← GRPO 训练器
│   ├── kto_trainer.py         ← KTO 训练器
│   └── orpo_trainer.py        ← ORPO 训练器
├── models/
│   ├── modeling_value_head.py  ← PPO 用的 Value Head
│   └── utils.py
└── core.py                    ← 工具函数（PPO 相关）
```

### 对应关系

```
训练阶段          TRL 组件            Config 类
────────────────────────────────────────────────────────
SFT              SFTTrainer           SFTConfig
Reward Model     RewardTrainer        RewardConfig
PPO              PPOTrainer           PPOConfig
DPO              DPOTrainer           DPOConfig
GRPO             GRPOTrainer          GRPOConfig
KTO              KTOTrainer           KTOConfig
ORPO             ORPOTrainer          ORPOConfig
SimPO            SimPOTrainer         SimPOConfig
```

### 安装

```bash
pip install trl transformers peft accelerate datasets
# 可选：用于实验追踪
pip install wandb
# 可选：Flash Attention 加速
pip install flash-attn --no-build-isolation
```

---

## 2. SFTTrainer：监督微调

### SFTConfig 完整参数

```python
from trl import SFTConfig, SFTTrainer

config = SFTConfig(
    # ─── 输出 ──────────────────────────────────────────────
    output_dir="./output/sft",

    # ─── 批次与步数 ─────────────────────────────────────────
    per_device_train_batch_size=4,
    per_device_eval_batch_size=4,
    gradient_accumulation_steps=4,
    num_train_epochs=3,
    max_steps=-1,                    # -1 表示按 epoch 训练

    # ─── 序列处理 ───────────────────────────────────────────
    max_seq_length=2048,             # 最大序列长度（超过截断）
    packing=True,                    # 序列拼接（提高 GPU 利用率）
    dataset_text_field="text",       # 数据集中文本字段名
    dataset_num_proc=4,              # 数据预处理进程数

    # ─── 学习率 ─────────────────────────────────────────────
    learning_rate=2e-4,
    lr_scheduler_type="cosine",
    warmup_ratio=0.05,

    # ─── 精度与性能 ─────────────────────────────────────────
    bf16=True,
    gradient_checkpointing=True,
    gradient_checkpointing_kwargs={"use_reentrant": False},
    optim="adamw_torch_fused",

    # ─── 日志与保存 ─────────────────────────────────────────
    logging_steps=10,
    eval_strategy="steps",
    eval_steps=100,
    save_strategy="steps",
    save_steps=200,
    save_total_limit=3,
    report_to="wandb",

    # ─── 数据处理 ───────────────────────────────────────────
    remove_unused_columns=False,     # 保留所有数据列
)
```

### 数据集格式

```python
from datasets import Dataset

# ─── 格式1：单文本字段（最简单）────────────────────────────
data = [
    {"text": "### Instruction:\n写一首诗\n\n### Response:\n春风拂..."},
    {"text": "### Instruction:\n解释 Python 装饰器\n\n### Response:\n装饰器是..."},
]
dataset = Dataset.from_list(data)

# ─── 格式2：对话格式（推荐，支持多轮）──────────────────────
data = [
    {
        "messages": [
            {"role": "system", "content": "你是一个有帮助的助手。"},
            {"role": "user", "content": "什么是机器学习？"},
            {"role": "assistant", "content": "机器学习是..."},
        ]
    }
]
# SFTTrainer 会自动使用 tokenizer 的 apply_chat_template

# ─── 格式3：自定义格式化函数───────────────────────────────
def formatting_func(example):
    return f"<s>[INST] {example['instruction']} [/INST] {example['output']} </s>"

trainer = SFTTrainer(
    model=model,
    args=config,
    train_dataset=dataset,
    formatting_func=formatting_func,    # 自定义格式化
)
```

### Packing 机制详解

```python
# Packing：将多个短序列拼接为一个长序列
# 避免大量 padding，提高 GPU 利用率

# 不用 packing（低效）：
# seq1: [tok1, tok2, ..., PAD, PAD, PAD]  → 实际长 200，padding 1848
# seq2: [tok1, tok2, ..., PAD, PAD, PAD]  → 实际长 512，padding 1536
# 大量 GPU 算力浪费在 padding 上

# 使用 packing（高效）：
# packed_seq: [seq1_tok1, ..., seq1_end, seq2_tok1, ..., seq3_end, ...]
#             → 一个 2048 token 的序列装满多个样本
# GPU 利用率接近 100%

trainer = SFTTrainer(
    model=model,
    args=SFTConfig(max_seq_length=2048, packing=True),
    train_dataset=dataset,
)
# 注意：packing 时，样本间有 BOS/EOS token 分隔
# Attention mask 保证不同样本间不相互 attention（使用因果 mask 即可）
```

---

## 3. RewardTrainer：奖励模型

### 奖励模型架构

```python
# 奖励模型 = 语言模型 + 线性 scalar head
# 输入：prompt + response（完整序列）
# 输出：单个标量值（表示回答质量）

# 内部结构：
class RewardModel(nn.Module):
    def __init__(self, base_model):
        self.base_model = base_model
        # 加在最后一层 hidden state 上的 head
        self.score = nn.Linear(hidden_size, 1, bias=False)

    def forward(self, input_ids, attention_mask):
        outputs = self.base_model(input_ids, attention_mask)
        # 取最后一个 non-padding token 的 hidden state
        last_hidden = outputs.last_hidden_state[:, -1, :]
        return self.score(last_hidden).squeeze(-1)  # [batch_size]
```

### RewardConfig 与数据格式

```python
from trl import RewardConfig, RewardTrainer

reward_config = RewardConfig(
    output_dir="./output/reward-model",
    per_device_train_batch_size=4,
    num_train_epochs=2,
    learning_rate=1e-5,              # RM 学习率通常比 SFT 小
    bf16=True,
    gradient_checkpointing=True,
    max_length=1024,                 # prompt + response 的最大长度
    remove_unused_columns=False,
    report_to="wandb",
)

# ─── 数据格式：必须包含 chosen 和 rejected ─────────────────
data = [
    {
        "prompt": "请解释量子纠缠",
        "chosen": "量子纠缠是一种量子力学现象，指两个或多个粒子之间存在强关联...[详细准确的解释]",
        "rejected": "量子纠缠就是两个粒子互相影响，跟相对论有关...[不准确的解释]",
    }
]

# RewardTrainer 内部会自动：
# 1. 分词：tokenizer(prompt + chosen)，tokenizer(prompt + rejected)
# 2. 前向传播获得两个奖励分数
# 3. 计算 Bradley-Terry 损失

trainer = RewardTrainer(
    model=reward_model,
    args=reward_config,
    train_dataset=train_dataset,
    eval_dataset=eval_dataset,
    tokenizer=tokenizer,
)
trainer.train()
```

### 奖励模型评估

```python
# 评估奖励模型的关键指标：Accuracy
# 即：模型给 chosen 打分高于 rejected 的比例

def evaluate_reward_model(model, eval_dataset, tokenizer):
    correct = 0
    total = 0

    for batch in eval_dataloader:
        chosen_rewards  = model(**batch["chosen_input"]).logits
        rejected_rewards = model(**batch["rejected_input"]).logits

        # chosen 分数 > rejected 分数则正确
        correct += (chosen_rewards > rejected_rewards).sum().item()
        total += len(chosen_rewards)

    accuracy = correct / total
    print(f"Reward Model Accuracy: {accuracy:.2%}")
    # 通常 > 70% 才认为奖励模型有用
    # 顶级 RM：> 85%
```

---

## 4. PPOTrainer：策略优化

### PPOConfig 关键参数

```python
from trl import PPOConfig, PPOTrainer

ppo_config = PPOConfig(
    # ─── 基本设置 ──────────────────────────────────────────
    output_dir="./output/ppo",

    # ─── PPO 核心超参数 ─────────────────────────────────────
    learning_rate=1.41e-5,           # PPO 学习率通常远小于 SFT
    batch_size=128,                  # 总 batch size（prompt 数量）
    mini_batch_size=4,               # PPO 更新的 mini-batch
    gradient_accumulation_steps=1,

    # ─── KL 散度控制 ────────────────────────────────────────
    kl_penalty="kl",                 # "kl" | "abs" | "mse" | "full"
    init_kl_coef=0.2,               # 初始 KL 惩罚系数 β
    target_kl=6.0,                   # 目标 KL 散度（自适应调整 β）
    adap_kl_ctrl=True,               # 自适应 KL 系数

    # ─── PPO 算法参数 ────────────────────────────────────────
    cliprange=0.2,                   # PPO clip 范围 ε
    cliprange_value=0.2,             # Value function clip 范围
    gamma=1.0,                       # 折扣因子
    lam=0.95,                        # GAE lambda（优势估计）
    vf_coef=0.1,                     # Value loss 权重

    # ─── 生成设置 ───────────────────────────────────────────
    max_new_tokens=256,
    temperature=1.0,

    # ─── 日志 ───────────────────────────────────────────────
    log_with="wandb",
)
```

### PPO 训练循环

```python
from trl import PPOTrainer, AutoModelForCausalLMWithValueHead
import torch

# PPO 需要特殊的 Value Head 模型
model = AutoModelForCausalLMWithValueHead.from_pretrained(
    "sft-model-path",
    # Value Head：在 LM 顶部加一个线性层，输出 V(s)（状态价值）
)

# 参考模型：保持冻结，用于计算 KL 散度
ref_model = AutoModelForCausalLMWithValueHead.from_pretrained(
    "sft-model-path",
)
# 或自动创建（共享权重，节省内存）
# ref_model = None  # PPOTrainer 会自动创建

trainer = PPOTrainer(
    model=model,
    ref_model=ref_model,
    tokenizer=tokenizer,
    config=ppo_config,
    dataset=train_dataset,
)

# PPO 训练循环
for epoch in range(num_epochs):
    for batch in trainer.dataloader:
        # Step 1: 生成 response
        query_tensors = batch["input_ids"]

        response_tensors = trainer.generate(
            query_tensors,
            max_new_tokens=256,
            do_sample=True,
            temperature=1.0,
        )

        # Step 2: 计算奖励（使用奖励模型）
        texts = [tokenizer.decode(r) for r in response_tensors]
        rewards = [reward_model(text) for text in texts]
        rewards = [torch.tensor(r) for r in rewards]

        # Step 3: PPO 更新
        stats = trainer.step(
            queries=query_tensors,
            responses=response_tensors,
            scores=rewards,
        )

        # 打印统计信息
        trainer.log_stats(stats, batch, rewards)
        print(f"mean_reward: {sum(rewards)/len(rewards):.3f}")
        print(f"kl_div: {stats['objective/kl']:.3f}")
```

### PPO 关键统计指标

```python
# 训练中需要监控的核心指标：

# ppo/mean_scores：平均奖励分数
#   → 应该随训练持续上升（对齐效果）

# objective/kl：KL 散度（策略 vs 参考模型的差异）
#   → 目标控制在 target_kl 附近（通常 6~15）
#   → 过高：policy 偏离太远（Reward Hacking 风险）
#   → 过低：训练没有进展

# ppo/loss/policy：策略损失
#   → 应该逐渐降低

# ppo/val/clipfrac：clip 比例
#   → 通常 0.1~0.3（过高说明步长太大）
```

---

## 5. DPOTrainer：直接偏好优化

### DPOConfig 参数说明

```python
from trl import DPOConfig, DPOTrainer

dpo_config = DPOConfig(
    # ─── 基本训练参数 ───────────────────────────────────────
    output_dir="./output/dpo",
    per_device_train_batch_size=4,
    num_train_epochs=2,
    learning_rate=5e-7,              # DPO 学习率通常很小！
    lr_scheduler_type="linear",
    warmup_ratio=0.1,
    bf16=True,
    gradient_checkpointing=True,

    # ─── DPO 核心参数 ───────────────────────────────────────
    beta=0.1,                        # KL 惩罚系数（通常 0.1~0.5）
                                     # 越大 → 越保守（接近参考模型）
                                     # 越小 → 越激进（可能忘记预训练知识）

    loss_type="sigmoid",             # 损失函数类型
                                     # "sigmoid"：标准 DPO
                                     # "hinge"：Margin-based
                                     # "ipo"：IPO 变体
                                     # "kto_pair"：KTO 配对版本
                                     # "bco_pair"：BCO 配对版本

    # ─── 序列长度控制 ────────────────────────────────────────
    max_length=1024,                 # prompt + response 总长度上限
    max_prompt_length=512,           # prompt 单独的长度上限
    max_target_length=512,           # response 长度上限
    truncation_mode="keep_end",      # 截断方式：keep_start | keep_end

    # ─── 参考模型处理 ────────────────────────────────────────
    ref_model_sync_steps=512,        # 参考模型同步频率（通常不需要）

    # ─── 数据处理 ───────────────────────────────────────────
    remove_unused_columns=False,
    label_pad_token_id=-100,

    # ─── 日志 ───────────────────────────────────────────────
    logging_steps=10,
    report_to="wandb",
)
```

### 偏好数据格式

```python
# DPO 数据集必须包含：prompt, chosen, rejected

data = [
    {
        "prompt": "请给我推荐一部科幻电影",
        "chosen": "我推荐《星际穿越》，这部由克里斯托弗·诺兰执导的科幻电影...[详细有帮助的推荐]",
        "rejected": "看星球大战吧。[简短无用的回答]",
    }
]

# ─── 对话格式（推荐）─────────────────────────────────────
data_chat_format = [
    {
        "prompt": [
            {"role": "system", "content": "你是一个有帮助的助手。"},
            {"role": "user", "content": "请给我推荐一部科幻电影"},
        ],
        "chosen": [{"role": "assistant", "content": "我推荐《星际穿越》..."}],
        "rejected": [{"role": "assistant", "content": "看星球大战吧。"}],
    }
]
```

### DPOTrainer 初始化

```python
from trl import DPOTrainer
from peft import LoraConfig, get_peft_model

# 参考模型（冻结的 SFT 模型）
ref_model = AutoModelForCausalLM.from_pretrained(
    "sft-model-path",
    torch_dtype=torch.bfloat16,
)
# 注意：ref_model 在整个 DPO 训练中保持冻结

# 策略模型（将被优化）
policy_model = AutoModelForCausalLM.from_pretrained(
    "sft-model-path",
    torch_dtype=torch.bfloat16,
)

# 可选：使用 LoRA 减少参数
lora_config = LoraConfig(r=16, lora_alpha=32, task_type="CAUSAL_LM",
                          target_modules=["q_proj", "v_proj"])
policy_model = get_peft_model(policy_model, lora_config)

trainer = DPOTrainer(
    model=policy_model,
    ref_model=ref_model,          # 如果 model 是 PEFT，可设为 None（自动禁用 adapter 作参考）
    args=dpo_config,
    train_dataset=train_dataset,
    eval_dataset=eval_dataset,
    tokenizer=tokenizer,
)
trainer.train()
```

### DPO 训练监控

```python
# 关键指标解读：

# rewards/chosen：chosen 回答的奖励（隐式）
#   → 应该随训练升高

# rewards/rejected：rejected 回答的奖励（隐式）
#   → 应该随训练降低

# rewards/margins：chosen - rejected 的差值
#   → 核心指标！应该持续增大
#   → 目标：margin > 0 并稳定增长

# logps/chosen：chosen 的对数概率之和
# logps/rejected：rejected 的对数概率之和

# loss：DPO 损失
#   → 应该稳定下降

# 警告信号：
# ❌ margins 不增长：beta 可能太大，或数据质量差
# ❌ chosen 概率下降：policy 在遗忘（beta 太小）
# ❌ 损失震荡：学习率太高
```

---

## 6. GRPOTrainer：组相对策略优化

### GRPOConfig 参数

```python
from trl import GRPOConfig, GRPOTrainer

grpo_config = GRPOConfig(
    # ─── 基本训练参数 ───────────────────────────────────────
    output_dir="./output/grpo",
    per_device_train_batch_size=1,   # GRPO 每次处理 1 个 prompt
    num_generations=8,               # G：每个 prompt 采样 G 个回答
    gradient_accumulation_steps=4,
    learning_rate=1e-6,
    bf16=True,

    # ─── GRPO 核心参数 ───────────────────────────────────────
    beta=0.01,                       # KL 惩罚系数（通常比 DPO 小）
    epsilon=0.2,                     # PPO clip 范围

    # ─── 生成参数 ───────────────────────────────────────────
    max_new_tokens=512,              # 生成的最大 token 数
    max_prompt_length=512,           # prompt 最大长度

    # ─── 归一化 ─────────────────────────────────────────────
    use_vllm=False,                  # 使用 vLLM 加速生成（推荐！）
    vllm_gpu_memory_utilization=0.8,
    temperature=1.0,                 # 采样温度

    # ─── 日志 ───────────────────────────────────────────────
    logging_steps=1,
    report_to="wandb",
)
```

### 奖励函数设计

```python
# GRPO 的奖励函数必须：
# 1. 接受 (completions: List[str], **kwargs) 作为输入
# 2. 返回 List[float]（每个回答的奖励分数）

def correctness_reward(completions, ground_truths, **kwargs):
    """验证答案正确性的奖励函数（数学推理任务）"""
    rewards = []
    for completion, gt in zip(completions, ground_truths):
        # 从回答中提取最终答案
        answer = extract_answer(completion)
        if answer is None:
            rewards.append(0.0)
        elif answer.strip() == gt.strip():
            rewards.append(1.0)   # 完全正确
        else:
            rewards.append(0.0)   # 错误
    return rewards

def format_reward(completions, **kwargs):
    """检查输出格式的奖励函数"""
    rewards = []
    for completion in completions:
        reward = 0.0
        if "<think>" in completion and "</think>" in completion:
            reward += 0.3    # 有思考过程
        if "<answer>" in completion:
            reward += 0.2    # 有答案标签
        rewards.append(reward)
    return rewards

def length_penalty(completions, **kwargs):
    """长度惩罚（避免过长或过短）"""
    rewards = []
    for completion in completions:
        tokens = len(completion.split())
        if tokens < 10:
            rewards.append(-0.5)    # 过短
        elif tokens > 2000:
            rewards.append(-0.3)    # 过长
        else:
            rewards.append(0.0)     # 正常
    return rewards

# 组合多个奖励函数
reward_fns = [correctness_reward, format_reward, length_penalty]
```

### GRPOTrainer 完整示例

```python
from trl import GRPOTrainer

trainer = GRPOTrainer(
    model=policy_model,
    ref_model=ref_model,            # 可选，不提供则使用 policy 初始状态
    args=grpo_config,
    train_dataset=train_dataset,    # 只需要 prompt（和 ground_truth）
    reward_funcs=reward_fns,        # 奖励函数列表
    tokenizer=tokenizer,
)

# 数据集格式（只需要 prompt）
train_data = [
    {
        "prompt": "计算：123 × 456 = ?",
        "ground_truth": "56088",    # 用于 correctness_reward
    },
    {
        "prompt": "写一个 Python 函数，实现斐波那契数列",
        "ground_truth": None,       # 代码任务用执行结果验证
    }
]

trainer.train()
```

### GRPO 训练监控

```python
# 关键指标：

# reward/mean：平均奖励
#   → 应该随训练逐渐上升

# reward/std：组内奖励标准差
#   → 反映探索多样性
#   → 过小：模型收敛（可能过早收敛）
#   → 过大：不稳定

# kl/mean：KL 散度（policy vs ref）
#   → 应该在合理范围内（控制在 0.1~1.0）

# objective/entropy：策略熵
#   → 监控策略是否过于确定（collapse 风险）

# group_advantage/mean：组内优势均值（应接近 0）
# group_advantage/std：组内优势标准差
```

---

## 参考资料

- [TRL 文档 - SFTTrainer](https://huggingface.co/docs/trl/sft_trainer)
- [TRL 文档 - DPOTrainer](https://huggingface.co/docs/trl/dpo_trainer)
- [TRL 文档 - GRPOTrainer](https://huggingface.co/docs/trl/grpo_trainer)
- [TRL GitHub](https://github.com/huggingface/trl)
- [DeepSeek-R1 技术报告](https://arxiv.org/abs/2501.12948)


---


## 1. 完整 SFT→DPO 流水线

### 流水线概览

```
数据准备
  │
  ├─ instruction-response 对  → Phase 1: SFT
  │                                │
  │                                ▼
  └─ 偏好对 (chosen/rejected) → Phase 2: DPO
                                   │
                                   ▼
                             对齐后的模型
                             （评估 & 部署）
```

### Phase 1：SFT 完整脚本

```python
"""
sft_train.py - LLaMA-2-7B SFT 训练脚本
"""
import torch
from datasets import load_dataset
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from peft import LoraConfig, prepare_model_for_kbit_training
from trl import SFTConfig, SFTTrainer

# ─── 配置 ────────────────────────────────────────────────
MODEL_ID = "meta-llama/Llama-2-7b-hf"
OUTPUT_DIR = "./output/sft-llama2-7b"

# ─── 量化配置（QLoRA）───────────────────────────────────
bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.bfloat16,
    bnb_4bit_use_double_quant=True,
)

# ─── 加载模型 ────────────────────────────────────────────
tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
tokenizer.pad_token = tokenizer.eos_token
tokenizer.padding_side = "right"

model = AutoModelForCausalLM.from_pretrained(
    MODEL_ID,
    quantization_config=bnb_config,
    device_map="auto",
    use_cache=False,
)
model = prepare_model_for_kbit_training(model)

# ─── LoRA 配置 ───────────────────────────────────────────
lora_config = LoraConfig(
    r=16,
    lora_alpha=32,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM",
)

# ─── 数据集 ──────────────────────────────────────────────
def format_alpaca(example):
    if example.get("input"):
        return (f"### Instruction:\n{example['instruction']}\n\n"
                f"### Input:\n{example['input']}\n\n"
                f"### Response:\n{example['output']}")
    return (f"### Instruction:\n{example['instruction']}\n\n"
            f"### Response:\n{example['output']}")

dataset = load_dataset("tatsu-lab/alpaca", split="train")
dataset = dataset.map(lambda x: {"text": format_alpaca(x)})
dataset = dataset.train_test_split(test_size=0.05, seed=42)

# ─── 训练器 ──────────────────────────────────────────────
sft_config = SFTConfig(
    output_dir=OUTPUT_DIR,
    per_device_train_batch_size=2,
    gradient_accumulation_steps=8,
    num_train_epochs=3,
    learning_rate=2e-4,
    bf16=True,
    gradient_checkpointing=True,
    gradient_checkpointing_kwargs={"use_reentrant": False},
    optim="paged_adamw_8bit",
    max_seq_length=2048,
    packing=True,
    dataset_text_field="text",
    logging_steps=10,
    eval_strategy="steps",
    eval_steps=100,
    save_strategy="steps",
    save_steps=200,
    save_total_limit=3,
    report_to="wandb",
    run_name="sft-llama2-7b-alpaca",
)

trainer = SFTTrainer(
    model=model,
    args=sft_config,
    peft_config=lora_config,
    train_dataset=dataset["train"],
    eval_dataset=dataset["test"],
    tokenizer=tokenizer,
)

trainer.train()
trainer.save_model(OUTPUT_DIR)
print(f"SFT 训练完成！模型保存至 {OUTPUT_DIR}")
```

---

## 2. 偏好数据集准备

### 偏好数据的来源

```
偏好数据获取方式：

1. 人工标注（最高质量）
   - 收集 prompt → 生成多个候选回答 → 人工排序
   - 工具：Label Studio、Argilla
   - 成本：高

2. AI 辅助标注（平衡质量与成本）
   - 用强模型（GPT-4）评估回答质量
   - 用规则/模板自动生成 rejected（如故意生成错误答案）
   - 成本：中

3. 公开数据集
   - HH-RLHF（Anthropic）：人工标注，通用对话
   - UltraFeedback：GPT-4 标注，通用任务
   - Orca DPO Pairs：思维链对话
   - Ultrachat 200K：多轮对话
   - StackExchange Preferences：问答偏好
```

### 使用 UltraFeedback 数据集

```python
from datasets import load_dataset

# UltraFeedback：64K 高质量偏好对
dataset = load_dataset("argilla/ultrafeedback-binarized-preferences", split="train")

# 数据结构：
# {
#   "prompt": "...",
#   "chosen": [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}],
#   "rejected": [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]
# }

print(dataset[0]["prompt"])
print("---chosen---")
print(dataset[0]["chosen"][-1]["content"][:200])
print("---rejected---")
print(dataset[0]["rejected"][-1]["content"][:200])
```

### 自动构建偏好数据集

```python
"""使用 GPT-4 自动构建偏好数据"""
import openai
from typing import List, Tuple

def generate_preference_pair(
    prompt: str,
    strong_model: str = "gpt-4-turbo",
    weak_model: str = "gpt-3.5-turbo",
) -> dict:
    """
    用强模型生成 chosen，弱模型生成 rejected
    简单但有效的偏好数据构建方法
    """
    client = openai.OpenAI()

    # chosen：用强模型生成高质量回答
    chosen_response = client.chat.completions.create(
        model=strong_model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.7,
    )
    chosen = chosen_response.choices[0].message.content

    # rejected：用弱模型生成相对低质量回答
    rejected_response = client.chat.completions.create(
        model=weak_model,
        messages=[{"role": "user", "content": prompt}],
        temperature=1.2,        # 高温度增加随机性（质量更差）
    )
    rejected = rejected_response.choices[0].message.content

    return {
        "prompt": prompt,
        "chosen": chosen,
        "rejected": rejected,
    }

# 也可以用 LLM-as-Judge 评估已有回答对
def rank_responses_with_llm(
    prompt: str,
    response_a: str,
    response_b: str,
    judge_model: str = "gpt-4",
) -> Tuple[str, str]:
    """
    用 LLM 评判两个回答的质量，返回 (chosen, rejected)
    """
    judge_prompt = f"""请评估以下两个回答的质量，选择更好的一个。

问题：{prompt}

回答A：{response_a}

回答B：{response_b}

请只输出 "A" 或 "B" 表示哪个回答更好，然后简短说明原因。
"""
    client = openai.OpenAI()
    response = client.chat.completions.create(
        model=judge_model,
        messages=[{"role": "user", "content": judge_prompt}],
    )
    verdict = response.choices[0].message.content
    if verdict.startswith("A"):
        return response_a, response_b   # A is chosen
    else:
        return response_b, response_a   # B is chosen
```

### 数据质量过滤

```python
def filter_preference_data(dataset):
    """过滤低质量偏好对"""

    def quality_check(example):
        chosen = example["chosen"]
        rejected = example["rejected"]

        # 1. 长度检查：chosen 应该比 rejected 长（通常）
        if len(chosen) < 50:
            return False    # chosen 太短

        # 2. 内容差异检查：避免太相似的对
        from difflib import SequenceMatcher
        similarity = SequenceMatcher(None, chosen, rejected).ratio()
        if similarity > 0.9:
            return False    # 太相似（< 10% 差异），没有学习价值

        # 3. 避免 chosen == rejected 的边缘情况
        if chosen.strip() == rejected.strip():
            return False

        return True

    filtered = dataset.filter(quality_check)
    print(f"过滤前：{len(dataset)} | 过滤后：{len(filtered)}")
    return filtered
```

---

## 3. DPO 训练完整代码

```python
"""
dpo_train.py - 完整 DPO 训练脚本（基于 SFT 模型）
"""
import torch
from datasets import load_dataset
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import LoraConfig, get_peft_model, PeftModel
from trl import DPOConfig, DPOTrainer

# ─── 配置 ────────────────────────────────────────────────
SFT_MODEL_PATH = "./output/sft-llama2-7b"  # SFT 完成后的模型路径
OUTPUT_DIR = "./output/dpo-llama2-7b"

# ─── 加载模型（从 SFT checkpoint）───────────────────────
tokenizer = AutoTokenizer.from_pretrained(SFT_MODEL_PATH)
tokenizer.pad_token = tokenizer.eos_token

# Policy 模型（将被 DPO 优化）
model = AutoModelForCausalLM.from_pretrained(
    SFT_MODEL_PATH,
    torch_dtype=torch.bfloat16,
    device_map="auto",
)

# LoRA for DPO（可选，节省显存）
lora_config = LoraConfig(
    r=16,
    lora_alpha=32,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    lora_dropout=0.05,
    task_type="CAUSAL_LM",
)
model = get_peft_model(model, lora_config)

# 参考模型（冻结，等于 SFT 模型）
# 当 model 是 PeftModel 时，可以不传 ref_model
# DPOTrainer 会自动将 adapter 禁用作为参考模型
ref_model = None  # None = 自动使用禁用 adapter 的 model 作参考

# ─── 数据集 ──────────────────────────────────────────────
dataset = load_dataset("argilla/ultrafeedback-binarized-preferences")
dataset = dataset["train"].train_test_split(test_size=0.05, seed=42)

# ─── DPO 配置 ────────────────────────────────────────────
dpo_config = DPOConfig(
    output_dir=OUTPUT_DIR,
    per_device_train_batch_size=2,
    gradient_accumulation_steps=8,
    num_train_epochs=2,
    learning_rate=5e-7,              # DPO 学习率非常小！
    lr_scheduler_type="linear",
    warmup_ratio=0.1,
    bf16=True,
    gradient_checkpointing=True,
    gradient_checkpointing_kwargs={"use_reentrant": False},
    optim="paged_adamw_8bit",
    beta=0.1,                        # KL 惩罚系数
    max_length=1024,
    max_prompt_length=512,
    logging_steps=10,
    eval_strategy="steps",
    eval_steps=100,
    save_strategy="epoch",
    save_total_limit=2,
    report_to="wandb",
    run_name="dpo-llama2-7b-ultrafeedback",
)

# ─── DPO 训练器 ──────────────────────────────────────────
trainer = DPOTrainer(
    model=model,
    ref_model=ref_model,
    args=dpo_config,
    train_dataset=dataset["train"],
    eval_dataset=dataset["test"],
    tokenizer=tokenizer,
)

trainer.train()
trainer.save_model(OUTPUT_DIR)
print(f"DPO 训练完成！模型保存至 {OUTPUT_DIR}")
```

---

## 4. GRPO 推理能力对齐

### 数学推理任务（GSM8K 风格）

```python
"""
grpo_math.py - 使用 GRPO 提升数学推理能力（DeepSeek-R1 风格）
"""
import re
import torch
from datasets import load_dataset
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import LoraConfig
from trl import GRPOConfig, GRPOTrainer

MODEL_ID = "Qwen/Qwen2.5-7B-Instruct"  # 基础指令模型

# ─── 奖励函数 ─────────────────────────────────────────────

THINKING_PATTERN = re.compile(r"<think>(.*?)</think>", re.DOTALL)
ANSWER_PATTERN = re.compile(r"<answer>(.*?)</answer>", re.DOTALL)

def extract_answer(text: str):
    """从 <answer>...</answer> 标签中提取答案"""
    match = ANSWER_PATTERN.search(text)
    return match.group(1).strip() if match else None

def correctness_reward_fn(completions, ground_truths, **kwargs):
    """正确性奖励：答案完全匹配得 2 分"""
    rewards = []
    for completion, gt in zip(completions, ground_truths):
        answer = extract_answer(completion)
        if answer is not None and answer == gt.strip():
            rewards.append(2.0)
        else:
            rewards.append(0.0)
    return rewards

def format_reward_fn(completions, **kwargs):
    """格式奖励：鼓励使用思考格式"""
    rewards = []
    for completion in completions:
        reward = 0.0
        if THINKING_PATTERN.search(completion):
            reward += 0.5    # 有思考过程
        if ANSWER_PATTERN.search(completion):
            reward += 0.5    # 有答案格式
        rewards.append(reward)
    return rewards

def thinking_quality_reward_fn(completions, **kwargs):
    """思考质量奖励：思考步骤更多得分更高（有上限）"""
    rewards = []
    for completion in completions:
        think_match = THINKING_PATTERN.search(completion)
        if think_match:
            think_text = think_match.group(1)
            # 按换行数估计推理步骤数
            steps = len([l for l in think_text.split("\n") if l.strip()])
            reward = min(steps * 0.1, 0.5)  # 上限 0.5
        else:
            reward = 0.0
        rewards.append(reward)
    return rewards

# ─── 数据集准备 ────────────────────────────────────────────
dataset = load_dataset("openai/gsm8k", "main", split="train")

SYSTEM_PROMPT = """你是一个数学推理专家。
请按以下格式回答：
<think>
[在这里展示你的推理过程，逐步分析]
</think>
<answer>
[最终数值答案，只写数字]
</answer>"""

def format_for_grpo(example):
    return {
        "prompt": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": example["question"]},
        ],
        # 提取 GSM8K 的标准答案（格式："...\n#### 42"）
        "ground_truth": example["answer"].split("####")[-1].strip(),
    }

dataset = dataset.map(format_for_grpo)

# ─── GRPO 训练 ────────────────────────────────────────────
tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
model = AutoModelForCausalLM.from_pretrained(
    MODEL_ID,
    torch_dtype=torch.bfloat16,
    device_map="auto",
    use_cache=False,
)

lora_config = LoraConfig(
    r=16, lora_alpha=32,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    task_type="CAUSAL_LM",
)

grpo_config = GRPOConfig(
    output_dir="./output/grpo-qwen-math",
    per_device_train_batch_size=1,
    num_generations=8,               # 每个 prompt 生成 8 个回答
    gradient_accumulation_steps=4,
    num_train_epochs=3,
    learning_rate=1e-6,
    bf16=True,
    gradient_checkpointing=True,
    beta=0.01,
    epsilon=0.2,
    max_new_tokens=1024,
    max_prompt_length=512,
    temperature=1.0,
    logging_steps=1,
    report_to="wandb",
)

trainer = GRPOTrainer(
    model=model,
    args=grpo_config,
    peft_config=lora_config,
    reward_funcs=[
        correctness_reward_fn,
        format_reward_fn,
        thinking_quality_reward_fn,
    ],
    train_dataset=dataset,
    tokenizer=tokenizer,
)

trainer.train()
```

### 代码生成任务

```python
"""代码生成的 GRPO 奖励函数（基于执行结果）"""
import subprocess
import tempfile
import os

def code_execution_reward(completions, test_cases, **kwargs):
    """
    执行代码并运行测试用例
    通过的测试用例越多，奖励越高
    """
    rewards = []

    for completion, tests in zip(completions, test_cases):
        # 提取代码块
        code_match = re.search(r"```python\n(.*?)```", completion, re.DOTALL)
        if not code_match:
            rewards.append(0.0)
            continue

        code = code_match.group(1)

        # 执行测试
        pass_count = 0
        for test in tests:
            try:
                # 在独立进程中执行（安全隔离）
                full_code = code + "\n" + test
                result = subprocess.run(
                    ["python", "-c", full_code],
                    timeout=5,
                    capture_output=True,
                    text=True,
                )
                if result.returncode == 0:
                    pass_count += 1
            except subprocess.TimeoutExpired:
                pass  # 超时不得分

        rewards.append(pass_count / len(tests))  # 通过率作为奖励

    return rewards
```

---

## 5. 奖励模型训练与评估

### 完整奖励模型训练

```python
"""reward_model_train.py"""
from transformers import AutoModelForSequenceClassification, AutoTokenizer
from trl import RewardConfig, RewardTrainer

MODEL_ID = "meta-llama/Llama-2-7b-hf"

# 奖励模型使用 SequenceClassification 头（输出 1 个分数）
tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
tokenizer.pad_token = tokenizer.eos_token

model = AutoModelForSequenceClassification.from_pretrained(
    MODEL_ID,
    num_labels=1,                # 输出 1 个标量分数
    torch_dtype=torch.bfloat16,
    device_map="auto",
)
model.config.pad_token_id = tokenizer.eos_token_id

# 数据集：HH-RLHF
dataset = load_dataset("Anthropic/hh-rlhf", split="train")
# 格式：{"chosen": "...", "rejected": "..."}

reward_config = RewardConfig(
    output_dir="./output/reward-model",
    per_device_train_batch_size=4,
    num_train_epochs=2,
    learning_rate=1e-5,
    bf16=True,
    gradient_checkpointing=True,
    max_length=1024,
    logging_steps=10,
    report_to="wandb",
)

trainer = RewardTrainer(
    model=model,
    args=reward_config,
    tokenizer=tokenizer,
    train_dataset=dataset,
)

trainer.train()
trainer.save_model("./output/reward-model")
```

### 奖励模型评估与可视化

```python
"""评估奖励模型质量"""
import torch
import numpy as np
import matplotlib.pyplot as plt
from transformers import AutoModelForSequenceClassification, AutoTokenizer

def evaluate_reward_model(rm_path, eval_dataset, batch_size=8):
    model = AutoModelForSequenceClassification.from_pretrained(rm_path)
    tokenizer = AutoTokenizer.from_pretrained(rm_path)
    model.eval()

    chosen_scores = []
    rejected_scores = []

    for i in range(0, len(eval_dataset), batch_size):
        batch = eval_dataset[i:i+batch_size]

        for chosen, rejected in zip(batch["chosen"], batch["rejected"]):
            with torch.no_grad():
                c_inputs = tokenizer(chosen, return_tensors="pt", truncation=True, max_length=512)
                r_inputs = tokenizer(rejected, return_tensors="pt", truncation=True, max_length=512)
                c_score = model(**c_inputs).logits.item()
                r_score = model(**r_inputs).logits.item()
                chosen_scores.append(c_score)
                rejected_scores.append(r_score)

    accuracy = sum(c > r for c, r in zip(chosen_scores, rejected_scores)) / len(chosen_scores)
    mean_margin = np.mean([c - r for c, r in zip(chosen_scores, rejected_scores)])

    print(f"Accuracy: {accuracy:.2%}")
    print(f"Mean Margin (chosen - rejected): {mean_margin:.3f}")

    # 可视化分数分布
    plt.figure(figsize=(10, 4))
    plt.hist(chosen_scores, bins=50, alpha=0.7, label="Chosen", color="green")
    plt.hist(rejected_scores, bins=50, alpha=0.7, label="Rejected", color="red")
    plt.xlabel("Reward Score")
    plt.ylabel("Count")
    plt.title(f"Reward Distribution (Accuracy: {accuracy:.2%})")
    plt.legend()
    plt.savefig("reward_distribution.png")

    return {"accuracy": accuracy, "mean_margin": mean_margin}
```

---

## 6. 防止 Reward Hacking

### 什么是 Reward Hacking

```
Reward Hacking 场景：

训练奖励模型评分标准包含"详细程度"
策略学到了：只要把回答写得很长，即使内容不准确，也能骗过 RM

例子：
  提问：1+1=?
  正常回答："2"（RM 打分：7）
  Hacked 回答：
    "这是一个有趣的数学问题，让我详细解释...（500字废话）...答案是3"
    （RM 打分：9，但答案错误！）
```

### 防止策略

```python
# ─── 策略1：KL 惩罚（PPO/GRPO 内置）────────────────────────
# 训练时加 KL 散度惩罚：
# total_reward = task_reward - β × KL(policy || reference)
# β 越大 → policy 越不能偏离 reference → 越安全但效果受限

# ─── 策略2：多个奖励模型集成 ────────────────────────────────
def ensemble_reward(response, reward_models):
    """使用多个 RM 集成，减少单一 RM 被 hack 的风险"""
    scores = [rm(response) for rm in reward_models]
    # 取最小值（最保守）
    return min(scores)
    # 或加权平均

# ─── 策略3：使用规则奖励（最可靠）──────────────────────────
def rule_based_reward(response, ground_truth):
    """
    规则奖励无法被 hack（因为规则是确定性的）
    适用于数学、代码等可验证任务
    """
    answer = extract_final_answer(response)
    return 1.0 if answer == ground_truth else 0.0

# ─── 策略4：定期更新参考模型 ────────────────────────────────
# 在 PPO 训练中，定期将当前 policy 更新为新的 reference
# 防止策略走太远
ppo_config = PPOConfig(ref_model_sync_steps=512)

# ─── 策略5：监控生成长度和格式 ──────────────────────────────
def length_penalty_reward(response, max_length=500):
    """惩罚异常长度的回答"""
    token_count = len(response.split())
    if token_count > max_length:
        return -0.5 * (token_count - max_length) / max_length
    return 0.0
```

---

## 7. KL 系数调优

### KL 散度的作用与调优

```python
# KL 散度 = policy 与 reference 之间的"距离"
# KL(policy || reference) = Σ policy(y) × log(policy(y) / reference(y))

# β 系数的影响：
# β 太小（< 0.01）：
#   → policy 可以任意偏离 reference
#   → 模型可能忘记预训练知识
#   → Reward Hacking 风险高
#
# β 太大（> 1.0）：
#   → policy 被强迫接近 reference
#   → 对齐效果有限
#   → 浪费训练
#
# 推荐范围：
#   DPO:  β = 0.1~0.5
#   PPO:  β = 0.01~0.2（自适应 KL 控制）
#   GRPO: β = 0.001~0.05

# 自适应 KL 控制（PPO 的标准做法）：
ppo_config = PPOConfig(
    init_kl_coef=0.2,     # 初始 β
    target_kl=6.0,         # 目标 KL 值（训练会自动调整 β 以维持此值）
    adap_kl_ctrl=True,     # 启用自适应调整
    # 若 KL > target_kl：增大 β（更保守）
    # 若 KL < target_kl：减小 β（更激进）
)
```

### KL 监控代码

```python
def monitor_kl_divergence(policy_model, ref_model, eval_dataloader, tokenizer):
    """监控策略与参考模型之间的 KL 散度"""
    total_kl = 0
    count = 0

    for batch in eval_dataloader:
        input_ids = batch["input_ids"].to(policy_model.device)

        with torch.no_grad():
            policy_logits = policy_model(input_ids).logits
            ref_logits    = ref_model(input_ids).logits

        # 计算 token 级别的 KL 散度
        policy_probs = torch.softmax(policy_logits, dim=-1)
        ref_probs    = torch.softmax(ref_logits, dim=-1)

        # KL(policy || ref) = Σ policy × log(policy/ref)
        kl = (policy_probs * (policy_probs.log() - ref_probs.log())).sum(-1).mean()
        total_kl += kl.item()
        count += 1

    mean_kl = total_kl / count
    print(f"Average KL Divergence: {mean_kl:.4f}")

    if mean_kl > 20:
        print("⚠️  警告：KL 散度过高，policy 严重偏离 reference！")
    elif mean_kl < 0.1:
        print("ℹ️  KL 散度较低，可以考虑减小 β（更大的更新幅度）")
```

---

## 8. 训练监控与可视化

### Weights & Biases 集成

```python
import wandb

# 初始化 wandb
wandb.init(
    project="llm-alignment",
    name="sft-dpo-llama2-7b",
    config={
        "model": "llama2-7b",
        "method": "DPO",
        "beta": 0.1,
        "learning_rate": 5e-7,
        "dataset": "ultrafeedback",
    }
)

# DPOTrainer 会自动记录以下指标（report_to="wandb"）：
# - train/loss
# - eval/rewards_chosen
# - eval/rewards_rejected
# - eval/rewards_margins
# - eval/rewards_accuracies  ← 关键指标：chosen > rejected 的比例
# - eval/logps_chosen
# - eval/logps_rejected
```

### TensorBoard 监控

```bash
# 启动 TensorBoard
tensorboard --logdir ./output/dpo-training/runs

# 关键面板：
# Scalars:
#   - train/loss（训练损失，应下降）
#   - eval/rewards_margins（奖励差值，应上升）
#   - eval/rewards_accuracies（偏好准确率，应 > 0.7）
# Text:
#   - 样本生成输出（qualitative 评估）
```

### 自定义训练回调

```python
from transformers import TrainerCallback

class AlignmentMonitorCallback(TrainerCallback):
    """自定义回调：监控对齐训练中的关键指标"""

    def on_evaluate(self, args, state, control, metrics=None, **kwargs):
        if metrics is None:
            return

        step = state.global_step

        # 关键指标警报
        if "eval/rewards_accuracies" in metrics:
            acc = metrics["eval/rewards_accuracies"]
            if acc < 0.5:
                print(f"⚠️  Step {step}: 偏好准确率仅 {acc:.2%}，低于随机！")
            elif acc > 0.8:
                print(f"✅ Step {step}: 偏好准确率 {acc:.2%}，对齐效果好！")

        if "eval/rewards_margins" in metrics:
            margin = metrics["eval/rewards_margins"]
            if margin < 0:
                print(f"❌ Step {step}: margin < 0，训练方向可能错误！")

# 在 Trainer 中使用
trainer = DPOTrainer(
    ...,
    callbacks=[AlignmentMonitorCallback()],
)
```

### 快速评估脚本

```python
"""quick_eval.py - 快速对比 SFT 和 DPO 模型的输出"""
from transformers import pipeline

prompts = [
    "请用简洁的语言解释什么是量子计算",
    "写一个 Python 函数，计算斐波那契数列",
    "我感觉很沮丧，有什么建议吗？",
]

def compare_models(sft_path, dpo_path, prompts):
    sft_pipe = pipeline("text-generation", model=sft_path, device_map="auto",
                        torch_dtype=torch.bfloat16)
    dpo_pipe = pipeline("text-generation", model=dpo_path, device_map="auto",
                        torch_dtype=torch.bfloat16)

    for prompt in prompts:
        print(f"\n{'='*60}")
        print(f"Prompt: {prompt}")
        print(f"\n[SFT 模型回答]:")
        print(sft_pipe(prompt, max_new_tokens=200, do_sample=True)[0]["generated_text"])
        print(f"\n[DPO 模型回答]:")
        print(dpo_pipe(prompt, max_new_tokens=200, do_sample=True)[0]["generated_text"])
```

---

## 参考资料

- [TRL 官方 DPO 示例](https://github.com/huggingface/trl/tree/main/examples/scripts)
- [Zephyr DPO 训练报告](https://huggingface.co/HuggingFaceH4/zephyr-7b-beta)
- [DeepSeek-R1 技术报告](https://arxiv.org/abs/2501.12948)
- [Weights & Biases LLM 监控](https://wandb.ai/site/articles/fine-tune-llm)
- [UltraFeedback 数据集](https://huggingface.co/datasets/openbmb/UltraFeedback)
