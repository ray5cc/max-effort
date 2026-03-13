# 11-Transformers与模型架构 — 技术资料

> 深入解析 HuggingFace Transformers 库的核心组件（模型加载、Pipeline、Tokenizer、Trainer），以及 Meta LLaMA 系列模型的创新架构（RMSNorm、RoPE 旋转位置编码、GQA 分组查询注意力），提供可运行的代码示例和性能优化技巧。

## 目录

- [1. 概述](#1-概述)
- [2. HuggingFace Transformers 核心组件](#2-huggingface-transformers-核心组件)
  - [2.1 Tokenizer 分词器](#21-tokenizer-分词器)
  - [2.2 模型加载与配置](#22-模型加载与配置)
  - [2.3 Pipeline 高层接口](#23-pipeline-高层接口)
  - [2.4 Trainer 训练框架](#24-trainer-训练框架)
- [3. LLaMA 模型架构详解](#3-llama-模型架构详解)
  - [3.1 整体架构](#31-整体架构)
  - [3.2 RMSNorm：更高效的归一化](#32-rmsnorm更高效的归一化)
  - [3.3 RoPE：旋转位置编码](#33-rope旋转位置编码)
  - [3.4 GQA：分组查询注意力](#34-gqa分组查询注意力)
  - [3.5 SwiGLU 激活函数](#35-swiglu-激活函数)
- [4. 注意力机制深度解析](#4-注意力机制深度解析)
- [5. 推理优化技术](#5-推理优化技术)
- [6. 实战示例](#6-实战示例)
- [7. 性能调优最佳实践](#7-性能调优最佳实践)
- [导航](#导航)

---

## 1. 概述

### 1.1 Transformer 架构的地位

自 2017 年 Google 发表《Attention Is All You Need》以来，Transformer 架构已成为 NLP 领域的事实标准：

```
Transformer 演进路线

BERT（2018）─── 双向编码器，理解任务
GPT-2/3（2019/2020）─── 单向解码器，生成任务
T5（2019）─── 编码器-解码器，通用框架
LLaMA（2023）─── 高效解码器，开源里程碑
LLaMA 2/3（2023/2024）─── RLHF 对齐，多模态
```

### 1.2 HuggingFace Transformers 的价值

HuggingFace Transformers 是连接学术研究与工程实践的桥梁：
- **统一接口**：100+ 种模型架构共享相同 API
- **Hub 生态**：50 万+ 预训练模型一键下载
- **工具完整**：从数据集处理到训练评估全链路

---

## 2. HuggingFace Transformers 核心组件

> 项目参考：[huggingface/transformers](https://github.com/huggingface/transformers)

### 2.1 Tokenizer 分词器

**Tokenizer 的核心职责**：将原始文本转换为模型可处理的 Token ID 序列。

#### 常见分词算法

| 算法 | 代表模型 | 特点 |
|------|---------|------|
| BPE（Byte Pair Encoding） | GPT 系列、LLaMA | 按频率合并字节对 |
| WordPiece | BERT、RoBERTa | 最大化语言模型似然 |
| SentencePiece | T5、LLaMA 3 | 不依赖预分词，语言无关 |
| Tiktoken | GPT-4、GPT-3.5 | BPE 的高效 Rust 实现 |

#### 关键代码示例

```python
from transformers import AutoTokenizer

# 加载 LLaMA 3 Tokenizer
tokenizer = AutoTokenizer.from_pretrained("meta-llama/Meta-Llama-3-8B")

# 基础使用
text = "Hello, 你好！LLaMA is awesome."
tokens = tokenizer.tokenize(text)
print(tokens)
# ['Hello', ',', 'Ġ你好', '！', 'ĠLL', 'aMA', 'Ġis', 'Ġawesome', '.']

# 编码（文本 → Token IDs）
encoding = tokenizer(
    text,
    padding=True,
    truncation=True,
    max_length=512,
    return_tensors="pt"  # 返回 PyTorch Tensor
)
print(encoding.input_ids)   # tensor([[128000, 9906, ...]])
print(encoding.attention_mask)  # tensor([[1, 1, ...]])

# 批量编码（对话格式）
messages = [
    {"role": "system", "content": "你是一个帮助用户的 AI 助手。"},
    {"role": "user", "content": "什么是机器学习？"},
]
# apply_chat_template 将对话格式化为模型期望的特殊 Token 格式
formatted = tokenizer.apply_chat_template(
    messages,
    tokenize=False,
    add_generation_prompt=True
)
# 输出：<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n你是一个...<|eot_id|>...

# 解码（Token IDs → 文本）
ids = [9906, 11, 220]
decoded = tokenizer.decode(ids, skip_special_tokens=True)
print(decoded)  # "Hello,"
```

#### Tokenizer 的特殊 Token

不同模型有不同的特殊 Token，理解它们对于正确使用模型至关重要：

```
LLaMA 3 特殊 Token：
<|begin_of_text|>   → BOS（句子开始）
<|end_of_text|>     → EOS（句子结束）
<|start_header_id|> → 角色标签开始
<|end_header_id|>   → 角色标签结束
<|eot_id|>          → 轮次结束（End of Turn）

BERT 特殊 Token：
[CLS]  → 分类标记（捕获全局语义）
[SEP]  → 句子分隔符
[MASK] → 遮蔽标记（MLM 训练用）
[PAD]  → 填充标记
```

---

### 2.2 模型加载与配置

```python
from transformers import AutoModelForCausalLM, AutoConfig
import torch

# 方式一：自动推断模型类
model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Meta-Llama-3-8B-Instruct",
    torch_dtype=torch.bfloat16,   # 使用 BF16 降低显存（推理不影响质量）
    device_map="auto",            # 自动分配到可用 GPU/CPU
    attn_implementation="flash_attention_2",  # 使用 Flash Attention 加速
)

# 方式二：先查看配置
config = AutoConfig.from_pretrained("meta-llama/Meta-Llama-3-8B")
print(config)
# LlamaConfig {
#   "hidden_size": 4096,           # 隐层维度
#   "intermediate_size": 14336,    # FFN 中间层维度
#   "num_attention_heads": 32,     # 注意力头数
#   "num_hidden_layers": 32,       # Transformer 层数
#   "num_key_value_heads": 8,      # KV 头数（GQA：8个KV头，32个Q头）
#   "max_position_embeddings": 8192,
#   "vocab_size": 128256,
# }

# 模型参数统计
total_params = sum(p.numel() for p in model.parameters())
trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
print(f"总参数: {total_params / 1e9:.2f}B")  # 8.03B

# 文本生成
input_ids = tokenizer.encode("Python 的优势是", return_tensors="pt").to("cuda")

with torch.no_grad():
    output = model.generate(
        input_ids,
        max_new_tokens=200,
        temperature=0.7,          # 多样性（0=贪心，越大越随机）
        top_p=0.9,                # 核采样（只考虑概率累积到 90% 的 Token）
        top_k=50,                 # 只考虑前 50 个 Token
        do_sample=True,           # 启用采样（否则为贪心解码）
        repetition_penalty=1.1,   # 重复惩罚
    )

generated_text = tokenizer.decode(output[0], skip_special_tokens=True)
```

---

### 2.3 Pipeline 高层接口

`pipeline` 是 Transformers 提供的最高层接口，适合快速原型开发：

```python
from transformers import pipeline

# 文本生成 Pipeline
generator = pipeline(
    "text-generation",
    model="meta-llama/Meta-Llama-3-8B-Instruct",
    device_map="auto",
    torch_dtype="auto",
)

result = generator(
    [{"role": "user", "content": "解释什么是注意力机制"}],
    max_new_tokens=500,
    do_sample=True,
)
print(result[0]["generated_text"][-1]["content"])

# 常用 Pipeline 类型
pipelines = {
    "text-generation":        "文本续写/对话",
    "text-classification":    "情感分析/分类",
    "token-classification":   "命名实体识别（NER）",
    "question-answering":     "阅读理解",
    "summarization":          "文本摘要",
    "translation":            "机器翻译",
    "feature-extraction":     "获取文本向量表示",
    "zero-shot-classification":"零样本分类",
    "image-to-text":          "图像描述",
    "automatic-speech-recognition": "语音识别（ASR）",
}
```

---

### 2.4 Trainer 训练框架

`Trainer` 封装了训练循环、分布式训练、混合精度等工程细节：

```python
from transformers import Trainer, TrainingArguments, DataCollatorForSeq2Seq

# 训练参数配置
training_args = TrainingArguments(
    output_dir="./results",
    
    # 训练超参数
    num_train_epochs=3,
    per_device_train_batch_size=4,
    gradient_accumulation_steps=4,    # 有效 batch_size = 16
    learning_rate=2e-5,
    weight_decay=0.01,
    warmup_ratio=0.1,
    lr_scheduler_type="cosine",       # 余弦学习率调度
    
    # 精度与效率
    fp16=False,
    bf16=True,                        # BF16 更稳定（推荐 Ampere+ GPU）
    gradient_checkpointing=True,      # 用计算换显存
    optim="adamw_torch_fused",        # 融合 AdamW（更快）
    
    # 评估与保存
    eval_strategy="steps",
    eval_steps=500,
    save_strategy="steps",
    save_steps=500,
    load_best_model_at_end=True,
    
    # 日志
    logging_steps=10,
    report_to=["tensorboard", "wandb"],
    
    # 分布式训练（多 GPU）
    dataloader_num_workers=4,
    ddp_find_unused_parameters=False,
)

trainer = Trainer(
    model=model,
    args=training_args,
    train_dataset=train_dataset,
    eval_dataset=eval_dataset,
    tokenizer=tokenizer,
    data_collator=DataCollatorForSeq2Seq(tokenizer, pad_to_multiple_of=8),
)

# 启动训练
trainer.train()

# 保存模型
trainer.save_model("./final_model")
tokenizer.save_pretrained("./final_model")
```

---

## 3. LLaMA 模型架构详解

> 项目参考：[meta-llama/llama](https://github.com/meta-llama/llama) / [meta-llama/llama3](https://github.com/meta-llama/llama3)

### 3.1 整体架构

LLaMA 是一个纯解码器（Decoder-Only）的自回归语言模型，相比原始 Transformer 做了多项改进：

```
LLaMA 模型结构（32 层 × 4096 维，以 LLaMA 3-8B 为例）

输入 Token IDs
        │
┌───────▼──────────────────────────────────────┐
│              Token Embedding                 │
│         vocab_size=128256 → hidden=4096       │
└───────────────────────┬──────────────────────┘
                        │
              ┌─────────┤  × 32 层
              │         │
┌─────────────▼─────────────────────────────────┐
│           Transformer Block                   │
│                                               │
│  ┌─────────────────────────────────────────┐  │
│  │       RMSNorm（Pre-Norm）               │  │
│  └──────────────────┬──────────────────────┘  │
│                     │                         │
│  ┌──────────────────▼──────────────────────┐  │
│  │    GQA（分组查询注意力）                  │  │
│  │  Q_heads=32, KV_heads=8, dim=128        │  │
│  │  + RoPE 旋转位置编码                     │  │
│  └──────────────────┬──────────────────────┘  │
│                     │ + 残差连接              │
│  ┌──────────────────▼──────────────────────┐  │
│  │       RMSNorm（Pre-Norm）               │  │
│  └──────────────────┬──────────────────────┘  │
│                     │                         │
│  ┌──────────────────▼──────────────────────┐  │
│  │      SwiGLU FFN（前馈网络）              │  │
│  │  hidden=4096 → intermediate=14336 → 4096│  │
│  └──────────────────┬──────────────────────┘  │
│                     │ + 残差连接              │
└─────────────────────┼─────────────────────────┘
                      │
┌─────────────────────▼──────────────────────────┐
│           最终 RMSNorm + LM Head               │
│           hidden=4096 → vocab=128256            │
└────────────────────────────────────────────────┘
```

---

### 3.2 RMSNorm：更高效的归一化

原始 Transformer 使用 **LayerNorm**，LLaMA 改用 **RMSNorm（Root Mean Square Normalization）**。

**LayerNorm 计算：**
```
y = (x - mean(x)) / sqrt(var(x) + ε) × γ + β
```
需要计算均值和方差，有 `γ` 和 `β` 两组参数。

**RMSNorm 计算：**
```
RMS(x) = sqrt(mean(x²) + ε)
y = (x / RMS(x)) × γ
```
去掉了均值计算（"重中心化"步骤），只保留缩放，参数量减半。

**优势：**
- 计算量减少约 40%（无需计算均值）
- 效果与 LayerNorm 相当甚至更好

```python
import torch
import torch.nn as nn

class RMSNorm(nn.Module):
    def __init__(self, dim: int, eps: float = 1e-6):
        super().__init__()
        self.eps = eps
        self.weight = nn.Parameter(torch.ones(dim))   # γ 参数
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # 计算 RMS
        rms = torch.sqrt(x.pow(2).mean(dim=-1, keepdim=True) + self.eps)
        # 归一化 + 缩放
        return x / rms * self.weight

# 对比参数量
layer_norm = nn.LayerNorm(4096)  # 4096 × 2 = 8192 参数
rms_norm = RMSNorm(4096)         # 4096 × 1 = 4096 参数（节省 50%）
```

---

### 3.3 RoPE：旋转位置编码

传统 Transformer 使用**绝对位置编码**（固定正弦波），LLaMA 使用 **RoPE（Rotary Position Embedding）**。

#### 核心思想

RoPE 将位置信息编码为**旋转矩阵**，使注意力分数自然包含相对位置信息：

```
传统方法：在输入加上位置向量 x + PE(pos)
RoPE：对 Q、K 向量按位置进行旋转变换

q' = R(pos_q) × q
k' = R(pos_k) × k

注意力分数：
q' · k' = (R(pos_q) × q)ᵀ × (R(pos_k) × k)
        = qᵀ × R(pos_q - pos_k)ᵀ × k
        ← 只依赖相对位置差 (pos_q - pos_k)！
```

**旋转矩阵（2维示意）：**
```
R(θ) = [cos(θ)  -sin(θ)]
        [sin(θ)   cos(θ)]
```

对于 d 维向量，将维度两两分组，每组独立旋转：

```python
def apply_rotary_emb(x: torch.Tensor, freqs_cis: torch.Tensor) -> torch.Tensor:
    """应用旋转位置编码（来自 LLaMA 源码）"""
    # x: [batch, seq_len, n_heads, head_dim]
    # 将最后一维两两配对，视为复数
    x_complex = torch.view_as_complex(x.float().reshape(*x.shape[:-1], -1, 2))
    # 乘以旋转因子（复数乘法 = 旋转）
    freqs_cis = freqs_cis.unsqueeze(0).unsqueeze(2)  # 广播维度
    x_rotated = x_complex * freqs_cis
    # 还原为实数
    return torch.view_as_real(x_rotated).flatten(-2).to(x.dtype)

def precompute_freqs_cis(dim: int, end: int, theta: float = 10000.0):
    """预计算旋转频率（只需计算一次）"""
    freqs = 1.0 / (theta ** (torch.arange(0, dim, 2).float() / dim))
    t = torch.arange(end)  # 位置序号
    freqs_2d = torch.outer(t, freqs)  # [seq_len, dim/2]
    return torch.polar(torch.ones_like(freqs_2d), freqs_2d)  # 复数表示
```

**RoPE 的优势：**

| 特性 | 绝对位置编码 | RoPE |
|------|-----------|------|
| 长度外推 | 难（超出训练长度效果差） | 好（通过调整 theta 实现） |
| 相对位置建模 | 间接 | 天然支持 |
| 计算开销 | 低（直接相加） | 低（已预计算） |
| 参数量 | 有（位置嵌入矩阵）| 无（纯计算，无参数） |

---

### 3.4 GQA：分组查询注意力

**标准 MHA（Multi-Head Attention）** 的问题：
- 推理时需要缓存所有层的 K、V（即 KV Cache）
- KV Cache 大小 = `2 × layers × heads × seq_len × head_dim × dtype_size`
- 对于 70B 模型，16K 上下文的 KV Cache 就需要约 80GB

**GQA（Grouped Query Attention）** 的解决方案：
- 将 Q 头分为若干组，每组共享一组 K、V
- LLaMA 3-8B：32 个 Q 头，8 个 KV 头（4:1 分组）
- KV Cache 减少 **75%**，速度大幅提升

```
MHA（标准）：
Q1 Q2 Q3 Q4 Q5 Q6 Q7 Q8  ← 8个Q头
K1 K2 K3 K4 K5 K6 K7 K8  ← 8个K头（与Q一一对应）
V1 V2 V3 V4 V5 V6 V7 V8  ← 8个V头

MQA（多查询注意力，极端情况）：
Q1 Q2 Q3 Q4 Q5 Q6 Q7 Q8  ← 8个Q头
K1                         ← 只有1个K头（所有Q共享）
V1                         ← 只有1个V头

GQA（分组查询注意力，LLaMA 3-8B 实际采用）：
Q1 Q2 Q3 Q4 | Q5 Q6 Q7 Q8  ← 8个Q头，分2组
K1          | K2             ← 2个K头（每组4个Q共享1个K）
V1          | V2             ← 2个V头
```

```python
import torch
import torch.nn as nn
import torch.nn.functional as F

class GroupedQueryAttention(nn.Module):
    def __init__(self, hidden_size: int, num_q_heads: int, num_kv_heads: int):
        super().__init__()
        self.num_q_heads = num_q_heads
        self.num_kv_heads = num_kv_heads
        self.groups = num_q_heads // num_kv_heads    # 每组 Q 头数
        self.head_dim = hidden_size // num_q_heads
        
        self.q_proj = nn.Linear(hidden_size, hidden_size, bias=False)
        self.k_proj = nn.Linear(hidden_size, num_kv_heads * self.head_dim, bias=False)
        self.v_proj = nn.Linear(hidden_size, num_kv_heads * self.head_dim, bias=False)
        self.o_proj = nn.Linear(hidden_size, hidden_size, bias=False)
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        B, L, _ = x.shape
        
        q = self.q_proj(x).view(B, L, self.num_q_heads, self.head_dim)
        k = self.k_proj(x).view(B, L, self.num_kv_heads, self.head_dim)
        v = self.v_proj(x).view(B, L, self.num_kv_heads, self.head_dim)
        
        # 将 KV 头重复扩展到与 Q 头数量相同（repeat_kv）
        k = k.repeat_interleave(self.groups, dim=2)  # [B, L, num_q_heads, head_dim]
        v = v.repeat_interleave(self.groups, dim=2)
        
        # 标准注意力计算
        q, k, v = q.transpose(1, 2), k.transpose(1, 2), v.transpose(1, 2)
        attn = F.scaled_dot_product_attention(q, k, v, is_causal=True)
        
        attn = attn.transpose(1, 2).reshape(B, L, -1)
        return self.o_proj(attn)
```

---

### 3.5 SwiGLU 激活函数

LLaMA 的 FFN 使用 **SwiGLU** 代替传统的 ReLU：

```python
# 标准 FFN（Transformer 原版）
class StandardFFN(nn.Module):
    def forward(self, x):
        return self.w2(F.relu(self.w1(x)))

# SwiGLU FFN（LLaMA 使用）
class SwiGLU_FFN(nn.Module):
    def __init__(self, hidden_size, intermediate_size):
        super().__init__()
        self.gate_proj = nn.Linear(hidden_size, intermediate_size, bias=False)
        self.up_proj   = nn.Linear(hidden_size, intermediate_size, bias=False)
        self.down_proj = nn.Linear(intermediate_size, hidden_size, bias=False)
    
    def forward(self, x):
        # SwiGLU = Swish(gate) × up
        gate = F.silu(self.gate_proj(x))  # Swish(x) = x × sigmoid(x)
        up = self.up_proj(x)
        return self.down_proj(gate * up)  # 门控乘法
```

SwiGLU 的优势：
- 门控机制让模型选择性地传递信息
- 训练更稳定，收敛更快
- 相比 ReLU，表达能力更强

---

## 4. 注意力机制深度解析

### 4.1 Scaled Dot-Product Attention

```
注意力计算公式：
Attention(Q, K, V) = softmax(QKᵀ / √d_k) × V

Q（查询）：当前 Token "想要找什么"
K（键）  ：所有 Token "我是什么"
V（值）  ：所有 Token "我携带什么信息"
√d_k    ：缩放因子，防止点积过大导致 softmax 梯度消失
```

**计算复杂度：O(n²d)**，这是 Transformer 的瓶颈所在。

### 4.2 因果注意力掩码（Causal Mask）

自回归语言模型在训练时使用下三角掩码，确保每个 Token 只能看到它之前的 Token：

```
掩码矩阵（4个Token示例）：
     T1  T2  T3  T4
T1 [  1   0   0   0 ]   ← T1 只能看 T1
T2 [  1   1   0   0 ]   ← T2 能看 T1, T2
T3 [  1   1   1   0 ]   ← T3 能看 T1, T2, T3
T4 [  1   1   1   1 ]   ← T4 能看所有 Token

0 = -inf（softmax 后变为 0，即忽略）
```

### 4.3 Flash Attention：显存高效实现

标准注意力需要在内存中存储 `n×n` 的注意力矩阵，Flash Attention 通过分块计算避免此问题：

```python
# 使用 Flash Attention（推荐）
from transformers import AutoModelForCausalLM
import torch

model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Meta-Llama-3-8B",
    attn_implementation="flash_attention_2",  # 需要 pip install flash-attn
    torch_dtype=torch.bfloat16,
)

# Flash Attention 优势：
# - 显存：O(n) 而非 O(n²)
# - 速度：比标准实现快 2~4 倍
# - 支持更长上下文（128K+）
```

---

## 5. 推理优化技术

### 5.1 KV Cache

自回归生成时，避免重复计算历史 Token 的 K、V：

```python
# 无 KV Cache（慢，每步重算）：O(n²)
for step in range(max_new_tokens):
    logits = model(all_tokens)  # 每次处理所有 Token
    next_token = logits[:, -1].argmax()
    all_tokens = torch.cat([all_tokens, next_token.unsqueeze(1)], dim=1)

# 有 KV Cache（快，只计算新 Token）：O(n)
past_key_values = None
for step in range(max_new_tokens):
    output = model(new_token, past_key_values=past_key_values)
    past_key_values = output.past_key_values  # 缓存历史 K/V
    next_token = output.logits[:, -1].argmax()
```

### 5.2 量化推理

```python
# INT8 量化（减少显存 ~50%）
from transformers import BitsAndBytesConfig

model = AutoModelForCausalLM.from_pretrained(
    model_name,
    quantization_config=BitsAndBytesConfig(load_in_8bit=True)
)

# INT4 量化（减少显存 ~75%）
model = AutoModelForCausalLM.from_pretrained(
    model_name,
    quantization_config=BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_compute_dtype=torch.bfloat16,
    )
)
```

### 5.3 投机解码（Speculative Decoding）

用小模型快速生成草稿，大模型并行验证，提升吞吐量 2~3 倍：

```
流程：
1. 草稿模型（小）快速生成 K 个 Token
2. 目标模型（大）并行验证这 K 个 Token
3. 接受所有与大模型分布一致的 Token
4. 丢弃不一致的 Token，重新生成

例如 K=5：
草稿：[the, cat, sat, on, mat]
验证：[√, √, √, ✗, ─]  ← "sat" 被拒绝
接受：[the, cat] + 大模型重采样一个 Token
```

---

## 6. 实战示例

### 端到端：加载模型进行对话推理

```python
from transformers import AutoTokenizer, AutoModelForCausalLM
import torch

# 1. 加载模型
model_id = "meta-llama/Meta-Llama-3-8B-Instruct"
tokenizer = AutoTokenizer.from_pretrained(model_id)
model = AutoModelForCausalLM.from_pretrained(
    model_id,
    torch_dtype=torch.bfloat16,
    device_map="auto",
    attn_implementation="flash_attention_2",
)

# 2. 构建对话
messages = [
    {"role": "system", "content": "你是一个专业的 AI 技术助手。"},
    {"role": "user", "content": "解释 Transformer 的注意力机制，用类比说明。"},
]

# 3. 格式化输入
input_ids = tokenizer.apply_chat_template(
    messages,
    add_generation_prompt=True,
    return_tensors="pt"
).to(model.device)

# 4. 推理
terminators = [
    tokenizer.eos_token_id,
    tokenizer.convert_tokens_to_ids("<|eot_id|>"),
]

with torch.no_grad():
    output = model.generate(
        input_ids,
        max_new_tokens=1024,
        eos_token_id=terminators,
        do_sample=True,
        temperature=0.6,
        top_p=0.9,
    )

# 5. 解码（只取新生成的部分）
new_tokens = output[0][input_ids.shape[-1]:]
response = tokenizer.decode(new_tokens, skip_special_tokens=True)
print(response)
```

---

## 7. 性能调优最佳实践

### 显存优化策略

```
任务      显存需求      优化策略
─────────────────────────────────────────
推理       高           量化（INT4/INT8）+ Flash Attention
SFT 训练  极高         LoRA + 梯度检查点 + bf16
RLHF      极高         DeepSpeed ZeRO-3 + 模型并行
```

| 优化技术 | 显存节省 | 速度影响 | 质量影响 |
|---------|---------|---------|---------|
| FP16/BF16 | 50% | 快 2x | 无 |
| INT8 量化 | 50% | 略慢 | 轻微（<1%） |
| INT4 量化 | 75% | 略慢 | 轻微（<3%） |
| Flash Attention | 大（O(n→O(n²)) | 快 2-4x | 无 |
| 梯度检查点 | 训练 60% | 慢 30% | 无 |
| KV Cache | 推理加速 | 快 10-100x | 无 |

### 多 GPU 部署

```python
# 方式一：device_map="auto"（自动流水线并行）
model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Meta-Llama-3-70B",
    device_map="auto",   # 自动将层分配到多个 GPU
    torch_dtype=torch.bfloat16,
)

# 方式二：使用 accelerate 自定义 device_map
from accelerate import init_empty_weights, infer_auto_device_map

with init_empty_weights():
    model = AutoModelForCausalLM.from_config(config)

device_map = infer_auto_device_map(
    model,
    max_memory={0: "40GiB", 1: "40GiB", "cpu": "100GiB"}
)
```

---

## 导航

- ← [10-AI-CLI与代码Agent](./10-AI-CLI与代码Agent.md)
- ← [技术资料总目录](../README.md)
- ↔ [对应面试题](../../02-面试指南/07-AI-Agent全栈开发面试/11-Transformers与模型架构面试题.md)
