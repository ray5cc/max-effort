# 01-LLM原理 — 技术资料

> 从 `modeling_llama.py` 源码出发，系统推导 Transformer 自注意力机制、位置编码演进、预训练范式、Tokenizer 算法、Scaling Laws 和解码策略的核心原理，覆盖 LLM 工程师必须掌握的底层知识。

## 相关链接

- 对应面试题：[01-LLM原理面试题](../../02-面试指南/07-AI-Agent全栈开发面试/01-LLM原理面试题.md)

---

## 目录

1. [概述](#1-概述)
   - 1.1 从 Attention is All You Need 到现代 LLM
   - 1.2 源码导览：以 `modeling_llama.py` 为主线
2. [Transformer 架构深度解析](#2-transformer-架构深度解析)
   - 2.1 整体架构与数据流
   - 2.2 Embedding 层
   - 2.3 Decoder Block 结构
   - 2.4 输出层与 Tied Weights
3. [自注意力机制数学推导](#3-自注意力机制数学推导)
   - 3.1 Q/K/V 矩阵的几何意义
   - 3.2 Scaled Dot-Product Attention 推导
   - 3.3 Multi-Head Attention
   - 3.4 因果掩码（Causal Mask）
   - 3.5 KV Cache 原理
4. [位置编码演进](#4-位置编码演进)
   - 4.1 绝对正弦位置编码（Sinusoidal PE）
   - 4.2 可学习位置编码（Learned PE）
   - 4.3 RoPE（旋转位置编码）数学推导
   - 4.4 ALiBi（线性偏置注意力）
   - 4.5 三种方案对比
5. [预训练范式](#5-预训练范式)
   - 5.1 GPT 自回归语言建模（CLM）
   - 5.2 BERT 掩码语言建模（MLM）
   - 5.3 T5 Encoder-Decoder（Span Corruption）
   - 5.4 三种范式对比与适用场景
6. [Tokenizer 深度解析](#6-tokenizer-深度解析)
   - 6.1 BPE（Byte-Pair Encoding）
   - 6.2 WordPiece
   - 6.3 SentencePiece
   - 6.4 Unigram Language Model
   - 6.5 四种算法对比
7. [Scaling Laws](#7-scaling-laws)
   - 7.1 Kaplan et al. 原始 Scaling Laws
   - 7.2 Chinchilla Optimal（Hoffmann et al.）
   - 7.3 工程实践：如何用 Scaling Laws 规划训练
8. [解码策略](#8-解码策略)
   - 8.1 贪心解码（Greedy Decoding）
   - 8.2 集束搜索（Beam Search）
   - 8.3 Top-k 采样
   - 8.4 Top-p（Nucleus）采样
   - 8.5 Temperature 控制
   - 8.6 HuggingFace `generate()` 源码剖析
9. [常见问题与最佳实践](#9-常见问题与最佳实践)

---

## 1. 概述

### 1.1 从 Attention is All You Need 到现代 LLM

2017 年 Vaswani 等人发表 *Attention is All You Need*，提出了纯注意力机制的 Transformer 架构，彻底取代 RNN/LSTM 成为序列建模的主流范式。从那之后，LLM 的演进路径可以分为三代：

```
第一代（2017-2019）：架构确立
  Transformer (2017) → GPT-1 (2018) → BERT (2018) → GPT-2 (2019)
  核心贡献：Self-Attention、Pre-training + Fine-tuning 范式

第二代（2019-2022）：规模扩张
  GPT-3 (2020, 175B) → T5 (2019) → PaLM (2022, 540B)
  核心贡献：Scaling Laws、In-Context Learning、思维链

第三代（2022-今）：对齐与效率
  InstructGPT (2022) → LLaMA (2023) → Mistral → LLaMA 3
  核心贡献：RLHF/DPO、开源生态、架构优化（RoPE/GQA/SwiGLU）
```

### 1.2 源码导览：以 `modeling_llama.py` 为主线

HuggingFace Transformers 中的 `src/transformers/models/llama/modeling_llama.py` 是最值得精读的源码文件之一，它包含了现代 Decoder-only LLM 的所有核心组件：

```
modeling_llama.py 主要类结构
────────────────────────────────────────────────────────────
LlamaRMSNorm            # 前归一化（替代 LayerNorm）
LlamaRotaryEmbedding    # RoPE 旋转位置编码
LlamaMLP                # SwiGLU 前馈网络
LlamaAttention          # GQA 分组查询注意力
  └─ LlamaSdpaAttention # PyTorch SDPA 加速版本
LlamaDecoderLayer       # 完整 Decoder Block
LlamaModel              # 堆叠 N 个 DecoderLayer
LlamaForCausalLM        # 带语言模型头的完整模型
  └─ generate()         # 继承自 GenerationMixin
────────────────────────────────────────────────────────────
```

**为什么读 LLaMA 源码而不是 Transformer 论文源码？**

原版论文代码是 Encoder-Decoder，而现代主流 LLM（GPT 系列、LLaMA、Mistral、Qwen）几乎都是 Decoder-only。LLaMA 代码简洁、工程化程度高，且包含了 RoPE/GQA/RMSNorm 等现代改进，是最佳学习切入点。

---

## 2. Transformer 架构深度解析

### 2.1 整体架构与数据流

以 LLaMA 为例，完整的前向传播数据流如下：

```
输入 Token IDs: [1, 15043, 29892, 3186, 29991]
                        │
               ┌────────▼────────┐
               │  Embedding 查表  │  vocab_size × hidden_size
               │  nn.Embedding   │  (32000 × 4096 for 7B)
               └────────┬────────┘
                        │ hidden_states: (batch, seq_len, 4096)
                        │
               ┌────────▼────────────────────────────┐
               │          Decoder Layer × 32          │
               │  ┌─────────────────────────────┐    │
               │  │ RMSNorm (pre-norm)           │    │
               │  │ GQA Attention + RoPE         │    │
               │  │ 残差连接 (+ hidden_states)   │    │
               │  │ RMSNorm (pre-norm)           │    │
               │  │ SwiGLU MLP                   │    │
               │  │ 残差连接 (+ hidden_states)   │    │
               │  └─────────────────────────────┘    │
               └────────┬────────────────────────────┘
                        │
               ┌────────▼────────┐
               │    RMSNorm      │  最终归一化
               └────────┬────────┘
                        │
               ┌────────▼────────┐
               │   lm_head       │  hidden_size × vocab_size
               │  nn.Linear      │  (4096 × 32000, no bias)
               └────────┬────────┘
                        │
               logits: (batch, seq_len, 32000)
                        │
               ┌────────▼────────┐
               │    Softmax      │  → 每个位置的词汇概率分布
               └─────────────────┘
```

**关键数字（LLaMA 3 8B）：**

| 参数 | 数值 | 含义 |
|------|------|------|
| `hidden_size` | 4096 | 词向量/隐层维度 |
| `num_hidden_layers` | 32 | Decoder Block 数量 |
| `num_attention_heads` | 32 | Q 注意力头数 |
| `num_key_value_heads` | 8 | K/V 注意力头数（GQA） |
| `intermediate_size` | 14336 | MLP 中间层维度 |
| `vocab_size` | 128256 | 词汇表大小 |
| `max_position_embeddings` | 8192 | 最大上下文长度 |

### 2.2 Embedding 层

```python
# 源码：modeling_llama.py → LlamaModel.__init__
self.embed_tokens = nn.Embedding(config.vocab_size, config.hidden_size, self.padding_idx)
```

Embedding 层本质是一个查找表（Look-Up Table）。给定 token ID，返回对应的 `hidden_size` 维向量。

**为什么 Embedding 是可训练的？**

初始化时，每个 token 的向量是随机的。训练过程中，反向传播通过交叉熵损失更新这些向量，使语义相近的 token（如 "cat"/"feline"）的向量在空间上相近——这正是词向量（Word2Vec/GloVe）的思想在大模型中的自然延伸。

### 2.3 Decoder Block 结构

```python
# 源码：LlamaDecoderLayer.forward（简化）
class LlamaDecoderLayer(nn.Module):
    def forward(self, hidden_states, attention_mask, position_ids, ...):
        residual = hidden_states

        # ① Pre-Norm（在注意力之前归一化）
        hidden_states = self.input_layernorm(hidden_states)

        # ② Self-Attention（含 RoPE 和 KV Cache）
        hidden_states, self_attn_weights, present_key_value = self.self_attn(
            hidden_states=hidden_states,
            attention_mask=attention_mask,
            position_ids=position_ids,
            past_key_value=past_key_value,
        )

        # ③ 残差连接
        hidden_states = residual + hidden_states

        residual = hidden_states

        # ④ Pre-Norm（在 MLP 之前归一化）
        hidden_states = self.post_attention_layernorm(hidden_states)

        # ⑤ SwiGLU MLP
        hidden_states = self.mlp(hidden_states)

        # ⑥ 残差连接
        hidden_states = residual + hidden_states

        return hidden_states, self_attn_weights, present_key_value
```

**Pre-Norm vs Post-Norm：**

```
Post-Norm (原版 Transformer):               Pre-Norm (LLaMA):
  x → Attention → (+x) → LayerNorm           x → LayerNorm → Attention → (+x)
  x → FFN      → (+x) → LayerNorm           x → LayerNorm → FFN       → (+x)

Post-Norm 问题：深层梯度消失（梯度需穿越归一化层）
Pre-Norm 优势：梯度直接通过残差路径流动，训练更稳定
```

### 2.4 输出层与 Tied Weights

```python
# 源码：LlamaForCausalLM.__init__
self.lm_head = nn.Linear(config.hidden_size, config.vocab_size, bias=False)
```

**Weight Tying（权重绑定）**是一个重要工程技巧：

```python
# 许多模型将 lm_head 的权重与 embed_tokens 绑定（共享参数）
# GPT-2 源码中可见：
self.lm_head.weight = self.transformer.wte.weight
```

原因：Embedding 矩阵将 token ID → 向量空间，lm_head 将向量空间 → token logits，两者互为转置，共享参数可减少约 `vocab_size × hidden_size` 个参数（LLaMA 3 8B 中约 500M 参数）。

---

## 3. 自注意力机制数学推导

### 3.1 Q/K/V 矩阵的几何意义

Self-Attention 将每个 token 的表示拆分为三个角色：

```
Query (Q)：我在找什么？（当前 token 的"问题"）
Key   (K)：我能提供什么？（每个 token 的"标签"）
Value (V)：我的实际内容是什么？（每个 token 的"信息"）

类比数据库：
  SELECT (Value)
  FROM tokens
  WHERE (Key) MATCHES (Query)
```

在代码中，三个矩阵通过线性投影得到：

```python
# 源码：LlamaAttention.forward（简化）
query_states = self.q_proj(hidden_states)  # (B, L, num_q_heads × head_dim)
key_states   = self.k_proj(hidden_states)  # (B, L, num_kv_heads × head_dim)
value_states = self.v_proj(hidden_states)  # (B, L, num_kv_heads × head_dim)

# 重塑为多头格式
query_states = query_states.view(B, L, self.num_heads, self.head_dim).transpose(1, 2)
key_states   = key_states.view(B, L, self.num_kv_heads, self.head_dim).transpose(1, 2)
value_states = value_states.view(B, L, self.num_kv_heads, self.head_dim).transpose(1, 2)
```

### 3.2 Scaled Dot-Product Attention 推导

**完整公式：**

```
Attention(Q, K, V) = softmax( Q·Kᵀ / √dₖ ) · V
```

**为什么除以 √dₖ（缩放因子）？**

设 Q 和 K 的每个元素独立服从均值 0、方差 1 的标准正态分布，则 Q·Kᵀ 的每个元素是 dₖ 个独立随机变量的和，其方差为 dₖ。

```
Var(Q·Kᵀ) = dₖ · Var(qᵢkᵢ) = dₖ · 1 = dₖ
Std(Q·Kᵀ) = √dₖ
```

如果不缩放，随着 dₖ 增大，内积值会变大，导致 softmax 进入饱和区（梯度极小），训练不稳定：

```
dₖ = 64: 内积量级 ≈ 8 → softmax 正常
dₖ = 64: 不缩放时 → 内积量级 ≈ 8, OK
dₖ = 512: 不缩放时 → 内积量级 ≈ 22 → softmax([22, -22]) ≈ [1, 0]，梯度消失
          缩放后   → 内积量级 ≈ 1  → softmax 工作正常
```

**softmax 温度与 √dₖ：**

除以 √dₖ 等价于提高 softmax 温度，使注意力分布更平滑，允许关注多个位置。

### 3.3 Multi-Head Attention

单头注意力只能学习一种"相关性模式"。多头注意力允许模型在不同子空间中并行学习多种模式：

```
Multi-Head Attention(Q, K, V) = Concat(head₁, ..., headₕ) · Wₒ

其中：headᵢ = Attention(Q·Wᵢᴼ, K·Wᵢᴷ, V·Wᵢᵛ)
```

```
每个头学习的模式示例：
  Head 1: 句法依存关系（主谓宾）
  Head 2: 局部上下文（相邻词）
  Head 3: 长距离指代（代词与名词）
  Head 4: 语义相似性（近义词）
  ...
```

**计算复杂度：**

对于序列长度 L 和隐层维度 d：

```
Self-Attention 时间复杂度：O(L² × d)
  - Q·Kᵀ 矩阵乘法：O(L² × d)  ← 二次瓶颈！
  - softmax：O(L²)
  - ×V 矩阵乘法：O(L² × d)

FFN 时间复杂度：O(L × d²)

当 L >> d 时，Attention 成为瓶颈（长上下文问题的根源）
当 d >> L 时，FFN 成为瓶颈（大模型推理中常见）
```

### 3.4 因果掩码（Causal Mask）

Decoder-only 模型在训练时必须防止"看到未来 token"，通过下三角掩码实现：

```
序列：[The, cat, sat, on, mat]
注意力矩阵（允许 ✓ / 禁止 ✗）：

         The  cat  sat  on  mat
The  [    ✓    ✗    ✗    ✗    ✗  ]
cat  [    ✓    ✓    ✗    ✗    ✗  ]
sat  [    ✓    ✓    ✓    ✗    ✗  ]
on   [    ✓    ✓    ✓    ✓    ✗  ]
mat  [    ✓    ✓    ✓    ✓    ✓  ]
```

代码实现：

```python
# 源码：modeling_llama.py → LlamaModel._update_causal_mask
def create_causal_mask(seq_len, dtype, device):
    # 创建上三角矩阵（不含对角线），填充 -inf
    mask = torch.full((seq_len, seq_len), fill_value=float("-inf"), dtype=dtype, device=device)
    mask = torch.triu(mask, diagonal=1)  # 上三角设为 -inf，其余为 0
    return mask

# 应用掩码：在 softmax 之前加到注意力分数上
# -inf 经过 softmax 后变为 0（完全屏蔽）
attn_weights = attn_weights + causal_mask
attn_weights = torch.softmax(attn_weights, dim=-1)
```

### 3.5 KV Cache 原理

自回归生成时，每一步都重新计算所有 token 的 K, V 代价极高。KV Cache 缓存历史计算：

```
无 KV Cache（步骤 t）：
  重新计算所有 t 个 token 的 K, V → O(t²) 总复杂度

有 KV Cache（步骤 t）：
  只计算新 token 的 K, V，并追加到缓存 → O(t) 总复杂度

内存代价：
  每层 KV Cache 大小 = 2 × batch_size × seq_len × num_kv_heads × head_dim × bytes_per_param
  LLaMA 3 8B, FP16, batch=1, seq=4096:
  = 2 × 1 × 4096 × 8 × 128 × 2 bytes × 32 layers ≈ 1.07 GB
```

```python
# 源码：LlamaAttention.forward 中的 KV Cache 逻辑
if past_key_value is not None:
    # 推理时：将新的 K, V 拼接到历史缓存
    key_states   = torch.cat([past_key_value[0], key_states],   dim=2)
    value_states = torch.cat([past_key_value[1], value_states], dim=2)

# 将当前 K, V 存入缓存，供下一步使用
present_key_value = (key_states, value_states)
```

---

## 4. 位置编码演进

### 4.1 绝对正弦位置编码（Sinusoidal PE）

原版 Transformer 使用固定的正弦/余弦函数为每个位置生成编码：

```
PE(pos, 2i)   = sin(pos / 10000^(2i/d_model))
PE(pos, 2i+1) = cos(pos / 10000^(2i/d_model))
```

其中 pos 是位置，i 是维度索引。

```
直觉：用二进制计数来类比
位置 0: 0000  →  高频维度快速变化
位置 1: 0001  →  低频维度缓慢变化
位置 2: 0010
位置 3: 0011

正弦编码类似于"连续版二进制计数"，
不同维度对应不同"时钟频率"
```

**局限性：** 训练时只见过 max_length 以内的位置，测试时超出范围效果急剧下降。

```python
import numpy as np
import torch

def sinusoidal_positional_encoding(max_len: int, d_model: int) -> torch.Tensor:
    pe = torch.zeros(max_len, d_model)
    position = torch.arange(0, max_len, dtype=torch.float).unsqueeze(1)
    # 频率：1 / 10000^(2i/d_model)
    div_term = torch.exp(torch.arange(0, d_model, 2).float() * (-np.log(10000.0) / d_model))
    pe[:, 0::2] = torch.sin(position * div_term)   # 偶数维度用 sin
    pe[:, 1::2] = torch.cos(position * div_term)   # 奇数维度用 cos
    return pe  # (max_len, d_model)
```

### 4.2 可学习位置编码（Learned PE）

GPT-2、BERT 等模型改用可学习的位置嵌入：

```python
# BERT/GPT-2 中的可学习位置编码
self.position_embeddings = nn.Embedding(max_position_embeddings, hidden_size)

# 前向传播：将 token embedding 与 position embedding 相加
position_ids = torch.arange(seq_len).unsqueeze(0)
embeddings = token_embeddings + self.position_embeddings(position_ids)
```

**优点：** 灵活，可学习最优编码方式。  
**缺点：** 无法外推（超出训练长度后无对应嵌入向量）。

### 4.3 RoPE（旋转位置编码）数学推导

RoPE（Rotary Position Embedding，Su et al., 2021）的核心目标：**令注意力权重仅依赖相对位置，且无需额外参数**。

**数学推导：**

设查询向量 q 在位置 m，键向量 k 在位置 n，定义旋转操作：

```
f(x, pos) = x ⊗ e^(i·pos·θ)   （复数形式）

其中 θ_d = 1 / 10000^(2d/D)，d 为维度对索引
```

对 D 维实数向量，将其视为 D/2 个二维子向量，对第 d 对 (x₂d, x₂d₊₁) 应用旋转矩阵：

```
[x₂d']     [cos(pos·θd)  -sin(pos·θd)] [x₂d  ]
[x₂d₊₁'] = [sin(pos·θd)   cos(pos·θd)] [x₂d₊₁]
```

**关键性质——内积仅依赖相对位置：**

```
⟨f(q, m), f(k, n)⟩
= Re[ Σd (q₂d + iq₂d₊₁)(k₂d - ik₂d₊₁) · e^(i(m-n)θd) ]
= g(q, k, m-n)    ← 只含 m-n，不含 m 或 n 的绝对值！
```

```python
# 源码：LlamaRotaryEmbedding（简化）
class LlamaRotaryEmbedding(nn.Module):
    def __init__(self, dim, max_position_embeddings=2048, base=10000):
        super().__init__()
        # 每维度对的频率 θ_d
        inv_freq = 1.0 / (base ** (torch.arange(0, dim, 2).float() / dim))
        self.register_buffer("inv_freq", inv_freq)

    def forward(self, x, position_ids):
        # position_ids: (batch, seq_len)
        # inv_freq: (dim/2,)
        freqs = torch.einsum("bi,j->bij", position_ids.float(), self.inv_freq)
        # emb: (batch, seq_len, dim)  → cos 和 sin 拼接
        emb = torch.cat((freqs, freqs), dim=-1)
        return emb.cos(), emb.sin()

def rotate_half(x):
    """将向量分为前后两半，实现旋转"""
    x1, x2 = x[..., : x.shape[-1] // 2], x[..., x.shape[-1] // 2 :]
    return torch.cat((-x2, x1), dim=-1)

def apply_rotary_pos_emb(q, k, cos, sin, position_ids):
    cos = cos[position_ids].unsqueeze(1)  # (B, 1, L, dim)
    sin = sin[position_ids].unsqueeze(1)
    q_embed = (q * cos) + (rotate_half(q) * sin)
    k_embed = (k * cos) + (rotate_half(k) * sin)
    return q_embed, k_embed
```

**长度外推：YaRN 与 RoPE Scaling**

LLaMA 3 通过调整 θ 基数（base）来扩展上下文窗口：

```python
# 将 base 从 10000 增大到 500000，使高频维度衰减更慢
# 这允许模型外推到更长的序列
config.rope_theta = 500000.0  # LLaMA 3 的设置
```

### 4.4 ALiBi（线性偏置注意力）

ALiBi（Press et al., 2022）不修改 embedding，而是在注意力分数上直接加线性偏置：

```
ALiBi 注意力分数 = Q·Kᵀ / √dₖ  -  m × |i - j|

其中 m 是每个头的斜率（超参数），|i - j| 是位置距离
```

```
注意力矩阵（Head 1，m=1）：
         pos0  pos1  pos2  pos3
pos0 [    0    -1    -2    -3  ]
pos1 [    0     0    -1    -2  ]
pos2 [    0     0     0    -1  ]
pos3 [    0     0     0     0  ]

越远的 token，偏置越大（负值），注意力权重越低
不同头使用不同斜率 m，学习不同的"衰减速度"
```

**ALiBi 的优势：** 无需位置嵌入向量，对超出训练长度的序列有更好的泛化。

### 4.5 三种方案对比

| 方案 | 训练长度外推 | 参数量 | 相对位置感知 | 代表模型 |
|------|------------|--------|------------|---------|
| 绝对正弦 PE | 差（无法外推） | 0 | 间接 | 原版 Transformer |
| 可学习 PE | 差（无超出索引） | `max_len × d` | 间接 | GPT-2、BERT |
| RoPE | 好（可扩展 base） | 0 | 直接 | LLaMA、Qwen、Mistral |
| ALiBi | 很好（天然外推） | 0 | 直接（线性衰减） | BLOOM、MPT |

---

## 5. 预训练范式

### 5.1 GPT 自回归语言建模（CLM）

**训练目标：** 给定前缀，预测下一个 token（因果语言建模）。

```
输入：[<BOS>, The, cat, sat, on, the, mat]
目标：[The,   cat, sat, on,  the, mat, <EOS>]

损失：交叉熵 L = -1/T × Σₜ log P(xₜ | x₁...xₜ₋₁; θ)

训练时用因果掩码，一次前向可计算所有位置的损失（Teacher Forcing）
```

```
GPT 预训练示意：
  输入序列: The  cat  sat  on   mat
                │    │    │    │    │
  Causal        ▼    ▼    ▼    ▼    ▼
  Decoder:  [The] [cat] [sat] [on] [mat]
              ↓    ↓    ↓    ↓    ↓
  预测：    cat   sat   on   mat  <EOS>
              ↓    ↓    ↓    ↓    ↓
  Loss：   CE₁ + CE₂ + CE₃ + CE₄ + CE₅
```

```python
# HuggingFace Transformers：CLM 训练的损失计算
# 源码：LlamaForCausalLM.forward
logits = self.lm_head(hidden_states)   # (B, L, vocab_size)

if labels is not None:
    # 将 logits 向左移动一位，与 labels 对齐
    shift_logits = logits[..., :-1, :].contiguous()
    shift_labels = labels[..., 1:].contiguous()
    loss_fct = nn.CrossEntropyLoss()
    loss = loss_fct(
        shift_logits.view(-1, self.config.vocab_size),
        shift_labels.view(-1)
    )
```

**优势：** 天然支持生成任务，无需额外修改架构。  
**代表模型：** GPT 系列、LLaMA、Mistral、Qwen、DeepSeek。

### 5.2 BERT 掩码语言建模（MLM）

**训练目标：** 随机遮盖 15% 的 token，预测被遮盖的原始 token。

```
原始：The cat sat on the mat
处理：随机选 15% 的位置
  80% 替换为 [MASK]：The [MASK] sat on the mat
  10% 替换为随机词：  The dog   sat on the mat
  10% 保持不变：      The cat   sat on the mat

目标：预测 "cat"（不论哪种处理方式）
```

**为什么要 10% 随机词 + 10% 保持不变？**

如果全部替换为 [MASK]，模型只需在测试时处理 [MASK]，而无需理解真实 token 上下文。引入噪声让模型不能"依赖 [MASK] 提示"，强迫学习每个 token 的真实语义表示。

```python
# BERT MLM 损失（简化）
# 仅在被遮盖位置计算损失，非遮盖位置 label=-100（忽略）
labels = torch.full_like(input_ids, fill_value=-100)
labels[masked_positions] = original_tokens[masked_positions]

outputs = model(masked_input_ids, labels=labels)
loss = outputs.loss  # 仅在 masked 位置计算 CE
```

**BERT 的双向性优势：** 每个 token 可以关注序列中所有其他 token（无因果掩码），得到更丰富的上下文表示，适合理解任务（NLU）。

**局限：** 不适合生成任务（无法自回归）。  
**代表模型：** BERT、RoBERTa、DeBERTa。

### 5.3 T5 Encoder-Decoder（Span Corruption）

**训练目标：** 将连续的 token span 替换为 sentinel token，Decoder 预测原始 span。

```
原始：    Thank you for inviting me to your party
Encoder输入: Thank you <X> me to <Y> party
Decoder输出: <X> for inviting <Y> your <Z>

（<X>, <Y>, <Z> 是哨兵 token，每个代表一段被遮盖的 span）
```

```
T5 架构：
                    Encoder                     Decoder
  ┌───────────────────────────┐  ┌────────────────────────────────┐
  │ Thank you <X> me to <Y>   │  │ <X> for inviting <Y> your <Z>  │
  │       ↓                   │  │         ↑ Cross-Attention        │
  │  Self-Attention (双向)     │──│  Self-Attention (因果) +        │
  │  Encoder 表示              │  │  Cross-Attention (看 Encoder)   │
  └───────────────────────────┘  └────────────────────────────────┘
```

**T5 与 BERT/GPT 的本质区别：**

| 架构 | 注意力方向 | 适合任务 |
|------|-----------|---------|
| GPT（Decoder-only） | 因果单向 | 生成、补全 |
| BERT（Encoder-only） | 双向全量 | 分类、理解 |
| T5（Encoder-Decoder） | 编码双向 + 解码单向 | 序列到序列（翻译、摘要、QA） |

### 5.4 三种范式对比与适用场景

```
预训练范式对比：

CLM (GPT)                  MLM (BERT)                 Seq2Seq (T5)
──────────────             ──────────────             ──────────────
  [BOS]                     [CLS]                     Encoder Input
    │                         │                           │
  ┌─▼──────────────┐        ┌─▼──────────────┐        ┌──▼─────────┐
  │ Causal Decoder  │        │  Bidirectional  │        │ Bi-Encoder │
  │  (下三角 mask)  │        │    Encoder      │        └─────┬──────┘
  └────────────────┘        └────────────────┘              │
    │                         │                        ┌────▼───────┐
  预测下一词                  预测 [MASK]               │ Causal Dec │
  (生成任务王者)              (理解任务王者)             └────────────┘
                                                        预测目标序列
```

| 维度 | CLM | MLM | Seq2Seq |
|------|-----|-----|---------|
| 生成能力 | ★★★★★ | ★☆☆☆☆ | ★★★★☆ |
| 理解能力（小数据微调） | ★★★☆☆ | ★★★★★ | ★★★★☆ |
| 参数效率 | ★★★★☆ | ★★★☆☆ | ★★☆☆☆ |
| 训练数据利用率 | ★★★☆☆ | ★★★★★ | ★★★☆☆ |
| 代表模型 | GPT/LLaMA | BERT/RoBERTa | T5/mT5/FLAN-T5 |

---

## 6. Tokenizer 深度解析

### 6.1 BPE（Byte-Pair Encoding）

BPE 是 GPT-2、GPT-3、LLaMA 等模型使用的分词算法，来自数据压缩领域。

**算法步骤：**

```
① 初始化：将所有单词拆分为字符序列
   语料：["low", "lower", "newest", "widest"]
   初始词表：{l, o, w, e, r, n, s, t, i, d, </w>}

② 统计相邻字节对频率：
   语料（展开）：l-o-w</w>(5次), l-o-w-e-r</w>(2次), ...
   最高频对：(e, s) 出现 6 次

③ 合并最高频对，得到新 token "es"
   更新语料：l-o-w</w>, l-o-w-e-r</w>, n-e-w-es-t</w>, w-i-d-es-t</w>

④ 重复步骤②③，直到达到目标词表大小
```

**字节级 BPE（Byte-level BPE）：**

GPT-2 的创新：以字节（256 个基础 token）而非字符为起点，可以无损表示任何 Unicode 文本，彻底消除 `[UNK]` token。

```python
# 使用 HuggingFace tokenizers 库训练 BPE
from tokenizers import Tokenizer
from tokenizers.models import BPE
from tokenizers.trainers import BpeTrainer
from tokenizers.pre_tokenizers import ByteLevel

tokenizer = Tokenizer(BPE())
tokenizer.pre_tokenizer = ByteLevel()  # 字节级 BPE

trainer = BpeTrainer(
    vocab_size=50000,
    min_frequency=2,
    special_tokens=["<pad>", "<eos>", "<bos>", "<unk>"]
)
tokenizer.train(["corpus.txt"], trainer)
```

### 6.2 WordPiece

WordPiece 是 BERT 使用的分词算法，与 BPE 最大的区别在于**合并标准**：

```
BPE：选择出现频率最高的字符对合并
WordPiece：选择最大化训练数据似然的字符对合并

即选择 score = freq(AB) / (freq(A) × freq(B)) 最高的对

直觉：优先合并"搭配显著"的字符对，而非单纯"高频"对
```

**WordPiece 的 `##` 前缀：**

```
"unaffable" → ["un", "##aff", "##able"]
单词中间的子词用 "##" 前缀标记，表示"接在前面的词后面"
```

```python
# BERT Tokenizer 示例
from transformers import BertTokenizer
tokenizer = BertTokenizer.from_pretrained("bert-base-uncased")

tokens = tokenizer.tokenize("unaffectionately")
# → ['un', '##affect', '##ion', '##ately']
```

### 6.3 SentencePiece

SentencePiece（Kudo & Richardson, 2018）的核心创新：**将分词视为无监督的语言模型问题**，并且直接在原始文本（含空格）上操作，不依赖预分词。

**关键特性：**

```
1. 空格作为普通字符处理（用 ▁ 表示单词开头空格）
   "Hello world" → ["▁Hello", "▁world"]

2. 支持 BPE 和 Unigram 两种子词算法

3. 语言无关：对中文、日文、阿拉伯文同等有效

4. 可逆性：tokenize → detokenize 无损
```

```python
import sentencepiece as spm

# 训练
spm.SentencePieceTrainer.train(
    input='corpus.txt',
    model_prefix='llama_spm',
    vocab_size=32000,
    model_type='bpe',           # 或 'unigram'
    character_coverage=0.9995,  # 覆盖 99.95% 的字符
    pad_id=0, unk_id=1, bos_id=2, eos_id=3
)

# 使用
sp = spm.SentencePieceProcessor(model_file='llama_spm.model')
sp.encode("Hello, 世界！", out_type=str)
# → ['▁Hello', ',', '▁世界', '！']
```

**LLaMA 使用 SentencePiece + BPE 的原因：** 多语言支持好、中文字符覆盖完整，且生成 token 可以直接拼接还原原始字符串。

### 6.4 Unigram Language Model

Unigram 是 SentencePiece 的另一种模式，基于概率语言模型：

**核心思想：**

```
假设每个 token 独立生成，句子的概率为各 token 概率之积：
P(x₁...xₙ) = Π P(xᵢ)

训练目标：最大化训练语料在 Unigram 语言模型下的似然

算法（EM 式迭代）：
① 初始化一个大词表（约 3× 目标大小）
② E 步：对每个单词，用 Viterbi 找最优分词
③ M 步：更新每个子词的概率
④ 修剪：删除"贡献最小"的子词
⑤ 重复直到达到目标词表大小
```

### 6.5 四种算法对比

| 维度 | BPE | WordPiece | SentencePiece | Unigram |
|------|-----|-----------|---------------|---------|
| 合并准则 | 频率最高 | 最大化似然增益 | 包装 BPE/Unigram | 最大化语言模型似然 |
| 分词确定性 | 确定性 | 确定性 | 确定性 | 概率（采样模式） |
| 多语言支持 | 需预处理 | 需预处理 | 原生支持 | 原生支持 |
| `[UNK]` token | 字节BPE可消除 | 存在 | 可消除 | 可消除 |
| 代表模型 | GPT-2/3, LLaMA | BERT, ELECTRA | LLaMA, T5 | Albert |
| 实现库 | `tokenizers` | `tokenizers` | `sentencepiece` | `sentencepiece` |

**Tokenizer 对模型性能的影响：**

```
词表大小 vs 平均序列长度的权衡：
  词表小（1K）：OOV 多，平均序列长，计算量大
  词表大（200K）：嵌入矩阵大，稀疏，但序列短

LLaMA 3 词表扩展：32K → 128K
  原因：提升中文、代码等非英语内容的表示效率
  效果：中文序列长度减少约 30%，推理速度提升
```

---

## 7. Scaling Laws

### 7.1 Kaplan et al. 原始 Scaling Laws

OpenAI 2020 年论文（*Scaling Laws for Neural Language Models*）发现，语言模型的损失 L 与参数量 N、数据量 D、计算量 C 之间存在幂律关系：

```
L(N) ≈ (Nₒ / N)^αN        αN ≈ 0.076
L(D) ≈ (Dₒ / D)^αD        αD ≈ 0.095
L(C) ≈ (Cₒ / C)^αC        αC ≈ 0.050

其中 Nₒ, Dₒ, Cₒ 是数据拟合的常数
```

**关键洞察：**

```
幂律意味着"边际收益递减但永不为零"：
  参数量 × 10 → 损失下降约 41%
  参数量 × 100 → 损失下降约 63%
  参数量 × 1000 → 损失下降约 74%

Kaplan 2020 结论：
  固定计算预算时，应优先扩大模型参数量（而非增加训练数据）
  最优参数量：N* ∝ C^0.73
```

### 7.2 Chinchilla Optimal（Hoffmann et al.）

DeepMind 2022 年论文（*Training Compute-Optimal Large Language Models*，即 Chinchilla 论文）纠正了 Kaplan 的结论：

**Chinchilla 最优定律：**

```
对于给定计算预算 C（FLOPs）：
  最优参数量 N* ≈ C^0.5 / 1.4
  最优数据量 D* ≈ 20 × N*

即：每个参数对应约 20 个训练 token
```

**与 Kaplan 的关键分歧：**

```
Kaplan (2020):              Chinchilla (2022):
  N* ∝ C^0.73                 N* ∝ C^0.5
  给定预算→偏大模型            给定预算→均衡参数和数据

GPT-3 (175B, 300B tokens): 数据量严重不足！
  Chinchilla 最优应为: ~70B 参数, 1.4T tokens

Chinchilla (70B, 1.4T tokens) 性能超过 Gopher (280B, 300B tokens)
```

```
Chinchilla 最优点可视化：

损失 L
│
│   GPT-3 区域               Chinchilla 区域
│   ●(N大, D小)                    ●(N均衡, D大)
│                              ★ 最优点（等 FLOPs 曲线上的最低损失）
│
└──────────────────────────────────────── 参数量 N →
```

**对 LLaMA 的影响：**

LLaMA（2023）正是基于 Chinchilla 结论设计的：

```
LLaMA 1 7B：在 1T tokens 上训练（≈ 143 tokens/param）
LLaMA 2 7B：在 2T tokens 上训练（≈ 286 tokens/param）
LLaMA 3 8B：在 15T tokens 上训练（≈ 1875 tokens/param）
  └─ 超出 Chinchilla 最优，追求推理效率（小模型但高度训练）
```

### 7.3 工程实践：如何用 Scaling Laws 规划训练

```python
def chinchilla_optimal(compute_budget_flops: float):
    """
    根据计算预算估算最优参数量和数据量
    
    规则：每次前向+反向传播约 6 × N FLOPs（N 为参数量）
    总 FLOPs ≈ 6 × N × D
    """
    # Chinchilla 系数（来自论文拟合）
    # N* = (C / (20 * 6))^0.5
    optimal_N = (compute_budget_flops / (20 * 6)) ** 0.5
    optimal_D = 20 * optimal_N
    return optimal_N, optimal_D

# 示例：A100 集群 × 100 天的计算预算
a100_flops_per_sec = 312e12      # 312 TFLOPS (BF16)
cluster_size = 512               # 512 × A100
efficiency = 0.4                 # 实际 MFU（模型 FLOPs 利用率）约 40%
days = 100
total_flops = a100_flops_per_sec * cluster_size * efficiency * days * 86400

N_opt, D_opt = chinchilla_optimal(total_flops)
print(f"最优参数量：{N_opt/1e9:.1f}B")
print(f"最优数据量：{D_opt/1e9:.1f}B tokens")
# 示例输出：约 30B 参数，600B tokens
```

**实践经验：**

```
"推理优化型"模型（如 LLaMA 3）选择训练远超 Chinchilla 最优的数据量：
  理由：部署时运行次数远超训练次数，小模型快速推理更经济

"训练优化型"模型（学术研究）遵循 Chinchilla 最优：
  理由：在固定预算下获得最低损失

经验法则（2024）：
  预算充足 → 70B+ 参数，2T+ tokens
  推理受限（边缘/移动） → 7B 参数，15T+ tokens（超训练）
```

---

## 8. 解码策略

### 8.1 贪心解码（Greedy Decoding）

每步选择概率最高的 token：

```
P = softmax(logits)  →  argmax(P)
```

```
示例：
输入：The capital of France is
步骤1：P("Paris")=0.9, P("Lyon")=0.05 → 选 "Paris"
步骤2：P(.)=0.95 → 选 "."
输出：The capital of France is Paris.
```

**优点：** 速度快，确定性强（每次输出相同）。  
**缺点：** 容易陷入重复循环，缺乏多样性。

### 8.2 集束搜索（Beam Search）

同时维护 k 条候选路径（beam width），最终选择总概率最高的路径：

```
Beam Width = 3 的搜索过程：
步骤1：
  候选1：The(0.4) capital(0.8) → score = log(0.4)+log(0.8) = -0.916
  候选2：The(0.4) best(0.1)    → score = -0.4+(-1.0) = -1.4  (淘汰)
  候选3：A(0.3) city(0.9)      → score = log(0.3)+log(0.9) = -1.323

步骤2：从保留的 k=3 候选中继续扩展...

最终：选总对数概率最高的路径
```

```python
# HuggingFace generate() 中的 Beam Search
from transformers import AutoModelForCausalLM, AutoTokenizer

model = AutoModelForCausalLM.from_pretrained("meta-llama/Llama-3.2-1B")
tokenizer = AutoTokenizer.from_pretrained("meta-llama/Llama-3.2-1B")

inputs = tokenizer("The capital of France is", return_tensors="pt")
output = model.generate(
    **inputs,
    num_beams=5,                 # beam width
    no_repeat_ngram_size=2,      # 禁止重复 2-gram
    length_penalty=1.0,          # 长度惩罚（>1 鼓励长输出）
    max_new_tokens=50,
)
```

**Beam Search 的问题：**

```
"The dog is very, very, very, very, very, very, very..."
  → 重复问题（repetition problem）

解决：no_repeat_ngram_size, repetition_penalty
```

### 8.3 Top-k 采样

从概率最高的 k 个 token 中随机采样：

```
原始概率：Paris(0.5), Lyon(0.2), Nice(0.15), Marseille(0.1), ...
Top-k=3：只保留 {Paris, Lyon, Nice}，重新归一化后采样

重归一化后：Paris(0.59), Lyon(0.24), Nice(0.18)
随机采样：有 59% 的概率选 Paris
```

```python
def top_k_sampling(logits, k=50):
    # 保留最高的 k 个 logits，其余设为 -inf
    top_k_logits, top_k_indices = torch.topk(logits, k)
    filtered_logits = torch.full_like(logits, float('-inf'))
    filtered_logits.scatter_(-1, top_k_indices, top_k_logits)
    probs = torch.softmax(filtered_logits, dim=-1)
    return torch.multinomial(probs, num_samples=1)
```

**问题：** 固定的 k 不够灵活——有时分布集中（只有 3 个合理词），有时分布分散（有 100 个合理词），k=50 可能过多或过少。

### 8.4 Top-p（Nucleus）采样

动态选择使累积概率达到 p 的最小 token 集合：

```
原始分布（排序后）：
  Paris:     0.50  → 累积 0.50
  Lyon:      0.20  → 累积 0.70
  Nice:      0.15  → 累积 0.85
  Marseille: 0.10  → 累积 0.95 ← p=0.9 截止于此
  Bordeaux:  0.03  → ...（丢弃）
  ...

Top-p=0.9：保留 {Paris, Lyon, Nice, Marseille}，重归一化后采样
```

```python
def top_p_sampling(logits, p=0.9):
    sorted_logits, sorted_indices = torch.sort(logits, descending=True)
    cumulative_probs = torch.cumsum(torch.softmax(sorted_logits, dim=-1), dim=-1)
    # 找到累积概率超过 p 的位置，之后的全部丢弃
    sorted_indices_to_remove = cumulative_probs - torch.softmax(sorted_logits, dim=-1) > p
    sorted_logits[sorted_indices_to_remove] = float('-inf')
    # 还原原始顺序
    logits = torch.gather(sorted_logits, -1, sorted_indices.argsort(-1))
    probs = torch.softmax(logits, dim=-1)
    return torch.multinomial(probs, num_samples=1)
```

### 8.5 Temperature 控制

Temperature T 控制分布的"尖锐程度"：

```
logits_T = logits / T

T < 1.0（低温）：分布更尖锐，更确定性（T→0 趋近贪心）
T = 1.0（标准）：原始分布
T > 1.0（高温）：分布更平坦，更随机（T→∞ 趋近均匀分布）
```

```
T=0.1:  Paris(0.99), Lyon(0.01)   ← 几乎总是 Paris
T=1.0:  Paris(0.50), Lyon(0.20)   ← 标准分布
T=2.0:  Paris(0.32), Lyon(0.24)   ← 更多样化但更随机

数学推导：
softmax(logits/T)ᵢ = exp(zᵢ/T) / Σⱼ exp(zⱼ/T)

当 T→0：最大 logit 的概率 → 1（贪心）
当 T→∞：所有概率 → 1/vocab_size（均匀）
```

**Temperature 与 Top-p 的组合使用：**

```python
# 实践中常见的组合：先缩放温度，再 Top-p 采样
# 对话场景：temperature=0.7, top_p=0.9（均衡质量与多样性）
# 代码生成：temperature=0.2, top_p=0.95（更确定性）
# 创意写作：temperature=1.2, top_p=0.95（更多创意）
```

### 8.6 HuggingFace `generate()` 源码剖析

`generate()` 方法定义在 `transformers/generation/utils.py` 的 `GenerationMixin` 中，是解码策略的统一入口：

```python
# 源码：GenerationMixin.generate()（核心流程简化）
def generate(self, inputs, generation_config=None, **kwargs):
    # ① 解析生成配置
    generation_config = self._get_generation_config(generation_config, **kwargs)

    # ② 根据配置选择解码模式
    if generation_config.num_beams == 1:
        if generation_config.do_sample:
            # 采样模式（Top-k / Top-p / Temperature）
            return self._sample(input_ids, logits_processor, stopping_criteria, ...)
        else:
            # 贪心模式
            return self._greedy_search(input_ids, logits_processor, ...)
    else:
        if generation_config.do_sample:
            # Beam + 采样
            return self._beam_sample(...)
        else:
            # 标准 Beam Search
            return self._beam_search(...)
```

**LogitsProcessor 机制：**

`generate()` 通过 `LogitsProcessor` 链式处理 logits，支持灵活扩展：

```python
# 源码：transformers/generation/logits_process.py

class TemperatureLogitsWarper(LogitsWarper):
    """Temperature 缩放"""
    def __call__(self, input_ids, scores):
        scores = scores / self.temperature
        return scores

class TopKLogitsWarper(LogitsWarper):
    """Top-k 过滤"""
    def __call__(self, input_ids, scores):
        top_k = min(self.top_k, scores.size(-1))
        indices_to_remove = scores < torch.topk(scores, top_k)[0][..., -1, None]
        scores = scores.masked_fill(indices_to_remove, self.filter_value)
        return scores

class TopPLogitsWarper(LogitsWarper):
    """Top-p（Nucleus）过滤"""
    def __call__(self, input_ids, scores):
        sorted_logits, sorted_indices = torch.sort(scores, descending=False)
        cumulative_probs = sorted_logits.softmax(dim=-1).cumsum(dim=-1)
        sorted_indices_to_remove = cumulative_probs <= (1 - self.top_p)
        scores = scores.scatter(1, sorted_indices, sorted_logits.masked_fill(
            sorted_indices_to_remove, self.filter_value))
        return scores

# 使用示例：自定义解码策略
from transformers import LogitsProcessorList, TemperatureLogitsWarper, TopPLogitsWarper

output = model.generate(
    input_ids,
    do_sample=True,
    temperature=0.8,
    top_p=0.9,
    max_new_tokens=200,
    repetition_penalty=1.1,      # 惩罚重复 token
    no_repeat_ngram_size=3,      # 禁止重复三元组
)
```

**解码策略选择指南：**

| 场景 | 推荐策略 | 典型参数 |
|------|---------|---------|
| 事实性问答 | 贪心 / 低温采样 | `temperature=0.3` |
| 代码生成 | 低温 + Top-p | `temperature=0.2, top_p=0.95` |
| 对话 | 中温 + Top-p | `temperature=0.7, top_p=0.9` |
| 创意写作 | 高温 + Top-p | `temperature=1.1, top_p=0.95` |
| 摘要 | Beam Search | `num_beams=4, length_penalty=0.8` |
| 机器翻译 | Beam Search | `num_beams=5, no_repeat_ngram_size=2` |

---

## 9. 常见问题与最佳实践

**Q1：为什么训练时用 Teacher Forcing，推理时不用？**

Teacher Forcing 是指训练时将真实 token（而非模型预测的 token）作为下一步的输入，以加速训练收敛。但这导致训练和推理的分布不一致（Exposure Bias）——推理时模型必须消化自己生成的可能错误 token。这是 GPT 类模型的固有问题，部分通过大量训练数据缓解。

**Q2：增大 Batch Size 和增大模型参数量，哪个更有效？**

参考 Scaling Laws：在固定计算预算下，增大参数量的收益（指数约 0.5-0.73）通常优于增大批大小。但批大小影响训练稳定性和收敛速度——过小的批大小导致梯度噪声大，过大则梯度方向信息冗余。实践中，先找到最优批大小，再在计算预算内最大化模型参数量。

**Q3：BPE 分词后，中文一个字变成多少 token？**

以 LLaMA 3 为例（128K 词表，含中文子词）：
- 常见汉字：1 token（直接在词表中）
- 不常见汉字：2-4 个 UTF-8 字节 = 2-4 个 token
- LLaMA 1（32K 词表）：每个中文字约 1-3 个 token（词表中中文覆盖少）
- LLaMA 3（128K 词表）：大多数汉字为 1 token（词表扩展了中文覆盖）

**Q4：Attention 的 O(L²) 复杂度在实践中何时成为瓶颈？**

对于大多数任务（L < 8192），FFN 的计算量（O(L × d²)）通常主导。但对于长文档处理（L > 32K），Attention 的内存占用（L² × H × dtype_bytes）会先触发 OOM。FlashAttention 通过分块计算将内存降为 O(L)，解决了这一问题。

**Q5：如何判断一个模型是否"过度训练"（超出 Chinchilla 最优）？**

计算 `tokens_per_param = total_training_tokens / num_parameters`：
- Chinchilla 最优：约 20 tokens/param
- 适度超训练（推理优化）：100-200 tokens/param（如 LLaMA 2）
- 极度超训练：1000+ tokens/param（如 LLaMA 3 8B）

超训练的收益：同等参数量下，推理延迟更低，质量更高（比更大但欠训练的模型更好）。

---

> **扩展阅读：**
> - [Attention Is All You Need (2017)](https://arxiv.org/abs/1706.03762)
> - [Language Models are Few-Shot Learners / GPT-3 (2020)](https://arxiv.org/abs/2005.14165)
> - [Training Compute-Optimal LLMs / Chinchilla (2022)](https://arxiv.org/abs/2203.15556)
> - [LLaMA: Open and Efficient Foundation Language Models (2023)](https://arxiv.org/abs/2302.13971)
> - [RoFormer: Enhanced Transformer with Rotary Position Embedding (2021)](https://arxiv.org/abs/2104.09864)
> - [HuggingFace Transformers 源码：modeling_llama.py](https://github.com/huggingface/transformers/blob/main/src/transformers/models/llama/modeling_llama.py)
> - [meta-llama/llama 参考实现](https://github.com/meta-llama/llama)
