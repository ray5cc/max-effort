# PostgreSQL 核心技术深度解析

> PostgreSQL 是世界上最先进的开源关系型数据库——理解它的底层实现，就是理解多进程架构如何实现隔离、MVCC 如何在不加锁的情况下实现一致性读、WAL 如何保证崩溃恢复、以及查询优化器如何在数以千计的执行计划中找到最优路径。

## 相关链接
- 对应面试题：[PostgreSQL 面试题](../../../02-面试指南/03-数据库面试/03-PostgreSQL面试题.md)

## 目录
1. [进程架构](#1-进程架构)
   - 1.1 [Postmaster 主进程](#11-postmaster-主进程)
   - 1.2 [Backend 进程](#12-backend-进程)
   - 1.3 [辅助进程](#13-辅助进程)
2. [存储引擎 — 堆表与页面布局](#2-存储引擎--堆表与页面布局)
   - 2.1 [Page 结构](#21-page-结构)
   - 2.2 [Tuple 结构](#22-tuple-结构)
   - 2.3 [HOT 更新优化](#23-hot-更新优化)
3. [索引系统](#3-索引系统)
   - 3.1 [B-tree 索引实现](#31-b-tree-索引实现)
   - 3.2 [页面分裂与 High Key](#32-页面分裂与-high-key)
   - 3.3 [其他索引类型对比](#33-其他索引类型对比)
   - 3.4 [查询计划如何选择索引](#34-查询计划如何选择索引)
4. [MVCC 实现](#4-mvcc-实现)
   - 4.1 [事务 ID 与快照](#41-事务-id-与快照)
   - 4.2 [可见性判断](#42-可见性判断)
   - 4.3 [行级锁与表级锁](#43-行级锁与表级锁)
   - 4.4 [SSI 可串行化快照隔离](#44-ssi-可串行化快照隔离)
5. [WAL — Write-Ahead Logging](#5-wal--write-ahead-logging)
   - 5.1 [WAL 记录格式与 LSN](#51-wal-记录格式与-lsn)
   - 5.2 [WAL 写入流程](#52-wal-写入流程)
   - 5.3 [Checkpoint 机制](#53-checkpoint-机制)
   - 5.4 [流式复制](#54-流式复制)
6. [查询执行引擎](#6-查询执行引擎)
   - 6.1 [查询处理全流程](#61-查询处理全流程)
   - 6.2 [火山模型执行器](#62-火山模型执行器)
   - 6.3 [执行器节点详解](#63-执行器节点详解)
   - 6.4 [代价模型与 EXPLAIN](#64-代价模型与-explain)
7. [VACUUM 与自动清理](#7-vacuum-与自动清理)
   - 7.1 [VACUUM 的作用](#71-vacuum-的作用)
   - 7.2 [autovacuum 配置调优](#72-autovacuum-配置调优)
   - 7.3 [XID Wraparound 问题](#73-xid-wraparound-问题)

---

## 1. 进程架构

PostgreSQL 采用**多进程架构**（每个连接一个独立 Backend 进程），而非多线程模型。这一设计简化了崩溃隔离：某个 Backend 崩溃不会影响整个数据库服务。

### 1.1 Postmaster 主进程

源码：`src/backend/postmaster/postmaster.c`

Postmaster 是 PostgreSQL 的守护进程，负责：
1. 监听 TCP 连接（默认端口 5432）
2. 为每个新连接 fork() 一个 Backend 进程
3. 启动所有辅助进程
4. 处理辅助进程异常退出（SIGCHLD）

```c
/* src/backend/postmaster/postmaster.c — ServerLoop 核心循环 */
static int
ServerLoop(void)
{
    for (;;)
    {
        /*
         * Wait for a connection request or a signal.
         * selres = select() on the listen sockets
         */
        selres = select(nSockets, &rmask, NULL, NULL, &timeout);

        if (selres > 0)
        {
            /* New connection request */
            ConnCreate(serverFd);
        }

        /* Reap dead children (SIGCHLD handler sets ReapWorkerDone) */
        if (ReapWorkerDone)
            reaper(SIGCHLD);

        /* Check if we need to launch auxiliary processes */
        MaybeStartWalSummarizer();
        MaybeStartCheckpointer();
        MaybeStartWalWriter();
        MaybeStartAutovacuumLauncher();
    }
}
```

`BackendStartup` 函数处理新连接：

```c
/* src/backend/postmaster/postmaster.c */
static int
BackendStartup(Port *port)
{
    pid = fork_process();       /* fork() 创建子进程 */
    if (pid == 0)               /* 子进程 */
    {
        /* 关闭 postmaster 监听 socket */
        ClosePostmasterPorts(false);
        /* 初始化 backend 内存上下文 */
        InitProcess();
        /* 进入 backend 主循环 */
        BackendRun(port);       /* 永不返回 */
    }
    /* 父进程记录子进程 PID */
    (void) BackendList_append(pid, port);
    return STATUS_OK;
}
```

### 1.2 Backend 进程

每个 Backend 进程处理一个客户端连接的完整生命周期：

```diagram
Client ──TCP──> Postmaster ──fork()──> Backend Process
                                          │
                                    PostgresMain()
                                          │
                              ┌──────────┴──────────┐
                              │   ReadCommand()      │ ← 读取查询
                              │   exec_simple_query()│ ← 解析/优化/执行
                              │   EndCommand()       │ ← 返回结果
                              └─────────────────────┘
```

`Port` 结构体描述客户端连接信息（`src/include/libpq/libpq-be.h`）：

```c
typedef struct Port {
    pgsocket    sock;           /* 连接 socket fd */
    SockAddr    laddr;          /* 本地地址 */
    SockAddr    raddr;          /* 远端地址 */
    char       *database_name; /* 目标数据库名 */
    char       *user_name;     /* 认证用户名 */
    char       *application_name; /* 应用标识 */
    /* 认证状态 */
    AuthRequest areq;
    /* SSL 连接 */
    void       *ssl;
    /* ... */
} Port;
```

### 1.3 辅助进程

```diagram
Postmaster
├── WAL Writer         — 定期将 WAL buffer 刷到磁盘
├── Checkpointer       — 执行 checkpoint，刷脏页到磁盘
├── Background Writer  — 预先刷脏页，减轻 checkpoint 压力
├── Autovacuum Launcher — 定期触发各表的 autovacuum worker
├── Autovacuum Worker  — 实际执行 VACUUM 的工作进程（多个）
├── Stats Collector    — 收集表/索引访问统计（pg_stat_* 视图数据来源）
├── WAL Receiver       — 流式复制时接收主库 WAL（备库专有）
└── Logical Replication Worker — 逻辑复制解码
```

| 辅助进程 | 主要职责 | 关键配置参数 |
|----------|----------|-------------|
| WAL Writer | 将 WAL buffer 定期（wal_writer_delay=200ms）fsync 到磁盘 | `wal_writer_delay` |
| Checkpointer | 定期/按量触发 checkpoint，将所有脏页写盘 | `checkpoint_timeout`, `max_wal_size` |
| Background Writer | 平滑刷脏页，减少 checkpoint 时的 I/O 峰值 | `bgwriter_lru_maxpages` |
| Autovacuum Launcher | 扫描 pg_stat_user_tables，决定哪些表需要 vacuum | `autovacuum_naptime` |
| Stats Collector | 通过 UDP 接收各 Backend 的统计信息 | `track_activities`, `track_counts` |

---

## 2. 存储引擎 — 堆表与页面布局

PostgreSQL 的数据以**堆文件（Heap File）**形式存储，每个关系（表/索引）对应磁盘上的若干文件。数据文件按 **8KB 页（Page/Block）**组织。

### 2.1 Page 结构

源码：`src/include/storage/bufpage.h`

```diagram
 0                   8KB
 ┌──────────────────────────────────────────────────────┐
 │  PageHeaderData (24 bytes)                           │
 ├──────────────────────────────────────────────────────┤
 │  ItemIdData[1]  │ ItemIdData[2]  │ ... (4 bytes each)│  ← pd_lower 到这里
 ├──────────────────────────────────────────────────────┤
 │                  Free Space                          │
 ├──────────────────────────────────────────────────────┤
 │  ... │  Tuple N  │  Tuple 2  │  Tuple 1             │  ← pd_upper 到这里
 ├──────────────────────────────────────────────────────┤
 │  Special Space (索引页使用，堆表为空)                 │  ← pd_special
 └──────────────────────────────────────────────────────┘
```

`PageHeaderData` 结构体：

```c
/* src/include/storage/bufpage.h */
typedef struct PageHeaderData {
    /* WAL 日志序列号，标识页面最后修改时对应的 WAL 位置 */
    PageXLogRecPtr  pd_lsn;         /* 8 bytes */

    /* 页面校验和（启用 data checksums 时使用） */
    uint16          pd_checksum;

    /* 页面标志位 */
    uint16          pd_flags;
    /* PD_HAS_FREE_LINES  = 0x0001 — 有空闲的 line pointer */
    /* PD_PAGE_FULL       = 0x0002 — 页面已满，INSERT 不会尝试此页 */
    /* PD_ALL_VISIBLE     = 0x0004 — 页内所有 tuple 对所有事务可见 */

    /* line pointer（ItemIdData）区域的末尾偏移 */
    LocationIndex   pd_lower;       /* 2 bytes */

    /* 可用空间的起始偏移（tuple 从高地址向低地址增长） */
    LocationIndex   pd_upper;       /* 2 bytes */

    /* 特殊空间的起始偏移（索引使用，堆表 = 页尾） */
    LocationIndex   pd_special;     /* 2 bytes */

    /* 页面大小与版本号（高位为大小，低位为版本） */
    uint16          pd_pagesize_version;

    /* 本页中最老的未提交事务 ID（用于 prune 优化） */
    TransactionId   pd_prune_xid;   /* 4 bytes */

    /* ItemIdData 数组（line pointers），可变长度 */
    ItemIdData      pd_linp[FLEXIBLE_ARRAY_MEMBER];
} PageHeaderData;
```

`ItemIdData`（line pointer）：

```c
typedef struct ItemIdData {
    unsigned    lp_off:15,  /* 指向页内 tuple 的偏移（字节） */
                lp_flags:2, /* LP_UNUSED/LP_NORMAL/LP_REDIRECT/LP_DEAD */
                lp_len:15;  /* tuple 的长度（字节） */
} ItemIdData;
```

**关键公式：**
- `FreeSpace = pd_upper - pd_lower`
- 可容纳的 tuple 数：`FreeSpace / (tuple_size + sizeof(ItemIdData))`

### 2.2 Tuple 结构

源码：`src/include/access/htup_details.h`

每个堆 Tuple 由**头部（HeapTupleHeaderData）+ 用户数据**组成：

```c
/* src/include/access/htup_details.h */
typedef struct HeapTupleHeaderData {
    union {
        HeapTupleFields t_heap;     /* 正常 tuple */
        DatumTupleFields t_datum;   /* TOAST 用途 */
    }           t_choice;

    ItemPointerData t_ctid;  /* 当前/最新版本 tuple 的物理位置 (blockno, offset) */

    /* 以下两个字段共用 4 bytes */
    uint16      t_infomask2; /* 列数（低11位）+ 标志位（高5位）*/
    uint16      t_infomask;  /* 各种状态标志 */

    uint8       t_hoff;      /* 头部总长度（含 NULL bitmap 和 OID） */

    /* 数据区（NULL bitmap + 用户列数据），从 t_hoff 处开始 */
    bits8       t_bits[FLEXIBLE_ARRAY_MEMBER]; /* NULL bitmap */
} HeapTupleHeaderData;

/* t_choice.t_heap 包含: */
typedef struct HeapTupleFields {
    TransactionId t_xmin;    /* 插入此 tuple 的事务 ID */
    TransactionId t_xmax;    /* 删除/更新此 tuple 的事务 ID（0表示未删除）*/
    union {
        CommandId   t_cid;   /* 插入/删除命令 ID（子事务内部用） */
        TransactionId t_xvac; /* 旧式 VACUUM 使用 */
    } t_field3;
} HeapTupleFields;
```

**关键字段解析：**

| 字段 | 说明 | 用途 |
|------|------|------|
| `t_xmin` | 插入此版本的 XID | MVCC 可见性判断 |
| `t_xmax` | 删除/更新此版本的 XID | MVCC 可见性判断 |
| `t_ctid` | 指向最新版本的物理位置 | UPDATE 链追踪 |
| `t_infomask` | `HEAP_XMIN_COMMITTED`, `HEAP_XMAX_COMMITTED` 等 | 缓存事务状态，避免 clog 查询 |
| `t_infomask2` | `HEAP_HOT_UPDATED`, `HEAP_ONLY_TUPLE` | HOT 更新标记 |

**UPDATE 操作的版本链：**

```diagram
UPDATE users SET email='new@x.com' WHERE id=1;

Block 5, Offset 10:                Block 5, Offset 24:
┌─────────────────────┐            ┌─────────────────────┐
│ t_xmin = 100        │            │ t_xmin = 200 (新事务)│
│ t_xmax = 200        │──t_ctid──→ │ t_xmax = 0           │
│ id=1, email=old     │            │ id=1, email=new      │
└─────────────────────┘            └─────────────────────┘
     旧版本（死tuple）                    新版本（活tuple）
```

### 2.3 HOT 更新优化

源码：`src/backend/access/heap/heapam.c`, `src/include/access/htup_details.h`

**HOT（Heap Only Tuple）**是 PostgreSQL 7.8 引入的重要优化。

**问题背景：** 普通 UPDATE 在更新非索引列时，仍需更新所有相关索引（因为索引指向旧 tuple 的物理地址）。高频 UPDATE 导致索引膨胀。

**HOT 条件（同时满足）：**
1. 更新的列**不在任何索引中**
2. 新 tuple 与旧 tuple 在**同一页面**内（有足够空间）

**HOT 链结构：**

```diagram
Index entry ──→ Block 5, Offset 10 (旧tuple, HEAP_HOT_UPDATED=1)
                    │  t_ctid
                    ↓
               Block 5, Offset 24 (新tuple, HEAP_ONLY_TUPLE=1)
                    │  t_ctid（如果再次更新，继续延伸）
                    ↓
               Block 5, Offset 38 (最新tuple)
```

索引条目**不变**，扫描时通过 `t_ctid` 追踪到最新版本。VACUUM 负责剪断已死亡的旧版本（heap_page_prune）。

---

## 3. 索引系统

### 3.1 B-tree 索引实现

源码：`src/backend/access/nbtree/`

PostgreSQL B-tree 实现（Lehman & Yao 算法）的核心数据结构：

```c
/* src/include/access/nbtree.h */
typedef struct BTPageOpaqueData {
    BlockNumber btpo_prev;  /* 同层左兄弟页面编号 */
    BlockNumber btpo_next;  /* 同层右兄弟页面编号 */
    union {
        uint32  level;      /* 层级（0=叶子页） */
        TransactionId xact; /* 已删除页面的事务 ID */
    } btpo;
    uint16      btpo_flags; /* BTP_LEAF / BTP_ROOT / BTP_DELETED 等 */
    BTCycleId   btpo_cycleid; /* 并发 VACUUM 使用 */
} BTPageOpaqueData;
```

**B-tree 整体结构：**

```diagram
                    ┌─────────────┐
                    │  Meta Page  │  Block 0：存储根页面地址、快速根等元信息
                    └─────────────┘

         Level 2:   ┌─────────────────────────────┐
         (Root)     │  [10 | 20 | 30]              │  内部节点：High Key + 下层指针
                    └────┬──────┬──────┬───────────┘
                         │      │      │
         Level 1:  ┌─────┘  ┌───┘  ┌──┘
                   ↓        ↓      ↓
                  [5|8|10] [15|20] [25|28|30]     内部节点

         Level 0:  ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐     叶子节点（双向链表）
         (Leaf)    │  │↔│  │↔│  │↔│  │↔│  │     存储 (key, heap TID) 对
                   └──┘ └──┘ └──┘ └──┘ └──┘
```

**查找流程（`_bt_search` in `nbtsearch.c`）：**

```diagram
_bt_search(rel, key, stack_ptr, access)
    │
    ├─ 从 Meta Page 获取根页面
    │
    ├─ loop (从根到叶子):
    │     _bt_binsrch()    — 在页面内二分查找目标 key 位置
    │     _bt_getbuf()     — 获取子页面（加锁）
    │     _bt_relbuf()     — 释放当前页面锁
    │
    └─ 返回叶子页面（已加读锁）
```

**插入流程（`_bt_doinsert` in `nbtinsert.c`）：**

```diagram
_bt_doinsert(rel, itup, checkUnique, heapRel)
    │
    ├─ _bt_search()        — 找到目标叶子页
    ├─ 检查唯一性约束
    ├─ _bt_findinsertloc() — 找到页内插入位置
    ├─ _bt_insertonpg()    — 执行插入
    │     ├─ 如页面有足够空间：直接插入
    │     └─ 空间不足：_bt_split() — 页面分裂
    └─ _bt_insert_parent() — 向上更新父节点
```

### 3.2 页面分裂与 High Key

**High Key** 是 PostgreSQL B-tree 的独特设计（来自 Lehman & Yao 论文）：

- 每个页面（除最右叶子）的**第一个 ItemId** 指向该页的 **High Key**
- High Key = 该页所能存储的最大键值
- 并发查找时，若目标 key > High Key，则通过 `btpo_next` 右移到兄弟页面（无需重新从根开始）

```
页面分裂过程 (_bt_split in nbtpage.c):

原页面 [P]:  [HighKey=∞ | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8]
                                  ↑ 满了，插入 key=5.5

分裂后:
左页 [P]:   [HighKey=5 | 1 | 2 | 3 | 4 | 5]
右页 [Q]:   [HighKey=∞ | 5.5 | 6 | 7 | 8]
                ↑ 新 High Key

父节点新增: [... | ptr→P | 5.5 | ptr→Q | ...]
```

### 3.3 其他索引类型对比

| 索引类型 | 数据结构 | 适用场景 | 支持操作符 | 大小 |
|----------|----------|----------|-----------|------|
| **B-tree** | 平衡树 | 等值/范围/排序 | `<`, `=`, `>`, `BETWEEN`, `LIKE 'x%'` | 中等 |
| **Hash** | 哈希表 | 仅等值查询 | `=` | 小 |
| **GiST** | 通用搜索树 | 几何/全文/范围类型 | `&&`, `@>`, `<->` | 大 |
| **GIN** | 倒排索引 | 数组/全文搜索/JSONB | `@>`, `@@`, `?` | 大 |
| **BRIN** | 块范围索引 | 物理顺序相关的大表（时序/日志） | `<`, `=`, `>` | 极小 |
| **SP-GiST** | 空间分区树 | 电话号码前缀/IP网段/地理坐标 | `<<`, `>>`, `~=` | 中等 |

**BRIN 特别说明：** 每个 BRIN 条目记录一个"块范围"（默认 128 页）内的 min/max 值。对于按时间顺序插入的日志表，BRIN 索引大小仅为 B-tree 的 1/1000，但精度较低（可能读取大量不匹配的块）。

### 3.4 查询计划如何选择索引

源码：`src/backend/optimizer/plan/createplan.c`

优化器通过**代价估算**决定是否使用索引：

```c
/* src/backend/optimizer/plan/createplan.c */
static IndexScan *
create_indexscan_plan(PlannerInfo *root,
                      IndexPath   *best_path,
                      List        *tlist,
                      List        *scan_clauses,
                      bool         indexonly)
{
    /* 从 IndexPath 中提取索引条件和过滤条件 */
    extract_actual_clauses(best_path->indexquals, ...);

    /* 构建执行计划节点 */
    scan_plan = make_indexscan(tlist,
                               qpqual,           /* 非索引过滤条件 */
                               best_path->indexinfo->indexoid,
                               best_path->indexquals,  /* 索引条件 */
                               best_path->indexorderbys,
                               indexonly);
    return scan_plan;
}
```

**代价计算关键参数：**

```sql
-- 顺序扫描代价 vs 索引扫描代价
-- seq_page_cost = 1.0 (基准)
-- random_page_cost = 4.0 (默认，SSD 可调低至 1.1)

-- 如果选择率低（大量行匹配），全表扫描更优：
-- cost(seqscan) = seq_page_cost * relpages + cpu_tuple_cost * reltuples

-- 如果选择率高（极少行匹配），索引更优：
-- cost(indexscan) = random_page_cost * index_pages + cpu_index_tuple_cost * index_tuples
```

```sql
-- 查看优化器的代价评估
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM users WHERE created_at > '2024-01-01';

-- 输出示例:
-- Seq Scan on users (cost=0.00..28450.00 rows=150000 width=64)
--   Filter: (created_at > '2024-01-01')
--   Rows Removed by Filter: 850000
-- vs
-- Index Scan using idx_users_created on users (cost=0.43..1250.43 rows=150000 width=64)
--   Index Cond: (created_at > '2024-01-01')
```

---

## 4. MVCC 实现

PostgreSQL 的 MVCC（多版本并发控制）通过在 tuple 中存储事务可见性信息实现，**读操作不加锁**，写操作只锁定被修改的行。

### 4.1 事务 ID 与快照

源码：`src/include/access/transam.h`

```c
/* src/include/access/transam.h */
typedef uint32 TransactionId;

/* 特殊 XID 值 */
#define InvalidTransactionId    ((TransactionId) 0)
#define BootstrapTransactionId  ((TransactionId) 1)
#define FrozenTransactionId     ((TransactionId) 2)  /* 冻结 XID，对所有事务可见 */
#define FirstNormalTransactionId ((TransactionId) 3)

/* XID 比较需要考虑环绕 (wraparound) */
#define TransactionIdPrecedes(id1, id2) \
    (((int32) ((id1) - (id2))) < 0)
```

**快照（Snapshot）结构**（`src/include/utils/snapshot.h`）：

```c
typedef struct SnapshotData {
    SnapshotType    snapshot_type;

    TransactionId   xmin;   /* 快照中最小活跃 XID（< xmin 的事务已提交，其修改可见）*/
    TransactionId   xmax;   /* 快照中最大已分配 XID+1（>= xmax 的事务不可见）*/

    TransactionId  *xip;    /* 快照时刻活跃事务列表（xmin <= xid < xmax 且仍在运行）*/
    uint32          xcnt;   /* xip 中的事务数量 */

    /* 子事务相关 */
    TransactionId  *subxip;
    int32           subxcnt;

    bool            takenDuringRecovery; /* 恢复过程中创建的快照 */
    bool            copied;
    CommandId       curcid;  /* 当前命令 ID（同一事务内的命令可见性）*/
    uint32          speculativeToken;
    uint32          active_count;
    uint32          regd_count;
    pairingheap_node ph_node;
    TimestampTz     whenTaken;
    XLogRecPtr      lsn;
} SnapshotData;
```

### 4.2 可见性判断

核心函数：`HeapTupleSatisfiesMVCC`（`src/backend/access/heap/heapam_visibility.c`）

```diagram
HeapTupleSatisfiesMVCC(tuple, snapshot, buffer):

1. 检查 t_xmin（谁插入了这个版本？）
   ├─ t_xmin == CurrentXID → 本事务插入，且本事务 cid 可见 → 可见
   ├─ t_xmin 在 xip 中（仍活跃）→ 不可见
   ├─ t_xmin < xmin → 已提交 → 检查 t_xmax
   └─ t_xmin >= xmax → 快照之后开始 → 不可见

2. 检查 t_xmax（谁删除/更新了这个版本？）
   ├─ t_xmax == 0 → 未被删除 → 可见
   ├─ t_xmax == CurrentXID → 本事务删除
   │     └─ 本命令之前删除 → 不可见；之后删除 → 可见
   ├─ t_xmax 在 xip 中（仍活跃）→ 还未提交删除 → 可见
   ├─ t_xmax < xmin → 已提交删除 → 不可见
   └─ t_xmax >= xmax → 快照之后删除 → 可见
```

**infomask 缓存优化：** PostgreSQL 在首次检查 XID 状态后，将结果写入 `t_infomask`（`HEAP_XMIN_COMMITTED`, `HEAP_XMAX_COMMITTED` 等标志），避免重复查询 pg_clog（SLRU），显著减少 I/O。

### 4.3 行级锁与表级锁

**行级锁**通过 `t_infomask` 中的锁模式位存储：

| SQL 语句 | 锁模式 | infomask 标志 |
|----------|--------|--------------|
| `SELECT ... FOR UPDATE` | 排他行锁 | `HEAP_XMAX_EXCL_LOCK` |
| `SELECT ... FOR NO KEY UPDATE` | 弱排他行锁 | `HEAP_XMAX_LOCK_ONLY \| HEAP_XMAX_EXCL_LOCK` |
| `SELECT ... FOR SHARE` | 共享行锁 | `HEAP_XMAX_KEYSHR_LOCK` |
| `SELECT ... FOR KEY SHARE` | 键共享行锁 | `HEAP_XMAX_KEYSHR_LOCK` |

**表级锁 8 种模式兼容矩阵：**

```
                  ACCESS  ROW     ROW     SHARE   SHARE   EXCL    ACCESS
                  SHARE   SHARE   EXCL    UPDATE  ROW EXCL        EXCL
                  (AS)    (RS)    (RE)    (SUE)   (SRE)   (E)     (AE)
ACCESS SHARE      ✓       ✓       ✓       ✓       ✓       ✓       ✗
ROW SHARE         ✓       ✓       ✓       ✓       ✓       ✗       ✗
ROW EXCLUSIVE     ✓       ✓       ✓       ✓       ✗       ✗       ✗
SHARE UPDATE EXCL ✓       ✓       ✓       ✗       ✗       ✗       ✗
SHARE ROW EXCL    ✓       ✓       ✗       ✗       ✗       ✗       ✗
EXCLUSIVE         ✓       ✗       ✗       ✗       ✗       ✗       ✗
ACCESS EXCLUSIVE  ✗       ✗       ✗       ✗       ✗       ✗       ✗
```

`ACCESS EXCLUSIVE`（`ALTER TABLE`, `DROP TABLE`, `TRUNCATE`, `LOCK TABLE`）与**所有其他锁**冲突，是最强锁。`SELECT` 获取 `ACCESS SHARE`，与 `ACCESS EXCLUSIVE` 互斥，所以 DDL 会被读查询阻塞。

### 4.4 SSI 可串行化快照隔离

PostgreSQL 9.1 实现了真正的**可串行化隔离级别**（SSI），通过检测并发事务的读写依赖来发现序列化冲突。

核心思想（Michael J. Cahill 的论文）：串行化冲突 = 事务间存在 **rw-anti-dependency 环**（T1 读数据 → T2 写，T2 读数据 → T1 写，形成环）。

实现：
- 每个事务使用**谓词锁（Predicate Lock）**记录已读取的数据范围
- 写入时检测是否与其他事务的谓词锁冲突
- 发现环 → 中止其中一个事务（报错 `ERROR: could not serialize access due to read/write dependencies`）

---

## 5. WAL — Write-Ahead Logging

WAL 保证了 PostgreSQL 的 **ACID 中的持久性（Durability）** 和 **崩溃恢复**能力：任何数据页修改在写入磁盘前，必须先将对应的 WAL 记录刷盘。

### 5.1 WAL 记录格式与 LSN

源码：`src/include/access/xlogrecord.h`

```c
/* src/include/access/xlogrecord.h */
typedef struct XLogRecord {
    uint32      xl_tot_len;  /* 整条 WAL 记录的总长度（含 XLogRecord 头） */
    TransactionId xl_xid;   /* 产生此记录的事务 XID（0 表示非事务性） */
    XLogRecPtr  xl_prev;    /* 前一条 WAL 记录的 LSN（用于向前扫描） */
    uint8       xl_info;    /* 记录类型标志（高4位为操作类型，低4位为 rmgr 相关标志）*/
    RmgrId      xl_rmid;    /* Resource Manager ID（heap/btree/xact 等）*/
    /* 2 bytes padding */
    pg_crc32c   xl_crc;     /* CRC32 校验（xl_tot_len 到此字段前的所有数据）*/
    /* 后跟 XLogRecordBlockHeader[] 和数据 */
} XLogRecord;
```

**LSN（Log Sequence Number）** 是 WAL 文件中的字节偏移量：

```c
typedef uint64 XLogRecPtr; /* 64位，高32位=WAL文件段编号，低32位=段内偏移 */

/* WAL 文件命名：000000010000000000000001 = timeline 1, segment 1 */
/* 默认每个 WAL 段文件 = 16MB */
```

```sql
-- 查看当前 LSN
SELECT pg_current_wal_lsn();          -- 主库当前写入位置
SELECT pg_last_wal_receive_lsn();     -- 备库最新接收位置
SELECT pg_last_wal_replay_lsn();      -- 备库最新回放位置

-- 主备复制延迟（字节）
SELECT pg_wal_lsn_diff(
    pg_current_wal_lsn(),
    pg_last_wal_replay_lsn()
);
```

**Resource Manager（rmgr）** 对应不同的操作类型：

| rmgr ID | 名称 | 负责记录 |
|---------|------|---------|
| 0 | XLOG | 系统控制（checkpoint, full-page write）|
| 1 | Transaction | BEGIN/COMMIT/ABORT |
| 2 | Storage | 文件创建/删除 |
| 10 | Heap | INSERT/UPDATE/DELETE/HOT_UPDATE |
| 11 | Btree | 索引分裂/插入/删除 |
| 16 | Standby | 备库相关记录 |

### 5.2 WAL 写入流程

```diagram
应用层 SQL → Backend 进程 → WAL 写入路径
                               │
                    XLogBeginInsert()
                    XLogRegisterData()    ← 注册要记录的数据
                    XLogRegisterBuffer()  ← 注册被修改的 buffer（full page write 时记录整页）
                               │
                    XLogInsert(rmgr, info)
                               │
                    ┌──────────────────────────────┐
                    │  WALInsertLockAcquire()       │ ← 获取 WAL insert 锁
                    │  ReserveXLogInsertLocation()  │ ← 原子分配 LSN（CAS 操作）
                    │  CopyXLogRecordToWAL()        │ ← 将记录复制到 WAL buffer
                    │  WALInsertLockRelease()       │
                    └──────────────────────────────┘
                               │
                    XLogFlush(LSN)        ← 事务提交时调用，等待 WAL 刷盘
                               │
                    ┌──────────────────────────────┐
                    │  WAL Writer 后台刷盘           │ ← wal_writer_delay=200ms
                    │  或 XLogFlush 同步 fsync()    │
                    └──────────────────────────────┘
```

**Full Page Write（FPW）：** Checkpoint 后首次修改某页时，WAL 中记录**整页内容**（而非仅变化量），确保部分写（partial write）崩溃后能完整恢复。

### 5.3 Checkpoint 机制

Checkpoint 将所有脏页从 shared_buffers 刷到磁盘，并在 WAL 中写入 checkpoint 记录，用于崩溃恢复时的起点。

**触发条件：**
- 时间：`checkpoint_timeout`（默认 5 分钟）
- 量：WAL 积累超过 `max_wal_size`（默认 1GB）
- 手动：`CHECKPOINT` 命令

**checkpoint_completion_target** 平滑刷脏：

```
目标：在下次 checkpoint 触发前，将本次 checkpoint 的刷盘工作完成
checkpoint_completion_target = 0.9 表示用 90% 的 checkpoint 间隔时间
均匀刷脏，避免 I/O 突刺
```

**崩溃恢复流程：**

```
数据库崩溃后重启:
    1. 读取 pg_control 文件 → 找到最近的 checkpoint LSN
    2. 从该 LSN 开始重放 WAL 记录（redo）
    3. 遇到 full-page write 记录 → 用完整页覆盖磁盘页
    4. 遇到普通修改记录 → 在已恢复的页上重做操作
    5. 到达 WAL 末尾 → 恢复完成，开始接受连接
```

### 5.4 流式复制

PostgreSQL 流式复制架构：

```diagram
主库 (Primary)                         备库 (Standby)
┌──────────────────────────────┐       ┌─────────────────────────────┐
│  Backend 进程                │       │  WAL Receiver 进程           │
│  写入 WAL buffer / WAL 文件  │←──────│  recovery.conf:             │
│                              │  TCP  │  primary_conninfo = 'host=..'│
│  WAL Sender 进程             │──────→│  startup process            │
│  (src/backend/replication/  │  WAL  │  重放 WAL，更新数据页        │
│   walsender.c)               │  流   │                             │
└──────────────────────────────┘       └─────────────────────────────┘
```

**同步复制 vs 异步复制：**

| 模式 | `synchronous_commit` | 主库等待 | 数据丢失风险 |
|------|---------------------|---------|------------|
| 异步 | `off` | 不等待 | 最多丢失几秒 WAL |
| 本地 | `local` | 等本地 fsync | 主库崩溃无丢失，备库可能落后 |
| 远程写 | `remote_write` | 备库写入 OS buffer | 备库 OS 崩溃可能丢失 |
| 远程同步 | `on` / `remote_apply` | 备库 WAL fsync / 回放完成 | 零数据丢失 |

**Hot Standby：** 备库回放 WAL 的同时可接受只读查询，需配置 `hot_standby = on`。备库维护自己的快照，只读查询与 WAL 回放并发执行。

---

## 6. 查询执行引擎

### 6.1 查询处理全流程

```diagram
客户端 SQL
    │
    ▼
┌─────────────────────────────────────────────────┐
│  Parser（词法/语法分析）                          │
│  src/backend/parser/gram.y                       │
│  → 生成 raw parse tree（List of Node *）         │
└─────────────────────────┬───────────────────────┘
                          ▼
┌─────────────────────────────────────────────────┐
│  Analyzer / Semantic Analysis                    │
│  src/backend/analyze/analyze.c                   │
│  → 解析列名/表名，生成 Query 结构体              │
│  → 检查权限，展开 * 列，处理子查询               │
└─────────────────────────┬───────────────────────┘
                          ▼
┌─────────────────────────────────────────────────┐
│  Rewriter（规则重写）                             │
│  src/backend/rewrite/rewriteHandler.c            │
│  → 展开视图（视图底层是规则）                    │
│  → 应用 DO INSTEAD 规则                         │
└─────────────────────────┬───────────────────────┘
                          ▼
┌─────────────────────────────────────────────────┐
│  Planner / Optimizer                             │
│  src/backend/optimizer/                          │
│  → 枚举可能的执行计划（join order, access path） │
│  → 基于代价选择最优计划                          │
│  → 生成 PlannedStmt（执行计划树）                │
└─────────────────────────┬───────────────────────┘
                          ▼
┌─────────────────────────────────────────────────┐
│  Executor（执行器）                               │
│  src/backend/executor/execMain.c                 │
│  → 火山模型迭代执行                               │
│  → 返回结果给客户端                              │
└─────────────────────────────────────────────────┘
```

入口函数（`src/backend/tcop/postgres.c`）：

```c
/* src/backend/tcop/postgres.c */
static void
exec_simple_query(const char *query_string)
{
    /* Step 1: Parse */
    parsetree_list = pg_parse_query(query_string);

    foreach(parsetree_item, parsetree_list)
    {
        /* Step 2: Analyze + Rewrite */
        querytree_list = pg_analyze_and_rewrite_fixedparams(
            parsetree, query_string, NULL, 0, NULL);

        /* Step 3: Plan */
        plantree_list = pg_plan_queries(querytree_list, ...);

        /* Step 4: Execute */
        PortalRun(portal, FETCH_ALL, ...);
    }
}
```

### 6.2 火山模型执行器

PostgreSQL 采用经典的 **Volcano/Iterator 模型**：每个执行计划节点实现三个接口。

```c
/* 每个执行器节点的接口（src/include/executor/executor.h）*/
typedef TupleTableSlot *(*ExecProcNodeMtd)(PlanState *pstate);

/* 等价于: */
void ExecInitNode(Plan *node, EState *estate, int eflags);   /* 初始化 */
TupleTableSlot *ExecProcNode(PlanState *node);               /* 获取下一行 */
void ExecEndNode(PlanState *node);                           /* 清理资源 */
```

**执行流程示意（嵌套循环连接）：**

```
NestLoopState.ExecProcNode():
    outer_tuple = ExecProcNode(outerPlan)   // 获取外表下一行
    if outer_tuple == NULL: return NULL     // 外表扫描完毕

    loop:
        inner_tuple = ExecProcNode(innerPlan) // 获取内表下一行
        if inner_tuple == NULL:
            // 内表扫描完，取外表下一行
            ExecReScan(innerPlan)            // 重置内表扫描
            outer_tuple = ExecProcNode(outerPlan)
            continue

        if joinqual satisfied:
            return project(outer_tuple, inner_tuple)
```

### 6.3 执行器节点详解

| 节点类型 | 功能 | 关键算法 |
|----------|------|---------|
| `SeqScan` | 全表顺序扫描 | 逐块读取堆文件，逐行可见性检查 |
| `IndexScan` | 索引扫描 | B-tree/GiST/etc 查找 TID，随机读取堆页 |
| `IndexOnlyScan` | 仅索引扫描 | 从索引直接获取数据，不读堆（需 visibility map 确认）|
| `BitmapHeapScan` | 位图堆扫描 | 先用 BitmapIndexScan 收集所有 TID，按页序读堆（减少随机 I/O）|
| `NestLoop` | 嵌套循环连接 | 外表每行驱动内表扫描，适合小结果集 |
| `HashJoin` | 哈希连接 | 构建内表哈希表，外表探测，适合大表等值连接 |
| `MergeJoin` | 归并连接 | 两侧已排序时，归并扫描，适合等值连接且已有序 |
| `Sort` | 排序 | quicksort（内存）/ external merge（超内存）|
| `Hash` | 构建哈希表 | HashJoin 的内侧节点 |
| `Aggregate` | 聚合 | plain/sorted/hashed 三种模式 |
| `Limit` | 限制行数 | 达到行数后停止调用子节点 |

### 6.4 代价模型与 EXPLAIN

优化器代价模型的**基础参数**（`src/backend/optimizer/path/costsize.c`）：

```
seq_page_cost    = 1.0    (顺序读 1 页的相对代价，基准值)
random_page_cost = 4.0    (随机读 1 页，默认是顺序的 4 倍)
                          (SSD 环境建议设为 1.1)
cpu_tuple_cost   = 0.01   (处理 1 行的 CPU 代价)
cpu_index_tuple_cost = 0.005  (处理 1 条索引记录)
cpu_operator_cost = 0.0025    (计算 1 次操作符)
parallel_tuple_cost = 0.1     (并行 worker 传输 1 行)
```

**EXPLAIN 输出解读：**

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT u.name, count(o.id)
FROM users u
JOIN orders o ON u.id = o.user_id
WHERE u.created_at > '2024-01-01'
GROUP BY u.name;

-- 示例输出:
HashAggregate  (cost=12450.30..12550.30 rows=10000 width=36)
               (actual time=185.432..190.123 rows=8542 loops=1)
  Group Key: u.name
  Batches: 1  Memory Usage: 2457kB
  Buffers: shared hit=8234 read=1205
  ->  Hash Join  (cost=3200.00..11200.30 rows=250000 width=28)
                 (actual time=45.234..150.123 rows=245123 loops=1)
        Hash Cond: (o.user_id = u.id)
        Buffers: shared hit=7234 read=1205
        ->  Seq Scan on orders o  (cost=0.00..5200.00 rows=500000 width=8)
                                  (actual time=0.012..55.234 rows=500000 loops=1)
              Buffers: shared hit=5200
        ->  Hash  (cost=2800.00..2800.00 rows=32000 width=24)
                  (actual time=44.123..44.123 rows=32000 loops=1)
              Buckets: 32768  Batches: 1  Memory Usage: 2134kB
              ->  Index Scan using idx_users_created on users u
                  (cost=0.43..2800.00 rows=32000 width=24)
                  (actual time=0.123..35.234 rows=32000 loops=1)
                  Index Cond: (created_at > '2024-01-01')
                  Buffers: shared hit=2034 read=1205
Planning Time: 2.345 ms
Execution Time: 192.567 ms
```

字段解析：
- `cost=start..total`：估算代价（start = 返回第一行代价，total = 全部完成代价）
- `rows`：估算行数（依赖统计信息的准确性）
- `actual time=start..end`：实际执行时间（毫秒）
- `Buffers: shared hit=N read=M`：从 shared_buffers 命中 N 页，从磁盘读取 M 页

---

## 7. VACUUM 与自动清理

### 7.1 VACUUM 的作用

PostgreSQL 的 MVCC 设计使得 UPDATE/DELETE 不会立即删除旧版本，而是保留为"死元组（dead tuple）"。VACUUM 负责清理这些残留版本。

**VACUUM 的四项核心工作：**

1. **回收死元组空间** — 将 `t_xmax` 已提交的死 tuple 对应的 ItemIdData 标记为 LP_DEAD，后续插入可复用空间

2. **更新 Visibility Map（VM）** — 页面中所有 tuple 对所有活跃事务可见时，设置 VM 的 all-visible bit，`IndexOnlyScan` 可直接信任此位而跳过堆访问

3. **更新 Free Space Map（FSM）** — 记录每页的剩余空间，供 INSERT 快速找到合适的页面

4. **冻结旧 XID（Freeze）** — 防止 XID Wraparound（见 7.3 节）

**VACUUM 与 VACUUM FULL 对比：**

| | VACUUM（普通）| VACUUM FULL |
|--|--------------|-------------|
| 锁级别 | ShareUpdateExclusiveLock（不阻读写）| AccessExclusiveLock（阻塞所有访问）|
| 空间回收 | 在原文件内原地回收，不还给 OS | 完整重建表文件，归还空间给 OS |
| 性能开销 | 低（后台运行）| 高（重建整表）|
| 使用场景 | 日常维护 | 表空间严重膨胀时 |
| 时间复杂度 | O(dead tuples) | O(total tuples) |

### 7.2 autovacuum 配置调优

autovacuum Launcher 根据统计信息决定触发哪张表的 VACUUM：

```
触发条件（满足任一）:
  n_dead_tup > autovacuum_vacuum_threshold + autovacuum_vacuum_scale_factor * reltuples

  默认:
  n_dead_tup > 50 + 0.2 * reltuples
  即：死元组超过总行数的 20% + 50 行，就触发 autovacuum

ANALYZE 触发条件:
  n_mod_since_analyze > autovacuum_analyze_threshold + autovacuum_analyze_scale_factor * reltuples
  默认:
  n_mod_since_analyze > 50 + 0.1 * reltuples
```

**大表优化配置（在表级别设置）：**

```sql
-- 对大表降低阈值，更频繁 autovacuum（避免死元组堆积太多）
ALTER TABLE large_table SET (
    autovacuum_vacuum_scale_factor = 0.01,   -- 1% 而非 20%
    autovacuum_vacuum_threshold = 1000,       -- 1000 行而非 50 行
    autovacuum_vacuum_cost_delay = 2          -- 降低 IO 限速延迟（毫秒）
);

-- 查看各表的 autovacuum 状态
SELECT schemaname, relname,
       n_dead_tup, n_live_tup,
       last_autovacuum, last_autoanalyze
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC;
```

### 7.3 XID Wraparound 问题

PostgreSQL 的 XID 是 32 位无符号整数，最大约 42 亿。由于可见性比较使用**模运算**（`TransactionIdPrecedes`），XID 的"过去"和"未来"各有约 21 亿的范围。

**Wraparound 灾难场景：**

```
当前 XID = 2,000,000,000

如果某个旧 tuple 的 t_xmin = 5（非常古老）
从当前 XID 的视角看：
  2,000,000,000 - 5 = 1,999,999,995 < 2^31 → 认为 XID=5 在"过去" → 可见 ✓

5 亿次事务后，XID = 2,500,000,000
  2,500,000,000 - 5 = 2,499,999,995 > 2^31 → 认为 XID=5 在"未来" → 不可见 ✗
  → 数据突然消失！
```

**防范：VACUUM FREEZE**

VACUUM 将年龄超过 `vacuum_freeze_min_age`（默认 5000万）的 tuple 的 t_xmin 替换为 `FrozenTransactionId`（XID=2），冻结后的 tuple 对所有事务永久可见，不参与 wraparound 计算。

```sql
-- 查看各库距离 wraparound 的距离
SELECT datname,
       age(datfrozenxid) AS age,
       2147483647 - age(datfrozenxid) AS remaining_xids
FROM pg_database
ORDER BY age DESC;

-- age > 1.5 亿时，PostgreSQL 开始在日志中告警
-- age > 2 亿时，强制关机并要求手动 VACUUM FREEZE
```

**关键参数：**

| 参数 | 默认值 | 含义 |
|------|--------|------|
| `vacuum_freeze_min_age` | 50,000,000 | XID 年龄超过此值才考虑冻结 |
| `vacuum_freeze_table_age` | 150,000,000 | 表的 relfrozenxid 年龄超过此值强制扫描全表冻结 |
| `autovacuum_freeze_max_age` | 200,000,000 | 超过此年龄强制触发 autovacuum FREEZE，忽略其他配置 |

---

## 性能对比与最佳实践

### 隔离级别对比

| 隔离级别 | 脏读 | 不可重复读 | 幻读 | 序列化异常 | 实现机制 |
|----------|------|-----------|------|-----------|---------|
| READ UNCOMMITTED | 可能 | 可能 | 可能 | 可能 | （PostgreSQL 中等同 READ COMMITTED）|
| READ COMMITTED | 不可能 | 可能 | 可能 | 可能 | 每个语句获取新快照 |
| REPEATABLE READ | 不可能 | 不可能 | 不可能* | 可能 | 事务开始时获取快照 |
| SERIALIZABLE | 不可能 | 不可能 | 不可能 | 不可能 | SSI + 谓词锁 |

*PostgreSQL 的 REPEATABLE READ 已经天然避免幻读（MVCC 快照隔离特性）

### 关键监控查询

```sql
-- 查看锁等待情况
SELECT pid, query, wait_event_type, wait_event, state
FROM pg_stat_activity
WHERE wait_event_type = 'Lock';

-- 查看锁依赖关系
SELECT blocked.pid, blocked.query,
       blocking.pid AS blocking_pid, blocking.query AS blocking_query
FROM pg_stat_activity blocked
JOIN pg_stat_activity blocking
    ON blocking.pid = ANY(pg_blocking_pids(blocked.pid))
WHERE blocked.wait_event_type = 'Lock';

-- 查看表膨胀
SELECT relname,
       pg_size_pretty(pg_total_relation_size(oid)) AS total_size,
       n_dead_tup, n_live_tup,
       ROUND(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 2) AS dead_pct
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC;

-- 查看 shared_buffers 命中率
SELECT sum(heap_blks_hit) / sum(heap_blks_hit + heap_blks_read) AS buffer_hit_rate
FROM pg_statio_user_tables;
```
