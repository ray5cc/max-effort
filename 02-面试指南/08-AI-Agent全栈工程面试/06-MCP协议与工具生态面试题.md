# MCP 协议与工具生态面试题

> 覆盖 MCP 协议架构、Server/Client 开发、A2A 协议与工具治理面试题

## 相关链接

- 对应技术资料：[MCP协议与工具生态](../../01-技术资料/08-AI-Agent全栈工程/06-MCP协议与工具生态.md)

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

<details>
<summary>参考答案</summary>

**MCP（Model Context Protocol）是 Anthropic 开源的 Agent 工具调用标准协议。解决 N×M 集成问题，统一为 N+M。**

#### 类比

USB 统一了电脑外设接口——键盘、鼠标、打印机都用同一种接口。MCP 统一了 AI 工具接口——不同的 AI 应用和不同的工具都用同一种协议通信。

#### 核心价值

```
没有 MCP：
  5 个 AI 应用 × 10 个工具 = 50 个集成点

有了 MCP：
  5 个 AI 应用实现 MCP Client + 10 个工具实现 MCP Server = 15 个集成点
```

#### 协议流程

```
Host (如 Claude Desktop)
  └── MCP Client
        ↕ JSON-RPC 2.0
      MCP Server (如 GitHub Server)
        └── 实际工具执行
        
初始化：
  Client → Server: initialize (协议版本、能力协商)
  Server → Client: 返回支持的 capabilities
  
工具发现：
  Client → Server: tools/list
  Server → Client: [{ name, description, inputSchema }]

工具调用：
  Client → Server: tools/call { name: "search", arguments: {...} }
  Server → Client: { content: [{ type: "text", text: "..." }] }
```

</details>

---

### Q2: MCP 三大原语

<details>
<summary>参考答案</summary>

**Resources（数据源）、Tools（可执行操作）、Prompts（提示词模板）是 MCP 的三大核心原语。**

| 原语 | 定义 | 类比 | 示例 |
|------|------|------|------|
| Resources | 只读数据源 | 文件系统中的文件 | 数据库记录、文档、配置 |
| Tools | 可执行的操作 | 可调用的函数 | 搜索、创建文件、发 API |
| Prompts | 可复用的提示词模板 | 函数模板 | "总结这篇文章"、"代码 Review" |

#### Resources

```json
// 获取资源列表
{ "method": "resources/list" }
// 返回
{ "resources": [
    { "uri": "db://users/123", "name": "用户信息", "mimeType": "application/json" }
]}

// 读取资源
{ "method": "resources/read", "params": { "uri": "db://users/123" } }
```

#### Tools

```json
// 获取工具列表
{ "method": "tools/list" }
// 返回
{ "tools": [{
    "name": "search_code",
    "description": "在代码库中搜索",
    "inputSchema": { "type": "object", "properties": { "query": { "type": "string" } } }
}]}
```

#### Prompts

```json
// 获取提示词模板
{ "method": "prompts/list" }
// 返回
{ "prompts": [{
    "name": "code_review",
    "description": "代码审查模板",
    "arguments": [{ "name": "code", "description": "要审查的代码" }]
}]}
```

</details>

---

### Q3: Host、Client、Server 角色关系

<details>
<summary>参考答案</summary>

**Host 是用户界面（如 Claude Desktop），Client 是 MCP 协议客户端（Host 内部），Server 是工具提供方。**

```
┌─────────────────────────────────────────┐
│  Host (如 Claude Desktop / IDE)          │
│                                         │
│  ┌──────────┐  ┌──────────┐             │
│  │ MCP      │  │ MCP      │             │
│  │ Client A │  │ Client B │  ...        │
│  └────┬─────┘  └────┬─────┘             │
│       │              │                  │
└───────│──────────────│──────────────────┘
        │              │
   ┌────┴─────┐   ┌───┴──────┐
   │ MCP      │   │ MCP      │
   │ Server A │   │ Server B │
   │ (GitHub) │   │ (Slack)  │
   └──────────┘   └──────────┘
```

#### 角色职责

| 角色 | 职责 | 示例 |
|------|------|------|
| Host | 用户交互、LLM 调用、安全策略 | Claude Desktop, VS Code, Cursor |
| Client | 管理与 Server 的连接、协议通信 | Host 内部组件（1:1 对应 Server） |
| Server | 暴露工具/资源/提示词 | GitHub Server, Postgres Server |

#### 关键设计

- 一个 Host 可以连接多个 Server（通过多个 Client 实例）
- Server 之间互相不知道对方存在（隔离）
- Host 控制哪些 Server 可以连接（安全策略）

</details>

---

### Q4: stdio vs HTTP+SSE 传输方式

<details>
<summary>参考答案</summary>

**stdio 适合本地进程通信（简单、零配置），HTTP+SSE 适合远程/网络部署（可跨机器、可认证）。**

| 维度 | stdio | HTTP+SSE |
|------|-------|----------|
| 传输方式 | 标准输入/输出 | HTTP 请求 + SSE 推送 |
| 部署场景 | 本地进程 | 远程服务/网络 |
| 配置复杂度 | 零（直接启动进程） | 需要端口、认证 |
| 安全 | 进程隔离 | 需要 TLS + 认证 |
| 调试 | 简单（管道日志） | 需要 HTTP 调试工具 |
| 适用场景 | 桌面应用、IDE 插件 | SaaS、多租户、微服务 |

#### stdio 工作方式

```bash
# Host 启动 Server 进程
$ node my-mcp-server.js

# 通过 stdin/stdout 通信
stdin  → { "jsonrpc": "2.0", "method": "tools/list" }
stdout ← { "jsonrpc": "2.0", "result": { "tools": [...] } }
```

#### HTTP+SSE 工作方式

```
Client → POST /message → Server（请求）
Client ← SSE stream  ← Server（响应流）
```

#### 面试追问

- **Streamable HTTP 是什么**？MCP 最新传输方式，用单一 HTTP endpoint + SSE 替代之前的 HTTP+SSE 双端点方案
- **生产环境用哪种**？内部工具用 stdio（简单），对外服务用 HTTP（安全可控）

</details>

---

### Q5: 开发 MCP Server

<details>
<summary>参考答案</summary>

**四步：初始化 Server → 定义工具 Schema → 实现工具处理逻辑 → 注册传输层。**

#### TypeScript 示例

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// 1. 创建 Server
const server = new McpServer({
  name: "weather-server",
  version: "1.0.0",
});

// 2. 定义工具
server.tool(
  "get_weather",
  "获取指定城市的天气信息",
  { city: z.string().describe("城市名称") },
  async ({ city }) => {
    // 3. 实现逻辑
    const weather = await fetchWeather(city);
    return {
      content: [{
        type: "text",
        text: `${city}：${weather.temp}°C, ${weather.condition}`
      }]
    };
  }
);

// 4. 启动传输层
const transport = new StdioServerTransport();
await server.connect(transport);
```

#### 关键要点

| 要点 | 说明 |
|------|------|
| Schema 定义 | 用 JSON Schema 定义输入参数，越清晰 LLM 调用越准确 |
| 错误处理 | 返回 `isError: true` 让 LLM 知道工具调用失败 |
| 结果格式 | 返回 text/image/resource 等多种内容类型 |
| 幂等性 | 工具应尽量设计为幂等的（重复调用不会出错） |

</details>

---

### Q6: Agent 中集成 MCP Client

<details>
<summary>参考答案</summary>

**核心流程：连接 MCP Server → 获取工具列表 → 转换为 LLM Function Calling 格式 → LLM 决策调用。**

```python
# 1. 连接 MCP Server
client = MCPClient()
await client.connect("stdio", command=["node", "weather-server.js"])

# 2. 获取工具列表
tools = await client.list_tools()
# [{ name: "get_weather", description: "...", inputSchema: {...} }]

# 3. 转换为 OpenAI Function Calling 格式
openai_tools = [
    {
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.inputSchema,
        }
    }
    for tool in tools
]

# 4. LLM 调用（传入工具列表）
response = await openai.chat.completions.create(
    model="gpt-4o",
    messages=messages,
    tools=openai_tools,
)

# 5. 如果 LLM 决定调用工具
if response.tool_calls:
    for call in response.tool_calls:
        result = await client.call_tool(call.function.name, 
                                         json.loads(call.function.arguments))
        # 将结果加入消息历史，继续对话
```

#### 面试追问

- **多个 MCP Server 的工具名冲突怎么办**？Client 可以加 Server 名前缀（如 `github.search_code`）
- **如何管理多个 Server 连接**？Host 维护 Server 连接池，按需启停

</details>

---

### Q7: MCP vs Function Calling

<details>
<summary>参考答案</summary>

**MCP 是跨应用的标准协议，Function Calling 是单次 API 调用的格式。MCP 工具可以转换为 FC 格式使用。**

| 维度 | MCP | Function Calling |
|------|-----|-----------------|
| 层级 | 应用间标准协议 | 单次 API 调用格式 |
| 工具发现 | 动态发现（tools/list） | 静态定义（请求参数） |
| 传输 | stdio / HTTP+SSE | HTTP API 请求体 |
| 生态 | 跨应用复用同一 Server | 每个应用独立定义 |
| 生命周期 | 长连接、有状态 | 无状态、每次请求携带 |
| 提供方 | Anthropic（开放标准） | 各 LLM 提供商各自定义 |

#### 实际调用流程

```
MCP Server 注册工具
     ↓
MCP Client 获取工具列表 (tools/list)
     ↓
转换为 LLM 提供商的 FC 格式 (OpenAI/Anthropic/...)
     ↓
LLM 决策：调用哪个工具
     ↓
通过 MCP 协议执行工具 (tools/call)
     ↓
将结果返回 LLM 继续对话
```

#### 面试追问

- **FC 格式各家都不同？**是的，OpenAI 用 `tools`，Anthropic 用 `tools`（格式略不同），Google 用 `function_declarations`。MCP Client 负责适配

</details>

---

### Q8: A2A 协议与 MCP 的关系

<details>
<summary>参考答案</summary>

**MCP 解决 Agent↔Tool 通信，A2A（Agent-to-Agent）解决 Agent↔Agent 通信。两者互补。**

#### 定位对比

```
MCP：Agent 如何使用工具
  Agent ──MCP──→ Tool (GitHub/Slack/DB)

A2A：Agent 如何与其他 Agent 协作  
  Agent A ──A2A──→ Agent B
  
组合使用：
  Agent A ──A2A──→ Agent B ──MCP──→ Tool
```

#### A2A 协议核心概念

| 概念 | 说明 |
|------|------|
| Agent Card | Agent 的"名片"（能力描述、端点地址） |
| Task | Agent 间的工作单元 |
| Message | Agent 间的通信消息 |
| Artifact | Task 的产出物 |

#### 为什么需要 A2A

```
场景：编码 Agent 需要设计 Agent 的帮助
  编码 Agent: "我需要这个组件的 UI 设计稿"
       ↓ A2A
  设计 Agent: "这是设计稿 [artifact]"
       ↓ A2A
  编码 Agent: 根据设计稿编写代码
       ↓ MCP
  GitHub Tool: 创建 PR
```

#### 面试追问

- **A2A 目前成熟吗**？Google 发起的，还在早期阶段，2026 年逐渐有生态
- **与 MCP 的竞争关系**？互补而非竞争，解决不同层面的问题

</details>

---

### Q9: 远程 MCP Server 安全性

<details>
<summary>参考答案</summary>

**四层防护：认证鉴权 + 传输加密 + 输入校验 + 审计日志。**

#### 安全架构

```
Client → HTTPS (TLS) → OAuth 2.0 认证
                          ↓
                    API Gateway
                    - 速率限制
                    - IP 白名单
                          ↓
                    MCP Server
                    - 输入校验 (JSON Schema)
                    - 权限检查 (RBAC)
                    - 操作审计
                          ↓
                    后端资源 (DB/API)
```

#### 具体措施

| 层面 | 措施 | 说明 |
|------|------|------|
| 认证 | OAuth 2.0 / API Key | 验证调用者身份 |
| 传输 | TLS 1.3 | 防止中间人攻击 |
| 输入校验 | JSON Schema 严格验证 | 防止注入和越权 |
| 权限 | RBAC + 资源级别控制 | 不同用户可用不同工具 |
| 限流 | Token Bucket | 防止滥用和 DDoS |
| 审计 | 每次调用记录日志 | 事后追踪和合规 |

#### 面试追问

- **如何防止 MCP Server 被 Prompt Injection 攻击**？Server 端对输入参数做严格类型校验，不将用户输入直接拼接为 SQL/命令

</details>

---

### Q10: 企业 MCP Server 注册中心

<details>
<summary>参考答案</summary>

**类似微服务的服务注册中心——统一管理企业内所有 MCP Server 的注册、发现、权限和监控。**

#### 架构设计

```
┌──────────────────────────────────────────────┐
│  MCP 注册中心                                  │
│                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ Server   │ │ 权限管理 │ │ 健康检查     │ │
│  │ Registry │ │ (RBAC)   │ │ (心跳/探针)  │ │
│  └──────────┘ └──────────┘ └──────────────┘ │
│                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ 版本管理 │ │ 使用统计 │ │ 文档/沙盒   │ │
│  └──────────┘ └──────────┘ └──────────────┘ │
└──────────────────────────────────────────────┘
     ↑ 注册          ↑ 发现           ↑ 管理
   Server A        Agent/Host       管理员
```

#### 核心功能

| 功能 | 说明 |
|------|------|
| 服务注册 | Server 发布到注册中心（名称、版本、工具列表） |
| 服务发现 | Agent 从注册中心搜索可用 Server |
| 权限管理 | 哪些团队可以使用哪些 Server |
| 版本管理 | 多版本共存、灰度发布、回滚 |
| 健康监控 | 心跳检测、可用性监控、告警 |
| 使用统计 | 调用量、错误率、延迟分布 |

</details>

---

### Q11: MCP Tool 数据过大问题

<details>
<summary>参考答案</summary>

**核心策略：截断 + 摘要 + 分页 + 过滤，确保工具返回数据不超出 LLM 上下文窗口。**

#### 解决方案

```
方案1：Server 端截断
  工具返回前检查数据大小
  超过阈值（如 10K tokens）时自动截断
  附加提示："结果已截断，共 1000 条，显示前 20 条"

方案2：Server 端摘要
  大数据通过 LLM 摘要后返回
  如：数据库查询返回 1000 行 → 摘要为统计信息

方案3：分页接口
  工具支持 page/page_size 参数
  Agent 先获取第一页，需要时再翻页

方案4：Client 端过滤
  Agent 在调用工具时指定 fields（只要需要的字段）
  如：只要 name 和 email，不要完整 profile
```

#### 实现示例

```typescript
server.tool("query_database", "查询数据库",
  { sql: z.string(), max_rows: z.number().default(20) },
  async ({ sql, max_rows }) => {
    const results = await db.query(sql);
    
    if (results.length > max_rows) {
      return {
        content: [{
          type: "text",
          text: `查询返回 ${results.length} 条结果，显示前 ${max_rows} 条：\n` +
                JSON.stringify(results.slice(0, max_rows), null, 2) +
                `\n\n提示：使用 LIMIT 或增加 max_rows 获取更多结果`
        }]
      };
    }
    
    return { content: [{ type: "text", text: JSON.stringify(results) }] };
  }
);
```

</details>
