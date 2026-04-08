# Prompt Cache 工程与路由优化

> 深入解析 Prompt Cache 的工程实现、缓存感知路由策略与命中率优化，支撑高并发和高可用的 LLM 推理服务

## 相关链接
- 对应面试题：[Prompt-Cache工程与路由优化面试题](../../02-面试指南/09-AI-Agent工程化面试/12-Prompt-Cache工程与路由优化面试题.md)
- 相关技术资料：[LLM推理服务工程](./01-LLM推理服务工程.md)、[LLM服务编排与成本治理](./11-LLM服务编排与成本治理.md)

## TL;DR 速览

- **Prefill 阶段**占 LLM 推理 60-80% 的计算量，而大量请求共享相同的 System Prompt 前缀——Prompt Cache 通过复用已计算的 KV Cache 直接跳过重复 Prefill
- **KV Cache** 存储每个 Token 在 Attention 层的 Key/Value 张量；对于 70B 模型，1024 Token 的 KV Cache 约占 2.5 GB 显存
- **Prefix Caching** 的核心原理：将 Token 序列按固定大小分块，用哈希值构建 Radix Tree 索引，匹配最长公共前缀后只需计算增量部分
- **缓存感知路由**是命中率的关键：标准轮询路由在 N 个 GPU 上的命中率约 1/N，前缀哈希路由可将命中率提升至 85%+
- **多层缓存**（GPU 显存 → 主机内存 → 分布式存储）配合 prefix-aware 淘汰策略，在有限显存下最大化缓存价值
- **API 层缓存**（OpenAI 50% 折扣 / Anthropic 90% 折扣）是零开发成本的优化手段，但需要理解前缀匹配规则才能最大化命中率
- **高可用设计**的核心：Cache miss 只是性能降级而非功能故障，系统必须在任何缓存失效场景下保持正确性

## 目录

1. [为什么需要 Prompt Cache？](#1-为什么需要-prompt-cache)
2. [Prompt Cache 核心原理](#2-prompt-cache-核心原理)
3. [多层缓存架构](#3-多层缓存架构)
4. [缓存感知路由策略](#4-缓存感知路由策略)
5. [命中率优化工程](#5-命中率优化工程)
6. [高并发设计](#6-高并发设计)
7. [高可用设计](#7-高可用设计)
8. [API 层 Prompt Caching](#8-api-层-prompt-caching)
9. [生产实践](#9-生产实践)
10. [常见陷阱与最佳实践](#10-常见陷阱与最佳实践)

---

## 1. 为什么需要 Prompt Cache？

### 1.1 LLM 推理的成本结构

LLM 推理分为两个阶段：**Prefill**（处理输入 Token）和 **Decode**（逐个生成输出 Token）。

```
┌─────────────────────────────────────────────────────────┐
│                    LLM 推理时间分布                       │
├─────────────┬───────────────────────────────────────────┤
│             │ ████████████████████████░░░░░░░░░░        │
│  短输出请求  │ ◄──── Prefill 70% ────►◄─ Decode 30% ─► │
│             │                                           │
│             │ ████████████████░░░░░░░░░░░░░░░░░░        │
│  长输出请求  │ ◄─ Prefill 40% ►◄──── Decode 60% ─────► │
├─────────────┴───────────────────────────────────────────┤
│  Prefill：计算密集（矩阵乘法），所有 Token 并行处理        │
│  Decode ：访存密集（逐 Token 生成），受限于显存带宽        │
└─────────────────────────────────────────────────────────┘
```

**生活类比**：把 LLM 推理想象成**考试**——

- **Prefill** 是"阅读题目"：需要完整读一遍所有考题，才能开始作答。题目越长，阅读时间越长
- **Decode** 是"写答案"：逐字书写答案，速度相对稳定
- **Prompt Cache** 相当于"开卷考试中的标记页"：如果上一场考试的题目和这场一样，你不需要重新阅读，直接翻到标记页开始作答

### 1.2 重复前缀的浪费

在典型的 LLM 应用中，大量请求共享相同的前缀：

| 场景 | 共享前缀 | 前缀长度占比 |
|------|---------|-------------|
| Chatbot（含 System Prompt） | System Prompt + 对话历史 | 60-90% |
| 代码补全（含仓库上下文） | 仓库文件 + 编辑位置 | 70-95% |
| RAG 检索增强 | System Prompt + 检索文档 | 50-80% |
| 批量文档处理 | 相同指令 + 不同文档 | 30-60% |

```
请求 A:  [System Prompt ← 2000 tokens →][User: 你好]
请求 B:  [System Prompt ← 2000 tokens →][User: 天气如何？]
请求 C:  [System Prompt ← 2000 tokens →][User: 写一首诗]
              │                          │
              └── 这 2000 tokens 被重复计算了 3 次 ──┘
```

**计算浪费的量化**：

假设一个多租户 LLM 服务：
- System Prompt 平均 2000 tokens
- 每个请求的用户输入平均 200 tokens
- QPS = 100

没有缓存：每秒处理 `100 × 2200 = 220,000` 输入 tokens 的 Prefill

有缓存（假设 80% 命中）：每秒处理 `20 × 2200 + 80 × 200 = 60,000` 输入 tokens

**Prefill 计算量减少 73%**，直接转化为更高的吞吐量和更低的延迟。

### 1.3 Prompt Cache 的价值定位

```
┌─────────────────────────────────────────────────────────┐
│              Prompt Cache 的三重价值                      │
├─────────────┬───────────────────────────────────────────┤
│  降低延迟    │ Cache hit 时 Prefill 延迟从数百 ms 降到    │
│             │ 接近 0，首 Token 时间（TTFT）显著下降        │
├─────────────┼───────────────────────────────────────────┤
│  提升吞吐    │ 跳过 Prefill 计算释放 GPU 算力，同等硬件   │
│             │ 下可服务更多并发请求                        │
├─────────────┼───────────────────────────────────────────┤
│  降低成本    │ API 厂商提供缓存 Token 50-90% 折扣，       │
│             │ 自部署时等效于增加 GPU 利用率               │
└─────────────┴───────────────────────────────────────────┘
```

---

## 2. Prompt Cache 核心原理

### 2.1 KV Cache 基础：存什么，为什么贵

Transformer 的 Attention 机制在每一层为每个 Token 计算一对向量：**Key（K）** 和 **Value（V）**。

```
Input Token → Embedding → [Layer 1] → [Layer 2] → ... → [Layer N] → Output
                             │            │                  │
                          K₁, V₁       K₂, V₂           Kₙ, Vₙ
                             │            │                  │
                             └────────────┴──────────────────┘
                                     KV Cache
                             （保存所有层的 K, V 张量）
```

**KV Cache 的内存占用公式**：

```
KV Cache 大小 = 2 × num_layers × num_kv_heads × head_dim × seq_len × dtype_size

以 Llama 3 70B 为例（FP16）:
= 2 × 80 × 8 × 128 × seq_len × 2 bytes
= 327,680 × seq_len bytes
≈ 0.31 MB / token

1024 tokens → 约 320 MB
4096 tokens → 约 1.28 GB
```

**生活类比**：KV Cache 就像**笔记本**——

- 考试时你每读一段题目都做了笔记（K/V），后面答题时翻笔记比重新读题快
- 笔记本大小有限（GPU 显存），写满了就得擦掉旧笔记（Cache 淘汰）
- 如果两个人做同一张卷子，后面的人可以直接抄前面人的笔记（KV Cache 复用）

### 2.2 Prefix Caching 原理

Prefix Caching 的核心思想：**如果两个请求的 Token 序列有相同前缀，前缀部分的 KV Cache 可以直接复用**。

```
┌───────────────────────────────────────────────────────┐
│                  Prefix Caching 工作流                  │
├───────────────────────────────────────────────────────┤
│                                                       │
│  请求 A（首次）:                                       │
│  ┌──────────────────────┬──────────┐                  │
│  │   System Prompt      │ User A   │                  │
│  │   tokens: [1,2,3...] │ [99,100] │                  │
│  └──────────┬───────────┴──────────┘                  │
│             │                                         │
│             ▼  完整 Prefill → 生成 KV Cache → 存入缓存  │
│  ┌──────────────────────┐                             │
│  │  Cache[hash(1,2,3)]  │                             │
│  │  = KV tensors        │                             │
│  └──────────────────────┘                             │
│                                                       │
│  请求 B（缓存命中）:                                    │
│  ┌──────────────────────┬──────────┐                  │
│  │   System Prompt      │ User B   │                  │
│  │   tokens: [1,2,3...] │ [55,66]  │                  │
│  └──────────┬───────────┴──────────┘                  │
│             │                                         │
│             ▼  前缀匹配 → 复用 KV Cache → 只计算增量    │
│  ┌──────────────────────┬──────────┐                  │
│  │  Cache HIT ✓         │ 计算增量  │                  │
│  │  （跳过 Prefill）     │ [55,66]  │                  │
│  └──────────────────────┴──────────┘                  │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### 2.3 Token 级分块与哈希匹配

实际实现中，Token 序列不是整体哈希，而是**按固定大小的块（Block）进行分块哈希**：

```
Token 序列:  [t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11, t12]

Block 大小 = 4:
┌───────────┐  ┌───────────┐  ┌───────────┐
│ Block 0   │  │ Block 1   │  │ Block 2   │
│ [t1..t4]  │  │ [t5..t8]  │  │ [t9..t12] │
│ hash: 0xA │  │ hash: 0xB │  │ hash: 0xC │
└───────────┘  └───────────┘  └───────────┘

匹配过程（逐块从前向后）:
1. 计算新请求的 Block 0 哈希 → 与缓存匹配 → ✓ 命中
2. 计算新请求的 Block 1 哈希 → 与缓存匹配 → ✓ 命中
3. 计算新请求的 Block 2 哈希 → 与缓存匹配 → ✗ 不匹配
→ 复用前 2 个 Block 的 KV Cache，只计算 Block 2 开始的部分
```

### 2.4 RadixAttention（SGLang）

SGLang 引入的 **RadixAttention** 用 Radix Tree（前缀树）来管理所有缓存的 Token 序列，支持任意前缀的高效匹配：

```
                    Radix Tree 结构示意
                         [root]
                        /       \
                 [System A]     [System B]
                 hash: 0x1      hash: 0x2
                /     \              \
         [Chat ctx1] [Chat ctx2]  [Doc ctx]
         hash: 0x3   hash: 0x4   hash: 0x5

查找过程（O(prefix_length / block_size)）:
请求: [System A tokens] + [Chat ctx1 tokens] + [new user msg]
1. root → 匹配 [System A] ✓ → 复用 KV Cache 0x1
2.      → 匹配 [Chat ctx1] ✓ → 复用 KV Cache 0x3
3.      → 新用户消息无缓存 → 仅计算增量
```

**核心优势**：

- **任意前缀共享**：不同对话可以共享相同 System Prompt 的 KV Cache
- **多轮对话友好**：每轮对话只需增量计算新消息，历史部分自动复用
- **细粒度淘汰**：可以淘汰叶子节点而保留共享的前缀节点

### 2.5 Automatic Prefix Caching（vLLM）

vLLM 的 APC（Automatic Prefix Caching）采用哈希表实现：

```python
# vLLM APC 核心逻辑简化（原理层面）
class PrefixCacheManager:
    def __init__(self, block_size: int = 16):
        self.block_size = block_size
        # hash(token_block) → physical_block_id
        self.cache_table: dict[int, int] = {}
    
    def compute_block_hash(
        self, tokens: list[int], block_idx: int
    ) -> int:
        """计算第 block_idx 个块的哈希值。
        
        关键：哈希值包含前缀信息，确保相同 Token 
        在不同上下文位置有不同哈希。
        """
        start = block_idx * self.block_size
        end = start + self.block_size
        block_tokens = tuple(tokens[start:end])
        
        # 包含前缀哈希，实现链式依赖
        if block_idx == 0:
            prefix_hash = 0
        else:
            prefix_hash = self.compute_block_hash(
                tokens, block_idx - 1
            )
        return hash((prefix_hash, block_tokens))
    
    def find_cached_prefix(
        self, tokens: list[int]
    ) -> tuple[int, list[int]]:
        """返回可复用的块数和对应的物理块 ID 列表。"""
        num_blocks = len(tokens) // self.block_size
        cached_blocks = []
        
        for i in range(num_blocks):
            block_hash = self.compute_block_hash(tokens, i)
            if block_hash in self.cache_table:
                cached_blocks.append(
                    self.cache_table[block_hash]
                )
            else:
                break  # 前缀中断，后续块不可能命中
        
        return len(cached_blocks), cached_blocks
```

**vLLM vs SGLang 对比**：

| 特性 | vLLM APC | SGLang RadixAttention |
|------|----------|----------------------|
| 数据结构 | 哈希表 | Radix Tree |
| 匹配方式 | 逐块哈希查表 | 树节点遍历 |
| 内存开销 | 较低 | 较高（树节点指针） |
| 部分前缀复用 | 支持 | 原生支持 |
| 多轮对话优化 | 通用 | 特别优化 |
| 启用方式 | `--enable-prefix-caching` | 默认启用 |

---

## 3. 多层缓存架构

### 3.1 三层缓存体系

**生活类比**：缓存层级就像**图书馆的借阅体系**——

- **L1（GPU 显存）**：你手边的参考书，翻手可得，但桌子空间有限
- **L2（主机内存）**：图书馆当层的书架，走几步就能拿到
- **L3（分布式存储）**：图书馆总馆或其他分馆，需要请人调书，较慢但容量大

```
┌──────────────────────────────────────────────────────────┐
│                    三层缓存架构                            │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────────┐  容量: 10-40 GB  延迟: ~0 μs       │
│  │  L1: GPU KV Cache │  (显存中，与推理引擎同进程)         │
│  │  (In-Process)     │  ← 最热数据，直接被 Attention 读取  │
│  └────────┬─────────┘                                    │
│           │ evict / promote                               │
│  ┌────────▼─────────┐  容量: 64-512 GB  延迟: ~10 μs     │
│  │  L2: Host Memory  │  (CPU 内存，PCIe 传输到 GPU)       │
│  │  (Offload Cache)  │  ← 次热数据，需要 GPU↔CPU 拷贝     │
│  └────────┬─────────┘                                    │
│           │ evict / fetch                                 │
│  ┌────────▼─────────┐  容量: TB 级   延迟: ~1 ms         │
│  │  L3: Distributed  │  (Redis / 共享文件系统 / NVMe)     │
│  │  (Remote Cache)   │  ← 冷数据，跨节点共享              │
│  └──────────────────┘                                    │
│                                                          │
│  ┌──────────────────┐                                    │
│  │  Miss: 重新计算    │  ← Cache miss → 执行完整 Prefill   │
│  │  (Full Prefill)   │     （功能正确，但延迟较高）         │
│  └──────────────────┘                                    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 3.2 L1: GPU KV Cache 管理

GPU 显存中的 KV Cache 通常由推理引擎直接管理（如 vLLM 的 BlockManager）：

```python
class GPUKVCacheManager:
    """L1 KV Cache 管理器（原理示意）"""
    
    def __init__(
        self,
        num_gpu_blocks: int,
        block_size: int = 16,
    ):
        self.block_size = block_size
        self.num_blocks = num_gpu_blocks
        # 空闲块池
        self.free_blocks: set[int] = set(range(num_gpu_blocks))
        # prefix_hash → (block_id, ref_count, last_access)
        self.cached: dict[int, CacheEntry] = {}
    
    def allocate_or_reuse(
        self, prefix_hash: int
    ) -> tuple[int, bool]:
        """分配或复用一个缓存块。"""
        if prefix_hash in self.cached:
            entry = self.cached[prefix_hash]
            entry.ref_count += 1
            entry.last_access = time.monotonic()
            return entry.block_id, True  # cache hit
        
        if not self.free_blocks:
            self._evict()  # 触发淘汰
        
        block_id = self.free_blocks.pop()
        self.cached[prefix_hash] = CacheEntry(
            block_id=block_id,
            ref_count=1,
            last_access=time.monotonic(),
        )
        return block_id, False  # cache miss
    
    def release(self, prefix_hash: int):
        """请求完成后释放引用（不立即删除，留作复用）。"""
        if prefix_hash in self.cached:
            self.cached[prefix_hash].ref_count -= 1
```

### 3.3 淘汰策略

标准的 LRU 对 KV Cache 并不理想——高频共享前缀应该被保护：

```
┌─────────────────────────────────────────────────────────┐
│              Prefix-Aware 淘汰策略                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  标准 LRU 的问题:                                        │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                      │
│  │ SP  │→│ H1  │→│ H2  │→│ H3  │→ evict               │
│  │共享  │ │独享  │ │独享  │ │独享  │                      │
│  │前缀  │ │叶子  │ │叶子  │ │叶子  │                      │
│  └─────┘ └─────┘ └─────┘ └─────┘                      │
│     ↑ 如果 SP 长时间没有新请求，可能被淘汰                 │
│       但淘汰 SP 会导致 H1/H2/H3 全部失效！                │
│                                                         │
│  Prefix-Aware 策略:                                      │
│  优先级: ref_count > 0 的不淘汰                           │
│        > 共享前缀（被多个序列引用）优先保留                 │
│        > 叶子节点按 LRU 淘汰                              │
│        > 相同优先级按访问时间排序                           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

```python
def _evict(self) -> None:
    """Prefix-Aware LRU 淘汰策略。"""
    candidates = [
        (h, e) for h, e in self.cached.items()
        if e.ref_count == 0  # 只淘汰无引用的块
    ]
    
    if not candidates:
        raise RuntimeError("No evictable blocks")
    
    # 优先淘汰：叶子节点 > 共享前缀
    # 同级内按最近访问时间排序（LRU）
    candidates.sort(
        key=lambda x: (
            x[1].is_shared_prefix,   # False 排前面
            x[1].last_access,        # 最早访问排前面
        )
    )
    
    victim_hash, victim = candidates[0]
    self.free_blocks.add(victim.block_id)
    del self.cached[victim_hash]
```

### 3.4 L2/L3 层级间传输

```
┌────────────────────────────────────────────────────────┐
│                 层级间数据流动                           │
├────────────────────────────────────────────────────────┤
│                                                        │
│  L1 → L2 (Offload):                                   │
│  ┌─────────┐    PCIe/NVLink     ┌──────────┐          │
│  │  GPU    │ ──── ~32 GB/s ────→│ CPU RAM  │          │
│  │  HBM    │                    │ (pinned) │          │
│  └─────────┘                    └──────────┘          │
│  触发：L1 空间不足，淘汰到 L2 而非直接丢弃              │
│  策略：异步 DMA 拷贝，不阻塞推理计算                    │
│                                                        │
│  L2 → L1 (Promote):                                   │
│  ┌──────────┐   PCIe/NVLink    ┌─────────┐           │
│  │ CPU RAM  │ ──── ~32 GB/s ──→│  GPU    │           │
│  │ (pinned) │                  │  HBM    │           │
│  └──────────┘                  └─────────┘           │
│  触发：请求需要的 prefix 在 L2 中命中                   │
│  延迟：~10 μs（远低于重新 Prefill 的数百 ms）          │
│                                                        │
│  L2 ↔ L3 (Remote):                                    │
│  ┌──────────┐    RDMA/TCP      ┌──────────┐          │
│  │ Host Mem │ ──── ~10 GB/s ──→│  Redis / │          │
│  │          │                  │  NVMe   │          │
│  └──────────┘                  └──────────┘          │
│  触发：跨节点缓存共享或本地 L2 淘汰                     │
│  适用：热门 System Prompt 的 KV Cache 跨 GPU 共享      │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## 4. 缓存感知路由策略

### 4.1 标准负载均衡为什么破坏缓存

**生活类比**：想象你有 4 家分店（GPU），每家都记住了常客的偏好（KV Cache）——

- **轮询路由**：每次把顾客随机分配到不同分店，每家店都得重新了解这位顾客
- **缓存感知路由**：把同一位顾客总是分配到同一家分店，分店记住偏好后服务更快

```
标准 Round-Robin 路由:

请求 (SP=A): ──→ GPU 0  [缓存 A ✓]
请求 (SP=A): ──→ GPU 1  [缓存 A ✓]  ← A 被缓存到了另一个 GPU
请求 (SP=A): ──→ GPU 2  [缓存 A ✓]  ← 又一个副本
请求 (SP=A): ──→ GPU 3  [缓存 A ✓]  ← 第四个副本

结果: 4 个 GPU 各存一份 A 的 KV Cache → 显存浪费 4x
     后续请求只有 1/4 概率命中（轮到同一个 GPU 才命中）

缓存感知路由 (hash(SP=A) → GPU 1):

请求 (SP=A): ──→ GPU 1  [缓存 A ✓]
请求 (SP=A): ──→ GPU 1  [命中 A ✓]  ← 100% 命中
请求 (SP=A): ──→ GPU 1  [命中 A ✓]  ← 100% 命中
请求 (SP=B): ──→ GPU 3  [缓存 B ✓]  ← B 路由到不同 GPU

结果: 每个 SP 只在一个 GPU 上缓存 → 高命中率 + 低显存浪费
```

### 4.2 前缀哈希路由

最直观的策略：对 System Prompt（或其他共享前缀）计算哈希，映射到固定的 GPU：

```python
import hashlib

class PrefixHashRouter:
    """前缀哈希路由器：相同前缀 → 相同 GPU。"""
    
    def __init__(self, gpu_endpoints: list[str]):
        self.endpoints = gpu_endpoints
        self.num_gpus = len(gpu_endpoints)
    
    def route(
        self,
        system_prompt: str,
        messages: list[dict],
    ) -> str:
        """基于 System Prompt 哈希选择目标 GPU。"""
        prefix_key = self._extract_prefix_key(
            system_prompt
        )
        gpu_idx = self._hash_to_gpu(prefix_key)
        return self.endpoints[gpu_idx]
    
    def _extract_prefix_key(
        self, system_prompt: str
    ) -> str:
        """提取用于路由的前缀关键字。
        
        关键：对 prompt 做标准化后再哈希，
        避免空白差异导致路由到不同 GPU。
        """
        normalized = system_prompt.strip()
        normalized = " ".join(normalized.split())
        return normalized
    
    def _hash_to_gpu(self, prefix_key: str) -> int:
        """一致性哈希到 GPU 索引。"""
        digest = hashlib.sha256(
            prefix_key.encode()
        ).hexdigest()
        return int(digest, 16) % self.num_gpus
```

### 4.3 一致性哈希实现缓存亲和

简单取模 `hash % N` 的问题：当 GPU 数量变化时（扩缩容），几乎所有前缀都会被重新映射，导致缓存全部失效。

**一致性哈希（Consistent Hashing）** 将哈希空间映射到环上，节点变更时只影响邻近区段：

```
                一致性哈希环

              0 (= 2³²)
            ╱    ╲
          ╱        ╲
     GPU-0(v1)    GPU-3(v1)
        ╱              ╲
      ╱                  ╲
  GPU-0(v2)          GPU-3(v2)
    │                      │
    │    Prefix "A" ●      │
    │                      │
  GPU-1(v1)          GPU-2(v2)
      ╲                  ╱
        ╲              ╱
     GPU-1(v2)    GPU-2(v1)
          ╲        ╱
            ╲    ╱
          2³¹ / 2

(v1, v2 = 虚拟节点，提高负载均衡性)

添加 GPU-4 时: 只有 GPU-4 附近的前缀被重新映射
             其他前缀的路由不变 → 缓存保留
```

```python
import bisect
import hashlib

class ConsistentHashRouter:
    """一致性哈希路由器（含虚拟节点）。"""
    
    def __init__(
        self,
        gpu_endpoints: list[str],
        virtual_nodes: int = 150,
    ):
        self.ring: list[tuple[int, str]] = []
        self.virtual_nodes = virtual_nodes
        
        for endpoint in gpu_endpoints:
            self.add_node(endpoint)
        
        self.ring.sort(key=lambda x: x[0])
    
    def add_node(self, endpoint: str):
        """添加节点（含虚拟节点）到哈希环。"""
        for i in range(self.virtual_nodes):
            key = f"{endpoint}:v{i}"
            h = self._hash(key)
            self.ring.append((h, endpoint))
        self.ring.sort(key=lambda x: x[0])
    
    def remove_node(self, endpoint: str):
        """移除节点（扩缩容时调用）。"""
        self.ring = [
            (h, ep) for h, ep in self.ring
            if ep != endpoint
        ]
    
    def route(self, prefix_key: str) -> str:
        """根据前缀键路由到最近的 GPU 节点。"""
        h = self._hash(prefix_key)
        idx = bisect.bisect_left(
            [x[0] for x in self.ring], h
        )
        if idx >= len(self.ring):
            idx = 0
        return self.ring[idx][1]
    
    def _hash(self, key: str) -> int:
        return int(
            hashlib.md5(key.encode()).hexdigest(), 16
        )
```

### 4.4 缓存感知调度器设计

实际生产中，路由决策不仅考虑缓存亲和性，还需要平衡负载和考虑缓存状态：

```
┌───────────────────────────────────────────────────────────┐
│                缓存感知调度器架构                            │
├───────────────────────────────────────────────────────────┤
│                                                           │
│  ┌─────────┐    ┌──────────────────────────────────┐     │
│  │  请求队列 │───→│        Cache-Aware Scheduler      │     │
│  └─────────┘    │                                    │     │
│                 │  1. 提取 prefix_key                 │     │
│                 │  2. 查询各 GPU 缓存状态              │     │
│                 │  3. 综合评分 → 选择最优 GPU          │     │
│                 │                                    │     │
│                 │  评分公式:                           │     │
│                 │  score = w₁ × cache_match_ratio    │     │
│                 │        + w₂ × (1 - load_ratio)     │     │
│                 │        + w₃ × memory_available     │     │
│                 │                                    │     │
│                 │  w₁=0.6, w₂=0.3, w₃=0.1           │     │
│                 └───────┬──────┬──────┬──────────────┘     │
│                         │      │      │                    │
│                    ┌────▼─┐┌───▼──┐┌──▼───┐               │
│                    │GPU 0 ││GPU 1 ││GPU 2 │               │
│                    │SP: A ││SP: B ││SP: A │               │
│                    │load: ││load: ││load: │               │
│                    │ 60%  ││ 30%  ││ 90%  │               │
│                    └──────┘└──────┘└──────┘               │
│                                                           │
│  示例: 请求 SP=A 到达                                      │
│  GPU 0: cache=✓(1.0) load=60%(0.4) → score=0.72          │
│  GPU 1: cache=✗(0.0) load=30%(0.7) → score=0.21          │
│  GPU 2: cache=✓(1.0) load=90%(0.1) → score=0.63          │
│  → 选择 GPU 0（最高分）                                    │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

```python
from dataclasses import dataclass

@dataclass
class GPUStatus:
    endpoint: str
    cached_prefixes: set[str]  # 当前缓存的前缀哈希集合
    active_requests: int
    max_requests: int
    free_memory_gb: float
    total_memory_gb: float

class CacheAwareScheduler:
    """综合缓存亲和与负载均衡的调度器。"""
    
    def __init__(
        self,
        w_cache: float = 0.6,
        w_load: float = 0.3,
        w_memory: float = 0.1,
    ):
        self.w_cache = w_cache
        self.w_load = w_load
        self.w_memory = w_memory
        self.gpu_statuses: dict[str, GPUStatus] = {}
    
    def select_gpu(self, prefix_hash: str) -> str:
        """为请求选择最优 GPU。"""
        best_score = -1.0
        best_endpoint = None
        
        for endpoint, status in self.gpu_statuses.items():
            score = self._score(status, prefix_hash)
            if score > best_score:
                best_score = score
                best_endpoint = endpoint
        
        return best_endpoint
    
    def _score(
        self, status: GPUStatus, prefix_hash: str
    ) -> float:
        cache_hit = (
            1.0 if prefix_hash in status.cached_prefixes
            else 0.0
        )
        load_ratio = (
            status.active_requests / status.max_requests
        )
        mem_ratio = (
            status.free_memory_gb / status.total_memory_gb
        )
        
        return (
            self.w_cache * cache_hit
            + self.w_load * (1.0 - load_ratio)
            + self.w_memory * mem_ratio
        )
```

---

## 5. 命中率优化工程

### 5.1 Prompt 标准化

缓存匹配是**逐 Token 精确匹配**——任何微小差异都会导致 miss：

```
原始 Prompt A: "You are a helpful assistant. "  (末尾有空格)
原始 Prompt B: "You are a helpful assistant."   (末尾无空格)

Token 化后:
A: [2675, 527, 264, 10950, 18328, 13, 220]     ← 多一个空格 Token
B: [2675, 527, 264, 10950, 18328, 13]

→ 完全相同的语义，但 Token 序列不同 → Cache MISS
```

```python
import re
import json

def normalize_prompt(prompt: str) -> str:
    """Prompt 标准化：消除语义无关差异。
    
    规则（按优先级）：
    1. 去除首尾空白
    2. 合并连续空白为单个空格
    3. 统一换行符为 \n
    4. 去除 Markdown 链接中的 tracking 参数
    """
    text = prompt.strip()
    text = re.sub(r'\r\n', '\n', text)
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text

def normalize_messages(
    messages: list[dict],
) -> list[dict]:
    """标准化消息列表，提取可缓存前缀。"""
    normalized = []
    for msg in messages:
        normalized.append({
            "role": msg["role"],
            "content": normalize_prompt(msg["content"]),
        })
    return normalized

def compute_cache_key(
    messages: list[dict],
    exclude_last_n: int = 1,
) -> str:
    """计算缓存键：排除最后 N 条消息（用户新输入）。"""
    prefix_msgs = messages[:-exclude_last_n]
    key_str = json.dumps(
        prefix_msgs, ensure_ascii=False, sort_keys=True
    )
    return hashlib.sha256(key_str.encode()).hexdigest()
```

### 5.2 前缀分组策略

将使用相同 System Prompt 的请求分组，提高同一 GPU 上的缓存复用率：

```
┌────────────────────────────────────────────────────────┐
│                  前缀分组策略                            │
├────────────────────────────────────────────────────────┤
│                                                        │
│  不分组（请求随机到达）:                                  │
│  ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐                    │
│  │A ││B ││C ││A ││B ││A ││C ││B │  → 交替到达         │
│  └──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘    缓存频繁切换     │
│                                                        │
│  分组后（批量调度）:                                     │
│  ┌──┐┌──┐┌──┐  ┌──┐┌──┐┌──┐  ┌──┐┌──┐                │
│  │A ││A ││A │  │B ││B ││B │  │C ││C │  → 同前缀聚集   │
│  └──┘└──┘└──┘  └──┘└──┘└──┘  └──┘└──┘    缓存高命中   │
│                                                        │
│  实现方式:                                              │
│  1. 请求入队时按 prefix_hash 分桶                       │
│  2. 调度器优先从同一桶中取多个请求组成 batch             │
│  3. 同一 batch 共享 Prefill → 极大减少重复计算           │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### 5.3 参数分离

影响模型生成行为但不影响 KV Cache 的参数应从缓存键中排除：

```python
@dataclass
class CacheConfig:
    """定义哪些参数参与缓存键计算。"""
    
    # 参与缓存键的参数（影响 KV Cache 内容）
    cache_key_params = {
        "messages",        # 消息内容 → Token 序列
        "model",           # 模型不同 → KV Cache 不可复用
    }
    
    # 不参与缓存键的参数（只影响解码阶段）
    non_cache_params = {
        "temperature",     # 采样温度，不影响 Prefill
        "top_p",           # 核采样，不影响 Prefill
        "max_tokens",      # 最大生成长度
        "stop",            # 停止词
        "frequency_penalty",
        "presence_penalty",
        "seed",            # 随机种子
    }
```

### 5.4 Few-shot 模板提取

对于 Few-shot 场景，将固定的示例部分提取为可缓存前缀：

```
❌ 低命中率（每次重组示例顺序）:
请求 1: [System] + [Example B] + [Example A] + [Query]
请求 2: [System] + [Example A] + [Example B] + [Query]
→ 示例顺序不同 → Token 序列不同 → 无法复用

✅ 高命中率（固定示例顺序+模板化）:
模板:   [System] + [Example A] + [Example B]  ← 固定前缀
请求 1: [模板] + [Query 1]
请求 2: [模板] + [Query 2]
→ 所有请求共享同一模板前缀 → 高命中率
```

### 5.5 缓存预热策略

```python
import asyncio

async def warm_up_cache(
    router: ConsistentHashRouter,
    inference_client,
    system_prompts: list[str],
):
    """在服务启动或扩容后预热关键前缀缓存。
    
    策略：发送只包含 System Prompt 的最小请求，
    触发 Prefill 计算并存入缓存。
    """
    tasks = []
    for sp in system_prompts:
        endpoint = router.route(normalize_prompt(sp))
        task = inference_client.generate(
            endpoint=endpoint,
            messages=[
                {"role": "system", "content": sp},
                {"role": "user", "content": "hi"},
            ],
            max_tokens=1,  # 只生成 1 个 token，目的是预热
        )
        tasks.append(task)
    
    # 并发预热，控制并发度避免冲击
    semaphore = asyncio.Semaphore(10)
    
    async def limited_warmup(task):
        async with semaphore:
            await task
    
    await asyncio.gather(
        *[limited_warmup(t) for t in tasks]
    )
```

---

## 6. 高并发设计

### 6.1 Cache 分片

在多 GPU 环境下，将缓存空间按前缀哈希分片，每个 GPU 负责一部分缓存：

```
┌──────────────────────────────────────────────────────┐
│                 Cache 分片架构                        │
├──────────────────────────────────────────────────────┤
│                                                      │
│  哈希空间: [0 ─────────────────────────────── 2³²)   │
│            │        │        │        │              │
│            ▼        ▼        ▼        ▼              │
│          GPU 0    GPU 1    GPU 2    GPU 3            │
│         [0, 2³⁰) [2³⁰,2³¹) ...    [3×2³⁰, 2³²)    │
│                                                      │
│  每个 GPU 只缓存自己分片内的前缀 KV Cache:             │
│  GPU 0: System Prompt A, C, F  (hash 落在分片 0)     │
│  GPU 1: System Prompt B, D     (hash 落在分片 1)     │
│  GPU 2: System Prompt E, G     (hash 落在分片 2)     │
│  GPU 3: System Prompt H        (hash 落在分片 3)     │
│                                                      │
│  优势: 无跨 GPU 缓存冲突，各自独立管理                 │
│  挑战: 热点前缀（高频 SP）可能导致分片不均              │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### 6.2 无锁并发访问

KV Cache 的读写需要处理并发场景——同一前缀可能被多个请求同时访问：

```python
import threading
from collections import OrderedDict

class LockFreeKVCacheIndex:
    """基于 Copy-on-Write 的无锁缓存索引。
    
    读操作零锁开销；写操作通过原子替换实现。
    """
    
    def __init__(self):
        # 不可变引用，读取时无需加锁
        self._index: dict[str, CacheEntry] = {}
        self._write_lock = threading.Lock()
    
    def lookup(self, prefix_hash: str) -> CacheEntry | None:
        """读操作：直接读取，无锁。"""
        # dict 的读操作在 CPython 中是线程安全的
        return self._index.get(prefix_hash)
    
    def insert(
        self, prefix_hash: str, entry: CacheEntry
    ) -> None:
        """写操作：Copy-on-Write + 原子替换。"""
        with self._write_lock:
            new_index = dict(self._index)
            new_index[prefix_hash] = entry
            self._index = new_index  # 原子替换引用

class RefCountManager:
    """原子引用计数管理器。"""
    
    def __init__(self):
        self._counts: dict[str, int] = {}
        self._lock = threading.Lock()
    
    def acquire(self, prefix_hash: str) -> int:
        """原子增加引用计数。"""
        with self._lock:
            self._counts[prefix_hash] = (
                self._counts.get(prefix_hash, 0) + 1
            )
            return self._counts[prefix_hash]
    
    def release(self, prefix_hash: str) -> int:
        """原子减少引用计数，返回新计数。"""
        with self._lock:
            count = self._counts.get(prefix_hash, 1) - 1
            if count <= 0:
                self._counts.pop(prefix_hash, None)
                return 0
            self._counts[prefix_hash] = count
            return count
```

### 6.3 请求合并（Request Coalescing）

当多个请求需要同一个尚未缓存的前缀时，只需计算一次 Prefill：

```
┌────────────────────────────────────────────────────────┐
│               Request Coalescing 原理                   │
├────────────────────────────────────────────────────────┤
│                                                        │
│  无合并:                                                │
│  请求 1 (SP=A): ──→ Prefill A ──→ 缓存 A ──→ Decode   │
│  请求 2 (SP=A): ──→ Prefill A ──→ 缓存 A ──→ Decode   │
│  请求 3 (SP=A): ──→ Prefill A ──→ 缓存 A ──→ Decode   │
│  → 3 次重复的 Prefill 计算                              │
│                                                        │
│  有合并:                                                │
│  请求 1 (SP=A): ──┐                                    │
│  请求 2 (SP=A): ──┼→ Prefill A (一次) → 缓存 A         │
│  请求 3 (SP=A): ──┘                    │               │
│                                   ┌────┼────┐          │
│                                   ▼    ▼    ▼          │
│                                Decode Decode Decode    │
│  → 只需 1 次 Prefill，3 个请求共享结果                   │
│                                                        │
└────────────────────────────────────────────────────────┘
```

```python
import asyncio
from collections import defaultdict

class PrefillCoalescer:
    """Prefill 请求合并器。
    
    将短时间窗口内到达的相同前缀请求合并，
    只执行一次 Prefill 计算。
    """
    
    def __init__(self):
        # prefix_hash → Future（首个请求创建，后续等待）
        self._inflight: dict[str, asyncio.Future] = {}
        self._lock = asyncio.Lock()
    
    async def get_or_compute(
        self,
        prefix_hash: str,
        compute_fn,  # async callable
    ):
        """获取缓存或合并计算。"""
        async with self._lock:
            if prefix_hash in self._inflight:
                # 已有请求在计算，等待结果
                future = self._inflight[prefix_hash]
            else:
                # 首个请求，创建 Future 并开始计算
                future = asyncio.get_event_loop().create_future()
                self._inflight[prefix_hash] = future
                # 在后台执行计算
                asyncio.create_task(
                    self._compute_and_resolve(
                        prefix_hash, compute_fn, future
                    )
                )
        
        return await future
    
    async def _compute_and_resolve(
        self, prefix_hash, compute_fn, future
    ):
        try:
            result = await compute_fn()
            future.set_result(result)
        except Exception as e:
            future.set_exception(e)
        finally:
            async with self._lock:
                self._inflight.pop(prefix_hash, None)
```

### 6.4 异步缓存填充

将缓存写入操作异步化，避免阻塞推理主路径：

```python
import asyncio
from collections import deque

class AsyncCachePopulator:
    """异步缓存填充器。
    
    Prefill 计算完成后，将 KV Cache 的持久化
    （写入 L2/L3）放入后台队列异步执行。
    """
    
    def __init__(self, l2_store, l3_store):
        self.l2_store = l2_store
        self.l3_store = l3_store
        self._queue: asyncio.Queue = asyncio.Queue(
            maxsize=1000
        )
        self._running = True
    
    async def start(self):
        """启动后台消费者。"""
        workers = [
            asyncio.create_task(self._worker(i))
            for i in range(4)  # 4 个并发写入 worker
        ]
        await asyncio.gather(*workers)
    
    async def submit(
        self, prefix_hash: str, kv_data: bytes
    ):
        """提交异步缓存写入任务（非阻塞）。"""
        try:
            self._queue.put_nowait(
                (prefix_hash, kv_data)
            )
        except asyncio.QueueFull:
            pass  # 队列满时丢弃，不阻塞推理
    
    async def _worker(self, worker_id: int):
        """后台 worker：写入 L2 和 L3。"""
        while self._running:
            prefix_hash, kv_data = await self._queue.get()
            try:
                await self.l2_store.put(
                    prefix_hash, kv_data
                )
                # L3 写入优先级更低，可进一步延迟
                await self.l3_store.put(
                    prefix_hash, kv_data
                )
            except Exception:
                pass  # 缓存写入失败不应影响服务
            finally:
                self._queue.task_done()
```

---

## 7. 高可用设计

### 7.1 核心原则：Cache miss ≠ 服务故障

```
┌────────────────────────────────────────────────────────┐
│              高可用设计的核心原则                         │
├────────────────────────────────────────────────────────┤
│                                                        │
│  ┌──────────────────────────────────────┐              │
│  │  Cache HIT:  快速路径（低延迟）       │              │
│  │  Cache MISS: 慢速路径（完整 Prefill） │              │
│  │  两者的最终结果完全相同               │              │
│  └──────────────────────────────────────┘              │
│                                                        │
│  这意味着：                                             │
│  ✓ 任何缓存节点宕机 → 性能降级，不是功能故障             │
│  ✓ 缓存全部失效 → 回退到无缓存模式，服务继续可用         │
│  ✓ 缓存数据损坏 → 丢弃重算，不产生错误结果              │
│                                                        │
│  这是与"数据库缓存"的根本区别：                          │
│  数据库缓存（如 Redis 缓存 MySQL）可能有一致性问题        │
│  KV Cache 是纯计算缓存，重算结果必然一致                 │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### 7.2 优雅降级

```python
class ResilientCacheRouter:
    """支持优雅降级的缓存路由器。"""
    
    def __init__(
        self,
        primary_router: CacheAwareScheduler,
        fallback_router,  # 简单轮询路由
        health_checker,
    ):
        self.primary = primary_router
        self.fallback = fallback_router
        self.health = health_checker
    
    async def route(self, request) -> str:
        """三级降级路由。"""
        prefix_hash = compute_cache_key(
            request.messages
        )
        
        # Level 1: 缓存感知路由（最优）
        try:
            preferred = self.primary.select_gpu(
                prefix_hash
            )
            if self.health.is_healthy(preferred):
                return preferred
        except Exception:
            pass
        
        # Level 2: 同缓存分片的备选节点
        try:
            backup = self.primary.select_gpu_backup(
                prefix_hash
            )
            if (
                backup
                and self.health.is_healthy(backup)
            ):
                return backup
        except Exception:
            pass
        
        # Level 3: 任意健康节点（放弃缓存亲和）
        return self.fallback.select_any_healthy()
```

### 7.3 节点故障后的缓存重建

```
┌────────────────────────────────────────────────────────┐
│              节点故障恢复流程                             │
├────────────────────────────────────────────────────────┤
│                                                        │
│  阶段 1: 故障检测 (秒级)                                │
│  ┌─────┐    heartbeat timeout    ┌──────────┐         │
│  │GPU 2│ ─────── ✗ ────────────→│Scheduler │         │
│  │ DOWN │                        │标记不可用  │         │
│  └─────┘                        └──────────┘         │
│                                                        │
│  阶段 2: 流量重路由 (立即)                               │
│  原本路由到 GPU 2 的请求 → 重路由到 GPU 0/1/3           │
│  这些请求将 cache miss → 执行完整 Prefill               │
│  服务可用，但延迟暂时升高                                │
│                                                        │
│  阶段 3: 缓存预热 (分钟级)                               │
│  新节点 GPU 2' 加入:                                    │
│  1. 从 L3 分布式缓存加载热门前缀 KV Cache               │
│  2. 或通过预热请求重建缓存                               │
│  3. 调度器逐步将流量切回 GPU 2'                          │
│                                                        │
│  阶段 4: 稳态恢复 (分钟级)                               │
│  GPU 2' 的缓存命中率逐步回升至正常水平                   │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### 7.4 缓存副本

对于极高可用性要求的场景，可以维护缓存副本：

```python
class ReplicatedCacheRouter:
    """双副本缓存路由。
    
    每个前缀哈希映射到 primary + secondary 两个 GPU，
    primary 故障时自动切换到 secondary。
    """
    
    def __init__(
        self,
        ring: ConsistentHashRouter,
    ):
        self.ring = ring
    
    def get_replicas(
        self, prefix_hash: str, n: int = 2
    ) -> list[str]:
        """获取 N 个副本节点（连续的不同物理节点）。"""
        replicas = []
        seen = set()
        
        # 在一致性哈希环上顺时针遍历
        start_idx = self.ring._find_position(prefix_hash)
        idx = start_idx
        
        while len(replicas) < n:
            _, endpoint = self.ring.ring[
                idx % len(self.ring.ring)
            ]
            if endpoint not in seen:
                replicas.append(endpoint)
                seen.add(endpoint)
            idx += 1
            if idx - start_idx > len(self.ring.ring):
                break
        
        return replicas
    
    def route_with_failover(
        self,
        prefix_hash: str,
        health_checker,
    ) -> str:
        """路由到主副本，主不可用则切到备副本。"""
        replicas = self.get_replicas(prefix_hash)
        for replica in replicas:
            if health_checker.is_healthy(replica):
                return replica
        raise RuntimeError("No healthy replicas")
```

### 7.5 跨节点缓存共享协议

```
┌────────────────────────────────────────────────────────┐
│            跨节点缓存共享协议                             │
├────────────────────────────────────────────────────────┤
│                                                        │
│  方案 A: Pull 模式（按需拉取）                           │
│  ┌──────┐  cache miss  ┌──────┐  transfer  ┌──────┐  │
│  │GPU 0 │ ───────────→ │L3    │ ─────────→│GPU 0 │  │
│  │(需要) │              │Store │            │(填充) │  │
│  └──────┘              └──────┘            └──────┘  │
│  优势: 简单，按需传输                                   │
│  劣势: 首次 miss 延迟较高                               │
│                                                        │
│  方案 B: Push 模式（主动复制）                           │
│  ┌──────┐  compute     ┌──────┐  replicate ┌──────┐  │
│  │GPU 1 │ ───────────→ │GPU 1 │ ─────────→│GPU 2 │  │
│  │(计算) │              │(缓存) │            │(副本) │  │
│  └──────┘              └──────┘            └──────┘  │
│  优势: 故障切换快（副本已就绪）                          │
│  劣势: 带宽开销大，显存利用率下降                        │
│                                                        │
│  方案 C: 混合模式（推荐）                                │
│  - 高频前缀（Top-K System Prompt）: Push 模式           │
│  - 低频前缀: Pull 模式（或直接重算）                     │
│  - 判断依据: 前缀的请求频率 × 前缀长度 > 阈值           │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## 8. API 层 Prompt Caching

### 8.1 三大厂商对比

| 特性 | OpenAI | Anthropic | Google Gemini |
|------|--------|-----------|---------------|
| 触发方式 | 自动（≥1024 tokens） | 显式（`cache_control`） | 显式（Context Cache API） |
| 最小前缀长度 | 1024 tokens | 1024 tokens（Sonnet）/ 2048（Haiku） | 32,768 tokens |
| 价格折扣 | 输入价格 50% | 输入价格 90%（写入加 25%） | 输入价格 75% |
| 缓存存活时间 | 5-10 分钟 | 5 分钟（可刷新） | 最长 1 小时（可设置） |
| 支持的内容 | 消息前缀 | 消息、System、工具定义 | 任意内容 |
| 多轮支持 | 自动（前缀匹配） | 自动（前缀匹配） | 需手动管理 |

### 8.2 OpenAI Prompt Caching

OpenAI 的缓存是**完全自动**的——满足条件时自动生效：

```python
from openai import OpenAI

client = OpenAI()

# 缓存自动生效的条件：
# 1. 消息前缀 ≥ 1024 tokens
# 2. 请求之间的前缀完全相同（逐 token 匹配）
# 3. 在缓存存活时间内（5-10 分钟）

# 构造一个长 System Prompt（满足 1024 token 最低要求）
long_system_prompt = """
You are an expert assistant for our e-commerce platform...
[包含详细的产品目录、规则、示例等，超过 1024 tokens]
"""

# 第一次请求：完整计算，缓存前缀
response1 = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": long_system_prompt},
        {"role": "user", "content": "推荐一款手机"},
    ],
)

# 检查缓存使用情况（在 usage 字段中返回）
usage = response1.usage
print(f"总输入 tokens: {usage.prompt_tokens}")
print(
    f"缓存命中 tokens: "
    f"{usage.prompt_tokens_details.cached_tokens}"
)
# 第一次: cached_tokens = 0

# 第二次请求：相同 System Prompt → 自动命中缓存
response2 = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": long_system_prompt},
        {"role": "user", "content": "推荐一台笔记本"},
    ],
)
# 第二次: cached_tokens ≈ system_prompt 的 token 数
# 这些 cached tokens 按 50% 价格计费
```

### 8.3 Anthropic Prompt Caching

Anthropic 需要**显式标记**缓存断点：

```python
import anthropic

client = anthropic.Anthropic()

# 使用 cache_control 显式标记缓存断点
response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    system=[
        {
            "type": "text",
            "text": "你是一个电商平台的智能助手...",
        },
        {
            # 长文本内容（需要超过最小缓存长度）
            "type": "text",
            "text": "[详细的产品目录和规则...]",
            # 关键：显式标记这里为缓存断点
            "cache_control": {"type": "ephemeral"},
        },
    ],
    messages=[
        {"role": "user", "content": "推荐一款手机"},
    ],
)

# 检查缓存使用情况
print(f"输入 tokens: {response.usage.input_tokens}")
print(
    f"缓存写入: "
    f"{response.usage.cache_creation_input_tokens}"
)
print(
    f"缓存读取: "
    f"{response.usage.cache_read_input_tokens}"
)

# 价格计算:
# 缓存写入: 基础价格 × 1.25 (多付 25%)
# 缓存读取: 基础价格 × 0.10 (90% 折扣！)
# 非缓存:   基础价格 × 1.00
```

**Anthropic 缓存的最佳实践**：

```python
# 多个缓存断点：System → Tools → Chat History
response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    system=[
        {
            "type": "text",
            "text": "你是一个代码审查助手...",
            "cache_control": {"type": "ephemeral"},
            # 断点 1: System Prompt 缓存
        },
    ],
    tools=[
        {
            "name": "run_tests",
            "description": "运行单元测试...",
            "input_schema": {"type": "object", "properties": {}},
        },
        {
            "name": "lint_code",
            "description": "代码检查...",
            "input_schema": {"type": "object", "properties": {}},
            "cache_control": {"type": "ephemeral"},
            # 断点 2: Tool 定义缓存
        },
    ],
    messages=[
        {"role": "user", "content": "审查这段代码..."},
        {"role": "assistant", "content": "我来审查..."},
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "请进一步检查安全问题",
                    "cache_control": {"type": "ephemeral"},
                    # 断点 3: 对话历史缓存
                },
            ],
        },
    ],
)
```

### 8.4 成本优化策略

```
┌────────────────────────────────────────────────────────┐
│             API 层缓存成本优化决策树                      │
├────────────────────────────────────────────────────────┤
│                                                        │
│  前缀长度 ≥ 最小要求？                                   │
│  ├── 否 → 无法使用缓存，考虑合并短前缀                   │
│  └── 是 ↓                                              │
│                                                        │
│  同一前缀的请求频率？                                    │
│  ├── 高频（>1 req/min）→ 缓存 ROI 很高                  │
│  │   OpenAI: 自动生效，无需操作                          │
│  │   Anthropic: 添加 cache_control                     │
│  ├── 中频（1 req/5min）→ 注意缓存过期                    │
│  │   考虑定期发送"保活"请求刷新缓存                       │
│  └── 低频（<1 req/10min）→ 缓存可能已过期                │
│      评估是否值得缓存写入开销（Anthropic +25%）           │
│                                                        │
│  多厂商成本对比（1000 次请求，10K token 前缀）:           │
│  ┌──────────┬──────────┬──────────┬──────────┐         │
│  │          │ 无缓存    │ OpenAI   │ Anthropic│         │
│  │          │          │ (50%off) │ (90%off) │         │
│  ├──────────┼──────────┼──────────┼──────────┤         │
│  │ 输入成本  │ $30.00   │ $15.15   │ $6.75    │         │
│  │ 节省比例  │   —      │  50%     │  78%     │         │
│  └──────────┴──────────┴──────────┴──────────┘         │
│  *Anthropic 首次写入多付 25%，后续读取节省 90%            │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## 9. 生产实践

### 9.1 监控指标体系

```python
# Prometheus 监控指标定义
from prometheus_client import (
    Counter, Gauge, Histogram, Summary,
)

# 核心指标
cache_hit_total = Counter(
    "prompt_cache_hit_total",
    "Total cache hits",
    ["gpu_id", "prefix_type"],
)
cache_miss_total = Counter(
    "prompt_cache_miss_total",
    "Total cache misses",
    ["gpu_id", "prefix_type"],
)
cache_hit_ratio = Gauge(
    "prompt_cache_hit_ratio",
    "Cache hit ratio (5min rolling)",
    ["gpu_id"],
)

# 容量指标
cache_memory_bytes = Gauge(
    "prompt_cache_memory_bytes",
    "Cache memory usage in bytes",
    ["gpu_id", "level"],  # level: l1/l2/l3
)
cache_entries_total = Gauge(
    "prompt_cache_entries_total",
    "Number of cached entries",
    ["gpu_id"],
)
cache_eviction_total = Counter(
    "prompt_cache_eviction_total",
    "Total cache evictions",
    ["gpu_id", "reason"],  # reason: lru/memory/manual
)

# 性能指标
prefill_duration_seconds = Histogram(
    "prompt_prefill_duration_seconds",
    "Prefill computation duration",
    ["gpu_id", "cache_status"],  # hit/miss
    buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5],
)
cache_transfer_duration_seconds = Histogram(
    "prompt_cache_transfer_seconds",
    "L2/L3 to L1 transfer duration",
    ["source_level"],
    buckets=[0.001, 0.005, 0.01, 0.05, 0.1],
)
```

### 9.2 关键告警规则

```yaml
# Prometheus AlertManager 告警规则
groups:
  - name: prompt_cache_alerts
    rules:
      # 命中率下降告警
      - alert: CacheHitRateDrop
        expr: prompt_cache_hit_ratio < 0.5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Cache hit rate dropped below 50%"
          description: >
            GPU {{ $labels.gpu_id }} cache hit rate
            is {{ $value | humanizePercentage }}.
            Possible causes: routing misconfiguration,
            cache eviction pressure, or traffic pattern
            change.

      # 显存压力告警
      - alert: CacheMemoryPressure
        expr: >
          prompt_cache_memory_bytes{level="l1"}
          / gpu_total_memory_bytes > 0.85
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "GPU KV Cache memory > 85%"
          description: >
            Risk of OOM. Consider increasing eviction
            aggressiveness or adding GPU capacity.

      # 淘汰率异常告警
      - alert: HighEvictionRate
        expr: >
          rate(prompt_cache_eviction_total[5m]) > 100
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High cache eviction rate"
```

### 9.3 容量规划

```
┌────────────────────────────────────────────────────────┐
│                   容量规划公式                           │
├────────────────────────────────────────────────────────┤
│                                                        │
│  1. 估算热门前缀数量:                                    │
│     N_prefix = 独立 System Prompt 数量                  │
│     例: 10 个业务场景 × 3 个版本 = 30 个前缀             │
│                                                        │
│  2. 估算单个前缀的 KV Cache 大小:                        │
│     Size_per_prefix = 2 × L × H × D × T × dtype       │
│     例 (70B, FP16, 2000 tokens):                       │
│     = 2 × 80 × 8 × 128 × 2000 × 2 ≈ 640 MB           │
│                                                        │
│  3. 总 L1 缓存需求:                                     │
│     L1_total = N_prefix × Size_per_prefix              │
│     = 30 × 640 MB ≈ 19.2 GB                           │
│                                                        │
│  4. GPU 显存分配:                                       │
│     总显存 = 模型权重 + KV Cache(活跃) + KV Cache(缓存)  │
│     80 GB = 35 GB + 25 GB + 20 GB                     │
│     → L1 缓存容量约 20 GB → 可缓存 ~31 个前缀           │
│                                                        │
│  5. 不够？选项:                                         │
│     a. 启用 L2 offload（CPU 内存）                      │
│     b. 缩短前缀长度                                     │
│     c. 使用量化 KV Cache（FP8 → 显存减半）              │
│     d. 增加 GPU 数量（分摊缓存压力）                     │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### 9.4 多租户 LLM 服务架构

```
┌───────────────────────────────────────────────────────────────┐
│               多租户 LLM 服务缓存架构                          │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────────────────────────────────┐        │
│  │                  API Gateway                      │        │
│  │  - 认证 / 限流 / 计费                              │        │
│  │  - Prompt 标准化                                   │        │
│  │  - 提取 prefix_key                                │        │
│  └────────────────────┬─────────────────────────────┘        │
│                       │                                       │
│  ┌────────────────────▼─────────────────────────────┐        │
│  │            Cache-Aware Router                     │        │
│  │  - 一致性哈希路由                                  │        │
│  │  - 负载感知调度                                    │        │
│  │  - 健康检查 + 故障转移                             │        │
│  └────┬──────────┬──────────┬──────────┬────────────┘        │
│       │          │          │          │                      │
│  ┌────▼───┐ ┌────▼───┐ ┌────▼───┐ ┌────▼───┐               │
│  │ GPU 0  │ │ GPU 1  │ │ GPU 2  │ │ GPU 3  │               │
│  │ vLLM   │ │ vLLM   │ │ vLLM   │ │ vLLM   │               │
│  │ +APC   │ │ +APC   │ │ +APC   │ │ +APC   │               │
│  ├────────┤ ├────────┤ ├────────┤ ├────────┤               │
│  │L1 Cache│ │L1 Cache│ │L1 Cache│ │L1 Cache│               │
│  │Tenant: │ │Tenant: │ │Tenant: │ │Tenant: │               │
│  │ A, D   │ │ B, E   │ │ C, F   │ │ A, G   │               │
│  └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘               │
│      │          │          │          │                      │
│  ┌───▼──────────▼──────────▼──────────▼────┐                │
│  │          L2: Host Memory Pool            │                │
│  │     (溢出缓存 + 预热候选)                 │                │
│  └──────────────────┬──────────────────────┘                │
│                     │                                        │
│  ┌──────────────────▼──────────────────────┐                │
│  │        L3: Redis Cluster / NVMe         │                │
│  │   (跨节点共享 + 持久化 + 灾备)           │                │
│  └─────────────────────────────────────────┘                │
│                                                               │
│  租户隔离策略:                                                 │
│  - 每个租户的缓存配额独立计算                                  │
│  - 大租户的 SP 优先 Push 副本到多个 GPU                        │
│  - 小租户共享 GPU，按 LRU 自然竞争缓存空间                     │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

### 9.5 TypeScript 路由层实现参考

```typescript
import { createHash } from "crypto";

interface RouteDecision {
  endpoint: string;
  cacheHit: boolean;
  fallback: boolean;
}

interface GPUNode {
  endpoint: string;
  healthy: boolean;
  load: number; // 0-1
  cachedPrefixes: Set<string>;
}

class PromptCacheRouter {
  private nodes: Map<string, GPUNode> = new Map();
  private ring: Array<{ hash: number; endpoint: string }> = [];
  private readonly virtualNodes = 150;

  constructor(endpoints: string[]) {
    for (const ep of endpoints) {
      this.addNode(ep);
    }
  }

  addNode(endpoint: string): void {
    this.nodes.set(endpoint, {
      endpoint,
      healthy: true,
      load: 0,
      cachedPrefixes: new Set(),
    });

    for (let i = 0; i < this.virtualNodes; i++) {
      const hash = this.hash(`${endpoint}:v${i}`);
      this.ring.push({ hash, endpoint });
    }
    this.ring.sort((a, b) => a.hash - b.hash);
  }

  route(systemPrompt: string): RouteDecision {
    const prefixKey = this.normalizePrompt(systemPrompt);
    const prefixHash = this.hash(prefixKey);

    // 1. 尝试缓存亲和路由
    const preferred = this.findOnRing(prefixHash);
    const prefNode = this.nodes.get(preferred);

    if (prefNode?.healthy && prefNode.load < 0.9) {
      return {
        endpoint: preferred,
        cacheHit: prefNode.cachedPrefixes.has(prefixKey),
        fallback: false,
      };
    }

    // 2. 降级：选择负载最低的健康节点
    const fallbackNode = this.selectLeastLoaded();
    return {
      endpoint: fallbackNode.endpoint,
      cacheHit: false,
      fallback: true,
    };
  }

  private normalizePrompt(prompt: string): string {
    return prompt.trim().replace(/\s+/g, " ");
  }

  private hash(key: string): number {
    const digest = createHash("md5")
      .update(key)
      .digest("hex");
    return parseInt(digest.substring(0, 8), 16);
  }

  private findOnRing(hash: number): string {
    for (const entry of this.ring) {
      if (entry.hash >= hash) return entry.endpoint;
    }
    return this.ring[0].endpoint;
  }

  private selectLeastLoaded(): GPUNode {
    let best: GPUNode | null = null;
    for (const node of this.nodes.values()) {
      if (
        node.healthy &&
        (!best || node.load < best.load)
      ) {
        best = node;
      }
    }
    if (!best) throw new Error("No healthy nodes");
    return best;
  }
}
```

---

## 10. 常见陷阱与最佳实践

### 陷阱 1：忽略 Prompt 标准化

❌ **错误做法**：直接使用原始 Prompt 作为缓存键

```python
# 两个语义相同但格式不同的 Prompt → Cache MISS
prompt_a = "You are a helpful assistant. "     # 末尾空格
prompt_b = "You are a helpful assistant."      # 无空格
# token 化后序列不同 → 路由到不同 GPU → 缓存未命中
```

✅ **正确做法**：标准化后再计算缓存键

```python
def normalize(prompt: str) -> str:
    return " ".join(prompt.strip().split())

# normalize(prompt_a) == normalize(prompt_b) → 同一缓存
```

### 陷阱 2：Round-Robin 路由导致缓存失效

❌ **错误做法**：使用标准轮询负载均衡

```nginx
# Nginx 默认 round-robin → 每个 GPU 都缓存一份
upstream llm_backend {
    server gpu-0:8000;
    server gpu-1:8000;
    server gpu-2:8000;
}
```

✅ **正确做法**：基于 Prompt 哈希的一致性路由

```nginx
upstream llm_backend {
    hash $prompt_prefix_hash consistent;
    server gpu-0:8000;
    server gpu-1:8000;
    server gpu-2:8000;
}
```

### 陷阱 3：将采样参数纳入缓存键

❌ **错误做法**：temperature 不同导致缓存未命中

```python
# 相同 Prompt，不同 temperature → 不同缓存键 → MISS
key_a = hash(messages + "temp=0.7")
key_b = hash(messages + "temp=0.3")
# 但 KV Cache 与 temperature 无关！
```

✅ **正确做法**：缓存键只包含影响 KV Cache 的参数

```python
# 只用 messages 和 model 计算缓存键
cache_key = hash(json.dumps(messages) + model_name)
# temperature/top_p/max_tokens 等采样参数不参与
```

### 陷阱 4：Few-shot 示例顺序随机化

❌ **错误做法**：每次请求随机排列 Few-shot 示例

```python
import random
examples = [ex1, ex2, ex3, ex4, ex5]
random.shuffle(examples)  # 每次顺序不同
prompt = system + "\n".join(examples) + query
# → 每次 Token 序列不同 → 无法复用缓存
```

✅ **正确做法**：固定示例顺序，作为静态模板

```python
# 示例按固定顺序排列，所有请求共享同一前缀
TEMPLATE = system + "\n".join(
    sorted(examples, key=lambda e: e["id"])
)
prompt = TEMPLATE + query
# → 所有请求的 TEMPLATE 部分完全相同 → 高命中率
```

### 陷阱 5：缓存过期导致周期性延迟毛刺

❌ **错误做法**：完全依赖自然过期

```
时间线:
t=0    缓存写入 → t=5min 过期 → t=5min+1s 第一个 MISS
                                → 延迟从 50ms 跳到 500ms
                                → 用户感知明显毛刺
```

✅ **正确做法**：定期"保活"刷新热门缓存

```python
async def keep_cache_alive(
    hot_prefixes: list[str],
    interval_seconds: int = 120,  # 每 2 分钟刷新
):
    """在缓存过期前发送保活请求。"""
    while True:
        for prefix in hot_prefixes:
            await client.generate(
                messages=[
                    {"role": "system", "content": prefix},
                    {"role": "user", "content": "."},
                ],
                max_tokens=1,
            )
        await asyncio.sleep(interval_seconds)
```

### 陷阱 6：缓存命中率监控缺失

❌ **错误做法**：部署了缓存但不监控命中率

```python
# 没有任何监控 → 不知道缓存是否生效
response = await llm.generate(messages)
```

✅ **正确做法**：全链路监控 + 告警

```python
async def generate_with_metrics(messages):
    prefix_hash = compute_cache_key(messages)
    gpu = router.select_gpu(prefix_hash)
    
    start = time.monotonic()
    response = await llm.generate(
        endpoint=gpu, messages=messages
    )
    duration = time.monotonic() - start
    
    # 记录指标
    is_hit = response.usage.get("cached_tokens", 0) > 0
    if is_hit:
        cache_hit_total.labels(gpu=gpu).inc()
    else:
        cache_miss_total.labels(gpu=gpu).inc()
    
    prefill_duration_seconds.labels(
        gpu=gpu,
        cache_status="hit" if is_hit else "miss",
    ).observe(duration)
    
    return response
```

### 陷阱 7：扩容时未考虑缓存预热

❌ **错误做法**：直接将流量切到新节点

```
新 GPU 加入 → 立即接收 100% 流量 → 全部 MISS
→ Prefill 计算量暴增 → 新节点过载 → 级联故障
```

✅ **正确做法**：渐进式流量切换 + 预热

```python
async def graceful_scale_up(new_gpu: str):
    # 阶段 1: 预热（不接收真实流量）
    await warm_up_cache(
        router, client,
        system_prompts=get_hot_prefixes(),
    )
    
    # 阶段 2: 灰度（只接收 10% 流量）
    router.set_weight(new_gpu, weight=0.1)
    await asyncio.sleep(300)  # 观察 5 分钟
    
    # 阶段 3: 全量
    router.set_weight(new_gpu, weight=1.0)
```

---

> **总结**：Prompt Cache 工程的核心在于三个协同：**推理引擎的 KV Cache 管理**提供底层能力，**缓存感知路由**确保请求到达正确的 GPU，**命中率优化工程**保证最大化缓存价值。三者缺一不可——单独优化推理引擎的缓存策略，如果路由层是轮询的，命中率永远不会超过 1/N。
