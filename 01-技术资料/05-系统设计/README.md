# 05-系统设计 — 技术资料

> 覆盖 LLM 推理优化、分布式训练等系统设计核心技术。

## 相关链接

- 对应面试指南：[05-系统设计面试](../../02-面试指南/05-系统设计面试/README.md)

## 文档列表

| 序号 | 文件名                                             | 覆盖技术知识点                                                                                                                             | 关联面试题                                                          |
| ---- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| 01   | [01-LLM推理引擎优化.md](./01-LLM推理引擎优化.md)   | KV Cache / PagedAttention / Continuous Batching / 量化 / CPU 推理（vLLM、TensorRT-LLM、llama.cpp）                                         | [面试题](../../02-面试指南/05-系统设计面试/01-LLM推理引擎面试题.md) |
| 02   | [02-分布式训练技术.md](./02-分布式训练技术.md)     | ZeRO Stage 1/2/3 / 张量并行 / 流水线并行 / 3D 并行（DeepSpeed、Megatron-LM）                                                               | [面试题](../../02-面试指南/05-系统设计面试/02-分布式训练面试题.md)  |
| 03   | [03-分布式系统基础.md](./03-分布式系统基础.md)     | CAP/PACELC 定理 / Raft 深度(Leader Election/Log Replication/Safety) / Multi-Raft(TiKV/CockroachDB) / 分布式事务(2PC/3PC/Saga/TCC/Temporal) / LSM-Tree vs B+Tree / 分片(Range/Hash/Hybrid) / 副本(主从/多主/Dynamo Quorum) / 缓存一致性(延迟双删/binlog) / Redis Cluster(16384 slots) / 服务注册中心(etcd/Consul/Nacos/ZK) / OpenTelemetry / SLO/SLI/Error Budget / 容错(Circuit Breaker/Bulkhead/Rate Limiting) / 分布式锁(Redis/Redlock/ZK) / 逻辑时钟 / CRDT / Gossip | [面试题](../../02-面试指南/05-系统设计面试/04-分布式系统面试题.md)  |
| 04   | [04-消息队列与流处理.md](./04-消息队列与流处理.md) | Kafka 深度(日志段/ISR/KRaft) / RabbitMQ(DLQ/Quorum Queue) / Flink / Kafka Streams / 幂等与事务                                             | [面试题](../../02-面试指南/05-系统设计面试/05-消息队列面试题.md)    |

## 说明

- 每篇文档聚焦**通用技术原理**，开源项目作为参考实现引用
- ASCII 图示 + 代码示例，深入浅出

## 导航

- ← [技术资料总目录](../README.md)
- ↔ [对应面试指南](../../02-面试指南/05-系统设计面试/README.md)
