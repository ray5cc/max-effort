# Redis 面试题

> 涵盖 Redis 高频面试考点：数据结构底层实现、持久化机制、内存管理、网络模型、集群与高可用、事务与 Lua 脚本。按难度分层，适合从初级到高级工程师备战。

## 相关链接

- 对应技术资料：[Redis 核心技术深度解析](../../01-技术资料/03-数据库/02-Redis核心技术.md)

## 目录

1. [⭐ 基础题（熟悉概念）](#1-基础题)
2. [⭐⭐ 进阶题（理解原理）](#2-进阶题)
3. [⭐⭐⭐ 高级题（深度原理 / 源码级）](#3-高级题)
4. [场景题（系统设计）](#4-场景题)

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
