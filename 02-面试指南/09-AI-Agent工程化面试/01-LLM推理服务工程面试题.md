# LLM 推理服务工程面试题

> 覆盖 vLLM、SGLang、TensorRT-LLM 等推理引擎的架构设计、性能优化与生产部署面试题

## 相关链接

- 对应技术资料：[LLM推理服务工程](../../01-技术资料/09-AI-Agent工程化/01-LLM推理服务工程.md)

## 题目列表

| 题号 | 题目 | 难度 |
|------|------|------|
| Q1 | 解释 KV Cache 的原理，为什么它对 LLM 推理如此重要？ | ⭐ 基础 |
| Q2 | 什么是 PagedAttention？它解决了什么问题？ | ⭐ 基础 |
| Q3 | Continuous Batching 和 Static Batching 的区别是什么？ | ⭐ 基础 |
| Q4 | 比较 Tensor Parallelism 和 Pipeline Parallelism 的适用场景 | ⭐⭐ 进阶 |
| Q5 | RadixAttention 的工作原理是什么？在什么场景下优势明显？ | ⭐⭐ 进阶 |
| Q6 | 解释 Chunked Prefill 技术及其对延迟的影响 | ⭐⭐ 进阶 |
| Q7 | 比较 FP8、AWQ、GPTQ、GGUF 量化方案的优劣和适用场景 | ⭐⭐ 进阶 |
| Q8 | vLLM V1 的多进程架构设计有什么优势？ | ⭐⭐ 进阶 |
| Q9 | 如何在 Kubernetes 上部署 vLLM 并实现自动扩缩容？ | ⭐⭐ 进阶 |
| Q10 | 什么是 Speculative Decoding？它如何加速推理？ | ⭐⭐ 进阶 |
| Q11 | 设计一个支持 Prefill-Decode 分离的推理集群架构 | ⭐⭐⭐ 高阶 |
| Q12 | 如何为一个日活 10 万用户的 AI 应用选择推理引擎？请给出选型决策过程 | ⭐⭐⭐ 高阶 |
| Q13 | KV Cache 使用率达到 90% 后会发生什么？如何排查和解决？ | ⭐⭐⭐ 高阶 |
| Q14 | 比较 vLLM 和 SGLang 在共享前缀场景下的性能差异及原因 | ⭐⭐⭐ 高阶 |
| Q15 | 解释 MLA（Multi-Latent Attention）如何压缩 KV Cache | ⭐⭐⭐ 高阶 |

## 🔥 高频考点速记

| # | 考点 | 核心要点 | 出题概率 |
|---|------|---------|---------|
| 1 | PagedAttention | OS 虚拟内存分页思想 → KV Cache 按 Block 管理 → 内存利用率 95%+ | ★★★★★ |
| 2 | Continuous Batching | 请求随到随处理 → 吞吐量提升 10-20x → iteration 级调度 | ★★★★★ |
| 3 | 量化技术选型 | FP8(H100) / AWQ(在线) / GGUF(CPU) → 精度-速度-硬件三角 | ★★★★☆ |
| 4 | 分布式推理 | TP(层内/同节点) / PP(层间/跨节点) / EP(MoE专家并行) | ★★★★☆ |
| 5 | 推理引擎选型 | vLLM(通用) / SGLang(多轮) / TRT-LLM(极致) / llama.cpp(边缘) | ★★★★☆ |

## 参考答案

### Q1: KV Cache 的原理

<details>
<summary>参考答案</summary>

**KV Cache 是用显存换计算的优化——缓存已计算的 Key/Value 矩阵，避免自回归生成中的重复计算。**

#### 生活类比

想象你在写一篇文章，每写一个新字都要把前面所有内容重读一遍。KV Cache 就像你的工作记忆——把已读内容的笔记存起来，写新字时只需翻笔记，不用重新通读全文。

#### 技术原理

在 Transformer 自回归解码中，生成第 t 个 token 时需要计算：

```
Attention(Q_t, K_{1:t}, V_{1:t}) = softmax(Q_t · K_{1:t}^T / √d_k) · V_{1:t}
```

**不用 KV Cache**：每生成一个新 token，重新计算前面所有 token 的 K 和 V。生成 n 个 token 的总计算量为 O(n² · d)。

**用 KV Cache**：将之前计算过的 K、V 向量缓存起来，新 token 只需计算自己的 Q、K、V 并拼接到缓存中。总计算量降为 O(n · d)。

#### KV Cache 显存占用公式

```
KV Cache = 2 × num_layers × num_kv_heads × head_dim × seq_len × batch_size × dtype_size
```

实际数据（单请求、4K 上下文、FP16）：

| 模型 | 层数 | KV Heads | Head Dim | 单请求 KV Cache |
|------|------|----------|----------|----------------|
| LLaMA-3-8B | 32 | 8 (GQA) | 128 | ~256 MB |
| LLaMA-3-70B | 80 | 8 (GQA) | 128 | ~640 MB |
| LLaMA-3-405B | 126 | 8 (GQA) | 128 | ~1 GB |

> GQA（Grouped-Query Attention）将 KV heads 从 64 减少到 8，KV Cache 减少 8 倍。这是现代大模型标配。

#### 在主流引擎中的实现

| 引擎 | KV Cache 管理策略 |
|------|------------------|
| vLLM | PagedAttention，按 Block 分页管理 |
| SGLang | RadixAttention，前缀树复用 |
| TensorRT-LLM | 分页 KV Cache + FP8 量化 |
| llama.cpp | 连续内存，支持 KV Cache 量化到 Q4/Q8 |

#### 面试追问

- **KV Cache 的显存瓶颈**：70B 模型同时服务 100 个 4K 请求，KV Cache 需要 ~64 GB，可能超过模型权重本身
- **KV Cache 量化**：FP8 量化可减少 50% 显存，INT4 量化减少 75%，但需评估精度影响
- **GQA/MQA 的影响**：MQA（1 个 KV head）比 MHA 减少 N 倍 KV Cache，GQA 是折中方案

</details>

---

### Q2: PagedAttention 原理

<details>
<summary>参考答案</summary>

**PagedAttention 借鉴操作系统虚拟内存分页思想，将 KV Cache 按 Block 管理，消除显存碎片化。**

#### 传统方式的问题

```
❌ 传统连续内存分配：
请求A [██████░░░░░░]  ← 预分配 max_len=2048，实际只用了 100 tokens
请求B [████████░░░░]  ← 60-80% 显存浪费
请求C [██░░░░░░░░░░]  ← 短请求浪费更严重

内部碎片：实际长度 < 预分配长度
外部碎片：请求结束后留下不连续空洞
```

#### PagedAttention 核心机制

```
✅ 分页管理（类比操作系统）：
物理 Block 池：[B0][B1][B2][B3][B4][B5][B6][B7]...

请求A 页表：逻辑块0→B2, 逻辑块1→B5
请求B 页表：逻辑块0→B0, 逻辑块1→B3, 逻辑块2→B7

每个 Block 存储 block_size（默认16）个 token 的 KV 数据
```

关键数据结构：

```python
class PhysicalBlock:
    block_id: int       # 物理块编号
    ref_count: int      # 引用计数（支持 CoW）
    data: Tensor        # [block_size, num_heads, head_dim]

class BlockTable:
    # 逻辑块号 → 物理块号的映射（类似 OS 页表）
    mapping: Dict[int, int]
```

#### 三大优势

1. **消除内部碎片**：按需分配 Block，不预留空间
2. **消除外部碎片**：Block 固定大小，不存在不规则空洞
3. **Copy-on-Write**：Beam Search / 并行采样时共享前缀的物理块，只在分叉时复制

**关键数据**：内存利用率从 20-40% 提升到 95%+，等效支持 2-4 倍并发请求。

#### 面试追问

- **block_size 如何选择**？太小（1）→ 寻址开销大；太大（256）→ 内部碎片回来。vLLM 默认 16
- **与 Prefix Caching 的关系**？相同前缀的请求可以共享物理 Block，通过 hash(block_content) 去重

</details>

---

### Q3: Continuous Batching vs Static Batching

<details>
<summary>参考答案</summary>

**Continuous Batching 在 iteration 级别动态调度请求，不等待最慢的请求完成，吞吐量提升 10-20 倍。**

#### Static Batching 的浪费

```
Static Batching（等待最慢的请求完成整个 batch 才处理新请求）：

时间 →  t1  t2  t3  t4  t5  t6  t7  t8  t9  t10
请求A  [██████████]                              ← 生成 10 tokens
请求B  [████░░░░░░]                              ← 生成 4 tokens，pad 6 轮
请求C  [██░░░░░░░░]                              ← 生成 2 tokens，pad 8 轮
                                                   GPU 利用率仅 ~53%
```

#### Continuous Batching

```
时间 →  t1  t2  t3  t4  t5  t6  t7  t8  t9  t10
请求A  [██████████]
请求B  [████]
请求C  [██]
请求D       [████████]                           ← B/C 完成后立即加入
请求E            [██████]                        ← 空位随时填充
                                                   GPU 利用率接近 100%
```

#### vLLM 调度器实现

```
Waiting Queue → [新请求入队]
       ↓
Scheduler (每次 iteration):
  1. 从 waiting queue 取请求加入 running batch
  2. 检查 running batch 中已完成的请求，移出释放资源
  3. 如果显存不足，执行 preemption（换出优先级低的请求）
       ↓
Running Batch → [本轮推理的请求集合]
```

#### 关键对比

| 维度 | Static Batching | Continuous Batching |
|------|----------------|-------------------|
| 调度粒度 | Batch 级 | Iteration 级 |
| GPU 利用率 | 30-50% | 90%+ |
| 吞吐量 | 基准 | 10-20x 提升 |
| 请求延迟 | 等 batch 凑满或超时 | 随到随处理 |
| 实现复杂度 | 简单 | 需要精细调度器 |

#### 面试追问

- **Preemption 策略**：显存不够时 swap 到 CPU 内存或直接 recompute？vLLM 支持两种
- **与 Chunked Prefill 的协同**：长 prompt 的 prefill 不会阻塞整个 batch

</details>

---

### Q4: Tensor Parallelism vs Pipeline Parallelism

<details>
<summary>参考答案</summary>

**TP 切层内（同节点、低延迟），PP 切层间（跨节点、高吞吐），EP 切专家（MoE 模型专用）。**

#### 核心区别

```
Tensor Parallelism（层内切分）：
Layer 1: [GPU0: 前半列] [GPU1: 后半列] → AllReduce → 合并输出
Layer 2: [GPU0: 前半列] [GPU1: 后半列] → AllReduce → 合并输出
每一层都需要 GPU 间通信

Pipeline Parallelism（层间切分）：
GPU0: Layer 1-20   →  GPU1: Layer 21-40  →  GPU2: Layer 41-60  →  GPU3: Layer 61-80
每一层只需在切分点做一次通信
```

#### 详细对比

| 维度 | Tensor Parallelism | Pipeline Parallelism |
|------|-------------------|---------------------|
| 切分方式 | 权重矩阵按列/行切分 | 模型按层切分 |
| 通信频率 | 每层 2 次 AllReduce | 仅在 stage 边界通信 |
| 通信量 | 大（激活值） | 小（隐藏状态） |
| 网络要求 | NVLink（400+ GB/s） | InfiniBand 即可 |
| 延迟影响 | 较低（并行计算） | Pipeline bubble 问题 |
| 适用场景 | 同节点多 GPU | 跨节点大模型 |

#### Expert Parallelism（MoE 模型）

MoE 模型（如 Mixtral 8x22B、DeepSeek-V3）的专家模块可按专家切分到不同 GPU：

```
Token → Router → Expert 0 (GPU0)
              → Expert 1 (GPU1)
              → Expert 2 (GPU2)
              ...
```

#### 生产推荐

```
单机 8×H100 部署 70B 模型: TP=8
2 节点 16×H100 部署 405B 模型: TP=8, PP=2
MoE 模型 (DeepSeek-V3): TP=8, EP=按专家分布
```

#### 面试追问

- **Pipeline Bubble 如何缓解**？用 micro-batch 填充空闲 stage
- **TP 的 AllReduce 开销**：NVLink 下 ~10μs，InfiniBand 下 ~100μs，决定了 TP 只适合同节点

</details>

---

### Q5: RadixAttention 工作原理

<details>
<summary>参考答案</summary>

**RadixAttention 是 SGLang 的核心优化，用基数树（Radix Tree）管理 KV Cache 前缀，实现跨请求复用。**

#### 类比理解

想象一本字典：以"pre"开头的单词（predict、preview、prefix）共享前三个字母的索引页。RadixAttention 就是 KV Cache 的字典——共享 system prompt 和公共前缀的请求不用重复计算。

#### 工作原理

```
Radix Tree 结构：
                    [system prompt KV]
                   /                   \
     [user: "翻译这段话"]         [user: "总结这篇文章"]
      /            \                    |
 [assistant:      [assistant:     [assistant:
  "翻译A"]         "翻译B"]        "总结A"]
```

所有请求共享 system prompt 的 KV Cache，相同前缀的多轮对话进一步复用。

#### vs vLLM 的 Prefix Caching

| 维度 | vLLM Prefix Caching | SGLang RadixAttention |
|------|---------------------|----------------------|
| 数据结构 | Hash Map（block hash） | Radix Tree（前缀树） |
| 匹配粒度 | Block 级别 | Token 级别 |
| 驱逐策略 | LRU per block | LRU per tree node |
| 多轮对话 | 每轮重新匹配 | 增量扩展树 |
| 优势场景 | 通用 | 多轮对话、共享前缀 |

#### 性能数据

- 多轮对话场景：SGLang 比 vLLM 快 3-5 倍（前缀复用率高）
- System Prompt 共享：节省 50-90% 的 Prefill 计算
- 批量处理相似请求：共享前缀越长，加速越明显

#### 面试追问

- **LRU 驱逐的粒度**？树节点级别，叶子节点最先被驱逐
- **内存开销**？Radix Tree 的元数据开销很小（指针 + 引用计数），远小于 KV Cache 本身

</details>

---

### Q6: Chunked Prefill 技术

<details>
<summary>参考答案</summary>

**Chunked Prefill 将长 Prompt 的 Prefill 阶段分块执行，避免阻塞 Decode 请求，显著降低 TTFT。**

#### 问题背景

```
❌ 不分块：一个 8K token 的 Prefill 占用 GPU 数秒
时间 →  |====== 8K Prefill ======|  Decode...
         其他 Decode 请求全部等待    延迟飙升

✅ Chunked Prefill：分成 512 token 的块交替执行
时间 →  |P1|D|P2|D|P3|D|...
         Prefill 和 Decode 交替    Decode 延迟稳定
```

#### 实现机制

1. 将长 Prompt 按 chunk_size（如 512 tokens）分块
2. 每次 iteration 处理一个 Prefill 块 + 当前所有 Decode 请求
3. Prefill 分多次完成，但 Decode 不被阻塞

#### 性能影响

| 指标 | 无 Chunked Prefill | 有 Chunked Prefill |
|------|-------------------|-------------------|
| 长 Prompt TTFT | 低（一次算完） | 略高（分多次） |
| Decode 延迟抖动 | 严重（被 Prefill 阻塞） | 平稳 |
| 整体吞吐量 | 较低 | 提升 10-30% |
| P99 延迟 | 高 | 显著降低 |

#### 面试追问

- **chunk_size 如何选择**？太小→Prefill 效率低；太大→回到阻塞问题。通常 256-1024
- **在 vLLM 中如何启用**？`--enable-chunked-prefill --max-num-batched-tokens 2048`

</details>

---

### Q7: 量化方案对比

<details>
<summary>参考答案</summary>

**量化是精度-速度-硬件的三角权衡。FP8 是 H100 首选，AWQ 适合在线服务，GGUF 适合 CPU/Mac 推理。**

#### 对比表

| 方案 | 精度 | 压缩率 | 速度 | 硬件要求 | 适用场景 |
|------|------|--------|------|---------|---------|
| FP8 (E4M3) | 最高 | 2x | 最快 | H100/H200 | 生产首选（新硬件） |
| AWQ | 高 | 4x | 快 | 任何 GPU | 在线服务（通用） |
| GPTQ | 中高 | 4x | 快 | 任何 GPU | 离线批处理 |
| GGUF (Q4_K_M) | 中 | 4-8x | 中 | CPU/Mac | 本地开发、边缘部署 |
| SmoothQuant | 高 | 2x | 快 | 任何 GPU | W8A8 权重+激活量化 |

#### 量化原理简述

```
FP8：直接用 8-bit 浮点数，H100 硬件原生支持 FP8 矩阵乘法
AWQ：Activation-aware Weight Quantization，保护重要权重通道不量化
GPTQ：逐层校准量化，最小化量化误差
GGUF：CPU-optimized 格式，支持混合精度（重要层 FP16，其他 Q4）
```

#### 选型决策树

```
有 H100/H200？ → FP8（零精度损失，2x 加速）
需要在线低延迟？ → AWQ（精度好，速度快）
大量离线处理？ → GPTQ（batch 处理效率高）
CPU/Mac 本地？ → GGUF Q4_K_M（最好的 CPU 体验）
极致压缩需求？ → GGUF Q2_K（有精度损失但模型很小）
```

#### 面试追问

- **FP8 为什么精度几乎无损**？因为 LLM 权重分布集中，8-bit 浮点足够表示
- **AWQ 的"重要通道"如何确定**？用校准数据集统计每个通道的激活值方差

</details>

---

### Q8: vLLM V1 多进程架构

<details>
<summary>参考答案</summary>

**vLLM V1 将 Scheduler 和 Worker 分为独立进程，Scheduler 通过 ZeroMQ 与 Worker 通信，实现更好的解耦和扩展性。**

#### V0 vs V1 架构

```
V0 架构（单进程）：
[API Server] → [Scheduler + Worker（同一进程）]
问题：Python GIL 限制、调度和推理耦合、难以扩展

V1 架构（多进程）：
[API Server] → ZMQ → [Scheduler Process] → ZMQ → [Worker Process(es)]
                            ↓                          ↓
                      纯 Python 调度             GPU 推理计算
```

#### 核心优势

1. **消除 GIL 瓶颈**：调度逻辑和 GPU 计算在不同进程，不互相阻塞
2. **灵活扩展**：多个 Worker 进程各管一个 GPU（TP 场景）
3. **容错性**：Worker 崩溃不影响 Scheduler，可重启恢复
4. **异步通信**：ZeroMQ 高性能 IPC，调度决策和推理执行流水线化

#### 面试追问

- **ZeroMQ 为什么比 gRPC 更适合这里**？进程间通信更低延迟、更轻量
- **与 SGLang 架构的区别**？SGLang 用 Data Parallelism + RadixAttention，vLLM 更强调 TP

</details>

---

### Q9: Kubernetes 部署 vLLM 并实现自动扩缩容

<details>
<summary>参考答案</summary>

**核心是 GPU 调度 + HPA 自定义指标 + 优雅关闭。**

#### 部署架构

```
                  ┌─────────────┐
                  │  Ingress /  │
                  │  API Gateway│
                  └──────┬──────┘
                         ↓
              ┌─────────────────┐
              │  Service (LB)   │
              └────┬───────┬────┘
                   ↓       ↓
            ┌──────────┐ ┌──────────┐
            │ vLLM Pod │ │ vLLM Pod │  ← HPA 管理副本数
            │ (1xH100) │ │ (1xH100) │
            └──────────┘ └──────────┘
```

#### 关键配置

```yaml
# Deployment 关键字段
resources:
  limits:
    nvidia.com/gpu: 1        # 每 Pod 1 个 GPU
    memory: "80Gi"
  requests:
    nvidia.com/gpu: 1
tolerations:
  - key: nvidia.com/gpu      # GPU 节点调度
    operator: Exists

# HPA 自定义指标
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
spec:
  minReplicas: 1
  maxReplicas: 8
  metrics:
    - type: Pods
      pods:
        metric:
          name: vllm_pending_requests  # 排队请求数
        target:
          type: AverageValue
          averageValue: "5"            # 平均排队超过5个就扩容
```

#### 自动扩缩容指标选择

| 指标 | 优势 | 劣势 |
|------|------|------|
| GPU 利用率 | 直观 | LLM 推理天然高利用率，不灵敏 |
| 排队请求数 | 直接反映负载 | 需要 vLLM 暴露 metrics |
| TTFT P95 | 反映用户体验 | 滞后指标，扩容不及时 |
| KV Cache 使用率 | 反映显存压力 | 与并发直接相关 |

**推荐**：pending_requests 作为主指标，KV Cache 使用率作为辅助指标。

#### 优雅关闭

```yaml
terminationGracePeriodSeconds: 120  # 给足时间完成当前推理
lifecycle:
  preStop:
    exec:
      command: ["/bin/sh", "-c", "sleep 30"]  # 等待当前请求完成
```

#### 面试追问

- **冷启动问题**：70B 模型加载需要 60-90 秒，可用 KEDA + 预热 Pod 缓解
- **多 GPU TP 部署**：需要 Pod 内多 GPU + shared memory 配置

</details>

---

### Q10: Speculative Decoding

<details>
<summary>参考答案</summary>

**用小模型快速"猜"多个 token，大模型一次性验证，在不改变输出分布的前提下加速 2-3 倍。**

#### 类比

老板（大模型）审批文件很慢。助理（小模型）先快速起草 5 个审批意见，老板一次性检查：对的就通过，错的从该处重新来。整体效率提升。

#### 工作流程

```
1. Draft 阶段：小模型（如 1B）快速生成 K 个候选 token
   [小模型] → token1, token2, token3, token4, token5

2. Verify 阶段：大模型（如 70B）一次前向传播验证所有候选
   [大模型] → 验证 token1✓, token2✓, token3✓, token4✗
   
3. 接受：前 3 个 token 正确，直接采用
4. 拒绝：token4 错误，从该位置用大模型重新采样
5. 结果：一次大模型前向传播产出 3+ 个 token（而非 1 个）
```

#### 关键性质

- **无损加速**：通过拒绝采样（rejection sampling）保证输出分布与纯大模型完全一致
- **加速比 = 1 / (1 - acceptance_rate^K)**：acceptance rate 越高、K 越大，加速越多
- **典型加速**：代码生成（高 acceptance rate）2-3 倍；创意写作（低 acceptance rate）1.5 倍

#### 面试追问

- **小模型如何选择**？同系列小模型（70B→8B）效果最好，acceptance rate 可达 70-80%
- **与 Medusa 的区别**？Medusa 不用独立小模型，而是在大模型上加多个预测头并行猜测

</details>

---

### Q11: Prefill-Decode 分离架构

<details>
<summary>参考答案</summary>

**将 Prefill（计算密集）和 Decode（内存密集）分离到不同硬件集群，各自优化，成本降低 30-50%。**

#### 为什么分离

```
Prefill 阶段：处理输入 Prompt（如 4K tokens）
  - 特点：大量矩阵乘法，计算密集型
  - 瓶颈：GPU FLOPS（算力）
  - 适合硬件：高算力 GPU（H100 SXM）

Decode 阶段：逐 Token 生成
  - 特点：频繁访问 KV Cache，内存密集型
  - 瓶颈：Memory Bandwidth（显存带宽）
  - 适合硬件：高带宽 GPU（L40S、A10G）
```

#### 架构设计

```
                    ┌──────────────┐
                    │  调度器       │
                    │ (请求路由)    │
                    └──┬────────┬──┘
                       ↓        ↓
              ┌──────────┐  ┌──────────┐
              │ Prefill  │  │ Decode   │
              │ 集群     │  │ 集群     │
              │ 4×H100   │  │ 16×L40S │
              │ SXM      │  │          │
              └────┬─────┘  └────┬─────┘
                   │  KV Cache   │
                   │  Transfer   │
                   └──────→──────┘
                   (RDMA/NVLink)
```

#### 实际案例

| 系统 | 来源 | 核心创新 |
|------|------|---------|
| Mooncake | 字节跳动 | KV Cache 中心化存储 + 调度 |
| DistServe | UC Berkeley | Prefill-Decode 分离 + 资源优化 |
| Splitwise | Microsoft | 异构硬件混合调度 |
| SGLang PD | SGLang 社区 | 内置 PD 分离支持 |

#### 成本分析

```
混合部署（8×H100）：
  Prefill 利用 H100 算力的 80%
  Decode 只利用 H100 算力的 20%（浪费带宽优势）
  月成本：$80,000

分离部署（2×H100 Prefill + 12×L40S Decode）：
  Prefill 充分利用 H100 算力
  Decode 充分利用 L40S 带宽
  月成本：$45,000（节省 44%）
```

#### 工程挑战

1. **KV Cache 传输**：70B 模型单请求 4K 上下文约 640MB，需要高速网络
2. **调度算法**：如何分配 Prefill 和 Decode 的 GPU 比例
3. **故障切换**：Prefill 节点故障时 Decode 节点能否 fallback
4. **延迟增加**：KV Cache 传输引入额外延迟（通常 10-50ms）

</details>

---

### Q12: 推理引擎选型决策

<details>
<summary>参考答案</summary>

**选型四步法：明确需求 → 评估约束 → 对比方案 → POC 验证。**

#### 需求分析（日活 10 万用户 AI 应用）

```
日活 10 万 → 峰值 QPS 约 50-100
平均请求：输入 500 tokens，输出 200 tokens
延迟要求：TTFT < 500ms，TPS > 30 tokens/s
预算限制：月度 GPU 成本 < $30,000
安全要求：代码不出企业网络（需自托管）
```

#### 引擎对比

| 维度 | vLLM | SGLang | TensorRT-LLM | llama.cpp |
|------|------|--------|--------------|-----------|
| 吞吐量 | ★★★★ | ★★★★★ | ★★★★★ | ★★ |
| 延迟 | ★★★★ | ★★★★ | ★★★★★ | ★★★ |
| 易用性 | ★★★★★ | ★★★★ | ★★ | ★★★★ |
| 模型支持 | ★★★★★ | ★★★★ | ★★★ | ★★★★ |
| 多轮对话 | ★★★ | ★★★★★ | ★★★ | ★★ |
| 社区生态 | ★★★★★ | ★★★★ | ★★★ | ★★★★ |

#### 选型决策树

```
需要极致性能 + 有 NVIDIA 专家？ → TensorRT-LLM
多轮对话为主 + 共享前缀多？ → SGLang
通用场景 + 快速上手？ → vLLM
CPU/Mac 本地部署？ → llama.cpp
边缘设备 + 小模型？ → llama.cpp / MLC-LLM
```

#### 本场景推荐

**vLLM**，理由：
1. OpenAI 兼容 API，前端无缝对接
2. 社区最活跃，模型支持最全
3. 容器化部署成熟，K8s 友好
4. 2×H100 即可满足 QPS 100 的需求

</details>

---

### Q13: KV Cache 使用率 90% 排查

<details>
<summary>参考答案</summary>

**KV Cache 高水位会导致请求排队甚至 OOM。排查路径：确认指标 → 分析原因 → 紧急扩容 → 长期优化。**

#### 会发生什么

```
KV Cache 使用率 90%+ 时：
1. 新请求无法分配 KV Block → 进入等待队列
2. 等待队列积压 → TTFT 飙升（从 200ms 到 5-10s）
3. 如果持续增长到 100% → 触发 preemption（换出部分请求）
4. 极端情况 → OOM 崩溃
```

#### 排查步骤

1. **确认指标**：Prometheus 查看 `vllm:kv_cache_usage_percent` 趋势
2. **分析原因**：
   - 流量突增？查看 QPS 和 pending_requests 指标
   - 请求变长？查看平均 prompt/completion 长度
   - 模型配置变化？max_model_len 或 block_size 调整
   - 并发连接泄漏？客户端未正确断开 SSE 连接
3. **紧急恢复**：
   - 启用限流保护（拒绝新请求优于全部超时）
   - Fallback 到云端 API
   - 扩容推理实例
4. **长期优化**：
   - 开启 KV Cache 量化（FP8 节省 50% 显存）
   - 开启 Prefix Caching 减少重复 KV
   - 设置合理的 max_model_len（不要远超实际需求）
   - 配置 HPA 基于 KV Cache 使用率自动扩容

</details>

---

### Q14: vLLM vs SGLang 共享前缀场景

<details>
<summary>参考答案</summary>

**SGLang 的 RadixAttention 在共享前缀场景下比 vLLM 快 3-5 倍，因为前缀树结构天然适合增量复用。**

#### 场景描述

多轮对话中，每轮都包含相同的 system prompt + 历史对话前缀。

```
第1轮: [system prompt] + [user: "你好"]
第2轮: [system prompt] + [user: "你好"] + [AI: "..."] + [user: "继续"]
第3轮: [system prompt] + [user: "你好"] + [AI: "..."] + [user: "继续"] + [AI: "..."] + [user: "详细说"]
```

#### vLLM 的方式（Hash-based Prefix Caching）

```
每轮请求：
1. 计算每个 block 的 hash
2. 查找 hash table 是否有匹配的物理块
3. 匹配的块直接复用，不匹配的重新计算

优点：简单、通用
缺点：以 block（16 tokens）为粒度，不完整的 block 无法复用
```

#### SGLang 的方式（RadixAttention）

```
Radix Tree 增量扩展：
第1轮后: root → [system+user1 KV]
第2轮后: root → [system+user1 KV] → [AI1+user2 KV]
第3轮后: root → [system+user1 KV] → [AI1+user2 KV] → [AI2+user3 KV]

每轮只需计算新增部分，前缀自动复用
```

#### 性能差异

| 场景 | vLLM | SGLang | SGLang 优势 |
|------|------|--------|------------|
| 单轮对话（无共享前缀） | 基准 | 基准 | 无明显差异 |
| 多轮对话（10 轮）| 1x | 3-5x | 前缀自动增量复用 |
| 批量相似请求 | 1x | 2-3x | 公共前缀高效共享 |
| Few-shot（长共享前缀） | 1x | 4-6x | 长前缀复用收益最大 |

#### 面试追问

- **那为什么不全用 SGLang**？vLLM 生态更成熟、模型支持更全、社区更活跃
- **vLLM 在改进吗**？是的，vLLM 也在增强 prefix caching，但架构差异决定了 SGLang 在这个场景天然更优

</details>

---

### Q15: MLA（Multi-Latent Attention）压缩 KV Cache

<details>
<summary>参考答案</summary>

**MLA 是 DeepSeek-V2 提出的注意力机制，用低秩压缩将 KV Cache 缩小 5-10 倍，以少量额外计算换取大幅显存节省。**

#### 核心思想

标准 MHA（Multi-Head Attention）：每个 head 独立存储完整的 K、V 向量。
MLA：将所有 head 的 KV 投影到一个低维潜在空间（latent space），只缓存压缩后的向量。

```
标准 MHA：
  KV Cache = num_heads × head_dim × 2 × seq_len
  例如：64 heads × 128 dim = 8192 维 KV 向量

MLA：
  KV Cache = latent_dim × seq_len
  例如：512 维 latent 向量（压缩 16 倍）
  推理时：latent → 上投影回 KV → 做 Attention
```

#### 压缩公式

```
编码（存储时）：
  c_t = W_DKV · [k_t; v_t]    # 压缩到低维 latent

解码（推理时）：
  k_t = W_UK · c_t             # 上投影恢复 K
  v_t = W_UV · c_t             # 上投影恢复 V
```

#### KV Cache 对比

| 方案 | 每 token KV 大小 | 相对于 MHA |
|------|-----------------|-----------|
| MHA (64 heads) | 16384 bytes (FP16) | 1x |
| GQA (8 groups) | 2048 bytes | 0.125x |
| MQA (1 head) | 256 bytes | 0.016x |
| MLA (latent 512) | 1024 bytes | 0.063x |

#### MLA 的优势

1. **大幅压缩 KV Cache**：5-10 倍压缩，同等显存支持更多并发
2. **保持模型质量**：低秩近似的信息损失可通过训练补偿
3. **DeepSeek-V2/V3 实证**：在保持 GPT-4 级别质量的同时，推理效率远超同规模模型

#### 面试追问

- **MLA vs GQA 哪个更好**？MLA 压缩更激进但需要额外计算（上投影），GQA 更简单；目前 GQA 是主流，MLA 是 DeepSeek 独创
- **额外计算开销**？上投影是小矩阵乘法，相比 Attention 本身开销很小（约 5-10%）

</details>
