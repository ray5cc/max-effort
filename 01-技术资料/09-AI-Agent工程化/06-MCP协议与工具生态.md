# MCP 协议与工具生态

> 从 Model Context Protocol 到 A2A 协议，解析 AI Agent 工具调用的标准化协议、生态建设与工程实践

## 相关链接

- 对应面试题：[MCP协议与工具生态面试题](../../02-面试指南/09-AI-Agent工程化面试/06-MCP协议与工具生态面试题.md)

## TL;DR 速览

- **MCP（Model Context Protocol）** 是 Anthropic 开源的 Agent 工具调用标准协议，解决"每个工具都要单独集成"的问题
- MCP 的核心架构：**Client（Agent） ↔ Server（工具提供方）**，通过 JSON-RPC 2.0 通信
- MCP Server 提供三种原语：**Resources（数据）、Tools（操作）、Prompts（模板）**
- **传输层** 支持 stdio（本地）和 HTTP+SSE（远程），2026 年新增 Streamable HTTP
- MCP 已被 Claude Code、Cursor、Windsurf、VS Code Copilot 等主流工具采用
- **A2A（Agent-to-Agent）** 是 Google 提出的 Agent 间通信协议，与 MCP 互补
- 生产环境部署 MCP Server 需要关注：**认证、权限、日志、错误处理**

## 目录

1. [为什么需要工具调用协议？](#_1-为什么需要工具调用协议)
2. [MCP 协议核心架构](#_2-mcp-协议核心架构)
3. [MCP Server 开发实践](#_3-mcp-server-开发实践)
4. [MCP Client 集成](#_4-mcp-client-集成)
5. [MCP 传输层与部署](#_5-mcp-传输层与部署)
6. [A2A 协议与 Agent 互操作](#_6-a2a-协议与-agent-互操作)
7. [工具生态与治理](#_7-工具生态与治理)
8. [常见陷阱与最佳实践](#_8-常见陷阱与最佳实践)
9. [延伸与前沿](#_9-延伸与前沿)

---

## 1. 为什么需要工具调用协议？

### 1.1 N×M 集成问题

在 MCP 出现之前，每个 AI 应用（如 Claude、ChatGPT、Cursor）需要独立对接每个工具（如 GitHub、Jira、数据库）。如果有 N 个应用和 M 个工具，需要 N×M 个集成：

```
没有 MCP（N×M 集成）:
┌────────┐     ┌────────┐
│ Claude  │────→│ GitHub │
│         │────→│ Jira   │
│         │────→│ DB     │
├────────┤     ├────────┤
│ Cursor  │────→│ GitHub │  ← 每个都要重新实现！
│         │────→│ Jira   │
│         │────→│ DB     │
└────────┘     └────────┘

有 MCP（N+M 集成）:
┌────────┐     ┌───────┐     ┌────────┐
│ Claude  │────→│       │────→│ GitHub │
├────────┤     │  MCP  │     ├────────┤
│ Cursor  │────→│ 协议  │────→│ Jira   │
├────────┤     │       │     ├────────┤
│ VS Code │────→│       │────→│ DB     │
└────────┘     └───────┘     └────────┘
```

**类比**：MCP 之于 AI Agent 工具调用，就像 USB 之于外设连接——在 USB 之前，每种外设都需要专用接口（串口、并口、PS/2）；USB 统一了接口标准，任何设备插上就能用。

### 1.2 MCP 的行业采用

截至 2026 年，MCP 已被以下产品采用：
- **Claude Code** / **Claude Desktop**（Anthropic）
- **Cursor** / **Windsurf**（AI IDE）
- **VS Code GitHub Copilot**（Microsoft）
- **Cline** / **Continue**（开源 IDE 插件）
- **OpenAI Agents SDK**（OpenAI 在 2025 年 3 月宣布支持）

---

## 2. MCP 协议核心架构

### 2.1 角色模型

```
┌─────────────────────────────────────────────────────┐
│                      Host                            │
│              (如 Claude Desktop)                      │
│                                                      │
│  ┌─────────────┐   ┌─────────────┐                  │
│  │ MCP Client  │   │ MCP Client  │   ...            │
│  │ (连接 A)     │   │ (连接 B)     │                  │
│  └──────┬──────┘   └──────┬──────┘                  │
│         │                 │                          │
└─────────┼─────────────────┼──────────────────────────┘
          │                 │
    ┌─────▼──────┐   ┌─────▼──────┐
    │ MCP Server │   │ MCP Server │
    │ (GitHub)   │   │ (Database) │
    └────────────┘   └────────────┘
```

- **Host**：运行 AI 应用的环境（如 Claude Desktop、IDE）
- **Client**：Host 内部维护的连接实例，每个 Client 连接一个 Server
- **Server**：工具提供方，暴露 Resources/Tools/Prompts

### 2.2 三大原语

| 原语 | 说明 | 示例 | 控制方 |
|------|------|------|--------|
| **Resources** | 数据/上下文 | 文件内容、数据库记录 | 应用端控制 |
| **Tools** | 可执行操作 | 创建 Issue、执行查询 | 模型端控制（LLM 决定何时调用） |
| **Prompts** | 模板/工作流 | "代码审查模板" | 用户端控制 |

### 2.3 协议消息格式（JSON-RPC 2.0）

```json
// Client → Server: 发现可用工具
{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}

// Server → Client: 返回工具列表
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [{
      "name": "create_issue",
      "description": "Create a new GitHub issue",
      "inputSchema": {
        "type": "object",
        "properties": {
          "title": {"type": "string", "description": "Issue title"},
          "body": {"type": "string", "description": "Issue body"},
          "labels": {"type": "array", "items": {"type": "string"}}
        },
        "required": ["title"]
      }
    }]
  }
}

// Client → Server: 调用工具
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "create_issue",
    "arguments": {
      "title": "Fix login bug",
      "body": "Users cannot login with OAuth",
      "labels": ["bug", "auth"]
    }
  }
}
```

---

## 3. MCP Server 开发实践

### 3.1 Python SDK 实现

```python
from mcp.server import Server
from mcp.types import Tool, TextContent
import mcp.server.stdio

# 创建 Server
server = Server("my-tools")

# 定义工具
@server.list_tools()
async def list_tools():
    return [
        Tool(
            name="query_database",
            description="Execute a read-only SQL query against the database",
            inputSchema={
                "type": "object",
                "properties": {
                    "sql": {
                        "type": "string",
                        "description": "SQL query (SELECT only)"
                    },
                    "database": {
                        "type": "string",
                        "enum": ["users", "orders", "products"]
                    }
                },
                "required": ["sql", "database"]
            }
        ),
        Tool(
            name="search_documents",
            description="Search internal knowledge base",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "top_k": {"type": "integer", "default": 5}
                },
                "required": ["query"]
            }
        )
    ]

# 实现工具执行
@server.call_tool()
async def call_tool(name: str, arguments: dict):
    if name == "query_database":
        sql = arguments["sql"]
        
        # 安全检查：只允许 SELECT
        if not sql.strip().upper().startswith("SELECT"):
            return [TextContent(type="text", text="Error: Only SELECT queries allowed")]
        
        result = await db.execute(sql)
        return [TextContent(type="text", text=format_table(result))]
    
    elif name == "search_documents":
        results = await search_engine.search(
            arguments["query"], 
            top_k=arguments.get("top_k", 5)
        )
        return [TextContent(type="text", text=format_results(results))]

# 启动 stdio 服务
async def main():
    async with mcp.server.stdio.stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
```

### 3.2 TypeScript SDK 实现

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server({
  name: "github-mcp-server",
  version: "1.0.0"
}, {
  capabilities: { tools: {} }
});

// 列出工具
server.setRequestHandler("tools/list", async () => ({
  tools: [{
    name: "search_code",
    description: "Search code in GitHub repositories",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        repo: { type: "string", description: "Repository (owner/name)" }
      },
      required: ["query"]
    }
  }]
}));

// 执行工具
server.setRequestHandler("tools/call", async (request) => {
  const { name, arguments: args } = request.params;
  
  if (name === "search_code") {
    const results = await github.searchCode(args.query, args.repo);
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
    };
  }
  
  throw new Error(`Unknown tool: ${name}`);
});

// 启动
const transport = new StdioServerTransport();
await server.connect(transport);
```

### 3.3 Resources 实现

```python
@server.list_resources()
async def list_resources():
    return [
        Resource(
            uri="db://users/schema",
            name="Users Table Schema",
            description="Schema of the users table",
            mimeType="application/json"
        ),
        Resource(
            uri="file://config/app.yaml",
            name="Application Config",
            mimeType="text/yaml"
        )
    ]

@server.read_resource()
async def read_resource(uri: str):
    if uri == "db://users/schema":
        schema = await db.get_schema("users")
        return schema
    elif uri.startswith("file://"):
        path = uri.replace("file://", "")
        return open(path).read()
```

---

## 4. MCP Client 集成

### 4.1 在 Agent 中集成 MCP Client

```python
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def create_mcp_agent():
    # 连接到 MCP Server
    server_params = StdioServerParameters(
        command="python",
        args=["my_mcp_server.py"]
    )
    
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            
            # 获取可用工具
            tools = await session.list_tools()
            
            # 将 MCP 工具转换为 LLM Function Calling 格式
            llm_tools = [
                {
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.inputSchema
                    }
                }
                for tool in tools.tools
            ]
            
            # Agent 循环
            while True:
                response = await llm.chat(messages, tools=llm_tools)
                
                if response.tool_calls:
                    for tc in response.tool_calls:
                        # 通过 MCP 协议调用工具
                        result = await session.call_tool(
                            tc.function.name,
                            json.loads(tc.function.arguments)
                        )
                        messages.append({
                            "role": "tool",
                            "content": result.content[0].text,
                            "tool_call_id": tc.id
                        })
                else:
                    break
```

### 4.2 Claude Desktop 配置

```json
// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxx"
      }
    },
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "POSTGRES_CONNECTION_STRING": "******localhost:5432/mydb"
      }
    },
    "my-custom-tools": {
      "command": "python",
      "args": ["/path/to/my_mcp_server.py"]
    }
  }
}
```

---

## 5. MCP 传输层与部署

### 5.1 传输方式对比

| 传输方式 | 协议 | 适用场景 | 特点 |
|---------|------|---------|------|
| stdio | 标准输入/输出 | 本地工具 | 简单、安全、进程隔离 |
| HTTP + SSE | HTTP POST + SSE | 远程服务 | 跨网络、需认证 |
| Streamable HTTP | HTTP Streaming | 远程服务（新） | 无状态、更易扩展 |

### 5.2 远程 MCP Server 部署

```python
# 使用 FastAPI 部署 HTTP MCP Server
from mcp.server.fastapi import create_mcp_app

app = create_mcp_app(server)

# 添加认证中间件
@app.middleware("http")
async def auth_middleware(request, call_next):
    token = request.headers.get("Authorization")
    if not verify_token(token):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    return await call_next(request)
```

### 5.3 安全最佳实践

```python
class SecureMCPServer:
    """生产级 MCP Server 安全封装"""
    
    def __init__(self, server: Server):
        self.server = server
        self.rate_limiter = RateLimiter(max_calls=100, period=60)
        self.audit_logger = AuditLogger()
    
    async def call_tool(self, name: str, args: dict, user: User):
        # 1. 速率限制
        if not self.rate_limiter.allow(user.id):
            raise RateLimitExceeded()
        
        # 2. 权限检查
        if not user.has_permission(name):
            raise PermissionDenied(f"User {user.id} cannot access tool {name}")
        
        # 3. 参数校验（防注入）
        sanitized_args = self.sanitize(name, args)
        
        # 4. 执行
        result = await self.server.call_tool(name, sanitized_args)
        
        # 5. 审计日志
        await self.audit_logger.log(user=user, tool=name, args=args, result=result)
        
        return result
```

---

## 6. A2A 协议与 Agent 互操作

### 6.1 A2A 概述

A2A（Agent-to-Agent Protocol）由 Google 在 2025 年 4 月提出，定义了 Agent 之间的发现、通信、协作标准：

```
MCP: Agent ↔ Tool（Agent 调用工具）
A2A: Agent ↔ Agent（Agent 之间协作）

两者互补:
┌──────────┐   A2A    ┌──────────┐
│ Agent A  │ ←──────→ │ Agent B  │
│          │          │          │
│  MCP ↕   │          │  MCP ↕   │
│          │          │          │
│ [Tools]  │          │ [Tools]  │
└──────────┘          └──────────┘
```

### 6.2 Agent Card（Agent 名片）

```json
// /.well-known/agent.json
{
  "name": "CodeReviewAgent",
  "description": "Expert agent for code review and quality analysis",
  "url": "https://code-review-agent.example.com",
  "version": "1.0.0",
  "capabilities": {
    "streaming": true,
    "pushNotifications": false
  },
  "skills": [
    {
      "id": "review_pull_request",
      "name": "Review Pull Request",
      "description": "Analyze code changes and provide review feedback"
    }
  ],
  "authentication": {
    "schemes": ["Bearer"]
  }
}
```

### 6.3 MCP vs A2A 对比

| 维度 | MCP | A2A |
|------|-----|-----|
| 关系 | Agent ↔ Tool | Agent ↔ Agent |
| 复杂度 | 低（工具是被动的） | 高（Agent 有自主性） |
| 状态 | 主要无状态 | 有状态（任务生命周期） |
| 发现 | 配置文件 | Agent Card（/.well-known/） |
| 通信 | JSON-RPC 2.0 | HTTP + JSON |
| 提出方 | Anthropic | Google |

---

## 7. 工具生态与治理

### 7.1 MCP Server 生态

截至 2026 年，常用的 MCP Server：

| 类别 | 工具 | 功能 |
|------|------|------|
| 开发 | GitHub MCP | 代码搜索、Issue/PR 管理 |
| 开发 | Filesystem | 文件读写操作 |
| 数据库 | PostgreSQL MCP | SQL 查询 |
| 搜索 | Brave Search | Web 搜索 |
| 文档 | Google Drive | 文件读取 |
| 通信 | Slack MCP | 消息发送/读取 |
| 监控 | Sentry MCP | 错误追踪 |

### 7.2 工具治理

```python
# 企业内部 MCP Server 注册中心
class MCPRegistry:
    """管理企业内所有 MCP Server 的注册和发现"""
    
    async def register(self, server_config: dict):
        """注册新的 MCP Server"""
        # 验证 Server 元数据
        self.validate_schema(server_config)
        # 安全审查
        await self.security_review(server_config)
        # 注册
        await self.store.save(server_config)
    
    async def discover(self, capabilities: list[str]) -> list[dict]:
        """按能力发现可用 Server"""
        return await self.store.find_by_capabilities(capabilities)
```

---

## 8. 常见陷阱与最佳实践

### ❌ 陷阱 1：工具描述不够清晰

```python
# ❌ 错误：描述模糊，LLM 不知道什么时候该调用
Tool(name="search", description="Search something")

# ✅ 正确：清晰的描述，包含使用场景和参数说明
Tool(
    name="search_code",
    description="Search for code snippets in GitHub repositories. "
                "Use this when the user asks about code, implementation details, "
                "or wants to find specific functions/classes. "
                "Returns matching files with line numbers and code context."
)
```

### ❌ 陷阱 2：不做输入校验

```python
# ❌ 错误：直接执行用户输入的 SQL
@server.call_tool()
async def call_tool(name, args):
    if name == "query":
        return await db.execute(args["sql"])  # SQL 注入风险！

# ✅ 正确：严格校验和限制
@server.call_tool()
async def call_tool(name, args):
    if name == "query":
        sql = args["sql"].strip()
        if not sql.upper().startswith("SELECT"):
            raise ValueError("Only SELECT queries allowed")
        if any(kw in sql.upper() for kw in ["DROP", "DELETE", "INSERT", "UPDATE"]):
            raise ValueError("Mutating operations not allowed")
        return await db.execute(sql, timeout=30)
```

### ❌ 陷阱 3：Tool 返回过多数据

```python
# ❌ 错误：返回整个数据库表
@server.call_tool()
async def call_tool(name, args):
    if name == "get_users":
        return await db.execute("SELECT * FROM users")  # 可能返回百万行！

# ✅ 正确：限制返回数量，提供摘要
@server.call_tool()
async def call_tool(name, args):
    if name == "get_users":
        limit = min(args.get("limit", 10), 100)
        total = await db.execute("SELECT COUNT(*) FROM users")
        rows = await db.execute(f"SELECT * FROM users LIMIT {limit}")
        return f"Showing {limit} of {total} users:\n{format_table(rows)}"
```

### ❌ 陷阱 4：MCP Server 没有错误处理

```python
# ❌ 错误：异常导致 Server 崩溃
@server.call_tool()
async def call_tool(name, args):
    result = external_api.call(args)  # 可能超时或返回错误
    return result

# ✅ 正确：优雅处理所有错误
@server.call_tool()
async def call_tool(name, args):
    try:
        result = await asyncio.wait_for(
            external_api.call(args), 
            timeout=30
        )
        return [TextContent(type="text", text=str(result))]
    except asyncio.TimeoutError:
        return [TextContent(type="text", text="Error: Request timed out after 30s")]
    except Exception as e:
        return [TextContent(type="text", text=f"Error: {type(e).__name__}: {str(e)}")]
```

### ❌ 陷阱 5：不区分 stdio 和远程部署的安全需求

```python
# ❌ 错误：远程 MCP Server 没有认证
# 任何人都可以调用你的工具

# ✅ 正确：远程部署必须加认证
# stdio: 本地进程隔离，相对安全
# HTTP: 必须有认证 + 限流 + 日志
```

---

## 9. 延伸与前沿

### 9.1 MCP 协议演进

- **Elicitation**：MCP Server 可以主动向用户请求额外信息
- **OAuth 2.1 集成**：标准化的远程 Server 认证流程
- **Streamable HTTP**：替代 SSE 的新传输层，更适合无服务器部署
- **工具组合**：多个工具自动编排成工作流

### 9.2 竞争协议

- **OpenAI Function Calling**：事实标准的 LLM 工具调用格式
- **Google A2A**：Agent 间协作协议
- **AG-UI**：Agent-UI 通信协议
- 未来趋势：这些协议可能会互相融合或由一个统一标准取代

### 9.3 企业级 MCP 平台

```
未来的企业 AI 工具平台:
┌─────────────────────────────────────────┐
│          MCP Server 注册中心             │
│   发现 │ 认证 │ 限流 │ 审计 │ 监控     │
├─────────────────────────────────────────┤
│  ┌───────┐ ┌───────┐ ┌───────┐         │
│  │GitHub │ │ DB    │ │ Jira  │  ...    │
│  │Server │ │Server │ │Server │         │
│  └───────┘ └───────┘ └───────┘         │
├─────────────────────────────────────────┤
│          Agent 编排层                    │
│   MCP Client │ A2A Client │ 路由       │
├─────────────────────────────────────────┤
│          AI 应用层                       │
│   Chat │ Agent │ Workflow │ IDE        │
└─────────────────────────────────────────┘
```
