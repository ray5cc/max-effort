# 07-AI-Agent 全栈开发 — 技术资料

> 覆盖 AI Agent 全链路开发的系统性技术文档，从 LLM 原理到前端渲染，再到微调部署。

## 相关链接

- 对应面试指南：[07-AI-Agent全栈开发面试](../../02-面试指南/07-AI-Agent全栈开发面试/README.md)

## 文档列表

| 序号 | 文件名 | 覆盖技术知识点 | 关联面试题 |
|------|--------|---------------|-----------|
| 01 | [01-LLM原理.md](./01-LLM原理.md) | Transformer架构/Self-Attention推导/RoPE/ALiBi/BPE/Scaling Laws/解码策略/MoE架构/推理模型/多模态/长上下文 | [面试题](../../02-面试指南/07-AI-Agent全栈开发面试/01-LLM原理面试题.md) |
| 02 | [02-Prompt工程.md](./02-Prompt工程.md) | PromptTemplate/CoT/ReAct/ToT/Self-Consistency/Reflexion/结构化输出/Prompt Injection防御 | [面试题](../../02-面试指南/07-AI-Agent全栈开发面试/02-Prompt工程面试题.md) |
| 03 | [03-工具调用与Function-Calling.md](./03-工具调用与Function-Calling.md) | OpenAI/Anthropic/Google协议对比/LangChain Tool源码/MCP协议/LangGraph工具编排/AgentExecutor源码/Computer Use自主操作/视觉工具集成/Tool RAG/语义缓存/成本感知路由 | [面试题](../../02-面试指南/07-AI-Agent全栈开发面试/03-工具调用面试题.md) |
| 04 | [04-记忆系统与RAG.md](./04-记忆系统与RAG.md) | RAG全链路/向量数据库/HNSW/语义分块/HyDE/Self-RAG/RAGAS评估/Graph RAG/混合搜索与多路召回/知识图谱(Neo4j)/Cross-Encoder重排序/查询优化/Contextual Retrieval | [面试题](../../02-面试指南/07-AI-Agent全栈开发面试/04-记忆系统面试题.md) |
| 05 | [05-Agent框架与编排.md](./05-Agent框架与编排.md) | ReAct/LangGraph StateGraph/AutoGen/Dify工作流/A2A通信协议/Agent评估/可观测性/HITL/可靠性工程 | [面试题](../../02-面试指南/07-AI-Agent全栈开发面试/05-Agent框架面试题.md) |
| 06 | [06-后端服务与API设计.md](./06-后端服务与API设计.md) | SSE流式API/LiteLLM网关/Redis会话管理/Langfuse可观测性/Token计量/Circuit Breaker | [面试题](../../02-面试指南/07-AI-Agent全栈开发面试/06-后端服务面试题.md) |
| 07 | [07-前端渲染与流式UI.md](./07-前端渲染与流式UI.md) | Fetch Streaming/React并发渲染/Vercel AI SDK/rAF批量渲染/Chat状态机/Zustand | [面试题](../../02-面试指南/07-AI-Agent全栈开发面试/07-前端渲染面试题.md) |
| 08 | [08-LLM微调技术.md](./08-LLM微调技术.md) | LoRA/QLoRA/RLHF/DPO/GRPO/分布式微调 | [面试题](../../02-面试指南/07-AI-Agent全栈开发面试/08-LLM微调技术面试题.md) |
| 09 | [09-多Agent系统.md](./09-多Agent系统.md) | AutoGen/GroupChat/Hub-Spoke/P2P/分层架构/任务调度 | [面试题](../../02-面试指南/07-AI-Agent全栈开发面试/09-多Agent系统面试题.md) |
| 10 | [10-AI-CLI与代码Agent.md](./10-AI-CLI与代码Agent.md) | CLI Agent 架构/沙箱技术/Prompt Injection/代码执行反馈 | [面试题](../../02-面试指南/07-AI-Agent全栈开发面试/10-AI-CLI与代码Agent面试题.md) |
| 11 | [11-Transformers与模型架构.md](./11-Transformers与模型架构.md) | RMSNorm/RoPE/GQA/KV Cache/FlashAttention/量化/投机解码 | [面试题](../../02-面试指南/07-AI-Agent全栈开发面试/11-Transformers与模型架构面试题.md) |
| 12 | [12-参数高效微调PEFT.md](./12-参数高效微调PEFT.md) | LoRA 数学原理/QLoRA/Adapter/Prefix Tuning/PEFT 生态 | [面试题](../../02-面试指南/07-AI-Agent全栈开发面试/12-PEFT面试题.md) |
| 13 | [13-对齐训练技术TRL.md](./13-对齐训练技术TRL.md) | RLHF/PPO/DPO/GRPO/SFT/奖励模型/TRL 参考实现 | [面试题](../../02-面试指南/07-AI-Agent全栈开发面试/13-TRL面试题.md) |
| 14 | [14-深度学习框架与计算图.md](./14-深度学习框架与计算图.md) | 计算图/自动微分/Eager vs 图执行/TensorFlow工程实践/PyTorch深度解析(Autograd/torch.compile/DDP/FSDP)/TF vs PyTorch选型 | [面试题](../../02-面试指南/07-AI-Agent全栈开发面试/14-深度学习框架面试题.md) |

## 说明

- 每篇文档聚焦于**通用技术知识点**，而非特定项目介绍
- 文档内含代码示例、ASCII 架构图、类比说明，力求深入浅出
- 如需了解特定开源项目细节，参见文档内的"参考实现"章节

## 导航

- ← [技术资料总目录](../README.md)
- ↔ [对应面试指南](../../02-面试指南/07-AI-Agent全栈开发面试/README.md)
