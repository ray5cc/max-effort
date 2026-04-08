# 09-AI-Agent 工程化 — 技术资料

> 聚焦 AI Agent 应用的生产级工程实践，覆盖从 LLM 推理部署、服务编排、全链路工程设计到端到端项目实战的完整技术链路

## 相关链接

- 对应面试指南：[09-AI-Agent工程化面试](../../02-面试指南/09-AI-Agent工程化面试/)

## 文档列表

| 序号 | 文件名 | 覆盖技术知识点 | 关联面试题 |
|------|--------|---------------|-----------|
| 01 | [LLM推理服务工程](./01-LLM推理服务工程.md) | vLLM / SGLang / TensorRT-LLM / PagedAttention / RadixAttention / Continuous Batching / 量化部署 / K8s | [面试题](../../02-面试指南/09-AI-Agent工程化面试/01-LLM推理服务工程面试题.md) |
| 02 | [AI网关与流量治理](./10-AI网关与流量治理.md) | LiteLLM / 多模型路由 / Virtual Keys / Fallback / Circuit Breaker / 成本管控 / Nginx SSE 代理 | [面试题](../../02-面试指南/09-AI-Agent工程化面试/10-AI网关与流量治理面试题.md) |
| 03 | [Agent架构设计模式](./05-Agent架构设计模式.md) | ReAct / Plan-and-Execute / Harness Engineering / Claude Code / Codex CLI / OpenHands / 多Agent拓扑 | [面试题](../../02-面试指南/09-AI-Agent工程化面试/05-Agent架构设计模式面试题.md) |
| 04 | [对话系统全栈工程](./08-对话系统全栈工程.md) | LobeChat / Open WebUI / 树形对话模型 / Model Runtime 抽象 / 插件系统 / 流式渲染 | [面试题](../../02-面试指南/09-AI-Agent工程化面试/08-对话系统全栈工程面试题.md) |
| 05 | [流式传输与实时通信](./03-流式传输与实时通信.md) | SSE / WebSocket / Fetch Streaming / 背压控制 / Nginx 代理 / AG-UI 协议 | [面试题](../../02-面试指南/09-AI-Agent工程化面试/03-流式传输与实时通信面试题.md) |
| 16 | [SSE分布式推送与数据一致性](./04-SSE分布式推送与数据一致性.md) | 分布式 SSE 推送 / Channel-per-Session / Redis Pub/Sub+Streams / 事件持久化与重放 / 幂等消费 / 背压控制 / 连接注册表 / Failover / 跨区域 Active-Active | [面试题](../../02-面试指南/09-AI-Agent工程化面试/04-SSE分布式推送与数据一致性面试题.md) |
| 06 | [RAG工程化实践](./07-RAG工程化实践.md) | 语义分块 / 混合检索 / Re-ranking / RAGAS 评估 / pgvector / Qdrant / 增量索引 | [面试题](../../02-面试指南/09-AI-Agent工程化面试/07-RAG工程化实践面试题.md) |
| 07 | [安全沙箱与权限体系](./13-安全沙箱与权限体系.md) | Docker / gVisor / Firecracker / Prompt Injection / HITL / 审计日志 / OWASP LLM Top 10 | [面试题](../../02-面试指南/09-AI-Agent工程化面试/13-安全沙箱与权限体系面试题.md) |
| 08 | [AI应用可观测性](./14-AI应用可观测性.md) | Prometheus / Grafana / LangFuse / OpenTelemetry / 成本归因 / 告警策略 | [面试题](../../02-面试指南/09-AI-Agent工程化面试/14-AI应用可观测性面试题.md) |
| 09 | [MCP协议与工具生态](./06-MCP协议与工具生态.md) | MCP 协议 / JSON-RPC 2.0 / Resources-Tools-Prompts / A2A 协议 / 工具治理 | [面试题](../../02-面试指南/09-AI-Agent工程化面试/06-MCP协议与工具生态面试题.md) |
| 10 | [LLM微调工程](./02-LLM微调工程.md) | SFT / RLHF / DPO / LoRA / QLoRA / 数据工程 / 评估体系 / 部署上线 | [面试题](../../02-面试指南/09-AI-Agent工程化面试/02-LLM微调工程面试题.md) |
| 11 | [LLM服务编排与成本治理](./11-LLM服务编排与成本治理.md) | BPE Token计量 / 统一计费引擎 / 语义缓存 / 多模型路由 / 负载均衡 / 多租户预算管控 / Fallback重试 | [面试题](../../02-面试指南/09-AI-Agent工程化面试/11-LLM服务编排与成本治理面试题.md) |
| 12 | [高性能API网关内核设计](./09-高性能API网关内核设计.md) | 请求生命周期 / 插件体系 / 限流算法 / 健康检查 / SSE 流代理 / AI 网关特化 / 控制面数据面分离 | [面试题](../../02-面试指南/09-AI-Agent工程化面试/09-高性能API网关内核设计面试题.md) |
| 13 | [Agent全链路工程设计](./15-Agent全链路工程设计.md) | CLI架构 / Agentic Loop / Tool系统 / API网关 / 推理服务 / 流式响应 / MCP集成 / 10万→1000万DAU | [面试题](../../02-面试指南/09-AI-Agent工程化面试/15-Agent全链路工程设计面试题.md) |
| 14 | [Chatbot全链路工程设计](./16-Chatbot全链路工程设计.md) | Web前端 / SSE传输 / 会话管理 / RAG检索增强 / 推理加速 / 多区域部署 / 10万→1000万DAU | [面试题](../../02-面试指南/09-AI-Agent工程化面试/16-Chatbot全链路工程设计面试题.md) |
| 15 | [端到端项目实战](./17-端到端项目实战.md) | 系统架构设计 / 模型级联 / MCP 集成 / 流式渲染 / 监控告警 / 安全合规 | [面试题](../../02-面试指南/09-AI-Agent工程化面试/17-端到端项目实战面试题.md) |

## 与 07-AI-Agent全栈开发 的关系

| 07-AI-Agent全栈开发 | 09-AI-Agent工程化 |
|---------------------|-------------------|
| 侧重**原理与概念** | 侧重**生产工程实践** |
| LLM 原理、Transformer 架构 | LLM 推理引擎部署与优化 |
| Function Calling 机制 | MCP 协议与工具生态 |
| RAG 原理 | RAG 工程化（分块、评估、运维） |
| Agent 框架概述 | Agent 架构设计模式与实战 |

> 💡 07 是"知其然"，09 是"知其所以然"并能"做出来"。面试中需要两者结合。

## 说明

本分类聚焦 AI Agent 应用的**工程化落地**，所有文档均结合真实开源项目（vLLM、SGLang、LiteLLM、LobeChat、Open WebUI、Claude Code、Codex CLI、OpenHands 等）的架构设计和实践经验。
