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

**核心要点**：

LLM 生成是自回归的——每生成一个 Token 都需要与之前所有 Token 做 Attention。如果每次都重新计算，计算量随序列长度平方增长。KV Cache 缓存已计算的 Key/Value 矩阵，新 Token 只需计算自己的 Q 与缓存的 K、V 做 Attention。

**面试追问**：
- KV Cache 的内存消耗如何估算？（层数 × KV Head 数 × Head 维度 × 序列长度 × 2 × 数据类型大小）
- 70B 模型 4096 序列长度的单请求 KV Cache 约多大？（~2.5GB）

### Q2: PagedAttention 原理

**核心要点**：

借鉴操作系统虚拟内存的分页思想。传统实现需要为每个请求预分配连续显存（按最大长度），导致内部碎片（预留了 2048 但只用了 100）和外部碎片（释放后空间大小不一）。PagedAttention 将 KV Cache 划分为固定大小的 Block（默认 16 tokens），按需分配，通过 Block Table（类似页表）维护逻辑到物理的映射。

**关键数据**：内存利用率从 20-40% 提升到 95%+，等效 2-4 倍并发提升。

### Q11: Prefill-Decode 分离架构（场景设计题）

**设计要点**：

1. **为什么分离**：Prefill 是计算密集型（大量矩阵乘法），Decode 是内存密集型（逐 Token 访问 KV Cache）。混合部署导致资源利用率低。

2. **架构设计**：
   - Prefill 集群：少量高计算力 GPU（如 4×H100 SXM），处理输入 Prompt
   - Decode 集群：多个中等 GPU（如 16×L40S），处理逐 Token 生成
   - KV Cache 传输：Prefill 完成后通过高速网络将 KV Cache 传输到 Decode 节点

3. **成本收益**：整体成本降低 30-50%，因为不同阶段使用最适合的硬件。

4. **工程挑战**：KV Cache 传输延迟、负载均衡、故障切换。
