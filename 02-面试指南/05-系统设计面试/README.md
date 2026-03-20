# 05-系统设计面试 — 面试指南

> 系统设计方向高频面试题，覆盖 LLM 推理优化、分布式训练、分布式系统、消息队列。

## 相关链接

- 对应技术资料：[05-系统设计](../../01-技术资料/05-系统设计/README.md)

## 面试题目录

| 序号 | 文件名 | 覆盖知识点 | 关联技术资料 |
|------|--------|-----------|-------------|
| 01 | [01-LLM推理引擎面试题.md](./01-LLM推理引擎面试题.md) | KV Cache / PagedAttention / Continuous Batching / vLLM / TensorRT-LLM / llama.cpp | [技术资料](../../01-技术资料/05-系统设计/01-LLM推理引擎优化.md) |
| 02 | [02-分布式训练面试题.md](./02-分布式训练面试题.md) | ZeRO Stage 1/2/3 深度 / 3D 并行(TP+PP+DP) / 通信原语(Ring/Tree AllReduce) / 混合精度(BF16/FP16/FP8) / Pipeline 调度(GPipe/PipeDream/1F1B) / 故障恢复·Elastic Training / DeepSpeed·Megatron-LM 工程实践 30 道分层题 | [技术资料](../../01-技术资料/05-系统设计/02-分布式训练技术.md) |
| 03 | [03-llama.cpp面试题.md](./03-llama.cpp面试题.md) | GGUF / 量化选型 / CPU SIMD / KV Cache / Metal-CUDA / 采样 / llama-server / ggml 29道分层题 | [技术资料](../../01-技术资料/05-系统设计/01-LLM推理引擎优化.md) |
| 04 | [04-分布式系统面试题.md](./04-分布式系统面试题.md) | CAP/PACELC / Raft 共识深度 / 分布式事务(2PC/3PC/Saga/Temporal) / 一致性哈希 / 缓存(延迟双删/热点Key) / 分布式锁(Redlock争议/fencing token) / 熔断限流(Circuit Breaker/Bulkhead/Rate Limiting) / Multi-Raft(TiKV) / CRDTs / 服务发现(etcd/Consul/Nacos) / 可观测性(OpenTelemetry/SLO) / 分布式追踪 30 道分层题 | [技术资料](../../01-技术资料/05-系统设计/03-分布式系统基础.md) |
| 05 | [05-消息队列面试题.md](./05-消息队列面试题.md) | Kafka 深度(ISR/Controller/Rebalance/Exactly-Once/事务) / Pulsar 架构(BookKeeper/分层存储) / 消息可靠性 / 顺序消息 / 消息积压 / 流处理(Flink窗口/水位线/状态) / 延迟消息(时间轮) / 实时数据管道 30 道分层题 | [技术资料](../../01-技术资料/05-系统设计/04-消息队列与流处理.md) |

## 导航

- ← [面试指南总目录](../README.md)
- ↔ [对应技术资料](../../01-技术资料/05-系统设计/README.md)
