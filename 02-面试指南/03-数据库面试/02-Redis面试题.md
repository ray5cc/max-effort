# Redis 面试题

> 涵盖 Redis 高频面试考点：数据结构底层实现（SDS/listpack/skiplist/quicklist）、持久化机制（RDB COW/AOF 重写/混合持久化）、内存管理、网络模型、集群与高可用（16384 slots/Gossip/脑裂）、事务与 Lua 脚本、Redlock 争议、布隆过滤器、分布式限流与延迟队列。共 33 道分层题目，适合从初级到高级工程师备战。

## 相关链接

- 对应技术资料：[Redis 核心技术深度解析](../../01-技术资料/03-数据库/02-Redis核心技术.md)

## 目录

1. [⭐ 基础题（熟悉概念）](#1-基础题)
2. [⭐⭐ 进阶题（理解原理）](#2-进阶题)
3. [⭐⭐⭐ 高级题（深度原理 / 源码级）](#3-高级题)
4. [场景题（系统设计）](#4-场景题)
5. [深度补充题（Q23-Q33）](#5-深度补充题q23-q32)—— 数据结构底层 / 持久化 COW / 集群 Gossip / Redlock 争议 / 限流器 / 延迟队列

---

## 🔥 高频考点速记

> 面试中最常被问到的核心知识点，按出现频率排序。建议优先掌握前 5 项。

| #   | 考点                 | 核心要点（一句话）                                                                    | 出题概率 |
| --- | -------------------- | ------------------------------------------------------------------------------------- | -------- |
| 1   | Redis 数据结构与编码 | 5种类型底层7种编码，SDS/ziplist/skiplist                                              | ★★★★★    |
| 2   | Redis 为什么这么快   | 纯内存+单线程避免锁+IO多路复用+高效数据结构                                           | ★★★★★    |
| 3   | 缓存穿透/击穿/雪崩   | 穿透(不存在key)用布隆过滤器，击穿(热key过期)用互斥锁，雪崩(大量key同时过期)设随机过期 | ★★★★★    |
| 4   | 持久化 RDB vs AOF    | RDB快照(fork子进程全量)，AOF日志(append追写)，混合模式                                | ★★★★☆    |
| 5   | 分布式锁             | SET NX EX + Lua原子释放 + Redlock争议                                                 | ★★★★★    |
| 6   | 过期删除与淘汰策略   | 惰性删除+定期采样，8种淘汰(LRU/LFU/TTL/随机)                                          | ★★★★☆    |
| 7   | 主从复制             | PSYNC增量同步(repl_backlog)，全量(RDB传输)                                            | ★★★☆☆    |
| 8   | Cluster 集群         | 16384 hash slot + gossip + MOVED/ASK 重定向                                           | ★★★★☆    |
| 9   | Redis 6.0 多线程 IO  | 主线程+IO线程分工，命令执行仍单线程                                                   | ★★★☆☆    |
| 10  | 大Key/热Key 问题     | SCAN扫描+拆分+本地缓存                                                                | ★★★★☆    |

---

## 1. 基础题

### Q1：Redis 有哪些基本数据类型？各自底层编码是什么？

**答：**

| 数据类型          | 小数据编码          | 大数据编码           |
| ----------------- | ------------------- | -------------------- |
| String            | int / embstr (≤44B) | raw (SDS)            |
| List              | listpack            | quicklist            |
| Hash              | listpack            | hashtable (dict)     |
| Set               | intset（纯整数）    | hashtable (dict)     |
| ZSet (Sorted Set) | listpack            | skiplist + hashtable |

关键点：Redis 会根据元素数量和大小动态切换编码。例如 Hash 在字段数 ≤ 128 且值长度 ≤ 64B 时使用 listpack，超过任一阈值自动升级为 hashtable。

---

### Q2：Redis 为什么快？

**答：**

1. **纯内存操作**：所有数据存在 RAM，读写无磁盘 IO 瓶颈
2. **单线程命令执行**：无锁竞争、无上下文切换开销（命令执行阶段）
3. **IO 多路复用**：单线程用 epoll 管理成千上万并发连接
4. **高效数据结构**：针对不同场景使用最优底层编码（ziplist/listpack/skiplist 等）
5. **非阻塞 IO + 事件驱动**：ae 事件库将网络 IO 和定时任务统一调度

---

### Q3：RDB 和 AOF 的区别是什么？各自适用场景？

**答：**

| 对比项   | RDB                          | AOF                     |
| -------- | ---------------------------- | ----------------------- |
| 数据格式 | 二进制快照                   | 写命令文本（RESP 格式） |
| 数据安全 | 可能丢失最后一次快照后的数据 | `everysec` 最多丢 1 秒  |
| 文件大小 | 小（压缩二进制）             | 大（尤其写命令频繁时）  |
| 恢复速度 | 快（直接加载二进制）         | 慢（需逐条回放命令）    |
| 适用场景 | 定期备份、允许丢分钟级数据   | 对数据安全要求高        |

**推荐**：生产环境开启混合持久化（`aof-use-rdb-preamble yes`），兼顾安全性和恢复速度。

---

### Q4：Redis 支持哪些过期键删除策略？

**答：**

1. **惰性删除（Lazy Expiry）**：访问 key 时调用 `expireIfNeeded()` 检查是否过期，已过期则删除。节省 CPU，但可能造成内存泄漏（从不访问的 key 不会被删除）。
2. **定期主动删除（Active Expiry）**：`serverCron` 调用 `activeExpireCycle()`，定期随机采样带有 expire 的 key，批量删除已过期的 key，防止内存无限增长。

---

### Q5：Redis 有哪些内存淘汰策略？

**答：** 共 8 种，由 `maxmemory-policy` 配置：

- `noeviction`：不淘汰，写操作返回 OOM 错误
- `allkeys-lru`：对所有 key 用近似 LRU 淘汰
- `volatile-lru`：只对设置了 expire 的 key 用近似 LRU 淘汰
- `allkeys-lfu`：对所有 key 用近似 LFU 淘汰
- `volatile-lfu`：只对设置了 expire 的 key 用近似 LFU 淘汰
- `allkeys-random`：随机淘汰任意 key
- `volatile-random`：随机淘汰有 expire 的 key
- `volatile-ttl`：淘汰 TTL 最短的 key

---

### Q6：Redis 的主从复制是如何工作的？

**答：**

1. Slave 连接 Master，发送 `PSYNC <replid> <offset>`
2. 若 offset 在 Master 的复制积压缓冲区（repl_backlog）范围内 → **部分重同步（Partial Resync）**，发送增量数据
3. 否则 → **全量重同步（Full Resync）**：Master fork 子进程生成 RDB，发给 Slave；期间新命令缓存在 `repl_backlog` 中，RDB 传输完后补发
4. 之后 Master 的每条写命令都会实时传播给所有 Slave（命令传播阶段）

---

## 2. 进阶题

### Q7：解释 Redis dict 的渐进式 Rehash 原理

**答：**

Redis 的 dict 包含两个 hashtable（`ht[0]` 和 `ht[1]`）。Rehash 触发条件：

- 扩容：`load factor > 1`（BGSAVE/BGREWRITEAOF 时放宽到 `> 5`）
- 缩容：`load factor < 0.1`

渐进式流程：

1. 分配新的 `ht[1]`（容量为 2 的幂，≥ `ht[0].used * 2`）
2. 设置 `rehashidx = 0`，标志 rehash 开始
3. **每次 CRUD 操作**时，迁移 `ht[0].table[rehashidx]` 整个链表到 `ht[1]`，`rehashidx++`
4. `serverCron` 在空闲时也会批量迁移（最多 1ms 内迁移 100 步）
5. `ht[0].used == 0` 时，交换 `ht[0] = ht[1]`，清空 `ht[1]`

**双表并存期间**：读操作先查 `ht[0]` 再查 `ht[1]`；写操作（新增）只写 `ht[1]`。

---

### Q8：SDS 相比 C 字符串有哪些优势？`__attribute__((__packed__))` 的作用是什么？

**答：**

SDS 优势：

- O(1) 获取长度（`len` 字段，无需 `strlen`）
- 自动扩容 + 空间预分配（`alloc` 字段），避免频繁 realloc
- 二进制安全（以 `len` 计长度，不被 `\0` 截断）
- 5 种头部类型（`sdshdr5/8/16/32/64`），按字符串长度选择最小头部

`__attribute__((__packed__))` 禁止编译器为结构体字段做内存对齐填充，保证 `sdshdr8` 的 `buf[-1]` 精确指向 `flags` 字段，SDS API 通过 `buf[-1]` 做 O(1) 类型判断，无需传递头指针。

---

### Q9：ziplist 的连锁更新（cascade update）是什么？listpack 如何解决这个问题？

**答：**

**ziplist 连锁更新**：每个 entry 用 `prevrawlen` 字段存储前一个 entry 的长度。若前一个 entry 长度从 < 254 增长到 ≥ 254，当前 entry 的 `prevrawlen` 需从 1 字节扩展为 5 字节（+4B）。这可能导致当前 entry 的下一个 entry 也需要扩展，最坏情况 N 个 entry 全部触发 realloc，时间复杂度 O(N²)。

**listpack 解决方案**：每个 lp-entry 尾部存储**自身的总长度**（`backlen`），不再存储前一个 entry 的长度。从尾部向前遍历时，通过 `backlen` 字段定位前一个 entry 的起始位置。任何 entry 的增删改**不会影响其他 entry**，彻底消除连锁更新风险。

---

### Q10：Redis 的近似 LRU 和精确 LRU 有什么区别？Redis 为什么不用精确 LRU？

**答：**

**精确 LRU** 需要维护一个全局 LRU 链表，每次访问需要将 key 移到链表头部，每次淘汰从链表尾部取出。对于 Redis 这种海量 key 场景，维护双向链表的内存开销巨大（每个 key 需要额外 16B 指针），且每次操作需要修改指针（写密集型，CPU cache 不友好）。

**Redis 近似 LRU**（`eviction.c: evictionPoolPopulate`）：

- 每个 robj 有 24 位 `lru` 字段存储最后访问的秒级时间戳
- 淘汰时随机采样 `maxmemory-samples`（默认 5）个 key，插入 16 个元素的候选池
- 从候选池中选 idle time 最长的淘汰

误差可控（samples=10 时近似精度接近精确 LRU），内存零额外开销，性能极高。

---

### Q11：AOF 重写的原理是什么？重写期间主进程如何保证数据不丢？

**答：**

AOF 重写（`BGREWRITEAOF`）目的：压缩 AOF 文件，去除冗余命令（如多次 SET 只保留最后一条）。

流程：

1. 主进程 `fork()` 子进程
2. 子进程遍历内存中所有 db 的 key-value，为每个 key 生成最简命令写入新 AOF 文件
3. **重写期间**，主进程新的写命令同时追加到两个缓冲区：
   - `server.aof_buf`：继续写入旧 AOF 文件（保证旧文件可用）
   - `server.aof_rewrite_buf`：积累增量
4. 子进程完成后，主进程将 `aof_rewrite_buf` 追加到新 AOF 文件
5. `rename()` 原子替换旧文件

这样即使子进程生成快照期间主进程崩溃，旧 AOF 文件仍然完整，保证数据安全。

---

### Q12：Redis Cluster 的 hash slot 是如何计算的？什么是 hash tag？

**答：**

Redis Cluster 将键空间划分为 16384 个槽（`CLUSTER_SLOTS = 16384`）：

```
slot = CRC16(key) & 0x3FFF
```

**Hash tag**：若 key 中包含 `{...}`，只对 `{}` 内的字符串计算 CRC16：

```
SET {user}:1001 "Alice"  → CRC16("user") & 0x3FFF
SET {user}:1002 "Bob"    → CRC16("user") & 0x3FFF  ← 同一个槽！
```

Hash tag 保证相关 key 落在同一节点，使得跨 key 的 MGET/MSET/事务等操作成为可能（同一槽 = 同一节点，无需跨节点协调）。

---

## 3. 高级题

### Q13：Redis 的跳表（skiplist）为什么选 p=0.25 而不是 p=0.5？`span` 字段有什么用？

**答：**

跳表节点层数由 `zslRandomLevel()` 以概率 `p` 决定每层是否晋升：

- `p=0.5`：平均每个节点 2 层，每层平均节点数为 N/2^L，理论 O(log N) 查找
- `p=0.25`：平均每个节点 1.33 层，内存占用减少约 33%，查找仍是 O(log N)，但常数略大

Redis 选 `p=0.25` 是内存效率优先的权衡（Redis 文档注释：`ZSKIPLIST_P = 0.25`，对内存更友好）。

**`span` 字段**：每个 level 的 `forward` 指针附带 `span`，记录从当前节点到 `forward` 节点之间跳过了多少个节点（第 0 层相邻节点 span=1）。`ZRANK` 命令通过累加 span 计算节点排名，时间复杂度 O(log N)；`ZRANGE ... BYSCORE` 也依赖 span 快速定位范围边界。

---

### Q14：Redis 6.0 多线程 IO 的架构是怎样的？为什么命令执行还是单线程？

**答：**

Redis 6.0 的多线程 IO 架构：

- **主线程**：`epoll_wait` 检测可读 fd → 将 client 分配给 IO 线程 → 等待 IO 线程完成 → **单线程执行所有命令** → 将需回复的 client 分配给 IO 线程写回
- **IO 线程**：仅负责 `read()/parse()`（读取并解析请求）和 `write()`（写回响应），不执行任何命令

命令执行保持单线程的原因：

1. Redis 的高性能主要瓶颈在网络 IO，不在命令执行（绝大多数命令 O(1) 或 O(log N)）
2. 单线程执行无需任何数据结构加锁，代码复杂度极低
3. 避免并发命令带来的原子性问题（MULTI/EXEC、Lua 脚本的隔离性依赖单线程）

实测：IO 多线程对读多写少场景吞吐量提升 ~60%-100%（取决于 pipeline 大小和连接数）。

---

### Q15：Sentinel 的 SDOWN/ODOWN 机制，以及 Leader 选举是如何工作的？

**答：**

**SDOWN（主观下线）**：单个 Sentinel 在 `down-after-milliseconds` 内持续收不到 Master 的有效回复（PING 无 PONG、错误响应），将该 Master 标记为 SDOWN。

**ODOWN（客观下线）**：发现 SDOWN 的 Sentinel 向其他 Sentinel 发送 `SENTINEL is-master-down-by-addr` 请求，若收到 `≥ quorum` 个 Sentinel 认同（回复 is_down=1），升级为 ODOWN，触发故障转移流程。

**Leader 选举（类 Raft）**：

1. 检测到 ODOWN 的 Sentinel 在新 `epoch` 中请求其他 Sentinel 投票给自己（发送含自身 `runid` 的 `is-master-down-by-addr`）
2. 每个 Sentinel 在每个 epoch 只投一票（先到先得）
3. 获得 `> N/2 + 1` 票的 Sentinel 成为 Leader，执行 failover：选最优 Slave → `REPLICAOF NO ONE` → 广播新主节点给其他 Slave

---

### Q16：解释 LFU 计数器的对数自增和衰减逻辑，为什么用对数概率而不是线性自增？

**答：**

**对数自增（`LFULogIncr`）**：

```c
double p = 1.0 / (baseval * lfu_log_factor + 1);
if (rand() < p) counter++;
```

`baseval = counter - 5`（初始值 5），`lfu_log_factor` 默认 10。计数器越高，自增概率越小（对数增长）。

**原因**：若线性自增，访问 1 万次的 key 和访问 100 次的 key，计数器差距为 9900，但 8 位计数器只能表示 0~255，很快溢出。对数方案让计数器在 255 范围内区分 `10^(255/10)` ≈ 10^25 量级的访问频率差异，实用范围远超线性方案。

**衰减（`LFUDecrAndReturn`）**：计算从上次访问到现在经过了多少个 `lfu-decay-time` 分钟，每经过一个周期计数器减 1。确保历史热点 key 不永久占据高位，新兴热点能够被淘汰策略识别。

---

### Q17：WATCH + MULTI/EXEC 实现乐观锁的原理，和数据库的乐观锁有何异同？

**答：**

**Redis 实现原理**：

- `WATCH key` → 在 `db->watched_keys[key]` 中记录当前 client
- 任何修改 key 的操作（`dbAdd/dbOverwrite/dbDelete`）→ 调用 `touchWatchedKey()` → 为所有监听该 key 的 client 设置 `CLIENT_DIRTY_CAS` flag
- `EXEC` 执行时检查 `CLIENT_DIRTY_CAS` → 若已设置则返回 nil，事务取消

**与数据库乐观锁对比**：

| 维度         | Redis WATCH                    | 数据库乐观锁（CAS/version） |
| ------------ | ------------------------------ | --------------------------- |
| 冲突检测粒度 | key 级别                       | 行/字段级别                 |
| 版本号       | 隐式（脏标记）                 | 显式 version 字段           |
| 冲突后       | 直接取消事务，客户端重试       | 更新失败，客户端重试        |
| 适用场景     | 低并发冲突场景                 | 低并发冲突场景              |
| ABA 问题     | 存在（key 改回原值仍触发冲突） | 用版本号可解决              |

---

### Q18：Redis 的 CLUSTER 模式下，MOVED 和 ASK 重定向有什么区别？

**答：**

| 重定向               | 触发场景                                   | 客户端处理            | 是否更新路由表             |
| -------------------- | ------------------------------------------ | --------------------- | -------------------------- |
| `MOVED slot ip:port` | slot 永久在目标节点                        | 直接向目标发请求      | **是**，更新本地 slot 路由 |
| `ASK slot ip:port`   | slot 正在迁移中（源节点的这个 key 已迁走） | 先发 ASKING，再发请求 | **否**，临时一次性重定向   |

**ASK 场景细节**：

- 迁移中，源节点标记为 `MIGRATING`，目标节点标记为 `IMPORTING`
- 对已迁移的 key，源节点返回 `-ASK`
- 目标节点的 IMPORTING 状态会拦截正常请求（返回 MOVED 回源节点），但 `ASKING` 命令可解除拦截
- 迁移完成后，slot 归属更新，所有节点恢复正常 MOVED 行为

---

## 4. 场景题

### Q19：如何用 Redis 实现分布式锁？有哪些坑？

**答：**

**基础实现（SET NX + PX）**：

```
SET lock_key unique_value NX PX 30000
```

- `NX`：key 不存在时才设置（获取锁）
- `PX 30000`：30 秒自动过期（防止客户端崩溃后锁不释放）
- `unique_value`：客户端唯一标识，确保只有加锁者能解锁

**解锁（Lua 脚本保证原子性）**：

```lua
if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
else
    return 0
end
```

**主要坑**：

1. **过期时间设置**：业务执行时间 > 锁过期时间 → 锁提前释放 → 并发问题。需加看门狗（watchdog）续期
2. **主从切换**：Master 设置锁后崩溃，Slave 升级为 Master 前锁未同步 → 另一客户端可以加锁（重复加锁）。RedLock 算法（向 N 个独立 Redis 节点加锁，多数成功才算获得锁）可缓解，但有争议
3. **网络分区**：Cluster 模式下需注意 MOVED 重定向对锁可见性的影响

---

### Q20：Redis 实现消息队列有哪些方案？各自优缺点？

**答：**

| 方案                   | 优点                               | 缺点                             | 适用场景       |
| ---------------------- | ---------------------------------- | -------------------------------- | -------------- |
| List（LPUSH/BRPOP）    | 简单，BRPOP 阻塞等待               | 消费后消息丢失，不支持多消费者组 | 简单任务队列   |
| Pub/Sub                | 支持广播，多订阅者                 | 无持久化，消费者离线丢消息       | 实时通知       |
| Sorted Set（延迟队列） | 支持定时任务，按 score(时间戳)排序 | 需轮询，不支持 blocking          | 延迟任务       |
| Stream（Redis 5.0+）   | 持久化、消费组、ACK 确认、历史回溯 | 相对复杂                         | 生产级消息队列 |

**Redis Stream 关键特性**：

- `XADD` 写入消息（自动生成 `timestamp-seq` 格式 ID）
- `XGROUP CREATE` 创建消费组
- `XREADGROUP` 读取消息，消费后需 `XACK` 确认
- `XPENDING` 查看未确认消息，支持 Dead Letter 处理

---

### Q21：你们生产环境 Redis 出现过内存爆满的情况，如何排查和处理？

**答（排查思路）：**

1. **`INFO memory`**：查看 `used_memory_human`（实际使用）、`mem_fragmentation_ratio`（碎片率，> 1.5 说明碎片严重）
2. **`INFO keyspace`**：查看各 db 的 key 数量和带 expire 的 key 数
3. **`redis-cli --bigkeys`**：扫描大 key（可能是没有 expire 的大 list/hash/set）
4. **`OBJECT ENCODING key`**：确认热点 key 的编码（listpack 升级为 hashtable 会大幅增加内存）
5. **`DEBUG SLEEP`** + `MEMORY DOCTOR`：Redis 4.0+ 内置内存分析

**处理方案**：

- **短期**：`maxmemory` + 合适的淘汰策略（`allkeys-lru` 或 `volatile-lru`）
- **中期**：清理大 key（SCAN + DEL，避免 KEYS \* 阻塞），为无 expire 的 key 设置 TTL
- **长期**：数据分片（Cluster）、冷热数据分层（Redis + 持久化存储），合理使用 Hash/Set 代替大量小 key

---

### Q22：Redis 单线程执行模型下，有哪些操作会导致线上阻塞？如何避免？

**答（高危命令及替代方案）：**

| 危险命令                    | 时间复杂度                  | 替代方案                                        |
| --------------------------- | --------------------------- | ----------------------------------------------- |
| `KEYS pattern`              | O(N) 全量扫描               | `SCAN cursor MATCH pattern COUNT 100`（渐进式） |
| `FLUSHDB / FLUSHALL`        | O(N)                        | `FLUSHDB ASYNC`（后台线程异步删除，Redis 4.0+） |
| `DEL` 大 key                | O(N)（集合类型）            | `UNLINK`（异步删除，非阻塞，Redis 4.0+）        |
| `LRANGE 0 -1` 超大 list     | O(N)                        | 分页读取，或使用 Stream                         |
| `SORT` 大集合               | O(N log N)                  | 提前在应用层排序                                |
| `SMEMBERS` 大 set           | O(N)                        | `SSCAN` 渐进式遍历                              |
| AOF `fsync always`          | 每写一次 fsync              | 改为 `everysec`（最多丢 1 秒）                  |
| fork（BGSAVE/BGREWRITEAOF） | 内存越大，fork COW 开销越大 | 控制单实例内存 ≤ 10GB，避免在写高峰触发         |

---

## 5. 深度补充题（Q23-Q32）

> 数据结构底层实现、持久化深度机制、集群架构细节、高并发实战与综合场景设计。

### Q23：SDS（Simple Dynamic String）为什么设计了 sdshdr5/8/16/32/64 五种头部？这和 `__attribute__((__packed__))` 有什么关系？⭐⭐⭐

<details>
<summary>参考答案</summary>

**核心动机**：Redis 存储大量短字符串（如 key 名），SDS 头部大小直接影响内存占用。五种头部根据字符串长度选择最紧凑的表示：

| 类型       | len/alloc 字段大小 | 最大长度       | 头部开销 |
| ---------- | ------------------ | -------------- | -------- |
| sdshdr5    | 不存储（flags 高5位） | 31 字节       | 1 字节   |
| sdshdr8    | uint8_t            | 255 字节       | 3 字节   |
| sdshdr16   | uint16_t           | 64 KB          | 5 字节   |
| sdshdr32   | uint32_t           | 4 GB           | 9 字节   |
| sdshdr64   | uint64_t           | 2^64           | 17 字节  |

**`__attribute__((__packed__))` 的作用**：

```c
struct __attribute__((__packed__)) sdshdr8 {
    uint8_t len;      // 已使用长度
    uint8_t alloc;    // 分配的总长度（不含头部和 \0）
    unsigned char flags; // 低 3 位标识类型
    char buf[];        // 柔性数组，实际数据
};
```

- 取消编译器的结构体对齐填充（padding），确保字段之间没有空隙
- 这样可以通过 `buf[-1]` 直接访问 `flags` 字段，快速判断 SDS 类型
- 如果没有 `packed`，编译器可能在 `len` 和 `alloc` 之间插入填充字节，导致偏移量不可预测

**类比**：像信封分大小号——寄一张名片用小信封（sdshdr5），寄一本书用大信封（sdshdr32）。如果所有信都用最大信封，邮费（内存）会很浪费。

**追问**：sdshdr5 实际在 Redis 中几乎不使用（创建时会升级为 sdshdr8），为什么保留？
→ 历史原因 + 极端内存优化场景下可手动启用；`flags` 字段的低 3 位可以标识 0-4 五种类型，sdshdr5 不存储 len/alloc，而是将长度编码在 flags 的高 5 位中。

</details>

---

### Q24：listpack 的编码格式和 ziplist 有什么本质区别？quicklist 是如何结合两者优势的？⭐⭐⭐

<details>
<summary>参考答案</summary>

**ziplist 的致命缺陷——连锁更新**：

ziplist 每个 entry 的 `prevlen` 字段记录前一个 entry 的长度：
- 前一项 < 254 字节 → `prevlen` 用 1 字节
- 前一项 ≥ 254 字节 → `prevlen` 用 5 字节

当中间插入一个大 entry，后续所有 entry 的 `prevlen` 可能从 1 字节扩展为 5 字节，引发**连锁更新**，最坏 O(N²)。

**listpack 的解决方案**：

```
[total-bytes] [num-elements] [entry1] [entry2] ... [end-byte]

每个 entry:
[encoding-type] [data] [backlen]
                        ↑ 记录自己的长度，而非前一项
```

- `backlen`：记录**当前 entry 自身的总长度**（而非前一个 entry 的长度）
- 反向遍历时：用 `backlen` 回退到自己的起始位置，再减一个 `backlen` 的编码长度到前一个 entry 的末尾
- 关键改进：修改任意 entry 不会影响相邻 entry 的编码，**彻底消除连锁更新**

**quicklist = 双向链表 + listpack（Redis 7.0 前为 ziplist）**：

```
quicklist:
  head → [listpack1] ↔ [listpack2] ↔ [listpack3] → tail

每个节点是一个 quicklistNode：
  - *listpack: 指向一个 listpack
  - count: 该 listpack 中的元素数
  - encoding: RAW 或 LZF 压缩
```

**关键配置参数**：

| 参数                        | 含义                                                    | 推荐值 |
| --------------------------- | ------------------------------------------------------- | ------ |
| `list-max-listpack-size`    | 正数=每个节点最大元素数；负数=-1(4KB)到-5(64KB)的大小限制 | -2(8KB) |
| `list-compress-depth`       | 两端不压缩的节点数（0=不压缩，1=首尾不压缩其余LZF压缩）  | 1      |

**设计思想**：纯 listpack 在元素多时遍历慢（O(N)）；纯链表每个节点都有 prev/next 指针开销。quicklist 取折中——链表提供 O(1) 首尾操作，每个节点内用 listpack 保持内存紧凑。

**追问**：ziplist → listpack 的迁移在 Redis 哪个版本完成？
→ Redis 7.0。Hash/ZSet 的小数据编码从 ziplist 改为 listpack；List 类型底层早已使用 quicklist，7.0 后 quicklist 内部节点也从 ziplist 换为 listpack。

</details>

---

### Q25：跳表（skiplist）的概率分析——为什么 Redis 选 p=0.25？期望层高和空间复杂度的推导过程是什么？⭐⭐⭐

<details>
<summary>参考答案</summary>

**跳表的层级构建**：

每个新节点插入时，随机决定层高：以概率 p 升一层，以概率 (1-p) 停止。

```c
// Redis 源码 t_zset.c
int zslRandomLevel(void) {
    int level = 1;
    while ((random() & 0xFFFF) < (ZSKIPLIST_P * 0xFFFF))
        level += 1;
    return (level < ZSKIPLIST_MAXLEVEL) ? level : ZSKIPLIST_MAXLEVEL;
}
// ZSKIPLIST_P = 0.25, ZSKIPLIST_MAXLEVEL = 32
```

**期望层高推导**：

节点层高为 k 的概率：P(level = k) = p^(k-1) × (1-p)

期望层高 = Σ(k=1→∞) k × p^(k-1) × (1-p) = **1 / (1-p)**

- p = 0.5 → 期望层高 = 2
- p = 0.25 → 期望层高 = 1.33

**空间开销分析**：

每个节点平均指针数 = 1/(1-p)
- p = 0.5 → 平均 2 个指针/节点（额外空间 = 原始数据的 2 倍）
- p = 0.25 → 平均 1.33 个指针/节点（额外空间 = 原始数据的 1.33 倍）

**为什么选 p=0.25 而不是 p=0.5**：

| 指标       | p=0.25          | p=0.5           |
| ---------- | --------------- | --------------- |
| 期望层高   | 1.33            | 2.0             |
| 额外空间   | 33%             | 100%            |
| 查找比较次数 | (log₄n)/2 + 1/(1-p) ≈ 略多 | (log₂n)/2 + 1/(1-p) |
| 实际性能   | 接近平衡树      | 略优但不明显    |

p=0.25 用微小的查找性能代价，换来了**约 50% 的内存节省**。对于 Redis 这样的内存数据库，这是最优权衡。

**最大层高 32 的数学依据**：

P(层高 > 32) = 0.25^32 = 2^(-64) ≈ 5.4 × 10^(-20)

即使有 2^64 个元素（远超任何实际场景），期望中也只有约 1 个节点达到 32 层。所以 32 层的上限足够覆盖任意规模数据。

**追问**：跳表的 span 字段有什么用？
→ 每一层的前进指针都记录了 `span`（跨越的节点数），用于 O(log n) 计算元素的排名（rank）。`ZRANK` 命令就是沿着查找路径累加各层 span。

</details>

---

### Q26：AOF 重写的 fork + COW 机制详解：重写期间的写命令如何保证不丢？RDB 的 fork 与 AOF 重写的 fork 有何区别？混合持久化的文件格式是怎样的？⭐⭐⭐

<details>
<summary>参考答案</summary>

**AOF 重写的完整流程**：

```
主进程                              子进程
  │                                   │
  ├─ fork() ──────────────────────►  │ 子进程获得内存快照（COW 共享页）
  │                                   │ 遍历数据库，将当前数据写成新 AOF
  │                                   │
  ├─ 继续处理客户端命令                │
  │   写入：① 旧 AOF 文件             │
  │         ② AOF 重写缓冲区          │
  │                                   │
  │                                   ├─ 写完新 AOF 文件
  │ ◄─ 通知主进程 ─────────────────── │
  │                                   │
  ├─ 将 AOF 重写缓冲区追加到新 AOF     │
  ├─ 原子替换旧 AOF 文件               │
  └─ 完成                             └─ 子进程退出
```

**COW（Copy-On-Write）机制**：

- fork 时不复制物理内存，父子进程共享相同的内存页（只复制页表，非常快）
- 当主进程修改某个内存页时，操作系统才复制该页（写时复制）
- 因此 fork 的内存开销 ≈ 被修改的页数 × 4KB（页大小），而非全部数据

**实际影响**：

```bash
# 关闭 Transparent Huge Pages（THP），避免 COW 粒度从 4KB 变为 2MB
echo never > /sys/kernel/mm/transparent_hugepage/enabled

# 设置 vm.overcommit_memory = 1，允许 fork 即使内存不足
sysctl vm.overcommit_memory=1
```

**RDB fork vs AOF 重写 fork 的区别**：

| 对比项         | RDB (BGSAVE)                 | AOF 重写 (BGREWRITEAOF)         |
| -------------- | ---------------------------- | -------------------------------- |
| 子进程做什么   | 将内存数据序列化为 RDB 二进制格式 | 将内存数据转写为 AOF 命令文本     |
| 写入内容       | 紧凑二进制                    | Redis 命令序列                    |
| 重写缓冲区     | 不需要                        | 需要（重写期间的增量命令）         |
| 文件体积       | 小                            | 大（但比旧 AOF 小，去除了冗余命令）|
| 恢复速度       | 快（直接加载二进制）           | 慢（逐条重放命令）                |

**混合持久化（Redis 4.0+，`aof-use-rdb-preamble yes`）**：

```
混合 AOF 文件格式：
┌─────────────────────┐
│   RDB 二进制数据     │  ← 子进程 fork 时的全量快照
├─────────────────────┤
│   AOF 增量命令       │  ← 重写期间主进程接收的新命令
└─────────────────────┘
```

- 恢复时：先加载 RDB 部分（快），再重放 AOF 增量部分（少量命令）
- 兼顾了 RDB 的恢复速度和 AOF 的数据安全性
- 文件头部有 `REDIS` 魔数标识 RDB 部分

**追问**：fork 期间如果写入量很大，COW 会导致内存翻倍吗？
→ 理论上最坏情况是全部页被修改，内存翻倍。实际中，生产环境应控制单实例内存 ≤ 10GB，并避免在写高峰触发 BGSAVE/BGREWRITEAOF。可通过 `INFO persistence` 的 `latest_fork_usec` 监控 fork 耗时。

</details>

---

### Q27：Redis Cluster 为什么是 16384 个 slot 而不是 65536？Gossip 协议如何传播集群状态？脑裂场景下如何防止数据丢失？⭐⭐⭐

<details>
<summary>参考答案</summary>

**为什么是 16384 个 slot**：

Antirez（Redis 作者）在 GitHub issue 中给出了明确理由：

1. **Gossip 消息大小**：每个节点在心跳包中携带自己负责的 slot 位图
   - 16384 slots → 位图 = 16384/8 = **2KB**
   - 65536 slots → 位图 = 65536/8 = **8KB**
   - 集群节点间高频交换心跳（每秒多次），2KB 比 8KB 节省大量带宽

2. **集群规模上限**：Redis 官方建议集群不超过 1000 个节点
   - 16384 / 1000 ≈ 16 个 slot/节点，粒度足够
   - 如果只有 3 个主节点，每个负责 ~5461 个 slot，完全够用

3. **slot 迁移粒度**：slot 数越多，单个 slot 包含的 key 越少，迁移更细粒度。但 16384 已经足够细。

**Gossip 协议工作机制**：

```
节点 A 每秒随机选择若干节点发送 PING 消息：
┌──────────────────────────────────┐
│ PING 消息内容：                    │
│  - 发送者的 clusterState          │
│  - 发送者已知的部分节点信息        │
│    (随机选择一些节点的 IP/Port/    │
│     状态/负责的 slots)            │
│  - 发送者自己负责的 slots 位图     │
└──────────────────────────────────┘
         │
         ▼
节点 B 收到 PING 后回复 PONG（格式相同）
         │
         ▼
节点 B 根据收到的信息更新自己的 clusterState：
  - 发现新节点 → 记录
  - 发现 slot 归属变化 → 更新映射表
  - 发现节点失联 → 标记 PFAIL
```

**状态传播的关键机制**：

| 机制   | 说明                                                     |
| ------ | -------------------------------------------------------- |
| PFAIL  | 单个节点认为某节点下线（Possible Fail）                  |
| FAIL   | 超过半数主节点在 `cluster-node-timeout` 内报告 PFAIL → 标记为 FAIL |
| Epoch  | 每次配置变更（如 failover）递增 configEpoch，版本大的覆盖小的 |

**脑裂（Split-Brain）防护**：

脑裂场景：网络分区导致少数派主节点与多数派隔离，少数派继续接受写入 → 分区恢复后数据冲突。

**防护配置**：

```bash
# 当主节点发现自己连接的从节点数 < min-replicas-to-write 时，拒绝写入
min-replicas-to-write 1
# 从节点必须在 min-replicas-max-lag 秒内有过 ACK
min-replicas-max-lag 10
```

**原理**：少数派分区中的主节点失去所有从节点连接，因不满足 `min-replicas-to-write` 条件而拒绝写入。这样即使脑裂，少数派不会产生脏数据。代价是在主从全部断开时写入不可用（选择 CP 而非 AP）。

**追问**：Cluster 模式下如何实现跨 slot 的事务？
→ 使用 Hash Tag：将相关 key 放在 `{tag}` 中，如 `user:{1001}:name` 和 `user:{1001}:age`，CRC16 只计算 `{1001}` 部分，保证落在同一个 slot，从而支持 MULTI/EXEC 事务和 Lua 脚本。

</details>

---

### Q28：Pipeline、MULTI/EXEC 事务、Lua 脚本三者在"原子性"上有什么区别？各自适用什么场景？⭐⭐⭐

<details>
<summary>参考答案</summary>

**三者对比**：

| 特性         | Pipeline                | MULTI/EXEC 事务           | Lua 脚本                   |
| ------------ | ----------------------- | ------------------------- | -------------------------- |
| 原子性       | ❌ 无                   | ⚠️ 弱（不支持回滚）      | ✅ 强（单线程串行执行）    |
| 隔离性       | ❌ 命令间可被插入       | ✅ EXEC 后命令连续执行     | ✅ 执行期间不会被打断      |
| 回滚         | ❌                      | ❌ 部分失败不回滚         | ❌（但可以通过逻辑控制）    |
| 网络优化     | ✅ 批量发送减少 RTT     | ⚠️ 需逐条发送 QUEUED     | ✅ 一次发送脚本            |
| 条件逻辑     | ❌ 不能根据中间结果分支 | ❌ QUEUED 后不能修改      | ✅ 完整的 if/else/loop     |
| Cluster 兼容 | ✅（同 slot）           | ✅（同 slot）             | ✅（同 slot + EVALSHA）    |

**Pipeline 详解**：

```python
# Pipeline 只是客户端层面的批量发送，不保证原子性
pipe = redis.pipeline(transaction=False)
pipe.set("a", 1)
pipe.set("b", 2)
pipe.incr("a")
results = pipe.execute()  # 一次性发送 3 条命令，减少 3 次 RTT 为 1 次
```

- 适用场景：批量读写无依赖关系的 key，追求吞吐量（如批量导入数据）
- 注意：Pipeline 中每条命令独立执行，中间可能被其他客户端的命令插入

**MULTI/EXEC 事务**：

```redis
WATCH balance           # 乐观锁：监视 key
MULTI                   # 开始事务，后续命令入队
DECRBY balance 100      # QUEUED（不立即执行）
INCRBY target 100       # QUEUED
EXEC                    # 原子执行所有 QUEUED 命令
                        # 如果 balance 在 WATCH 后被修改，EXEC 返回 nil（事务失败）
```

- 不支持回滚：如果 INCRBY 的 key 类型错误，DECRBY 已经执行的不会撤销
- Redis 作者认为：事务中的错误是编程 bug，不应该在生产中依赖回滚

**Lua 脚本**：

```lua
-- 原子性扣减库存：检查 + 扣减在一个脚本中
local stock = tonumber(redis.call('GET', KEYS[1]))
if stock and stock >= tonumber(ARGV[1]) then
    redis.call('DECRBY', KEYS[1], ARGV[1])
    return 1  -- 扣减成功
else
    return 0  -- 库存不足
end
```

```bash
EVALSHA <sha1> 1 product:stock:1001 5
```

- **为什么是原子的**：Redis 单线程执行模型，Lua 脚本执行期间不会处理其他客户端命令
- **风险**：长时间运行的 Lua 脚本会阻塞整个 Redis（默认 `lua-time-limit 5000`ms 后可被 `SCRIPT KILL` 中断，但如果脚本已执行写操作则只能 `SHUTDOWN NOSAVE`）
- 适用场景：需要"读-判断-写"原子操作的业务逻辑（如库存扣减、限流计数）

**追问**：Redis 7.0 的 Function 和 EVAL 有什么区别？
→ Function 通过 `FUNCTION LOAD` 持久化注册到 Redis 服务器端，重启后仍存在，且支持 AOF/RDB 持久化。EVAL 每次都需要传脚本文本（EVALSHA 需要客户端预加载）。Function 是 Lua 脚本的生产级替代。

</details>

---

### Q29：Redlock 算法的工作流程是什么？Martin Kleppmann 的批评和 Antirez 的回应分别是什么观点？生产中你会怎么选？⭐⭐⭐

<details>
<summary>参考答案</summary>

**Redlock 算法流程**（需要 N 个独立 Redis 实例，通常 N=5）：

```
客户端获取锁：
1. 记录当前时间 T1
2. 依次向 N 个 Redis 实例发送 SET key value NX PX ttl
3. 记录当前时间 T2
4. 如果满足以下两个条件，则认为获取锁成功：
   a. 成功获取锁的实例数 ≥ N/2 + 1（多数派）
   b. 总耗时 (T2 - T1) < 锁的 TTL
5. 实际锁的有效时间 = TTL - (T2 - T1)
6. 如果获取失败，向所有实例发送 DEL 释放锁
```

**Martin Kleppmann 的批评（"How to do distributed locking"）**：

1. **GC 暂停问题**：客户端获取锁后发生 Full GC（或进程暂停），锁在 GC 期间过期，另一个客户端获取了同一把锁 → 两个客户端同时持有锁

```
Client A: 获取锁 → [Full GC 30秒] → 以为还持有锁 → 写数据
                     ↑ 锁已过期
Client B:           获取锁 → 写数据 → 数据冲突！
```

2. **时钟跳变问题**：Redlock 依赖各节点的时钟大致同步。如果某个节点时钟突然跳变（NTP 校准），锁可能提前过期。

3. **根本观点**：分布式锁分两类用途——
   - **效率锁**（避免重复工作）：单节点 Redis 锁就够了，不需要 Redlock
   - **正确性锁**（保证数据安全）：Redlock 不够安全，应该用 ZooKeeper/etcd + fencing token

**Antirez 的回应（"Is Redlock safe?"）**：

1. **GC 问题被夸大**：合理设置 TTL + watchdog 续期可以缓解
2. **时钟跳变是可控的**：禁用 NTP step mode，改用 slew mode（渐进式调整）
3. **Redlock 不需要精确时钟同步**：只需要各节点的"时钟漂移率"在合理范围内

**生产建议**：

```
┌──────────────────┬──────────────────────────────────┐
│ 场景             │ 推荐方案                         │
├──────────────────┼──────────────────────────────────┤
│ 幂等性保护       │ 单节点 Redis + SET NX PX         │
│ （重复执行无害） │ + 看门狗续期（如 Redisson）       │
├──────────────────┼──────────────────────────────────┤
│ 金融级互斥       │ etcd/ZooKeeper + fencing token   │
│ （不容许重复执行）│ （共识协议保证，非时钟依赖）     │
├──────────────────┼──────────────────────────────────┤
│ 跨数据中心       │ etcd（Raft 协议原生支持）        │
│                  │ 不推荐 Redlock（网络延迟加剧问题）│
└──────────────────┴──────────────────────────────────┘
```

**追问**：什么是 fencing token？
→ 锁服务每次授锁时返回一个单调递增的 token（如 ZooKeeper 的 zxid）。客户端访问共享资源时必须携带 token，资源端（如数据库）拒绝比已见过的更小的 token。即使旧客户端的锁过期后才来写入，资源端也会因为 token 过旧而拒绝。

</details>

---

### Q30：Redis 的布隆过滤器（Bloom Filter）原理是什么？误判率公式如何推导？热 Key 问题和 singleflight 模式如何解决？⭐⭐⭐

<details>
<summary>参考答案</summary>

**布隆过滤器原理**：

```
添加元素 x：
  hash1(x) % m → 置位 bit[i1] = 1
  hash2(x) % m → 置位 bit[i2] = 1
  ...
  hashk(x) % m → 置位 bit[ik] = 1

查询元素 y：
  检查 bit[hash1(y)%m], bit[hash2(y)%m], ..., bit[hashk(y)%m]
  全部为 1 → "可能存在"（可能误判）
  任一为 0 → "一定不存在"（绝无漏判）
```

**误判率公式推导**：

- m 位的位数组，k 个哈希函数，n 个已插入元素
- 某一位在一次哈希后仍为 0 的概率：(1 - 1/m)
- 插入 n 个元素后（共 kn 次哈希）仍为 0：(1 - 1/m)^(kn) ≈ e^(-kn/m)
- 误判率 = 所有 k 位都为 1的概率：**p = (1 - e^(-kn/m))^k**
- 最优 k = (m/n) × ln2 ≈ 0.693 × (m/n)

**实际工程中的使用（Redis Bloom Module）**：

```bash
# 创建：误判率 0.01，预期元素数 100 万
BF.RESERVE user_filter 0.01 1000000
# 添加
BF.ADD user_filter "user:1001"
# 查询
BF.EXISTS user_filter "user:9999"  # → 0（一定不存在）
```

应用：缓存穿透防护——查询 Redis 前先过 Bloom Filter，不存在的 key 直接拦截。

**热 Key 问题**：

大量请求集中访问少数几个 key（如秒杀商品），导致单个 Redis 节点压力过大。

**解决方案矩阵**：

| 方案             | 原理                                                     | 适用场景      |
| ---------------- | -------------------------------------------------------- | ------------- |
| 本地缓存         | 应用进程内缓存热 key 值（如 Caffeine/Guava Cache）        | 读多写少      |
| key 分散         | 将 `hot_key` 拆分为 `hot_key:1` ~ `hot_key:N`，随机读取 | 读多写少      |
| singleflight     | 同一进程内多个 goroutine 请求同一 key 时，只放行一个       | 缓存击穿防护  |
| 读写分离         | 从节点承担读流量                                          | 读 QPS 极高   |

**singleflight 模式详解**：

```go
import "golang.org/x/sync/singleflight"

var g singleflight.Group

func GetData(key string) (interface{}, error) {
    // 相同 key 的并发请求只执行一次 fn，其余等待结果
    v, err, shared := g.Do(key, func() (interface{}, error) {
        // 只有第一个请求会执行这里
        val, err := redis.Get(key)
        if err == redis.Nil {
            val, err = db.Query(key)
            redis.Set(key, val, 5*time.Minute)
        }
        return val, err
    })
    // shared=true 表示结果来自另一个并发调用的共享
    return v, err
}
```

**追问**：布隆过滤器不支持删除怎么办？
→ 使用 **Cuckoo Filter**（Redis 的 `CF.*` 命令），支持删除操作，且在元素数较少时空间效率更高。或用 **Counting Bloom Filter**（每个位用计数器替代，但空间开销 ×4）。

</details>

---

### Q31：【场景题】设计一个支持亿级用户的实时排行榜系统，要求：实时更新分数、查询 Top-N、查询用户排名、查询附近排名用户。⭐⭐⭐

<details>
<summary>参考答案</summary>

**核心数据结构：Redis Sorted Set**

```bash
# 更新分数（O(log n)）
ZADD leaderboard 9500 "user:1001"

# 查询 Top-10（O(log n + 10)）
ZREVRANGE leaderboard 0 9 WITHSCORES

# 查询用户排名（O(log n)，0-based）
ZREVRANK leaderboard "user:1001"

# 查询用户分数
ZSCORE leaderboard "user:1001"

# 查询某用户附近的排名（前后各 5 名）
# 先获取排名 rank，再 ZREVRANGE rank-5 rank+5
```

**亿级用户的分片策略**：

单个 Sorted Set 存 1 亿用户，内存约 1 亿 × (member + score) ≈ 数 GB，单实例可以承受但 QPS 有瓶颈。

```
方案一：分段排行榜
  ┌──────────────────────────────────────┐
  │ 第一层：100 个分片（按 user_id hash） │
  │ 每个分片 100 万用户                   │
  │ 各分片独立 Sorted Set                 │
  └──────────────────────────────────────┘
  ┌──────────────────────────────────────┐
  │ 第二层：全局 Top-K 合并              │
  │ 每个分片定期推送 Top-1000 到汇总 Set  │
  │ 汇总 Set 维护全局 Top-N              │
  └──────────────────────────────────────┘

方案二：按分数段分桶（适合查排名）
  桶1：分数 90000-100000 → sorted set
  桶2：分数 80000-90000  → sorted set
  ...
  用户排名 = 高分桶总人数 + 本桶内排名
```

**并列排名处理**：

```bash
# 将 score 编码为：实际分数 × 10^10 + (MAX_TIMESTAMP - 达到该分数的时间戳)
# 分数相同时，先达到的 timestamp 更早 → 编码后 score 更大 → 排名靠前
ZADD leaderboard 95000000001699000000 "user:1001"
```

**多维度排行榜**：

```bash
# 日/周/月排行榜
ZADD leaderboard:daily:2024-01-15 score user
ZADD leaderboard:weekly:2024-W03 score user
ZADD leaderboard:monthly:2024-01 score user

# 利用 ZUNIONSTORE 合并多日数据生成周排行
ZUNIONSTORE leaderboard:weekly:2024-W03 7 \
  leaderboard:daily:2024-01-15 \
  leaderboard:daily:2024-01-16 \
  ... AGGREGATE SUM
```

**追问链**：

1. **如何处理分数频繁更新**？→ 客户端本地缓存 + 批量合并（每 100ms 一次 ZADD），减少 Redis 写入次数
2. **排行榜需要持久化吗**？→ 分数来源（如游戏服务器）是真实数据源，排行榜是衍生数据，可以从源数据重建。但为了快速恢复，建议 RDB 快照
3. **全球多区域怎么做**？→ 每个区域独立排行榜 + 全球汇总服务定期合并 Top-K

</details>

---

### Q32：【场景题】用 Redis 实现三种分布式限流器：固定窗口、滑动窗口、令牌桶。分析各自的优缺点和 Lua 脚本实现。⭐⭐⭐

<details>
<summary>参考答案</summary>

**方案一：固定窗口计数器**

```lua
-- KEYS[1] = 限流 key，ARGV[1] = 限额，ARGV[2] = 窗口大小（秒）
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])

local current = tonumber(redis.call('GET', key) or "0")
if current >= limit then
    return 0  -- 限流
end
if current == 0 then
    redis.call('SET', key, 1, 'EX', window)
else
    redis.call('INCR', key)
end
return 1  -- 放行
```

- ✅ 简单高效，O(1) 操作
- ❌ **临界点突刺**：窗口 [0:00-1:00] 结尾集中 100 请求 + 窗口 [1:00-2:00] 开头集中 100 请求 → 1 秒内实际承受 200 请求

**方案二：滑动窗口（Sorted Set）**

```lua
-- KEYS[1] = 限流 key
-- ARGV[1] = 限额, ARGV[2] = 窗口大小(毫秒), ARGV[3] = 当前时间戳(毫秒), ARGV[4] = 唯一请求ID
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local request_id = ARGV[4]

-- 移除窗口外的旧请求
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)

-- 统计当前窗口内的请求数
local count = redis.call('ZCARD', key)

if count >= limit then
    return 0  -- 限流
end

-- 添加当前请求（score = 时间戳, member = 唯一ID）
redis.call('ZADD', key, now, request_id)
redis.call('PEXPIRE', key, window)
return 1  -- 放行
```

- ✅ 无临界点突刺，精确限流
- ❌ 每个请求存一条记录，高 QPS 下内存开销大（百万 QPS → 窗口内百万条记录）

**方案三：令牌桶（Token Bucket）**

```lua
-- KEYS[1] = 桶 key
-- ARGV[1] = 桶容量, ARGV[2] = 每秒产生令牌数, ARGV[3] = 当前时间戳(秒), ARGV[4] = 请求令牌数
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])

-- 获取桶状态
local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(bucket[1])
local last_refill = tonumber(bucket[2])

if tokens == nil then
    -- 初始化：满桶
    tokens = capacity
    last_refill = now
end

-- 计算自上次填充以来产生的令牌
local elapsed = math.max(0, now - last_refill)
tokens = math.min(capacity, tokens + elapsed * rate)
last_refill = now

if tokens >= requested then
    tokens = tokens - requested
    redis.call('HMSET', key, 'tokens', tokens, 'last_refill', last_refill)
    redis.call('EXPIRE', key, capacity / rate * 2)  -- 过期时间 = 填满桶的两倍时间
    return 1  -- 放行
else
    redis.call('HMSET', key, 'tokens', tokens, 'last_refill', last_refill)
    redis.call('EXPIRE', key, capacity / rate * 2)
    return 0  -- 限流
end
```

- ✅ 允许突发流量（桶内有积累的令牌），平滑限流
- ✅ 只存两个字段（tokens + last_refill），内存开销极小
- ❌ 实现相对复杂

**三种方案对比**：

| 方案       | 精确度 | 内存 | 突发支持 | 实现复杂度 | 推荐场景               |
| ---------- | ------ | ---- | -------- | ---------- | ---------------------- |
| 固定窗口   | 低     | O(1) | ❌       | 简单       | 粗粒度限流（如日配额）   |
| 滑动窗口   | 高     | O(N) | ❌       | 中等       | 精确计数限流（如 API 限频）|
| 令牌桶     | 中     | O(1) | ✅       | 较高       | 平滑限流 + 允许突发      |

**追问链**：

1. **分布式多节点限流如何保证全局一致**？→ 所有节点共用同一个 Redis key，Lua 脚本保证原子性
2. **Redis 不可用时如何降级**？→ 本地进程内限流（如 Go 的 `golang.org/x/time/rate`）+ 允许少量超限（宁可放行也不完全拒绝）
3. **漏桶（Leaky Bucket）和令牌桶的区别**？→ 漏桶以固定速率处理请求（不允许突发），令牌桶允许突发（桶内令牌可累积）。漏桶适合"严格匀速"场景（如音视频流控）。

</details>

---

### Q33：【场景题】设计一个基于 Redis 的延迟队列，支持：延迟投递、精确触发、失败重试、死信队列。⭐⭐⭐

<details>
<summary>参考答案</summary>

**核心思路：Sorted Set + Stream**

```
Sorted Set（delay_queue）：score = 触发时间戳，member = 消息ID
Hash（msg:{id}）：存储消息体和元数据
Stream（processing）：正在处理的消息（可选，用于 ACK 机制）
```

**整体架构**：

```
生产者                     Redis                        消费者
  │                          │                            │
  ├─ ZADD delay_queue        │                            │
  │  score=now+delay         │                            │
  │  member=msg_id           │                            │
  ├─ HSET msg:{id}           │                            │
  │  body/retry/created      │                            │
  │                          │                            │
  │                     [调度器轮询]                       │
  │                          │                            │
  │                          ├─ ZRANGEBYSCORE              │
  │                          │  delay_queue 0 now          │
  │                          │  LIMIT 0 100                │
  │                          │                            │
  │                          ├─ 到期消息 ──────────────► │ 处理
  │                          │  XADD processing           │
  │                          │  ZREM delay_queue           │
  │                          │                            │
  │                          │                ◄──────────── │ XACK
  │                          │                            │
```

**调度器核心逻辑（Lua 脚本保证原子性）**：

```lua
-- 获取并转移到期消息
local msgs = redis.call('ZRANGEBYSCORE', KEYS[1], '0', ARGV[1], 'LIMIT', 0, 100)
if #msgs == 0 then
    return 0
end
for i, msg_id in ipairs(msgs) do
    -- 转移到处理队列
    redis.call('XADD', KEYS[2], '*', 'msg_id', msg_id)
    redis.call('ZREM', KEYS[1], msg_id)
end
return #msgs
```

**失败重试机制**：

```python
MAX_RETRY = 3

def process_message(msg_id):
    msg = redis.hgetall(f"msg:{msg_id}")
    retry_count = int(msg.get("retry", 0))

    try:
        do_business_logic(msg["body"])
        redis.delete(f"msg:{msg_id}")  # 成功，清理
    except Exception as e:
        if retry_count < MAX_RETRY:
            # 指数退避重试：1s, 4s, 9s
            delay = (retry_count + 1) ** 2
            redis.hset(f"msg:{msg_id}", "retry", retry_count + 1)
            redis.zadd("delay_queue", {msg_id: time.time() + delay})
        else:
            # 超过重试次数 → 进入死信队列
            redis.xadd("dead_letter_queue", {"msg_id": msg_id, "error": str(e)})
            redis.expire(f"msg:{msg_id}", 7 * 86400)  # 保留 7 天供排查
```

**关键设计细节**：

| 问题               | 解决方案                                                                |
| ------------------ | ----------------------------------------------------------------------- |
| 消息重复消费       | 消费者处理前用 `SET msg:{id}:lock NX EX 60` 加锁                       |
| 调度器单点故障     | 多实例调度器 + 分布式锁竞争 + 只有获取锁的实例执行 ZRANGEBYSCORE       |
| 轮询空转浪费 CPU   | 空轮询时 `BLPOP` 或 `sleep(100ms)` + 指数退避                          |
| 消息堆积           | 监控 ZCARD(delay_queue)，超过阈值告警；消费者水平扩展                   |
| 时间精度           | 调度器轮询间隔决定精度（100ms 轮询 ≈ 100ms 误差），可接受大部分场景     |

**与专业消息队列对比**：

| 特性         | Redis 延迟队列         | RabbitMQ (delayed-exchange)  | Kafka (时间轮)      |
| ------------ | ---------------------- | ---------------------------- | ------------------- |
| 延迟精度     | ~100ms                 | ~1s                          | ~1s                 |
| 消息持久化   | 依赖 AOF/RDB           | 原生支持                      | 原生支持            |
| 吞吐量       | 万级/s                  | 万级/s                        | 十万级/s            |
| 运维复杂度   | 低（复用已有 Redis）     | 中                            | 高                  |
| 推荐规模     | < 100 万消息/天         | < 1000 万消息/天               | 海量                |

**追问链**：

1. **为什么不直接用 Redis 的 key 过期通知（keyspace notification）做延迟队列？**
   → `__keyevent@0__:expired` 通知不可靠：Redis 的过期是惰性+定期采样，不保证精确时间触发；且通知是 fire-and-forget，消费者离线时消息丢失
2. **为什么不用 Redis Stream 的 XAUTOCLAIM 替代手动重试？**
   → 可以。`XAUTOCLAIM` 在 Redis 6.2+ 支持自动认领超时未 ACK 的消息，简化了重试逻辑。但延迟投递（定时触发）仍需 Sorted Set

</details>
