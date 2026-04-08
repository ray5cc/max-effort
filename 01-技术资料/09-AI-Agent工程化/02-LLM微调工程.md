# LLM 微调工程

> 从 LoRA 到 DPO，系统解析 LLM 微调的全链路工程实践——数据准备、训练框架、分布式训练、评估上线与生产级 Pipeline

## 相关链接

- 对应面试题：[LLM微调工程面试题](../../02-面试指南/09-AI-Agent工程化面试/02-LLM微调工程面试题.md)

## TL;DR 速览

- **微调的本质**是在预训练模型基础上用领域数据继续训练，让通用模型变成领域专家
- **LoRA** 是当前最主流的高效微调方法：冻结原始权重，只训练低秩增量矩阵 ΔW = B×A，参数量仅为全量微调的 0.1-1%
- **QLoRA** = 4-bit 量化 + LoRA，可在单张 24GB 消费级显卡上微调 70B 模型
- **数据质量 >> 数据数量**：1000 条高质量指令数据的效果往往优于 10 万条低质量数据
- 训练框架选型：**TRL**（HuggingFace 官方）、**Axolotl**（一站式）、**LLaMA-Factory**（中文生态最全）
- 对齐训练趋势：**DPO** 正在取代 RLHF 成为主流，因为不需要训练 Reward Model
- 生产微调 Pipeline：数据标注 → 清洗去重 → 格式转换 → 训练 → 评估 → 合并量化 → 部署
- 关键成本参考：7B 模型 LoRA 微调约 $5-20（云 GPU），70B 全参数微调约 $500-2000

## 目录

1. [为什么需要微调？](#_1-为什么需要微调)
2. [微调方法全景](#_2-微调方法全景)
3. [训练数据工程](#_3-训练数据工程)
4. [训练框架与工程实践](#_4-训练框架与工程实践)
5. [分布式训练深入](#_5-分布式训练深入)
6. [评估与上线](#_6-评估与上线)
7. [生产环境完整流水线](#_7-生产环境完整流水线)
8. [常见陷阱与最佳实践](#_8-常见陷阱与最佳实践)
9. [面试通关指南](#_9-面试通关指南)
10. [延伸与前沿](#_10-延伸与前沿)

---

## 1. 为什么需要微调？

### 1.1 预训练、微调与 Prompt Engineering 的本质区别

**类比**：把 LLM 想象成一个刚毕业的通才型大学生。

- **预训练**（Pre-training）= 大学本科四年，学习了海量通用知识，但不精通任何特定领域
- **微调**（Fine-tuning）= 入职后的岗位培训，用公司的真实业务数据让他变成领域专家
- **Prompt Engineering** = 给新员工写一份详细的工作手册，不改变他的知识，只是引导他用正确的方式工作
- **RAG** = 让员工在工作时查阅资料库，弥补知识缺口

```
模型能力增强手段对比:

投入成本:     低 ─────────────────────────────────── 高
             │                                       │
             Prompt      Few-shot     RAG      LoRA微调    全参数微调    继续预训练
             Engineering                                              (CPT)
             │                                       │
效果深度:     浅 ─────────────────────────────────── 深
```

### 1.2 什么场景需要微调？

**需要微调的场景**：

| 场景 | 为什么 Prompt/RAG 不够 | 微调能解决什么 |
|------|----------------------|---------------|
| 输出格式严格控制 | Prompt 控制格式不稳定，复杂 JSON 容易出错 | 训练模型"天生"就输出正确格式 |
| 领域专业术语 | 模型不认识行业黑话、缩写 | 让模型理解并正确使用领域术语 |
| 风格一致性 | Few-shot 示例数量有限，风格漂移 | 让模型内化特定的写作/回答风格 |
| 推理成本优化 | 长 Prompt（含 few-shot）导致高 Token 成本 | 短 Prompt 就能得到好结果，省 70%+ Token |
| 小模型替代大模型 | 7B 模型直接用效果差 | 微调后 7B ≈ 未微调的 70B（特定任务） |
| 工具调用准确性 | 通用模型工具调用格式经常错 | 训练模型精准输出 Function Call |

**不需要微调的场景**：

| 场景 | 推荐方案 | 原因 |
|------|---------|------|
| 需要最新知识 | RAG | 微调数据有截止日期，RAG 实时检索 |
| 简单格式调整 | Prompt Engineering | 成本低、迭代快 |
| 需要引用来源 | RAG + Prompt | 微调不能保证事实准确性 |
| 任务种类多变 | 通用大模型 + Prompt | 微调会让模型变窄 |

### 1.3 微调的 ROI 计算

```python
# 微调 ROI 估算框架
def calculate_finetune_roi():
    # === 成本端 ===
    gpu_hours = 50          # 7B LoRA 微调，约 50 GPU 小时
    gpu_cost_per_hour = 2   # A100 云实例 $2/hour
    data_labeling_cost = 500  # 1000 条数据人工标注
    engineer_hours = 40      # 工程师时间（数据准备+训练+评估）
    engineer_rate = 50       # $50/hour
    
    total_cost = (gpu_hours * gpu_cost_per_hour + 
                  data_labeling_cost + 
                  engineer_hours * engineer_rate)
    # = $100 + $500 + $2000 = $2,600
    
    # === 收益端 ===
    daily_requests = 10000
    tokens_saved_per_request = 500  # 短 Prompt 省 500 tokens
    token_price = 0.01 / 1000       # $0.01/1K tokens
    daily_saving = daily_requests * tokens_saved_per_request * token_price
    # = $50/day
    
    # ROI
    payback_days = total_cost / daily_saving  # 52 天回本
    annual_roi = (daily_saving * 365 - total_cost) / total_cost
    # = ($18,250 - $2,600) / $2,600 = 602%
    
    return payback_days, annual_roi
```

### 1.4 业界真实案例

- **字节跳动**：对 Llama 进行中文领域微调，用于内部代码审查 Agent，工具调用准确率从 67% 提升到 94%
- **Bloomberg**：在金融领域数据上微调 BloombergGPT，NER 准确率提升 20%
- **Hugging Face**：用 DPO 微调 Zephyr-7B，在 MT-Bench 上超过 Llama-2-Chat-70B
- **阿里巴巴**：Qwen 系列通过领域微调支撑内部 100+ 业务场景

---

## 2. 微调方法全景

### 2.1 全参数微调（Full Fine-tuning）

**原理**：更新模型的所有参数，和预训练一样的优化过程，只是用领域数据和更小的学习率。

```
全参数微调:
┌──────────────────────┐
│   原始预训练权重 W₀     │
│   (所有参数可训练)      │    梯度更新
│                      │ ◄──────────── Loss
│   W₁ = W₀ - η∇L     │
│   (全部更新)          │
└──────────────────────┘
参数量: 7B → 训练 7B 参数
显存:   7B 模型需要 ~112GB (bf16 权重 + 优化器状态 + 梯度)
```

**适用场景**：
- 数据量充足（10 万条以上）
- 需要深层能力改变（如学习新语言）
- 有充足的 GPU 资源

**灾难性遗忘（Catastrophic Forgetting）**：
全参数微调的最大风险——模型在领域数据上表现好了，但通用能力急剧下降。

```python
# ❌ 灾难性遗忘的典型表现
# 微调前: "What is 2+2?" → "4"
# 用法律数据微调后: "What is 2+2?" → "According to Section 2.2 of the..."

# ✅ 解决方案: 数据混合
training_data = (
    domain_data * 0.7 +        # 70% 领域数据
    general_data * 0.2 +       # 20% 通用对话数据（维持通用能力）
    safety_data * 0.1          # 10% 安全数据（维持安全对齐）
)
```

### 2.2 LoRA（Low-Rank Adaptation）— 当前最主流方法

**核心思想**：大模型的权重更新矩阵 ΔW 是低秩的——你不需要更新所有参数，只需要学习一个低维的"修正向量"。

**类比**：全参数微调就像给一栋大楼重新装修每个房间；LoRA 就像只在关键位置贴上装饰贴纸——效果相似，但成本低 99%。

**数学原理**：

```
原始前向传播:  h = W₀x
LoRA 前向传播: h = W₀x + (B × A)x

其中:
- W₀ ∈ R^(d×k) 是原始权重（冻结不训练）
- A ∈ R^(r×k) 是降维矩阵（r << d）
- B ∈ R^(d×r) 是升维矩阵
- r 是秩（rank），通常 8-64

参数量对比:
- 全参数: d × k（如 4096 × 4096 = 16M）
- LoRA:   d × r + r × k（如 4096 × 16 + 16 × 4096 = 131K）
- 压缩比: 约 122 倍

实际缩放:  h = W₀x + (α/r) × (B × A)x
- α (alpha) 控制 LoRA 更新的缩放，通常设为 2r（如 r=16 则 α=32）
```

```
LoRA 架构示意图:

输入 x ──────────────────────────────→ (+) ──→ 输出 h
    │                                    ↑
    │         ┌─────────────┐           │
    │         │  W₀ (冻结)   │    原始路径│
    │         │  d × k      │───────────┘
    │         └─────────────┘
    │                                   LoRA 旁路
    │         ┌─────────────┐    ┌─────────────┐
    └────────→│  A (降维)    │───→│  B (升维)    │──→ × (α/r)
              │  r × k      │    │  d × r      │
              │  (可训练)    │    │  (可训练)    │
              └─────────────┘    └─────────────┘
```

**关键超参数选择经验**：

| 参数 | 推荐值 | 说明 |
|------|--------|------|
| rank (r) | 8-64 | 简单任务 8-16，复杂任务 32-64 |
| alpha (α) | 2×rank | α=32 when r=16 是最常用设置 |
| target_modules | q_proj, v_proj, k_proj, o_proj, gate_proj, up_proj, down_proj | 覆盖 Attention + FFN 效果最好 |
| dropout | 0.05-0.1 | 防止过拟合 |
| bias | "none" | 通常不训练 bias |

```python
# LoRA 配置示例（使用 peft 库）
from peft import LoraConfig, get_peft_model

lora_config = LoraConfig(
    r=16,                    # 秩
    lora_alpha=32,           # 缩放系数
    target_modules=[         # 应用 LoRA 的层
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj"
    ],
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM"
)

model = get_peft_model(base_model, lora_config)
model.print_trainable_parameters()
# trainable params: 13,631,488 || all params: 6,751,150,080
# trainable%: 0.2019%
```

### 2.3 QLoRA — 消费级显卡微调大模型

**核心创新**：4-bit 量化 + LoRA + 分页优化器，让 70B 模型在单张 48GB A6000 上微调。

```
QLoRA 技术栈:

原始模型 (bf16)     量化模型 (NF4)      QLoRA 训练
┌──────────┐      ┌──────────┐      ┌──────────────────┐
│ 70B 参数  │ ──→  │ 70B 参数  │      │ 冻结的 NF4 权重   │
│ 140GB    │ 量化  │ ~35GB    │      │ + LoRA bf16 参数  │
│          │      │ 4-bit    │      │ ~38GB 总显存      │
└──────────┘      └──────────┘      └──────────────────┘
```

**关键技术点**：

1. **NF4（NormalFloat 4-bit）数据类型**：
   - 专门为正态分布的神经网络权重设计的 4-bit 量化格式
   - 比标准 INT4 信息损失更小（权重通常近似正态分布）

2. **双重量化（Double Quantization）**：
   - 量化常数本身也被量化（FP32 → FP8）
   - 进一步节省约 3GB 显存（对 65B 模型）

3. **分页优化器（Paged Optimizers）**：
   - 利用 NVIDIA 统一内存，优化器状态可以在 GPU ↔ CPU 间自动换页
   - 避免 OOM（Out of Memory）错误

```python
# QLoRA 配置示例
from transformers import BitsAndBytesConfig

bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",           # NF4 量化
    bnb_4bit_use_double_quant=True,       # 双重量化
    bnb_4bit_compute_dtype=torch.bfloat16 # 计算用 bf16
)

model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-3.1-70B-Instruct",
    quantization_config=bnb_config,
    device_map="auto"                     # 自动多卡分配
)

# 然后像普通 LoRA 一样配置训练
model = get_peft_model(model, lora_config)
```

**显存需求对比**：

| 模型 | 全参数微调 | LoRA (bf16) | QLoRA (NF4) |
|------|----------|-------------|-------------|
| 7B | 112 GB | 16 GB | 6 GB |
| 13B | 208 GB | 28 GB | 10 GB |
| 70B | 1120 GB | 160 GB | 38 GB |
| 405B | 不现实 | 不现实 | ~200 GB (多卡) |

### 2.4 LoRA 变体

**DoRA（Weight-Decomposed Low-Rank Adaptation）**：
- 将权重分解为**方向**（direction）和**幅度**（magnitude）两部分
- LoRA 只调方向，DoRA 同时调方向和幅度
- 效果接近全参数微调，额外开销极小

**rsLoRA（Rank-Stabilized LoRA）**：
- 修改缩放因子为 α/√r（而不是 α/r）
- 高 rank 时训练更稳定

**LoRA+**：
- A 矩阵和 B 矩阵使用不同的学习率（B 的学习率 = λ × A 的学习率，λ ≈ 16）
- 训练速度提升 2 倍，效果不降

### 2.5 对齐训练方法

```
对齐训练方法演进:

RLHF (2022)                  DPO (2023)              ORPO (2024)
┌───────────────┐       ┌──────────────┐       ┌──────────────┐
│ 1. 训练SFT模型  │       │ 1. 训练SFT模型 │       │ 直接一步训练    │
│ 2. 训练RM模型   │       │ 2. DPO直接优化 │       │ SFT + 对齐    │
│ 3. PPO强化学习  │       │    (无需RM)    │       │ (无需RM和ref) │
│ 4. 多轮迭代    │       │              │       │              │
└───────────────┘       └──────────────┘       └──────────────┘
   复杂度: ★★★★★          复杂度: ★★★             复杂度: ★★
```

**SFT（Supervised Fine-Tuning）**：
- 用 (指令, 回答) 对进行监督学习
- 让模型学会遵循指令的格式

**RLHF（Reinforcement Learning from Human Feedback）**：
```
SFT模型 → 生成多个回答 → 人类排序 → 训练 Reward Model → PPO 优化策略模型
                ↑                                              │
                └──────────── 迭代 ─────────────────────────────┘
```
- 需要训练额外的 Reward Model
- PPO 训练不稳定，超参数敏感
- OpenAI 最初用此方法训练 ChatGPT

**DPO（Direct Preference Optimization）**：
```python
# DPO 的核心思想：直接从偏好数据学习，不需要 Reward Model
# 数据格式: (prompt, chosen_response, rejected_response)

# DPO Loss 公式:
# L_DPO = -E[log σ(β(log π(y_w|x)/π_ref(y_w|x) - log π(y_l|x)/π_ref(y_l|x)))]

# 用 TRL 库实现 DPO:
from trl import DPOTrainer, DPOConfig

training_args = DPOConfig(
    output_dir="./dpo_output",
    beta=0.1,                    # 温度参数，控制偏离参考模型的程度
    learning_rate=5e-7,
    per_device_train_batch_size=4,
    num_train_epochs=1,
    bf16=True,
)

dpo_trainer = DPOTrainer(
    model=model,
    ref_model=ref_model,         # 参考模型（SFT 后的模型副本）
    args=training_args,
    train_dataset=preference_data,
    tokenizer=tokenizer,
)
dpo_trainer.train()
```

**ORPO（Odds Ratio Preference Optimization）**：
- 将 SFT 和对齐训练合并为一步
- 不需要参考模型，训练更简单
- 适合资源有限的场景

---

## 3. 训练数据工程

### 3.1 数据格式

**Alpaca 格式**（最简单，单轮指令）：
```json
{
  "instruction": "将以下英文翻译为中文",
  "input": "The quick brown fox jumps over the lazy dog",
  "output": "敏捷的棕色狐狸跳过了懒狗"
}
```

**ShareGPT/OpenAI 格式**（多轮对话）：
```json
{
  "conversations": [
    {"role": "system", "content": "你是一个专业的代码审查助手"},
    {"role": "user", "content": "请审查这段 Python 代码:\ndef add(a,b): return a+b"},
    {"role": "assistant", "content": "这段代码有以下改进建议:\n1. 缺少类型注解..."},
    {"role": "user", "content": "请加上类型注解"},
    {"role": "assistant", "content": "```python\ndef add(a: int, b: int) -> int:\n    return a + b\n```"}
  ]
}
```

**工具调用格式**（Function Calling 训练数据）：
```json
{
  "messages": [
    {"role": "user", "content": "北京今天天气怎么样？"},
    {"role": "assistant", "content": null, "tool_calls": [{
      "id": "call_123",
      "type": "function",
      "function": {
        "name": "get_weather",
        "arguments": "{\"city\": \"北京\"}"
      }
    }]},
    {"role": "tool", "tool_call_id": "call_123", "content": "{\"temp\": 25, \"condition\": \"晴\"}"},
    {"role": "assistant", "content": "北京今天天气晴朗，气温25°C，适合户外活动。"}
  ]
}
```

### 3.2 数据质量工程

**数据质量是微调成功的第一要素**。Google 的研究表明，1000 条精心标注的数据可以超过 100K 条噪声数据的效果。

**数据清洗流水线**：

```
原始数据 ──→ 去重 ──→ 质量过滤 ──→ 格式校验 ──→ 安全过滤 ──→ 最终数据
              │         │            │            │
              │    LLM评分 ≥ 4/5    JSON Schema   敏感词/PII
              │         │         验证           检测
          MinHash/     长度过滤
          SimHash      (太短/太长)
```

```python
# 数据去重示例（MinHash）
from datasketch import MinHash, MinHashLSH

def create_minhash(text, num_perm=128):
    m = MinHash(num_perm=num_perm)
    for word in text.split():
        m.update(word.encode('utf-8'))
    return m

# LSH 近似去重（比精确去重快 100 倍）
lsh = MinHashLSH(threshold=0.8, num_perm=128)
unique_data = []
for i, item in enumerate(raw_data):
    mh = create_minhash(item["output"])
    if not lsh.query(mh):  # 没有近似重复
        lsh.insert(f"doc_{i}", mh)
        unique_data.append(item)

# 质量评分（使用强模型评估弱模型的训练数据）
async def score_data_quality(item):
    prompt = f"""请评估以下指令-回答对的质量（1-5分）:
    指令: {item['instruction']}
    回答: {item['output']}
    
    评分标准:
    5=完美: 准确、完整、格式好
    4=好: 基本正确，有小瑕疵
    3=及格: 方向对但不够深入
    2=差: 有明显错误
    1=很差: 完全不相关
    
    只返回数字分数:"""
    score = await strong_model.generate(prompt)
    return int(score.strip())
```

### 3.3 数据规模经验法则

| 任务类型 | 推荐数据量 | 说明 |
|---------|-----------|------|
| 格式控制 | 100-500 条 | 如固定 JSON 输出格式 |
| 风格迁移 | 500-2,000 条 | 如客服语气、技术文档风格 |
| 领域知识 | 2,000-10,000 条 | 如金融/医疗领域 QA |
| 工具调用 | 5,000-20,000 条 | 多工具多场景覆盖 |
| 通用助手 | 50,000-100,000+ 条 | 如 Alpaca、WizardLM |

### 3.4 合成数据生成

**Evol-Instruct**（WizardLM 提出的数据增强方法）：

```python
# 用强模型将简单指令进化为复杂指令
evolution_prompt = """
请将以下简单指令改写为更复杂、更有深度的版本。
添加约束条件、多步推理、或边界情况。

原始指令: {simple_instruction}

进化后的指令（只返回改写后的指令）:
"""

# 示例:
# 简单: "写一个排序算法"
# 进化: "实现一个稳定的排序算法，要求时间复杂度 O(n log n)，
#        空间复杂度 O(1)，并处理包含 null 值的数组。
#        给出与 Python 内置 sorted() 的性能对比。"
```

**Self-Instruct**（用模型自身生成训练数据）：

```
种子数据 (175条) → LLM 生成新指令 → LLM 生成回答 → 过滤 → 训练数据
                     ↑                                    │
                     └──────── 迭代扩充 ──────────────────┘
```

---

## 4. 训练框架与工程实践

### 4.1 框架选型对比

| 框架 | 适用场景 | 优势 | 劣势 |
|------|---------|------|------|
| **TRL** (HuggingFace) | SFT/DPO/RLHF 全流程 | 官方支持、文档好、与 transformers 深度集成 | 配置复杂 |
| **Axolotl** | 一站式微调 | YAML 配置即用、内置多种优化 | 灵活性稍差 |
| **LLaMA-Factory** | 中文生态 | Web UI、支持 100+ 模型、中文文档全 | 封装较重 |
| **Unsloth** | 快速训练 | 2-5 倍训练加速、显存减半 | 模型覆盖有限 |
| **torchtune** | PyTorch 原生 | Meta 官方、代码简洁 | 功能较少 |

### 4.2 TRL 完整训练示例

```python
from transformers import AutoModelForCausalLM, AutoTokenizer
from trl import SFTTrainer, SFTConfig
from peft import LoraConfig
from datasets import load_dataset

# 1. 加载模型和分词器
model_name = "meta-llama/Llama-3.1-8B-Instruct"
tokenizer = AutoTokenizer.from_pretrained(model_name)
tokenizer.pad_token = tokenizer.eos_token

model = AutoModelForCausalLM.from_pretrained(
    model_name,
    torch_dtype=torch.bfloat16,
    device_map="auto",
    attn_implementation="flash_attention_2"  # Flash Attention 加速
)

# 2. 配置 LoRA
peft_config = LoraConfig(
    r=16,
    lora_alpha=32,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                     "gate_proj", "up_proj", "down_proj"],
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM"
)

# 3. 训练配置
training_args = SFTConfig(
    output_dir="./output",
    num_train_epochs=3,
    per_device_train_batch_size=4,
    gradient_accumulation_steps=4,    # 有效 batch = 4 × 4 = 16
    learning_rate=2e-4,               # LoRA 学习率通常比全参数高
    lr_scheduler_type="cosine",
    warmup_ratio=0.1,
    bf16=True,
    logging_steps=10,
    save_strategy="steps",
    save_steps=200,
    eval_strategy="steps",
    eval_steps=200,
    max_seq_length=2048,
    gradient_checkpointing=True,      # 用计算换显存
    gradient_checkpointing_kwargs={"use_reentrant": False},
    dataset_text_field="text",
    packing=True,                     # 短样本拼接，提高 GPU 利用率
)

# 4. 数据加载
dataset = load_dataset("json", data_files="training_data.jsonl")

# 5. 格式化函数
def format_chat(example):
    messages = example["conversations"]
    return {"text": tokenizer.apply_chat_template(messages, tokenize=False)}

formatted_dataset = dataset.map(format_chat)

# 6. 开始训练
trainer = SFTTrainer(
    model=model,
    args=training_args,
    train_dataset=formatted_dataset["train"],
    eval_dataset=formatted_dataset["test"],
    peft_config=peft_config,
)
trainer.train()

# 7. 保存 adapter
trainer.save_model("./lora_adapter")
```

### 4.3 Axolotl 配置示例

```yaml
# axolotl_config.yaml — 极简配置
base_model: meta-llama/Llama-3.1-8B-Instruct
model_type: LlamaForCausalLM

load_in_4bit: true          # QLoRA
adapter: qlora
lora_r: 16
lora_alpha: 32
lora_target_modules:
  - q_proj
  - k_proj
  - v_proj
  - o_proj

datasets:
  - path: my_data.jsonl
    type: sharegpt

sequence_len: 4096
micro_batch_size: 2
gradient_accumulation_steps: 8
num_epochs: 3
learning_rate: 2e-4
lr_scheduler: cosine
warmup_steps: 100

optimizer: adamw_bnb_8bit   # 8-bit 优化器省显存
bf16: true
flash_attention: true
gradient_checkpointing: true

# 评估
eval_steps: 100
save_steps: 200

# 启动: axolotl train axolotl_config.yaml
```

### 4.4 超参数调优经验

| 超参数 | 推荐范围 | 经验说明 |
|--------|---------|---------|
| Learning Rate | 1e-4 ~ 5e-4 (LoRA) / 1e-5 ~ 5e-5 (全参数) | LoRA 学习率比全参数高 10 倍 |
| Batch Size | 越大越好（显存允许范围内） | 用梯度累积模拟大 batch |
| Epochs | 1-5 | 数据少可以多跑几 epoch，数据多 1-2 epoch 够了 |
| Warmup | 5-10% steps | 防止初始学习率过大 |
| Weight Decay | 0.01-0.1 | 防止过拟合 |
| LoRA rank | 8 (简单) / 16 (中等) / 64 (复杂) | 更大的 rank 不一定更好 |
| LoRA alpha | 2 × rank | 经验公式，几乎不用调 |
| Max Seq Length | 任务相关 | 不要设太长，浪费显存和计算 |

---

## 5. 分布式训练深入

### 5.1 DeepSpeed ZeRO

```
DeepSpeed ZeRO 三个阶段:

Stage 1: 优化器状态分片
┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐
│ GPU0 │  │ GPU1 │  │ GPU2 │  │ GPU3 │
│      │  │      │  │      │  │      │
│ 全量  │  │ 全量  │  │ 全量  │  │ 全量  │  ← 模型参数（每卡全量）
│ 模型  │  │ 模型  │  │ 模型  │  │ 模型  │
│      │  │      │  │      │  │      │
│ 1/4  │  │ 1/4  │  │ 1/4  │  │ 1/4  │  ← 优化器状态（分片）
│ 优化器│  │ 优化器│  │ 优化器│  │ 优化器│
└──────┘  └──────┘  └──────┘  └──────┘
显存节省: ~4x（优化器通常占 70% 显存）

Stage 2: + 梯度分片
每张卡只存 1/N 的梯度，AllReduce 替换为 Reduce-Scatter
显存节省: ~8x

Stage 3: + 模型参数分片
每张卡只存 1/N 的模型参数
前向/反向时按需 AllGather 参数
显存节省: 与卡数成线性关系（N张卡 = N倍节省）
代价: 通信量增大
```

```json
// DeepSpeed ZeRO Stage 2 配置（最常用）
{
  "bf16": {"enabled": true},
  "zero_optimization": {
    "stage": 2,
    "offload_optimizer": {"device": "none"},
    "allgather_partitions": true,
    "allgather_bucket_size": 5e8,
    "reduce_scatter": true,
    "reduce_bucket_size": 5e8,
    "overlap_comm": true,
    "contiguous_gradients": true
  },
  "gradient_accumulation_steps": 4,
  "gradient_clipping": 1.0,
  "train_micro_batch_size_per_gpu": 2,
  "wall_clock_breakdown": false
}
```

### 5.2 FSDP（Fully Sharded Data Parallelism）

PyTorch 原生的分布式训练方案，与 DeepSpeed ZeRO Stage 3 类似：

```python
# HuggingFace Trainer 使用 FSDP
from transformers import TrainingArguments

training_args = TrainingArguments(
    output_dir="./output",
    fsdp="full_shard auto_wrap",
    fsdp_config={
        "fsdp_offload_params": False,
        "fsdp_state_dict_type": "SHARDED_STATE_DICT",
        "fsdp_transformer_layer_cls_to_wrap": "LlamaDecoderLayer",
    },
    # ... 其他训练参数
)
```

### 5.3 实际启动命令

```bash
# 单机多卡 LoRA 微调（最常见场景）
accelerate launch \
  --num_processes 4 \
  --mixed_precision bf16 \
  train.py \
  --config config.yaml

# 多机多卡 DeepSpeed 训练
deepspeed --num_gpus 8 \
  --num_nodes 2 \
  --master_addr node0 \
  --master_port 29500 \
  train.py \
  --deepspeed ds_config.json
```

---

## 6. 评估与上线

### 6.1 评估方法体系

```
评估金字塔:

             ┌──────────┐
             │  在线A/B  │  ← 最终验证
             │  测试     │
             ├──────────┤
             │  人工评估  │  ← 质量把关
             │  /LLM评估 │
             ├──────────┤
             │ Benchmark │  ← 能力基线
             │ 评测      │
             ├──────────┤
             │ Loss曲线  │  ← 训练监控
             │ 分析      │
             └──────────┘
```

**Loss 曲线分析**：

```python
# 健康的训练曲线特征:
# 1. Train Loss 持续下降
# 2. Eval Loss 先降后趋于平稳
# 3. Train Loss 和 Eval Loss 差距不太大

# ❌ 过拟合信号:
# - Eval Loss 开始上升而 Train Loss 继续下降
# - Train Loss 远低于 Eval Loss

# ❌ 欠拟合信号:
# - Train Loss 和 Eval Loss 都很高且不再下降
# - 需要增大学习率、增加数据、增大模型
```

**Benchmark 评测**：

| Benchmark | 评测能力 | 适用场景 |
|-----------|---------|---------|
| MMLU | 多领域知识 | 通用能力评估 |
| HumanEval / MBPP | 代码生成 | 代码模型 |
| C-Eval / CMMLU | 中文能力 | 中文模型 |
| MT-Bench | 多轮对话质量 | 对话模型 |
| AlpacaEval | 指令跟随 | SFT 模型 |
| IFEval | 指令遵循率 | 格式控制能力 |

**LLM-as-Judge 评估**：

```python
# 用 GPT-4 作为评判者
judge_prompt = """
请评估以下 AI 助手的回答质量（1-10分）。

用户问题: {question}
AI 回答: {answer}
参考答案: {reference}

评分标准:
- 准确性 (1-10)
- 完整性 (1-10)  
- 表达清晰度 (1-10)

请给出每项评分和总分，以及简要理由。
JSON格式输出:
"""

# 注意: LLM-as-Judge 有位置偏差（倾向选第一个）和冗长偏差（倾向选更长的回答）
# 最佳实践: 交换位置评估两次，取平均
```

### 6.2 模型合并与部署

```python
# LoRA adapter 合并到基座模型
from peft import PeftModel

base_model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-3.1-8B-Instruct",
    torch_dtype=torch.bfloat16
)
lora_model = PeftModel.from_pretrained(base_model, "./lora_adapter")

# 合并权重
merged_model = lora_model.merge_and_unload()
merged_model.save_pretrained("./merged_model")
tokenizer.save_pretrained("./merged_model")

# 量化后部署到 vLLM
# 1. 使用 AutoAWQ 量化
# pip install autoawq
from awq import AutoAWQForCausalLM
awq_model = AutoAWQForCausalLM.from_pretrained("./merged_model")
awq_model.quantize(tokenizer, quant_config={"zero_point": True, "q_group_size": 128, "w_bit": 4})
awq_model.save_quantized("./merged_model_awq")

# 2. 部署到 vLLM
# vllm serve ./merged_model_awq --dtype auto --max-model-len 8192
```

---

## 7. 生产环境完整流水线

```
生产微调 Pipeline:

数据标注          数据工程          模型训练         评估验证         部署上线
┌──────┐      ┌──────┐      ┌──────┐      ┌──────┐      ┌──────┐
│标注平台│ ──→ │清洗去重│ ──→ │LoRA/ │ ──→ │Benchmark│──→│合并量化│
│(Label │      │格式转换│      │QLoRA │      │人工评估 │    │vLLM部署│
│Studio)│      │质量评分│      │训练   │      │A/B测试  │    │灰度发布│
└──────┘      └──────┘      └──────┘      └──────┘      └──────┘
    │              │              │              │              │
    ▼              ▼              ▼              ▼              ▼
  DVC/S3       版本管理       W&B/MLflow     评估报告       监控告警
  数据版本     数据集v1.2     实验追踪       自动化         Prometheus
```

**MLOps 实验追踪**：

```python
# 使用 Weights & Biases 追踪实验
import wandb

wandb.init(
    project="llm-finetune",
    name="llama3-8b-lora-r16-v3",
    config={
        "model": "Llama-3.1-8B-Instruct",
        "method": "LoRA",
        "rank": 16,
        "lr": 2e-4,
        "epochs": 3,
        "data_version": "v1.2",
        "data_size": 5000,
    }
)

# 在训练中自动记录指标
# TRL/SFTTrainer 自动集成 wandb
training_args = SFTConfig(
    report_to="wandb",
    # ...
)
```

**成本估算**：

| 模型 | 方法 | GPU | 时间 | 成本 (云) |
|------|------|-----|------|----------|
| 7B | LoRA | 1× A100 40GB | 2-4h | $5-12 |
| 7B | QLoRA | 1× RTX 4090 | 3-6h | 本地电费 |
| 13B | LoRA | 1× A100 80GB | 4-8h | $12-24 |
| 70B | QLoRA | 1× A100 80GB | 8-24h | $24-72 |
| 70B | 全参数 | 8× A100 80GB | 24-72h | $500-2000 |

---

## 8. 常见陷阱与最佳实践

### ❌ 陷阱 1：不做数据质量检查就训练

```python
# ❌ 直接用爬取的数据训练
dataset = load_dataset("json", data_files="raw_data.jsonl")
trainer = SFTTrainer(model=model, train_dataset=dataset)
trainer.train()  # 数据质量差 → 模型变差

# ✅ 先做数据质量审计
stats = analyze_data(dataset)
print(f"总量: {stats['total']}")
print(f"重复率: {stats['dup_rate']:.1%}")
print(f"平均长度: {stats['avg_len']}")
print(f"空回答: {stats['empty_count']}")
print(f"质量分布: {stats['quality_dist']}")
# 清洗后: 去重 → 质量过滤(score≥4) → 长度过滤 → 格式校验
```

### ❌ 陷阱 2：学习率设置不当

```python
# ❌ LoRA 用了全参数微调的学习率
training_args = SFTConfig(learning_rate=5e-6)  # 太小，训练不动

# ❌ 全参数微调用了 LoRA 的学习率
training_args = SFTConfig(learning_rate=2e-4)  # 太大，灾难性遗忘

# ✅ 正确的学习率范围
# LoRA:    1e-4 ~ 5e-4
# 全参数:  1e-5 ~ 5e-5
# DPO:     1e-7 ~ 5e-6（需要非常小的学习率）
```

### ❌ 陷阱 3：忽略 Chat Template

```python
# ❌ 不使用正确的 Chat Template，模型学到错误的格式
text = f"User: {question}\nAssistant: {answer}"

# ✅ 使用模型自带的 Chat Template
text = tokenizer.apply_chat_template(
    [{"role": "user", "content": question},
     {"role": "assistant", "content": answer}],
    tokenize=False
)
# Llama-3 格式:
# <|begin_of_text|><|start_header_id|>user<|end_header_id|>
# {question}<|eot_id|><|start_header_id|>assistant<|end_header_id|>
# {answer}<|eot_id|>
```

### ❌ 陷阱 4：不做评估就上线

```python
# ❌ 训练完直接部署
model.save_pretrained("production_model")
# deploy_to_vllm("production_model")  # 可能比原模型更差

# ✅ 完整评估流程
# 1. 在多个 benchmark 上测试（确保通用能力没有退化）
# 2. 在领域测试集上评估（确保领域能力有提升）
# 3. 人工抽样评估 50-100 条
# 4. A/B 测试对比原模型
# 5. 灰度发布（5% → 20% → 50% → 100%）
```

### ❌ 陷阱 5：过拟合而不自知

```python
# ❌ 训练太多 epoch，不监控 eval loss
training_args = SFTConfig(num_train_epochs=10)  # 10 epoch 几乎必然过拟合

# ✅ 设置合理 epoch + early stopping
training_args = SFTConfig(
    num_train_epochs=3,
    eval_strategy="steps",
    eval_steps=100,
    load_best_model_at_end=True,
    metric_for_best_model="eval_loss",
    greater_is_better=False,
    save_total_limit=3,          # 只保留最好的 3 个 checkpoint
)
```

### ❌ 陷阱 6：LoRA target_modules 选择不当

```python
# ❌ 只对 q_proj 和 v_proj 加 LoRA（早期默认设置，效果不是最优）
lora_config = LoraConfig(target_modules=["q_proj", "v_proj"])

# ✅ 覆盖 Attention 和 FFN 的所有线性层
lora_config = LoraConfig(
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                     "gate_proj", "up_proj", "down_proj"]
)
# 参数量增加约 2-3 倍，但效果显著提升
```

### ❌ 陷阱 7：忽略数据混合防止灾难性遗忘

```python
# ❌ 只用领域数据训练
train_data = load_domain_data()  # 全部是领域数据

# ✅ 混合通用数据维持基础能力
train_data = concatenate_datasets([
    load_domain_data(),                          # 70% 领域数据
    load_general_chat_data().select(range(n)),   # 20% 通用对话
    load_safety_data().select(range(m)),          # 10% 安全数据
])
```

### ❌ 陷阱 8：DPO 数据中 chosen 和 rejected 质量差距不明显

```python
# ❌ chosen 和 rejected 回答质量差不多
{"chosen": "这是一个好回答", "rejected": "这也是一个不错的回答"}
# 模型学不到什么是"更好"

# ✅ chosen 和 rejected 质量差异明显
{"chosen": "详细、准确、结构化的回答...", 
 "rejected": "简短、有错误、不相关的回答..."}
```

---

## 9. 面试通关指南

### 2 分钟结构化话术

> **问：请介绍一下你做过的 LLM 微调项目。**
> 
> 我们团队为内部代码审查 Agent 微调了 Llama-3.1-8B 模型。选择微调的原因是：通用模型对我们内部代码规范和工具调用格式的遵循率只有 67%，远不能满足生产需求。
> 
> **数据方面**：我们从 Code Review 历史记录中提取了约 8000 条高质量的 (代码, 审查意见) 对，用 GPT-4 对数据做质量评分，过滤掉 3 分以下的，最终保留 5200 条。还用 Evol-Instruct 方法增强了 2000 条复杂场景数据。
> 
> **训练方面**：使用 QLoRA（4-bit 量化 + rank=32 的 LoRA），在 2 张 A100 上训练了约 6 小时。学习率 2e-4，cosine scheduler，3 个 epoch。
> 
> **效果**：工具调用准确率从 67% 提升到 94%，代码审查建议的人工采纳率从 45% 提升到 78%。推理成本比调用 GPT-4 降低了 85%。
> 
> **部署**：模型合并后用 AWQ 量化，部署在 vLLM 上。灰度发布两周后全量上线。

### 高频追问方向

1. **LoRA 的数学原理能详细讲讲吗？为什么低秩近似有效？**
2. **QLoRA 的 NF4 数据类型是怎么回事？为什么比 INT4 好？**
3. **DPO 和 RLHF 的本质区别是什么？为什么 DPO 更简单？**
4. **数据质量怎么保证？你是怎么做数据清洗的？**
5. **如何判断模型过拟合了？你用什么评估方法？**
6. **灾难性遗忘怎么解决？你在实际项目中遇到过吗？**

---

## 10. 延伸与前沿

### 10.1 持续预训练（Continual Pre-Training, CPT）

当需要让模型学习大量新领域知识（而不仅仅是新任务格式）时，需要在预训练阶段继续训练：

```
预训练数据 (通用) → 领域数据 (CPT) → 指令数据 (SFT) → 偏好数据 (DPO)
```

- 典型案例：将英文模型适配为中文模型（如 Chinese-LLaMA）
- 数据量通常需要数十亿 Token
- 比 SFT 微调成本高 100-1000 倍

### 10.2 模型合并（Model Merging）

将多个微调模型的能力合并到一个模型中，无需额外训练：

```python
# 使用 mergekit 合并模型
# pip install mergekit
# mergekit-yaml merge_config.yaml ./merged_output
```

```yaml
# merge_config.yaml
models:
  - model: base_model        # 基座模型
    parameters:
      weight: 0.5
  - model: code_finetuned     # 代码能力
    parameters:
      weight: 0.3
  - model: math_finetuned     # 数学能力
    parameters:
      weight: 0.2
merge_method: linear          # 线性合并
dtype: bfloat16
```

### 10.3 小模型蒸馏

用大模型的输出训练小模型：

```
教师模型 (70B)           学生模型 (7B)
    │                        ↑
    │   生成高质量回答         │
    └──────────────→ 训练数据 ──┘
```

- 可以将 GPT-4 级别的能力压缩到 7B 模型（特定任务）
- 关键：教师模型不仅提供答案，还提供推理过程（Chain-of-Thought）

### 10.4 多模态微调

在视觉-语言模型上微调：

- **LLaVA** 架构：视觉编码器 + 投影层 + LLM
- 微调策略：通常冻结视觉编码器，只微调投影层和 LLM
- 数据格式：(图像, 问题, 回答) 三元组
