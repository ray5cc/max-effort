# 11-Transformers与模型架构 — 技术资料

> 从 LLaMA 架构细节到 HuggingFace Transformers 工程实践，深入理解现代大型语言模型的设计取舍与推理优化技术。

## 相关链接

- 对应面试题：[11-Transformers与模型架构面试题](../../02-面试指南/07-AI-Agent全栈开发面试/11-Transformers与模型架构面试题.md)

## 目录

1. [概述](#1-概述)
   - 1.1 HuggingFace Transformers 生态
   - 1.2 为什么学习源码
2. [LLaMA 模型架构](#2-llama-模型架构)
   - 2.1 整体架构（相比原版 Transformer 的改进）
   - 2.2 RMSNorm（替代 LayerNorm）
   - 2.3 RoPE（旋转位置编码）
   - 2.4 GQA（分组查询注意力）
   - 2.5 SwiGLU 激活函数
3. [HuggingFace Transformers 核心组件](#3-huggingface-transformers-核心组件)
   - 3.1 Tokenizer：分词与编码
   - 3.2 Model：模型加载与前向传播
   - 3.3 Pipeline：一行代码运行模型
   - 3.4 Trainer：训练封装
   - 3.5 generate() 方法与解码策略
4. [推理优化技术](#4-推理优化技术)
   - 4.1 KV Cache 原理与实现
   - 4.2 量化（INT8/INT4/GPTQ/AWQ）
   - 4.3 投机解码（Speculative Decoding）
   - 4.4 连续批处理（Continuous Batching）
   - 4.5 FlashAttention
5. [实战示例](#5-实战示例)
   - 5.1 加载并运行 LLaMA 模型
   - 5.2 自定义 Tokenizer
   - 5.3 性能基准测试
6. [最佳实践](#6-最佳实践)
7. [常见问题](#7-常见问题)

---

## 1. 概述

### 1.1 HuggingFace Transformers 生态

HuggingFace 已发展为 AI 工程师的"标准工具链"，其生态由几个核心库协同工作：

```
┌─────────────────────────────────────────────────────────────────┐
│                    HuggingFace 生态全景                          │
├──────────────┬──────────────────┬──────────────────────────────┤
│  transformers │    tokenizers     │         datasets              │
│  (模型主库)   │  (Rust 加速分词)  │       (数据集管理)            │
├──────────────┴──────────────────┴──────────────────────────────┤
│         accelerate（多 GPU/TPU 训练加速）                         │
├──────────────────────────────────────────────────────────────────┤
│  PEFT（参数高效微调）  │  TRL（强化学习）  │  optimum（硬件优化）  │
└──────────────────────────────────────────────────────────────────┘
```

| 库名 | 核心职责 | 典型使用场景 |
|------|----------|-------------|
| `transformers` | 模型定义、加载、推理 | 所有场景的基础 |
| `tokenizers` | Rust 实现的高性能分词 | 生产分词管道 |
| `datasets` | 数据集加载与流式处理 | 训练数据管理 |
| `accelerate` | 分布式训练抽象层 | 多卡/多机训练 |
| `PEFT` | LoRA/QLoRA 等参数高效微调 | 低资源微调 |
| `TRL` | RLHF/DPO/PPO 训练 | 对齐训练 |
| `optimum` | ONNX/TensorRT 导出优化 | 生产推理优化 |

### 1.2 为什么学习源码

**类比：** 学驾驶不需要了解发动机原理，但汽车工程师必须懂。同理，使用 API 不需要懂源码，但要优化推理延迟、调试奇怪 bug、定制训练流程时，源码是唯一可靠的参考。

学习源码的三个核心收益：

1. **定位性能瓶颈**：了解 `generate()` 的 KV Cache 机制，才能判断 OOM 发生在哪一步
2. **定制化能力**：扩展 `Attention` 模块以支持自定义注意力掩码
3. **避免"黑盒陷阱"**：`pipeline()` 的默认 `truncation=True` 可能悄悄截断你的输入

---

## 2. LLaMA 模型架构

### 2.1 整体架构（相比原版 Transformer 的改进）

原版 Transformer（Vaswani et al., 2017）是 Encoder-Decoder 结构，而 LLaMA 是纯 Decoder-only 的自回归语言模型，并在多处做了工程优化：

```
原版 Transformer Decoder Block          LLaMA Decoder Block
─────────────────────────────          ──────────────────────────────
  Input Embedding                        Input Embedding
       │                                      │
  ┌────▼────┐                          ┌──────▼──────┐
  │ LayerNorm│  ← 后归一化              │  RMSNorm    │  ← 前归一化（Pre-norm）
  └────┬────┘                          └──────┬──────┘
       │                                      │
  ┌────▼───────────────┐              ┌───────▼──────────────────┐
  │  Multi-Head Attention│             │ Grouped Query Attention   │
  │  (绝对位置编码)      │             │ (RoPE 旋转位置编码)       │
  └────┬───────────────┘              └───────┬──────────────────┘
       │                                      │
  ┌────▼────┐                          ┌──────▼──────┐
  │ LayerNorm│                          │  RMSNorm    │
  └────┬────┘                          └──────┬──────┘
       │                                      │
  ┌────▼────────────┐                 ┌───────▼──────────────────┐
  │  FFN (ReLU)     │                 │  FFN (SwiGLU)            │
  └────┬────────────┘                 └───────┬──────────────────┘
       │                                      │
  Output Embedding                     Output Embedding
```

**改进点汇总：**

| 改进项 | 原版 Transformer | LLaMA | 收益 |
|--------|-----------------|-------|------|
| 归一化位置 | Post-norm（后归一化） | Pre-norm（前归一化） | 训练更稳定，梯度更好流动 |
| 归一化方法 | LayerNorm | RMSNorm | 计算量减少约 15% |
| 位置编码 | 绝对正弦位置编码 | RoPE | 支持长度外推，相对位置更准确 |
| 注意力机制 | Multi-Head Attention | GQA | 推理时 KV Cache 内存减少 |
| 激活函数 | ReLU | SwiGLU | 更强表达能力 |

### 2.2 RMSNorm（替代 LayerNorm）

**LayerNorm 的公式：**

```
LayerNorm(x) = γ · (x - μ) / √(σ² + ε) + β
```

其中 μ 是均值，σ² 是方差——需要计算两次遍历（一次算均值，一次算方差）。

**RMSNorm 的公式：**

```
RMSNorm(x) = γ · x / RMS(x)

其中 RMS(x) = √(1/n · Σᵢ xᵢ²)
```

**直觉解释：** LayerNorm 认为"归一化"需要同时消除均值（中心化）和方差（缩放）的影响；RMSNorm 认为缩放才是关键，均值偏移影响不大。去掉均值计算后，少了约 7-15% 的计算量，且实验证明效果相当。

```python
import torch
import torch.nn as nn

class RMSNorm(nn.Module):
    def __init__(self, dim: int, eps: float = 1e-6):
        super().__init__()
        self.eps = eps
        self.weight = nn.Parameter(torch.ones(dim))  # 可学习的缩放参数 γ

    def _norm(self, x):
        # x: (batch, seq_len, dim)
        return x * torch.rsqrt(x.pow(2).mean(-1, keepdim=True) + self.eps)

    def forward(self, x):
        output = self._norm(x.float()).type_as(x)
        return output * self.weight
```

### 2.3 RoPE（旋转位置编码）

#### 数学推导

RoPE（Rotary Position Embedding）的核心思想：**通过旋转变换，使得两个 token 的内积仅依赖于它们的相对位置差**。

设查询向量 q 在位置 m，键向量 k 在位置 n，RoPE 定义如下旋转操作：

```
f(q, m) = q · e^(imθ)   （复数表示）

其中 θ_d = 1 / 10000^(2d/D)，d 为维度索引，D 为总维度
```

对于实数向量，将 D 维向量拆成 D/2 个二维子向量，对每对 (x₂ᵢ, x₂ᵢ₊₁) 应用旋转矩阵：

```
[x₂ᵢ']     [cos(mθᵢ)  -sin(mθᵢ)] [x₂ᵢ  ]
[x₂ᵢ₊₁'] = [sin(mθᵢ)   cos(mθᵢ)] [x₂ᵢ₊₁]
```

**内积的相对性：**
```
⟨f(q,m), f(k,n)⟩ = Re[qk* · e^(i(m-n)θ)]
```

这里的 `(m-n)` 正是相对位置差！无论 m 和 n 的绝对值是多少，只要差值相同，注意力权重就相同。

#### 直觉解释

**类比：** 把每个 token 的词向量想象成一个指针（复数平面上的向量），位置 m 的 token 就是把指针旋转了 m 个角度。两个 token 做内积时，相当于计算它们旋转角度的差，差值就是相对距离。

```
位置 0: →         (旋转 0°)
位置 1:  ↗        (旋转 θ°)
位置 2:   ↑       (旋转 2θ°)
位置 3:    ↖      (旋转 3θ°)

位置 1 和 位置 3 的内积 = cos(3θ - θ) = cos(2θ)
位置 0 和 位置 2 的内积 = cos(2θ - 0) = cos(2θ)  ← 相同！
```

```python
def precompute_freqs_cis(dim: int, end: int, theta: float = 10000.0):
    """预计算 RoPE 的复数旋转因子"""
    # 每个维度对的频率
    freqs = 1.0 / (theta ** (torch.arange(0, dim, 2).float() / dim))
    t = torch.arange(end)                     # 位置序列 [0, 1, ..., end-1]
    freqs = torch.outer(t, freqs)             # (end, dim/2)
    freqs_cis = torch.polar(torch.ones_like(freqs), freqs)  # 复数形式
    return freqs_cis

def apply_rotary_emb(xq, xk, freqs_cis):
    """将 RoPE 应用到 Q 和 K"""
    xq_ = torch.view_as_complex(xq.float().reshape(*xq.shape[:-1], -1, 2))
    xk_ = torch.view_as_complex(xk.float().reshape(*xk.shape[:-1], -1, 2))
    # 元素级别乘法 = 旋转
    xq_out = torch.view_as_real(xq_ * freqs_cis).flatten(3)
    xk_out = torch.view_as_real(xk_ * freqs_cis).flatten(3)
    return xq_out.type_as(xq), xk_out.type_as(xk)
```

### 2.4 GQA（分组查询注意力）

#### MHA / MQA / GQA 的演进

```
MHA (Multi-Head Attention)        MQA (Multi-Query Attention)       GQA (Grouped Query Attention)
──────────────────────────        ────────────────────────────      ─────────────────────────────
Q₁ K₁ V₁                         Q₁ \                              Q₁ Q₂ \
Q₂ K₂ V₂                         Q₂  K V  ← 共享                  Q₃ Q₄  K₁ V₁  ← 1 组
Q₃ K₃ V₃                         Q₃ /                              Q₅ Q₆ \
Q₄ K₄ V₄                         Q₄ /                              Q₇ Q₈  K₂ V₂  ← 2 组
(H 个独立的 K,V)                  (1 个共享的 K,V)                  (G 个共享的 K,V)
KV Cache: H × 2 × L × D          KV Cache: 1 × 2 × L × D           KV Cache: G × 2 × L × D
```

| 方案 | KV Cache 大小 | 质量 | 典型应用 |
|------|-------------|------|---------|
| MHA | H × 2 × L × D | 最高 | GPT-3、早期模型 |
| MQA | 1 × 2 × L × D | 略降 | PaLM、Falcon |
| GQA | G × 2 × L × D | 接近 MHA | LLaMA 3、Mistral |

**GQA 的工程意义：** 以 LLaMA 3 70B 为例，H=64 个 Q-head，G=8 个 KV-head，KV Cache 体积减少到 MHA 的 1/8，批处理量大幅提升。

```python
# GQA 前向传播（简化版）
def grouped_query_attention(Q, K, V, num_q_heads, num_kv_heads):
    """
    Q: (batch, seq, num_q_heads, head_dim)
    K: (batch, seq, num_kv_heads, head_dim)
    V: (batch, seq, num_kv_heads, head_dim)
    """
    groups = num_q_heads // num_kv_heads
    # 将 K, V 重复扩展以匹配 Q 的头数
    K = K.repeat_interleave(groups, dim=2)  # (batch, seq, num_q_heads, head_dim)
    V = V.repeat_interleave(groups, dim=2)
    # 标准 Scaled Dot-Product Attention
    scale = Q.shape[-1] ** -0.5
    attn = torch.softmax(torch.einsum('bshd,bthd->bsht', Q, K) * scale, dim=-1)
    return torch.einsum('bsht,bthd->bshd', attn, V)
```

### 2.5 SwiGLU 激活函数

**FFN 从 ReLU 到 SwiGLU 的演进：**

```
原版 FFN（ReLU）:
  FFN(x) = max(0, xW₁ + b₁)W₂ + b₂

GLU（Gated Linear Unit）：
  GLU(x, W, V, b, c) = σ(xW + b) ⊙ (xV + c)

SwiGLU：
  SwiGLU(x, W, V) = Swish(xW) ⊙ (xV)
  Swish(x) = x · σ(x)  （自门控，平滑版 ReLU）
```

**直觉解释：** 门控机制让每个神经元可以学习"什么时候应该传递信息"，类似于 LSTM 中的门，但更轻量。SwiGLU 相比 ReLU 需要多一个权重矩阵（三个矩阵 W₁, W₂, W₃），但在同等参数量下效果更强。

```python
class SwiGLU(nn.Module):
    def __init__(self, dim: int, hidden_dim: int):
        super().__init__()
        self.w1 = nn.Linear(dim, hidden_dim, bias=False)
        self.w2 = nn.Linear(hidden_dim, dim, bias=False)
        self.w3 = nn.Linear(dim, hidden_dim, bias=False)

    def forward(self, x):
        # Swish(xW₁) ⊙ (xW₃)，再通过 W₂ 降维
        return self.w2(F.silu(self.w1(x)) * self.w3(x))
        # F.silu 即 Swish 激活函数
```

---

## 3. HuggingFace Transformers 核心组件

### 3.1 Tokenizer：分词与编码

Tokenizer 是模型的"前处理器"，负责将原始文本转换为 token ID 序列。

```python
from transformers import AutoTokenizer

tokenizer = AutoTokenizer.from_pretrained("meta-llama/Llama-3-8b-hf")

# 基础编码
text = "Hello, 世界！今天天气不错。"
encoding = tokenizer(text, return_tensors="pt")
print(encoding.input_ids)   # tensor([[...]])
print(encoding.attention_mask)  # tensor([[1, 1, 1, ...]])

# 解码回文本
decoded = tokenizer.decode(encoding.input_ids[0], skip_special_tokens=True)

# 批量编码（自动 padding）
batch = tokenizer(
    ["Short text.", "A much longer piece of text that needs padding."],
    padding=True,           # 自动对齐到最长序列
    truncation=True,        # 超过 max_length 时截断
    max_length=512,
    return_tensors="pt"
)
```

**Tokenizer 类型对比：**

| 类型 | 算法 | 代表模型 | 词表大小 |
|------|------|----------|---------|
| BPE | Byte Pair Encoding | GPT-2/4, LLaMA | 32K - 128K |
| WordPiece | 最大似然 BPE 变体 | BERT, RoBERTa | 30K |
| SentencePiece | 无监督分词 | T5, Gemma | 32K |
| Unigram | 语言模型采样 | mT5, XLNet | 可变 |

### 3.2 Model：模型加载与前向传播

```python
from transformers import AutoModelForCausalLM
import torch

# 加载模型（自动检测架构）
model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-3-8b-hf",
    torch_dtype=torch.bfloat16,    # 使用 BF16 减少显存
    device_map="auto",             # 自动分配到可用 GPU
    attn_implementation="flash_attention_2",  # 启用 FlashAttention
)

# 前向传播（计算 logits）
with torch.no_grad():
    outputs = model(
        input_ids=batch["input_ids"],
        attention_mask=batch["attention_mask"],
        output_hidden_states=True,   # 返回每层的隐藏状态
        output_attentions=False,
    )

logits = outputs.logits              # (batch, seq_len, vocab_size)
last_hidden = outputs.hidden_states[-1]  # 最后一层的表示

# 查看模型结构
print(model.config)
print(f"参数量: {sum(p.numel() for p in model.parameters()) / 1e9:.1f}B")
```

### 3.3 Pipeline：一行代码运行模型

```python
from transformers import pipeline

# 文本生成
generator = pipeline(
    "text-generation",
    model="meta-llama/Llama-3-8b-instruct",
    torch_dtype=torch.bfloat16,
    device_map="auto",
)

result = generator(
    "介绍一下 Transformer 架构：",
    max_new_tokens=200,
    temperature=0.7,
    do_sample=True,
)
print(result[0]["generated_text"])

# 其他常用 pipeline 任务
# pipeline("feature-extraction")   # 提取嵌入向量
# pipeline("text-classification")  # 情感分类
# pipeline("token-classification") # 命名实体识别
# pipeline("question-answering")   # 问答
# pipeline("summarization")        # 摘要
```

**注意事项：** `pipeline` 是便捷封装，内部默认设置可能不适合所有场景：
- `truncation=True` 默认开启，长输入会被静默截断
- 批处理时 padding 策略影响推理速度
- 生产环境建议直接使用底层 `model.generate()`

### 3.4 Trainer：训练封装

```python
from transformers import Trainer, TrainingArguments

training_args = TrainingArguments(
    output_dir="./results",
    num_train_epochs=3,
    per_device_train_batch_size=4,
    per_device_eval_batch_size=8,
    gradient_accumulation_steps=4,   # 等效 batch_size = 4 * 4 = 16
    warmup_steps=500,
    weight_decay=0.01,
    logging_dir="./logs",
    logging_steps=10,
    evaluation_strategy="epoch",
    save_strategy="epoch",
    load_best_model_at_end=True,
    fp16=True,                        # 混合精度训练
    dataloader_num_workers=4,
    report_to="wandb",                # 集成 W&B 监控
)

trainer = Trainer(
    model=model,
    args=training_args,
    train_dataset=train_dataset,
    eval_dataset=eval_dataset,
    tokenizer=tokenizer,
    compute_metrics=compute_metrics,  # 自定义评估指标函数
)

trainer.train()
trainer.save_model("./final-model")
```

### 3.5 generate() 方法与解码策略

`generate()` 是 LLM 推理的核心，支持多种解码策略：

```python
# 贪婪解码（Greedy）：每步选最高概率的 token
outputs = model.generate(input_ids, max_new_tokens=100)

# 束搜索（Beam Search）：维护 k 条候选路径
outputs = model.generate(
    input_ids,
    num_beams=4,
    early_stopping=True,
    no_repeat_ngram_size=3,   # 防止重复 3-gram
)

# 采样（Sampling）：按概率分布随机采样
outputs = model.generate(
    input_ids,
    do_sample=True,
    temperature=0.7,          # < 1 更集中，> 1 更随机
    top_p=0.9,                # Nucleus Sampling：累积概率阈值
    top_k=50,                 # 只从概率最高的 k 个 token 中采样
    repetition_penalty=1.1,   # 惩罚重复 token
)

# 流式生成（Streaming）
from transformers import TextStreamer
streamer = TextStreamer(tokenizer, skip_special_tokens=True)
model.generate(input_ids, streamer=streamer, max_new_tokens=200)
```

**解码策略对比：**

| 策略 | 速度 | 多样性 | 一致性 | 适用场景 |
|------|------|--------|--------|---------|
| Greedy | 最快 | 低 | 高 | 翻译、摘要 |
| Beam Search | 慢 | 低 | 最高 | 机器翻译 |
| Top-k Sampling | 快 | 中 | 中 | 对话、创意写作 |
| Top-p (Nucleus) | 快 | 高 | 中 | 通用生成 |
| Temperature + Top-p | 快 | 可调 | 可调 | 最常用组合 |

---

## 4. 推理优化技术

### 4.1 KV Cache 原理与实现

#### 为什么需要 KV Cache？

自回归生成时，每生成一个新 token，都需要对所有历史 token 重新计算 Attention，复杂度为 O(n²)。KV Cache 通过缓存历史 token 的 K 和 V 矩阵，避免重复计算。

#### ASCII 图解：有无 KV Cache 的对比

```
【无 KV Cache 时】生成第 4 个 token：
输入: [T1, T2, T3]
──────────────────────────────────────────────
Step 1: T1 → Q₁,K₁,V₁
Step 2: T2 → Q₂,K₂,V₂
Step 3: T3 → Q₃,K₃,V₃
计算 Attention(Q₃, [K₁,K₂,K₃], [V₁,V₂,V₃]) → 输出 T4
↑ 每次都重新计算 K₁,V₁ 和 K₂,V₂！

【有 KV Cache 时】：
Prefill 阶段（一次性处理所有输入 token）：
输入: [T1, T2, T3]
同时计算:
  K_cache = [K₁, K₂, K₃]  ← 存入缓存
  V_cache = [V₁, V₂, V₃]  ← 存入缓存
  输出 T4

Decode 阶段（逐 token 生成）：
输入: T4（新 token）
计算: Q₄
K_cache = [K₁, K₂, K₃, K₄]  ← 追加 K₄
V_cache = [V₁, V₂, V₃, V₄]  ← 追加 V₄
Attention(Q₄, K_cache, V_cache) → 输出 T5
↑ 只需计算新 token 的 Q₄,K₄,V₄！

KV Cache 内存占用 = 2 × num_layers × num_kv_heads × seq_len × head_dim × dtype_bytes
以 LLaMA 3 8B (BF16) 为例：
  2 × 32层 × 8头 × 4096序列 × 128维 × 2字节 ≈ 4 GB（满序列）
```

```python
# HuggingFace 中 KV Cache 的使用
from transformers import DynamicCache

# 手动管理 KV Cache（适用于自定义推理循环）
past_key_values = DynamicCache()

for step in range(max_new_tokens):
    outputs = model(
        input_ids=new_token.unsqueeze(0),
        past_key_values=past_key_values,
        use_cache=True,
    )
    past_key_values = outputs.past_key_values  # 更新缓存
    next_token = outputs.logits[:, -1, :].argmax(dim=-1)
    new_token = next_token
```

### 4.2 量化（INT8/INT4/GPTQ/AWQ）

量化是将模型权重从高精度（FP32/BF16）压缩到低精度（INT8/INT4）的过程，以牺牲少量精度换取大幅内存节省和推理加速。

#### 量化精度对比

| 精度 | 位宽 | 内存（7B模型） | 精度损失 | 推理速度 | 推荐场景 |
|------|------|------------|--------|---------|---------|
| FP32 | 32 bit | ~28 GB | 无（基准） | 1x | 研究/调试 |
| BF16 | 16 bit | ~14 GB | 极小 | ~2x | 训练/高质量推理 |
| INT8 | 8 bit | ~7 GB | 小（<1%） | ~2-3x | 生产推理 |
| INT4 | 4 bit | ~3.5 GB | 中（1-3%） | ~3-4x | 内存受限场景 |
| INT4 GPTQ | 4 bit | ~3.5 GB | 小（经校准） | ~3-4x | 高质量 INT4 |
| INT4 AWQ | 4 bit | ~3.5 GB | 极小 | ~3-4x | 最佳 INT4 方案 |

#### 量化方法详解

**LLM.int8()（bitsandbytes）：** 混合精度——检测到离群值（outlier）的维度用 FP16，其余用 INT8。

```python
from transformers import BitsAndBytesConfig

# INT8 量化
config_int8 = BitsAndBytesConfig(load_in_8bit=True)

# INT4（NF4 数据类型，用于 QLoRA）
config_int4 = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",        # NormalFloat4，针对正态分布优化
    bnb_4bit_use_double_quant=True,   # 双重量化进一步节省内存
    bnb_4bit_compute_dtype=torch.bfloat16,
)

model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-3-8b-hf",
    quantization_config=config_int4,
    device_map="auto",
)
```

**GPTQ（Post-Training Quantization）：** 使用少量校准数据（128条样本），通过二阶优化（Hessian 矩阵）最小化量化误差。比 bitsandbytes 精度更高，推理速度更快，但需要提前量化（离线）。

**AWQ（Activation-aware Weight Quantization）：** 关键洞见：权重不是均等重要的，对应高激活值的权重通道应该用更高精度保存（或等效的缩放）。AWQ 通过保护约 1% 的显著权重通道，在 INT4 下达到接近 FP16 的效果。

```python
# 使用 AutoAWQ 加载已量化模型
from awq import AutoAWQForCausalLM

model = AutoAWQForCausalLM.from_quantized(
    "TheBloke/Llama-3-8B-AWQ",
    fuse_layers=True,     # 融合算子进一步加速
)
```

### 4.3 投机解码（Speculative Decoding）

#### 核心思想

**类比：** 你让一位实习生（小模型）起草文件，然后你（大模型）快速审阅并批准/修改。比你从头写要快得多。

投机解码使用一个小的"草稿模型"（Draft Model）快速生成多个候选 token，然后用大的"目标模型"（Target Model）一次并行验证所有候选，接受正确的，拒绝错误的（并在第一个错误处重新采样）。

```
Draft Model 快速生成草稿（5 个 token）：
  [T1] → [T1, T2_d, T3_d, T4_d, T5_d, T6_d]
            ↑ 草稿 token（draft）

Target Model 并行验证（1 次前向传播）：
  输入: [T1, T2_d, T3_d, T4_d, T5_d, T6_d]
  获得: P_target(T2|T1), P_target(T3|T1:2), ...

接受/拒绝（按比例接受算法）：
  T2_d: 接受 ✓（target 同意）
  T3_d: 接受 ✓（target 同意）
  T4_d: 拒绝 ✗（target 不同意）→ 从 target 分布重新采样 T4
  停止，得到 [T2, T3, T4]（3 个 token，只需 1 次 target 前向传播）
```

**加速比：** 若草稿接受率 α，草稿长度 γ，加速比约为 `(1 - α^(γ+1)) / ((1-α) × (1 + cost_ratio))`。实践中，以 LLaMA 7B 为草稿、LLaMA 70B 为目标，可获得 2-3x 加速。

```python
# 使用 HuggingFace 内置投机解码
from transformers import AutoModelForCausalLM

draft_model = AutoModelForCausalLM.from_pretrained("meta-llama/Llama-3-8b-hf")
target_model = AutoModelForCausalLM.from_pretrained("meta-llama/Llama-3-70b-hf")

outputs = target_model.generate(
    input_ids,
    assistant_model=draft_model,   # 指定草稿模型
    max_new_tokens=200,
)
```

### 4.4 连续批处理（Continuous Batching）

#### 传统静态批处理的问题

```
传统静态批处理（等待全部完成）：
时间 →  0   1   2   3   4   5   6   7
请求A: [■■■■■■■■■■■■■■■■]              ← 长请求，占据 slot
请求B:     [■■■■]                      ← 短请求，早完成但 slot 仍占用
请求C:              [■■■■■■■■]
请求D: 等待...等待...等待...→ 高延迟！  ← 排队等待 A 完成
```

```
连续批处理（Continuous Batching / Iteration-level Scheduling）：
时间 →  0   1   2   3   4   5   6   7
Slot1: [A  A  A  A  A  A  D  D  D]  ← A 完成后立即插入 D
Slot2: [B  B  C  C  C  C  C  E  E]  ← B 完成后立即插入 C
↑ GPU 始终满负载运行，显著提高吞吐量
```

连续批处理是 vLLM、TGI 等推理框架的核心技术，可将 GPU 利用率从约 30% 提升到接近 100%。

### 4.5 FlashAttention

#### 标准 Attention 的内存瓶颈

标准 Attention 计算 `Softmax(QKᵀ/√d)V` 需要将 (seq_len × seq_len) 的注意力矩阵写入 HBM（高带宽显存），对于 seq_len=4096，这是一个 64M 的矩阵——**IO 访问是瓶颈，不是计算。**

#### FlashAttention 的解决方案

FlashAttention 使用**分块（Tiling）**技术：将 Q, K, V 分成小块加载到 SRAM（片上快速缓存），在 SRAM 内完成计算，避免频繁读写 HBM。

```
标准 Attention 的内存访问模式：
HBM → Q,K,V → SRAM
SRAM 计算 QKᵀ → HBM（存注意力矩阵）
HBM 读注意力矩阵 → SRAM
SRAM 计算 Softmax → HBM
HBM 读回 → SRAM 计算 × V → HBM
总 IO：O(N²) 次 HBM 访问

FlashAttention 的内存访问模式：
HBM → Q_block, K_block, V_block → SRAM（分块）
SRAM 内: 计算局部 QKᵀ，Online Softmax，累积 Output
循环所有块后直接输出最终结果
总 IO：O(N) 次 HBM 访问（提升 5-20x IO 效率）
```

| 特性 | 标准 Attention | FlashAttention v1 | FlashAttention v2 |
|------|-------------|-----------------|-----------------|
| 内存复杂度 | O(N²) | O(N) | O(N) |
| 速度提升 | 基准 | ~3x | ~6x |
| 支持反向传播 | 是 | 是（重计算） | 是（优化） |
| 因果掩码 | 是 | 是 | 是 |
| 序列并行 | 否 | 否 | 是 |

---

## 5. 实战示例

### 5.1 加载并运行 LLaMA 模型

```python
import torch
from transformers import AutoTokenizer, AutoModelForCausalLM

def load_llama(model_name: str = "meta-llama/Llama-3-8b-instruct"):
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    # 确保有 pad_token（LLaMA 默认无）
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        model_name,
        torch_dtype=torch.bfloat16,
        device_map="auto",
        attn_implementation="flash_attention_2",
    )
    model.eval()
    return tokenizer, model


def chat(tokenizer, model, messages: list[dict], max_new_tokens: int = 512):
    """支持 ChatML 格式的多轮对话"""
    # 使用模型专属的聊天模板
    prompt = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
    )
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

    with torch.no_grad():
        output_ids = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=True,
            temperature=0.7,
            top_p=0.9,
            repetition_penalty=1.05,
            pad_token_id=tokenizer.pad_token_id,
        )

    # 只解码新生成的部分
    new_tokens = output_ids[0][inputs["input_ids"].shape[1]:]
    return tokenizer.decode(new_tokens, skip_special_tokens=True)


# 使用示例
tokenizer, model = load_llama()
response = chat(tokenizer, model, [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "解释一下 RoPE 位置编码的原理"},
])
print(response)
```

### 5.2 自定义 Tokenizer

```python
from tokenizers import Tokenizer, models, trainers, pre_tokenizers
from transformers import PreTrainedTokenizerFast

# 从头训练一个 BPE Tokenizer
def train_bpe_tokenizer(corpus_files: list[str], vocab_size: int = 32000):
    tokenizer = Tokenizer(models.BPE(unk_token="<unk>"))
    tokenizer.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)

    trainer = trainers.BpeTrainer(
        vocab_size=vocab_size,
        special_tokens=["<unk>", "<s>", "</s>", "<pad>"],
        min_frequency=2,
    )
    tokenizer.train(corpus_files, trainer)

    # 包装为 HuggingFace 兼容格式
    hf_tokenizer = PreTrainedTokenizerFast(
        tokenizer_object=tokenizer,
        bos_token="<s>",
        eos_token="</s>",
        unk_token="<unk>",
        pad_token="<pad>",
    )
    return hf_tokenizer


# 扩展现有 Tokenizer（添加领域词汇）
def extend_tokenizer(base_tokenizer_name: str, new_tokens: list[str]):
    tokenizer = AutoTokenizer.from_pretrained(base_tokenizer_name)
    num_added = tokenizer.add_tokens(new_tokens)
    print(f"添加了 {num_added} 个新 token")
    # 注意：需要同步扩展模型的 Embedding 层
    # model.resize_token_embeddings(len(tokenizer))
    return tokenizer
```

### 5.3 性能基准测试

```python
import time
import torch
from dataclasses import dataclass

@dataclass
class BenchmarkResult:
    prefill_latency_ms: float    # 首 token 延迟
    decode_throughput_tps: float  # 生成速度（tokens/sec）
    total_memory_gb: float        # 显存占用
    tokens_generated: int

def benchmark_inference(
    model,
    tokenizer,
    prompt: str,
    max_new_tokens: int = 100,
    num_warmup: int = 2,
    num_runs: int = 5,
) -> BenchmarkResult:
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    input_len = inputs["input_ids"].shape[1]

    # 预热（避免 CUDA 初始化影响计时）
    for _ in range(num_warmup):
        with torch.no_grad():
            model.generate(**inputs, max_new_tokens=10)

    torch.cuda.synchronize()

    # 正式计时
    latencies = []
    for _ in range(num_runs):
        start = time.perf_counter()
        with torch.no_grad():
            output = model.generate(**inputs, max_new_tokens=max_new_tokens)
        torch.cuda.synchronize()
        end = time.perf_counter()
        latencies.append(end - start)

    avg_latency = sum(latencies) / len(latencies)
    tokens_gen = output.shape[1] - input_len
    memory_gb = torch.cuda.max_memory_allocated() / 1e9

    return BenchmarkResult(
        prefill_latency_ms=avg_latency * 1000 / tokens_gen,  # 近似
        decode_throughput_tps=tokens_gen / avg_latency,
        total_memory_gb=memory_gb,
        tokens_generated=tokens_gen,
    )

# 运行基准测试
result = benchmark_inference(model, tokenizer, "Explain the Transformer architecture:")
print(f"首 token 延迟:  {result.prefill_latency_ms:.1f} ms")
print(f"生成吞吐量:     {result.decode_throughput_tps:.1f} tokens/s")
print(f"显存占用:       {result.total_memory_gb:.2f} GB")
```

---

## 6. 最佳实践

| 场景 | 推荐配置 | 原因 |
|------|---------|------|
| 单卡推理（24GB） | BF16 + FlashAttention2 | 平衡速度与精度 |
| 单卡推理（16GB） | INT4 AWQ + FlashAttention2 | 内存受限 |
| 多卡推理（生产） | vLLM + Continuous Batching | 最高吞吐量 |
| 微调（24GB） | QLoRA（NF4）+ Gradient Checkpointing | 最低内存需求 |
| 长上下文推理 | FlashAttention2 + KV Cache 量化 | O(N²) 内存控制 |
| 延迟敏感场景 | Speculative Decoding + CUDA Graph | 最低 TTFT |

**实践建议：**

1. **永远先测量再优化**：用 `torch.profiler` 找出真正的瓶颈，不要盲目量化
2. **BF16 优于 FP16**：BF16 数值范围更大，在 Ampere+ 架构上同速
3. **KV Cache 是最大的内存消耗**：生产环境用 PagedAttention（vLLM）管理碎片化
4. **batch_size=1 时 Speculative Decoding 效果最好**：大 batch 时 Draft-Target 调度复杂度上升
5. **量化前要做好评测**：在目标数据集上评测 perplexity 和任务指标，确保量化误差可接受

---

## 7. 常见问题

**Q: `device_map="auto"` 会把模型放在哪里？**

A: HuggingFace 会根据可用 GPU 显存自动分配层，优先填满 GPU，再溢出到 CPU 甚至磁盘。使用 `infer_auto_device_map()` 可以手动查看分配方案。CPU 分配会极大降低推理速度，应尽量避免。

**Q: 为什么 LLaMA 没有 bias 参数？**

A: LLaMA 的所有线性层均设置 `bias=False`。研究表明在大规模预训练中 bias 对性能几乎无影响，去掉后可略微减少参数量和计算，且与 RMSNorm 配合使用时更稳定（RMSNorm 已有可学习的缩放参数）。

**Q: attention_mask 在生成时是否必要？**

A: 单请求推理时不必要（自回归生成不需要 padding），批推理时必须提供，否则 padding token 会影响注意力计算。建议始终传入 `attention_mask`。

**Q: `torch.compile()` 能加速 Transformer 推理吗？**

A: 对于固定输入 shape 有效（可提升 20-50%），但动态 shape（每步 seq_len 变化的自回归生成）需要配合 `torch.compile(dynamic=True)` 或 CUDA Graph，配置复杂。生产环境推荐直接使用 vLLM 或 TensorRT-LLM。

**Q: FlashAttention 和 SDPA（scaled_dot_product_attention）有什么关系？**

A: PyTorch 2.0+ 的 `F.scaled_dot_product_attention` 会自动选择最优内核：在有 FlashAttention 的情况下使用 FlashAttention，否则回退到标准实现。`attn_implementation="sdpa"` 是更安全的选择，而 `attn_implementation="flash_attention_2"` 则强制使用 FlashAttention2。

---

## 导航

- ← [技术资料总目录](../README.md)
- ↔ [对应面试题](../../02-面试指南/07-AI-Agent全栈开发面试/11-Transformers与模型架构面试题.md)
