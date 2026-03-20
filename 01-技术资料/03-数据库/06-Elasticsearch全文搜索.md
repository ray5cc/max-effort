# Elasticsearch 全文搜索引擎深度解析

> Elasticsearch 是分布式全文搜索引擎——当你需要在海量文档中秒级找到"相关内容"时,传统数据库的 LIKE 查询已经无能为力。理解倒排索引、分词器、分布式架构,就是理解如何构建可扩展的搜索系统,从日志分析到 RAG 检索,Elasticsearch 都是事实标准。

## 相关链接
- 对应面试题:[Elasticsearch 面试题](../../../02-面试指南/03-数据库面试/06-Elasticsearch面试题.md)

## 目录
1. [为什么需要全文搜索引擎](#1-为什么需要全文搜索引擎)
2. [倒排索引原理](#2-倒排索引原理)
   - 2.1 [正排索引 vs 倒排索引](#21-正排索引-vs-倒排索引)
   - 2.2 [倒排索引的数据结构](#22-倒排索引的数据结构)
   - 2.3 [索引构建流程](#23-索引构建流程)
3. [Analyzer 与分词](#3-analyzer-与分词)
   - 3.1 [Analyzer 三大组件](#31-analyzer-三大组件)
   - 3.2 [中文分词挑战](#32-中文分词挑战)
   - 3.3 [内置 Analyzer 对比](#33-内置-analyzer-对比)
4. [Mapping 映射设计](#4-mapping-映射设计)
   - 4.1 [动态映射与显式映射](#41-动态映射与显式映射)
   - 4.2 [核心字段类型](#42-核心字段类型)
   - 4.3 [text vs keyword](#43-text-vs-keyword)
5. [Query DSL 查询语言](#5-query-dsl-查询语言)
   - 5.1 [查询类型分类](#51-查询类型分类)
   - 5.2 [全文查询详解](#52-全文查询详解)
   - 5.3 [复合查询 bool](#53-复合查询-bool)
   - 5.4 [相关性评分 TF-IDF 与 BM25](#54-相关性评分-tf-idf-与-bm25)
6. [Aggregation 聚合框架](#6-aggregation-聚合框架)
   - 6.1 [Bucket Aggregation](#61-bucket-aggregation)
   - 6.2 [Metric Aggregation](#62-metric-aggregation)
   - 6.3 [Pipeline Aggregation](#63-pipeline-aggregation)
7. [分布式架构](#7-分布式架构)
   - 7.1 [核心概念](#71-核心概念)
   - 7.2 [分片分配机制](#72-分片分配机制)
   - 7.3 [写入流程](#73-写入流程)
   - 7.4 [搜索流程](#74-搜索流程)
8. [副本与故障恢复](#8-副本与故障恢复)
   - 8.1 [副本一致性模型](#81-副本一致性模型)
   - 8.2 [故障检测与恢复](#82-故障检测与恢复)
9. [性能优化](#9-性能优化)
   - 9.1 [写入性能优化](#91-写入性能优化)
   - 9.2 [查询性能优化](#92-查询性能优化)
   - 9.3 [索引生命周期管理](#93-索引生命周期管理)
10. [混合搜索与向量检索](#10-混合搜索与向量检索)
    - 10.1 [Dense Vector 字段](#101-dense-vector-字段)
    - 10.2 [kNN 搜索](#102-knn-搜索)
    - 10.3 [Hybrid Search 实现](#103-hybrid-search-实现)
11. [实践案例](#11-实践案例)
    - 11.1 [RAG 系统中的 Elasticsearch](#111-rag-系统中的-elasticsearch)
    - 11.2 [日志分析与 ELK Stack](#112-日志分析与-elk-stack)

---

## 1. 为什么需要全文搜索引擎

### 1.1 传统数据库的局限

假设你在维护一个文档管理系统,用户想搜索"Python 异步编程",使用 MySQL 可能会这样写:

```sql
SELECT * FROM documents
WHERE content LIKE '%Python%' AND content LIKE '%异步%';
```

**问题：**

1. **性能灾难**：`LIKE '%keyword%'` 无法使用 B+树索引,只能全表扫描。100万文档的表查询需要数十秒
2. **零语言理解**：搜 "Python" 找不到 "python"、"py"、"Python3"
3. **无相关性排序**：匹配到的结果没有"最相关"概念,只能按 ID 或时间排序
4. **无分词能力**：中文 "异步编程" 如果文档中是 "异步 IO 编程",就完全匹配不到

### 1.2 Elasticsearch 的解决方案

Elasticsearch 基于 Apache Lucene,为全文搜索而生:

| 需求 | MySQL | Elasticsearch |
|------|-------|--------------|
| 大文本搜索性能 | 全表扫描,秒级延迟 | 倒排索引,毫秒级响应 |
| 模糊匹配 | 手动 LIKE | 分词器自动处理 |
| 相关性排序 | 无 | BM25/TF-IDF 算法 |
| 中文分词 | 无 | IK/jieba 分词器 |
| 分布式扩展 | 分库分表复杂 | 自动分片 |
| 实时聚合分析 | GROUP BY 慢 | Aggregation 框架 |

**类比：**
- **MySQL B+树索引** = 图书馆的书架编号,只能按"书名""作者"精确查找
- **Elasticsearch 倒排索引** = 书籍的关键词索引,可以输入任何概念快速定位所有相关书籍

---

## 2. 倒排索引原理

### 2.1 正排索引 vs 倒排索引

**正排索引（Forward Index）**：传统数据库的做法

```
文档ID → 内容
Doc1 → "Elasticsearch is fast"
Doc2 → "Lucene is a library"
Doc3 → "Elasticsearch uses Lucene"
```

搜索 "Elasticsearch" 需要遍历所有文档（O(N)）。

**倒排索引（Inverted Index）**：将词映射到文档

```
词项(Term) → 文档列表(Posting List)
elasticsearch → [Doc1, Doc3]
fast          → [Doc1]
lucene        → [Doc2, Doc3]
library       → [Doc2]
uses          → [Doc3]
```

搜索 "Elasticsearch" 直接查词典得到 `[Doc1, Doc3]`（O(1) 查词典 + O(M) 合并结果,M 为匹配文档数）。

**类比：**
- **正排索引** = 书籍按章节编号,要找"机器学习"得翻遍全书
- **倒排索引** = 书末的关键词索引,"机器学习: 第3章、第8章、第15章",瞬间定位

### 2.2 倒排索引的数据结构

Lucene 倒排索引包含三个核心数据结构:

#### Term Dictionary（词典）

存储所有词项,Lucene 用 **FST（Finite State Transducer）** 实现:

```
词项    → 文件偏移量
-------   -----------
apple   →  1024
apply   →  2048
banana  →  3072
```

FST 特点:
- 有序存储,支持前缀查询（"app*" 找到 apple、apply）
- 极度压缩,千万级词项只需几十MB
- 查询复杂度 O(k),k 为词项长度

#### Posting List（倒排列表）

存储包含该词的文档 ID 列表 + 位置信息:

```
Term: "elasticsearch"
Posting List:
  DocID: 1  → [pos: 0]
  DocID: 3  → [pos: 0]
  DocID: 7  → [pos: 5]
```

**压缩技术：**

1. **Delta Encoding（增量编码）**：存储文档 ID 差值

```
原始: [1, 3, 7, 9, 100]
存储: [1, 2, 4, 2, 91]  ← 小数字更易压缩
```

2. **Variable Byte Encoding**：小数字用更少字节

```
1   → 0000 0001          (1字节)
128 → 1000 0001 0000 0000 (2字节)
```

#### Doc Values（正排数据）

用于排序、聚合等需要"文档 → 字段值"的操作（列式存储）:

```
DocID → field_value
1     → 1500
2     → 2300
3     → 1800
```

### 2.3 索引构建流程

```
文档 "Elasticsearch is fast"
    ↓
[1] Analysis（分析阶段）
    ↓ Character Filter（字符过滤）
    "Elasticsearch is fast"  # 保持不变
    ↓ Tokenizer（分词）
    ["Elasticsearch", "is", "fast"]
    ↓ Token Filter（词项过滤）
    ["elasticsearch", "fast"]  # is 被停用词过滤，全部小写
    ↓
[2] 构建倒排索引
    Term         Posting List
    elasticsearch → [Doc1]
    fast          → [Doc1]
    ↓
[3] 写入 Segment
    内存 Buffer → Refresh → Filesystem Cache → Flush → Disk
```

**Segment 不可变性：**

Lucene 的 Segment 文件一旦写入就**永不修改**,这带来:
- **优势**：无需锁,多线程并发读取；操作系统文件缓存高效
- **更新策略**：新增文档写新 Segment,删除文档打删除标记；后台定期 Merge

---

## 3. Analyzer 与分词

### 3.1 Analyzer 三大组件

Analyzer（分析器）将文本转为可搜索的词项,包含三个阶段:

```
原始文本: "The Quick BROWN foxes jumped! <html>"
    ↓
[1] Character Filter（字符过滤）
    - html_strip: 去掉 <html>
    - mapping:    BROWN → brown
    结果: "The Quick brown foxes jumped!"
    ↓
[2] Tokenizer（分词器）
    - standard: 按空格/标点分割
    结果: ["The", "Quick", "brown", "foxes", "jumped"]
    ↓
[3] Token Filter（词项过滤）
    - lowercase:  全部小写
    - stop:       移除 "The"
    - stemmer:    jumped → jump, foxes → fox
    结果: ["quick", "brown", "fox", "jump"]
```

**测试 Analyzer：**

```json
POST _analyze
{
  "analyzer": "standard",
  "text": "The Quick BROWN foxes jumped!"
}
```

返回:

```json
{
  "tokens": [
    {"token": "the", "position": 0},
    {"token": "quick", "position": 1},
    {"token": "brown", "position": 2},
    {"token": "foxes", "position": 3},
    {"token": "jumped", "position": 4}
  ]
}
```

### 3.2 中文分词挑战

中文没有天然分隔符,同一句子可能有多种分词方式:

```
原文: "我爱北京天安门"

分词方案1: ["我", "爱", "北京", "天安门"]
分词方案2: ["我", "爱", "北京天安门"]
分词方案3: ["我爱", "北京", "天安门"]
```

**IK Analyzer** 是最流行的 ES 中文分词器:

```json
POST _analyze
{
  "analyzer": "ik_smart",
  "text": "我是中国人,我爱我的祖国"
}

{
  "tokens": [
    {"token": "我"},
    {"token": "是"},
    {"token": "中国人"},  # 粗粒度分词
    {"token": "我"},
    {"token": "爱"},
    {"token": "我的"},
    {"token": "祖国"}
  ]
}
```

```json
POST _analyze
{
  "analyzer": "ik_max_word",
  "text": "我是中国人,我爱我的祖国"
}

{
  "tokens": [
    {"token": "我"},
    {"token": "是"},
    {"token": "中国人"},
    {"token": "中国"},    # 细粒度分词
    {"token": "国人"},
    {"token": "我"},
    {"token": "爱"},
    {"token": "我的"},
    {"token": "祖国"}
  ]
}
```

**选择建议：**
- **ik_smart**：召回率低,精确度高（搜索"中国"不会匹配"中国人"）
- **ik_max_word**：召回率高,可能有噪声（适合搜索场景）

### 3.3 内置 Analyzer 对比

| Analyzer | 功能 | 示例输入 | 输出 |
|----------|------|---------|------|
| standard | 标准分词,按空格/标点分割 | "Quick-foxes" | ["quick", "foxes"] |
| simple | 非字母分割,全小写 | "Quick_Foxes123" | ["quick", "foxes"] |
| whitespace | 仅按空格分割,不小写 | "Quick Foxes" | ["Quick", "Foxes"] |
| stop | standard + 停用词过滤 | "The quick fox" | ["quick", "fox"] |
| keyword | 不分词,整体作为一个词 | "hello world" | ["hello world"] |
| pattern | 正则表达式分词 | "foo-123-bar" | ["foo", "123", "bar"] |
| language | 特定语言（如 english）| "foxes running" | ["fox", "run"] |

**自定义 Analyzer：**

```json
PUT my_index
{
  "settings": {
    "analysis": {
      "analyzer": {
        "my_analyzer": {
          "type": "custom",
          "char_filter": ["html_strip"],
          "tokenizer": "standard",
          "filter": ["lowercase", "stop", "snowball"]
        }
      }
    }
  }
}
```

---

## 4. Mapping 映射设计

### 4.1 动态映射与显式映射

**动态映射（Dynamic Mapping）**：ES 自动推断字段类型

```json
POST articles/_doc/1
{
  "title": "Elasticsearch Guide",
  "price": 29.99,
  "published": "2024-01-01"
}
```

ES 自动生成 Mapping:

```json
{
  "mappings": {
    "properties": {
      "title":     {"type": "text"},      # 字符串 → text
      "price":     {"type": "float"},     # 小数 → float
      "published": {"type": "date"}       # 日期格式 → date
    }
  }
}
```

**问题：**
- 数字 ID "123" 可能被推断为 long,导致无法做精确匹配
- 需要 keyword 类型的字段被推断成 text

**显式映射（Explicit Mapping）**：

```json
PUT articles
{
  "mappings": {
    "properties": {
      "title": {
        "type": "text",
        "analyzer": "ik_max_word",
        "fields": {
          "keyword": {"type": "keyword"}  # Multi-field
        }
      },
      "product_id": {"type": "keyword"},
      "price": {"type": "scaled_float", "scaling_factor": 100},
      "tags": {"type": "keyword"},
      "published": {"type": "date", "format": "yyyy-MM-dd"}
    }
  }
}
```

### 4.2 核心字段类型

#### 文本类型

| 类型 | 分词 | 用途 | 示例 |
|------|------|------|------|
| text | 是 | 全文搜索 | 文章内容、商品描述 |
| keyword | 否 | 精确匹配、聚合、排序 | ID、邮箱、状态码 |

#### 数值类型

```json
{
  "age": {"type": "integer"},           # -2^31 ~ 2^31-1
  "price": {"type": "scaled_float", "scaling_factor": 100},  # 节省空间
  "stock": {"type": "long"}
}
```

#### 日期类型

```json
{
  "created_at": {
    "type": "date",
    "format": "yyyy-MM-dd HH:mm:ss||epoch_millis"  # 支持多种格式
  }
}
```

#### 对象类型

```json
{
  "user": {
    "type": "object",
    "properties": {
      "name": {"type": "text"},
      "age": {"type": "integer"}
    }
  }
}
```

存储为扁平化:

```json
{
  "user.name": "Alice",
  "user.age": 30
}
```

#### Nested 类型（嵌套对象）

解决 Object 类型的多值问题:

```json
# 错误案例：使用 object 类型
PUT products/_doc/1
{
  "comments": [
    {"author": "Alice", "rating": 5},
    {"author": "Bob", "rating": 2}
  ]
}

# 查询：rating=5 且 author=Bob
GET products/_search
{
  "query": {
    "bool": {
      "must": [
        {"match": {"comments.author": "Bob"}},
        {"match": {"comments.rating": 5}}
      ]
    }
  }
}
# 错误！会匹配到 Doc1（因为扁平化后失去关联）
```

**正确做法：使用 nested**

```json
PUT products
{
  "mappings": {
    "properties": {
      "comments": {
        "type": "nested",
        "properties": {
          "author": {"type": "keyword"},
          "rating": {"type": "integer"}
        }
      }
    }
  }
}

# 使用 nested 查询
GET products/_search
{
  "query": {
    "nested": {
      "path": "comments",
      "query": {
        "bool": {
          "must": [
            {"term": {"comments.author": "Bob"}},
            {"term": {"comments.rating": 5}}
          ]
        }
      }
    }
  }
}
# 正确！不会匹配到 Doc1
```

### 4.3 text vs keyword

**Multi-field 最佳实践：**

```json
{
  "title": {
    "type": "text",
    "analyzer": "ik_max_word",
    "fields": {
      "keyword": {
        "type": "keyword",
        "ignore_above": 256  # 超过256字符不索引
      }
    }
  }
}
```

使用场景:

```json
# 全文搜索：使用 text 字段
GET articles/_search
{
  "query": {
    "match": {"title": "Elasticsearch 教程"}
  }
}

# 精确匹配/聚合/排序：使用 keyword 子字段
GET articles/_search
{
  "query": {
    "term": {"title.keyword": "Elasticsearch 教程"}
  },
  "aggs": {
    "popular_titles": {
      "terms": {"field": "title.keyword"}
    }
  }
}
```

---

## 5. Query DSL 查询语言

### 5.1 查询类型分类

Elasticsearch 查询分为两大类:

| 类型 | 是否计算相关性 | 可缓存 | 用途 |
|------|--------------|--------|------|
| **Query Context** | 是（TF-IDF/BM25） | 否 | 全文搜索 |
| **Filter Context** | 否（仅 yes/no） | 是 | 精确过滤 |

```json
GET articles/_search
{
  "query": {
    "bool": {
      "must": [                          # Query Context
        {"match": {"content": "elasticsearch"}}
      ],
      "filter": [                        # Filter Context
        {"term": {"status": "published"}},
        {"range": {"price": {"gte": 10}}}
      ]
    }
  }
}
```

### 5.2 全文查询详解

#### match 查询（最常用）

```json
GET articles/_search
{
  "query": {
    "match": {
      "content": {
        "query": "Elasticsearch distributed search",
        "operator": "and"  # 默认 or
      }
    }
  }
}
```

**分析过程：**

```
查询文本: "Elasticsearch distributed search"
    ↓ 分词（使用字段的 analyzer）
词项: ["elasticsearch", "distributed", "search"]
    ↓ operator=and
构建查询: content 必须包含全部三个词
    ↓ operator=or（默认）
构建查询: content 包含任意一个词即可
```

#### match_phrase（短语查询）

要求词项顺序一致:

```json
GET articles/_search
{
  "query": {
    "match_phrase": {
      "content": {
        "query": "quick brown fox",
        "slop": 1  # 允许词项间隔1个位置
      }
    }
  }
}
```

匹配案例:

```
slop=0: "quick brown fox" ✓
        "quick red brown fox" ✗

slop=1: "quick brown fox" ✓
        "quick red brown fox" ✓  ← red 在中间，间隔1
        "quick very red brown fox" ✗  ← 间隔2
```

#### multi_match（多字段查询）

```json
GET articles/_search
{
  "query": {
    "multi_match": {
      "query": "elasticsearch",
      "fields": ["title^3", "content"],  # title 权重3倍
      "type": "best_fields"               # 取最佳字段的分数
    }
  }
}
```

**type 参数：**

| 类型 | 行为 | 适用场景 |
|------|------|---------|
| best_fields | 取最高分字段 | 单个字段高度相关 |
| most_fields | 累加所有字段分数 | 多字段都相关 |
| cross_fields | 跨字段分析词项 | 姓+名分开存储 |

#### query_string（高级语法）

支持布尔操作符:

```json
GET articles/_search
{
  "query": {
    "query_string": {
      "query": "(Elasticsearch OR Solr) AND distributed -mongodb",
      "default_field": "content"
    }
  }
}
```

### 5.3 复合查询 bool

bool 查询是构建复杂查询的核心:

```json
GET articles/_search
{
  "query": {
    "bool": {
      "must": [                             # 必须匹配（计算相关性）
        {"match": {"content": "elasticsearch"}}
      ],
      "should": [                           # 应该匹配（提高分数）
        {"match": {"content": "distributed"}},
        {"term": {"tags": "search"}}
      ],
      "must_not": [                         # 必须不匹配（Filter Context）
        {"term": {"status": "draft"}}
      ],
      "filter": [                           # 必须匹配（不计算分数）
        {"range": {"price": {"gte": 10, "lte": 100}}},
        {"term": {"category": "tech"}}
      ],
      "minimum_should_match": 1             # should 至少匹配1条
    }
  }
}
```

**评分逻辑：**

```
总分 = sum(must 子句分数) + sum(should 子句分数)
filter 和 must_not 不贡献分数，仅过滤
```

### 5.4 相关性评分 TF-IDF 与 BM25

#### TF-IDF（ES 5.x 之前）

```
score = TF(词频) × IDF(逆文档频率) × field_norm

TF(term, doc)  = sqrt(term在文档中出现次数)
IDF(term)      = log(文档总数 / 包含term的文档数)
field_norm     = 1 / sqrt(字段长度)
```

**直觉：**
- **TF**：词出现越多,越相关（但用 sqrt 防止过度放大）
- **IDF**：词越罕见,越重要（"的"、"是" IDF很低）
- **field_norm**：短文档惩罚系数小（避免长文档天然高分）

#### BM25（ES 5.0+ 默认）

```
score(d, q) = ∑ IDF(qi) × TF(qi, d) × (k1 + 1)
                          / (TF(qi, d) + k1 × (1 - b + b × |d| / avgdl))

k1 = 1.2   # 词频饱和参数（TF 上限）
b  = 0.75  # 文档长度归一化因子
```

**改进：**

1. **TF 饱和**：词出现10次 vs 100次分数差距不大（防止堆砌关键词）
2. **可调长度惩罚**：b=0 无惩罚,b=1 全惩罚（可针对场景调优）

**调整 BM25 参数：**

```json
PUT articles
{
  "settings": {
    "index": {
      "similarity": {
        "my_bm25": {
          "type": "BM25",
          "k1": 1.5,   # 提高 TF 影响
          "b": 0.5     # 减少长度惩罚
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "content": {
        "type": "text",
        "similarity": "my_bm25"
      }
    }
  }
}
```

**查看评分解释：**

```json
GET articles/_search
{
  "query": {"match": {"content": "elasticsearch"}},
  "explain": true  # 显示每个字段的评分计算过程
}
```

---

## 6. Aggregation 聚合框架

Aggregation 是 ES 的实时分析引擎,类比 SQL 的 GROUP BY + 聚合函数。

### 6.1 Bucket Aggregation（桶聚合）

将文档分组到不同的桶中。

#### terms（分组统计）

```json
GET products/_search
{
  "size": 0,  # 不返回原始文档
  "aggs": {
    "popular_brands": {
      "terms": {
        "field": "brand.keyword",
        "size": 10,
        "order": {"_count": "desc"}
      }
    }
  }
}
```

返回:

```json
{
  "aggregations": {
    "popular_brands": {
      "buckets": [
        {"key": "Apple", "doc_count": 1500},
        {"key": "Samsung", "doc_count": 1200}
      ]
    }
  }
}
```

#### range（区间统计）

```json
GET products/_search
{
  "aggs": {
    "price_ranges": {
      "range": {
        "field": "price",
        "ranges": [
          {"to": 50},
          {"from": 50, "to": 100},
          {"from": 100}
        ]
      }
    }
  }
}
```

#### date_histogram（时间直方图）

```json
GET logs/_search
{
  "aggs": {
    "daily_requests": {
      "date_histogram": {
        "field": "timestamp",
        "calendar_interval": "day",
        "format": "yyyy-MM-dd"
      }
    }
  }
}
```

**calendar_interval vs fixed_interval：**

| 类型 | 示例 | 说明 |
|------|------|------|
| calendar_interval | "day", "month" | 考虑夏令时、月份天数差异 |
| fixed_interval | "24h", "30d" | 固定时长 |

### 6.2 Metric Aggregation（指标聚合）

#### 单值指标

```json
GET products/_search
{
  "aggs": {
    "avg_price": {"avg": {"field": "price"}},
    "max_price": {"max": {"field": "price"}},
    "total_sales": {"sum": {"field": "sales"}},
    "distinct_brands": {"cardinality": {"field": "brand.keyword"}}  # 去重计数
  }
}
```

#### 多值指标（stats/extended_stats）

```json
GET products/_search
{
  "aggs": {
    "price_stats": {
      "extended_stats": {"field": "price"}
    }
  }
}
```

返回:

```json
{
  "aggregations": {
    "price_stats": {
      "count": 1000,
      "min": 9.99,
      "max": 999.99,
      "avg": 149.5,
      "sum": 149500,
      "sum_of_squares": 30000000,
      "variance": 5000,
      "std_deviation": 70.71,
      "std_deviation_bounds": {
        "upper": 291.0,
        "lower": 8.0
      }
    }
  }
}
```

### 6.3 Pipeline Aggregation（管道聚合）

对其他聚合结果再聚合。

#### bucket_sort（桶排序+分页）

```json
GET products/_search
{
  "aggs": {
    "brands": {
      "terms": {"field": "brand.keyword"},
      "aggs": {
        "avg_price": {"avg": {"field": "price"}},
        "top_brands": {
          "bucket_sort": {
            "sort": [{"avg_price": {"order": "desc"}}],
            "size": 5  # 只保留前5个桶
          }
        }
      }
    }
  }
}
```

#### derivative（导数/变化率）

```json
GET sales/_search
{
  "aggs": {
    "daily_sales": {
      "date_histogram": {
        "field": "date",
        "calendar_interval": "day"
      },
      "aggs": {
        "total": {"sum": {"field": "amount"}},
        "growth": {
          "derivative": {"buckets_path": "total"}  # 计算每日增长
        }
      }
    }
  }
}
```

#### moving_avg（移动平均）

```json
GET logs/_search
{
  "aggs": {
    "hourly_errors": {
      "date_histogram": {
        "field": "timestamp",
        "fixed_interval": "1h"
      },
      "aggs": {
        "error_count": {
          "filter": {"term": {"level": "ERROR"}}
        },
        "smoothed": {
          "moving_avg": {
            "buckets_path": "error_count",
            "window": 24,  # 24小时窗口
            "model": "simple"
          }
        }
      }
    }
  }
}
```

---

## 7. 分布式架构

### 7.1 核心概念

```
Cluster (集群)
    ↓
Node (节点)
    ↓
Index (索引)  ≈ 数据库的表
    ↓
Shard (分片)
    ↓ Primary Shard (主分片)
    ↓ Replica Shard (副本分片)
    ↓
Segment (段)  ← Lucene 不可变索引文件
```

**类比：**
- **Index** = 图书馆的某个分馆（如"科技分馆"）
- **Shard** = 分馆中的一个书架区域（物理分割）
- **Replica** = 另一个分馆的备份书架（高可用）
- **Segment** = 书架上的一本本书（不可修改,只能换新书）

#### Index（索引）

逻辑概念,类似数据库的表:

```json
PUT products  # 创建索引
```

#### Shard（分片）

Index 的物理分片,每个 Shard 是一个独立的 Lucene 实例:

```json
PUT products
{
  "settings": {
    "number_of_shards": 3,      # 主分片数（创建后不可改）
    "number_of_replicas": 1     # 每个主分片的副本数（可动态修改）
  }
}
```

**分片分配：**

```
3 个主分片 + 1 副本 = 6 个 Shard

Node1: [P0, R1, R2]  ← P=Primary, R=Replica
Node2: [P1, R0, R2]
Node3: [P2, R0, R1]
```

规则:
- 主分片和其副本**永不**在同一节点
- 数据写入主分片,同步到副本

### 7.2 分片分配机制

Master 节点负责分片分配,遵循以下策略:

1. **均衡分布**：各节点 Shard 数量尽量相等
2. **同 Index 分片分散**：同一 Index 的分片尽量分布在不同节点
3. **副本不与主分片同节点**
4. **磁盘水位线**：
   - `cluster.routing.allocation.disk.watermark.low: 85%`：新分片不分配到该节点
   - `cluster.routing.allocation.disk.watermark.high: 90%`：迁移分片离开该节点

**分片数量选择：**

| 场景 | 建议 |
|------|------|
| 小索引（< 10GB） | 1 个主分片 |
| 中等索引（10-100GB） | 3-5 个主分片 |
| 大索引（> 100GB） | 分片大小控制在 20-50GB |

**过多分片的问题：**
- 每个 Shard 有元数据开销（集群状态大）
- 搜索需要在所有分片上执行,然后合并结果（延迟高）

### 7.3 写入流程

```
Client
  ↓ (1) 计算文档应该写入哪个分片
  hash(routing) % number_of_primary_shards → Shard 0
  ↓
Coordinating Node (协调节点)
  ↓ (2) 转发到 Primary Shard 所在节点
  ↓
Node1 (Primary Shard 0)
  ↓ (3) 写入主分片
  [Lucene] 写入内存 Buffer
  ↓ (4) 并行转发到所有副本
  ↓ ↓
Node2 (Replica 0)  Node3 (Replica 0)
  ↓ (5) 副本写入成功
  ↓
  (6) 主分片返回成功
  ↓
Client 收到响应
```

**详细步骤：**

1. **路由**：`routing = _id`（可自定义）,计算分片编号
2. **写入主分片**：
   - 数据写入内存 Buffer
   - 写入 Translog（预写日志,防止崩溃丢数据）
3. **同步副本**：默认等待**全部副本**写入成功（`wait_for_active_shards=all`）
4. **Refresh（默认1秒）**：Buffer → Filesystem Cache（此时可搜索）
5. **Flush（默认30分钟）**：Filesystem Cache → Disk + 清空 Translog

**写入参数调优：**

```json
POST products/_doc/1?refresh=wait_for
{
  "title": "iPhone 15"
}
```

| refresh 参数 | 行为 | 用途 |
|-------------|------|------|
| false（默认） | 异步 refresh | 高吞吐写入 |
| true | 立即 refresh | 测试环境（性能差） |
| wait_for | 等待下次 refresh | 写入后立即可搜索 |

### 7.4 搜索流程

**两阶段查询（Query Then Fetch）**：

```
Client
  ↓
Coordinating Node
  ↓ (1) Query Phase
  广播到所有分片（每个 Index 的 Primary 或 Replica 之一）
  ↓        ↓        ↓
Node1 P0  Node2 P1  Node3 P2
  ↓ 每个分片返回 Top K 的文档 ID + 分数
  [Doc5:0.9, Doc2:0.8]
  ↓
Coordinating Node
  ↓ (2) 归并排序,选出全局 Top K
  [Doc5, Doc10, Doc2]
  ↓ (3) Fetch Phase
  根据文档 ID 到对应分片获取完整文档
  ↓        ↓        ↓
Node1 P0  Node2 P1  Node3 P2
  ↓ 返回 _source 字段
  ↓
Client 收到完整结果
```

**优化策略：**

1. **Routing**：将相关文档路由到同一分片

```json
POST products/_doc/1?routing=user123
{
  "user_id": "user123",
  "title": "Product A"
}

# 搜索时指定 routing,只查询一个分片
GET products/_search?routing=user123
{
  "query": {"term": {"user_id": "user123"}}
}
```

2. **preference=_local**：优先查询本地分片（减少网络开销）

```json
GET products/_search?preference=_local
```

3. **search_type=dfs_query_then_fetch**：全局精确 IDF（默认每个分片独立计算 IDF,可能不准）

---

## 8. 副本与故障恢复

### 8.1 副本一致性模型

Elasticsearch 使用**主备模式（Primary-Backup Replication）**:

```
写入流程:
Client → Primary Shard → Replica Shards
              ↓
         等待多数副本成功（可配置）
```

**一致性参数：**

```json
POST products/_doc/1?wait_for_active_shards=2
{
  "title": "iPhone"
}
```

| wait_for_active_shards | 含义 |
|----------------------|------|
| 1（默认） | 仅主分片写入成功即返回（最快,可能丢数据） |
| all | 全部副本写入成功（最安全,延迟高） |
| 2 | 至少 1 主 + 1 副本（折中） |

**读写一致性：**

ES **不保证强一致性**,因为:
- Refresh 延迟（默认1秒）
- 副本间同步延迟
- 搜索可能命中旧副本

### 8.2 故障检测与恢复

#### 节点故障检测

Master 节点定期 ping 所有节点:

```yaml
# elasticsearch.yml
cluster.fault_detection.leader_check.interval: 1s    # 检测间隔
cluster.fault_detection.leader_check.timeout: 10s    # 超时判定
cluster.fault_detection.leader_check.retry_count: 3  # 重试次数
```

#### 主分片丢失

```
故障前:
Node1: [P0]  ← 崩溃
Node2: [R0]

恢复后:
Node2: [P0]  ← 副本提升为主分片
Node3: [R0]  ← Master 在健康节点创建新副本
```

#### 脑裂防护

```yaml
discovery.zen.minimum_master_nodes: 2  # 至少 (N/2) + 1 个 master 候选节点
```

ES 7.0+ 使用自动配置,无需手动设置。

---

## 9. 性能优化

### 9.1 写入性能优化

#### 批量写入（Bulk API）

```json
POST _bulk
{"index": {"_index": "products", "_id": "1"}}
{"title": "Product 1", "price": 29.99}
{"index": {"_index": "products", "_id": "2"}}
{"title": "Product 2", "price": 39.99}
```

**最佳实践：**
- 单次 Bulk 大小: 5-15MB（太大导致内存压力）
- 并发请求数: 2-4 倍 CPU 核心数

#### 调整 Refresh 间隔

```json
PUT products/_settings
{
  "index.refresh_interval": "30s"  # 默认 1s
}
```

写入时临时禁用:

```json
PUT products/_settings
{
  "index.refresh_interval": "-1"  # 禁用
}

# ... 执行大量写入 ...

PUT products/_settings
{
  "index.refresh_interval": "1s"  # 恢复
}
POST products/_refresh  # 手动刷新
```

#### 增加副本数

```json
PUT products/_settings
{
  "number_of_replicas": 0  # 写入时禁用副本
}

# ... 大量写入 ...

PUT products/_settings
{
  "number_of_replicas": 1  # 恢复
}
```

#### 禁用 _source 字段（仅日志场景）

```json
PUT logs
{
  "mappings": {
    "_source": {"enabled": false},  # 不存储原始 JSON
    "properties": {
      "message": {"type": "text"},
      "timestamp": {"type": "date"}
    }
  }
}
```

节省 30-50% 磁盘空间,但无法 reindex 和显示原始文档。

### 9.2 查询性能优化

#### 使用 Filter Context

```json
# 慢：所有条件都在 must 中
GET products/_search
{
  "query": {
    "bool": {
      "must": [
        {"match": {"title": "laptop"}},
        {"term": {"brand": "Apple"}},
        {"range": {"price": {"gte": 1000}}}
      ]
    }
  }
}

# 快：精确条件放 filter
GET products/_search
{
  "query": {
    "bool": {
      "must": [
        {"match": {"title": "laptop"}}
      ],
      "filter": [
        {"term": {"brand": "Apple"}},
        {"range": {"price": {"gte": 1000}}}
      ]
    }
  }
}
```

Filter 结果会被缓存（Bitset Cache）。

#### 预加载 Fielddata

```json
PUT products/_mapping
{
  "properties": {
    "title": {
      "type": "text",
      "fielddata": true,
      "eager_global_ordinals": true  # 索引打开时预加载
    }
  }
}
```

#### 分页优化

**深度分页问题：**

```json
GET products/_search
{
  "from": 10000,  # 每个分片需要排序前 10010 条
  "size": 10
}
```

10 个分片 × 10010 条 = 100,100 条需要协调节点排序（OOM 风险）。

**解决方案 1：Scroll API**

```json
# 初始请求
POST products/_search?scroll=1m
{
  "size": 1000,
  "query": {"match_all": {}}
}

# 返回 scroll_id，后续使用
POST _search/scroll
{
  "scroll": "1m",
  "scroll_id": "DXF1ZXJ5QW5kRmV0Y2gBAA..."
}
```

适用场景：**批量导出**,不适合实时翻页。

**解决方案 2：Search After**

```json
GET products/_search
{
  "size": 10,
  "sort": [
    {"price": "asc"},
    {"_id": "asc"}  # 必须有唯一排序字段
  ]
}

# 返回最后一条的 sort 值 [29.99, "prod123"]
# 下一页
GET products/_search
{
  "size": 10,
  "sort": [{"price": "asc"}, {"_id": "asc"}],
  "search_after": [29.99, "prod123"]
}
```

适用场景：**实时深度分页**。

### 9.3 索引生命周期管理

**ILM（Index Lifecycle Management）** 自动管理索引的热-温-冷-删除阶段:

```json
PUT _ilm/policy/logs_policy
{
  "policy": {
    "phases": {
      "hot": {
        "actions": {
          "rollover": {
            "max_size": "50GB",
            "max_age": "1d"
          }
        }
      },
      "warm": {
        "min_age": "7d",
        "actions": {
          "forcemerge": {"max_num_segments": 1},
          "shrink": {"number_of_shards": 1}
        }
      },
      "cold": {
        "min_age": "30d",
        "actions": {
          "freeze": {}
        }
      },
      "delete": {
        "min_age": "90d",
        "actions": {
          "delete": {}
        }
      }
    }
  }
}
```

**应用到索引模板：**

```json
PUT _index_template/logs_template
{
  "index_patterns": ["logs-*"],
  "template": {
    "settings": {
      "index.lifecycle.name": "logs_policy",
      "index.lifecycle.rollover_alias": "logs"
    }
  }
}
```

---

## 10. 混合搜索与向量检索

### 10.1 Dense Vector 字段

ES 7.3+ 支持向量字段:

```json
PUT articles
{
  "mappings": {
    "properties": {
      "title": {"type": "text"},
      "content": {"type": "text"},
      "content_vector": {
        "type": "dense_vector",
        "dims": 384,
        "index": true,
        "similarity": "cosine"  # cosine / dot_product / l2_norm
      }
    }
  }
}
```

**写入向量：**

```json
POST articles/_doc/1
{
  "title": "Elasticsearch Guide",
  "content": "Elasticsearch is a search engine",
  "content_vector": [0.23, -0.51, 0.87, ...]  # 384 维
}
```

### 10.2 kNN 搜索

#### 精确 kNN（script_score）

```json
GET articles/_search
{
  "query": {
    "script_score": {
      "query": {"match_all": {}},
      "script": {
        "source": "cosineSimilarity(params.query_vector, 'content_vector') + 1.0",
        "params": {
          "query_vector": [0.21, -0.48, 0.89, ...]
        }
      }
    }
  }
}
```

**问题**：全量扫描,性能差（类似向量数据库的暴力搜索）。

#### 近似 kNN（HNSW）

ES 8.0+ 支持 HNSW 索引:

```json
PUT articles
{
  "mappings": {
    "properties": {
      "content_vector": {
        "type": "dense_vector",
        "dims": 384,
        "index": true,
        "similarity": "cosine",
        "index_options": {
          "type": "hnsw",
          "m": 16,              # 每层最大连接数
          "ef_construction": 100  # 构建时的搜索宽度
        }
      }
    }
  }
}
```

**kNN 查询：**

```json
GET articles/_search
{
  "knn": {
    "field": "content_vector",
    "query_vector": [0.21, -0.48, 0.89, ...],
    "k": 10,
    "num_candidates": 100  # 每个分片的候选数（越大越准确）
  }
}
```

### 10.3 Hybrid Search 实现

**混合 BM25 全文搜索 + 向量相似度：**

```json
GET articles/_search
{
  "query": {
    "bool": {
      "should": [
        {
          "match": {
            "content": {
              "query": "machine learning algorithms",
              "boost": 1.0
            }
          }
        },
        {
          "script_score": {
            "query": {"match_all": {}},
            "script": {
              "source": "cosineSimilarity(params.query_vector, 'content_vector') + 1.0",
              "params": {
                "query_vector": [...]
              }
            },
            "boost": 2.0  # 向量搜索权重2倍
          }
        }
      ]
    }
  }
}
```

**ES 8.12+ RRF（Reciprocal Rank Fusion）：**

```json
GET articles/_search
{
  "retriever": {
    "rrf": {
      "retrievers": [
        {
          "standard": {
            "query": {
              "match": {"content": "machine learning"}
            }
          }
        },
        {
          "knn": {
            "field": "content_vector",
            "query_vector": [...],
            "k": 10
          }
        }
      ],
      "rank_window_size": 50,
      "rank_constant": 60
    }
  }
}
```

RRF 算法:

```
score = ∑ (1 / (rank + k))

例如文档在 BM25 排名第 3,向量搜索排名第 5:
score = 1/(3+60) + 1/(5+60) = 0.0159 + 0.0154 = 0.0313
```

---

## 11. 实践案例

### 11.1 RAG 系统中的 Elasticsearch

**架构：**

```
用户问题: "What is Elasticsearch?"
    ↓
[1] Embedding 模型
    query_vector = model.encode(query)
    ↓
[2] Elasticsearch Hybrid Search
    - BM25: match_phrase_prefix
    - kNN: dense_vector similarity
    ↓
[3] Reranking（可选）
    使用 Cross-Encoder 重排序
    ↓
[4] 返回 Top-K 文档
    传递给 LLM 作为 Context
```

**完整示例：**

```python
from elasticsearch import Elasticsearch
from sentence_transformers import SentenceTransformer

es = Elasticsearch("http://localhost:9200")
model = SentenceTransformer('all-MiniLM-L6-v2')

# 创建索引
es.indices.create(index="knowledge_base", body={
    "mappings": {
        "properties": {
            "content": {"type": "text", "analyzer": "ik_max_word"},
            "title": {"type": "text"},
            "content_vector": {
                "type": "dense_vector",
                "dims": 384,
                "index": True,
                "similarity": "cosine"
            }
        }
    }
})

# 写入文档
doc = {
    "title": "Elasticsearch Intro",
    "content": "Elasticsearch is a distributed search engine...",
    "content_vector": model.encode(doc["content"]).tolist()
}
es.index(index="knowledge_base", document=doc)

# 搜索
query = "What is Elasticsearch?"
query_vector = model.encode(query).tolist()

response = es.search(index="knowledge_base", body={
    "query": {
        "bool": {
            "should": [
                {"match": {"content": {"query": query, "boost": 1.0}}},
                {
                    "script_score": {
                        "query": {"match_all": {}},
                        "script": {
                            "source": "cosineSimilarity(params.qv, 'content_vector') + 1.0",
                            "params": {"qv": query_vector}
                        },
                        "boost": 2.0
                    }
                }
            ]
        }
    },
    "size": 5
})

for hit in response['hits']['hits']:
    print(f"Score: {hit['_score']}, Title: {hit['_source']['title']}")
```

### 11.2 日志分析与 ELK Stack

**架构：**

```
应用服务器
    ↓ 日志文件
Filebeat (日志采集)
    ↓ 轻量级 Shipper
Logstash (解析/过滤/增强)
    ↓ Grok 解析、GeoIP、时间戳处理
Elasticsearch (存储/搜索)
    ↓
Kibana (可视化)
```

**Logstash 配置示例：**

```ruby
input {
  beats {
    port => 5044
  }
}

filter {
  grok {
    match => {
      "message" => "%{IPORHOST:client_ip} - - \[%{HTTPDATE:timestamp}\] \"%{WORD:method} %{URIPATHPARAM:request} HTTP/%{NUMBER:http_version}\" %{NUMBER:response_code} %{NUMBER:bytes}"
    }
  }
  date {
    match => [ "timestamp", "dd/MMM/yyyy:HH:mm:ss Z" ]
    target => "@timestamp"
  }
  geoip {
    source => "client_ip"
  }
}

output {
  elasticsearch {
    hosts => ["http://localhost:9200"]
    index => "nginx-logs-%{+YYYY.MM.dd}"
  }
}
```

**索引模板：**

```json
PUT _index_template/nginx_logs
{
  "index_patterns": ["nginx-logs-*"],
  "template": {
    "settings": {
      "number_of_shards": 3,
      "number_of_replicas": 1,
      "index.lifecycle.name": "logs_policy"
    },
    "mappings": {
      "properties": {
        "client_ip": {"type": "ip"},
        "method": {"type": "keyword"},
        "request": {"type": "text"},
        "response_code": {"type": "short"},
        "bytes": {"type": "integer"},
        "geoip.location": {"type": "geo_point"}
      }
    }
  }
}
```

**常用分析查询：**

```json
# 1. 每小时请求量
GET nginx-logs-*/_search
{
  "size": 0,
  "aggs": {
    "requests_per_hour": {
      "date_histogram": {
        "field": "@timestamp",
        "calendar_interval": "hour"
      }
    }
  }
}

# 2. Top 10 IP 地址
GET nginx-logs-*/_search
{
  "size": 0,
  "aggs": {
    "top_ips": {
      "terms": {
        "field": "client_ip",
        "size": 10
      }
    }
  }
}

# 3. 404 错误率
GET nginx-logs-*/_search
{
  "size": 0,
  "query": {
    "range": {
      "@timestamp": {
        "gte": "now-1h"
      }
    }
  },
  "aggs": {
    "error_rate": {
      "filters": {
        "filters": {
          "success": {"range": {"response_code": {"gte": 200, "lt": 300}}},
          "error": {"range": {"response_code": {"gte": 400}}}
        }
      }
    }
  }
}

# 4. 地理位置分布（Kibana 地图可视化）
GET nginx-logs-*/_search
{
  "size": 0,
  "aggs": {
    "locations": {
      "geohash_grid": {
        "field": "geoip.location",
        "precision": 3
      }
    }
  }
}
```

---

## 最佳实践总结

### 索引设计

| 原则 | 说明 |
|------|------|
| 合理分片 | 单分片 20-50GB,避免过度分片 |
| 使用别名 | 零停机索引切换 `logs → logs-2024-01-01` |
| 显式 Mapping | 避免动态映射的类型推断错误 |
| Multi-field | text + keyword 双映射满足不同需求 |

### 查询优化

| 原则 | 说明 |
|------|------|
| Filter 优先 | 精确匹配放 filter,利用缓存 |
| 避免深度分页 | 用 search_after 或 scroll |
| 减少返回字段 | 使用 _source 过滤或 stored_fields |
| 合理分片路由 | 相关数据路由到同一分片 |

### 写入优化

| 原则 | 说明 |
|------|------|
| 批量写入 | Bulk API,单批 5-15MB |
| 延长 refresh_interval | 默认1秒,写入密集时可设为 30s |
| 写入时减少副本 | 临时设为 0,写入后恢复 |
| 禁用 _all 字段 | ES 6.0+ 已默认禁用 |

### 集群运维

| 原则 | 说明 |
|------|------|
| 监控关键指标 | JVM Heap < 50%,GC 频率,Rejected 线程 |
| 预留内存 | Heap 设为物理内存 50%（最大 32GB） |
| 冷热分离 | 热数据 SSD,冷数据 HDD + Freeze |
| 定期清理 | ILM 自动删除过期索引 |

### 安全

| 原则 | 说明 |
|------|------|
| 启用安全特性 | X-Pack Security（ES 7.0+ 免费） |
| RBAC 权限控制 | 最小权限原则 |
| 传输加密 | TLS/SSL |
| 审计日志 | 记录所有索引/搜索操作 |

---

## 常见问题

### Q1: Elasticsearch vs Solr 如何选择？

| 特性 | Elasticsearch | Solr |
|------|--------------|------|
| 易用性 | RESTful API,更易上手 | 需要理解 Solr 配置文件 |
| 分布式 | 原生分布式,自动分片 | 需要 SolrCloud 配置 |
| 实时性 | Near Real-Time（1秒） | 同样 NRT |
| 社区生态 | ELK Stack 生态强大 | 更成熟,Apache 项目 |
| 性能 | 大数据下更优 | 传统搜索更强 |

**建议**：
- 新项目、日志分析、APM → Elasticsearch
- 传统企业搜索、需要复杂配置 → Solr

### Q2: Elasticsearch 能否替代关系型数据库？

**不能**。适用场景不同:

| 场景 | ES | MySQL |
|------|----|----|
| 全文搜索 | ✓ | ✗ |
| 复杂 JOIN | ✗ | ✓ |
| 事务 | ✗ | ✓ |
| 实时聚合 | ✓ | △ |
| 数据一致性 | 最终一致性 | 强一致性 |

**典型架构**：MySQL 作主数据库,ES 作搜索引擎（通过 Logstash/Debezium CDC 同步）。

### Q3: 如何处理 Elasticsearch 内存溢出？

**排查步骤：**

1. **检查 JVM Heap 使用率**

```bash
GET _nodes/stats/jvm
```

Heap 使用率持续 > 75% 需要优化。

2. **检查 Field Data 内存**

```bash
GET _nodes/stats/indices/fielddata
```

**解决方案**：
- 使用 `doc_values`（默认启用,列式存储）而非 fielddata
- 增加 `indices.fielddata.cache.size: 20%`

3. **检查查询缓存**

```bash
GET _nodes/stats/indices/query_cache
```

**解决方案**：减小 `indices.queries.cache.size: 10%`

4. **检查 Segment 数量**

```bash
GET my_index/_stats
```

过多小 Segment 导致内存碎片。

**解决方案**：Force Merge

```json
POST my_index/_forcemerge?max_num_segments=1
```

### Q4: 如何实现 Elasticsearch 数据的实时同步？

**方案 1：Logstash JDBC Input**

```ruby
input {
  jdbc {
    jdbc_driver_library => "/path/to/mysql-connector.jar"
    jdbc_driver_class => "com.mysql.jdbc.Driver"
    jdbc_connection_string => "jdbc:mysql://localhost:3306/mydb"
    jdbc_user => "user"
    jdbc_password => "password"
    schedule => "* * * * *"  # 每分钟
    statement => "SELECT * FROM products WHERE updated_at > :sql_last_value"
    use_column_value => true
    tracking_column => "updated_at"
  }
}

output {
  elasticsearch {
    hosts => ["localhost:9200"]
    index => "products"
    document_id => "%{id}"
  }
}
```

**缺点**：延迟高（分钟级）,频繁查询给数据库压力。

**方案 2：Debezium CDC**

捕获 MySQL Binlog,实时同步（秒级）:

```yaml
# Kafka Connect 配置
name: mysql-source
connector.class: io.debezium.connector.mysql.MySqlConnector
database.hostname: localhost
database.port: 3306
database.user: debezium
database.password: password
database.server.id: 184054
database.server.name: mydb
table.include.list: mydb.products
```

Kafka → Elasticsearch Sink Connector。

**方案 3：应用双写**

应用层同时写入 MySQL 和 ES（需要处理一致性）。

---

## 参考资料

- [Elasticsearch 官方文档](https://www.elastic.co/guide/en/elasticsearch/reference/current/index.html)
- [Elasticsearch: The Definitive Guide](https://www.elastic.co/guide/en/elasticsearch/guide/current/index.html)
- [Apache Lucene 官方文档](https://lucene.apache.org/core/)
- [IK Analyzer GitHub](https://github.com/medcl/elasticsearch-analysis-ik)
- [Elasticsearch Performance Tuning Practice at eBay](https://tech.ebayinc.com/engineering/elasticsearch-performance-tuning-practice-at-ebay/)
