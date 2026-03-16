# 04-记忆系统与RAG — 技术资料

> 从四种记忆类型到 RAG 全链路，系统拆解向量嵌入、ANN 搜索（HNSW 内核）、Chunking 策略、LlamaIndex/Haystack 源码，以及 HyDE/Self-RAG/Graph RAG 等高级检索增强技术。

## 相关链接

- 对应面试题：[04-记忆系统面试题](../../02-面试指南/07-AI-Agent全栈开发面试/04-记忆系统面试题.md)

---

## 目录

1. [四种记忆类型](#1-四种记忆类型)
   - 1.1 上下文内记忆（In-Context Memory）
   - 1.2 外部持久化记忆（External Persistent Memory）
   - 1.3 外部检索记忆（Retrieval / RAG）
   - 1.4 参数化记忆（Parametric Memory）
   - 1.5 四种类型横向对比
2. [RAG 全链路](#2-rag-全链路)
   - 2.1 全链路架构图
   - 2.2 Loading（文档加载）
   - 2.3 Chunking（分块）
   - 2.4 Indexing（索引构建）
   - 2.5 Storing（持久化存储）
   - 2.6 Querying（查询）
   - 2.7 Evaluation（评估）
3. [向量嵌入与 ANN 搜索](#3-向量嵌入与-ann-搜索)
   - 3.1 文本嵌入模型原理
   - 3.2 HNSW 算法内核
   - 3.3 Chroma 源码解析
   - 3.4 Milvus 架构解析
4. [Chunking 策略](#4-chunking-策略)
   - 4.1 Fixed-Size Chunking
   - 4.2 Recursive Chunking
   - 4.3 Semantic Chunking
   - 4.4 Agentic Chunking
   - 4.5 策略对比表
5. [LlamaIndex 源码分析](#5-llamaindex-源码分析)
   - 5.1 VectorStoreIndex 构建流程
   - 5.2 StorageContext 设计
   - 5.3 QueryEngine Pipeline
6. [Haystack Pipeline](#6-haystack-pipeline)
   - 6.1 组件模型设计
   - 6.2 pipeline.add_component 实现
   - 6.3 异步执行机制
7. [高级 RAG](#7-高级-rag)
   - 7.1 HyDE（假设文档嵌入）
   - 7.2 Self-RAG（检索决策）
   - 7.3 Corrective RAG
   - 7.4 Adaptive RAG
   - 7.5 Graph RAG
8. [RAGAS 评估框架](#8-ragas-评估框架)
   - 8.1 四大核心指标
   - 8.2 评估代码示例

---

## 1. 四种记忆类型

### 1.1 上下文内记忆（In-Context Memory）

上下文内记忆是最直接的记忆形式——把信息放入当前请求的 prompt/messages 列表中。

```
┌────────────────────────────────────────────┐
│            Context Window (128K tokens)     │
│                                            │
│  System Prompt   │  Tool Results           │
│  ─────────────   │  ──────────────         │
│  角色/规则        │  工具调用结果             │
│                  │                         │
│  Chat History    │  Retrieved Docs         │
│  ─────────────   │  ──────────────         │
│  对话历史         │  RAG 检索结果            │
└────────────────────────────────────────────┘
```

**实现模式：滑动窗口 + 摘要压缩**

```python
from langchain.memory import ConversationSummaryBufferMemory
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(model="gpt-4o")

# 超过 max_token_limit 时，旧消息自动压缩为摘要
memory = ConversationSummaryBufferMemory(
    llm=llm,
    max_token_limit=2000,
    return_messages=True,
    memory_key="chat_history",
)

# 内部实现：predict_new_summary() 调用 LLM 生成摘要
# langchain/memory/summary_buffer.py
def save_context(self, inputs, outputs):
    super().save_context(inputs, outputs)
    # 若超限则压缩
    if self.moving_summary_buffer == "":
        # 直接存储前 N 条
        pass
    else:
        # 调用 LLM 合并旧摘要 + 新消息
        self.moving_summary_buffer = self.predict_new_summary(
            self.chat_memory.messages[: -self.k * 2],
            self.moving_summary_buffer,
        )
```

**优缺点**

| 维度 | 说明 |
|------|------|
| 优点 | 零延迟、无检索误差、LLM 直接"看到"完整内容 |
| 缺点 | 受 context window 限制；长历史成本高 |
| 适用 | 短对话、单轮任务、tool result 注入 |

---

### 1.2 外部持久化记忆（External Persistent Memory）

将结构化的 key-value 数据、会话摘要或用户档案存储在外部数据库（Redis / PostgreSQL / DynamoDB），跨会话持久化。

```python
import redis
import json
from datetime import datetime

class RedisMemoryStore:
    """跨会话持久化记忆"""
    
    def __init__(self, redis_url: str, ttl: int = 86400 * 7):
        self.client = redis.from_url(redis_url)
        self.ttl = ttl  # 7天过期
    
    def save_session(self, user_id: str, session_id: str, messages: list):
        key = f"memory:{user_id}:{session_id}"
        self.client.setex(
            key,
            self.ttl,
            json.dumps({"messages": messages, "ts": datetime.utcnow().isoformat()})
        )
    
    def load_user_summary(self, user_id: str) -> str:
        key = f"summary:{user_id}"
        data = self.client.get(key)
        return json.loads(data)["summary"] if data else ""
    
    def update_user_profile(self, user_id: str, facts: dict):
        """增量更新用户画像"""
        key = f"profile:{user_id}"
        existing = self.client.hgetall(key) or {}
        existing.update(facts)
        self.client.hset(key, mapping=existing)
```

---

### 1.3 外部检索记忆（Retrieval / RAG）

通过向量相似度搜索，从大规模知识库中按需检索相关片段注入上下文。这是本文档的核心主题，详见 §2-§7。

---

### 1.4 参数化记忆（Parametric Memory）

模型权重本身就是压缩的"记忆"——通过预训练和微调将知识编码进参数。

```
预训练阶段（世界知识）          微调阶段（任务知识）
────────────────────          ────────────────────
万亿 token 语料                领域数据 / 指令对
          │                             │
          ▼                             ▼
    [Transformer 权重]  ──SFT/LoRA──▶ [专域权重]
    W_Q, W_K, W_V ...                W'_Q, W'_K ...
```

参数化记忆的局限：知识截止日期（training cutoff）、更新成本高、无法精确引用来源。这正是 RAG 存在的根本动机。

---

### 1.5 四种类型横向对比

| 维度 | In-Context | External Persistent | RAG/Retrieval | Parametric |
|------|-----------|--------------------|---------  ----|------------|
| 容量 | ~200K token | 无限（DB） | 无限（向量库） | 固定（参数量） |
| 延迟 | 0ms | ~5ms（KV读） | ~50-200ms | 0ms |
| 更新代价 | 即时 | 即时 | 索引更新（秒级） | 重训（天级） |
| 精确引用 | ✅ | ✅ | ✅ | ❌ |
| 跨会话 | ❌ | ✅ | ✅ | ✅ |
| 知识时效 | 实时 | 实时 | 近实时 | 训练截止 |

---

## 2. RAG 全链路

### 2.1 全链路架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        RAG 全链路                                │
└─────────────────────────────────────────────────────────────────┘

  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
  │  Loading │───▶│ Chunking │───▶│ Indexing │───▶│ Storing  │
  │文档加载   │    │ 分块切割  │    │ 向量化    │    │ 持久化   │
  └──────────┘    └──────────┘    └──────────┘    └──────────┘
                                                        │
  ┌─────────────────────────────────────────────────────┘
  │
  ▼
  ┌──────────────────────────────────────────┐
  │                Querying                   │
  │  用户 Query                               │
  │     │                                    │
  │     ▼                                    │
  │  Query 向量化                             │
  │     │                                    │
  │     ▼                                    │
  │  ANN 搜索（HNSW/IVF）                     │
  │     │                                    │
  │     ▼                                    │
  │  Re-ranking（可选）                       │
  │     │                                    │
  │     ▼                                    │
  │  上下文注入 → LLM 生成                    │
  └──────────────────────────────────────────┘
        │
        ▼
  ┌──────────┐
  │Evaluation│  RAGAS: Faithfulness / Answer Relevancy /
  │  评估    │  Context Precision / Context Recall
  └──────────┘
```

---

### 2.2 Loading（文档加载）

LlamaIndex 的 `SimpleDirectoryReader` 和 `PDFReader` 是常用加载器。

```python
from llama_index.core import SimpleDirectoryReader
from llama_index.readers.file import PDFReader

# 加载本地目录（支持 PDF/DOCX/TXT/HTML/CSV）
documents = SimpleDirectoryReader(
    input_dir="./knowledge_base",
    required_exts=[".pdf", ".md", ".txt"],
    recursive=True,              # 递归子目录
    num_files_limit=100,
).load_data()

# 每个 Document 对象：
# document.text          - 原始文本
# document.metadata      - {"file_name": ..., "page_label": ...}
# document.doc_id        - UUID

# 自定义 PDFReader（含页码元数据）
pdf_reader = PDFReader()
pdf_docs = pdf_reader.load_data(file="./report.pdf")
# metadata: {"page_label": "1", "file_name": "report.pdf"}
```

**LlamaIndex SimpleDirectoryReader 内部调用链**

```
SimpleDirectoryReader.load_data()
  │
  ├── _load_data_from_paths()
  │     │
  │     └── 遍历文件 → 按扩展名选 Reader
  │           ├── .pdf  → PDFReader (uses pypdf)
  │           ├── .docx → DocxReader (uses python-docx)
  │           ├── .html → HTMLTagReader (uses bs4)
  │           └── .txt  → 直接读取
  │
  └── Document(text=..., metadata=file_metadata)
```

---

### 2.3 Chunking（分块）

详见 §4，此处展示 LlamaIndex 内置的 `SentenceSplitter`：

```python
from llama_index.core.node_parser import SentenceSplitter

splitter = SentenceSplitter(
    chunk_size=512,       # tokens
    chunk_overlap=50,     # overlap tokens
    paragraph_separator="\n\n",
)

nodes = splitter.get_nodes_from_documents(documents)
# 每个 Node:
# node.text           - 分块文本
# node.metadata       - 继承自父 Document
# node.relationships  - PREVIOUS/NEXT/SOURCE 关系图
```

---

### 2.4 Indexing（索引构建）

```python
from llama_index.core import VectorStoreIndex, Settings
from llama_index.embeddings.openai import OpenAIEmbedding

# 全局配置嵌入模型
Settings.embed_model = OpenAIEmbedding(model="text-embedding-3-small")

# 构建向量索引（内部调用 embed_model 批量编码）
index = VectorStoreIndex.from_documents(
    documents,
    show_progress=True,
)
# 内部流程：
# 1. documents → SentenceSplitter → nodes
# 2. 批量调用 embed_model.get_text_embedding_batch(texts)
# 3. 写入 SimpleVectorStore（默认 in-memory）
```

---

### 2.5 Storing（持久化存储）

```python
from llama_index.core import StorageContext
from llama_index.vector_stores.chroma import ChromaVectorStore
import chromadb

# 连接 Chroma
chroma_client = chromadb.PersistentClient(path="./chroma_db")
chroma_collection = chroma_client.get_or_create_collection("knowledge")

# 构建 StorageContext
vector_store = ChromaVectorStore(chroma_collection=chroma_collection)
storage_context = StorageContext.from_defaults(vector_store=vector_store)

# 构建并持久化索引
index = VectorStoreIndex.from_documents(
    documents,
    storage_context=storage_context,
)

# 下次直接加载（无需重新索引）
index = VectorStoreIndex.from_vector_store(
    vector_store,
    storage_context=storage_context,
)
```

---

### 2.6 Querying（查询）

```python
# 创建 QueryEngine
query_engine = index.as_query_engine(
    similarity_top_k=5,        # 检索 Top-5
    response_mode="compact",   # compact/tree_summarize/refine
)

response = query_engine.query("什么是 HNSW 算法？")
print(response.response)

# 查看检索到的源文档
for node in response.source_nodes:
    print(f"Score: {node.score:.3f} | {node.node.text[:100]}")
```

---

### 2.7 Evaluation（评估）

详见 §8。

---

## 3. 向量嵌入与 ANN 搜索

### 3.1 文本嵌入模型原理

文本嵌入将离散 token 序列映射到连续语义空间中的稠密向量：

```
输入文本: "HNSW 是一种近似最近邻搜索算法"
    │
    ▼
Tokenizer（BPE）
    │  ["HNSW", "是", "一种", "近似", "最近邻", "搜索", "算法"]
    ▼
Transformer Encoder（BERT/E5/BGE）
    │  [CLS] token 的隐藏状态 or Mean Pooling
    ▼
L2 Normalize
    │
    ▼
向量: [0.023, -0.156, 0.891, ..., 0.042]  # 1536 维（text-embedding-3-small）
```

主流嵌入模型对比：

| 模型 | 维度 | MTEB 均分 | 适用场景 |
|------|------|-----------|---------|
| text-embedding-3-small | 1536 | 62.3 | 通用、低成本 |
| text-embedding-3-large | 3072 | 64.6 | 高精度 |
| BGE-M3 | 1024 | 66.7 | 多语言、开源 |
| E5-mistral-7b | 4096 | 66.6 | 长文本 |

---

### 3.2 HNSW 算法内核

HNSW（Hierarchical Navigable Small World）是当前最主流的 ANN 索引结构。

**分层结构**

```
Layer 2 (稀疏):  1 ──── 7
                        │
Layer 1 (中密):  1 ─ 3 ─ 7 ─ 9
                     │       │
Layer 0 (稠密):  1-2-3-4-5-6-7-8-9-10  ← 所有节点
```

**插入算法（Insert）**

```python
def hnsw_insert(hnsw, new_element, M=16, ef_construction=200):
    """
    M: 每层最大出度
    ef_construction: 构建时候选集大小（影响质量 vs 速度）
    """
    # 1. 随机决定该节点的最高层
    #    level ~ floor(-ln(uniform(0,1)) * mL)，mL = 1/ln(M)
    node_level = floor(-log(random()) * (1 / log(M)))
    
    # 2. 从顶层开始贪心搜索，找到进入下层的入口点
    entry_point = hnsw.entry_point
    for layer in range(hnsw.max_layer, node_level + 1, -1):
        entry_point = greedy_search(layer, new_element, entry_point, ef=1)
    
    # 3. 从 node_level 到 layer 0，执行 ef_construction 候选集搜索并连边
    for layer in range(min(node_level, hnsw.max_layer), -1, -1):
        # 找到 ef_construction 个最近邻候选
        candidates = search_layer(new_element, entry_point, ef_construction, layer)
        # 启发式剪枝：选 M 个邻居（保证多样性）
        neighbors = select_neighbors_heuristic(new_element, candidates, M)
        # 双向建边
        for neighbor in neighbors:
            connect(new_element, neighbor, layer)
            # 若邻居出度超 M，重新剪枝
            if degree(neighbor, layer) > M:
                prune_connections(neighbor, layer, M)
        entry_point = candidates[0]  # 更新入口
```

**查询算法（Search）**

```python
def hnsw_search(hnsw, query, k, ef=50):
    """
    ef: 查询时候选集大小（ef >= k，越大越准确但越慢）
    时间复杂度: O(log N) 期望
    """
    entry = hnsw.entry_point
    
    # 从高层贪心下降到 layer 1
    for layer in range(hnsw.max_layer, 0, -1):
        entry = greedy_search(query, entry, ef=1, layer=layer)
    
    # 在 layer 0 用 ef 大小的候选集做精细搜索
    candidates = search_layer(query, entry, ef, layer=0)
    
    return candidates[:k]  # 返回 Top-k
```

**HNSW 参数影响矩阵**

| 参数 | 增大效果 | 代价 |
|------|---------|------|
| M（出度） | 召回率↑ | 内存↑、构建时间↑ |
| ef_construction | 构建质量↑ | 构建时间↑ |
| ef（查询） | 召回率↑ | 查询延迟↑ |

---

### 3.3 Chroma 源码解析

Chroma 使用 hnswlib（C++ 绑定）作为 HNSW 底层实现。

```python
# chroma-core/chroma: chromadb/segment/impl/vector/local_hnsw.py

class LocalHnswSegment(VectorReader):
    """Chroma 本地 HNSW 段"""
    
    def _init_index(self, dimensionality: int):
        index = hnswlib.Index(space=self._params.space, dim=dimensionality)
        index.init_index(
            max_elements=self._params._max_elements,
            ef_construction=self._params.ef_construction,  # 默认 100
            M=self._params.M,                               # 默认 16
            random_seed=self._params.random_seed,
        )
        index.set_ef(self._params.ef)  # 查询 ef，默认 10
        return index
    
    def upsert(self, vectors: Sequence[VectorEmbeddingRecord]):
        """批量写入向量"""
        # 1. 分配 int 类型 label（Chroma UUID → int 映射存于 _label_to_id）
        labels = self._get_or_create_labels([v.id for v in vectors])
        embeddings = np.array([v.embedding for v in vectors])
        # 2. 调用 hnswlib 批量插入
        self._index.add_items(embeddings, labels, num_threads=4)
    
    def query(self, vectors, k, allowed_ids=None):
        """ANN 查询"""
        # 1. 调用 hnswlib knn_query
        labels, distances = self._index.knn_query(vectors, k=k)
        # 2. label → UUID 反查
        ids = [[self._id_to_label[l] for l in row] for row in labels]
        return ids, distances
```

**Chroma 持久化写入路径**

```
chromadb.add(documents, embeddings, ids)
  │
  ├── EmbeddingQueue.submit()          # 异步队列
  │
  ├── LocalHnswSegment.upsert()        # HNSW 索引更新
  │     └── hnswlib.Index.add_items()  # C++ 层写入
  │
  └── SqliteMetadataSegment.upsert()   # 元数据写入 SQLite
        └── documents/metadata 存储
```

---

### 3.4 Milvus 架构解析

Milvus 是分布式向量数据库，适合亿级向量。

```
┌─────────────────────────────────────────────────────┐
│                   Milvus 架构                        │
│                                                     │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐            │
│  │  Proxy  │  │  Root   │  │  Data   │  ← 协调层   │
│  │  接入层  │  │  Coord  │  │  Coord  │            │
│  └────┬────┘  └─────────┘  └─────────┘            │
│       │                                            │
│  ┌────▼─────────────────────────────────┐          │
│  │           Query Nodes                │  ← 查询层 │
│  │  内存中维护 Growing Segment（新数据）  │          │
│  │  + Sealed Segment（HNSW/IVF 索引）   │          │
│  └──────────────────────────────────────┘          │
│                                                     │
│  ┌──────────────────────────────────────┐          │
│  │           Data Nodes                 │  ← 存储层 │
│  │  WAL (Pulsar/Kafka) → S3/MinIO       │          │
│  └──────────────────────────────────────┘          │
└─────────────────────────────────────────────────────┘
```

```python
from pymilvus import MilvusClient, DataType

client = MilvusClient(uri="http://localhost:19530")

# 创建 Collection（Schema 定义）
schema = client.create_schema(auto_id=True, enable_dynamic_field=True)
schema.add_field("id", DataType.INT64, is_primary=True)
schema.add_field("embedding", DataType.FLOAT_VECTOR, dim=1536)
schema.add_field("text", DataType.VARCHAR, max_length=4096)

# HNSW 索引参数
index_params = client.prepare_index_params()
index_params.add_index(
    field_name="embedding",
    index_type="HNSW",
    metric_type="COSINE",
    params={"M": 16, "efConstruction": 200},
)

client.create_collection("knowledge", schema=schema, index_params=index_params)

# 批量插入
client.insert("knowledge", data=[
    {"embedding": emb, "text": text}
    for emb, text in zip(embeddings, texts)
])

# 查询（混合搜索：向量 + 标量过滤）
results = client.search(
    collection_name="knowledge",
    data=[query_embedding],
    limit=5,
    filter='text like "%Python%"',   # 标量过滤（Bitset 加速）
    output_fields=["text"],
    search_params={"ef": 64},
)
```

---

## 4. Chunking 策略

### 4.1 Fixed-Size Chunking

最简单的策略：按固定 token 数切分，允许重叠。

```python
from langchain.text_splitter import TokenTextSplitter

splitter = TokenTextSplitter(
    chunk_size=512,
    chunk_overlap=64,
    encoding_name="cl100k_base",  # tiktoken
)

chunks = splitter.split_text(long_text)
```

**优点**：简单、可预测；**缺点**：在语义边界中间截断，上下文破碎。

---

### 4.2 Recursive Chunking

LangChain 最常用分块器，按分隔符优先级递归切分：

```python
from langchain.text_splitter import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=100,
    # 分隔符优先级（从高到低尝试）
    separators=["\n\n", "\n", "。", "！", "？", ".", "!", "?", " ", ""],
)

# 内部实现（简化版）：
# def _split_text(text, separators):
#     separator = separators[0]  # 尝试最高优先级
#     splits = text.split(separator)
#     for split in splits:
#         if len(split) <= chunk_size:
#             good_splits.append(split)
#         else:
#             # 递归用下一级分隔符
#             _split_text(split, separators[1:])
```

---

### 4.3 Semantic Chunking

基于嵌入相似度的语义分块，在语义断点处切分：

```python
from llama_index.core.node_parser import SemanticSplitterNodeParser
from llama_index.embeddings.openai import OpenAIEmbedding

semantic_splitter = SemanticSplitterNodeParser(
    buffer_size=1,               # 前后各看 1 句
    breakpoint_percentile_threshold=95,  # 余弦距离 95 分位数作为阈值
    embed_model=OpenAIEmbedding(),
)

nodes = semantic_splitter.get_nodes_from_documents(documents)

# 内部算法：
# 1. 按句子分割文本
# 2. 计算相邻句子组的嵌入向量
# 3. 计算余弦距离序列
# 4. 距离突变点（> 95 分位数）作为分块边界
```

---

### 4.4 Agentic Chunking

让 LLM 自行决定分块边界，适合结构不规则的文档：

```python
from openai import OpenAI

client = OpenAI()

AGENTIC_CHUNK_PROMPT = """
你是一个文档分析专家。请将以下文本分割成语义完整的片段。
每个片段应该：
1. 包含一个完整的主题或概念
2. 可以独立理解，无需依赖其他片段
3. 不超过 800 字

请以 JSON 格式返回：{"chunks": ["片段1", "片段2", ...]}

文本：
{text}
"""

def agentic_chunk(text: str) -> list[str]:
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": AGENTIC_CHUNK_PROMPT.format(text=text)}],
    )
    return json.loads(response.choices[0].message.content)["chunks"]
```

**适用场景**：法律合同、学术论文、技术规格书等结构复杂文档。

---

### 4.5 策略对比表

| 策略 | 语义完整性 | 速度 | 成本 | 适用场景 |
|------|-----------|------|------|---------|
| Fixed-Size | ⭐⭐ | ⚡⚡⚡ | 极低 | 结构均匀的纯文本 |
| Recursive | ⭐⭐⭐ | ⚡⚡⚡ | 极低 | 通用文档（首选） |
| Semantic | ⭐⭐⭐⭐ | ⚡⚡ | 中（需嵌入） | 学术/技术文档 |
| Agentic | ⭐⭐⭐⭐⭐ | ⚡ | 高（需 LLM） | 结构复杂/不规则文档 |

**Chunk Size 经验值**

```
问答系统:      256 ~ 512 tokens   （检索精度优先）
摘要/归纳:    512 ~ 1024 tokens   （上下文丰富度优先）
代码检索:     函数级别（100~300 tokens）
长文档分析:  Parent-Child（父: 1024, 子: 256）
```

---

## 5. LlamaIndex 源码分析

### 5.1 VectorStoreIndex 构建流程

```python
# llama-index-core/llama_index/core/indices/vector_store/base.py

class VectorStoreIndex(BaseIndex[IndexDict]):
    
    @classmethod
    def from_documents(
        cls,
        documents: Sequence[Document],
        storage_context: Optional[StorageContext] = None,
        **kwargs,
    ) -> "VectorStoreIndex":
        # 1. 初始化存储上下文
        storage_context = storage_context or StorageContext.from_defaults()
        
        # 2. 构建索引（调用 __init__ → _build_index_from_nodes）
        return cls(
            nodes=None,
            documents=documents,
            storage_context=storage_context,
            **kwargs,
        )
    
    def _build_index_from_nodes(
        self, nodes: Sequence[BaseNode]
    ) -> IndexDict:
        # 关键方法：批量嵌入 + 写入向量存储
        index_struct = IndexDict()
        
        # 批量嵌入（默认 batch_size=2048）
        nodes_with_embeddings = self._embed_nodes(
            nodes,
            show_progress=self._show_progress,
        )
        
        # 写入 VectorStore
        new_ids = self._vector_store.add(
            [NodeWithEmbedding(node=n, embedding=n.embedding) 
             for n in nodes_with_embeddings]
        )
        
        # 更新 IndexDict（node_id → doc_id 映射）
        for node, node_id in zip(nodes_with_embeddings, new_ids):
            index_struct.add_node(node, text_id=node_id)
        
        return index_struct
    
    def _embed_nodes(self, nodes, show_progress=False):
        """批量嵌入（利用 embed_model 的批处理能力）"""
        id_to_embed_map: Dict[str, List[float]] = {}
        
        texts_to_embed = [node.get_content(metadata_mode=MetadataMode.EMBED) 
                          for node in nodes]
        
        # 调用 embed_model.get_text_embedding_batch()
        new_embeddings = self._embed_model.get_text_embedding_batch(
            texts_to_embed,
            show_progress=show_progress,
        )
        
        for node, embedding in zip(nodes, new_embeddings):
            node.embedding = embedding
        
        return nodes
```

---

### 5.2 StorageContext 设计

`StorageContext` 是 LlamaIndex 的依赖注入容器，聚合所有存储后端：

```python
# llama_index/core/storage/storage_context.py

@dataclass
class StorageContext:
    """所有存储组件的聚合容器"""
    
    docstore: BaseDocumentStore          # 文档元数据存储（默认 SimpleDocumentStore）
    index_store: BaseIndexStore          # 索引结构存储（IndexDict 等）
    vector_store: VectorStore            # 向量存储（Chroma/Milvus/Pinecone...）
    graph_store: GraphStore              # 知识图谱（可选）
    image_store: VectorStore             # 多模态图像向量（可选）
    
    @classmethod
    def from_defaults(
        cls,
        vector_store: Optional[VectorStore] = None,
        persist_dir: Optional[str] = None,
        ...
    ) -> "StorageContext":
        """工厂方法：构建默认或自定义存储上下文"""
        
        vector_store = vector_store or SimpleVectorStore()
        docstore = SimpleDocumentStore()
        index_store = SimpleIndexStore()
        
        return cls(
            docstore=docstore,
            index_store=index_store,
            vector_store=vector_store,
        )
    
    def persist(self, persist_dir: str = DEFAULT_PERSIST_DIR):
        """将所有存储持久化到磁盘"""
        self.docstore.persist(os.path.join(persist_dir, DOCSTORE_FNAME))
        self.index_store.persist(os.path.join(persist_dir, INDEX_STORE_FNAME))
        self.vector_store.persist(os.path.join(persist_dir, VECTOR_STORE_FNAME))
```

---

### 5.3 QueryEngine Pipeline

```
query_engine.query("问题")
  │
  ▼
RetrieverQueryEngine.query()
  │
  ├─▶ [1] VectorIndexRetriever.retrieve()
  │         │
  │         ├── embed_model.get_query_embedding(query_str)
  │         │       → query_embedding: List[float]
  │         │
  │         └── vector_store.query(VectorStoreQuery(
  │                 query_embedding=...,
  │                 similarity_top_k=k,
  │                 mode=VectorStoreQueryMode.DEFAULT
  │             ))
  │                 → [NodeWithScore(node, score), ...]
  │
  ├─▶ [2] NodePostprocessors（可选链）
  │         ├── SimilarityPostprocessor(cutoff=0.7)  过滤低分节点
  │         ├── KeywordNodePostprocessor             关键词过滤
  │         └── SentenceTransformerRerank            Cross-Encoder 重排序
  │
  └─▶ [3] ResponseSynthesizer.synthesize()
            │
            ├── mode="compact":  合并节点文本 → 单次 LLM 调用
            ├── mode="refine":   节点逐一 refine → 多次 LLM 调用
            └── mode="tree_summarize": 树状归纳 → 适合长文档
```

```python
from llama_index.core.query_engine import RetrieverQueryEngine
from llama_index.core.retrievers import VectorIndexRetriever
from llama_index.core.response_synthesizers import get_response_synthesizer
from llama_index.core.postprocessor import SimilarityPostprocessor, SentenceTransformerRerank

# 自定义 QueryEngine 每个组件
retriever = VectorIndexRetriever(index=index, similarity_top_k=10)

reranker = SentenceTransformerRerank(
    model="cross-encoder/ms-marco-MiniLM-L-6-v2",
    top_n=3,  # 重排后保留 3 个
)

synthesizer = get_response_synthesizer(response_mode="compact")

query_engine = RetrieverQueryEngine(
    retriever=retriever,
    node_postprocessors=[
        SimilarityPostprocessor(similarity_cutoff=0.6),
        reranker,
    ],
    response_synthesizer=synthesizer,
)
```

---

## 6. Haystack Pipeline

### 6.1 组件模型设计

Haystack 2.x 采用基于**有向图**的 Pipeline 模型，每个组件是图中的一个节点。

```python
# haystack/core/component/component.py

from haystack import component

@component
class TextEmbedder:
    """Haystack 组件装饰器：自动注册 input/output socket"""
    
    def __init__(self, model: str = "sentence-transformers/all-MiniLM-L6-v2"):
        self.model = SentenceTransformer(model)
    
    # @component.output_types 声明输出类型（用于类型检查和 Pipeline 连线验证）
    @component.output_types(embedding=List[float])
    def run(self, text: str):
        embedding = self.model.encode(text).tolist()
        return {"embedding": embedding}

# 组件的核心机制：
# - run() 参数 → 自动推断为 InputSocket
# - @component.output_types → 注册 OutputSocket
# - Pipeline 连线时进行类型兼容性检查
```

---

### 6.2 pipeline.add_component 实现

```python
# haystack/core/pipeline/base.py（简化）

class PipelineBase:
    
    def __init__(self):
        self.graph = networkx.MultiDiGraph()  # 有向图
        self._components: Dict[str, Component] = {}
    
    def add_component(self, name: str, instance: Component):
        """
        注册组件到 Pipeline 图
        1. 验证 name 唯一性
        2. 将 instance 添加为图节点
        3. 存储 input/output sockets 元数据
        """
        if name in self._components:
            raise ValueError(f"Component named '{name}' already exists")
        
        self._components[name] = instance
        # 图节点携带组件元数据
        self.graph.add_node(
            name,
            instance=instance,
            input_sockets=instance.__haystack_input__._sockets_dict,
            output_sockets=instance.__haystack_output__._sockets_dict,
            visits=0,
        )
    
    def connect(self, sender: str, receiver: str):
        """
        连接两个组件的 socket
        sender:   "component_name.output_socket"
        receiver: "component_name.input_socket"
        """
        sender_component, sender_socket = sender.split(".")
        receiver_component, receiver_socket = receiver.split(".")
        
        # 类型兼容性检查
        out_type = self.graph.nodes[sender_component]["output_sockets"][sender_socket].type
        in_type  = self.graph.nodes[receiver_component]["input_sockets"][receiver_socket].type
        
        if not _types_are_compatible(out_type, in_type):
            raise PipelineConnectError(f"Type mismatch: {out_type} → {in_type}")
        
        # 添加有向边
        self.graph.add_edge(sender_component, receiver_component,
                            key=f"{sender_socket}/{receiver_socket}",
                            sender_socket=sender_socket,
                            receiver_socket=receiver_socket)
```

---

### 6.3 完整 RAG Pipeline 示例

```python
from haystack import Pipeline
from haystack.components.retrievers.in_memory import InMemoryEmbeddingRetriever
from haystack.components.builders import PromptBuilder
from haystack.components.generators import OpenAIGenerator
from haystack.components.embedders import (
    SentenceTransformersTextEmbedder,
    SentenceTransformersDocumentEmbedder,
)
from haystack.document_stores.in_memory import InMemoryDocumentStore

# 1. 构建文档库
doc_store = InMemoryDocumentStore()
doc_embedder = SentenceTransformersDocumentEmbedder(
    model="sentence-transformers/all-MiniLM-L6-v2"
)
doc_embedder.warm_up()

from haystack import Document
docs = [Document(content="HNSW 是分层可导航小世界图算法"),
        Document(content="RAG 将检索与生成结合")]
docs_with_embeddings = doc_embedder.run(docs)["documents"]
doc_store.write_documents(docs_with_embeddings)

# 2. 构建查询 Pipeline
rag_pipeline = Pipeline()
rag_pipeline.add_component("embedder", 
    SentenceTransformersTextEmbedder(model="sentence-transformers/all-MiniLM-L6-v2"))
rag_pipeline.add_component("retriever",
    InMemoryEmbeddingRetriever(document_store=doc_store, top_k=3))
rag_pipeline.add_component("prompt_builder", PromptBuilder(template="""
根据以下上下文回答问题。
上下文: {% for doc in documents %}{{ doc.content }}{% endfor %}
问题: {{ question }}
"""))
rag_pipeline.add_component("llm", OpenAIGenerator(model="gpt-4o-mini"))

# 3. 连接组件（有向图连边）
rag_pipeline.connect("embedder.embedding", "retriever.query_embedding")
rag_pipeline.connect("retriever.documents", "prompt_builder.documents")
rag_pipeline.connect("prompt_builder.prompt", "llm.prompt")

# 4. 运行（同步）
result = rag_pipeline.run({
    "embedder": {"text": "什么是 HNSW？"},
    "prompt_builder": {"question": "什么是 HNSW？"},
})
print(result["llm"]["replies"][0])
```

### 6.3 异步执行机制

Haystack 2.x 的 `AsyncPipeline` 对无依赖的组件并发执行：

```python
import asyncio
from haystack import AsyncPipeline

async_pipeline = AsyncPipeline()
# 添加组件（与同步 API 相同）

# 并发执行：Haystack 分析有向图的拓扑顺序
# 同一层（无依赖关系）的组件通过 asyncio.gather() 并发执行
result = await async_pipeline.run_async({"embedder": {"text": "..."}})

# 内部实现（简化）：
# async def _run_component(name, inputs):
#     component = self._components[name]
#     if hasattr(component, "run_async"):
#         return await component.run_async(**inputs)
#     else:
#         # 同步组件在线程池中执行，避免阻塞事件循环
#         return await asyncio.get_event_loop().run_in_executor(
#             None, partial(component.run, **inputs)
#         )
```

---

## 7. 高级 RAG

### 7.1 HyDE（假设文档嵌入）

HyDE 解决的问题：**查询向量与文档向量的语义鸿沟**（query-document asymmetry）。

```
传统 RAG:
  用户 Query → embed(Query) → ANN 搜索
  问题：Query 是问题句，文档是陈述句，嵌入空间分布不同

HyDE:
  用户 Query → LLM 生成假设答案 → embed(假设答案) → ANN 搜索
  假设答案与真实文档在嵌入空间更接近
```

```python
from llama_index.core.indices.query.query_transform import HyDEQueryTransform
from llama_index.core.query_engine import TransformQueryEngine

# HyDE 变换器
hyde = HyDEQueryTransform(
    include_original=True,   # 同时保留原始 Query
    llm=Settings.llm,
)

# 包装 QueryEngine
hyde_query_engine = TransformQueryEngine(
    query_engine=base_query_engine,
    query_transform=hyde,
)

# 内部实现：
# def run(self, query_bundle):
#     # 1. 用 LLM 生成假设文档
#     hypothetical_doc = llm.predict(
#         HYDE_PROMPT.format(query=query_bundle.query_str)
#     )
#     # 2. 嵌入假设文档（而非原始 Query）
#     hypothetical_embedding = embed_model.get_text_embedding(hypothetical_doc)
#     # 3. 用假设嵌入检索
#     return QueryBundle(
#         query_str=query_bundle.query_str,
#         embedding=hypothetical_embedding,
#     )
```

---

### 7.2 Self-RAG（检索决策）

Self-RAG 让模型**自主决定是否需要检索**，以及**评估检索结果质量**。

```
┌─────────────────────────────────────────────────────┐
│                   Self-RAG 流程                      │
└─────────────────────────────────────────────────────┘

用户 Query
  │
  ▼
[Retrieve token 预测]
  ├── "Retrieve=Yes" → 触发检索 → 生成 IsRel token（是否相关）
  │                              → 生成 IsSup token（是否支撑答案）
  └── "Retrieve=No"  → 直接生成答案
                              │
                              ▼
                    [IsUse token 预测]（答案是否有用）
                              │
                    ── 选择最优生成路径 ──▶ 最终答案
```

```python
# 简化的 Self-RAG 实现（基于特殊 token 分类）
RETRIEVE_TOKEN   = "[Retrieve]"
ISREL_TOKEN_YES  = "[Relevant]"
ISREL_TOKEN_NO   = "[Irrelevant]"
ISSUP_TOKEN_FULL = "[Fully supported]"
ISSUP_TOKEN_PART = "[Partially supported]"
ISUSE_TOKEN      = "[Utility:5]"  # 1-5 分

def self_rag_generate(query: str, retriever, llm) -> str:
    # 步骤 1：判断是否需要检索
    retrieve_decision = llm.predict(f"{query}\n{RETRIEVE_TOKEN}")
    
    if "Yes" in retrieve_decision:
        # 步骤 2：检索
        docs = retriever.retrieve(query)
        
        # 步骤 3：对每个文档评估相关性
        candidates = []
        for doc in docs:
            relevance = llm.predict(f"Context: {doc.text}\nQuery: {query}\n{ISREL_TOKEN_YES}")
            if ISREL_TOKEN_YES in relevance:
                # 步骤 4：生成并评估支撑度
                answer = llm.predict(f"Context: {doc.text}\nQuery: {query}")
                support = llm.predict(f"{answer}\n{ISSUP_TOKEN_FULL}")
                utility = llm.predict(f"{answer}\n{ISUSE_TOKEN}")
                candidates.append((answer, support, utility))
        
        # 步骤 5：选择评分最高的答案
        return max(candidates, key=lambda x: score(x[1], x[2]))[0]
    else:
        return llm.predict(query)
```

---

### 7.3 Corrective RAG

CRAG 引入**检索评估器**（Retrieval Evaluator）和**知识精炼**（Knowledge Refinement）步骤：

```
Query → 检索 → [评估器]
                  │
                  ├── 置信度高  → 直接使用文档 → 生成答案
                  ├── 置信度中  → 知识精炼（去噪）→ 生成答案
                  └── 置信度低  → Web 搜索补充 → 知识精炼 → 生成答案
```

```python
from langgraph.graph import StateGraph, END
from typing import TypedDict, Annotated

class CRAGState(TypedDict):
    question: str
    documents: list
    generation: str
    web_search_needed: bool

def grade_documents(state: CRAGState):
    """评估检索文档相关性"""
    question = state["question"]
    docs = state["documents"]
    
    relevant_docs = []
    need_web_search = False
    
    for doc in docs:
        score = grader_llm.invoke({
            "document": doc.page_content,
            "question": question,
        })
        if score.binary_score == "yes":
            relevant_docs.append(doc)
        else:
            need_web_search = True
    
    return {
        "documents": relevant_docs,
        "web_search_needed": need_web_search,
    }

def web_search(state: CRAGState):
    """Tavily 搜索补充"""
    from langchain_community.tools.tavily_search import TavilySearchResults
    tool = TavilySearchResults(max_results=3)
    results = tool.invoke(state["question"])
    return {"documents": state["documents"] + results}

# 构建 LangGraph 工作流
workflow = StateGraph(CRAGState)
workflow.add_node("retrieve", retrieve)
workflow.add_node("grade_documents", grade_documents)
workflow.add_node("web_search", web_search)
workflow.add_node("generate", generate)

workflow.set_entry_point("retrieve")
workflow.add_edge("retrieve", "grade_documents")
workflow.add_conditional_edges(
    "grade_documents",
    lambda s: "web_search" if s["web_search_needed"] else "generate",
)
workflow.add_edge("web_search", "generate")
workflow.add_edge("generate", END)

app = workflow.compile()
```

---

### 7.4 Adaptive RAG

根据 Query 复杂度**动态选择检索策略**：

```
Simple Query（事实型）  → 直接 LLM 回答（无需检索）
Single-step Query      → 标准 RAG
Multi-step Query（复杂） → Iterative RAG（多轮检索）
```

```python
def route_query(state):
    """Query 分类路由"""
    question = state["question"]
    
    route = router_llm.invoke({
        "question": question,
        "options": ["direct_answer", "single_rag", "iterative_rag"],
    })
    
    return route.datasource

workflow.add_conditional_edges(
    "classify_query",
    route_query,
    {
        "direct_answer": "llm_node",
        "single_rag": "single_retrieve_node",
        "iterative_rag": "iterative_retrieve_node",
    }
)
```

---

### 7.5 Graph RAG

Graph RAG 将文档知识构建为**知识图谱**，支持多跳推理：

```
传统 RAG:   Query → 向量搜索 → 孤立文本片段
Graph RAG:  Query → 图遍历  → 关联实体网络

知识图谱结构：
  (Python) ──[用于]──▶ (机器学习)
      │                     │
  [是]                   [包括]
      │                     │
  (编程语言)          (深度学习)──[框架]──▶ (PyTorch)
```

```python
# 使用 LlamaIndex 的 KnowledgeGraphIndex
from llama_index.core import KnowledgeGraphIndex
from llama_index.core.graph_stores import SimpleGraphStore

graph_store = SimpleGraphStore()
storage_context = StorageContext.from_defaults(graph_store=graph_store)

# 构建知识图谱索引（LLM 自动抽取三元组）
kg_index = KnowledgeGraphIndex.from_documents(
    documents,
    storage_context=storage_context,
    max_triplets_per_chunk=5,        # 每块最多提取 5 个三元组
    include_embeddings=True,         # 同时支持向量搜索
    show_progress=True,
)

# 查询（结合图遍历 + 向量检索）
kg_query_engine = kg_index.as_query_engine(
    include_text=True,
    retriever_mode="hybrid",         # 图 + 向量混合检索
    similarity_top_k=5,
    graph_traversal_depth=2,         # 图遍历深度
    response_mode="tree_summarize",
)

response = kg_query_engine.query("PyTorch 与机器学习的关系？")
```

**Microsoft GraphRAG**（更完整的实现）分为两阶段：

```
离线阶段（Indexing）：
  文档 → 实体抽取 → 关系抽取 → 社区检测（Leiden算法）→ 社区摘要

在线阶段（Querying）：
  Local Search:  从查询实体出发，遍历邻域（适合具体问题）
  Global Search: 遍历社区摘要，Map-Reduce 聚合（适合全局问题）
```

---

## 8. RAGAS 评估框架

### 8.1 四大核心指标

```
┌─────────────────────────────────────────────────────────┐
│                   RAGAS 评估体系                         │
└─────────────────────────────────────────────────────────┘

                    question
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
       context       answer       ground_truth
          │             │             │
          │             ▼             │
          │   ┌─────────────────┐     │
          │   │   Faithfulness   │     │
          │   │ 答案是否由上下文  │     │
          │   │ 支撑（不幻觉）   │     │
          │   └─────────────────┘     │
          │                           │
          ▼                           ▼
┌──────────────────┐       ┌──────────────────────┐
│ Context Precision │       │   Answer Relevancy    │
│ 检索到的上下文中  │       │   答案与问题的相关性   │
│ 有多少是真正有用的│       │  （语义相似度）       │
└──────────────────┘       └──────────────────────┘
          │
          ▼
┌──────────────────┐
│  Context Recall   │
│ 标准答案中的信息  │
│ 有多少被检索到   │
└──────────────────┘
```

| 指标 | 计算方式 | 范围 | 越高越好 |
|------|---------|------|---------|
| Faithfulness | 答案中被上下文支撑的陈述数 / 总陈述数 | [0, 1] | ✅ |
| Answer Relevancy | embed(answer) 与 embed(question) 余弦相似度均值 | [0, 1] | ✅ |
| Context Precision | 相关上下文排名靠前的比例（AP@k） | [0, 1] | ✅ |
| Context Recall | 标准答案中被上下文覆盖的句子比例 | [0, 1] | ✅ |

---

### 8.2 评估代码示例

```python
from ragas import evaluate
from ragas.metrics import (
    faithfulness,
    answer_relevancy,
    context_precision,
    context_recall,
)
from datasets import Dataset

# 准备评估数据集
eval_data = {
    "question": [
        "什么是 HNSW？",
        "RAG 的全称是什么？",
    ],
    "answer": [
        "HNSW 是分层可导航小世界图，一种用于近似最近邻搜索的数据结构。",
        "RAG 全称 Retrieval-Augmented Generation，检索增强生成。",
    ],
    "contexts": [
        ["HNSW（Hierarchical Navigable Small World）是由 Malkov 等人在 2018 年提出的 ANN 索引..."],
        ["RAG（Retrieval-Augmented Generation）由 Facebook AI 在 2020 年提出..."],
    ],
    "ground_truth": [
        "HNSW 是一种分层图结构的近似最近邻搜索算法。",
        "RAG 是检索增强生成的缩写。",
    ],
}

dataset = Dataset.from_dict(eval_data)

# 执行评估（内部并发调用 LLM 判断）
result = evaluate(
    dataset=dataset,
    metrics=[faithfulness, answer_relevancy, context_precision, context_recall],
    llm=ChatOpenAI(model="gpt-4o"),        # 评估用 LLM
    embeddings=OpenAIEmbeddings(),          # 评估用嵌入模型
)

print(result)
# {'faithfulness': 0.92, 'answer_relevancy': 0.88,
#  'context_precision': 0.85, 'context_recall': 0.90}

# 转换为 DataFrame 查看每条样本
df = result.to_pandas()
print(df[["question", "faithfulness", "answer_relevancy"]].to_string())
```

**生产环境评估流水线**

```python
import mlflow

def evaluate_rag_pipeline(query_engine, test_cases: list) -> dict:
    """端到端 RAG 评估 + MLflow 追踪"""
    
    with mlflow.start_run(run_name="rag_evaluation"):
        predictions = []
        for case in test_cases:
            response = query_engine.query(case["question"])
            predictions.append({
                "question": case["question"],
                "answer": str(response),
                "contexts": [n.node.text for n in response.source_nodes],
                "ground_truth": case["ground_truth"],
            })
        
        dataset = Dataset.from_list(predictions)
        scores = evaluate(dataset, metrics=[
            faithfulness, answer_relevancy,
            context_precision, context_recall,
        ])
        
        # 记录到 MLflow
        mlflow.log_metrics({
            "faithfulness": scores["faithfulness"],
            "answer_relevancy": scores["answer_relevancy"],
            "context_precision": scores["context_precision"],
            "context_recall": scores["context_recall"],
        })
        
        return scores
```

---

## 参考实现

| 项目 | 关键模块 | 说明 |
|------|---------|------|
| [LlamaIndex](https://github.com/run-llama/llama_index) | `llama_index/core/indices/vector_store/` | VectorStoreIndex 核心 |
| [Haystack](https://github.com/deepset-ai/haystack) | `haystack/core/pipeline/base.py` | Pipeline 有向图实现 |
| [Chroma](https://github.com/chroma-core/chroma) | `chromadb/segment/impl/vector/` | HNSW 向量段实现 |
| [Milvus](https://github.com/milvus-io/milvus) | `internal/core/src/index/` | 分布式向量索引 |
| [RAGAS](https://github.com/explodinggradients/ragas) | `ragas/metrics/` | RAG 评估指标实现 |
| [hnswlib](https://github.com/nmslib/hnswlib) | `python_bindings/` | HNSW C++ 绑定 |

---

*导航：← [03-工具调用与Function-Calling](./03-工具调用与Function-Calling.md) | [技术资料总目录](../README.md) | ↔ [对应面试题](../../02-面试指南/07-AI-Agent全栈开发面试/04-记忆系统面试题.md)*
