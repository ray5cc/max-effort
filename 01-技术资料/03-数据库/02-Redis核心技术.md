# Redis 核心技术深度解析

> Redis 是单线程事件驱动的内存数据库——理解它的底层实现，就是理解如何在极简模型下榨干硬件性能：精心设计的数据结构、无锁并发、Copy-on-Write 持久化、渐进式 Rehash……每一个设计决策背后都是对 "正确性 vs 性能" 的深度权衡。

## 相关链接
- 对应面试题：[Redis 面试题](../../../02-面试指南/03-数据库面试/02-Redis面试题.md)

## 目录
1. [Redis 数据结构底层实现](#1-redis-数据结构底层实现)
   - 1.1 [SDS — Simple Dynamic String](#11-sds--simple-dynamic-string)
   - 1.2 [ziplist / listpack](#12-ziplist--listpack)
   - 1.3 [hashtable / dict](#13-hashtable--dict)
   - 1.4 [skiplist — 有序集合骨架](#14-skiplist--有序集合骨架)
   - 1.5 [intset — 整数集合](#15-intset--整数集合)
   - 1.6 [quicklist — 链表 + ziplist 复合](#16-quicklist--链表--ziplist-复合)
   - 1.7 [编码转换阈值配置](#17-编码转换阈值配置)
2. [Redis 持久化机制](#2-redis-持久化机制)
   - 2.1 [RDB 快照](#21-rdb-快照)
   - 2.2 [AOF 日志](#22-aof-日志)
   - 2.3 [混合持久化](#23-混合持久化)
3. [Redis 内存管理](#3-redis-内存管理)
   - 3.1 [内存分配器 — jemalloc 集成](#31-内存分配器--jemalloc-集成)
   - 3.2 [淘汰策略](#32-淘汰策略)
   - 3.3 [过期键删除](#33-过期键删除)
4. [Redis 网络模型](#4-redis-网络模型)
   - 4.1 [ae 事件库](#41-ae-事件库)
   - 4.2 [IO 多路复用后端](#42-io-多路复用后端)
   - 4.3 [命令处理完整流程](#43-命令处理完整流程)
   - 4.4 [Redis 6.0+ 多线程 IO](#44-redis-60-多线程-io)
5. [Redis 集群](#5-redis-集群)
   - 5.1 [主从复制](#51-主从复制)
   - 5.2 [Sentinel 哨兵](#52-sentinel-哨兵)
   - 5.3 [Redis Cluster 模式](#53-redis-cluster-模式)
6. [Redis 事务与 Lua 脚本](#6-redis-事务与-lua-脚本)
   - 6.1 [MULTI/EXEC 事务](#61-multiexec-事务)
   - 6.2 [WATCH 乐观锁](#62-watch-乐观锁)
   - 6.3 [Lua 脚本原子执行](#63-lua-脚本原子执行)

---

## 1. Redis 数据结构底层实现

Redis 的高性能离不开对每种数据类型的精心底层编码。一个 key 在不同元素数量 / 值大小下会使用完全不同的内部表示，核心目标是：**小数据用紧凑编码节省内存，大数据用高效编码保证速度**。

### 1.1 SDS — Simple Dynamic String

源码：`src/sds.h`, `src/sds.c`

C 语言原生字符串不记录长度、不安全追加。Redis 用 SDS（Simple Dynamic String）彻底解决了这两个问题。

```c
/* src/sds.h */
struct __attribute__ ((__packed__)) sdshdr5 {
    unsigned char flags; /* 低3位为type，高5位为长度 */
    char buf[];
};
struct __attribute__ ((__packed__)) sdshdr8 {
    uint8_t  len;        /* 已使用字节数 */
    uint8_t  alloc;      /* 总分配字节数（不含header和\0） */
    unsigned char flags; /* 低3位标识类型：SDS_TYPE_8 = 1 */
    char buf[];
};
struct __attribute__ ((__packed__)) sdshdr16 {
    uint16_t len;
    uint16_t alloc;
    unsigned char flags;
    char buf[];
};
struct __attribute__ ((__packed__)) sdshdr32 {
    uint32_t len;
    uint32_t alloc;
    unsigned char flags;
    char buf[];
};
struct __attribute__ ((__packed__)) sdshdr64 {
    uint64_t len;
    uint64_t alloc;
    unsigned char flags;
    char buf[];
};
```

**关键设计点：**

| 特性 | C字符串 | SDS |
|------|---------|-----|
| 获取长度 | O(N) strlen | O(1) `sds->len` |
| 追加安全 | 需手动 realloc | 自动扩容 + 预分配 |
| 二进制安全 | 遇 `\0` 截断 | `len` 字段独立记录 |
| 内存头大小 | 0 | 3B (sdshdr8) 起 |

**空间预分配策略（`sdsMakeRoomFor` in sds.c）：**
- 扩容后长度 < 1MB：`alloc = newlen * 2`（加倍）
- 扩容后长度 ≥ 1MB：`alloc = newlen + 1MB`（线性增长）

**`__attribute__((__packed__))`** 作用：禁止结构体对齐填充，保证 `buf[-1]` 精确命中 `flags` 字段，SDS API 靠此实现 O(1) 类型判断。

---

### 1.2 ziplist / listpack

源码：`src/ziplist.c`，`src/listpack.c`（Redis 7.0 起 listpack 全面替换 ziplist）

**ziplist 内存布局（ASCII）：**

```
┌────────┬────────┬────────┬──────────────────────────────────┬────────┐
│zlbytes │zltail  │zllen   │   entry[0] | entry[1] | ...       │zlend   │
│(4字节) │(4字节) │(2字节) │                                  │(0xFF)  │
└────────┴────────┴────────┴──────────────────────────────────┴────────┘

每个 entry 结构：
┌─────────────────────┬──────────────┬─────────────┐
│ prevrawlen           │ encoding      │ content     │
│ (1 或 5 字节)        │ (1~5 字节)    │ (变长)      │
└─────────────────────┴──────────────┴─────────────┘
```

`prevrawlen` 存储前一个 entry 的长度，支持从尾部向前遍历（O(N) 但内存紧凑）。

**ziplist 的连锁更新（cascade update）缺陷：**  
若某个 entry 长度从 < 254 变成 ≥ 254，其后所有 `prevrawlen` 从 1 字节扩展为 5 字节，最坏情况触发 O(N) 次 realloc，这是 ziplist 被 listpack 取代的核心原因。

**listpack 内存布局（src/listpack.c）：**

```
┌────────┬────────┬──────────────────────────────┬────────┐
│total   │num     │   lp-entry[0] | lp-entry[1]  │lpend   │
│bytes   │elements│                              │(0xFF)  │
│(4字节) │(2字节) │                              │        │
└────────┴────────┴──────────────────────────────┴────────┘

lp-entry：
┌─────────────────┬─────────────────┬──────────────────┐
│ encoding+data    │ backlen          │                  │
│ (变长)           │ (1~5 字节，记录  │                  │
│                  │  本entry总长度)  │                  │
└─────────────────┴─────────────────┴──────────────────┘
```

listpack 的每个 entry 自包含本体长度（`backlen`），删除/插入不再引发连锁更新。

---

### 1.3 hashtable / dict

源码：`src/dict.h`, `src/dict.c`

```c
/* src/dict.h */
typedef struct dictEntry {
    void *key;
    union {
        void *val;
        uint64_t u64;
        int64_t  s64;
        double   d;
    } v;
    struct dictEntry *next; /* 链地址法处理冲突 */
    void *metadata[];       /* 灵活数组，存储额外元信息 */
} dictEntry;

typedef struct dictht {   /* hash table（每个 dict 含两个） */
    dictEntry **table;    /* 桶数组 */
    unsigned long size;   /* 桶数量，必须是 2 的幂 */
    unsigned long sizemask; /* size - 1，用于取模 */
    unsigned long used;   /* 已存储 entry 数量 */
} dictht;

typedef struct dict {
    dictType *type;
    dictht ht[2];         /* ht[0] 正常使用，ht[1] rehash 时用 */
    long rehashidx;       /* -1 表示未在 rehash；≥0 为当前 rehash 桶下标 */
    unsigned pauserehash; /* > 0 时暂停 rehash（迭代器持有期间） */
} dict;
```

**渐进式 Rehash（Progressive Rehashing）核心流程：**

Redis 不会一次性完成 rehash（避免阻塞），而是分摊到每次 CRUD 操作中。

```
触发条件：
  扩容：used / size > 1（load factor > 1）
        或 BGSAVE/BGREWRITEAOF 期间 load factor > 5（放宽阈值，减少 COW 页污染）
  缩容：used / size < 0.1

渐进式流程：
┌──────────────────────────────────────────────────────────────────┐
│  dictRehash(dict *d, int n)   ← 每次最多迁移 n 个非空桶          │
│                                                                  │
│  while (n-- && d->ht[0].used) {                                  │
│      // 跳过空桶（但最多跳 10*n 个，防止长时间阻塞）              │
│      while (d->ht[0].table[d->rehashidx] == NULL)               │
│          d->rehashidx++;                                         │
│                                                                  │
│      // 将 ht[0].table[rehashidx] 整个链表迁移到 ht[1]           │
│      de = d->ht[0].table[d->rehashidx];                         │
│      while (de) {                                                │
│          h = dictHashKey(d, de->key) & d->ht[1].sizemask;       │
│          de->next = d->ht[1].table[h];                          │
│          d->ht[1].table[h] = de;                                │
│          d->ht[0].used--;  d->ht[1].used++;                     │
│          de = nextde;                                            │
│      }                                                           │
│      d->ht[0].table[d->rehashidx] = NULL;                       │
│      d->rehashidx++;                                             │
│  }                                                               │
│  // ht[0].used == 0 时，swap ht[0]=ht[1], 清空 ht[1]            │
└──────────────────────────────────────────────────────────────────┘

双表并存期间查找顺序：先查 ht[0]，再查 ht[1]
写操作（新增）只写入 ht[1]，保证 ht[0] 只减不增
```

---

### 1.4 skiplist — 有序集合骨架

源码：`src/t_zset.c`, `src/server.h`

```c
/* src/server.h */
typedef struct zskiplistNode {
    sds ele;                         /* 成员字符串 */
    double score;                    /* 分值 */
    struct zskiplistNode *backward;  /* 后退指针（仅第0层） */
    struct zskiplistLevel {
        struct zskiplistNode *forward; /* 前进指针 */
        unsigned long span;            /* 到 forward 跨越的节点数（用于 RANK 计算） */
    } level[];                         /* 柔性数组，层数在 [1, ZSKIPLIST_MAXLEVEL=32] 随机确定 */
} zskiplistNode;

typedef struct zskiplist {
    struct zskiplistNode *header, *tail;
    unsigned long length;  /* 节点数 */
    int level;             /* 当前最大层数 */
} zskiplist;
```

**跳表层级布局（ASCII，4层示例）：**

```
Level 4: header ──────────────────────────────────────────→ NULL
Level 3: header ──────────── [score=30] ──────────────────→ NULL
Level 2: header ── [s=10] ── [s=30] ── [s=50] ───────────→ NULL
Level 1: header ── [s=10] ── [s=20] ── [s=30] ── [s=50] → NULL
                    ↑ backward 指针 ↑
```

- 查找复杂度 O(log N)，与红黑树相当，但实现简单、范围查询友好
- 层数由 `zslRandomLevel()` 以 **p=0.25** 概率确定（每层有 25% 概率晋升到上一层）
- `span` 字段让 `ZRANK` / `ZRANGE … BYSCORE` 在 O(log N) 内完成，无需遍历

---

### 1.5 intset — 整数集合

源码：`src/intset.h`

```c
typedef struct intset {
    uint32_t encoding;  /* INTSET_ENC_INT16 / INT32 / INT64 */
    uint32_t length;    /* 元素数量 */
    int8_t contents[];  /* 实际存储的有序整数数组，按 encoding 解释宽度 */
} intset;
```

- 所有元素**有序存储**，查找用二分搜索 O(log N)
- 插入新元素超出当前 `encoding` 范围时触发**升级（upgrade）**：重新 realloc，将每个元素从旧宽度转换到新宽度
- 升级是单向的，不支持降级（防止频繁 realloc）

---

### 1.6 quicklist — 链表 + ziplist 复合

源码：`src/quicklist.h`

```c
typedef struct quicklistNode {
    struct quicklistNode *prev, *next;
    unsigned char *entry;  /* ziplist 或 listpack 数据块 */
    size_t sz;             /* entry 字节数 */
    unsigned int count      : 16;  /* entry 中元素个数 */
    unsigned int encoding   : 2;   /* RAW(ziplist) 或 LZF(压缩) */
    unsigned int container  : 2;   /* PLAIN 或 PACKED */
    unsigned int recompress : 1;   /* 临时解压标志 */
    unsigned int attempted_compress : 1;
    unsigned int dont_compress : 1;
    unsigned int extra : 9;
} quicklistNode;

typedef struct quicklist {
    quicklistNode *head, *tail;
    unsigned long count;        /* 所有 ziplist 中的元素总数 */
    unsigned long len;          /* quicklistNode 节点数 */
    signed int fill             : QL_FILL_BITS;  /* 每节点最大 ziplist 大小 */
    unsigned int compress       : QL_COMP_BITS;  /* 首尾各多少节点不压缩 */
    unsigned int bookmark_count : QL_BM_BITS;
    quicklistBookmark bookmarks[];
} quicklist;
```

**内存布局：**
```
quicklist
  ├── Node1 [ziplist: e0, e1, e2, e3]
  ├── Node2 [ziplist: e4, e5, e6, e7]  ← LZF 压缩（compress > 0 时，中间节点压缩）
  └── Node3 [ziplist: e8, e9]
```

`fill` 配置 `list-max-ziplist-size`：正数表示每节点最多元素数，负数表示字节上限（-1=4KB, -2=8KB, -3=16KB, -4=32KB, -5=64KB）。

---

### 1.7 编码转换阈值配置

| 数据类型 | 小数据编码 | 转换条件 | 大数据编码 |
|----------|-----------|---------|-----------|
| String | embstr (≤44B) | 超过 44 字节 | raw (sds) |
| List | listpack | 元素数 > `list-max-listpack-size`(128) 或单元素 > 64B | quicklist |
| Hash | listpack | 字段数 > `hash-max-listpack-entries`(128) 或值 > `hash-max-listpack-value`(64) | hashtable |
| Set | intset | 有非整数 或 元素数 > `set-max-intset-entries`(512) | hashtable |
| ZSet | listpack | 元素数 > `zset-max-listpack-entries`(128) 或成员长度 > `zset-max-listpack-value`(64) | skiplist+hashtable |

---

## 2. Redis 持久化机制

### 2.1 RDB 快照

源码：`src/rdb.c`, `src/rdb.h`

**触发路径：**

```
BGSAVE 命令
    │
    ▼
rdbSaveBackground(char *filename)          ← src/rdb.c
    │  fork()
    ├──► [子进程] rdbSave(filename, &rsi)
    │        │
    │        ▼
    │    rdbSaveRio(&rdb, &error, ...)
    │        │  遍历所有 db
    │        ▼
    │    rdbSaveKeyValuePair(rdb, key, val, expiretime)
    │        │
    │        ├── rdbSaveObjectType(rdb, val)  ← 写入类型字节
    │        ├── rdbSaveStringObject(rdb, key)
    │        └── rdbSaveObject(rdb, val, key) ← 按编码序列化
    │
    └──► [父进程] 继续服务请求（COW 保护内存）
         serverCron() 轮询 wait3() 检测子进程结束
```

**Copy-on-Write（COW）机制：**
```
fork() 后，父子进程共享物理内存页（页表指向同一物理页）
父进程写某页 → OS 触发 page fault → 复制该页 → 父进程写副本
子进程始终看到 fork 时刻的快照，无需任何锁

[父进程内存]    [子进程读取]
  page A ────────── page A (只读共享)
  page B ─→ COW → page B' (父写，子仍读原始 B)
```

**RDB 文件格式（ASCII）：**

```
┌──────────┬─────────┬──────────────────────────────────────────┬────────┐
│  "REDIS" │ version │  数据体（若干 DB 块）                      │  EOF  │
│  (5字节) │ (4字节) │                                          │+CRC64  │
└──────────┴─────────┴──────────────────────────────────────────┴────────┘

DB 块：
┌──────────┬────────┬──────────────────────────────────────────┐
│ SELECTDB │ db_id  │  key-value 对（每对含可选 EXPIRETIME 前缀）│
│ (0xFE)   │ (varint)│                                          │
└──────────┴────────┴──────────────────────────────────────────┘

key-value 对：
┌───────────────┬────────┬───────┬────────┐
│ [EXPIRETIME]  │ type   │  key  │ value  │
│ (可选，8字节) │(1字节) │(sds)  │(编码体)│
└───────────────┴────────┴───────┴────────┘
```

**`rdbSaveObject` 按类型序列化：**
- `OBJ_ENCODING_LISTPACK` → 直接写入原始 listpack 二进制字节串
- `OBJ_ENCODING_SKIPLIST` → 迭代 dictIterator，每个元素 `[member_sds][score_double]`
- `OBJ_ENCODING_HT` → 迭代 dictIterator，写入每个 key-value sds 对

---

### 2.2 AOF 日志

源码：`src/aof.c`

**写入路径：**

```
processCommand()
    │  命令执行成功后
    ▼
feedAppendOnlyFile(cmd, dbid, argv, argc)   ← src/aof.c
    │  将命令转换为 RESP 格式字节串
    │  追加到 server.aof_buf（内存缓冲区）
    ▼
beforeSleep() / serverCron()
    │
    └── flushAppendOnlyFile(force)
            │
            ├── write(server.aof_fd, server.aof_buf)  ← 写入内核 page cache
            │
            └── fsync 策略：
                  appendfsync always   → 每次 write 后立即 fsync（最安全，性能最低）
                  appendfsync everysec → 后台线程每秒 fsync 一次（默认，最多丢1秒）
                  appendfsync no       → 由 OS 决定（最快，崩溃可能丢失多秒数据）
```

**AOF 重写（`BGREWRITEAOF`）：**

```
bgrewriteaofCommand()
    │  fork 子进程
    ▼
rewriteAppendOnlyFile(filename)            ← 子进程执行
    │  遍历所有 db，为每个 key 生成最少命令
    │  （如 1000次 LPUSH 合并为一条 RPUSH key v0 v1 ... v999）
    │
    └── 重写期间父进程新命令同时写入：
          server.aof_buf           ← 继续写旧 AOF 文件（保证现有客户端可读）
          server.aof_rewrite_buf   ← 积累重写期间增量命令

子进程完成后：
    父进程将 aof_rewrite_buf 追加到新 AOF 文件
    原子 rename 替换旧文件
```

AOF 重写不依赖旧 AOF 文件（从内存 RDB 快照重新生成），保证文件最小化。

---

### 2.3 混合持久化

Redis 4.0+ 引入，由 `aof-use-rdb-preamble yes`（默认开启）控制。

```
混合持久化的 AOF 文件格式：

┌──────────────────────────────┬──────────────────────────────────┐
│  RDB 格式前缀                │  AOF 格式后缀                    │
│  (fork 时刻的全量快照，二进制)│  (fork 之后的增量命令，RESP 文本)│
└──────────────────────────────┴──────────────────────────────────┘
```

**重写流程变化：**  
子进程调用 `rdbSaveRio()` 将当前内存状态以 RDB 格式写入新 AOF 前缀，随后父进程追加增量 AOF 后缀。加载时先用 RDB loader 读前缀（速度快），再用 AOF loader 回放后缀。

**三种持久化对比：**

| 方式 | 数据安全 | 恢复速度 | 文件大小 | 适用场景 |
|------|---------|---------|---------|---------|
| RDB | 可能丢失分钟级数据 | 快 | 小（压缩二进制） | 备份、全量恢复 |
| AOF(everysec) | 最多丢 1 秒 | 较慢（需回放） | 大（文本） | 高安全要求 |
| 混合持久化 | 最多丢 1 秒 | 快（RDB前缀） | 中 | 推荐默认配置 |

---

## 3. Redis 内存管理

### 3.1 内存分配器 — jemalloc 集成

源码：`src/zmalloc.c`, `src/zmalloc.h`

Redis 在编译时选择内存分配器（`USE_JEMALLOC`/`USE_TCMALLOC`/`USE_LIBC`），默认使用 **jemalloc**。

```c
/* src/zmalloc.c — 核心封装 */
void *zmalloc(size_t size) {
    void *ptr = malloc(size + PREFIX_SIZE); /* 头部存储 size_t 大小 */
    if (!ptr) zmalloc_oom_handler(size);
    *((size_t*)ptr) = size;                 /* 记录分配大小 */
    zmalloc_used_memory += size + PREFIX_SIZE;
    return (char*)ptr + PREFIX_SIZE;
}

size_t zmalloc_used_memory(void) {
    return atomic_load_explicit(&used_memory, memory_order_relaxed);
}
```

jemalloc 的优势：
- **Arena 分离**：多 CPU 核心各有独立 arena，减少锁竞争
- **Size class 精确分配**：将大小向上取整到预定义的 size class（如 8, 16, 32, 48, 64...字节），内部碎片极小
- `malloc_usable_size()` 让 Redis 在 jemalloc 下可以精确统计实际分配大小（`INFO memory` 中的 `used_memory`）

---

### 3.2 淘汰策略

源码：`src/evict.c`

**8 种淘汰策略（`maxmemory-policy`）：**

| 策略 | 范围 | 算法 |
|------|------|------|
| `noeviction` | — | 拒绝写入，返回 OOM 错误 |
| `allkeys-lru` | 全部 key | 近似 LRU |
| `volatile-lru` | 设置了 expire 的 key | 近似 LRU |
| `allkeys-lfu` | 全部 key | 近似 LFU |
| `volatile-lfu` | 设置了 expire 的 key | 近似 LFU |
| `allkeys-random` | 全部 key | 随机 |
| `volatile-random` | 设置了 expire 的 key | 随机 |
| `volatile-ttl` | 设置了 expire 的 key | TTL 最小优先 |

**近似 LRU（evict.c：`evictionPoolPopulate`）：**

Redis 不维护全局 LRU 链表（代价太高），而是**采样候选池**：

```
evictionPoolPopulate(db, dict, pool[EVPOOL_SIZE=16]):
    随机从 dict 中采样 maxmemory-samples(默认5) 个 key
    计算 idletime = server.unixtime - key->lru
    将这些 key 按 idletime 降序插入 pool（保持有序，最大长度 16）
    淘汰 pool 中 idletime 最大的 key

每次需要淘汰时调用上述函数，从 pool 末尾取出候选并删除
```

**LFU 计数器衰减与自增（`evict.c`）：**

LFU 将 `lru` 字段的 24 位重用为：`[高16位=最后访问分钟数][低8位=对数频率计数]`

```c
/* LFULogIncr：访问时自增，使用对数概率避免计数器溢出 */
uint8_t LFULogIncr(uint8_t counter) {
    if (counter == 255) return 255;
    double r = (double)rand() / RAND_MAX;
    double baseval = counter - LFU_INIT_VAL;  /* LFU_INIT_VAL = 5 */
    if (baseval < 0) baseval = 0;
    double p = 1.0 / (baseval * server.lfu_log_factor + 1);
    if (r < p) counter++;  /* 越高的计数器越难再自增 */
    return counter;
}

/* LFUDecrAndReturn：定期衰减，惩罚长时间未访问的 key */
unsigned long LFUDecrAndReturn(robj *o) {
    unsigned long ldt = o->lru >> 8;          /* 取出分钟时间戳 */
    unsigned long counter = o->lru & 255;      /* 取出计数器 */
    unsigned long num_periods = ...            /* 过去了多少个 lfu-decay-time 分钟 */
    if (num_periods > counter) counter = 0;
    else counter -= num_periods;
    return counter;
}
```

---

### 3.3 过期键删除

源码：`src/expire.c`

Redis 采用**惰性删除 + 定期主动删除**双策略。

**惰性删除（`expireIfNeeded`）：**

```c
/* src/expire.c */
int expireIfNeeded(redisDb *db, robj *key, int force_delete_without_reply) {
    /* 每次访问 key 时调用，已过期则立即删除 */
    if (!keyIsExpired(db, key)) return 0;
    /* 从 db->dict 和 db->expires 中删除 */
    deleteExpiredKeyAndPropagate(db, key);
    return 1;
}
```

**定期主动删除（`activeExpireCycle`）：**

```
activeExpireCycle(type):
  type = ACTIVE_EXPIRE_CYCLE_FAST  ← beforeSleep() 中调用，快速模式，时间上限约 1ms
  type = ACTIVE_EXPIRE_CYCLE_SLOW  ← serverCron() 中调用，慢速模式

伪代码：
  for each db in server.dbs (按 current_db 循环，跨调用继续上次位置):
      repeat:
          随机采样 ACTIVE_EXPIRE_CYCLE_LOOKUPS_PER_LOOP(20) 个带 expire 的 key
          删除其中已过期的 key
          if 已过期比例 < 25%: break  ← 该 db 过期比例健康，切换下一个 db
          if 超过时间预算: return      ← 防止长时间阻塞
```

慢速模式时间预算 = `1s / server.hz * ACTIVE_EXPIRE_CYCLE_SLOW_TIME_PERC(25%)` 约 = 25ms（hz=10 时）

---

## 4. Redis 网络模型

### 4.1 ae 事件库

源码：`src/ae.c`, `src/ae.h`

Redis 自带轻量级事件循环库 **ae**（Async Events），抽象了 epoll / kqueue / select。

```c
/* src/ae.h — 核心结构 */
typedef struct aeFileEvent {
    int mask;              /* AE_READABLE | AE_WRITABLE | AE_BARRIER */
    aeFileProc *rfileProc; /* 可读回调 */
    aeFileProc *wfileProc; /* 可写回调 */
    void *clientData;
} aeFileEvent;

typedef struct aeTimeEvent {
    long long id;
    monotime when;
    aeTimeProc *timeProc;  /* 定时回调（如 serverCron） */
    aeEventFinalizerProc *finalizerProc;
    void *clientData;
    struct aeTimeEvent *prev, *next;
    int refcount;
} aeTimeEvent;

typedef struct aeEventLoop {
    int maxfd;
    int setsize;           /* 最大监听 fd 数量 */
    long long timeEventNextId;
    aeFileEvent *events;   /* 注册的文件事件数组 */
    aeFiredEvent *fired;   /* 本轮触发的事件 */
    aeTimeEvent *timeEventHead;
    int stop;
    void *apidata;         /* 底层 IO 多路复用状态（epoll_event[] 等） */
    aeBeforeSleepProc *beforesleep;
    aeBeforeSleepProc *aftersleep;
    int flags;
} aeEventLoop;
```

**主循环（`aeMain` in ae.c）：**

```
aeMain(eventLoop):
  while (!eventLoop->stop):
      beforesleep()                    ← 处理 pending 客户端写回、AOF flush 等
      aeProcessEvents(eventLoop,       ← 核心分发
          AE_ALL_EVENTS |
          AE_CALL_BEFORE_SLEEP |
          AE_CALL_AFTER_SLEEP)
          │
          ├── 计算最近定时事件距今剩余时间 → 作为 poll 超时
          ├── aeApiPoll(eventLoop, tvp)  ← epoll_wait / kevent / select
          ├── aftersleep()
          ├── 处理所有 fired 文件事件（rfileProc / wfileProc）
          └── 处理到期时间事件（timeProc）
```

---

### 4.2 IO 多路复用后端

Redis 在编译时通过 Makefile 宏选择后端，优先级：`epoll > kqueue > select`

```c
/* src/ae.c 顶部条件包含 */
#ifdef HAVE_EPOLL
#include "ae_epoll.c"      ← Linux 默认
#elif defined(HAVE_KQUEUE)
#include "ae_kqueue.c"     ← macOS/BSD
#else
#include "ae_select.c"     ← 兜底
#endif
```

每个后端实现统一接口：

```c
/* 抽象接口（ae_epoll.c 实现） */
static int  aeApiCreate(aeEventLoop *eventLoop);
static int  aeApiAddEvent(aeEventLoop *el, int fd, int mask);
static void aeApiDelEvent(aeEventLoop *el, int fd, int delmask);
static int  aeApiPoll(aeEventLoop *el, struct timeval *tvp);
    /* epoll 实现：epoll_wait(state->epfd, state->events, el->setsize, timeout) */
    /* 将触发事件转换为 el->fired[] 数组 */
static char *aeApiName(void);
```

---

### 4.3 命令处理完整流程

```
客户端 TCP 连接
       │
       ▼
aeCreateFileEvent(fd, AE_READABLE, acceptTcpHandler)
       │  新连接到达
       ▼
acceptTcpHandler → acceptCommonHandler → createClient(fd)
       │  注册可读事件
       ▼
aeCreateFileEvent(fd, AE_READABLE, readQueryFromClient)
       │
       ▼ [客户端发送命令数据]
readQueryFromClient(fd)              ← src/networking.c
       │  read() 追加到 client->querybuf
       ▼
processInputBuffer(client)
       │  RESP 协议解析 → client->argc / client->argv
       ▼
processCommand(client)               ← src/server.c
       │
       ├── lookupCommand(argv[0])    ← 从 server.commands 字典查找
       ├── 权限检查 / 参数数量检查 / maxmemory 检查
       ├── call(client, CMD_CALL_FULL)
       │       │
       │       └── cmd->proc(client)  ← 实际命令函数，如 setCommand / getCommand
       │
       ▼
addReply*(client, ...)               ← 将响应追加到 client->buf 或 client->reply 链表
       │
       ▼
aeCreateFileEvent(fd, AE_WRITABLE, sendReplyToClient)
       │  事件循环下次触发写事件
       ▼
sendReplyToClient → writeToClient → write(fd, ...)  ← 发送给客户端
```

---

### 4.4 Redis 6.0+ 多线程 IO

源码：`src/networking.c`, `src/io_threads.c`

Redis 6.0 引入多线程 IO，但**命令执行仍在主线程**，只有读写操作分发到 IO 线程。

```
架构图（4个IO线程）：

主线程                    IO Thread 1     IO Thread 2     IO Thread 3
   │                           │               │               │
   │ epoll_wait 检测可读 fd     │               │               │
   │ 将 clients 分配给 IO threads               │               │
   ├──→ io_threads_list[1] ────►│  read(fd) +   │               │
   ├──→ io_threads_list[2] ─────────────────────►│  parseReq    │
   ├──→ io_threads_list[3] ──────────────────────────────────────►
   │                                                            │
   │ 等待所有 IO 线程完成读取 (io_threads_pending[i] == 0)
   │
   │ 主线程逐一 processCommand()  ← 单线程执行，无需加锁
   │
   │ 将需要写回的 clients 分配给 IO threads
   ├──→ io_threads_list[1] ────►│  write(fd)    │               │
   ...
```

关键函数：
- `postponeClientRead(client)` → 将可读 client 加入 `server.clients_pending_read`
- `handleClientsWithPendingReadsUsingThreads()` → 将 pending read clients 均匀分配到 IO 线程
- `handleClientsWithPendingWritesUsingThreads()` → 将 pending write clients 均匀分配到 IO 线程
- IO 线程数通过 `io-threads` 配置（1 = 禁用多线程，等同于旧版本行为）

---

## 5. Redis 集群

### 5.1 主从复制

源码：`src/replication.c`

**复制建立流程：**

```
SLAVE → MASTER: PING
SLAVE → MASTER: REPLCONF listening-port <port>
SLAVE → MASTER: REPLCONF capa psync2
SLAVE → MASTER: PSYNC <replid> <offset>
                        │
          ┌─────────────┴──────────────┐
          │ 部分重同步（Partial Resync）│  全量重同步（Full Resync）
          │ offset 在 backlog 范围内    │  MASTER fork 发送 RDB
          │ MASTER → SLAVE:             │  MASTER → SLAVE:
          │  +CONTINUE                  │  +FULLRESYNC <replid> <offset>
          │  发送 backlog 增量数据       │  [RDB 二进制流]
          └─────────────────────────────┘
                        │
          SLAVE 持续接收 MASTER 的命令传播（replication stream）
```

**Replication Backlog（复制积压缓冲区，`src/server.h`）：**

```c
/* server.h */
char *repl_backlog;          /* 环形缓冲区，记录最近写命令字节流 */
long long repl_backlog_size; /* repl-backlog-size 配置，默认 1MB */
long long repl_backlog_histlen; /* 已使用长度 */
long long repl_backlog_idx;  /* 写入位置（环形） */
long long repl_backlog_off;  /* 缓冲区首字节对应的全局 offset */
```

断线重连时，若 slave 的 `offset` 落在 `[repl_backlog_off, repl_backlog_off + histlen)` 范围内，即可执行部分重同步，否则触发全量重同步。

**`syncWithMaster` 流程（slave 侧）：**

```
syncWithMaster(el, fd, privdata, mask)   ← 连接可写时触发
    │
    ├── PHASE 1: 发送 PING，等待 +PONG
    ├── PHASE 2: 发送 AUTH / REPLCONF
    ├── PHASE 3: 发送 PSYNC，等待 +FULLRESYNC / +CONTINUE
    └── PHASE 4 (Full): 接收 RDB（readSyncBulkPayload），加载完毕后进入在线复制
```

---

### 5.2 Sentinel 哨兵

源码：`src/sentinel.c`

```c
/* src/sentinel.c — 核心状态 */
struct sentinelState {
    char myid[CONFIG_RUN_ID_SIZE+1];
    uint64_t current_epoch;
    dict *masters;           /* 监控的主节点，key=名称，value=sentinelRedisInstance* */
    int tilt;                /* TILT 模式标志（系统时钟跳变时进入） */
    int running_scripts;
    ...
} sentinel;
```

**主观下线（SDOWN）vs 客观下线（ODOWN）：**

```
SDOWN（Subjective Down）：
  单个 Sentinel 连续 down-after-milliseconds 内无法收到 PONG
  → 标记 flags |= SRI_S_DOWN

ODOWN（Objective Down）：
  对 Master 标记 SDOWN 后，向其他 Sentinel 发送：
      SENTINEL is-master-down-by-addr <ip> <port> <epoch> <*>
  收到 ≥ quorum 个 Sentinel 同意（回复 is_down=1）
  → 标记 flags |= SRI_O_DOWN，触发故障转移
```

**Leader 选举（类 Raft）：**

```
发起 ODOWN 的 Sentinel 请求成为 Leader：
  向所有 Sentinel 发送：SENTINEL is-master-down-by-addr ... <runid>
  每个 Sentinel 在当前 epoch 只投一票（先到先得）
  获得 > (Sentinel总数/2 + 1) 票 → 成为 Leader，执行 failover

Failover 步骤：
  1. 从 slave 列表中选出最优 slave（优先级→复制偏移量→run_id 字典序）
  2. 向最优 slave 发送 REPLICAOF NO ONE（提升为新 Master）
  3. 等待新 Master 上线，广播 REPLICAOF new_master 给其他 slave
  4. 更新配置，sentinel.conf 中写入新主节点信息
```

**Sentinel 状态机（ASCII）：**

```
  MONITOR ──[SDOWN]──→ ODOWN check ──[quorum met]──→ LEADER ELECTION
     ↑                                                      │
     │                                                [elected]
     │                                                      ▼
     │                                               FAILOVER_IN_PROGRESS
     │                                                      │
     └──────────────────[failover done]──────── PROMOTE_SLAVE → UPDATE_CONFIG
```

---

### 5.3 Redis Cluster 模式

源码：`src/cluster.c`, `src/cluster.h`

**Hash Slot 分配：**

Redis Cluster 将键空间划分为 **16384（`CLUSTER_SLOTS`）个槽**：

```c
/* src/cluster.c */
unsigned int keyHashSlot(char *key, int keylen) {
    /* 支持 hash tag：key 中 {tag} 部分决定槽位 */
    int s = ..., e = ...;  /* 找到第一对 {} */
    if (s != -1 && e != -1 && e != s+1)
        return crc16(key+s+1, e-s-1) & 0x3FFF;  /* 0x3FFF = 16383 */
    return crc16(key, keylen) & 0x3FFF;
}
```

**数据分布示意（3主节点）：**

```
Node A: slots  0 ~ 5460
Node B: slots  5461 ~ 10922
Node C: slots  10923 ~ 16383

SET user:1001 "Alice"
  → crc16("user:1001") & 0x3FFF = 7638 → Node B

SET {user}:1001 "Alice"
SET {user}:1002 "Bob"
  → 都用 crc16("user") → 同一个槽 → 同一节点（多键事务可行）
```

**Gossip 协议（`clusterCron` in cluster.c）：**

```
每秒执行约 10 次（server.hz 基频）：
  1. 随机选 1 个节点发送 PING（附带本节点视角下的部分节点状态）
  2. 超过 cluster-node-timeout / 2 未收到 PONG → 标记 PFAIL（Possible Fail）
  3. 收到其他节点的 PFAIL 报告 → 统计
  4. 达到 quorum 节点都报告 PFAIL → 标记 FAIL，广播 FAIL 消息

clusterCron() 还负责：
  - 处理孤立 master（无 slave 时从其他 master 迁移一个 slave 过来）
  - 更新 clusterState.stats_pfail_nodes 计数
```

**MOVED / ASK 重定向：**

```
客户端: SET foo bar
        │  计算 slot = 12345 → 应该在 Node C，但发给了 Node A
        ▼
Node A → -MOVED 12345 192.168.1.3:6379   ← 永久重定向，客户端更新路由表

迁移中（MIGRATING）：
Node A（源）→ -ASK 12345 192.168.1.3:6379  ← 临时重定向，客户端不更新路由表
客户端 → Node C: ASKING; SET foo bar        ← 必须先发 ASKING 解除 IMPORTING 拦截
```

---

## 6. Redis 事务与 Lua 脚本

### 6.1 MULTI/EXEC 事务

源码：`src/multi.c`

```c
/* src/server.h — client flags */
#define CLIENT_MULTI (1<<3)   /* 客户端处于 MULTI 状态 */
#define CLIENT_DIRTY_CAS (1<<4) /* WATCH 监控的 key 被修改 */
#define CLIENT_DIRTY_EXEC (1<<5) /* 队列中存在语法错误命令 */

/* src/server.h — 命令队列 */
typedef struct multiCmd {
    robj **argv;
    int argc;
    struct redisCommand *cmd;
} multiCmd;

/* client 结构中 */
multiState mstate;  /* 包含 multiCmd *commands 数组和 int count */
```

**MULTI/EXEC 执行流程：**

```
客户端:  MULTI
             │  设置 CLIENT_MULTI flag，清空 mstate
             ▼
客户端:  SET k1 v1
         GET k2
         INCR counter
             │  将三条命令入队 (mstate.commands[])
             │  每条命令回复 +QUEUED
             ▼
客户端:  EXEC
             │
             ├── 检查 CLIENT_DIRTY_CAS → WATCH 冲突 → 返回 nil
             ├── 检查 CLIENT_DIRTY_EXEC → 队列有错误命令 → 返回 EXECABORT
             │
             └── execCommand(client):
                   for each cmd in mstate.commands:
                       call(client, cmd)   ← 按顺序执行
                   清除 CLIENT_MULTI flag
                   返回数组响应（每条命令的结果）
```

**注意：Redis 事务不是原子性（ACID 意义上）**  
执行期间不会回滚：若某条命令执行失败（如类型错误），其他命令仍继续执行。"原子"仅指不被其他客户端命令插入。

---

### 6.2 WATCH 乐观锁

```c
/* src/multi.c */
void watchForKey(client *c, robj *key) {
    /* 在 db->watched_keys 字典中记录：key → 监听它的 client 列表 */
}

void touchWatchedKey(redisDb *db, robj *key) {
    /* 在任何写操作后调用（dbAdd/dbOverwrite/dbDelete 等） */
    /* 遍历 watched_keys[key] 的所有 client，设置 CLIENT_DIRTY_CAS */
}
```

**WATCH 乐观锁工作流程（CAS 模式）：**

```
WATCH key1 key2        ← 注册监控
MULTI
  GET key1
  SET key1 newval
EXEC
  │
  ├── 若 key1 在 WATCH 后被其他客户端修改过
  │     → CLIENT_DIRTY_CAS 已被 touchWatchedKey 设置
  │     → EXEC 返回 nil（事务取消）
  │     → 客户端重试（乐观锁重试模式）
  │
  └── 若 key1 未被修改 → 正常执行事务
```

WATCH 在 EXEC 后（无论成功与否）或 DISCARD 后自动解除。`UNWATCH` 可手动解除所有监控。

---

### 6.3 Lua 脚本原子执行

源码：`src/scripting.c`

```c
/* src/scripting.c — Lua 状态机集成 */
lua_State *lua;       /* server 全局 Lua 虚拟机 */

void evalCommand(client *c) {
    /* argv[1] = script body, argv[2] = numkeys, argv[3..] = keys/args */
    evalGenericCommand(c, 0 /* not evalsha */);
}

void evalGenericCommand(client *c, int evalsha) {
    /* 1. 将 script 编译为 Lua 函数并缓存（SHA1 → function name） */
    /* 2. 设置 redis.call / redis.pcall 回调（调用 luaRedisCallCommand） */
    /* 3. lua_pcall(lua, ...) 执行脚本 */
    /* 4. 将 Lua 返回值转换为 Redis 类型返回给客户端 */
}
```

**原子性保证机制：**

```
Redis 是单线程模型（命令执行阶段）
Lua 脚本执行期间：
  ├── 不会处理其他客户端请求（同一事件循环迭代内完成）
  ├── 不会执行 serverCron 的大部分逻辑
  └── 超时保护：lua-time-limit(5000ms) 超时后
        ├── 其他客户端可以执行 SCRIPT KILL 中断脚本
        └── 只读脚本可以被 KILL，写过数据的脚本不可 KILL（保证一致性）
```

**`redis.call` vs `redis.pcall`：**

```lua
-- redis.call：命令出错直接抛 Lua error，整个脚本终止
local val = redis.call('GET', KEYS[1])

-- redis.pcall：命令出错返回错误表，脚本可以自行处理
local ok, err = pcall(redis.call, 'GET', KEYS[1])
```

**EVALSHA 与脚本缓存（`src/scripting.c`）：**

```
EVAL script numkeys key... arg...
  → 计算 SHA1 = f1c3d... → 缓存 lua_scripts 字典（SHA1 → 脚本）
  → 执行

EVALSHA f1c3d... numkeys key... arg...
  → 直接从缓存取出脚本执行，无需重复传输脚本体

SCRIPT FLUSH → 清空 lua_scripts 缓存
SCRIPT LOAD script → 仅缓存不执行，返回 SHA1
```

---

## 附录：Redis 关键配置速查

| 配置项 | 默认值 | 含义 |
|--------|--------|------|
| `maxmemory` | 0（不限） | 内存上限 |
| `maxmemory-policy` | `noeviction` | 淘汰策略 |
| `maxmemory-samples` | 5 | LRU/LFU 近似采样数 |
| `lfu-log-factor` | 10 | LFU 对数增长因子 |
| `lfu-decay-time` | 1 | LFU 衰减间隔（分钟） |
| `hz` | 10 | serverCron 每秒执行次数 |
| `aof-use-rdb-preamble` | yes | 混合持久化开关 |
| `appendfsync` | everysec | AOF fsync 策略 |
| `repl-backlog-size` | 1MB | 复制积压缓冲区大小 |
| `cluster-node-timeout` | 15000ms | 集群节点超时 |
| `io-threads` | 1（禁用） | 多线程 IO 线程数 |
| `lua-time-limit` | 5000ms | Lua 脚本超时 |
| `list-max-listpack-size` | 128 | list listpack 编码阈值（元素数） |
| `hash-max-listpack-entries` | 128 | hash listpack 编码阈值（字段数） |
| `zset-max-listpack-entries` | 128 | zset listpack 编码阈值（元素数） |
| `set-max-intset-entries` | 512 | set intset 编码阈值（元素数） |
