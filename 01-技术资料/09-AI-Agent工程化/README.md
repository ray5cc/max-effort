# 09-AI-Agent 工程化 — 技术资料

> 聚焦 AI Agent 应用的生产级工程实践，覆盖从 LLM 推理部署到端到端项目实战的完整技术链路

## 相关链接

- 对应面试指南：[09-AI-Agent工程化面试](../../02-面试指南/09-AI-Agent工程化面试/)

## 文档列表

| 序号 | 文件名 | 覆盖技术知识点 | 关联面试题 |
|------|--------|---------------|-----------|
| 01 | [LLM推理服务工程](./01-LLM推理服务工程.md) | vLLM / SGLang / TensorRT-LLM / PagedAttention / RadixAttention / Continuous Batching / 量化部署 / K8s | [面试题](../../02-面试指南/09-AI-Agent工程化面试/01-LLM推理服务工程面试题.md) |
| 02 | [AI网关与流量治理](./02-AI网关与流量治理.md) | LiteLLM / 多模型路由 / Virtual Keys / Fallback / Circuit Breaker / 成本管控 / Nginx SSE 代理 | [面试题](../../02-面试指南/09-AI-Agent工程化面试/02-AI网关与流量治理面试题.md) |
| 03 | [Agent架构设计模式](./03-Agent架构设计模式.md) | ReAct / Plan-and-Execute / Harness Engineering / Claude Code / Codex CLI / OpenHands / 多Agent拓扑 | [面试题](../../02-面试指南/09-AI-Agent工程化面试/03-Agent架构设计模式面试题.md) |
| 04 | [对话系统全栈工程](./04-对话系统全栈工程.md) | LobeChat / Open WebUI / 树形对话模型 / Model Runtime 抽象 / 插件系统 / 流式渲染 | [面试题](../../02-面试指南/09-AI-Agent工程化面试/04-对话系统全栈工程面试题.md) |
| 05 | [流式传输与实时通信](./05-流式传输与实时通信.md) | SSE / WebSocket / Fetch Streaming / 背压控制 / Nginx 代理 / AG-UI 协议 | [面试题](../../02-面试指南/09-AI-Agent工程化面试/05-流式传输与实时通信面试题.md) |
| 06 | [RAG工程化实践](./06-RAG工程化实践.md) | 语义分块 / 混合检索 / Re-ranking / RAGAS 评估 / pgvector / Qdrant / 增量索引 | [面试题](../../02-面试指南/09-AI-Agent工程化面试/06-RAG工程化实践面试题.md) |
| 07 | [安全沙箱与权限体系](./07-安全沙箱与权限体系.md) | Docker / gVisor / Firecracker / Prompt Injection / HITL / 审计日志 / OWASP LLM Top 10 | [面试题](../../02-面试指南/09-AI-Agent工程化面试/07-安全沙箱与权限体系面试题.md) |
| 08 | [AI应用可观测性](./08-AI应用可观测性.md) | Prometheus / Grafana / LangFuse / OpenTelemetry / 成本归因 / 告警策略 | [面试题](../../02-面试指南/09-AI-Agent工程化面试/08-AI应用可观测性面试题.md) |
| 09 | [MCP协议与工具生态](./09-MCP协议与工具生态.md) | MCP 协议 / JSON-RPC 2.0 / Resources-Tools-Prompts / A2A 协议 / 工具治理 | [面试题](../../02-面试指南/09-AI-Agent工程化面试/09-MCP协议与工具生态面试题.md) |
| 10 | [端到端项目实战](./10-端到端项目实战.md) | 系统架构设计 / 模型级联 / MCP 集成 / 流式渲染 / 监控告警 / 安全合规 | [面试题](../../02-面试指南/09-AI-Agent工程化面试/10-端到端项目实战面试题.md) |

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
