# 03-数据库 — 技术资料

> 覆盖向量数据库、关系型数据库、缓存数据库等核心技术知识。

## 相关链接

- 对应面试指南：[03-数据库面试](../../02-面试指南/03-数据库面试/)

## 文档列表

| 序号 | 文件名 | 覆盖技术知识点 | 关联面试题 |
|------|--------|---------------|-----------|
| 01 | [01-向量数据库.md](./01-向量数据库.md) | 向量嵌入 / HNSW 算法 / ANN 搜索 / 距离度量（Chroma、Milvus、Qdrant） | [面试题](../../02-面试指南/03-数据库面试/01-向量数据库面试题.md) |
| 02 | [02-Redis核心技术.md](./02-Redis核心技术.md) | SDS / ziplist / listpack / dict 渐进式 Rehash / skiplist / quicklist / RDB / AOF / 混合持久化 / jemalloc / LRU/LFU 淘汰 / ae 事件库 / epoll / 多线程IO / 主从复制 / Sentinel / Cluster / MULTI/EXEC / Lua 脚本 | [面试题](../../02-面试指南/03-数据库面试/02-Redis面试题.md) |
| 03 | [03-PostgreSQL核心技术.md](./03-PostgreSQL核心技术.md) | 多进程架构 / 堆表页面布局（PageHeaderData/HeapTupleHeaderData）/ B-tree 索引（nbtinsert.c/nbtsearch.c）/ MVCC 快照与可见性 / WAL（XLogInsert/流式复制）/ 火山模型执行器 / VACUUM 与 XID 冻结（postgres/postgres 源码）| [面试题](../../02-面试指南/03-数据库面试/03-PostgreSQL面试题.md) |
| 04 | [04-MySQL-InnoDB核心技术.md](./04-MySQL-InnoDB核心技术.md) | InnoDB 架构 / Buffer Pool LRU（Young/Old 分区）/ B+树聚簇索引与辅助索引 / MVCC（row_search_mvcc/Read View/Undo 版本链）/ 锁机制（Record/Gap/Next-Key Lock）/ Redo Log / Doublewrite Buffer（MariaDB/server storage/innobase/ 源码）| [面试题](../../02-面试指南/03-数据库面试/04-MySQL-InnoDB面试题.md) |
| 05 | [05-MongoDB核心技术.md](./05-MongoDB核心技术.md) | 文档模型与 BSON / WiredTiger 存储引擎（B+树/压缩/CheckPoint）/ 查询规划器 / 复制集（oplog/选举）/ 分片（Shard Key/Chunk Balancer）/ Read/Write Concern / 多文档事务 / Embedding vs Referencing / 聚合管道（$match/$group/$lookup）/ 索引设计 / 性能调优 | [面试题](../../02-面试指南/03-数据库面试/05-MongoDB面试题.md) |
| 06 | [06-Elasticsearch全文搜索.md](./06-Elasticsearch全文搜索.md) | 倒排索引原理（Term Dictionary/Posting List/Doc Values）/ Analyzer与分词（IK中文分词/ik_smart vs ik_max_word）/ Mapping映射设计（text vs keyword/nested类型）/ Query DSL（match/bool/相关性评分BM25）/ Aggregation聚合（Bucket/Metric/Pipeline）/ 分布式架构（分片分配/写入流程/搜索流程）/ 副本与故障恢复 / 性能优化（Bulk写入/Filter缓存/ILM生命周期）/ Dense Vector与kNN搜索 / Hybrid Search混合检索 / RAG系统集成 / ELK Stack日志分析 | [面试题](../../02-面试指南/03-数据库面试/06-Elasticsearch面试题.md) |

## 导航

- ← [技术资料总目录](../)
- ↔ [对应面试指南](../../02-面试指南/03-数据库面试/)
