# Elasticsearch 面试题

> 面向 Elasticsearch 7/8 时代的分层面试题,涵盖倒排索引、分词器、Query DSL、聚合分析、分布式架构、Mapping 设计、搜索相关性、性能调优与生产实践。

## 相关链接

- 对应技术资料：[Elasticsearch 核心技术](../../01-技术资料/03-数据库/06-Elasticsearch核心技术.md)

## 目录

1. [⭐ 基础题（熟悉概念）](#1-基础题)
2. [⭐⭐ 进阶题（理解原理）](#2-进阶题)
3. [⭐⭐⭐ 高级题（深度原理 / 生产级）](#3-高级题)
4. [🎯 场景题（系统设计）](#4-场景题)

---

## 🔥 高频考点速记

> 面试中最常被问到的核心知识点，按出现频率排序。建议优先掌握前 5 项。

| #   | 考点                 | 核心要点（一句话）                                                                    | 出题概率 |
| --- | -------------------- | ------------------------------------------------------------------------------------- | -------- |
| 1   | 倒排索引             | Term → Posting List，是全文搜索的核心数据结构                                         | ★★★★★    |
| 2   | 分词器（Analyzer）   | 字符过滤 → 分词 → Token 过滤三段式，中文需 IK/jieba                                   | ★★★★★    |
| 3   | Query DSL            | match（全文）vs term（精确）vs bool（组合），理解评分机制                             | ★★★★★    |
| 4   | Mapping 设计         | 字段类型选择（text/keyword/nested）、dynamic mapping 陷阱                             | ★★★★☆    |
| 5   | 分布式架构           | 分片（Primary/Replica）+ 路由 + 协调节点，理解写入与搜索流程                          | ★★★★★    |
| 6   | 聚合（Aggregation）  | Bucket（分桶）+ Metric（度量）+ Pipeline，先聚合后计算                                | ★★★★☆    |
| 7   | 搜索相关性（BM25）   | TF-IDF 升级版，考虑文档长度归一化，默认评分算法                                       | ★★★☆☆    |
| 8   | 性能调优             | Bulk 批量写入 / Refresh Interval / 分片数设计 / Filter Context 缓存                   | ★★★★★    |
| 9   | Deep Pagination      | from+size 深分页性能差，用 search_after 或 Scroll API                                 | ★★★★☆    |
| 10  | 集群健康与监控       | 三色健康状态（Green/Yellow/Red）、节点角色、索引生命周期                              | ★★★☆☆    |

---

## 1. 基础题

### Q1：什么是倒排索引（Inverted Index）？它和正排索引有什么区别？

**答：**

**倒排索引**是从词（Term）到文档（Document）的映射关系，是全文搜索引擎的核心数据结构。

| 索引类型 | 映射关系                  | 查询效率       | 适用场景   |
| -------- | ------------------------- | -------------- | ---------- |
| 正排索引 | 文档 ID → 字段内容        | 根据 ID 查内容快 | 关系型数据库 |
| 倒排索引 | Term → 包含该词的文档列表 | 全文搜索快     | 搜索引擎   |

**倒排索引结构**：

```
Term Dictionary（词典）：所有词的有序列表
├─ "elasticsearch" → Posting List [doc1, doc5, doc9]
├─ "search" → Posting List [doc2, doc5, doc8]
└─ "engine" → Posting List [doc1, doc3]

Posting List（倒排列表）：
├─ 文档 ID
├─ 词频（TF）
├─ 词位置（Position，用于短语查询）
└─ 字段偏移量（用于高亮）
```

**类比**：正排索引像通讯录（姓名→电话），倒排索引像电话黄页（行业→商家列表）。

---

### Q2：Elasticsearch 中的 Analyzer（分词器）是什么？由哪几部分组成？

**答：**

**Analyzer** 负责将文本转换为倒排索引中的 Term，是全文搜索的第一步。

**三段式结构**：

```
原始文本 "The 2 QUICK Brown-Foxes jumped!"

↓ 1. Character Filters（字符过滤器）
   HTML Strip / Mapping / Pattern Replace
   → "The 2 QUICK Brown-Foxes jumped"

↓ 2. Tokenizer（分词器）
   Standard / Whitespace / Keyword / N-gram
   → ["The", "2", "QUICK", "Brown", "Foxes", "jumped"]

↓ 3. Token Filters（词元过滤器）
   Lowercase / Stop / Synonym / Stemmer
   → ["quick", "brown", "fox", "jump"]  ← 最终 Terms
```

**常用 Analyzer**：

| Analyzer        | 特点                                   | 适用场景       |
| --------------- | -------------------------------------- | -------------- |
| `standard`      | Unicode 分词 + 小写 + 停用词           | 英文默认       |
| `whitespace`    | 按空格分词，不转小写                   | 结构化文本     |
| `keyword`       | 不分词，整个字段作为一个 Term          | 精确匹配       |
| `ik_smart`      | 中文粗粒度分词（IK 插件）              | 中文搜索       |
| `ik_max_word`   | 中文细粒度分词，最大化切分             | 中文全文搜索   |

**测试分词器**：

```json
POST /_analyze
{
  "analyzer": "ik_smart",
  "text": "Elasticsearch是一个分布式搜索引擎"
}
```

---

### Q3：`text` 和 `keyword` 类型有什么区别？

**答：**

| 对比项     | text                                | keyword                  |
| ---------- | ----------------------------------- | ------------------------ |
| 分词       | **会分词**，建立倒排索引            | **不分词**，整体作为一个 Term |
| 搜索       | 全文搜索（match query）             | 精确匹配（term query）   |
| 聚合/排序  | 不支持（需使用 `fielddata`，不推荐） | 支持                     |
| 适用场景   | 文章内容、描述、评论                | ID、标签、状态、枚举值   |

**示例**：

```json
PUT /products
{
  "mappings": {
    "properties": {
      "title": { "type": "text" },           // 可全文搜索
      "sku": { "type": "keyword" },          // 精确匹配
      "category": {
        "type": "text",
        "fields": {
          "keyword": { "type": "keyword" }   // Multi-field：支持全文搜索 + 聚合
        }
      }
    }
  }
}
```

**最佳实践**：对于需要**既能全文搜索又能聚合/排序**的字段（如商品分类），使用 `text` + `keyword` multi-field。

---

### Q4：`match` 和 `term` 查询有什么区别？

**答：**

| 查询类型 | 是否分词           | 适用字段类型 | 示例场景             |
| -------- | ------------------ | ------------ | -------------------- |
| `match`  | **查询词会分词**   | text         | 全文搜索："搜索引擎" |
| `term`   | **查询词不分词**   | keyword      | 精确匹配：status=active |

**实际查询流程对比**：

```json
// match 查询（全文搜索）
GET /products/_search
{
  "query": {
    "match": {
      "title": "无线蓝牙耳机"
    }
  }
}
// 查询词会被分词为 ["无线", "蓝牙", "耳机"]，匹配包含任一词的文档（OR 逻辑）

// term 查询（精确匹配）
GET /products/_search
{
  "query": {
    "term": {
      "status": "active"
    }
  }
}
// 查询词 "active" 不分词，必须完全匹配
```

**常见陷阱**：对 `text` 字段使用 `term` 查询：

```json
// ❌ 错误：text 字段已分词，term 无法匹配
GET /products/_search
{
  "query": {
    "term": {
      "title": "无线蓝牙耳机"  // title 是 text 类型，已被分词
    }
  }
}
// 结果：0 条（因为倒排索引里没有 "无线蓝牙耳机" 这个完整 Term）

// ✅ 正确：使用 match
{
  "query": { "match": { "title": "无线蓝牙耳机" } }
}

// 或者使用 keyword 字段
{
  "query": { "term": { "title.keyword": "无线蓝牙耳机" } }
}
```

---

### Q5：Elasticsearch 集群中的分片（Shard）是什么？Primary 和 Replica 有什么区别？

**答：**

**分片（Shard）** 是索引的物理存储单元，每个分片本质上是一个独立的 Lucene 索引。

**两种分片类型**：

| 分片类型              | 职责                                   | 数量                         |
| --------------------- | -------------------------------------- | ---------------------------- |
| **Primary Shard**     | 处理写入请求，是数据的主副本           | 索引创建时指定，之后不可变   |
| **Replica Shard**     | 处理读取请求，提供高可用和读吞吐       | 可动态调整                   |

**分片架构图**：

```
Index: products (3 Primary + 2 Replica)

Node1            Node2            Node3
├─ P0            ├─ P1            ├─ P2
├─ R1            ├─ R2            ├─ R0
└─ R2            └─ R0            └─ R1

P0, P1, P2 = Primary Shards (主分片)
R0, R1, R2 = Replica Shards (副本)
```

**关键特性**：

- **写入流程**：客户端 → 协调节点 → 路由到 Primary Shard → 同步写入 Replica Shard
- **读取流程**：协调节点轮询 Primary 或 Replica Shard（负载均衡）
- **故障恢复**：Primary 挂掉时，Replica 自动提升为 Primary
- **分片数规划**：`分片数 = (总数据量 / 单分片目标大小)`，建议单分片 20-50GB

---

### Q6：什么是 Mapping？Dynamic Mapping 有什么风险？

**答：**

**Mapping** 是索引的 Schema 定义，类似关系型数据库的表结构，定义了字段类型、分词器、是否索引等属性。

**Dynamic Mapping（动态映射）**：ES 自动根据写入数据推断字段类型。

**类型推断规则**：

| JSON 类型   | 推断的 ES 类型                        |
| ----------- | ------------------------------------- |
| `true/false`| `boolean`                             |
| `123`       | `long`                                |
| `123.45`    | `float`                               |
| `"2024-01"` | `text` + `keyword`（如果不像日期）     |
| `"2024-01-01"` | `date`（如果启用日期检测）          |
| `"hello"`   | `text` + `keyword` multi-field        |

**风险**：

1. **字段类型错误**：首次写入 `price: "99"`（字符串），后续写入 `price: 99.5`（数字）会报错
2. **字段爆炸**：动态字段无限制增长，超过 `index.mapping.total_fields.limit`（默认 1000）
3. **性能问题**：text 字段默认带 keyword，占用额外存储和内存

**最佳实践**：生产环境关闭 dynamic mapping：

```json
PUT /products
{
  "mappings": {
    "dynamic": "strict",  // 拒绝未定义字段
    "properties": {
      "title": { "type": "text" },
      "price": { "type": "scaled_float", "scaling_factor": 100 }
    }
  }
}
```

---

### Q7：什么是聚合（Aggregation）？Bucket 和 Metric 聚合有什么区别？

**答：**

**Aggregation** 是 ES 的分析引擎，类似 SQL 的 `GROUP BY` 和聚合函数。

**三大类聚合**：

| 聚合类型           | 作用                     | SQL 类比                 | 示例               |
| ------------------ | ------------------------ | ------------------------ | ------------------ |
| **Bucket 聚合**    | 分桶（分组）             | `GROUP BY`               | terms / range / date_histogram |
| **Metric 聚合**    | 计算指标                 | `COUNT() / SUM() / AVG()`| sum / avg / cardinality |
| **Pipeline 聚合**  | 对其他聚合结果再计算     | 嵌套子查询               | derivative / cumulative_sum |

**示例：电商订单分析**

```json
GET /orders/_search
{
  "size": 0,  // 不返回文档，只返回聚合结果
  "aggs": {
    "by_category": {          // Bucket 聚合：按分类分桶
      "terms": { "field": "category.keyword" },
      "aggs": {
        "total_sales": {      // Metric 聚合：计算每个桶的销售额
          "sum": { "field": "amount" }
        },
        "avg_price": {
          "avg": { "field": "price" }
        }
      }
    }
  }
}
```

**类比**：Bucket 是"篮子"，Metric 是"往篮子里计算统计值"。

---

### Q8：Elasticsearch 的写入流程是怎样的？

**答：**

**完整写入流程**（7 步）：

```
1. 客户端发送写入请求
   ↓
2. 协调节点（Coordinating Node）接收请求
   ↓
3. 路由计算：shard_id = hash(routing_value) % num_primary_shards
   ↓
4. 转发到目标 Primary Shard 所在节点
   ↓
5. Primary Shard 写入：
   ├─ 写入内存 Buffer（Lucene Index Buffer）
   ├─ 写入 Translog（预写日志，持久化到磁盘）
   └─ 每隔 refresh_interval（默认 1s）刷新到文件系统缓存（生成 Segment）
   ↓
6. 并行同步写入所有 Replica Shards
   ↓
7. 所有副本确认后，返回客户端成功
```

**关键概念**：

- **Translog**：类似 MySQL 的 Redo Log，保证崩溃恢复
- **Refresh**：内存 → 文件系统缓存（此时文档可被搜索，但未持久化）
- **Flush**：文件系统缓存 → 磁盘（生成 Segment 文件），清空 Translog

**ASCII 流程图**：

```
Client → Coordinating Node → Primary Shard → Replica Shards
                                    ↓
                          [Memory Buffer + Translog]
                                    ↓
                          Refresh (1s) → Segment (可搜索)
                                    ↓
                          Flush → 持久化到磁盘
```

---

## 2. 进阶题

### Q9：`bool` 查询的 `must` / `should` / `filter` / `must_not` 有什么区别？

**答：**

`bool` 查询用于组合多个子查询，是 ES 查询的核心。

| 子句        | 逻辑      | 是否参与评分 | 是否缓存 | SQL 类比       |
| ----------- | --------- | ------------ | -------- | -------------- |
| `must`      | 必须匹配  | **是**       | 否       | `AND`          |
| `should`    | 可选匹配  | **是**       | 否       | `OR`           |
| `filter`    | 必须匹配  | **否**       | **是**   | `WHERE` 过滤   |
| `must_not`  | 必须不匹配| **否**       | **是**   | `NOT` / `!=`   |

**示例：搜索"价格 100-500 元的在售蓝牙耳机，优先显示小米品牌"**

```json
GET /products/_search
{
  "query": {
    "bool": {
      "must": [
        { "match": { "title": "蓝牙耳机" } }  // 必须包含关键词（参与评分）
      ],
      "filter": [
        { "term": { "status": "active" } },  // 必须在售（不参与评分，可缓存）
        { "range": { "price": { "gte": 100, "lte": 500 } } }
      ],
      "should": [
        { "term": { "brand": "小米" } }      // 优先显示小米（提升评分）
      ],
      "must_not": [
        { "term": { "has_discount": false } } // 排除无折扣商品
      ]
    }
  }
}
```

**性能优化**：尽量用 `filter` 代替 `must`（如果不需要评分），因为 filter 结果会被缓存。

---

### Q10：什么是 BM25 算法？它相比 TF-IDF 有什么改进?

**答：**

**BM25（Best Matching 25）** 是 ES 5.0+ 的默认相关性评分算法，是 TF-IDF 的改进版。

**TF-IDF 的问题**：

- 词频（TF）无上限：一个词出现 10 次和 100 次评分差距过大
- 忽略文档长度：长文档天然更易匹配

**BM25 改进**：

```
BM25(q, d) = Σ IDF(qi) · [ TF(qi, d) · (k1 + 1) ] / [ TF(qi, d) + k1 · (1 - b + b · |d| / avgdl) ]

关键参数：
- k1（默认 1.2）：控制词频饱和度（越大，词频影响越大）
- b（默认 0.75）：文档长度归一化因子（0=忽略长度，1=完全归一化）
- |d|：文档长度
- avgdl：所有文档的平均长度
```

**直觉理解**：

- **词频饱和**：词出现 5 次 vs 10 次，评分差距不大（而 TF-IDF 差距翻倍）
- **长度惩罚**：相同词频下，短文档评分更高（更相关）

**调优示例**：

```json
PUT /articles
{
  "settings": {
    "index": {
      "similarity": {
        "custom_bm25": {
          "type": "BM25",
          "k1": 1.5,   // 增强词频影响
          "b": 0.5     // 减弱长度惩罚
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "content": {
        "type": "text",
        "similarity": "custom_bm25"
      }
    }
  }
}
```

---

### Q11：如何解决深分页（Deep Pagination）性能问题？

**答：**

**问题**：`from + size` 深分页性能极差，因为协调节点需要从每个分片获取 `from + size` 条数据，排序后截取。

```json
// ❌ 深分页：第 10000 页，每页 10 条
GET /products/_search
{
  "from": 100000,  // 实际需要从每个分片获取 100010 条数据
  "size": 10
}
```

**原理**：3 个分片 × 100010 条 = 300030 条数据传输到协调节点 → 排序 → 返回 10 条。

**三种解决方案**：

| 方案            | 原理                                       | 适用场景           | 限制             |
| --------------- | ------------------------------------------ | ------------------ | ---------------- |
| **search_after** | 基于上一页最后一条的排序值定位下一页       | 实时滚动分页       | 不支持跳页       |
| **Scroll API**  | 创建快照，保持上下文                       | 全量导出           | 占用内存，不适合实时 |
| **PIT + search_after** | Point-in-Time（时间点快照）+ search_after | 大数据量一致性遍历 | ES 7.10+         |

**search_after 示例**：

```json
// 第一次查询
GET /products/_search
{
  "size": 10,
  "sort": [
    { "price": "asc" },
    { "_id": "asc" }  // 保证唯一排序
  ]
}

// 响应包含 sort 值：
{
  "hits": {
    "hits": [
      {
        "_id": "100",
        "_source": { "price": 99 },
        "sort": [99, "100"]  // ← 用于下一页
      }
    ]
  }
}

// 第二页：传入上一页最后一条的 sort 值
GET /products/_search
{
  "size": 10,
  "search_after": [99, "100"],  // 从这里继续
  "sort": [
    { "price": "asc" },
    { "_id": "asc" }
  ]
}
```

**最佳实践**：禁用深分页 `index.max_result_window: 10000`（默认）。

---

### Q12：什么是 Nested 类型？为什么需要它？

**答：**

**问题**：ES 内部扁平化存储数组对象，导致查询结果错误。

```json
// 文档
{
  "title": "笔记本",
  "comments": [
    { "author": "Alice", "rating": 5 },
    { "author": "Bob", "rating": 1 }
  ]
}

// 内部存储（扁平化）
{
  "comments.author": ["Alice", "Bob"],
  "comments.rating": [5, 1]
}

// ❌ 错误查询：查找 Alice 给 1 分的评论
GET /products/_search
{
  "query": {
    "bool": {
      "must": [
        { "term": { "comments.author": "Alice" } },
        { "term": { "comments.rating": 1 } }
      ]
    }
  }
}
// 错误匹配！因为 Alice 和 1 分在不同对象
```

**解决方案：Nested 类型**

```json
PUT /products
{
  "mappings": {
    "properties": {
      "comments": {
        "type": "nested",  // 声明为 nested
        "properties": {
          "author": { "type": "keyword" },
          "rating": { "type": "integer" }
        }
      }
    }
  }
}

// ✅ 正确查询
GET /products/_search
{
  "query": {
    "nested": {
      "path": "comments",
      "query": {
        "bool": {
          "must": [
            { "term": { "comments.author": "Alice" } },
            { "term": { "comments.rating": 1 } }
          ]
        }
      }
    }
  }
}
// 现在不会错误匹配
```

**原理**：nested 对象以独立隐藏文档存储，保持对象关系。

**性能成本**：nested 查询需要 join，速度较慢，嵌套层级建议 ≤ 2 层。

---

### Q13：Elasticsearch 集群的健康状态有哪些？Yellow 和 Red 的区别是什么？

**答：**

**三色健康状态**：

```bash
GET /_cluster/health
```

| 状态      | 含义                                   | 可读？ | 可写？ | 风险                     |
| --------- | -------------------------------------- | ------ | ------ | ------------------------ |
| **Green** | 所有主分片和副本分片都正常             | ✅      | ✅      | 无                       |
| **Yellow**| 所有主分片正常，部分副本分片未分配     | ✅      | ✅      | 节点故障可能丢数据       |
| **Red**   | 部分主分片未分配                       | ⚠️ 部分 | ⚠️ 部分 | **已有数据丢失**         |

**Yellow 常见原因**：

- 单节点集群：副本分片无法分配（主副本不能在同一节点）
- 节点数 < 副本数 + 1

**解决方案**：

```json
// 单节点集群：设置副本数为 0
PUT /my-index/_settings
{
  "index": {
    "number_of_replicas": 0
  }
}

// 或增加节点
```

**Red 排查**：

```bash
# 查看未分配的分片
GET /_cat/shards?v&h=index,shard,prirep,state,unassigned.reason

# 解释为何无法分配
GET /_cluster/allocation/explain
{
  "index": "my-index",
  "shard": 0,
  "primary": true
}
```

---

### Q14：如何优化 Elasticsearch 的写入性能？

**答：**

**10 项优化策略**：

| 优化项                  | 配置                                      | 原理                                       |
| ----------------------- | ----------------------------------------- | ------------------------------------------ |
| **Bulk 批量写入**       | 批量大小 5-15MB / 1000-5000 条            | 减少网络开销和索引开销                     |
| **增大 Refresh 间隔**   | `index.refresh_interval: 30s`（默认 1s）  | 减少 Segment 生成频率                      |
| **减少副本数**          | 写入期间设为 0，写完后恢复                | 减少副本同步开销                           |
| **禁用 `_source`**      | `"_source": { "enabled": false }`         | 减少存储（但无法 reindex/update）          |
| **禁用不必要索引**      | `"index": false`（不可搜索但可存储）      | 减少倒排索引大小                           |
| **增大 Translog Flush** | `index.translog.durability: async`        | 异步刷盘（高吞吐，但可能丢数据）           |
| **增大索引缓冲**        | `indices.memory.index_buffer_size: 20%`   | 减少磁盘写入频率                           |
| **使用自动生成 ID**     | 不指定 `_id`，让 ES 自动生成              | 避免版本检查开销                           |
| **分片数规划**          | 单分片 20-50GB，总分片数 = 节点数 × (1-3)| 避免过多小分片                             |
| **禁用字段动态映射**    | `"dynamic": "strict"`                     | 避免字段爆炸                               |

**Bulk 写入示例**：

```bash
POST /_bulk
{ "index": { "_index": "logs" } }
{ "timestamp": "2024-01-01T00:00:00", "level": "INFO" }
{ "index": { "_index": "logs" } }
{ "timestamp": "2024-01-01T00:01:00", "level": "ERROR" }
```

**写入期间配置**：

```json
// 开始导入前
PUT /my-index/_settings
{
  "index": {
    "refresh_interval": "30s",
    "number_of_replicas": 0
  }
}

// 导入完成后
PUT /my-index/_settings
{
  "index": {
    "refresh_interval": "1s",
    "number_of_replicas": 1
  }
}

POST /my-index/_forcemerge?max_num_segments=1
```

---

### Q15：什么是 Segment Merge？为什么需要定期合并？

**答：**

**Segment** 是 Lucene 的最小存储单元，不可变。每次 refresh 生成一个新 Segment。

**问题**：Segment 数量过多导致：

- 打开文件句柄过多
- 搜索需要遍历所有 Segment，性能下降
- 删除的文档占用空间（标记删除，未物理删除）

**Merge 流程**：

```
多个小 Segment → 合并 → 新的大 Segment → 删除旧 Segment
[seg1][seg2][seg3] → [merged_seg] (物理删除标记删除的文档)
```

**合并策略**：

| 策略              | 触发条件                         | 配置参数                       |
| ----------------- | -------------------------------- | ------------------------------ |
| **自动合并**      | 后台持续进行                     | `index.merge.scheduler.max_thread_count` |
| **手动合并**      | 导入完成后、索引不再写入时       | `POST /index/_forcemerge?max_num_segments=1` |

**最佳实践**：

- 只读索引（如历史日志）：forcemerge 到 1 个 Segment
- 活跃索引：让自动合并运行，不要频繁 forcemerge（IO 密集）

```bash
# 查看 Segment 数量
GET /_cat/segments/my-index?v

# 强制合并（仅在索引不再写入时）
POST /my-index/_forcemerge?max_num_segments=1
```

---

## 3. 高级题

### Q16：解释 Elasticsearch 的 Query Context 和 Filter Context 的区别，为什么 Filter Context 性能更好？

**答：**

| 对比项       | Query Context                        | Filter Context                     |
| ------------ | ------------------------------------ | ---------------------------------- |
| 评分         | **计算相关性评分**（_score）         | **不计算评分**（_score = 0）       |
| 缓存         | **不缓存**                           | **自动缓存**（Bitset 缓存）        |
| 适用场景     | 全文搜索（"最相关的文档"）           | 结构化过滤（"符合条件的文档"）     |
| 典型查询     | `match` / `multi_match`              | `term` / `range` / `exists` in `filter` |

**性能差异原因**：

1. **评分开销**：Query Context 需要计算 TF-IDF/BM25，CPU 密集
2. **缓存机制**：Filter Context 的结果以 Bitset（位图）形式缓存在内存中

**Bitset 缓存示例**：

```
Filter: status = "active"
Index 有 100 万文档，1000 个符合条件

Bitset: [0, 0, 1, 0, 1, ..., 0]  ← 1 表示匹配
         └─ 仅占用 100万 / 8 = 125 KB 内存
```

**对比查询**：

```json
// Query Context（慢，不缓存）
GET /products/_search
{
  "query": {
    "bool": {
      "must": [
        { "range": { "price": { "gte": 100 } } }  // 计算评分
      ]
    }
  }
}

// Filter Context（快，缓存）
GET /products/_search
{
  "query": {
    "bool": {
      "filter": [
        { "range": { "price": { "gte": 100 } } }  // 不计算评分，缓存结果
      ]
    }
  }
}
```

**最佳实践**：

- 结构化条件（状态、日期、范围）→ 用 `filter`
- 全文搜索（标题、描述）→ 用 `must` / `should`
- 混合使用：`filter` 过滤 + `must` 评分

---

### Q17：什么是 Fielddata？为什么 text 字段不支持聚合和排序？如何解决？

**答：**

**问题根源**：`text` 字段分词后存储在倒排索引（Term → Doc List），无法高效支持"按原始字段值排序/聚合"。

**Fielddata** 是一种内存数据结构，将倒排索引反向构建为 Doc → Terms 结构，支持聚合/排序。

| 数据结构      | 存储位置   | 用途               | 适用字段类型 |
| ------------- | ---------- | ------------------ | ------------ |
| **Inverted Index** | 磁盘 + 文件系统缓存 | 搜索（Term → Doc） | text / keyword |
| **Doc Values**     | 磁盘（列式存储） | 聚合/排序（Doc → Value） | keyword / number / date |
| **Fielddata**      | **堆内存** | 聚合/排序（Doc → Terms） | text（需手动启用） |

**为什么默认禁用 Fielddata**：

- 占用大量堆内存（GC 压力）
- 首次聚合时延迟高（需构建 Fielddata）
- 容易导致 OOM

**三种解决方案**：

| 方案                  | 配置                                  | 适用场景               |
| --------------------- | ------------------------------------- | ---------------------- |
| **1. 使用 keyword 子字段** | `"fields": { "keyword": { "type": "keyword" } }` | **推荐**，适合绝大部分场景 |
| **2. 启用 Fielddata** | `"fielddata": true`                   | 仅用于低基数字段（如标签） |
| **3. 聚合前过滤**     | 减少聚合文档数                        | 辅助优化               |

**示例：Multi-field 方案（推荐）**

```json
PUT /articles
{
  "mappings": {
    "properties": {
      "tags": {
        "type": "text",  // 支持全文搜索
        "fields": {
          "keyword": {   // 支持聚合/排序
            "type": "keyword"
          }
        }
      }
    }
  }
}

// 聚合时使用 .keyword
GET /articles/_search
{
  "aggs": {
    "popular_tags": {
      "terms": { "field": "tags.keyword" }  // ← 使用 keyword 子字段
    }
  }
}
```

**Fielddata 方案（不推荐）**

```json
PUT /articles/_mapping
{
  "properties": {
    "tags": {
      "type": "text",
      "fielddata": true  // 启用 Fielddata（慎用）
    }
  }
}
```

---

### Q18：如何设计一个电商网站的商品搜索索引？需要考虑哪些因素？

**答：**

**核心考量**：

1. **搜索场景**：全文搜索（标题）、精确过滤（品牌、分类）、范围查询（价格）、聚合分析（分类统计）
2. **性能要求**：亚秒级响应、高并发读取、实时更新库存
3. **数据规模**：百万级商品、每日数十万更新

**完整 Mapping 设计**：

```json
PUT /products
{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 2,
    "refresh_interval": "1s",
    "analysis": {
      "analyzer": {
        "ik_pinyin": {  // 中文 + 拼音分词
          "type": "custom",
          "tokenizer": "ik_max_word",
          "filter": ["lowercase", "pinyin"]
        }
      }
    }
  },
  "mappings": {
    "dynamic": "strict",  // 禁止动态字段
    "properties": {
      "id": { "type": "keyword" },
      "title": {
        "type": "text",
        "analyzer": "ik_pinyin",
        "fields": {
          "keyword": { "type": "keyword" }  // 用于精确匹配和排序
        }
      },
      "brand": { "type": "keyword" },  // 品牌（精确 + 聚合）
      "category": {
        "type": "keyword",
        "fields": {
          "text": {
            "type": "text",
            "analyzer": "ik_smart"  // 支持分类全文搜索
          }
        }
      },
      "price": { "type": "scaled_float", "scaling_factor": 100 },
      "stock": { "type": "integer" },
      "sales": { "type": "integer" },  // 用于排序
      "rating": { "type": "half_float" },
      "tags": { "type": "keyword" },  // 标签数组
      "specs": {  // 规格参数（嵌套对象）
        "type": "nested",
        "properties": {
          "name": { "type": "keyword" },
          "value": { "type": "keyword" }
        }
      },
      "description": {
        "type": "text",
        "analyzer": "ik_smart",
        "index_options": "offsets",  // 支持高亮
        "store": false  // 不存储原始值（从 _source 获取）
      },
      "images": {
        "type": "keyword",
        "index": false  // 不索引（仅展示）
      },
      "status": { "type": "keyword" },  // 上架状态
      "created_at": { "type": "date" },
      "updated_at": { "type": "date" }
    }
  }
}
```

**查询示例**：

```json
GET /products/_search
{
  "query": {
    "bool": {
      "must": [
        {
          "multi_match": {
            "query": "小米蓝牙耳机",
            "fields": ["title^3", "description"],  // title 权重 × 3
            "type": "best_fields"
          }
        }
      ],
      "filter": [
        { "term": { "status": "active" } },
        { "range": { "price": { "gte": 100, "lte": 500 } } },
        { "terms": { "brand": ["小米", "华为"] } }
      ],
      "should": [
        { "term": { "tags": "热销" } }  // 提升热销商品
      ]
    }
  },
  "sort": [
    { "_score": "desc" },
    { "sales": "desc" }
  ],
  "aggs": {
    "by_brand": {
      "terms": { "field": "brand", "size": 20 }
    },
    "price_ranges": {
      "range": {
        "field": "price",
        "ranges": [
          { "to": 100 },
          { "from": 100, "to": 500 },
          { "from": 500 }
        ]
      }
    }
  },
  "highlight": {
    "fields": {
      "title": {},
      "description": {}
    }
  }
}
```

**优化建议**：

- **分片策略**：每分片 20-50GB，总分片数 = 节点数 × 2
- **Routing Key**：按品牌/分类路由，减少跨分片查询
- **别名机制**：`products_v1` → `products` 别名，支持零停机重建索引
- **缓存预热**：高频过滤条件（status=active）放入 filter context

---

### Q19：什么是 Index Lifecycle Management（ILM）？如何用 ILM 管理时序数据？

**答：**

**ILM** 是 ES 的索引生命周期管理工具，自动化索引的创建、滚动、压缩、删除。

**四个生命周期阶段**：

```
Hot → Warm → Cold → Delete
```

| 阶段     | 特征                                   | 节点类型       | 典型配置                     |
| -------- | -------------------------------------- | -------------- | ---------------------------- |
| **Hot**  | 高频写入 + 查询，最新数据              | 高性能 SSD     | 主分片 + 副本                |
| **Warm** | 只读，偶尔查询                         | 普通磁盘       | 减少副本、合并 Segment       |
| **Cold** | 低频访问，长期存储                     | 冷存储         | 冻结索引、Searchable Snapshot |
| **Delete** | 过期数据删除                         | -              | 删除索引                     |

**ILM 策略示例（日志管理）**：

```json
PUT _ilm/policy/logs_policy
{
  "policy": {
    "phases": {
      "hot": {
        "actions": {
          "rollover": {  // 滚动创建新索引
            "max_size": "50GB",
            "max_age": "1d"
          }
        }
      },
      "warm": {
        "min_age": "7d",  // 7 天后进入 warm
        "actions": {
          "forcemerge": {
            "max_num_segments": 1  // 合并 Segment
          },
          "shrink": {
            "number_of_shards": 1  // 减少分片数
          },
          "allocate": {
            "number_of_replicas": 1  // 减少副本
          }
        }
      },
      "cold": {
        "min_age": "30d",  // 30 天后进入 cold
        "actions": {
          "freeze": {}  // 冻结索引（减少内存占用）
        }
      },
      "delete": {
        "min_age": "90d",  // 90 天后删除
        "actions": {
          "delete": {}
        }
      }
    }
  }
}
```

**应用 ILM 策略**：

```json
// 创建索引模板
PUT _index_template/logs_template
{
  "index_patterns": ["logs-*"],
  "template": {
    "settings": {
      "number_of_shards": 3,
      "number_of_replicas": 2,
      "index.lifecycle.name": "logs_policy",  // 绑定 ILM 策略
      "index.lifecycle.rollover_alias": "logs"  // 写入别名
    }
  }
}

// 创建初始索引
PUT logs-000001
{
  "aliases": {
    "logs": {
      "is_write_index": true  // 写入目标
    }
  }
}
```

**写入数据**：

```bash
POST logs/_doc
{
  "timestamp": "2024-01-01T00:00:00",
  "message": "Application started"
}
```

ILM 会自动管理滚动、迁移、删除。

---

### Q20：Elasticsearch 的跨集群搜索（Cross-Cluster Search，CCS）是什么？如何配置？

**答：**

**CCS** 允许从一个集群搜索多个远程集群的数据，常用于：

- 多地域部署（美国 + 欧洲 + 亚洲）
- 历史数据归档（热数据集群 + 冷数据集群）
- 多租户隔离（每个租户一个集群）

**配置步骤**：

**1. 配置远程集群（在本地集群执行）**

```bash
PUT _cluster/settings
{
  "persistent": {
    "cluster": {
      "remote": {
        "cluster_us": {  // 远程集群别名
          "seeds": ["us-node1:9300", "us-node2:9300"]
        },
        "cluster_eu": {
          "seeds": ["eu-node1:9300"]
        }
      }
    }
  }
}
```

**2. 跨集群搜索**

```json
GET cluster_us:products,cluster_eu:products/_search
{
  "query": {
    "match": { "title": "iPhone" }
  }
}

// 同时搜索本地 + 远程
GET products,cluster_us:products/_search
{
  "query": { "match_all": {} }
}
```

**3. 查看远程集群状态**

```bash
GET _remote/info
```

**性能优化**：

- **minimize_roundtrips**：减少网络往返（默认 true）
- **ccs_minimize_roundtrips**：协调节点聚合结果，减少数据传输

```json
GET cluster_us:logs-*/_search?ccs_minimize_roundtrips=true
{
  "query": { "range": { "timestamp": { "gte": "now-1h" } } }
}
```

**限制**：

- 远程集群版本必须 ≤ 本地集群版本
- 不支持跨集群写入（只读）

---

## 4. 场景题

### Q21：设计一个电商网站的商品搜索功能，需要支持以下需求，你会如何设计？

**需求**：

1. 用户输入"小米手机"，需要搜索标题和描述
2. 支持按价格、品牌、分类筛选
3. 支持按销量、价格、评分排序
4. 需要聚合统计（品牌分布、价格区间）
5. 需要高亮显示匹配词
6. 数据量：100 万商品，每日 10 万更新
7. 性能要求：95% 请求 < 200ms

**答：**

**1. 索引设计**

参见 Q18 的 Mapping 设计。

**2. 查询策略**

```json
POST /products/_search
{
  "size": 20,
  "from": 0,
  "query": {
    "function_score": {  // 加入业务评分
      "query": {
        "bool": {
          "must": [
            {
              "multi_match": {
                "query": "小米手机",
                "fields": [
                  "title^3",           // 标题权重 × 3
                  "description",
                  "category.text^2"
                ],
                "type": "best_fields",
                "operator": "or",
                "minimum_should_match": "75%"  // 至少匹配 75% 的词
              }
            }
          ],
          "filter": [
            { "term": { "status": "active" } },
            { "range": { "price": { "gte": 1000, "lte": 5000 } } },
            { "terms": { "brand": ["小米", "华为"] } }
          ],
          "should": [
            { "term": { "tags": "新品" } }
          ]
        }
      },
      "functions": [
        {
          "field_value_factor": {
            "field": "sales",
            "factor": 0.1,
            "modifier": "log1p"  // log(1 + sales)
          }
        },
        {
          "gauss": {  // 时间衰减：越新评分越高
            "created_at": {
              "origin": "now",
              "scale": "30d",
              "decay": 0.5
            }
          }
        }
      ],
      "boost_mode": "sum",
      "score_mode": "sum"
    }
  },
  "sort": [
    { "_score": "desc" },
    { "sales": "desc" }
  ],
  "aggs": {
    "by_brand": {
      "terms": {
        "field": "brand",
        "size": 20,
        "order": { "_count": "desc" }
      },
      "aggs": {
        "avg_price": {
          "avg": { "field": "price" }
        }
      }
    },
    "price_ranges": {
      "range": {
        "field": "price",
        "ranges": [
          { "key": "低价", "to": 1000 },
          { "key": "中价", "from": 1000, "to": 3000 },
          { "key": "高价", "from": 3000 }
        ]
      }
    }
  },
  "highlight": {
    "fields": {
      "title": {
        "pre_tags": ["<em>"],
        "post_tags": ["</em>"]
      },
      "description": {
        "fragment_size": 150,
        "number_of_fragments": 3
      }
    }
  }
}
```

**3. 性能优化**

| 优化项            | 方案                                                                 |
| ----------------- | -------------------------------------------------------------------- |
| **分片策略**      | 3 主分片 × 2 副本，单分片 30GB                                       |
| **路由优化**      | 按 `brand` 路由：`?routing=xiaomi`                                   |
| **Filter 缓存**   | 高频过滤条件（status=active）放入 filter context                     |
| **预热查询**      | 启动时执行常见查询，填充 Cache                                       |
| **慢查询监控**    | `index.search.slowlog.threshold.query.warn: 200ms`                   |
| **分页优化**      | 使用 search_after 代替 from+size                                     |
| **聚合优化**      | `execution_hint: map`（低基数字段），限制聚合结果大小                |

**4. 架构设计**

```
                     负载均衡器
                         ↓
    ┌──────────────────────────────────────┐
    │     协调节点（Coordinating Nodes）    │  ← 3 台，仅路由请求
    └──────────────────────────────────────┘
                         ↓
    ┌──────────────────────────────────────┐
    │      数据节点（Data Nodes）           │  ← 6 台，32GB RAM + SSD
    │  [Shard 0P][Shard 1P][Shard 2P]      │
    │  [Shard 0R][Shard 1R][Shard 2R]      │
    └──────────────────────────────────────┘
                         ↓
    ┌──────────────────────────────────────┐
    │      主节点（Master Nodes）           │  ← 3 台（选举，轻量级）
    └──────────────────────────────────────┘
```

**5. 监控指标**

- 查询延迟 P50/P95/P99
- 慢查询数量
- JVM 堆内存使用率
- GC 暂停时间
- 分片分布均匀性

---

### Q22：线上 Elasticsearch 集群突然变 Red，部分数据不可查询，如何排查和恢复？

**答：**

**排查流程**：

**Step 1：确认集群状态**

```bash
GET /_cluster/health?pretty

{
  "status": "red",
  "number_of_nodes": 5,
  "unassigned_shards": 3  # ← 未分配的分片数
}
```

**Step 2：查看未分配的分片**

```bash
GET /_cat/shards?v&h=index,shard,prirep,state,unassigned.reason | grep UNASSIGNED

# 输出示例
products  0  p  UNASSIGNED  NODE_LEFT        ← 主分片，节点离开
products  1  r  UNASSIGNED  ALLOCATION_FAILED
```

**Step 3：解释为何无法分配**

```bash
GET /_cluster/allocation/explain
{
  "index": "products",
  "shard": 0,
  "primary": true
}

# 可能的原因：
# - NODE_LEFT: 节点宕机，主分片丢失
# - ALLOCATION_FAILED: 磁盘空间不足
# - REPLICA_NOT_PROMOTED: 副本分片损坏，无法提升为主分片
```

**常见原因与解决方案**：

| 原因                         | 现象                       | 解决方案                                                                 |
| ---------------------------- | -------------------------- | ------------------------------------------------------------------------ |
| **节点宕机**                 | 主分片未分配               | 1. 重启节点<br>2. 若节点无法恢复，从快照恢复                             |
| **磁盘空间不足**             | `ALLOCATION_FAILED`        | 清理磁盘或增加节点                                                       |
| **副本分片损坏**             | 副本无法提升为主分片       | 使用 `reroute` API 强制分配 + `allocate_empty_primary`（数据丢失）      |
| **分片损坏（Shard Corruption）** | 分片无法打开           | 从快照恢复                                                               |

**Step 4：强制分配分片（最后手段）**

```bash
# 前提：确认数据已丢失，强制分配空的主分片
POST /_cluster/reroute
{
  "commands": [
    {
      "allocate_empty_primary": {
        "index": "products",
        "shard": 0,
        "node": "node-1",
        "accept_data_loss": true  # ← 确认数据丢失
      }
    }
  ]
}
```

**Step 5：从快照恢复（推荐）**

```bash
# 1. 关闭索引
POST /products/_close

# 2. 恢复快照
POST /_snapshot/my_backup/snapshot_20240101/_restore
{
  "indices": "products"
}

# 3. 重新打开索引
POST /products/_open
```

**预防措施**：

- 至少 2 个副本分片
- 定期快照（每日/每周）
- 监控磁盘空间（预警阈值 85%）
- 使用专用主节点（防止脑裂）

---

### Q23：如何实现 Elasticsearch 的搜索建议（Search Suggestions / Autocomplete）功能？

**答：**

**需求**：用户输入"iph"，实时返回建议["iPhone 14", "iPhone 13 Pro", "iPad"]

**三种实现方案**：

| 方案                  | 原理                                   | 优点               | 缺点                     |
| --------------------- | -------------------------------------- | ------------------ | ------------------------ |
| **Prefix Query**      | 前缀匹配（`prefix` query）             | 简单               | 性能差（扫描所有词）     |
| **Edge N-gram**       | 建索引时预生成前缀（"i", "ip", "iph"）| 快速               | 索引膨胀                 |
| **Completion Suggester** | 专用 FST（有限状态机）数据结构      | **最快**，推荐     | 只支持前缀匹配           |

**推荐方案：Completion Suggester**

**Mapping 设计**：

```json
PUT /products
{
  "mappings": {
    "properties": {
      "title": { "type": "text" },
      "suggest": {
        "type": "completion",  // ← Completion 类型
        "contexts": [
          {
            "name": "category",
            "type": "category"  // 支持分类过滤
          }
        ]
      }
    }
  }
}
```

**写入数据**：

```json
POST /products/_doc/1
{
  "title": "iPhone 14 Pro Max",
  "suggest": {
    "input": ["iPhone 14", "iPhone 14 Pro", "iPhone 14 Pro Max"],
    "weight": 100,  // 权重（越高越优先）
    "contexts": {
      "category": ["手机"]
    }
  }
}
```

**搜索建议**：

```json
POST /products/_search
{
  "suggest": {
    "product_suggest": {
      "prefix": "iph",  // 用户输入
      "completion": {
        "field": "suggest",
        "size": 5,
        "skip_duplicates": true,
        "contexts": {
          "category": ["手机"]  // 过滤分类
        }
      }
    }
  }
}

// 响应
{
  "suggest": {
    "product_suggest": [
      {
        "options": [
          {
            "text": "iPhone 14 Pro Max",
            "_score": 100,
            "_source": { "title": "iPhone 14 Pro Max" }
          },
          {
            "text": "iPhone 14 Pro",
            "_score": 90
          }
        ]
      }
    ]
  }
}
```

**优化建议**：

- **拼音支持**：结合拼音分词器，支持"pingguo" → "苹果"
- **纠错（Fuzzy）**：`"fuzzy": { "fuzziness": 1 }`，支持容错 1 个字符
- **权重设计**：热门商品权重更高（基于销量/点击率）

**前端集成**：

```javascript
// 用户输入时实时调用
const fetchSuggestions = async (query) => {
  const response = await fetch('/products/_search', {
    method: 'POST',
    body: JSON.stringify({
      suggest: {
        product_suggest: {
          prefix: query,
          completion: { field: 'suggest', size: 5 }
        }
      }
    })
  });
  return response.json();
};
```

---

### Q24：如何监控和调优 Elasticsearch 集群的性能？

**答：**

**监控指标体系**：

| 监控层级         | 关键指标                                  | 告警阈值                     | 工具                     |
| ---------------- | ----------------------------------------- | ---------------------------- | ------------------------ |
| **集群健康**     | status（Green/Yellow/Red）                | Yellow > 5min, Red 立即      | `_cluster/health`        |
| **节点资源**     | CPU / 内存 / 磁盘 / JVM 堆                | Heap > 85%, Disk > 85%       | `_nodes/stats`           |
| **搜索性能**     | 查询延迟 P50/P95/P99 / 慢查询数           | P95 > 500ms                  | `_nodes/stats`, Slowlog  |
| **索引性能**     | 索引速率 / Bulk 拒绝数                    | Bulk Rejected > 100/min      | `_nodes/stats`           |
| **分片状态**     | 未分配分片 / 重定位中分片                 | Unassigned > 0               | `_cat/shards`            |
| **GC 性能**      | GC 暂停时间 / Young GC 频率               | GC > 1s                      | `_nodes/stats/jvm`       |

**监控工具**：

```bash
# 1. 集群健康
GET /_cluster/health

# 2. 节点统计
GET /_nodes/stats

# 3. 慢查询日志
GET /_nodes/stats/indices/search?pretty

# 4. 热点线程（CPU 高时）
GET /_nodes/hot_threads

# 5. Pending Tasks（任务队列积压）
GET /_cluster/pending_tasks
```

**调优策略**：

**1. JVM 调优**

```yaml
# elasticsearch.yml
-Xms16g
-Xmx16g  # Heap 大小 = 物理内存的 50%，且 ≤ 31GB（避免指针压缩失效）

# GC 调优（使用 G1GC）
-XX:+UseG1GC
-XX:MaxGCPauseMillis=200
```

**2. 查询调优**

| 问题                 | 表现                       | 解决方案                                                                 |
| -------------------- | -------------------------- | ------------------------------------------------------------------------ |
| **慢查询**           | P95 延迟高                 | 1. 增加副本分片（提升并发）<br>2. 优化查询（filter context）<br>3. 分页优化 |
| **深分页**           | from=10000 超时            | 使用 search_after 或 Scroll API                                          |
| **聚合慢**           | 高基数字段聚合慢           | 1. `execution_hint: map`<br>2. 限制聚合大小<br>3. 预聚合（Rollup）      |

**3. 索引调优**

```json
// 写入期间配置
PUT /logs/_settings
{
  "index": {
    "refresh_interval": "30s",  // 减少 Refresh 频率
    "number_of_replicas": 0,    // 写入期间关闭副本
    "translog": {
      "durability": "async",    // 异步刷盘
      "sync_interval": "30s"
    }
  }
}

// 写入完成后
PUT /logs/_settings
{
  "index": {
    "refresh_interval": "1s",
    "number_of_replicas": 1
  }
}
```

**4. 分片优化**

```bash
# 过多小分片：合并分片
POST /logs-2024.01/_shrink/logs-2024.01-shrunk
{
  "settings": {
    "index.number_of_shards": 1
  }
}

# 分片分布不均
POST /_cluster/reroute?retry_failed=true
```

**5. 监控告警（Prometheus + Grafana）**

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'elasticsearch'
    static_configs:
      - targets: ['es-node1:9200', 'es-node2:9200']
    metrics_path: '/_prometheus/metrics'  # Elasticsearch Exporter
```

---

## 总结

**高频必考点（按优先级）**：

1. **倒排索引原理**（Q1）
2. **text vs keyword + match vs term**（Q3, Q4）
3. **分片与副本**（Q5）
4. **bool 查询**（Q9）
5. **深分页优化**（Q11）
6. **Query Context vs Filter Context**（Q16）
7. **电商搜索设计**（Q18, Q21）

**面试收尾建议**：

- 强调**生产实践**：提及真实项目中的集群规模、数据量、QPS
- 展示**排查能力**：描述曾遇到的 Red 状态、慢查询排查过程
- 讨论**选型思路**：ES vs Solr vs PostgreSQL Full-Text Search 的场景对比
- 关注**版本特性**：ES 7/8 的新特性（如 Searchable Snapshots、Data Streams）
