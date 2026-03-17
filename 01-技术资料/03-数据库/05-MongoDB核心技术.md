# MongoDB 核心技术

> MongoDB 是最有代表性的文档数据库之一。理解它，不只是记住 BSON、Replica Set、Sharding 这些名词，而是要真正看懂：为什么文档模型会在某些场景比关系模型更顺手，MongoDB 如何用 WiredTiger、oplog、chunk、查询规划器和事务能力，把“灵活”变成一套可落地的工程系统。

## 相关链接

- 对应面试题：[MongoDB 面试题](../../../02-面试指南/03-数据库面试/05-MongoDB面试题.md)

## 目录

1. [为什么需要文档数据库](#1-为什么需要文档数据库)
2. [文档模型与 BSON](#2-文档模型与-bson)
3. [集合、索引与查询入口](#3-集合索引与查询入口)
4. [存储引擎与内部架构](#4-存储引擎与内部架构)
5. [读写流程与查询规划器](#5-读写流程与查询规划器)
6. [复制集、oplog 与高可用](#6-复制集oplog-与高可用)
7. [分片、Chunk 与 Balancer](#7-分片chunk-与-balancer)
8. [一致性、读写关注与事务](#8-一致性读写关注与事务)
9. [Schema 设计：Embedding vs Referencing](#9-schema-设计embedding-vs-referencing)
10. [聚合管道](#10-聚合管道)
11. [实战案例](#11-实战案例)
12. [性能调优](#12-性能调优)
13. [常见陷阱与最佳实践](#13-常见陷阱与最佳实践)
14. [MongoDB 7/8 时代实践备注](#14-mongodb-78-时代实践备注)

---

## 1. 为什么需要文档数据库

很多工程师第一次接触 MongoDB 时，容易把它理解成“没有表结构的 JSON 数据库”。这个说法不算错，但太浅。

真正的问题是：

当业务对象本身就是“一个可以自然聚合在一起的对象”时，关系型数据库把它拆成很多表，再靠 join 拼起来，未必总是最顺手。

一个很直观的类比：

- 关系型数据库像把一家公司的信息拆进很多 Excel 表，再通过员工编号、部门编号做关联。
- 文档数据库像给每个员工建一份完整档案袋，档案袋里直接放个人信息、联系方式、当前部门、最近几次绩效记录。

如果你的读取模式就是“按人拿整份档案”，第二种方式会更自然。

### 1.1 文档数据库适合解决什么问题

典型场景：

- 内容管理系统：文章、标签、评论摘要、作者信息天然是一个文档。
- 电商商品中心：同一类商品属性差异大，手机有屏幕尺寸，鞋子有尺码，电脑有 CPU/GPU。
- 用户画像系统：画像标签和行为摘要字段常变，结构经常迭代。
- 事件与日志存储：同一事件族有共性，但不同事件类型字段差异明显。
- 配置中心：配置项天然是层级对象。

### 1.2 MongoDB 解决的核心矛盾

MongoDB 试图平衡三件事：

1. 数据模型要足够灵活。
2. 查询能力不能弱到只能按主键取值。
3. 分布式扩展和高可用要是数据库内建能力，而不是业务自己拼。

它的核心思路是：

- 用文档模型承载灵活结构。
- 用丰富索引和查询规划器保证查询效率。
- 用 Replica Set 提供高可用。
- 用 Sharding 提供水平扩展。

### 1.3 MongoDB 不是什么

MongoDB 不是“关系数据库的完全替代品”。

如果你的业务特征是：

- 强事务跨多行多表极其频繁。
- 复杂 join、窗口函数、复杂 SQL 分析是核心能力。
- 数据关系稳定且高度规范化。

那么 PostgreSQL 往往更合适。

技术选型里最容易犯的错误，不是不会用 MongoDB，而是把“模型灵活”误解成“所有场景都该用它”。

### 1.4 一个极简对比

| 维度         | MongoDB                        | PostgreSQL         |
| ------------ | ------------------------------ | ------------------ |
| 数据模型     | 文档                           | 关系模型           |
| Schema       | 可选、可渐进演进               | 强结构、强约束     |
| Join         | 支持 `$lookup`，但不是核心优势 | 强项               |
| 水平扩展     | 原生分片                       | 可做，但复杂度更高 |
| OLTP 事务    | 支持，但有成本                 | 成熟强项           |
| 半结构化数据 | 很强                           | 通过 JSONB 也很强  |

工程上更准确的理解是：

MongoDB 擅长“对象型数据 + 高并发读写 + 结构灵活 + 原生分布式”。

---

## 2. 文档模型与 BSON

MongoDB 的基本单位不是“行”，而是“文档”。文档通常以类似 JSON 的形式展示，但实际存储格式是 BSON。

### 2.1 什么是文档

一个订单文档示例：

```json
{
  "_id": { "$oid": "65f000000000000000000001" },
  "orderNo": "ORD-20260317-001",
  "userId": 1001,
  "status": "PAID",
  "items": [
    {
      "sku": "iphone-15-pro-256g",
      "price": 8999,
      "qty": 1
    },
    {
      "sku": "charger-30w",
      "price": 199,
      "qty": 1
    }
  ],
  "shippingAddress": {
    "city": "Shanghai",
    "district": "Pudong",
    "detail": "XX Road 88"
  },
  "createdAt": { "$date": "2026-03-17T09:00:00Z" }
}
```

这份结构如果放进关系库，通常会拆成：

- orders
- order_items
- addresses

而在 MongoDB 里，它可以自然地作为一个聚合根保存。

### 2.2 BSON 与 JSON 的关系

BSON 是 Binary JSON，不是单纯把 JSON 文本压缩一下，而是二进制编码格式，支持更多数据类型。

| 能力       | JSON                   | BSON        |
| ---------- | ---------------------- | ----------- |
| 字符串     | 支持                   | 支持        |
| 数字       | 不区分 int/long/double | 明确区分    |
| 日期       | 无原生日期类型         | 有原生 Date |
| 二进制     | 不友好                 | 有 Binary   |
| ObjectId   | 无                     | 原生支持    |
| Decimal128 | 无                     | 支持        |

类比一下：

- JSON 像“发给人看的快递面单”。
- BSON 像“仓库内部扫描系统使用的条码格式”，机器处理更高效，也能表达更多类型信息。

### 2.3 常见 BSON 类型

MongoDB 常见数据类型包括：

- `ObjectId`
- `String`
- `Int32`
- `Int64`
- `Double`
- `Decimal128`
- `Boolean`
- `Date`
- `Array`
- `Document`
- `Binary`
- `Null`

### 2.4 ObjectId 的结构

`ObjectId` 是 12 字节，常被用作默认 `_id`。

历史上它通常由以下部分组成：

- 4 字节时间戳
- 5 字节随机值
- 3 字节递增计数器

这带来几个实际效果：

1. 大体按时间递增。
2. 分布式环境下碰撞概率极低。
3. 用它做默认主键时，插入位置通常较稳定。

但注意，它不是严格连续 ID，也不适合拿去表达业务顺序语义。

### 2.5 BSON 的几个工程注意点

#### 文档大小上限

单个文档默认上限是 16MB。

这条限制很重要，因为很多初学者会把 MongoDB 当成“什么都往一个文档里塞的数据库”。

错误示例：

- 一个用户文档里内嵌几十万条行为明细。
- 一个商品文档里内嵌所有评论全文。

这会导致：

- 文档过大，更新和传输成本高。
- 热点文档冲突加剧。
- 索引和内存命中变差。

#### 字段名也占空间

MongoDB 存储时字段名也在 BSON 里，所以冗长字段名会增加存储和网络开销。

但工程上不要为了省几个字节把字段名压成不可读的缩写。通常：

- 内部高吞吐事件表可以适度缩短。
- 面向业务主文档保持可读性更重要。

### 2.6 文档模型的优点与代价

优点：

- 天然表达层级结构。
- 读取聚合对象时很顺手。
- Schema 演进成本低。

代价：

- 容易出现字段不一致。
- 去重、约束、复杂关联需要更多自律。
- 大文档更新、数组更新、热点文档竞争需要额外设计。

---

## 3. 集合、索引与查询入口

MongoDB 的逻辑组织大致是：

- database
- collection
- document

Collection 类似关系库里的表，但约束更弱。

### 3.1 Collection 的基本特征

同一个 collection 内的文档：

- 不要求字段完全一致。
- 不要求每个字段都出现。
- 数据类型也可能演进。

示例：

```javascript
db.products.insertMany([
  {
    name: "iPhone 15 Pro",
    category: "phone",
    specs: {
      storage: "256GB",
      color: "black",
    },
  },
  {
    name: "Running Shoes",
    category: "shoes",
    specs: {
      sizeRange: [40, 41, 42, 43],
      material: "mesh",
    },
  },
]);
```

这类模型对商品中心非常自然。

### 3.2 Schema 可选，不代表不要 Schema

MongoDB 常被误解为“无 Schema”。更准确的说法是“Schema 灵活，但不是不要 Schema”。

生产环境里通常至少有三层约束：

1. 应用层 DTO/对象模型约束。
2. 集合级 JSON Schema Validator。
3. 索引与唯一约束。

#### Validator 示例

```javascript
db.createCollection("users", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["email", "status", "createdAt"],
      properties: {
        email: {
          bsonType: "string",
          pattern: "^.+@.+$",
        },
        status: {
          enum: ["ACTIVE", "LOCKED", "DELETED"],
        },
        createdAt: {
          bsonType: "date",
        },
      },
    },
  },
});
```

### 3.3 索引是 MongoDB 性能的分水岭

很多 MongoDB 项目性能差，不是数据库不行，而是“以为结构灵活，所以索引也可以慢慢补”。

这是错误认知。

MongoDB 的查询性能高度依赖索引设计。尤其在大集合上，全表扫描成本会迅速失控。

### 3.4 常见索引类型

MongoDB 常见索引包括：

- 单字段索引 `single field`
- 复合索引 `compound`
- 多键索引 `multikey`
- 文本索引 `text`
- TTL 索引
- 哈希索引 `hashed`
- 地理空间索引 `2d` / `2dsphere`
- 稀疏索引 `sparse`
- 部分索引 `partial`
- 列存索引 `columnstore`（7.x 时代值得关注）

### 3.5 单字段索引

```javascript
db.orders.createIndex({ userId: 1 });
```

适合：

- 高频按某字段过滤。
- 字段选择性较高。

### 3.6 复合索引与前缀原则

```javascript
db.orders.createIndex({ userId: 1, status: 1, createdAt: -1 });
```

这个索引可以很好支持：

- `userId`
- `userId + status`
- `userId + status + createdAt`

但不能高效支持：

- 仅按 `status`
- 仅按 `createdAt`

这和关系型数据库的复合索引前缀原则一致。

### 3.7 多键索引 Multikey

当被索引字段是数组时，MongoDB 会自动把它变成 multikey 索引。

```javascript
db.articles.createIndex({ tags: 1 });
```

文档：

```json
{
  "title": "MongoDB Guide",
  "tags": ["mongodb", "database", "nosql"]
}
```

数组每个元素都会参与索引。

这很方便，但也要注意：

- 数组很大时，索引项会膨胀。
- 多数组字段的复合索引受限制。

### 3.8 Text Index

```javascript
db.articles.createIndex({ title: "text", content: "text" });
```

它适合站内轻量全文检索，但不适合替代 Elasticsearch 做复杂搜索。

### 3.9 TTL 索引

```javascript
db.sessions.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
```

典型用途：

- 会话过期
- 临时验证码
- 观测日志保留策略

注意：TTL 删除不是实时秒杀式发生，而是后台线程定期扫描，所以它是“最终过期”，不是严格准点删除。

### 3.10 覆盖查询 Covered Query

如果查询所需字段全部来自索引，就不必回表读取完整文档。

示例：

```javascript
db.orders.createIndex({ userId: 1, status: 1, createdAt: -1 });

db.orders.find(
  { userId: 1001, status: "PAID" },
  { _id: 0, userId: 1, status: 1, createdAt: 1 },
);
```

如果规划器能完全从索引返回结果，这就是 covered query。

类比：

- 普通索引查询像先查图书馆索引卡，再跑去书架拿书。
- 覆盖查询像索引卡上信息已经够了，根本不需要去书架。

---

## 4. 存储引擎与内部架构

MongoDB 当前主流存储引擎是 WiredTiger。

早年还有 MMAPv1，但在现代生产环境里几乎不再讨论。

### 4.1 WiredTiger 的基本定位

WiredTiger 不是一个“只负责把文档写到磁盘”的薄层，它承担了大量核心职责：

- B-Tree 风格的数据组织
- 页缓存管理
- 压缩
- 并发控制
- Checkpoint
- 日志
- 快照语义支持

如果把 MongoDB 看成一家大仓库：

- MongoDB Server 是整个仓库管理系统。
- WiredTiger 是仓库里的货架系统 + 出入库登记系统 + 临时缓存区。

### 4.2 WiredTiger 的核心机制

#### 页面与 B-Tree

MongoDB 的集合和索引底层都可以理解为基于树结构组织。

实际工作时不用死抠源码细节，但要知道：

- 数据不是简单 append 到一个文本文件。
- 查询和索引都依赖页结构与树遍历。
- 更新可能导致 page split。

#### Compression

WiredTiger 支持压缩，常见收益：

- 降低磁盘占用。
- 提升缓存有效容量。

但压缩也意味着：

- CPU 开销上升。
- 热路径上要权衡读写成本。

#### Cache

WiredTiger 自带缓存。MongoDB 还依赖操作系统 page cache。

因此调优时需要理解：

- 不是“把所有内存都给 MongoDB”就最好。
- WiredTiger cache 与 OS cache 的平衡很重要。

### 4.3 Checkpoint 与 Journal

MongoDB 的持久化不是“每次写都把最终数据页同步刷盘”。

典型路径是：

1. 更新先进入内存与 journal。
2. 后续由 checkpoint 将一致状态落盘。

Journal 类似“记账流水”，Checkpoint 类似“阶段性盘点后把总账固化”。

### 4.4 并发控制与文档级锁

MongoDB 早期锁粒度较粗，现代版本已经演进到更细的并发控制。

工程上你通常需要知道的是：

- 不是全库一把大锁。
- 热点主要集中在相同文档、高冲突索引键、chunk 迁移、事务范围过大。

### 4.5 写冲突与重试

WiredTiger 使用乐观并发控制思路的一面体现在：

- 写热点下可能出现 write conflict。
- 上层驱动或事务逻辑需要具备重试意识。

这也是为什么 MongoDB 官方和大多数驱动都强调：

- 应用要正确处理瞬时失败与重试。

### 4.6 存储引擎层面的几个实际信号

生产中常见的性能征兆：

- Cache eviction 压力高。
- checkpoint 时间拉长。
- dirty cache 比例高。
- page read into cache 频繁，说明工作集超内存。

这些现象比一句“MongoDB 变慢了”有用得多。

---

## 5. 读写流程与查询规划器

MongoDB 真正难的部分，不是会写 `find()`，而是理解一条查询为什么会快、为什么会慢。

### 5.1 写入流程概览

以一条插入为例：

```javascript
db.orders.insertOne({
  orderNo: "ORD-1",
  userId: 1001,
  status: "NEW",
  createdAt: new Date(),
});
```

高层流程可以理解为：

1. 客户端驱动发送请求。
2. mongod 解析请求。
3. 写入存储引擎内存结构。
4. 更新相关索引。
5. 根据 writeConcern 决定何时向客户端确认。
6. 后续 journal/checkpoint 完成更稳定的持久化过程。

### 5.2 查询流程概览

```javascript
db.orders
  .find({ userId: 1001, status: "PAID" })
  .sort({ createdAt: -1 })
  .limit(20);
```

典型步骤：

1. 解析查询条件。
2. 生成候选执行计划。
3. 选择 winning plan。
4. 执行索引扫描/文档读取/排序/过滤。
5. 返回结果。

### 5.3 查询规划器在做什么

MongoDB 查询规划器会考虑：

- 哪些索引可用。
- 是否需要排序。
- 是否需要回表。
- 哪个计划预估成本更低。

你可以通过 `explain()` 查看：

```javascript
db.orders
  .find({ userId: 1001, status: "PAID" })
  .sort({ createdAt: -1 })
  .explain("executionStats");
```

重点看：

- `winningPlan`
- `stage`
- `totalKeysExamined`
- `totalDocsExamined`
- `executionTimeMillis`

### 5.4 理想查询长什么样

理想状态通常是：

- `totalKeysExamined` 接近返回行数。
- `totalDocsExamined` 尽量少。
- 没有额外阻塞排序。
- 没有大范围 scan 再 filter。

### 5.5 单字段、复合、排序三者的协同

示例查询：

```javascript
db.orders
  .find({ userId: 1001, status: "PAID" })
  .sort({ createdAt: -1 })
  .limit(20);
```

理想索引往往是：

```javascript
db.orders.createIndex({ userId: 1, status: 1, createdAt: -1 });
```

原因：

- 过滤字段在前。
- 排序字段紧随其后。
- 避免额外内存排序。

### 5.6 索引类型详解

#### Single

最简单，也最容易被滥用。多个单字段索引不一定能替代一个合适的复合索引。

#### Compound

MongoDB 绝大多数高性能业务查询，最终都落在少量精心设计的复合索引上。

#### Multikey

适合数组字段，但数组越大，索引展开越多。

#### Text

适合轻量全文检索，不适合复杂检索平台场景。

#### TTL

适合生命周期明确的数据，不适合强实时删除要求。

#### Partial

非常实用。

```javascript
db.users.createIndex(
  { email: 1 },
  { unique: true, partialFilterExpression: { deleted: { $ne: true } } },
);
```

这比简单 unique 更适合软删除模型。

### 5.7 SBE 与现代查询执行

MongoDB 6.x 之后逐步强化 Slot-Based Execution（SBE）引擎，到了 7/8 时代已经是很多查询路径上的现实能力。

你不必在面试里背所有内部实现，但要知道：

- MongoDB 在持续优化现代查询执行框架。
- explain 中的一些执行细节与旧版本会不同。
- 升级版本后，同一查询计划表现可能变化，需要回归验证。

### 5.8 一个慢查询示例

```javascript
db.orders.find({ status: "PAID" }).sort({ createdAt: -1 }).limit(20);
```

如果集合有几亿数据，而 `status = PAID` 占比 80%，那么：

- 即使有 `status` 索引，也可能不理想。
- 若没有 `createdAt` 配合，可能触发大范围扫描和排序。

更合适的索引往往是结合实际过滤选择性与排序路径一起设计。

---

## 6. 复制集、oplog 与高可用

MongoDB 的高可用核心是 Replica Set。

### 6.1 Replica Set 是什么

一个复制集通常包含：

- 1 个 Primary
- 多个 Secondary

Primary 接受写入，Secondary 复制 Primary 的操作日志并回放。

类比：

- Primary 像总账会计。
- Secondary 像同步抄账的分会计。

### 6.2 oplog 是什么

`oplog` 是操作日志，位于 `local.oplog.rs`。

它不是“完整数据副本”，而是“按时间顺序记录的数据变更流水”。

Secondary 通过持续拉取并应用 oplog，实现复制。

### 6.3 Primary 的确认与复制延迟

当你写入一条数据时，客户端何时收到成功，不只取决于 Primary 本地写入，还取决于 `writeConcern`。

例如：

```javascript
db.orders.insertOne(
  { orderNo: "ORD-2", status: "PAID" },
  { writeConcern: { w: "majority" } },
);
```

`w: majority` 表示多数节点确认后才算成功，这比 `w:1` 更安全，但延迟更高。

### 6.4 选主机制

当 Primary 故障时，复制集会触发选举。

基础认知：

- 不是所有 Secondary 都能瞬间当选。
- 节点必须足够新，不能严重落后。
- 多数派是核心。

这背后的思想和很多分布式系统一致：

没有多数派，就不要冒险承认“我才是新的主”。

### 6.5 故障切换时应用会看到什么

常见现象：

- 短暂写失败。
- 驱动层报 `NotPrimary`、`PrimarySteppedDown`、重试相关错误。
- 读流量重新路由。

所以生产环境必须：

- 使用官方驱动的重试写和连接字符串配置。
- 不要把一次连接失败当成整个服务故障。

### 6.6 readPreference 的影响

常见选项：

- `primary`
- `primaryPreferred`
- `secondary`
- `secondaryPreferred`
- `nearest`

如果业务要求“刚写入立刻读到”，通常应谨慎使用 secondary 读。

否则就会碰到经典问题：

- 写已成功返回。
- 紧接着从 Secondary 读取，却因复制延迟没看到最新数据。

### 6.7 oplog 窗口的重要性

如果 Secondary 落后太久，而 oplog 已经滚动覆盖了它需要追的历史，就可能需要全量重新同步。

所以线上要关注：

- oplog 大小
- 复制延迟
- 节点恢复时间

这不是“运维细节”，而是直接决定故障恢复窗口的核心参数。

---

## 7. 分片、Chunk 与 Balancer

当单机容量或吞吐不够时，MongoDB 的水平扩展依赖 Sharding。

### 7.1 分片架构的角色

分片集群主要包含：

- `mongos`：路由层
- Config Server Replica Set：元数据管理
- Shard：真正存放数据的分片节点，通常每个 shard 自己也是一个 Replica Set

### 7.2 Shard Key 为什么关键

分片不是“把数据随便拆几份”。

Shard Key 决定：

- 数据如何分布
- 请求是否均衡
- 是否会出现热点
- 查询能否精准路由

一个不好的 Shard Key，足以让集群越扩越慢。

### 7.3 Chunk 是什么

MongoDB 不直接以单条文档为迁移单位，而是把某段 shard key 范围的数据组织成 chunk。

你可以把 chunk 理解成：

- “一小箱有连续编号范围的货物”。

分片迁移时，系统搬的是箱子，不是零散单件。

### 7.4 Balancer 在做什么

Balancer 负责让各 shard 的 chunk 分布更均衡。

它会：

1. 检查哪些 shard chunk 过多。
2. 挑选 chunk 迁移。
3. 更新元数据。

Balancer 是必要的，但它不是免费的：

- 会带来迁移流量。
- 热点期迁移会干扰业务。

### 7.5 Range Sharding vs Hashed Sharding

#### Range

优点：

- 支持范围查询精准落到少量 shard。

缺点：

- 如果 key 递增，容易把新写入全部打到最后一个 shard，形成热点。

#### Hashed

优点：

- 分布更均匀，适合高并发写入。

缺点：

- 范围查询路由能力差。

这就是经典权衡：

- 要范围局部性，还是要全局均匀性。

### 7.6 热点分片是怎么出现的

最经典的错误：

用时间递增字段作为 range shard key，例如：

```javascript
{
  createdAt: 1;
}
```

结果：

- 最新数据都落在最后区间。
- 最新区间几乎都在某个 shard。
- 该 shard 成为写热点。

### 7.7 分片查询的两种代价

#### Targeted Query

路由器知道去哪个 shard 查，成本低。

#### Scatter-Gather

路由器不知道目标，只能广播到所有 shard，再聚合结果。

这在大集群上代价很高。

所以一个好 shard key，不只是“分布均匀”，还要让核心查询尽量 targeted。

### 7.8 分片环境下的实际建议

- 不要太早分片，先把单节点模型和索引做好。
- 分片键优先从访问模式反推，而不是从字段名字拍脑袋。
- 提前用真实查询压测 shard key。
- 关注 chunk migration 对延迟的影响。

---

## 8. 一致性、读写关注与事务

MongoDB 不是“完全不要事务”，而是事务能力的使用方式与关系库不同。

### 8.1 Read Concern

常见读关注级别包括：

- `local`
- `available`
- `majority`
- `linearizable`
- `snapshot`

可以粗略理解为：

- 你希望读取多“新”的数据。
- 你愿意为多强的一致性付出多少延迟成本。

### 8.2 Write Concern

常见写关注：

- `w:1`
- `w:"majority"`
- 是否 `j:true`

示例：

```javascript
db.payments.insertOne(
  {
    paymentNo: "P-001",
    amount: NumberDecimal("99.99"),
  },
  {
    writeConcern: { w: "majority", j: true },
  },
);
```

### 8.3 Read Concern 与 Write Concern 的组合

经典误区：

- 只记得事务这个大词，却不关注日常请求的 readConcern / writeConcern 配置。

实际上很多“一致性问题”都不是事务缺失，而是：

- 写用 `w:1`
- 读走 secondary
- 应用还假设“写后立刻强一致可见”

### 8.4 MongoDB 事务能做什么

MongoDB 支持多文档事务，也支持分片集群上的分布式事务。

这让很多跨集合一致性需求可以直接落地。

示例：

```javascript
const session = db.getMongo().startSession();
session.startTransaction();

try {
  const orders = session.getDatabase("shop").orders;
  const inventory = session.getDatabase("shop").inventory;

  orders.insertOne({ orderNo: "ORD-3", sku: "sku-1", qty: 1 });
  inventory.updateOne({ sku: "sku-1" }, { $inc: { stock: -1 } });

  session.commitTransaction();
} catch (e) {
  session.abortTransaction();
  throw e;
} finally {
  session.endSession();
}
```

### 8.5 事务的代价

事务不是免费午餐。代价包括：

- 持有更多状态。
- 更高资源占用。
- 跨分片事务更慢。
- 长事务会阻碍清理与缓存效率。

所以最佳实践通常是：

- 单文档能完成的更新，就不要上事务。
- 一个聚合根内尽量靠文档原子性解决问题。

### 8.6 单文档原子性

MongoDB 的一个重要优势是：

- 单文档更新天然原子。

例如：

```javascript
db.accounts.updateOne(
  { _id: 1001, balance: { $gte: 100 } },
  { $inc: { balance: -100 } },
);
```

这类“读条件 + 原地更新”在单文档里非常有价值。

### 8.7 事务限制要点

面向 MongoDB 7/8 时代，工程上要记住这些方向：

- 事务应短小。
- 避免在事务里做大批量扫描。
- 避免长时间等待外部调用。
- 控制事务涉及的文档数量和 shard 数量。

---

## 9. Schema 设计：Embedding vs Referencing

MongoDB 设计最容易问到，也最容易做错的点，就是嵌入还是引用。

### 9.1 Embedding

把相关数据直接放进一个文档里。

示例：

```json
{
  "_id": 1001,
  "name": "Alice",
  "addresses": [
    {
      "tag": "home",
      "city": "Shanghai",
      "detail": "Road 88"
    },
    {
      "tag": "office",
      "city": "Shanghai",
      "detail": "Building A"
    }
  ]
}
```

适合：

- 一起读，一起写。
- 生命周期一致。
- 数量有限。

### 9.2 Referencing

通过外键式字段关联其他文档。

```json
{
  "_id": 2001,
  "userId": 1001,
  "orderNo": "ORD-1001"
}
```

适合：

- 关联对象很多。
- 独立增长。
- 经常单独查询。
- 文档可能突破 16MB 风险。

### 9.3 如何判断

一个非常实用的判断框架：

1. 它们是不是天然一个聚合？
2. 是否总是一起读取？
3. 数量会不会无限增长？
4. 是否需要独立更新和独立索引？

如果答案偏向“总是一起、数量有限、生命周期一致”，倾向 embedding。

如果答案偏向“增长快、经常单查、更新独立”，倾向 referencing。

### 9.4 订单案例

订单的 `items` 通常适合 embedding：

- 下单后基本一起读。
- 条目数通常有限。
- 不会无限增长。

但订单评论、物流轨迹全文、海量支付流水，通常不适合无脑内嵌。

### 9.5 一对多不是自动等于引用

很多人看到一对多就条件反射要拆表，这其实是关系数据库思维的惯性。

在 MongoDB 中，一对多也完全可能内嵌，只要“多”的规模受控。

### 9.6 反范式是 MongoDB 的常态

MongoDB 鼓励为读模型做一定冗余。

例如订单文档中存一份用户昵称快照、商品标题快照，这是很常见的工程实践。

不要把关系数据库那种“必须绝对去冗余”的审美硬套到 MongoDB 上。

但要注意：

- 冗余字段必须定义更新策略。
- 明确哪些是快照，哪些是实时字段。

---

## 10. 聚合管道

MongoDB 的聚合管道是非常核心的能力。它不是 SQL，但可以表达大量分析和数据处理逻辑。

### 10.1 聚合管道的思想

聚合管道像工厂流水线：

- 原始文档进入流水线。
- 每个 stage 做一步处理。
- 最终输出结果。

### 10.2 常见 Stage

- `$match`
- `$project`
- `$group`
- `$sort`
- `$limit`
- `$unwind`
- `$lookup`
- `$facet`
- `$set` / `$addFields`
- `$count`

### 10.3 一个订单统计示例

```javascript
db.orders.aggregate([
  {
    $match: {
      status: "PAID",
      createdAt: {
        $gte: ISODate("2026-03-01T00:00:00Z"),
        $lt: ISODate("2026-04-01T00:00:00Z"),
      },
    },
  },
  { $unwind: "$items" },
  {
    $group: {
      _id: "$items.sku",
      totalQty: { $sum: "$items.qty" },
      totalAmount: { $sum: { $multiply: ["$items.qty", "$items.price"] } },
    },
  },
  { $sort: { totalAmount: -1 } },
  { $limit: 10 },
]);
```

### 10.4 `$lookup` 是 join，但别把它当成关系库 join 的平替

MongoDB 支持 `$lookup`，这很有用，但也要克制。

如果你的核心读路径天天依赖复杂 `$lookup`，那通常说明：

- Schema 没设计好。
- 或者其实更适合关系数据库。

### 10.5 聚合优化基本原则

- 尽早 `$match`，缩小输入。
- 尽早 `$project`，减少字段。
- 能利用索引的过滤尽量提前。
- 大 `$group` 和 `$sort` 要谨慎，可能吃大量内存。

### 10.6 聚合与索引的配合

聚合不是脱离索引独立运行的魔法。

例如 `$match` 如果能命中索引，整个管道成本会显著下降。

### 10.7 分页聚合要注意什么

如果你在聚合后做深分页，`skip` 成本可能很高。

更好的方式往往是：

- 用范围条件分页。
- 或者基于游标字段分页。

---

## 11. 实战案例

### 11.1 用户档案

适合 MongoDB 的原因：

- 标签和画像结构常变。
- 不同用户可能有不同维度特征。

建议模型：

```json
{
  "_id": 1001,
  "name": "Alice",
  "tags": ["vip", "shanghai", "sports"],
  "profile": {
    "gender": "female",
    "age": 29,
    "favoriteCategories": ["running", "yoga"]
  },
  "lastActiveAt": { "$date": "2026-03-17T09:00:00Z" }
}
```

### 11.2 商品中心

适合点：

- 商品属性高度异构。
- 同类商品和异类商品字段差异明显。

但要注意：

- 通用搜索字段仍然要标准化。
- 关键查询字段必须稳定，并配好索引。

### 11.3 订单系统

MongoDB 能做订单系统，但要看系统重点。

如果你的订单主要是：

- 高并发写入
- 按订单聚合读取
- 条目内嵌很自然

那么 MongoDB 可以胜任。

如果系统高度依赖：

- 多表复杂对账
- 大量强事务报表
- 复杂 SQL 风格分析

那 PostgreSQL 往往更稳妥。

### 11.4 日志与事件流

MongoDB 在中等规模事件存储中也常见，尤其当：

- 文档结构灵活。
- 查询是按时间范围和部分标签过滤。

这时 TTL 索引与分片策略尤为关键。

---

## 12. 性能调优

MongoDB 调优，核心不是背参数，而是先判断瓶颈在哪一层。

### 12.1 先判断四类问题

1. 查询没走好索引。
2. 工作集超内存。
3. 写热点或分片热点。
4. 复制/事务/聚合导致额外开销。

### 12.2 explain 是第一现场

遇到慢查询，先看：

- 是否 COLLSCAN
- keys/docs examined 比例
- 是否有阻塞排序
- 返回 20 条却扫描几百万条

### 12.3 低选择性字段别迷信索引

比如 `status` 只有 `NEW/PAID/CLOSED` 三种值。

如果你单独给它建索引，往往收益有限。

要结合：

- 高频过滤组合
- 排序字段
- 租户字段
- 时间范围

一起设计复合索引。

### 12.4 深分页问题

```javascript
db.orders.find({ userId: 1001 }).sort({ createdAt: -1 }).skip(100000).limit(20);
```

这是典型坏味道。

更好的方式：

```javascript
db.orders
  .find({
    userId: 1001,
    createdAt: { $lt: ISODate("2026-03-17T09:00:00Z") },
  })
  .sort({ createdAt: -1 })
  .limit(20);

更好的方式：

```javascript
db.orders.find({
  userId: 1001,
  createdAt: { $lt: ISODate("2026-03-17T09:00:00Z") }
}).sort({ createdAt: -1 }).limit(20)
```

也就是基于上次游标值做 seek pagination。

### 12.5 批量写入优于大量单写

在合适场景下使用 `insertMany`、`bulkWrite`，可以减少网络往返和协调成本。

### 12.6 热点文档问题

典型错误：

- 把一个全局计数器文档当成所有请求都要更新的点。

结果是：

- 单文档锁竞争
- 高冲突
- 延迟抖动

更好的方式：

- 分桶计数
- 异步汇总
- 预聚合

### 12.7 Aggregation 内存风险

大 `$sort`、大 `$group`、大 `$lookup` 都要警惕。

必要时：

- 先过滤
- 拆离线任务
- 预聚合
- 调整分析路径

### 12.8 复制集调优视角

- 关注 replication lag。
- 关注 primary 负载是否过于集中。
- 让报表读和在线读分流，但别误伤一致性。

### 12.9 分片调优视角

- 先看 shard key 是否合理。
- 再看 chunk 分布。
- 再看是否 scatter-gather。

很多所谓“分片后更慢”，根因不是分片本身，而是 shard key 设计错误。

---

## 13. 常见陷阱与最佳实践

### 13.1 陷阱：把 MongoDB 当成完全无约束的 JSON 桶

最佳实践：

- 保持逻辑 schema。
- 使用 validator。
- 建立字段字典与版本演进规范。

### 13.2 陷阱：一个集合塞进过多异构文档

灵活不代表所有对象都要混在一个 collection 里。

如果查询模式、索引需求、生命周期差异很大，就应该拆分集合。

### 13.3 陷阱：索引越多越安全

索引有代价：

- 写入更慢。
- 占更多内存和磁盘。
- 建索引与维护索引都有成本。

最佳实践：

- 用慢查询和访问模式驱动索引设计。
- 定期清理无用索引。

### 13.4 陷阱：无脑内嵌一切

最佳实践：

- 小而稳定、总是一起读的数据才适合 embedding。
- 无限增长数组要尽早拆分。

### 13.5 陷阱：写后立刻从 Secondary 读

最佳实践：

- 强一致读走 Primary 或使用合适 concern。
- 明确业务是否接受最终一致。

### 13.6 陷阱：事务用得像关系库

MongoDB 支持事务，不代表最佳模型就是“先拆成很多集合，再靠事务补一致性”。

最佳实践仍然是：

- 优先单文档原子性。
- 优先按聚合根建模。

### 13.7 陷阱：Shard Key 只考虑均匀，不考虑查询路由

最佳实践：

- 同时考虑分布与 targetability。

### 13.8 陷阱：把 `$lookup` 当日常核心路径

最佳实践：

- 重要在线链路尽量避免大规模跨集合 join。

### 13.9 陷阱：忽视运维观测

应重点关注：

- 慢查询日志
- WiredTiger cache
- replication lag
- page fault/磁盘延迟
- chunk migration
- oplog 窗口

---

## 14. MongoDB 7/8 时代实践备注

MongoDB 到 7/8 时代，很多团队使用它已经不是“只要能存 JSON 就行”，而是把它当成成熟分布式数据库来运营。

### 14.1 版本升级要关心什么

- 查询执行引擎变化是否影响 explain 结果。
- 某些索引与聚合优化在新版本中表现更好，但也要做回归压测。
- 驱动版本和服务器版本要匹配更新。

### 14.2 Columnstore Index 的实践价值

在 MongoDB 7.x 时代，列存索引是值得关注的新能力之一，尤其适合：

- 宽文档
- 分析型投影查询
- 只读取少量字段的探索式分析

它不是 OLTP 万能索引，但对某些分析读很有帮助。

### 14.3 时间序列与特定场景能力更成熟

如果你处理监控、传感器、事件类数据，7/8 时代围绕时间序列的支持比早年更成熟。

但原则不变：

- 先看查询模式。
- 再看 retention、分片和冷热分层策略。

### 14.4 Atlas 特性与社区版边界

很多团队在谈 MongoDB 能力时，会混用“MongoDB 数据库能力”和“Atlas 托管平台能力”。

工程上要分清：

- 哪些是内核数据库能力。
- 哪些是 Atlas 附加能力，例如部分搜索和平台级集成功能。

### 14.5 最后的选型建议

如果你的系统满足以下大多数特征，MongoDB 很可能是合适的：

- 业务对象天然以文档聚合呈现。
- 字段模型常演进。
- 高并发读写多于复杂 join。
- 需要原生复制集和分片。

如果你的系统更偏向：

- 复杂关联分析
- 强事务一致性链路很多
- SQL 分析和约束能力极其重要

那么 PostgreSQL 仍然很可能是更稳妥的基座。

MongoDB 最值得掌握的，不是命令，而是建模思维。

当你知道什么该嵌入、什么该引用，什么该走单文档原子性、什么该上事务，什么 shard key 能同时兼顾均匀和路由，MongoDB 才真正从“灵活”变成“可控”。
