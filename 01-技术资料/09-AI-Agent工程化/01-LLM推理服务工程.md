# LLM 推理服务工程

> 从 vLLM、SGLang 到 TensorRT-LLM，深入解析 LLM 推理引擎的工程化部署与生产环境性能优化实践

## 相关链接

- 对应面试题：[LLM推理服务工程面试题](../../02-面试指南/09-AI-Agent工程化面试/01-LLM推理服务工程面试题.md)

## TL;DR 速览

- **PagedAttention** 是 vLLM 的核心创新，将 KV Cache 按页管理，内存利用率从 ~20% 提升到 ~95%
- **RadixAttention** 是 SGLang 的杀手锏，用 Radix Tree 缓存共享前缀，多轮对话场景加速 2-5 倍
- **Continuous Batching** 让请求随到随处理，吞吐量比 Static Batching 高 10-20 倍
- 量化技术选型：在线服务用 **FP8/AWQ**（精度损失小），离线/边缘用 **GGUF**（CPU 友好）
- 分布式推理核心：**Tensor Parallelism** 降延迟，**Pipeline Parallelism** 省显存，**Expert Parallelism** 服务 MoE 模型
- 生产部署三要素：**健康检查 + 优雅关闭 + 自动扩缩容**，缺一不可
- vLLM 是「稳定之选」，SGLang 是「多轮对话最优」，TensorRT-LLM 是「极致吞吐」

## 目录

1. [为什么需要专业的推理服务工程？](#_1-为什么需要专业的推理服务工程)
2. [核心技术原理](#_2-核心技术原理)
3. [主流推理引擎工程实践](#_3-主流推理引擎工程实践)
4. [分布式推理与 GPU 集群管理](#_4-分布式推理与-gpu-集群管理)
5. [量化技术工程实践](#_5-量化技术工程实践)
6. [生产部署最佳实践](#_6-生产部署最佳实践)
7. [性能基准测试与选型指南](#_7-性能基准测试与选型指南)
8. [常见陷阱与最佳实践](#_8-常见陷阱与最佳实践)
9. [延伸与前沿](#_9-延伸与前沿)

---

## 1. 为什么需要专业的推理服务工程？

### 1.1 现实挑战

想象你在运营一家餐厅。LLM 训练是"研发菜谱"，而推理服务是"每天接待数千名食客"——后者才是真正决定商业成败的环节。

在生产环境中，LLM 推理面临三大核心挑战：

**成本问题：GPU 算力极其昂贵**

一块 H100 GPU 云实例价格约 $2-3/小时。一个中等规模的 AI 服务（日活 10 万用户），如果不做优化，月均 GPU 成本可轻松超过 $50,000。推理成本通常占 AI 应用总成本的 80-90%。

**延迟问题：用户体验的关键瓶颈**

用户对聊天机器人的容忍延迟约为 2-3 秒。一个 70B 参数模型在单 GPU 上的首 Token 延迟（TTFT）可达 1-5 秒，逐 Token 生成速度约 30-50 tokens/s。如果不优化，长文本生成可能需要等待 30 秒以上。

**吞吐量问题：并发请求的处理能力**

朴素实现中，一个请求独占整块 GPU，其他请求只能排队。这就像一个餐厅只有一个厨师，同时只做一道菜——即使后厨有很多空闲灶台。

### 1.2 推理服务 vs 模型训练的本质差异

| 维度 | 训练 | 推理 |
|------|------|------|
| 计算模式 | 批量、确定性 | 流式、不确定长度 |
| 优化目标 | 吞吐量（samples/s） | 延迟（TTFT, TPS）+ 吞吐量 |
| 内存模式 | 固定分配 | 动态增长（KV Cache） |
| 并发模式 | 数据并行 | 请求级别并发 |
| 可靠性要求 | 可重试 | 实时、不可中断 |

### 1.3 业界参考

- **OpenAI** 的推理集群使用定制优化引擎，推理成本在两年内下降了 10 倍
- **Databricks** 和 **Anyscale** 大规模使用 vLLM 为客户提供模型服务
- **字节跳动** 和 **阿里云** 基于 vLLM/SGLang 构建内部推理平台

---

## 2. 核心技术原理

### 2.1 KV Cache — 推理加速的基石

**为什么需要 KV Cache？**

LLM 生成文本是自回归的——每生成一个 Token 都需要"看"之前所有 Token。如果每次都重新计算所有 Token 的 Attention，计算量随序列长度平方增长。

KV Cache 的思路很简单：**把已经计算过的 Key 和 Value 矩阵缓存起来**，生成下一个 Token 时只需计算新 Token 的 Q 与缓存的 K、V 做 Attention。

**类比**：像写考试答案时的草稿纸。你不会每写一题就把之前的推导过程擦掉重写，而是保留草稿，后续题目直接引用之前的中间结果。

**内存消耗**：一个 70B 模型（80 层、8 个 KV Head、128 维），序列长度 4096 时，单个请求的 KV Cache 约占 2.5 GB。如果同时处理 64 个请求，仅 KV Cache 就需要 160 GB——已经超过单块 H100 的 80GB 显存。

### 2.2 PagedAttention — vLLM 的核心创新

**问题：KV Cache 的内存碎片化**

传统实现中，每个请求的 KV Cache 需要预分配一块连续的显存空间。由于请求的输出长度不可预知，系统不得不按最大长度预留空间，导致：
- **内部碎片**：实际输出 100 tokens，但预留了 2048 tokens 的空间
- **外部碎片**：请求结束后释放的空间大小不一，难以复用

**解决方案：借鉴操作系统的虚拟内存**

PagedAttention 的灵感直接来自操作系统的分页内存管理：

```
传统连续分配:
┌────────────────────────────────────────────┐
│  Request A (预留2048)  │ 浪费! │ Request B │
└────────────────────────────────────────────┘

PagedAttention 分页管理:
┌──────┬──────┬──────┬──────┬──────┬──────┐
│ A-P1 │ B-P1 │ A-P2 │ C-P1 │ B-P2 │ A-P3 │  ← 物理块
└──────┴──────┴──────┴──────┴──────┴──────┘
   ↑              ↑              ↑
   └── Request A: [P1, P2, P3] ──┘  ← 逻辑映射（不必连续）
```

**核心机制**：
1. 将 KV Cache 划分为固定大小的 **Block**（默认 16 tokens/block）
2. 每个请求维护一个 **Block Table**（类似页表），记录逻辑块到物理块的映射
3. 按需分配：生成到哪里，分配到哪里，不再预留

**实际效果**：内存利用率从传统方案的 20-40% 提升到 95% 以上，等效于同样的 GPU 可以服务 2-4 倍的并发请求。

### 2.3 RadixAttention — SGLang 的 Prefix 共享利器

**场景**：在多轮对话、Few-shot Learning、RAG 等场景中，大量请求共享相同的系统提示词或前缀。如果每个请求都独立计算这些共享前缀的 KV Cache，会造成巨大的重复计算。

**RadixAttention** 使用 **Radix Tree**（基数树）来组织和复用 KV Cache：

```
                    [System Prompt]
                    /              \
        [User: 天气]             [User: 翻译]
        /          \                    |
  [助手: 今天...]  [助手: 明天...]   [助手: Here...]
```

**类比**：想象一个图书馆的目录系统。很多书的分类路径有共同前缀（如"科学→物理→"），图书馆不会为每本书都建立完整的独立目录路径，而是共享前缀部分。

**工程实现**：
- **自动前缀匹配**：新请求到达时，自动在 Radix Tree 中查找最长匹配前缀
- **LRU 淘汰**：树节点按最近使用时间淘汰，确保热点前缀常驻缓存
- **零拷贝共享**：匹配到的 KV Cache 直接引用，无需复制

**性能收益**：在共享系统提示词的场景下，SGLang 的 TTFT 可比 vLLM 快 2-5 倍。

### 2.4 Continuous Batching — 动态批处理

**传统 Static Batching 的问题**：

```
时间 →  ────────────────────────────────
Req A:  [████████████████]              ← 生成 200 tokens
Req B:  [████████]                      ← 生成 100 tokens（完成后空等）
Req C:  [等待...........][████████████] ← 必须等 A 完成才能进入
```

Static Batching 中，一个 Batch 的所有请求必须等最长的那个完成才能释放资源。

**Continuous Batching 的解决方案**：

```
时间 →  ────────────────────────────────
Req A:  [████████████████]
Req B:  [████████]
Req C:          [████████████]  ← B 完成后，C 立即插入
Req D:                  [████]  ← A 完成后，D 立即插入
```

**每次前向传播（iteration）后，调度器检查**：
1. 有没有请求已经生成了 EOS Token？有的话移出 Batch
2. 等待队列中有没有新请求？有的话插入 Batch

这让 GPU 始终保持满载，吞吐量提升 10-20 倍。

### 2.5 Chunked Prefill — 长文本优化

当输入 Prompt 很长（如 RAG 场景下 8K-32K tokens）时，Prefill 阶段的计算量巨大，会阻塞其他请求的 Decode 步骤。

**Chunked Prefill** 将长 Prompt 的 Prefill 分成多个 Chunk（如每 512 tokens 一个 Chunk），在 Chunk 之间穿插其他请求的 Decode 步骤：

```
无 Chunked Prefill:
[=====长 Prefill=====][Decode][Decode][Decode]
其他请求等待......................↑ 才能开始

有 Chunked Prefill:
[Chunk1][D][Chunk2][D][Chunk3][D][Decode]
         ↑          ↑          ↑  穿插处理
```

这显著降低了其他请求在 Prefill 期间的延迟尖峰。

---

## 3. 主流推理引擎工程实践

### 3.1 vLLM — 生产级推理引擎

vLLM（github.com/vllm-project/vllm）是当前使用最广泛的 LLM 推理引擎，被 Databricks、Anyscale、众多企业采用。

**架构概览（V1 多进程架构）**：

```
┌─────────────────────────────────────────────┐
│                 API Server                   │
│            (OpenAI-compatible)               │
├─────────────────────────────────────────────┤
│               Core Engine                    │
│  ┌───────────┐  ┌──────────────────────┐    │
│  │ Scheduler  │  │   KV Cache Manager   │    │
│  │ (Continuous│  │   (PagedAttention)   │    │
│  │  Batching) │  │                      │    │
│  └─────┬─────┘  └──────────┬───────────┘    │
│        │                    │                │
│  ┌─────▼────────────────────▼───────────┐    │
│  │          Model Executor               │    │
│  │  ┌─────────┐  ┌─────────┐           │    │
│  │  │ Worker 0 │  │ Worker 1 │  ...     │    │
│  │  │ (GPU 0)  │  │ (GPU 1)  │          │    │
│  │  └─────────┘  └─────────┘           │    │
│  └──────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

**快速部署**：

```bash
# 安装
pip install vllm

# 单 GPU 启动 OpenAI 兼容服务
vllm serve meta-llama/Llama-3.1-8B-Instruct \
  --host 0.0.0.0 \
  --port 8000 \
  --max-model-len 8192 \
  --gpu-memory-utilization 0.9

# 多 GPU 张量并行
vllm serve meta-llama/Llama-3.1-70B-Instruct \
  --tensor-parallel-size 4 \
  --max-model-len 32768

# FP8 量化推理（H100）
vllm serve meta-llama/Llama-3.1-70B-Instruct \
  --quantization fp8 \
  --tensor-parallel-size 2
```

**关键配置参数**：

| 参数 | 说明 | 推荐值 |
|------|------|--------|
| `--gpu-memory-utilization` | GPU 显存使用比例 | 0.85-0.95 |
| `--max-model-len` | 最大序列长度 | 根据业务需求设置 |
| `--max-num-seqs` | 最大并发序列数 | 256（默认） |
| `--block-size` | KV Cache 块大小 | 16（默认） |
| `--enable-chunked-prefill` | 启用分块预填充 | 生产环境建议开启 |
| `--swap-space` | CPU 交换空间(GB) | 4-16 |

**V1 架构的关键改进**：
- **多进程设计**：API Server 和 Engine 运行在不同进程中，API 延迟不受推理计算影响
- **异步调度**：Scheduler 在 GPU 执行当前 Batch 时，预处理下一个 Batch 的 Token
- **Prefix Caching**：通过 `--enable-prefix-caching` 启用自动前缀缓存

### 3.2 SGLang — 结构化生成与多轮对话优化

SGLang（github.com/sgl-project/sglang）在多轮对话、共享前缀场景下有显著优势。

**核心特性**：

```bash
# 启动 SGLang 服务
python -m sglang.launch_server \
  --model-path meta-llama/Llama-3.1-8B-Instruct \
  --port 30000 \
  --tp 1

# 多 GPU
python -m sglang.launch_server \
  --model-path meta-llama/Llama-3.1-70B-Instruct \
  --port 30000 \
  --tp 4 \
  --chunked-prefill-size 8192
```

**RadixAttention 工程细节**：

```python
# SGLang 前端 DSL — 结构化生成
import sglang as sgl

@sgl.function
def multi_turn_chat(s, system_prompt, questions):
    s += sgl.system(system_prompt)  # 共享前缀，自动缓存
    for q in questions:
        s += sgl.user(q)
        s += sgl.assistant(sgl.gen("answer", max_tokens=256))
```

**结构化输出**（基于 FSM/Grammar）：

SGLang 内置了基于有限状态机（FSM）的结构化输出引擎，可以保证 LLM 输出严格符合 JSON Schema：

```python
import sglang as sgl

@sgl.function
def extract_info(s, text):
    s += "Extract information from: " + text
    s += sgl.gen("result", 
                  regex=r'\{"name": "[^"]+", "age": \d+\}')
```

**SGLang vs vLLM 性能对比**（共享前缀场景）：

| 场景 | vLLM TTFT | SGLang TTFT | SGLang 加速比 |
|------|-----------|-------------|--------------|
| 单轮对话（无共享） | 120ms | 115ms | 1.04x |
| 多轮对话（5轮） | 120ms | 35ms | 3.4x |
| Few-shot（8-shot） | 180ms | 40ms | 4.5x |
| RAG（共享文档） | 250ms | 60ms | 4.2x |

### 3.3 TensorRT-LLM — 极致性能优化

TensorRT-LLM（github.com/NVIDIA/TensorRT-LLM）是 NVIDIA 官方的 LLM 推理优化引擎，追求在 NVIDIA GPU 上的极致性能。

**架构特点**：
- **C++/CUDA 核心**：底层全部用 C++ 和 CUDA 实现，比 Python 引擎快 10-30%
- **模型编译**：需要将模型预先转换（compile）为 TensorRT Engine，类似 C++ 代码编译为二进制
- **FP8 内核级优化**：在 Hopper 架构（H100）上使用 FP8 Tensor Core，吞吐量提升 30-50%

**部署流程**：

```bash
# 步骤 1: 转换模型权重
python convert_checkpoint.py \
  --model_dir ./llama-70b \
  --output_dir ./trt_ckpt \
  --tp_size 4 \
  --dtype float16

# 步骤 2: 构建 TensorRT 引擎（耗时较长，约 20-30 分钟）
trtllm-build \
  --checkpoint_dir ./trt_ckpt \
  --output_dir ./trt_engine \
  --max_batch_size 64 \
  --max_input_len 4096 \
  --max_seq_len 8192 \
  --gemm_plugin float16

# 步骤 3: 启动服务
python run.py --engine_dir ./trt_engine --max_output_len 512
```

**适用场景**：
- 大规模固定模型部署（不频繁切换模型）
- 极致吞吐量需求（百万级 QPS）
- NVIDIA GPU 环境（A100/H100/B200）

### 3.4 llama.cpp 与 Ollama — 边缘推理

**llama.cpp**（github.com/ggml-org/llama.cpp）是纯 C/C++ 实现的推理引擎，可在 CPU 上高效运行。

```bash
# 使用 GGUF 量化模型
./llama-server \
  -m models/llama-3.1-8b-instruct-Q4_K_M.gguf \
  --host 0.0.0.0 \
  --port 8080 \
  -ngl 99  # GPU 层数（混合推理）
```

**Ollama**（github.com/ollama/ollama）是 llama.cpp 的用户友好封装：

```bash
# 一键安装运行
ollama run llama3.1:8b

# 启动 API 服务
ollama serve  # 自动监听 11434 端口

# 拉取并运行模型
curl http://localhost:11434/api/generate -d '{
  "model": "llama3.1:8b",
  "prompt": "Hello, world!"
}'
```

**边缘部署选型**：

| 设备 | 推荐引擎 | 量化方案 | 可运行模型 |
|------|----------|---------|-----------|
| MacBook M3 (36GB) | Ollama/llama.cpp | Q4_K_M | 70B |
| PC RTX 4090 (24GB) | vLLM/llama.cpp | FP16/Q8 | 8B-13B FP16, 70B Q4 |
| Jetson Orin (64GB) | llama.cpp | Q4_K_M | 70B |
| 树莓派 5 (8GB) | llama.cpp | Q2_K | 1-3B |

---

## 4. 分布式推理与 GPU 集群管理

### 4.1 并行策略概览

当模型大到单个 GPU 放不下时（如 70B 模型 FP16 需要 ~140GB 显存），需要多 GPU 协作：

```
┌────────────────────────────────────────────────────┐
│              分布式推理并行策略                       │
├────────────┬───────────────┬───────────────────────┤
│ Tensor     │ Pipeline      │ Data Parallel         │
│ Parallelism│ Parallelism   │ (DP)                  │
│ (TP)       │ (PP)          │                       │
│            │               │                       │
│ 模型层内   │ 模型层间      │ 数据维度              │
│ 切分权重   │ 切分层        │ 复制模型              │
│            │               │                       │
│ 降低延迟   │ 省显存        │ 提高吞吐              │
│ 通信密集   │ 流水线气泡    │ 无额外通信            │
└────────────┴───────────────┴───────────────────────┘
```

### 4.2 Tensor Parallelism（TP）

**原理**：将每一层的权重矩阵沿着特定维度切分到多个 GPU 上，每个 GPU 计算部分结果，再通过 AllReduce 汇总。

```
单 GPU:
Input → [W_full] → Output

TP=2:
Input → [W_part1] → Partial1 ─┐
                                ├→ AllReduce → Output
Input → [W_part2] → Partial2 ─┘
```

**适用场景**：同一节点内多 GPU（NVLink 连接，带宽 900 GB/s）
**限制**：跨节点 TP 效率急剧下降（网络带宽成瓶颈）

### 4.3 Pipeline Parallelism（PP）

**原理**：将模型的不同层分配到不同 GPU，数据像流水线一样依次经过各 GPU。

```
GPU 0: [Layer 0-19]  →  GPU 1: [Layer 20-39]  →  GPU 2: [Layer 40-59]  →  GPU 3: [Layer 60-79]
        ↓ 通信               ↓ 通信                ↓ 通信
    Activation            Activation             Activation
```

**适用场景**：跨节点分布式推理（只需传递层间 Activation，数据量远小于 TP 的 AllReduce）

### 4.4 Prefill-Decode 分离架构

在高并发场景下，Prefill（计算密集）和 Decode（内存密集）的资源需求截然不同。先进架构将两者分离：

```
             ┌─────────────┐
             │  Load       │
             │  Balancer   │
             └──────┬──────┘
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
┌─────────────────┐ ┌─────────────────┐
│ Prefill Cluster │ │ Decode Cluster  │
│ (计算密集)       │ │ (内存密集)       │
│ 少量大GPU       │ │ 多个中等GPU      │
│ H100 SXM        │ │ L40S / A10G     │
└────────┬────────┘ └─────────────────┘
         │  KV Cache 传输        ▲
         └───────────────────────┘
```

**实际收益**：
- Prefill 集群可用更少但更强的 GPU（如 4×H100），充分利用计算能力
- Decode 集群可用更多但更便宜的 GPU（如 16×L40S），充分利用显存带宽
- 整体成本降低 30-50%

---

## 5. 量化技术工程实践

### 5.1 量化方案对比

| 方案 | 精度 | 速度提升 | 精度损失 | 适用场景 |
|------|------|---------|---------|---------|
| FP16 | 基线 | 1x | 无 | 训练、精度敏感 |
| FP8 | 8-bit 浮点 | 1.5-2x | 极小 | H100 在线服务 |
| AWQ | 4-bit | 2-3x | 小 | 在线服务 |
| GPTQ | 4-bit | 2-3x | 小 | 离线批处理 |
| GGUF Q4_K_M | 4-bit 混合 | 3-4x* | 中等 | CPU/边缘设备 |
| GGUF Q2_K | 2-bit | 5-6x* | 较大 | 极限压缩 |

> *速度提升为相对于 FP16 在同等硬件上的对比

### 5.2 FP8 量化实践（H100 推荐方案）

```python
# vLLM FP8 量化启动
# 方式一：使用预量化模型
vllm serve neuralmagic/Meta-Llama-3.1-70B-Instruct-FP8 \
  --tensor-parallel-size 4

# 方式二：在线量化（动态 FP8）
vllm serve meta-llama/Llama-3.1-70B-Instruct \
  --quantization fp8 \
  --tensor-parallel-size 4
```

### 5.3 AWQ 量化实践

```python
from awq import AutoAWQForCausalLM
from transformers import AutoTokenizer

# 量化模型
model = AutoAWQForCausalLM.from_pretrained("meta-llama/Llama-3.1-8B-Instruct")
tokenizer = AutoTokenizer.from_pretrained("meta-llama/Llama-3.1-8B-Instruct")

quant_config = {
    "zero_point": True,
    "q_group_size": 128,
    "w_bit": 4,
    "version": "GEMM"
}

model.quantize(tokenizer, quant_config=quant_config)
model.save_quantized("llama-3.1-8b-awq")
```

---

## 6. 生产部署最佳实践

### 6.1 Kubernetes 部署配置

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vllm-inference
  namespace: ai-serving
spec:
  replicas: 2
  selector:
    matchLabels:
      app: vllm-inference
  template:
    metadata:
      labels:
        app: vllm-inference
    spec:
      containers:
      - name: vllm
        image: vllm/vllm-openai:latest
        command:
        - python
        - -m
        - vllm.entrypoints.openai.api_server
        args:
        - --model=meta-llama/Llama-3.1-8B-Instruct
        - --host=0.0.0.0
        - --port=8000
        - --max-model-len=8192
        - --gpu-memory-utilization=0.9
        - --enable-chunked-prefill
        ports:
        - containerPort: 8000
        resources:
          limits:
            nvidia.com/gpu: 1
            memory: "32Gi"
          requests:
            nvidia.com/gpu: 1
            memory: "24Gi"
        livenessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 120
          periodSeconds: 30
          timeoutSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 60
          periodSeconds: 10
        lifecycle:
          preStop:
            exec:
              command: ["/bin/sh", "-c", "sleep 30"]
      terminationGracePeriodSeconds: 60
      nodeSelector:
        nvidia.com/gpu.product: NVIDIA-H100-SXM
```

### 6.2 自动扩缩容

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: vllm-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: vllm-inference
  minReplicas: 1
  maxReplicas: 8
  metrics:
  - type: Pods
    pods:
      metric:
        name: gpu_utilization
      target:
        type: AverageValue
        averageValue: "80"
  - type: Pods
    pods:
      metric:
        name: pending_requests
      target:
        type: AverageValue
        averageValue: "10"
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
      - type: Pods
        value: 2
        periodSeconds: 120
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
      - type: Pods
        value: 1
        periodSeconds: 300
```

### 6.3 健康检查与监控

**核心监控指标**：

| 指标 | 说明 | 告警阈值 |
|------|------|---------|
| TTFT (Time to First Token) | 首 Token 延迟 | P99 > 3s |
| TPS (Tokens per Second) | 生成速度 | < 20 tokens/s |
| GPU Utilization | GPU 利用率 | < 30% 或 > 95% |
| KV Cache Usage | KV Cache 占用率 | > 90% |
| Queue Depth | 等待队列长度 | > 50 |
| Request Error Rate | 请求错误率 | > 1% |

**Prometheus 指标采集**：

```python
# vLLM 内置 Prometheus 指标端点
# 访问 http://localhost:8000/metrics
# 关键指标:
# vllm:num_requests_running     - 正在处理的请求数
# vllm:num_requests_waiting     - 等待中的请求数
# vllm:gpu_cache_usage_perc     - GPU KV Cache 使用率
# vllm:cpu_cache_usage_perc     - CPU KV Cache 使用率
# vllm:avg_generation_throughput_toks_per_s - 平均生成吞吐
```

---

## 7. 性能基准测试与选型指南

### 7.1 基准测试对比（H100 SXM 80GB，Llama-3.1-70B）

| 指标 | vLLM (FP8) | SGLang (FP8) | TensorRT-LLM (FP8) |
|------|-----------|-------------|-------------------|
| 吞吐量 (tokens/s) | ~2,000 | ~2,100 | ~3,200 |
| TTFT P50 | 120ms | 110ms | 100ms |
| TTFT P99 | 350ms | 280ms | 250ms |
| 冷启动时间 | ~1min | ~1min | ~28min |
| 共享前缀 TTFT | 120ms | 35ms | N/A |
| 内存效率 | 优秀 | 优秀 | 良好 |
| 模型切换速度 | 快 | 快 | 极慢 |

### 7.2 选型决策树

```
你的场景是什么？
├── 多轮对话 / 共享系统提示词 / RAG
│   └── → SGLang（RadixAttention 前缀缓存优势明显）
├── 通用在线服务（API 兼容、快速上线）
│   └── → vLLM（生态最成熟、OpenAI API 兼容、社区最大）
├── 极致吞吐量（固定模型、大规模部署）
│   └── → TensorRT-LLM（NVIDIA 原生优化、需要运维能力）
├── 边缘设备 / 本地开发 / CPU 推理
│   └── → llama.cpp / Ollama（轻量、跨平台）
└── 结构化输出（JSON Schema 约束）
    └── → SGLang（内置 FSM 引擎）或 vLLM（Outlines 集成）
```

---

## 8. 常见陷阱与最佳实践

### ❌ 陷阱 1：不设置 max-model-len，使用模型默认最大长度

```bash
# ❌ 错误：使用默认 128K 上下文长度，导致 KV Cache 预留过大
vllm serve meta-llama/Llama-3.1-8B-Instruct

# ✅ 正确：根据实际业务需求设置合理的上下文长度
vllm serve meta-llama/Llama-3.1-8B-Instruct --max-model-len 8192
```

### ❌ 陷阱 2：GPU 利用率设置过高导致 OOM

```bash
# ❌ 错误：设置 0.99，几乎不留余量
vllm serve model --gpu-memory-utilization 0.99

# ✅ 正确：留出 5-15% 的安全余量
vllm serve model --gpu-memory-utilization 0.9
```

### ❌ 陷阱 3：忽略健康检查和优雅关闭

```yaml
# ❌ 错误：无健康检查，模型加载期间就接收流量
# containers:
#   - name: vllm
#     ports:
#       - containerPort: 8000

# ✅ 正确：配置 readinessProbe 确保模型加载完成后才接收流量
readinessProbe:
  httpGet:
    path: /health
    port: 8000
  initialDelaySeconds: 120  # 模型加载需要时间
  periodSeconds: 10
```

### ❌ 陷阱 4：在共享前缀场景下选错引擎

```python
# ❌ 错误：RAG 场景使用 vLLM，每个请求的共享文档前缀都重新计算
# 100 个请求共享相同的 4K 文档上下文，每个都独立计算 Prefill

# ✅ 正确：使用 SGLang 的 RadixAttention，自动缓存共享前缀
# 第一个请求计算完整 Prefill，后续 99 个请求直接复用 KV Cache
```

### ❌ 陷阱 5：跨节点使用 Tensor Parallelism

```bash
# ❌ 错误：跨节点 TP，网络带宽成为瓶颈
# Node1-GPU0 + Node2-GPU0 做 TP=2（延迟增加 10-50 倍）

# ✅ 正确：节点内 TP + 节点间 PP
# Node1: TP=4（4 个 GPU 做 Tensor Parallel）
# Node2: PP=2（与 Node1 做 Pipeline Parallel）
vllm serve model --tensor-parallel-size 4 --pipeline-parallel-size 2
```

### ❌ 陷阱 6：不做基准测试直接上线

```bash
# ❌ 错误：凭感觉设置参数直接部署

# ✅ 正确：使用基准测试工具验证性能
# vLLM 内置 benchmark 工具
python -m vllm.entrypoints.openai.api_server &
python benchmarks/benchmark_serving.py \
  --backend vllm \
  --model meta-llama/Llama-3.1-8B-Instruct \
  --num-prompts 1000 \
  --request-rate 10
```

---

## 9. 延伸与前沿

### 9.1 推测解码（Speculative Decoding）

使用一个小模型（Draft Model）快速生成候选 Token 序列，再用大模型一次性验证，可加速 2-3 倍而不损失精度：

```bash
# vLLM 推测解码
vllm serve meta-llama/Llama-3.1-70B-Instruct \
  --speculative-model meta-llama/Llama-3.1-8B-Instruct \
  --num-speculative-tokens 5
```

### 9.2 Prefill-Decode 分离的商业化实践

- **Mooncake**（月之暗面）：开源了 Prefill-Decode 分离的推理框架
- **DeepSeek**：在 V3 模型中使用了 EP（Expert Parallelism）+ PP 的混合策略
- **Groq**：使用专用 LPU 硬件实现了极低延迟推理

### 9.3 长上下文推理优化

- **Ring Attention**：将长序列分块到多个 GPU，每个 GPU 处理一部分序列，通过 Ring 通信传递 KV
- **Infinite Context**：通过 KV Cache 压缩和蒸馏，在有限显存中支持百万级上下文
- **MLA（Multi-Latent Attention）**：DeepSeek-V3 的创新，将 KV Cache 压缩到低维潜在空间，显存节省 90%+

### 9.4 2026 年趋势

1. **FP4 量化**：NVIDIA Blackwell 架构（B200）原生支持 FP4，吞吐量将进一步翻倍
2. **统一推理引擎**：vLLM 和 SGLang 正在互相学习对方的优势，未来可能趋同
3. **Serverless 推理**：按 Token 计费的 Serverless 推理平台（如 Modal、Replicate）正在兴起
4. **异构推理**：CPU + GPU + NPU 混合推理，根据负载动态调度
