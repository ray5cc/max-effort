# LLM 推理引擎与优化技术

> 本文系统讲解大语言模型**推理加速**的核心技术：KV Cache 管理、内存分页（PagedAttention）、连续批处理（Continuous Batching）、模型量化（Quantization）及 CPU 端高效推理，并以 vLLM、TensorRT-LLM、llama.cpp 为参考实现。

## 相关链接

- 对应面试题：[01-LLM推理引擎面试题](../../02-面试指南/05-系统设计面试/01-LLM推理引擎面试题.md)
- 对应面试题（llama.cpp）：[15-LLM推理引擎面试题](../../02-面试指南/07-AI-Agent全栈开发面试/15-LLM推理引擎面试题.md)（llama.cpp 专题已合并至此）

## 目录

1. [什么是 vLLM](#1-什么是-vllm)
2. [核心创新：PagedAttention](#2-核心创新pagedattention)
3. [传统 KV Cache 的内存浪费问题](#3-传统-kv-cache-的内存浪费问题)
4. [PagedAttention 深度解析](#4-pagedattention-深度解析)
5. [Continuous Batching（连续批处理）](#5-continuous-batching连续批处理)
6. [性能数据与对比](#6-性能数据与对比)
7. [OpenAI 兼容 API 服务](#7-openai-兼容-api-服务)

---


## 1. 什么是 vLLM

vLLM（**v**irtual **LLM**）是 UC Berkeley Sky Computing Lab 于 2023 年发布的开源 LLM 推理框架，论文标题为 *"Efficient Memory Management for Large Language Model Serving with PagedAttention"*（SOSP 2023）。

### 核心定位

```mermaid
flowchart LR
    U["用户请求"] --> API["OpenAI Compatible API"]
    API --> E["vLLM Engine"]
    E --> PA["PagedAttention
Continuous Batching
Multi-GPU Support"]
    PA --> GPU["GPU 推理加速"]

    style U fill:#6b7280,color:#fff,stroke:#4b5563
    style API fill:#4a9eff,color:#fff,stroke:#2563eb
    style E fill:#f59e0b,color:#fff,stroke:#d97706
    style PA fill:#10b981,color:#fff,stroke:#059669
    style GPU fill:#8b5cf6,color:#fff,stroke:#7c3aed
```

### 主要特性

| 特性 | 说明 |
|------|------|
| **PagedAttention** | 分页式 KV Cache 管理，消除内存碎片 |
| **Continuous Batching** | 动态批处理，最大化 GPU 利用率 |
| **OpenAI 兼容 API** | 无缝替换 OpenAI API，零改造成本 |
| **多模型支持** | LLaMA、Mistral、Mixtral、Qwen、GPT-2/J/NeoX 等 |
| **多 GPU 支持** | 张量并行、流水线并行 |
| **量化支持** | AWQ、GPTQ、INT8、FP8 |

---

## 2. 核心创新：PagedAttention

### 问题背景：为什么需要 PagedAttention？

LLM 推理的核心计算是 Attention 机制。对于自回归生成，每个 token 的生成需要访问之前所有 token 的 Key 和 Value，这些数据被缓存为 **KV Cache**。

```
自回归生成过程：

Prompt: "The capital of France is"
Step 1: 生成 "Paris"      → KV Cache 包含 6 个 token 的 K、V
Step 2: 生成 ","          → KV Cache 包含 7 个 token 的 K、V
Step 3: 生成 "which"      → KV Cache 包含 8 个 token 的 K、V
...

每步都需要读取并更新 KV Cache
```

### KV Cache 的内存占用

对于 LLaMA-13B（单请求）：

```
KV Cache 大小 = 2 × num_layers × num_heads × head_dim × seq_len × sizeof(float16)

LLaMA-13B 参数：
- num_layers = 40
- num_heads  = 40  
- head_dim   = 128
- seq_len    = 2048

每请求 KV Cache ≈ 2 × 40 × 40 × 128 × 2048 × 2 bytes ≈ 1.6 GB
```

---

## 3. 传统 KV Cache 的内存浪费问题

### 问题一：预留内存过多（Over-reservation）

传统系统在请求开始时为整个最大序列长度预分配内存：

```
传统分配方式：

请求 A (实际用 200 tokens, 预留 2048)：
[████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]
  已用 ~10%          浪费 ~90%

请求 B (实际用 150 tokens, 预留 2048)：
[██████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]
  已用 ~7%           浪费 ~93%
```

**结果**：GPU 内存的 60-80% 被浪费，严重限制并发数量。

### 问题二：内存碎片（Fragmentation）

```
时间线：
t=0: 请求A(长)  请求B(短)  请求C(中)  [空闲]
     [AAAAAAAA][BBBB][CCCCCC][          ]

t=5: 请求B 完成
     [AAAAAAAA][    ][CCCCCC][          ]
                ^^^^
              碎片！新请求可能放不进去

t=8: 新请求D需要比[    ]更大的空间，但总空闲足够
     → 无法放入 → 内存利用率低
```

### 问题三：并发数量受限

```
24GB GPU（如 RTX 3090）运行 LLaMA-7B：
- 模型权重：约 14GB
- 可用 KV Cache：约 10GB
- 每请求预留 2048 tokens：约 1GB

最大并发 ≈ 10 个请求（实际吞吐极低）
```

---

## 4. PagedAttention 深度解析

### 核心思想：操作系统虚拟内存类比

PagedAttention 借鉴操作系统的虚拟内存和分页机制：

```diagram
操作系统虚拟内存          PagedAttention KV Cache
─────────────────         ──────────────────────────
虚拟地址空间       ←→     逻辑 KV 块（Logical Block）
物理内存页框       ←→     物理 KV 块（Physical Block）  
页表（Page Table） ←→     块表（Block Table）
按需分配           ←→     动态分配 KV 块
页面置换           ←→     KV 块抢占/换出
```

### 逻辑块与物理块

```diagram
逻辑视图（请求视角）：
Request A: [Block 0][Block 1][Block 2][Block 3]
           token 0-3  4-7     8-11    12-15

物理内存（实际布局）：
Physical Memory:
┌────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐
│ P7 │ P3 │ P1 │ P9 │ P2 │ P5 │ P4 │ P6 │ P8 │ P0 │
└────┴────┴────┴────┴────┴────┴────┴────┴────┴────┘

Block Table（块表映射）：
Request A:
  Logical 0 → Physical 3
  Logical 1 → Physical 7  
  Logical 2 → Physical 1
  Logical 3 → Physical 9
```

### Block 的参数配置

```python
# vLLM 中的 Block 配置
block_size = 16        # 每个 block 存储 16 个 token 的 KV
num_gpu_blocks = 1000  # GPU 上总共 1000 个物理块
num_cpu_blocks = 5000  # CPU 上总共 5000 个物理块（用于换出）

# 每个物理块的内存大小（LLaMA-7B 示例）
block_memory = block_size × num_layers × 2 × num_heads × head_dim × dtype_size
             = 16 × 32 × 2 × 32 × 128 × 2 bytes
             ≈ 8 MB per block
```

### Copy-on-Write for Beam Search

Beam Search 需要维护多个候选序列（beam），这些序列共享前缀：

```diagram
Beam Search (beam_width=3):

Prompt: "The weather today is"
         └─ 共享前缀 KV Cache（逻辑块 0、1）

分叉点：
  Beam 1: "sunny"  → 新建物理块 P_A
  Beam 2: "cloudy" → 新建物理块 P_B  
  Beam 3: "rainy"  → 新建物理块 P_C

内存布局（CoW 机制）：
Beam 1 块表: [P_shared_0, P_shared_1, P_A, ...]
Beam 2 块表: [P_shared_0, P_shared_1, P_B, ...]  
Beam 3 块表: [P_shared_0, P_shared_1, P_C, ...]
              ↑─── 共享，引用计数=3 ───↑

当 Beam 2 需要修改共享块时：
  → 触发 Copy-on-Write
  → 复制物理块为 P_shared_1_copy
  → Beam 2 块表更新为 P_shared_1_copy
  → 原块引用计数从 3 降到 2
```

### 内存节省效果

```
传统方式 vs PagedAttention：

传统方式（3个并发请求，最大长度2048）：
  占用 = 3 × 2048 tokens × KV_size_per_token = 3 × 1GB = 3GB
  实际使用 = 3 × 200 tokens = 0.3GB
  内存利用率 = 10%

PagedAttention：
  占用 = 按实际使用量分配
  200 tokens = 200/16 ≈ 13 个块 × 8MB = 104MB 每请求
  3个请求 = 312MB
  内存利用率 ≈ 97%（仅最后一块有少量内部碎片）
```

---

## 5. Continuous Batching（连续批处理）

### 静态批处理的问题

```
静态批处理（Static Batching）：

时间线：
Batch: [Req_A(需200步), Req_B(需50步), Req_C(需180步)]

Step 1-50:   A、B、C 都在计算 ✓
Step 51-180: A、C 在计算，B 已完成但 GPU slot 被占 ✗
Step 181-200: 只有 A 在计算，C 完成但 slot 占用 ✗

GPU 利用率随时间递减，后期严重浪费
```

### 连续批处理（Iteration-Level Scheduling）

```
Continuous Batching：

每个推理步骤（iteration）都可以动态调整批次：

Step 1:   [A, B, C] 在批次中
Step 50:  [A, B, C] B 生成完毕
Step 51:  [A, C, D] B 退出，新请求 D 立即加入！
Step 100: [A, C, D] D 生成完毕  
Step 101: [A, C, E] D 退出，E 加入
...

GPU 始终保持满负荷运行 ✓
```

### 调度器决策流程

```diagram
每个 Step 的调度逻辑：

┌─────────────────────────────────────────────┐
│ 等待队列（Waiting Queue）                    │
│ [Req_E, Req_F, Req_G, ...]                  │
└──────────────────┬──────────────────────────┘
                   │ 有空闲 KV 块时
                   ▼
┌─────────────────────────────────────────────┐
│ 运行队列（Running Queue）                    │
│ [Req_A, Req_B, Req_C, Req_D]               │
│ 当前正在 GPU 上推理                          │
└──────────────────┬──────────────────────────┘
                   │ 内存不足时（抢占）
                   ▼
┌─────────────────────────────────────────────┐
│ 换出队列（Swapped Queue）                    │
│ KV Cache 换出到 CPU 内存                    │
└─────────────────────────────────────────────┘
```

### Chunked Prefill（分块预填充）

```python
# vLLM v0.3+ 引入 Chunked Prefill
# 将长 Prompt 的 prefill 阶段分块，与 decode 阶段交织执行

# 问题：长 prompt prefill 时间很长，阻塞其他请求的 decode
# 解决：将 prefill 分成多个 chunk

# 配置示例
engine_args = EngineArgs(
    model="meta-llama/Llama-2-7b-chat-hf",
    enable_chunked_prefill=True,
    max_num_batched_tokens=2048,  # 每个 iteration 最多处理的 token 数
)
```

---

## 6. 性能数据与对比

### vLLM 官方 Benchmark 结果

```diagram
测试环境：A100-40GB，LLaMA-7B，ShareGPT 数据集

吞吐量对比（tokens/second）：
┌──────────────────────────┬──────────────────┐
│ 框架                     │ 吞吐量 (tok/s)   │
├──────────────────────────┼──────────────────┤
│ HuggingFace Transformers │ ~500             │
│ TGI (Text Gen Inference) │ ~2,000           │
│ FasterTransformer        │ ~3,000           │
│ vLLM                     │ ~12,000          │
└──────────────────────────┴──────────────────┘

vLLM 对比 HuggingFace: 约 24x 吞吐量提升
vLLM 对比 TGI:          约 6x  吞吐量提升
```

### 内存效率对比

```
并发请求数 vs 内存占用：

HuggingFace（静态批处理）：
  最大并发 = 10-15 个请求（2048 max_len, 7B 模型, A100-40G）

vLLM（PagedAttention）：
  最大并发 = 40-60 个请求（相同条件）
  KV Cache 利用率 > 90%（vs 传统 ~50-60%）
```

---

## 7. OpenAI 兼容 API 服务

vLLM 提供与 OpenAI API 完全兼容的服务端点，支持 `/v1/chat/completions`、`/v1/completions`、`/v1/embeddings`。

```python
# 启动 vLLM OpenAI 兼容服务
python -m vllm.entrypoints.openai.api_server \
    --model meta-llama/Llama-2-7b-chat-hf \
    --host 0.0.0.0 \
    --port 8000 \
    --tensor-parallel-size 2

# 使用 OpenAI Python SDK 调用（零改造）
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8000/v1",
    api_key="token-abc123",  # 任意字符串
)

response = client.chat.completions.create(
    model="meta-llama/Llama-2-7b-chat-hf",
    messages=[
        {"role": "user", "content": "Explain PagedAttention in simple terms"}
    ],
    temperature=0.7,
    max_tokens=512,
)

print(response.choices[0].message.content)
```

### API 端点列表

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v1/chat/completions` | POST | Chat 对话生成（兼容 ChatGPT） |
| `/v1/completions` | POST | 文本补全 |
| `/v1/embeddings` | POST | 文本向量化 |
| `/v1/models` | GET | 列出可用模型 |
| `/health` | GET | 健康检查 |
| `/metrics` | GET | Prometheus 指标 |

---

## 总结

```diagram
vLLM 技术栈全景：

                    ┌─────────────────────────┐
                    │   OpenAI Compatible API  │
                    │   FastAPI + uvicorn      │
                    └───────────┬─────────────┘
                                │
                    ┌───────────▼─────────────┐
                    │      LLMEngine          │
                    │   Scheduler + Tokenizer  │
                    └───────────┬─────────────┘
                                │
              ┌─────────────────┼──────────────────┐
              │                 │                  │
    ┌─────────▼──────┐ ┌────────▼───────┐ ┌───────▼────────┐
    │ BlockSpaceManager│ │  CacheEngine  │ │   Worker(s)   │
    │  PagedAttention  │ │ GPU/CPU Swap  │ │ Model Executor │
    └──────────────────┘ └───────────────┘ └────────────────┘
              │                                    │
    ┌─────────▼──────────────────────────────────▼────────┐
    │                    GPU Memory                        │
    │         Model Weights | KV Cache Blocks              │
    └──────────────────────────────────────────────────────┘
```

**核心价值**：PagedAttention + Continuous Batching 的组合，使 vLLM 成为目前生产环境 LLM 推理的首选方案之一，在保证低延迟的同时实现了业界领先的吞吐量。


---


## 1. LLMEngine 整体架构

### 组件关系图

```diagram
LLMEngine
├── Tokenizer                    # 分词器
├── Scheduler                    # 调度器
│   └── BlockSpaceManager        # 块空间管理器
├── WorkerGroup                  # 工作进程组
│   ├── Worker 0 (GPU 0)         # 工作进程
│   │   ├── ModelRunner          # 模型执行器
│   │   └── CacheEngine          # KV Cache 引擎
│   ├── Worker 1 (GPU 1)
│   └── ...
└── OutputProcessor              # 输出处理器
    └── Sampler                  # 采样器
```

### 推理请求生命周期

```diagram
客户端请求
    │
    ▼ add_request()
┌───────────────────────────────────────────┐
│  LLMEngine                                │
│                                           │
│  1. Tokenize: text → input_ids            │
│  2. Create SequenceGroup                  │
│  3. Add to Scheduler.waiting_queue        │
└───────────────┬───────────────────────────┘
                │ step() 循环（每个 iteration）
                ▼
┌───────────────────────────────────────────┐
│  Scheduler._schedule()                    │
│  • 从 waiting/running/swapped 选择序列    │
│  • 分配/释放/换入换出 KV 块               │
│  • 返回 SchedulerOutputs                 │
└───────────────┬───────────────────────────┘
                │ execute_model()
                ▼
┌───────────────────────────────────────────┐
│  WorkerGroup (分布式执行)                 │
│  • 并行执行模型 forward pass              │
│  • GPU 间 AllReduce（张量并行时）         │
│  • 返回 logits                            │
└───────────────┬───────────────────────────┘
                │
                ▼
┌───────────────────────────────────────────┐
│  Sampler                                  │
│  • 应用 temperature, top-p, top-k        │
│  • 生成下一个 token                       │
│  • 检查停止条件（EOS、max_tokens）        │
└───────────────┬───────────────────────────┘
                │
                ▼
           返回 RequestOutput
```

### 核心数据结构

```python
# 序列（单条生成路径）
class Sequence:
    seq_id: int
    prompt: str
    prompt_token_ids: List[int]
    output_token_ids: List[int]
    logical_token_blocks: List[LogicalTokenBlock]
    status: SequenceStatus  # WAITING / RUNNING / SWAPPED / FINISHED

# 序列组（一个请求可能对应多条序列，如 beam search）
class SequenceGroup:
    request_id: str
    seqs: List[Sequence]        # beam_width 个序列
    sampling_params: SamplingParams
    arrival_time: float

# 逻辑 Token 块
class LogicalTokenBlock:
    block_number: int           # 逻辑块编号
    block_size: int             # 块大小（默认 16）
    token_ids: List[int]        # 存储的 token ID
    num_tokens: int             # 当前已填充的 token 数
```

---

## 2. BlockSpaceManager：内存块管理

### 物理块分配器

```python
class BlockAllocator:
    """管理物理 KV 块的分配与释放"""
    
    def __init__(self, device: str, block_size: int, num_blocks: int):
        self.free_blocks: List[PhysicalTokenBlock] = []
        # 初始化时所有块都是空闲的
        for i in range(num_blocks):
            self.free_blocks.append(
                PhysicalTokenBlock(device=device, block_number=i, 
                                   block_size=block_size)
            )
    
    def allocate(self) -> PhysicalTokenBlock:
        """分配一个空闲物理块"""
        if not self.free_blocks:
            raise MemoryError("No free blocks available")
        block = self.free_blocks.pop()
        block.ref_count = 1
        return block
    
    def free(self, block: PhysicalTokenBlock) -> None:
        """释放物理块（引用计数降为 0 时回收）"""
        block.ref_count -= 1
        if block.ref_count == 0:
            self.free_blocks.append(block)
```

### 逻辑到物理的映射

```diagram
BlockSpaceManager 维护每个序列的块表（Block Table）：

Sequence A 的块表：
┌─────────────────────────────────────────────────────────┐
│ Logical Block │ Physical Block │ ref_count               │
├───────────────┼────────────────┼─────────────────────────┤
│     0         │      P7        │   1                     │
│     1         │      P2        │   1                     │
│     2         │      P15       │   1                     │
│     3         │      P9        │   1 (last, partially filled)│
└─────────────────────────────────────────────────────────┘

Prefix Sharing（前缀共享）：
若 Sequence B 有相同的前缀（System Prompt）：
┌─────────────────────────────────────────────────────────┐
│ Logical Block │ Physical Block │ ref_count               │
├───────────────┼────────────────┼─────────────────────────┤
│     0         │      P7        │   2 (与 A 共享!)        │
│     1         │      P2        │   2 (与 A 共享!)        │
│     2         │      P18       │   1                     │
└─────────────────────────────────────────────────────────┘
```

### Copy-on-Write 实现

```python
def fork_sequence(self, parent_seq: Sequence, child_seq: Sequence):
    """Beam Search 时 fork 序列，使用 CoW"""
    src_block_table = self.block_tables[parent_seq.seq_id]
    
    # 子序列共享父序列的所有物理块
    for block in src_block_table:
        block.ref_count += 1  # 增加引用计数
    
    self.block_tables[child_seq.seq_id] = src_block_table.copy()
    
    # 触发 CoW：当需要写入共享块时
    # (最后一个块通常需要写入新 token)
    last_block = src_block_table[-1]
    if last_block.ref_count > 1:
        # 复制最后一个块
        new_block = self.gpu_allocator.allocate()
        self._copy_block(src=last_block, dst=new_block)
        last_block.ref_count -= 1
        self.block_tables[child_seq.seq_id][-1] = new_block
```

---

## 3. Scheduler：调度策略

### FCFS 与抢占机制

```python
class Scheduler:
    """vLLM 默认调度器：FCFS + 抢占"""
    
    def _schedule(self) -> SchedulerOutputs:
        # 三个队列
        waiting   # 等待 prefill 的请求（FIFO）
        running   # 正在 decode 的请求
        swapped   # KV Cache 被换出到 CPU 的请求
        
        # 调度优先级：
        # 1. 优先从 swapped 换入（避免长时间等待）
        # 2. 调度 waiting 中的新请求做 prefill
        # 3. 继续 running 中的 decode
        
        # 内存不足时的抢占策略：
        # - Swapping：将请求的 KV Cache 换出到 CPU
        # - Recomputation：丢弃 KV Cache，等内存充足时重新计算
```

### 调度决策流程图

```diagram
_schedule() 执行流程：

开始
  │
  ▼
处理 swapped 队列
  ├── 有空闲 GPU 块？
  │    YES → 换入 KV Cache，移回 running
  │    NO  → 保持 swapped
  │
  ▼
处理 waiting 队列（prefill 新请求）
  ├── 有足够 GPU 块？
  │    YES → 分配块，开始 prefill，移入 running
  │    NO  → 触发抢占
  │           ├── swapping 策略：最老的 running 请求换出
  │           └── recomputation 策略：最老的重新入队
  │
  ▼
处理 running 队列（继续 decode）
  ├── 每个序列分配下一个 token 的 KV 块
  ├── 检查是否完成（EOS/max_tokens）
  └── 返回 SchedulerOutputs
```

### Priority Scheduling（优先级调度）

```python
# 为请求设置优先级
from vllm import LLMEngine, SamplingParams

engine.add_request(
    request_id="vip-001",
    prompt="高优先级请求",
    sampling_params=SamplingParams(max_tokens=100),
    priority=0,    # 0 = 最高优先级
)

engine.add_request(
    request_id="normal-001", 
    prompt="普通请求",
    sampling_params=SamplingParams(max_tokens=100),
    priority=1,    # 1 = 普通优先级
)
```

### Chunked Prefill 配置

```python
# Chunked Prefill：将大 prefill 分成小块，与 decode 交织
# 好处：降低 prefill 对 decode 延迟的影响（TTFT vs TPOT 权衡）

from vllm import LLM

llm = LLM(
    model="meta-llama/Llama-2-7b-chat-hf",
    enable_chunked_prefill=True,
    max_num_batched_tokens=512,   # 每次最多 512 个 token
    max_num_seqs=256,              # 最大并发序列数
)
```

---

## 4. Worker 与模型并行

### 张量并行（Tensor Parallelism）

```diagram
张量并行将注意力头和 FFN 层分布到多个 GPU：

GPU 0                    GPU 1
┌──────────────────┐    ┌──────────────────┐
│ Attention        │    │ Attention        │
│  Head 0-15       │    │  Head 16-31      │
│                  │    │                  │
│ FFN              │    │ FFN              │
│  Col 0-2047      │    │  Col 2048-4095   │
└────────┬─────────┘    └─────────┬────────┘
         │                        │
         └──────── AllReduce ──────┘
                  (同步梯度/激活值)
```

```python
# 多 GPU 张量并行配置
from vllm import LLM

llm = LLM(
    model="meta-llama/Llama-2-70b-chat-hf",
    tensor_parallel_size=4,    # 4 个 GPU 张量并行
    dtype="float16",
)

# Worker 初始化（每个 GPU 一个 Worker）
# Worker 0: GPU 0, rank=0, local_rank=0
# Worker 1: GPU 1, rank=1, local_rank=1
# ...
```

### 流水线并行（Pipeline Parallelism）

```diagram
流水线并行将模型层分布到多个 GPU：

GPU 0（Layer 0-9）    GPU 1（Layer 10-19）   GPU 2（Layer 20-31）
┌─────────────────┐  ┌─────────────────────┐  ┌─────────────────┐
│  Embedding      │  │  Transformer 10-19  │  │  Transformer    │
│  Transformer    │→ │                     │→ │  20-31          │
│  0-9            │  │                     │  │  LM Head        │
└─────────────────┘  └─────────────────────┘  └─────────────────┘

micro-batch 1 → GPU0 → GPU1 → GPU2 → 输出
micro-batch 2 → GPU0 → GPU1 → GPU2 → 输出（流水线方式）
```

```python
# 张量并行 + 流水线并行组合
llm = LLM(
    model="meta-llama/Llama-2-70b-chat-hf",
    tensor_parallel_size=2,    # 每个流水线阶段 2 GPU 张量并行
    pipeline_parallel_size=2,  # 2 个流水线阶段
    # 总共使用 2×2 = 4 个 GPU
)
```

### Worker 内部结构

```python
class Worker:
    """在单个 GPU 上执行推理的工作进程"""
    
    def __init__(self, model_config, parallel_config, ...):
        self.model_runner = ModelRunner(...)    # 模型前向传播
        self.cache_engine = CacheEngine(...)   # KV Cache 管理
        
    def execute_model(self, seq_group_metadata_list, 
                      blocks_to_swap_in, blocks_to_swap_out,
                      blocks_to_copy):
        # 1. 执行 KV Cache 的换入/换出/复制
        self.cache_engine.swap_in(blocks_to_swap_in)
        self.cache_engine.swap_out(blocks_to_swap_out)
        self.cache_engine.copy(blocks_to_copy)
        
        # 2. 准备输入 tensor
        input_tokens, input_positions, ... = \
            self.model_runner.prepare_input_tensors(seq_group_metadata_list)
        
        # 3. 执行模型前向传播
        output = self.model_runner.execute_model(input_tokens, ...)
        
        return output
```

---

## 5. Sampler：采样策略

### 支持的采样方法

```python
from vllm import SamplingParams

# Greedy（贪婪解码）
params = SamplingParams(temperature=0.0)

# Temperature Sampling（温度采样）
params = SamplingParams(
    temperature=0.8,   # 0=greedy, 1=原始分布, >1=更随机
)

# Top-P Sampling（核采样）
params = SamplingParams(
    temperature=0.8,
    top_p=0.9,         # 从累积概率 90% 的 token 中采样
)

# Top-K Sampling
params = SamplingParams(
    temperature=0.8,
    top_k=50,          # 从概率最高的 50 个 token 中采样
)

# Beam Search
params = SamplingParams(
    use_beam_search=True,
    best_of=4,         # beam width = 4
    temperature=0.0,
)

# 停止条件
params = SamplingParams(
    max_tokens=512,
    stop=["</s>", "\n\n"],   # 遇到这些字符串停止
    stop_token_ids=[2],       # 遇到这些 token ID 停止
)
```

### 采样流程

```diagram
Logits（未归一化分数）
      │
      ▼ apply_temperature(logits / temperature)
Scaled Logits
      │
      ▼ apply_top_k(only keep top-k logits)
Filtered Logits
      │  
      ▼ apply_top_p(cumulative prob filter)
More Filtered Logits
      │
      ▼ softmax → probabilities
Probabilities
      │
      ▼ multinomial_sample()
Next Token ID
      │
      ▼ check_stop_conditions()
      ├── EOS token → FINISHED_STOPPED
      ├── stop string → FINISHED_STOPPED
      ├── max_tokens → FINISHED_LENGTH_CAPPED
      └── continue → 下一个 step
```

---

## 6. AsyncLLMEngine：异步引擎

### 异步 vs 同步引擎

```python
# 同步引擎（适合批量离线推理）
from vllm import LLM, SamplingParams

llm = LLM(model="meta-llama/Llama-2-7b-chat-hf")
outputs = llm.generate(["Hello, world!"], SamplingParams(max_tokens=100))

# 异步引擎（适合在线服务）
from vllm.engine.async_llm_engine import AsyncLLMEngine
from vllm.engine.arg_utils import AsyncEngineArgs

engine_args = AsyncEngineArgs(
    model="meta-llama/Llama-2-7b-chat-hf",
    tensor_parallel_size=2,
)
engine = AsyncLLMEngine.from_engine_args(engine_args)

# 异步流式生成
async def generate_stream(prompt: str):
    sampling_params = SamplingParams(temperature=0.8, max_tokens=100)
    request_id = "req-001"
    
    async for output in engine.generate(prompt, sampling_params, request_id):
        # 每生成一个 token 就 yield 一次
        yield output.outputs[0].text
```

### 异步引擎架构

```diagram
AsyncLLMEngine
├── _engine_loop()                 # 后台循环（独立 asyncio task）
│   └── 不断调用 engine.step()
├── generate()                     # 异步生成器
│   ├── add_request()              # 添加请求
│   └── async for output in ...   # 等待输出
└── RequestTracker                 # 请求追踪器
    ├── new_requests_event         # 通知 engine_loop 有新请求
    └── stream_outputs             # 每个请求的输出队列

并发模型：
多个 generate() 协程 ──► RequestTracker ──► engine_loop ──► GPU
                         (异步队列)         (单线程循环)
```

---

## 7. 模型支持与量化

### 支持的模型架构

| 架构 | 代表模型 |
|------|---------|
| LlamaForCausalLM | LLaMA 1/2/3, Vicuna, Alpaca |
| MistralForCausalLM | Mistral-7B |
| MixtralForCausalLM | Mixtral-8x7B, 8x22B |
| Qwen2ForCausalLM | Qwen2-7B/72B |
| GPT2LMHeadModel | GPT-2 |
| GPTNeoXForCausalLM | Pythia, GPT-NeoX |
| PhiForCausalLM | Phi-2, Phi-3 |
| GemmaForCausalLM | Gemma 2B/7B |
| Starcoder2ForCausalLM | StarCoder2 |

### 量化方案对比

```diagram
量化方案性能对比（LLaMA-7B, A100-40GB）：

精度/显存/吞吐量权衡：
┌────────────┬──────────┬──────────┬──────────────────────────┐
│ 方案       │ 精度损失 │ 显存节省 │ 特点                     │
├────────────┼──────────┼──────────┼──────────────────────────┤
│ FP16/BF16  │ 无       │ 基准     │ 默认，最高精度            │
│ INT8 W8A8  │ 极小     │ ~50%     │ 速度快，需要校准数据      │
│ AWQ W4A16  │ 小       │ ~75%     │ 仅权重量化，激活值 FP16  │
│ GPTQ W4A16 │ 小       │ ~75%     │ 训练后量化，精度接近 FP16│
│ FP8 W8A8   │ 极小     │ ~50%     │ H100 专用，硬件加速      │
└────────────┴──────────┴──────────┴──────────────────────────┘
```

```python
# AWQ 量化模型加载
llm = LLM(
    model="TheBloke/Llama-2-7B-Chat-AWQ",
    quantization="awq",
    dtype="auto",
)

# GPTQ 量化模型加载
llm = LLM(
    model="TheBloke/Llama-2-7B-Chat-GPTQ",
    quantization="gptq",
)

# FP8 量化（H100 GPU）
llm = LLM(
    model="meta-llama/Meta-Llama-3-8B",
    quantization="fp8",
    kv_cache_dtype="fp8",
)
```

---

## 8. Speculative Decoding

### 原理：Draft Model + Verification

```
Speculative Decoding 流程：

Step 1: 小模型（Draft Model）连续生成 K 个候选 token
        Draft: [tok_1, tok_2, tok_3, tok_4]（gamma=4）

Step 2: 大模型（Target Model）并行验证所有候选
        Target: 一次 forward pass 同时处理 gamma+1 个位置
        
Step 3: 验证结果
        ✓ tok_1 = 接受
        ✓ tok_2 = 接受  
        ✓ tok_3 = 接受
        ✗ tok_4 = 拒绝 → 从 target 分布中重采样

好处：每次 target model forward pass 平均接受 2-4 个 token
      而不是原来的 1 个 → 2-4x 速度提升！
```

```python
# vLLM 中使用 Speculative Decoding
llm = LLM(
    model="meta-llama/Llama-2-70b-chat-hf",     # 大模型（target）
    speculative_model="meta-llama/Llama-2-7b-chat-hf",  # 小模型（draft）
    num_speculative_tokens=5,    # 每次推测 5 个 token
    speculative_draft_tensor_parallel_size=1,
)

# 或使用 ngram 作为 draft model（无需额外模型）
llm = LLM(
    model="meta-llama/Llama-2-70b-chat-hf",
    speculative_model="[ngram]",
    num_speculative_tokens=5,
    ngram_prompt_lookup_max=4,
)
```

---

## 架构总结

```diagram
vLLM 完整组件图：

┌─────────────────────────────────────────────────────────────────────┐
│                          vLLM Engine                                │
│                                                                     │
│  ┌─────────────┐    ┌────────────────────────────────────────────┐ │
│  │  Tokenizer  │    │              Scheduler                     │ │
│  │  HuggingFace│    │  ┌──────────┐ ┌────────┐ ┌─────────────┐  │ │
│  │  Tokenizers │    │  │ Waiting  │ │Running │ │   Swapped   │  │ │
│  └─────────────┘    │  │  Queue   │ │ Queue  │ │    Queue    │  │ │
│                     │  └──────────┘ └────────┘ └─────────────┘  │ │
│                     │         BlockSpaceManager                  │ │
│                     └────────────────────────────────────────────┘ │
│                                      │                              │
│                     ┌────────────────▼───────────────────────────┐ │
│                     │           Worker Group                      │ │
│                     │  ┌──────────────┐  ┌──────────────────────┐│ │
│                     │  │   Worker 0   │  │      Worker N        ││ │
│                     │  │ ModelRunner  │  │    ModelRunner       ││ │
│                     │  │ CacheEngine  │  │    CacheEngine       ││ │
│                     │  └──────┬───────┘  └──────────┬───────────┘│ │
│                     │         └───── NCCL ────────────┘           │ │
│                     └───────────────────────────────────────────── ┘ │
└─────────────────────────────────────────────────────────────────────┘
```


---


## 1. 安装与快速上手

### 环境要求

```
硬件要求：
- GPU: NVIDIA GPU（Compute Capability ≥ 7.0）
  ✓ A100, H100, A10G, L40S（推荐）
  ✓ RTX 3090, RTX 4090（开发测试）
  ✗ 不支持 AMD GPU（ROCm 实验性支持）

软件要求：
- Python 3.8-3.12
- CUDA 11.8 或 12.x
- PyTorch 2.x
```

### 安装

```bash
# 方式1：pip 安装（推荐）
pip install vllm

# 方式2：指定 CUDA 版本
pip install vllm --extra-index-url https://download.pytorch.org/whl/cu121

# 方式3：从源码安装（最新特性）
git clone https://github.com/vllm-project/vllm.git
cd vllm
pip install -e .  # 开发模式安装

# 验证安装
python -c "import vllm; print(vllm.__version__)"
```

### 快速上手（离线批量推理）

```python
from vllm import LLM, SamplingParams

# 初始化模型
llm = LLM(model="facebook/opt-125m")   # 测试用小模型

# 定义采样参数
sampling_params = SamplingParams(
    temperature=0.8,
    top_p=0.95,
    max_tokens=128,
)

# 批量推理
prompts = [
    "Hello, my name is",
    "The capital of France is",
    "The future of AI is",
]
outputs = llm.generate(prompts, sampling_params)

# 打印输出
for output in outputs:
    prompt = output.prompt
    generated_text = output.outputs[0].text
    print(f"Prompt: {prompt!r}")
    print(f"Generated: {generated_text!r}")
    print("---")
```

### Chat 模板使用

```python
from vllm import LLM, SamplingParams
from vllm.entrypoints.chat_utils import apply_chat_template

llm = LLM(model="meta-llama/Llama-2-7b-chat-hf")

# 使用 Chat 模板
messages = [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "What is PagedAttention?"},
]

# 方式1：直接使用 chat 接口
outputs = llm.chat(
    messages=[messages],
    sampling_params=SamplingParams(temperature=0.7, max_tokens=512),
)
print(outputs[0].outputs[0].text)
```

---

## 2. OpenAI 兼容服务部署

### 启动服务

```bash
# 基础启动
python -m vllm.entrypoints.openai.api_server \
    --model meta-llama/Llama-2-7b-chat-hf \
    --host 0.0.0.0 \
    --port 8000

# 生产配置
python -m vllm.entrypoints.openai.api_server \
    --model meta-llama/Llama-2-7b-chat-hf \
    --host 0.0.0.0 \
    --port 8000 \
    --tensor-parallel-size 2 \
    --gpu-memory-utilization 0.90 \
    --max-model-len 4096 \
    --max-num-seqs 256 \
    --served-model-name "llama-2-7b" \
    --api-key "your-secret-key" \
    --disable-log-requests   # 生产环境关闭请求日志
```

### API 调用示例

```python
# Chat Completions
import openai

client = openai.OpenAI(
    base_url="http://localhost:8000/v1",
    api_key="your-secret-key",
)

# 普通对话
response = client.chat.completions.create(
    model="llama-2-7b",
    messages=[{"role": "user", "content": "Hello!"}],
    temperature=0.7,
    max_tokens=256,
)
print(response.choices[0].message.content)

# 流式对话
stream = client.chat.completions.create(
    model="llama-2-7b",
    messages=[{"role": "user", "content": "Tell me a story"}],
    stream=True,
)
for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
```

```bash
# curl 测试
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-key" \
  -d '{
    "model": "llama-2-7b",
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 100
  }'

# 健康检查
curl http://localhost:8000/health
# 返回: {"status": "ok"}
```

---

## 3. Docker 部署

### 官方 Docker 镜像

```bash
# 使用官方镜像
docker pull vllm/vllm-openai:latest

# 单 GPU 部署
docker run --runtime nvidia --gpus all \
    -v ~/.cache/huggingface:/root/.cache/huggingface \
    -p 8000:8000 \
    --ipc=host \
    vllm/vllm-openai:latest \
    --model meta-llama/Llama-2-7b-chat-hf \
    --tensor-parallel-size 1

# 多 GPU 部署
docker run --runtime nvidia --gpus '"device=0,1,2,3"' \
    -v ~/.cache/huggingface:/root/.cache/huggingface \
    -p 8000:8000 \
    --ipc=host \
    vllm/vllm-openai:latest \
    --model meta-llama/Llama-2-70b-chat-hf \
    --tensor-parallel-size 4
```

### 自定义 Dockerfile

```dockerfile
# Dockerfile
FROM vllm/vllm-openai:v0.4.0

# 安装额外依赖
RUN pip install prometheus-client

# 复制配置文件
COPY config/model_config.json /app/config/

# 自定义启动脚本
COPY scripts/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/app/entrypoint.sh"]
```

```bash
# entrypoint.sh
#!/bin/bash
set -e

# 等待模型下载完成（如果需要）
python -c "
from huggingface_hub import snapshot_download
snapshot_download(repo_id='${MODEL_ID}', cache_dir='/models')
"

# 启动 vLLM 服务
exec python -m vllm.entrypoints.openai.api_server \
    --model "${MODEL_ID}" \
    --host 0.0.0.0 \
    --port 8000 \
    --tensor-parallel-size "${TENSOR_PARALLEL_SIZE:-1}" \
    --gpu-memory-utilization "${GPU_MEMORY_UTIL:-0.90}" \
    --max-model-len "${MAX_MODEL_LEN:-4096}"
```

### Docker Compose 完整配置

```yaml
# docker-compose.yml
version: '3.8'

services:
  vllm:
    image: vllm/vllm-openai:latest
    ports:
      - "8000:8000"
    volumes:
      - huggingface_cache:/root/.cache/huggingface
      - ./models:/models
    environment:
      - HUGGING_FACE_HUB_TOKEN=${HF_TOKEN}
      - CUDA_VISIBLE_DEVICES=0,1
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 2
              capabilities: [gpu]
    command: >
      --model meta-llama/Llama-2-7b-chat-hf
      --tensor-parallel-size 2
      --gpu-memory-utilization 0.90
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    restart: unless-stopped
    shm_size: '2gb'      # 共享内存（NCCL 通信需要）

  # Prometheus 监控
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    
  # Grafana 可视化
  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin

volumes:
  huggingface_cache:
```

---

## 4. Kubernetes 部署

### Deployment 配置

```yaml
# vllm-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vllm-server
  namespace: ai-inference
  labels:
    app: vllm-server
spec:
  replicas: 2           # 2 个副本（不同节点）
  selector:
    matchLabels:
      app: vllm-server
  template:
    metadata:
      labels:
        app: vllm-server
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "8000"
        prometheus.io/path: "/metrics"
    spec:
      containers:
      - name: vllm
        image: vllm/vllm-openai:v0.4.0
        ports:
        - containerPort: 8000
        env:
        - name: HUGGING_FACE_HUB_TOKEN
          valueFrom:
            secretKeyRef:
              name: hf-token
              key: token
        - name: CUDA_VISIBLE_DEVICES
          value: "0"
        args:
        - "--model"
        - "meta-llama/Llama-2-7b-chat-hf"
        - "--tensor-parallel-size"
        - "1"
        - "--gpu-memory-utilization"
        - "0.90"
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
          initialDelaySeconds: 120   # 等待模型加载
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 120
          periodSeconds: 10
        volumeMounts:
        - name: model-cache
          mountPath: /root/.cache/huggingface
        - name: dshm
          mountPath: /dev/shm
      volumes:
      - name: model-cache
        persistentVolumeClaim:
          claimName: model-cache-pvc
      - name: dshm
        emptyDir:
          medium: Memory
          sizeLimit: 2Gi
      nodeSelector:
        nvidia.com/gpu: "true"
      tolerations:
      - key: nvidia.com/gpu
        operator: Exists
        effect: NoSchedule

---
# Service
apiVersion: v1
kind: Service
metadata:
  name: vllm-service
  namespace: ai-inference
spec:
  selector:
    app: vllm-server
  ports:
  - port: 80
    targetPort: 8000
  type: ClusterIP

---
# HPA（自动扩缩容）
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: vllm-hpa
  namespace: ai-inference
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: vllm-server
  minReplicas: 1
  maxReplicas: 8
  metrics:
  - type: External
    external:
      metric:
        name: vllm_request_queue_size   # 自定义 Prometheus 指标
      target:
        type: AverageValue
        averageValue: "10"
```

---

## 5. 多 GPU 张量并行

```bash
# 4×A100 80GB 运行 LLaMA-70B
python -m vllm.entrypoints.openai.api_server \
    --model meta-llama/Llama-2-70b-chat-hf \
    --tensor-parallel-size 4 \
    --max-model-len 4096 \
    --gpu-memory-utilization 0.95

# 8×A100 运行 LLaMA-70B（更高吞吐）
python -m vllm.entrypoints.openai.api_server \
    --model meta-llama/Llama-2-70b-chat-hf \
    --tensor-parallel-size 8 \
    --max-model-len 8192

# 张量并行 + 流水线并行（超大模型）
python -m vllm.entrypoints.openai.api_server \
    --model meta-llama/Llama-2-70b-chat-hf \
    --tensor-parallel-size 4 \
    --pipeline-parallel-size 2 \
    # 总计 8 GPU
```

---

## 6. 性能调优参数

### 核心调优参数

```bash
# 关键性能参数说明

# 1. gpu_memory_utilization（显存利用率）
# 默认 0.90，表示使用 90% GPU 显存
# KV Cache 块数 = (总显存 × utilization - 模型权重) / 每块大小
--gpu-memory-utilization 0.90   # 保守设置，适合模型大小接近显存的情况
--gpu-memory-utilization 0.95   # 激进设置，最大化 KV Cache 容量

# 2. max_model_len（最大序列长度）
# 控制 prefill + decode 的总长度上限
--max-model-len 4096    # 限制最大长度（减少 KV Cache 单块占用）
--max-model-len 8192    # 支持更长上下文

# 3. max_num_seqs（最大并发序列数）
# 批处理时最多同时处理的序列数
--max-num-seqs 256      # 高吞吐场景
--max-num-seqs 64       # 低延迟场景

# 4. max_num_batched_tokens（每次迭代最大 token 数）
--max-num-batched-tokens 8192   # 控制每个 iteration 的计算量

# 5. block_size（KV Cache 块大小）
# 默认 16，每块存储 16 个 token 的 KV
--block-size 16    # 平衡碎片和开销

# 6. swap_space（CPU 换出空间）
--swap-space 8     # GB，CPU 内存用于 KV Cache 换出
```

### 场景化调优策略

```diagram
场景1：最大化吞吐量
──────────────────────────────────────────────
目标：每秒处理最多的 token 数
配置：
  --gpu-memory-utilization 0.95
  --max-num-seqs 512
  --max-num-batched-tokens 32768
  --enable-chunked-prefill

场景2：最低延迟（TTFT + TPOT）
──────────────────────────────────────────────
目标：最小化用户感知延迟
配置：
  --gpu-memory-utilization 0.85
  --max-num-seqs 16
  --max-num-batched-tokens 2048

场景3：长上下文处理
──────────────────────────────────────────────
目标：支持 32K+ 上下文
配置：
  --max-model-len 32768
  --gpu-memory-utilization 0.95
  --tensor-parallel-size 4    # 更多 GPU 分担 KV Cache
  --swap-space 32             # 大 CPU 换出空间
```

---

## 7. 基准测试

### 官方 Benchmark 脚本

```bash
# 吞吐量测试
python benchmarks/benchmark_throughput.py \
    --backend vllm \
    --model meta-llama/Llama-2-7b-chat-hf \
    --dataset benchmarks/ShareGPT_V3_unfiltered_cleaned_split.json \
    --num-prompts 1000 \
    --tensor-parallel-size 1

# 延迟测试
python benchmarks/benchmark_latency.py \
    --model meta-llama/Llama-2-7b-chat-hf \
    --batch-size 1 \
    --input-len 512 \
    --output-len 128 \
    --num-iters 100

# 在线服务测试（需先启动服务）
python benchmarks/benchmark_serving.py \
    --backend openai-chat \
    --base-url http://localhost:8000 \
    --model meta-llama/Llama-2-7b-chat-hf \
    --dataset-name sharegpt \
    --dataset-path benchmarks/ShareGPT_V3_unfiltered_cleaned_split.json \
    --num-prompts 500 \
    --request-rate 10     # 每秒 10 个请求
```

### 关键指标解读

```
测试结果示例输出：

Throughput: 2450.3 requests/min
            12340.5 tokens/s

Latency percentiles (output tokens):
  P50 TTFT  (Time to First Token):  125ms
  P99 TTFT:                         430ms
  P50 TPOT  (Time per Output Token): 18ms
  P99 TPOT:                          42ms
  P50 E2E (End-to-End):             580ms
  P99 E2E:                          1850ms

解读：
- TTFT = 从请求到第一个 token 输出的时间（用户感知响应速度）
- TPOT = 每个 token 的生成时间（决定流式输出的流畅度）
- E2E  = 完整生成时间
```

---

## 8. 监控与可观测性

### Prometheus 指标

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'vllm'
    static_configs:
      - targets: ['vllm-service:8000']
    metrics_path: '/metrics'
```

### 核心监控指标

```python
# vLLM 暴露的关键 Prometheus 指标

# 请求队列
vllm:num_requests_waiting          # 等待队列长度
vllm:num_requests_running          # 运行中请求数
vllm:num_requests_swapped          # 换出请求数

# KV Cache 使用率
vllm:gpu_cache_usage_perc          # GPU KV Cache 使用率 (0-1)
vllm:cpu_cache_usage_perc          # CPU KV Cache 使用率 (0-1)

# 吞吐量
vllm:prompt_tokens_total           # 总 prompt token 数
vllm:generation_tokens_total       # 总生成 token 数
vllm:request_success_total         # 成功请求数

# 延迟
vllm:e2e_request_latency_seconds   # 端到端延迟分布
vllm:time_to_first_token_seconds   # TTFT 分布
vllm:time_per_output_token_seconds # TPOT 分布
```

### 告警规则

```yaml
# alerts.yml - Prometheus 告警规则
groups:
  - name: vllm_alerts
    rules:
    
    # KV Cache 使用率过高
    - alert: VLLMHighCacheUsage
      expr: vllm:gpu_cache_usage_perc > 0.95
      for: 5m
      labels:
        severity: warning
      annotations:
        summary: "vLLM GPU cache usage is too high ({{ $value }})"
        
    # 请求队列过长
    - alert: VLLMHighQueueLength
      expr: vllm:num_requests_waiting > 100
      for: 2m
      labels:
        severity: warning
      annotations:
        summary: "vLLM request queue is backing up ({{ $value }} waiting)"
        
    # P99 延迟过高
    - alert: VLLMHighLatency
      expr: histogram_quantile(0.99, vllm:e2e_request_latency_seconds_bucket) > 10
      for: 5m
      labels:
        severity: critical
      annotations:
        summary: "vLLM P99 latency exceeds 10s"
```

---

## 9. 集成方案

### LangChain 集成

```python
from langchain_openai import ChatOpenAI
from langchain.schema import HumanMessage

# LangChain 通过 OpenAI 兼容接口连接 vLLM
llm = ChatOpenAI(
    model="meta-llama/Llama-2-7b-chat-hf",
    openai_api_key="token-abc123",
    openai_api_base="http://localhost:8000/v1",
    temperature=0.7,
)

response = llm.invoke([HumanMessage(content="什么是 PagedAttention？")])
print(response.content)

# RAG Pipeline
from langchain.chains import RetrievalQA
from langchain_community.vectorstores import FAISS
from langchain_openai import OpenAIEmbeddings

# 使用 vLLM 作为推理后端
qa_chain = RetrievalQA.from_chain_type(
    llm=llm,
    retriever=vectorstore.as_retriever(),
)
```

### LiteLLM 集成（统一 API 网关）

```python
# 通过 LiteLLM 路由到多个 vLLM 实例
import litellm

# 配置多个 vLLM 后端
litellm.api_base = "http://localhost:8000/v1"
litellm.api_key = "token-abc123"

response = litellm.completion(
    model="openai/meta-llama/Llama-2-7b-chat-hf",
    messages=[{"role": "user", "content": "Hello!"}],
)

# 负载均衡配置（litellm_config.yaml）
```

```yaml
# litellm_config.yaml
model_list:
  - model_name: llama-7b
    litellm_params:
      model: openai/meta-llama/Llama-2-7b-chat-hf
      api_base: http://vllm-server-1:8000/v1
      api_key: token-1
  
  - model_name: llama-7b        # 相同名称，自动负载均衡
    litellm_params:
      model: openai/meta-llama/Llama-2-7b-chat-hf
      api_base: http://vllm-server-2:8000/v1
      api_key: token-2
```

---

## 10. 生产注意事项

### 健康检查与优雅停机

```python
# 优雅停机脚本
import signal
import asyncio
from vllm.engine.async_llm_engine import AsyncLLMEngine

engine = AsyncLLMEngine.from_engine_args(engine_args)

async def shutdown_handler():
    """等待所有进行中的请求完成后停机"""
    print("Received shutdown signal, waiting for active requests...")
    
    # 停止接受新请求
    engine.stop_accepting_requests()
    
    # 等待所有请求完成（最多等待 60 秒）
    deadline = asyncio.get_event_loop().time() + 60
    while engine.has_unfinished_requests():
        if asyncio.get_event_loop().time() > deadline:
            print("Timeout, forcing shutdown")
            break
        await asyncio.sleep(0.5)
    
    print("All requests completed, shutting down")
    await engine.shutdown()

# 注册信号处理器
signal.signal(signal.SIGTERM, lambda s, f: asyncio.create_task(shutdown_handler()))
```

### 生产环境 Checklist

```
生产部署检查清单：

基础配置
  ✓ 设置 --api-key 并在客户端配置认证
  ✓ 设置 --max-model-len 防止超长请求占用过多内存
  ✓ 配置 --disable-log-requests 减少日志开销
  ✓ 设置合理的 --gpu-memory-utilization（建议 0.90）

高可用
  ✓ 部署多个副本（至少 2 个）
  ✓ 配置 Health Check（liveness + readiness probe）
  ✓ 设置请求超时
  ✓ 配置优雅停机

监控
  ✓ 接入 Prometheus 指标收集
  ✓ 配置 KV Cache 使用率告警
  ✓ 配置请求队列长度告警
  ✓ 配置 P99 延迟告警

性能
  ✓ 根据场景选择吞吐量/延迟优先策略
  ✓ 测试在目标 QPS 下的 GPU Cache 使用率
  ✓ 验证 OOM 不会导致服务崩溃（--gpu-memory-utilization < 1.0）

安全
  ✓ 限制请求大小（--max-num-batched-tokens）
  ✓ 配置请求速率限制（通过上游网关）
  ✓ 不在日志中记录用户输入内容
```

### 常见问题排查

```bash
# 问题1：CUDA Out of Memory
# 解决：降低 gpu_memory_utilization 或 max_model_len
--gpu-memory-utilization 0.85
--max-model-len 2048

# 问题2：请求延迟抖动
# 可能是 KV Cache 换出导致，检查 swap 频率
# 监控 vllm:num_requests_swapped 指标

# 问题3：启动时 HuggingFace 下载慢
# 使用本地模型路径或国内镜像
export HF_ENDPOINT=https://hf-mirror.com
--model /path/to/local/model

# 问题4：多 GPU NCCL 通信错误
# 确保 --ipc=host（Docker 中）
# 或设置 NCCL_DEBUG=INFO 查看详情
export NCCL_DEBUG=INFO
```


---


## 1. 什么是 TensorRT-LLM

TensorRT-LLM（TRT-LLM）是 NVIDIA 于 2023 年发布的开源 LLM 推理优化库，构建于 TensorRT 之上，专为 NVIDIA GPU（特别是 H100、A100）优化。

```diagram
TensorRT-LLM 技术栈：

┌─────────────────────────────────────────────────────┐
│           应用层（Triton Inference Server）           │
├─────────────────────────────────────────────────────┤
│         TensorRT-LLM Runtime（C++/Python API）       │
├──────────────────────┬──────────────────────────────┤
│  TensorRT Engine     │   Custom CUDA Kernels        │
│  (图优化/融合)        │   (FlashAttention, GEMM等)   │
├──────────────────────┴──────────────────────────────┤
│              CUDA / cuBLAS / cuDNN                   │
├─────────────────────────────────────────────────────┤
│         NVIDIA GPU（H100 / A100 / L40S）             │
└─────────────────────────────────────────────────────┘
```

### 核心特性

| 特性 | 说明 |
|------|------|
| **TensorRT 图优化** | 层融合、常量折叠、精度校准 |
| **自定义 CUDA Kernels** | 针对 LLM 的 Attention、GEMM 优化 |
| **In-flight Batching** | 连续批处理，最大化 GPU 利用率 |
| **FP8/INT4/INT8** | H100 原生 FP8 硬件加速 |
| **多 GPU 并行** | 张量并行、流水线并行、专家并行 |
| **Triton 集成** | 与 NVIDIA Triton 服务器无缝集成 |

---

## 2. TensorRT 基础：图优化与内核融合

### 计算图优化流程

```diagram
原始模型（ONNX / PyTorch）
        │
        ▼ 解析阶段
TensorRT Network Definition
        │
        ▼ 优化阶段
┌───────────────────────────────────────┐
│  TensorRT 优化 Pass                   │
│  ① 层融合（Layer Fusion）             │
│  ② 常量折叠（Constant Folding）       │
│  ③ 冗余层消除                         │
│  ④ 精度选择（FP32/FP16/INT8/FP8）    │
│  ⑤ Kernel 自动调优（Auto-tuning）    │
└───────────────────────────────────────┘
        │
        ▼ 序列化
TensorRT Engine（.engine 文件）
        │
        ▼ 部署
Runtime 推理（极低延迟）
```

### 层融合（Layer Fusion）示例

```
未融合：
  LayerNorm → Linear → GELU → Linear → Add
  每层单独 kernel 调用 = 5 次 GPU kernel 启动
  每次启动有固定开销（~10μs）

融合后：
  [LayerNorm + Linear + GELU + Linear + Add] = 1 个 kernel
  减少内存读写次数，消除 kernel 启动开销

典型融合模式（Transformer）：
  QKV Projection Fusion:
    Q_proj + K_proj + V_proj → 单个 fused_qkv kernel
  
  Attention + Softmax Fusion:
    matmul(Q,K) + scale + softmax + matmul(V) → Flash Attention kernel
  
  FFN Fusion:
    Linear + GELU + Linear → 单个 FFN kernel
```

### 精度自动选择

```python
# TensorRT 混合精度配置
config = builder.create_builder_config()

# 允许 FP16
config.set_flag(trt.BuilderFlag.FP16)

# 允许 INT8（需要校准数据）
config.set_flag(trt.BuilderFlag.INT8)
config.int8_calibrator = MyCalibrator(calibration_data)

# TensorRT 自动为每层选择最优精度
# 精度敏感层保持 FP32，计算密集层使用 FP16/INT8
```

---

## 3. LLM 专项优化

### 自定义 CUDA Kernels

TRT-LLM 针对 LLM 关键算子编写了高度优化的 CUDA kernels：

```
关键 Kernel 优化：

1. Multi-Head Attention (MHA) Kernel
   - Fused QKV + Attention + Output Projection
   - 使用 Tensor Core 加速矩阵乘法
   - 减少 global memory 访问

2. Grouped Query Attention (GQA) Kernel  
   - 针对 LLaMA-2/3, Mistral 的 GQA 结构优化
   - KV 头复用，减少内存占用

3. GEMM Kernel (矩阵乘法)
   - cuBLAS vs 自定义 kernel 自动选择
   - 不同 batch_size 选择不同 tile 大小

4. RoPE (Rotary Position Embedding) Kernel
   - 融入 QK 计算，避免单独 kernel 调用

5. RMSNorm / LayerNorm Kernel
   - 与下一层融合，减少内存往返
```

### KV Cache 分页管理

```diagram
TRT-LLM 的 KV Cache 管理（类似 PagedAttention）：

物理内存：
┌────┬────┬────┬────┬────┬────┬────┬────┐
│Blk0│Blk1│Blk2│Blk3│Blk4│Blk5│Blk6│Blk7│
└────┴────┴────┴────┴────┴────┴────┴────┘

请求的逻辑 KV 块：
Seq A: [Blk2, Blk5, Blk0]   ← 不连续存储
Seq B: [Blk1, Blk7]

KV Cache Manager：
- 维护空闲块链表
- 分配：从空闲链表取块
- 释放：请求完成时归还块
```

### Tensor Parallelism 优化

```
H100 NVLink 互联：
8×H100 全互联，带宽 900 GB/s（vs PCIe 64 GB/s）

TRT-LLM 针对 NVLink 优化的 AllReduce：
  - 使用自定义 AllReduce kernel（非标准 NCCL）
  - 结合 Tensor Core 和 NVLink 流水线
  - 延迟比 NCCL 低 2-3x
```

---

## 4. In-flight Batching

TRT-LLM 中的连续批处理实现与 vLLM 类似，但有 NVIDIA 特定优化：

```
In-flight Batching 工作流：

时间步 t=1:
  Batch: [Req_A(prefill, 512 tok), Req_B(decode), Req_C(decode)]
  
  注意：prefill 和 decode 在同一个 forward pass 中处理！
  这需要特殊的 attention mask 处理：
  
  Req_A (prefill): 使用因果 mask（新 token 看不到未来）
  Req_B (decode):  只有 1 个新 token，访问完整 KV Cache
  Req_C (decode):  只有 1 个新 token，访问完整 KV Cache

时间步 t=2:
  Req_A 完成 prefill，开始 decode
  Batch: [Req_A(decode), Req_B(decode), Req_C(decode), Req_D(prefill)]
```

### Paged KV Cache（TRT-LLM v0.8+）

```python
# TRT-LLM 中启用分页 KV Cache
executor_config = trtllm.ExecutorConfig(
    kv_cache_config=trtllm.KvCacheConfig(
        enable_block_reuse=True,     # 跨请求复用 KV 块
        max_tokens=40960,
        max_attention_window=[4096], # 滑动窗口注意力
        free_gpu_memory_fraction=0.9,
    )
)
```

---

## 5. 量化支持

### 量化方案概览

```
量化精度层次：

FP32 → FP16/BF16 → FP8 → INT8 → INT4/W4A16
精度:  ████████    ████     ███     ██      █
速度:  █           ██       ████    ████    █████
显存:  █████       ████     ██      ██      █
```

### FP8（H100 专属）

```
H100 Tensor Core 原生支持 FP8：
- FP8 E4M3: 范围小，精度高（用于前向传播）
- FP8 E5M2: 范围大，精度低（用于梯度）

推理使用 E4M3：
  权重: FP8 存储
  激活值: FP8 计算
  Attention: FP16（精度敏感）
  
速度对比（H100, LLaMA-70B）：
  FP16:  ~2000 tok/s
  FP8:   ~3500 tok/s  （1.75x 加速）
  INT8:  ~2800 tok/s
```

### SmoothQuant（W8A8）

```
问题：激活值存在极端异常值（outliers），直接 INT8 量化损失大

SmoothQuant 解决方案：
  原始：
    Y = (X · W)           X 有大异常值，W 较平滑
  
  迁移异常值：
    Y = (X · diag(s)⁻¹) · (diag(s) · W)
         ↑ 平滑后的激活值   ↑ 吸收异常值的权重
  
  效果：激活值量化误差大幅降低，支持 W8A8 量化
```

---

## 6. 性能数据

```diagram
H100 80GB SXM5 基准测试（官方数据）：

LLaMA-2 70B，TP=4，FP8：
  吞吐量:  ~5500 tok/s（output tokens）
  TTFT P99:  ~800ms（input 512 tok）
  
对比 vLLM（FP16, TP=4, A100）：
  吞吐量:  ~2800 tok/s

延迟对比（单请求，input=512, output=128）：
┌─────────────────┬──────────┬──────────┐
│ 框架/配置       │  TTFT    │  总延迟  │
├─────────────────┼──────────┼──────────┤
│ TRT-LLM FP8 H100│  45ms    │  380ms   │
│ TRT-LLM FP16 A100│ 85ms   │  720ms   │
│ vLLM FP16 A100  │  95ms    │  850ms   │
│ TGI FP16 A100   │  120ms   │  1100ms  │
└─────────────────┴──────────┴──────────┘
```

---

## 7. 与 vLLM、TGI 对比

```
三大框架综合对比：

                  TensorRT-LLM    vLLM         TGI
硬件绑定         NVIDIA专属      NVIDIA为主   NVIDIA/AMD
最大吞吐量       ★★★★★          ★★★★         ★★★
延迟（单请求）   ★★★★★          ★★★★         ★★★
部署复杂度       ★（复杂）       ★★★★（简单）  ★★★★
模型支持广度     ★★★            ★★★★★        ★★★★
量化支持         FP8/INT8/INT4   AWQ/GPTQ     GPTQ
LoRA 支持        有限            支持          完善
更新频率         快              快            中等
社区活跃度       中              高            高

选型建议：
  性能优先 + NVIDIA GPU → TensorRT-LLM
  通用性 + 快速部署    → vLLM
  HuggingFace 生态集成 → TGI
```


---


## 1. TensorRT Engine：构建与运行

### 两阶段架构

```diagram
阶段一：Build Phase（一次性编译，CPU 上执行）
─────────────────────────────────────────────
  输入: 模型权重（HuggingFace / NeMo 格式）
     + 构建配置（精度、并行度、优化目标）
  
  过程:
  ① 加载权重，转换为 TRT-LLM 格式
  ② 构建计算图（layer by layer）
  ③ 应用优化 Pass（层融合、精度选择）
  ④ Auto-tune Kernels（针对目标 GPU）
  ⑤ 序列化为 .engine 文件（几分钟到几小时）
  
  输出: model.engine（可在目标 GPU 上重复使用）

阶段二：Runtime Phase（生产推理，GPU 上执行）
─────────────────────────────────────────────
  输入: .engine 文件 + 请求（input_ids, sampling_params）
  
  过程:
  ① 反序列化 Engine（加载到 GPU，秒级）
  ② In-flight Batching 调度
  ③ 执行优化后的 CUDA Kernels
  ④ KV Cache 管理
  
  输出: generated_token_ids
```

### Engine 构建命令

```bash
# LLaMA-2-7B 构建示例
# 步骤1：转换权重格式
python examples/llama/convert_checkpoint.py \
    --model_dir /models/Llama-2-7b-hf \
    --output_dir /models/llama-7b-trt-ckpt \
    --dtype float16

# 步骤2：编译 Engine
trtllm-build \
    --checkpoint_dir /models/llama-7b-trt-ckpt \
    --output_dir /engines/llama-7b \
    --gemm_plugin float16 \
    --gpt_attention_plugin float16 \
    --max_batch_size 64 \
    --max_input_len 2048 \
    --max_output_len 512
```

---

## 2. 模型定义：Python API 封装 C++ Kernels

TRT-LLM 提供 Python API 来定义模型结构，底层调用优化的 C++ CUDA Kernels：

```python
import tensorrt_llm
from tensorrt_llm import Tensor
from tensorrt_llm.layers import Attention, MLP, LayerNorm
from tensorrt_llm.models import LLaMAForCausalLM

# 模型定义（高级 API）
class LLaMADecoderLayer(tensorrt_llm.Module):
    def __init__(self, config):
        super().__init__()
        self.input_layernorm = RmsNorm(
            normalized_shape=config.hidden_size,
            dtype=config.dtype,
        )
        # 使用 TRT-LLM 优化的 Attention 层
        self.attention = Attention(
            hidden_size=config.hidden_size,
            num_attention_heads=config.num_heads,
            num_kv_heads=config.num_kv_heads,  # GQA 支持
            attention_mask_type=AttentionMaskType.causal,
            dtype=config.dtype,
        )
        self.mlp = GatedMLP(
            hidden_size=config.hidden_size,
            intermediate_size=config.intermediate_size,
            dtype=config.dtype,
        )
    
    def forward(self, hidden_states, kv_cache_params, attention_params):
        residual = hidden_states
        hidden_states = self.input_layernorm(hidden_states)
        hidden_states = self.attention(
            hidden_states,
            kv_cache_params=kv_cache_params,   # KV Cache 管理
            attention_params=attention_params,  # 序列长度等元信息
        )
        hidden_states = hidden_states + residual
        # ... MLP ...
        return hidden_states
```

---

## 3. 核心组件

### ModelConfig

```python
from tensorrt_llm import ModelConfig

config = ModelConfig(
    max_batch_size=64,
    max_beam_width=1,
    num_heads=32,
    num_kv_heads=8,          # GQA：32 头 Q，8 头 KV
    hidden_size=4096,
    vocab_size=32000,
    num_layers=32,
    max_prompt_embedding_table_size=0,
    kv_cache_quant_mode=QuantMode.INT8_KV_CACHE,  # KV Cache 量化
    dtype=trt.DataType.HALF,
)
```

### GenerationConfig

```python
from tensorrt_llm.runtime import GenerationConfig

gen_config = GenerationConfig(
    temperature=0.8,
    top_k=50,
    top_p=0.95,
    repetition_penalty=1.1,
    max_new_tokens=512,
    beam_width=1,           # 1 = greedy/sampling
    end_id=2,               # </s> token ID
    pad_id=0,
)
```

### GptSession（低级 API）

```python
from tensorrt_llm.runtime import TensorRTLLM

# 加载 Engine
session = TensorRTLLM(
    engine_dir="/engines/llama-7b",
    lora_dir=None,
    rank=0,                  # 当前进程的 rank（多 GPU）
    max_batch_size=64,
)

# 推理
input_ids = torch.tensor([[1, 2, 3, 4, 5]], dtype=torch.int32).cuda()
outputs = session.generate(
    batch_input_ids=[input_ids],
    max_new_tokens=128,
    temperature=0.8,
)
```

---

## 4. Triton Inference Server 集成

```diagram
TRT-LLM + Triton 服务架构：

客户端 HTTP/gRPC 请求
         │
         ▼
┌─────────────────────────────────────┐
│     Triton Inference Server         │
│                                     │
│  ┌─────────────────────────────┐   │
│  │  Ensemble Pipeline          │   │
│  │  preprocessing → tensorrt_llm → postprocessing │
│  └─────────────────────────────┘   │
│                                     │
│  Dynamic Batching（Triton 侧）       │
│  Model Instances Management         │
└─────────────────────┬───────────────┘
                      │
          ┌───────────▼──────────┐
          │  TRT-LLM Backend     │
          │  (C++ 插件)          │
          │  in-flight batching  │
          │  KV cache 管理       │
          └──────────────────────┘
```

### Triton 模型仓库结构

```diagram
model_repository/
├── preprocessing/             # Tokenization
│   ├── 1/
│   │   └── model.py
│   └── config.pbtxt
├── tensorrt_llm/             # TRT-LLM 推理核心
│   ├── 1/
│   │   └── model.engine      # 编译好的 Engine
│   └── config.pbtxt
├── postprocessing/           # Detokenization
│   ├── 1/
│   │   └── model.py
│   └── config.pbtxt
└── ensemble/                 # 编排以上三个模型
    ├── 1/
    └── config.pbtxt
```

```bash
# 启动 Triton Server
docker run --rm --gpus all \
    -v /path/to/model_repository:/models \
    -p 8000:8000 -p 8001:8001 -p 8002:8002 \
    nvcr.io/nvidia/tritonserver:24.01-trtllm-python-py3 \
    tritonserver --model-repository=/models
```

---

## 5. Plugin 系统

TRT-LLM 通过 Plugin 将自定义 CUDA Kernels 集成到 TensorRT 计算图中：

```cpp
// Attention Plugin 注册（C++）
class GPTAttentionPlugin : public nvinfer1::IPluginV2DynamicExt {
public:
    // 核心推理接口
    int enqueue(
        const nvinfer1::PluginTensorDesc* inputDesc,
        const nvinfer1::PluginTensorDesc* outputDesc,
        const void* const* inputs,
        void* const* outputs,
        void* workspace,
        cudaStream_t stream) override;
    
    // Plugin 特有参数
    int num_heads;
    int head_size;
    int rotary_embedding_dim;
    bool use_paged_kv_cache;    // 启用分页 KV Cache
    int tokens_per_block;       // 每块 token 数
};
```

### 常用 Plugin

| Plugin | 用途 |
|--------|------|
| `gpt_attention_plugin` | 融合的 Multi-Head Attention（含 KV Cache 管理）|
| `gemm_plugin` | 优化的矩阵乘法（FP16/BF16）|
| `rmsnorm_quantization_plugin` | 融合 RMSNorm + 量化 |
| `weight_only_quantization_matmul_plugin` | W4A16/W8A16 权重量化 GEMM |
| `smooth_quant_gemm_plugin` | SmoothQuant W8A8 GEMM |
| `moe_plugin` | Mixture of Experts（MoE）路由+计算 |

---

## 6. 量化工作流

### 完整量化流程

```bash
# 方式1：FP8 量化（H100）
python quantization/quantize.py \
    --model_dir /models/Llama-2-7b-hf \
    --dtype float16 \
    --qformat fp8 \
    --kv_cache_dtype fp8 \
    --output_dir /models/llama-7b-fp8 \
    --calib_size 512

# 构建 FP8 Engine
trtllm-build \
    --checkpoint_dir /models/llama-7b-fp8 \
    --output_dir /engines/llama-7b-fp8 \
    --strongly_typed \
    --max_batch_size 64

# 方式2：INT8 SmoothQuant
python quantization/quantize.py \
    --model_dir /models/Llama-2-7b-hf \
    --dtype float16 \
    --qformat int8_sq \
    --output_dir /models/llama-7b-int8sq \
    --calib_size 512 \
    --smoothquant 0.5   # migration strength

# 方式3：AWQ W4A16
python quantization/quantize.py \
    --model_dir /models/Llama-2-7b-hf \
    --dtype float16 \
    --qformat int4_awq \
    --output_dir /models/llama-7b-awq
```

---

## 7. 多 GPU 并行策略

### 张量并行

```bash
# TP=4：4 GPU 张量并行
python examples/llama/convert_checkpoint.py \
    --model_dir /models/Llama-2-70b-hf \
    --output_dir /models/llama-70b-tp4 \
    --dtype float16 \
    --tp_size 4

trtllm-build \
    --checkpoint_dir /models/llama-70b-tp4 \
    --output_dir /engines/llama-70b-tp4 \
    --workers 4 \
    --gemm_plugin float16 \
    --gpt_attention_plugin float16
```

### 流水线并行

```bash
# TP=2, PP=2：4 GPU，2 TP + 2 PP
python examples/llama/convert_checkpoint.py \
    --model_dir /models/Llama-2-70b-hf \
    --output_dir /models/llama-70b-tp2pp2 \
    --dtype float16 \
    --tp_size 2 \
    --pp_size 2

trtllm-build \
    --checkpoint_dir /models/llama-70b-tp2pp2 \
    --output_dir /engines/llama-70b-tp2pp2 \
    --workers 4
```

### Expert Parallel（MoE 专家并行）

```bash
# Mixtral-8x7B：专家并行
python examples/mixtral/convert_checkpoint.py \
    --model_dir /models/Mixtral-8x7B-Instruct-v0.1 \
    --output_dir /models/mixtral-tp2ep2 \
    --tp_size 2 \
    --moe_tp_size 2 \   # MoE 张量并行
    --moe_ep_size 2     # MoE 专家并行（专家分布在多 GPU）

# 总 GPU = tp_size × ep_size = 4
```

---

## 8. Executor API

TRT-LLM v0.7+ 推出的新一代异步推理 API：

```python
import tensorrt_llm
from tensorrt_llm.executor import GenerationExecutor, SamplingParams

# 初始化 Executor（支持异步）
executor = GenerationExecutor.create(
    engine_dir="/engines/llama-7b",
    executor_config=tensorrt_llm.ExecutorConfig(
        max_beam_width=1,
        kv_cache_config=tensorrt_llm.KvCacheConfig(
            enable_block_reuse=True,
            free_gpu_memory_fraction=0.9,
        ),
        batching_config=tensorrt_llm.BatchingConfig(
            # In-flight batching 配置
            max_tokens_in_paged_kv_cache=40960,
        ),
    ),
)

# 同步生成
sampling_params = SamplingParams(temperature=0.8, max_new_tokens=128)
result = executor.generate("Hello, world!", sampling_params)
print(result.text)

# 异步批量生成
import asyncio

async def async_generate():
    futures = []
    for prompt in ["Prompt 1", "Prompt 2", "Prompt 3"]:
        future = executor.generate_async(prompt, sampling_params)
        futures.append(future)
    
    results = await asyncio.gather(*futures)
    return results

# 流式生成
for token in executor.generate_stream("Tell me a story", sampling_params):
    print(token.text, end="", flush=True)
```


---


## 1. Docker 环境配置

### 官方容器

```bash
# 拉取 TRT-LLM 开发容器（包含完整工具链）
docker pull nvcr.io/nvidia/tritonserver:24.01-trtllm-python-py3

# 或使用 TRT-LLM 构建容器
docker pull nvcr.io/nvidia/tensorrt:24.01-py3

# 启动开发容器
docker run --rm -it --gpus all \
    -v /home/user/models:/models \
    -v /home/user/engines:/engines \
    --ipc=host \
    --ulimit memlock=-1 \
    --ulimit stack=67108864 \
    nvcr.io/nvidia/tritonserver:24.01-trtllm-python-py3 bash
```

### 从源码构建

```bash
# 克隆仓库
git clone https://github.com/NVIDIA/TensorRT-LLM.git
cd TensorRT-LLM
git submodule update --init --recursive

# 使用官方构建脚本
make -C docker build                    # 构建 Docker 镜像
make -C docker run                      # 进入容器
python3 scripts/build_wheel.py --clean  # 构建 Python 包
pip install build/tensorrt_llm*.whl     # 安装
```

---

## 2. 构建工作流

```diagram
完整构建流程：

原始模型
  │ (HuggingFace / NeMo / Megatron 格式)
  │
  ▼ convert_checkpoint.py
TRT-LLM Checkpoint
  │ (统一格式：config.json + rank*.safetensors)
  │
  ▼ trtllm-build
TensorRT Engine
  │ (.engine 文件，针对特定 GPU 优化)
  │
  ▼ Triton 模型仓库 / Python Runtime
生产服务
```

### 构建参数说明

```bash
trtllm-build \
    --checkpoint_dir /ckpt/llama-7b \   # 转换后的 checkpoint
    --output_dir /engines/llama-7b \    # Engine 输出目录
    
    # 精度插件
    --gemm_plugin float16 \             # 矩阵乘法精度
    --gpt_attention_plugin float16 \    # Attention 精度
    
    # 序列长度限制（影响 KV Cache 大小）
    --max_batch_size 64 \
    --max_input_len 2048 \
    --max_output_len 512 \
    --max_seq_len 2560 \               # max_input + max_output
    
    # KV Cache 优化
    --paged_kv_cache enable \          # 启用分页 KV Cache
    --tokens_per_block 64 \            # 每块 64 个 token
    
    # 并行编译
    --workers 4                         # 多进程并行构建
```

---

## 3. LLaMA 模型完整构建示例

### LLaMA-2-7B FP16

```bash
# 步骤1：下载模型
huggingface-cli download meta-llama/Llama-2-7b-chat-hf \
    --local-dir /models/Llama-2-7b-hf

# 步骤2：转换 Checkpoint
python TensorRT-LLM/examples/llama/convert_checkpoint.py \
    --model_dir /models/Llama-2-7b-hf \
    --output_dir /ckpt/llama-7b-fp16 \
    --dtype float16

# 步骤3：构建 Engine
trtllm-build \
    --checkpoint_dir /ckpt/llama-7b-fp16 \
    --output_dir /engines/llama-7b-fp16 \
    --gemm_plugin float16 \
    --gpt_attention_plugin float16 \
    --max_batch_size 64 \
    --max_input_len 2048 \
    --max_output_len 512

# 步骤4：快速验证
python TensorRT-LLM/examples/run.py \
    --engine_dir /engines/llama-7b-fp16 \
    --tokenizer_dir /models/Llama-2-7b-hf \
    --max_output_len 100 \
    --input_text "Tell me about PagedAttention"
```

### LLaMA-3-70B TP=4

```bash
# 转换（4 GPU 张量并行）
python examples/llama/convert_checkpoint.py \
    --model_dir /models/Meta-Llama-3-70B-Instruct \
    --output_dir /ckpt/llama3-70b-tp4 \
    --dtype bfloat16 \
    --tp_size 4

# 构建（4 进程并行）
trtllm-build \
    --checkpoint_dir /ckpt/llama3-70b-tp4 \
    --output_dir /engines/llama3-70b-tp4 \
    --gemm_plugin bfloat16 \
    --gpt_attention_plugin bfloat16 \
    --max_batch_size 32 \
    --max_input_len 4096 \
    --max_output_len 1024 \
    --workers 4

# 多 GPU 运行
mpirun -n 4 python examples/run.py \
    --engine_dir /engines/llama3-70b-tp4 \
    --tokenizer_dir /models/Meta-Llama-3-70B-Instruct \
    --max_output_len 200 \
    --input_text "Explain transformer architecture"
```

---

## 4. Triton Server 部署

### 模型仓库配置

```bash
# 创建模型仓库结构
cp -r TensorRT-LLM/all_models/inflight_batcher_llm/* /triton_models/

# 填充 Engine
cp -r /engines/llama-7b-fp16/* \
    /triton_models/tensorrt_llm/1/

# 配置文件修改
```

```protobuf
# /triton_models/tensorrt_llm/config.pbtxt
backend: "tensorrtllm"
max_batch_size: 64

model_transaction_policy {
  decoupled: true   # 流式输出必须设置
}

dynamic_batching { }

instance_group [
  {
    count: 1
    kind: KIND_GPU
    gpus: [0]
  }
]

parameters {
  key: "engine_dir"
  value: { string_value: "/triton_models/tensorrt_llm/1" }
}

parameters {
  key: "max_tokens_in_paged_kv_cache"
  value: { string_value: "40960" }
}

parameters {
  key: "batch_scheduler_policy"
  value: { string_value: "guaranteed_no_evict" }
}

parameters {
  key: "kv_cache_free_gpu_mem_fraction"
  value: { string_value: "0.9" }
}

parameters {
  key: "enable_chunked_context"
  value: { string_value: "true" }
}
```

### 启动 Triton Server

```bash
docker run --rm --gpus all \
    -v /triton_models:/models \
    -p 8000:8000 \   # HTTP
    -p 8001:8001 \   # gRPC
    -p 8002:8002 \   # Metrics
    --ipc=host \
    nvcr.io/nvidia/tritonserver:24.01-trtllm-python-py3 \
    tritonserver \
        --model-repository=/models \
        --grpc-port=8001 \
        --http-port=8000 \
        --metrics-port=8002 \
        --log-verbose=0

# 健康检查
curl http://localhost:8000/v2/health/ready

# 测试推理（使用 tritonclient）
python examples/inflight_batcher_llm/client.py \
    --url localhost:8001 \
    --tokenizer_dir /models/Llama-2-7b-hf \
    --request_output_len 100 \
    --text "Hello, what is TensorRT-LLM?"
```

---

## 5. 多 GPU 张量并行部署

```bash
# 8×H100 部署 LLaMA-3-70B（TP=8）

# 转换
python examples/llama/convert_checkpoint.py \
    --model_dir /models/Meta-Llama-3-70B \
    --output_dir /ckpt/llama3-70b-tp8 \
    --dtype bfloat16 \
    --tp_size 8

# 构建（8 GPU 并行，约 20-30 分钟）
trtllm-build \
    --checkpoint_dir /ckpt/llama3-70b-tp8 \
    --output_dir /engines/llama3-70b-tp8 \
    --gemm_plugin bfloat16 \
    --gpt_attention_plugin bfloat16 \
    --max_batch_size 128 \
    --max_input_len 4096 \
    --max_output_len 2048 \
    --workers 8

# Triton config.pbtxt 多 GPU 配置
# instance_group { count: 1; kind: KIND_GPU; gpus: [0,1,2,3,4,5,6,7] }
```

---

## 6. FP8 量化（H100）

```bash
# FP8 量化（需要 H100 GPU）

# 步骤1：FP8 量化权重
python TensorRT-LLM/examples/quantization/quantize.py \
    --model_dir /models/Meta-Llama-3-8B-Instruct \
    --dtype float16 \
    --qformat fp8 \
    --kv_cache_dtype fp8 \
    --output_dir /ckpt/llama3-8b-fp8 \
    --calib_size 512 \
    --calib_dataset cnn_dailymail   # 校准数据集

# 步骤2：构建 FP8 Engine
trtllm-build \
    --checkpoint_dir /ckpt/llama3-8b-fp8 \
    --output_dir /engines/llama3-8b-fp8 \
    --strongly_typed \              # 严格 FP8 类型
    --gemm_plugin float16 \         # GEMM 仍用 FP16 累加
    --gpt_attention_plugin float16 \
    --max_batch_size 128 \
    --max_input_len 4096 \
    --max_output_len 2048

# 验证精度损失（与 FP16 对比）
python examples/summarize.py \
    --engine_dir /engines/llama3-8b-fp8 \
    --hf_model_dir /models/Meta-Llama-3-8B-Instruct \
    --data_type fp8 \
    --check_accuracy

# 典型精度损失：ROUGE-L score 下降 < 0.5%
```

---

## 7. 性能基准测试

```bash
# 官方 benchmark 脚本
python TensorRT-LLM/benchmarks/python/benchmark.py \
    --engine_dir /engines/llama3-8b-fp8 \
    --batch_size 1 4 8 16 32 64 \
    --input_output_len "128,128" "512,128" "1024,256" \
    --tokenizer /models/Meta-Llama-3-8B-Instruct \
    --warm_up 5 \
    --num_runs 20

# 示例输出
# BS=1,  input=512,  output=128: 42ms TTFT, 2500 tok/s
# BS=32, input=512,  output=128: 155ms TTFT, 12800 tok/s
# BS=64, input=1024, output=256: 380ms TTFT, 18500 tok/s

# In-flight batching 测试（更接近生产）
python benchmarks/python/gpt_benchmark.py \
    --engine_dir /engines/llama3-8b-fp8 \
    --tokenizer /models/Meta-Llama-3-8B-Instruct \
    --dataset benchmarks/ShareGPT_V3_unfiltered.json \
    --num_requests 1000 \
    --request_rate 50   # 每秒 50 个请求
```

---

## 8. 性能优化参数

```
关键优化旋钮：

1. max_tokens_in_paged_kv_cache
   - 增大 → 支持更多并发，吞吐量↑，但 OOM 风险↑
   - 建议：GPU 显存的 70-80% 分配给 KV Cache

2. kv_cache_free_gpu_mem_fraction
   - 0.9 = 90% 剩余显存用于 KV Cache
   - Engine 加载后的剩余显存 × fraction = KV Cache 空间

3. batch_scheduler_policy
   - "guaranteed_no_evict": 只调度有足够 KV 块的请求
   - "max_utilization": 尽量满负荷，可能触发抢占

4. enable_chunked_context
   - 长 prefill 分块，与 decode 交织
   - 降低 TPOT，提升 P99 延迟

5. tokens_per_block
   - 16/32/64: 值越大，块表越小但碎片越多
   - 建议：短序列用 16，长序列用 64

6. max_num_sequences（最大并发序列数）
   - 增大 → 吞吐量↑，P50 延迟↑
   - 根据 SLA 要求平衡
```

---

## 9. NIM 集成

NVIDIA Inference Microservices（NIM）是基于 TRT-LLM 的生产级推理容器：

```bash
# 使用 NIM（最简单的生产部署方式）
# 无需手动构建 Engine，NIM 自动完成优化

# 拉取 LLaMA-3 NIM 容器
docker login nvcr.io
docker pull nvcr.io/nim/meta/llama3-8b-instruct:latest

# 启动 NIM（自动检测 GPU 并选择最优配置）
docker run --rm --gpus all \
    -e NGC_API_KEY=$NGC_API_KEY \
    -v /nim_cache:/opt/nim/.cache \
    -p 8000:8000 \
    nvcr.io/nim/meta/llama3-8b-instruct:latest

# NIM 提供 OpenAI 兼容 API
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "meta/llama3-8b-instruct",
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 100
  }'
```

### NIM vs 手动 TRT-LLM 部署

| 维度 | NIM | 手动 TRT-LLM |
|------|-----|-------------|
| 部署难度 | 极简（一个命令）| 复杂（多步骤）|
| 定制化 | 受限 | 完全灵活 |
| Engine 构建 | 自动 | 手动 |
| 优化程度 | NVIDIA 预优化 | 需要手动调优 |
| 成本 | NGC 许可证 | 开源免费 |
| 适合场景 | 标准模型快速上线 | 定制模型/深度优化 |


---


## 1. 什么是 llama.cpp

llama.cpp 由 Georgi Gerganov 于 2023 年 3 月开源，最初目标是在 MacBook 上运行 Meta 的 LLaMA 模型。

**核心特性：**
- 纯 C/C++ 实现，零外部依赖（可选 BLAS）
- 支持 CPU 推理（无需 GPU）
- 支持多种量化格式（显著降低内存占用）
- 跨平台：Linux、macOS、Windows、Android、iOS
- OpenAI 兼容的 HTTP 服务端

```diagram
┌─────────────────────────────────────────────┐
│              llama.cpp 生态系统               │
├─────────────────────────────────────────────┤
│  llama-cli  │ llama-server │ llama-bench     │
├─────────────────────────────────────────────┤
│           llama.cpp 核心库                   │
├──────────┬──────────┬──────────┬────────────┤
│   GGML   │   CUDA   │  Metal   │   Vulkan   │
│  (CPU)   │ (NVIDIA) │ (Apple)  │  (通用GPU) │
└──────────┴──────────┴──────────┴────────────┘
```

---

## 2. GGML 张量库

GGML（Georgi Gerganov Machine Learning）是 llama.cpp 的底层张量计算库。

**核心设计理念：**
- **静态内存分配**：使用固定大小的内存池，避免 malloc/free 开销
- **计算图**：以 DAG（有向无环图）表示计算过程
- **量化原生支持**：在张量级别支持整数量化运算
- **SIMD 优化**：针对 AVX2、AVX512、NEON 等指令集优化

```c
// GGML 基本数据结构示例
struct ggml_tensor {
    enum ggml_type type;    // 数据类型（F32, F16, Q4_0 等）
    int64_t ne[4];          // 各维度大小 [cols, rows, matrices, batches]
    size_t  nb[4];          // 各维度字节步长
    void   *data;           // 数据指针
    char    name[64];       // 张量名称
};

// 创建上下文和张量
struct ggml_context *ctx = ggml_init(params);
struct ggml_tensor  *a   = ggml_new_tensor_2d(ctx, GGML_TYPE_F32, 4096, 4096);
struct ggml_tensor  *b   = ggml_new_tensor_2d(ctx, GGML_TYPE_F32, 4096, 4096);
struct ggml_tensor  *c   = ggml_mul_mat(ctx, a, b);  // 矩阵乘法节点

// 构建并执行计算图
struct ggml_cgraph *graph = ggml_new_graph(ctx);
ggml_build_forward_expand(graph, c);
ggml_graph_compute_with_ctx(ctx, graph, n_threads);
```

**GGML vs PyTorch 对比：**

| 特性 | GGML | PyTorch |
|------|------|---------|
| 语言 | C/C++ | Python/C++ |
| 内存管理 | 静态内存池 | 动态分配 |
| 量化支持 | 原生支持 | 通过扩展 |
| 部署依赖 | 零依赖 | Python 运行时 |
| 训练支持 | 有限 | 完整 |
| 生态系统 | 专注推理 | 完整 ML 生态 |

---

## 3. GGUF 模型格式

GGUF（GPT-Generated Unified Format）是 2023 年 8 月引入的新格式，取代了旧的 GGML/GGMF/GGJT 格式。

**GGUF 文件结构：**

```diagram
┌────────────────────────────────────────┐
│            GGUF 文件结构                │
├────────────────────────────────────────┤
│  Magic Number: "GGUF" (4 bytes)        │
│  Version: uint32 (当前为 3)            │
├────────────────────────────────────────┤
│  Tensor Count: uint64                  │
│  Metadata KV Count: uint64             │
├────────────────────────────────────────┤
│  Metadata Section（键值对）:            │
│  ├── general.architecture: "llama"     │
│  ├── llama.context_length: 4096        │
│  ├── llama.embedding_length: 4096      │
│  ├── tokenizer.ggml.model: "llama"     │
│  └── tokenizer.ggml.tokens: [...]      │
├────────────────────────────────────────┤
│  Tensor Info Section:                  │
│  ├── name, ndim, shape, dtype, offset  │
│  └── ... (每个张量一条记录)            │
├────────────────────────────────────────┤
│  Alignment Padding                     │
├────────────────────────────────────────┤
│  Tensor Data Section（实际权重数据）    │
└────────────────────────────────────────┘
```

**GGUF 相比旧格式的改进：**
- 单文件包含模型权重 + tokenizer + 元数据
- 支持未来扩展（不破坏兼容性）
- mmap 友好（内存映射文件加载）
- 支持大于 4GB 的模型

---

## 4. 量化方法详解

量化是将浮点权重压缩为低精度整数的技术，核心权衡是**精度损失 vs 内存节省 vs 速度提升**。

### 量化类型说明

| 量化类型 | 位宽 | 每权重字节 | 7B 模型大小 | 质量损失 | 推荐场景 |
|---------|------|-----------|------------|---------|---------|
| F32 | 32-bit | 4.0 B | ~28 GB | 无 | 基准测试 |
| F16 | 16-bit | 2.0 B | ~14 GB | 极小 | GPU 推理 |
| Q8_0 | 8-bit | 1.1 B | ~7.7 GB | 很小 | 高质量需求 |
| Q6_K | 6-bit | 0.82 B | ~5.9 GB | 小 | 质量/速度均衡 |
| Q5_K_M | 5-bit | 0.69 B | ~4.8 GB | 小 | 推荐通用 |
| Q4_K_M | 4-bit | 0.54 B | ~4.1 GB | 中等 | **最常用** |
| Q4_0 | 4-bit | 0.50 B | ~3.8 GB | 中等 | 速度优先 |
| Q3_K_M | 3-bit | 0.38 B | ~3.3 GB | 较大 | 内存极限 |
| IQ2_XXS | 2-bit | 0.26 B | ~2.2 GB | 大 | 极端内存限制 |

### 命名规则解析

```diagram
Q4_K_M
│ │ │ └── M = Medium（中等版本，关键层用更高精度）
│ │ └──── K = K-quants（使用超块量化，更精确）
│ └────── 4 = 4位量化
└──────── Q = Quantized（量化）

IQ2_XXS
│  │  └── XXS = 超超小（最激进压缩）
│  └───── 2 = 2位量化
└──────── I = Importance-aware（基于重要性的量化）
```

### Q4_K_M 量化数学原理

```
传统 Q4_0（每 32 个值一个缩放因子）：
block_size = 32
scale = max(abs(block)) / 7  # 映射到 [-7, 7]
quantized = round(value / scale)  # int4

K-quants Q4_K_M（超块，每 256 个值）：
super_block_size = 256
sub_block_size = 32
# 每个超块有独立的缩放因子集合
# "M" 版本：注意力层和 FFN 门控层使用 Q6_K 量化
```

---

## 5. CPU 推理的重要性

### 为什么 CPU 推理很重要

**消费级硬件普及：**
- 大多数用户没有高端 GPU
- Apple Silicon（M1/M2/M3）统一内存架构尤其适合大模型
- 成本：RTX 4090（24GB VRAM）约 ¥15,000 vs MacBook Pro M3 Max（128GB 统一内存）

**隐私与数据安全：**
```diagram
云端 API 推理:                本地 CPU 推理:
用户数据 ──► API 服务器        用户数据 ──► 本地模型
           ├── 数据留存                    ├── 完全私有
           ├── 网络延迟                    ├── 零延迟（网络）
           └── 按调用计费                  └── 零边际成本
```

**边缘部署场景：**
- IoT 设备、嵌入式系统
- 无网络环境（医疗、军事、离线工具）
- 低延迟要求（本地 coding assistant）

---

## 6. 硬件后端支持

### Metal 后端（Apple Silicon）

```diagram
Apple M2/M3 统一内存架构：
┌─────────────────────────────────────┐
│           统一内存（共享）           │
│  ┌──────────┐    ┌──────────────┐   │
│  │  CPU 核心 │    │   GPU 核心   │   │
│  │ (P+E 核) │    │ (30/38/40核) │   │
│  └──────────┘    └──────────────┘   │
│  ┌──────────────────────────────┐   │
│  │        Neural Engine         │   │
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘
优势：CPU 和 GPU 共享同一块内存，无需数据拷贝
```

编译 Metal 支持：
```bash
cmake -B build -DGGML_METAL=ON
cmake --build build --config Release
```

### CUDA 后端（NVIDIA GPU）

```bash
# 编译 CUDA 支持
cmake -B build -DGGML_CUDA=ON
cmake --build build --config Release -j$(nproc)

# 使用 n_gpu_layers 控制 GPU 卸载层数
./llama-cli -m model.gguf -ngl 35  # 35 层放到 GPU
```

### Vulkan 后端（通用 GPU）

支持 AMD、Intel、NVIDIA GPU，跨平台：
```bash
cmake -B build -DGGML_VULKAN=ON
cmake --build build
```

---

## 7. 性能对比

### Apple Silicon vs NVIDIA GPU

| 硬件 | 内存 | Llama-3-8B Q4_K_M | Llama-3-70B Q4_K_M |
|------|------|-------------------|-------------------|
| M2 (8GB) | 8 GB 统一 | ~35 tok/s | 不可运行 |
| M2 Pro (16GB) | 16 GB 统一 | ~45 tok/s | 不可运行 |
| M2 Max (32GB) | 32 GB 统一 | ~55 tok/s | ~8 tok/s |
| M3 Max (64GB) | 64 GB 统一 | ~65 tok/s | ~15 tok/s |
| RTX 3060 (12GB) | 12 GB VRAM | ~80 tok/s | 不可运行 |
| RTX 4090 (24GB) | 24 GB VRAM | ~120 tok/s | 不可运行 |
| 2x RTX 4090 | 48 GB VRAM | ~130 tok/s | ~35 tok/s |

> 注意：tok/s = tokens per second（生成速度）；数据为近似值，受量化类型和上下文长度影响。

### CPU 纯计算性能

| CPU | 线程数 | Llama-3-8B Q4_K_M |
|-----|-------|-------------------|
| Intel i9-13900K | 24 | ~12 tok/s |
| AMD Ryzen 9 7950X | 32 | ~15 tok/s |
| Apple M2 (仅CPU) | 8 | ~20 tok/s |

**结论**：Apple Silicon 因统一内存架构，CPU+GPU 协同推理效率远超传统 CPU，是本地推理的最佳平台之一。


---


## 1. ggml 张量库内部机制

### 张量是什么？

可以把张量想象成一个**多维数组加上一套元数据**。一个向量是 1 维张量，一个矩阵是 2 维张量，Transformer 中的权重通常是 2～4 维张量。ggml 用 `ggml_tensor` 结构体表示它们：

```c
struct ggml_tensor {
    enum ggml_type type;     // 数据类型：F32、F16、Q4_K、Q8_0 …
    int64_t        ne[4];    // 每个维度的元素数量（number of elements）
                             //   ne[0]=列数, ne[1]=行数, ne[2]=…, ne[3]=…
    size_t         nb[4];    // 每个维度的字节步长（number of bytes stride）
                             //   nb[0]=单个元素大小, nb[1]=一行字节数 …
    void          *data;     // 指向实际数据的裸指针
    char           name[GGML_MAX_NAME]; // 调试用名称，如 "blk.0.attn_q.weight"
    struct ggml_tensor *src[GGML_MAX_SRC]; // 这个张量是由哪些张量计算而来
    enum ggml_op   op;       // 产生本张量的操作：GGML_OP_MUL_MAT、GGML_OP_ADD …
    void          *extra;    // 后端专用数据（CUDA 用于存 cudaStream 等）
};
```

**nb（步长）的作用**：步长使 ggml 能够实现**零拷贝视图**。对矩阵做转置时，只需交换 `ne[0]`/`ne[1]` 和 `nb[0]`/`nb[1]`，无需移动任何数据。这对性能至关重要。

### 内存竞技场（Arena）

ggml 采用**单块连续内存池**管理所有张量数据。创建 `ggml_context` 时预先分配一块大内存，之后所有张量数据都从这块内存线性分配：

```diagram
┌──────────────────────────────────────────────┐
│              ggml_context 内存池              │
├──────────┬──────────┬──────────┬─────────────┤
│ggml_tensor│ggml_tensor│  数据块  │   数据块    │
│ (元数据)  │ (元数据)  │ (权重字节)│ (激活字节)  │
└──────────┴──────────┴──────────┴─────────────┘
     ↑ 固定元数据区域             ↑ 滑动分配指针
```

好处是：**没有 malloc/free 的碎片**，整块内存可以直接 mmap 到 GGUF 文件，实现零拷贝加载模型权重。

### 计算图（cgraph）：DAG 结构

ggml 不立即执行计算，而是先**构建计算图（Computation Graph）**，再一次性执行。这与 PyTorch 的 eager mode 不同，更接近 TensorFlow 1.x 的静态图。

计算图是一个**有向无环图（DAG）**：
- **节点（Node）**：每个 `ggml_tensor`（当它有 `op != NONE` 时）
- **边（Edge）**：`src[]` 指针，表示依赖关系

以矩阵乘法 `C = A × B + bias` 为例：

```diagram
   A (权重)    B (输入)
     │            │
     └────┬───────┘
          ↓
     [MUL_MAT]          bias
          │               │
          └───────┬───────┘
                  ↓
               [ADD]
                  │
                  ↓
                  C (输出)
```

构建和执行流程：

```c
// 1. 构建图（只是设置指针，不做计算）
struct ggml_tensor *C_no_bias = ggml_mul_mat(ctx, A, B);
struct ggml_tensor *C         = ggml_add(ctx, C_no_bias, bias);

// 2. 将输出节点添加到 forward 图
ggml_build_forward_expand(cgraph, C);

// 3. 实际执行计算（多线程调度）
ggml_graph_compute_with_ctx(ctx, cgraph, n_threads);
```

`ggml_graph_compute` 内部会拓扑排序节点，然后用线程池并行执行可并行的节点。

---

## 2. GGUF 文件格式深度解析

GGUF（GGML Universal File）是 llama.cpp 从 v2 开始使用的统一模型文件格式，取代了早期的 GGML/GGJT 格式。

### 文件头结构

```diagram
偏移量   大小    内容
──────────────────────────────────────────────────
0x00    4B      Magic: 0x46554747 ("GGUF" 小端)
0x04    4B      Version: 3
0x08    8B      tensor_count: uint64
0x10    8B      metadata_kv_count: uint64
0x18    ...     metadata KV pairs（变长）
...     ...     tensor info array（变长）
...     ...     对齐填充（padding to alignment）
...     ...     tensor data（实际权重字节）
```

十六进制示意：

```
47 46 55 46   | GGUF magic
03 00 00 00   | version = 3
xx xx xx xx xx xx xx xx | tensor_count
xx xx xx xx xx xx xx xx | metadata_kv_count
...           | metadata KV pairs
```

### Metadata KV 对

每个 KV 对的格式：

```c
// key: GGUF 字符串（4字节长度 + UTF-8 字节）
// value_type: uint32（0=uint8, 4=uint32, 8=string, 9=array …）
// value: 根据 value_type 变长
```

常见的 metadata key：

| Key | 类型 | 示例值 | 说明 |
|-----|------|--------|------|
| `general.architecture` | string | `"llama"` | 模型架构 |
| `general.name` | string | `"Llama 3.2 3B"` | 模型名称 |
| `llama.context_length` | uint32 | `131072` | 最大上下文长度 |
| `llama.embedding_length` | uint32 | `3072` | hidden dim |
| `llama.block_count` | uint32 | `28` | Transformer 层数 |
| `llama.attention.head_count` | uint32 | `24` | 注意力头数 |
| `tokenizer.ggml.model` | string | `"gpt2"` | tokenizer 类型 |
| `tokenizer.ggml.tokens` | array[string] | `["<unk>", ...]` | 词表 |

### Tensor Info 数组

每个张量的描述信息：

```c
struct gguf_tensor_info {
    // 名称（GGUF 字符串格式）
    char   name[];               // 如 "blk.0.attn_q.weight"
    uint32 n_dims;               // 维度数，通常 1 或 2
    uint64 ne[n_dims];           // 每个维度的元素数
    uint32 type;                 // ggml_type 枚举
    uint64 offset;               // 从 tensor data section 起始的字节偏移
};
```

### 用 Python 读取 GGUF Metadata

```python
import struct
from pathlib import Path

def read_gguf_metadata(path: str) -> dict:
    """读取 GGUF 文件的 metadata，返回 KV 字典"""
    GGUF_MAGIC = b"GGUF"
    VALUE_TYPES = {
        0: ("B", 1),   # uint8
        1: ("b", 1),   # int8
        2: ("H", 2),   # uint16
        3: ("h", 2),   # int16
        4: ("I", 4),   # uint32
        5: ("i", 4),   # int32
        6: ("f", 4),   # float32
        7: ("?", 1),   # bool
        # 8 = string，9 = array，10 = uint64，11 = int64，12 = float64
    }

    def read_string(f):
        (length,) = struct.unpack("<Q", f.read(8))
        return f.read(length).decode("utf-8")

    def read_value(f, vtype):
        if vtype == 8:   # string
            return read_string(f)
        if vtype in VALUE_TYPES:
            fmt, size = VALUE_TYPES[vtype]
            (val,) = struct.unpack(f"<{fmt}", f.read(size))
            return val
        return None  # array 等复杂类型略

    with open(path, "rb") as f:
        assert f.read(4) == GGUF_MAGIC, "Not a GGUF file"
        (version,)    = struct.unpack("<I", f.read(4))
        (n_tensors,)  = struct.unpack("<Q", f.read(8))
        (n_kv,)       = struct.unpack("<Q", f.read(8))

        metadata = {"__version__": version}
        for _ in range(n_kv):
            key         = read_string(f)
            (vtype,)    = struct.unpack("<I", f.read(4))
            value       = read_value(f, vtype)
            metadata[key] = value

    return metadata

# 使用示例
meta = read_gguf_metadata("./models/model.gguf")
print(f"架构: {meta.get('general.architecture')}")
print(f"上下文长度: {meta.get('llama.context_length')}")
print(f"层数: {meta.get('llama.block_count')}")
```

---

## 3. 核心推理代码导读

### `llama_model_load()`：加载模型权重

```diagram
llama_model_load()
  ├─ 打开 GGUF 文件，读取 metadata
  ├─ 根据 architecture 选择 hparams（超参数）
  ├─ 为每一层创建 ggml_tensor（此时只是元数据，data=nullptr）
  ├─ 计算所需总内存
  ├─ 根据 n_gpu_layers 决定哪些层放 GPU
  └─ ggml_backend_alloc_ctx_tensors()
       ├─ CPU 层：在 CPU RAM 中分配，直接 mmap 文件数据
       └─ GPU 层：分配 VRAM，用 cudaMemcpy 从文件数据拷贝
```

关键点：CPU 层使用 `mmap`，模型权重**按需加载**（操作系统缺页中断时才真正读取磁盘），这让 llama.cpp 在内存有限时也能运行大模型。

### `llama_new_context_with_model()`：创建推理上下文

```diagram
llama_new_context_with_model()
  ├─ 分配 KV cache（见第 4 节）
  │    n_ctx * n_layers * n_heads * head_dim * 2 * sizeof(kv_type)
  ├─ 分配 compute buffer（临时激活值）
  │    根据 n_batch 和模型大小估算，通常数百 MB
  ├─ 创建 ggml_backend_sched（调度器，管理 CPU/GPU 混合计算）
  └─ 返回 llama_context 指针
```

### `llama_decode()`：一次前向传播

```diagram
llama_decode(ctx, batch)
  ├─ 处理 batch：确定哪些 token 需要计算 logits
  ├─ 构建计算图 llm_build_graph()
  │    ├─ 输入嵌入：token_embd × inp_tokens
  │    ├─ for layer in range(n_layers):
  │    │    ├─ RMSNorm (attn)
  │    │    ├─ Q/K/V 线性变换
  │    │    ├─ RoPE 位置编码
  │    │    ├─ KV cache 读写
  │    │    ├─ Attention（SDPA 或 Flash Attention）
  │    │    ├─ FFN（SwiGLU）
  │    │    └─ 残差连接
  │    └─ 最终 RMSNorm + lm_head 线性变换 → logits
  ├─ ggml_backend_sched_graph_compute() 执行图
  └─ 从输出张量读取 logits
```

### Token 生成循环伪代码

```python
# 完整的 token 生成循环（概念伪代码）
def generate(model, prompt, max_new_tokens=200):
    # 1. 编码提示词
    tokens = tokenize(prompt)                  # List[int]

    # 2. 预填充（prefill）：一次处理整个 prompt
    logits = llama_decode(ctx, batch=tokens)   # 返回最后一个位置的 logits

    generated = []
    for _ in range(max_new_tokens):
        # 3. 采样下一个 token
        next_token = sample(logits, temp=0.7, top_p=0.9)
        if next_token == EOS_TOKEN:
            break

        generated.append(next_token)

        # 4. 解码（decode）：每次只输入一个新 token
        #    KV cache 中已有历史的 K/V，不需要重新计算
        logits = llama_decode(ctx, batch=[next_token])

    return detokenize(generated)
```

**预填充 vs 解码**：prefill 阶段可以并行处理所有输入 token（一次 batch），速度快；decode 阶段每次只有一个新 token，受 memory bandwidth 限制（这是 CPU 推理的瓶颈所在）。

---

## 4. KV Cache 实现原理

### 为什么需要 KV Cache？

Transformer 的 Self-Attention 计算公式：

```
Attention(Q, K, V) = softmax(QK^T / √d_k) × V
```

在自回归生成时，每次生成新 token，都需要与**所有历史 token** 的 K、V 做注意力计算。如果没有缓存：

```
生成第 512 个 token 时，需要对前 511 个 token 重新计算 K 和 V
→ 计算复杂度 O(n²)，n 是序列长度
```

有了 KV Cache：

```
每次只计算新 token 的 Q、K、V
把新的 K、V append 到缓存中
→ 计算复杂度 O(n)，空间复杂度 O(n)
```

### llama.cpp 的 KV Cache 分配

llama.cpp 为每一层预先分配一块**固定大小**的 KV Cache：

```c
// 每层 KV cache 大小（字节）
size_t kv_size_per_layer =
    (size_t)n_ctx          // 上下文长度
  * n_kv_heads             // KV 头数（GQA 时 < n_heads）
  * head_dim               // 每头维度 = hidden_dim / n_heads
  * 2                      // K 和 V 各一份
  * ggml_type_size(kv_type); // 通常 F16 = 2 bytes，或 Q8_0 = 1 byte
```

**LLaMA 7B 示例计算**（F16 精度，4096 上下文）：

```
模型参数：
  n_layers  = 32
  n_kv_heads = 32    (LLaMA 7B 使用 MHA，KV 头数 = 注意力头数)
  head_dim  = 128    (4096 hidden_dim / 32 heads)
  kv_type   = F16    (2 bytes)

每层 KV cache = 4096 × 32 × 128 × 2 × 2 = 67,108,864 bytes = 64 MB
总 KV cache   = 32 × 64 MB = 2,048 MB ≈ 2 GB
```

这就是为什么大上下文会消耗大量内存！128K 上下文的 KV cache 会是 4096 上下文的 32 倍。

### GQA（Grouped Query Attention）节省 KV Cache

LLaMA 3 等新模型使用 GQA：多个 Query 头共享同一组 KV 头。

```
LLaMA 3.2 3B:
  n_heads     = 24   (Q 头数)
  n_kv_heads  = 8    (KV 头数，为 Q 头数的 1/3)
  → KV cache 缩小为原来的 1/3
```

### n_ctx_per_seq 与 n_seq_max

llama.cpp 支持**多序列**共享同一个 KV Cache（用于 batch 并发推理）：

```
总 KV cache slots = n_ctx
                  = n_seq_max × n_ctx_per_seq
```

例如：`n_ctx=4096, n_seq_max=4` → 每个序列最多用 1024 个 KV slot。llama-server 的 `--parallel` 参数正是控制 `n_seq_max`。

---

## 5. 量化 Kernel 内部机制

### Q4_K_M 格式：Superblock 结构

Q4_K 格式将权重分组进行量化，结构如下：

```diagram
一个 Q4_K "superblock" = 256 个浮点数
│
├─ 12 个 "block"，每块 32 个元素
│    ├─ scale（FP16）：块的缩放因子
│    ├─ min  （FP16）：块的最小值偏置
│    └─ 32 个 4-bit 整数（存储为 16 字节，每字节存 2 个值）
│
└─ superblock 级别的 scale + min（6-bit 精度）
```

内存布局（每 256 个 float32 → 约 144 字节，压缩率约 7:1）：

```
[d: FP16][dmin: FP16][scales/mins: 12×6bit packed][qs: 128 bytes (256×4bit)]
```

### 反量化（Dequantization）运算

矩阵乘法时，Q4_K 权重**不会提前解压**，而是在计算时**即时反量化**：

```c
// 概念性的反量化过程（简化）
float dequantize_q4(uint8_t q4_val, float scale, float min) {
    // q4_val 是 0-15 的 4-bit 整数
    return scale * (float)q4_val + min;
}
```

### AVX2 向量化反量化（简化示意）

```c
// 实际 llama.cpp 中使用 AVX2 指令一次处理 32 个值
#include <immintrin.h>

void dequant_q4_k_avx2(
    const uint8_t *restrict qs,   // 4-bit 量化值
    const float *restrict scales, // 缩放因子数组
    float *restrict output,       // 输出 float32
    int n                         // 元素数量
) {
    __m256i mask_low4  = _mm256_set1_epi8(0x0F);  // 低 4-bit 掩码
    __m256i mask_high4 = _mm256_set1_epi8(0xF0);  // 高 4-bit 掩码

    for (int i = 0; i < n/32; i++) {
        // 加载 16 字节（存储了 32 个 4-bit 值）
        __m128i raw = _mm_loadu_si128((__m128i*)(qs + i*16));
        __m256i raw256 = _mm256_cvtepu8_epi16(raw);

        // 分离低位和高位的 4-bit 值
        __m256i lo = _mm256_and_si256(raw256, mask_low4);
        __m256i hi = _mm256_srli_epi16(_mm256_and_si256(raw256, mask_high4), 4);

        // 转换为 float 并乘以 scale
        __m256 scale_vec = _mm256_set1_ps(scales[i]);
        __m256 lo_f = _mm256_mul_ps(_mm256_cvtepi32_ps(/* lo */), scale_vec);
        // ... 存储到 output
    }
}
```

### 为什么量化反而更快？

看似矛盾，实则有充分理由：

```
FP16 矩阵乘法（无量化）：
  瓶颈：内存带宽（从 RAM/VRAM 读取 FP16 权重）
  每秒能读取的权重数 = 内存带宽 / 2 bytes

Q4_K 矩阵乘法（含即时反量化）：
  每秒能读取的权重数 = 内存带宽 / 0.5 bytes（4-bit）
  额外反量化开销 << 节省的内存读取时间

结论：内存带宽是瓶颈，减小数据量 = 提升速度
      在现代 CPU/GPU 上，反量化计算几乎"免费"
```

---

## 6. 后端系统架构

### ggml_backend 接口

llama.cpp 的后端系统是一套**硬件抽象层**，允许同一份计算图在不同硬件上执行：

```c
// ggml_backend 接口（简化）
struct ggml_backend_i {
    const char * (*get_name)(ggml_backend_t backend);

    // 在此后端分配一块显存/内存
    ggml_backend_buffer_t (*alloc_buffer)(
        ggml_backend_t backend, size_t size);

    // 执行计算图（核心接口）
    enum ggml_status (*graph_compute)(
        ggml_backend_t backend, struct ggml_cgraph *cgraph);

    // 在 CPU 和此后端之间同步数据
    bool (*supports_op)(ggml_backend_t backend, const struct ggml_tensor *op);
};
```

### 三种主要后端对比

| 后端 | 适用平台 | 加速方式 | 特点 |
|------|----------|----------|------|
| CPU backend | 所有平台 | AVX2/AVX512/NEON | 默认回退，稳定 |
| CUDA backend | NVIDIA GPU | cuBLAS + 自定义 kernel | 最高吞吐量 |
| Metal backend | Apple Silicon | Metal Shaders | macOS/iOS 专用，功耗低 |
| Vulkan backend | 跨平台 GPU | Vulkan Compute | AMD/Intel GPU |

### n_gpu_layers 如何路由层到 GPU

```diagram
n_gpu_layers = 35  （将前 35 层放 GPU，其余在 CPU）

┌──────────────────────────────────────────────┐
│  Layer 0-34 → CUDA backend (VRAM)            │
│  Layer 35-31 → CPU backend (RAM)             │  ← 这里假设共 32 层
│  token_embd, lm_head → CPU                  │
└──────────────────────────────────────────────┘

数据流：
  输入 token → CPU RAM
  → 送到 GPU（cudaMemcpy）
  → 前 35 层在 GPU 上计算
  → 中间激活值送回 CPU（cudaMemcpy）
  → 剩余层在 CPU 上计算
  → 输出 logits
```

### Backend Scheduler（调度器）

`ggml_backend_sched` 负责在混合 CPU/GPU 环境中调度：

1. 分析计算图中每个节点，决定在哪个后端执行
2. 自动插入数据传输节点（GPU→CPU 或 CPU→GPU）
3. 避免不必要的数据往返

---

## 7. 采样算法实现

### 完整采样 Pipeline

```diagram
logits (词表大小的原始分数，如 32000 维)
  │
  ▼
[Temperature Scaling]  logits /= temperature
  │  temperature=1.0 → 原始分布
  │  temperature<1.0 → 更确定，峰值更尖锐
  │  temperature>1.0 → 更随机，分布更均匀
  ▼
[Repetition Penalty]   惩罚最近出现过的 token
  │
  ▼
[Softmax]              exp(logits) / sum(exp(logits)) → 概率分布
  │
  ▼
[Top-K Filter]         只保留概率最高的 K 个 token（如 K=40）
  │                    其余 token 概率置为 0
  ▼
[Top-P / Nucleus]      按概率从大到小累加，直到累积概率超过 P（如 P=0.9）
  │                    只保留累积概率 P 内的 token
  ▼
[Multinomial Sample]   从过滤后的分布中随机抽样
  │
  ▼
next_token (int)
```

### Mirostat：基于"惊喜度"的自适应采样

Mirostat 是 llama.cpp 支持的一种先进采样方法，目标是控制生成文本的**困惑度（perplexity）**在目标值附近：

```python
# Mirostat v2 核心逻辑（简化伪代码）
def mirostat_sample(logits, tau=5.0, eta=0.1, mu=None):
    """
    tau: 目标"惊喜度"（信息熵），越大越随机
    eta: 学习率，控制 mu 的更新速度
    mu:  当前的自适应截断阈值（初始 = 2*tau）
    """
    if mu is None:
        mu = 2 * tau

    # 1. Softmax 得到概率
    probs = softmax(logits)

    # 2. 按概率排序，截断到 mu 控制的范围
    sorted_probs = sorted(probs, reverse=True)
    cumulative_surprise = 0.0
    k = 0
    for p in sorted_probs:
        # surprise = -log2(p)（信息量）
        surprise = -math.log2(p)
        if cumulative_surprise + surprise > mu:
            break
        cumulative_surprise += surprise
        k += 1

    # 3. 从前 k 个 token 中采样
    next_token = sample_from_top_k(probs, k)

    # 4. 根据实际惊喜度更新 mu
    actual_surprise = -math.log2(probs[next_token])
    mu = mu - eta * (actual_surprise - tau)

    return next_token, mu
```

### 采样链代码（llama-cpp-python 风格）

```python
from llama_cpp import Llama

llm = Llama(model_path="./model.gguf", n_ctx=2048)

# 使用完整采样参数
output = llm(
    "Once upon a time",
    max_tokens=200,
    temperature=0.8,      # 温度缩放
    top_k=40,             # Top-K 过滤
    top_p=0.95,           # Top-P Nucleus 过滤
    repeat_penalty=1.1,   # 重复惩罚
    # mirostat_mode=2,    # 开启 Mirostat v2（与 top_k/top_p 互斥）
    # mirostat_tau=5.0,
)
print(output["choices"][0]["text"])
```

---

## 8. llama-server 并发模型

### 整体架构

```diagram
                    HTTP 请求
                       │
              ┌────────▼────────┐
              │   httplib.h     │  轻量级 HTTP 服务器
              │  (HTTP server)  │
              └────────┬────────┘
                       │ 解析请求，放入任务队列
              ┌────────▼────────┐
              │   Task Queue    │  线程安全队列
              │  (mutex + cv)   │
              └────────┬────────┘
                       │ 调度器分配任务到 slot
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
  ┌─────────┐    ┌─────────┐    ┌─────────┐
  │ Slot 0  │    │ Slot 1  │    │ Slot N  │
  │(序列 0) │    │(序列 1) │    │(序列 N) │
  └────┬────┘    └────┬────┘    └────┬────┘
       └───────────────┴───────────────┘
                       │ 每轮 decode 处理一个 batch
              ┌────────▼────────┐
              │  llama_decode() │  单次批量前向传播
              │  (batch 推理)   │
              └────────┬────────┘
                       │ 采样，更新各 slot 状态
              ┌────────▼────────┐
              │   SSE Stream    │  推送 token 到客户端
              └─────────────────┘
```

### "Slot" 是什么？

Slot 是 llama-server 中的**并发推理单元**。每个 slot 代表一个独立的对话序列，维护自己的：

- KV cache 占用的 token 范围（`cell_min` 到 `cell_max`）
- 当前生成状态（prefill/decode/idle）
- 请求参数（temperature, top_p 等）
- 已生成的 token 列表

```
--parallel 4 意味着：
  4 个 slot 同时活跃
  每轮 llama_decode 可以包含来自 4 个不同序列的 token
  batch 大小 = 活跃 slot 数量（decode 阶段每 slot 贡献 1 个 token）
```

### 连续批处理（Continuous Batching）

llama-server 实现了**连续批处理**：不等所有序列同时开始，新请求可以在任意时刻加入：

```
时间轴：
t=0  [Slot0: prefill 512 tokens] [Slot1: idle]
t=1  [Slot0: decode] [Slot1: prefill 128 tokens]
t=2  [Slot0: decode] [Slot1: decode]
t=3  [Slot0: done]   [Slot1: decode] [Slot2: prefill]
```

这避免了等待"齐头并进"的浪费，提高了 GPU/CPU 利用率。

---

## 总结

llama.cpp 的架构设计体现了几个核心思想：

1. **内存效率优先**：Arena 分配器、mmap 零拷贝加载、量化压缩，都是为了在有限内存中运行大模型
2. **延迟执行计算图**：先构建 DAG，再统一调度执行，便于跨后端优化
3. **硬件抽象**：Backend 接口将计算与硬件解耦，同一套代码可在 CPU/CUDA/Metal 上运行
4. **带宽优先于计算**：LLM 推理是 memory-bound，量化减少带宽消耗是提速的核心手段

理解这些原理后，遇到性能问题、内存 OOM、精度问题时，你就能快速定位到正确的调优方向。


---


## 1. 从源码编译

### 获取源码

```bash
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
```

### 方式一：Make（快速验证）

```bash
# 基础 CPU 编译
make -j$(nproc)

# 启用 OpenBLAS 加速（提升矩阵运算速度）
make -j$(nproc) GGML_OPENBLAS=1
```

编译产物位于当前目录，可直接运行 `./llama-cli`。

### 方式二：CMake（推荐用于生产）

```bash
# NVIDIA GPU（CUDA）
cmake -B build \
  -DGGML_CUDA=ON \
  -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release -j$(nproc)

# 验证编译结果
./build/bin/llama-cli --version
```

**常用 CMake 编译选项说明：**

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-DGGML_CUDA=ON` | 启用 NVIDIA CUDA 加速，需要安装 CUDA Toolkit | OFF |
| `-DGGML_METAL=ON` | 启用 Apple Metal 加速，macOS 上 Apple Silicon 默认开启 | 自动检测 |
| `-DGGML_VULKAN=ON` | 启用 Vulkan 加速，适合 AMD/Intel GPU | OFF |
| `-DGGML_OPENBLAS=ON` | 链接 OpenBLAS，提升 CPU 矩阵运算性能 | OFF |
| `-DGGML_BLAS=ON` | 自动检测系统 BLAS（OpenBLAS/MKL） | OFF |
| `-DCMAKE_BUILD_TYPE=Release` | 开启编译器优化（-O3），生产必须 | Debug |
| `-DLLAMA_BUILD_SERVER=ON` | 同时编译 llama-server | ON |

### macOS Apple Silicon

```bash
# Metal 在 Apple Silicon 上默认启用，无需额外参数
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release -j$(nproc)

# 如果要禁用 Metal（纯 CPU）
cmake -B build -DGGML_METAL=OFF -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release -j$(nproc)
```

### Windows（Visual Studio）

```powershell
# 打开 "Developer Command Prompt for VS 2022"
cmake -B build -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release -G "Visual Studio 17 2022"
cmake --build build --config Release

# 编译产物位于 build\bin\Release\
.\build\bin\Release\llama-cli.exe --version
```

**前置依赖**：
- Visual Studio 2019+ 或 Build Tools（含 C++ 工作负载）
- CUDA Toolkit 12.x（如需 GPU）
- CMake 3.21+

---

## 2. 下载模型与快速上手

### 从 HuggingFace 下载 GGUF 模型

```bash
# 安装 huggingface_hub 客户端
pip install huggingface_hub

# 下载 Llama 3.2 3B Instruct（Q4_K_M 量化，约 2GB）
huggingface-cli download bartowski/Llama-3.2-3B-Instruct-GGUF \
  --include "Llama-3.2-3B-Instruct-Q4_K_M.gguf" \
  --local-dir ./models

# 或者下载 Qwen2.5 7B（中文能力更强）
huggingface-cli download Qwen/Qwen2.5-7B-Instruct-GGUF \
  --include "qwen2.5-7b-instruct-q4_k_m*.gguf" \
  --local-dir ./models
```

> **小提示**：可以在 [Hugging Face](https://huggingface.co/bartowski) 搜索 `GGUF` 找到大量已量化好的模型。

### 基础推理命令

```bash
# 简单文本补全（非对话模式）
./build/bin/llama-cli \
  -m ./models/Llama-3.2-3B-Instruct-Q4_K_M.gguf \
  -p "量子纠缠是什么？用简单语言解释：" \
  -n 300 \
  --temp 0.7 \
  --top-p 0.9

# 对话模式（Chat 格式，使用模型自带的聊天模板）
./build/bin/llama-cli \
  -m ./models/Llama-3.2-3B-Instruct-Q4_K_M.gguf \
  --chat-template llama3 \
  -i \
  -n -1 \
  --temp 0.7
```

**常用命令行参数：**

| 参数 | 说明 | 示例 |
|------|------|------|
| `-m <path>` | 模型文件路径 | `-m ./models/model.gguf` |
| `-p <prompt>` | 输入提示词 | `-p "你好"` |
| `-n <tokens>` | 最多生成多少 token（-1 为无限） | `-n 500` |
| `--temp <float>` | 温度（0=确定性，1=标准，>1=创意） | `--temp 0.7` |
| `--top-p <float>` | Nucleus 采样阈值 | `--top-p 0.9` |
| `-c <int>` | 上下文窗口大小 | `-c 4096` |
| `-t <int>` | CPU 线程数 | `-t 8` |
| `-ngl <int>` | 卸载到 GPU 的层数 | `-ngl 35` |
| `--mlock` | 将模型锁定在 RAM 中防止换出 | `--mlock` |

---

## 3. llama-cpp-python Python API

### 安装

```bash
# 纯 CPU 版本
pip install llama-cpp-python

# CUDA 加速版本（需要已安装 CUDA Toolkit）
CMAKE_ARGS="-DGGML_CUDA=on" pip install llama-cpp-python --force-reinstall

# Metal 加速版本（macOS Apple Silicon）
CMAKE_ARGS="-DGGML_METAL=on" pip install llama-cpp-python --force-reinstall

# 含 web server 的版本（额外安装 FastAPI/uvicorn）
pip install "llama-cpp-python[server]"
```

### 基础用法：Llama 类

```python
from llama_cpp import Llama

# 加载模型
llm = Llama(
    model_path="./models/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
    n_ctx=4096,        # 上下文窗口大小
    n_gpu_layers=35,   # 卸载到 GPU 的层数（0 = 纯 CPU）
    n_threads=8,       # CPU 线程数（建议 = 物理核心数）
    verbose=False,     # 关闭调试输出
)

# 文本补全 API
output = llm(
    "The quick brown fox",
    max_tokens=100,
    temperature=0.8,
    top_p=0.95,
    stop=["。", "\n\n"],   # 遇到这些 token 停止生成
)
print(output["choices"][0]["text"])
```

### Chat Completion API

```python
from llama_cpp import Llama

llm = Llama(
    model_path="./models/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
    n_ctx=4096,
    n_gpu_layers=35,
    chat_format="llama-3",   # 指定聊天格式，自动处理特殊 token
    verbose=False,
)

# 兼容 OpenAI 的 chat completions 接口
response = llm.create_chat_completion(
    messages=[
        {"role": "system", "content": "你是一个乐于助人的 AI 助手。"},
        {"role": "user",   "content": "用 Python 写一个快速排序算法"},
    ],
    max_tokens=512,
    temperature=0.7,
)
print(response["choices"][0]["message"]["content"])
```

### 流式输出（Streaming）

```python
from llama_cpp import Llama

llm = Llama(
    model_path="./models/model.gguf",
    n_ctx=4096,
    n_gpu_layers=35,
    verbose=False,
)

# 流式输出：逐 token 打印，实现打字机效果
stream = llm.create_chat_completion(
    messages=[{"role": "user", "content": "讲一个关于程序员的笑话"}],
    max_tokens=200,
    temperature=0.9,
    stream=True,     # 开启流式模式
)

print("回答：", end="", flush=True)
for chunk in stream:
    delta = chunk["choices"][0]["delta"]
    if "content" in delta:
        print(delta["content"], end="", flush=True)
print()  # 换行
```

### 嵌入向量（Embedding）

```python
# 启用 embedding 模式
llm_embed = Llama(
    model_path="./models/model.gguf",
    embedding=True,    # 开启 embedding 模式
    n_ctx=512,
    verbose=False,
)

text = "llama.cpp 是一个高效的推理框架"
embedding = llm_embed.embed(text)
print(f"向量维度: {len(embedding)}")  # 通常是模型的 hidden_dim
```

---

## 4. 量化格式选择指南

### 格式对比表（以 LLaMA 7B 为基准）

| 格式 | 模型大小 | 所需 RAM | 质量损失 | 推荐场景 |
|------|----------|----------|----------|----------|
| `F32` | 28 GB | 32+ GB | 无损失（基准） | 研究/微调基准 |
| `F16` | 14 GB | 16+ GB | 极小 | GPU 内存充足时 |
| `Q8_0` | 7.2 GB | 9 GB | 几乎无损 | 最高质量量化 |
| `Q6_K` | 5.5 GB | 7 GB | 极小 | 高质量，较省内存 |
| `Q5_K_M` | 5.0 GB | 6.5 GB | 很小 | 质量与大小平衡 |
| **`Q4_K_M`** | **4.1 GB** | **5.5 GB** | **小** | **最佳默认选择 ✓** |
| `Q4_K_S` | 3.9 GB | 5.2 GB | 略大 | 内存偏紧时 |
| `Q3_K_M` | 3.3 GB | 4.5 GB | 中等 | 内存较少 |
| `Q2_K` | 2.7 GB | 3.8 GB | 较大 | 内存严重受限 |
| `IQ2_M` | 2.5 GB | 3.5 GB | 中等 | 新型整数量化 |

> **命名规则**：`Q{bits}_{variant}` 中 `K` 表示 K-quant（使用分块缩放），`M/S/L` 表示 Medium/Small/Large（混合精度策略）。

### "选量化"决策树

```diagram
你的可用内存是多少？
│
├─ 充足（>= 16 GB RAM 或 16 GB VRAM）
│    └─ 追求最高质量？
│         ├─ 是 → F16 或 Q8_0
│         └─ 否 → Q5_K_M（性价比高）
│
├─ 适中（8-16 GB）
│    └─ Q4_K_M（推荐默认）
│         或 Q5_K_M（内存稍宽松时）
│
├─ 紧张（4-8 GB）
│    └─ Q4_K_S 或 Q3_K_M
│         取决于你能接受多大质量损失
│
└─ 极度受限（< 4 GB）
     └─ Q2_K 或 IQ2_M（质量损失明显）
          或考虑换用更小的模型（3B/1B）
```

**实用建议**：
- **日常使用**：`Q4_K_M` 是最常见的选择，质量损失约等于 FP16 的 99%，体积只有 30%
- **代码生成**：推荐 `Q5_K_M` 或 `Q6_K`，代码质量对精度更敏感
- **中文模型**：Qwen2.5 / Yi 等中文模型同样支持所有 GGUF 量化格式

---

## 5. llama-server：OpenAI 兼容 API

### 启动服务

```bash
./build/bin/llama-server \
  -m ./models/Llama-3.2-3B-Instruct-Q4_K_M.gguf \
  --host 0.0.0.0 \
  --port 8080 \
  -c 4096 \          # 总上下文窗口大小
  -t 8 \             # CPU 线程数
  -ngl 35 \          # 卸载到 GPU 的层数
  --parallel 4 \     # 最多同时处理 4 个请求（slots）
  --ctx-size 4096 \  # 每个 slot 的上下文
  --chat-template llama3  # 聊天模板
```

服务启动后可访问 `http://localhost:8080` 查看内置 Web UI。

### curl 调用示例

```bash
# 对话请求（兼容 OpenAI /v1/chat/completions）
curl -s http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [
      {"role": "system", "content": "你是一个乐于助人的助手。"},
      {"role": "user", "content": "Python 中的 GIL 是什么？"}
    ],
    "max_tokens": 500,
    "temperature": 0.7
  }' | jq '.choices[0].message.content'

# 流式输出
curl -s http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "写一首诗"}], "stream": true}' \
  --no-buffer
```

### Python openai 客户端调用

```python
from openai import OpenAI

# 将 base_url 指向本地 llama-server
client = OpenAI(
    base_url="http://localhost:8080/v1",
    api_key="not-needed",   # llama-server 默认不需要 API key
)

# 普通请求
response = client.chat.completions.create(
    model="local-llama",   # 模型名无关紧要，llama-server 忽略此字段
    messages=[
        {"role": "system", "content": "你是一位资深 Python 工程师。"},
        {"role": "user",   "content": "解释 Python 的 asyncio 事件循环"},
    ],
    max_tokens=800,
    temperature=0.7,
)
print(response.choices[0].message.content)

# 流式请求
stream = client.chat.completions.create(
    model="local-llama",
    messages=[{"role": "user", "content": "给我讲讲 Transformer 架构"}],
    stream=True,
)
for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
```

---

## 6. LangChain 集成

### 安装依赖

```bash
pip install langchain langchain-community llama-cpp-python
```

### 基础 LLM 集成

```python
from langchain_community.llms import LlamaCpp
from langchain.callbacks.manager import CallbackManager
from langchain.callbacks.streaming_stdout import StreamingStdOutCallbackHandler

# 创建 LLM 实例（流式输出到 stdout）
llm = LlamaCpp(
    model_path="./models/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
    n_ctx=4096,
    n_gpu_layers=35,
    temperature=0.7,
    max_tokens=512,
    top_p=0.9,
    callback_manager=CallbackManager([StreamingStdOutCallbackHandler()]),
    verbose=False,
)

# 直接调用
result = llm.invoke("用一句话解释什么是机器学习")
```

### Prompt Template + Chain

```python
from langchain.prompts import PromptTemplate
from langchain_community.llms import LlamaCpp

llm = LlamaCpp(
    model_path="./models/model.gguf",
    n_ctx=2048,
    n_gpu_layers=35,
    temperature=0.5,
    verbose=False,
)

# 定义 Prompt 模板
template = PromptTemplate(
    input_variables=["language", "task"],
    template="用 {language} 语言写一个函数，功能是：{task}。只输出代码，不需要解释。"
)

# 构建链
chain = template | llm

# 调用
result = chain.invoke({"language": "Python", "task": "计算斐波那契数列的第 n 项"})
print(result)
```

---

## 7. 构建本地 RAG 系统

RAG（Retrieval-Augmented Generation）系统允许 LLM 基于你的私有文档回答问题。以下是一个完整的本地 RAG 实现：

### 安装依赖

```bash
pip install llama-cpp-python sentence-transformers chromadb langchain langchain-community
```

### 完整 RAG 实现

```python
"""
本地 RAG 系统：使用 llama.cpp + ChromaDB + sentence-transformers
无需联网，所有数据留在本地
"""
import os
from typing import List

from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.llms import LlamaCpp
from langchain_community.vectorstores import Chroma
from langchain.embeddings.base import Embeddings
from langchain.chains import RetrievalQA
from langchain.schema import Document
from sentence_transformers import SentenceTransformer


# ─── 1. 本地 Embedding 模型 ───────────────────────────────────────────────────

class LocalEmbeddings(Embeddings):
    """包装 sentence-transformers，适配 LangChain Embeddings 接口"""

    def __init__(self, model_name: str = "BAAI/bge-m3"):
        # BGE-M3 支持中英文，效果优秀
        self.model = SentenceTransformer(model_name)

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        embeddings = self.model.encode(texts, normalize_embeddings=True)
        return embeddings.tolist()

    def embed_query(self, text: str) -> List[float]:
        embedding = self.model.encode([text], normalize_embeddings=True)
        return embedding[0].tolist()


# ─── 2. 准备文档 ──────────────────────────────────────────────────────────────

def load_documents(data_dir: str) -> List[Document]:
    """加载目录中的所有 .txt 和 .md 文件"""
    documents = []
    for filename in os.listdir(data_dir):
        if filename.endswith((".txt", ".md")):
            filepath = os.path.join(data_dir, filename)
            with open(filepath, "r", encoding="utf-8") as f:
                content = f.read()
            documents.append(Document(
                page_content=content,
                metadata={"source": filename}
            ))
    return documents


def split_documents(documents: List[Document]) -> List[Document]:
    """将长文档切分为小块（chunk）"""
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=500,      # 每块最多 500 字符
        chunk_overlap=50,    # 相邻块重叠 50 字符，避免信息断裂
        separators=["\n\n", "\n", "。", "！", "？", " ", ""],
    )
    return splitter.split_documents(documents)


# ─── 3. 构建向量数据库 ────────────────────────────────────────────────────────

def build_vectorstore(chunks: List[Document], persist_dir: str = "./chroma_db") -> Chroma:
    """将文档块向量化并存入 ChromaDB"""
    embeddings = LocalEmbeddings()
    vectorstore = Chroma.from_documents(
        documents=chunks,
        embedding=embeddings,
        persist_directory=persist_dir,
    )
    return vectorstore


def load_vectorstore(persist_dir: str = "./chroma_db") -> Chroma:
    """加载已有的向量数据库（避免重复构建）"""
    embeddings = LocalEmbeddings()
    return Chroma(
        persist_directory=persist_dir,
        embedding_function=embeddings,
    )


# ─── 4. 构建 RAG Chain ────────────────────────────────────────────────────────

def build_rag_chain(vectorstore: Chroma) -> RetrievalQA:
    """组装完整的 RAG pipeline"""

    # 本地 LLM
    llm = LlamaCpp(
        model_path="./models/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
        n_ctx=4096,
        n_gpu_layers=35,
        temperature=0.1,     # RAG 场景下降低温度，减少幻觉
        max_tokens=1024,
        verbose=False,
    )

    # 检索器：每次检索最相似的 3 个文档块
    retriever = vectorstore.as_retriever(
        search_type="similarity",
        search_kwargs={"k": 3},
    )

    # RetrievalQA chain：检索 + 生成
    qa_chain = RetrievalQA.from_chain_type(
        llm=llm,
        chain_type="stuff",   # 将检索到的文档直接塞进 prompt
        retriever=retriever,
        return_source_documents=True,  # 返回来源文档
    )
    return qa_chain


# ─── 5. 主程序 ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    DATA_DIR = "./docs"       # 你的文档目录
    DB_DIR   = "./chroma_db"  # 向量库持久化目录

    # 首次运行：构建向量库
    if not os.path.exists(DB_DIR):
        print("正在构建向量数据库...")
        docs   = load_documents(DATA_DIR)
        chunks = split_documents(docs)
        print(f"共 {len(docs)} 个文件，切分为 {len(chunks)} 个块")
        vectorstore = build_vectorstore(chunks, DB_DIR)
        print("向量数据库构建完成！")
    else:
        print("加载已有向量数据库...")
        vectorstore = load_vectorstore(DB_DIR)

    # 构建 RAG chain
    qa = build_rag_chain(vectorstore)

    # 开始问答
    while True:
        question = input("\n请输入问题（输入 q 退出）：").strip()
        if question.lower() == "q":
            break

        result = qa.invoke({"query": question})
        print(f"\n回答：{result['result']}")
        print("\n来源文档：")
        for doc in result["source_documents"]:
            print(f"  - {doc.metadata['source']}: {doc.page_content[:100]}...")
```

---

## 8. 性能调优指南

### CPU 线程数（n_threads）

```bash
# 错误做法：用逻辑核心数（包含超线程）
# 正确做法：只用物理核心数

# Linux：查看物理核心数
nproc --all                    # 逻辑核心（包含 HT）
lscpu | grep "Core(s) per socket"  # 每颗 CPU 的物理核心数

# 示例：8 核 16 线程的 CPU，应设置 n_threads=8
./build/bin/llama-cli -m model.gguf -t 8 ...

# 原因：ggml 的矩阵运算是 memory-bound，超线程共享缓存，
# 反而会引起缓存竞争，超过物理核心数后性能不升反降
```

### GPU 层数（n_gpu_layers）调优

```bash
# 策略：从 0 开始，每次增加 5-10 层，观察 tokens/s 变化

# 第一步：纯 CPU 基线
./build/bin/llama-bench -m model.gguf -ngl 0

# 第二步：逐步增加 GPU 层
./build/bin/llama-bench -m model.gguf -ngl 10
./build/bin/llama-bench -m model.gguf -ngl 20
./build/bin/llama-bench -m model.gguf -ngl 35
./build/bin/llama-bench -m model.gguf -ngl 100  # 全部层放 GPU

# 如果 VRAM 不足会报错，此时减少 ngl
# 最优值：让 VRAM 使用率达到 90% 左右
```

### Batch Size（批大小）

```bash
# batch_size 影响 prefill（提示词处理）速度
# 越大 prefill 越快，但内存占用更多

# 默认 512，可以增大到 2048（内存允许时）
./build/bin/llama-server -m model.gguf --batch-size 2048

# ubatch（物理批大小）：实际送入后端的批大小，通常 = batch_size / 4
./build/bin/llama-server -m model.gguf --batch-size 2048 --ubatch-size 512
```

### 内存锁定（mlock）

```bash
# --mlock 将模型权重锁定在物理内存，防止被交换到 swap
# 对于 SSD 较慢的机器，可以避免生成中途突然变慢

./build/bin/llama-server -m model.gguf --mlock

# Linux 可能需要增大 mlock 限制
ulimit -l unlimited
```

### Flash Attention

```bash
# --flash-attn 使用 Flash Attention 算法，节省 KV cache 内存，加快长上下文推理
./build/bin/llama-server -m model.gguf --flash-attn -c 32768

# 适合长上下文（>4096）场景，短上下文收益不明显
```

### 基准测试命令

```bash
# llama-bench：标准性能测试工具
./build/bin/llama-bench \
  -m ./models/model.gguf \
  -ngl 35 \       # GPU 层数
  -t 8 \          # CPU 线程
  -p 512 \        # prefill token 数（测提示词处理速度）
  -n 128 \        # decode token 数（测生成速度）
  -r 3            # 重复 3 次取平均

# 输出示例：
# pp512  =  234.56 ± 2.34 t/s   ← prefill 速度
# tg128  =   18.23 ± 0.45 t/s   ← decode（生成）速度
```

---

## 9. 常见错误与调试

### Metal not found / Metal 初始化失败

**症状**：`ggml_metal_init: failed to load default.metallib`

```bash
# 原因：编译时 Metal 库没有正确嵌入
# 方法 1：重新编译，确保 CMake 能找到 Metal 框架
cmake -B build -DGGML_METAL=ON -DCMAKE_BUILD_TYPE=Release
cmake --build build -j$(nproc)

# 方法 2：临时禁用 Metal，使用 CPU
./llama-cli -m model.gguf --no-metal

# 方法 3：手动指定 metallib 路径
GGML_METAL_PATH_RESOURCES=./build ./llama-cli -m model.gguf
```

### CUDA 显存不足（OOM）

**症状**：`CUDA error: out of memory` 或 `CUBLAS_STATUS_ALLOC_FAILED`

```bash
# 原因：n_gpu_layers 设置过高，VRAM 不足
# 解决：减少 GPU 层数，让部分层在 CPU 运行

# 查看 VRAM 使用量
nvidia-smi

# 减少 GPU 层数（每减 1 层约节省 模型大小/层数 的 VRAM）
./llama-server -m model.gguf -ngl 20   # 原来是 35

# 或者减小上下文长度（KV cache 占用 VRAM）
./llama-server -m model.gguf -ngl 35 -c 2048   # 原来是 4096
```

### 超出上下文长度

**症状**：`llama_decode: KV cache is full` 或生成质量突然下降

```bash
# 原因：输入 token 数 + 已生成 token 数 超过了 -c 设置的上下文
# 解决 1：减少输入长度（缩短 system prompt 或历史对话）
# 解决 2：增大上下文（需要更多内存）
./llama-server -m model.gguf -c 8192

# 解决 3：使用支持更长上下文的模型（如 Llama 3.1 支持 128K）
# 注意：长上下文 KV cache 内存消耗与 n_ctx 成正比
```

### Segmentation Fault（段错误）

**症状**：程序直接崩溃，无错误信息

```bash
# 常见原因和解决方案：
# 1. 模型文件损坏或格式不对（GGML vs GGUF 混淆）
#    验证：file ./models/model.gguf  # 应该显示 GGUF 格式信息
#    修复：重新下载模型文件

# 2. 版本不匹配（旧版 llama.cpp 打开新版 GGUF）
#    修复：更新到最新版 llama.cpp，重新编译

# 3. 内存不足（RAM 使用率 100%，触发 OOM killer）
#    验证：dmesg | grep -i "killed process"
#    修复：使用更小的量化版本，或增加 swap

# 开启调试模式获取详细错误信息
./llama-cli -m model.gguf -v  # verbose 模式
```

### CPU 推理速度慢

**症状**：生成速度 < 2 tokens/s（对于 7B 模型）

```bash
# 检查点 1：n_threads 是否正确
lscpu | grep "Core(s) per socket"   # 获取物理核心数
./llama-cli -m model.gguf -t <物理核心数>

# 检查点 2：是否链接了 BLAS（加速矩阵运算）
./llama-cli --version 2>&1 | grep -i blas
# 没有 BLAS 时重新编译：
cmake -B build -DGGML_OPENBLAS=ON -DCMAKE_BUILD_TYPE=Release
cmake --build build -j$(nproc)

# 检查点 3：CPU 频率是否被降频（电源管理）
# Linux：
cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor
# 应为 performance，若为 powersave 则改为：
echo "performance" | sudo tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor

# 检查点 4：模型是否全部加载进内存（避免重复读盘）
./llama-cli -m model.gguf --mlock  # 锁定内存
```

---

## 10. 生产级 FastAPI 服务

以下是一个完整的、可直接部署的 FastAPI 服务，包含请求队列、健康检查、错误处理和日志记录：

```python
"""
生产级 llama.cpp FastAPI 服务
功能：
- 健康检查端点
- OpenAI 兼容的 /v1/chat/completions 端点（含流式）
- 请求队列（并发控制）
- 结构化日志
- 优雅错误处理
"""
import asyncio
import logging
import time
import uuid
from contextlib import asynccontextmanager
from typing import AsyncGenerator, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from llama_cpp import Llama

# ─── 日志配置 ─────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("llama-service")


# ─── 配置 ─────────────────────────────────────────────────────────────────────

MODEL_PATH    = "./models/Llama-3.2-3B-Instruct-Q4_K_M.gguf"
N_CTX         = 4096
N_GPU_LAYERS  = 35
N_THREADS     = 8
MAX_QUEUE_SIZE = 10   # 最大排队请求数


# ─── 全局状态 ─────────────────────────────────────────────────────────────────

llm: Optional[Llama] = None
request_semaphore: Optional[asyncio.Semaphore] = None  # 同时处理 1 个请求


# ─── 应用生命周期 ──────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用启动/关闭时执行"""
    global llm, request_semaphore

    logger.info(f"正在加载模型：{MODEL_PATH}")
    start = time.time()

    # 在线程池中加载模型，避免阻塞事件循环
    loop = asyncio.get_event_loop()
    llm = await loop.run_in_executor(
        None,
        lambda: Llama(
            model_path=MODEL_PATH,
            n_ctx=N_CTX,
            n_gpu_layers=N_GPU_LAYERS,
            n_threads=N_THREADS,
            chat_format="llama-3",
            verbose=False,
        )
    )
    request_semaphore = asyncio.Semaphore(1)  # 同时只处理 1 个推理请求

    logger.info(f"模型加载完成，耗时 {time.time() - start:.1f}s")
    yield
    # 关闭时清理
    logger.info("服务正在关闭...")
    del llm


app = FastAPI(
    title="Local LLM Service",
    version="1.0.0",
    lifespan=lifespan,
)


# ─── 数据模型 ─────────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str     # "system" | "user" | "assistant"
    content: str

class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    max_tokens: int = 512
    temperature: float = 0.7
    top_p: float = 0.9
    stream: bool = False
    stop: Optional[List[str]] = None

class ChatResponse(BaseModel):
    id: str
    object: str = "chat.completion"
    model: str = "local-llama"
    choices: list


# ─── 端点实现 ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    """健康检查：返回服务状态"""
    return {
        "status": "healthy",
        "model_loaded": llm is not None,
        "model_path": MODEL_PATH,
    }


@app.post("/v1/chat/completions")
async def chat_completions(request: ChatRequest):
    """OpenAI 兼容的 chat completions 端点"""
    if llm is None:
        raise HTTPException(status_code=503, detail="模型未加载")

    # 将 Pydantic 对象转为字典列表
    messages = [{"role": m.role, "content": m.content} for m in request.messages]
    request_id = f"chatcmpl-{uuid.uuid4().hex[:8]}"

    logger.info(f"[{request_id}] 收到请求，消息数={len(messages)}, stream={request.stream}")

    # 流式响应
    if request.stream:
        return StreamingResponse(
            _stream_response(request_id, messages, request),
            media_type="text/event-stream",
            headers={"X-Request-ID": request_id},
        )

    # 非流式响应：等待完整结果
    async with request_semaphore:
        start = time.time()
        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                lambda: llm.create_chat_completion(
                    messages=messages,
                    max_tokens=request.max_tokens,
                    temperature=request.temperature,
                    top_p=request.top_p,
                    stop=request.stop,
                    stream=False,
                )
            )
        except Exception as e:
            logger.error(f"[{request_id}] 推理失败: {e}")
            raise HTTPException(status_code=500, detail=f"推理失败: {str(e)}")

    elapsed = time.time() - start
    n_tokens = result["usage"]["completion_tokens"]
    logger.info(f"[{request_id}] 完成，生成 {n_tokens} tokens，耗时 {elapsed:.1f}s，"
                f"速度 {n_tokens/elapsed:.1f} t/s")

    # 注入请求 ID
    result["id"] = request_id
    return result


async def _stream_response(
    request_id: str,
    messages: list,
    request: ChatRequest,
) -> AsyncGenerator[str, None]:
    """生成 SSE 流式响应"""
    async with request_semaphore:
        loop = asyncio.get_event_loop()

        # 在线程池中运行同步的流式生成
        queue: asyncio.Queue = asyncio.Queue()

        def run_inference():
            try:
                for chunk in llm.create_chat_completion(
                    messages=messages,
                    max_tokens=request.max_tokens,
                    temperature=request.temperature,
                    top_p=request.top_p,
                    stop=request.stop,
                    stream=True,
                ):
                    loop.call_soon_threadsafe(queue.put_nowait, chunk)
                loop.call_soon_threadsafe(queue.put_nowait, None)  # 结束信号
            except Exception as e:
                loop.call_soon_threadsafe(queue.put_nowait, e)

        loop.run_in_executor(None, run_inference)

        while True:
            chunk = await queue.get()
            if chunk is None:
                break
            if isinstance(chunk, Exception):
                logger.error(f"[{request_id}] 流式推理失败: {chunk}")
                break

            chunk["id"] = request_id
            import json
            yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"

        yield "data: [DONE]\n\n"


# ─── 启动入口 ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=8000,
        log_level="info",
        access_log=True,
    )
```

### 启动与测试

```bash
# 安装依赖
pip install fastapi uvicorn[standard] llama-cpp-python pydantic

# 启动服务
python server.py

# 测试健康检查
curl http://localhost:8000/health

# 测试对话
curl -s http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "你好，介绍一下自己"}],
    "max_tokens": 200,
    "temperature": 0.7
  }' | python -m json.tool
```

### Docker 部署（可选）

```dockerfile
FROM python:3.11-slim

# 安装编译依赖
RUN apt-get update && apt-get install -y \
    build-essential cmake git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 安装 Python 依赖
RUN pip install --no-cache-dir \
    fastapi uvicorn[standard] \
    "llama-cpp-python[server]" \
    pydantic

# 复制应用代码
COPY server.py .

# 模型通过 volume 挂载，不打包进镜像
VOLUME ["/app/models"]

EXPOSE 8000
CMD ["python", "server.py"]
```

```bash
# 构建镜像
docker build -t llama-service .

# 运行（挂载模型目录）
docker run -d \
  -p 8000:8000 \
  -v $(pwd)/models:/app/models \
  --name llama-service \
  llama-service
```

---

## 总结

通过本指南，你已经掌握了：

1. **编译**：不同平台（Linux/macOS/Windows）的编译方法和关键选项
2. **模型选择**：如何根据硬件选择合适的量化格式（Q4_K_M 是最佳起点）
3. **Python API**：llama-cpp-python 的完整用法，包括流式输出和嵌入向量
4. **服务部署**：llama-server 的生产级配置和调优
5. **应用集成**：LangChain 集成和本地 RAG 系统的完整实现
6. **性能调优**：线程、GPU 层数、batch 等关键参数的调优方法
7. **问题排查**：常见错误的原因和解决方案
8. **生产服务**：带队列和错误处理的 FastAPI 服务完整实现

llama.cpp 的核心价值在于**让大模型推理真正可及**——无论是个人开发者在笔记本上实验，还是企业在本地服务器上部署隐私敏感的业务，它都是目前最成熟、最高效的选择。


---

