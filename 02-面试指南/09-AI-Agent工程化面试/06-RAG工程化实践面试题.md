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

### Q3: 混合检索优势

纯向量检索的弱点：对精确关键词（产品名、错误码、API 名称）不敏感。向量 Embedding 擅长语义相似性，但 "ERR_CONNECTION_REFUSED" 这类精确匹配靠 BM25 更有效。

混合检索 = α × 向量得分 + (1-α) × BM25 得分：
- α=0.7 适合通用语义查询
- α=0.3 适合含专有名词/错误码的查询
- 比纯向量检索 Recall@10 提升 15-30%

### Q10: RAG 质量诊断

**诊断框架**：
1. **检索质量**：用 RAGAS 的 Context Precision/Recall 评估
2. **分块质量**：抽样检查分块是否截断了关键信息
3. **Embedding 质量**：测试特定查询的检索结果是否相关
4. **生成质量**：用 Faithfulness 评估 LLM 是否忠于上下文
5. **端到端测试**：建立评估集定期回归测试
