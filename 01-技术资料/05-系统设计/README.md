# 05-系统设计 — 技术资料

> 系统设计学习文档，涵盖高并发、分布式系统及架构设计原则。

## 文档列表

| 序号 | 文件 | 描述 | 对应面试题 |
|------|------|------|-----------|
| 03-00 | [llama.cpp 项目综述与技术原理](./03-llama.cpp/00-项目综述与技术原理.md) | llama.cpp 整体介绍、GGML、GGUF、量化方法、后端支持 | [面试题](../../../02-面试指南/05-系统设计面试/03-llama.cpp面试题.md) |
| 03-01 | [llama.cpp 架构详解与核心组件](./03-llama.cpp/01-架构详解与核心组件.md) | ggml 张量库、GGUF 格式、推理代码、KV Cache、量化 kernel、后端系统、采样算法、server 并发 | [面试题](../../../02-面试指南/05-系统设计面试/03-llama.cpp面试题.md) |
| 03-02 | [llama.cpp 生产应用与工程实践](./03-llama.cpp/02-生产应用与工程实践.md) | 编译、模型下载、Python API、量化选择、llama-server、LangChain、RAG 系统、性能调优、FastAPI 服务 | [面试题](../../../02-面试指南/05-系统设计面试/03-llama.cpp面试题.md) |
| 04-00 | [DeepSpeed 项目综述与技术原理](./04-DeepSpeed/00-项目综述与技术原理.md) | ZeRO 三阶段原理、显存计算、ZeRO-Infinity、推理优化、与 FSDP/Megatron 对比 | [面试题](../../../02-面试指南/05-系统设计面试/04-DeepSpeed面试题.md) |
| 04-01 | [DeepSpeed 架构详解与核心组件](./04-DeepSpeed/01-架构详解与核心组件.md) | DeepSpeedEngine、Reduce-Scatter/All-Gather 原语、参数分片重建、Activation Checkpointing、混合精度、ds_config、Pipeline Parallel、MII | [面试题](../../../02-面试指南/05-系统设计面试/04-DeepSpeed面试题.md) |
| 04-02 | [DeepSpeed 生产应用与工程实践](./04-DeepSpeed/02-生产应用与工程实践.md) | 环境搭建、DDP 迁移对比、ZeRO Stage 2/3 配置、HuggingFace 集成、多机训练、OOM 调试、吞吐基准 | [面试题](../../../02-面试指南/05-系统设计面试/04-DeepSpeed面试题.md) |
| 05-00 | [Megatron-LM 项目综述与技术原理](./05-Megatron-LM/00-项目综述与技术原理.md) | 3D 并行原理、张量并行/流水线并行/数据并行、显存分析、与 DeepSpeed/FSDP 对比 | [面试题](../../02-面试指南/05-系统设计面试/05-Megatron-LM面试题.md) |
| 05-01 | [Megatron-LM 架构详解与核心组件](./05-Megatron-LM/01-架构详解与核心组件.md) | 进程组初始化、ColumnParallelLinear/RowParallelLinear、流水线调度、分布式检查点、FlashAttention 集成 | [面试题](../../02-面试指南/05-系统设计面试/05-Megatron-LM面试题.md) |
| 05-02 | [Megatron-LM 生产应用与工程实践](./05-Megatron-LM/02-生产应用与工程实践.md) | 环境搭建、并行策略选择、训练脚本参数、数据预处理、检查点转换、MFU 监控、常见问题调试 | [面试题](../../02-面试指南/05-系统设计面试/05-Megatron-LM面试题.md) |

## 主要内容方向

- 分布式系统基础（CAP、BASE、一致性）
- 高可用架构（负载均衡、熔断、限流）
- 消息队列（Kafka、RabbitMQ、RocketMQ）
- 分布式缓存
- 分布式事务
- API 设计（RESTful、gRPC、GraphQL）
- 经典系统设计案例（URL 短链、秒杀系统等）

## 导航

- ← [技术资料总目录](../README.md)
- ↔ [系统设计面试指南](../../02-面试指南/05-系统设计面试/README.md)
