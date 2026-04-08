# 参数高效微调（PEFT）

> **参数高效微调（Parameter-Efficient Fine-Tuning，PEFT）**是一类通用技术，让大语言模型以冻结大部分参数的方式完成领域适配，极大降低训练成本。代表方法包括 LoRA、QLoRA、Adapter Tuning 等。

## 相关链接

- 对应面试题：[07-PEFT面试题](../../02-面试指南/07-LLM基础面试/07-PEFT面试题.md)

## 目录
1. [为什么需要 PEFT](#1-为什么需要-peft)
2. [核心方法总览](#2-核心方法总览)
3. [LoRA 深度解析](#3-lora-深度解析)
4. [QLoRA：量化加速](#4-qlora量化加速)
5. [其他方法详解](#5-其他方法详解)
6. [方法选择指南](#6-方法选择指南)
7. [HuggingFace PEFT 生态](#7-huggingface-peft-生态)

---

## 1. 为什么需要 PEFT

### 全量微调的困境

以 LLaMA-2-70B 为例，全量微调所需资源：

```
模型参数量：70B × 4 bytes (fp32) = 280 GB
梯度存储：  280 GB
优化器状态：560 GB (Adam 需要一阶 + 二阶矩)
激活值缓存：~100 GB (batch_size=4, seq_len=2048)
─────────────────────────────────────────────
总计 VRAM：≈ 1,120 GB ≈ 14 × A100 80GB
```

**核心痛点**：
- 💸 **成本爆炸**：每次微调都要重新训练全部参数
- 🗄️ **存储爆炸**：每个任务都需要保存一份完整权重副本
- ⚠️ **灾难性遗忘**：全量微调容易破坏预训练知识
- 🔄 **部署困难**：无法为不同用户/任务快速切换模型

### PEFT 的核心思路

```
预训练模型权重 W₀ (冻结)
        │
        ▼
  ┌─────────────────┐
  │  轻量级适配器    │  ← 只训练这部分 (0.1% ~ 1% 参数)
  │  (Adapter/LoRA) │
  └─────────────────┘
        │
        ▼
   微调后的输出
```

**PEFT 的三大优势**：
1. **参数效率**：只训练 < 1% 的参数，节省 99% 计算资源
2. **保留基础能力**：冻结预训练权重，不破坏通用知识
3. **模块化部署**：基础模型共享 + 插拔式适配器

---

## 2. 核心方法总览

```
PEFT 方法家族
├── 适配器方法 (Adapter Methods)
│   ├── Adapter Tuning (Houlsby 2019)
│   └── IA³ (Infused Adapter by Inhibiting and Amplifying Inner Activations)
│
├── 低秩分解方法 (Low-Rank Decomposition)
│   ├── LoRA (Low-Rank Adaptation) ← 当前主流
│   ├── AdaLoRA (Adaptive LoRA)
│   └── LoftQ (LoRA-Fine-Tuning-aware Quantization)
│
├── 软提示方法 (Soft Prompt Methods)
│   ├── Prompt Tuning
│   └── Prefix Tuning
│
└── 量化结合方法
    └── QLoRA (Quantized LoRA) ← 消费级 GPU 首选
```

### 各方法参数量对比

```
方法              可训练参数比例   GPU 需求 (7B 模型)   质量
─────────────────────────────────────────────────────────
Full Fine-Tuning    100%          ≥ 4×A100 80GB      最佳
LoRA (r=64)         ~0.5%         1×A100 80GB        接近全量
QLoRA (r=64)        ~0.5%         1×RTX 3090 24GB    略低于 LoRA
Prefix Tuning       <0.1%         较低               中等
Prompt Tuning       <0.01%        最低               较差
IA³                 ~0.01%        较低               中等
AdaLoRA             ~0.5%         类似 LoRA          优于固定 rank LoRA
```

---

## 3. LoRA 深度解析

### 核心数学原理

LoRA (Hu et al., 2021) 的关键洞察：**预训练模型的权重更新具有低内在秩（intrinsic rank）**。

**原始权重更新**：
```
W = W₀ + ΔW
其中 W₀ ∈ ℝ^(d×k)，ΔW ∈ ℝ^(d×k)
```

**LoRA 分解**：
```
ΔW = B × A

其中：
  A ∈ ℝ^(r×k)   — 下投影矩阵，随机高斯初始化
  B ∈ ℝ^(d×r)   — 上投影矩阵，零初始化
  r ≪ min(d, k)  — 秩 (rank)，通常 4~64

前向传播：
  h = W₀x + ΔWx = W₀x + (B × A)x
    = W₀x + B(Ax)
```

**参数节省计算**：
```
原始 ΔW 参数量：d × k
LoRA 参数量：    r × k + d × r = r(d + k)

节省比例：1 - r(d+k)/(d×k) ≈ 1 - r/d (当 d ≈ k 时)

例：d=k=4096, r=8
  原始：4096 × 4096 = 16,777,216
  LoRA：8 × (4096+4096) = 65,536
  节省：99.6% ↓
```

### Scaling Factor Alpha

```python
# LoRA 的实际公式加入了 scaling 因子
h = W₀x + (alpha/r) × B × A × x

# alpha 的作用：调节 LoRA 更新对原始输出的影响幅度
# 常见设置：alpha = r 或 alpha = 2r
# 当 alpha = r 时，scaling = 1（无缩放）
# 当 alpha = 2r 时，scaling = 2（更强的适配）
```

### 初始化策略

```
训练开始时：
  A: 随机高斯初始化 (Kaiming uniform)  → 引入随机性
  B: 零初始化                          → 确保 ΔW = 0，训练开始无扰动

这保证了：
  - 训练初期 = 等价于原始预训练模型
  - 梯度从零开始稳定增长
  - 不会因随机初始化导致训练不稳定
```

### 应用层选择

LoRA 通常应用于 Transformer 的 **注意力层权重矩阵**：

```
Transformer 层中的矩阵
├── Q (Query)     ← LoRA 核心目标
├── K (Key)       ← LoRA 核心目标
├── V (Value)     ← LoRA 核心目标
├── O (Output)    ← 常见目标
├── Gate/Up/Down  ← MoE 或 FFN 层（可选）
└── Embedding     ← 较少使用

经验：target_modules = ["q_proj", "v_proj"] 是最小配置
      target_modules = ["q_proj", "k_proj", "v_proj", "o_proj"] 效果更好
      加入 FFN 层进一步提升，但训练成本上升
```

### Rank 选择原理

```
低 rank (r=4~8):
  适合：简单任务，数据少，快速验证
  优点：参数极少，速度快，不易过拟合
  缺点：表达能力有限

中等 rank (r=16~32):
  适合：常规 SFT 任务，代码/对话微调
  优点：平衡性能与效率
  缺点：需要更多 GPU 内存

高 rank (r=64~128):
  适合：复杂任务，数据充足
  优点：接近全量微调效果
  缺点：参数量增加，节省效果减弱
```

---

## 4. QLoRA：量化加速

### 核心创新 (Dettmers et al., 2023)

QLoRA 在 LoRA 基础上叠加了三项量化技术，实现在消费级 GPU 上微调 70B 模型：

```
QLoRA = LoRA + NF4 量化 + 双重量化 + 分页优化器

┌─────────────────────────────────────┐
│  预训练模型 (NF4 4-bit 量化存储)     │  ← 减少 ~75% 显存
│  W₀ (frozen, 4-bit)                │
├─────────────────────────────────────┤
│  LoRA 适配器 (BF16 计算)            │  ← 正常精度训练
│  A, B 矩阵                         │
└─────────────────────────────────────┘
```

### NF4 量化（NormalFloat 4-bit）

```python
# NF4 的设计思路：
# 预训练权重近似服从 N(0, σ²) 正态分布
# NF4 使用 16 个分位点，等信息量量化

NF4 量化点（16个，信息论最优）：
[-1.0, -0.6962, -0.5251, -0.3947, -0.2844, -0.1848,
 -0.0911,  0.0,   0.0796,  0.1609,  0.2461,  0.3379,
  0.4407,  0.5626,  0.7230,  1.0]

对比 FP16 (65536 个精确值) → NF4 (16 个) → 显存节省 75%
```

### 双重量化（Double Quantization）

```
问题：量化需要存储量化常数 (quantization constants)
     每 64 个参数存储 1 个 fp32 常数 → 额外 0.5 bit/param

双重量化：将量化常数本身再次量化为 fp8
  原始：64 params × (4-bit weight + 0.5-bit const) = 4.5 bit/param
  双量：64 params × (4-bit weight + 0.127-bit const) ≈ 4.13 bit/param
  节省：~0.37 bit/param (对 70B 模型 ≈ 节省 3GB)
```

### 分页优化器（Paged Optimizers）

```python
# 使用 NVIDIA 的统一内存 (Unified Memory)
# GPU 显存不足时，自动将优化器状态 page 到 CPU 内存

optimizer = bnb.optim.PagedAdamW8bit(
    model.parameters(),
    lr=2e-4
)
# 优点：避免 OOM 崩溃，牺牲少量速度换稳定性
```

### QLoRA 精度流水线

```
存储：   NF4 4-bit (W₀)
   ↓
反量化：  BF16 (计算时展开)
   ↓
计算：   BF16 前向传播 + LoRA
   ↓
梯度：   BF16 (只对 LoRA 参数)
   ↓
优化器：  BF16/FP32 (LoRA 参数 Adam 状态)
```

---

## 5. 其他方法详解

### Prefix Tuning

```python
# 在每个 Transformer 层的 KV 中插入可训练的前缀向量
# 原始：  [K, V] ← 来自输入 token
# 修改后：[P_K, K], [P_V, V]  ← P_K/P_V 是可训练前缀

# 参数量：num_layers × prefix_length × 2 × d_model
# 优点：对输入序列透明，不需要修改模型结构
# 缺点：比 LoRA 难训练（需要重参数化技巧）
```

### Prompt Tuning

```python
# 最简单的 PEFT 方法：在输入 embedding 层添加可训练 token
# Input: [soft_tokens (m个)] + [task_input_tokens]
# 只有 soft_tokens 的 embedding 参与训练

# 参数量：m × d_model （极少）
# 适用：模型越大效果越接近全量微调（10B+ 模型）
# 缺点：小模型效果差
```

### IA³ (Infused Adapter by Inhibiting and Amplifying)

```python
# 通过逐元素缩放向量修改激活值
# 修改：Key, Value, FFN激活
#
# h_attention = (lₖ ⊙ K) attention(Q, lₖ⊙K, lᵥ⊙V)
# h_ffn = (lff ⊙ γ(W₁x)) W₂
#
# 其中 lₖ, lᵥ, lff 是可训练的向量
# 参数量极少：约 0.01% 原始参数
# 推理时可合并：几乎无额外延迟
```

### AdaLoRA（自适应秩分配）

```python
# 问题：不同权重矩阵的重要性不同，统一 rank 浪费
# 解决：用 SVD 分解替代 LoRA 的 AB 分解，动态剪枝奇异值

# ΔW = U × Λ × Vᵀ (SVD 形式)
# Λ = diag(λ₁, λ₂, ..., λᵣ)  ← 奇异值可被置零（剪枝）

# 训练过程：
#   1. 正常 LoRA 训练 + 重要性评分
#   2. 对不重要的奇异值施加惩罚（归零）
#   3. 自动在重要矩阵分配更高 rank

# 效果：同等参数预算下优于固定 rank LoRA
```

### LoftQ（LoRA-Fine-Tuning-aware Quantization）

```python
# 问题：QLoRA 中量化误差 + LoRA 初始化不协调
# 解决：联合优化量化和 LoRA 初始化

# 迭代流程：
# W₀ ≈ Q(W₀) + B₀A₀
# 其中 Q(W₀) 是 W₀ 的量化版本
# B₀, A₀ 通过 SVD 分解量化残差初始化

# 优点：比 QLoRA 量化误差更小，特别对低 bit 量化
```

---

## 6. 方法选择指南

| 场景 | 推荐方法 | 理由 |
|------|----------|------|
| **消费级 GPU (< 24GB)**，7B~13B 模型 | QLoRA | 显存最优，质量可接受 |
| **单张 A100 80GB**，7B~34B 模型 | LoRA (r=16~64) | 速度快，质量高 |
| **多卡训练**，追求最佳质量 | LoRA (r=64~128) 或全量 | 资源充足 |
| **多任务切换**，同一基础模型 | LoRA (多适配器) | 轻松切换任务 |
| **极低参数预算** (< 0.1%) | Prompt Tuning / IA³ | 参数极少 |
| **自适应秩分配** | AdaLoRA | 参数分配更智能 |
| **量化 + 高质量** | LoftQ | 优于标准 QLoRA |

### 决策树

```
开始
 │
 ├─ GPU VRAM < 24GB?
 │   └─ YES → QLoRA (bnb 4-bit + r=8~16)
 │
 ├─ 需要最佳质量?
 │   └─ YES → LoRA (r=64) 或全量微调
 │
 ├─ 需要多任务切换?
 │   └─ YES → LoRA 多适配器
 │
 ├─ 部署延迟敏感?
 │   └─ YES → LoRA + merge_and_unload()
 │
 └─ 默认推荐 → LoRA (r=16, alpha=32)
```

---

## 7. HuggingFace PEFT 生态

### 库概览

```python
# 安装
pip install peft transformers bitsandbytes accelerate

# 版本（2024年推荐）
peft>=0.10.0
transformers>=4.38.0
bitsandbytes>=0.43.0
accelerate>=0.27.0
```

### 核心 API 一览

```python
from peft import (
    # 配置类
    LoraConfig,
    AdaLoraConfig,
    IA3Config,
    PrefixTuningConfig,
    PromptTuningConfig,

    # 模型包装类
    PeftModel,
    PeftModelForCausalLM,
    PeftModelForSequenceClassification,

    # 工厂函数
    get_peft_model,
    prepare_model_for_kbit_training,

    # 任务类型
    TaskType,
)

from transformers import BitsAndBytesConfig  # QLoRA 量化配置
```

### 社区生态

```
HuggingFace Hub：
  https://huggingface.co/models?library=peft
  ↑ 超过 50,000 个 PEFT 适配器权重
  ↑ 支持直接 from_pretrained() 加载

常用配套工具：
  - bitsandbytes: 量化支持 (NF4, Int8)
  - accelerate: 多 GPU/TPU 训练
  - trl: RLHF/SFT 训练器（与 PEFT 深度集成）
  - unsloth: 高性能 LoRA 训练加速（2x 速度）
```

---

## 参考资料

- [LoRA Paper](https://arxiv.org/abs/2106.09685) - Hu et al., 2021
- [QLoRA Paper](https://arxiv.org/abs/2305.14314) - Dettmers et al., 2023
- [AdaLoRA Paper](https://arxiv.org/abs/2303.10512) - Zhang et al., 2023
- [IA³ Paper](https://arxiv.org/abs/2205.05638) - Liu et al., 2022
- [PEFT Library Docs](https://huggingface.co/docs/peft)


---


## 1. PEFT 库架构总览

### 整体分层架构

```
┌─────────────────────────────────────────────────────┐
│                   用户代码层                          │
│  get_peft_model() / PeftModel.from_pretrained()     │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│                PeftModel 包装层                       │
│  PeftModelForCausalLM                               │
│  PeftModelForSeq2SeqLM                              │
│  PeftModelForSequenceClassification                 │
│  PeftModelForTokenClassification                    │
│  PeftModelForQuestionAnswering                      │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│               PeftConfig 配置层                       │
│  LoraConfig  AdaLoraConfig  IA3Config               │
│  PrefixTuningConfig  PromptTuningConfig             │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│               Adapter 注入层                          │
│  LoraLayer → 替换 nn.Linear 为 LoraLinear            │
│  IA3Layer  → 插入缩放向量                            │
│  PrefixEncoder → 生成 KV 前缀                        │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│               基础模型层 (Frozen)                     │
│  LLaMA / Mistral / GPT-2 / BERT ...                 │
└─────────────────────────────────────────────────────┘
```

### 关键设计模式

```python
# PEFT 的核心设计：模块替换（Module Replacement）
# 原始 Linear 层 → 被包装为 LoraLinear

# 原始结构（简化）：
class TransformerLayer:
    self.q_proj = nn.Linear(dim, dim)   # 普通线性层

# PEFT 注入后：
class TransformerLayer:
    self.q_proj = LoraLinear(
        in_features=dim,
        out_features=dim,
        r=16,
        lora_alpha=32,
        # 包含原始 weight + lora_A + lora_B
    )
```

---

## 2. PeftConfig 与 TaskType

### TaskType 枚举

```python
from peft import TaskType

# 所有支持的任务类型
TaskType.SEQ_CLS           # 序列分类（BERT、RoBERTa）
TaskType.SEQ_2_SEQ_LM      # 序列到序列（T5、BART）
TaskType.CAUSAL_LM         # 因果语言模型（GPT、LLaMA）
TaskType.TOKEN_CLS         # Token 分类（NER）
TaskType.QUESTION_ANS      # 问答
TaskType.FEATURE_EXTRACTION # 特征提取（无 head）

# 选择依据：
# - LLaMA/Mistral/GPT 系列 → CAUSAL_LM
# - T5/BART 系列 → SEQ_2_SEQ_LM
# - BERT 分类 → SEQ_CLS
```

### PeftConfig 基类

```python
from dataclasses import dataclass
from peft import PeftConfigMixin

# 所有 Config 的共有字段
@dataclass
class PeftConfigMixin:
    peft_type: PeftType           # 自动设置（LORA, PREFIX_TUNING 等）
    task_type: TaskType = None    # 任务类型
    inference_mode: bool = False  # 推理模式（冻结 dropout）
    base_model_name_or_path: str  # 基础模型路径（自动填充）
    revision: str = None          # 模型版本
```

---

## 3. LoraConfig 详解

### 完整参数说明

```python
from peft import LoraConfig

config = LoraConfig(
    # ─── 必须设置 ───────────────────────────────────────
    task_type=TaskType.CAUSAL_LM,

    # ─── 核心超参数 ──────────────────────────────────────
    r=16,                    # LoRA 秩（rank），常用：4/8/16/32/64
    lora_alpha=32,           # Scaling factor = alpha/r
                             # 通常设 alpha = 2r（scaling=2）

    # ─── 应用范围 ────────────────────────────────────────
    target_modules=[         # 应用 LoRA 的模块名称
        "q_proj",
        "k_proj",
        "v_proj",
        "o_proj",
        # "gate_proj",       # 可选：MLP 层
        # "up_proj",
        # "down_proj",
    ],

    # ─── 正则化 ──────────────────────────────────────────
    lora_dropout=0.05,       # A/B 矩阵的 Dropout（防过拟合）
    bias="none",             # bias 处理："none"|"all"|"lora_only"

    # ─── 可选优化 ────────────────────────────────────────
    use_rslora=False,        # Rank-Stabilized LoRA（推荐高 rank 时开启）
    use_dora=False,          # DoRA: Weight-Decomposed LoRA

    # ─── 模块匹配模式 ────────────────────────────────────
    modules_to_save=None,    # 额外完整训练的层（如 classification head）
                             # 例：["lm_head", "embed_tokens"]
)
```

### target_modules 匹配策略

```python
# 方式1：精确指定模块名（推荐）
target_modules=["q_proj", "v_proj"]

# 方式2：正则表达式匹配
target_modules=".*\.attention\.(q|v)_proj"

# 方式3：ALL_LINEAR（全部 Linear 层）
target_modules="all-linear"  # PEFT 0.7.0+

# 方式4：自动检测（特定模型）
from peft.utils import TRANSFORMERS_MODELS_TO_LORA_TARGET_MODULES_MAPPING
# 内置了 LLaMA、BERT、GPT-2 等模型的推荐 target_modules

# 不同模型的 target_modules 对应关系：
# ┌──────────────┬────────────────────────────────────────────┐
# │ LLaMA/Mistral│ q_proj, k_proj, v_proj, o_proj            │
# │ GPT-2        │ c_attn, c_proj                            │
# │ BERT         │ query, key, value, dense                  │
# │ Falcon       │ query_key_value, dense                    │
# │ Phi-2        │ q_proj, k_proj, v_proj, dense             │
# └──────────────┴────────────────────────────────────────────┘
```

### RSLoRA 与 DoRA 说明

```python
# RSLoRA (Rank-Stabilized LoRA)
# 问题：标准 LoRA scaling = alpha/r，高 rank 时梯度不稳定
# 解决：使用 1/sqrt(r) 代替 1/r 进行缩放
# 适用：r >= 32 时推荐开启
config = LoraConfig(r=64, use_rslora=True)

# DoRA (Weight-Decomposed Low-Rank Adaptation)
# 将权重分解为 magnitude + direction 两部分
# W = m × (W₀ + ΔW) / ‖W₀ + ΔW‖   (magnitude × normalized direction)
# 效果：通常优于标准 LoRA 1~2%
config = LoraConfig(r=16, use_dora=True)
```

---

## 4. BitsAndBytesConfig（QLoRA）

### 完整配置说明

```python
from transformers import BitsAndBytesConfig
import torch

# 4-bit 量化配置（QLoRA 标准配置）
bnb_config = BitsAndBytesConfig(
    # ─── 量化精度 ─────────────────────────────────────────
    load_in_4bit=True,               # 启用 4-bit 量化
    bnb_4bit_quant_type="nf4",       # 量化类型：nf4 或 fp4
                                     # nf4 通常优于 fp4

    # ─── 计算精度 ─────────────────────────────────────────
    bnb_4bit_compute_dtype=torch.bfloat16,  # 反量化后的计算精度
                                            # 推荐 bfloat16（A100+）
                                            # 无 BF16 支持用 float16

    # ─── 双重量化 ─────────────────────────────────────────
    bnb_4bit_use_double_quant=True,  # 对量化常数再次量化（节省 ~0.37 bit/param）

    # ─── 分组量化 ─────────────────────────────────────────
    # bnb_4bit_quant_storage=torch.uint8,  # 高级：量化存储类型
)

# 8-bit 量化配置（较旧方式，精度更高但节省更少）
bnb_config_8bit = BitsAndBytesConfig(
    load_in_8bit=True,
    llm_int8_threshold=6.0,          # 离群值阈值
    llm_int8_skip_modules=["lm_head"],  # 跳过量化的层
)
```

### 模型加载流程

```python
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import prepare_model_for_kbit_training

# Step 1: 加载量化模型
model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-2-7b-hf",
    quantization_config=bnb_config,
    device_map="auto",           # 自动分配到可用设备
    trust_remote_code=True,
    torch_dtype=torch.bfloat16,
)

# Step 2: 为 kbit 训练准备模型（关键！）
model = prepare_model_for_kbit_training(
    model,
    use_gradient_checkpointing=True,
    gradient_checkpointing_kwargs={"use_reentrant": False},
)
# prepare_model_for_kbit_training 做了什么：
# 1. 将所有 LayerNorm 转为 float32（稳定训练）
# 2. 将 lm_head 转为 float32
# 3. 启用梯度检查点（节省显存）
# 4. 冻结基础模型参数

# Step 3: 应用 LoRA
from peft import get_peft_model, LoraConfig

lora_config = LoraConfig(
    r=16,
    lora_alpha=32,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM",
)

model = get_peft_model(model, lora_config)
model.print_trainable_parameters()
# 输出: trainable params: 8,388,608 || all params: 3,548,061,696 || trainable%: 0.24
```

---

## 5. PeftModel 核心方法

### 模型创建

```python
from peft import get_peft_model, PeftModel

# 方式1：从头创建（训练时）
peft_model = get_peft_model(base_model, peft_config)

# 方式2：加载已有适配器（推理/继续训练）
peft_model = PeftModel.from_pretrained(
    base_model,
    "path/to/adapter",           # 本地路径或 HF Hub ID
    adapter_name="default",      # 适配器名称（多适配器时重要）
    is_trainable=False,          # True=继续训练，False=推理
)
```

### 保存与加载

```python
# ─── 保存适配器（只保存 LoRA 权重，不保存基础模型）───────
peft_model.save_pretrained(
    "output/my-lora-adapter",
    # 保存内容：
    # ├── adapter_config.json   （LoraConfig 序列化）
    # └── adapter_model.bin     （A/B 矩阵权重，几十 MB）
)

# ─── 加载适配器 ──────────────────────────────────────────
peft_model = PeftModel.from_pretrained(
    base_model,
    "output/my-lora-adapter",
)

# ─── 加载到已有 PeftModel ─────────────────────────────────
peft_model.load_adapter(
    "output/my-lora-adapter-v2",
    adapter_name="v2",
)
```

### 合并与卸载

```python
# merge_and_unload：将 LoRA 权重合并回基础模型
# 公式：W_merged = W₀ + (alpha/r) × B × A
merged_model = peft_model.merge_and_unload()

# 合并后的优势：
# ✅ 推理速度与原始模型相同（无 LoRA 额外计算）
# ✅ 可以用 transformers 正常推理
# ❌ 无法再切换不同适配器
# ❌ 无法恢复原始模型

# 保存合并后的完整模型
merged_model.save_pretrained("output/merged-model")
tokenizer.save_pretrained("output/merged-model")

# unload：卸载适配器（不合并，恢复原始权重）
base_model = peft_model.unload()
```

### 推理模式切换

```python
# 训练模式（LoRA dropout 生效）
peft_model.train()

# 推理模式（LoRA dropout 禁用）
peft_model.eval()

# 快速推理：禁用梯度计算
with torch.no_grad():
    outputs = peft_model.generate(
        input_ids,
        max_new_tokens=200,
        do_sample=True,
        temperature=0.7,
    )

# 或使用 torch.inference_mode()（更严格的无梯度模式）
with torch.inference_mode():
    outputs = peft_model(**inputs)
```

---

## 6. 多适配器支持

### 加载多个适配器

```python
from peft import PeftModel

# 加载基础模型
base_model = AutoModelForCausalLM.from_pretrained("meta-llama/Llama-2-7b-hf")

# 加载第一个适配器
model = PeftModel.from_pretrained(
    base_model,
    "adapter-for-coding",
    adapter_name="coding",
)

# 加载第二个适配器
model.load_adapter("adapter-for-math", adapter_name="math")
model.load_adapter("adapter-for-chat", adapter_name="chat")

# 切换激活的适配器
model.set_adapter("coding")   # 切换到代码适配器
model.set_adapter("math")     # 切换到数学适配器

# 禁用所有适配器（使用原始基础模型）
with model.disable_adapter():
    outputs = model.generate(...)

# 查看所有适配器
print(model.peft_config)  # 字典：{adapter_name: config}
```

### 适配器加权合并（LoRAHub 风格）

```python
from peft import PeftModel

# 方法1：add_weighted_adapter（线性组合）
model.add_weighted_adapter(
    adapters=["coding", "math"],           # 要合并的适配器名称
    weights=[0.7, 0.3],                    # 权重（和为1）
    adapter_name="coding_math_mix",        # 合并后的名称
    combination_type="linear",            # 线性合并
)

# 方法2：DARE (Drop And REscale) 合并
model.add_weighted_adapter(
    adapters=["adapter1", "adapter2"],
    weights=[0.5, 0.5],
    adapter_name="dare_merged",
    combination_type="dare_linear",
    density=0.5,    # 保留 50% 的参数（随机丢弃 50%）
)

# 方法3：TIES 合并（处理冲突参数）
model.add_weighted_adapter(
    adapters=["adapter1", "adapter2"],
    weights=[0.5, 0.5],
    adapter_name="ties_merged",
    combination_type="ties",
    density=0.3,
)
```

### 适配器合并策略对比

```
合并策略        原理                          适用场景
──────────────────────────────────────────────────────────
linear          按权重线性叠加 ΔW             任务相似，简单场景
svd             对合并结果 SVD 降秩           减少参数量
dare_linear     随机丢弃后线性合并            任务差异大，防止冲突
dare_ties       随机丢弃 + 符号选择           多适配器，复杂合并
ties            基于参数符号投票选择          冲突参数多的场景
cat             直接连接（不推荐）            实验性
```

---

## 7. 与 Transformers 的集成

### Trainer 集成

```python
from transformers import TrainingArguments, Trainer
from peft import get_peft_model, LoraConfig

# PEFT 模型可以直接传入 HF Trainer
training_args = TrainingArguments(
    output_dir="./results",
    num_train_epochs=3,
    per_device_train_batch_size=4,
    gradient_accumulation_steps=4,
    learning_rate=2e-4,
    fp16=True,                      # 混合精度训练
    logging_steps=10,
    save_strategy="epoch",
    # 关键：只保存 LoRA 适配器（不保存完整模型）
    save_safetensors=True,
)

trainer = Trainer(
    model=peft_model,               # PeftModel 直接传入
    args=training_args,
    train_dataset=train_dataset,
    eval_dataset=eval_dataset,
    tokenizer=tokenizer,
)

trainer.train()
# Trainer 自动：
# ✅ 只优化 trainable 参数（LoRA A/B 矩阵）
# ✅ 正确处理梯度检查点
# ✅ save_pretrained 只保存适配器
```

### GenerationMixin 集成

```python
# PeftModel 完整支持 transformers 的生成 API
outputs = peft_model.generate(
    input_ids=input_ids,
    attention_mask=attention_mask,
    max_new_tokens=512,
    do_sample=True,
    temperature=0.7,
    top_p=0.9,
    repetition_penalty=1.1,
    pad_token_id=tokenizer.eos_token_id,
)

# 流式生成（配合 TextStreamer）
from transformers import TextStreamer
streamer = TextStreamer(tokenizer, skip_special_tokens=True)

outputs = peft_model.generate(
    input_ids=input_ids,
    max_new_tokens=512,
    streamer=streamer,
)
```

---

## 8. 适配器合并策略

### 合并时机选择

```
场景                           推荐策略
────────────────────────────────────────────────────────────
生产部署（固定任务）            merge_and_unload()
                               → 无推理开销，但无法切换

多租户服务（不同用户/任务）     保留 PEFT 结构 + set_adapter()
                               → 灵活切换，稍有额外开销

实验/开发阶段                  保留 PEFT 结构
                               → 方便调试和比较

量化部署                       merge → GPTQ/AWQ 量化
                               → 最优推理性能
```

### 合并的数学等价性

```python
# 合并前（推理时）：
# output = W₀ × x + (alpha/r) × B × A × x
#        = (W₀ + (alpha/r) × B × A) × x

# 合并后（等价）：
# W_merged = W₀ + (alpha/r) × B × A
# output = W_merged × x

# 等价性证明：矩阵乘法分配律
# 注意：merge 操作是精确等价的（无精度损失）

# 但 QLoRA 合并有精度差异：
# 量化模型合并：先反量化 W₀，加上 BA，再（可选）重新量化
# 存在轻微数值误差（通常可忽略）
```

### 合并代码示例

```python
# 完整的合并 + 保存流程
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer
import torch

# 1. 加载基础模型（bfloat16 以避免精度损失）
base_model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-2-7b-hf",
    torch_dtype=torch.bfloat16,
    device_map="auto",
)

# 2. 加载 LoRA 适配器
model = PeftModel.from_pretrained(base_model, "./lora-adapter")

# 3. 合并并卸载
merged = model.merge_and_unload()

# 4. 保存完整模型
merged.save_pretrained("./merged-llama2-7b", safe_serialization=True)
tokenizer = AutoTokenizer.from_pretrained("meta-llama/Llama-2-7b-hf")
tokenizer.save_pretrained("./merged-llama2-7b")

print("合并完成！模型大小：", sum(p.numel() for p in merged.parameters()) / 1e9, "B 参数")
```

---

## 参考资料

- [PEFT 官方文档](https://huggingface.co/docs/peft)
- [PEFT GitHub 源码](https://github.com/huggingface/peft)
- [LoraConfig API 文档](https://huggingface.co/docs/peft/package_reference/lora)
- [BitsAndBytesConfig 文档](https://huggingface.co/docs/transformers/main_classes/quantization)


---


## 1. 完整 LoRA 微调示例

### 环境准备

```bash
# 安装依赖
pip install transformers peft accelerate datasets trl bitsandbytes
pip install wandb  # 可选，用于实验追踪

# 验证 GPU
python -c "import torch; print(torch.cuda.get_device_name(0))"
```

### 数据准备

```python
from datasets import load_dataset

# 使用 Alpaca 格式数据集
dataset = load_dataset("tatsu-lab/alpaca", split="train")

# Alpaca 格式：instruction + input + output
def format_prompt(example):
    """将 Alpaca 格式转换为 LLaMA 对话格式"""
    if example["input"]:
        return (
            f"### Instruction:\n{example['instruction']}\n\n"
            f"### Input:\n{example['input']}\n\n"
            f"### Response:\n{example['output']}"
        )
    else:
        return (
            f"### Instruction:\n{example['instruction']}\n\n"
            f"### Response:\n{example['output']}"
        )

dataset = dataset.map(
    lambda x: {"text": format_prompt(x)},
    remove_columns=dataset.column_names,
)
dataset = dataset.train_test_split(test_size=0.1, seed=42)
```

### LLaMA-2 LoRA 微调（单卡 A100）

```python
import torch
from transformers import (
    AutoTokenizer,
    AutoModelForCausalLM,
    TrainingArguments,
)
from peft import LoraConfig, get_peft_model, TaskType
from trl import SFTTrainer

# ─── 1. 模型与分词器 ──────────────────────────────────────
MODEL_ID = "meta-llama/Llama-2-7b-hf"

tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
tokenizer.pad_token = tokenizer.eos_token     # LLaMA 没有 pad token
tokenizer.padding_side = "right"              # 右填充（避免 SDPA 警告）

model = AutoModelForCausalLM.from_pretrained(
    MODEL_ID,
    torch_dtype=torch.bfloat16,
    device_map="auto",
    use_cache=False,             # 训练时关闭 KV cache
)
model.enable_input_require_grads()  # 梯度检查点需要

# ─── 2. LoRA 配置 ─────────────────────────────────────────
lora_config = LoraConfig(
    task_type=TaskType.CAUSAL_LM,
    r=16,
    lora_alpha=32,
    target_modules=[
        "q_proj", "k_proj", "v_proj", "o_proj",   # 注意力层
        "gate_proj", "up_proj", "down_proj",       # MLP 层（可选）
    ],
    lora_dropout=0.05,
    bias="none",
)

model = get_peft_model(model, lora_config)
model.print_trainable_parameters()
# trainable params: 167,772,160 || all params: 6,773,221,376 || trainable%: 2.48

# ─── 3. 训练参数 ──────────────────────────────────────────
training_args = TrainingArguments(
    output_dir="./llama2-7b-alpaca-lora",

    # 批次设置
    per_device_train_batch_size=4,
    per_device_eval_batch_size=4,
    gradient_accumulation_steps=4,        # 等效 batch_size = 4×4 = 16

    # 训练轮次
    num_train_epochs=3,
    # max_steps=1000,                     # 也可按步数控制

    # 学习率调度
    learning_rate=2e-4,
    lr_scheduler_type="cosine",
    warmup_ratio=0.05,

    # 精度
    bf16=True,                             # A100 使用 BF16
    # fp16=True,                           # 其他 GPU 使用 FP16

    # 内存优化
    gradient_checkpointing=True,
    gradient_checkpointing_kwargs={"use_reentrant": False},
    optim="adamw_torch_fused",            # 融合 AdamW（更快）
    dataloader_num_workers=4,

    # 日志与保存
    logging_steps=10,
    eval_strategy="steps",
    eval_steps=100,
    save_strategy="steps",
    save_steps=200,
    save_total_limit=3,
    load_best_model_at_end=True,

    # 实验追踪
    report_to="wandb",                    # 或 "tensorboard"
    run_name="llama2-7b-alpaca-lora-r16",
)

# ─── 4. 训练器 ────────────────────────────────────────────
trainer = SFTTrainer(
    model=model,
    args=training_args,
    train_dataset=dataset["train"],
    eval_dataset=dataset["test"],
    tokenizer=tokenizer,
    peft_config=lora_config,              # SFTTrainer 可直接传 peft_config
    dataset_text_field="text",
    max_seq_length=2048,
    packing=True,                         # 序列拼接（提高效率）
)

# ─── 5. 开始训练 ──────────────────────────────────────────
trainer.train()
trainer.save_model()
```

---

## 2. QLoRA 消费级 GPU 配置

### RTX 3090/4090（24GB）配置

```python
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from peft import (
    LoraConfig,
    get_peft_model,
    prepare_model_for_kbit_training,
    TaskType,
)

MODEL_ID = "meta-llama/Llama-2-13b-hf"  # 13B 模型在 24GB 上微调

# ─── QLoRA 量化配置 ───────────────────────────────────────
bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.bfloat16,
    bnb_4bit_use_double_quant=True,       # 双重量化，多节省 ~2GB
)

# ─── 加载量化模型 ─────────────────────────────────────────
model = AutoModelForCausalLM.from_pretrained(
    MODEL_ID,
    quantization_config=bnb_config,
    device_map="auto",                    # 自动分配（单卡全放 GPU）
    trust_remote_code=True,
)

# ─── 关键步骤：准备 kbit 训练 ─────────────────────────────
model = prepare_model_for_kbit_training(
    model,
    use_gradient_checkpointing=True,
)

# ─── LoRA 配置（QLoRA 通常用较小的 rank）─────────────────
lora_config = LoraConfig(
    task_type=TaskType.CAUSAL_LM,
    r=8,                                  # 消费级 GPU 建议 8~16
    lora_alpha=16,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    lora_dropout=0.05,
    bias="none",
)

model = get_peft_model(model, lora_config)
model.print_trainable_parameters()
# trainable params: 20,971,520 || all params: 13,028,818,944 || trainable%: 0.16

# ─── 训练参数（显存优化版）───────────────────────────────
training_args = TrainingArguments(
    output_dir="./llama2-13b-qlora",
    per_device_train_batch_size=1,        # 24GB 上 13B 只能 batch=1
    gradient_accumulation_steps=16,       # 等效 batch=16
    num_train_epochs=3,
    learning_rate=2e-4,
    bf16=True,
    optim="paged_adamw_8bit",             # 分页优化器（关键！防止 OOM）
    gradient_checkpointing=True,
    max_grad_norm=0.3,
    warmup_ratio=0.03,
    lr_scheduler_type="constant",
    logging_steps=10,
    save_strategy="epoch",
)
```

### 显存使用估算

```
模型           量化    LoRA r=8    训练 batch=1   预估 VRAM
──────────────────────────────────────────────────────────
LLaMA-2-7B    NF4     +LoRA       seq=2048       ~10 GB
LLaMA-2-13B   NF4     +LoRA       seq=2048       ~16 GB
LLaMA-2-70B   NF4     +LoRA       seq=512        ~46 GB
Mistral-7B    NF4     +LoRA       seq=4096       ~12 GB

FP16（无量化）
LLaMA-2-7B    —       +LoRA       seq=2048       ~24 GB
LLaMA-2-13B   —       +LoRA       seq=2048       ~40 GB
```

---

## 3. Rank 与 Alpha 调参指南

### 实践经验法则

```python
# 经验规则总结：
#
# 1. alpha / r = 常数（通常 = 1 或 2）
#    推荐：alpha = r（scaling=1）或 alpha = 2r（scaling=2）
#
# 2. rank 选择：
#    - 快速验证 / 数据 < 5K：       r = 4~8
#    - 常规微调 / 数据 5K~50K：     r = 16~32
#    - 高质量 / 数据充足：           r = 64~128
#    - 接近全量微调：               r = 256（慎用）
#
# 3. 任务复杂度 vs rank：
#    - 简单格式化任务（JSON 输出）：  r = 4
#    - 对话风格迁移：               r = 8~16
#    - 领域知识注入：               r = 16~32
#    - 复杂推理能力：               r = 64+

# 调参实验框架
def lora_experiment(rank, alpha, dataset_size):
    """快速调参实验"""
    config = LoraConfig(
        r=rank,
        lora_alpha=alpha,
        target_modules=["q_proj", "v_proj"],  # 最小配置先验证
        lora_dropout=0.0 if dataset_size > 10000 else 0.05,
        task_type=TaskType.CAUSAL_LM,
    )
    # 训练 100~200 steps 快速评估
    return config
```

### Dropout 使用建议

```
数据集大小        lora_dropout    理由
────────────────────────────────────────────────────────
< 1,000 样本      0.05~0.1       数据少，需要正则化防过拟合
1K ~ 10K          0.05           轻度正则化
> 10K             0.0~0.05       数据充足，dropout 作用小
> 100K            0.0            大数据集，dropout 可能有害
```

### Learning Rate 建议

```python
# LoRA 的学习率通常比全量微调高 10x
# 全量微调：lr = 1e-5 ~ 3e-5
# LoRA:      lr = 1e-4 ~ 5e-4

# 不同模型的推荐学习率：
lr_recommendations = {
    "LLaMA-2-7B":  2e-4,
    "LLaMA-2-13B": 2e-4,
    "LLaMA-2-70B": 1e-4,
    "Mistral-7B":  2e-4,
    "Falcon-7B":   2e-4,
    "GPT-2":       5e-4,
}

# 学习率调度：
# - cosine：通用，适合完整 epoch 训练
# - constant_with_warmup：适合步数控制训练
# - warmup_ratio = 0.03~0.05（通常）
```

---

## 4. 适配器保存与加载

### 训练后保存

```python
# 方式1：通过 trainer 保存（推荐）
trainer.save_model("./output/lora-adapter")
# 保存：adapter_config.json + adapter_model.safetensors

# 方式2：直接保存
model.save_pretrained("./output/lora-adapter")
tokenizer.save_pretrained("./output/lora-adapter")

# 方式3：保存到 HuggingFace Hub
model.push_to_hub(
    "username/my-lora-adapter",
    use_auth_token=True,
    commit_message="Add LoRA adapter for LLaMA-2-7B",
)

# 适配器目录结构：
# output/lora-adapter/
# ├── adapter_config.json     ← LoraConfig 序列化（~1KB）
# ├── adapter_model.safetensors ← LoRA 权重（~64MB for r=16）
# └── tokenizer files...      ← 如果保存了 tokenizer
```

### 推理时加载

```python
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer
import torch

# ─── 方式1：加载基础模型 + 适配器（常规推理）─────────────
base_model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-2-7b-hf",
    torch_dtype=torch.bfloat16,
    device_map="auto",
)

model = PeftModel.from_pretrained(
    base_model,
    "./output/lora-adapter",
    torch_dtype=torch.bfloat16,
)
model.eval()

# ─── 方式2：QLoRA 推理（保留量化）─────────────────────────
bnb_config = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_compute_dtype=torch.bfloat16)
base_model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-2-7b-hf",
    quantization_config=bnb_config,
    device_map="auto",
)
model = PeftModel.from_pretrained(base_model, "./output/qlora-adapter")

# ─── 生成推理 ─────────────────────────────────────────────
tokenizer = AutoTokenizer.from_pretrained("./output/lora-adapter")

def inference(prompt, max_new_tokens=200):
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=True,
            temperature=0.7,
            top_p=0.9,
            pad_token_id=tokenizer.eos_token_id,
        )
    return tokenizer.decode(outputs[0], skip_special_tokens=True)

print(inference("### Instruction:\n写一首关于春天的诗\n\n### Response:\n"))
```

---

## 5. 合并适配器到基础模型

### 标准合并流程

```python
"""合并 LoRA 适配器到基础模型，用于生产部署"""
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

def merge_lora_adapter(
    base_model_id: str,
    adapter_path: str,
    output_path: str,
    torch_dtype=torch.bfloat16,
):
    print(f"正在加载基础模型：{base_model_id}")
    base_model = AutoModelForCausalLM.from_pretrained(
        base_model_id,
        torch_dtype=torch_dtype,
        device_map="auto",
        low_cpu_mem_usage=True,
    )

    print(f"正在加载 LoRA 适配器：{adapter_path}")
    model = PeftModel.from_pretrained(
        base_model,
        adapter_path,
        torch_dtype=torch_dtype,
    )

    print("正在合并权重...")
    merged_model = model.merge_and_unload()

    print(f"正在保存合并模型到：{output_path}")
    merged_model.save_pretrained(
        output_path,
        safe_serialization=True,    # 保存为 safetensors 格式
        max_shard_size="4GB",       # 分片大小（大模型需要）
    )

    tokenizer = AutoTokenizer.from_pretrained(base_model_id)
    tokenizer.save_pretrained(output_path)

    print("✅ 合并完成！")
    return merged_model

# 使用示例
merge_lora_adapter(
    base_model_id="meta-llama/Llama-2-7b-hf",
    adapter_path="./output/lora-adapter",
    output_path="./output/llama2-7b-merged",
)
```

### QLoRA 合并注意事项

```python
# QLoRA 合并需要先将模型加载为全精度（非量化）
# 然后再加载适配器合并

# ❌ 错误方式：量化状态下合并
base_model = AutoModelForCausalLM.from_pretrained(
    model_id,
    quantization_config=bnb_config,  # 不要在量化状态下合并！
)

# ✅ 正确方式：全精度加载 + 合并
base_model = AutoModelForCausalLM.from_pretrained(
    model_id,
    torch_dtype=torch.bfloat16,      # 全精度
    device_map="auto",
)
model = PeftModel.from_pretrained(base_model, adapter_path)
merged = model.merge_and_unload()   # 合并
```

---

## 6. 多任务多适配器训练

### 方案一：为不同任务分别训练适配器

```python
from peft import LoraConfig, get_peft_model, PeftModel

# 任务1：代码生成
def train_coding_adapter(base_model, coding_dataset):
    lora_config = LoraConfig(r=32, lora_alpha=64, task_type="CAUSAL_LM",
                             target_modules=["q_proj", "v_proj"])
    model = get_peft_model(base_model, lora_config)
    # ... 训练 ...
    model.save_pretrained("./adapters/coding")

# 任务2：数学推理
def train_math_adapter(base_model, math_dataset):
    lora_config = LoraConfig(r=64, lora_alpha=128, task_type="CAUSAL_LM",
                             target_modules=["q_proj", "k_proj", "v_proj", "o_proj"])
    model = get_peft_model(base_model, lora_config)
    # ... 训练 ...
    model.save_pretrained("./adapters/math")

# 推理时按需切换
base_model = load_base_model()
model = PeftModel.from_pretrained(base_model, "./adapters/coding", adapter_name="coding")
model.load_adapter("./adapters/math", adapter_name="math")
model.load_adapter("./adapters/chat", adapter_name="chat")

# 路由逻辑
def route_and_infer(query: str, task_type: str) -> str:
    model.set_adapter(task_type)  # 动态切换
    return generate(model, query)
```

### 方案二：混合数据集单次训练

```python
from datasets import concatenate_datasets, interleave_datasets

# 按比例混合数据集
coding_ds = load_dataset("code_instructions", split="train")   # 50K
math_ds   = load_dataset("math_instructions", split="train")   # 30K
chat_ds   = load_dataset("chat_instructions", split="train")   # 80K

# 方式1：等比例混合
mixed_dataset = interleave_datasets(
    [coding_ds, math_ds, chat_ds],
    probabilities=[0.3, 0.3, 0.4],  # 按比例采样
    seed=42,
)

# 方式2：直接拼接
mixed_dataset = concatenate_datasets([coding_ds, math_ds, chat_ds])
mixed_dataset = mixed_dataset.shuffle(seed=42)

# 使用一个适配器处理多任务
lora_config = LoraConfig(
    r=32,        # 多任务需要更高 rank
    lora_alpha=64,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                    "gate_proj", "up_proj", "down_proj"],  # 覆盖更多层
    task_type="CAUSAL_LM",
)
```

---

## 7. VRAM 优化策略

### 梯度检查点

```python
from transformers import TrainingArguments

# 梯度检查点：以重计算换显存
# 原理：不缓存所有激活值，反向传播时重新计算
# 显存节省：~30~40%
# 速度损失：~15~20%

training_args = TrainingArguments(
    gradient_checkpointing=True,
    gradient_checkpointing_kwargs={
        "use_reentrant": False,    # 推荐 False（与 PEFT 更兼容）
    },
)

# 手动启用（不使用 Trainer）
model.gradient_checkpointing_enable(
    gradient_checkpointing_kwargs={"use_reentrant": False}
)
```

### 优化器内存优化

```python
# 选项1：paged_adamw_8bit（QLoRA 推荐）
optim = "paged_adamw_8bit"
# - 优化器状态以 8bit 存储
# - GPU 显存不足时自动 page 到 CPU
# - 节省：~75% 优化器状态显存

# 选项2：adamw_bnb_8bit（全量参数）
optim = "adamw_bnb_8bit"

# 选项3：adamw_torch_fused（速度最快）
optim = "adamw_torch_fused"
# - 适合显存充足的情况
# - 使用 CUDA kernel 融合，速度快约 10%

# 选项4：sgd（极限省显存）
optim = "sgd"
# - 无优化器状态（只有动量）
# - 显存最省，但收敛慢

# 内存占用对比（7B 模型，LoRA r=16）：
# AdamW fp32：  ~8GB 优化器状态
# AdamW 8bit：  ~2GB 优化器状态
# paged AdamW:  ~2GB + CPU overflow 支持
```

### Flash Attention 2

```python
# Flash Attention 2：高效注意力计算
# 显存节省：O(n²) → O(n)（序列长度）
# 速度提升：2~4x

model = AutoModelForCausalLM.from_pretrained(
    MODEL_ID,
    attn_implementation="flash_attention_2",  # 启用 Flash Attention 2
    torch_dtype=torch.bfloat16,
)

# 安装：pip install flash-attn --no-build-isolation
# 需要：Ampere+ GPU (A100/A10/RTX 3090+)
```

### 完整显存优化配置

```python
"""最省显存的 QLoRA 配置（适合 16GB GPU 训练 7B 模型）"""

# 1. 量化配置
bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.float16,  # V100 没有 BF16
    bnb_4bit_use_double_quant=True,
)

# 2. 最小 LoRA
lora_config = LoraConfig(
    r=4,
    lora_alpha=8,
    target_modules=["q_proj", "v_proj"],  # 只用最关键的两层
    lora_dropout=0.05,
    task_type="CAUSAL_LM",
)

# 3. 训练参数
training_args = TrainingArguments(
    per_device_train_batch_size=1,
    gradient_accumulation_steps=8,
    gradient_checkpointing=True,
    optim="paged_adamw_8bit",
    fp16=True,
    max_grad_norm=0.3,
    dataloader_num_workers=0,    # 减少 CPU 内存占用
)
```

---

## 8. 常见问题排查

### 问题1：梯度爆炸（Loss 变成 NaN）

```python
# 症状：loss 突然变为 nan 或 inf
# 诊断：
import torch
for name, param in model.named_parameters():
    if param.grad is not None:
        if torch.isnan(param.grad).any():
            print(f"NaN 梯度：{name}")

# 解决方案：
# 1. 降低学习率
training_args = TrainingArguments(learning_rate=1e-4)  # 从 2e-4 降到 1e-4

# 2. 增加梯度裁剪
training_args = TrainingArguments(max_grad_norm=0.3)

# 3. 使用 bf16 替代 fp16（bf16 不容易溢出）
training_args = TrainingArguments(bf16=True, fp16=False)

# 4. 检查数据中是否有异常（空文本、超长序列）
def check_data(dataset):
    for item in dataset:
        if len(item["text"]) == 0:
            print("警告：空样本")
        if len(item["text"]) > 10000:
            print(f"警告：超长样本 {len(item['text'])} 字符")
```

### 问题2：模式塌陷（Repetition/Mode Collapse）

```python
# 症状：模型输出重复文字，无法停止
# 原因：过拟合、学习率过高、数据质量差

# 解决方案：
# 1. 降低学习率
# 2. 减少训练轮次（早停）
# 3. 增加 lora_dropout
# 4. 生成时使用 repetition_penalty
outputs = model.generate(
    input_ids,
    repetition_penalty=1.1,    # 惩罚重复（1.0=无惩罚，>1.0=有惩罚）
    no_repeat_ngram_size=3,    # 禁止重复 3-gram
)
```

### 问题3：OOM（显存溢出）

```python
# 调试工具
import torch
print(f"已用显存：{torch.cuda.memory_allocated()/1e9:.2f} GB")
print(f"峰值显存：{torch.cuda.max_memory_allocated()/1e9:.2f} GB")
torch.cuda.empty_cache()  # 清理缓存（不释放已用显存）

# 逐步减少 batch_size 同时增加 gradient_accumulation_steps
# batch=4, accum=4 → batch=2, accum=8 → batch=1, accum=16

# 检查是否有不必要的张量保留在 GPU 上
import gc
gc.collect()
torch.cuda.empty_cache()
```

### 问题4：训练速度慢

```python
# 性能分析
# 检查 GPU 利用率
# watch -n 1 nvidia-smi

# 1. 启用 Flash Attention 2（最有效）
model = AutoModelForCausalLM.from_pretrained(
    model_id, attn_implementation="flash_attention_2"
)

# 2. 使用 packing（序列拼接）
trainer = SFTTrainer(packing=True)  # 将短序列拼接到 max_seq_length

# 3. 增加 dataloader_num_workers
training_args = TrainingArguments(dataloader_num_workers=4)

# 4. 使用 bf16（比 fp16 稳定，比 fp32 快）
training_args = TrainingArguments(bf16=True)

# 5. 使用 unsloth 加速（2x 速度提升）
# pip install unsloth
from unsloth import FastLanguageModel
model, tokenizer = FastLanguageModel.from_pretrained(model_id, ...)
```

### 问题5：evaluate 指标不上升

```python
# 常见原因和检查清单：
# □ 学习率太高或太低（先试 2e-4）
# □ 训练数据格式错误（检查 format_prompt 输出）
# □ pad_token 设置错误（LLaMA 需要手动设置）
# □ max_seq_length 太短（重要内容被截断）
# □ 数据集太小（< 500 样本效果差）

# 快速检查：打印几个训练样本
print(tokenizer.decode(train_dataset[0]["input_ids"]))

# 验证 pad_token 设置
assert tokenizer.pad_token == tokenizer.eos_token, "LLaMA 需要设置 pad_token"
assert model.config.pad_token_id == tokenizer.eos_token_id
```

---

## 参考资料

- [QLoRA 实践指南](https://www.philschmid.de/fine-tune-llms-in-2024-with-trl)
- [LoRA 超参数调优](https://magazine.sebastianraschka.com/p/practical-tips-for-finetuning-llms)
- [unsloth 加速 LoRA](https://github.com/unslothai/unsloth)
- [PEFT 官方示例](https://github.com/huggingface/peft/tree/main/examples)
