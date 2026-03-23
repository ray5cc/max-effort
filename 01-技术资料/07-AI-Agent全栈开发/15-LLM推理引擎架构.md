# LLM 推理引擎架构

> 深入解析 LLM 推理引擎的核心技术原理与生产实践，涵盖注意力优化、批处理策略、量化技术、分布式推理等关键主题，结合 vLLM、SGLang、TensorRT-LLM、llama.cpp 等真实开源项目的架构剖析。

## 相关链接

- 对应面试题：[15-LLM推理引擎面试题](../../02-面试指南/07-AI-Agent全栈开发面试/15-LLM推理引擎面试题.md)
- 相关技术资料：[11-Transformers与模型架构](./11-Transformers与模型架构.md)

## TL;DR 速览

| 主题 | 核心知识点 | 面试高频 |
|------|-----------|---------|
| PagedAttention | vLLM 虚拟内存管理 KV Cache，消除显存碎片 | ⭐⭐⭐ |
| Continuous Batching | 动态批处理 vs 静态批处理，请求级调度 | ⭐⭐⭐ |
| 量化技术 | GPTQ/AWQ/FP8/INT4/GGUF 混合精度方案 | ⭐⭐ |
| 推测解码 | Draft-Verify 加速自回归，数学保证分布不变 | ⭐⭐ |
| 分布式推理 | TP/PP/DP/EP 四种并行策略与组合 | ⭐⭐⭐ |
| Prefix Caching | RadixAttention 前缀复用，多轮对话加速 | ⭐⭐ |
| 结构化输出 | FSM/Grammar 约束解码，保证 JSON 格式 | ⭐⭐ |
| Prefill-Decode 分离 | 计算密集 vs 访存密集的异构部署 | ⭐⭐ |

## 目录

1. [为什么需要专业推理引擎？](#1-为什么需要专业推理引擎)
2. [KV Cache 管理与 PagedAttention](#2-kv-cache-管理与-pagedattention)
3. [批处理策略](#3-批处理策略)
4. [量化技术深度解析](#4-量化技术深度解析)
5. [推测解码（Speculative Decoding）](#5-推测解码speculative-decoding)
6. [分布式推理架构](#6-分布式推理架构)
7. [结构化输出与约束解码](#7-结构化输出与约束解码)
8. [推理引擎架构对比](#8-推理引擎架构对比)
9. [生产部署实践](#9-生产部署实践)
10. [实战案例：用 vLLM 部署 DeepSeek-V3](#10-实战案例用-vllm-部署-deepseek-v3)
11. [常见陷阱与最佳实践](#11-常见陷阱与最佳实践)

---

## 1. 为什么需要专业推理引擎？

### 1.1 一个类比：推理引擎就像数据库的查询优化器

想象你去一家餐厅吃饭。如果每位客人的菜都由一个独立厨师从头到尾做完，再开始做下一位客人的菜（朴素推理），餐厅一晚上只能服务几桌客人。而真正的商业厨房会：

- **同时处理多桌订单**（批处理）
- **炒菜和备菜分开**（prefill-decode 分离）
- **提前切好常用食材**（KV Cache / Prefix Caching）
- **用半成品加速出餐**（量化 / 推测解码）

推理引擎之于 LLM，正如查询优化器之于数据库——不改变"做什么"，但彻底改变"怎么做"。

### 1.2 LLM 推理的两阶段特性

LLM 的自回归推理天然分为两个截然不同的阶段：

```diagram
┌─────────────────────────────────────────────────────────────┐
│                    LLM 推理两阶段                            │
├─────────────────────────┬───────────────────────────────────┤
│    Prefill（预填充）      │      Decode（解码）                │
├─────────────────────────┼───────────────────────────────────┤
│ 处理全部输入 token        │ 逐个生成输出 token                  │
│ 一次前向传播              │ 每个 token 一次前向传播              │
│ 计算密集 (Compute-bound) │ 访存密集 (Memory-bound)             │
│ GPU 算力是瓶颈           │ 显存带宽是瓶颈                      │
│ 可高度并行               │ 天然串行（自回归）                   │
│ 延迟 = TTFT             │ 延迟 = TPS (tokens/second)          │
└─────────────────────────┴───────────────────────────────────┘
```

**为什么 Decode 是访存密集的？**

这是理解推理引擎设计的关键。在 Decode 阶段，每次前向传播只处理 **1 个 token**，但需要加载模型的 **全部权重参数**：

```
算术强度 (Arithmetic Intensity) = FLOPs / 字节数

Prefill (处理 1024 tokens):
  FLOPs ≈ 2 × 模型参数量 × 序列长度
  数据量 ≈ 模型参数量 × 字节/参数
  算术强度 ≈ 2 × 1024 = 2048 (Compute-bound ✅)

Decode (处理 1 token):
  FLOPs ≈ 2 × 模型参数量 × 1
  数据量 ≈ 模型参数量 × 字节/参数
  算术强度 ≈ 2 × 1 = 2 (Memory-bound ✅)
```

以 A100 GPU 为例：

| 指标 | A100 80GB SXM | 含义 |
|------|--------------|------|
| FP16 算力 | 312 TFLOPS | 每秒浮点运算次数 |
| 显存带宽 | 2.0 TB/s | 每秒数据搬运量 |
| 算力/带宽比 | 156 | 算术强度 > 156 才 Compute-bound |

Decode 阶段算术强度仅约 2，远低于 156 的平衡点。这意味着 **GPU 99% 的算力在等待数据搬运**——这就是为什么 Decode 阶段的优化核心是减少显存访问，而非增加计算量。

### 1.3 朴素推理 vs 优化推理的性能差距

用一个真实的性能对比来说明推理引擎的价值：

```diagram
模型: LLaMA-2 70B, GPU: 4×A100 80GB

┌────────────────────┬────────────┬─────────────┬──────────┐
│ 推理方式            │ 吞吐量      │ 显存利用率    │ 并发请求  │
│                    │(tokens/s)  │             │          │
├────────────────────┼────────────┼─────────────┼──────────┤
│ HuggingFace naive  │ ~30        │ ~45%        │ 1        │
│ + KV Cache         │ ~80        │ ~55%        │ 1        │
│ + 静态批处理        │ ~300       │ ~70%        │ 8        │
│ vLLM (全优化)       │ ~2000      │ ~95%        │ 256      │
│ TensorRT-LLM (FP8) │ ~3500      │ ~95%        │ 256      │
└────────────────────┴────────────┴─────────────┴──────────┘
```

从朴素推理到 vLLM 全优化，吞吐量提升了 **60 倍以上**。这不是微优化，而是架构级别的革命。

### 1.4 推理引擎解决的核心问题

```diagram
┌──────────────────────────────────────────────────────────┐
│                  推理引擎核心技术栈                         │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │ KV Cache │  │  批处理   │  │   量化    │  │ 分布式   │ │
│  │  管理    │  │  调度     │  │  压缩     │  │  并行    │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘ │
│       │             │             │             │        │
│  PagedAttn     Continuous     GPTQ/AWQ/FP8    TP/PP/   │
│  RadixAttn     Batching       GGUF            DP/EP    │
│  Prefix $      Chunked                                  │
│                Prefill                                   │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ 推测解码  │  │ 结构化   │  │  PD 分离  │              │
│  │          │  │  输出     │  │          │              │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       │             │             │                      │
│  Draft-Verify  FSM/Grammar   Prefill-Decode             │
│  Medusa        Constrained   Disaggregated              │
│  N-gram        Decoding      Serving                    │
└──────────────────────────────────────────────────────────┘
```

---

## 2. KV Cache 管理与 PagedAttention

### 2.1 KV Cache 为什么占用大量显存

#### 类比：KV Cache 就像会议记录

想象你在主持一个长会议。每当有人发言，你不可能从头重听所有人之前说过的话。所以你需要一份持续更新的**会议纪要**（KV Cache）——记录每个人（每层 attention head）之前说的关键信息（Key-Value 对）。

会议越长、参会人越多，这份记录就越厚——这就是 KV Cache 显存占用问题的本质。

#### KV Cache 显存占用计算公式

```
KV Cache 显存 = 2 × num_layers × num_heads × head_dim × seq_len × batch_size × bytes_per_element

其中：
  2          — K 和 V 各一份
  num_layers — 模型层数
  num_heads  — 注意力头数（如果用 GQA，则为 KV 头数）
  head_dim   — 每个头的维度
  seq_len    — 序列长度
  batch_size — 批大小
  bytes_per_element — 数据类型字节数（FP16=2, FP8=1, INT8=1）
```

以 LLaMA-3 70B 为例计算单个请求的 KV Cache：

```python
# LLaMA-3 70B 模型参数
num_layers = 80
num_kv_heads = 8       # GQA: 8 KV heads (vs 64 query heads)
head_dim = 128
seq_len = 8192         # 上下文窗口
bytes_per_element = 2  # FP16

kv_cache_per_request = (
    2 * num_layers * num_kv_heads * head_dim * seq_len * bytes_per_element
)
# = 2 × 80 × 8 × 128 × 8192 × 2
# = 2,684,354,560 bytes
# ≈ 2.5 GB（单个请求！）

# 如果没有 GQA（64 个 KV heads）：
# = 2 × 80 × 64 × 128 × 8192 × 2 ≈ 20 GB（单个请求！）
```

**关键洞察**：GQA（Grouped-Query Attention）将 KV Cache 降低了 8 倍（64→8 KV heads），这也是现代模型普遍采用 GQA 的原因之一。

但即使有 GQA，一块 80GB A100 加载 70B 模型本身就占 ~140GB（FP16），用 4 卡 TP 后每卡剩余约 ~45GB 显存，仅能容纳 ~18 个并发请求的 KV Cache——这远远不够生产需求。

### 2.2 朴素 KV Cache 管理的问题

在 PagedAttention 出现之前，KV Cache 的管理方式是"预分配"：

```diagram
┌──────────────────── GPU 显存 ────────────────────┐
│                                                   │
│  ┌─────────────────────────────────────────────┐  │
│  │ 请求 A: [██████████░░░░░░░░░░░░░░░░░░░░░░] │  │ ← 预分配 max_seq_len
│  │          已用 10     浪费 22                 │  │
│  └─────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────┐  │
│  │ 请求 B: [████████████████████░░░░░░░░░░░░░] │  │ ← 预分配 max_seq_len
│  │          已用 20        浪费 12              │  │
│  └─────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────┐  │
│  │ 请求 C: [██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] │  │ ← 预分配 max_seq_len
│  │          已用 2      浪费 30                 │  │
│  └─────────────────────────────────────────────┘  │
│                                                   │
│  ████ 已使用    ░░░░ 浪费（内部碎片）               │
│                                                   │
│  剩余显存不足以容纳新请求（外部碎片）                 │
│  [░░░░░] [░░░] [░░░░░░░░]                        │
└───────────────────────────────────────────────────┘
```

**两个核心问题**：

1. **内部碎片**：每个请求预分配 `max_seq_len` 大小的连续内存，但实际使用量远小于此
2. **外部碎片**：请求结束释放的内存块大小不一，无法合并利用

vLLM 论文（SOSP 2023）的测量显示，朴素管理方式导致 **60-80% 的 KV Cache 显存被浪费**。

### 2.3 vLLM 的 PagedAttention 原理

#### 核心类比：操作系统虚拟内存分页

PagedAttention 的灵感直接来自操作系统的虚拟内存管理：

| 操作系统概念 | PagedAttention 对应 |
|------------|-------------------|
| 虚拟地址空间 | 逻辑 KV Cache（每个请求看到连续空间） |
| 物理页帧 (Physical Frame) | 物理 KV Block（GPU 显存中的固定大小块） |
| 页表 (Page Table) | Block Table（逻辑块→物理块映射表） |
| 页大小 (Page Size) | Block Size（通常 16 个 token） |
| 按需分页 (Demand Paging) | 按需分配 Block（生成新 token 时才分配） |
| Copy-on-Write | Beam Search / Parallel Sampling 时共享 Block |

#### 物理块与逻辑块的映射

```diagram
请求 A (已生成 35 tokens, block_size=16):

逻辑块序列:        Block Table (请求 A):
┌──────────┐       ┌───────┬───────────┐
│ 逻辑块 0 │──────→│ 逻辑0 │ 物理块 7  │
│ tokens 0-15│     ├───────┼───────────┤
├──────────┤       │ 逻辑1 │ 物理块 2  │
│ 逻辑块 1 │──────→├───────┼───────────┤
│ tokens 16-31│    │ 逻辑2 │ 物理块 15 │ ← 仅用了 3/16 slots
├──────────┤       └───────┴───────────┘
│ 逻辑块 2 │──────→
│ tokens 32-34│
└──────────┘

GPU 显存物理布局（块不需要连续！）:
┌──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┐
│ 块0  │ 块1  │ 块2  │ 块3  │ ...  │ 块7  │ ...  │ 块15 │
│ 空闲 │ 空闲 │ A-逻1│ 空闲 │      │ A-逻0│      │ A-逻2│
└──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┘
```

**关键优势**：
- **零内部碎片**：只有最后一个块可能有少量未使用空间（平均浪费 < block_size/2）
- **零外部碎片**：所有块大小相同，任何空闲块可以分配给任何请求
- **按需分配**：不预分配 max_seq_len，生成新 token 时才分配新块

#### Block 分配器的核心逻辑

```python
class BlockAllocator:
    """简化的 vLLM Block 分配器"""

    def __init__(self, num_blocks: int, block_size: int):
        self.block_size = block_size
        # 空闲块栈（O(1) 分配/回收）
        self.free_blocks: list[int] = list(range(num_blocks))
        # 引用计数（支持 Copy-on-Write）
        self.ref_count: dict[int, int] = {}

    def allocate(self) -> int:
        """分配一个物理块"""
        if not self.free_blocks:
            raise OutOfMemoryError("No free blocks available")
        block_id = self.free_blocks.pop()
        self.ref_count[block_id] = 1
        return block_id

    def free(self, block_id: int):
        """释放一个物理块（引用计数归零时才真正释放）"""
        self.ref_count[block_id] -= 1
        if self.ref_count[block_id] == 0:
            self.free_blocks.append(block_id)
            del self.ref_count[block_id]

    def cow_copy(self, block_id: int) -> int:
        """Copy-on-Write: 写时复制"""
        if self.ref_count[block_id] == 1:
            return block_id  # 独占，无需复制
        # 分配新块，复制数据
        new_block = self.allocate()
        # GPU 上执行 block 数据拷贝
        gpu_memcpy(src=block_id, dst=new_block)
        self.ref_count[block_id] -= 1
        return new_block

    def share(self, block_id: int):
        """增加引用计数（用于 beam search 共享前缀）"""
        self.ref_count[block_id] += 1
```

#### Copy-on-Write 实现 Beam Search

Beam Search 中多个候选序列共享相同的前缀 tokens。PagedAttention 用 Copy-on-Write 避免重复存储：

```diagram
Beam Search (beam_width=3) 第 10 步：

三个候选共享前缀 "The quick brown fox":

候选 1: "The quick brown fox jumps"
候选 2: "The quick brown fox runs"
候选 3: "The quick brown fox sleeps"

Block Table (候选 1):        引用计数:
┌───────┬─────────┐         ┌─────────┬──────┐
│ 逻辑0 │ 物理块 3│←──┐     │ 物理块 3│ 3    │ ← 三个候选共享！
├───────┼─────────┤   │     ├─────────┼──────┤
│ 逻辑1 │ 物理块 8│   │     │ 物理块 8│ 1    │ ← 候选 1 独占
└───────┴─────────┘   │     └─────────┴──────┘
                      │
Block Table (候选 2):  │
┌───────┬─────────┐   │
│ 逻辑0 │ 物理块 3│←──┤  ← 同一个物理块 3
├───────┼─────────┤   │
│ 逻辑1 │ 物理块 5│   │
└───────┴─────────┘   │
                      │
Block Table (候选 3):  │
┌───────┬─────────┐   │
│ 逻辑0 │ 物理块 3│←──┘  ← 同一个物理块 3
├───────┼─────────┤
│ 逻辑1 │ 物理块 11│
└───────┴─────────┘
```

当某个候选需要修改共享块时，触发 Copy-on-Write：分配新块、复制数据、修改新块、更新 Block Table。

### 2.4 SGLang 的 RadixAttention

#### 核心类比：浏览器地址栏自动补全

浏览器会缓存你访问过的 URL，当你输入 `github.c` 时自动补全为 `github.com/...`。RadixAttention 做的事情类似——缓存之前处理过的 token 前缀，下次遇到相同前缀时直接复用 KV Cache，跳过 Prefill。

#### 为什么需要 Prefix Caching？

在实际生产中，很多请求共享相同的前缀：

```
多轮对话场景：
  第 1 轮: [System Prompt] + [用户问题 1]
  第 2 轮: [System Prompt] + [用户问题 1] + [回答 1] + [用户问题 2]
  第 3 轮: [System Prompt] + [用户问题 1] + [回答 1] + [用户问题 2] + [回答 2] + [用户问题 3]

  → 每轮都重复 Prefill 之前的内容，浪费 80%+ 的计算

Few-shot Prompting 场景：
  请求 1: [指令 + 5个示例] + [输入 A]
  请求 2: [指令 + 5个示例] + [输入 B]
  请求 3: [指令 + 5个示例] + [输入 C]

  → 三个请求共享完全相同的前缀（指令 + 5 个示例）
```

#### Radix Tree 数据结构

RadixAttention 使用 **Radix Tree（基数树）** 来存储和检索 KV Cache 前缀：

```diagram
Radix Tree 缓存示例：

                        [root]
                       /      \
                [System: You   [System: You
                 are a         are a code
                 helpful       reviewer]
                 assistant]    │
                /       \      └─ KV Cache 块 #C
   [User: Hello] [User: What]
        │              │
   KV Cache 块 #A  KV Cache 块 #B

查找过程（类比 Trie 树的前缀匹配）：
  新请求: "System: You are a helpful assistant" + "User: Hello" + "How are you?"
  
  1. 匹配到 "System: You are a helpful assistant" → 命中！复用 KV Cache
  2. 匹配到 "User: Hello" → 命中！复用 KV Cache
  3. "How are you?" → 未命中，只需 Prefill 这部分
  
  节省: 跳过了前缀的 Prefill 计算 ≈ 90% 的输入 token
```

#### RadixAttention 的核心实现

```python
class RadixCache:
    """SGLang RadixAttention 的简化实现"""

    def __init__(self, max_cache_size: int):
        self.root = RadixNode()
        self.max_cache_size = max_cache_size
        self.current_size = 0

    def match_prefix(self, token_ids: list[int]) -> tuple[int, list[KVCacheBlock]]:
        """
        在 Radix Tree 中查找最长匹配前缀
        返回: (匹配的 token 数, 对应的 KV Cache 块列表)
        """
        node = self.root
        matched_length = 0
        kv_blocks = []

        for token_id in token_ids:
            if token_id in node.children:
                child = node.children[token_id]
                kv_blocks.append(child.kv_block)
                matched_length += 1
                node = child
                # 更新 LRU 时间戳
                child.last_access = time.monotonic()
            else:
                break  # 前缀不再匹配

        return matched_length, kv_blocks

    def insert(self, token_ids: list[int], kv_blocks: list[KVCacheBlock]):
        """将新的 KV Cache 插入 Radix Tree"""
        node = self.root
        for i, token_id in enumerate(token_ids):
            if token_id not in node.children:
                new_node = RadixNode(kv_block=kv_blocks[i])
                node.children[token_id] = new_node
                self.current_size += 1
            node = node.children[token_id]

        # 超出容量时 LRU 淘汰
        if self.current_size > self.max_cache_size:
            self._evict_lru()

    def _evict_lru(self):
        """LRU 策略淘汰最久未使用的叶子节点"""
        # 找到所有叶子节点，按 last_access 排序
        leaves = self._find_leaves(self.root)
        leaves.sort(key=lambda n: n.last_access)

        while self.current_size > self.max_cache_size * 0.9:  # 淘汰到 90%
            oldest_leaf = leaves.pop(0)
            self._remove_leaf(oldest_leaf)
            self.current_size -= 1
```

#### RadixAttention 适用场景

| 场景 | 前缀复用率 | 加速效果 |
|------|----------|---------|
| 多轮对话（长历史） | 80-95% | 3-10x TTFT 降低 |
| Few-shot Prompting | 90-99% | 5-20x TTFT 降低 |
| 批量文档处理（相同指令） | 95-99% | 10-50x TTFT 降低 |
| Code Completion（相同仓库上下文） | 70-90% | 2-5x TTFT 降低 |
| 单轮独立对话 | 0-10% | 几乎无效果 |

### 2.5 KV Cache 管理方案对比

| 特性 | vLLM PagedAttention | SGLang RadixAttention | TensorRT-LLM KV Cache |
|------|--------------------|-----------------------|----------------------|
| 核心数据结构 | Block Table（哈希表） | Radix Tree（前缀树） | 预分配 + 分池管理 |
| 显存碎片 | 接近零 | 接近零 | 低（池化管理） |
| 前缀缓存 | v0.6+ 支持 APC | 原生 RadixAttention | 支持 |
| Copy-on-Write | 原生支持 | 通过 Tree 共享 | 支持 |
| KV Cache 量化 | FP8/INT8 | FP8 | FP8 原生优化 |
| 实现复杂度 | 中等 | 较高（Tree 维护） | 高（CUDA 深度优化） |
| 适用场景 | 通用高并发 | 前缀复用密集 | 极致性能要求 |

---

## 3. 批处理策略

### 3.1 静态批处理（Naive Batching）的问题

#### 类比：银行窗口叫号

想象一个银行窗口（GPU），同时叫了 8 个人（batch_size=8）。每个人的业务耗时不同——有人只是查余额（短输出），有人要办贷款（长输出）。但窗口规则是：**必须等所有 8 个人都办完，才能叫下一批 8 个人**。

```diagram
静态批处理示例 (batch_size=4):

时间 ──────────────────────────────────────────────→

请求 A: [Prefill][D][D][D][DONE]░░░░░░░░░░░░░░░░░░  ← 3 tokens 后完成
请求 B: [Prefill][D][D][D][D][D][D][D][D][D][DONE]░  ← 10 tokens 后完成
请求 C: [Prefill][D][D][D][D][D][DONE]░░░░░░░░░░░░░  ← 6 tokens 后完成
请求 D: [Prefill][D][D][D][D][D][D][D][D][D][D][DONE] ← 11 tokens 后完成

         ░░░ = GPU 空闲（等待最慢的请求 D）

         批次 1 完成后才开始批次 2...

请求 E: ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░[Prefill][D]...
请求 F: ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░[Prefill][D]...
```

**问题**：
- 请求 A 在第 3 步就完成了，但 GPU 还在等请求 D
- 请求 E、F 排队等待，即使 GPU 有空闲容量
- 平均 GPU 利用率仅 ~50%

### 3.2 连续批处理（Continuous Batching）原理

#### 类比：火锅自助餐

连续批处理就像火锅自助餐：不需要等一桌人都吃完才翻桌，而是谁吃完谁走，有新客人可以直接坐到空位上。

```diagram
连续批处理示例:

时间 ──────────────────────────────────────────────→
      Step1  Step2  Step3  Step4  Step5  Step6  ...

请求 A: [P+D]  [D]   [D]  [DONE]
请求 B: [P+D]  [D]   [D]   [D]   [D]   [D]   [DONE]
请求 C: [P+D]  [D]   [D]   [D]  [DONE]
请求 D: [P+D]  [D]   [D]   [D]   [D]   [D]    [D]...
请求 E:                     [P+D] [D]   [D]   [DONE] ← A 完成后立即加入！
请求 F:                                 [P+D]  [D]   ← C 完成后立即加入！

关键区别:
- 每个 iteration 都检查是否有请求完成
- 完成的请求立即退出批次，释放 GPU 资源
- 新请求立即加入批次，无需等待当前批次全部完成
- GPU 始终保持满负载 → 利用率 ~95%+
```

#### Iteration-level Scheduling

连续批处理的关键是在**每个 decode step** 都做调度决策：

```python
class ContinuousBatchScheduler:
    """连续批处理调度器的简化实现"""

    def __init__(self, max_batch_size: int, max_tokens_per_step: int):
        self.max_batch_size = max_batch_size
        self.max_tokens_per_step = max_tokens_per_step
        self.waiting_queue: list[Request] = []    # 等待队列
        self.running_batch: list[Request] = []    # 正在运行的批次

    def step(self) -> list[Request]:
        """每个 iteration 调用一次"""
        # 1. 移除已完成的请求
        completed = [r for r in self.running_batch if r.is_finished()]
        for r in completed:
            self.running_batch.remove(r)
            r.release_kv_cache()
            r.send_response()

        # 2. 从等待队列加入新请求（填满空位）
        while (
            self.waiting_queue
            and len(self.running_batch) < self.max_batch_size
            and self._total_tokens() < self.max_tokens_per_step
        ):
            new_request = self.waiting_queue.pop(0)
            new_request.allocate_kv_cache()
            self.running_batch.append(new_request)

        # 3. 返回当前批次给 GPU 执行
        return self.running_batch

    def _total_tokens(self) -> int:
        """计算当前批次的总 token 数（prefill + decode）"""
        return sum(r.current_tokens for r in self.running_batch)
```

### 3.3 vLLM 的调度器架构

vLLM 的调度器比简单的连续批处理更复杂，它管理三个队列和抢占策略：

```diagram
vLLM 调度器三队列架构:

┌─────────────────────────────────────────────────┐
│                 vLLM Scheduler                  │
│                                                 │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐     │
│  │ WAITING │───→│ RUNNING │───→│ FINISHED│     │
│  │  Queue  │    │  Batch  │    │  Output │     │
│  └─────────┘    └────┬────┘    └─────────┘     │
│                      │                          │
│                 ┌────▼────┐                     │
│                 │ SWAPPED │  ← 被抢占的请求      │
│                 │  Queue  │    KV Cache 存到 CPU │
│                 └─────────┘                     │
│                                                 │
│  调度策略:                                       │
│  1. 优先处理 RUNNING 中的请求（避免浪费已做工作）   │
│  2. SWAPPED 请求优先于 WAITING 恢复              │
│  3. 显存不足时抢占最后加入的请求（LIFO）            │
└─────────────────────────────────────────────────┘
```

#### 抢占策略：Recompute vs Swap

当 GPU 显存不足以容纳所有运行中请求的 KV Cache 时，vLLM 需要"抢占"一些请求：

```diagram
┌─────────────────────────────────────────────────────┐
│              抢占策略对比                              │
├─────────────────────┬───────────────────────────────┤
│   Recompute（重算）  │      Swap（交换到 CPU）         │
├─────────────────────┼───────────────────────────────┤
│ 丢弃 KV Cache       │ 将 KV Cache 复制到 CPU 内存    │
│ 恢复时重新 Prefill   │ 恢复时从 CPU 复制回 GPU        │
│ 无 CPU 内存开销      │ 占用 CPU 内存                  │
│ 恢复慢（需要重算）    │ 恢复快（仅数据复制）            │
│ 适合：短序列         │ 适合：长序列                    │
│ 适合：CPU 内存有限    │ 适合：PCIe 带宽充足             │
└─────────────────────┴───────────────────────────────┘
```

```python
class VLLMScheduler:
    """vLLM 调度器的核心调度逻辑（简化）"""

    def schedule(self) -> SchedulerOutputs:
        # Phase 1: 尝试为 RUNNING 请求分配显存
        running_budget = self._compute_budget()
        preempted = []

        for seq_group in reversed(self.running):
            if not self._can_allocate(seq_group, running_budget):
                # 显存不足，需要抢占
                if self.preemption_mode == "swap":
                    self._swap_out(seq_group)  # KV Cache → CPU
                    self.swapped.append(seq_group)
                else:
                    self._recompute(seq_group)  # 丢弃 KV Cache
                    self.waiting.appendleft(seq_group)  # 重回等待队列头部
                preempted.append(seq_group)
                self.running.remove(seq_group)

        # Phase 2: 尝试恢复 SWAPPED 请求
        for seq_group in self.swapped[:]:
            if self._can_allocate(seq_group, running_budget):
                self._swap_in(seq_group)  # CPU → GPU
                self.swapped.remove(seq_group)
                self.running.append(seq_group)

        # Phase 3: 接收新 WAITING 请求
        for seq_group in self.waiting[:]:
            if self._can_allocate(seq_group, running_budget):
                self.waiting.remove(seq_group)
                self.running.append(seq_group)

        return SchedulerOutputs(
            scheduled=self.running,
            preempted=preempted,
        )
```

### 3.4 SGLang 的零开销 CPU 调度器

SGLang 的一个核心创新是将调度逻辑从 Python 移到高效的 C++ 实现，消除了 Python GIL 和解释器开销。其调度器的设计理念是**让 GPU 永远不等 CPU**：

```diagram
传统调度器 (Python):
  GPU Iteration 1 ──→ [Python 调度: 50μs-2ms] ──→ GPU Iteration 2
                       ↑ Python GIL 争用 ↑

SGLang 零开销调度器:
  GPU Iteration 1 ──→ GPU Iteration 2 ──→ GPU Iteration 3
       ↑                  ↑                  ↑
  [C++ 调度: <5μs]  [C++ 调度: <5μs]  [C++ 调度: <5μs]
  （与 GPU 计算重叠，不阻塞）
```

关键设计决策：
- **调度与执行重叠**：在 GPU 执行当前 iteration 时，CPU 同时计算下一轮的调度决策
- **无锁数据结构**：避免 Python 的线程锁争用
- **批量元数据更新**：一次性计算所有 token 的位置信息和注意力掩码

### 3.5 Chunked Prefill：长序列的分块预填充

当遇到非常长的输入序列（如 32K tokens）时，一次性 Prefill 会：
1. 独占 GPU 很长时间，阻塞其他请求
2. 显存峰值很高（attention 矩阵占用大量中间显存）

**Chunked Prefill** 将长序列的 Prefill 分成多个小块，与 Decode 请求交错执行：

```
无 Chunked Prefill:
  GPU: [====== 长序列 Prefill (1000ms) ======][Decode][Decode]...
  其他请求: 等待...等待...等待...                ↑ 终于可以 Decode

有 Chunked Prefill (chunk_size=512 tokens):
  GPU: [Prefill chunk 1][Decode×N][Prefill chunk 2][Decode×N]...
  其他请求: 无感知延迟，持续获得 Decode token

优势:
- 所有请求的 TPOT (Time Per Output Token) 更稳定
- 不会因为一个长输入阻塞所有短请求
- P95/P99 延迟大幅降低
```

```python
class ChunkedPrefillScheduler:
    """分块预填充调度"""

    def __init__(self, chunk_size: int = 512, max_tokens_per_step: int = 2048):
        self.chunk_size = chunk_size
        self.max_tokens_per_step = max_tokens_per_step

    def schedule_step(self, prefill_requests, decode_requests):
        """混合调度 Prefill 块和 Decode 请求"""
        scheduled_tokens = 0
        batch = []

        # 1. 优先调度 Decode 请求（每个只需 1 token）
        for req in decode_requests:
            if scheduled_tokens + 1 <= self.max_tokens_per_step:
                batch.append(ScheduleItem(req, num_tokens=1, is_prefill=False))
                scheduled_tokens += 1

        # 2. 用剩余预算调度 Prefill 块
        remaining_budget = self.max_tokens_per_step - scheduled_tokens
        for req in prefill_requests:
            chunk_tokens = min(
                req.remaining_prefill_tokens,
                self.chunk_size,
                remaining_budget,
            )
            if chunk_tokens > 0:
                batch.append(ScheduleItem(req, num_tokens=chunk_tokens, is_prefill=True))
                remaining_budget -= chunk_tokens

        return batch
```

---

## 4. 量化技术深度解析

### 4.1 为什么量化有效？

#### 类比：JPEG 压缩图片

你拍了一张 5000×4000 的照片（RAW 格式约 60MB）。直接存 RAW 文件能保留所有细节，但太占空间。用 JPEG 压缩到 3MB，肉眼几乎看不出区别——因为 JPEG 去掉了人眼不敏感的高频细节。

模型量化做的事情类似：

```
原始模型 (FP16):
  每个参数 = 16 bit 浮点数
  70B 参数 × 2 bytes = 140 GB 显存

INT4 量化后:
  每个参数 = 4 bit 整数
  70B 参数 × 0.5 bytes = 35 GB 显存
  → 显存降低 75%，推理速度提升 2-3x
  → 精度损失通常 < 1% (perplexity 变化)
```

**为什么可以这么做？**

1. **权重分布集中**：LLM 的权重通常呈近似正态分布，大部分值集中在零附近，只需少数 bit 就能精确表示
2. **冗余信息**：模型参数中存在大量冗余，不是每个 bit 都承载关键信息
3. **异常值保护**：少数重要的离群权重（outliers）可以用更高精度保留

### 4.2 权重量化方法

#### 4.2.1 GPTQ（后训练量化，逐层最优）

**核心思想**：量化 = 一个优化问题。目标是找到量化后的权重 $\hat{W}$，使得量化前后的**输出差异最小**。

```
GPTQ 优化目标:

  min  || W·X - Ŵ·X ||²
  Ŵ

  其中:
  W  = 原始 FP16 权重矩阵
  Ŵ  = 量化后的权重矩阵
  X  = 校准数据集的输入激活

关键创新 (来自 Optimal Brain Quantization):
- 逐列量化：一列一列地量化权重
- 误差补偿：量化一列后，用 Hessian 矩阵调整剩余列，补偿精度损失
- 分组量化 (Group Quantization)：每 128 列共享一组量化参数 (scale + zero_point)
```

```python
# GPTQ 核心算法（简化）
def gptq_quantize(W: Tensor, X_calib: Tensor, group_size: int = 128):
    """
    GPTQ 逐列量化
    W: [out_features, in_features] 权重矩阵
    X_calib: [num_samples, in_features] 校准数据
    """
    # 计算 Hessian 矩阵 H = X^T X （反映每个权重对输出的影响大小）
    H = X_calib.T @ X_calib
    H_inv = torch.linalg.inv(H)  # 实际用 Cholesky 分解加速

    W_quant = W.clone()
    errors = torch.zeros_like(W)

    for col in range(W.shape[1]):
        # 当前列的量化
        w_col = W_quant[:, col]

        # 计算该列的量化参数 (per-group)
        group_id = col // group_size
        scale, zero_point = compute_quant_params(w_col, bits=4)

        # 量化
        w_quant_col = quantize(w_col, scale, zero_point, bits=4)

        # 量化误差
        error = (w_col - dequantize(w_quant_col, scale, zero_point))

        # 用 Hessian 逆矩阵将误差补偿到后续列
        # 这是 GPTQ 的核心 —— 让后续列"吸收"当前列的量化误差
        W_quant[:, col+1:] += error.unsqueeze(1) * H_inv[col, col+1:] / H_inv[col, col]

        W_quant[:, col] = w_quant_col

    return W_quant, scales, zero_points
```

#### 4.2.2 AWQ（激活感知权重量化）

**核心洞察**：不是所有权重同等重要。**通过观察激活值**（而非权重本身），找出哪些权重通道更重要，然后给重要的通道更大的量化精度。

```
AWQ 核心直觉:

  模型中有些权重通道的激活值特别大（"salient channels"）
  → 这些通道对模型输出影响更大
  → 量化这些通道会导致更大的精度损失

  解决方案: Per-channel Scaling
  → 对重要通道乘以一个大的 scale 因子 s
  → 量化后再除以 s 恢复
  → 效果: 重要通道获得更细的量化粒度

  W_quant = Quantize(W × diag(s)) / s

  s 的选择: s_j = max(|X_j|)^α，α ∈ [0, 1]（通常 α=0.5）
  X_j 是校准数据中第 j 个通道的激活值
```

**AWQ vs GPTQ 对比**：

| 特性 | GPTQ | AWQ |
|------|------|-----|
| 核心方法 | 逐列量化 + Hessian 误差补偿 | 激活感知通道缩放 |
| 校准数据量 | 128-256 样本 | 128 样本 |
| 量化速度 | 较慢（矩阵运算多） | 快（仅需计算缩放因子） |
| INT4 精度 | 好 | 略好（保护重要通道） |
| 适合场景 | 通用量化 | 注重精度的场景 |
| 框架支持 | vLLM, TRT-LLM, llama.cpp | vLLM, TRT-LLM |

#### 4.2.3 FP8：Hopper/Blackwell 原生支持

FP8 是 NVIDIA Hopper（H100）和 Blackwell（B200/GB200）架构原生支持的数据格式，有两种变体：

```diagram
FP8 数据格式:

E4M3 (4 位指数 + 3 位尾数):
  ┌──┬────────┬───────┐
  │S │ EEEE   │ MMM   │  → 范围: [-448, 448], 精度较高
  │1 │ 4 bits │ 3 bits│  → 适用于: 权重和激活
  └──┴────────┴───────┘

E5M2 (5 位指数 + 2 位尾数):
  ┌──┬─────────┬──────┐
  │S │ EEEEE   │ MM   │  → 范围: [-57344, 57344], 范围更大
  │1 │ 5 bits  │ 2 bits│  → 适用于: 梯度 (训练时)
  └──┴─────────┴──────┘

对比:
  FP16:  1 + 5 + 10 = 16 bits → 精度高，但慢
  FP8:   1 + 4 + 3  = 8 bits  → 2x 吞吐量，精度足够好
  INT8:  无浮点    = 8 bits    → 需要量化/反量化步骤
```

**FP8 相比 INT8 的优势**：

```python
# INT8 量化推理: 需要额外的量化/反量化步骤
def int8_matmul(X_fp16, W_int8, scale_w, zero_point_w):
    W_fp16 = (W_int8 - zero_point_w) * scale_w  # 反量化（额外开销）
    return X_fp16 @ W_fp16.T

# FP8 推理: 硬件原生支持，无需额外步骤
def fp8_matmul(X_fp8, W_fp8):
    return torch.matmul(X_fp8, W_fp8.T)  # H100 Tensor Core 直接计算
    # 结果精度自动提升到 FP16/FP32
```

**FP8 在 H100/B200 上的性能**：

| GPU | FP16 TFLOPS | FP8 TFLOPS | 加速比 |
|-----|-------------|------------|--------|
| A100 SXM | 312 | 不支持 | — |
| H100 SXM | 990 | 1979 | 2x |
| B200 SXM | ~2250 | ~4500 | 2x |
| GB200 NVL72 | — | ~1440 PFLOPS (集群) | — |

#### 4.2.4 GGUF 格式（llama.cpp 的量化格式族）

**类比**：GGUF 就像一个"模型的 zip 包"，把模型参数、分词器、超参数全部打包成一个文件，还支持多种压缩比。

```diagram
GGUF 量化类型矩阵 (llama.cpp):

┌──────────┬─────────┬───────────┬────────────┬───────────┐
│ 类型      │ 平均 BPW│ 模型大小   │ 精度        │ 适用场景   │
│          │(bit/w)  │ (70B 模型) │            │           │
├──────────┼─────────┼───────────┼────────────┼───────────┤
│ Q2_K     │ 2.63    │ ~23 GB    │ ★★         │ 极限压缩   │
│ Q3_K_M   │ 3.07    │ ~27 GB    │ ★★★        │ 内存紧张   │
│ Q4_0     │ 4.00    │ ~35 GB    │ ★★★        │ 基础 4bit  │
│ Q4_K_M   │ 4.58    │ ~40 GB    │ ★★★★       │ 最佳性价比 │
│ Q5_K_M   │ 5.33    │ ~47 GB    │ ★★★★★      │ 高质量     │
│ Q6_K     │ 6.56    │ ~58 GB    │ ★★★★★      │ 接近无损   │
│ Q8_0     │ 8.00    │ ~70 GB    │ ★★★★★★     │ 几乎无损   │
│ F16      │ 16.00   │ ~140 GB   │ ★★★★★★★    │ 原始精度   │
└──────────┴─────────┴───────────┴────────────┴───────────┘

BPW = Bits Per Weight (每个权重的平均 bit 数)
K 系列 = K-Quant (混合精度量化，不同层用不同量化精度)
```

**K-Quant 混合精度的核心思想**：

```
不是所有层同等重要！

Q4_K_M 的实际策略:
- Attention 层的 QKV 权重 → Q6_K (高精度, 这些层更敏感)
- FFN 的 gate/up 权重      → Q4_K (中精度)
- FFN 的 down 权重         → Q4_K (中精度)
- 模型头部/尾部层           → Q6_K (高精度, 第一层和最后几层更重要)
- 中间层的部分权重          → Q4_K (低精度, 不太敏感)

→ 平均下来 4.58 BPW，但精度比均匀 Q4_0 好很多
```

### 4.3 KV Cache 量化

KV Cache 量化是一个独立于权重量化的优化，直接减少推理时的显存占用：

```python
# TensorRT-LLM FP8 KV Cache 示例
class FP8KVCache:
    """FP8 KV Cache 实现思路"""

    def __init__(self, num_layers, num_heads, head_dim, max_seq_len):
        # FP8 存储: 每个元素仅 1 byte (vs FP16 的 2 bytes)
        self.k_cache = torch.zeros(
            (num_layers, max_seq_len, num_heads, head_dim),
            dtype=torch.float8_e4m3fn,  # FP8 E4M3
        )
        self.v_cache = torch.zeros_like(self.k_cache)
        # 每层一个 scale factor
        self.k_scales = torch.ones(num_layers, dtype=torch.float32)
        self.v_scales = torch.ones(num_layers, dtype=torch.float32)

    def store(self, layer_idx, position, k, v):
        """存入 KV Cache: FP16 → FP8 动态量化"""
        # 计算 scale: 将 FP16 的范围映射到 FP8 范围 [-448, 448]
        k_scale = k.abs().max() / 448.0
        v_scale = v.abs().max() / 448.0

        self.k_cache[layer_idx, position] = (k / k_scale).to(torch.float8_e4m3fn)
        self.v_cache[layer_idx, position] = (v / v_scale).to(torch.float8_e4m3fn)
        self.k_scales[layer_idx] = k_scale
        self.v_scales[layer_idx] = v_scale

    def load(self, layer_idx, positions):
        """读取 KV Cache: FP8 → FP16 反量化"""
        k = self.k_cache[layer_idx, positions].to(torch.float16) * self.k_scales[layer_idx]
        v = self.v_cache[layer_idx, positions].to(torch.float16) * self.v_scales[layer_idx]
        return k, v
```

### 4.4 量化对精度的影响

```diagram
Perplexity 对比 (LLaMA-2 70B, WikiText-2):

┌──────────────┬────────────┬────────────────┬──────────┐
│ 量化方案      │ PPL        │ vs FP16 变化   │ 可接受？  │
├──────────────┼────────────┼────────────────┼──────────┤
│ FP16 (原始)  │ 3.32       │ 基准           │ ✅       │
│ FP8 E4M3     │ 3.33       │ +0.3%         │ ✅ 几乎无损│
│ INT8 (静态)  │ 3.35       │ +0.9%         │ ✅       │
│ AWQ INT4     │ 3.41       │ +2.7%         │ ✅       │
│ GPTQ INT4    │ 3.45       │ +3.9%         │ ✅       │
│ Q4_K_M (GGUF)│ 3.43      │ +3.3%         │ ✅       │
│ Q3_K_M (GGUF)│ 3.68      │ +10.8%        │ ⚠️ 可接受│
│ Q2_K (GGUF)  │ 4.21       │ +26.8%        │ ❌ 明显下降│
└──────────────┴────────────┴────────────────┴──────────┘

经验法则:
- 4 bit 量化: 精度损失 < 5%，大多数任务无感
- 3 bit 量化: 精度损失 5-15%，简单任务可用，复杂推理下降
- 2 bit 量化: 精度损失 > 20%，仅适合极端资源受限场景
```

---

## 5. 推测解码（Speculative Decoding）

### 5.1 核心原理：Draft-Verify 范式

#### 类比：写论文的草稿-审核流程

想象你要写一篇论文。方法 A 是请教授（大模型）逐字逐句地写，每个字都经过深思熟虑——准确但极慢。方法 B 是：

1. **先让助研（小模型）快速写一段草稿**（Draft，5 个词只需 1 个"大模型时间单位"）
2. **教授一次性审核这段草稿**（Verify，可以并行检查所有 5 个词）
3. **接受所有正确的词，从第一个错误处重写**

如果草稿质量足够好（80% 的词被接受），那平均每个"大模型时间单位"可以产出 4 个正确的词——**接近 4 倍加速**。

#### 数学保证：输出分布不变

推测解码最关键的性质是**它不改变输出分布**——即使用了 draft model，最终输出的概率分布与只用 target model 完全相同。

```
Speculative Decoding 验证算法:

对于 draft model 生成的每个 token x_i:
  p(x_i) = target model 对 x_i 的概率
  q(x_i) = draft model 对 x_i 的概率

  接受概率 = min(1, p(x_i) / q(x_i))

  if 随机数 < 接受概率:
      接受 x_i（继续验证下一个 token）
  else:
      拒绝 x_i
      从调整后的分布中重新采样:
        p'(x) = normalize(max(0, p(x) - q(x)))
      → 这个 rejection sampling 保证最终分布 = p(x)
```

```python
def speculative_decode(
    target_model,
    draft_model,
    input_ids,
    gamma: int = 5,  # 每次推测的 token 数
    temperature: float = 1.0,
):
    """推测解码核心实现"""
    generated = list(input_ids)

    while not finished:
        # === Phase 1: Draft (快速生成 gamma 个候选 token) ===
        draft_tokens = []
        draft_probs = []
        draft_input = generated.copy()

        for _ in range(gamma):
            logits = draft_model(draft_input)
            prob = softmax(logits / temperature)
            token = sample(prob)
            draft_tokens.append(token)
            draft_probs.append(prob)
            draft_input.append(token)

        # === Phase 2: Verify (大模型一次性验证所有候选) ===
        # 关键：大模型只需要一次前向传播！
        verify_input = generated + draft_tokens
        target_logits = target_model(verify_input)  # 并行计算所有位置
        target_probs = [softmax(l / temperature) for l in target_logits]

        # === Phase 3: Accept/Reject ===
        accepted = 0
        for i in range(gamma):
            p_target = target_probs[len(generated) + i][draft_tokens[i]]
            q_draft = draft_probs[i][draft_tokens[i]]

            # Rejection sampling
            accept_prob = min(1.0, p_target / q_draft)
            if random.random() < accept_prob:
                generated.append(draft_tokens[i])
                accepted += 1
            else:
                # 从修正分布中采样
                adjusted_prob = torch.clamp(
                    target_probs[len(generated) + i] - draft_probs[i], min=0
                )
                adjusted_prob /= adjusted_prob.sum()
                new_token = sample(adjusted_prob)
                generated.append(new_token)
                break  # 后续 draft tokens 全部丢弃

        # 如果所有 gamma 个都接受了，bonus: 再从 target 采样一个
        if accepted == gamma:
            bonus_token = sample(target_probs[len(generated)])
            generated.append(bonus_token)

    return generated
```

### 5.2 推测解码的多种实现方式

#### 5.2.1 独立 Draft Model

最经典的方式：用一个同架构的小模型作为 draft model。

```
LLaMA-3 70B (target) + LLaMA-3 8B (draft):

性能数据:
  Draft speed: 8B 模型在 A100 上 ~100 tokens/s
  Verify speed: 70B 模型一次验证 gamma=5 个 token
  接受率: ~70-80% (取决于任务和温度)
  有效加速: 1.8-2.5x (相比 70B 单独推理)

限制:
  Draft 模型需要与 Target 分布匹配
  额外占用 GPU 显存 (~16 GB for 8B FP16)
  代码生成等确定性任务接受率高，创意写作接受率低
```

#### 5.2.2 Self-Speculative（同模型 Early Exit）

不需要独立的 draft model，而是用目标模型的前几层作为 "draft"：

```diagram
Self-Speculative Decoding:

  Target Model (70B, 80 layers):
  ┌──────────────────────────────────────┐
  │ Layer 1-10 ← 作为 Draft (前 10 层)   │ → 生成草稿 tokens
  │ Layer 11-80 ← 完整验证               │ → 验证/修正
  └──────────────────────────────────────┘

  优势: 无需额外模型，无额外显存
  劣势: 草稿质量较低（只用了 1/8 的层），接受率通常 50-60%
```

#### 5.2.3 N-gram Speculative（TensorRT-LLM）

利用已生成的 N-gram 模式预测后续 token——完全不需要模型推理：

```
N-gram 推测:

  已生成序列: "The function takes a list of integers and returns"
  
  N-gram 匹配:
    观察到 "list of" 之前出现过 "list of integers"
    → 推测下一个 token 可能是 "integers"
    
  特别适合:
  - 代码生成（重复的模式多，如 for 循环、函数签名）
  - 模板化文本
  - 翻译（双语对照有规律）

  加速: 1.1-1.5x（取决于重复率）
  成本: 几乎为零（只是查表）
```

#### 5.2.4 Medusa 多头预测

在模型顶部添加多个预测头，同时预测未来多个位置的 token：

```diagram
Medusa 架构:

  原始 LM Head:     预测 position t
  Medusa Head 1:    预测 position t+1
  Medusa Head 2:    预测 position t+2
  Medusa Head 3:    预测 position t+3

  ┌─────────────────────┐
  │  Transformer Layers  │
  │  (共享，不额外训练)   │
  └──────────┬──────────┘
             │ hidden_state
     ┌───────┼───────┬───────┐
     ▼       ▼       ▼       ▼
  ┌─────┐┌─────┐┌─────┐┌─────┐
  │LM   ││Head ││Head ││Head │
  │Head ││  1  ││  2  ││  3  │
  └──┬──┘└──┬──┘└──┬──┘└──┬──┘
     ▼      ▼      ▼      ▼
   tok_t  tok_t+1 tok_t+2 tok_t+3

  训练: 冻结 Transformer，只训练 Medusa Heads
  参数量: 每个 Head 约 1-2% 额外参数
  加速: 2-3x（无需额外模型！）
```

### 5.3 加速比分析与适用场景

```
推测解码加速比估算公式:

  加速比 ≈ (1 - α^(γ+1)) / ((1 - α) × (c × γ + 1))

  其中:
  α = 接受率 (draft token 被 target 接受的概率)
  γ = 推测长度 (每次 draft 的 token 数)
  c = draft 成本比 (draft 一步 / target 一步的时间比)

  示例: α=0.8, γ=5, c=0.1 (draft 比 target 快 10x)
  加速比 ≈ (1 - 0.8^6) / ((1 - 0.8) × (0.1×5 + 1))
         ≈ 0.738 / (0.2 × 1.5)
         ≈ 2.46x
```

| 方式 | 额外显存 | 加速比 | 实现复杂度 | 最佳场景 |
|------|---------|--------|----------|---------|
| Independent Draft | 大 | 1.8-2.5x | 中 | 有显存余量 |
| Self-Speculative | 无 | 1.3-1.5x | 低 | 显存紧张 |
| N-gram | 几乎无 | 1.1-1.5x | 低 | 高重复文本 |
| Medusa | 小 | 2-3x | 中 | 需要训练 Heads |

### 5.4 推测解码 + 结构化输出

TensorRT-LLM blog 中提出的创新：将推测解码与引导式解码（Guided Decoding）结合。

```
传统方案: 推测解码和 JSON Schema 约束分别处理
  → Draft model 可能生成不符合 Schema 的 token
  → 验证时被拒绝 → 浪费了推测的计算

优化方案 (TensorRT-LLM Combining Guided + Speculative):
  1. Draft 阶段就使用 FSM 约束，只生成合法 token
  2. 大幅提高接受率（因为合法 token 空间更小）
  3. 结构化输出 + 推测解码 → 3-5x 加速
```

---

## 6. 分布式推理架构

### 6.1 四种并行策略的原理与适用场景

#### 类比：如何拆分一个大拼图任务

想象你要拼一副 10000 片的巨型拼图：

- **张量并行 (TP)**：把每一行拼图分给不同的人，每个人只拼一部分列 → 需要频繁对照邻接部分
- **流水线并行 (PP)**：把拼图分成上、中、下区域，每个人负责一个区域 → 上面的人做完才能做下面的
- **数据并行 (DP)**：每人各拿一份相同的小拼图，同时拼 → 最后合并结果
- **专家并行 (EP)**：每个人是不同领域的专家（天空/建筑/草地），动态分配任务 → MoE 模型专用

#### 6.1.1 张量并行 (Tensor Parallelism, TP)

```diagram
张量并行: 将模型的每一层切分到多个 GPU

                    单 GPU                          2-way TP
┌────────────────────────┐        ┌───────────────┐ ┌───────────────┐
│  Attention Head 0-63   │   →    │ GPU 0         │ │ GPU 1         │
│  FFN [hidden, 4×hidden]│        │ Head 0-31     │ │ Head 32-63    │
│                        │        │ FFN[:, :2h]   │ │ FFN[:, 2h:]   │
└────────────────────────┘        └───────┬───────┘ └───────┬───────┘
                                          │ AllReduce       │
                                          └────────┬────────┘
                                                   ▼
                                         合并结果，继续下一层

Attention 头的切分:
  每个 GPU 持有 num_heads/TP_size 个头
  Q, K, V 矩阵按 head 维度切分
  每个 GPU 独立计算自己的 attention
  最后 AllReduce 合并输出

MLP 的切分:
  Gate/Up projection: 按列切分 (Column Parallel)
    GPU 0: W_gate[:, :hidden_size]
    GPU 1: W_gate[:, hidden_size:]
  Down projection: 按行切分 (Row Parallel)
    GPU 0: W_down[:hidden_size, :]
    GPU 1: W_down[hidden_size:, :]
  → 只需要一次 AllReduce
```

**TP 的通信开销**：

```python
# TP 通信分析
# 每层需要 2 次 AllReduce:
#   1. Attention output 合并
#   2. MLP output 合并

# AllReduce 通信量 = 2 × (TP - 1) / TP × hidden_size × batch × seq_len × 2 bytes
# 对于 LLaMA-3 70B, hidden=8192, TP=4:
#   每层通信 ≈ 2 × 0.75 × 8192 × B × S × 2 ≈ 24,576 × B × S bytes

# 通信/计算比:
#   TP=2: 每层 1 次 AllReduce, 延迟 ~5μs (NVLink)
#   TP=4: 每层 1 次 AllReduce, 延迟 ~10μs (NVLink)
#   TP=8: 每层 1 次 AllReduce, 延迟 ~20μs (NVLink)

# 结论: TP 强烈依赖高带宽互联 (NVLink 900 GB/s)
# 跨节点 TP (仅 InfiniBand 400 Gb/s ≈ 50 GB/s) 会严重降速
```

#### 6.1.2 流水线并行 (Pipeline Parallelism, PP)

```diagram
流水线并行: 将模型的不同层放在不同 GPU

LLaMA-3 70B (80 layers), PP=4:

  GPU 0: Embedding + Layer 0-19
  GPU 1: Layer 20-39
  GPU 2: Layer 40-59
  GPU 3: Layer 60-79 + LM Head

  前向传播:
  GPU 0 ──→ GPU 1 ──→ GPU 2 ──→ GPU 3
  (仅传递 hidden states，通信量很小)

优势:
  - 通信量极小（只传中间激活，不是全模型）
  - 可以跨节点使用（对带宽要求低）

劣势:
  - Pipeline Bubble: 前面的 GPU 等后面的 GPU 完成
  - 延迟增加（顺序传播）
  
  Bubble 率 ≈ (PP - 1) / (PP - 1 + num_microbatches)
  → 微批次数越多，bubble 越小
```

#### 6.1.3 数据并行 (Data Parallelism, DP)

```
数据并行: 每个 GPU 持有完整模型副本，处理不同的请求

  DP=4 (4 个完整模型副本):

  GPU 0: [完整模型] ← 请求 1, 5, 9, 13...
  GPU 1: [完整模型] ← 请求 2, 6, 10, 14...
  GPU 2: [完整模型] ← 请求 3, 7, 11, 15...
  GPU 3: [完整模型] ← 请求 4, 8, 12, 16...

  负载均衡器 (DP Coordinator) 按请求量分配

优势:
  - 线性扩展吞吐量
  - 各副本独立，无通信开销
  - 可以动态调整副本数

劣势:
  - 每个副本需要足够显存放整个模型
  - 小模型 (如 7B) 非常适合 DP
  - 大模型 (如 70B) 通常需要 TP+DP 组合
```

#### 6.1.4 专家并行 (Expert Parallelism, EP)

```
专家并行: MoE 模型专用，将不同 Expert 放在不同 GPU

DeepSeek-V3 (256 Experts, Top-8 路由):

  EP=8 (8 个 GPU):
  GPU 0: Expert 0-31    (32 个 Expert)
  GPU 1: Expert 32-63   (32 个 Expert)
  GPU 2: Expert 64-95   (32 个 Expert)
  ...
  GPU 7: Expert 224-255 (32 个 Expert)

  推理流程:
  1. 每个 token 经过 Router，选择 Top-8 个 Expert
  2. 将 token 通过 AlltoAll 发送到对应 Expert 所在的 GPU
  3. Expert 计算完成后，AlltoAll 收集结果
  4. 合并 Expert 输出

  通信模式: AlltoAll (每个 GPU 向每个其他 GPU 发送不同的数据)
  → NVLink 的 one-sided AlltoAll 优化关键 (TensorRT-LLM)
```

### 6.2 vLLM V1 多进程架构

vLLM V1 采用了全新的多进程架构，解决了 V0 的性能瓶颈：

```diagram
vLLM V1 架构 (以 TP=4, DP=2 为例):

┌──────────────────────────────────────────────────────────┐
│                    API Server Process                     │
│ (处理 HTTP 请求, OpenAI API 兼容层)                        │
│ FastAPI + Uvicorn                                        │
└────────────────────────┬─────────────────────────────────┘
                         │ ZMQ IPC
┌────────────────────────▼─────────────────────────────────┐
│              DP Coordinator Process (可选)                 │
│ (当 DP > 1 时启动，负载均衡分配请求到不同 DP rank)           │
└──────────┬─────────────────────────────┬─────────────────┘
           │ ZMQ IPC                     │ ZMQ IPC
┌──────────▼──────────┐      ┌───────────▼─────────────┐
│ Engine Core (DP=0)  │      │  Engine Core (DP=1)     │
│ (调度器 + 分词器)    │      │  (调度器 + 分词器)       │
└──────────┬──────────┘      └───────────┬─────────────┘
           │ ZMQ                         │ ZMQ
   ┌───────┼───────┐             ┌───────┼───────┐
   ▼       ▼       ▼             ▼       ▼       ▼
┌─────┐ ┌─────┐ ┌─────┐      ┌─────┐ ┌─────┐ ┌─────┐
│GPU  │ │GPU  │ │GPU  │      │GPU  │ │GPU  │ │GPU  │
│Wkr 0│ │Wkr 1│ │Wkr 2│      │Wkr 4│ │Wkr 5│ │Wkr 6│
│TP=0 │ │TP=1 │ │TP=2 │      │TP=0 │ │TP=1 │ │TP=2 │
└─────┘ └─────┘ └─────┘      └─────┘ └─────┘ └─────┘
  ↕ NCCL AllReduce ↕            ↕ NCCL AllReduce ↕
```

**进程数计算公式**：

```
总进程数 = 1 (API Server)
         + 1 (DP Coordinator, 仅 DP > 1 时)
         + DP (Engine Core 进程数)
         + DP × TP (GPU Worker 进程数)

示例: TP=4, DP=2
  = 1 + 1 + 2 + 2×4
  = 12 个进程

ZMQ 通信:
  API Server ↔ Engine Core: IPC 套接字 (毫秒级)
  Engine Core ↔ GPU Workers: IPC 套接字 (毫秒级)
  GPU Workers 之间: NCCL AllReduce (微秒级, NVLink)
```

### 6.3 Prefill-Decode 分离（Disaggregated Serving）

#### 为什么要分离？

```diagram
Prefill 和 Decode 的资源需求完全不同:

┌──────────────────────────────────────────────────┐
│                资源需求对比                         │
├───────────────┬──────────────┬────────────────────┤
│               │  Prefill     │  Decode            │
├───────────────┼──────────────┼────────────────────┤
│ 计算模式      │ Compute-bound│ Memory-bound       │
│ GPU 利用率    │ 90-100%      │ 10-30%             │
│ 显存带宽利用率 │ 30-50%      │ 90-100%            │
│ 理想 GPU     │ 算力强 (H100) │ 带宽高 (多卡)       │
│ Batch Size   │ 小 (1-4)     │ 大 (64-256)        │
│ 延迟影响      │ TTFT         │ TPS/TPOT           │
└───────────────┴──────────────┴────────────────────┘

混合部署问题:
  当 Prefill 和 Decode 在同一 GPU 上混合:
  - 长 Prefill 会阻塞 Decode（TPOT 抖动）
  - Decode 占满显存后，Prefill 无法启动（TTFT 上升）
  - GPU 在两种模式间频繁切换，利用率下降
```

#### SGLang 的 PD 分离方案

```diagram
SGLang Prefill-Decode 分离架构:

┌─────────────┐
│  Router     │ ← 接收所有请求
│ (负载均衡)   │
└──────┬──────┘
       │
   ┌───┴───┐
   ▼       ▼
┌──────┐ ┌──────┐    Prefill 集群 (Compute-optimized)
│ P-GPU│ │ P-GPU│    - 高算力 GPU
│  0   │ │  1   │    - 小 batch，大 seq_len
└──┬───┘ └──┬───┘    - 计算完后通过网络传输 KV Cache
   │        │
   │ KV Cache Transfer (RDMA / NVLink)
   │        │
   ▼        ▼
┌──────┐ ┌──────┐ ┌──────┐    Decode 集群 (Memory-optimized)
│ D-GPU│ │ D-GPU│ │ D-GPU│    - 高带宽 GPU，数量更多
│  0   │ │  1   │ │  2   │    - 大 batch，每步只处理 1 token/请求
└──────┘ └──────┘ └──────┘    - 显存主要用于 KV Cache
```

**KV Cache 传输优化**：

```
传输量估算 (LLaMA-3 70B, 1024 input tokens, FP16):
  KV Cache = 2 × 80 layers × 8 heads × 128 dim × 1024 tokens × 2 bytes
           = 335 MB

  InfiniBand 400 Gb/s (单向 50 GB/s):
    传输时间 = 335 MB / 50 GB/s ≈ 6.7 ms

  NVLink 900 GB/s (同节点):
    传输时间 = 335 MB / 900 GB/s ≈ 0.37 ms

  → 同节点 NVLink 传输几乎无感
  → 跨节点 InfiniBand 需要仔细权衡
```

### 6.4 大规模 EP 部署

SGLang 在大规模 MoE 模型部署上的实践：

```
SGLang + DeepSeek-V3 on 96× H100 GPUs:

EP 配置:
  256 experts / 8 GPUs per EP group = 32 experts per GPU
  12 EP groups across 96 GPUs

数据流:
  1. 输入 token 经过 Shared Attention (TP within node)
  2. Router 计算 Expert 分配
  3. AlltoAll: 将 token 发送到对应 Expert 的 GPU
  4. Expert 计算
  5. AlltoAll: 收集结果回原 GPU
  6. 合并输出

NVLink 内 AlltoAll 通信优化:
  - 同节点 8 GPU: NVLink 900 GB/s → ~0.1ms AlltoAll
  - 跨节点: InfiniBand 400 Gb/s → 需要通信/计算重叠

性能数据:
  96× H100: ~4000 tokens/s (FP8, DeepSeek-V3 671B MoE)
```

**GB200 NVL72 的突破**：

```
NVIDIA GB200 NVL72 架构:

  72 个 Blackwell GPU + 36 个 Grace CPU
  NVLink 5: 1.8 TB/s 全互联带宽
  总 HBM3e: 72 × 192 GB = 13.8 TB

  对 MoE 模型的意义:
  - 所有 GPU 通过 NVLink 全互联
  - AlltoAll 延迟极低 → EP 几乎无通信瓶颈
  - DeepSeek-V3 671B: 单个 NVL72 机柜即可部署
  
  SGLang 报告: GB200 NVL72 性能约为 H100 集群的 25 倍
  - H100 8 GPU: ~300 tokens/s
  - GB200 NVL72: ~7500 tokens/s (整个机柜)
```

---

## 7. 结构化输出与约束解码

### 7.1 为什么需要约束解码

#### 类比：填空题 vs 开放式问答

让 LLM 输出 JSON 就像让学生做**填空题**而非写作文。你需要的不是天马行空的回答，而是精确匹配预定义格式的响应：

```json
{
  "name": "___",      // 必须是字符串
  "age": ___,         // 必须是整数
  "skills": ["___"]   // 必须是字符串数组
}
```

没有约束解码，LLM 可能输出：
- 多余的解释文字（"Here is the JSON:"）
- 格式错误（缺少引号、多余逗号）
- 类型错误（age 输出为字符串 "25" 而非数字 25）
- 不完整的 JSON（token 限制截断）

### 7.2 有限状态机 (FSM) 方法

#### 核心原理

将 JSON Schema 或正则表达式编译成有限状态机 (FSM)，在每一步解码时，**只允许 FSM 当前状态可接受的 token**：

```
JSON Schema → FSM → Token Mask

示例: {"type": "object", "properties": {"name": {"type": "string"}}}

FSM 状态转换:
  State 0: 期望 '{'
  State 1: 期望 '"' (key 开始)
  State 2: 期望 'n', 'a', 'm', 'e' (key 名称)
  State 3: 期望 '"' (key 结束)
  State 4: 期望 ':'
  State 5: 期望 '"' (value 开始)
  State 6: 期望 任意字符串内容
  State 7: 期望 '"' (value 结束)
  State 8: 期望 '}' 或 ','

在 State 0:
  允许的 token: { '{' }
  Token mask: [0, 0, ..., 1, ..., 0]  (仅 '{' 对应的位置为 1)
  → 将不允许的 token 的 logits 设为 -inf
```

```python
class FSMConstrainedDecoder:
    """FSM 约束解码器（简化实现）"""

    def __init__(self, schema: dict, tokenizer):
        self.tokenizer = tokenizer
        # 将 JSON Schema 编译为 FSM
        self.fsm = compile_json_schema_to_fsm(schema)
        self.current_state = self.fsm.initial_state

    def get_token_mask(self) -> torch.Tensor:
        """根据 FSM 当前状态，返回允许的 token mask"""
        allowed_tokens = set()

        # 获取 FSM 当前状态允许的下一个字符
        allowed_chars = self.fsm.get_allowed_chars(self.current_state)

        # 找出哪些 token 的首字符在允许范围内
        for token_id in range(self.tokenizer.vocab_size):
            token_str = self.tokenizer.decode([token_id])
            if token_str and token_str[0] in allowed_chars:
                # 验证整个 token 是否与 FSM 兼容
                if self._is_token_compatible(token_str):
                    allowed_tokens.add(token_id)

        mask = torch.full((self.tokenizer.vocab_size,), float('-inf'))
        mask[list(allowed_tokens)] = 0.0
        return mask

    def apply_constraint(self, logits: torch.Tensor) -> torch.Tensor:
        """在 logits 上应用 FSM 约束"""
        mask = self.get_token_mask()
        return logits + mask  # -inf 位置的 token 概率变为 0

    def advance(self, token_id: int):
        """解码一个 token 后，更新 FSM 状态"""
        token_str = self.tokenizer.decode([token_id])
        for char in token_str:
            self.current_state = self.fsm.transition(self.current_state, char)
```

#### SGLang 的 Compressed FSM（3x faster JSON）

SGLang 的关键优化：**跳过 FSM 中不需要解码的确定性 token**。

```
传统 FSM:
  每个 token 都需要:
    1. 计算 logits (GPU 前向传播)
    2. 应用 mask
    3. 采样

  对于 {"name": "____"}:
    { → logits + mask + sample  (确定性: 只有 '{' 合法)
    " → logits + mask + sample  (确定性: 只有 '"' 合法)
    n → logits + mask + sample  (确定性: schema 指定的 key)
    a → logits + mask + sample  (确定性)
    m → logits + mask + sample  (确定性)
    e → logits + mask + sample  (确定性)
    " → logits + mask + sample  (确定性)
    : → logits + mask + sample  (确定性)
    " → logits + mask + sample  (确定性)
    值 → logits + mask + sample  ← 只有这里真正需要采样！
    " → logits + mask + sample  (确定性)
    } → logits + mask + sample  (确定性)

  → 12 次前向传播，但只有 1 次真正有"选择"

SGLang Compressed FSM:
  检测到 '{"name":"' 是确定性前缀
  → 直接一次性生成，跳过 8 次前向传播
  → 只需 ~4 次前向传播
  → ~3x 加速！
```

### 7.3 Grammar-based Decoding（llama.cpp 的 GBNF）

llama.cpp 支持 GBNF（GGML BNF）格式的上下文无关文法约束：

```
GBNF 示例 (JSON 数组约束):

root   ::= "[" ws items "]"
items  ::= item ("," ws item)*
item   ::= number | string
number ::= [0-9]+
string ::= "\"" [a-zA-Z0-9 ]+ "\""
ws     ::= [ \t\n]*

使用方式:
$ llama-server --model model.gguf --grammar-file json_array.gbnf

优势:
  - 支持任意上下文无关文法（比 regex 更强大）
  - 可以约束 XML, SQL, 代码语法等
  - llama.cpp 原生支持，性能好
```

---

## 8. 推理引擎架构对比

### 8.1 vLLM：通用高性能服务

```diagram
vLLM 架构特点:

┌──────────────────────────────────────────┐
│              vLLM 系统架构                 │
├──────────────────────────────────────────┤
│                                          │
│  核心创新:                                │
│  - PagedAttention (SOSP 2023)            │
│  - Continuous Batching                   │
│  - V1 多进程架构 (ZMQ IPC)               │
│  - Prefix Caching (APC)                  │
│                                          │
│  支持的优化:                              │
│  - TP / PP / DP / EP                     │
│  - FP4 / FP8 / INT4 / AWQ / GPTQ 量化   │
│  - Speculative Decoding                  │
│  - Chunked Prefill                       │
│  - Multi-LoRA serving                    │
│  - Structured Output (Outlines/xgrammar) │
│                                          │
│  API:                                    │
│  - OpenAI 兼容 API                       │
│  - Chat / Completions / Embeddings       │
│  - 支持 Tool Calling                     │
│                                          │
│  部署规模:                                │
│  - 被众多公司用于生产部署                   │
│  - 活跃的开源社区                          │
│  - 支持 100+ 模型架构                     │
└──────────────────────────────────────────┘
```

**vLLM 快速部署示例**：

```python
# 方式 1: Python API
from vllm import LLM, SamplingParams

llm = LLM(
    model="meta-llama/Llama-3-70B-Instruct",
    tensor_parallel_size=4,
    quantization="fp8",            # FP8 量化
    enable_prefix_caching=True,    # 启用前缀缓存
    max_model_len=8192,
    gpu_memory_utilization=0.90,
)

params = SamplingParams(temperature=0.7, top_p=0.9, max_tokens=512)
outputs = llm.generate(["Explain quantum computing"], params)

# 方式 2: 启动 OpenAI 兼容服务
# $ vllm serve meta-llama/Llama-3-70B-Instruct \
#     --tensor-parallel-size 4 \
#     --quantization fp8 \
#     --enable-prefix-caching \
#     --port 8000

# 方式 3: 使用 OpenAI SDK 调用
from openai import OpenAI

client = OpenAI(base_url="http://localhost:8000/v1", api_key="dummy")
response = client.chat.completions.create(
    model="meta-llama/Llama-3-70B-Instruct",
    messages=[{"role": "user", "content": "Explain quantum computing"}],
    temperature=0.7,
)
```

### 8.2 SGLang：高吞吐 + 结构化输出优化

```diagram
SGLang 架构特点:

┌──────────────────────────────────────────┐
│             SGLang 系统架构                │
├──────────────────────────────────────────┤
│                                          │
│  核心创新:                                │
│  - RadixAttention (前缀缓存)              │
│  - Zero-overhead CPU Scheduler           │
│  - Compressed FSM (3x faster JSON)       │
│  - Prefill-Decode 分离                   │
│                                          │
│  大规模部署:                              │
│  - 96× H100 GPU EP 部署                  │
│  - GB200 NVL72 支持 (25x 性能)           │
│  - 驱动 400K+ GPU                        │
│                                          │
│  生态系统:                                │
│  - RL backbone (AReaL, verl, OpenRLHF)   │
│  - PyTorch 原生生态                       │
│  - 被 xAI/AMD/NVIDIA/Intel/LinkedIn/     │
│    Cursor 等采用                          │
│                                          │
│  API:                                    │
│  - OpenAI 兼容 API                       │
│  - Native SGLang Frontend (Python DSL)   │
│  - 批处理 API                            │
└──────────────────────────────────────────┘
```

**SGLang 部署示例**：

```python
# 启动服务
# $ python -m sglang.launch_server \
#     --model-path meta-llama/Llama-3-70B-Instruct \
#     --tp 4 \
#     --port 30000

# 使用 SGLang Python DSL（原生前端）
import sglang as sgl

@sgl.function
def multi_turn_chat(s, question1, question2):
    s += sgl.system("You are a helpful assistant.")
    s += sgl.user(question1)
    s += sgl.assistant(sgl.gen("answer1", max_tokens=256))
    s += sgl.user(question2)
    s += sgl.assistant(sgl.gen("answer2", max_tokens=256))

# RadixAttention 自动缓存重复前缀
state = multi_turn_chat.run(
    question1="What is machine learning?",
    question2="Can you give me an example?",
)
print(state["answer1"])
print(state["answer2"])

# 使用 OpenAI 兼容 API（同样可行）
from openai import OpenAI

client = OpenAI(base_url="http://localhost:30000/v1", api_key="None")
response = client.chat.completions.create(
    model="meta-llama/Llama-3-70B-Instruct",
    messages=[{"role": "user", "content": "Hello!"}],
)
```

### 8.3 TensorRT-LLM：NVIDIA 官方极致优化

```diagram
TensorRT-LLM 架构特点:

┌──────────────────────────────────────────┐
│         TensorRT-LLM 系统架构             │
├──────────────────────────────────────────┤
│                                          │
│  核心优化:                                │
│  - FP8 原生支持 (Hopper/Blackwell)       │
│  - CUDA Graph (消除 kernel launch 开销)  │
│  - Sparse Attention                      │
│  - Custom CUDA Kernels                   │
│                                          │
│  MoE 优化:                               │
│  - NVLink one-sided AlltoAll             │
│  - 大规模 EP 部署优化                     │
│  - DeepSeek-R1 Blackwell 优化            │
│                                          │
│  高级特性:                                │
│  - Disaggregated Serving (PD 分离)       │
│  - Inference-time Compute                │
│  - Speculative + Guided Decoding 结合    │
│  - 多模态支持                             │
│                                          │
│  生产部署:                                │
│  - Triton Inference Server 集成          │
│  - 被 Bing, NAVER 等使用                 │
│  - NVIDIA 官方支持与优化                  │
└──────────────────────────────────────────┘
```

```python
# TensorRT-LLM 部署 (简化流程)

# Step 1: 构建引擎 (离线步骤，编译优化)
# $ trtllm-build \
#     --model_dir ./llama-3-70b \
#     --output_dir ./engine \
#     --dtype float16 \
#     --use_fp8_context_fmha enable \
#     --tp_size 4 \
#     --pp_size 1 \
#     --max_batch_size 64 \
#     --max_input_len 4096 \
#     --max_seq_len 8192

# Step 2: 启动推理服务
# $ tritonserver --model-repository ./triton_model_repo

# Step 3: 客户端调用
import tritonclient.grpc as grpcclient

client = grpcclient.InferenceServerClient(url="localhost:8001")
# 构建请求...
```

### 8.4 llama.cpp：边缘设备本地推理

```diagram
llama.cpp 架构特点:

┌──────────────────────────────────────────┐
│          llama.cpp 系统架构               │
├──────────────────────────────────────────┤
│                                          │
│  设计哲学:                                │
│  - 纯 C/C++ 实现，零外部依赖              │
│  - 跨平台: Linux/macOS/Windows/Android   │
│  - 支持多种硬件后端                       │
│                                          │
│  后端支持:                                │
│  - CPU (x86 AVX2/AVX512, ARM NEON)      │
│  - NVIDIA GPU (CUDA)                     │
│  - Apple Silicon (Metal)                 │
│  - AMD GPU (ROCm/Vulkan)                │
│  - Intel GPU (SYCL/Vulkan)              │
│  - WebAssembly (WASM) — 浏览器运行       │
│                                          │
│  GGUF 量化:                              │
│  - 1.5-8 bit 多种量化方案                 │
│  - K-Quant 混合精度                       │
│  - CPU+GPU 混合推理 (部分层在 CPU)        │
│                                          │
│  服务能力:                                │
│  - llama-server (OpenAI 兼容 HTTP API)   │
│  - 多模态支持 (LLaVA/视觉模型)           │
│  - Grammar-based 约束解码 (GBNF)         │
│  - gpt-oss 支持                          │
│                                          │
│  地位:                                    │
│  - 几乎所有本地推理 App 的底层引擎         │
│  - GitHub 70K+ Stars                     │
│  - 最活跃的开源 LLM 推理项目之一           │
└──────────────────────────────────────────┘
```

**llama.cpp CPU+GPU 混合推理**：

```bash
# 混合推理: 将部分层放在 GPU，其余在 CPU
# 适合显存不足以容纳整个模型的情况

$ llama-cli \
    -m llama-3-70b-Q4_K_M.gguf \
    -ngl 40 \               # 前 40 层放 GPU (共 80 层)
    -c 4096 \               # 上下文长度
    -t 16 \                 # CPU 线程数
    -p "Explain quantum computing"

# -ngl 参数控制 GPU 卸载的层数:
#   -ngl 0:  纯 CPU 推理
#   -ngl 40: 混合推理 (一半 GPU, 一半 CPU)
#   -ngl 80: 纯 GPU 推理 (需要足够显存)

# 启动 OpenAI 兼容 API 服务
$ llama-server \
    -m llama-3-70b-Q4_K_M.gguf \
    -ngl 40 \
    --host 0.0.0.0 \
    --port 8080 \
    --n-predict 512
```

### 8.5 Ollama：开发者友好的本地模型管理

```diagram
Ollama 架构特点:

┌──────────────────────────────────────────┐
│            Ollama 系统架构                │
├──────────────────────────────────────────┤
│                                          │
│  设计哲学: "Docker for LLMs"             │
│  - 一条命令运行任何模型                    │
│  - 自动下载、量化、管理模型               │
│  - 类 Docker 的 Modelfile 配置           │
│                                          │
│  底层引擎: llama.cpp                      │
│  - 继承 llama.cpp 的所有硬件支持          │
│  - GGUF 格式模型                         │
│                                          │
│  API:                                    │
│  - REST API (generate/chat/embed)        │
│  - OpenAI 兼容端点                       │
│                                          │
│  开发者集成:                              │
│  - Claude Code 本地模型支持               │
│  - Codex CLI 集成                        │
│  - OpenClaw 支持                         │
│  - 多模型并存与切换                       │
│                                          │
│  模型管理:                                │
│  - ollama pull / push / list / rm        │
│  - 自定义 Modelfile                      │
│  - 模型库 (ollama.com/library)           │
└──────────────────────────────────────────┘
```

```bash
# Ollama 使用示例

# 安装 (一行命令)
$ curl -fsSL https://ollama.com/install.sh | sh

# 运行模型 (自动下载)
$ ollama run llama3:70b
>>> Tell me about quantum computing
...

# 查看本地模型
$ ollama list
NAME              SIZE    MODIFIED
llama3:70b        40 GB   2 hours ago
codellama:34b     19 GB   1 day ago
mistral:7b        4.1 GB  3 days ago

# 自定义 Modelfile
$ cat Modelfile
FROM llama3:70b
SYSTEM "You are a senior software engineer."
PARAMETER temperature 0.3
PARAMETER num_ctx 8192

$ ollama create my-coding-assistant -f Modelfile
$ ollama run my-coding-assistant

# REST API
$ curl http://localhost:11434/api/generate -d '{
    "model": "llama3:70b",
    "prompt": "Write a Python function to sort a list",
    "stream": false
}'

# OpenAI 兼容 API (v0.1.24+)
from openai import OpenAI

client = OpenAI(base_url="http://localhost:11434/v1", api_key="ollama")
response = client.chat.completions.create(
    model="llama3:70b",
    messages=[{"role": "user", "content": "Hello!"}],
)
```

### 8.6 架构对比总表

| 特性 | vLLM | SGLang | TensorRT-LLM | llama.cpp | Ollama |
|------|------|--------|--------------|-----------|--------|
| **核心语言** | Python + CUDA | Python + CUDA | C++ + CUDA | C/C++ | Go + llama.cpp |
| **KV Cache 管理** | PagedAttention | RadixAttention | 池化管理 | 连续分配 | 继承 llama.cpp |
| **批处理** | Continuous | Continuous + Zero-overhead | Continuous | 基础批处理 | 单请求为主 |
| **量化支持** | FP4/FP8/INT4/AWQ/GPTQ | FP8/INT4/AWQ/GPTQ | FP8 原生/INT4 | GGUF 全系列 | GGUF |
| **分布式** | TP/PP/DP/EP | TP/DP/EP | TP/PP/EP | 不支持 | 不支持 |
| **结构化输出** | Outlines/xgrammar | Compressed FSM | Guided Decoding | GBNF Grammar | 不支持 |
| **推测解码** | ✅ | ✅ | ✅ (含 N-gram) | ✅ | ❌ |
| **PD 分离** | 实验性 | ✅ | ✅ | ❌ | ❌ |
| **硬件支持** | NVIDIA/AMD/TPU | NVIDIA/AMD | 仅 NVIDIA | 全平台 | 全平台 |
| **API 兼容** | OpenAI | OpenAI + Native | Triton/OpenAI | OpenAI | OpenAI + REST |
| **适用场景** | 通用高并发服务 | 高吞吐 + RL | 极致 NVIDIA 性能 | 本地/边缘推理 | 开发者本地使用 |
| **易用性** | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **性能** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |

**选型决策树**：

```diagram
需要部署 LLM 推理？
│
├─ 开发者本地测试？
│  └─ Ollama （一条命令搞定）
│
├─ 边缘设备 / 无 GPU / Apple Silicon？
│  └─ llama.cpp + GGUF 量化
│
├─ 云端生产部署？
│  │
│  ├─ 仅 NVIDIA GPU + 追求极致性能？
│  │  └─ TensorRT-LLM + FP8
│  │
│  ├─ 大量前缀复用 / 结构化输出密集？
│  │  └─ SGLang （RadixAttention + Compressed FSM）
│  │
│  ├─ 通用高并发 / 多模型 / 多 LoRA？
│  │  └─ vLLM （生态最完善）
│  │
│  └─ RL 训练 backbone？
│     └─ SGLang （AReaL, verl, OpenRLHF 集成）
│
└─ MoE 大规模部署 (DeepSeek-V3 等)？
   ├─ NVIDIA NVLink 集群 → SGLang EP / TensorRT-LLM EP
   └─ GB200 NVL72 → SGLang (原生支持)
```

---

## 9. 生产部署实践

### 9.1 从 "能跑" 到 "好用" 的关键步骤

```
Stage 1: "能跑" — 基础部署
  ✅ 选择推理引擎，加载模型
  ✅ 基本功能验证
  ❌ 无监控、无优化、单实例

Stage 2: "跑得快" — 性能优化
  ✅ 量化 (FP8/INT4)
  ✅ TP/DP 配置
  ✅ Prefix Caching
  ✅ 调优 batch size 和显存分配

Stage 3: "跑得稳" — 生产化
  ✅ 健康检查 + 自动重启
  ✅ 负载均衡 + 水平扩展
  ✅ 监控告警 (Prometheus + Grafana)
  ✅ 请求限流 + 超时控制

Stage 4: "跑得省" — 成本优化
  ✅ GPU 利用率监控 + 自动伸缩
  ✅ 混合精度选择 (FP8 vs INT4)
  ✅ 模型选型 (大模型 vs 小模型 + routing)
  ✅ Spot Instance / Reserved Instance
```

### 9.2 性能调优 Checklist

```python
# vLLM 性能调优参数参考

vllm_config = {
    # === 基础配置 ===
    "model": "meta-llama/Llama-3-70B-Instruct",
    "tensor_parallel_size": 4,           # TP 大小 (同节点 GPU 数)
    "pipeline_parallel_size": 1,         # PP 大小 (跨节点时使用)

    # === 显存管理 ===
    "gpu_memory_utilization": 0.90,      # GPU 显存利用率上限
    "max_model_len": 8192,               # 最大序列长度
    "block_size": 16,                    # PagedAttention 块大小
    "swap_space": 4,                     # CPU swap 空间 (GB)

    # === 量化 ===
    "quantization": "fp8",               # 量化方式
    "kv_cache_dtype": "fp8_e4m3",        # KV Cache 量化

    # === 批处理 ===
    "max_num_seqs": 256,                 # 最大并发序列数
    "max_num_batched_tokens": 8192,      # 每步最大 token 数

    # === 前缀缓存 ===
    "enable_prefix_caching": True,       # 启用 APC

    # === 推测解码 ===
    "speculative_model": "meta-llama/Llama-3-8B-Instruct",
    "num_speculative_tokens": 5,         # 推测长度

    # === 其他优化 ===
    "enable_chunked_prefill": True,      # 分块预填充
    "enforce_eager": False,              # False = 使用 CUDA Graph
}
```

### 9.3 监控指标

```diagram
核心监控指标 (四大黄金指标):

┌────────────────┬──────────────────┬─────────────────────┐
│ 指标            │ 含义              │ 目标值              │
├────────────────┼──────────────────┼─────────────────────┤
│ TTFT           │ 首 Token 延迟     │ < 500ms (P95)      │
│ (Time To First │ (用户感知的       │ < 200ms (P50)      │
│  Token)        │  等待时间)        │                     │
├────────────────┼──────────────────┼─────────────────────┤
│ TPS / TPOT     │ 每秒生成 Token    │ > 30 tokens/s      │
│ (Tokens Per    │ / 每 Token 耗时   │ (单请求)            │
│  Second / Time │                  │                     │
│  Per Output    │                  │                     │
│  Token)        │                  │                     │
├────────────────┼──────────────────┼─────────────────────┤
│ 吞吐量          │ 系统整体每秒      │ 取决于硬件和模型     │
│ (Throughput)   │ 输出 Token 数     │                     │
├────────────────┼──────────────────┼─────────────────────┤
│ GPU 利用率      │ GPU SM 活跃率     │ > 80%              │
│                │ + 显存利用率       │ 显存 > 85%          │
└────────────────┴──────────────────┴─────────────────────┘

辅助监控指标:
- 请求队列长度 (> 100 需要扩容)
- KV Cache 使用率 (> 95% 需要优化或扩容)
- 请求超时率 (> 1% 需要调查)
- 抢占率 (> 5% 说明显存不足)
- Token 配额使用率 (成本控制)
```

```python
# Prometheus 监控指标示例 (vLLM 内置)
"""
# GPU 利用率
vllm:gpu_cache_usage_perc          # KV Cache 显存使用百分比
vllm:num_requests_running          # 当前运行中的请求数
vllm:num_requests_waiting          # 等待队列中的请求数
vllm:num_requests_swapped          # 被交换到 CPU 的请求数

# 延迟指标
vllm:e2e_request_latency_seconds   # 端到端请求延迟
vllm:time_to_first_token_seconds   # TTFT
vllm:time_per_output_token_seconds # TPOT

# 吞吐量指标
vllm:generation_tokens_total       # 生成的总 token 数
vllm:prompt_tokens_total           # 接收的总 prompt token 数

# 抢占指标
vllm:num_preemptions_total         # 抢占次数
vllm:preemption_count              # 同时被抢占的序列数
"""
```

### 9.4 成本优化策略

```diagram
GPU 推理成本优化策略:

┌─────────────────────────────────────────────────────┐
│ 策略 1: 选择正确的量化级别                             │
│                                                     │
│  FP16 → FP8:  显存减半, 吞吐翻倍, 精度几乎无损        │
│  FP16 → INT4: 显存降 75%, 吞吐 3-4x, 精度微降         │
│                                                     │
│  70B FP16: 需要 4× A100 80GB                        │
│  70B FP8:  需要 2× A100 80GB                        │
│  70B INT4: 需要 1× A100 80GB                        │
│                                                     │
│  成本差: 4x → 2x → 1x (GPU 数量直接影响成本)         │
├─────────────────────────────────────────────────────┤
│ 策略 2: 模型路由 (Model Routing)                      │
│                                                     │
│  简单请求 → 小模型 (7B/8B): 成本低, 速度快            │
│  复杂请求 → 大模型 (70B):   成本高, 质量好             │
│                                                     │
│  路由器: 根据请求复杂度、用户等级、业务场景分流         │
│  效果: 80% 请求用小模型, 成本降低 60-70%              │
├─────────────────────────────────────────────────────┤
│ 策略 3: Prefix Caching                               │
│                                                     │
│  多轮对话: 前缀复用率 80-95%                          │
│  → Prefill 计算减少 80-95%                           │
│  → GPU 资源需求降低, 成本节省                         │
├─────────────────────────────────────────────────────┤
│ 策略 4: 自动伸缩 (Auto-scaling)                       │
│                                                     │
│  基于请求量和 GPU 利用率动态调整副本数                  │
│  低谷期缩容 → 高峰期扩容                              │
│  结合 Spot Instance → 额外节省 50-70%                │
└─────────────────────────────────────────────────────┘
```

---

## 10. 实战案例：用 vLLM 部署 DeepSeek-V3

### 10.1 环境准备与模型分析

```
DeepSeek-V3 模型参数:
  总参数量: 671B (MoE, 每 token 激活 37B)
  Expert 数: 256 + 1 共享
  层数: 61
  Hidden Size: 7168
  KV Heads: 128 (MLA, Multi-head Latent Attention)
  训练精度: FP8

硬件需求评估:
  FP8 权重: 671B × 1 byte ≈ 671 GB
  → 最少需要 8× H100 80GB (TP=8) 或 4× H100 80GB (TP=4, 部分卸载)
  → 推荐: 8× H100 80GB NVLink (单节点)

  更优方案 (EP):
  → 每个 GPU 只需放 256/EP_size 个 Expert
  → 8× H100 EP: 每 GPU 32 Expert ≈ ~85 GB/GPU (FP8)
```

### 10.2 部署配置

```bash
# 使用 vLLM 部署 DeepSeek-V3

# 方案 1: 8-GPU TP (张量并行)
$ vllm serve deepseek-ai/DeepSeek-V3 \
    --tensor-parallel-size 8 \
    --quantization fp8 \
    --max-model-len 16384 \
    --gpu-memory-utilization 0.92 \
    --enable-prefix-caching \
    --enable-chunked-prefill \
    --max-num-seqs 128 \
    --port 8000

# 方案 2: TP+DP (2 节点, 各 8 GPU)
$ vllm serve deepseek-ai/DeepSeek-V3 \
    --tensor-parallel-size 8 \
    --data-parallel-size 2 \
    --quantization fp8 \
    --max-model-len 16384 \
    --port 8000
```

### 10.3 性能基准测试

```python
# 使用 vLLM benchmark 工具
# $ python benchmark_serving.py \
#     --backend vllm \
#     --model deepseek-ai/DeepSeek-V3 \
#     --num-prompts 500 \
#     --request-rate 10

# 预期性能参考 (8× H100, FP8, TP=8):
"""
==== Benchmark Results ====
Total time:              120.5 s
Successful requests:     500
Request throughput:      4.15 req/s
Input token throughput:  2076 tokens/s
Output token throughput: 1245 tokens/s
Mean TTFT:               185.3 ms
Median TTFT:             162.1 ms
P95 TTFT:                412.7 ms
Mean TPOT:               24.3 ms
Median TPOT:             22.1 ms
P95 TPOT:                38.9 ms
"""
```

### 10.4 Prefix Caching 启用与效果

```python
# 验证 Prefix Caching 效果

from openai import OpenAI

client = OpenAI(base_url="http://localhost:8000/v1", api_key="dummy")

# 模拟多轮对话
system_prompt = """You are a senior software architect with 20 years of experience.
You provide detailed, well-reasoned technical advice.
Always consider scalability, maintainability, and performance."""

# 第 1 轮 (无缓存, Prefill 完整 system prompt)
t0 = time.time()
r1 = client.chat.completions.create(
    model="deepseek-ai/DeepSeek-V3",
    messages=[
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": "How to design a rate limiter?"},
    ],
)
ttft_1 = time.time() - t0  # ~200ms

# 第 2 轮 (system prompt 缓存命中, 只 Prefill 新内容)
t0 = time.time()
r2 = client.chat.completions.create(
    model="deepseek-ai/DeepSeek-V3",
    messages=[
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": "How to design a rate limiter?"},
        {"role": "assistant", "content": r1.choices[0].message.content},
        {"role": "user", "content": "How about distributed rate limiting?"},
    ],
)
ttft_2 = time.time() - t0  # ~80ms (前缀缓存命中, TTFT 降低 60%)

print(f"Round 1 TTFT: {ttft_1:.0f}ms")
print(f"Round 2 TTFT: {ttft_2:.0f}ms")
print(f"Speedup: {ttft_1/ttft_2:.1f}x")
```

---

## 11. 常见陷阱与最佳实践

### 陷阱 1：GPU 显存计算错误

❌ **错误做法**：只计算模型权重的显存，忘记 KV Cache 和中间激活

```python
# 错误计算
model_size = 70e9 * 2  # 70B params × 2 bytes (FP16) = 140 GB
# "4× A100 80GB = 320 GB，足够！"

# 实际情况
model_size = 140  # GB
kv_cache_per_request = 2.5  # GB (8K context, GQA)
concurrent_requests = 64
kv_cache_total = 2.5 * 64  # = 160 GB！
intermediate_activations = 10  # GB (batch forward pass)

total = 140 + 160 + 10  # = 310 GB → 刚好用满 4 卡，几乎无余量
```

✅ **正确做法**：用公式精确计算，留 10-15% 余量

```python
# 显存预算计算
def estimate_gpu_memory(
    model_params_b: float,  # 模型参数量 (十亿)
    bytes_per_param: int,   # 每参数字节数
    num_kv_heads: int,
    head_dim: int,
    num_layers: int,
    max_seq_len: int,
    max_batch_size: int,
    kv_cache_dtype_bytes: int = 2,
    safety_margin: float = 0.85,  # 85% 显存利用率
) -> dict:
    model_gb = model_params_b * bytes_per_param
    kv_per_req = 2 * num_layers * num_kv_heads * head_dim * max_seq_len * kv_cache_dtype_bytes / 1e9
    kv_total = kv_per_req * max_batch_size
    total = model_gb + kv_total
    gpus_needed = int(total / (80 * safety_margin)) + 1
    return {
        "model_gb": model_gb,
        "kv_per_request_gb": kv_per_req,
        "kv_total_gb": kv_total,
        "total_gb": total,
        "gpus_needed_a100_80gb": gpus_needed,
    }
```

### 陷阱 2：量化精度 vs 速度的错误权衡

❌ **错误做法**：追求极致量化（Q2_K），结果模型输出质量严重下降

```
用户反馈: "模型回答变得不连贯了"
原因: Q2_K 量化 → perplexity 上升 27% → 复杂推理能力下降
```

✅ **正确做法**：根据任务选择合适的量化级别

```
量化选型指南:

代码生成 / 数学推理 → FP8 或 Q5_K_M 以上
  (精度敏感, 量化损失会影响正确率)

对话 / 文本生成 → Q4_K_M
  (对量化不太敏感, 性价比最高)

信息抽取 / 分类 → Q3_K_M 也可接受
  (任务简单, 量化损失影响小)

务必测试: 量化后用你的实际 benchmark 测精度!
```

### 陷阱 3：Batch Size 设置不当

❌ **错误做法**：max_num_seqs 设得太大，导致每个请求分到的 KV Cache 很少

```
max_num_seqs = 1024  # 太大！
# 显存全被 KV Cache 占满
# 每个请求只能生成很短的序列
# 大量请求被抢占 → 性能反而下降
```

✅ **正确做法**：根据显存容量和平均序列长度计算最优 batch size

```python
def optimal_batch_size(
    available_kv_memory_gb: float,
    kv_per_request_gb: float,
    target_utilization: float = 0.85,
) -> int:
    """计算最优批大小"""
    max_concurrent = int(available_kv_memory_gb * target_utilization / kv_per_request_gb)
    return max(1, max_concurrent)

# 示例: 45 GB 可用于 KV Cache, 每请求 0.5 GB
# → 最优 batch = int(45 * 0.85 / 0.5) = 76
```

### 陷阱 4：TP vs DP 选择错误

❌ **错误做法**：跨节点使用 TP（没有 NVLink，只有 InfiniBand）

```
2 节点 × 4 GPU, 用 TP=8:
  每次 AllReduce 通过 InfiniBand (50 GB/s)
  延迟: 每层 ~100μs → 80 层 = 8ms/token
  → TPS 仅 ~25 tokens/s (严重受限)
```

✅ **正确做法**：同节点 TP，跨节点 DP

```
2 节点 × 4 GPU, 用 TP=4 + DP=2:
  TP 通信: NVLink (900 GB/s), 延迟 ~10μs/层
  DP: 无通信开销 (独立副本)
  → TPS ~60 tokens/s per DP rank
  → 总吞吐翻倍

规则: TP 不要超出 NVLink 域 (通常 = 单节点 GPU 数)
```

### 陷阱 5：KV Cache 内存泄漏

❌ **错误做法**：长时间运行后，KV Cache 不释放，可用显存越来越少

```
问题根因:
- 客户端断连但服务端没有检测到 → KV Cache 不释放
- 超长生成请求没有 max_tokens 限制 → 无限占用显存
- Prefix Cache 没有设置淘汰策略 → 缓存只增不减
```

✅ **正确做法**：设置超时、最大长度、缓存淘汰

```python
# 防止 KV Cache 泄漏的配置
config = {
    "max_tokens": 4096,           # 每请求最大生成长度
    "request_timeout": 300,       # 请求超时 (秒)
    "max_model_len": 16384,       # 模型最大序列长度
    "gpu_memory_utilization": 0.90,  # 留有余量
}

# 监控 KV Cache 使用率
# 告警: vllm:gpu_cache_usage_perc > 0.95 持续 5 分钟
```

### 陷阱 6：冷启动优化忽略

❌ **错误做法**：每次部署/重启都需要等待几分钟加载模型

```
LLaMA-3 70B 冷启动时间:
  模型加载 (从磁盘读取 140 GB): ~60s
  权重转换 + CUDA 编译: ~30s
  CUDA Graph warmup: ~20s
  总计: ~2 分钟
  
  → K8s Pod 重启 = 2 分钟服务不可用
```

✅ **正确做法**：多种策略减少冷启动影响

```
策略 1: 预热 (Warmup)
  启动后发送几个 dummy 请求，触发 CUDA Graph 编译和 JIT
  在 K8s readiness probe 中检查预热完成

策略 2: 模型缓存
  将模型文件放在 NVMe SSD 或 RAM disk
  使用 shared memory 在多进程间共享模型权重

策略 3: 滚动更新
  K8s 设置 maxUnavailable=0, maxSurge=1
  新 Pod 就绪后才杀旧 Pod

策略 4: 多副本 + 健康检查
  至少 2 个副本，一个重启时另一个继续服务
```

### 陷阱 7：监控盲区

❌ **错误做法**：只监控 GPU 利用率，不监控推理质量指标

```
GPU 利用率 99%，但用户投诉 "太慢了"
原因: 大量请求排队等待，TTFT P95 > 5s
GPU 忙 ≠ 用户体验好
```

✅ **正确做法**：建立全面的监控体系

```
必须监控的指标:

用户体验指标:
  ✅ TTFT P50/P95/P99
  ✅ TPOT P50/P95/P99
  ✅ 端到端延迟分布
  ✅ 错误率 / 超时率

系统资源指标:
  ✅ GPU SM 利用率
  ✅ GPU 显存利用率 (含 KV Cache 分类)
  ✅ CPU/内存使用率
  ✅ 网络带宽 (NVLink + InfiniBand)

业务指标:
  ✅ QPS (每秒请求数)
  ✅ 队列深度
  ✅ Token 消耗速率
  ✅ 成本/请求

告警规则:
  🚨 TTFT P95 > 3s: 需要扩容或优化
  🚨 KV Cache 使用率 > 95%: 可能出现抢占
  🚨 错误率 > 1%: 排查 OOM 或模型问题
  🚨 队列深度 > 200: 需要扩容
```

### 陷阱 8：并发安全问题

❌ **错误做法**：多个客户端共享同一个 conversation_id 导致对话混乱

```python
# 错误: 全局共享对话历史
conversation_history = []

def chat(user_message):
    conversation_history.append({"role": "user", "content": user_message})
    response = llm.generate(conversation_history)
    conversation_history.append({"role": "assistant", "content": response})
    # 并发请求会互相污染 conversation_history!
```

✅ **正确做法**：请求级别隔离对话状态

```python
# 正确: 每个请求携带完整上下文
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class ChatRequest(BaseModel):
    messages: list[dict]  # 客户端每次发送完整对话历史
    session_id: str       # 用于 Prefix Caching 优化

@app.post("/chat")
async def chat(request: ChatRequest):
    # 每个请求独立，无共享状态
    response = await llm.generate(
        messages=request.messages,
        # session_id 用于 RadixAttention 前缀缓存
    )
    return {"response": response}

# 对话历史存储在 Redis/数据库中, 由客户端管理
```

### 陷阱 9：忽视 Prefill 和 Decode 的性能差异

❌ **错误做法**：用相同指标评估不同类型的请求

```
短 Prompt + 长 Output: TTFT 很快, 但 TPS 是瓶颈
长 Prompt + 短 Output: TTFT 是瓶颈, TPS 无关紧要
混在一起看 "平均延迟" → 无法发现真正的问题
```

✅ **正确做法**：分维度监控，按请求类型优化

```
按 prompt_length 分桶监控:
  短 Prompt (<512 tokens):  关注 TTFT 和 TPS
  中 Prompt (512-4K tokens): 关注 TTFT (考虑 Chunked Prefill)
  长 Prompt (4K+ tokens):   关注 TTFT, 启用 Chunked Prefill

按 output_length 分桶监控:
  短 Output (<100 tokens):  TTFT 占比大 → 优化 Prefix Caching
  长 Output (100+ tokens):  TPS 占比大 → 优化 Batch Size / 量化
```

### 陷阱 10：升级引擎版本不做回归测试

❌ **错误做法**：直接将 vLLM 从 0.5 升级到 0.7，生产环境出现兼容性问题

```
常见问题:
  - 量化格式不兼容
  - API 参数变更 (如 guided decoding 参数改名)
  - 性能回归 (新版本某些场景反而更慢)
  - 输出质量变化 (采样策略细微差异)
```

✅ **正确做法**：灰度发布 + 性能回归测试

```
升级流程:
  1. 在测试环境用生产流量回放测试
  2. 对比新旧版本的 TTFT/TPS/精度指标
  3. 灰度发布: 先切 5% 流量到新版本
  4. 监控 24 小时无异常后逐步扩大
  5. 保留旧版本 rollback 能力
```

---

## 参考资源

1. **vLLM**：Efficient Memory Management for Large Language Model Serving with PagedAttention (SOSP 2023)
2. **SGLang**：Efficient Execution of Structured Language Model Programs (ICLR 2025 Best Paper)
3. **FlashAttention**：Fast and Memory-Efficient Exact Attention (NeurIPS 2022)
4. **Speculative Decoding**：Fast Inference from Transformers via Speculative Decoding (ICML 2023)
5. **GPTQ**：Accurate Post-Training Quantization for Generative Pre-trained Transformers
6. **AWQ**：Activation-aware Weight Quantization for LLM Compression and Acceleration
7. **TensorRT-LLM**：NVIDIA official documentation and blog posts
8. **llama.cpp**：GitHub repository (ggml-org/llama.cpp)
9. **Ollama**：GitHub repository (ollama/ollama)
10. **NVIDIA GB200 NVL72**：Blackwell architecture whitepaper
