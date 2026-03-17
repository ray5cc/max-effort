# PostgreSQL 面试题

> 基于 PostgreSQL 源码（`postgres/postgres`）的分层面试题，涵盖进程架构、存储引擎、MVCC、WAL、查询执行器与 VACUUM 核心机制。

## 相关链接

- 对应技术资料：[PostgreSQL 核心技术](../../01-技术资料/03-数据库/03-PostgreSQL核心技术.md)

## 题目列表

---

## 🔥 高频考点速记

> 面试中最常被问到的核心知识点，按出现频率排序。建议优先掌握前 5 项。

| #   | 考点              | 核心要点（一句话）                             | 出题概率 |
| --- | ----------------- | ---------------------------------------------- | -------- |
| 1   | MVCC 与可见性判断 | xmin/xmax + 快照比较，读写不阻塞               | ★★★★★    |
| 2   | WAL 与持久性      | Write-Ahead Logging，先写日志再写数据          | ★★★★★    |
| 3   | B-tree 索引实现   | Lehman & Yao 并发安全，High Key 优化           | ★★★★☆    |
| 4   | VACUUM 与膨胀     | 清理死元组，autovacuum 调优，VACUUM FULL 重建  | ★★★★★    |
| 5   | 事务隔离级别      | RC/RR/Serializable，SSI 代替 2PL               | ★★★★☆    |
| 6   | 执行计划分析      | EXPLAIN ANALYZE，Sequential vs Index Scan 决策 | ★★★★☆    |
| 7   | 流式复制          | WAL Sender/Receiver，同步/异步模式             | ★★★☆☆    |
| 8   | 堆表页面布局      | 8KB page，ItemId 数组+元组数据                 | ★★★☆☆    |
| 9   | HOT 更新          | 同页面更新免索引更新，减少膨胀                 | ★★★☆☆    |
| 10  | XID Wraparound    | 42亿事务ID上限，aggressive VACUUM 防范         | ★★★☆☆    |

---

### ⭐ 基础题

---

**Q1. PostgreSQL 采用什么进程模型？与 MySQL 的线程模型相比有何优缺点？**

**参考答案：**

PostgreSQL 采用**多进程模型**：每个客户端连接对应一个独立的 Backend 进程（由 Postmaster fork 创建）。

**优点：**

- 进程间天然内存隔离，一个 Backend 崩溃不会影响其他连接或主进程
- 利用 OS 进程管理机制，简化了崩溃恢复逻辑
- 安全性更好：进程间无法共享内存地址空间

**缺点：**

- 每个连接开销较大（fork 代价、进程上下文切换）
- 默认最大连接数（`max_connections`）通常设为 100-500，超高并发场景需要 PgBouncer 等连接池
- 每个进程独占自己的 CPU 缓存，相比线程模型有更多缓存 miss

MySQL 使用一连接一线程模型，线程共享内存空间，创建代价低，但线程崩溃可能影响整个进程。

**关键知识点：** `src/backend/postmaster/postmaster.c` 的 `BackendStartup` → `fork_process()` → `BackendRun()`。

---

**Q2. 解释 PostgreSQL 中什么是 WAL，它解决了什么问题？**

**参考答案：**

WAL（Write-Ahead Logging，预写日志）是 PostgreSQL 实现 ACID 中**持久性（Durability）**和**崩溃恢复**的核心机制。

**核心原则：** 任何数据页修改写入磁盘之前，必须先将对应的 WAL 记录持久化到 WAL 文件。

**解决的问题：**

1. **崩溃恢复**：崩溃后重启时，从最近 Checkpoint 位置重放 WAL 记录，将数据库恢复到崩溃前的一致状态
2. **性能**：WAL 是顺序追加写（比随机 I/O 高效得多），数据页可以延迟异步刷盘
3. **流式复制**：主库将 WAL 流式传输给备库，备库通过重放 WAL 保持与主库同步

**LSN（Log Sequence Number）**：WAL 的字节偏移量，用于标识 WAL 位置，每个数据页在其头部存储最后修改时的 LSN。

---

**Q3. PostgreSQL 的 B-tree 索引与 Hash 索引的区别是什么？各自适用什么场景？**

**参考答案：**

|            | B-tree                                            | Hash                        |
| ---------- | ------------------------------------------------- | --------------------------- |
| 支持操作   | `=`, `<`, `>`, `BETWEEN`, `LIKE 'x%'`, `ORDER BY` | 仅 `=`                      |
| 结构       | 平衡树（O(log n) 查找）                           | 哈希表（O(1) 等值查找）     |
| 范围查询   | ✓（叶子节点双向链表）                             | ✗                           |
| 排序支持   | ✓（索引有序）                                     | ✗                           |
| 大小       | 中等                                              | 相对小                      |
| WAL 持久化 | ✓                                                 | ✓（PG 10+，之前不记录 WAL） |

**适用场景：**

- B-tree：99% 的场景默认选择，支持最广泛的操作符
- Hash：仅纯等值查询的大表，且不需要排序或范围（实际很少使用，B-tree 一般够用）

---

**Q4. 什么是 VACUUM？为什么 PostgreSQL 需要定期执行 VACUUM？**

**参考答案：**

**背景：** PostgreSQL 的 MVCC 实现通过保留旧版本 tuple（而非原地修改）来支持多版本并发读。UPDATE/DELETE 不会立即删除旧数据，而是将其标记为死元组（dead tuple）。

**VACUUM 的核心工作：**

1. **回收死元组**：将 `t_xmax` 已提交的死 tuple 标记为可复用，释放空间给后续插入
2. **更新 Visibility Map（VM）**：标记页面内所有 tuple 对所有事务可见，供 Index Only Scan 优化
3. **更新 Free Space Map（FSM）**：记录各页剩余空间，供 INSERT 快速定位合适页面
4. **冻结旧 XID**：防止 XID Wraparound 问题（32位 XID 约42亿上限）

**不执行 VACUUM 的后果：**

- 表空间不断膨胀（bloat）
- 查询需要扫描大量死元组，性能下降
- XID 年龄达到阈值时数据库拒绝连接，强制进入维护模式

---

**Q5. 解释 PostgreSQL 的事务隔离级别以及默认级别是什么？**

**参考答案：**

PostgreSQL 支持 4 种隔离级别（READ UNCOMMITTED 实现等同 READ COMMITTED）：

| 隔离级别                   | 脏读 | 不可重复读 | 幻读 | 实现方式           |
| -------------------------- | ---- | ---------- | ---- | ------------------ |
| READ COMMITTED（**默认**） | 否   | 可能       | 可能 | 每条语句获取新快照 |
| REPEATABLE READ            | 否   | 否         | 否\* | 事务开始时获取快照 |
| SERIALIZABLE               | 否   | 否         | 否   | SSI + 谓词锁       |

\*PostgreSQL 的 REPEATABLE READ 通过 MVCC 快照天然避免幻读（不同于 MySQL 用 Gap Lock）。

**默认级别 READ COMMITTED** 适合大多数 OLTP 场景：读写不互相阻塞，并发性好。

**SERIALIZABLE** 使用 SSI（Serializable Snapshot Isolation），通过检测事务间的 rw-anti-dependency 环来发现序列化冲突，不会产生大量锁。

---

**Q6. PostgreSQL 中 `pg_stat_activity` 视图能告诉我们什么？**

**参考答案：**

`pg_stat_activity` 是 DBA 最常用的监控视图，每行代表一个活跃连接/后台进程：

```sql
SELECT pid, usename, application_name, state, wait_event_type, wait_event, query
FROM pg_stat_activity
WHERE state != 'idle';
```

**关键字段：**

- `pid`：Backend 进程 ID
- `state`：`active`（正在执行）/ `idle`（空闲）/ `idle in transaction`（事务中等待）/ `idle in transaction (aborted)`
- `wait_event_type/wait_event`：等待原因（Lock/BufferPin/IO/Client 等）
- `query`：当前/最近执行的 SQL
- `query_start`：查询开始时间（可计算执行时长）
- `xact_start`：事务开始时间（`idle in transaction` + 时间长 → 需要关注）

---

### ⭐⭐ 进阶题

---

**Q7. 解释 HOT（Heap Only Tuple）更新优化的原理和条件。**

**参考答案：**

**问题背景：** 普通 UPDATE 产生新版本 tuple 时，会更新所有关联索引（即使被更新的列不在索引中）。高频 UPDATE 导致索引膨胀，I/O 增加。

**HOT 条件（两个条件必须同时满足）：**

1. 被更新的列**不在任何索引**中
2. 新 tuple 与旧 tuple 在**同一个数据页**中（页内有足够空闲空间）

**HOT 的工作原理：**

- 新 tuple 在旧 tuple 的 `t_ctid` 字段中建立指针链（旧→新）
- 旧 tuple 的 `t_infomask2` 设置 `HEAP_HOT_UPDATED` 标志
- 新 tuple 设置 `HEAP_ONLY_TUPLE` 标志，表示它没有独立的索引条目
- 索引条目**不变**，扫描时跟随 `t_ctid` 链找到最新版本

**收益：** 索引条目数量保持不变，避免索引膨胀，减少索引页 I/O。

**VACUUM 的作用：** `heap_page_prune()` 函数定期清理 HOT 链中已死亡的旧版本，维护链的紧凑性。

---

**Q8. 描述 PostgreSQL MVCC 中可见性判断的完整流程。**

**参考答案：**

可见性判断的核心函数是 `HeapTupleSatisfiesMVCC`（`src/backend/access/heap/heapam_visibility.c`）。

**判断流程：**

**步骤 1：检查 `t_xmin`（谁插入了这个版本）**

- `t_xmin == InvalidXID`：tuple 未完成插入 → 不可见
- `t_xmin` 的事务已中止（查 pg_clog）→ 不可见
- `t_xmin` > 快照的 `xmax`（快照后才开始的事务）→ 不可见
- `t_xmin` 在快照的 `xip` 中（快照时仍活跃）→ 不可见
- 否则（快照前已提交）→ 通过 t_xmin 检查，继续检查 t_xmax

**步骤 2：检查 `t_xmax`（谁删除/更新了这个版本）**

- `t_xmax == 0`：未被删除 → **可见**
- `t_xmax` 的事务已中止 → 删除被回滚 → **可见**
- `t_xmax` 在快照的 `xip` 中（快照时仍活跃）→ 删除未提交 → **可见**
- `t_xmax` > 快照的 `xmax` → 快照后才删除 → **可见**
- 否则（删除已提交且在快照前）→ **不可见**

**优化：** `t_infomask` 缓存事务提交/中止状态（`HEAP_XMIN_COMMITTED`, `HEAP_XMAX_ABORTED` 等标志），避免重复查询 pg_clog（SLRU），显著减少 I/O。

---

**Q9. PostgreSQL 如何实现流式复制？主库宕机后如何进行故障切换？**

**参考答案：**

**流式复制架构：**

- 主库：WAL Sender 进程读取 WAL 流，通过 TCP 发送给备库
- 备库：WAL Receiver 进程接收 WAL 记录，写入本地 WAL 文件，startup 进程持续回放

**WAL Sender 核心逻辑：**

1. 从 `pg_wal/` 目录读取待发送 WAL（当前位置到最新写入 LSN）
2. 通过 `pq_sendmessage` 发送 `XLogData` 消息
3. 接收备库的 `StandbyStatusUpdate`（汇报 `write_lsn / flush_lsn / apply_lsn`）

**同步复制（`synchronous_commit = on`）：** 主库在 COMMIT 时等待至少一个同步备库确认 `flush_lsn >= commit_lsn` 后才返回成功。

**故障切换（Failover）流程：**

1. 检测主库故障（`pg_is_in_recovery()` + 连接超时）
2. 确认备库已接收尽可能多的 WAL（选取 `apply_lsn` 最新的备库）
3. 在备库执行 `pg_promote()` 或创建 `recovery.signal` 后重启
4. 备库退出恢复模式，成为新主库
5. 其他备库更新 `primary_conninfo` 指向新主库，执行 `pg_rewind` 对齐分叉点

---

**Q10. 解释 Checkpoint 的作用、触发条件和 `checkpoint_completion_target` 的意义。**

**参考答案：**

**Checkpoint 的作用：**

- 将内存（shared_buffers）中所有脏页强制刷写到磁盘
- 在 WAL 中写入 checkpoint 记录，作为崩溃恢复的起始点
- 推进 `last_checkpoint_lsn`，允许旧 WAL 文件被回收/覆盖

**触发条件（满足任一）：**

- `checkpoint_timeout`（默认 5 分钟）时间到达
- WAL 积累量超过 `max_wal_size`（默认 1GB）
- `CHECKPOINT` 命令手动触发
- `pg_ctl stop` / 关闭数据库时

**`checkpoint_completion_target`（默认 0.9）的意义：**

如果两次 checkpoint 间隔为 T 秒，PostgreSQL 的目标是在 `T * 0.9` 秒内**均匀地**完成本次 checkpoint 的所有脏页刷盘。这样可以避免在 checkpoint 触发时刻产生 I/O 突刺，将 I/O 压力平摊到整个 checkpoint 间隔期间。

**调优建议：**

- 增大 `max_wal_size` 和 `checkpoint_timeout`，延长 checkpoint 间隔，减少 checkpoint 频率
- `checkpoint_completion_target = 0.9` 通常是好的默认值
- 监控 `pg_stat_bgwriter` 中的 `checkpoints_req`（触发量 checkpoint）vs `checkpoints_timed`（超时 checkpoint），前者多说明写入量大需增大 `max_wal_size`

---

**Q11. 解释 PostgreSQL B-tree 索引中的 High Key 概念及其作用。**

**参考答案：**

PostgreSQL B-tree 实现来自 Lehman & Yao 1981 年论文，**High Key** 是其核心设计之一。

**High Key 定义：** 每个非最右叶子页面的**第一个 line pointer** 指向该页的 High Key——即该页所能存储的最大键值（或包含最大值的键）。

**High Key 的作用（支持并发安全的页面分裂）：**

在并发环境下，一个线程可能在另一个线程修改 B-tree 时进行查找：

1. 线程 A 正在读叶子页 P，找到目标 key 所在位置
2. 线程 B 同时对页 P 进行分裂，将部分键值移到新页 Q，并更新 P 的 High Key

读线程 A 在持有页 P 读锁后，通过比较目标 key 与 P 的 High Key：

- 若 key <= High Key：目标在本页或已被正确处理
- 若 key > High Key：目标已移到右兄弟页 → 通过 `btpo_next` 指针**向右移动**（不需要从根重新开始）

这种"右移"机制（rightlink）使得并发查找不需要持有全树锁，大幅提高并发性。

---

**Q12. 什么是 SSI（Serializable Snapshot Isolation）？它与传统的基于锁的串行化有何不同？**

**参考答案：**

**SSI 原理（Michael J. Cahill 论文）：**

SSI 通过检测**可串行化异常**来实现真正的串行化隔离，而非用锁预防所有并发。

核心思想：任何非串行化的并发执行都可以表示为事务图中存在 **rw-anti-dependency 环**：

- T1 读了某数据 → T2 对该数据执行了写（T1 的快照无法看到 T2 的写）= `T1 -rw→ T2`
- T2 读了某数据 → T1 对该数据执行了写 = `T2 -rw→ T1`
- 两者形成环 → 无法串行化

**实现：**

- 每个事务维护**谓词锁（Predicate Lock）**，记录已读取的数据范围
- 写操作时检测是否与其他事务的谓词锁冲突
- 检测到 rw-anti-dependency 环 → 中止代价小的事务（`ERROR: could not serialize access due to read/write dependencies`）

**vs 基于锁的串行化（如 2PL）：**
| | SSI | 两阶段锁（2PL）|
|--|-----|---------------|
| 并发性 | 高（大多数情况无锁）| 低（读写相互阻塞）|
| 死锁 | 可能（abort 代替）| 可能 |
| 读阻塞写 | 否 | 是 |
| 实现复杂度 | 高 | 相对简单 |

---

### ⭐⭐⭐ 高级题

---

**Q13. 描述 PostgreSQL 堆页面的内部布局，包括 `PageHeaderData`、ItemId 数组和 Tuple 数据的位置关系。**

**参考答案：**

PostgreSQL 每个 8KB 页面（block）的内存布局如下（从低地址到高地址）：

```
偏移 0:   PageHeaderData (24 bytes)
          - pd_lsn (8B): 最后修改此页的 WAL LSN
          - pd_checksum (2B): 页面校验和
          - pd_flags (2B): PD_HAS_FREE_LINES, PD_PAGE_FULL, PD_ALL_VISIBLE
          - pd_lower (2B): ItemId 区域末尾（新 ItemId 从这里向右增长）
          - pd_upper (2B): Tuple 区域开始（新 Tuple 从这里向左增长）
          - pd_special (2B): Special 区域开始（堆表=页尾，索引页另有用途）
          - pd_pagesize_version (2B): 页大小和格式版本
          - pd_prune_xid (4B): 用于判断是否可 prune 的最小 XID

偏移 24+: ItemId 数组（每个 4 bytes，向高地址增长）
          - lp_off (15bit): Tuple 在页内的偏移
          - lp_flags (2bit): LP_UNUSED/LP_NORMAL/LP_REDIRECT/LP_DEAD
          - lp_len (15bit): Tuple 长度

(空闲空间，pd_lower 到 pd_upper 之间)

高地址:   Tuple 数据（向低地址增长）
          - 每个 Tuple = HeapTupleHeaderData + 用户数据
          - HeapTupleHeaderData 含 t_xmin/t_xmax/t_ctid/infomask

页尾:     Special 区域（堆表为空，B-tree 存 BTPageOpaqueData）
```

**关键点：**

- `FreeSpace = pd_upper - pd_lower`
- ItemId 是"间接层"，允许页内 Tuple 移动（HOT 链）而不影响索引
- `pd_all_visible` 位设置后，IndexOnlyScan 可跳过堆访问直接返回索引数据

---

**Q14. 什么是 XID Wraparound？PostgreSQL 如何防止它？**

**参考答案：**

**问题根源：** PostgreSQL 的 XID 是 32 位无符号整数（约 42 亿），可见性比较通过模运算实现（每个 XID 只能"看见"比它小约 21 亿和"看不见"比它大约 21 亿的事务）。

**Wraparound 危险场景：**

```
假设某 tuple 的 t_xmin = 5（非常古老的事务）
当前 XID = 2,000,000,000：5 在"过去"，tuple 可见 ✓

当 XID 增长到 2,500,000,000：
  2,500,000,000 - 5 = 2,499,999,995 > 2^31
  从模运算视角看，XID=5 现在在"未来"！
  → tuple 突然变为不可见！ → 数据丢失！
```

**防范机制：VACUUM FREEZE**

VACUUM 将年龄超过 `vacuum_freeze_min_age`（默认 5000万）的 tuple 的 `t_xmin` 替换为特殊的 `FrozenTransactionId`（XID=2）。冻结后的 tuple 对所有现在和将来的事务**永久可见**，不参与 wraparound 计算。

**关键参数：**

- `vacuum_freeze_min_age = 50,000,000`：低于此年龄不冻结（保留 MVCC 历史）
- `vacuum_freeze_table_age = 150,000,000`：表 relfrozenxid 年龄超过此值，强制全表冻结扫描
- `autovacuum_freeze_max_age = 200,000,000`：超过此值必须触发 autovacuum 冻结

**应急查询：**

```sql
SELECT datname, age(datfrozenxid) AS age,
       2147483647 - age(datfrozenxid) AS xids_remaining
FROM pg_database
ORDER BY age DESC;
-- age > 1.5亿 开始告警，> 2亿 强制维护
```

---

**Q15. 在什么情况下应该选择 BRIN 索引而不是 B-tree 索引？**

**参考答案：**

**BRIN（Block Range Index）** 的工作原理：

- 将表按**块范围**（默认 128 页）分组，每组只存储该范围内列值的 min/max
- 查询时，BRIN 找出 min/max 范围与查询条件重叠的块范围，只扫描这些块

**选择 BRIN 的条件（同时满足）：**

1. **表非常大**（数亿行以上）且空间紧张，无法承受 B-tree 索引大小
2. **列值与物理存储顺序高度相关**（即相关性 `correlation` 接近 1）
3. 查询模式是**范围查询**，且允许较低的精度（BRIN 只能做粗粒度过滤）

**典型场景：**

- 日志表中的时间戳（按时间顺序插入）
- IoT 传感器数据（按采集顺序插入）
- 批量导入的历史数据

**BRIN vs B-tree 对比：**

|                | B-tree               | BRIN                           |
| -------------- | -------------------- | ------------------------------ |
| 索引大小       | 大（与行数成正比）   | 极小（与块数成正比）           |
| 查询精度       | 精确（直接找到行）   | 粗粒度（确定块范围）           |
| 插入代价       | 中等（需维护树结构） | 极低（仅更新 min/max）         |
| 数据相关性要求 | 无                   | 高（相关性差则退化为全表扫描） |

**查看列相关性：**

```sql
SELECT attname, correlation
FROM pg_stats
WHERE tablename = 'your_table'
ORDER BY abs(correlation) DESC;
-- correlation 越接近 ±1，BRIN 效果越好
```

---

**Q16. 解释 `pg_stat_statements` 扩展的工作原理以及如何用它进行查询优化？**

**参考答案：**

`pg_stat_statements` 通过**钩子（Hook）机制**拦截所有 SQL 执行，统计每类查询的执行次数、总时间、行数等。

**工作原理：**

1. 通过 `ExecutorFinish_hook` 在每次查询执行结束时收集统计数据
2. 对 SQL 文本进行**归一化**处理（将常量替换为 `$1`, `$2` 等参数占位符），同类 SQL 聚合统计
3. 数据存储在共享内存中（`pg_stat_statements.max` 条），进程间共享

```sql
-- 安装
CREATE EXTENSION pg_stat_statements;

-- 查找最耗时的查询（总执行时间）
SELECT query,
       calls,
       total_exec_time / 1000 AS total_sec,
       mean_exec_time AS avg_ms,
       rows / calls AS avg_rows,
       stddev_exec_time AS stddev_ms   -- 标准差大 = 执行时间不稳定
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;

-- 查找 I/O 密集型查询
SELECT query, calls,
       shared_blks_hit,
       shared_blks_read,
       shared_blks_read / (shared_blks_hit + shared_blks_read + 0.001) AS miss_rate
FROM pg_stat_statements
WHERE shared_blks_read > 1000
ORDER BY shared_blks_read DESC;

-- 重置统计
SELECT pg_stat_statements_reset();
```

**优化步骤：**

1. 找出 `total_exec_time` 最高的 SQL
2. 用 `EXPLAIN (ANALYZE, BUFFERS)` 分析执行计划
3. 检查是否有 Seq Scan（考虑添加索引）
4. 检查 `rows` 估算是否准确（不准确则需 `ANALYZE` 更新统计信息）
5. `stddev_exec_time` 大的查询排查锁等待或 I/O 抖动

---

**Q17. PostgreSQL 表级锁的 8 种模式是什么？哪些锁会阻塞 SELECT 查询？**

**参考答案：**

PostgreSQL 表级锁从弱到强：

1. **ACCESS SHARE** — `SELECT`（只读）获取，与 ACCESS EXCLUSIVE 冲突
2. **ROW SHARE** — `SELECT FOR UPDATE/SHARE` 获取，与 EXCLUSIVE 和 ACCESS EXCLUSIVE 冲突
3. **ROW EXCLUSIVE** — `INSERT/UPDATE/DELETE` 获取，与 SHARE、SHARE ROW EXCLUSIVE、EXCLUSIVE、ACCESS EXCLUSIVE 冲突
4. **SHARE UPDATE EXCLUSIVE** — `VACUUM/ANALYZE/CREATE INDEX CONCURRENTLY` 获取
5. **SHARE** — `CREATE INDEX`（非并发）获取
6. **SHARE ROW EXCLUSIVE** — `CREATE TRIGGER/ALTER TABLE ADD FOREIGN KEY` 获取
7. **EXCLUSIVE** — 很少显式使用
8. **ACCESS EXCLUSIVE** — `ALTER TABLE/DROP TABLE/TRUNCATE/REINDEX/CLUSTER/VACUUM FULL/LOCK TABLE` 获取，与**所有其他锁**冲突

**会阻塞 SELECT 的锁：** 只有 **ACCESS EXCLUSIVE** 锁会阻塞 `SELECT`（因为 SELECT 获取 ACCESS SHARE，与 ACCESS EXCLUSIVE 冲突）。

**实践意义：**

- `ALTER TABLE` 需要 ACCESS EXCLUSIVE，会阻塞所有查询
- 长时间运行的事务 + `ALTER TABLE` = 严重锁等待
- 解决方案：`lock_timeout = '3s'`（超时则放弃 DDL）/ `CREATE INDEX CONCURRENTLY` 替代 `CREATE INDEX`

---

**Q18. 如何诊断和解决 PostgreSQL 中的查询性能问题？列出系统化的排查思路。**

**参考答案：**

**系统化排查步骤：**

**Step 1：发现问题查询**

```sql
-- 当前正在执行的长查询
SELECT pid, now() - query_start AS duration, query, state
FROM pg_stat_activity
WHERE state = 'active' AND now() - query_start > interval '5 seconds'
ORDER BY duration DESC;

-- 历史最耗时（pg_stat_statements）
SELECT query, calls, total_exec_time/calls AS avg_ms
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20;
```

**Step 2：分析执行计划**

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) <your query>;
-- 关注：Seq Scan on large table / actual rows >> estimated rows / Buffers: read (磁盘IO)
```

**Step 3：常见问题及修复**

| 现象               | 原因                               | 解决方案                                           |
| ------------------ | ---------------------------------- | -------------------------------------------------- |
| Seq Scan 大表      | 缺少索引或 `random_page_cost` 过高 | 添加索引 / 降低 `random_page_cost=1.1`（SSD）      |
| rows 估算严重偏差  | 统计信息过时                       | `ANALYZE table` / 提高 `default_statistics_target` |
| Hash Join 内存不足 | work_mem 太小                      | 增大 `work_mem=64MB`（慎：每连接）                 |
| 锁等待             | 长事务或 DDL                       | `pg_blocking_pids()` 找到阻塞源，kill 或优化事务   |
| 大量 dead tuples   | autovacuum 跟不上                  | 手动 VACUUM / 调整 autovacuum 参数                 |

**Step 4：索引优化**

- 添加复合索引时，等值条件列放前，范围/排序列放后
- 考虑部分索引（`WHERE is_active = true`）减少索引大小
- 使用 `pg_stat_user_indexes` 找出从未使用的索引（可删除）

---

**Q19. 解释 `EXPLAIN` 输出中 `cost` 的含义以及如何调整代价参数影响查询计划选择。**

**参考答案：**

**`cost=start..total` 的含义：**

- `start cost`：返回**第一行**的估算代价（对 LIMIT 查询有意义）
- `total cost`：返回**所有行**的估算代价（规划器默认优化目标）
- 代价单位：无量纲，以 `seq_page_cost=1.0` 为基准

**代价参数及调整场景：**

| 参数                   | 默认值 | 说明                                    | 调整场景             |
| ---------------------- | ------ | --------------------------------------- | -------------------- |
| `seq_page_cost`        | 1.0    | 顺序读一页的代价（基准）                | -                    |
| `random_page_cost`     | 4.0    | 随机读一页的代价                        | SSD 环境改为 1.1-2.0 |
| `cpu_tuple_cost`       | 0.01   | 处理一行的 CPU 代价                     | -                    |
| `cpu_index_tuple_cost` | 0.005  | 处理一条索引记录的代价                  | -                    |
| `effective_cache_size` | 4GB    | OS 文件缓存估算（影响 Index Scan 代价） | 设为实际内存 \* 0.75 |
| `parallel_tuple_cost`  | 0.1    | 并行 worker 传输一行的代价              | -                    |

**典型场景：** 数据库在 SSD 上，但优化器仍然选择 Seq Scan：

```sql
-- 全局或会话级别降低 random_page_cost
SET random_page_cost = 1.1;
-- 然后重新执行 EXPLAIN，通常会切换为 Index Scan
```

---

**Q20. 什么情况下需要手动执行 `VACUUM FULL`？它与普通 `VACUUM` 有什么本质区别？**

**参考答案：**

**本质区别：**

|          | VACUUM（普通）                             | VACUUM FULL                       |
| -------- | ------------------------------------------ | --------------------------------- |
| 锁级别   | ShareUpdateExclusiveLock（不阻塞读写）     | AccessExclusiveLock（阻塞所有）   |
| 空间处理 | 原地标记死元组空间为可重用，**不缩小文件** | 完整重建表文件，**将空间归还 OS** |
| 执行时间 | 快（只扫描包含死元组的页）                 | 慢（需要重建整张表 + 所有索引）   |
| 停机影响 | 在线执行，业务无感知                       | 需要维护窗口（表完全不可访问）    |

**何时需要 VACUUM FULL：**

1. **表严重膨胀**：删除了大量数据（如清理历史数据）后，表文件很大但实际数据很少，普通 VACUUM 无法缩小文件
2. **`pg_total_relation_size` >> 实际数据量**：说明有大量虚假空间
3. **查询性能因 bloat 严重下降**（需要扫描大量空页）

**替代方案（减少停机时间）：**

- `pg_repack` 扩展：在线重建表，只需短暂的最终切换锁
- 分区表：定期 DROP 旧分区（立即归还空间，无需 VACUUM FULL）

```sql
-- 检查表膨胀程度
SELECT relname,
       pg_size_pretty(pg_total_relation_size(oid)) total,
       pg_size_pretty(pg_relation_size(oid)) table_only,
       n_dead_tup, n_live_tup,
       round(100.0 * n_dead_tup / nullif(n_live_tup + n_dead_tup, 0), 1) dead_pct
FROM pg_stat_user_tables
WHERE n_dead_tup > 10000
ORDER BY n_dead_tup DESC;
```

---

**Q21. PostgreSQL 的查询执行器采用什么模型？与向量化执行引擎相比有何差异？**

**参考答案：**

**火山模型（Volcano/Iterator Model）：**

PostgreSQL 采用经典的**逐行拉取（Pull-based Row-at-a-time）**执行模型：

- 每个算子节点实现 `Init()` / `GetNext()` / `End()` 三个接口
- 顶层节点调用 `GetNext()`，递归向下驱动，每次返回一行
- 链式调用构成执行树，数据从叶子节点"流"向根节点

**优点：** 实现简单，内存占用少（每次只处理一行），适合高并发 OLTP

**缺点：**

- 函数调用开销大（每行每节点一次虚函数调用）
- 对 CPU 流水线不友好（分支多）
- CPU 缓存利用率低（每行数据很小）

**向量化执行（Vectorized Execution，如 DuckDB/ClickHouse）：**

- 每次 `GetNext()` 返回一个**向量**（批量行，如 1024 行）
- 算子对整个向量进行 SIMD 批量处理
- 减少虚函数调用次数，提高 CPU 利用率，适合 OLAP 大批量扫描

**PostgreSQL 的方向：** JIT（Just-In-Time）编译，使用 LLVM 将关键循环（表达式求值、比较操作）编译为机器码，减少解释器开销（`jit = on`，默认在 JIT 收益大时自动开启）。

---

**Q22. 描述 PostgreSQL autovacuum 在生产环境中常见的调优场景。**

**参考答案：**

**场景一：高频写入表（autovacuum 跟不上）**

现象：`pg_stat_user_tables.n_dead_tup` 持续增大，查询变慢。

```sql
-- 针对高频写入表降低触发阈值，增加资源
ALTER TABLE hot_table SET (
    autovacuum_vacuum_scale_factor = 0.01,  -- 1% 而非默认 20%
    autovacuum_vacuum_threshold = 100,
    autovacuum_vacuum_cost_delay = 0,        -- 不限速（后台负载允许时）
    autovacuum_vacuum_cost_limit = 800       -- 提高 cost limit（默认 200）
);
```

**场景二：全局 autovacuum worker 数量不足**

```ini
# postgresql.conf
autovacuum_max_workers = 6  # 默认 3，大库可增加
autovacuum_naptime = 30s    # 默认 60s，提高检查频率
```

**场景三：大表 VACUUM 被长事务阻塞**

现象：vacuum 启动但无法清理，因为有事务持有旧快照（旧 `xmin`）。

```sql
-- 找出阻塞 vacuum 的长事务
SELECT pid, now() - xact_start AS duration, state, query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY xact_start;

-- vacuum 无法清理比 xmin_horizon 更新的 dead tuples
SELECT datname, datfrozenxid, age(datfrozenxid)
FROM pg_database;
```

**场景四：Visibility Map 不更新导致 IndexOnlyScan 频繁 fallback**

```sql
-- 检查各表的 vm 覆盖情况
SELECT relname,
       heap_blks_hit, heap_blks_read,
       idx_blks_hit, idx_blks_read
FROM pg_statio_user_tables
WHERE heap_blks_read > 1000
ORDER BY heap_blks_read DESC;
-- 大量 heap_blks_read 说明 vm 未设置，index only scan 仍要读堆
```
