# MCP 协议与工具生态面试题

> 覆盖 MCP 协议架构、Server/Client 开发、A2A 协议与工具治理面试题

## 相关链接

- 对应技术资料：[MCP协议与工具生态](../../01-技术资料/09-AI-Agent工程化/09-MCP协议与工具生态.md)

## 题目列表

| 题号 | 题目 | 难度 |
|------|------|------|
| Q1 | 什么是 MCP 协议？它解决了什么问题？ | ⭐ 基础 |
| Q2 | MCP 的三大原语（Resources/Tools/Prompts）分别是什么？ | ⭐ 基础 |
| Q3 | MCP 中 Host、Client、Server 的角色关系是什么？ | ⭐ 基础 |
| Q4 | 比较 MCP 的 stdio 和 HTTP+SSE 两种传输方式 | ⭐⭐ 进阶 |
| Q5 | 如何开发一个 MCP Server？请描述关键步骤 | ⭐⭐ 进阶 |
| Q6 | 如何在 Agent 中集成 MCP Client 调用工具？ | ⭐⭐ 进阶 |
| Q7 | MCP 和 OpenAI Function Calling 有什么区别和联系？ | ⭐⭐ 进阶 |
| Q8 | A2A 协议是什么？它与 MCP 是什么关系？ | ⭐⭐ 进阶 |
| Q9 | 如何保证远程 MCP Server 的安全性？ | ⭐⭐⭐ 高阶 |
| Q10 | 设计一个企业内部的 MCP Server 注册中心和治理平台 | ⭐⭐⭐ 高阶 |
| Q11 | 你的 MCP Tool 返回的数据太大导致超出 LLM 上下文窗口，如何解决？ | 🎯 场景 |

## 🔥 高频考点速记

| # | 考点 | 核心要点 | 出题概率 |
|---|------|---------|---------|
| 1 | MCP 核心价值 | N×M → N+M 集成问题 / 统一工具协议 / USB 类比 | ★★★★★ |
| 2 | 三大原语 | Resources(数据) + Tools(操作) + Prompts(模板) | ★★★★★ |
| 3 | MCP vs Function Calling | MCP=标准化协议(跨应用) vs FC=单次API格式(单应用) | ★★★★☆ |
| 4 | 安全实践 | 认证 + 限流 + 输入校验 + 审计日志 | ★★★★☆ |

## 参考答案

### Q1: MCP 协议

MCP（Model Context Protocol）是 Anthropic 开源的 Agent 工具调用标准协议。核心价值：

**问题**：N 个 AI 应用 × M 个工具 = N×M 个集成点
**解决**：统一协议标准，AI 应用实现 MCP Client，工具实现 MCP Server，只需 N+M 个集成

**类比**：USB 统一了外设接口标准，MCP 统一了 AI 工具接口标准。

### Q7: MCP vs Function Calling

| 维度 | MCP | Function Calling |
|------|-----|-----------------|
| 层级 | 应用间标准协议 | 单次 API 调用格式 |
| 发现 | 动态发现（tools/list） | 静态定义（请求参数） |
| 传输 | stdio / HTTP | HTTP API 请求体 |
| 生态 | 跨应用复用同一 Server | 每个应用独立定义 |
| 关系 | MCP 工具可转换为 FC 格式 | FC 是 MCP 的消费端 |

实际流程：MCP Client 获取工具列表 → 转换为 FC 格式 → LLM 决策 → 通过 MCP 协议执行工具
