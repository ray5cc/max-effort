# MySQL/InnoDB 核心技术深度解析

> InnoDB 是 MySQL 默认存储引擎——理解它的底层实现，就是理解 Buffer Pool 如何以 LRU 变体最大化内存利用率、B+树聚簇索引如何决定物理存储布局、MVCC 如何通过 Undo Log 链实现多版本并发、以及 Next-Key Lock 如何在范围查询中防止幻读。

## 相关链接
- 对应面试题：[MySQL/InnoDB 面试题](../../../02-面试指南/03-数据库面试/04-MySQL-InnoDB面试题.md)

## 目录
1. [InnoDB 整体架构](#1-innodb-整体架构)
   - 1.1 [内存结构](#11-内存结构)
   - 1.2 [磁盘结构](#12-磁盘结构)
   - 1.3 [关键状态变量](#13-关键状态变量)
2. [Buffer Pool 机制](#2-buffer-pool-机制)
   - 2.1 [LRU 链表分区](#21-lru-链表分区)
   - 2.2 [Flush 链表与脏页刷盘](#22-flush-链表与脏页刷盘)
   - 2.3 [预读机制](#23-预读机制)
   - 2.4 [Buffer Pool 监控](#24-buffer-pool-监控)
3. [B+树索引](#3-b树索引)
   - 3.1 [聚簇索引](#31-聚簇索引)
   - 3.2 [辅助索引](#32-辅助索引)
   - 3.3 [页面内部结构](#33-页面内部结构)
   - 3.4 [索引优化技术](#34-索引优化技术)
   - 3.5 [自适应哈希索引](#35-自适应哈希索引)
4. [MVCC 与事务](#4-mvcc-与事务)
   - 4.1 [Undo Log 结构](#41-undo-log-结构)
   - 4.2 [Read View 快照](#42-read-view-快照)
   - 4.3 [row_search_mvcc 可见性判断](#43-row_search_mvcc-可见性判断)
   - 4.4 [四种隔离级别实现](#44-四种隔离级别实现)
5. [锁机制](#5-锁机制)
   - 5.1 [行锁类型](#51-行锁类型)
   - 5.2 [意向锁](#52-意向锁)
   - 5.3 [锁的加锁规则](#53-锁的加锁规则)
   - 5.4 [死锁检测](#54-死锁检测)
6. [Redo Log 与崩溃恢复](#6-redo-log-与崩溃恢复)
   - 6.1 [Redo Log 格式与 LSN](#61-redo-log-格式与-lsn)
   - 6.2 [WAL 与 Doublewrite Buffer](#62-wal-与-doublewrite-buffer)
   - 6.3 [Checkpoint 机制](#63-checkpoint-机制)
   - 6.4 [崩溃恢复流程](#64-崩溃恢复流程)
7. [Change Buffer 与 Doublewrite](#7-change-buffer-与-doublewrite)
   - 7.1 [Change Buffer 原理](#71-change-buffer-原理)
   - 7.2 [Doublewrite 防止 Partial Write](#72-doublewrite-防止-partial-write)

---

## 1. InnoDB 整体架构

### 1.1 内存结构

```
InnoDB 内存结构
├── Buffer Pool（最重要，默认 128MB，生产建议 60-80% 物理内存）
│     ├── 数据页（16KB/页）
│     ├── 索引页
│     ├── 插入缓冲页（Change Buffer 的内存部分）
│     ├── Adaptive Hash Index
│     └── 锁信息
├── Change Buffer（写缓冲，原 Insert Buffer，max 25% of Buffer Pool）
│     └── 缓存对非唯一辅助索引页的写操作（页不在 Buffer Pool 中时）
├── Log Buffer（WAL 缓冲，默认 16MB）
│     └── Redo Log 记录先写入此处，再刷盘
└── Additional Memory Pool（已基本弃用，8.0 后移除）
```

### 1.2 磁盘结构

```
InnoDB 磁盘结构
├── 表空间（Tablespace）
│     ├── System Tablespace (ibdata1)      — 数据字典、Double Write Buffer、Undo Log（老版本）
│     ├── File-Per-Table Tablespace (.ibd) — 默认每表一个文件（innodb_file_per_table=ON）
│     ├── General Tablespace              — 手动创建，多表共享
│     └── Undo Tablespace (.ibu)          — 8.0 起 Undo Log 独立文件
├── Redo Log 文件 (ib_logfile0, ib_logfile1) — 循环写入，默认 2×50MB
├── Doublewrite Buffer 文件                  — 8.0.20 起独立文件
└── 表结构文件 (.frm → 8.0 后合并入 .ibd)
```

**空间层次（从大到小）：**

```
表空间(Tablespace) → 段(Segment) → 区(Extent, 1MB=64个页) → 页(Page, 16KB) → 行(Row)
```

### 1.3 关键状态变量

源码：`storage/innobase/srv/srv0srv.cc`（MariaDB/server）

```cpp
/* storage/innobase/srv/srv0srv.cc — srv_export_innodb_status() */
void srv_export_innodb_status() {
    export_vars.innodb_buffer_pool_size = srv_buf_pool_size;
    export_vars.innodb_buffer_pool_pages_total = buf_pool_get_n_pages();
    export_vars.innodb_buffer_pool_pages_dirty =
        buf_get_n_dirty_pages();        /* 脏页数量 */
    export_vars.innodb_buffer_pool_reads =
        srv_stats.buf_pool_reads;       /* 从磁盘读取的次数（Buffer Pool miss）*/
    export_vars.innodb_buffer_pool_read_requests =
        srv_stats.buf_pool_read_requests; /* Buffer Pool 请求总次数 */
    export_vars.innodb_rows_inserted = srv_stats.n_rows_inserted;
    export_vars.innodb_rows_updated  = srv_stats.n_rows_updated;
    export_vars.innodb_rows_deleted  = srv_stats.n_rows_deleted;
    export_vars.innodb_log_waits     = srv_stats.log_waits; /* Log Buffer 等待次数 */
    /* ... */
}
```

**关键 SHOW ENGINE INNODB STATUS 指标：**

```sql
SHOW ENGINE INNODB STATUS\G

-- Buffer pool hit rate:
-- Buffer pool hit rate 999 / 1000   → 99.9% 命中率（越高越好）

-- Row operations:
-- Number of rows inserted/updated/deleted/read per second

-- Log sequence number (LSN) 与 checkpoint LSN 的差值 = 未刷盘的 redo log 量
```

---

## 2. Buffer Pool 机制

Buffer Pool 是 InnoDB 最核心的内存组件，所有数据访问都必须经过 Buffer Pool。

### 2.1 LRU 链表分区

InnoDB 不使用标准 LRU，而是**分区 LRU（Midpoint Insertion Strategy）**：

```
Buffer Pool LRU 链表:

┌──────────────────────────────────────────────────────────┐
│  Young 区（热端，默认 5/8 = 62.5% of Buffer Pool）        │
│  head → [最近访问] → ... → [较早访问] → midpoint           │
├──────────────────────────────────────────────────────────┤
│  Old 区（冷端，默认 3/8 = 37.5% of Buffer Pool）          │
│  midpoint → [新读入] → ... → [最久未访问] → tail          │
└──────────────────────────────────────────────────────────┘
                                              ↑ 淘汰位置
```

**Midpoint Insertion 工作流程：**

1. 新页从磁盘读入时 → 插入到 **midpoint（Old 区头部）**，而非链表头部
2. 该页在 `innodb_old_blocks_time`（默认 1000ms）内被再次访问 → 晋升到 Young 区头部
3. 若 1000ms 内未被再次访问（如全表扫描的预读页）→ 留在 Old 区，很快被淘汰

**设计目的：** 防止全表扫描（大量一次性读取）冲刷热点数据，保护 Young 区的高频访问页。

```sql
-- 配置参数
innodb_old_blocks_pct = 37          -- Old 区占比（%），默认 37
innodb_old_blocks_time = 1000       -- 晋升到 Young 区需在 Old 区存活的最短时间（ms）
innodb_buffer_pool_size = 8G        -- Buffer Pool 总大小
innodb_buffer_pool_instances = 8    -- 实例数（>= 1GB 时建议 8，减少锁竞争）
```

**多 Buffer Pool 实例：** 大内存系统中，将 Buffer Pool 分为多个实例，每个实例有独立的 LRU 链表和 Flush 链表，减少互斥锁竞争。哈希函数 `space_id & (instances-1)` 决定页属于哪个实例。

### 2.2 Flush 链表与脏页刷盘

被修改但未刷盘的页（脏页）会被添加到 **Flush 链表**（按 LSN 排序）：

```
Flush 链表（脏页，按 oldest_modification LSN 排序）:
head → [LSN=200, 用户表page] → [LSN=150, 索引page] → [LSN=100, ...] → tail
        ↑ 最近修改                                       ↑ 最老修改

tail 端的页优先刷盘（最早修改，Redo Log 最需要推进 checkpoint）
```

**刷盘策略：**

| 刷盘方式 | 触发时机 | 线程 |
|---------|---------|------|
| 后台刷盘（normal）| 定期（innodb_io_capacity 控制速率）| Page Cleaner Thread |
| 同步刷盘（sharp）| Buffer Pool 全满无可用页 | Foreground Thread（用户请求）|
| Fuzzy Checkpoint | LSN 推进达到阈值 | Page Cleaner Thread |
| Sharp Checkpoint | MySQL 关闭时 | 主线程 |

**`innodb_io_capacity`** 控制后台刷盘的 I/O 速率（IOPS）：
- HDD: `innodb_io_capacity = 200`
- SSD: `innodb_io_capacity = 2000`
- NVMe: `innodb_io_capacity = 10000`

### 2.3 预读机制

InnoDB 在以下情况触发异步预读：

**线性预读（Linear Read-Ahead）：**
- 顺序访问同一 Extent（64 页）中 `innodb_read_ahead_threshold`（默认 56）个页后，自动异步预读**下一个 Extent**
- 配置：`innodb_read_ahead_threshold = 56`（0 = 禁用）

**随机预读（Random Read-Ahead）：**
- Buffer Pool 中某 Extent 已缓存 13 个连续页时，预读该 Extent 内剩余页
- 默认禁用（`innodb_random_read_ahead = OFF`）

### 2.4 Buffer Pool 监控

源码：`storage/innobase/handler/i_s.cc`

```cpp
/* storage/innobase/handler/i_s.cc — INNODB_BUFFER_POOL_STATS 相关 */
/* 通过 information_schema.INNODB_BUFFER_POOL_STATS 查询 Buffer Pool 状态 */
```

```sql
-- Buffer Pool 命中率（核心指标，生产环境应 > 99%）
SELECT
    (1 - innodb_buffer_pool_reads / innodb_buffer_pool_read_requests) * 100
        AS hit_rate_pct
FROM information_schema.INNODB_BUFFER_POOL_STATS;

-- 查看 Buffer Pool 中的页分布
SELECT page_type, count(*) AS pages
FROM information_schema.INNODB_BUFFER_PAGE
GROUP BY page_type
ORDER BY pages DESC;

-- 脏页比例
SHOW STATUS LIKE 'Innodb_buffer_pool_pages_dirty';
SHOW STATUS LIKE 'Innodb_buffer_pool_pages_total';
```

---

## 3. B+树索引

### 3.1 聚簇索引

InnoDB 每张表**必须有且只有一个**聚簇索引（Clustered Index），决定数据的物理存储顺序。

**聚簇索引的选择规则（优先级从高到低）：**
1. `PRIMARY KEY` 显式主键
2. 第一个 `UNIQUE NOT NULL` 索引
3. 隐式 `ROW_ID`（6 字节，全局递增）

**聚簇索引结构：**

```
聚簇索引 B+树（主键 = 1,2,3,...）:

                     ┌──────────┐
      Root Page:     │  10 | 20 │    内部节点：仅存键值和子页指针
                     └──┬────┬──┘
                     ↙      ↘
              ┌───────┐   ┌───────┐
Leaf Pages:   │1|row1 │↔  │11|row │   叶子节点：存储完整行数据（所有列）
              │2|row2 │   │12|row │   叶子节点构成双向链表，支持范围扫描
              │...    │   │...    │
              └───────┘   └───────┘
```

**叶子页面内部布局（FIL_PAGE_INDEX 类型）：**

```
Page (16KB)
┌──────────────────────────────────────────────────────┐
│ File Header (38 bytes)                                │
│   FIL_PAGE_SPACE_OR_CHKSUM / FIL_PAGE_OFFSET         │
│   FIL_PAGE_PREV / FIL_PAGE_NEXT (双向链表指针)        │
│   FIL_PAGE_LSN / FIL_PAGE_TYPE / FIL_PAGE_ARCH_LOG_NO│
├──────────────────────────────────────────────────────┤
│ Page Header (56 bytes)                                │
│   PAGE_N_DIR_SLOTS / PAGE_HEAP_TOP / PAGE_N_HEAP      │
│   PAGE_FREE / PAGE_GARBAGE / PAGE_LAST_INSERT         │
│   PAGE_DIRECTION / PAGE_N_DIRECTION                   │
├──────────────────────────────────────────────────────┤
│ Infimum Record (固定, 虚拟最小记录)                   │
│ Supremum Record (固定, 虚拟最大记录)                  │
├──────────────────────────────────────────────────────┤
│ User Records (行记录区域，从 Infimum 到 Supremum)     │
│   记录格式：变长列长度列表 | NULL标志位 | 记录头 | 列数据 │
├──────────────────────────────────────────────────────┤
│ Free Space (空闲区域)                                 │
├──────────────────────────────────────────────────────┤
│ Page Directory (槽位数组，用于二分查找)                │
│   每个槽指向一组记录中的最后一条                      │
├──────────────────────────────────────────────────────┤
│ File Trailer (8 bytes)                                │
│   FIL_PAGE_END_LSN_OLD_CHKSUM / FIL_PAGE_SPACE_ID    │
└──────────────────────────────────────────────────────┘
```

### 3.2 辅助索引

辅助索引（Secondary Index）的叶子节点存储**索引列 + 主键值**（而非行数据）：

```sql
CREATE TABLE users (
    id INT PRIMARY KEY,          -- 聚簇索引键
    name VARCHAR(50),
    email VARCHAR(100),
    age INT,
    INDEX idx_email (email)      -- 辅助索引
);
```

```
辅助索引 idx_email 的 B+树叶子节点:
[email='alice@x.com', id=3]
[email='bob@y.com',   id=1]
[email='carol@z.com', id=2]
       ↑ 按 email 排序          ↑ 存储主键，用于回表查询
```

**回表（Table Lookup）：** 辅助索引查询获取主键后，再用主键在聚簇索引中查找完整行：

```
SELECT name, age FROM users WHERE email = 'alice@x.com';

辅助索引 → email='alice@x.com' → id=3
聚簇索引 → id=3 → 返回 name, age（回表）
```

### 3.3 页面内部结构

InnoDB 行记录格式（Compact 格式，MySQL 5.0+默认）：

```c
/* 每行记录的结构（Compact 行格式）:
 *
 * [变长字段长度列表(逆序)] [NULL标志位] [记录头信息(5字节)] [行数据]
 *
 * 记录头信息 (5 bytes):
 *   bit 0-1:   预留
 *   bit 2:     delete_mask  — 1 = 该行已被删除（delete-mark）
 *   bit 3:     min_rec_mask — B+树非叶节点中最小记录的标志
 *   bit 4-7:   n_owned      — 当前槽（slot）拥有的记录数
 *   bit 8-20:  heap_no      — 在页内堆中的位置编号
 *   bit 21-23: record_type  — 0=普通用户记录, 1=B+树内节点, 2=infimum, 3=supremum
 *   bit 24-47: next_record  — 下一条记录的相对偏移量（构成单向链表）
 */

/* 行数据中，InnoDB 自动添加的隐藏列（对用户不可见）:
 *   DB_ROW_ID   (6 bytes) — 表无主键时使用，全局唯一递增
 *   DB_TRX_ID   (6 bytes) — 最后修改此行的事务 ID
 *   DB_ROLL_PTR (7 bytes) — 回滚指针，指向 Undo Log 中的前一个版本
 */
```

### 3.4 索引优化技术

**覆盖索引（Covering Index）：** 查询所需列全部在索引中，无需回表。

```sql
-- idx_name_age(name, age) 覆盖下面的查询
SELECT name, age FROM users WHERE name = 'Alice';
-- EXPLAIN 输出: Extra = "Using index"（不需要回表）
```

**最左前缀原则：** 复合索引 `idx(a, b, c)` 可用于：
- `WHERE a = 1`
- `WHERE a = 1 AND b = 2`
- `WHERE a = 1 AND b = 2 AND c = 3`
- `WHERE a = 1 AND b > 2`（范围查询后面的列无法用索引过滤）
- **不能用于**：`WHERE b = 2`（跳过了 a）

**索引下推（Index Condition Pushdown, ICP）：** 将 WHERE 中可用索引过滤的条件下推到存储引擎层执行，减少回表次数。

```sql
-- idx(name, age)
SELECT * FROM users WHERE name LIKE 'Alice%' AND age > 25;

-- 没有 ICP:  引擎返回所有 name LIKE 'Alice%' 的行 → Server 层过滤 age
-- 有 ICP:    引擎同时检查 name LIKE 'Alice%' AND age > 25 → 减少回表

-- EXPLAIN Extra = "Using index condition"
```

### 3.5 自适应哈希索引

源码：`storage/innobase/btr/btr0sea.cc`

```
Adaptive Hash Index (AHI):
- InnoDB 自动监控 B+树的访问模式
- 当某个索引的某个键值被频繁等值查询（默认 ≥ 17 次访问），自动在内存中建立哈希索引
- 等值查询从 B+树 O(log n) 优化为哈希 O(1)
- 完全自动，不需用户干预

优点: 频繁的等值查询性能提升显著
缺点: 占用 Buffer Pool 内存，范围查询无效，并发写入时哈希维护有 latch 竞争

配置:
innodb_adaptive_hash_index = ON   -- 默认开启
innodb_adaptive_hash_index_parts = 8  -- 哈希分片数（减少 latch 竞争）
```

---

## 4. MVCC 与事务

InnoDB 通过 **Undo Log + Read View** 实现多版本并发控制，读操作不加行锁。

### 4.1 Undo Log 结构

Undo Log 分为两种：

**Insert Undo Log：**
- 事务 INSERT 时产生
- 仅用于事务回滚，提交后立即可以删除
- 只需记录插入行的主键（回滚时 DELETE 即可）

**Update Undo Log：**
- 事务 UPDATE/DELETE 时产生
- 除事务回滚外，还用于 MVCC 的历史版本查询
- 需等到**没有任何 Read View 需要访问该版本**时才能删除（由 Purge 线程清理）

**Undo Log 记录的内容（UPDATE 为例）：**

```
UPDATE users SET age = 26 WHERE id = 1;

Undo Log 记录:
┌─────────────────────────────────────────┐
│ undo_type: TRX_UNDO_UPD_EXIST_REC       │
│ undo_no: 0 (本事务第几条 undo)           │
│ table_id: 42                             │
│ old_pk: id = 1                          │
│ changed columns:                         │
│   age: old_value = 25                   │
│ DB_TRX_ID (old): trx_id = 100           │
│ DB_ROLL_PTR: → 再前一个版本的 undo log  │
└─────────────────────────────────────────┘
```

**Undo 版本链：**

```
当前行（聚簇索引叶子节点）:
  id=1, age=26, DB_TRX_ID=200, DB_ROLL_PTR → Undo Log 1

Undo Log 1 (trx_id=200 修改前):
  id=1, age=25, DB_TRX_ID=100, DB_ROLL_PTR → Undo Log 2

Undo Log 2 (trx_id=100 修改前):
  id=1, age=24, DB_TRX_ID=50,  DB_ROLL_PTR → NULL（最初版本）
```

### 4.2 Read View 快照

源码：`storage/innobase/read/read0read.cc`

Read View 记录快照创建时刻的活跃事务信息：

```cpp
/* storage/innobase/include/read0types.h */
class ReadView {
    /** 快照时已提交的最大事务 ID + 1
     * （>= m_low_limit_id 的事务，此快照不可见）*/
    trx_id_t    m_low_limit_id;

    /** 快照时最小的活跃事务 ID
     * （< m_up_limit_id 的事务已全部提交，对此快照可见）*/
    trx_id_t    m_up_limit_id;

    /** 快照创建者的事务 ID */
    trx_id_t    m_creator_trx_id;

    /** 快照时活跃事务的 ID 列表（m_up_limit_id <= id < m_low_limit_id 中仍活跃的）*/
    ids_t       m_ids;

    /** 快照时已提交的最大事务 ID（用于 purge 判断） */
    trx_id_t    m_low_limit_no;
};
```

**可见性判断规则：**

```
对于行的 DB_TRX_ID = trx_id:

1. trx_id == m_creator_trx_id → 自己修改的 → 可见

2. trx_id < m_up_limit_id → 快照前已提交 → 可见

3. trx_id >= m_low_limit_id → 快照后开始的事务 → 不可见

4. m_up_limit_id <= trx_id < m_low_limit_id:
   ├─ trx_id 在 m_ids 中（快照时仍活跃）→ 不可见
   └─ trx_id 不在 m_ids 中（快照前已提交）→ 可见

不可见时：通过 DB_ROLL_PTR 追溯 Undo Log 链，直到找到可见版本
```

**Read View 的创建时机（关键区别）：**

| 隔离级别 | Read View 创建时机 |
|----------|-------------------|
| READ COMMITTED | **每条 SQL 语句**执行前创建（可以看到其他事务提交的内容）|
| REPEATABLE READ | **事务第一条 SQL** 执行时创建（整个事务看到一致的快照）|

### 4.3 row_search_mvcc 可见性判断

源码：`storage/innobase/row/row0sel.cc`

```cpp
/* storage/innobase/row/row0sel.cc */
static dberr_t
row_search_mvcc(
    byte*           buf,          /* 输出 buffer */
    page_cur_mode_t mode,         /* 查询模式：等值/范围/... */
    row_prebuilt_t* prebuilt,     /* 查询预构建对象（含 Read View）*/
    ulint           match_mode,   /* 精确匹配还是前缀 */
    ulint           direction)    /* 方向：前进/后退 */
{
    /* 1. 定位到 B+树中的目标记录 */
    btr_pcur_open_with_no_init(index, search_tuple, mode, BTR_SEARCH_LEAF,
                               pcur, 0, &mtr);

    /* 2. 主循环：遍历满足条件的记录 */
    for (;;) {
        /* 获取当前记录 */
        rec = btr_pcur_get_rec(pcur);

        /* 3. 检查记录是否被删除标记 */
        if (rec_get_deleted_flag(rec, comp)) {
            /* Delete-marked 记录：检查 MVCC 可见性 */
            goto locks_ok_del_marked;
        }

        /* 4. MVCC 可见性检查 */
        if (prebuilt->select_lock_type == LOCK_NONE) {
            /* 快照读（普通 SELECT）：使用 Read View */
            offsets = rec_get_offsets(rec, index, ...);

            if (!lock_clust_rec_cons_read_sees(rec, index, offsets,
                                               prebuilt->trx->read_view)) {
                /* 当前版本不可见，追溯 Undo Log */
                err = row_sel_build_prev_vers_for_mysql(
                    prebuilt->trx->read_view, clust_index,
                    prebuilt, rec, &offsets, &heap, &old_vers, ...);
                if (old_vers == NULL) {
                    goto next_rec; /* 所有版本都不可见，跳过此行 */
                }
                rec = old_vers; /* 使用历史版本 */
            }
        } else {
            /* 当前读（SELECT ... FOR UPDATE/SHARE）：加锁 */
            err = lock_clust_rec_read_check_and_lock(...);
        }

        /* 5. 返回记录给 MySQL Server 层 */
        row_sel_store_mysql_rec(buf, prebuilt, rec, ...);
        break;
    }
}
```

### 4.4 四种隔离级别实现

| 隔离级别 | 读方式 | 锁策略 | 解决的问题 |
|----------|--------|--------|-----------|
| READ UNCOMMITTED | 读最新版本（无 Read View）| 不加行锁 | 无（可脏读）|
| READ COMMITTED | 快照读（每句新 Read View）| 仅加 Record Lock | 脏读 |
| REPEATABLE READ（默认）| 快照读（事务级 Read View）| Record Lock + Gap Lock | 脏读 + 不可重复读 + 幻读 |
| SERIALIZABLE | 普通 SELECT 也加共享锁 | Next-Key Lock + Table Lock | 全部 |

---

## 5. 锁机制

### 5.1 行锁类型

InnoDB 在索引记录上实现行锁，**锁加在索引记录上，不是行数据上**。

**Record Lock（记录锁）：** 锁定单个索引记录。

```sql
SELECT * FROM users WHERE id = 1 FOR UPDATE;
-- 对聚簇索引上 id=1 的记录加 Record Lock（X 锁）
```

**Gap Lock（间隙锁）：** 锁定索引记录之间的"间隙"，防止幻读（INSERT 进入间隙）。

```sql
-- 假设表中有 id = 1, 3, 5
SELECT * FROM users WHERE id BETWEEN 2 AND 4 FOR UPDATE;
-- 加 Gap Lock: (1, 3) 和 (3, 5) 两个区间
-- 阻止其他事务 INSERT id=2 或 id=4
```

**Next-Key Lock：** Record Lock + 该记录**前方**的 Gap Lock = 左开右闭区间 `(prev, current]`。

这是 InnoDB 在 REPEATABLE READ 下**默认的行锁类型**。

```
表中数据: id = 1, 5, 10, 15

Next-Key Lock 区间划分:
(-∞, 1]  (1, 5]  (5, 10]  (10, 15]  (15, +∞)
                                      ↑ Gap Lock（最后一个空间没有右边界）

SELECT * FROM users WHERE id = 10 FOR UPDATE;
→ 对 (5, 10] 加 Next-Key Lock
→ 阻止其他事务 INSERT id = 6,7,8,9,10
```

**Insert Intention Lock（插入意向锁）：** INSERT 时在目标间隙上加的特殊 Gap Lock。

- 多个 INSERT 操作如果插入**不同位置**的同一间隙，相互不冲突（不同插入意向锁兼容）
- 但被已有 Gap Lock 阻塞（插入意向锁与 Gap Lock 不兼容）

### 5.2 意向锁

表级意向锁（Intention Lock）表明事务"意图"对某行加行锁：

| 意向锁 | 含义 | 加锁时机 |
|--------|------|---------|
| IS (Intention Shared) | 事务将对表内某行加 S 锁 | `SELECT ... FOR SHARE` 前 |
| IX (Intention Exclusive) | 事务将对表内某行加 X 锁 | `SELECT ... FOR UPDATE`, `UPDATE`, `DELETE` 前 |

**意向锁兼容矩阵：**

```
        X       IX      S       IS
X      冲突    冲突    冲突    冲突
IX     冲突    兼容    冲突    兼容
S      冲突    冲突    兼容    兼容
IS     冲突    兼容    兼容    兼容
```

意向锁之间（IS/IX）基本兼容，因为真正的冲突由行锁控制。意向锁的作用是：**快速判断表级操作（LOCK TABLE / DDL）是否与现有行锁冲突，无需遍历所有行锁**。

### 5.3 锁的加锁规则

以 REPEATABLE READ 隔离级别为例，`UPDATE/DELETE/SELECT FOR UPDATE` 的加锁规则：

**等值查询唯一索引：**
```sql
UPDATE users SET age=1 WHERE id=5;  -- id 为主键
-- 只对 id=5 加 Record Lock（因为唯一索引查找，无幻读风险，不需 Gap Lock）
```

**等值查询非唯一索引：**
```sql
-- 假设 idx_age，表中 age=25 的行有 id=3, id=7
UPDATE users SET name='x' WHERE age=25;
-- 对 age=25 的两行加 Record Lock
-- 对 (上一个 age 值, 25) 和 (25, 下一个 age 值) 加 Gap Lock（防止新 INSERT age=25）
```

**范围查询：**
```sql
SELECT * FROM users WHERE id > 10 AND id < 20 FOR UPDATE;
-- 对所有 10 < id < 20 的记录加 Next-Key Lock
-- 对 (10, 第一个满足条件的id], ..., (最后满足条件的id, 20) 加 Next-Key Lock
```

### 5.4 死锁检测

InnoDB 使用 **Wait-For Graph（等待图）** 检测死锁：

```
节点 = 事务，边 = "等待"关系（T1 等待 T2 持有的锁 → T1 → T2）

T1 持有 id=1 的 X 锁，等待 id=2 的 X 锁
T2 持有 id=2 的 X 锁，等待 id=1 的 X 锁

Wait-For Graph:
T1 → T2 → T1  （环！死锁）

InnoDB 选择回滚代价更小的事务（undo log 更少的那个），
释放锁，让另一个事务继续执行。
错误信息: ERROR 1213 (40001): Deadlock found when trying to get lock;
          try restarting transaction
```

**死锁排查 SQL：**

```sql
-- 查看最近一次死锁信息
SHOW ENGINE INNODB STATUS\G
-- 找到 LATEST DETECTED DEADLOCK 部分

-- 实时锁等待
SELECT r.trx_id waiting_trx_id,
       r.trx_query waiting_query,
       b.trx_id blocking_trx_id,
       b.trx_query blocking_query
FROM information_schema.innodb_lock_waits w
JOIN information_schema.innodb_trx b ON b.trx_id = w.blocking_trx_id
JOIN information_schema.innodb_trx r ON r.trx_id = w.requesting_trx_id;
```

---

## 6. Redo Log 与崩溃恢复

### 6.1 Redo Log 格式与 LSN

Redo Log 记录了所有数据页的物理修改，用于崩溃恢复。

**Log Record 结构：**

```
Redo Log Record:
┌──────────────────────────────────────────────────────┐
│ type (1 byte)   — 操作类型（如 MLOG_REC_UPDATE_IN_PLACE）│
│ space_id (compressed uint) — 表空间 ID               │
│ page_no  (compressed uint) — 页编号                  │
│ [操作相关数据]               — 具体修改内容           │
└──────────────────────────────────────────────────────┘
```

**LSN（Log Sequence Number）：** 单调递增的字节偏移量，标识 Redo Log 的写入位置。

```
关键 LSN 关系:
lsn (当前写入位置)
  >= flushed_to_disk_lsn (已 fsync 到磁盘的位置)
     >= last_checkpoint_lsn (最近 checkpoint 的位置)

lsn - last_checkpoint_lsn = 未经 checkpoint 的 redo log 量
（超过 innodb_log_file_size * innodb_log_files_in_group 的一定比例时强制 checkpoint）
```

### 6.2 WAL 与 Doublewrite Buffer

**WAL（Write-Ahead Logging）原则：** 数据页写入磁盘前，Redo Log 必须先 fsync。

```
事务提交流程 (innodb_flush_log_at_trx_commit = 1):

1. 修改 Buffer Pool 中的数据页（内存）
2. 写入 Redo Log Buffer
3. 事务 COMMIT 时：
   a. Redo Log Buffer → Redo Log 文件（fsync）← WAL 保证
   b. 返回客户端 "提交成功"
4. 后台将 Buffer Pool 中的脏页异步写入磁盘

崩溃发生在步骤 3a 之后：重启时重放 Redo Log 恢复所有已提交事务 ✓
崩溃发生在步骤 3a 之前：未完成的事务被丢弃，使用 Undo Log 回滚 ✓
```

**`innodb_flush_log_at_trx_commit` 三种模式：**

| 值 | 行为 | 持久性 | 性能 |
|----|------|--------|------|
| 0 | 每秒刷盘一次（后台线程），commit 不刷 | 最多丢失 1 秒数据 | 最高 |
| 1（默认）| 每次 commit 都 fsync | 不丢数据 | 最低 |
| 2 | 每次 commit 写 OS 缓存，每秒 fsync | OS 崩溃可丢失 1 秒数据 | 中等 |

### 6.3 Checkpoint 机制

InnoDB 使用 **Fuzzy Checkpoint**（模糊检查点，不要求立刻刷所有脏页）：

```
Checkpoint 推进过程：

older LSN ─────────────────────────────────→ newer LSN
           ↑                    ↑
    last_checkpoint_lsn    flushed_to_disk_lsn

InnoDB 要求:
  flushed_to_disk_lsn - last_checkpoint_lsn < redo_log_total_size * 0.75

当差值接近阈值时，强制刷脏页推进 checkpoint（避免 Log 文件写满死锁）
```

**InnoDB redo log 是循环写的：** `ib_logfile0` 写满后接着写 `ib_logfile1`，写满后回到 `ib_logfile0`。因此 `last_checkpoint_lsn` 必须不断推进，否则无法覆盖旧日志。

### 6.4 崩溃恢复流程

```
MySQL 重启后 InnoDB 初始化:

Step 1: 读取 Checkpoint LSN
  → 从 redo log 文件中读取最新的 checkpoint 信息

Step 2: Redo Phase（重做已提交事务）
  → 从 checkpoint LSN 开始，重放所有 redo log 记录
  → 重建 Buffer Pool 中未刷盘的数据页到崩溃前状态

Step 3: Undo Phase（回滚未提交事务）
  → 扫描 Undo Log，找到崩溃时未提交的事务
  → 使用 Undo Log 逐条撤销其修改
  → 注意：此阶段可接受新连接（Hot Recovery）

Step 4: Change Buffer 合并
  → 将 Change Buffer 中缓存的辅助索引修改合并到对应页
```

---

## 7. Change Buffer 与 Doublewrite

### 7.1 Change Buffer 原理

**问题背景：** INSERT/UPDATE/DELETE 时需要修改所有相关索引。若辅助索引页不在 Buffer Pool 中，需要随机 I/O 将页读入，代价极高。

**Change Buffer 解决方案：** 当辅助索引页不在 Buffer Pool 中，且**该索引不是唯一索引**时（唯一索引需读入页才能检查唯一性），将修改操作缓存在 Change Buffer 中，延迟到该页被读入 Buffer Pool 时再合并。

```
写入流程 (无需立即修改辅助索引页):
  INSERT INTO users VALUES (100, 'Alice', 25);
  → 修改聚簇索引页（可能在 Buffer Pool 中）
  → 对非唯一辅助索引 idx_age:
     ├─ 若 age=25 对应的索引页在 Buffer Pool → 直接修改
     └─ 若不在 Buffer Pool → 写入 Change Buffer（仅写内存+redo log）

合并触发时机:
  1. 辅助索引页被读入 Buffer Pool（SELECT/UPDATE 访问该页）
  2. Change Buffer 占用空间超过阈值（innodb_change_buffer_max_size = 25%）
  3. MySQL 关闭时（Sharp Checkpoint）
  4. Slow Shutdown 时
```

**Change Buffer 适用场景（写多读少的辅助索引）：**
- 批量插入后才查询的场景：Change Buffer 效果极好
- 频繁读取的辅助索引：很快被合并，意义不大
- **唯一索引**：**不能使用** Change Buffer（必须读入页才能判断唯一性）

```sql
-- 监控 Change Buffer
SHOW ENGINE INNODB STATUS\G
-- 查看 INSERT BUFFER AND ADAPTIVE HASH INDEX 部分:
-- Ibuf: size 1, free list len 0, seg size 2, 0 merges
-- merged operations: insert 0, delete mark 0, delete 0
-- discarded operations: insert 0, delete mark 0, delete 0
```

### 7.2 Doublewrite 防止 Partial Write

**Partial Write 问题：** InnoDB 页大小 16KB，文件系统写操作通常是 4KB。若写入 16KB 页时服务器崩溃，可能只写入了 4KB（"撕裂页"），导致 Redo Log 无法在损坏页上回放（Redo Log 是物理 redo，需要完整的基础页）。

**Doublewrite Buffer 解决方案（两阶段写）：**

```
Step 1: 写 Doublewrite Buffer（顺序 I/O，代价小）
  脏页 → 先顺序写入 Doublewrite Buffer 文件（共享表空间中连续的 2MB 区域）
  fsync()  — 确保 Doublewrite Buffer 数据已持久化

Step 2: 写实际数据文件（随机 I/O）
  脏页 → 写入 .ibd 文件中对应的实际位置

崩溃恢复时:
  → 检查实际数据文件中的页
  → 若页损坏（checksum 不匹配），从 Doublewrite Buffer 恢复完整页
  → 再重放 Redo Log
```

**性能影响：** Doublewrite 使写操作量翻倍（写 2 次），但 Step 1 是**顺序写**，I/O 效率高。实测对写吞吐量的影响约 5-10%。

```sql
-- 查看 Doublewrite 统计
SHOW STATUS LIKE 'Innodb_dblwr%';
-- Innodb_dblwr_pages_written: 写入 Doublewrite Buffer 的页数
-- Innodb_dblwr_writes: 写操作次数（pages_written / writes = 每次批量写的页数）

-- MySQL 8.0.20+ 可关闭（使用支持原子写的存储设备，如 FusionIO）
innodb_doublewrite = OFF
```

---

## 性能对比与最佳实践

### InnoDB vs MyISAM 核心对比

| 特性 | InnoDB | MyISAM |
|------|--------|--------|
| 事务支持 | ✓ ACID | ✗ |
| 行级锁 | ✓ | ✗（表锁）|
| 外键 | ✓ | ✗ |
| MVCC | ✓ | ✗ |
| 崩溃恢复 | ✓ Redo Log | ✗（需要修复）|
| 全文索引 | ✓（5.6+）| ✓ |
| 表行数统计 | 估算（需全扫或抽样）| 精确（存储在元数据中）|
| 聚簇索引 | ✓（数据与主键索引合一）| ✗（堆组织，主键是辅助索引）|

### 关键参数调优

```sql
-- 生产环境推荐配置（以 32GB 内存为例）

# Buffer Pool（物理内存的 60-75%）
innodb_buffer_pool_size = 20G
innodb_buffer_pool_instances = 8   # CPU 核数相关，通常 4-16

# Redo Log（越大越好，但影响崩溃恢复时间）
innodb_log_file_size = 2G          # 单个文件
innodb_log_files_in_group = 2      # 文件数

# I/O 配置（NVMe SSD）
innodb_io_capacity = 10000
innodb_io_capacity_max = 40000
innodb_read_io_threads = 8
innodb_write_io_threads = 8
innodb_flush_method = O_DIRECT     # 绕过 OS 页缓存，避免双重缓冲

# 事务持久性
innodb_flush_log_at_trx_commit = 1  # 强持久性
# innodb_flush_log_at_trx_commit = 2  # 允许 OS 崩溃丢失 1 秒数据（高吞吐场景）

# 并发控制
innodb_thread_concurrency = 0       # 0 = 不限制（由 InnoDB 自适应）
innodb_lock_wait_timeout = 50       # 行锁等待超时（秒）
innodb_deadlock_detect = ON         # 死锁检测（高并发时有性能损耗，可与 innodb_lock_wait_timeout 配合关闭）
```
