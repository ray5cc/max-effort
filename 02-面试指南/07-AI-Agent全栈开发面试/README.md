# 07-AI-Agent 全栈开发面试 — 面试指南

> 覆盖 AI Agent 全链路开发的高频面试题，从 LLM 原理到前端渲染，对应 [01-技术资料/07-AI-Agent全栈开发](../../01-技术资料/07-AI-Agent全栈开发/README.md)。

## 相关链接

- 对应技术资料：[07-AI-Agent全栈开发](../../01-技术资料/07-AI-Agent全栈开发/README.md)

## 面试题目录

| 序号 | 文件名 | 覆盖知识点 | 关联技术资料 |
|------|--------|-----------|-------------|
| 01 | [01-LLM原理面试题.md](./01-LLM原理面试题.md) | Transformer、Self-Attention、预训练、RLHF | [技术资料](../../01-技术资料/07-AI-Agent全栈开发/01-LLM原理.md) |
| 02 | [02-Prompt工程面试题.md](./02-Prompt工程面试题.md) | 提示词设计、CoT、Few-shot、结构化输出 | [技术资料](../../01-技术资料/07-AI-Agent全栈开发/02-Prompt工程.md) |
| 03 | [03-工具调用面试题.md](./03-工具调用面试题.md) | Function Calling、Tool Use、MCP 协议 | [技术资料](../../01-技术资料/07-AI-Agent全栈开发/03-工具调用与Function-Calling.md) |
| 04 | [04-记忆系统面试题.md](./04-记忆系统面试题.md) | RAG、向量检索、持久化记忆、Fine-tuning | [技术资料](../../01-技术资料/07-AI-Agent全栈开发/04-记忆系统与RAG.md) |
| 05 | [05-Agent框架面试题.md](./05-Agent框架面试题.md) | LangChain、LangGraph、AutoGen、多 Agent | [技术资料](../../01-技术资料/07-AI-Agent全栈开发/05-Agent框架与编排.md) |
| 06 | [06-后端服务面试题.md](./06-后端服务面试题.md) | 流式 API、会话管理、编排架构 | [技术资料](../../01-技术资料/07-AI-Agent全栈开发/06-后端服务与API设计.md) |
| 07 | [07-前端渲染面试题.md](./07-前端渲染面试题.md) | SSE、WebSocket、流式 UI、React | [技术资料](../../01-技术资料/07-AI-Agent全栈开发/07-前端渲染与流式UI.md) |
| 08 | [08-LLM微调技术面试题.md](./08-LLM微调技术面试题.md) | LoRA/QLoRA/RLHF/DPO/GRPO/分布式微调 | [技术资料](../../01-技术资料/07-AI-Agent全栈开发/08-LLM微调技术.md) |
| 09 | [09-多Agent系统面试题.md](./09-多Agent系统面试题.md) | AutoGen/GroupChat/Hub-Spoke/P2P/分层架构/任务调度 | [技术资料](../../01-技术资料/07-AI-Agent全栈开发/09-多Agent系统.md) |
| 10 | [10-AI-CLI与代码Agent面试题.md](./10-AI-CLI与代码Agent面试题.md) | CLI Agent 架构/沙箱技术选型/Prompt Injection/代码执行反馈 | [技术资料](../../01-技术资料/07-AI-Agent全栈开发/10-AI-CLI与代码Agent.md) |
| 11 | [11-Transformers与模型架构面试题.md](./11-Transformers与模型架构面试题.md) | RMSNorm/RoPE/GQA/KV Cache/FlashAttention/量化/投机解码 | [技术资料](../../01-技术资料/07-AI-Agent全栈开发/11-Transformers与模型架构.md) |

## 高频考点速查

### LLM 与 Prompt
- Transformer 架构中 Self-Attention 的计算过程
- RLHF 与 SFT 的区别及应用场景
- Chain-of-Thought 与 ReAct 框架的区别

### 工具调用 & 记忆
- Function Calling 与 Tool Use 的实现原理
- RAG 与 Fine-tuning 的选择策略
- 四种记忆类型（上下文内、持久化、外部检索、参数化）的适用场景

### Agent 架构
- 单 Agent vs 多 Agent 系统的设计取舍
- LangGraph 中如何实现有状态的 Agent 工作流
- Context 窗口管理与"上下文腐败（Context Rot）"的避免策略

### 工程化与生产
- Harness Engineering 核心理念
- AI 应用的可观测性指标设计（延迟、准确率、Token 用量）
- 流式输出（SSE/WebSocket）在前后端的实现要点

## 说明

- 面试题按难度分为：⭐ 基础 / ⭐⭐ 进阶 / ⭐⭐⭐ 高阶，标注在各题目文件中
- 每题提供参考答案、关键知识点与延伸阅读链接

## 导航

- ← [面试指南总目录](../README.md)
- ↔ [对应技术资料](../../01-技术资料/07-AI-Agent全栈开发/README.md)
