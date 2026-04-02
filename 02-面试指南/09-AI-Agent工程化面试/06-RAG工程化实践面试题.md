# RAG 工程化实践面试题

> 覆盖分块策略、混合检索、Re-ranking、RAGAS 评估等 RAG 生产实践面试题

## 相关链接

- 对应技术资料：[RAG工程化实践](../../01-技术资料/09-AI-Agent工程化/06-RAG工程化实践.md)

## 题目列表

| 题号 | 题目 | 难度 |
|------|------|------|
| Q1 | RAG 的基本工作流程是什么？ | ⭐ 基础 |
| Q2 | 比较固定长度分块和语义分块的优缺点 | ⭐ 基础 |
| Q3 | 为什么混合检索比纯向量检索效果好？ | ⭐⭐ 进阶 |
| Q4 | Cross-Encoder Re-ranking 是如何工作的？它与 Bi-Encoder 有什么区别？ | ⭐⭐ 进阶 |
| Q5 | RAGAS 的四个核心评估指标分别评估什么？ | ⭐⭐ 进阶 |
| Q6 | 什么是 HyDE（Hypothetical Document Embeddings）？ | ⭐⭐ 进阶 |
| Q7 | Contextual Retrieval（上下文增强检索）如何提升检索质量？ | ⭐⭐ 进阶 |
| Q8 | 比较 pgvector、Qdrant、Milvus 的适用场景 | ⭐⭐ 进阶 |
| Q9 | 如何设计一个支持增量更新的 RAG 索引管线？ | ⭐⭐⭐ 高阶 |
| Q10 | 你的 RAG 系统上线后用户反馈"回答不准确"，如何系统性地诊断和优化？ | 🎯 场景 |
| Q11 | 设计一个企业知识库 RAG 系统，需要支持多种文档格式和权限控制 | 🎯 场景 |

## 🔥 高频考点速记

| # | 考点 | 核心要点 | 出题概率 |
|---|------|---------|---------|
| 1 | 混合检索 | 向量(语义) + BM25(关键词) → 加权融合 → Recall 提升 15-30% | ★★★★★ |
| 2 | Re-ranking | Bi-Encoder 粗召回 top-50 → Cross-Encoder 精排 top-5 | ★★★★★ |
| 3 | 分块策略 | 300-600 tokens / 50-100 overlap / 递归分隔符 | ★★★★☆ |
| 4 | RAGAS 评估 | Faithfulness + Answer Relevancy + Context Precision + Recall | ★★★★☆ |

## 参考答案

### Q1: RAG 基本工作流程

<details>
<summary>参考答案</summary>

**RAG = 检索增强生成。先从知识库检索相关文档，再将文档作为上下文注入 LLM Prompt，让 LLM 基于真实数据回答。**

#### 流程

```
用户查询 → Embedding → 向量检索 → 相关文档
                                      ↓
                              构造 Prompt：
                              "根据以下上下文回答问题：
                               {检索到的文档}
                               问题：{用户查询}"
                                      ↓
                                 LLM 生成回答
```

#### 各阶段详解

| 阶段 | 核心任务 | 关键技术 |
|------|---------|---------|
| 索引 | 文档→分块→Embedding→入库 | 分块策略、Embedding 模型 |
| 检索 | 查询→Embedding→相似度搜索 | 向量检索、混合检索、Re-ranking |
| 生成 | 上下文+查询→LLM→回答 | Prompt 工程、上下文窗口管理 |
| 评估 | 回答质量+检索质量 | RAGAS、人工评估 |

#### 面试追问

- **RAG vs Fine-tuning**？RAG 适合事实性知识（文档、API）；Fine-tuning 适合行为和风格（回答语气、格式）
- **RAG 的核心挑战**？检索不准（garbage in, garbage out）和幻觉（LLM 不忠于上下文）

</details>

---

### Q2: 固定长度分块 vs 语义分块

<details>
<summary>参考答案</summary>

**固定长度简单快速但可能截断语义，语义分块保留完整语义但更复杂。**

#### 对比

| 维度 | 固定长度分块 | 语义分块 |
|------|------------|---------|
| 方法 | 按 token/字符数切分 | 按语义边界（段落/标题/句子）切分 |
| 优点 | 简单快速、大小均匀 | 语义完整、检索精度高 |
| 缺点 | 可能截断句子/段落 | 大小不均匀、实现复杂 |
| 适用场景 | 通用文本、大规模处理 | 结构化文档、高精度需求 |

#### 推荐实践

```python
# 递归字符分割（最常用的折中方案）
from langchain.text_splitter import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,          # 目标大小
    chunk_overlap=100,       # 重叠（保留上下文）
    separators=[
        "\n## ",  # 先按标题切
        "\n### ",
        "\n\n",   # 再按段落切
        "\n",     # 再按行切
        ". ",     # 最后按句子切
        " ",      # 兜底按词切
    ]
)
```

#### 关键参数

```
chunk_size: 300-600 tokens（太小丢上下文，太大稀释信号）
chunk_overlap: 50-100 tokens（保证边界信息不丢失）
```

</details>

---

### Q3: 混合检索优势

<details>
<summary>参考答案</summary>

**向量检索擅长语义匹配，BM25 擅长精确关键词匹配，混合后 Recall 提升 15-30%。**

#### 各自的弱点

```
纯向量检索：
  查询 "ERR_CONNECTION_REFUSED 如何解决"
  → Embedding 编码"连接被拒绝的错误处理"
  → 检索到"网络故障排查指南"（语义相关✓）
  → 漏掉了包含精确错误码的文档（关键词不敏感✗）

纯 BM25：
  查询 "如何优化数据库查询性能"
  → 关键词匹配"数据库"+"查询"+"性能"
  → 漏掉了"SQL 调优最佳实践"（语义相关但关键词不同✗）
```

#### 混合策略

```python
def hybrid_search(query, alpha=0.7, top_k=10):
    # 向量检索（语义）
    vector_results = vector_db.search(embed(query), top_k=50)
    
    # BM25 检索（关键词）
    bm25_results = bm25_index.search(query, top_k=50)
    
    # 加权融合（RRF 或线性组合）
    combined = {}
    for doc, score in vector_results:
        combined[doc.id] = alpha * normalize(score)
    for doc, score in bm25_results:
        combined[doc.id] = combined.get(doc.id, 0) + (1-alpha) * normalize(score)
    
    return sorted(combined.items(), key=lambda x: x[1], reverse=True)[:top_k]
```

#### 面试追问

- **alpha 如何调优**？通用查询 α=0.7（偏语义）；含专有名词/错误码 α=0.3（偏关键词）
- **RRF（Reciprocal Rank Fusion）vs 线性组合**？RRF 对分数不敏感，更鲁棒：`score = Σ 1/(k + rank_i)`

</details>

---

### Q4: Cross-Encoder Re-ranking

<details>
<summary>参考答案</summary>

**Bi-Encoder 快速粗召回 top-50，Cross-Encoder 精排到 top-5。精度大幅提升但速度慢，所以两阶段配合使用。**

#### Bi-Encoder vs Cross-Encoder

```
Bi-Encoder（独立编码，适合召回）：
  Query → Encoder → Q_vec
  Doc   → Encoder → D_vec   → cosine(Q_vec, D_vec)
  特点：query 和 doc 独立编码，可以预计算 doc embedding
  速度：毫秒级检索百万文档

Cross-Encoder（联合编码，适合排序）：
  [Query, Doc] → Encoder → relevance_score
  特点：query 和 doc 拼接后一起编码，能捕捉更精细的交互
  速度：每对 query-doc 需要一次推理，慢 1000 倍
```

#### 两阶段检索

```
Stage 1 - 粗召回（Bi-Encoder）：
  100万文档 → top-50 候选（毫秒级）

Stage 2 - 精排（Cross-Encoder）：
  top-50 → 逐对评分 → top-5 最终结果（百毫秒级）
```

#### 面试追问

- **有哪些好的 Cross-Encoder 模型**？BAAI/bge-reranker-v2、Cohere Rerank、Jina Reranker
- **Re-ranking 能提升多少**？通常 NDCG@5 提升 10-20%

</details>

---

### Q5: RAGAS 四个核心指标

<details>
<summary>参考答案</summary>

**RAGAS 用 LLM-as-Judge 自动评估 RAG 系统的四个维度：检索的精度、检索的召回、回答的忠实度、回答的相关性。**

| 指标 | 评估什么 | 计算方式 |
|------|---------|---------|
| Context Precision | 检索到的文档是否都相关？ | 相关文档排名 / 总检索数 |
| Context Recall | 回答所需的信息是否都被检索到？ | 回答中有据可查的比例 |
| Faithfulness | 回答是否忠实于检索到的上下文？ | 回答中每个 claim 是否能在上下文中找到依据 |
| Answer Relevancy | 回答是否回答了用户的问题？ | 回答与问题的语义相关度 |

#### 直觉理解

```
Context Precision：检索的准不准？（排在前面的应该是最相关的）
Context Recall：检索的全不全？（所有需要的信息都检索到了吗？）
Faithfulness：LLM 有没有胡说八道？（是否忠于上下文）
Answer Relevancy：回答有没有跑题？（是否回答了用户的问题）
```

#### 面试追问

- **Faithfulness 低怎么办**？强化 Prompt 中的"只根据上下文回答"指令 + 添加 citation
- **这四个指标哪个最重要**？Faithfulness 最重要——不忠实的回答比没有回答更危险

</details>

---

### Q6: HyDE（Hypothetical Document Embeddings）

<details>
<summary>参考答案</summary>

**让 LLM 先生成一个"假想的完美文档"，用这个假想文档的 Embedding 去检索，比用查询的 Embedding 效果更好。**

#### 原理

```
传统检索：
  Query: "Redis 集群如何处理网络分区"
  → Embed(Query) → 向量检索 → 可能检索偏差

HyDE：
  Query → LLM 生成假想文档：
  "Redis 集群在网络分区时会触发 Sentinel 故障转移...
   使用 Gossip 协议检测节点故障... 
   配置 cluster-node-timeout 控制超时..."
  → Embed(假想文档) → 向量检索 → 更精准

为什么更好？假想文档与真实文档在 embedding 空间更接近（都是文档语言风格）
```

#### 面试追问

- **缺点是什么**？每次检索多一次 LLM 调用（增加延迟和成本），且 LLM 可能生成错误的假想文档导致检索偏差
- **什么时候用**？用户查询很短或很模糊时效果最好

</details>

---

### Q7: Contextual Retrieval

<details>
<summary>参考答案</summary>

**Anthropic 提出的方法：在每个分块前面加上 LLM 生成的上下文说明，解决分块后丢失原始上下文的问题。**

#### 问题

```
原始文档："我们公司在 2024 年 Q3 的营收增长了 30%"
分块后：  "营收增长了 30%"
→ 缺少了"哪个公司""什么时候"的上下文
→ 检索时与"某公司 2024 年 Q3 营收"的查询匹配度降低
```

#### 解决方案

```
原始分块：
  "营收增长了 30%"

增强后的分块：
  "【上下文：本段来自 XYZ 公司 2024 年度财报 Q3 部分。
    XYZ 公司是一家 SaaS 企业。】
   营收增长了 30%"
```

#### 实现

```python
def add_context(chunk, full_document):
    prompt = f"""以下是文档的一个片段。请用 1-2 句话描述这个片段在文档中的上下文。

    文档：{full_document[:2000]}
    
    片段：{chunk}
    
    上下文说明："""
    
    context = llm.generate(prompt)
    return f"[上下文：{context}]\n{chunk}"
```

#### 效果数据

- Anthropic 报告：检索失败率降低 49%（结合 BM25）
- 最大改善场景：短片段、缺乏上下文的表格数据

</details>

---

### Q8: 向量数据库对比

<details>
<summary>参考答案</summary>

**pgvector 适合已有 PostgreSQL 的团队，Qdrant 性能优秀适合中小规模，Milvus 适合超大规模分布式场景。**

| 维度 | pgvector | Qdrant | Milvus |
|------|---------|--------|--------|
| 类型 | PostgreSQL 扩展 | 专用向量数据库 | 分布式向量数据库 |
| 部署复杂度 | 最低（已有 PG 直接装） | 低（单二进制） | 高（多组件） |
| 性能 | 中（<100 万向量） | 高 | 最高（亿级向量） |
| 过滤 | 原生 SQL WHERE | Payload filter | 属性过滤 |
| 适用规模 | <100 万向量 | <1000 万向量 | 亿级向量 |
| 优势 | 事务一致性、无额外组件 | API 好用、内存映射 | 水平扩展、GPU 加速 |
| 语言 | C (PG 扩展) | Rust | Go + C++ |

#### 选型建议

```
已有 PostgreSQL + 向量量 < 100 万？ → pgvector（零额外基础设施）
中小规模 + 高性能要求？ → Qdrant（Rust 性能 + 简单部署）
大规模 + 分布式需求？ → Milvus（水平扩展设计）
云原生 + 不想运维？ → Pinecone（托管服务）
```

</details>

---

### Q9: 增量更新的 RAG 索引管线

<details>
<summary>参考答案</summary>

**核心是文档变更检测 + 增量 Embedding + 索引更新，避免全量重建。**

#### 管线设计

```
数据源监控
  ↓ 文件变更/新增/删除事件
文档处理队列（消息队列）
  ↓
增量处理：
  新增文档 → 分块 → Embedding → 插入向量库
  修改文档 → 重新分块 → 重新 Embedding → 更新向量库
  删除文档 → 删除对应向量
  ↓
一致性校验（定期全量比对）
```

#### 变更检测方案

| 方案 | 适用场景 | 实现 |
|------|---------|------|
| 文件 Hash | 本地文件系统 | MD5/SHA256 对比 |
| 数据库 updated_at | 数据库文档 | 增量查询 |
| Webhook | SaaS 平台 | 事件驱动 |
| 定时全量扫描 | 兜底方案 | 每日凌晨对账 |

#### 面试追问

- **如何保证一致性**？定期全量对账 + 文档级版本号
- **Embedding 模型升级怎么办**？必须全量重建索引（不同模型的向量不可比较）

</details>

---

### Q10: RAG 系统质量优化

<details>
<summary>参考答案</summary>

**系统性诊断：检索质量 → 分块质量 → Embedding 质量 → 生成质量 → 端到端测试。**

#### 诊断框架

```
用户反馈"回答不准确"
  ↓ 判断问题类型
┌──────────────────────────────────────────┐
│ 1. 检索不到相关文档？→ 检索问题           │
│    - 检查 Context Recall                 │
│    - 可能原因：分块丢失信息、Embedding 不佳│
│                                          │
│ 2. 检索到但不相关？→ 排序问题             │
│    - 检查 Context Precision              │
│    - 解决方案：添加 Re-ranking            │
│                                          │
│ 3. 检索准确但回答错误？→ 生成问题         │
│    - 检查 Faithfulness                   │
│    - 解决方案：强化 Prompt、更好的模型     │
└──────────────────────────────────────────┘
```

#### 优化手段（按效果排序）

| 优化 | 效果 | 成本 |
|------|------|------|
| 添加混合检索 | Recall +15-30% | 低 |
| 添加 Re-ranking | Precision +10-20% | 中 |
| 优化分块策略 | 全面提升 | 低 |
| Contextual Retrieval | Recall +49% | 高（LLM 成本） |
| 调优 Prompt | Faithfulness +10% | 低 |
| 换更好的 Embedding 模型 | 全面提升 | 中 |

</details>

---

### Q11: 企业知识库 RAG 系统设计

<details>
<summary>参考答案</summary>

**核心挑战：多格式文档解析 + 权限控制 + 增量更新 + 回答质量保证。**

#### 架构设计

```
文档源                    文档处理管线              检索与生成
┌─────────┐            ┌──────────────┐          ┌──────────────┐
│Confluence│→           │              │          │              │
│SharePoint│→ 解析器 → │ 分块 → 增强   │→ 向量库  │ 混合检索     │
│PDF/Word  │→           │ → Embedding  │          │ → Re-rank    │
│Notion    │→           │              │          │ → LLM 生成   │
└─────────┘            └──────────────┘          └──────────────┘
                              ↓                        ↓
                        权限标签                   权限过滤
                        (department,               (用户权限
                         role, level)               ∩ 文档权限)
```

#### 权限控制方案

```python
# 每个文档分块携带权限标签
chunk = {
    "content": "...",
    "embedding": [...],
    "metadata": {
        "source": "confluence",
        "department": "engineering",
        "access_level": "internal",   # public/internal/confidential
        "allowed_roles": ["engineer", "manager"],
    }
}

# 检索时过滤
results = vector_db.search(
    query_embedding,
    filter={
        "department": {"$in": user.departments},
        "access_level": {"$lte": user.clearance_level},
    }
)
```

#### 多格式解析

| 格式 | 解析工具 | 注意事项 |
|------|---------|---------|
| PDF | PyMuPDF / Unstructured | 表格提取、扫描件 OCR |
| Word/PPT | python-docx / python-pptx | 保留结构层级 |
| HTML/Markdown | BeautifulSoup / 原生解析 | 保留标题结构 |
| 代码文件 | Tree-sitter | 按函数/类分块 |

</details>
