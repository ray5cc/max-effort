# vLLM 常见面试题库

> 涵盖 vLLM 核心原理、系统设计和工程实践的 30 道面试题，从基础概念到深度原理，适合中高级工程师备考。

## 相关链接

- 项目综述：[00-项目综述与技术原理.md](./00-项目综述与技术原理.md)
- 架构详解：[01-架构详解与核心组件.md](./01-架构详解与核心组件.md)
- 生产实践：[02-生产应用与工程实践.md](./02-生产应用与工程实践.md)

---

## 基础概念（Q1-Q8）

### Q1：什么是 vLLM？它解决了什么核心问题？

**答：**

vLLM（由 UC Berkeley 开发，SOSP 2023）是一个高吞吐量、低延迟的 LLM 推理引擎。

**核心问题**：传统 LLM 推理框架在 KV Cache 管理上存在严重的内存浪费——预分配最大序列长度导致利用率仅 20-40%，同时内存碎片使得实际可用并发数极低。

**解决方案**：
1. **PagedAttention**：借鉴 OS 虚拟内存分页思想，将 KV Cache 按固定大小（16 tokens/块）动态分配，消除碎片，利用率提升至 >90%
2. **Continuous Batching**：动态调整批次，任何时刻完成的请求立即被新请求替换，GPU 始终满负荷

**效果**：相比 HuggingFace Transformers，吞吐量提升约 24x；相比 TGI 提升约 6x。

---

### Q2：PagedAttention 的核心原理是什么？

**答：**

PagedAttention 将 KV Cache 组织成固定大小的**物理块（Physical Block）**，每块存储固定数量（默认 16 个）token 的 Key 和 Value 向量。

**关键概念**：
- **逻辑块（Logical Block）**：从请求视角看到的连续 KV Cache
- **物理块（Physical Block）**：实际在 GPU 内存中分配的块，可以不连续
- **块表（Block Table）**：维护每个序列的逻辑块到物理块的映射

```
传统方式：预分配 2048 tokens 的连续内存
[████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]
 已用10%              浪费90%

PagedAttention：按需分配物理块
Block 0 → Physical 3
Block 1 → Physical 7   （不连续，但通过块表索引）
Block 2 → Physical 1
```

**关键改进**：
- 无外部碎片（块大小固定）
- 内部碎片仅在最后一个块（< block_size tokens）
- 支持跨请求共享前缀（引用计数机制）

---

### Q3：PagedAttention 如何处理 Beam Search 的内存共享？

**答：**

Beam Search 需要维护多个候选序列（beam），它们共享相同的前缀。PagedAttention 使用 **Copy-on-Write（CoW）** 机制：

**初始状态**：所有 beam 共享相同物理块，引用计数增加
```
Prompt: "The weather is" (共享块 P0, P1)
Beam 1: [P0, P1, P_A(独占)]  ref(P0)=3, ref(P1)=3
Beam 2: [P0, P1, P_B(独占)]
Beam 3: [P0, P1, P_C(独占)]
```

**写入时 CoW**：若某个 beam 需要修改共享块：
1. 分配新物理块
2. 复制原块内容到新块
3. 原块引用计数减 1
4. 该 beam 的块表指向新块

**内存节省**：对于 beam_width=4，共享前缀占 90% 时，节省约 67% 内存（相比每个 beam 独立分配）。

---

### Q4：Continuous Batching 与 Static Batching 有什么区别？

**答：**

| 维度 | Static Batching | Continuous Batching |
|------|----------------|---------------------|
| 调度时机 | 请求到达时组批 | 每个 iteration 动态调整 |
| 批次变化 | 固定，直到最长序列完成 | 每步可加入/退出 |
| GPU 利用率 | 随时间递减（短序列完成后空闲）| 始终高利用率 |
| 延迟 | 长请求拖累整批 | 短请求及时完成 |

**Continuous Batching 核心**：

每个 iteration（前向传播步骤）之后：
- 已完成序列（EOS 或 max_tokens）从批次中移除
- 等待队列中的新序列立即补充进来
- 从不存在"GPU 空等"的情况

**典型场景收益**：ShareGPT 数据集中输出长度差异极大（几十到几千 token），静态批处理吞吐量比连续批处理低 3-6x。

---

### Q5：vLLM 的内存效率为什么比传统方法高？

**答：**

**传统方法的三种内存浪费**：

1. **过度预留**：在请求开始时为整个 max_seq_len 分配内存，实际使用率 10-40%
2. **外部碎片**：不同长度请求产生的内存空洞无法被利用
3. **内部碎片**：为对齐预留的空间

**vLLM 的解决**：

```
传统 LLM 服务：
GPU 内存 = 模型权重(固定) + KV Cache(过度预留)
实际 KV Cache 利用率 ≈ 20-40%

vLLM：
GPU 内存 = 模型权重(固定) + 动态块分配的 KV Cache
实际 KV Cache 利用率 ≈ 90-96%
（仅最后一个块有少量内部碎片）
```

**量化对比**（LLaMA-13B, A100-40GB）：
- 传统方式：最大并发 ~10 请求
- vLLM：最大并发 ~40-60 请求（4-6x 提升）

---

### Q6：如何在 vLLM 中配置 KV Cache 大小？

**答：**

vLLM 不直接设置 KV Cache 大小，而是通过以下参数间接控制：

```bash
# 方式1：控制 GPU 显存占用比例
--gpu-memory-utilization 0.90
# KV Cache = GPU总显存 × 0.90 - 模型权重大小

# 方式2：限制最大序列长度（减少每个 KV 块的内存需求）
--max-model-len 4096

# 方式3：控制 block_size（更多小块 vs 更少大块）
--block-size 16  # 默认，适合大多数场景
```

**计算公式**：
```python
# 可用 KV Cache 块数（近似）
available_kv_memory = total_gpu_memory × gpu_memory_utilization - model_weights
bytes_per_block = block_size × num_layers × 2 × num_heads × head_dim × dtype_size
num_blocks = available_kv_memory / bytes_per_block
```

---

### Q7：vLLM 如何处理请求超过 GPU 内存的情况？

**答：**

vLLM 有两种 KV Cache **抢占（Preemption）策略**：

**1. Swapping（换出）**：
- 将最老的运行中请求的 KV Cache 从 GPU 复制到 CPU
- 释放 GPU 块供新请求使用
- 当内存充裕时换回 GPU
- 开销：PCIe 传输带宽（约 16-32 GB/s）

**2. Recomputation（重计算）**：
- 丢弃 KV Cache，将请求移回等待队列
- 等内存充裕时重新进行 prefill
- 无 CPU 内存开销，但需要重新计算

**选择策略**：
- 短序列 → Recomputation（重算代价小）
- 长序列 → Swapping（重算代价太高）

```bash
# 配置换出空间
--swap-space 8  # 8GB CPU 内存用于 KV Cache 换出
```

---

### Q8：什么是 Chunked Prefill？它解决什么问题？

**答：**

**问题**：LLM 推理分为两个阶段：
- **Prefill**：处理输入 prompt，计算所有 token 的 KV Cache（耗时随 prompt 长度增长）
- **Decode**：逐个生成输出 token

长 prompt 的 prefill 会阻塞其他请求的 decode，导致 TPOT（每 token 延迟）急剧上升。

**Chunked Prefill 解决方案**：
将长 prompt 的 prefill 分成多个 chunk，与 decode 步骤交织执行：

```
传统方式：
Step 1: [Prefill: 2048 tokens for Req_A]    ← 阻塞其他请求
Step 2: [Decode: Req_B, C, D, E]
Step 3: [Decode: Req_B, C, D, E]

Chunked Prefill：
Step 1: [Prefill: 512 tokens for Req_A] + [Decode: Req_B, C, D]
Step 2: [Prefill: 512 tokens for Req_A] + [Decode: Req_B, C, D]
Step 3: [Prefill: 512 tokens for Req_A] + [Decode: Req_B, C, D]
Step 4: [Prefill: 512 tokens for Req_A] + [Decode: Req_B, C, D]
```

**配置**：
```python
LLM(enable_chunked_prefill=True, max_num_batched_tokens=512)
```

---

## 深度原理（Q9-Q16）

### Q9：PagedAttention 在 CUDA 层面是如何实现的？

**答：**

传统 Attention 需要 KV 矩阵在内存中连续存储，PagedAttention 通过自定义 CUDA kernel 实现非连续内存的 Attention 计算：

**核心实现**（类似 FlashAttention，但支持分页）：
```
传统 Attention:
K: [k0, k1, k2, ..., kN]  ← 连续内存

PagedAttention:
K: Block0→[k0..k15], Block7→[k16..k31], Block3→[k32..k47]
   ↑ 不连续！

CUDA Kernel 中：
1. 从 block_table 获取 block 编号
2. 计算 block 在 GPU 内存中的实际地址
3. 逐块加载 K、V 并计算 attention score
4. 使用在线 softmax 累积结果（避免存储完整注意力矩阵）
```

**关键优化**：
- 使用共享内存（Shared Memory）缓存当前处理的块
- 向量化内存访问（128-bit 对齐）
- Warp 级别并行处理多个注意力头

---

### Q10：张量并行和流水线并行的原理和适用场景？

**答：**

**张量并行（Tensor Parallelism）**：
```
原理：将单个层（Attention、FFN）的权重矩阵按列/行分割
      每个 GPU 计算部分结果，通过 AllReduce 合并

Attention（QKV 投影按列分割）：
  GPU 0: Q[0:H/2], K[0:H/2], V[0:H/2]  → Attention Head 0-15
  GPU 1: Q[H/2:H], K[H/2:H], V[H/2:H]  → Attention Head 16-31
  同步: AllReduce(output)

FFN（两层矩阵，列-行分割）：
  GPU 0: W1[:,0:d/2], W2[0:d/2,:]
  GPU 1: W1[:,d/2:d], W2[d/2:d,:]
  同步: AllReduce(output)

适合：内存不足以放下整个模型（常用）
```

**流水线并行（Pipeline Parallelism）**：
```
原理：按层分割，每个 GPU 处理部分层
  GPU 0: Embedding + Layer 0-9
  GPU 1: Layer 10-19
  GPU 2: Layer 20-31 + LM Head

数据流: Micro-batch 流过各 GPU
适合：超大模型（>100B参数），但有流水线气泡（bubble）开销
```

**组合使用**：
```
4 GPU, TP=2, PP=2:
  GPU 0+1: Layer 0-15（张量并行）
  GPU 2+3: Layer 16-31（张量并行）
```

---

### Q11：vLLM 的 Scheduler 如何做抢占决策？

**答：**

vLLM 调度器按照 FCFS（先来先服务）调度，但内存不足时触发抢占：

**抢占触发条件**：
当处理等待队列中的新请求（prefill）时，如果 KV Cache 块不足

**抢占策略选择**：
```python
# vLLM 源码逻辑（简化）
def _preempt(self, seq_group, blocks_to_free):
    if self.preemption_mode == PreemptionMode.RECOMPUTE:
        # 方式1：重计算
        self._preempt_by_recompute(seq_group)
        # 丢弃 KV Cache，移回 waiting 队列
    else:
        # 方式2：换出到 CPU
        self._preempt_by_swap(seq_group)
        # 将 KV Cache 块换出到 CPU，移入 swapped 队列
```

**抢占顺序**：
- 优先抢占**最晚到达**的请求（LCFS 抢占）
- 确保最早的请求优先完成（防止饥饿）

---

### Q12：Speculative Decoding 在 vLLM 中的实现细节？

**答：**

**核心思想**：小模型（draft）快速生成多个候选，大模型（target）并行验证，接受/拒绝候选。

**vLLM 中的实现**：
```
1. Draft 阶段（小模型生成 γ=5 个候选 token）：
   输入: x_1...x_n
   输出: d_1, d_2, d_3, d_4, d_5

2. Verification 阶段（大模型并行处理 n+5 个位置）：
   一次 forward pass 同时得到所有位置的 logits
   
3. Token 接受/拒绝：
   for i in range(γ):
     p = target_prob[d_i]
     q = draft_prob[d_i]
     if random() < min(1, p/q):  # 接受
         accept(d_i)
     else:  # 拒绝，从修正分布中采样
         sample from max(0, p-q) / Z
         break

4. 平均接受长度 > 1，实现速度提升
```

**vLLM 支持的 Draft 策略**：
- 小模型 Draft（需要加载额外小模型）
- [ngram] Draft（无需额外模型，从 prompt 中查找 n-gram 匹配）
- Medusa（多头预测）

---

### Q13：vLLM 的内存管理与操作系统虚拟内存有哪些相似和不同？

**答：**

**相似之处**：

| OS 虚拟内存 | vLLM PagedAttention |
|------------|---------------------|
| 虚拟页（Virtual Page）| 逻辑 KV 块 |
| 物理页框（Frame）| 物理 KV 块 |
| 页表（Page Table）| 块表（Block Table）|
| 页面置换（Swapping）| KV Cache 换出到 CPU |
| 写时复制（CoW）| Beam Search 共享块 CoW |
| 共享内存 | 前缀共享（相同 System Prompt）|

**不同之处**：

1. **访问模式已知**：KV Cache 的访问模式是顺序追加的，不需要 LRU 等复杂置换策略
2. **块大小固定且较大**：OS 页通常 4KB，vLLM 块约 8MB（16 tokens × LLaMA-7B 参数）
3. **无随机访问**：一旦 token 被处理，其 KV Cache 只读，不会随机修改
4. **显式管理**：OS 页面管理对程序透明，vLLM 需要显式通知 CUDA kernel 块映射

---

### Q14：如何评估 vLLM 的服务性能？关键指标有哪些？

**答：**

**关键指标**：

| 指标 | 定义 | 典型值 | 适用场景 |
|------|------|--------|---------|
| TTFT (Time to First Token) | 从请求到第一个 token 的时间 | 100-500ms | 交互式应用 |
| TPOT (Time per Output Token) | 每个生成 token 的平均时间 | 10-50ms | 流式输出流畅度 |
| Throughput | 每秒总生成 token 数 | 5K-50K tok/s | 批量处理 |
| P99 Latency | 99% 请求的端到端延迟 | < 5s | SLA 保障 |
| GPU KV Cache Utilization | KV Cache 使用率 | > 80% | 内存效率 |

**权衡关系**：
```
吞吐量 ↑ ↔ 延迟 ↑（批越大，单个请求等待越长）
max_num_seqs ↑ → 吞吐量 ↑, TTFT ↑
max_num_seqs ↓ → 延迟 ↓, 吞吐量 ↓
```

**优化建议**：
- 在线服务（聊天应用）：优先优化 TTFT 和 TPOT，限制 max_num_seqs
- 批量处理（数据生成）：最大化吞吐量，接受更高延迟

---

### Q15：vLLM 如何支持前缀共享（Prefix Caching）？

**答：**

**场景**：多个请求共享相同的 System Prompt（如 RAG 场景中的上下文）

**实现原理**（Automatic Prefix Caching, APC）：
```
请求1: [System Prompt(256 tokens)] + [User Query A]
请求2: [System Prompt(256 tokens)] + [User Query B]

没有 APC：
  请求1 Prefill: 计算 256+len(A) 个 token
  请求2 Prefill: 计算 256+len(B) 个 token（重复计算！）

有 APC（vLLM v0.3+）：
  请求1 Prefill: 计算所有 token，System Prompt 的 KV 块保留
  请求2 Prefill: 直接复用 System Prompt 的物理块！
               只需计算 len(B) 个 token
```

**实现细节**：
- 以 block_size 为单位，对每个块的 token ID 序列计算哈希
- 相同哈希的块视为可复用
- 块被所有共享者引用计数，最后使用者释放时才回收

```bash
# 启用 APC
python -m vllm.entrypoints.openai.api_server \
    --model llama-2-7b \
    --enable-prefix-caching
```

---

### Q16：vLLM 中 FlashAttention 是如何集成的？

**答：**

vLLM 将 FlashAttention 与 PagedAttention 结合，形成 **PagedFlashAttention**：

**FlashAttention 贡献**：
- IO-aware：减少 HBM 读写次数（分块计算，不存中间注意力矩阵）
- 不需要 O(N²) 的注意力矩阵，只需 O(N) 的额外空间

**PagedAttention 贡献**：
- 非连续 KV Cache 的高效访问（块表索引）
- 支持动态长度序列

**结合后的 CUDA Kernel**：
```
对于每个 Query token q：
  初始化 running_sum = 0, running_max = -inf
  
  for block_idx in block_table[seq_id]:
    # 加载当前 KV 块（16 个 token）
    K_block = load_kv_block(block_idx)
    V_block = load_kv_block(block_idx)
    
    # 计算该块的注意力分数
    scores = q @ K_block.T / sqrt(head_dim)
    
    # 在线 softmax 更新
    running_max, running_sum = update_online_softmax(
        scores, running_max, running_sum)
    
    # 累积 Value
    output += softmax(scores) @ V_block

return output / running_sum
```

---

## 系统设计（Q17-Q22）

### Q17：设计一个高吞吐量 LLM 服务系统

**答：**

```
系统架构：

用户层
  │ HTTPS 请求
  ▼
负载均衡（Nginx / AWS ALB）
  │ 路由策略：最少连接数
  ▼
API Gateway（FastAPI / Kong）
  ├── 认证授权（JWT）
  ├── 请求限流（Token Bucket）
  ├── 请求验证（max_tokens, prompt_length）
  └── 请求日志（Async Logger）
  │
  ▼
请求队列（Kafka / Redis Stream）
  │ 优先级队列（VIP 用户高优先级）
  ▼
vLLM 服务集群
  ├── 实例1: LLaMA-7B (GPU 0-1, TP=2) → 通用请求
  ├── 实例2: LLaMA-7B (GPU 2-3, TP=2) → 通用请求
  └── 实例3: LLaMA-70B (GPU 4-7, TP=4) → 高质量请求
  │
  ▼
结果返回（SSE 流式 / WebSocket）
  │
  ▼
监控层（Prometheus + Grafana + AlertManager）
  ├── GPU 利用率
  ├── 请求队列深度
  └── P99 延迟
```

**关键设计决策**：
1. **模型路由**：小模型处理简单请求，大模型处理复杂请求（成本优化）
2. **水平扩展**：按 GPU 节点扩展，不跨节点进行 TP（网络延迟大）
3. **故障隔离**：单个 vLLM 实例崩溃不影响其他实例
4. **背压机制**：队列满时返回 503 而不是无限积压

---

### Q18：vLLM 与 TGI（Text Generation Inference）的对比？

**答：**

| 维度 | vLLM | TGI (HuggingFace) |
|------|------|-------------------|
| 内存管理 | PagedAttention（几乎无碎片）| 连续预分配（碎片较多）|
| 批处理 | Continuous Batching | Continuous Batching（v2+）|
| 吞吐量 | 更高（~6x vs TGI）| 中等 |
| 量化支持 | AWQ/GPTQ/INT8/FP8 | GPTQ/BitsAndBytes |
| 模型支持 | 广泛 | 广泛（与 HF 生态深度集成）|
| 部署难度 | 较简单 | 中等 |
| 生产成熟度 | 高 | 高 |
| 特殊功能 | Speculative Decoding, APC | LoRA 支持更完善 |

**选择建议**：
- 追求最高吞吐量 → vLLM
- 需要 LoRA 动态加载 → TGI 或 vLLM LoRA（v0.4+）
- HuggingFace 生态深度集成 → TGI

---

### Q19：如何为 vLLM 服务设置 SLA 保障？

**答：**

**SLA 定义示例**：
```
P50 TTFT < 200ms
P99 TTFT < 1s
P99 TPOT < 50ms  
可用性 > 99.9%
```

**实现手段**：

1. **请求限流**：超过 QPS 限制时返回 429，保护服务不被打垮
2. **超时控制**：设置请求最大等待时间，超时返回 504
3. **优先级队列**：VIP 用户请求优先处理
4. **弹性扩缩容**：基于队列深度和延迟指标自动扩展副本
5. **熔断机制**：单实例错误率超阈值时，流量不再路由到该实例

```python
# 客户端超时配置
client = openai.OpenAI(
    timeout=httpx.Timeout(
        connect=5.0,     # 连接超时
        read=60.0,       # 读取超时
        write=10.0,
    )
)
```

---

### Q20：如何优化 vLLM 在长文档摘要场景下的性能？

**答：**

长文档摘要特点：超长 prompt（8K-128K tokens），短输出（500-2000 tokens）

**优化策略**：

1. **Chunked Prefill**：避免长 prefill 阻塞其他请求
```bash
--enable-chunked-prefill --max-num-batched-tokens 2048
```

2. **前缀缓存**：同一文档的多次处理复用 KV Cache
```bash
--enable-prefix-caching
```

3. **增大 max_model_len**：
```bash
--max-model-len 32768
```

4. **选择支持长上下文的模型**：
```
LLaMA 3.1（128K）, Qwen2（32K+）, Mistral Long（32K）
```

5. **减少并发**：长 prompt 单请求内存占用大，降低 max_num_seqs

---

## 对比与选型（Q21-Q26）

### Q21：vLLM 与 DeepSpeed-MII 的对比？

**答：**

| 维度 | vLLM | DeepSpeed-MII |
|------|------|---------------|
| 内存管理 | PagedAttention | 传统连续分配 |
| 吞吐量 | 领先 | 较低 |
| ZeRO 优化 | 不支持 | 支持（内存极小时有优势）|
| 量化 | AWQ/GPTQ/INT8/FP8 | ZeroQuant, GPTQ |
| 生态 | 独立项目 | 与 DeepSpeed 深度集成 |
| 适用场景 | 通用 LLM 推理服务 | 超大模型（trillion 参数级）|

---

### Q22：什么场景下 vLLM 不是最优选择？

**答：**

1. **CPU 推理**：vLLM 强依赖 NVIDIA GPU，CPU 推理使用 llama.cpp 更合适
2. **移动端/边缘设备**：使用 GGUF + llama.cpp 或 MLC-LLM
3. **需要精细 LoRA 控制**：TGI 的 LoRA 支持更完善（多 LoRA 动态切换）
4. **单一短请求低延迟**：vLLM 的 continuous batching 有少量调度开销，对极低延迟（<20ms）场景用 TensorRT-LLM 更优
5. **训练时推理**：使用 HuggingFace Transformers 或 DeepSpeed

---

### Q23-Q26：快问快答

**Q23：vLLM 中的 `gpu_memory_utilization=0.9` 是什么意思？**

保留 10% GPU 显存作为安全缓冲（防止 OOM），90% 分配给模型权重和 KV Cache。KV Cache 块数 = (总显存 × 0.9 - 模型权重) / 块大小。

**Q24：为什么 PagedAttention 的块大小选 16？**

权衡碎片率和开销：块越小，内部碎片越少，但块表更大、元数据开销更多；块越大，碎片率上升。16 tokens/块 在大多数场景下是经验最优值。

**Q25：vLLM 的 Prefill 和 Decode 为什么效率不同？**

Prefill 是矩阵-矩阵乘法（Compute-bound），可以充分利用 GPU 算力；Decode 是矩阵-向量乘法（Memory-bound），瓶颈在显存带宽而非算力，GPU 利用率低。

**Q26：AWQ 和 GPTQ 量化的本质区别？**

| | AWQ | GPTQ |
|--|-----|------|
| 核心思想 | 识别重要权重（激活值大的通道）保持高精度 | 基于二阶 Hessian 信息最小化量化误差 |
| 校准数据 | 需要少量数据确定权重重要性 | 需要校准数据计算 Hessian |
| 精度 | 通常略优 | 接近 AWQ |
| 速度 | 量化过程较快 | 较慢 |
| 激活值精度 | FP16（仅权重量化 W4A16）| FP16 |

---

## 综合设计题（Q27-Q30）

### Q27：设计支持百万级用户的 LLM 聊天服务

**关键设计点**：

```
1. 接入层：CDN + WAF + 全球负载均衡
2. 会话管理：Redis 存储对话历史，TTL 24h
3. 推理层：
   - 多区域部署（就近处理）
   - 每区域：3-5 个 vLLM 实例（A100×4 每实例）
   - 消息队列（Kafka）做异步解耦
4. 模型选择：
   - 简单问题 → 7B 模型（低延迟低成本）
   - 复杂问题 → 70B 模型（高质量）
   - 用分类器判断路由
5. 成本优化：
   - 夜间低峰期缩容
   - 使用 Spot 实例
   - AWQ 4-bit 量化降低 GPU 需求
```

### Q28：如何实现 vLLM 的金丝雀发布（灰度升级）？

```
1. 新版本 vLLM 在少量 Pod 上部署（10%）
2. 通过 Kubernetes Service 权重路由 10% 流量
3. 监控：错误率、延迟、内存使用对比新旧版本
4. 若指标正常，逐步扩大至 50% → 100%
5. 若异常，立即将权重调回 0%

关键监控指标对比：
  - TTFT P99
  - 错误率（5xx）
  - GPU OOM 频率
  - KV Cache 命中率（APC）
```

### Q29：如何排查 vLLM 内存泄漏问题？

```bash
# 1. 监控 GPU 内存随时间的变化
watch -n 5 nvidia-smi

# 2. 检查 KV Cache 使用率是否持续增长
# Prometheus 查询：vllm:gpu_cache_usage_perc

# 3. 检查是否有请求没有被正确清理
# 可能原因：异常请求未触发 abort_request()

# 4. 启用 vLLM 调试日志
export VLLM_LOGGING_LEVEL=DEBUG

# 常见原因：
# - 客户端断开连接但服务端未检测到（缺少连接检测）
# - Beam Search 的 CoW 块未正确释放
# - 解决：确保 request_id 唯一且 abort_request() 被调用
```

### Q30：如何在 vLLM 上实现 RAG（检索增强生成）？

```python
from vllm import LLM, SamplingParams
import faiss

# 1. 向量检索（可以单独部署）
def retrieve(query: str, k: int = 5) -> list[str]:
    query_vec = embed(query)
    _, indices = faiss_index.search(query_vec, k)
    return [documents[i] for i in indices[0]]

# 2. 构建带上下文的 Prompt
def build_rag_prompt(query: str, context_docs: list[str]) -> str:
    context = "\n\n".join(context_docs)
    return f"""Based on the following context, answer the question.

Context:
{context}

Question: {query}
Answer:"""

# 3. 使用 vLLM 生成（启用前缀缓存）
llm = LLM(
    model="meta-llama/Llama-2-7b-chat-hf",
    enable_prefix_caching=True,  # 系统 Prompt 共享缓存
)

# 4. 批量处理 RAG 请求（共享 System Prompt 的 KV Cache）
queries = ["问题1", "问题2", "问题3"]
prompts = [build_rag_prompt(q, retrieve(q)) for q in queries]

outputs = llm.generate(prompts, SamplingParams(max_tokens=512))
```

**APC 优化**：若所有请求共享相同的 System Prompt，前缀缓存可以消除重复计算，大幅降低 TTFT。
