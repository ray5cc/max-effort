# Prompt Cache 工程与路由优化 — 面试题

> 覆盖 KV Cache 复用、Prefix Caching、缓存感知路由、命中率优化与高可用设计

## 相关链接
- 对应技术资料：[Prompt Cache工程与路由优化](../../01-技术资料/09-AI-Agent工程化/12-Prompt-Cache工程与路由优化.md)

## 题目列表

| 题号 | 题目 | 难度 |
|------|------|------|
| Q1 | KV Cache 是什么？为什么它对 LLM 推理至关重要？ | ⭐ 基础 |
| Q2 | Prefix Caching 的工作原理是什么？解释 RadixAttention 的概念 | ⭐ 基础 |
| Q3 | 精确匹配缓存与前缀缓存有什么区别？ | ⭐ 基础 |
| Q4 | 对比 OpenAI 和 Anthropic 的 Prompt Caching 机制 | ⭐ 基础 |
| Q5 | 为什么 Round-Robin 负载均衡会摧毁缓存命中率？ | ⭐⭐ 进阶 |
| Q6 | 如何用一致性哈希实现缓存感知路由？ | ⭐⭐ 进阶 |
| Q7 | 多层缓存架构（GPU/Host/Distributed）是如何工作的？ | ⭐⭐ 进阶 |
| Q8 | Prompt 标准化有哪些技术手段？如何提升缓存命中率？ | ⭐⭐ 进阶 |
| Q9 | LRU 和 Prefix-Aware 淘汰策略的区别是什么？ | ⭐⭐ 进阶 |
| Q10 | 什么是请求合并（Request Coalescing）？如何实现？ | ⭐⭐ 进阶 |
| Q11 | 设计一个面向多租户 LLM 服务的缓存感知调度器 | ⭐⭐⭐ 高级 |
| Q12 | GPU 节点故障后如何重建缓存？描述完整恢复流程 | ⭐⭐⭐ 高级 |
| Q13 | 如何权衡缓存命中率与负载均衡？ | ⭐⭐⭐ 高级 |
| Q14 | 多租户 SaaS 场景：每个租户有不同的 System Prompt，设计缓存路由策略 | 🎯 场景设计 |
| Q15 | 缓存命中率从 85% 骤降到 30%，如何诊断和修复？ | 🎯 场景设计 |

## 🔥 高频考点速记

| # | 考点 | 核心要点 | 出题概率 |
|---|------|---------|---------|
| 1 | KV Cache 复用 | Prefill 占 60-80% 算力 → 共享前缀直接跳过 → TTFT 从数百 ms 降到接近 0 | ★★★★★ |
| 2 | 缓存感知路由 | Round-Robin 命中率 ≈ 1/N → 前缀哈希路由 85%+ → 一致性哈希抗扩缩容 | ★★★★★ |
| 3 | Prefix Caching | Token 分块哈希 → Radix Tree / 哈希表索引 → 最长公共前缀匹配 | ★★★★☆ |
| 4 | 命中率优化 | Prompt 标准化 + 示例顺序固定 + 参数分离 + 缓存预热 | ★★★★☆ |
| 5 | 高可用设计 | Cache miss ≠ 故障 → 优雅降级 → 缓存副本 → 渐进式预热 | ★★★☆☆ |

## 参考答案

### Q1: KV Cache 是什么？为什么它对 LLM 推理至关重要？

<details>
<summary>参考答案</summary>

**KV Cache 是 Transformer 推理中用显存换计算的核心优化——缓存已计算的 Key/Value 张量，避免自回归生成中的重复计算。Prompt Cache 进一步复用不同请求之间共享前缀的 KV Cache，跳过重复的 Prefill 阶段。**

#### 生活类比

把 LLM 推理想象成**考试**：

- **Prefill**（阅读题目）：需要完整读一遍所有题目才能开始答题，题目越长阅读时间越长
- **Decode**（写答案）：逐字书写答案，速度相对稳定
- **KV Cache**：你的笔记本——每读一段就做笔记（K/V），后面答题翻笔记而非重读全文
- **Prompt Cache**：如果两个人做同一张卷子，后面的人可以直接抄前面人的笔记

#### LLM 推理的两个阶段

```
┌─────────────────────────────────────────────────────────┐
│                    LLM 推理时间分布                       │
├─────────────┬───────────────────────────────────────────┤
│  短输出请求  │ ████████████████████████░░░░░░░░░░        │
│             │ ◄──── Prefill 70% ────►◄─ Decode 30% ─►  │
│  长输出请求  │ ████████████████░░░░░░░░░░░░░░░░░░        │
│             │ ◄─ Prefill 40% ►◄──── Decode 60% ─────►  │
├─────────────┴───────────────────────────────────────────┤
│  Prefill：计算密集（矩阵乘法），所有 Token 并行处理        │
│  Decode ：访存密集（逐 Token 生成），受限于显存带宽        │
└─────────────────────────────────────────────────────────┘
```

#### KV Cache 显存占用公式

```
KV Cache 大小 = 2 × num_layers × num_kv_heads × head_dim × seq_len × dtype_size

以 Llama 3 70B 为例（FP16）:
= 2 × 80 × 8 × 128 × seq_len × 2 bytes
≈ 0.31 MB / token

1024 tokens → 约 320 MB
4096 tokens → 约 1.28 GB
```

#### Prompt Cache 的价值量化

| 指标 | 无缓存 | 有缓存（80% 命中） | 提升 |
|------|--------|-------------------|------|
| Prefill 计算量（QPS=100，SP=2000 tokens） | 220K tokens/s | 60K tokens/s | **减少 73%** |
| 首 Token 延迟（TTFT） | 数百 ms | 接近 0 | **10x+** |
| 单 GPU 可支持并发 | N | 2-4N | **2-4x** |
| API 成本（Anthropic 缓存折扣） | 100% | 10% | **节省 90%** |

#### 面试追问

- **KV Cache 大到什么程度会成为瓶颈**？70B 模型同时服务 100 个 4K 请求，KV Cache 需要 ~64 GB，可能超过模型权重本身（35 GB in FP8）
- **GQA/MQA 如何缓解 KV Cache 压力**？GQA 将 KV heads 从 64 减少到 8，KV Cache 减少 8 倍，是现代大模型标配
- **KV Cache 量化**：FP8 可减少 50% 显存，但需评估对注意力精度的影响

</details>

---

### Q2: Prefix Caching 的工作原理是什么？解释 RadixAttention 的概念

<details>
<summary>参考答案</summary>

**Prefix Caching 的核心思想：如果两个请求的 Token 序列有相同前缀，前缀部分的 KV Cache 可以直接复用，只需计算增量部分。RadixAttention 是 SGLang 引入的基于 Radix Tree（基数树）的 KV Cache 管理方案，支持任意前缀的高效匹配。**

#### Token 级分块与哈希匹配

实际实现中不是整体哈希，而是按固定大小的块（Block）分块哈希：

```
Token 序列:  [t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11, t12]

Block 大小 = 4:
┌───────────┐  ┌───────────┐  ┌───────────┐
│ Block 0   │  │ Block 1   │  │ Block 2   │
│ [t1..t4]  │  │ [t5..t8]  │  │ [t9..t12] │
│ hash: 0xA │  │ hash: 0xB │  │ hash: 0xC │
└───────────┘  └───────────┘  └───────────┘

匹配过程（逐块从前向后）:
1. 新请求 Block 0 哈希 → 与缓存匹配 → ✓ 命中
2. 新请求 Block 1 哈希 → 与缓存匹配 → ✓ 命中
3. 新请求 Block 2 哈希 → 与缓存匹配 → ✗ 不匹配
→ 复用前 2 个 Block 的 KV Cache，只计算 Block 2 开始的增量部分
```

**关键细节**：块的哈希值包含前缀信息（链式哈希依赖），确保相同 Token 在不同上下文位置有不同的哈希值。

#### RadixAttention（SGLang）

用 Radix Tree 管理所有缓存的 Token 序列，支持任意前缀的高效匹配：

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

#### vLLM APC vs SGLang RadixAttention

| 特性 | vLLM APC（哈希表） | SGLang RadixAttention（Radix Tree） |
|------|-------------------|-------------------------------------|
| 数据结构 | 哈希表 | Radix Tree |
| 匹配方式 | 逐块哈希查表 | 树节点遍历 |
| 内存开销 | 较低 | 较高（树节点指针） |
| 多轮对话优化 | 通用 | 特别优化 |
| 细粒度淘汰 | 块级淘汰 | 可淘汰叶子节点而保留共享前缀 |
| 启用方式 | `--enable-prefix-caching` | 默认启用 |

#### 核心代码原理（vLLM APC 简化）

```python
class PrefixCacheManager:
    def __init__(self, block_size: int = 16):
        self.block_size = block_size
        self.cache_table: dict[int, int] = {}  # hash → block_id
    
    def compute_block_hash(self, tokens: list[int], block_idx: int) -> int:
        start = block_idx * self.block_size
        end = start + self.block_size
        block_tokens = tuple(tokens[start:end])
        # 链式哈希：包含前缀信息
        prefix_hash = 0 if block_idx == 0 else self.compute_block_hash(tokens, block_idx - 1)
        return hash((prefix_hash, block_tokens))
    
    def find_cached_prefix(self, tokens: list[int]) -> tuple[int, list[int]]:
        num_blocks = len(tokens) // self.block_size
        cached_blocks = []
        for i in range(num_blocks):
            block_hash = self.compute_block_hash(tokens, i)
            if block_hash in self.cache_table:
                cached_blocks.append(self.cache_table[block_hash])
            else:
                break  # 前缀中断，后续不可能命中
        return len(cached_blocks), cached_blocks
```

#### 面试追问

- **block_size 如何选择**？太小（1）→ 哈希计算开销大；太大（256）→ 部分前缀匹配概率降低。vLLM 默认 16
- **为什么哈希需要链式依赖**？因为相同的 Token 块在不同上下文位置的 Attention 输出不同（位置编码和因果掩码的影响），哈希必须包含前缀信息
- **RadixAttention 的多轮对话优势**？每轮对话只需增量计算新消息，历史部分自动复用，且树结构天然支持分叉（不同用户在同一上下文基础上的不同对话）

</details>

---

### Q3: 精确匹配缓存与前缀缓存有什么区别？

<details>
<summary>参考答案</summary>

**精确匹配缓存（Exact Match Caching）要求输入完全相同才命中，适用于结果缓存；前缀缓存（Prefix Caching）只要求前缀部分相同即可复用，适用于 KV Cache 复用。两者在架构位置、缓存粒度和适用场景上有本质区别。**

#### 对比总览

```
精确匹配缓存:
  请求 A: [System + User: "你好"]     → hash("System+你好") → 查缓存
  请求 B: [System + User: "天气如何"] → hash("System+天气如何") → MISS
  → 只有完全相同的输入才命中

前缀缓存:
  请求 A: [System Prompt][User: "你好"]     → System 部分 KV Cache 存入
  请求 B: [System Prompt][User: "天气如何"] → System 部分 KV Cache 命中 ✓
  → 共享前缀部分即可复用，增量部分单独计算
```

#### 详细对比表

| 维度 | 精确匹配缓存 | 前缀缓存（Prompt Cache） |
|------|-------------|------------------------|
| **匹配条件** | 输入 100% 相同 | 前缀部分相同即可 |
| **缓存内容** | 模型完整输出（文本） | 中间计算结果（KV 张量） |
| **架构位置** | API 网关层 / 应用层 | 推理引擎内部 |
| **存储介质** | Redis / 磁盘 | GPU 显存 / Host 内存 |
| **命中率** | 低（完全相同输入少） | 高（共享前缀普遍） |
| **节省的开销** | 跳过整个推理（100%） | 跳过前缀 Prefill（60-90%） |
| **适用场景** | 高频重复查询（FAQ） | 共享 System Prompt / 多轮对话 |
| **一致性问题** | 有（temperature > 0 时结果不确定） | 无（KV Cache 是确定性计算） |

#### 典型场景适配

```
场景 1: FAQ 机器人（高重复率）
  → 精确匹配缓存优先（相同问题返回相同回答）
  → 前缀缓存作为 fallback

场景 2: 客服助手（同 System Prompt，不同用户问题）
  → 前缀缓存优先（System Prompt 复用）
  → 精确匹配缓存收益低

场景 3: 代码补全（大量仓库上下文 + 不同编辑位置）
  → 前缀缓存价值极高（仓库上下文占 70-95%）
  → 精确匹配几乎不可能命中
```

#### 面试追问

- **能否两层缓存同时使用**？可以，且推荐。API 层做精确匹配缓存（命中则直接返回零延迟），推理引擎层做前缀缓存（未精确命中时加速 Prefill）
- **精确匹配缓存在 temperature > 0 时如何处理**？需要将 temperature/seed 也纳入缓存键，或只对 temperature=0 的确定性请求启用
- **前缀缓存有没有一致性风险**？没有。KV Cache 是确定性计算，相同前缀的 KV Cache 结果永远相同（前提是同一模型权重）

</details>

---

### Q4: 对比 OpenAI 和 Anthropic 的 Prompt Caching 机制

<details>
<summary>参考答案</summary>

**OpenAI 采用全自动缓存（满足条件即生效），Anthropic 采用显式标记缓存断点（通过 `cache_control` 字段）。两者在触发方式、价格策略和最佳实践上有显著差异。**

#### 三大厂商对比

| 特性 | OpenAI | Anthropic | Google Gemini |
|------|--------|-----------|---------------|
| 触发方式 | 自动（≥1024 tokens） | 显式（`cache_control`） | 显式（Context Cache API） |
| 最小前缀长度 | 1024 tokens | 1024 tokens (Sonnet) / 2048 (Haiku) | 32,768 tokens |
| 价格折扣 | 输入价格 **50%** | 输入价格 **90%**（写入加 25%） | 输入价格 **75%** |
| 缓存存活时间 | 5-10 分钟 | 5 分钟（可刷新） | 最长 1 小时（可设置） |
| 支持缓存内容 | 消息前缀 | 消息、System、工具定义 | 任意内容 |
| 多轮支持 | 自动（前缀匹配） | 自动（前缀匹配） | 需手动管理 |

#### OpenAI 用法示例

```python
from openai import OpenAI
client = OpenAI()

# 完全自动——满足 ≥1024 tokens 前缀即生效
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": long_system_prompt},  # ≥1024 tokens
        {"role": "user", "content": "推荐一款手机"},
    ],
)

# 在 usage 中查看缓存命中
print(response.usage.prompt_tokens_details.cached_tokens)
# 第一次: 0（缓存写入）
# 第二次: ≈ system_prompt token 数（命中，按 50% 计费）
```

#### Anthropic 用法示例

```python
import anthropic
client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    system=[
        {
            "type": "text",
            "text": "你是一个电商平台的智能助手...",
            "cache_control": {"type": "ephemeral"},  # 显式标记缓存断点
        },
    ],
    messages=[{"role": "user", "content": "推荐一款手机"}],
)

# 三种计费类型
print(f"缓存写入: {response.usage.cache_creation_input_tokens}")  # ×1.25
print(f"缓存读取: {response.usage.cache_read_input_tokens}")      # ×0.10
print(f"普通输入: {response.usage.input_tokens}")                  # ×1.00
```

#### 成本对比（1000 次请求，10K token 前缀）

```
┌──────────┬──────────┬──────────┬──────────┐
│          │ 无缓存    │ OpenAI   │ Anthropic│
│          │          │ (50%off) │ (90%off) │
├──────────┼──────────┼──────────┼──────────┤
│ 输入成本  │ $30.00   │ $15.15   │ $6.75    │
│ 节省比例  │   —      │  50%     │  78%     │
└──────────┴──────────┴──────────┴──────────┘
*Anthropic 首次写入多付 25%，但后续 999 次读取节省 90%
```

#### 选型建议

| 场景 | 推荐方案 | 原因 |
|------|---------|------|
| 高频重复前缀（>1 req/min） | Anthropic | 90% 折扣远超 OpenAI 的 50% |
| 低频、多样化前缀 | OpenAI | 自动缓存，无需显式管理 |
| 超长上下文（32K+ tokens） | Gemini | 唯一支持超长缓存 |
| 多缓存断点（System + Tools + History） | Anthropic | 支持多个 `cache_control` 断点 |

#### 面试追问

- **Anthropic 缓存写入加 25% 的策略是否值得**？只要同一前缀被复用 2 次以上就值得：第 1 次写入 1.25x，第 2 次读取 0.1x，总计 1.35x vs 无缓存 2.0x
- **缓存过期后如何处理**？定期发送"保活"请求（max_tokens=1）刷新缓存存活时间
- **OpenAI 缓存命中的前提条件**？前缀必须逐 Token 完全一致，且在 5-10 分钟内，同一 organization 内

</details>

---

### Q5: 为什么 Round-Robin 负载均衡会摧毁缓存命中率？

<details>
<summary>参考答案</summary>

**Round-Robin（轮询）将请求均匀分发到所有 GPU，导致相同前缀的请求被分散到不同 GPU 上，每个 GPU 都缓存一份副本。命中率从理论上的接近 100% 降至约 1/N（N 为 GPU 数量），同时显存浪费 N 倍。**

#### 问题可视化

```
标准 Round-Robin 路由（4 个 GPU）:

请求 (SP=A): ──→ GPU 0  [缓存 A ✓]
请求 (SP=A): ──→ GPU 1  [缓存 A ✓]  ← 又一个副本
请求 (SP=A): ──→ GPU 2  [缓存 A ✓]  ← 又一个副本
请求 (SP=A): ──→ GPU 3  [缓存 A ✓]  ← 第四个副本

结果:
  ❌ 4 个 GPU 各存一份 A 的 KV Cache → 显存浪费 4x
  ❌ 后续请求只有 1/4 概率命中（轮到同一 GPU 才命中）
  ❌ 命中率理论上限 = 1/N = 25%

缓存感知路由 (hash(SP=A) → GPU 1):

请求 (SP=A): ──→ GPU 1  [缓存 A ✓]
请求 (SP=A): ──→ GPU 1  [命中 A ✓]  ← 100% 命中
请求 (SP=A): ──→ GPU 1  [命中 A ✓]  ← 100% 命中
请求 (SP=B): ──→ GPU 3  [缓存 B ✓]  ← B 路由到不同 GPU

结果:
  ✅ 每个 SP 只在一个 GPU 上缓存 → 高命中率 + 低显存浪费
  ✅ 命中率可达 85%+
```

#### 量化分析

| 指标 | Round-Robin (4 GPU) | 前缀哈希路由 |
|------|--------------------|-----------:|
| 缓存命中率 | ~25% | ~85%+ |
| 显存浪费（相同前缀副本） | 4x | 1x |
| Prefill 计算量 | 高（75% 请求 miss） | 低（15% miss） |
| TTFT P99 | 高（频繁 miss） | 低（稳定命中） |

#### 生活类比

想象 4 家分店（GPU），每家都记住常客偏好（KV Cache）：

- **轮询路由**：每次把顾客随机分配到不同分店，每家都得重新了解这位顾客
- **缓存感知路由**：把同一位顾客总是分配到同一家分店，分店记住偏好后服务更快

#### 面试追问

- **如果不同 System Prompt 的流量极度不均衡怎么办**？一个热门 SP 占 80% 流量，前缀哈希路由会将所有热门流量集中到一个 GPU，导致过载。此时需要结合负载感知的评分机制
- **加权轮询（Weighted Round-Robin）能解决问题吗**？不能——它改善的是负载均衡，不改善缓存亲和性。相同前缀的请求仍然被分散
- **Nginx 如何配置缓存感知路由**？使用 `hash $prompt_prefix_hash consistent;` 替换默认轮询

</details>

---

### Q6: 如何用一致性哈希实现缓存感知路由？

<details>
<summary>参考答案</summary>

**简单取模 `hash % N` 在 GPU 数量变化时会导致几乎所有前缀重新映射、缓存全部失效。一致性哈希（Consistent Hashing）将哈希空间映射到环上，节点变更时只影响邻近区段，保留大部分缓存。虚拟节点机制进一步提高负载均衡性。**

#### 取模 vs 一致性哈希

```
取模哈希（hash % N）:
  N=4: prefix_A → GPU 2,  prefix_B → GPU 0,  prefix_C → GPU 3
  N=5: prefix_A → GPU 3,  prefix_B → GPU 1,  prefix_C → GPU 4
  → 3 个 GPU 全部重新映射 → 所有缓存失效！

一致性哈希:
  添加 GPU-4:
  ┌─────────────────────────────────────────────┐
  │  只有 GPU-4 附近的前缀被重新映射             │
  │  其他前缀的路由不变 → 缓存保留               │
  │  理论上只影响 1/N 的前缀                     │
  └─────────────────────────────────────────────┘
```

#### 一致性哈希环示意

```
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
```

#### 核心实现

```python
import bisect
import hashlib

class ConsistentHashRouter:
    def __init__(self, gpu_endpoints: list[str], virtual_nodes: int = 150):
        self.ring: list[tuple[int, str]] = []
        self.virtual_nodes = virtual_nodes
        for endpoint in gpu_endpoints:
            self.add_node(endpoint)
        self.ring.sort(key=lambda x: x[0])
    
    def add_node(self, endpoint: str):
        """添加节点（含虚拟节点），扩容时只影响邻近前缀。"""
        for i in range(self.virtual_nodes):
            h = self._hash(f"{endpoint}:v{i}")
            self.ring.append((h, endpoint))
        self.ring.sort(key=lambda x: x[0])
    
    def remove_node(self, endpoint: str):
        """移除节点（缩容），只有该节点的前缀被重新映射。"""
        self.ring = [(h, ep) for h, ep in self.ring if ep != endpoint]
    
    def route(self, prefix_key: str) -> str:
        """根据前缀键路由到最近的 GPU 节点。"""
        h = self._hash(prefix_key)
        idx = bisect.bisect_left([x[0] for x in self.ring], h)
        if idx >= len(self.ring):
            idx = 0
        return self.ring[idx][1]
    
    def _hash(self, key: str) -> int:
        return int(hashlib.md5(key.encode()).hexdigest(), 16)
```

#### 虚拟节点的作用

| 虚拟节点数 | 负载均衡性 | 节点变更影响 |
|-----------|-----------|-------------|
| 1 | 差（数据集中在少数节点） | 1/N 的前缀 |
| 50 | 中等 | 1/N 的前缀 |
| 150 | 良好（推荐） | 1/N 的前缀，更均匀分布 |
| 500+ | 优秀但内存开销增大 | 1/N 的前缀 |

#### 面试追问

- **虚拟节点数量如何选择**？经验值 100-200。太少则负载不均，太多则查找开销增大（O(log(N×V))）
- **一致性哈希的缺点**？热点前缀仍然集中在少数节点。需要结合负载感知评分机制，在缓存亲和和负载均衡之间动态权衡
- **如何处理节点权重不同（异构 GPU）**？给性能强的节点分配更多虚拟节点

</details>

---

### Q7: 多层缓存架构（GPU/Host/Distributed）是如何工作的？

<details>
<summary>参考答案</summary>

**KV Cache 的多层架构类似 CPU 的 L1/L2/L3 缓存层级——越靠近计算核心速度越快、容量越小。通过分层管理，在有限 GPU 显存下最大化缓存价值。**

#### 生活类比

缓存层级就像**图书馆的借阅体系**：

- **L1（GPU 显存）**：你手边的参考书，翻手可得，但桌子空间有限
- **L2（主机内存）**：当层书架，走几步就能拿到
- **L3（分布式存储）**：总馆或其他分馆，需要调书，较慢但容量大

#### 架构全景

```
┌──────────────────────────────────────────────────────────┐
│                    三层缓存架构                            │
├──────────────────────────────────────────────────────────┤
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
│  │  L3: Distributed  │  (Redis / NVMe)                   │
│  │  (Remote Cache)   │  ← 冷数据，跨节点共享              │
│  └──────────────────┘                                    │
│  ┌──────────────────┐                                    │
│  │  Miss: 重新计算    │  ← 全部未命中 → 完整 Prefill       │
│  │  (Full Prefill)   │     （功能正确，延迟较高）           │
│  └──────────────────┘                                    │
└──────────────────────────────────────────────────────────┘
```

#### 各层参数对比

| 层级 | 存储介质 | 容量 | 延迟 | 带宽 | 适用数据 |
|------|---------|------|------|------|---------|
| L1 | GPU HBM | 10-40 GB | ~0 μs | ~3 TB/s | 活跃请求 + 热门前缀 |
| L2 | CPU DRAM (pinned) | 64-512 GB | ~10 μs | ~32 GB/s (PCIe) | 次热前缀、被 L1 淘汰的数据 |
| L3 | Redis / NVMe | TB 级 | ~1 ms | ~10 GB/s (RDMA) | 跨节点共享、持久化 |
| Miss | 重新计算 | — | ~100-500 ms | — | 完整 Prefill |

#### 层级间数据流动

```
L1 → L2 (Offload):  L1 空间不足时，淘汰到 L2 而非直接丢弃
                     异步 DMA 拷贝，不阻塞推理计算

L2 → L1 (Promote):  请求需要的 prefix 在 L2 中命中
                     延迟 ~10 μs（远低于重新 Prefill 的数百 ms）

L2 ↔ L3 (Remote):   跨节点缓存共享或本地 L2 淘汰
                     适用于热门 System Prompt 的 KV Cache 跨 GPU 共享
```

#### 面试追问

- **L2 offload 的延迟 10 μs vs Prefill 的 100+ ms，值得吗**？绝对值得，加速 10000 倍。关键是 PCIe 传输可以和其他计算 overlap
- **L3 用 Redis 还是 NVMe**？热门前缀用 Redis（低延迟、跨节点）；冷数据用 NVMe（大容量、持久化）。混合使用最佳
- **KV Cache 量化能否扩大 L1 容量**？FP8 量化可将 L1 有效容量翻倍，但需要评估注意力精度影响

</details>

---

### Q8: Prompt 标准化有哪些技术手段？如何提升缓存命中率？

<details>
<summary>参考答案</summary>

**缓存匹配是逐 Token 精确匹配——任何微小差异（末尾空格、换行符不同）都会导致 Token 序列不同进而 cache miss。Prompt 标准化通过消除语义无关的格式差异，将语义相同的 Prompt 映射到相同的 Token 序列。**

#### 问题展示

```
原始 Prompt A: "You are a helpful assistant. "  (末尾有空格)
原始 Prompt B: "You are a helpful assistant."   (末尾无空格)

Token 化后:
A: [2675, 527, 264, 10950, 18328, 13, 220]     ← 多一个空格 Token
B: [2675, 527, 264, 10950, 18328, 13]

→ 完全相同的语义，但 Token 序列不同 → Cache MISS ❌
```

#### 标准化技术清单

| 技术 | 效果 | 命中率提升 |
|------|------|-----------|
| 去除首尾空白 | 消除 trailing space 差异 | +5-10% |
| 合并连续空白 | `"a  b"` → `"a b"` | +3-5% |
| 统一换行符 | `\r\n` → `\n` | +2-3% |
| 固定 Few-shot 顺序 | 排列不同 → 统一排序 | +10-20% |
| 参数分离 | temperature 不参与缓存键 | +5-15% |
| 模板版本化 | 统一模板版本，避免微小修改 | +10-15% |

#### 标准化实现

```python
import re
import json
import hashlib

def normalize_prompt(prompt: str) -> str:
    """消除语义无关差异。"""
    text = prompt.strip()
    text = re.sub(r'\r\n', '\n', text)
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text

def compute_cache_key(messages: list[dict], exclude_last_n: int = 1) -> str:
    """计算缓存键：排除最后 N 条消息（用户新输入）。"""
    prefix_msgs = messages[:-exclude_last_n]
    normalized = [
        {"role": m["role"], "content": normalize_prompt(m["content"])}
        for m in prefix_msgs
    ]
    key_str = json.dumps(normalized, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(key_str.encode()).hexdigest()
```

#### Few-shot 顺序固定

```
❌ 低命中率（每次重组示例顺序）:
请求 1: [System] + [Example B] + [Example A] + [Query]
请求 2: [System] + [Example A] + [Example B] + [Query]
→ 示例顺序不同 → Token 序列不同 → 无法复用

✅ 高命中率（固定示例顺序 + 模板化）:
模板:   [System] + [Example A] + [Example B]  ← 固定前缀
请求 1: [模板] + [Query 1]
请求 2: [模板] + [Query 2]
→ 所有请求共享同一模板前缀 → 高命中率
```

#### 参数分离原则

```python
# 参与缓存键的参数（影响 KV Cache）
cache_key_params = {"messages", "model"}

# 不参与缓存键的参数（只影响解码阶段）
non_cache_params = {
    "temperature", "top_p", "max_tokens",
    "stop", "frequency_penalty", "seed",
}
# temperature 不同但 KV Cache 完全相同 → 不应作为缓存键
```

#### 面试追问

- **标准化会不会改变模型输出**？不会。标准化只针对路由层的缓存键计算，发送给模型的原始 Prompt 不变
- **动态内容（时间戳、用户 ID）如何处理**？将动态部分放在前缀之后，确保前缀是不变的。例如把日期放在 System Prompt 末尾而非开头
- **模板版本管理**？使用版本号（如 `v2.1`）标识模板，版本变更时缓存自然失效

</details>

---

### Q9: LRU 和 Prefix-Aware 淘汰策略的区别是什么？

<details>
<summary>参考答案</summary>

**标准 LRU 按最近访问时间淘汰，但在 KV Cache 场景中会错误淘汰共享前缀——导致依赖该前缀的所有缓存条目连带失效。Prefix-Aware 策略引入引用计数和前缀层级感知，优先淘汰叶子节点而保留高价值的共享前缀。**

#### LRU 的问题

```
标准 LRU 淘汰链:
┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐
│ SP  │→ │ H1  │→ │ H2  │→ │ H3  │→ evict
│共享  │  │独享  │  │独享  │  │独享  │
│前缀  │  │叶子  │  │叶子  │  │叶子  │
└─────┘  └─────┘  └─────┘  └─────┘
   ↑
   如果 SP 长时间没有新请求直接触达，可能被淘汰
   但淘汰 SP 会导致 H1/H2/H3 全部失效！

原因: 虽然 H1/H2/H3 每次命中都隐式使用了 SP，
     但 LRU 只记录"最后直接访问时间"，不感知前缀依赖
```

#### Prefix-Aware 策略

```
优先级规则（从高到低）:
1. ref_count > 0 的块 → 绝不淘汰（正在被活跃请求使用）
2. 共享前缀节点    → 优先保留（被多个叶子引用）
3. 独享叶子节点    → 按 LRU 淘汰
4. 同优先级内      → 按最近访问时间排序
```

#### 实现对比

```python
# ❌ 标准 LRU
def evict_lru(cache):
    victim = min(cache.values(), key=lambda e: e.last_access)
    del cache[victim.key]  # 可能淘汰共享前缀

# ✅ Prefix-Aware LRU
def evict_prefix_aware(cache):
    candidates = [e for e in cache.values() if e.ref_count == 0]
    candidates.sort(key=lambda e: (
        e.is_shared_prefix,   # False 排前面（先淘汰非共享的）
        e.last_access,        # 最早访问排前面
    ))
    del cache[candidates[0].key]  # 优先淘汰独享叶子
```

#### 效果对比

| 场景 | LRU | Prefix-Aware |
|------|-----|-------------|
| 淘汰共享 System Prompt | 可能（若 SP 没被直接访问） | 不会（共享前缀受保护） |
| 淘汰后连带失效 | 所有依赖该前缀的条目失效 | 只淘汰叶子，前缀保留 |
| 缓存有效容量 | 低（频繁重建前缀） | 高（前缀稳定复用） |
| 适用场景 | 通用缓存 | KV Cache（树状前缀结构） |

#### 面试追问

- **如何判断一个块是"共享前缀"**？维护每个块的子节点引用计数，被 2 个以上缓存条目引用的即为共享前缀
- **SGLang 的 RadixAttention 如何做淘汰**？天然支持——Radix Tree 的叶子节点可以独立淘汰，中间节点（共享前缀）只有所有叶子都被淘汰后才会释放
- **实际生产中命中率提升多少**？从 LRU 切换到 Prefix-Aware 通常提升 10-25% 命中率，取决于前缀共享的比例

</details>

---

### Q10: 什么是请求合并（Request Coalescing）？如何实现？

<details>
<summary>参考答案</summary>

**当多个请求同时需要同一个尚未缓存的前缀时，请求合并只执行一次 Prefill 计算，所有等待的请求共享计算结果。这类似于缓存穿透防护中的"singleflight"模式。**

#### 核心原理

```
无合并:
请求 1 (SP=A): ──→ Prefill A ──→ 缓存 A ──→ Decode
请求 2 (SP=A): ──→ Prefill A ──→ 缓存 A ──→ Decode
请求 3 (SP=A): ──→ Prefill A ──→ 缓存 A ──→ Decode
→ 3 次重复的 Prefill 计算（浪费 GPU 算力）

有合并:
请求 1 (SP=A): ──┐
请求 2 (SP=A): ──┼→ Prefill A (1 次) → 缓存 A
请求 3 (SP=A): ──┘                    │
                                 ┌────┼────┐
                                 ▼    ▼    ▼
                              Decode Decode Decode
→ 只需 1 次 Prefill，3 个请求共享结果
```

#### 生活类比

想象一家餐厅：3 个人同时点了同一道菜。厨房不会做 3 份再分别端上来，而是做 1 份大盘、一次出菜分给 3 个人。

#### 实现代码

```python
import asyncio

class PrefillCoalescer:
    """Prefill 请求合并器（Singleflight 模式）。"""
    
    def __init__(self):
        self._inflight: dict[str, asyncio.Future] = {}
        self._lock = asyncio.Lock()
    
    async def get_or_compute(self, prefix_hash: str, compute_fn):
        async with self._lock:
            if prefix_hash in self._inflight:
                # 已有请求在计算 → 等待结果（不重复计算）
                future = self._inflight[prefix_hash]
            else:
                # 首个请求 → 创建 Future 并开始计算
                future = asyncio.get_event_loop().create_future()
                self._inflight[prefix_hash] = future
                asyncio.create_task(
                    self._compute_and_resolve(prefix_hash, compute_fn, future)
                )
        return await future
    
    async def _compute_and_resolve(self, prefix_hash, compute_fn, future):
        try:
            result = await compute_fn()
            future.set_result(result)
        except Exception as e:
            future.set_exception(e)
        finally:
            async with self._lock:
                self._inflight.pop(prefix_hash, None)
```

#### 效果量化

| 场景 | 无合并 | 有合并 | 节省 |
|------|--------|--------|------|
| 突发 10 个相同 SP 请求 | 10 次 Prefill | 1 次 Prefill | 90% GPU 算力 |
| 稳态 100 QPS，10 个 SP | ~100 Prefill/s | ~10 Prefill/s | 90% GPU 算力 |
| 冷启动场景 | 所有请求 miss | 首个 miss，其余等待 | 减少冲击 |

#### 与缓存预热的协作

```
冷启动优化组合:
1. 服务启动 → 缓存预热（warm_up_cache）填充热门前缀
2. 预热未覆盖的前缀 → 请求合并（PrefillCoalescer）避免重复计算
3. 缓存填充完成 → 后续请求直接命中 L1 Cache
```

#### 面试追问

- **合并窗口太大会不会增加延迟**？会。第 2/3 个请求需要等待第 1 个请求的 Prefill 完成。但 Prefill 延迟远低于 3 次 Prefill 的总延迟，是值得的权衡
- **如何处理合并计算失败**？所有等待的 Future 都会收到异常。应该在 fallback 中允许各请求独立重试
- **与 Continuous Batching 的关系**？请求合并发生在缓存层面（避免重复 Prefill），Continuous Batching 发生在推理引擎层面（同一 batch 中的不同请求共享 GPU 计算资源）。两者互补

</details>

---

### Q11: 设计一个面向多租户 LLM 服务的缓存感知调度器

<details>
<summary>参考答案</summary>

**多租户缓存感知调度器需要综合考虑三个维度：缓存亲和性（将相同前缀路由到同一 GPU）、负载均衡（避免热门 SP 导致单 GPU 过载）、和租户隔离（保证 SLA）。核心是设计一个多因子评分函数来选择最优 GPU。**

#### 架构全景

```
┌────────────────────────────────────────────────────────────┐
│                  多租户缓存感知调度器                         │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ┌────────┐    ┌──────────────────────────────────────┐    │
│  │ 请求队列 │──→│       Cache-Aware Scheduler          │    │
│  └────────┘    │                                      │    │
│                │  1. 提取 prefix_key（标准化后哈希）    │    │
│                │  2. 查询各 GPU 缓存状态 + 负载         │    │
│                │  3. 多因子评分 → 选择最优 GPU           │    │
│                │                                      │    │
│                │  评分公式:                             │    │
│                │  score = w₁ × cache_match_ratio       │    │
│                │        + w₂ × (1 - load_ratio)        │    │
│                │        + w₃ × memory_available        │    │
│                │  w₁=0.6, w₂=0.3, w₃=0.1              │    │
│                └──────┬──────┬──────┬─────────────────┘    │
│                       │      │      │                      │
│                  ┌────▼─┐┌───▼──┐┌──▼───┐                  │
│                  │GPU 0 ││GPU 1 ││GPU 2 │                  │
│                  │SP: A ││SP: B ││SP: A │                  │
│                  │load: ││load: ││load: │                  │
│                  │ 60%  ││ 30%  ││ 90%  │                  │
│                  └──────┘└──────┘└──────┘                  │
│                                                            │
│  示例: 请求 SP=A 到达                                       │
│  GPU 0: cache=✓(1.0) load=60%(0.4) → score=0.72           │
│  GPU 1: cache=✗(0.0) load=30%(0.7) → score=0.21           │
│  GPU 2: cache=✓(1.0) load=90%(0.1) → score=0.63           │
│  → 选择 GPU 0（最高分）                                     │
└────────────────────────────────────────────────────────────┘
```

#### 核心实现

```python
from dataclasses import dataclass

@dataclass
class GPUStatus:
    endpoint: str
    cached_prefixes: set[str]
    active_requests: int
    max_requests: int
    free_memory_gb: float
    total_memory_gb: float

class CacheAwareScheduler:
    def __init__(self, w_cache=0.6, w_load=0.3, w_memory=0.1):
        self.w_cache = w_cache
        self.w_load = w_load
        self.w_memory = w_memory
        self.gpu_statuses: dict[str, GPUStatus] = {}
    
    def select_gpu(self, prefix_hash: str) -> str:
        best_score, best_endpoint = -1.0, None
        for endpoint, status in self.gpu_statuses.items():
            score = self._score(status, prefix_hash)
            if score > best_score:
                best_score = score
                best_endpoint = endpoint
        return best_endpoint
    
    def _score(self, status: GPUStatus, prefix_hash: str) -> float:
        cache_hit = 1.0 if prefix_hash in status.cached_prefixes else 0.0
        load_ratio = status.active_requests / status.max_requests
        mem_ratio = status.free_memory_gb / status.total_memory_gb
        return (
            self.w_cache * cache_hit
            + self.w_load * (1.0 - load_ratio)
            + self.w_memory * mem_ratio
        )
```

#### 多租户扩展设计

| 设计要素 | 方案 |
|---------|------|
| **租户隔离** | 每个租户独立的缓存配额，防止大租户挤占小租户 |
| **优先级调度** | VIP 租户的请求评分额外加权（如 w_priority × tier_weight） |
| **热门 SP 副本** | 流量 Top-K 的 System Prompt 推送副本到多个 GPU |
| **冷启动保护** | 新租户首个请求自动触发缓存预热 |
| **GPU 状态同步** | 秒级心跳上报各 GPU 的缓存列表、负载和显存 |

#### 权重动态调整

```python
def adaptive_weights(self, overall_load: float) -> tuple[float, float, float]:
    """根据集群整体负载动态调整权重。"""
    if overall_load < 0.5:
        # 低负载：最大化缓存命中率
        return (0.8, 0.15, 0.05)
    elif overall_load < 0.8:
        # 中等负载：平衡缓存和负载
        return (0.6, 0.3, 0.1)
    else:
        # 高负载：优先保证负载均衡，避免过载
        return (0.3, 0.6, 0.1)
```

#### 面试追问

- **评分函数的权重如何调优**？根据业务目标。延迟敏感型提高 w_cache，吞吐敏感型提高 w_load。建议 A/B 测试对比不同权重配置
- **GPU 状态同步的延迟如何处理**？状态信息有 1-2 秒延迟，可能导致决策基于过时数据。解决方案：乐观调度 + 目标 GPU 的本地拒绝机制（load > 95% 时拒绝并回退）
- **如何避免"羊群效应"**？多个请求同时评分选择同一 GPU → 瞬间过载。添加随机扰动（jitter）或使用 Power of Two Choices 算法

</details>

---

### Q12: GPU 节点故障后如何重建缓存？描述完整恢复流程

<details>
<summary>参考答案</summary>

**KV Cache 是纯计算缓存，Cache miss 只是性能降级而非功能故障。恢复的核心原则是：先保可用性（立即重路由），再恢复性能（渐进式预热）。整个流程分为故障检测 → 流量重路由 → 缓存重建 → 稳态恢复四个阶段。**

#### 核心原则

```
┌──────────────────────────────────────────┐
│  Cache HIT:  快速路径（低延迟）           │
│  Cache MISS: 慢速路径（完整 Prefill）     │
│  两者的最终结果完全相同                   │
└──────────────────────────────────────────┘

这意味着：
✓ 任何缓存节点宕机 → 性能降级，不是功能故障
✓ 缓存全部失效 → 回退到无缓存模式，服务继续可用
✓ 缓存数据损坏 → 丢弃重算，不产生错误结果
```

#### 完整恢复流程

```
阶段 1: 故障检测（秒级）
┌─────┐    heartbeat timeout    ┌──────────┐
│GPU 2│ ─────── ✗ ────────────→│Scheduler │
│ DOWN│                        │标记不可用  │
└─────┘                        └──────────┘

阶段 2: 流量重路由（立即）
原本路由到 GPU 2 的请求 → 重路由到 GPU 0/1/3
这些请求将 cache miss → 执行完整 Prefill
服务可用，但延迟暂时升高（P99 可能从 50ms → 500ms）

阶段 3: 缓存预热（分钟级）
新节点 GPU 2' 加入:
1. 从 L3 分布式缓存加载热门前缀 KV Cache
2. 或通过预热请求重建缓存
3. 调度器逐步将流量切回 GPU 2'

阶段 4: 稳态恢复（分钟级）
GPU 2' 的缓存命中率逐步回升至正常水平
```

#### 三级降级路由实现

```python
class ResilientCacheRouter:
    def __init__(self, primary_router, fallback_router, health_checker):
        self.primary = primary_router
        self.fallback = fallback_router
        self.health = health_checker
    
    async def route(self, request) -> str:
        prefix_hash = compute_cache_key(request.messages)
        
        # Level 1: 缓存感知路由（最优）
        try:
            preferred = self.primary.select_gpu(prefix_hash)
            if self.health.is_healthy(preferred):
                return preferred
        except Exception:
            pass
        
        # Level 2: 同缓存分片的备选节点
        try:
            backup = self.primary.select_gpu_backup(prefix_hash)
            if backup and self.health.is_healthy(backup):
                return backup
        except Exception:
            pass
        
        # Level 3: 任意健康节点（放弃缓存亲和）
        return self.fallback.select_any_healthy()
```

#### 渐进式预热策略

```python
async def graceful_recovery(new_gpu: str):
    # 阶段 1: 从 L3 恢复热门前缀（如果有）
    hot_prefixes = await l3_store.get_hot_prefixes(top_k=20)
    for prefix_hash, kv_data in hot_prefixes:
        await transfer_to_gpu(new_gpu, prefix_hash, kv_data)
    
    # 阶段 2: 预热请求（max_tokens=1，只触发 Prefill）
    for sp in get_hot_system_prompts():
        await client.generate(
            endpoint=new_gpu,
            messages=[{"role": "system", "content": sp},
                      {"role": "user", "content": "hi"}],
            max_tokens=1,
        )
    
    # 阶段 3: 灰度切流（10% → 50% → 100%）
    router.set_weight(new_gpu, weight=0.1)
    await asyncio.sleep(300)  # 观察 5 分钟
    router.set_weight(new_gpu, weight=0.5)
    await asyncio.sleep(300)
    router.set_weight(new_gpu, weight=1.0)
```

#### 与数据库缓存的根本区别

| 维度 | 数据库缓存（Redis + MySQL） | KV Cache |
|------|---------------------------|----------|
| 缓存失效后果 | 可能返回过期数据（一致性问题） | 只是多花计算时间（无一致性问题） |
| 重算成本 | 数据库查询（可能慢但可控） | Prefill 计算（延迟从 0 → 数百 ms） |
| 缓存预热 | 复杂（需要预填充数据） | 简单（发送 max_tokens=1 的请求即可） |
| 容错设计 | 需要防雪崩/穿透/击穿 | 天然容错（miss 只是性能退化） |

#### 面试追问

- **缓存副本（Cache Replication）值不值得**？对 SLA 要求极高的场景值得。每个前缀映射到 primary + secondary 两个 GPU，primary 故障时切到 secondary（已有副本，零预热延迟）
- **故障期间如何控制 Prefill 洪峰**？限流 + 请求合并。对同一前缀的 miss 请求做 coalescing，避免 10 个请求触发 10 次 Prefill
- **跨节点缓存共享用 Push 还是 Pull**？热门前缀用 Push（故障切换快），冷门前缀用 Pull（按需拉取节省带宽）

</details>

---

### Q13: 如何权衡缓存命中率与负载均衡？

<details>
<summary>参考答案</summary>

**纯缓存亲和路由将所有相同前缀请求路由到同一 GPU，命中率最高但可能导致热点过载；纯负载均衡路由将请求均匀分散，负载均衡但命中率约 1/N。最优解是两者的动态权衡：低负载时偏向缓存亲和，高负载时偏向负载均衡。**

#### 矛盾可视化

```
                缓存命中率 ↑
                    │
                    │    ★ 理想点（高命中 + 均衡负载）
                    │   ╱
                    │  ╱
     纯缓存亲和 ──→ ● ╱
     （高命中率     │╱
      高负载倾斜） │╱
                    │─────────────────→ 负载均衡性
                   ╱│
                  ╱ │
                 ╱  │
     纯轮询 ──→ ●   │
     （低命中率     │
      完美均衡）    │
```

#### 三种策略对比

| 策略 | 命中率 | 负载均衡 | 适用场景 |
|------|--------|---------|---------|
| 纯轮询 | ~1/N | 完美 | 无缓存需求 |
| 纯前缀哈希 | ~100% | 可能极度倾斜 | 前缀分布均匀 |
| 加权评分 | 85%+ | 良好 | 生产环境（推荐） |
| 动态自适应 | 70-95% | 自动适应 | 流量模式多变 |

#### 动态自适应策略

```python
class AdaptiveScheduler:
    """根据集群负载动态调整缓存亲和权重。"""
    
    def get_weights(self, cluster_load: float):
        if cluster_load < 0.5:
            # 低负载：最大化缓存命中率
            return {"cache": 0.8, "load": 0.15, "memory": 0.05}
        elif cluster_load < 0.8:
            # 中等负载：平衡
            return {"cache": 0.6, "load": 0.3, "memory": 0.1}
        else:
            # 高负载：优先保证不过载
            return {"cache": 0.3, "load": 0.6, "memory": 0.1}
    
    def select_gpu(self, prefix_hash: str) -> str:
        cluster_load = self._get_cluster_load()
        weights = self.get_weights(cluster_load)
        
        best_score, best_gpu = -1.0, None
        for gpu_id, status in self.gpu_statuses.items():
            score = (
                weights["cache"] * (1.0 if prefix_hash in status.cached else 0.0)
                + weights["load"] * (1.0 - status.load_ratio)
                + weights["memory"] * status.free_mem_ratio
            )
            if score > best_score:
                best_score = score
                best_gpu = gpu_id
        return best_gpu
```

#### 热点前缀的特殊处理

```
问题: 一个 SP 占 80% 流量 → 前缀哈希路由导致一个 GPU 承受 80% 流量

解决方案 — 热点前缀副本:
1. 检测热点: 某前缀的请求率 > 平均值 × 3
2. 推送副本: 将热点 SP 的 KV Cache 复制到 K 个 GPU
3. 分散路由: 对热点 SP 的请求在 K 个 GPU 间轮询

结果: 命中率保持高 + 负载分散到多个 GPU

               热点 SP 副本分布:
               ┌──────┐ ┌──────┐ ┌──────┐
               │GPU 0 │ │GPU 1 │ │GPU 2 │
               │SP=A ✓│ │SP=A ✓│ │SP=A ✓│ ← 副本
               │SP=D  │ │SP=B  │ │SP=C  │ ← 各自独有
               └──────┘ └──────┘ └──────┘
```

#### 面试追问

- **评分函数是否可以用机器学习优化**？可以。将历史调度决策和效果（命中率、延迟、负载方差）作为训练数据，学习最优权重组合
- **如果所有 GPU 负载都在 90%+**？此时应触发自动扩容，新 GPU 加入后先预热再接流量
- **Power of Two Choices 能否应用在这里**？可以。随机选 2 个候选 GPU 评分后选最优的那个，避免所有请求同时选到同一 GPU（减少羊群效应）

</details>

---

### Q14: 多租户 SaaS 场景——每个租户有不同 System Prompt，设计缓存路由策略

<details>
<summary>参考答案</summary>

**这是一道综合场景设计题，需要覆盖路由策略、缓存管理、租户隔离、高可用和监控全链路。**

#### 场景分析

```
假设:
- 100 个租户，每个租户有独立的 System Prompt（平均 2000 tokens）
- 总 QPS = 500，分布不均（Top 10 租户占 70% 流量）
- 4 个 GPU 节点（A100 80GB），每个节点运行 vLLM + APC
- SLA: P99 延迟 < 2 秒，可用性 99.9%
```

#### 整体架构

```
┌────────────────────────────────────────────────────────────┐
│                      API Gateway                            │
│  ① 认证 → ② Prompt 标准化 → ③ 提取 tenant_id + prefix_key │
└────────────────────────┬───────────────────────────────────┘
                         │
┌────────────────────────▼───────────────────────────────────┐
│                Cache-Aware Router                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 1. 一致性哈希: hash(prefix_key) → 候选 GPU           │   │
│  │ 2. 多因子评分: cache_hit × 0.6 + load × 0.3 + ...  │   │
│  │ 3. 热点检测: Top-K SP 自动创建副本                    │   │
│  │ 4. 故障降级: primary → secondary → any_healthy       │   │
│  └─────────────────────────────────────────────────────┘   │
└──────┬──────────┬──────────┬──────────┬────────────────────┘
       │          │          │          │
  ┌────▼───┐ ┌────▼───┐ ┌────▼───┐ ┌────▼───┐
  │ GPU 0  │ │ GPU 1  │ │ GPU 2  │ │ GPU 3  │
  │Tenant: │ │Tenant: │ │Tenant: │ │Tenant: │
  │A,D,G,  │ │B,E,H,  │ │C,F,I,  │ │A,D,J,  │
  │...     │ │...     │ │...     │ │...     │
  └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘
      │          │          │          │
  ┌───▼──────────▼──────────▼──────────▼────┐
  │          L2: Host Memory Pool            │
  └──────────────────┬──────────────────────┘
  ┌──────────────────▼──────────────────────┐
  │        L3: Redis Cluster (跨节点共享)     │
  └─────────────────────────────────────────┘
```

#### 关键设计决策

**1. 路由策略**

```python
class MultiTenantRouter:
    def route(self, tenant_id: str, system_prompt: str) -> str:
        prefix_key = normalize_prompt(system_prompt)
        prefix_hash = hash(prefix_key)
        
        # 热点租户：多副本轮询
        if self.is_hot_tenant(tenant_id):
            replicas = self.get_replicas(prefix_hash, n=3)
            return self.least_loaded(replicas)
        
        # 普通租户：一致性哈希
        return self.consistent_hash.route(prefix_key)
```

**2. 租户隔离**

| 策略 | 实现 |
|------|------|
| 缓存配额 | 每个租户最多占用单 GPU 30% 的缓存空间 |
| 大租户副本 | Top 10 租户的 SP 推送到 2-3 个 GPU |
| 小租户共享 | 小流量租户共享 GPU，按 LRU 自然竞争 |
| QoS 保障 | VIP 租户请求优先调度，评分函数加权 |

**3. 容量规划**

```
单 GPU 显存分配 (80 GB):
  模型权重: 35 GB (70B FP8)
  活跃 KV Cache: 25 GB (~80 并发请求)
  缓存 KV Cache: 20 GB
  
单前缀缓存大小 (2000 tokens, 70B FP16):
  = 2 × 80 × 8 × 128 × 2000 × 2 ≈ 640 MB

每个 GPU 可缓存: 20 GB / 640 MB ≈ 31 个前缀
4 个 GPU 总共: ~124 个前缀（大于 100 个租户，理论上全覆盖）
```

**4. 监控指标**

```yaml
# 按租户粒度监控
- prompt_cache_hit_ratio{tenant_id}      # 每个租户的命中率
- prompt_cache_size_bytes{tenant_id}     # 缓存占用
- prefill_latency_p99{tenant_id}         # Prefill 延迟
- request_rate{tenant_id}               # 请求速率（检测热点）
```

#### 面试追问

- **100 个租户增长到 1000 个怎么办**？L1 缓存容不下所有前缀，此时依赖 L2/L3 层级和智能淘汰。高频租户缓存在 L1，低频租户按需从 L2 promote
- **租户的 System Prompt 频繁变更怎么办**？每次变更后旧缓存自然过期（hash 不同），新缓存自动建立。建议限制变更频率（如每 5 分钟最多变更 1 次）
- **如何处理跨租户的共享前缀**？如果多个租户的 System Prompt 前半部分相同，可以在 Radix Tree 中自然共享。但需要注意隐私隔离

</details>

---

### Q15: 缓存命中率从 85% 骤降到 30%，如何诊断和修复？

<details>
<summary>参考答案</summary>

**缓存命中率骤降是生产环境中的高优告警。诊断需要从流量模式、路由配置、缓存状态和基础设施四个维度排查。核心方法论：先确认影响范围，再逐层排查根因，最后修复并预防。**

#### 诊断框架

```
缓存命中率 85% → 30%

Step 1: 确认影响范围
├── 全局下降 → 基础设施或路由层问题
├── 单 GPU 下降 → 该 GPU 的缓存或负载问题
└── 单租户下降 → 该租户的 Prompt 或流量模式变化

Step 2: 逐层排查
├── 1. 流量模式变化？
├── 2. 路由配置变更？
├── 3. 缓存淘汰压力？
├── 4. 节点故障/扩缩容？
└── 5. Prompt 内容变化？
```

#### 常见根因与诊断方法

| # | 根因 | 症状 | 诊断方法 | 修复方案 |
|---|------|------|---------|---------|
| 1 | 路由配置被改为 Round-Robin | 所有 GPU 命中率同时下降 | 检查 Nginx/路由器配置 | 恢复一致性哈希路由 |
| 2 | GPU 节点扩缩容 | 扩容后命中率短暂下降 | 检查节点变更日志 | 使用一致性哈希 + 缓存预热 |
| 3 | System Prompt 模板更新 | 特定租户命中率下降 | 对比 Prompt 版本 hash | 固定模板版本，渐进式更新 |
| 4 | 缓存显存不足 | 淘汰率指标飙升 | 检查 cache_eviction_total | 扩容 / 启用 L2 offload |
| 5 | 新增大量新租户 | 缓存空间竞争加剧 | 检查 cache_entries_total | 租户配额 + 容量扩容 |
| 6 | Prompt 标准化失效 | 相同语义的 Prompt 路由到不同 GPU | 检查 normalize 逻辑 | 修复标准化 bug |
| 7 | Few-shot 示例顺序随机化 | 相同场景多个缓存键 | 检查 Prompt 构造代码 | 固定示例顺序 |
| 8 | 缓存过期（TTL） | 周期性命中率波动 | 检查缓存过期时间 | 添加 keep-alive 机制 |

#### 诊断流程代码

```python
async def diagnose_cache_drop(metrics_client, config_store):
    """自动化诊断流程。"""
    
    # Step 1: 确认影响范围
    per_gpu_hit_rate = await metrics_client.query(
        'prompt_cache_hit_ratio by (gpu_id)'
    )
    
    all_dropped = all(r < 0.5 for r in per_gpu_hit_rate.values())
    
    if all_dropped:
        # 全局问题 → 检查路由配置
        current_config = await config_store.get("routing_mode")
        if current_config == "round_robin":
            return "根因: 路由模式被改为 round_robin → 恢复 consistent_hash"
        
        # 检查是否有节点变更
        node_changes = await config_store.get_recent_changes("gpu_nodes")
        if node_changes:
            return f"根因: 节点变更 {node_changes} → 触发缓存预热"
    
    # Step 2: 检查淘汰率
    eviction_rate = await metrics_client.query(
        'rate(prompt_cache_eviction_total[5m])'
    )
    if any(r > 100 for r in eviction_rate.values()):
        return "根因: 缓存淘汰率过高 → 缓存容量不足，需扩容或启用 L2"
    
    # Step 3: 检查 Prompt 变更
    prompt_hash_cardinality = await metrics_client.query(
        'count(distinct prefix_hash) by (tenant_id)'
    )
    # 如果某租户的前缀种类突然增多 → Prompt 模板变更或标准化失效
    
    return "需要进一步人工排查"
```

#### 修复后的预防措施

```
┌──────────────────────────────────────────────────────────┐
│                   预防措施清单                             │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  1. 监控告警:                                             │
│     ✅ cache_hit_ratio < 0.5 持续 5 分钟 → P1 告警        │
│     ✅ eviction_rate > 100/s 持续 5 分钟 → P2 告警        │
│     ✅ 路由配置变更 → 自动通知                             │
│                                                          │
│  2. 变更管控:                                             │
│     ✅ 路由配置变更需要审批                                │
│     ✅ System Prompt 变更走灰度发布                        │
│     ✅ GPU 扩缩容前自动预热                                │
│                                                          │
│  3. 自愈机制:                                             │
│     ✅ 命中率下降 → 自动触发热门前缀预热                    │
│     ✅ 节点故障 → 自动降级路由 + 渐进式恢复                 │
│     ✅ 缓存压力 → 自动启用 L2 offload                      │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

#### 面试追问

- **如果命中率下降是因为业务流量模式正常变化（如新活动上线导致大量新 SP）**？不是 bug 而是容量问题。应该提前做容量规划，活动前预热新 SP 的缓存
- **如何做到秒级诊断**？预置诊断 Runbook + 自动化脚本。关键指标（命中率、淘汰率、节点变更、Prompt 变更）全部打入 Dashboard，告警触发时自动执行诊断流程
- **命中率下降但延迟没有明显上升是什么情况**？可能 Prompt 较短（Prefill 耗时本身就小），或者 GPU 负载很低（充足算力吸收了额外 Prefill）。虽然延迟没变，但 GPU 利用率上升了

</details>
