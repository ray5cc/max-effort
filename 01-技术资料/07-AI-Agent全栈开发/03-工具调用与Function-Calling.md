# 03-工具调用与Function-Calling — 技术资料

> 从协议格式到源码内核，系统拆解 OpenAI/Anthropic/Google 三大 Function Calling 协议差异、LangChain Tool 系统继承体系、MCP（Model Context Protocol）传输层设计、LangGraph 工具编排策略，以及 `AgentExecutor` / `create_tool_calling_agent` 的完整执行链路。

## 相关链接

- 对应面试题：[03-工具调用面试题](../../02-面试指南/07-AI-Agent全栈开发面试/03-工具调用面试题.md)

---

## 目录

1. [概述](#1-概述)
   - 1.1 为什么 LLM 需要工具调用
   - 1.2 工具调用的执行模型
2. [Function Calling 协议对比](#2-function-calling-协议对比)
   - 2.1 OpenAI Function Calling 协议
   - 2.2 Anthropic Tool Use 协议
   - 2.3 Google Gemini Function Calling 协议
   - 2.4 三大协议横向对比
3. [LangChain Tool 系统源码分析](#3-langchain-tool-系统源码分析)
   - 3.1 BaseTool 抽象类
   - 3.2 StructuredTool 与 @tool 装饰器
   - 3.3 args_schema 与 Pydantic 集成
   - 3.4 invoke() 调用链路
4. [MCP 协议详解](#4-mcp-协议详解)
   - 4.1 MCP 设计动机与架构
   - 4.2 JSON-RPC 传输层
   - 4.3 工具注册与发现
   - 4.4 资源类型系统
   - 4.5 MCP 与 LangChain 集成
5. [工具编排策略](#5-工具编排策略)
   - 5.1 并行工具调用
   - 5.2 顺序链式调用
   - 5.3 LangGraph 条件路由
6. [AgentExecutor 源码剖析](#6-agentexecutor-源码剖析)
   - 6.1 create_tool_calling_agent() 内部实现
   - 6.2 AgentExecutor 执行循环
   - 6.3 工具选择与结果注入
7. [生产实践](#7-生产实践)
   - 7.1 工具设计最佳实践
   - 7.2 错误处理与重试
   - 7.3 工具调用的可观测性

---

## 1. 概述

### 1.1 为什么 LLM 需要工具调用

纯文本 LLM 存在三类固有缺陷：

```
知识截止（Knowledge Cutoff）
  训练数据有时效性，无法获取实时信息（股价、天气、新闻）

计算不可靠（Unreliable Computation）
  LLM 做精确数学运算容易出错，"幻算"问题在 GPT-4 上仍存在

无副作用能力（No Side Effects）
  无法执行数据库写入、发送邮件、调用外部 API 等操作
```

Function Calling（工具调用）通过让模型输出**结构化的函数调用请求**，由外部系统执行后将结果回传，从根本上解决上述三类问题。

### 1.2 工具调用的执行模型

工具调用的核心是一个**请求-执行-回传**的闭环：

```
┌─────────────────────────────────────────────────────────┐
│                   工具调用完整流程                        │
└─────────────────────────────────────────────────────────┘

用户输入
  │
  ▼
┌──────────┐   携带工具定义   ┌──────────────┐
│  应用层   │──────────────▶│     LLM      │
│          │               │  (GPT-4/     │
│          │◀──────────────│   Claude/    │
└──────────┘  tool_calls   │   Gemini)    │
  │           JSON 列表     └──────────────┘
  │
  │  解析 tool_calls
  ▼
┌──────────────────┐
│   工具调度器      │  ─── 并行 / 顺序执行
│  Tool Dispatcher │
└──────────────────┘
  │
  ├──▶ Tool A (search_web)    ──▶ 返回搜索结果
  ├──▶ Tool B (get_weather)   ──▶ 返回天气数据
  └──▶ Tool C (run_code)      ──▶ 返回执行结果
  │
  │  构造 tool 消息（role=tool）
  ▼
┌──────────┐  包含工具结果的   ┌──────────────┐
│  应用层   │──────────────▶│     LLM      │
│          │   完整对话历史   │  生成最终回复  │
└──────────┘               └──────────────┘
```

**关键设计原则**：LLM 本身不执行工具，它只负责**决策**调用哪个工具、传递什么参数。实际执行由应用层的 Tool Executor 完成。

---

## 2. Function Calling 协议对比

### 2.1 OpenAI Function Calling 协议

OpenAI 在 `gpt-3.5-turbo-0613` 中首次引入 Function Calling，之后在 GPT-4 中演进为 `tools` 参数。

**工具定义格式（请求侧）**：

```json
{
  "model": "gpt-4o",
  "messages": [
    {"role": "user", "content": "北京今天天气怎么样？"}
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "获取指定城市的当前天气信息",
        "parameters": {
          "type": "object",
          "properties": {
            "city": {
              "type": "string",
              "description": "城市名称，如 '北京'、'上海'"
            },
            "unit": {
              "type": "string",
              "enum": ["celsius", "fahrenheit"],
              "description": "温度单位"
            }
          },
          "required": ["city"]
        }
      }
    }
  ],
  "tool_choice": "auto"
}
```

**模型响应格式（有工具调用时）**：

```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": null,
        "tool_calls": [
          {
            "id": "call_abc123",
            "type": "function",
            "function": {
              "name": "get_weather",
              "arguments": "{\"city\": \"北京\", \"unit\": \"celsius\"}"
            }
          }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ]
}
```

**工具结果回传格式**：

```json
{
  "role": "tool",
  "tool_call_id": "call_abc123",
  "content": "{\"temperature\": 22, \"condition\": \"晴\", \"humidity\": 45}"
}
```

**`tool_choice` 控制选项**：

| 值 | 行为 |
|----|------|
| `"auto"` | 模型自主决定是否调用工具（默认） |
| `"none"` | 禁止调用任何工具 |
| `"required"` | 强制调用至少一个工具 |
| `{"type":"function","function":{"name":"xxx"}}` | 强制调用指定工具 |

**并行工具调用**：GPT-4o 支持在单次响应中返回多个 `tool_calls`，`finish_reason` 为 `"tool_calls"`，应用层需并行执行所有调用后统一回传。

### 2.2 Anthropic Tool Use 协议

Anthropic 的 Claude 将工具能力称为 **Tool Use**，协议格式与 OpenAI 有明显差异。

**工具定义格式**：

```json
{
  "model": "claude-opus-4-5",
  "messages": [
    {"role": "user", "content": "北京今天天气怎么样？"}
  ],
  "tools": [
    {
      "name": "get_weather",
      "description": "获取指定城市的当前天气信息",
      "input_schema": {
        "type": "object",
        "properties": {
          "city": {
            "type": "string",
            "description": "城市名称"
          },
          "unit": {
            "type": "string",
            "enum": ["celsius", "fahrenheit"]
          }
        },
        "required": ["city"]
      }
    }
  ]
}
```

**模型响应格式（含工具调用）**：

```json
{
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "我来帮你查询北京的天气。"
    },
    {
      "type": "tool_use",
      "id": "toolu_01A09q90qw90lq917835lq9",
      "name": "get_weather",
      "input": {
        "city": "北京",
        "unit": "celsius"
      }
    }
  ],
  "stop_reason": "tool_use"
}
```

**关键差异**：Anthropic 的 `content` 是**数组类型**，可以同时包含文字和工具调用，而 OpenAI 的 `content` 与 `tool_calls` 是并列字段。

**工具结果回传格式**：

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_01A09q90qw90lq917835lq9",
      "content": "{\"temperature\": 22, \"condition\": \"晴\"}"
    }
  ]
}
```

**另一个关键差异**：Anthropic 将工具结果作为 `user` 角色发送（`tool_result` 类型块），而 OpenAI 使用独立的 `role: "tool"` 消息。

### 2.3 Google Gemini Function Calling 协议

Gemini 的 Function Calling 使用 protobuf-风格的格式定义：

**工具定义格式**：

```json
{
  "tools": [
    {
      "function_declarations": [
        {
          "name": "get_weather",
          "description": "获取指定城市的当前天气信息",
          "parameters": {
            "type": "OBJECT",
            "properties": {
              "city": {
                "type": "STRING",
                "description": "城市名称"
              },
              "unit": {
                "type": "STRING",
                "enum": ["celsius", "fahrenheit"]
              }
            },
            "required": ["city"]
          }
        }
      ]
    }
  ],
  "tool_config": {
    "function_calling_config": {
      "mode": "AUTO"
    }
  }
}
```

**模型响应格式**：

```json
{
  "candidates": [
    {
      "content": {
        "parts": [
          {
            "function_call": {
              "name": "get_weather",
              "args": {
                "city": "北京",
                "unit": "celsius"
              }
            }
          }
        ],
        "role": "model"
      },
      "finish_reason": "STOP"
    }
  ]
}
```

**工具结果回传**：

```json
{
  "parts": [
    {
      "function_response": {
        "name": "get_weather",
        "response": {
          "temperature": 22,
          "condition": "晴"
        }
      }
    }
  ]
}
```

**Gemini 特性**：`args` 字段直接是 JSON 对象（非 JSON 字符串），无需额外 `json.loads()`。

### 2.4 三大协议横向对比

| 维度 | OpenAI | Anthropic | Google Gemini |
|------|--------|-----------|---------------|
| 工具定义外层键 | `tools[].function` | `tools[]`（直接） | `tools[].function_declarations[]` |
| Schema 键名 | `parameters` | `input_schema` | `parameters` |
| 类型大小写 | 小写 (`"string"`) | 小写 (`"string"`) | 大写 (`"STRING"`) |
| 响应中的工具调用位置 | `message.tool_calls[]` | `message.content[]`（混合） | `parts[].function_call` |
| arguments 格式 | JSON 字符串（需解析） | JSON 对象（直接使用） | JSON 对象（直接使用） |
| 工具结果的 role | `"tool"` | `"user"`（含 `tool_result` 块） | `"user"`（含 `function_response` 块） |
| 工具 ID 字段 | `tool_call_id` | `tool_use_id` | 无（按 name 匹配） |
| 强制指定工具 | `tool_choice: {type,function}` | `tool_choice: {type,name}` | `function_calling_config.mode` |
| 并行调用 | ✅ 支持 | ✅ 支持 | ✅ 支持 |
| 流式工具调用 | ✅ | ✅ | ✅ |

---

## 3. LangChain Tool 系统源码分析

### 3.1 BaseTool 抽象类

LangChain 所有工具的根基是 `BaseTool`，位于 `langchain_core/tools/base.py`：

```python
# langchain_core/tools/base.py（简化）
class BaseTool(RunnableSerializable[Union[str, dict, ToolCall], Any]):
    """所有工具的抽象基类"""

    name: str                    # 工具名称，LLM 调用时使用
    description: str             # 工具描述，注入到 system prompt
    args_schema: Optional[Type[BaseModel]] = None  # 参数 Pydantic Schema
    return_direct: bool = False  # 是否跳过 Agent 直接返回给用户
    verbose: bool = False
    callbacks: Callbacks = None
    handle_tool_error: Optional[Union[bool, str, Callable]] = False
    handle_validation_error: Optional[Union[bool, str, Callable]] = False

    @abstractmethod
    def _run(self, *args: Any, **kwargs: Any) -> Any:
        """子类必须实现的同步执行方法"""

    async def _arun(self, *args: Any, **kwargs: Any) -> Any:
        """异步执行方法，默认在线程池中运行 _run"""
        return await asyncio.get_event_loop().run_in_executor(
            None, partial(self._run, *args, **kwargs)
        )

    def invoke(
        self,
        input: Union[str, dict, ToolCall],
        config: Optional[RunnableConfig] = None,
        **kwargs: Any,
    ) -> Any:
        """LCEL 兼容的 invoke 入口"""
        tool_input, kwargs = self._parse_input(input, kwargs)
        return self.run(tool_input, **kwargs)

    def run(
        self,
        tool_input: Union[str, Dict],
        verbose: Optional[bool] = None,
        start_color: Optional[str] = "green",
        color: Optional[str] = "green",
        callbacks: Callbacks = None,
        **kwargs: Any,
    ) -> Any:
        """完整执行路径，含错误处理和回调"""
        parsed_input = self._parse_input(tool_input)
        # 触发 on_tool_start 回调
        run_manager = callback_manager.on_tool_start(...)
        try:
            # 调用 _run，传入解析后的参数
            tool_args, tool_kwargs = self._to_args_and_kwargs(parsed_input)
            observation = self._run(*tool_args, **tool_kwargs)
        except ValidationError as e:
            observation = self._handle_validation_error(e)
        except ToolException as e:
            observation = self._handle_tool_error(e)
        # 触发 on_tool_end 回调
        run_manager.on_tool_end(observation, ...)
        return observation
```

**继承体系**：

```
Runnable (langchain_core/runnables/base.py)
  └── RunnableSerializable
        └── BaseTool
              ├── Tool              # 简单函数包装（单字符串参数）
              ├── StructuredTool    # 多参数结构化工具（主流）
              ├── RetrieverTool     # 向量检索工具
              └── BaseSingleActionAgent（遗留）
```

### 3.2 StructuredTool 与 @tool 装饰器

`StructuredTool` 是最常用的工具类，`@tool` 装饰器是其语法糖：

```python
# langchain_core/tools/structured.py（简化）
class StructuredTool(BaseTool):
    """支持多参数结构化输入的工具"""

    args_schema: Type[BaseModel]  # 非 Optional，必须提供
    func: Optional[Callable[..., Any]] = None      # 同步函数
    coroutine: Optional[Callable[..., Awaitable[Any]]] = None  # 异步函数

    @classmethod
    def from_function(
        cls,
        func: Optional[Callable] = None,
        coroutine: Optional[Callable] = None,
        name: Optional[str] = None,
        description: Optional[str] = None,
        return_direct: bool = False,
        args_schema: Optional[Type[BaseModel]] = None,
        infer_schema: bool = True,
        **kwargs: Any,
    ) -> "StructuredTool":
        name = name or func.__name__
        description = description or func.__doc__ or ""

        # 从函数签名自动推断 Pydantic Schema
        if infer_schema and args_schema is None:
            args_schema = create_schema_from_function(
                f"{name}Schema",
                func,
                filter_args=(),
                parse_docstring=True,
                error_on_invalid_docstring=False,
            )
        return cls(
            name=name,
            func=func,
            coroutine=coroutine,
            args_schema=args_schema,
            description=description,
            return_direct=return_direct,
            **kwargs,
        )

    def _run(self, *args: Any, run_manager=None, **kwargs: Any) -> Any:
        """执行包装的函数"""
        if self.func:
            # 注入 run_manager（如果函数签名支持）
            new_argument_supported = signature(self.func).parameters.get(
                "callbacks"
            )
            if new_argument_supported:
                return self.func(
                    *args, callbacks=run_manager.get_child(), **kwargs
                )
            return self.func(*args, **kwargs)
        raise NotImplementedError("StructuredTool does not support async")
```

**`@tool` 装饰器源码**：

```python
# langchain_core/tools/convert.py（简化）
def tool(
    *args: Union[str, Callable, Runnable],
    return_direct: bool = False,
    args_schema: Optional[Type[BaseModel]] = None,
    infer_schema: bool = True,
    response_format: Literal["content", "content_and_artifact"] = "content",
    parse_docstring: bool = False,
    error_on_invalid_docstring: bool = True,
) -> Callable:
    def decorator(func: Callable) -> StructuredTool:
        return StructuredTool.from_function(
            func=func if not asyncio.iscoroutinefunction(func) else None,
            coroutine=func if asyncio.iscoroutinefunction(func) else None,
            name=tool_name,
            description=description,
            return_direct=return_direct,
            args_schema=args_schema,
            infer_schema=infer_schema,
            response_format=response_format,
        )
    # 处理 @tool 与 @tool() 两种调用形式
    if len(args) == 1 and callable(args[0]):
        return decorator(args[0])
    return decorator
```

**实际使用示例**：

```python
from langchain_core.tools import tool
from pydantic import BaseModel, Field

# 方式一：@tool 装饰器（自动推断 Schema）
@tool
def search_web(query: str, num_results: int = 5) -> str:
    """搜索网页并返回结果摘要。
    
    Args:
        query: 搜索关键词
        num_results: 返回结果数量，默认 5
    """
    # 实际搜索逻辑
    return f"搜索 '{query}' 的结果..."

# 方式二：显式定义 Schema
class WeatherInput(BaseModel):
    city: str = Field(description="城市名称，如 '北京'")
    unit: str = Field(default="celsius", description="温度单位")

@tool(args_schema=WeatherInput)
def get_weather(city: str, unit: str = "celsius") -> str:
    """获取指定城市的实时天气"""
    return f"{city} 当前温度 22{unit}"

# 方式三：StructuredTool.from_function
from langchain_core.tools import StructuredTool

def calculate(expression: str) -> str:
    """计算数学表达式"""
    return str(eval(expression))  # noqa: S307（生产中需沙箱）

calc_tool = StructuredTool.from_function(
    func=calculate,
    name="calculator",
    description="执行数学计算，支持 +,-,*,/,** 运算符",
)

# 查看生成的 JSON Schema（用于发送给 LLM）
print(search_web.args_schema.model_json_schema())
# {
#   "title": "search_webSchema",
#   "type": "object",
#   "properties": {
#     "query": {"title": "Query", "type": "string"},
#     "num_results": {"title": "Num Results", "default": 5, "type": "integer"}
#   },
#   "required": ["query"]
# }
```

### 3.3 args_schema 与 Pydantic 集成

`BaseTool.args` 属性动态生成工具的参数描述字典，是 LangChain 将工具转换为 LLM 可理解格式的关键：

```python
# BaseTool.args 属性（langchain_core/tools/base.py）
@property
def args(self) -> dict:
    """返回工具参数的 JSON Schema dict"""
    if self.args_schema is not None:
        schema = self.args_schema.model_json_schema()
        # 移除 title 字段（LLM 不需要）
        return schema.get("properties", {})
    # 无 Schema 时，从 _run 签名推断
    schema = create_schema_from_function("tool_input", self._run)
    return schema.get("properties", {})

# convert_to_openai_tool() 将 BaseTool 转换为 OpenAI 格式
def convert_to_openai_tool(tool: BaseTool) -> dict:
    """将 LangChain 工具转换为 OpenAI tools[] 格式"""
    return {
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.args_schema.model_json_schema()
            if tool.args_schema
            else {
                "type": "object",
                "properties": tool.args,
            },
        },
    }
```

**Schema 推断机制**：`create_schema_from_function` 使用 `inspect.signature` 解析函数签名，将类型注解映射为 JSON Schema 类型：

```
Python 类型注解  →  JSON Schema 类型
str              →  "string"
int / float      →  "integer" / "number"
bool             →  "boolean"
List[str]        →  {"type": "array", "items": {"type": "string"}}
Optional[str]    →  {"anyOf": [{"type": "string"}, {"type": "null"}]}
Literal["a","b"] →  {"type": "string", "enum": ["a", "b"]}
```

### 3.4 invoke() 调用链路

```
外部调用 tool.invoke({"query": "北京天气"})
  │
  ▼
BaseTool.invoke(input, config)          # LCEL Runnable 接口
  │
  ├── _parse_input(input)               # 解析输入：str/dict/ToolCall
  │     ├── ToolCall → 提取 args dict
  │     ├── dict → 直接使用
  │     └── str → {"input": str}（单参数工具）
  │
  └── self.run(tool_input, callbacks)   # 执行入口
        │
        ├── _to_args_and_kwargs(input)  # 转为 *args/**kwargs
        │
        ├── callback_manager.on_tool_start(...)
        │
        ├── self._run(*args, **kwargs)  # 实际执行（子类实现）
        │     └── StructuredTool._run  → self.func(**kwargs)
        │
        ├── callback_manager.on_tool_end(observation)
        │
        └── return observation          # 字符串结果
```

---

## 4. MCP 协议详解

### 4.1 MCP 设计动机与架构

**Model Context Protocol（MCP）** 是 Anthropic 于 2024 年 11 月发布的开放标准，目标是解决 AI 应用与外部系统集成的"M×N 问题"：

```
没有 MCP 时（M×N 集成）：
  每个 AI 应用 × 每个工具 = 独立集成实现

  App A ──→ Tool 1 (自定义)
  App A ──→ Tool 2 (自定义)
  App B ──→ Tool 1 (重新实现)
  App B ──→ Tool 2 (重新实现)

有 MCP 时（M+N 集成）：
  每个应用只需实现 MCP Client
  每个工具只需实现 MCP Server

  App A ──┐
  App B ──┤ MCP Protocol ├──→ Tool Server 1
  App C ──┘               └──→ Tool Server 2
```

**MCP 整体架构**：

```
┌─────────────────────────────────────────────────────────┐
│                    MCP 架构层次                           │
└─────────────────────────────────────────────────────────┘

┌──────────────────┐     MCP Protocol      ┌─────────────────┐
│   MCP Host       │  ◄──────────────────► │   MCP Server    │
│  (AI 应用)       │                        │  (工具提供方)    │
│                  │                        │                 │
│  - Claude Desktop│  ┌──────────────────┐ │  - 文件系统 API  │
│  - VS Code       │  │  Transport Layer │ │  - 数据库连接    │
│  - LangChain App │  │  (传输层)         │ │  - Web 搜索     │
│                  │  │                  │ │  - GitHub API   │
│  MCP Client      │  │  - stdio         │ │                 │
│  (协议实现)      │  │  - HTTP+SSE      │ │  Resources      │
│                  │  │  - WebSocket     │ │  Tools          │
└──────────────────┘  └──────────────────┘ │  Prompts        │
                                            └─────────────────┘
```

### 4.2 JSON-RPC 传输层

MCP 基于 **JSON-RPC 2.0** 协议，支持三种传输方式：

**stdio 传输（本地进程）**：

```
MCP Host                      MCP Server
  │                               │
  │ 启动子进程（subprocess）       │
  │ stdin/stdout 通信             │
  │                               │
  │──── JSON-RPC Request ────────▶│
  │     {                         │
  │       "jsonrpc": "2.0",       │
  │       "id": 1,                │
  │       "method": "tools/list", │
  │       "params": {}            │
  │     }                         │
  │                               │
  │◀─── JSON-RPC Response ────────│
  │     {                         │
  │       "jsonrpc": "2.0",       │
  │       "id": 1,                │
  │       "result": {             │
  │         "tools": [...]        │
  │       }                       │
  │     }                         │
```

**HTTP+SSE 传输（远程服务）**：

```python
# MCP Server 使用 SSE 推送通知
# GET /sse → Server-Sent Events 流
# POST /message → JSON-RPC 请求

# 初始化握手
→ POST /message
  {"jsonrpc":"2.0","id":0,"method":"initialize","params":{
    "protocolVersion":"2024-11-05",
    "capabilities":{"tools":{},"resources":{}},
    "clientInfo":{"name":"my-app","version":"1.0"}
  }}

← {"jsonrpc":"2.0","id":0,"result":{
    "protocolVersion":"2024-11-05",
    "capabilities":{"tools":{"listChanged":true}},
    "serverInfo":{"name":"filesystem-server","version":"0.1.0"}
  }}

# 初始化完成通知
→ POST /message
  {"jsonrpc":"2.0","method":"notifications/initialized"}
```

### 4.3 工具注册与发现

MCP Server 通过标准接口暴露工具：

```python
# MCP Server 实现示例（Python SDK）
from mcp.server import Server
from mcp.server.models import InitializationOptions
from mcp.types import Tool, TextContent, CallToolResult
import mcp.types as types

app = Server("weather-server")

@app.list_tools()
async def list_tools() -> list[Tool]:
    """注册工具列表（响应 tools/list 请求）"""
    return [
        Tool(
            name="get_weather",
            description="获取指定城市的实时天气信息",
            inputSchema={
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": "城市名称"
                    },
                    "unit": {
                        "type": "string",
                        "enum": ["celsius", "fahrenheit"],
                        "default": "celsius"
                    }
                },
                "required": ["city"]
            }
        ),
        Tool(
            name="search_news",
            description="搜索最新新闻",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "max_results": {"type": "integer", "default": 5}
                },
                "required": ["query"]
            }
        )
    ]

@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[types.ContentBlock]:
    """执行工具调用（响应 tools/call 请求）"""
    if name == "get_weather":
        city = arguments["city"]
        unit = arguments.get("unit", "celsius")
        # 实际 API 调用
        result = await fetch_weather_api(city, unit)
        return [TextContent(type="text", text=str(result))]
    elif name == "search_news":
        # ...
        pass
    else:
        raise ValueError(f"Unknown tool: {name}")
```

**工具调用 JSON-RPC 格式**：

```json
// 请求
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "tools/call",
  "params": {
    "name": "get_weather",
    "arguments": {
      "city": "北京",
      "unit": "celsius"
    }
  }
}

// 响应
{
  "jsonrpc": "2.0",
  "id": 5,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"temperature\": 22, \"condition\": \"晴\", \"humidity\": 45}"
      }
    ],
    "isError": false
  }
}
```

### 4.4 资源类型系统

MCP 定义了三类**原语（Primitives）**，每类对应不同的控制方（由谁决定使用）：

```
┌─────────────┬──────────────────────────────┬────────────────────┐
│   原语类型   │         描述                  │     控制方          │
├─────────────┼──────────────────────────────┼────────────────────┤
│  Resources  │ 文件、数据库记录、API 响应等    │  Host（AI 应用）    │
│             │ 由 LLM 读取的上下文数据         │  决定注入哪些资源   │
├─────────────┼──────────────────────────────┼────────────────────┤
│  Tools      │ 可执行的函数/API               │  Model（LLM）      │
│             │ 由 LLM 决定何时调用             │  自主决策调用       │
├─────────────┼──────────────────────────────┼────────────────────┤
│  Prompts    │ 预定义的提示词模板             │  User（用户）       │
│             │ 由用户选择使用哪个模板           │  明确选择           │
└─────────────┴──────────────────────────────┴────────────────────┘
```

**Resources 示例**：

```python
@app.list_resources()
async def list_resources() -> list[types.Resource]:
    return [
        types.Resource(
            uri="file:///workspace/config.json",
            name="项目配置文件",
            description="当前项目的配置信息",
            mimeType="application/json"
        )
    ]

@app.read_resource()
async def read_resource(uri: str) -> str:
    if uri == "file:///workspace/config.json":
        with open("/workspace/config.json") as f:
            return f.read()
```

### 4.5 MCP 与 LangChain 集成

`langchain-mcp-adapters` 库将 MCP 工具无缝转换为 LangChain 工具：

```python
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from langchain_mcp_adapters.tools import load_mcp_tools
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

# 连接 MCP Server（stdio 模式）
server_params = StdioServerParameters(
    command="python",
    args=["weather_server.py"],
    env={"WEATHER_API_KEY": "xxx"}
)

async def run_agent():
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            # 自动加载 MCP Server 暴露的所有工具
            tools = await load_mcp_tools(session)
            # tools 是 List[BaseTool]，可直接用于 LangChain

            model = ChatOpenAI(model="gpt-4o")
            agent = create_react_agent(model, tools)

            result = await agent.ainvoke({
                "messages": [{"role": "user", "content": "北京今天天气如何？"}]
            })
```

**`load_mcp_tools` 内部实现**：调用 `session.list_tools()` 获取工具列表，然后为每个工具创建一个 `StructuredTool`，其 `_run` 方法实际调用 `session.call_tool(name, args)`。

---

## 5. 工具编排策略

### 5.1 并行工具调用

当多个工具之间没有数据依赖时，应并行执行以降低延迟：

```python
import asyncio
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI

@tool
async def get_weather(city: str) -> str:
    """获取城市天气"""
    await asyncio.sleep(1)  # 模拟 API 延迟
    return f"{city}: 晴，22°C"

@tool
async def get_news(topic: str) -> str:
    """获取新闻"""
    await asyncio.sleep(1)
    return f"{topic} 最新新闻..."

# GPT-4o 在单次响应中返回多个 tool_calls
model = ChatOpenAI(model="gpt-4o").bind_tools([get_weather, get_news])

async def execute_parallel_tools(tool_calls: list) -> list:
    """并行执行所有工具调用"""
    tasks = []
    for tc in tool_calls:
        tool_map = {"get_weather": get_weather, "get_news": get_news}
        tool = tool_map[tc["name"]]
        tasks.append(tool.ainvoke(tc["args"]))

    # asyncio.gather 并行等待所有结果
    results = await asyncio.gather(*tasks)
    return [
        {"tool_call_id": tc["id"], "content": str(r)}
        for tc, r in zip(tool_calls, results)
    ]
```

**延迟对比**：

```
顺序执行（3 个工具，各 1s）：1s + 1s + 1s = 3s
并行执行（3 个工具，各 1s）：max(1s, 1s, 1s) = 1s（提速 3x）
```

### 5.2 顺序链式调用

当工具 B 需要工具 A 的输出时，使用顺序链：

```python
from langchain_core.runnables import RunnableLambda
from langchain_core.messages import HumanMessage, ToolMessage

def sequential_tool_chain():
    """
    工具调用链：搜索 → 提取 → 总结
    Tool A: search_web(query) → URLs
    Tool B: extract_content(url) → 文章内容
    Tool C: summarize(content) → 摘要
    """
    model = ChatOpenAI(model="gpt-4o").bind_tools(
        [search_web, extract_content, summarize_text]
    )

    messages = [HumanMessage("总结今天关于量子计算的最新研究")]

    # ReAct 循环：思考 → 行动 → 观察 → 思考...
    while True:
        response = model.invoke(messages)
        messages.append(response)

        if not response.tool_calls:
            break  # 模型决定停止调用工具，返回最终答案

        # 依次执行（顺序保证数据流）
        for tool_call in response.tool_calls:
            result = execute_tool(tool_call)
            messages.append(ToolMessage(
                content=str(result),
                tool_call_id=tool_call["id"]
            ))

    return messages[-1].content
```

### 5.3 LangGraph 条件路由

LangGraph 通过图结构实现复杂的工具编排逻辑：

```python
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode
from typing import TypedDict, Annotated
from langchain_core.messages import BaseMessage
import operator

class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], operator.add]

# 定义工具节点（自动并行执行所有 tool_calls）
tools = [search_web, get_weather, run_code]
tool_node = ToolNode(tools)

model = ChatOpenAI(model="gpt-4o").bind_tools(tools)

def call_model(state: AgentState) -> AgentState:
    response = model.invoke(state["messages"])
    return {"messages": [response]}

def should_continue(state: AgentState) -> str:
    """条件路由：决定下一步是调用工具还是结束"""
    last_message = state["messages"][-1]

    if last_message.tool_calls:
        # 根据工具类型路由到不同处理节点
        tool_names = [tc["name"] for tc in last_message.tool_calls]
        if any(name == "run_code" for name in tool_names):
            return "sandboxed_tool_node"   # 代码执行走沙箱
        return "tool_node"                 # 普通工具调用
    return END                             # 无工具调用，结束

# 构建图
workflow = StateGraph(AgentState)
workflow.add_node("agent", call_model)
workflow.add_node("tool_node", tool_node)
workflow.add_node("sandboxed_tool_node", sandboxed_tool_node)

workflow.set_entry_point("agent")
workflow.add_conditional_edges(
    "agent",
    should_continue,
    {
        "tool_node": "tool_node",
        "sandboxed_tool_node": "sandboxed_tool_node",
        END: END
    }
)
# 工具执行完毕后回到 agent 节点
workflow.add_edge("tool_node", "agent")
workflow.add_edge("sandboxed_tool_node", "agent")

app = workflow.compile()
```

**LangGraph 工具编排流程图**：

```
                    ┌─────────┐
               ─────│  START  │
               │    └─────────┘
               │         │
               │         ▼
               │    ┌─────────┐
               └────│  agent  │◀──────────────────┐
                    └─────────┘                    │
                         │                         │
              ┌──────────┼──────────┐              │
              │          │          │              │
        tool_calls?  sandboxed?    END             │
              │          │          │              │
              ▼          ▼          ▼              │
        ┌──────────┐ ┌──────────┐  ●              │
        │tool_node │ │sandbox   │                  │
        │(并行执行)│ │tool_node │                  │
        └──────────┘ └──────────┘                  │
              │          │                         │
              └──────────┴─────────────────────────┘
                    工具结果注入 messages
```

---

## 6. AgentExecutor 源码剖析

### 6.1 create_tool_calling_agent() 内部实现

`create_tool_calling_agent` 是 LangChain 创建工具调用 Agent 的标准函数：

```python
# langchain/agents/tool_calling_agent/base.py（简化）
def create_tool_calling_agent(
    llm: BaseLanguageModel,
    tools: Sequence[BaseTool],
    prompt: ChatPromptTemplate,
    message_formatter: Optional[Callable] = None,
) -> Runnable:
    """
    创建工具调用 Agent（LCEL 管道）

    返回的 Runnable 签名：
    Input: {"input": str, "intermediate_steps": list, "chat_history": list}
    Output: Union[AgentAction, AgentFinish]
    """
    # 1. 验证 prompt 包含必要的占位符
    missing_vars = {"agent_scratchpad"}.difference(
        prompt.input_variables + list(prompt.partial_variables)
    )
    if missing_vars:
        raise ValueError(f"Prompt missing variables: {missing_vars}")

    # 2. 将工具绑定到 LLM（注入工具定义到 API 请求）
    llm_with_tools = llm.bind_tools(tools)

    # 3. 构建 LCEL 管道
    agent = (
        RunnablePassthrough.assign(
            # 将 intermediate_steps 格式化为消息历史
            agent_scratchpad=lambda x: format_to_tool_messages(
                x["intermediate_steps"]
            ),
        )
        | prompt                    # 渲染完整 prompt（含工具结果）
        | llm_with_tools            # 调用 LLM（携带工具定义）
        | ToolsAgentOutputParser()  # 解析响应为 AgentAction/AgentFinish
    )
    return agent
```

**`format_to_tool_messages` 的作用**：将 `(AgentAction, observation)` 元组列表转换为 `AIMessage` + `ToolMessage` 消息序列，维护完整的对话上下文。

**`ToolsAgentOutputParser` 解析逻辑**：

```python
class ToolsAgentOutputParser(BaseOutputParser):
    def parse_result(
        self, result: list[Generation], *, partial: bool = False
    ) -> Union[list[AgentAction], AgentFinish]:
        if not isinstance(result[0], ChatGeneration):
            raise ValueError("Expected ChatGeneration")

        message = result[0].message

        # 有 tool_calls → AgentAction（继续执行）
        if message.tool_calls:
            return [
                ToolAgentAction(
                    tool=tool_call["name"],
                    tool_input=tool_call["args"],
                    log=f"Invoking: `{tool_call['name']}`",
                    message_log=[message],
                    tool_call_id=tool_call["id"],
                )
                for tool_call in message.tool_calls
            ]

        # 无 tool_calls → AgentFinish（返回最终答案）
        return AgentFinish(
            return_values={"output": message.content},
            log=str(message.content)
        )
```

### 6.2 AgentExecutor 执行循环

```python
# langchain/agents/agent.py（AgentExecutor._call 简化）
class AgentExecutor(Chain):
    agent: RunnableAgent
    tools: Sequence[BaseTool]
    max_iterations: int = 15
    max_execution_time: Optional[float] = None
    early_stopping_method: str = "force"
    handle_parsing_errors: Union[bool, str, Callable] = False

    def _call(self, inputs: dict) -> dict:
        """同步执行循环"""
        intermediate_steps: list[tuple[AgentAction, str]] = []
        iterations = 0
        time_elapsed = 0.0
        start_time = time.time()

        while self._should_continue(iterations, time_elapsed):
            # 1. 调用 Agent（LLM + 输出解析）
            next_step_output = self._take_next_step(
                name_to_tool_map={t.name: t for t in self.tools},
                color_mapping=...,
                inputs=inputs,
                intermediate_steps=intermediate_steps,
            )

            # 2. AgentFinish → 结束循环
            if isinstance(next_step_output, AgentFinish):
                return self._return(next_step_output, intermediate_steps)

            # 3. AgentAction → 执行工具，收集结果
            for action, observation in next_step_output:
                intermediate_steps.append((action, str(observation)))

                # return_direct=True 的工具直接返回
                tool = name_to_tool_map.get(action.tool)
                if tool and tool.return_direct:
                    return self._return(
                        AgentFinish({"output": observation}, ""),
                        intermediate_steps
                    )

            iterations += 1
            time_elapsed = time.time() - start_time

        # 超出最大迭代次数，强制停止
        return self._return(
            self.agent.return_stopped_response(
                self.early_stopping_method, intermediate_steps, **inputs
            ),
            intermediate_steps,
        )

    def _take_next_step(self, name_to_tool_map, ...) -> ...:
        """单步：调用 LLM，然后执行返回的所有工具"""
        # 调用 agent（LCEL 管道）
        output = self.agent.plan(intermediate_steps, **inputs)

        if isinstance(output, AgentFinish):
            return output

        # 并发执行所有 AgentAction（若有多个 tool_calls）
        with ThreadPoolExecutor() as executor:
            results = list(executor.map(
                lambda action: (action, self._run_tool(action, name_to_tool_map)),
                output if isinstance(output, list) else [output]
            ))
        return results
```

### 6.3 工具选择与结果注入

**工具选择**由 LLM 自主完成——LangChain 仅负责将工具的 JSON Schema 通过 `bind_tools()` 注入到 API 请求，不干预模型决策。

**LLM.bind_tools() 的内部实现**：

```python
# langchain_openai/chat_models/base.py（简化）
class ChatOpenAI(BaseChatOpenAI):
    def bind_tools(
        self,
        tools: Sequence[Union[dict, type, Callable, BaseTool]],
        *,
        tool_choice: Optional[Union[dict, str, Literal["auto","none","required"]]] = None,
        **kwargs,
    ) -> Runnable:
        # 将各种类型统一转换为 OpenAI tools 格式
        formatted_tools = [convert_to_openai_tool(t) for t in tools]
        if tool_choice is not None:
            kwargs["tool_choice"] = tool_choice
        return super().bind(tools=formatted_tools, **kwargs)

# convert_to_openai_tool 支持以下输入类型
# BaseTool → 读取 name/description/args_schema
# dict     → 验证格式后直接使用
# type     → Pydantic 模型作为工具（用于结构化输出）
# Callable → 从函数签名推断（同 @tool 装饰器）
```

**工具结果注入流程**：

```
intermediate_steps = [
    (AgentAction(tool="search_web", tool_input={"query":"北京天气"}),
     "北京当前天气：晴，22°C"),
]
                    │
                    ▼
format_to_tool_messages(intermediate_steps)
                    │
                    ▼
[
  AIMessage(
    content="",
    tool_calls=[{"id":"call_abc","name":"search_web","args":{...}}]
  ),
  ToolMessage(
    content="北京当前天气：晴，22°C",
    tool_call_id="call_abc"
  )
]
                    │
                    ▼
注入到 prompt 的 {agent_scratchpad} 占位符
模型据此继续生成下一步
```

---

## 7. 生产实践

### 7.1 工具设计最佳实践

**描述质量决定召回率**：工具的 `description` 字段直接影响 LLM 是否选择该工具，应遵循以下原则：

```python
# ❌ 描述不足（LLM 难以判断何时使用）
@tool
def query_db(sql: str) -> str:
    """执行 SQL 查询"""
    ...

# ✅ 描述充分（明确触发条件和能力边界）
@tool
def query_db(sql: str) -> str:
    """
    在 PostgreSQL 数据库中执行 SQL SELECT 查询，返回 JSON 格式的结果。
    适用场景：需要查询用户数据、订单记录、产品信息等结构化数据时使用。
    注意：仅支持 SELECT 语句，不支持 INSERT/UPDATE/DELETE。
    返回格式：[{"column": value, ...}, ...] 的 JSON 数组
    """
    ...
```

**单一职责原则**：

```python
# ❌ 功能耦合（LLM 难以精确控制）
@tool
def manage_file(action: str, path: str, content: str = "") -> str:
    """读写删文件"""
    ...

# ✅ 职责分离（每个工具专注一件事）
@tool
def read_file(path: str) -> str:
    """读取文件内容，返回字符串。支持 .txt/.md/.py/.json 格式。"""
    ...

@tool
def write_file(path: str, content: str) -> str:
    """将 content 写入指定文件路径。文件不存在时自动创建。"""
    ...
```

### 7.2 错误处理与重试

```python
from langchain_core.tools import ToolException

class RobustSearchTool(BaseTool):
    name = "search_web"
    description = "搜索网页，失败时自动重试（最多 3 次）"
    handle_tool_error = True  # 启用错误处理（返回错误信息而非抛出异常）

    def _run(self, query: str) -> str:
        import httpx
        from tenacity import retry, stop_after_attempt, wait_exponential

        @retry(
            stop=stop_after_attempt(3),
            wait=wait_exponential(multiplier=1, min=1, max=10)
        )
        def _search():
            response = httpx.get(
                "https://api.search.example.com",
                params={"q": query},
                timeout=10.0
            )
            response.raise_for_status()
            return response.json()["results"]

        try:
            results = _search()
            return "\n".join(r["snippet"] for r in results[:5])
        except httpx.HTTPStatusError as e:
            raise ToolException(f"搜索 API 返回错误：{e.response.status_code}")
        except httpx.TimeoutException:
            raise ToolException("搜索超时，请稍后重试")

# handle_tool_error=True 时，ToolException 不会终止 Agent
# 而是将错误信息作为工具结果返回给 LLM，LLM 可据此调整策略
```

**工具超时控制**：

```python
import signal
from contextlib import contextmanager

@contextmanager
def timeout(seconds: int):
    def handler(signum, frame):
        raise TimeoutError(f"工具执行超时（>{seconds}s）")
    signal.signal(signal.SIGALRM, handler)
    signal.alarm(seconds)
    try:
        yield
    finally:
        signal.alarm(0)

class TimeoutTool(BaseTool):
    name = "slow_api"
    description = "调用可能较慢的外部 API（限制 30s）"

    def _run(self, **kwargs) -> str:
        with timeout(30):
            return call_slow_api(**kwargs)
```

### 7.3 工具调用的可观测性

```python
from langchain_core.callbacks import BaseCallbackHandler
from datetime import datetime

class ToolObservabilityHandler(BaseCallbackHandler):
    """记录工具调用的完整遥测数据"""

    def on_tool_start(
        self, serialized: dict, input_str: str, **kwargs
    ) -> None:
        self.start_time = datetime.now()
        tool_name = serialized.get("name", "unknown")
        # 发送到监控系统（Prometheus/DataDog/Langfuse）
        metrics.increment("tool.invocations", tags=[f"tool:{tool_name}"])

    def on_tool_end(self, output: str, **kwargs) -> None:
        duration = (datetime.now() - self.start_time).total_seconds()
        metrics.histogram("tool.duration_seconds", duration)
        # 记录输出长度（检测工具是否返回过长内容）
        metrics.histogram("tool.output_length", len(output))

    def on_tool_error(
        self, error: BaseException, **kwargs
    ) -> None:
        metrics.increment("tool.errors", tags=[f"error:{type(error).__name__}"])

# 注入 Callback
agent_executor = AgentExecutor(
    agent=agent,
    tools=tools,
    callbacks=[ToolObservabilityHandler()],
    verbose=True,
)
```

**关键监控指标**：

| 指标 | 说明 | 告警阈值 |
|------|------|---------|
| `tool.invocations` | 工具调用总次数（按 tool name 分组） | - |
| `tool.duration_p99` | P99 调用延迟 | > 10s |
| `tool.error_rate` | 工具错误率 | > 5% |
| `agent.iterations` | 单次请求的 Agent 迭代次数 | > 10 次 |
| `tool.output_length` | 工具返回内容长度 | > 4096 tokens |
| `agent.token_cost` | 单次 Agent 调用的 Token 消耗 | 按业务设定 |

---

## 参考资料

- [OpenAI Function Calling 官方文档](https://platform.openai.com/docs/guides/function-calling)
- [Anthropic Tool Use 官方文档](https://docs.anthropic.com/en/docs/build-with-claude/tool-use)
- [MCP 协议规范](https://spec.modelcontextprotocol.io/)
- [LangChain Tools 源码](https://github.com/langchain-ai/langchain/tree/master/libs/core/langchain_core/tools)
- [LangGraph 条件边文档](https://langchain-ai.github.io/langgraph/how-tos/branching/)
