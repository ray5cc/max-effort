# 03-数据库 — 技术资料

> 覆盖向量数据库、关系型数据库、缓存数据库等核心技术知识。

## 相关链接

- 对应面试指南：[03-数据库面试](../../02-面试指南/03-数据库面试/README.md)

## 文档列表

| 序号 | 文件名 | 覆盖技术知识点 | 关联面试题 |
|------|--------|---------------|-----------|
| 01 | [01-向量数据库.md](./01-向量数据库.md) | 向量嵌入 / HNSW 算法 / ANN 搜索 / 距离度量（Chroma、Milvus、Qdrant） | [面试题](../../02-面试指南/03-数据库面试/01-向量数据库面试题.md) |
| 02 | [02-Redis核心技术.md](./02-Redis核心技术.md) | SDS / ziplist / listpack / dict 渐进式 Rehash / skiplist / quicklist / RDB / AOF / 混合持久化 / jemalloc / LRU/LFU 淘汰 / ae 事件库 / epoll / 多线程IO / 主从复制 / Sentinel / Cluster / MULTI/EXEC / Lua 脚本 | [面试题](../../02-面试指南/03-数据库面试/02-Redis面试题.md) |
| 03 | [03-PostgreSQL核心技术.md](./03-PostgreSQL核心技术.md) | 多进程架构 / 堆表页面布局（PageHeaderData/HeapTupleHeaderData）/ B-tree 索引（nbtinsert.c/nbtsearch.c）/ MVCC 快照与可见性 / WAL（XLogInsert/流式复制）/ 火山模型执行器 / VACUUM 与 XID 冻结（postgres/postgres 源码）| [面试题](../../02-面试指南/03-数据库面试/03-PostgreSQL面试题.md) |
| 04 | [04-MySQL-InnoDB核心技术.md](./04-MySQL-InnoDB核心技术.md) | InnoDB 架构 / Buffer Pool LRU（Young/Old 分区）/ B+树聚簇索引与辅助索引 / MVCC（row_search_mvcc/Read View/Undo 版本链）/ 锁机制（Record/Gap/Next-Key Lock）/ Redo Log / Doublewrite Buffer（MariaDB/server storage/innobase/ 源码）| [面试题](../../02-面试指南/03-数据库面试/04-MySQL-InnoDB面试题.md) |
| 05 | [05-数据库高可用与安全.md](./05-数据库高可用与安全.md) | RTO/RPO、主从/半同步/异步复制、故障切换、读写分离一致性、备份与 PITR、TLS/TDE/字段加密、审计与租户隔离、防护与告警 | [面试题](../../02-面试指南/03-数据库面试/05-数据库高可用与安全面试题.md) |

## 导航

- ← [技术资料总目录](../README.md)
- ↔ [对应面试指南](../../02-面试指南/03-数据库面试/README.md)
