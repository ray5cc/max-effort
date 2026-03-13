# TensorRT-LLM 常见面试题库

> 涵盖 TensorRT 图优化、量化、in-flight batching、多 GPU 并行等核心考点，分初级 / 中级 / 高级三个层次。

---

## 初级题

### Q1. TensorRT-LLM 与 vLLM 的核心区别是什么？

**答：**
| 维度 | TensorRT-LLM | vLLM |
|------|-------------|------|
| 硬件绑定 | NVIDIA GPU（CUDA/TensorRT） | 多后端（CUDA/ROCm/CPU） |
| 优化方式 | 编译期内核融合 + 量化 | PagedAttention 运行时内存管理 |
| 量化支持 | FP8/INT8/INT4（AWQ/GPTQ/SmoothQuant） | AWQ/GPTQ/INT8 |
| 部署集成 | Triton Inference Server / NIM | OpenAI-compatible HTTP server |
| 编译成本 | 高（需 build engine） | 低（直接加载权重） |
| 典型场景 | NVIDIA 生产环境极致性能 | 通用多模型快速部署 |

---

### Q2. TensorRT 的图优化流程分哪几步？

**答：**
1. **模型解析**：读取 ONNX / TF / PyTorch 模型，建立 TensorRT 网络定义
2. **图优化**（Graph Optimization）：消除冗余节点、常量折叠（Constant Folding）、层合并
3. **内核选择**（Kernel Selection）：针对目标 GPU 选择最优 CUDA kernel（包含 cuBLAS、cuDNN）
4. **精度校准**（Calibration）：INT8 量化时收集激活分布，确定 scale factor
5. **引擎序列化**（Serialization）：将优化后的计划保存为 `.engine` 文件，下次直接加载

---

### Q3. 什么是内核融合（Kernel Fusion）？它带来哪些好处？

**答：**  
将多个独立的 CUDA kernel（如 LayerNorm → GEMM → GELU → GEMM）合并为一个 kernel 执行。

**好处：**
- **减少内存读写**：中间结果留在寄存器/共享内存，避免写回 HBM
- **降低 kernel launch 开销**：每次 kernel 启动有固定延迟（~μs 级）
- **提升 GPU 利用率**：更大的计算密度

典型融合：`QKV Projection` + `Softmax` + `Attention` 合并为 FlashAttention kernel。

---

### Q4. FP8 与 INT8 量化有什么区别？

**答：**
| 维度 | FP8 (E4M3/E5M2) | INT8 |
|------|----------------|------|
| 数据类型 | 浮点（含指数位） | 整数 |
| 动态范围 | 较大（E4M3: ±448） | 小（-128~127） |
| 精度损失 | 更小 | 较大（尤其激活值分布不均匀时） |
| 硬件支持 | H100/H200 Tensor Core | A100 及以上 |
| 量化粒度 | 可 per-tensor/per-channel | 同上 |
| 适用场景 | H100 生产部署 | A100 及更早 GPU |

---

### Q5. TensorRT-LLM 的 in-flight batching 是什么？

**答：**  
也称 **连续批处理**（Continuous Batching）。传统静态批处理需要等一批请求全部完成才能接入新请求，而 in-flight batching 在每个解码步（iteration）后动态调整批次：
- 已完成的序列立即移出批次
- 等待队列中的新请求立即加入
- 批次大小动态变化，GPU 持续满载

**效果：** 显著提升吞吐量，P99 延迟大幅降低，尤其对输出长度差异大的请求有效。

---

### Q6. 什么是 SmoothQuant？解决了什么问题？

**答：**  
**问题背景：** LLM 激活值（activation）中存在离群值（outlier），直接 INT8 量化损失大。  
**SmoothQuant 方法：**  
- 将激活中的困难（大值）迁移到权重中（权重更容易量化）
- 引入平滑因子 `s`：`Y = (X / s) × (W × s)`
- 两边都变得更容易量化，精度损失小

```python
# 概念示意
smooth_factor = activation.abs().max(dim=0) ** alpha / weight.abs().max(dim=0) ** (1 - alpha)
weight_smoothed = weight * smooth_factor
activation_smoothed = activation / smooth_factor
```

---

## 中级题

### Q7. TensorRT-LLM build 流程分几个阶段？每阶段做什么？

**答：**

```
阶段 1: 权重转换
  HuggingFace 权重 → TRT-LLM 格式 (convert_checkpoint.py)
  ↓
阶段 2: 引擎编译 (trtllm-build)
  定义网络结构 → 图优化 → 量化 → kernel 选择 → .engine 文件
  ↓
阶段 3: 运行时推理 (tensorrt_llm.runtime)
  加载 .engine → 分配 KV cache → 处理请求 → 生成 token
```

编译阶段耗时长（数分钟到数小时），但推理速度极快。

---

### Q8. TensorRT-LLM 如何实现 Tensor Parallel？

**答：**  
- **列并行（Column Parallel）**：将 GEMM 的权重矩阵按列切分，每个 GPU 计算部分输出，最后 All-Reduce
- **行并行（Row Parallel）**：权重按行切分，输入按列切分，局部 GEMM 后 All-Reduce
- MHA 中 Q/K/V 投影用列并行，输出投影用行并行
- FFN 中第一层列并行，第二层行并行

```
TP=4 示意（4 GPU）:
  [W: 4096×4096] → 每 GPU 持有 [W: 4096×1024]
  前向：各 GPU 计算局部结果 → NCCL All-Reduce → 合并输出
```

---

### Q9. KV Cache 分页（Paged KV Cache）在 TRT-LLM 中如何实现？

**答：**  
TensorRT-LLM 借鉴 vLLM 的 PagedAttention 思想：
- KV cache 不预分配固定大小，而是按 **page/block** 动态分配
- 每个 page 存储固定数量（如 16 或 32）token 的 KV 值
- BlockManager 维护 logical→physical 块映射
- 支持 beam search 的写时复制（Copy-on-Write）

**优势：** 减少内存碎片，允许更大批次，提升 GPU 内存利用率。

---

### Q10. 如何选择 INT8 vs INT4 量化？

**答：**  
| 场景 | 推荐 |
|------|------|
| 精度优先，VRAM 充足 | FP16/BF16（不量化） |
| 均衡场景，A100/H100 | INT8（SmoothQuant/GPTQ） |
| VRAM 受限，可接受精度损失 | INT4（AWQ/GPTQ W4A16） |
| H100，追求极致性能 | FP8 |

**实践原则：**
- 先尝试 INT8，对比 perplexity / 任务指标
- INT4 一般损失 < 1% perplexity（AWQ 优于 GPTQ）
- 注意：权重 INT4 + 激活 FP16（W4A16）比 W4A4 精度好很多

---

### Q11. Triton Inference Server 与 TensorRT-LLM 如何配合？

**答：**

```
客户端 HTTP/gRPC
      ↓
Triton Inference Server
  ├── 请求路由 & 并发管理
  ├── 动态批处理（Dynamic Batching）
  ├── 多模型多版本管理
  └── TensorRT-LLM Backend (libtensorrt_llm.so)
            ↓
      TRT Engine 执行
      (GPU 内核融合推理)
```

配置文件 `config.pbtxt` 指定 backend、batch 策略、实例数等参数。

---

### Q12. 什么是 GQA（Grouped Query Attention）？TRT-LLM 如何优化它？

**答：**  
GQA 将 KV head 数量减少（如从 32 个 Q head 减到 8 个 KV head），多个 Q head 共享一组 KV，减少 KV cache 大小。

TRT-LLM 优化：
- 专用 CUDA kernel 处理 GQA/MQA attention
- KV cache 只存 KV head 数，而非 Q head 数
- 减少 KV cache 内存最高达 4×（如 LLaMA-3 70B: 8 KV heads vs 64 Q heads）

---

## 高级题

### Q13. 设计一个基于 TensorRT-LLM 的生产 LLM 服务系统，支持 1000 QPS

**答：**

```
架构设计：
┌─────────────────────────────────────────────────────────┐
│                    负载均衡层 (Nginx/Envoy)               │
└────────────────────┬────────────────────────────────────┘
                     │
         ┌───────────┴───────────┐
         ↓                       ↓
┌────────────────┐     ┌────────────────┐
│ Triton Node 1  │     │ Triton Node 2  │   (可水平扩展)
│ 4×H100 TP=4   │     │ 4×H100 TP=4   │
│ TRT-LLM Engine │     │ TRT-LLM Engine │
└────────────────┘     └────────────────┘
         ↓
┌────────────────────────────────────────┐
│         监控层 (Prometheus + Grafana)   │
│  指标: throughput, latency, GPU util   │
└────────────────────────────────────────┘
```

**关键配置：**
- TP=4 部署 70B 模型（4×H100 80GB）
- in-flight batching，max_batch_size=128
- KV cache paging，内存利用率 > 80%
- FP8 量化（H100）
- Triton Dynamic Batching，preferred_batch_size=[32,64]
- 请求队列 + 超时控制（max_queue_delay_microseconds）

---

### Q14. TensorRT-LLM 的 Pipeline Parallel 如何处理 micro-batch？

**答：**  
- 模型按层切分为 PP 个阶段（Stage），每个 Stage 在不同 GPU 上
- 使用 **1F1B（One Forward One Backward）** 调度减少 bubble
- 推理时无 backward，简化为流水线前向
- Micro-batch 在流水线中重叠执行：Stage 1 处理 batch N+1 时，Stage 2 在处理 batch N

**Pipeline Bubble 比例：** `(PP-1) / (num_micro_batches + PP - 1)`

---

### Q15. AWQ（Activation-aware Weight Quantization）原理是什么？

**答：**  
AWQ 的核心观察：**权重中只有少部分（约 1%）对激活值影响大**，对这部分权重保持高精度。

**算法：**
1. 统计激活值分布，找出 salient（重要）通道
2. 对 salient 通道的权重放大（scale up），量化误差分散
3. 其余通道正常 INT4 量化
4. 推理时通过 scale factor 恢复

**与 GPTQ 对比：**
- AWQ：免校准数据集（只需少量激活统计），速度更快
- GPTQ：需要校准集，使用二阶海森矩阵信息，精度略高

---

### Q16. 如何 profile TensorRT-LLM 推理性能瓶颈？

**答：**  
```bash
# 1. 使用 nsys 采集 GPU timeline
nsys profile --trace=cuda,nvtx \
  python run_trtllm.py --model llama-7b

# 2. 查看 GEMM vs attention 耗时比例
nsys stats report.nsys-rep

# 3. 使用 ncu 详细分析单个 kernel
ncu --metrics sm__throughput.avg.pct_of_peak_sustained_elapsed \
  python run_trtllm.py
```

**常见瓶颈：**
- `prefill 阶段`：GEMM 密集，关注 SM utilization
- `decode 阶段`：访存密集（memory-bound），关注 HBM 带宽
- **Roofline 模型**：判断操作是 compute-bound 还是memory-bound

---

### Q17. TensorRT-LLM 中 speculative decoding 如何加速推理？

**答：**  
**原理：** 用小模型（draft model）快速生成多个候选 token，大模型（target model）并行验证。

```
Draft Model (小):  [token1][token2][token3][token4]  → 4 个候选
Target Model (大): 并行验证 4 个 token
  - 接受前 k 个，拒绝第 k+1 个
  - 一次 target 前向 = 生成多个 token
```

**加速比：** 理想情况 3-4× token 速率提升（acceptance rate 越高，加速越明显）。

TRT-LLM 支持：
- Medusa（多个 draft heads）
- Eagle（轻量级 draft 模型）
- Draft model 选择（需与 target 同 tokenizer）

---

### Q18. 如何减少 TRT-LLM 引擎的编译时间？

**答：**  
1. **使用预编译引擎（NIM）**：NVIDIA 提供常见模型的预编译 .engine 文件
2. **指定精确 max_batch_size / max_seq_len**：避免过大的优化空间
3. **禁用不需要的精度（strongly_typed=True）**：减少 kernel profile 数量
4. **使用 weight_only_quant 而非 full INT8**：编译更快
5. **分层编译缓存**：相同层可复用编译结果

---

### Q19. TensorRT-LLM 的 MoE（专家混合）并行策略是什么？

**答：**  
Mixture of Experts 模型（如 Mixtral 8×7B）在 TRT-LLM 中使用 **Expert Parallel（EP）**：
- 将不同专家分配到不同 GPU 上
- Token routing 后，跨 GPU 发送 token 到对应专家 GPU（All-to-All 通信）
- 可与 TP、DP 组合使用（TP×EP×DP = 总 GPU 数）

**通信开销：** MoE 的 All-to-All 是主要瓶颈，需要高速 NVLink 互联。

---

### Q20. 如何验证量化后模型的精度？

**答：**  
```python
# 1. 困惑度 (Perplexity) 对比
import torch
from tensorrt_llm import LLM

fp16_ppl = compute_perplexity(fp16_model, wikitext2)
int8_ppl  = compute_perplexity(int8_model,  wikitext2)
print(f"精度损失: {int8_ppl - fp16_ppl:.2f}")  # 通常 < 0.5

# 2. 任务指标 (MMLU, HellaSwag 等)
# 使用 lm-evaluation-harness
python main.py --model trtllm --model_args model_dir=./engine \
  --tasks mmlu --num_fewshot 5

# 3. 端到端输出质量评估
# 抽样比较量化前后的生成文本
```

**经验阈值：**
- PPL 增加 < 0.5：优秀
- PPL 增加 0.5-2.0：可接受
- PPL 增加 > 2.0：需重新调整量化参数

---

*参考资料：[TensorRT-LLM GitHub](https://github.com/NVIDIA/TensorRT-LLM) | [NVIDIA TensorRT 文档](https://docs.nvidia.com/deeplearning/tensorrt/)*
