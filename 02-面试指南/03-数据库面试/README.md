# 03-数据库面试 — 面试指南

> 数据库方向面试题目与解析，涵盖关系型数据库、NoSQL 及缓存技术。

## 文档列表

| 序号 | 文件 | 描述 | 对应技术资料 |
|------|------|------|-------------|
| 01 | [01-向量数据库面试题.md](./01-向量数据库面试题.md) | 向量嵌入 / ANN 搜索 / HNSW / IVF / Chroma / Milvus 架构 / 混合搜索 22 道分层面试题 | [技术资料](../../01-技术资料/03-数据库/01-向量数据库.md) |
| 02 | [02-Redis面试题.md](./02-Redis面试题.md) | Redis 数据结构底层(SDS/listpack/skiplist/quicklist) / 持久化深度(RDB COW/AOF重写/混合) / 内存管理 / 集群架构(16384slots/Gossip/脑裂) / Pipeline vs 事务 vs Lua / Redlock争议 / 布隆过滤器 / 排行榜 / 分布式限流 / 延迟队列 33 道分层面试题 | [技术资料](../../01-技术资料/03-数据库/02-Redis核心技术.md) |
| 03 | [03-PostgreSQL面试题.md](./03-PostgreSQL面试题.md) | 进程架构 / MVCC 可见性判断 / HOT 更新 / WAL / Checkpoint / B-tree High Key / SSI / VACUUM / XID Wraparound / BRIN / EXPLAIN 22 道分层面试题 | [技术资料](../../01-技术资料/03-数据库/03-PostgreSQL核心技术.md) |
| 04 | [04-MySQL-InnoDB面试题.md](./04-MySQL-InnoDB面试题.md) | Buffer Pool LRU / B+树聚簇索引 / MVCC Read View / Next-Key Lock / Change Buffer / Doublewrite / 崩溃恢复 / 死锁 / 索引优化 22 道分层面试题 | [技术资料](../../01-技术资料/03-数据库/04-MySQL-InnoDB核心技术.md) |
| 05 | [05-MongoDB面试题.md](./05-MongoDB面试题.md) | BSON / WiredTiger / 复制集 / 分片 / 事务 / Embedding vs Referencing / 聚合管道 / 索引设计 / 性能调优 30 道分层面试题 | [技术资料](../../01-技术资料/03-数据库/05-MongoDB核心技术.md) |
| 06 | [06-Elasticsearch面试题.md](./06-Elasticsearch面试题.md) | 倒排索引 / 分词器 / Query DSL / 聚合分析 / 分布式架构 / Mapping 设计 / BM25 评分 / 深分页优化 / ILM 生命周期 / 性能调优 24 道分层面试题 | [技术资料](../../01-技术资料/03-数据库/06-Elasticsearch核心技术.md) |

## 高频考点方向

- MySQL 索引原理（B+树）
- MySQL 事务与锁
- SQL 优化与执行计划
- Redis 数据结构与底层实现
- Redis 持久化、集群、主从复制
- MySQL vs MongoDB 对比
- 数据库设计与范式

## 导航

- ← [面试指南总目录](../)
- ↔ [数据库技术资料](../../01-技术资料/03-数据库/)
