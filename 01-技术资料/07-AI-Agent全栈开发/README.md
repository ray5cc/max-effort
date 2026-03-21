# 07-AI-Agent 全栈开发 — 技术资料

> 覆盖 AI Agent 全链路开发的系统性技术文档，从 LLM 原理到前端渲染，再到微调部署。

## 相关链接

- 对应面试指南：[07-AI-Agent全栈开发面试](../../02-面试指南/07-AI-Agent全栈开发面试/)

## 文档列表

| 序号 | 文件名 | 覆盖技术知识点 | 关联面试题 |
|------|--------|---------------|-----------|
| 01 | [01-LLM原理.md](./01-LLM原理.md) | Transformer架构/Self-Attention推导/RoPE/ALiBi/BPE/Scaling Laws/解码策略/MoE架构/推理模型/多模态/长上下文 | [面试题](../../02-面试指南/07-AI-Agent全栈开发面试/01-LLM原理面试题.md) |
| 02 | [02-Prompt工程.md](./02-Prompt工程.md) | PromptTemplate/CoT/ReAct/ToT/Self-Consistency/Reflexion/结构化输出/Prompt Injection防御 | [面试题](../../02-面试指南/07-AI-Agent全栈开发面试/02-Prompt工程面试题.md) |
| 03 | [03-工具调用与Function-Calling.md](./03-工具调用与Function-Calling.md) | OpenAI/Anthropic/Google协议对比/LangChain Tool源码/MCP协议/LangGraph工具编排/AgentExecutor源码/Computer Use自主操作/视觉工具集成/Tool RAG/语义缓存/成本感知路由 | [面试题](../../02-面试指南/07-AI-Agent全栈开发面试/03-工具调用面试题.md) |
| 04 | [04-记忆系统与RAG.md](./04-记忆系统与RAG.md) | RAG全链路/向量数据库/HNSW/语义分块/HyDE/Self-RAG/RAGAS评估/Graph RAG/混合搜索与多路召回/知识图谱(Neo4j)/Cross-Encoder重排序/查询优化/Contextual Retrieval | [面试题](../../02-面试指南/07-AI-Agent全栈开发面试/04-记忆系统面试题.md) |
| 05 | [05-Agent框架与编排.md](./05-Agent框架与编排.md) | ReAct/LangGraph StateGraph/AutoGen/Dify工作流/A2A通信协议/Agent评估/可观测性/HITL/可靠性工程 | [面试题](../../02-面试指南/07-AI-Agent全栈开发面试/05-Agent框架面试题.md) |
| 06 | [06-后端服务与API设计.md](./06-后端服务与API设计.md) | SSE流式API/LiteLLM网关/Redis会话管理/Langfuse可观测性/Token计量/Circuit Breaker/FastAPI生态(vLLM/Open WebUI/LiteLLM架构)/流式深度实现(错误处理/背压/WebSocket/AG-UI)/认证授权(Virtual Keys/RBAC/多租户)/七层中间件/数据库设计(树形对话/向量存储)/生产部署进阶(健康检查/优雅关闭/OpenTelemetry/成本看板) | [面试题](../../02-面试指南/07-AI-Agent全栈开发面试/06-后端服务面试题.md) |
| 07 | [07-前端渲染与流式UI.md](./07-前端渲染与流式UI.md) | Fetch Streaming/React并发渲染/Vercel AI SDK/rAF批量渲染/Chat状态机/Zustand/AG-UI协议/Generative UI/CopilotKit/Ant Design X/LobeChat架构/Open WebUI架构 | [面试题](../../02-面试指南/07-AI-Agent全栈开发面试/07-前端渲染面试题.md) |
| 08 | [08-LLM微调技术.md](./08-LLM微调技术.md) | LoRA/QLoRA/RLHF/DPO/GRPO/分布式微调/Unsloth/Axolotl/LLaMA-Factory工具链/数据策展管线(去重/质量过滤/合成数据)/GRPO深度解析/端到端实战(Qwen2.5客服Agent)/评估体系(MMLU/MT-Bench/LLM-as-Judge/A-B测试)/常见陷阱速查表 | [面试题](../../02-面试指南/07-AI-Agent全栈开发面试/08-LLM微调技术面试题.md) |
| 09 | [09-多Agent系统.md](./09-多Agent系统.md) | AutoGen/GroupChat/Hub-Spoke/P2P/分层架构/任务调度 | [面试题](../../02-面试指南/07-AI-Agent全栈开发面试/09-多Agent系统面试题.md) |
| 10 | [10-AI-CLI与代码Agent.md](./10-AI-CLI与代码Agent.md) | CLI Agent 架构/沙箱技术/Prompt Injection/代码执行反馈/Claude Code/OpenHands/通用架构模式/生产级工程挑战/Claude Code 工程最佳实践（CLAUDE.md写作/记忆层级/Skills/Hooks/Subagent/GitHub Actions）/Codex Harness Engineering（AGENTS.md规范/模块化/快照测试/API约定/CI流程）/三大Agent工程范式对比 | [面试题](../../02-面试指南/07-AI-Agent全栈开发面试/10-AI-CLI与代码Agent面试题.md) |
| 11 | [11-Transformers与模型架构.md](./11-Transformers与模型架构.md) | RMSNorm/RoPE/GQA/KV Cache/FlashAttention/量化/投机解码/2026开源模型全景图(DeepSeek-V3 MLA/Qwen2.5/Gemma蒸馏/Phi数据工程/GLM填空架构/InternLM工具调用/Command R+ RAG优化)/代码模型对比(StarCoder2/Codestral)/模型选型指南/评估基准对比/选型常见陷阱 | [面试题](../../02-面试指南/07-AI-Agent全栈开发面试/11-Transformers与模型架构面试题.md) |
| 12 | [12-参数高效微调PEFT.md](./12-参数高效微调PEFT.md) | LoRA 数学原理/QLoRA/Adapter/Prefix Tuning/PEFT 生态 | [面试题](../../02-面试指南/07-AI-Agent全栈开发面试/12-PEFT面试题.md) |
| 13 | [13-对齐训练技术TRL.md](./13-对齐训练技术TRL.md) | RLHF/PPO/DPO/GRPO/SFT/奖励模型/TRL 参考实现 | [面试题](../../02-面试指南/07-AI-Agent全栈开发面试/13-TRL面试题.md) |
| 14 | [14-深度学习框架与计算图.md](./14-深度学习框架与计算图.md) | 计算图/自动微分/Eager vs 图执行/TensorFlow工程实践/PyTorch深度解析(Autograd/torch.compile/DDP/FSDP)/TF vs PyTorch选型 | [面试题](../../02-面试指南/07-AI-Agent全栈开发面试/14-深度学习框架面试题.md) |
| 15 | [15-LLM推理引擎架构.md](./15-LLM推理引擎架构.md) | PagedAttention/RadixAttention/Continuous Batching/Chunked Prefill/量化技术(GPTQ/AWQ/FP8/GGUF)/推测解码(Draft-Verify/Medusa)/分布式推理(TP/PP/DP/EP)/Prefill-Decode分离/结构化输出(FSM/Grammar)/vLLM V1多进程架构/SGLang零开销调度/TensorRT-LLM FP8优化/llama.cpp GGUF混合推理/Ollama模型管理/GB200 NVL72大规模部署 | [面试题](../../02-面试指南/07-AI-Agent全栈开发面试/15-LLM推理引擎面试题.md) |
| 16 | [16-LLM网关与模型管理.md](./16-LLM网关与模型管理.md) | Proxy Gateway架构/统一API适配(100+提供商)/多模型路由(延迟/成本/智能路由)/Fallback与Circuit Breaker/Virtual Keys多租户/Langfuse可观测性/Prompt版本控制与A/B测试/LLM评估体系/MCP与A2A协议/安全合规/成本优化(Prompt Caching/模型级联/Batch API/Semantic Caching)/K8s生产部署 | [面试题](../../02-面试指南/07-AI-Agent全栈开发面试/16-LLM网关与模型管理面试题.md) |

## 说明

- 每篇文档聚焦于**通用技术知识点**，而非特定项目介绍
- 文档内含代码示例、ASCII 架构图、类比说明，力求深入浅出
- 如需了解特定开源项目细节，参见文档内的"参考实现"章节

## 导航

- ← [技术资料总目录](../)
- ↔ [对应面试指南](../../02-面试指南/07-AI-Agent全栈开发面试/)
