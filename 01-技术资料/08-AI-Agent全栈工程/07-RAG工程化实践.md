# RAG 工程化实践

> 从原型到生产，深入解析 RAG 系统的索引构建、检索优化、评估体系与企业级部署实践

## 相关链接

- 对应面试题：[RAG工程化实践面试题](../../02-面试指南/08-AI-Agent全栈工程面试/07-RAG工程化实践面试题.md)

## TL;DR 速览

- RAG 原型只需 20 行代码，但**生产级 RAG 需要解决分块、检索质量、评估、更新**四大工程问题
- **语义分块**优于固定长度分块：按段落/标题分块，保持语义完整性
- **混合检索** = 向量检索 + BM25 关键词检索，比纯向量检索 Recall 高 15-30%
- **Re-ranking** 是提升精度最有效的手段：用 Cross-Encoder 对候选文档重排序
- **RAGAS 评估框架**提供四个核心指标：Faithfulness、Answer Relevancy、Context Precision、Context Recall
- 向量数据库选型：**pgvector** 适合中小规模，**Qdrant/Milvus** 适合大规模
- 生产 RAG 必须有**文档更新管线**：增量索引 + 版本管理 + 过期清理

## 目录

1. [RAG 原型 vs 生产级 RAG](#_1-rag-原型-vs-生产级-rag)
2. [文档处理与分块策略](#_2-文档处理与分块策略)
3. [Embedding 模型选型](#_3-embedding-模型选型)
4. [向量数据库工程实践](#_4-向量数据库工程实践)
5. [检索策略优化](#_5-检索策略优化)
6. [Re-ranking 与后处理](#_6-re-ranking-与后处理)
7. [RAG 评估体系](#_7-rag-评估体系)
8. [生产部署与运维](#_8-生产部署与运维)
9. [常见陷阱与最佳实践](#_9-常见陷阱与最佳实践)
10. [延伸与前沿](#_10-延伸与前沿)

---

## 1. RAG 原型 vs 生产级 RAG

### 1.1 RAG 的核心价值

**类比**：LLM 就像一个博学的人，但他的知识停留在训练截止日期。RAG 就像给他一个"随身图书馆"——每次回答问题前，先去图书馆查阅最新资料，再结合自己的知识给出回答。

### 1.2 原型与生产的差距

```
RAG 原型 (20 行代码):
  文档 → 固定分块 → Embedding → 向量库 → Top-K 检索 → LLM 生成

生产级 RAG (完整管线):
  ┌──────────────────────────────────────────────────────────┐
  │                    数据管线 (离线)                         │
  │  文档采集 → 格式解析 → 清洗去重 → 语义分块              │
  │  → Embedding → 索引构建 → 增量更新 → 版本管理           │
  ├──────────────────────────────────────────────────────────┤
  │                    检索管线 (在线)                         │
  │  查询改写 → 混合检索 → Re-ranking → 上下文组装          │
  │  → LLM 生成 → 答案验证 → 引用标注                       │
  ├──────────────────────────────────────────────────────────┤
  │                    评估与监控                              │
  │  RAGAS 自动评估 → A/B 测试 → 人工标注 → 持续优化        │
  └──────────────────────────────────────────────────────────┘
```

---

## 2. 文档处理与分块策略

### 2.1 分块策略对比

| 策略 | 原理 | 优点 | 缺点 |
|------|------|------|------|
| 固定长度 | 按字符/Token 数分块 | 简单、均匀 | 可能截断语义 |
| 语义分块 | 按段落/标题/主题分块 | 保持语义完整 | 块大小不均匀 |
| 递归分块 | 按层级分隔符递归分割 | 平衡语义和长度 | 需要调参 |
| 滑动窗口 | 重叠分块 | 减少信息丢失 | 索引膨胀 |

### 2.2 推荐实践：递归分块

```python
from langchain.text_splitter import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(
    chunk_size=512,          # 每块约 512 tokens
    chunk_overlap=50,        # 块间重叠 50 tokens
    separators=[
        "\n## ",             # 优先按二级标题分块
        "\n### ",            # 其次按三级标题
        "\n\n",              # 再按段落
        "\n",                # 再按行
        ". ",                # 最后按句子
        " ",                 # 最后按词
    ],
    length_function=lambda text: len(tokenizer.encode(text))
)

chunks = splitter.split_text(document_text)
```

### 2.3 增强分块：添加元数据

```python
def create_chunks_with_metadata(doc, chunks):
    """为每个分块添加元数据，提升检索质量"""
    enriched = []
    for i, chunk in enumerate(chunks):
        enriched.append({
            "text": chunk,
            "metadata": {
                "source": doc.filename,
                "chunk_index": i,
                "total_chunks": len(chunks),
                "title": extract_section_title(chunk),
                "created_at": doc.created_at,
                "doc_type": doc.type  # "api_doc" | "tutorial" | "faq"
            }
        })
    return enriched
```

### 2.4 Contextual Retrieval（Anthropic 方法）

为每个分块生成上下文描述，解决"脱离文档上下文后不知道分块在说什么"的问题：

```python
async def add_contextual_description(chunk, full_document):
    """使用 LLM 为分块添加上下文描述"""
    prompt = f"""这是一篇文档的完整内容：
<document>
{full_document[:3000]}
</document>

这是文档中的一个片段：
<chunk>
{chunk}
</chunk>

请用 1-2 句话简要描述这个片段在文档中的上下文和位置。"""
    
    context = await llm.generate(prompt)
    return f"{context}\n\n{chunk}"  # 上下文 + 原文
```

---

## 3. Embedding 模型选型

### 3.1 主流 Embedding 模型对比

| 模型 | 维度 | MTEB 排名 | 中文支持 | 部署方式 |
|------|------|----------|---------|---------|
| text-embedding-3-large | 3072 | 高 | 好 | API |
| Cohere embed-v3 | 1024 | 高 | 好 | API |
| BGE-M3 | 1024 | 高 | 优秀 | 本地 |
| GTE-Qwen2 | 1536 | 极高 | 优秀 | 本地 |
| nomic-embed-text | 768 | 中上 | 中等 | 本地/Ollama |

### 3.2 Embedding 最佳实践

```python
# 查询和文档使用不同的前缀（部分模型要求）
query_embedding = embed("query: 什么是 PagedAttention?")
doc_embedding = embed("passage: PagedAttention 是 vLLM 的核心创新...")

# 批量处理以提高效率
embeddings = embed_batch(chunks, batch_size=64)
```

---

## 4. 向量数据库工程实践

### 4.1 向量数据库选型

| 数据库 | 适用规模 | 特点 | 部署复杂度 |
|--------|---------|------|-----------|
| pgvector | < 500 万向量 | 与 PostgreSQL 集成，SQL 查询 | 低 |
| Qdrant | < 1 亿向量 | Rust 实现，高性能，丰富过滤 | 中 |
| Milvus | > 1 亿向量 | 分布式，水平扩展 | 高 |
| Chroma | 开发/原型 | Python 原生，内存优先 | 极低 |

### 4.2 pgvector 实践

```sql
-- 启用扩展
CREATE EXTENSION vector;

-- 创建向量表
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    embedding vector(1536),  -- OpenAI text-embedding-3-small 维度
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 创建 HNSW 索引（推荐）
CREATE INDEX ON documents 
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);

-- 相似度查询
SELECT id, content, 
       1 - (embedding <=> query_embedding) AS similarity
FROM documents
WHERE metadata->>'doc_type' = 'api_doc'  -- 元数据过滤
ORDER BY embedding <=> query_embedding
LIMIT 10;
```

### 4.3 Qdrant 实践

```python
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

client = QdrantClient(host="localhost", port=6333)

# 创建集合
client.create_collection(
    collection_name="documents",
    vectors_config=VectorParams(size=1536, distance=Distance.COSINE)
)

# 插入文档
client.upsert(
    collection_name="documents",
    points=[
        PointStruct(
            id=str(uuid4()),
            vector=embedding,
            payload={
                "content": chunk_text,
                "source": "api_docs",
                "section": "authentication"
            }
        )
    ]
)

# 带过滤的检索
results = client.search(
    collection_name="documents",
    query_vector=query_embedding,
    query_filter=Filter(
        must=[
            FieldCondition(key="source", match=MatchValue(value="api_docs"))
        ]
    ),
    limit=10
)
```

---

## 5. 检索策略优化

### 5.1 混合检索

**纯向量检索的问题**：对精确关键词（如产品名、错误码、API 名称）检索能力弱。

**混合检索** = 向量检索（语义） + BM25 检索（关键词）：

```python
from rank_bm25 import BM25Okapi
import numpy as np

class HybridRetriever:
    def __init__(self, documents, embeddings):
        # BM25 索引
        tokenized = [doc.split() for doc in documents]
        self.bm25 = BM25Okapi(tokenized)
        
        # 向量索引
        self.embeddings = embeddings
        self.documents = documents
    
    def search(self, query, alpha=0.7, top_k=10):
        """alpha: 向量检索权重（0-1）"""
        # 向量检索得分
        query_emb = embed(query)
        vector_scores = cosine_similarity(query_emb, self.embeddings)
        
        # BM25 得分
        bm25_scores = self.bm25.get_scores(query.split())
        
        # 归一化
        vector_scores = (vector_scores - vector_scores.min()) / (vector_scores.max() - vector_scores.min() + 1e-8)
        bm25_scores = (bm25_scores - bm25_scores.min()) / (bm25_scores.max() - bm25_scores.min() + 1e-8)
        
        # 加权融合
        final_scores = alpha * vector_scores + (1 - alpha) * bm25_scores
        
        top_indices = np.argsort(final_scores)[-top_k:][::-1]
        return [(self.documents[i], final_scores[i]) for i in top_indices]
```

### 5.2 查询改写

```python
async def query_rewrite(original_query: str) -> list[str]:
    """将用户查询改写为多个检索友好的查询"""
    prompt = f"""将以下用户问题改写为 3 个不同角度的搜索查询，以提高检索覆盖率：

用户问题：{original_query}

要求：
1. 保持原意，但用不同的措辞
2. 包含可能的同义词和相关术语
3. 一个查询侧重概念，一个侧重实现，一个侧重对比"""
    
    rewritten = await llm.generate(prompt)
    return parse_queries(rewritten)

# 使用：用多个查询分别检索，合并去重
queries = await query_rewrite("vLLM 和 SGLang 哪个好？")
# → ["vLLM SGLang 性能对比", "LLM 推理引擎选型", "PagedAttention vs RadixAttention"]
```

### 5.3 HyDE（Hypothetical Document Embeddings）

```python
async def hyde_retrieval(query: str):
    """让 LLM 先生成假设性答案，再用答案做检索"""
    # 1. 生成假设性文档
    hypothetical = await llm.generate(
        f"请回答以下问题（不需要完全准确）：{query}"
    )
    
    # 2. 用假设性文档的 Embedding 做检索
    hyp_embedding = embed(hypothetical)
    results = vector_search(hyp_embedding, top_k=10)
    
    return results
```

---

## 6. Re-ranking 与后处理

### 6.1 Cross-Encoder Re-ranking

```python
from sentence_transformers import CrossEncoder

reranker = CrossEncoder('BAAI/bge-reranker-v2-m3')

def rerank(query: str, documents: list[str], top_k: int = 5):
    """使用 Cross-Encoder 对候选文档重排序"""
    # Cross-Encoder 为每个 (query, doc) 对打分
    pairs = [(query, doc) for doc in documents]
    scores = reranker.predict(pairs)
    
    # 按分数排序
    ranked = sorted(zip(documents, scores), key=lambda x: x[1], reverse=True)
    return ranked[:top_k]

# 工作流：
# 1. 粗召回：向量检索 top-50
# 2. 精排序：Cross-Encoder rerank top-5
results = vector_search(query, top_k=50)
final = rerank(query, [r.text for r in results], top_k=5)
```

### 6.2 上下文组装

```python
def build_rag_context(query: str, retrieved_docs: list, max_tokens: int = 4000):
    """将检索到的文档组装为 LLM 上下文"""
    context_parts = []
    total_tokens = 0
    
    for i, doc in enumerate(retrieved_docs):
        doc_tokens = count_tokens(doc.text)
        if total_tokens + doc_tokens > max_tokens:
            break
        
        context_parts.append(f"[来源 {i+1}: {doc.metadata.get('source', '未知')}]\n{doc.text}")
        total_tokens += doc_tokens
    
    context = "\n\n---\n\n".join(context_parts)
    
    prompt = f"""基于以下参考资料回答用户问题。如果参考资料中没有相关信息，请明确说明。
请在回答中标注引用来源（如 [来源 1]）。

参考资料：
{context}

用户问题：{query}"""
    
    return prompt
```

---

## 7. RAG 评估体系

### 7.1 RAGAS 核心指标

| 指标 | 评估对象 | 说明 |
|------|---------|------|
| Faithfulness | 生成 → 上下文 | 答案是否忠于检索到的上下文（无幻觉） |
| Answer Relevancy | 生成 → 问题 | 答案是否切题 |
| Context Precision | 检索 | 检索结果中相关文档的排名位置 |
| Context Recall | 检索 | 检索到的相关文档覆盖率 |

### 7.2 RAGAS 实践

```python
from ragas import evaluate
from ragas.metrics import faithfulness, answer_relevancy, context_precision, context_recall

# 准备评估数据
eval_dataset = {
    "question": ["什么是 PagedAttention？"],
    "answer": ["PagedAttention 是 vLLM 的核心技术..."],
    "contexts": [["PagedAttention 将 KV Cache 按页管理..."]],
    "ground_truth": ["PagedAttention 借鉴操作系统虚拟内存分页..."]
}

result = evaluate(
    dataset=eval_dataset,
    metrics=[faithfulness, answer_relevancy, context_precision, context_recall]
)
print(result)
# {'faithfulness': 0.92, 'answer_relevancy': 0.88, 
#  'context_precision': 0.85, 'context_recall': 0.90}
```

---

## 8. 生产部署与运维

### 8.1 增量索引管线

```python
class IncrementalIndexer:
    """增量索引：只处理新增/修改的文档"""
    
    async def index_document(self, doc_id: str, content: str):
        # 1. 计算内容哈希
        content_hash = hashlib.sha256(content.encode()).hexdigest()
        
        # 2. 检查是否已索引（且内容未变）
        existing = await db.get_document_hash(doc_id)
        if existing == content_hash:
            return  # 内容未变，跳过
        
        # 3. 删除旧的分块
        await vector_db.delete(filter={"doc_id": doc_id})
        
        # 4. 重新分块、Embedding、索引
        chunks = self.splitter.split(content)
        embeddings = await self.embed_batch(chunks)
        await vector_db.upsert(chunks, embeddings, metadata={"doc_id": doc_id})
        
        # 5. 更新哈希记录
        await db.update_document_hash(doc_id, content_hash)
```

### 8.2 监控指标

| 指标 | 说明 | 告警阈值 |
|------|------|---------|
| 检索延迟 | 向量搜索耗时 | P99 > 200ms |
| Recall@10 | 检索命中率 | < 0.7 |
| LLM Faithfulness | 答案忠实度 | < 0.8 |
| 无答案率 | "我不知道"的比例 | > 30% |

---

## 9. 常见陷阱与最佳实践

### ❌ 陷阱 1：只用向量检索

```python
# ❌ 错误：纯向量检索对精确关键词（错误码、API名称）不敏感
results = vector_search("ERR_CONNECTION_REFUSED", top_k=10)

# ✅ 正确：混合检索 = 向量 + BM25
results = hybrid_search("ERR_CONNECTION_REFUSED", alpha=0.3)  # BM25 权重更高
```

### ❌ 陷阱 2：分块太大或太小

```python
# ❌ 错误：2000 tokens 的大块 — 检索精度低，上下文浪费
splitter = RecursiveCharacterTextSplitter(chunk_size=2000)

# ❌ 错误：100 tokens 的小块 — 缺乏上下文，语义不完整
splitter = RecursiveCharacterTextSplitter(chunk_size=100)

# ✅ 正确：300-600 tokens，带 50-100 overlap
splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)
```

### ❌ 陷阱 3：不做 Re-ranking

```python
# ❌ 错误：直接用 Top-K 向量检索结果
results = vector_search(query, top_k=5)
# 向量检索的排序质量有限，很多"语义相近但不相关"的结果

# ✅ 正确：粗召回 + 精排序
candidates = vector_search(query, top_k=50)  # 粗召回
final = rerank(query, candidates, top_k=5)    # 精排序
```

### ❌ 陷阱 4：不评估 RAG 质量

```python
# ❌ 错误：部署后不做任何评估，"感觉还行"
# 无法知道检索质量是否在退化

# ✅ 正确：定期自动评估
# 1. 维护评估集（问题 + 标准答案 + 相关文档）
# 2. 每次更新索引后运行 RAGAS 评估
# 3. 设置 Faithfulness < 0.8 的自动告警
```

### ❌ 陷阱 5：文档更新后不更新索引

```python
# ❌ 错误：文档修改后旧版本的分块仍在向量库中
# 用户可能得到过时的信息

# ✅ 正确：使用增量索引管线
# 文档修改 → 删除旧分块 → 重新分块+索引
```

---

## 10. 延伸与前沿

### 10.1 Graph RAG

传统 RAG 检索的是独立的文本块，Graph RAG 额外构建知识图谱，捕获实体间关系：

```
文本块: "vLLM 使用 PagedAttention 管理 KV Cache"
→ 图谱三元组: (vLLM, 使用, PagedAttention), (PagedAttention, 管理, KV Cache)
```

### 10.2 Agentic RAG

RAG 从被动检索升级为主动规划：
- **Self-RAG**：LLM 自主决定是否需要检索、检索什么
- **Corrective RAG**：检索后自动评估结果质量，不满意则重新检索
- **Adaptive RAG**：根据问题类型自动选择检索策略

### 10.3 多模态 RAG

- **图片检索**：通过 CLIP 等模型实现图文混合检索
- **表格理解**：将表格转换为结构化数据后检索
- **代码检索**：基于 AST 和代码语义的检索
