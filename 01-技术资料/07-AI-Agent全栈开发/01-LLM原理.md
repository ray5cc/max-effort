# 01-LLM原理 — 技术资料

> 从 `modeling_llama.py` 源码出发，系统推导 Transformer 自注意力机制、位置编码演进、预训练范式、Tokenizer 算法、Scaling Laws 和解码策略的核心原理；并深入讲解 MoE 稀疏架构、推理模型（o1/R1）、多模态大模型和长上下文技术等 2025-2026 前沿进展，覆盖 LLM 工程师必须掌握的底层知识。

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
10. [MoE（Mixture of Experts）架构](#10-moemixture-of-experts架构)
    - 10.1 为什么需要 MoE
    - 10.2 稀疏 MoE 核心原理
    - 10.3 路由算法
    - 10.4 Mixtral 8x7B 架构分析
    - 10.5 MoE 训练挑战
    - 10.6 DeepSeek-MoE 创新
11. [推理模型（Reasoning Models）](#11-推理模型reasoning-models)
    - 11.1 推理模型的范式转变
    - 11.2 Test-time Compute Scaling
    - 11.3 OpenAI o1/o3 工作原理
    - 11.4 DeepSeek-R1
    - 11.5 推理 Token 的经济学
    - 11.6 推理模型的限制
12. [多模态大模型（Multimodal LLMs）](#12-多模态大模型multimodal-llms)
    - 12.1 多模态的动机
    - 12.2 Vision Transformer（ViT）
    - 12.3 图像 Token 化策略
    - 12.4 多模态融合架构
    - 12.5 主流多模态模型对比
    - 12.6 音频模态
13. [长上下文技术（Long Context）](#13-长上下文技术long-context)
    - 13.1 长上下文的挑战
    - 13.2 位置编码外推
    - 13.3 滑动窗口注意力
    - 13.4 稀疏注意力
    - 13.5 Ring Attention
    - 13.6 实际应用与评测
    - 13.7 长上下文 vs RAG

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

**Q6：MoE 模型的参数量等于计算量吗？**

不等于。MoE 模型的**总参数量**包含所有 Expert 的参数，但每次推理只激活其中一部分（通常 Top-2）。以 Mixtral 8x7B 为例，总参数约 46.7B，但每次前向传播只激活约 12.9B 参数。因此评估 MoE 模型的推理成本时，应关注**激活参数量**（Active Parameters）而非总参数量。

**Q7：所有任务都应该用推理模型（如 o1/o3）吗？**

不应该。推理模型通过大量内部思考 token 来提升复杂推理能力，但对简单任务（翻译、摘要、信息提取）来说，这些额外推理 token 既浪费成本又增加延迟。决策框架：需要多步逻辑推理、数学证明、代码调试 → 推理模型；模式匹配、格式转换、简单问答 → 标准模型。

**Q8：有了长上下文（128K+），还需要 RAG 吗？**

需要。长上下文和 RAG 是互补而非替代关系。长上下文适合文档数量有限且需要全局理解的场景（如分析一份完整合同）；RAG 适合知识库庞大（远超上下文窗口）、需要实时更新、或需要精确引用溯源的场景。此外，长上下文的 KV Cache 内存成本与序列长度线性增长，塞入过多内容会显著增加延迟和费用。

---

## 10. MoE（Mixture of Experts）架构

### 10.1 为什么需要 MoE

**问题背景：密集模型的计算瓶颈**

传统 Transformer 模型是**密集（Dense）模型**——每个 token 都必须通过模型的所有参数进行计算。当我们想提升模型能力时，通常需要增大参数量，但这意味着计算成本也线性增长。假设一个 70B 密集模型每次推理需要 70B 次乘加操作，那么一个 700B 的密集模型就需要 700B 次——成本直接翻 10 倍。

**核心矛盾**：我们希望模型拥有更多知识（更多参数），但不希望每次推理都用到所有参数。

> **生活类比：公司专家团队**
>
> 想象一家拥有 100 位专家的咨询公司。当客户提出一个法律问题时，不需要 100 位专家全部参与——只需要 2-3 位法律专家即可。但这家公司确实**拥有** 100 位专家的知识储备，使其能处理各种领域的问题。MoE 模型就是这个思路：拥有大量参数（专家），但每次只激活少数几个。

**密集模型 vs MoE 模型的核心差异：**

```
密集模型（Dense）：每个 token 激活 100% 参数
──────────────────────────────────────────
  输入 token → [所有参数参与计算] → 输出
  计算量 = 总参数量 × 2（乘加）

MoE 模型（Sparse）：每个 token 只激活 ~25% 参数
──────────────────────────────────────────
  输入 token → [路由器选择 2/8 个 Expert] → 输出
  计算量 ≈ (共享参数 + 2个Expert参数) × 2
  知识容量 = 全部 8 个 Expert 的参数总和
```

### 10.2 稀疏 MoE 核心原理

MoE 的核心思想是将 Transformer 中的**FFN（前馈网络）层**替换为多个并行的 Expert 网络，并引入一个 Gating Network（门控网络/路由器）来决定每个 token 应该被哪些 Expert 处理。

**三大核心组件：**

```
MoE Layer 架构示意图
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

                    ┌─────────────────┐
                    │   输入 Token x   │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Gating Network  │  g(x) = Softmax(W_g · x)
                    │   （路由器）      │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │ Top-K 选择    │              │
              │ (通常 K=2)    │              │
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │ Expert 1 │  │ Expert 2 │  │ Expert 3 │  ... Expert N
        │  (FFN)   │  │  (FFN)   │  │  (FFN)   │     (未被选中
        └────┬─────┘  └────┬─────┘  └──────────┘      不参与计算)
             │ g₁          │ g₂
             │             │
             ▼             ▼
        ┌──────────────────────┐
        │  输出 = g₁·E₁(x)     │
        │       + g₂·E₂(x)     │  加权求和
        └──────────────────────┘

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**1. Expert 网络**

每个 Expert 本质上就是一个标准的 FFN（或 SwiGLU FFN），结构与密集 Transformer 中的 FFN 完全相同：

```
Expert_i(x) = W₂ · σ(W₁ · x)    # 标准 FFN
Expert_i(x) = W₂ · (SiLU(W₁ · x) ⊙ W₃ · x)  # SwiGLU 变体
```

所有 Expert 共享相同的架构，但参数独立——这意味着不同 Expert 可以学习不同领域的知识。

**2. Gating Network（路由器）**

路由器是一个简单的线性层 + Softmax，将输入 token 映射到 N 个 Expert 的概率分布上：

```
g(x) = Softmax(W_g · x)     # W_g ∈ ℝ^{N×d}，N=Expert数量
```

其中 `g(x)_i` 表示第 i 个 Expert 被选中的概率。

**3. Top-K 选择与加权输出**

为了保证稀疏性，只选择概率最高的 K 个 Expert（通常 K=2），其余 Expert 的门控权重置零：

```
TopK(g(x)) = { g(x)_i  if i ∈ Top-K indices
             { 0        otherwise

output = Σᵢ TopK(g(x))_i · Expert_i(x)
```

被置零的 Expert 不参与前向计算，从而节省了计算量。

### 10.3 路由算法

路由算法是 MoE 架构的核心难题——如何让 token 高效、均衡地分配到各 Expert。

**Token-level Routing vs Sequence-level Routing**

| 路由粒度 | 说明 | 代表模型 |
|---------|------|---------|
| Token-level | 每个 token 独立路由到不同 Expert | Mixtral、DeepSeek-MoE |
| Sequence-level | 整个序列路由到相同的 Expert 集合 | 早期 MoE 研究 |
| Expert-level | Expert 主动选择要处理的 token | Expert Choice Routing |

Token-level Routing 是目前的主流选择，因为同一段话中不同 token 可能涉及不同领域（如一句话里既有数学符号又有自然语言），让每个 token 独立选择 Expert 更灵活。

**负载均衡损失函数**

如果完全依靠路由器自然学习，往往会出现**路由坍塌（Routing Collapse）**——大部分 token 被路由到少数几个"明星" Expert，其余 Expert 几乎不被使用。为了避免这个问题，需要引入辅助损失函数强制负载均衡：

```
L_balance = α · N · Σᵢ fᵢ · pᵢ

其中：
  N = Expert 数量
  fᵢ = 分配到 Expert i 的 token 占比（实际负载）
  pᵢ = 路由器分配给 Expert i 的平均概率
  α = 平衡系数（通常 0.01）

直觉：如果某个 Expert 既被分配了很多 token（fᵢ 大），
      路由器还给它很高的概率（pᵢ 大），
      则 fᵢ × pᵢ 很大，损失函数会惩罚这种不均衡。
理想状态：每个 Expert 处理 1/N 的 token → fᵢ = pᵢ = 1/N
```

### 10.4 Mixtral 8x7B 架构分析

Mixtral 8x7B 是 Mistral AI 在 2023 年底发布的开源 MoE 模型，以清晰的架构和出色的性能成为理解 MoE 的最佳案例。

**架构参数：**

```
Mixtral 8x7B 架构详解
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
模型维度 (d_model)      : 4096
注意力头数              : 32 heads（Q）, 8 heads（KV, GQA）
层数                    : 32 Decoder Layers
Expert 数量             : 8 per layer
每次激活 Expert 数       : 2 (Top-2)
单个 Expert FFN 维度     : 14336
词表大小                : 32000
上下文长度              : 32768

参数量分析：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
共享参数（Attention + Embedding）:
  Attention per layer = 4096 × 4096 × 4 = 67M（Q/K/V/O 矩阵）
  × 32 layers = ~2.1B
  Embedding = 4096 × 32000 = ~131M
  共享参数合计 ≈ 2.3B

Expert 参数（MoE FFN）:
  单个 Expert FFN = 4096 × 14336 × 3 = ~176M（W₁/W₂/W₃）
  × 8 Experts × 32 layers = ~45.1B

总参数量 ≈ 46.7B
每次推理激活参数 ≈ 2.3B + (176M × 2 × 32) ≈ 12.9B
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**关键洞察**：Mixtral 拥有 46.7B 的知识容量，但每次推理只需 12.9B 的计算成本——相当于一个 13B 密集模型的推理速度，但性能接近 70B 密集模型。

```
密集模型 vs Mixtral 8x7B 结构对比（单层）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

密集模型（如 LLaMA-2 70B）:
┌──────────────────────────────────────────┐
│ Attention → RMSNorm → FFN(d=28672) → +  │  ← 每个 token 全量计算
└──────────────────────────────────────────┘

Mixtral 8x7B:
┌──────────────────────────────────────────────────┐
│ Attention(GQA) → RMSNorm → Router → Top-2 FFN → + │
│                              │                      │
│              ┌───────────────┼───────────────┐      │
│              ▼               ▼               │      │
│         Expert_3(14336)  Expert_7(14336)      │      │
│           ↓  g₃=0.6       ↓  g₇=0.4        │      │
│              └───────┬───────┘               │      │
│                      ▼                       │      │
│              加权求和输出                      │      │
└──────────────────────────────────────────────────┘
   ← 只有 2/8 Expert 参与计算
```

### 10.5 MoE 训练挑战

**1. Expert Collapse（专家坍塌）**

如果某些 Expert 在训练早期获得了更多梯度更新（因为被路由了更多 token），它们会变得"更强"，从而吸引更多 token，形成正反馈循环。最终，只有少数 Expert 被频繁使用，其余 Expert 参数几乎不更新，成为"死 Expert"。

解决方案：
- 负载均衡损失函数（如上节所述）
- Expert 容量限制（Capacity Factor）：每个 Expert 每次最多处理 C × (T/N) 个 token，超出的 token 被丢弃或重路由
- Jitter Noise：在路由器输出上添加噪声，增加探索性

**2. 负载不均衡的通信开销**

在分布式训练中，不同 Expert 通常分布在不同 GPU 上。Token-level Routing 意味着每个 token 可能被路由到任意 GPU 上的 Expert，导致大量的 All-to-All 通信。如果负载不均衡，部分 GPU 会成为瓶颈，其余 GPU 空闲等待。

```
分布式 MoE 通信示意
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GPU 0           GPU 1           GPU 2           GPU 3
┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
│Expert 0,1│   │Expert 2,3│   │Expert 4,5│   │Expert 6,7│
└─────────┘   └─────────┘   └─────────┘   └─────────┘
     ↑  ↕           ↕             ↕           ↕  ↑
     │  └───────────┴─────────────┴───────────┘  │
     │         All-to-All 通信（高带宽需求）        │
     └───────────────────────────────────────────┘

Token 需要跨 GPU 传输到对应的 Expert → 通信成为瓶颈
```

**3. 训练不稳定**

MoE 模型的路由决策是离散的（选哪个 Expert），这使得训练过程中梯度不连续。常见缓解措施包括：使用更低的学习率、更大的 batch size、以及在训练初期使用更高的 auxiliary loss 系数。

### 10.6 DeepSeek-MoE 创新

DeepSeek 团队在 MoE 架构上提出了两项关键创新，显著缓解了传统 MoE 的问题：

**1. 细粒度 Expert（Fine-grained Expert Segmentation）**

传统 MoE 使用少量大 Expert（如 Mixtral 的 8 个）。DeepSeek-MoE 将 Expert 拆分为更多更小的单元——例如将 8 个大 Expert 拆分为 64 个小 Expert，每次激活 8 个。这带来了更灵活的知识组合能力：

```
传统 MoE：8 个大 Expert，激活 2 个
  → 组合数 = C(8,2) = 28 种

DeepSeek-MoE：64 个小 Expert，激活 8 个
  → 组合数 = C(64,8) = 4,426,165,368 种
  → 更精细的知识选择和组合
```

**2. 共享 Expert（Shared Expert Isolation）**

DeepSeek-MoE 引入了若干**共享 Expert**，它们不参与路由选择，而是**始终被激活**。共享 Expert 捕获通用知识（如语法、常识），路由 Expert 专注于领域特定知识（如数学、代码）：

```
DeepSeek-MoE 架构
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

          ┌──────────────┐
          │  输入 Token   │
          └──────┬───────┘
                 │
         ┌───────┴───────┐
         │               │
         ▼               ▼
  ┌─────────────┐  ┌──────────┐
  │ 共享 Expert  │  │  Router  │
  │ (始终激活)   │  │ (门控)   │
  │ E_s1, E_s2  │  └────┬─────┘
  └──────┬──────┘       │ Top-K 选择
         │        ┌─────┼─────┐
         │        ▼     ▼     ▼
         │    ┌────┐ ┌────┐ ┌────┐
         │    │E_r3│ │E_r7│ │E_r1│ ... (64个路由Expert)
         │    └──┬─┘ └──┬─┘ └──┬─┘
         │       └──────┼──────┘
         │              │
         └──────┬───────┘
                ▼
         加权求和输出

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
共享 Expert 捕获通用知识 → 减轻路由 Expert 的负担
路由 Expert 专注领域知识 → 提升专业能力
```

这种设计在 DeepSeek-V2（236B 总参数，21B 激活）和 DeepSeek-V3 中取得了极佳效果，以远低于同等密集模型的推理成本达到了接近的性能。

---

## 11. 推理模型（Reasoning Models）

### 11.1 推理模型的范式转变

**从"快速回复"到"深度思考"**

传统 LLM 的工作方式是：收到问题后，逐 token 生成答案，每个 token 的生成只经过一次前向传播。这就像考试时**不打草稿直接写答案**——对于简单题目没问题，但对于需要多步推理的复杂问题，往往会出错。

> **生活类比：考试时打草稿**
>
> 普通学生（传统 LLM）：看到题目直接写答案，写错了就错了。
> 优等生（推理模型）：先在草稿纸上演算、验证、尝试不同思路，确认无误后再写出最终答案。草稿纸上的演算过程就是"推理 Token"。
>
> 推理模型的代价是什么？时间（延迟）和草稿纸（推理 Token 的计算成本）。但对于复杂问题，这个代价换来了显著更高的准确率。

**范式对比：**

```
传统 LLM（GPT-4、Claude 标准模式）：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  用户问题 → [一次前向] → 直接输出答案
  特点：快速、低成本、适合大部分任务

推理模型（o1/o3、DeepSeek-R1）：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  用户问题 → [内部推理过程：数百~数千推理 token]
           → [验证与回溯]
           → [最终答案]
  特点：慢速、高成本、适合数学/代码/复杂推理
```

### 11.2 Test-time Compute Scaling

传统的 Scaling Laws 关注**训练时计算量**（Training Compute）：投入更多 GPU 时间训练更大模型，性能会可预测地提升。推理模型引入了一个新维度——**推理时计算量**（Test-time Compute）：在推理阶段投入更多计算，让模型"想更久"，也能提升性能。

**两个维度的 Scaling 对比：**

```
┌─────────────────────────────────────────────────┐
│              模型性能                              │
│                                                   │
│  ▲                                                │
│  │           ╱ 训练 Scaling                        │
│  │         ╱   (更大模型、更多数据)                  │
│  │       ╱                                        │
│  │     ╱────── 推理 Scaling                        │
│  │   ╱         (更多推理 token、更多搜索)            │
│  │ ╱                                              │
│  └──────────────────────────► 计算量              │
└─────────────────────────────────────────────────┘

关键发现（2024-2025）：
  - 两种 Scaling 可以互相替代
  - 小模型 + 大量推理计算 ≈ 大模型 + 少量推理计算
  - 但存在收益递减点：推理 token 超过某个阈值后，继续增加收益很小
```

**数学直觉**：如果训练计算量为 C_train，推理计算量为 C_test，那么模型在困难任务上的有效性能大致与 `f(C_train) + g(C_test)` 相关，其中 f 和 g 都是递增的凹函数（收益递减）。

### 11.3 OpenAI o1/o3 工作原理

OpenAI 的 o1（2024 年 9 月）和 o3（2024 年 12 月）系列是推理模型的开创者。虽然具体实现未完全公开，但根据公开论文和社区研究，核心机制可以归纳为：

**Chain-of-Thought at Scale（大规模思维链）**

o1 的核心思路是将 Chain-of-Thought（CoT）从提示工程技巧升级为**模型内部的原生能力**：

```
传统 CoT（外部 Prompt 引导）：
  用户：请一步步思考。9.11 和 9.8 哪个大？
  模型：让我一步步分析...

o1 内部 CoT（模型自主推理）：
  用户：9.11 和 9.8 哪个大？
  模型内部（推理 token，用户不可见）：
    <thinking>
    比较 9.11 和 9.8
    整数部分都是 9，比较小数部分
    0.11 vs 0.8
    0.8 = 0.80，0.80 > 0.11
    所以 9.8 > 9.11
    等等，让我验证一下...
    9.8 - 9.11 = 0.69 > 0
    确认 9.8 > 9.11 ✓
    </thinking>
  模型输出：9.8 更大。
```

**训练方法推测**：

o1 的训练过程可能包含：
1. **大规模 CoT 数据收集**：通过人工标注和模型生成，收集包含详细推理步骤的训练数据
2. **过程奖励模型（Process Reward Model, PRM）**：不仅奖励正确的最终答案，还奖励正确的推理步骤
3. **强化学习（RL）优化**：使用 RL 训练模型学会何时需要更深入的推理、何时需要回溯检查
4. **推理 Token 机制**：模型学会生成内部推理 token（不输出给用户），作为"草稿纸"

### 11.4 DeepSeek-R1

DeepSeek-R1（2025 年 1 月）是第一个**完全开源**的推理模型，其训练方法对社区影响深远。

**GRPO（Group Relative Policy Optimization）训练方法**

DeepSeek-R1 的核心创新是使用纯强化学习（不依赖大量人工标注的 CoT 数据）训练推理能力：

```
GRPO 训练流程
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. 采样阶段：
   对同一问题，让模型生成 G 个不同的完整回答
   （如 G=64 个回答，通过不同的采样随机性）

2. 评估阶段：
   对每个回答计算奖励 r_i：
   - 答案正确性（数学题可自动验证）
   - 格式正确性（是否按要求输出 <thinking>...</thinking>）

3. 组内归一化：
   A_i = (r_i - mean(r)) / std(r)     # 组内相对优势
   → 不需要单独训练 Critic/Value 模型（PPO 需要）

4. 策略更新：
   最大化 E[A_i · log π(a_i|s)]       # 鼓励相对更优的回答
   + KL 惩罚项（防止偏离参考模型太远）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
关键优势：
  - 不需要训练 Value 模型 → 节省显存
  - 不需要人工标注 CoT → 可扩展
  - 模型自发学会推理、验证、回溯等行为
```

**R1 的"顿悟时刻"（Aha Moment）**

DeepSeek 团队发现了一个令人惊奇的现象：在纯 RL 训练过程中，模型**自发地**学会了以下行为，而这些行为从未被显式教授：

- 自我验证（"让我检查一下这个计算"）
- 回溯探索（"这个方法行不通，换一种思路"）
- 步骤分解（将复杂问题拆分为子问题）
- 反思纠错（"等等，上面的推理有个错误"）

这说明推理能力可以通过恰当的奖励信号从大模型中**涌现**出来，而不需要依赖人工标注的推理轨迹。

### 11.5 推理 Token 的经济学

推理模型的一个重要实践考量是成本分析——推理 token 的成本结构与普通输出 token 截然不同：

```
成本结构对比（以 API 定价为例）：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    输入 Token    输出 Token    推理 Token
标准模型 (GPT-4o)   $2.5/M       $10/M         不适用
推理模型 (o3)       $2/M         $8/M          $8/M（内部）

典型场景成本分析：
  简单问答（100 in + 200 out）：
    GPT-4o:  $0.00225
    o3:      $0.0018 + 推理 token（~500）= $0.006
    → o3 贵约 2.5 倍，但准确率无差异

  复杂数学推理（200 in + 500 out）：
    GPT-4o:  $0.0055（但可能答错）
    o3:      $0.0044 + 推理 token（~3000）= $0.028
    → o3 贵约 5 倍，但准确率可能从 40% 提升到 90%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**决策框架：何时使用推理模型？**

| 任务类型 | 推荐模型 | 理由 |
|---------|---------|------|
| 数学竞赛/证明 | 推理模型 | 需要多步推理和验证 |
| 复杂代码调试 | 推理模型 | 需要追踪执行流程和逻辑 |
| 法律/医学分析 | 推理模型 | 需要严谨的逻辑推理链 |
| 简单问答/翻译 | 标准模型 | 无需深度推理，推理 token 浪费 |
| 文本摘要 | 标准模型 | 模式匹配任务，不需要推理 |
| 批量数据处理 | 标准模型 | 成本敏感，推理模型成本过高 |

### 11.6 推理模型的限制

1. **延迟显著增加**：推理 token 需要逐个生成，1000 个推理 token ≈ 额外 5-15 秒等待。对于实时交互（如聊天机器人），这可能是不可接受的。

2. **推理并非万能**：推理模型在**模式匹配**类任务上不一定优于标准模型。例如，文本分类、情感分析、信息提取等任务，标准模型已经能做得很好。

3. **推理 token 可能"跑偏"**：模型可能进入无意义的推理循环（反复检查已确认的结论），浪费推理预算。目前需要通过 `max_completion_tokens` 等参数限制推理长度。

4. **训练数据偏差**：推理模型在数学和编程等可验证任务上效果最好（因为训练时的奖励信号明确），但在开放式推理（哲学论证、创意分析）上优势不明显。

---

## 12. 多模态大模型（Multimodal LLMs）

### 12.1 多模态的动机

**从纯文本到理解世界**

早期 LLM 只能处理文本——这相当于一个人只有"阅读"能力，看不到图片、听不到声音。但现实世界的信息是多模态的：用户可能会拍一张错误截图让你调试、发一段语音描述需求、或者上传一份图表让你分析。

> **生活类比：五感**
>
> 人类通过五种感官（视觉、听觉、触觉、嗅觉、味觉）理解世界。纯文本 LLM 就像一个只有"阅读"能力的人——能力有限。多模态 LLM 相当于给这个人增加了"视觉"（图像理解）和"听觉"（语音理解）——虽然还不完整，但已经能处理绝大多数数字世界的任务。

**多模态模型的核心挑战**：如何将图像、音频等非文本信息转化为 LLM 能理解的 token 序列？

```
多模态 LLM 的核心思路
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  图像 ──→ [Vision Encoder] ──→ 图像 Token 序列 ──┐
                                                   │
  文本 ──→ [Text Tokenizer] ──→ 文本 Token 序列 ──┼→ [LLM] → 输出
                                                   │
  音频 ──→ [Audio Encoder] ──→ 音频 Token 序列 ──┘

关键：所有模态都被转化为统一的 Token 序列，
     共享同一个 Transformer 架构进行处理
```

### 12.2 Vision Transformer（ViT）

Vision Transformer 是将图像输入到 Transformer 架构中的关键技术。它的核心思想是：**将图像切割成固定大小的 Patch，每个 Patch 当作一个"视觉 Token"**。

> **类比：拼图**
>
> 把一张完整的照片想象成一幅拼图。ViT 的做法是把这幅拼图拆成一个个小方块（16×16 像素的 Patch），然后让模型"阅读"这些方块的序列，就像阅读一段文字一样。

**Patch Embedding 过程：**

```
原始图像 (224 × 224 × 3 RGB)
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 1: 切割为 Patch
  Patch 大小 = 16 × 16
  Patch 数量 = (224/16) × (224/16) = 14 × 14 = 196 个 Patch

Step 2: 线性投影
  每个 Patch (16 × 16 × 3 = 768 维向量)
  → 通过线性层 W_p ∈ ℝ^{768×d} 投影到 d 维嵌入空间
  → 得到 196 个 d 维的 Patch Embedding

Step 3: 添加位置编码
  加入可学习的位置编码（或 2D 正弦编码）
  → 告诉模型每个 Patch 在图像中的位置

Step 4: 添加 [CLS] Token（可选）
  在序列开头添加一个特殊 token，用于聚合全局信息

最终输入到 Transformer:
  [CLS] [P_1] [P_2] ... [P_196]
  ↑                          ↑
  全局分类 token           196 个视觉 token

━━━━━━━━━━━━━━━━━━━━━━━━━━━
196 个视觉 token 与文本 token 地位等同，
可以与文本 token 拼接后一起送入 LLM
```

**ViT 与文本 Token 的统一**

这种设计的精妙之处在于：图像 Patch 经过投影后，在数学上与文本 Token Embedding 没有本质区别——都是 d 维向量。这意味着 Transformer 的 Self-Attention 可以同时在文本 token 和视觉 token 之间计算注意力，实现跨模态理解。

### 12.3 图像 Token 化策略

不同模型采用了不同的图像 Token 化策略，核心权衡是**分辨率 vs Token 数量 vs 计算成本**：

**固定分辨率 vs 动态分辨率**

```
固定分辨率（早期方法）：
  所有图像统一缩放到 224×224 → 196 tokens
  问题：高分辨率图像的细节丢失严重

动态分辨率（现代方法）：
  根据图像实际尺寸动态调整 → token 数量不固定

  ┌─────────────────────────────────────────┐
  │        Tile-based 方法（GPT-4V 等）      │
  │                                         │
  │  高分辨率图像 (1024 × 768)               │
  │  → 先生成低分辨率概览 (224×224 = 196 tok) │
  │  → 再切割为多个 Tile，每个 224×224        │
  │                                         │
  │  ┌──────┬──────┬──────┬──────┐          │
  │  │Tile 1│Tile 2│Tile 3│Tile 4│          │
  │  │196tok│196tok│196tok│196tok│          │
  │  └──────┴──────┴──────┴──────┘          │
  │  + 低分辨率概览 196 tok                  │
  │  = 总计 ~980 tokens                     │
  │                                         │
  │  更高分辨率 → 更多 Tile → 更多 Token     │
  │  → 更高成本但更高细节保留                 │
  └─────────────────────────────────────────┘
```

**Token 数量与成本的关系**：

以 GPT-4V 为例，一张 1024×1024 的图像约消耗 765 tokens。这意味着一张图片的处理成本约等于一段 500 字的中文文本。在设计多模态应用时，图像分辨率的选择直接影响 API 成本和延迟。

### 12.4 多模态融合架构

如何将视觉 token 和文本 token "融合"是多模态模型的关键架构决策：

```
三种融合架构对比
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Early Fusion（早期融合）
   ┌────────────────────────────────┐
   │ [图像tokens] [文本tokens] → LLM │
   │  直接拼接后送入同一个 Transformer │
   └────────────────────────────────┘
   代表：Gemini、Fuyu
   优点：模态间可以从底层开始交互
   缺点：需要从头训练，无法复用纯文本 LLM

2. Late Fusion（晚期融合）
   ┌────────────────────────────────────┐
   │ 图像 → [Vision Encoder] → 图像特征 │
   │ 文本 → [LLM] → 文本特征            │
   │ 图像特征 + 文本特征 → [融合层] → 输出│
   └────────────────────────────────────┘
   代表：CLIP（对比学习阶段）
   优点：各编码器可独立预训练
   缺点：模态交互太晚，理解深度有限

3. Cross-Attention Fusion（交叉注意力融合）
   ┌──────────────────────────────────────┐
   │ 图像 → [Vision Encoder] → 视觉特征   │
   │                    ↓ (作为 K, V)      │
   │ 文本 → [LLM 层 with Cross-Attn] → 输出│
   │         ↑ (文本作为 Q)                 │
   └──────────────────────────────────────┘
   代表：Flamingo、LLaVA（变体）
   优点：可复用预训练 LLM，视觉信息按需注入
   缺点：需要额外的 Cross-Attention 参数
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**当前主流方案**：大多数现代多模态 LLM（LLaVA、Qwen-VL、InternVL）采用 Early Fusion 的变体——将预训练 Vision Encoder（如 CLIP ViT）的输出通过一个投影层（MLP Projector）映射到 LLM 的嵌入空间，然后与文本 token 拼接后送入预训练 LLM。

### 12.5 主流多模态模型对比

| 模型 | Vision Encoder | LLM | 融合方式 | 最大分辨率 | 特色 |
|------|---------------|-----|---------|-----------|------|
| GPT-4V/4o | 未公开 | GPT-4 | 未公开 | 动态 Tile | 综合能力最强，OCR/图表理解优秀 |
| Claude Vision | 未公开 | Claude 3.5+ | 未公开 | 动态 | 长文档理解、代码截图分析 |
| Gemini 2.0 | 原生多模态 | 原生多模态 | Early Fusion | 原生支持 | 原生多模态训练（非后接） |
| LLaVA-NeXT | CLIP ViT-L | LLaMA/Vicuna | MLP Projector | 动态 Tile | 开源标杆，社区活跃 |
| Qwen-VL | ViT-bigG | Qwen | Cross-Attn | 动态 | 中文多模态能力强 |

**关键差异**：Gemini 是从头以多模态目标训练的（原生多模态），而大多数其他模型是在预训练好的纯文本 LLM 上"接入"视觉能力的。原生多模态训练理论上能实现更深度的跨模态理解，但需要更大的训练投入。

### 12.6 音频模态

音频模态的处理与图像模态遵循相似的"编码为 Token → 融合到 LLM"范式。

**Whisper 架构**

OpenAI 的 Whisper 是目前最广泛使用的语音编码器，其架构是标准的 Encoder-Decoder Transformer：

```
Whisper 架构
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  音频波形 (16kHz)
       │
       ▼
  [Log-Mel 频谱图] → 80 个频率 bins × T 帧
       │
       ▼
  ┌─────────────────────┐
  │  Encoder (Transformer)│  → 音频特征序列
  │  - 2层 Conv1D 下采样   │
  │  - N 层 Self-Attention │
  └──────────┬──────────┘
             │
             ▼
  ┌─────────────────────┐
  │  Decoder (Transformer)│  → 文本 Token 序列
  │  - Cross-Attention    │     (转录结果)
  │  - 自回归生成         │
  └─────────────────────┘

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**语音 Agent 应用**

在 AI Agent 场景中，语音模态的集成通常遵循以下流程：

```
实时语音 Agent Pipeline
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  用户语音 → [Whisper/ASR] → 文本 → [LLM] → 文本回复
                                                │
                                                ▼
                                         [TTS 引擎] → 语音输出

2025 新趋势：端到端语音模型
  用户语音 → [多模态 LLM（直接理解语音 Token）] → 语音/文本输出
  代表：GPT-4o 实时语音、Gemini Live
  优势：保留语气、情感、韵律等声学信息
       延迟更低（省去 ASR 中间步骤）
```

---

## 13. 长上下文技术（Long Context）

### 13.1 长上下文的挑战

**为什么长上下文是个难题？**

标准 Self-Attention 的计算复杂度和内存占用都与序列长度 L 的平方成正比：

> **类比：班级讨论**
>
> 在一个 30 人的班级讨论中，每个人需要听每个人的发言，交流次数 = 30 × 30 = 900 次。如果班级扩大到 300 人，交流次数 = 300 × 300 = 90,000 次——增加了 100 倍！这就是 O(L²) 的直觉。
>
> 长上下文技术的目标就是让"300 人的讨论"不需要真的进行 90,000 次交流。

**两大瓶颈：**

```
1. 计算量瓶颈：
   Attention 计算 = O(L² × d)
   L = 4K   → 16M 次运算 (基准)
   L = 128K → 16.4B 次运算 (1024 倍！)
   L = 1M   → 1T 次运算

2. KV Cache 内存瓶颈：
   KV Cache 大小 = 2 × L × n_layers × n_heads × d_head × dtype_bytes
   
   以 LLaMA-3 70B 为例（80 层，64 个 KV head，128 d_head，FP16）：
   L = 4K   → 2 × 4096 × 80 × 64 × 128 × 2B   ≈ 10.5 GB
   L = 128K → 2 × 131072 × 80 × 64 × 128 × 2B  ≈ 335 GB（！）
   
   单张 H100 只有 80GB 显存 → 128K 上下文的 KV Cache 就需要 4+ 张 H100
```

### 13.2 位置编码外推

训练时通常使用固定的最大序列长度（如 4K 或 8K），但推理时用户可能输入更长的序列。位置编码外推技术解决的是：**如何让模型处理比训练时更长的序列**。

**RoPE 频率缩放（NTK-aware Scaling）**

RoPE（旋转位置编码）使用固定频率的正弦/余弦函数编码位置。当序列长度超出训练范围时，高频分量会出现从未见过的位置编码值，导致注意力模式崩坏。

```
RoPE 位置编码回顾：
  θ_i = base^(-2i/d)    # base 通常为 10000
  对位置 m: (cos(mθ_i), sin(mθ_i))

问题：
  训练时 m ∈ [0, 4096]，推理时 m = 100000
  → 高频分量 θ_i 对应的 cos(100000 × θ_i) 从未在训练中见过

NTK-aware 缩放：
  修改 base → base × α^(d/(d-2))
  其中 α = 目标长度 / 训练长度
  
  直觉：增大 base → 降低所有频率 → 将长序列的位置编码
        "压缩"到训练时见过的范围内
  
  优势：不需要重新训练，直接修改 base 即可
  局限：过度压缩会损失近距离位置的分辨率
```

**YaRN（Yet another RoPE extensioN）方法**

YaRN 在 NTK-aware 基础上引入了更精细的频率分组处理：

```
YaRN 的核心思想：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  将 RoPE 的频率维度分为三组：

  1. 低频维度（波长 >> 训练长度）：
     → 不需要缩放，本身就能外推
     
  2. 高频维度（波长 << 训练长度）：
     → 也不需要缩放，已经在训练中充分采样
     
  3. 中间频率维度：
     → 需要插值缩放，平滑过渡

  这种分频处理保留了近距离位置的高分辨率，
  同时允许远距离位置的外推
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 13.3 滑动窗口注意力

**Mistral 的 Sliding Window Attention（SWA）**

SWA 的核心思想是：每个 token 只关注最近 W 个 token（而非所有历史 token），将 Attention 复杂度从 O(L²) 降为 O(L × W)。

```
标准因果注意力 vs 滑动窗口注意力（W=3）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

标准因果注意力（每个 token 看到之前所有 token）：
  Token:  t₁  t₂  t₃  t₄  t₅  t₆
  t₁      ✓
  t₂      ✓   ✓
  t₃      ✓   ✓   ✓
  t₄      ✓   ✓   ✓   ✓
  t₅      ✓   ✓   ✓   ✓   ✓
  t₆      ✓   ✓   ✓   ✓   ✓   ✓
  注意力数 = L(L+1)/2 = 21

滑动窗口注意力（W=3，只看最近 3 个 token）：
  Token:  t₁  t₂  t₃  t₄  t₅  t₆
  t₁      ✓
  t₂      ✓   ✓
  t₃      ✓   ✓   ✓
  t₄          ✓   ✓   ✓
  t₅              ✓   ✓   ✓
  t₆                  ✓   ✓   ✓
  注意力数 = L × W = 18（L 很大时差异显著）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**信息传播**：虽然每层只看 W 个 token，但经过多层堆叠后，信息可以逐层传播。N 层网络的有效感受野 = N × W。例如 Mistral-7B 有 32 层，W=4096，理论感受野 = 32 × 4096 = 131,072 tokens。

**Mistral 的实际做法**：Mistral-7B 在大部分层使用 SWA（W=4096），并在模型的部分层（如每隔几层）使用全局注意力，确保远距离信息不会完全丢失。

### 13.4 稀疏注意力

稀疏注意力通过**只计算注意力矩阵中的部分元素**来降低复杂度，核心思路是：大部分注意力权重接近零，可以跳过。

**Local + Global Attention Patterns**

```
稀疏注意力的典型模式
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Local Attention（局部注意力）：
   每个 token 只看附近的 token（类似滑动窗口）
   适合：捕捉局部语法和语义关系

2. Global Attention（全局注意力）：
   选定若干"全局 token"（如句首、[CLS]），
   它们可以看到所有位置，也被所有位置看到
   适合：远距离信息的汇聚和传播

3. 组合模式（Longformer、BigBird）：
   ┌─────────────────────────┐
   │ ■ ■ ■ □ □ □ □ □ □ □ □ ■│  ← 全局 token（行/列全亮）
   │ ■ ■ ■ ■ □ □ □ □ □ □ □ ■│
   │ ■ ■ ■ ■ ■ □ □ □ □ □ □ ■│
   │ □ ■ ■ ■ ■ ■ □ □ □ □ □ ■│
   │ □ □ ■ ■ ■ ■ ■ □ □ □ □ ■│  ← 局部窗口（对角线附近）
   │ □ □ □ ■ ■ ■ ■ ■ □ □ □ ■│
   │ □ □ □ □ ■ ■ ■ ■ ■ □ □ ■│
   │ □ □ □ □ □ ■ ■ ■ ■ ■ □ ■│
   │ □ □ □ □ □ □ ■ ■ ■ ■ ■ ■│
   │ □ □ □ □ □ □ □ ■ ■ ■ ■ ■│
   │ □ □ □ □ □ □ □ □ ■ ■ ■ ■│
   │ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■│  ← 全局 token
   └─────────────────────────┘
   ■ = 计算注意力   □ = 跳过（置零）
   
   复杂度：O(L × (W + G))，W=窗口大小，G=全局token数
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 13.5 Ring Attention

Ring Attention 是一种**分布式长序列处理**技术，核心思路是将长序列分块分配到多个设备上，通过环形通信流水线实现 Attention 计算。

```
Ring Attention 工作原理
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

假设序列长度 L=16K，4 个设备各持有 4K tokens 的 Q/K/V

Device 0:  Q₀, K₀, V₀   (tokens 0-4095)
Device 1:  Q₁, K₁, V₁   (tokens 4096-8191)
Device 2:  Q₂, K₂, V₂   (tokens 8192-12287)
Device 3:  Q₃, K₃, V₃   (tokens 12288-16383)

Step 1: 每个设备计算本地 Q × 本地 K,V
  Device 0: Attn(Q₀, K₀, V₀)
  Device 1: Attn(Q₁, K₁, V₁)  ... 同时进行

Step 2: KV 块沿"环"传递（Device 0→1→2→3→0）
  Device 0 收到 K₃,V₃ → 计算 Attn(Q₀, K₃, V₃)
  Device 1 收到 K₀,V₀ → 计算 Attn(Q₁, K₀, V₀)
  ...

Step 3, 4: 继续传递和计算
  经过 4 步，每个设备的 Q 与所有 K,V 都计算过注意力

关键优化：
  - 通信与计算重叠（传输 KV 的同时计算当前 KV 的注意力）
  - 每个设备只需持有 1/N 的 KV Cache → 内存线性降低
  - 总通信量 = O(L × d)，与序列长度线性相关
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Ring Attention 与 FlashAttention 是正交的优化——FlashAttention 优化单设备上的注意力计算效率，Ring Attention 解决多设备间的序列并行问题。两者可以结合使用。

### 13.6 实际应用与评测

**128K/200K/1M 上下文的生产经验**

```
主流模型长上下文能力（2025-2026）：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  GPT-4o         : 128K
  Claude 3.5+    : 200K
  Gemini 2.0     : 1M → 2M
  DeepSeek-V3    : 128K
  Qwen-2.5       : 128K → 1M（长序列版本）
  LLaMA-3.1      : 128K
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Needle in a Haystack 测试**

这是评估长上下文模型的经典测试：在一段很长的文本中随机位置插入一个特定事实（"needle"），然后询问模型这个事实。测试模型在不同文本长度和不同插入位置下的检索准确率。

```
NIAH 测试结果示意（理想模型）：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  插入位置 →  开头   中间   结尾
  上下文长度
    4K        ✅     ✅     ✅
    32K       ✅     ✅     ✅
    128K      ✅     ✅     ✅

  实际观察：
  - 大多数模型在文本中间的检索准确率最低（"Lost in the Middle"）
  - 上下文越长，中间位置的准确率下降越明显
  - Claude 和 Gemini 在 NIAH 测试中表现最为均匀
```

**实践建议**：

1. **重要信息放在开头或结尾**，避免埋在长文本中间
2. **128K 上下文 ≠ 128K 有效理解**，实际有效理解通常不到标称的 80%
3. **长上下文的延迟和成本与长度近似线性**，128K 输入的首 token 延迟可能超过 10 秒

### 13.7 长上下文 vs RAG

这是一个工程中经常需要做的决策。两种方案各有优劣，并非互相替代：

| 维度 | 长上下文（直接塞入） | RAG（检索增强生成） |
|------|-------------------|-------------------|
| 适用数据量 | < 500 页（受上下文窗口限制） | 无上限（检索后只取最相关片段） |
| 全局理解 | ✅ 模型看到所有内容，可做全局分析 | ❌ 只看到检索到的片段，缺乏全局视角 |
| 实时性 | ✅ 无需预处理 | ⚠️ 需要预先构建索引 |
| 精确引用 | ⚠️ 可能幻觉引用位置 | ✅ 可精确追溯引用来源 |
| 成本（单次） | 💰💰💰 每次都需处理全部 token | 💰 只处理检索到的少量 token |
| 成本（多次查询） | 💰💰💰 每次都是全量成本 | 💰 索引构建一次，多次查询摊薄 |
| 更新频率 | ✅ 每次传入最新数据 | ⚠️ 需要重建/更新索引 |
| 延迟 | ⚠️ 长输入 → 高首 token 延迟 | ✅ 输入短 → 低延迟 |

**决策框架：**

```
需要全局理解（如"总结这份合同的所有风险点"）
  → 优先长上下文

数据量超过 500 页 或 需要多次查询同一知识库
  → 优先 RAG

需要精确引用溯源
  → 优先 RAG

一次性分析 + 数据量可控
  → 长上下文更简单

最佳实践：两者结合
  → RAG 检索最相关的 Top-K 文档 → 放入长上下文窗口
  → 既有检索精度，又有全局理解能力
```

---

> **扩展阅读：**
> - [Attention Is All You Need (2017)](https://arxiv.org/abs/1706.03762)
> - [Language Models are Few-Shot Learners / GPT-3 (2020)](https://arxiv.org/abs/2005.14165)
> - [Training Compute-Optimal LLMs / Chinchilla (2022)](https://arxiv.org/abs/2203.15556)
> - [LLaMA: Open and Efficient Foundation Language Models (2023)](https://arxiv.org/abs/2302.13971)
> - [RoFormer: Enhanced Transformer with Rotary Position Embedding (2021)](https://arxiv.org/abs/2104.09864)
> - [Mixtral of Experts (2024)](https://arxiv.org/abs/2401.04088)
> - [DeepSeekMoE: Towards Ultimate Expert Specialization (2024)](https://arxiv.org/abs/2401.06066)
> - [DeepSeek-R1: Incentivizing Reasoning Capability in LLMs via RL (2025)](https://arxiv.org/abs/2501.12948)
> - [Learning Transferable Visual Models From Natural Language Supervision / CLIP (2021)](https://arxiv.org/abs/2103.00020)
> - [An Image is Worth 16x16 Words / ViT (2020)](https://arxiv.org/abs/2010.11929)
> - [Ring Attention with Blockwise Transformers (2023)](https://arxiv.org/abs/2310.01889)
> - [YaRN: Efficient Context Window Extension (2023)](https://arxiv.org/abs/2309.00071)
> - [HuggingFace Transformers 源码：modeling_llama.py](https://github.com/huggingface/transformers/blob/main/src/transformers/models/llama/modeling_llama.py)
> - [meta-llama/llama 参考实现](https://github.com/meta-llama/llama)
