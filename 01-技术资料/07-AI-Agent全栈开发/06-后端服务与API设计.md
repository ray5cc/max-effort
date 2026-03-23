# 06-后端服务与API设计 — 技术资料

> 深入 AI 应用后端架构：流式 API 设计、LLM 网关、会话管理、异步任务队列、可观测性与成本控制。

## 相关链接

- 对应面试题：[06-后端服务面试题](../../02-面试指南/07-AI-Agent全栈开发面试/06-后端服务面试题.md)

---

## 目录

1. [流式 API 设计](#1-流式-api-设计)
2. [LLM API 网关 — LiteLLM](#2-llm-api-网关--litellm)
3. [会话管理与上下文窗口策略](#3-会话管理与上下文窗口策略)
4. [可观测性 — Langfuse](#4-可观测性--langfuse)
5. [Token 计量与成本控制](#5-token-计量与成本控制)
6. [生产部署](#6-生产部署)
7. [FastAPI 在 AI 后端的统治地位](#7-fastapi-在-ai-后端的统治地位)
8. [流式响应后端深度实现](#8-流式响应后端深度实现)
9. [AI 应用认证与授权](#9-ai-应用认证与授权)
10. [AI 后端中间件架构](#10-ai-后端中间件架构)
11. [数据库选型与数据模型](#11-数据库选型与数据模型)
12. [生产部署与可观测性（进阶）](#12-生产部署与可观测性进阶)
13. [常见陷阱与最佳实践](#13-常见陷阱与最佳实践)

---

## 1. 流式 API 设计

### 1.1 为什么需要流式响应

LLM 推理天然是逐 Token 生成的过程。若等待完整响应再返回，用户在 GPT-4 生成 500 个 Token 时需要等待约 10 秒才能看到任何内容。流式传输让首字节时间（TTFT, Time To First Token）降至 200~500ms，极大提升感知性能。

### 1.2 SSE 协议规范（text/event-stream）

Server-Sent Events 是 HTTP/1.1 的单向推送协议，格式为纯文本，天然穿透大多数代理与防火墙。

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

data: {"delta": "Hello"}

data: {"delta": " World"}

data: [DONE]

```

关键规则：
- 每个事件以 **一个空行** 结尾（`\n\n`）
- `data:` 字段为主体，多行用多个 `data:` 前缀
- `id:` 字段供客户端断线重连时发送 `Last-Event-ID`
- `retry:` 字段告知客户端重连间隔（毫秒）
- 服务端发送 `data: [DONE]` 约定终止流（OpenAI 风格）

### 1.3 FastAPI StreamingResponse 实现

```python
import asyncio
import json
from typing import AsyncGenerator

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import httpx

app = FastAPI()


class ChatRequest(BaseModel):
    messages: list[dict]
    model: str = "gpt-4o-mini"
    temperature: float = 0.7


async def openai_stream_generator(
    request: ChatRequest,
) -> AsyncGenerator[str, None]:
    """将 OpenAI 流式响应转换为 SSE 格式."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        async with client.stream(
            "POST",
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            json={
                "model": request.model,
                "messages": request.messages,
                "stream": True,
                "temperature": request.temperature,
            },
        ) as response:
            if response.status_code != 200:
                yield f"data: {json.dumps({'error': 'upstream error'})}\n\n"
                return

            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    payload = line[6:]
                    if payload == "[DONE]":
                        yield "data: [DONE]\n\n"
                        return
                    try:
                        chunk = json.loads(payload)
                        delta = chunk["choices"][0]["delta"]
                        if "content" in delta:
                            yield f"data: {json.dumps({'delta': delta['content']})}\n\n"
                    except (json.JSONDecodeError, KeyError):
                        continue


@app.post("/v1/chat/stream")
async def chat_stream(request: ChatRequest):
    return StreamingResponse(
        openai_stream_generator(request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # 关闭 Nginx 缓冲
            "Access-Control-Allow-Origin": "*",
        },
    )
```

> **`X-Accel-Buffering: no`** 是让 Nginx 不缓冲响应的关键头，缺失会导致流被缓存后一次性推送。

### 1.4 WebSocket 全双工场景

| 场景 | 推荐协议 | 原因 |
|------|----------|------|
| 单次问答流式输出 | SSE | 实现简单，HTTP 缓存友好 |
| 多轮对话中断/继续 | WebSocket | 双向通信，支持客户端发送停止信号 |
| Agent 实时工具调用反馈 | WebSocket | 工具执行进度需要服务端主动推送 |
| 语音转文字实时字幕 | WebSocket | 音频分片需要客户端持续发送 |

```python
from fastapi import WebSocket, WebSocketDisconnect

@app.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_json()
            # 支持客户端发送 {"type": "stop"} 中断流
            if data.get("type") == "stop":
                break

            async for token in stream_llm(data["messages"]):
                await websocket.send_json({"type": "token", "data": token})

            await websocket.send_json({"type": "done"})
    except WebSocketDisconnect:
        pass  # 客户端正常断开
```

### 1.5 前端 Fetch Streaming 消费

```typescript
async function* streamChat(messages: Message[]): AsyncGenerator<string> {
  const response = await fetch("/v1/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // 保留未完整行

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") return;
        try {
          const { delta } = JSON.parse(payload);
          if (delta) yield delta;
        } catch {
          // 忽略解析失败的行
        }
      }
    }
  } finally {
    reader.cancel(); // 确保释放锁
  }
}
```

### 1.6 请求链路 ASCII 时序图

```diagram
Client          Nginx            FastAPI          LLM API
  │                │                │                │
  │─── POST ──────▶│                │                │
  │                │─── 反向代理 ──▶│                │
  │                │                │─── stream ────▶│
  │                │                │◀── chunk[0] ───│
  │◀── SSE ────────│◀── yield ──────│                │
  │  data: {...}   │                │◀── chunk[1] ───│
  │◀── SSE ────────│◀── yield ──────│                │
  │                │                │◀── [DONE] ─────│
  │◀── data:[DONE] │◀── return ─────│                │
  │                │                │                │
```

---

## 2. LLM API 网关 — LiteLLM

### 2.1 为什么需要 LLM 网关

直接调用各家 LLM SDK 导致代码强耦合：OpenAI、Anthropic、Google 接口各不相同。LiteLLM 提供统一接口，同时内置：
- **多 Provider 路由**：自动在 OpenAI / Anthropic / Azure / Bedrock 间切换
- **负载均衡**：分散请求，避免单一 Key 限流
- **Fallback 重试**：主模型失败时自动降级
- **成本追踪**：记录每次调用的 Token 用量与费用

### 2.2 基础统一调用

```python
import litellm
from litellm import completion

# 统一接口，无需修改代码即可切换模型
def call_llm(messages: list[dict], model: str = "gpt-4o") -> str:
    response = completion(
        model=model,          # "claude-3-5-sonnet-20241022" / "gemini/gemini-1.5-pro"
        messages=messages,
        temperature=0.7,
        max_tokens=2048,
    )
    return response.choices[0].message.content


# 流式调用
async def stream_llm(messages: list[dict]) -> AsyncGenerator[str, None]:
    response = await litellm.acompletion(
        model="gpt-4o-mini",
        messages=messages,
        stream=True,
    )
    async for chunk in response:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta
```

### 2.3 Router 负载均衡配置

```python
from litellm import Router

router = Router(
    model_list=[
        {
            "model_name": "gpt-4o",           # 路由别名
            "litellm_params": {
                "model": "gpt-4o",
                "api_key": "sk-prod-key-1",
                "rpm": 500,                   # 每分钟请求限制
                "tpm": 100_000,               # 每分钟 Token 限制
            },
            "model_info": {"id": "openai-primary"},
        },
        {
            "model_name": "gpt-4o",
            "litellm_params": {
                "model": "gpt-4o",
                "api_key": "sk-prod-key-2",   # 第二个 API Key
                "rpm": 500,
            },
            "model_info": {"id": "openai-secondary"},
        },
        {
            "model_name": "gpt-4o",
            "litellm_params": {
                "model": "azure/gpt-4o",      # Azure 备用
                "api_key": "azure-key",
                "api_base": "https://myazure.openai.azure.com",
                "api_version": "2024-08-01-preview",
            },
            "model_info": {"id": "azure-fallback"},
        },
    ],
    routing_strategy="least-busy",    # round-robin | least-busy | latency-based-routing
    num_retries=2,
    timeout=30,
    retry_after=5,
)

# 使用路由器发起请求
response = await router.acompletion(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello"}],
)
```

### 2.4 三种路由策略对比

| 策略 | 适用场景 | 优点 | 缺点 |
|------|----------|------|------|
| `round-robin` | 各实例性能相近 | 实现简单，分布均匀 | 不感知实例负载差异 |
| `least-busy` | 实例负载波动大 | 动态平衡，避免热点 | 需维护并发计数状态 |
| `latency-based-routing` | 多地域部署 | 自动选择最快节点 | 需要持续探测延迟 |

### 2.5 两层 Fallback 机制

```python
from litellm import Router

router = Router(
    model_list=[...],
    # 第一层：同名模型内部 fallback（Key 轮换）
    num_retries=2,
    retry_policy={
        "RateLimitError": {"num_retries": 3, "retry_after": 10},
        "Timeout": {"num_retries": 2, "retry_after": 2},
    },
    # 第二层：跨模型 fallback
    fallbacks=[
        {"gpt-4o": ["claude-3-5-sonnet", "gemini/gemini-1.5-pro"]},
    ],
    context_window_fallbacks=[
        # 超出上下文窗口时自动切换到更大窗口的模型
        {"gpt-4o-mini": ["gpt-4o"]},
    ],
)
```

### 2.6 成本追踪与限流

```python
import litellm

# 开启成本追踪回调
litellm.success_callback = ["langfuse"]   # 同步到 Langfuse
litellm.failure_callback = ["langfuse"]

# 设置每用户预算（美元）
from litellm.budget_manager import BudgetManager

budget_manager = BudgetManager(project_name="my-app")

async def chat_with_budget(user_id: str, messages: list[dict]) -> str:
    # 检查预算
    if not budget_manager.is_valid_user(user_id):
        budget_manager.create_budget_for_user(
            user=user_id,
            total_budget=5.0,      # $5 / 用户
            duration="monthly",
        )

    if budget_manager.get_current_cost(user_id) >= budget_manager.get_total_budget(user_id):
        raise HTTPException(status_code=429, detail="Monthly budget exceeded")

    response = await litellm.acompletion(
        model="gpt-4o-mini",
        messages=messages,
        metadata={"user_api_key": user_id},  # 关联用户
    )

    # 更新成本
    budget_manager.update_cost(
        completion_obj=response,
        user=user_id,
    )
    return response.choices[0].message.content
```

---

## 3. 会话管理与上下文窗口策略

### 3.1 会话存储架构

AI 应用的会话需要持久化历史消息，同时兼顾高读写性能：

```diagram
┌──────────┐    ┌───────────────┐    ┌──────────────┐
│  Client  │───▶│  FastAPI App  │───▶│  Redis       │
│          │    │               │    │  (热数据)     │
└──────────┘    │  session_id   │    │  TTL: 24h    │
                │  in Cookie /  │    └──────┬───────┘
                │  Header       │           │ 定期持久化
                └───────────────┘    ┌──────▼───────┐
                                     │  PostgreSQL  │
                                     │  (冷数据)    │
                                     └──────────────┘
```

### 3.2 Redis 会话管理实现

```python
import json
import uuid
from datetime import timedelta
from typing import Optional

import redis.asyncio as aioredis
from pydantic import BaseModel

redis_client = aioredis.from_url("redis://localhost:6379", decode_responses=True)

SESSION_TTL = timedelta(hours=24)
MAX_MESSAGES_IN_REDIS = 50  # Redis 中保留最近 50 条


class Message(BaseModel):
    role: str   # "user" | "assistant" | "system"
    content: str
    timestamp: float


class SessionStore:
    def __init__(self, redis: aioredis.Redis):
        self.redis = redis

    def _key(self, session_id: str) -> str:
        return f"session:{session_id}:messages"

    async def create_session(self) -> str:
        session_id = str(uuid.uuid4())
        # 初始化空会话（用 TTL 标记其存在）
        await self.redis.setex(
            f"session:{session_id}:meta",
            SESSION_TTL,
            json.dumps({"created_at": __import__("time").time()}),
        )
        return session_id

    async def append_message(self, session_id: str, message: Message) -> None:
        key = self._key(session_id)
        pipe = self.redis.pipeline()
        pipe.rpush(key, message.model_dump_json())
        pipe.ltrim(key, -MAX_MESSAGES_IN_REDIS, -1)  # 只保留最近 N 条
        pipe.expire(key, int(SESSION_TTL.total_seconds()))
        await pipe.execute()

    async def get_messages(
        self, session_id: str, limit: int = 20
    ) -> list[Message]:
        key = self._key(session_id)
        raw = await self.redis.lrange(key, -limit, -1)
        return [Message.model_validate_json(r) for r in raw]

    async def clear_session(self, session_id: str) -> None:
        await self.redis.delete(
            self._key(session_id),
            f"session:{session_id}:meta",
        )


# FastAPI 集成
session_store = SessionStore(redis_client)

@app.post("/chat")
async def chat(
    request: ChatRequest,
    session_id: Optional[str] = None,
):
    if not session_id:
        session_id = await session_store.create_session()

    # 追加用户消息
    user_msg = Message(role="user", content=request.message, timestamp=time.time())
    await session_store.append_message(session_id, user_msg)

    # 获取历史上下文
    history = await session_store.get_messages(session_id, limit=20)
    messages = [{"role": m.role, "content": m.content} for m in history]

    # 调用 LLM（此处省略流式逻辑）
    reply = await call_llm(messages)

    # 保存助手回复
    assistant_msg = Message(role="assistant", content=reply, timestamp=time.time())
    await session_store.append_message(session_id, assistant_msg)

    return {"session_id": session_id, "reply": reply}
```

### 3.3 三种上下文窗口策略

| 策略 | 原理 | 优点 | 缺点 | 适用场景 |
|------|------|------|------|----------|
| **滑动窗口** | 只保留最近 N 条消息 | 实现极简，延迟稳定 | 丢失远期上下文 | 日常问答，短对话 |
| **摘要压缩** | 定期将历史摘要为一条 system 消息 | 保留语义，节省 Token | 摘要有信息损失，需额外 LLM 调用 | 长篇文档处理，长对话 |
| **重要性评分** | 对每条消息评分，保留高分消息 | 保留关键信息 | 评分逻辑复杂，计算开销大 | Agent 任务追踪 |

```python
# 策略一：滑动窗口
def sliding_window(messages: list[dict], max_tokens: int = 3000) -> list[dict]:
    """从最新消息向前取，直到接近 Token 上限."""
    window = []
    total = 0
    for msg in reversed(messages):
        tokens = estimate_tokens(msg["content"])
        if total + tokens > max_tokens:
            break
        window.insert(0, msg)
        total += tokens
    return window


# 策略二：摘要压缩
async def summarize_and_compress(
    messages: list[dict],
    keep_recent: int = 10,
) -> list[dict]:
    """将早期历史压缩为摘要，保留最近 N 条完整消息."""
    if len(messages) <= keep_recent:
        return messages

    old_messages = messages[:-keep_recent]
    recent_messages = messages[-keep_recent:]

    summary_prompt = [
        {"role": "system", "content": "请将以下对话历史简洁地总结为一段话："},
        *old_messages,
    ]
    summary = await call_llm(summary_prompt)

    return [
        {"role": "system", "content": f"[对话历史摘要]\n{summary}"},
        *recent_messages,
    ]
```

---

## 4. 可观测性 — Langfuse

### 4.1 为什么 LLM 可观测性与传统不同

传统服务的监控关注 CPU/内存/HTTP 状态码，LLM 应用还需追踪：
- **语义质量**：回复是否符合预期（需人工或自动评估）
- **Token 用量**：直接对应成本，需精确到每次调用
- **提示词版本**：不同 Prompt 对质量的影响
- **多步 Agent 链路**：哪一步出现幻觉或工具调用失败

### 4.2 Trace / Span / Generation 层级

```diagram
Trace（一次用户请求的完整链路）
│
├── Span: "retrieval"（RAG 检索）
│   ├── input: user query
│   └── output: top-k chunks
│
├── Span: "context-build"（上下文构建）
│   └── metadata: token_count=1200
│
└── Generation: "llm-call"（LLM 推理）
    ├── model: "gpt-4o-mini"
    ├── input: messages[]
    ├── output: assistant reply
    ├── usage: {prompt_tokens: 1200, completion_tokens: 350}
    └── latency: 2340ms
```

### 4.3 Python SDK 集成

```python
from langfuse import Langfuse
from langfuse.decorators import langfuse_context, observe
import time

langfuse = Langfuse(
    public_key="pk-lf-...",
    secret_key="sk-lf-...",
    host="https://cloud.langfuse.com",
)


# 方式一：装饰器（推荐，自动追踪）
@observe(name="rag-chat")
async def rag_chat(user_id: str, query: str) -> str:
    langfuse_context.update_current_trace(
        user_id=user_id,
        tags=["production", "v2"],
        metadata={"query_length": len(query)},
    )

    # 自动记录为子 Span
    @observe(name="retrieval")
    async def retrieve(q: str) -> list[str]:
        chunks = await vector_search(q)
        langfuse_context.update_current_observation(
            output=chunks[:2],  # 记录前两条结果
            metadata={"chunk_count": len(chunks)},
        )
        return chunks

    chunks = await retrieve(query)
    context = "\n".join(chunks[:5])

    # Generation 会被自动记录
    response = await litellm.acompletion(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": f"Context:\n{context}"},
            {"role": "user", "content": query},
        ],
    )
    return response.choices[0].message.content


# 方式二：手动 SDK（更细粒度控制）
async def manual_trace_example(query: str) -> str:
    trace = langfuse.trace(
        name="manual-chat",
        input={"query": query},
        metadata={"env": "production"},
    )

    retrieval_span = trace.span(
        name="retrieval",
        start_time=datetime.utcnow(),
    )
    chunks = await vector_search(query)
    retrieval_span.end(
        output={"chunk_count": len(chunks)},
        level="DEFAULT",
    )

    generation = trace.generation(
        name="llm-completion",
        model="gpt-4o-mini",
        input=[{"role": "user", "content": query}],
        model_parameters={"temperature": 0.7},
    )

    start = time.time()
    response = await litellm.acompletion(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": query}],
    )
    elapsed = time.time() - start

    generation.end(
        output=response.choices[0].message.content,
        usage={
            "input": response.usage.prompt_tokens,
            "output": response.usage.completion_tokens,
        },
        end_time=datetime.utcnow(),
    )

    trace.update(output={"reply": response.choices[0].message.content})
    langfuse.flush()  # 确保数据上传（生产环境用 background task）
    return response.choices[0].message.content
```

### 4.4 关键监控指标

| 指标 | 采集方式 | 告警阈值示例 |
|------|----------|--------------|
| TTFT（首 Token 延迟） | Generation latency | P95 > 3s 告警 |
| Total latency | Trace duration | P95 > 15s 告警 |
| Prompt Token 用量 | Generation usage.input | 单次 > 8000 记录 |
| Completion Token 用量 | Generation usage.output | 单次 > 2000 记录 |
| 每日成本 | LiteLLM cost tracking | 超 $50/天 告警 |
| 错误率 | Trace level=ERROR | > 1% 告警 |
| 用户满意度 | Langfuse scores API | 平均分 < 3/5 告警 |

```python
# 记录用户反馈评分
langfuse.score(
    trace_id=trace.id,
    name="user-feedback",
    value=4.5,        # 1-5 分
    comment="回答准确，但略冗长",
    data_type="NUMERIC",
)

# 记录自动评估（如 LLM-as-judge）
langfuse.score(
    trace_id=trace.id,
    name="faithfulness",
    value=0.92,       # 0-1
    data_type="NUMERIC",
    source="eval-pipeline",
)
```

---

## 5. Token 计量与成本控制

### 5.1 精确 Token 计数（tiktoken）

OpenAI 的 Token 计数不等于字符数，必须用官方分词器精确计算：

```python
import tiktoken
from functools import lru_cache


@lru_cache(maxsize=8)
def get_encoding(model: str) -> tiktoken.Encoding:
    """缓存编码器，避免重复初始化（约 1MB 模型文件）."""
    try:
        return tiktoken.encoding_for_model(model)
    except KeyError:
        # 未知模型降级到 cl100k_base（GPT-4 系列编码）
        return tiktoken.get_encoding("cl100k_base")


def count_tokens(messages: list[dict], model: str = "gpt-4o") -> int:
    """
    精确计算 messages 列表的 Token 数。
    参考 OpenAI 官方计算逻辑（每条消息有 4 个额外 Token 的固定开销）。
    """
    encoding = get_encoding(model)
    tokens_per_message = 3   # <|start|>{role}\n{content}<|end|>
    tokens_per_name = 1      # 若有 name 字段额外加 1
    num_tokens = 3           # 每个回复以 <|start|>assistant<|message|> 开头

    for message in messages:
        num_tokens += tokens_per_message
        for key, value in message.items():
            num_tokens += len(encoding.encode(str(value)))
            if key == "name":
                num_tokens += tokens_per_name

    return num_tokens


def estimate_cost(
    prompt_tokens: int,
    completion_tokens: int,
    model: str = "gpt-4o-mini",
) -> float:
    """根据模型价格估算成本（美元）."""
    PRICING = {
        "gpt-4o": {"input": 2.50, "output": 10.00},         # per 1M tokens
        "gpt-4o-mini": {"input": 0.15, "output": 0.60},
        "claude-3-5-sonnet-20241022": {"input": 3.00, "output": 15.00},
        "gemini-1.5-flash": {"input": 0.075, "output": 0.30},
    }
    price = PRICING.get(model, {"input": 1.0, "output": 3.0})
    return (
        prompt_tokens * price["input"] / 1_000_000
        + completion_tokens * price["output"] / 1_000_000
    )
```

### 5.2 语义缓存

对语义相近的问题直接返回缓存结果，降低 LLM 调用次数：

```python
import hashlib
import numpy as np
from typing import Optional

import redis.asyncio as aioredis
from openai import AsyncOpenAI

openai_client = AsyncOpenAI()
redis = aioredis.from_url("redis://localhost:6379")

SIMILARITY_THRESHOLD = 0.95   # 余弦相似度阈值
CACHE_TTL = 3600              # 1 小时


async def get_embedding(text: str) -> list[float]:
    """获取文本的嵌入向量."""
    resp = await openai_client.embeddings.create(
        model="text-embedding-3-small",
        input=text,
    )
    return resp.data[0].embedding


def cosine_similarity(a: list[float], b: list[float]) -> float:
    va, vb = np.array(a), np.array(b)
    return float(np.dot(va, vb) / (np.linalg.norm(va) * np.linalg.norm(vb)))


async def semantic_cache_get(query: str) -> Optional[str]:
    """查询语义缓存，返回命中的缓存结果或 None."""
    query_vec = await get_embedding(query)

    # 遍历缓存键（生产环境应用向量数据库如 Redis Stack / Qdrant）
    keys = await redis.keys("sem_cache:*")
    for key in keys:
        cached = await redis.hgetall(key)
        if not cached:
            continue
        cached_vec = json.loads(cached["embedding"])
        score = cosine_similarity(query_vec, cached_vec)
        if score >= SIMILARITY_THRESHOLD:
            await redis.expire(key, CACHE_TTL)  # 命中则刷新 TTL
            return cached["response"]
    return None


async def semantic_cache_set(query: str, response: str) -> None:
    """将查询结果存入语义缓存."""
    embedding = await get_embedding(query)
    key = f"sem_cache:{hashlib.md5(query.encode()).hexdigest()}"
    await redis.hset(key, mapping={
        "query": query,
        "response": response,
        "embedding": json.dumps(embedding),
    })
    await redis.expire(key, CACHE_TTL)


async def cached_llm_call(query: str) -> str:
    # 1. 查缓存
    cached = await semantic_cache_get(query)
    if cached:
        return cached   # 节省约 100% 的 Token 成本

    # 2. 未命中则调用 LLM
    response = await call_llm([{"role": "user", "content": query}])

    # 3. 存入缓存
    await semantic_cache_set(query, response)
    return response
```

### 5.3 多层预算管理

```python
from enum import Enum
from dataclasses import dataclass, field
from datetime import date


class BudgetPeriod(str, Enum):
    DAILY = "daily"
    MONTHLY = "monthly"


@dataclass
class BudgetConfig:
    user_daily_limit: float = 0.50      # $0.50 / 用户 / 天
    user_monthly_limit: float = 5.00    # $5.00 / 用户 / 月
    org_daily_limit: float = 100.0      # $100 / 组织 / 天
    alert_threshold: float = 0.80       # 80% 时发送告警


async def check_and_deduct_budget(
    user_id: str,
    org_id: str,
    estimated_cost: float,
) -> None:
    """检查多层预算，超出则抛出异常."""
    today = date.today().isoformat()
    month = today[:7]

    pipe = redis.pipeline()
    pipe.incrbyfloat(f"budget:user:{user_id}:daily:{today}", estimated_cost)
    pipe.incrbyfloat(f"budget:user:{user_id}:monthly:{month}", estimated_cost)
    pipe.incrbyfloat(f"budget:org:{org_id}:daily:{today}", estimated_cost)
    results = await pipe.execute()

    user_daily, user_monthly, org_daily = results

    config = BudgetConfig()
    if user_daily > config.user_daily_limit:
        raise HTTPException(429, "Daily user budget exceeded")
    if user_monthly > config.user_monthly_limit:
        raise HTTPException(429, "Monthly user budget exceeded")
    if org_daily > config.org_daily_limit:
        raise HTTPException(429, "Organization daily budget exceeded")
```

---

## 6. 生产部署

### 6.1 FastAPI Lifespan 与优雅启停

```python
from contextlib import asynccontextmanager
import asyncio
import signal

from fastapi import FastAPI
import redis.asyncio as aioredis


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动阶段：初始化连接池
    app.state.redis = aioredis.from_url(
        "redis://localhost:6379",
        max_connections=20,
        decode_responses=True,
    )
    app.state.http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(connect=5.0, read=60.0, write=10.0, pool=5.0),
        limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
    )
    print("✅ Startup complete")
    yield
    # 关闭阶段：等待进行中请求完成，清理资源
    await app.state.redis.aclose()
    await app.state.http_client.aclose()
    print("✅ Shutdown complete")


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health_check():
    """K8s readiness/liveness probe 端点."""
    checks = {}
    try:
        await app.state.redis.ping()
        checks["redis"] = "ok"
    except Exception as e:
        checks["redis"] = f"error: {e}"

    status = "healthy" if all(v == "ok" for v in checks.values()) else "degraded"
    code = 200 if status == "healthy" else 503
    return JSONResponse({"status": status, "checks": checks}, status_code=code)
```

### 6.2 Circuit Breaker 状态机

断路器防止在上游故障时持续发送注定失败的请求：

```diagram
         failure_threshold 次失败
CLOSED ──────────────────────────▶ OPEN
  ▲                                  │
  │ 成功                             │ reset_timeout 后
  │                                  ▼
  └─────────── 成功 ──────────── HALF_OPEN
```

```python
import asyncio
import time
from enum import Enum
from typing import Callable, TypeVar

T = TypeVar("T")


class CircuitState(Enum):
    CLOSED = "closed"         # 正常
    OPEN = "open"             # 熔断，拒绝请求
    HALF_OPEN = "half_open"   # 试探恢复


class CircuitBreaker:
    def __init__(
        self,
        failure_threshold: int = 5,
        reset_timeout: float = 60.0,
        half_open_max_calls: int = 3,
    ):
        self.failure_threshold = failure_threshold
        self.reset_timeout = reset_timeout
        self.half_open_max_calls = half_open_max_calls

        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._last_failure_time: float = 0
        self._half_open_calls = 0
        self._lock = asyncio.Lock()

    @property
    def state(self) -> CircuitState:
        if self._state == CircuitState.OPEN:
            if time.time() - self._last_failure_time >= self.reset_timeout:
                self._state = CircuitState.HALF_OPEN
                self._half_open_calls = 0
        return self._state

    async def call(self, func: Callable[..., T], *args, **kwargs) -> T:
        async with self._lock:
            current_state = self.state

            if current_state == CircuitState.OPEN:
                raise Exception("Circuit breaker is OPEN — rejecting request")

            if current_state == CircuitState.HALF_OPEN:
                if self._half_open_calls >= self.half_open_max_calls:
                    raise Exception("Circuit breaker HALF_OPEN — max probe calls reached")
                self._half_open_calls += 1

        try:
            result = await func(*args, **kwargs)
            async with self._lock:
                # 成功：重置计数
                self._failure_count = 0
                if self._state == CircuitState.HALF_OPEN:
                    self._state = CircuitState.CLOSED
            return result
        except Exception as e:
            async with self._lock:
                self._failure_count += 1
                self._last_failure_time = time.time()
                if self._failure_count >= self.failure_threshold:
                    self._state = CircuitState.OPEN
            raise


# 全局实例
llm_circuit_breaker = CircuitBreaker(failure_threshold=5, reset_timeout=60.0)

async def resilient_llm_call(messages: list[dict]) -> str:
    return await llm_circuit_breaker.call(call_llm, messages)
```

### 6.3 Kubernetes 探针配置

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ai-backend
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: api
          image: myapp/ai-backend:v1.2.0
          ports:
            - containerPort: 8000
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
            limits:
              cpu: "2000m"
              memory: "2Gi"
          livenessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 10   # 等待应用启动
            periodSeconds: 15
            failureThreshold: 3       # 连续 3 次失败才重启
          readinessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 5
            periodSeconds: 10
            failureThreshold: 2       # 连续 2 次失败则从 Service 摘除
          startupProbe:
            httpGet:
              path: /health
              port: 8000
            failureThreshold: 30      # 最多等待 30 * 10 = 300s 启动
            periodSeconds: 10
          env:
            - name: OPENAI_API_KEY
              valueFrom:
                secretKeyRef:
                  name: llm-secrets
                  key: openai-api-key
          lifecycle:
            preStop:
              exec:
                # 给 in-flight 请求 30s 完成时间
                command: ["/bin/sh", "-c", "sleep 30"]
      terminationGracePeriodSeconds: 60
```

### 6.4 横向扩展注意事项

| 问题 | 解决方案 |
|------|----------|
| 会话粘性 | 使用 Redis 集中存储会话，无需 sticky session |
| 流式连接超时 | Nginx `proxy_read_timeout 300s` + ALB idle timeout 310s |
| 并发 Token 计算 | 使用 Redis INCRBY 原子操作，避免竞态 |
| 热 Key 限流 | 对同一 session_id 使用 Redis 令牌桶限流 |
| LLM Key 轮换 | LiteLLM Router 管理多个 API Key，自动轮换 |

---

## 7. FastAPI 在 AI 后端的统治地位

### 7.1 为什么 FastAPI 成为 AI 后端的事实标准

想象你在开一家餐厅。你需要一个厨房管理系统：它必须同时处理多桌订单（异步并发），自动记录菜单和食材清单（文档生成），严格检查每道菜的配料是否合格（数据验证），还要支持灵活的人员分工（依赖注入）。FastAPI 就是 AI 后端世界里的这套系统——它把 Web 框架在 AI 场景下最需要的能力全部内置了。

2026 年，几乎所有主流 AI 开源项目都选择了 FastAPI 作为后端框架：

| 项目 | 领域 | FastAPI 使用方式 |
|------|------|-----------------|
| **vLLM** | LLM 推理引擎 | OpenAI 兼容 API 服务端，SSE 流式端点 |
| **SGLang** | LLM 推理引擎 | 高性能 API 服务器，异步调度 |
| **Open WebUI** | AI 前端平台 | 完整后端服务，WebSocket + REST |
| **Dify** | LLMOps 平台 | 工作流执行引擎，多租户 API |
| **LiteLLM** | LLM 网关 | Proxy Server，8ms P95 at 1k RPS |
| **Langfuse** | 可观测性平台 | API 数据采集层 |
| **LobeChat** | AI Chat 平台 | 服务端 API 层 |

这不是巧合，而是 FastAPI 的四大核心优势完美匹配了 AI 后端的技术需求。

### 7.2 四大核心优势解析

#### 优势一：async-native（原生异步）

LLM 调用的特点是**高延迟**（单次请求 2-30 秒）但**低 CPU 占用**（等待远程 API 返回）。这恰好是异步编程的最佳场景——在等待 LLM 响应期间，服务器可以处理其他请求。

```python
from fastapi import FastAPI
import httpx

app = FastAPI()

# ✅ 异步：一个进程可以同时处理数百个 LLM 请求
@app.post("/chat")
async def chat(request: ChatRequest):
    async with httpx.AsyncClient(timeout=60.0) as client:
        # 等待 LLM 的 10 秒内，这个进程可以处理其他请求
        response = await client.post(
            "https://api.openai.com/v1/chat/completions",
            json={"model": "gpt-4o", "messages": request.messages},
            headers={"Authorization": f"Bearer {api_key}"},
        )
    return response.json()


# ❌ 同步：每个请求独占一个线程，10 个线程只能同时服务 10 个用户
@app.post("/chat-sync-bad")
def chat_sync(request: ChatRequest):
    import requests  # 同步 HTTP 库
    response = requests.post(...)  # 阻塞整个线程
    return response.json()
```

类比：同步模式像是一个柜员同时只能服务一位客户，客户去复印材料时柜员只能干等；异步模式像是柜员发给客户一个号码牌，客户去复印期间柜员继续服务下一位。

#### 优势二：自动 OpenAPI 文档

FastAPI 基于类型注解自动生成 OpenAPI（Swagger）文档。对于 AI 后端来说，这意味着前端团队可以直接查看所有可用的端点、请求格式和响应结构，无需额外维护文档。

```python
from pydantic import BaseModel, Field


class ChatCompletionRequest(BaseModel):
    """OpenAI 兼容的聊天补全请求"""
    model: str = Field(..., description="模型名称", example="gpt-4o")
    messages: list[dict] = Field(..., description="消息列表")
    temperature: float = Field(0.7, ge=0, le=2, description="采样温度")
    max_tokens: int | None = Field(None, description="最大生成 Token 数")
    stream: bool = Field(False, description="是否启用流式输出")


class ChatCompletionResponse(BaseModel):
    """OpenAI 兼容的聊天补全响应"""
    id: str = Field(..., description="请求 ID")
    choices: list[dict] = Field(..., description="候选回复列表")
    usage: dict = Field(..., description="Token 用量统计")


# FastAPI 自动为这个端点生成可交互的文档页面
@app.post("/v1/chat/completions", response_model=ChatCompletionResponse)
async def create_chat_completion(request: ChatCompletionRequest):
    ...
```

访问 `http://localhost:8000/docs` 即可看到完整的可交互 API 文档。vLLM 和 LiteLLM 都利用这一特性，让用户可以直接在浏览器中测试 API。

#### 优势三：Pydantic 数据验证

AI 应用的请求参数复杂且嵌套深（消息列表、工具定义、模型配置等）。Pydantic 在请求到达业务逻辑之前就完成了类型检查和格式校验，避免了运行时错误。

```python
from pydantic import BaseModel, field_validator


class ToolCall(BaseModel):
    """工具调用定义——Pydantic 自动验证嵌套结构"""
    name: str
    arguments: dict

    @field_validator("name")
    @classmethod
    def validate_tool_name(cls, v: str) -> str:
        allowed = {"search", "calculator", "code_interpreter"}
        if v not in allowed:
            raise ValueError(f"不支持的工具: {v}，可选: {allowed}")
        return v


class AgentRequest(BaseModel):
    messages: list[dict]
    tools: list[ToolCall] | None = None
    max_iterations: int = Field(default=10, ge=1, le=50)

    @field_validator("messages")
    @classmethod
    def validate_messages(cls, v: list[dict]) -> list[dict]:
        if not v:
            raise ValueError("消息列表不能为空")
        if v[0].get("role") != "system" and v[0].get("role") != "user":
            raise ValueError("第一条消息必须是 system 或 user 角色")
        return v
```

#### 优势四：依赖注入

FastAPI 的依赖注入系统让认证、数据库连接、配置加载等横切关注点可以优雅地复用，而不是在每个端点中重复代码。

```python
from fastapi import Depends, Header, HTTPException


async def verify_api_key(
    authorization: str = Header(..., description="Bearer API Key"),
) -> str:
    """验证 API Key 并返回用户 ID——所有需要认证的端点共享此逻辑"""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid auth format")
    api_key = authorization.removeprefix("Bearer ")
    user = await db.get_user_by_api_key(api_key)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return user.id


async def get_rate_limiter(user_id: str = Depends(verify_api_key)):
    """基于用户 ID 的速率限制——依赖 verify_api_key 的结果"""
    limiter = await redis.get(f"rate:{user_id}")
    if limiter and int(limiter) > 100:
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    await redis.incr(f"rate:{user_id}")
    return user_id


# 端点只需声明依赖，FastAPI 自动按顺序执行依赖链
@app.post("/v1/chat/completions")
async def chat(
    request: ChatRequest,
    user_id: str = Depends(get_rate_limiter),  # 自动执行: verify_api_key → rate_limiter
):
    ...
```

### 7.3 vLLM 的 API Server 架构

vLLM 是目前最流行的 LLM 推理引擎，其 API Server 展示了 FastAPI 在高性能 AI 后端中的典型用法。

```diagram
                    vLLM API Server 架构
┌──────────────────────────────────────────────────────────┐
│                  FastAPI Application                      │
│                                                           │
│  ┌─────────────────┐  ┌─────────────────┐                │
│  │ /v1/completions  │  │ /v1/chat/       │                │
│  │                  │  │  completions    │  OpenAI 兼容    │
│  └────────┬─────────┘  └────────┬────────┘  端点          │
│           │                      │                        │
│           ▼                      ▼                        │
│  ┌──────────────────────────────────────┐                 │
│  │        Request Processor              │                │
│  │  • Tokenize input                     │                │
│  │  • Validate parameters                │                │
│  │  • Create SamplingParams              │                │
│  └──────────────────┬───────────────────┘                 │
│                     ▼                                     │
│  ┌──────────────────────────────────────┐                 │
│  │        AsyncLLMEngine                 │                │
│  │  • Continuous Batching                │                │
│  │  • PagedAttention                     │                │
│  │  • 异步事件循环驱动                     │                │
│  └──────────────────────────────────────┘                 │
└──────────────────────────────────────────────────────────┘
```

关键设计模式：

```python
# vLLM 风格：OpenAI 兼容的流式端点实现
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, JSONResponse
import asyncio
import json
import time


app = FastAPI(title="LLM Inference Server")


async def generate_stream(engine, request_id: str, prompt: str, params: dict):
    """vLLM 风格的异步生成器——将引擎输出转换为 OpenAI SSE 格式"""
    created = int(time.time())

    # 模拟 vLLM 引擎的异步 Token 生成
    async for output in engine.generate(prompt, params, request_id):
        chunk = {
            "id": f"chatcmpl-{request_id}",
            "object": "chat.completion.chunk",
            "created": created,
            "model": params.get("model", "default"),
            "choices": [{
                "index": 0,
                "delta": {"content": output.text},
                "finish_reason": None,
            }],
        }
        yield f"data: {json.dumps(chunk)}\n\n"

    # 发送结束标记
    final_chunk = {
        "id": f"chatcmpl-{request_id}",
        "object": "chat.completion.chunk",
        "created": created,
        "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
    }
    yield f"data: {json.dumps(final_chunk)}\n\n"
    yield "data: [DONE]\n\n"


@app.post("/v1/chat/completions")
async def create_chat_completion(request: Request):
    body = await request.json()

    if body.get("stream", False):
        # 流式模式：返回 SSE
        return StreamingResponse(
            generate_stream(engine, request_id, prompt, params),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Request-Id": request_id,
            },
        )
    else:
        # 非流式模式：等待完整生成后返回 JSON
        result = await engine.generate_complete(prompt, params, request_id)
        return JSONResponse(content=format_completion_response(result))
```

### 7.4 Open WebUI 的后端架构

Open WebUI 展示了 FastAPI 构建完整 AI 平台的工程实践：

```diagram
          Open WebUI 后端架构
┌─────────────────────────────────────┐
│           FastAPI App                │
│                                      │
│  Middleware Chain:                    │
│  ┌────────────────────────────┐      │
│  │ 1. CORS Middleware          │      │
│  │ 2. Auth Middleware (JWT)    │      │
│  │ 3. Rate Limiting            │      │
│  │ 4. Request Logging          │      │
│  └────────────┬───────────────┘      │
│               ▼                      │
│  ┌────────────────────────────┐      │
│  │ API Routes                  │      │
│  │  /api/chat    → Chat Logic  │      │
│  │  /api/models  → Model Mgmt  │      │
│  │  /api/files   → File Upload  │      │
│  │  /ws          → WebSocket    │      │
│  └────────────┬───────────────┘      │
│               ▼                      │
│  ┌────────────────────────────┐      │
│  │ Data Layer                  │      │
│  │  SQLAlchemy ORM             │      │
│  │  Alembic Migrations         │      │
│  │  SQLite / PostgreSQL        │      │
│  └────────────────────────────┘      │
└─────────────────────────────────────┘
```

核心技术栈组合：
- **FastAPI** + **SQLAlchemy**：ORM 数据访问层，支持 SQLite（开发）和 PostgreSQL（生产）
- **Alembic**：数据库迁移管理，确保数据库 Schema 平滑升级
- **WebSocket**：实时双向通信，用于 Chat 流式推送和在线状态同步
- **Middleware Chain**：中间件链式架构，认证 → 限流 → CORS → 日志

---

## 8. 流式响应后端深度实现

### 8.1 为什么需要深入理解流式架构

前文第 1 节介绍了 SSE 的基本实现。但在生产环境中，流式响应面临更多挑战：中途错误如何通知客户端？客户端消费慢时如何处理背压？WebSocket 和 SSE 各自适用于哪些场景？本节深入探讨这些问题。

类比：基本的 SSE 就像一根水管通水——打开水龙头，水就流出来。但生产环境的流式架构像是一套完整的供水系统：需要考虑水管破裂报警（错误处理）、水压调节（背压控制）、双向水路（WebSocket）、多种水源切换（AG-UI 协议）。

### 8.2 SSE 中途错误处理

流式响应最棘手的问题之一：HTTP 状态码已经发送（200 OK），此时 LLM 生成到一半报错了，怎么办？

```python
import json
import traceback
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.responses import StreamingResponse


async def resilient_stream(
    messages: list[dict],
    model: str,
) -> AsyncGenerator[str, None]:
    """带完善错误处理的流式生成器"""
    try:
        async for token in llm_client.stream(messages, model=model):
            chunk = {
                "choices": [{"delta": {"content": token}, "finish_reason": None}],
            }
            yield f"data: {json.dumps(chunk)}\n\n"

        # 正常结束
        yield f"data: {json.dumps({'choices': [{'delta': {}, 'finish_reason': 'stop'}]})}\n\n"
        yield "data: [DONE]\n\n"

    except Exception as e:
        # ⚠️ 关键：HTTP 200 已发送，无法改状态码
        # 方案一：发送 SSE error 事件
        error_event = {
            "error": {
                "message": str(e),
                "type": type(e).__name__,
                "code": "stream_error",
            }
        }
        yield f"event: error\ndata: {json.dumps(error_event)}\n\n"

        # 方案二：在 data 字段中嵌入错误（兼容 OpenAI 风格客户端）
        error_chunk = {
            "choices": [{
                "delta": {"content": ""},
                "finish_reason": "error",
            }],
            "error": {"message": str(e)},
        }
        yield f"data: {json.dumps(error_chunk)}\n\n"
        yield "data: [DONE]\n\n"


@app.post("/v1/chat/completions")
async def chat_stream(request: ChatRequest):
    return StreamingResponse(
        resilient_stream(request.messages, request.model),
        media_type="text/event-stream",
    )
```

客户端配合处理：

```javascript
// 前端消费 SSE 时，需要监听 error 事件
const eventSource = new EventSource('/v1/chat/completions');

eventSource.addEventListener('error', (event) => {
  const error = JSON.parse(event.data);
  console.error('Stream error:', error.error.message);
  showErrorToast('生成中断，请重试');
});

eventSource.onmessage = (event) => {
  if (event.data === '[DONE]') {
    eventSource.close();
    return;
  }
  const chunk = JSON.parse(event.data);
  if (chunk.error) {
    // OpenAI 风格的内联错误
    handleStreamError(chunk.error);
    return;
  }
  appendToken(chunk.choices[0].delta.content);
};
```

### 8.3 背压（Backpressure）处理

当 LLM 生成速度远快于客户端消费速度时（例如弱网环境），服务端内存会不断积压未发送的 chunk。

类比：这就像厨房出菜速度远快于服务员上菜速度。如果不做控制，菜会堆满出菜口。解决方案是让厨房"感知"服务员的忙碌程度，适当放慢出菜节奏。

```python
import asyncio
from collections import deque


class BackpressureAwareStream:
    """背压感知的流式传输——当客户端消费慢时自动调节发送速率"""

    def __init__(self, max_buffer_size: int = 100):
        self.buffer: deque[str] = deque(maxlen=max_buffer_size)
        self.max_buffer_size = max_buffer_size
        self._closed = False

    async def produce(self, token: str) -> None:
        """生产端：LLM 生成的 Token 放入缓冲区"""
        while len(self.buffer) >= self.max_buffer_size:
            if self._closed:
                return
            # 缓冲区满，等待消费端消费
            await asyncio.sleep(0.01)
        self.buffer.append(token)

    async def consume(self) -> AsyncGenerator[str, None]:
        """消费端：按客户端速率输出 Token"""
        while not self._closed or self.buffer:
            if self.buffer:
                token = self.buffer.popleft()
                chunk = {"choices": [{"delta": {"content": token}}]}
                yield f"data: {json.dumps(chunk)}\n\n"
            else:
                await asyncio.sleep(0.005)  # 无数据时短暂等待

    def close(self):
        self._closed = True
```

### 8.4 WebSocket 双向通信场景

SSE 是单向推送（服务端 → 客户端），但有些 AI 场景需要双向通信：

| 场景 | 为什么需要双向 | 协议选择 |
|------|--------------|----------|
| 基本 Chat | 用户发一条，模型回一条 | SSE 即可 |
| 工具调用审批（HITL） | 模型请求调用工具，等待用户确认 | WebSocket |
| 实时语音对话 | 双方同时说话，低延迟 | WebSocket |
| 多人协作编辑 | 多用户同时操作同一文档 | WebSocket |
| Agent 执行监控 | 实时展示 Agent 的多步推理过程 | WebSocket / SSE |

```python
from fastapi import WebSocket, WebSocketDisconnect
import json


class ConnectionManager:
    """WebSocket 连接管理器——管理多个客户端的实时连接"""

    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}

    async def connect(self, session_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[session_id] = websocket

    def disconnect(self, session_id: str):
        self.active_connections.pop(session_id, None)

    async def send_event(self, session_id: str, event: dict):
        ws = self.active_connections.get(session_id)
        if ws:
            await ws.send_json(event)


manager = ConnectionManager()


@app.websocket("/ws/chat/{session_id}")
async def websocket_chat(websocket: WebSocket, session_id: str):
    await manager.connect(session_id, websocket)
    try:
        while True:
            # 接收客户端消息
            data = await websocket.receive_json()

            if data["type"] == "user_message":
                # 流式返回 LLM 响应
                async for token in llm_stream(data["content"]):
                    await websocket.send_json({
                        "type": "token",
                        "content": token,
                    })
                await websocket.send_json({"type": "done"})

            elif data["type"] == "tool_approval":
                # HITL：用户确认/拒绝工具调用
                approved = data.get("approved", False)
                if approved:
                    result = await execute_tool(data["tool_call"])
                    await websocket.send_json({
                        "type": "tool_result",
                        "result": result,
                    })

    except WebSocketDisconnect:
        manager.disconnect(session_id)
```

### 8.5 AG-UI 协议服务端实现

AG-UI（Agent-User Interaction Protocol）是 2025 年提出的 Agent-前端标准化通信协议，定义了 Agent 执行过程中各类事件的流式传输格式。

```python
from enum import Enum
from pydantic import BaseModel
import json


class AGUIEventType(str, Enum):
    """AG-UI 协议定义的事件类型"""
    TEXT_MESSAGE_START = "TEXT_MESSAGE_START"
    TEXT_MESSAGE_CONTENT = "TEXT_MESSAGE_CONTENT"
    TEXT_MESSAGE_END = "TEXT_MESSAGE_END"
    TOOL_CALL_START = "TOOL_CALL_START"
    TOOL_CALL_ARGS = "TOOL_CALL_ARGS"
    TOOL_CALL_END = "TOOL_CALL_END"
    STATE_SNAPSHOT = "STATE_SNAPSHOT"
    STATE_DELTA = "STATE_DELTA"
    RUN_STARTED = "RUN_STARTED"
    RUN_FINISHED = "RUN_FINISHED"
    RUN_ERROR = "RUN_ERROR"


class AGUIEvent(BaseModel):
    type: AGUIEventType
    data: dict | None = None


async def agui_stream(agent_executor, messages: list) -> AsyncGenerator[str, None]:
    """AG-UI 协议的服务端实现——将 Agent 执行过程转换为标准化事件流"""
    # Agent 开始执行
    yield format_sse(AGUIEvent(type=AGUIEventType.RUN_STARTED))

    try:
        async for step in agent_executor.stream(messages):
            if step.type == "text":
                # 文本消息流
                yield format_sse(AGUIEvent(
                    type=AGUIEventType.TEXT_MESSAGE_START,
                    data={"message_id": step.id},
                ))
                for token in step.tokens:
                    yield format_sse(AGUIEvent(
                        type=AGUIEventType.TEXT_MESSAGE_CONTENT,
                        data={"content": token},
                    ))
                yield format_sse(AGUIEvent(
                    type=AGUIEventType.TEXT_MESSAGE_END,
                ))

            elif step.type == "tool_call":
                # 工具调用事件
                yield format_sse(AGUIEvent(
                    type=AGUIEventType.TOOL_CALL_START,
                    data={"name": step.tool_name, "call_id": step.call_id},
                ))
                yield format_sse(AGUIEvent(
                    type=AGUIEventType.TOOL_CALL_ARGS,
                    data={"args": step.arguments},
                ))
                yield format_sse(AGUIEvent(
                    type=AGUIEventType.TOOL_CALL_END,
                    data={"result": step.result},
                ))

            elif step.type == "state_update":
                # Agent 状态快照（供前端展示推理过程）
                yield format_sse(AGUIEvent(
                    type=AGUIEventType.STATE_DELTA,
                    data=step.state_diff,
                ))

        yield format_sse(AGUIEvent(type=AGUIEventType.RUN_FINISHED))

    except Exception as e:
        yield format_sse(AGUIEvent(
            type=AGUIEventType.RUN_ERROR,
            data={"message": str(e)},
        ))


def format_sse(event: AGUIEvent) -> str:
    return f"event: {event.type.value}\ndata: {event.model_dump_json()}\n\n"
```

---

## 9. AI 应用认证与授权

### 9.1 为什么 AI 应用的认证授权不同于传统 Web 应用

传统 Web 应用的认证主要保护**数据**（用户隐私、业务数据）。AI 应用除了保护数据，还要保护**计算资源**——每次 LLM 调用都是真金白银（GPT-4o 每百万 Token $2.5-$10），一个泄露的 API Key 可能在几小时内消耗数千美元。

类比：传统 Web 认证像是检查你的身份证才让你进图书馆（保护图书不被偷）。AI 应用认证像是高档自助餐厅——不仅要验证你的预订（身份），还要跟踪你吃了多少（Token 用量），确保不超出预算（成本上限），还要限制某些菜品只对 VIP 开放（模型访问控制）。

### 9.2 API Key 管理（LiteLLM Virtual Keys 模式）

LiteLLM 的 Virtual Keys 系统是 AI 应用 API Key 管理的标杆实现。核心思想是：不直接暴露 LLM Provider 的原始 Key，而是创建"虚拟 Key"分发给用户，每个虚拟 Key 可以独立设置权限和限制。

```python
from pydantic import BaseModel
from datetime import datetime, timedelta
import secrets
import hashlib


class VirtualKey(BaseModel):
    """虚拟 API Key 数据模型——参考 LiteLLM Virtual Keys 设计"""
    key_id: str                          # 内部 ID
    key_hash: str                        # Key 的哈希值（不存储原文）
    key_alias: str | None = None         # 人类可读别名
    user_id: str                         # 所属用户
    team_id: str | None = None           # 所属团队
    org_id: str | None = None            # 所属组织

    # 访问控制
    allowed_models: list[str] | None = None   # 允许的模型列表，None 表示全部
    max_budget: float | None = None           # 总预算上限（美元）
    max_budget_per_month: float | None = None # 月度预算
    tpm_limit: int | None = None              # 每分钟 Token 限制
    rpm_limit: int | None = None              # 每分钟请求限制
    max_parallel_requests: int | None = None  # 最大并发请求数

    # 生命周期
    expires_at: datetime | None = None        # 过期时间
    is_active: bool = True
    created_at: datetime
    last_used_at: datetime | None = None

    # 用量追踪
    total_tokens_used: int = 0
    total_cost: float = 0.0


class APIKeyManager:
    """API Key 管理器——创建、验证、撤销虚拟 Key"""

    def __init__(self, db):
        self.db = db

    async def create_key(
        self,
        user_id: str,
        team_id: str | None = None,
        allowed_models: list[str] | None = None,
        max_budget: float | None = None,
        expires_in: timedelta | None = None,
    ) -> tuple[str, VirtualKey]:
        """创建虚拟 Key，返回 (原始 Key, Key 元数据)"""
        # 生成安全的随机 Key
        raw_key = f"sk-max-{secrets.token_urlsafe(32)}"
        key_hash = hashlib.sha256(raw_key.encode()).hexdigest()

        virtual_key = VirtualKey(
            key_id=secrets.token_hex(8),
            key_hash=key_hash,
            user_id=user_id,
            team_id=team_id,
            allowed_models=allowed_models,
            max_budget=max_budget,
            expires_at=datetime.utcnow() + expires_in if expires_in else None,
            created_at=datetime.utcnow(),
        )
        await self.db.save_key(virtual_key)
        return raw_key, virtual_key  # 原始 Key 只在创建时返回一次

    async def verify_key(self, raw_key: str) -> VirtualKey | None:
        """验证 Key 并检查是否有效"""
        key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
        key = await self.db.get_key_by_hash(key_hash)
        if not key or not key.is_active:
            return None
        if key.expires_at and key.expires_at < datetime.utcnow():
            return None
        if key.max_budget and key.total_cost >= key.max_budget:
            return None
        return key

    async def rotate_key(self, old_key_id: str) -> tuple[str, VirtualKey]:
        """密钥轮换：创建新 Key 并停用旧 Key"""
        old_key = await self.db.get_key_by_id(old_key_id)
        # 创建相同权限的新 Key
        raw_key, new_key = await self.create_key(
            user_id=old_key.user_id,
            team_id=old_key.team_id,
            allowed_models=old_key.allowed_models,
            max_budget=old_key.max_budget,
        )
        # 停用旧 Key（延迟失效，给迁移留时间）
        old_key.expires_at = datetime.utcnow() + timedelta(hours=24)
        await self.db.save_key(old_key)
        return raw_key, new_key
```

### 9.3 多租户隔离

AI 平台通常需要支持多个组织、团队和用户。LiteLLM 的多租户模型提供了清晰的层级结构：

```diagram
            多租户层级结构
┌─────────────────────────────────┐
│  Organization（组织）            │  ← 最高层级，独立计费
│  ├── Team A（团队 A）            │  ← 共享预算，独立限额
│  │   ├── User 1（API Key 1）    │  ← 个人限额
│  │   ├── User 2（API Key 2）    │
│  │   └── User 3（API Key 3）    │
│  ├── Team B（团队 B）            │
│  │   ├── User 4（API Key 4）    │
│  │   └── User 5（API Key 5）    │
│  └── Organization Budget: $500  │
│      Team A Budget: $300         │
│      Team B Budget: $200         │
└─────────────────────────────────┘
```

```python
from pydantic import BaseModel


class TenantConfig(BaseModel):
    """租户配置——每个层级可以独立设置限制和路由"""
    org_id: str
    team_id: str | None = None

    # 模型路由：不同租户可以使用不同的模型
    allowed_models: list[str]
    default_model: str

    # 成本控制
    monthly_budget: float
    current_spend: float = 0.0

    # 路由策略：某些租户走专用部署
    custom_endpoints: dict[str, str] | None = None


class MultiTenantRouter:
    """多租户路由器——根据租户配置路由请求"""

    def __init__(self):
        self.tenant_configs: dict[str, TenantConfig] = {}

    async def route_request(
        self,
        request: ChatRequest,
        api_key: VirtualKey,
    ) -> dict:
        config = self.tenant_configs.get(api_key.org_id)

        # 1. 检查模型访问权限
        if request.model not in config.allowed_models:
            raise HTTPException(
                status_code=403,
                detail=f"Model {request.model} not allowed for your organization",
            )

        # 2. 检查预算
        if config.current_spend >= config.monthly_budget:
            raise HTTPException(
                status_code=429,
                detail="Monthly budget exceeded",
            )

        # 3. 路由到对应端点
        endpoint = (config.custom_endpoints or {}).get(
            request.model,
            DEFAULT_ENDPOINT,
        )

        return {"endpoint": endpoint, "config": config}
```

### 9.4 RBAC 权限模型（参考 Open WebUI）

Open WebUI 实现了适合 AI 平台的角色访问控制：

```python
from enum import Enum
from functools import wraps


class Role(str, Enum):
    """Open WebUI 风格的角色定义"""
    ADMIN = "admin"       # 管理员：全部权限
    USER = "user"         # 普通用户：使用权限
    PENDING = "pending"   # 待审批：只读权限


class Permission(str, Enum):
    """细粒度权限定义"""
    CHAT_CREATE = "chat:create"
    CHAT_READ = "chat:read"
    MODEL_LIST = "model:list"
    MODEL_USE_GPT4 = "model:use:gpt-4o"
    MODEL_USE_CLAUDE = "model:use:claude-3-5-sonnet"
    FILE_UPLOAD = "file:upload"
    ADMIN_USER_MANAGE = "admin:user:manage"
    ADMIN_MODEL_MANAGE = "admin:model:manage"
    ADMIN_SETTINGS = "admin:settings"


# 角色 → 权限映射
ROLE_PERMISSIONS: dict[Role, set[Permission]] = {
    Role.ADMIN: set(Permission),  # 管理员拥有全部权限
    Role.USER: {
        Permission.CHAT_CREATE,
        Permission.CHAT_READ,
        Permission.MODEL_LIST,
        Permission.MODEL_USE_GPT4,
        Permission.FILE_UPLOAD,
    },
    Role.PENDING: {
        Permission.CHAT_READ,
        Permission.MODEL_LIST,
    },
}


def require_permission(permission: Permission):
    """权限检查装饰器——声明式地保护端点"""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, current_user=None, **kwargs):
            if not current_user:
                raise HTTPException(status_code=401)
            user_permissions = ROLE_PERMISSIONS.get(current_user.role, set())
            if permission not in user_permissions:
                raise HTTPException(
                    status_code=403,
                    detail=f"Permission denied: {permission.value}",
                )
            return await func(*args, current_user=current_user, **kwargs)
        return wrapper
    return decorator


# 使用示例
@app.post("/api/chat")
@require_permission(Permission.CHAT_CREATE)
async def create_chat(request: ChatRequest, current_user: User = Depends(get_current_user)):
    ...


@app.put("/api/admin/models/{model_id}")
@require_permission(Permission.ADMIN_MODEL_MANAGE)
async def update_model_config(model_id: str, current_user: User = Depends(get_current_user)):
    ...
```

### 9.5 企业级身份集成

生产环境中 AI 平台通常需要与企业现有身份体系集成：

| 集成方式 | 场景 | 实现要点 |
|----------|------|----------|
| **SSO（OIDC/SAML）** | 企业统一登录 | FastAPI + Authlib，支持 Okta/Azure AD |
| **LDAP/AD** | 企业目录服务 | python-ldap 库，同步用户和组织结构 |
| **SCIM 2.0** | 自动化用户生命周期管理 | 创建/禁用/更新用户的标准 API |
| **API Key + JWT** | 程序化访问 + Web 会话 | API 调用用 Key，Web UI 用 JWT |

---

## 10. AI 后端中间件架构

### 10.1 为什么需要中间件链

AI 应用的每个请求需要经过多道"检查站"：验证身份、检查速率、校验参数、记录日志、追踪成本……如果在每个端点函数中重复这些逻辑，代码会臃肿且难以维护。

类比：中间件链就像机场的安检流程。每位旅客（请求）进入登机口（业务逻辑）前，依次经过：身份验证（护照检查）→ 安全扫描（参数校验）→ 行李称重（速率限制）→ 登机牌打印（请求追踪）。每个环节由专门的工作人员负责，流程标准化且可插拔。

### 10.2 七层中间件架构

```diagram
               AI 后端中间件链
┌────────────────────────────────────────────────────┐
│  Request ──────────────────────────────── Response  │
│     │                                        ▲      │
│     ▼                                        │      │
│  ┌──────────────────────────────────────────┐ │     │
│  │ ① Auth Middleware                        │ │     │
│  │   API Key / JWT / OAuth 验证              │ │     │
│  └──────────────────┬───────────────────────┘ │     │
│                     ▼                         │      │
│  ┌──────────────────────────────────────────┐ │     │
│  │ ② Rate Limiting                          │ │     │
│  │   Token Bucket / Sliding Window          │ │     │
│  └──────────────────┬───────────────────────┘ │     │
│                     ▼                         │      │
│  ┌──────────────────────────────────────────┐ │     │
│  │ ③ Request Validation                     │ │     │
│  │   Pydantic Schema 校验                    │ │     │
│  └──────────────────┬───────────────────────┘ │     │
│                     ▼                         │      │
│  ┌──────────────────────────────────────────┐ │     │
│  │ ④ Logging & Tracing                      │ │     │
│  │   OpenTelemetry + Langfuse               │ │     │
│  └──────────────────┬───────────────────────┘ │     │
│                     ▼                         │      │
│  ┌──────────────────────────────────────────┐ │     │
│  │ ⑤ Cost Tracking                          │ │     │
│  │   Token 计数 + 预算执行                    │ │     │
│  └──────────────────┬───────────────────────┘ │     │
│                     ▼                         │      │
│  ┌──────────────────────────────────────────┐ │     │
│  │ ⑥ Caching                                │ │     │
│  │   语义缓存 + Prompt 缓存                   │ │     │
│  └──────────────────┬───────────────────────┘ │     │
│                     ▼                         │      │
│  ┌──────────────────────────────────────────┐ │     │
│  │ ⑦ Error Handling                         │ │     │
│  │   重试 + Fallback + 熔断                   │ │     │
│  └──────────────────┬───────────────────────┘ │     │
│                     ▼                         │      │
│         ┌──────────────────┐                  │      │
│         │  Business Logic  │ ─────────────────┘      │
│         │  (LLM 调用)       │                         │
│         └──────────────────┘                         │
└────────────────────────────────────────────────────┘
```

### 10.3 FastAPI 中间件实现

```python
import time
import uuid
from contextvars import ContextVar

from fastapi import FastAPI, Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

# 请求上下文：在中间件和业务逻辑之间传递信息
request_id_var: ContextVar[str] = ContextVar("request_id", default="")
user_id_var: ContextVar[str] = ContextVar("user_id", default="")


class AuthMiddleware(BaseHTTPMiddleware):
    """① 认证中间件——验证请求身份"""

    SKIP_PATHS = {"/health", "/docs", "/openapi.json"}

    async def dispatch(self, request: Request, call_next):
        if request.url.path in self.SKIP_PATHS:
            return await call_next(request)

        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return Response(
                content='{"error": "Missing API key"}',
                status_code=401,
                media_type="application/json",
            )

        api_key = auth_header.removeprefix("Bearer ")
        user = await verify_api_key(api_key)
        if not user:
            return Response(
                content='{"error": "Invalid API key"}',
                status_code=401,
                media_type="application/json",
            )

        # 将用户信息存入请求上下文
        user_id_var.set(user.id)
        request.state.user = user
        return await call_next(request)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """② 速率限制中间件——令牌桶算法"""

    async def dispatch(self, request: Request, call_next):
        user = getattr(request.state, "user", None)
        if not user:
            return await call_next(request)

        # 令牌桶：检查当前时间窗口内的请求数
        bucket_key = f"rate:{user.id}:{int(time.time()) // 60}"
        current = await redis.incr(bucket_key)
        if current == 1:
            await redis.expire(bucket_key, 60)

        rpm_limit = user.rpm_limit or 60  # 默认每分钟 60 次
        if current > rpm_limit:
            return Response(
                content='{"error": "Rate limit exceeded"}',
                status_code=429,
                media_type="application/json",
                headers={
                    "Retry-After": str(60 - int(time.time()) % 60),
                    "X-RateLimit-Limit": str(rpm_limit),
                    "X-RateLimit-Remaining": "0",
                },
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(rpm_limit)
        response.headers["X-RateLimit-Remaining"] = str(rpm_limit - current)
        return response


class TracingMiddleware(BaseHTTPMiddleware):
    """④ 追踪中间件——OpenTelemetry + 请求 ID 注入"""

    async def dispatch(self, request: Request, call_next):
        # 生成或继承请求 ID
        request_id = request.headers.get("X-Request-Id", str(uuid.uuid4()))
        request_id_var.set(request_id)

        start_time = time.perf_counter()
        response = await call_next(request)
        duration_ms = (time.perf_counter() - start_time) * 1000

        # 注入追踪头
        response.headers["X-Request-Id"] = request_id
        response.headers["X-Response-Time"] = f"{duration_ms:.1f}ms"

        # 结构化日志
        logger.info(
            "request_completed",
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            duration_ms=round(duration_ms, 1),
            user_id=user_id_var.get(""),
        )

        return response


class CostTrackingMiddleware(BaseHTTPMiddleware):
    """⑤ 成本追踪中间件——记录 Token 用量并执行预算"""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        # 只在 LLM 相关端点追踪成本
        if "/v1/chat/completions" not in request.url.path:
            return response

        user = getattr(request.state, "user", None)
        if not user:
            return response

        # 从响应头中提取 Token 用量（业务逻辑设置）
        tokens_used = int(response.headers.get("X-Tokens-Used", 0))
        cost = float(response.headers.get("X-Request-Cost", 0))

        if tokens_used > 0:
            # 更新用量统计
            await redis.incrbyfloat(f"cost:{user.id}:total", cost)
            await redis.incrbyfloat(f"cost:{user.org_id}:monthly", cost)

        return response


# 注册中间件（注意：后添加的先执行）
app = FastAPI()
app.add_middleware(CostTrackingMiddleware)   # ⑤ 最内层
app.add_middleware(TracingMiddleware)         # ④
app.add_middleware(RateLimitMiddleware)       # ②
app.add_middleware(AuthMiddleware)            # ① 最外层
```

### 10.4 LiteLLM 的中间件架构案例

LiteLLM Proxy 的中间件设计体现了 AI 网关的最佳实践：

```python
# LiteLLM 风格的请求处理管线
class LLMProxyPipeline:
    """LiteLLM 风格的请求处理管线——每个阶段可以独立配置"""

    def __init__(self):
        self.pre_call_hooks: list[Callable] = []    # LLM 调用前
        self.post_call_hooks: list[Callable] = []   # LLM 调用后
        self.failure_hooks: list[Callable] = []      # 调用失败时

    async def process_request(self, request: dict) -> dict:
        # ========== Pre-call 阶段 ==========
        for hook in self.pre_call_hooks:
            request = await hook(request)
            # hook 可以修改请求（如注入 system prompt）
            # 也可以拒绝请求（如预算超限抛异常）

        # ========== LLM 调用 ==========
        try:
            response = await self.call_llm(request)
        except Exception as e:
            for hook in self.failure_hooks:
                await hook(request, e)
            raise

        # ========== Post-call 阶段 ==========
        for hook in self.post_call_hooks:
            response = await hook(request, response)
            # hook 可以修改响应（如过滤 PII）
            # 也可以记录指标（如 Token 用量）

        return response


# 注册自定义 hook
pipeline = LLMProxyPipeline()

async def budget_check_hook(request: dict) -> dict:
    """Pre-call：检查预算"""
    user_id = request.get("user")
    spent = await get_user_spend(user_id)
    if spent > request.get("max_budget", float("inf")):
        raise BudgetExceededError(f"User {user_id} budget exceeded")
    return request

async def langfuse_logging_hook(request: dict, response: dict) -> dict:
    """Post-call：记录到 Langfuse"""
    await langfuse.log_generation(
        model=request["model"],
        input=request["messages"],
        output=response["choices"][0]["message"],
        usage=response.get("usage"),
    )
    return response

pipeline.pre_call_hooks.append(budget_check_hook)
pipeline.post_call_hooks.append(langfuse_logging_hook)
```

### 10.5 Dify 的工作流执行引擎

Dify 展示了另一种中间件思维：将 AI 应用的整个执行过程抽象为**可视化工作流**，每个节点是一个独立的处理步骤：

```diagram
        Dify 工作流执行架构
┌───────────────────────────────────────────┐
│  Workflow Engine                           │
│                                            │
│  ┌─────────┐    ┌──────────┐    ┌───────┐ │
│  │ 开始节点  │───▶│ LLM 节点  │───▶│ 条件  │ │
│  │ (Input)  │    │ (GPT-4o) │    │ 分支   │ │
│  └─────────┘    └──────────┘    └───┬───┘ │
│                                  ┌──┴──┐   │
│                               ┌──┴──┐  │   │
│                               │工具   │ │   │
│                               │调用   │ │   │
│                               └──┬──┘ │   │
│                                  │  ┌─┴─┐ │
│                                  │  │代码│ │
│                                  │  │执行│ │
│                                  │  └─┬─┘ │
│                                  ▼    ▼    │
│                              ┌──────────┐  │
│                              │  结束节点  │  │
│                              │ (Output)  │  │
│                              └──────────┘  │
└───────────────────────────────────────────┘
```

核心设计思想：

```python
from abc import ABC, abstractmethod
from typing import Any


class WorkflowNode(ABC):
    """Dify 风格的工作流节点基类"""

    @abstractmethod
    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """执行节点逻辑，接收上下文，返回更新后的上下文"""
        ...


class LLMNode(WorkflowNode):
    """LLM 调用节点"""
    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        prompt = self.render_template(context)
        response = await llm_client.chat(prompt)
        context["llm_output"] = response
        return context


class ConditionalNode(WorkflowNode):
    """条件分支节点"""
    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        condition_result = eval_condition(self.condition, context)
        context["_next_node"] = self.true_branch if condition_result else self.false_branch
        return context


class ToolNode(WorkflowNode):
    """工具调用节点"""
    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        result = await execute_tool(self.tool_name, context.get("tool_args"))
        context["tool_result"] = result
        return context


class WorkflowEngine:
    """工作流引擎——按 DAG 顺序执行节点"""

    async def run(self, workflow_def: dict, initial_context: dict) -> dict:
        context = initial_context.copy()
        current_node_id = workflow_def["start_node"]

        while current_node_id:
            node = self.build_node(workflow_def["nodes"][current_node_id])

            # 执行节点
            context = await node.execute(context)

            # 流式输出中间结果（供前端实时展示）
            yield {
                "node_id": current_node_id,
                "status": "completed",
                "output": context.get("llm_output", context.get("tool_result")),
            }

            # 确定下一个节点
            current_node_id = context.pop("_next_node", None) or \
                              workflow_def["edges"].get(current_node_id)
```

---

## 11. 数据库选型与数据模型

### 11.1 为什么 AI 应用的数据模型不同于传统 CRUD

传统 Web 应用的数据模型围绕**业务实体**（用户、订单、商品）。AI 应用的数据模型需要额外处理：
- **对话历史**：消息链条、角色、工具调用记录
- **树形分支**：用户可以在对话中"分叉"（LobeChat 的重新生成功能）
- **向量嵌入**：语义搜索需要存储和检索高维向量
- **Token 用量**：每条消息的 Token 消耗需要精确记录

类比：传统数据库像是标准图书馆——每本书有固定的分类编号，按书架排列整齐。AI 应用的数据存储像是一个多媒体图书馆——除了传统书籍（结构化数据），还有有声书的播放列表（对话链条）、读书笔记的思维导图（树状结构）、以及根据内容"感觉像"进行检索的智能推荐系统（向量检索）。

### 11.2 对话存储数据模型

```python
from sqlalchemy import (
    Column, String, Text, Integer, Float, JSON, DateTime, ForeignKey, Index,
    Enum as SAEnum,
)
from sqlalchemy.orm import declarative_base, relationship
from datetime import datetime
import enum

Base = declarative_base()


class MessageRole(str, enum.Enum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"


class Conversation(Base):
    """会话表——一次完整的对话"""
    __tablename__ = "conversations"

    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), nullable=False, index=True)
    title = Column(String(255), default="New Chat")
    model = Column(String(100), default="gpt-4o")
    system_prompt = Column(Text, nullable=True)

    # 统计信息
    total_tokens = Column(Integer, default=0)
    total_cost = Column(Float, default=0.0)
    message_count = Column(Integer, default=0)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    messages = relationship("Message", back_populates="conversation", lazy="dynamic")


class Message(Base):
    """消息表——对话中的每条消息"""
    __tablename__ = "messages"

    id = Column(String(36), primary_key=True)
    conversation_id = Column(String(36), ForeignKey("conversations.id"), nullable=False)
    parent_id = Column(String(36), ForeignKey("messages.id"), nullable=True)  # 树状结构

    role = Column(SAEnum(MessageRole), nullable=False)
    content = Column(Text, nullable=True)         # 文本内容
    tool_calls = Column(JSON, nullable=True)      # 工具调用记录
    tool_call_id = Column(String(100), nullable=True)  # 工具响应对应的调用 ID

    # 元数据
    model = Column(String(100), nullable=True)     # 生成此消息的模型
    tokens_input = Column(Integer, default=0)      # 输入 Token 数
    tokens_output = Column(Integer, default=0)     # 输出 Token 数
    cost = Column(Float, default=0.0)              # 本次调用成本
    latency_ms = Column(Integer, nullable=True)    # 响应延迟
    finish_reason = Column(String(50), nullable=True)

    # 排序和分支
    sequence = Column(Integer, nullable=False)     # 在对话中的顺序
    is_active = Column(Integer, default=1)         # 软删除（重新生成时旧消息标记为非活跃）

    created_at = Column(DateTime, default=datetime.utcnow)

    conversation = relationship("Conversation", back_populates="messages")

    __table_args__ = (
        Index("idx_conv_sequence", "conversation_id", "sequence"),
        Index("idx_conv_active", "conversation_id", "is_active"),
        Index("idx_parent", "parent_id"),
    )
```

### 11.3 树形对话结构（分支对话）

LobeChat 等 AI Chat 应用支持"重新生成"和"编辑历史消息"，这意味着对话不是简单的线性列表，而是树形结构：

```diagram
               树形对话结构
                  ┌──────┐
                  │ User  │ "什么是 RAG？"
                  │ msg-1 │
                  └───┬───┘
                      │
                  ┌───┴───┐
                  │ Asst   │ "RAG 是检索增强生成..."（第一次回答）
                  │ msg-2  │
                  └───┬───┘
              ┌───────┴───────┐
              │               │
         ┌────┴────┐    ┌────┴────┐
         │ User     │    │ Asst    │  ← 用户点击"重新生成"
         │ msg-3    │    │ msg-2b  │  "RAG 的全称是..."（第二次回答）
         │"具体怎么 │    └─────────┘
         │ 实现？"   │
         └────┬────┘
              │
         ┌────┴────┐
         │ Asst     │
         │ msg-4    │
         └─────────┘
```

```python
class ConversationTree:
    """树形对话管理器——支持分支和重新生成"""

    async def get_active_branch(self, conversation_id: str) -> list[Message]:
        """获取当前活跃分支的消息列表（用于发送给 LLM）"""
        # 从最后一条活跃消息开始，沿 parent_id 向上追溯
        messages = []
        current = await self.get_latest_active_message(conversation_id)

        while current:
            messages.append(current)
            if current.parent_id:
                current = await self.get_message(current.parent_id)
            else:
                break

        messages.reverse()  # 从最早到最新
        return messages

    async def regenerate(self, message_id: str) -> Message:
        """重新生成某条 Assistant 消息——创建新分支"""
        original = await self.get_message(message_id)

        # 标记旧消息为非活跃
        original.is_active = 0
        await self.db.save(original)

        # 创建新的 Assistant 消息，挂在相同的 parent 下
        new_message = Message(
            id=generate_id(),
            conversation_id=original.conversation_id,
            parent_id=original.parent_id,  # 与原消息共享父节点
            role=MessageRole.ASSISTANT,
            sequence=original.sequence,
            is_active=1,
        )

        # 用活跃分支的上下文重新调用 LLM
        context = await self.get_active_branch(original.conversation_id)
        response = await llm_client.chat(context)
        new_message.content = response.content
        new_message.tokens_output = response.usage.completion_tokens

        await self.db.save(new_message)
        return new_message

    async def edit_and_continue(
        self, message_id: str, new_content: str
    ) -> list[Message]:
        """编辑历史消息并从该点继续——创建新分支"""
        original = await self.get_message(message_id)

        # 将原消息及其后续消息标记为非活跃
        await self.deactivate_subtree(message_id)

        # 创建编辑后的新消息
        edited = Message(
            id=generate_id(),
            conversation_id=original.conversation_id,
            parent_id=original.parent_id,
            role=original.role,
            content=new_content,
            sequence=original.sequence,
            is_active=1,
        )
        await self.db.save(edited)

        # 基于新消息重新生成 Assistant 回复
        context = await self.get_active_branch(original.conversation_id)
        response = await llm_client.chat(context)

        assistant_msg = Message(
            id=generate_id(),
            conversation_id=original.conversation_id,
            parent_id=edited.id,
            role=MessageRole.ASSISTANT,
            content=response.content,
            sequence=edited.sequence + 1,
            is_active=1,
        )
        await self.db.save(assistant_msg)

        return [edited, assistant_msg]
```

### 11.4 长对话高效分页

对话可能包含数百条消息，直接全量加载会导致内存和网络压力。高效的分页策略基于游标而非 OFFSET：

```python
from pydantic import BaseModel
from typing import Optional


class PaginationCursor(BaseModel):
    """游标分页——比 OFFSET 更高效"""
    last_sequence: int        # 最后一条消息的 sequence
    last_id: str              # 最后一条消息的 ID（打破 sequence 相同的情况）
    direction: str = "older"  # older: 加载更早的 / newer: 加载更新的


async def get_messages_paginated(
    conversation_id: str,
    cursor: Optional[PaginationCursor] = None,
    limit: int = 20,
) -> dict:
    """游标分页获取消息——避免 OFFSET 的性能问题"""
    query = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .where(Message.is_active == 1)
    )

    if cursor:
        if cursor.direction == "older":
            # 加载更早的消息
            query = query.where(
                (Message.sequence < cursor.last_sequence) |
                ((Message.sequence == cursor.last_sequence) &
                 (Message.id < cursor.last_id))
            ).order_by(Message.sequence.desc())
        else:
            # 加载更新的消息
            query = query.where(
                (Message.sequence > cursor.last_sequence) |
                ((Message.sequence == cursor.last_sequence) &
                 (Message.id > cursor.last_id))
            ).order_by(Message.sequence.asc())
    else:
        # 默认加载最新的消息
        query = query.order_by(Message.sequence.desc())

    query = query.limit(limit + 1)  # 多取一条判断是否有更多
    results = await db.execute(query)
    messages = results.scalars().all()

    has_more = len(messages) > limit
    if has_more:
        messages = messages[:limit]

    return {
        "messages": messages,
        "has_more": has_more,
        "next_cursor": PaginationCursor(
            last_sequence=messages[-1].sequence,
            last_id=messages[-1].id,
            direction=cursor.direction if cursor else "older",
        ) if has_more else None,
    }
```

### 11.5 向量存储集成模式

AI 应用通常需要同时使用关系型数据库（结构化数据）和向量数据库（语义检索）。Open WebUI 的做法是在 9 种向量数据库后端之上抽象出统一接口：

```python
from abc import ABC, abstractmethod
from pydantic import BaseModel


class Document(BaseModel):
    id: str
    content: str
    metadata: dict
    embedding: list[float] | None = None


class VectorStore(ABC):
    """统一向量存储接口——Open WebUI 支持 9 种后端"""

    @abstractmethod
    async def upsert(self, collection: str, documents: list[Document]) -> None:
        ...

    @abstractmethod
    async def search(
        self, collection: str, query_embedding: list[float], top_k: int = 5,
    ) -> list[Document]:
        ...

    @abstractmethod
    async def delete(self, collection: str, doc_ids: list[str]) -> None:
        ...


class ChromaVectorStore(VectorStore):
    """Chroma 后端实现"""
    async def upsert(self, collection: str, documents: list[Document]) -> None:
        col = self.client.get_or_create_collection(collection)
        col.upsert(
            ids=[d.id for d in documents],
            documents=[d.content for d in documents],
            metadatas=[d.metadata for d in documents],
            embeddings=[d.embedding for d in documents if d.embedding],
        )

    async def search(
        self, collection: str, query_embedding: list[float], top_k: int = 5,
    ) -> list[Document]:
        col = self.client.get_collection(collection)
        results = col.query(query_embeddings=[query_embedding], n_results=top_k)
        return [
            Document(id=id_, content=doc, metadata=meta)
            for id_, doc, meta in zip(
                results["ids"][0], results["documents"][0], results["metadatas"][0]
            )
        ]


class PgVectorStore(VectorStore):
    """PostgreSQL + pgvector 后端实现"""
    async def search(
        self, collection: str, query_embedding: list[float], top_k: int = 5,
    ) -> list[Document]:
        # pgvector 使用 SQL 进行向量搜索
        sql = """
            SELECT id, content, metadata,
                   1 - (embedding <=> $1::vector) AS similarity
            FROM documents
            WHERE collection = $2
            ORDER BY embedding <=> $1::vector
            LIMIT $3
        """
        rows = await self.db.fetch(sql, query_embedding, collection, top_k)
        return [Document(id=r["id"], content=r["content"], metadata=r["metadata"]) for r in rows]


# 工厂模式：根据配置选择后端
def create_vector_store(backend: str) -> VectorStore:
    stores = {
        "chroma": ChromaVectorStore,
        "pgvector": PgVectorStore,
        "qdrant": QdrantVectorStore,
        "milvus": MilvusVectorStore,
        "pinecone": PineconeVectorStore,
        "weaviate": WeaviateVectorStore,
    }
    if backend not in stores:
        raise ValueError(f"Unsupported vector store: {backend}")
    return stores[backend]()
```

### 11.6 会话管理与上下文窗口优化

结合关系型数据库和 Redis，实现高效的会话上下文管理：

```python
class HybridSessionManager:
    """混合会话管理——Redis 热存储 + PostgreSQL 冷归档"""

    def __init__(self, redis_client, db_session):
        self.redis = redis_client
        self.db = db_session
        self.max_context_tokens = 8000  # 上下文窗口限制

    async def get_context_messages(
        self, conversation_id: str, max_tokens: int | None = None,
    ) -> list[dict]:
        """获取适合发送给 LLM 的上下文消息——自动截断"""
        max_tokens = max_tokens or self.max_context_tokens

        # 1. 先从 Redis 获取最近消息（热数据）
        cached = await self.redis.lrange(f"conv:{conversation_id}:recent", 0, -1)

        if cached:
            messages = [json.loads(m) for m in cached]
        else:
            # 2. 缓存未命中，从数据库加载
            db_messages = await self.db.execute(
                select(Message)
                .where(Message.conversation_id == conversation_id)
                .where(Message.is_active == 1)
                .order_by(Message.sequence.desc())
                .limit(50)
            )
            messages = [
                {"role": m.role.value, "content": m.content}
                for m in reversed(db_messages.scalars().all())
            ]
            # 回写 Redis
            pipe = self.redis.pipeline()
            for m in messages:
                pipe.rpush(f"conv:{conversation_id}:recent", json.dumps(m))
            pipe.expire(f"conv:{conversation_id}:recent", 3600)
            await pipe.execute()

        # 3. 滑动窗口截断：从最新消息开始，累计 Token 直到达到限制
        truncated = []
        total_tokens = 0
        for msg in reversed(messages):
            msg_tokens = count_tokens(msg["content"])
            if total_tokens + msg_tokens > max_tokens:
                break
            truncated.append(msg)
            total_tokens += msg_tokens

        truncated.reverse()
        return truncated
```

---

## 12. 生产部署与可观测性（进阶）

### 12.1 为什么 AI 服务的部署比传统服务更复杂

前文第 6 节介绍了基础的 K8s 部署和 Circuit Breaker。本节深入探讨 AI 服务特有的部署挑战：长连接的优雅关闭、有状态服务的水平扩展、LLM 调用链的端到端追踪。

类比：部署传统 Web 服务像是管理一个快餐连锁店——每个订单几秒完成，关门时最多等几个订单做完。部署 AI 服务像是管理一个精细餐厅——每道菜需要 10-30 分钟，关门时必须等所有正在烹饪的菜做完，而且每道菜的食材成本都很高，必须精确记录。

### 12.2 AI 服务健康检查设计

传统的 `/health` 返回 200 不够。AI 服务的健康检查需要验证**依赖链路**是否正常：

```python
from fastapi import FastAPI
from pydantic import BaseModel
from datetime import datetime


class HealthStatus(BaseModel):
    status: str                      # healthy / degraded / unhealthy
    timestamp: str
    checks: dict[str, dict]          # 各组件状态


app = FastAPI()


@app.get("/health")
async def health_check() -> HealthStatus:
    """深度健康检查——验证所有关键依赖"""
    checks = {}

    # 1. 数据库连接
    try:
        await db.execute("SELECT 1")
        checks["database"] = {"status": "healthy", "latency_ms": 2}
    except Exception as e:
        checks["database"] = {"status": "unhealthy", "error": str(e)}

    # 2. Redis 连接
    try:
        await redis.ping()
        checks["redis"] = {"status": "healthy"}
    except Exception as e:
        checks["redis"] = {"status": "unhealthy", "error": str(e)}

    # 3. LLM API 可达性（轻量级检查，不发真实请求）
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get("https://api.openai.com/v1/models",
                                     headers={"Authorization": f"Bearer {api_key}"})
            checks["llm_api"] = {
                "status": "healthy" if resp.status_code == 200 else "degraded",
                "latency_ms": resp.elapsed.total_seconds() * 1000,
            }
    except Exception as e:
        checks["llm_api"] = {"status": "unhealthy", "error": str(e)}

    # 4. 向量数据库
    try:
        await vector_store.heartbeat()
        checks["vector_db"] = {"status": "healthy"}
    except Exception as e:
        checks["vector_db"] = {"status": "unhealthy", "error": str(e)}

    # 综合判断
    statuses = [c["status"] for c in checks.values()]
    if all(s == "healthy" for s in statuses):
        overall = "healthy"
    elif any(s == "unhealthy" for s in statuses):
        overall = "unhealthy"
    else:
        overall = "degraded"

    return HealthStatus(
        status=overall,
        timestamp=datetime.utcnow().isoformat(),
        checks=checks,
    )


@app.get("/ready")
async def readiness_check():
    """就绪检查——K8s 用这个决定是否路由流量"""
    # 只检查核心依赖（数据库 + Redis），LLM API 不影响就绪状态
    try:
        await db.execute("SELECT 1")
        await redis.ping()
        return {"ready": True}
    except Exception:
        return Response(status_code=503, content='{"ready": false}')
```

### 12.3 优雅关闭（Graceful Shutdown）

AI 服务的流式请求可能持续 30 秒以上，关闭时必须等待所有 in-flight 请求完成：

```python
import asyncio
import signal
from contextlib import asynccontextmanager

# 活跃请求追踪
active_requests: set[str] = set()
shutting_down = asyncio.Event()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI Lifespan：启动和关闭时的资源管理"""
    # ===== 启动 =====
    await db.connect()
    await redis.connect()
    logger.info("Service started")

    yield  # 运行期间

    # ===== 关闭 =====
    logger.info("Shutting down, waiting for active requests...")
    shutting_down.set()

    # 等待所有活跃请求完成（最多 60 秒）
    for _ in range(600):  # 60 秒超时
        if not active_requests:
            break
        logger.info(f"Waiting for {len(active_requests)} active requests")
        await asyncio.sleep(0.1)

    if active_requests:
        logger.warning(f"Force closing {len(active_requests)} requests")

    await db.disconnect()
    await redis.disconnect()
    logger.info("Service stopped")


app = FastAPI(lifespan=lifespan)


@app.middleware("http")
async def track_requests(request: Request, call_next):
    """追踪活跃请求——优雅关闭时用于等待"""
    if shutting_down.is_set():
        return Response(
            status_code=503,
            content='{"error": "Service is shutting down"}',
            headers={"Retry-After": "5"},
        )

    request_id = str(uuid.uuid4())
    active_requests.add(request_id)
    try:
        response = await call_next(request)
        return response
    finally:
        active_requests.discard(request_id)
```

### 12.4 有状态 AI 服务的水平扩展

AI 服务的扩展挑战在于**流式连接的有状态性**——SSE 连接在完成前必须保持在同一 Pod 上。

```diagram
          有状态 AI 服务扩展策略
┌──────────────────────────────────────────────┐
│                  Load Balancer               │
│        （不使用 sticky session！）              │
└──────┬──────────────┬──────────────┬─────────┘
       │              │              │
  ┌────┴────┐   ┌────┴────┐   ┌────┴────┐
  │  Pod 1  │   │  Pod 2  │   │  Pod 3  │
  │ FastAPI │   │ FastAPI │   │ FastAPI │
  └────┬────┘   └────┬────┘   └────┬────┘
       │              │              │
       └──────────────┼──────────────┘
                      │
              ┌───────┴───────┐
              │     Redis     │  ← 集中式状态存储
              │  (Sessions)   │
              ├───────────────┤
              │  PostgreSQL   │  ← 持久化存储
              │  (Messages)   │
              └───────────────┘
```

关键原则：
- **无状态 Pod**：所有会话状态存储在 Redis，任何 Pod 都能处理任何请求
- **流式连接**：SSE/WebSocket 连接在建立后天然绑定到特定 Pod，但这不影响扩展——连接断开后客户端重连到任意 Pod
- **HPA 策略**：基于 CPU 和内存的自动扩缩容，同时监控活跃连接数

### 12.5 OpenTelemetry 端到端追踪

LLM 调用链的追踪需要覆盖从 API 入口到 LLM Provider 的完整路径：

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

# 初始化 OpenTelemetry
provider = TracerProvider()
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
trace.set_tracer_provider(provider)
tracer = trace.get_tracer("ai-backend")

# 自动为 FastAPI 和 httpx 添加追踪
FastAPIInstrumentor.instrument_app(app)
HTTPXClientInstrumentor().instrument()


@app.post("/v1/chat/completions")
async def chat_completion(request: ChatRequest):
    with tracer.start_as_current_span("chat_completion") as span:
        span.set_attribute("model", request.model)
        span.set_attribute("message_count", len(request.messages))

        # 上下文检索
        with tracer.start_as_current_span("context_retrieval"):
            context = await retrieve_context(request.messages)
            span.set_attribute("context_chunks", len(context))

        # LLM 调用
        with tracer.start_as_current_span("llm_call") as llm_span:
            response = await llm_client.chat(request)
            llm_span.set_attribute("tokens_input", response.usage.prompt_tokens)
            llm_span.set_attribute("tokens_output", response.usage.completion_tokens)
            llm_span.set_attribute("model_used", response.model)
            llm_span.set_attribute("finish_reason", response.choices[0].finish_reason)

        # 持久化
        with tracer.start_as_current_span("persist_response"):
            await save_message(request, response)

        return response
```

追踪产生的 Span 结构：

```diagram
chat_completion (总耗时: 3200ms)
├── context_retrieval (150ms)
│   ├── embedding_generation (50ms)
│   └── vector_search (100ms)
├── llm_call (2800ms)              ← 通常占总时间 80%+
│   └── httpx.request POST https://api.openai.com/...
└── persist_response (250ms)
    ├── redis.rpush (5ms)
    └── postgres.insert (245ms)
```

### 12.6 Langfuse 集成实践

Langfuse 专为 LLM 应用设计，提供比通用 APM 更丰富的 AI 专属指标：

```python
from langfuse import Langfuse
from langfuse.decorators import observe, langfuse_context

langfuse = Langfuse()


@observe()  # 自动创建 Langfuse Trace
async def handle_chat_request(request: ChatRequest, user_id: str):
    # 设置 Trace 元数据
    langfuse_context.update_current_trace(
        user_id=user_id,
        session_id=request.session_id,
        tags=["production", request.model],
    )

    # RAG 检索（自动记录为 Span）
    @observe(name="rag_retrieval")
    async def retrieve():
        docs = await vector_store.search(request.messages[-1]["content"])
        langfuse_context.update_current_observation(
            metadata={"num_docs": len(docs)},
        )
        return docs

    context_docs = await retrieve()

    # LLM 调用（自动记录为 Generation）
    @observe(as_type="generation")
    async def call_llm(messages, model):
        langfuse_context.update_current_observation(
            model=model,
            model_parameters={"temperature": 0.7},
            input=messages,
        )
        response = await llm_client.chat(messages, model=model)
        langfuse_context.update_current_observation(
            output=response.choices[0].message.content,
            usage={
                "input": response.usage.prompt_tokens,
                "output": response.usage.completion_tokens,
                "total": response.usage.total_tokens,
                "unit": "TOKENS",
            },
        )
        return response

    return await call_llm(augmented_messages, request.model)
```

Langfuse 提供的关键看板：

| 指标 | 说明 | 目标值 |
|------|------|--------|
| **TTFT（首 Token 时间）** | 从请求到第一个 Token 返回 | < 500ms |
| **Token/s** | 每秒生成的 Token 数 | > 30 tok/s |
| **成本/请求** | 每次 LLM 调用的美元成本 | 按模型追踪 |
| **错误率** | LLM 调用失败比例 | < 1% |
| **用户反馈** | 点赞/点踩比例 | > 80% 正面 |
| **延迟 P95** | 95 分位延迟 | < 5s |

### 12.7 成本看板与告警

```python
from datetime import datetime, timedelta


class CostDashboard:
    """成本看板——实时监控 LLM 支出"""

    async def get_daily_report(self, org_id: str) -> dict:
        today = datetime.utcnow().date()
        return {
            "date": str(today),
            "total_cost": await self.get_cost(org_id, today),
            "by_model": await self.get_cost_by_model(org_id, today),
            "by_team": await self.get_cost_by_team(org_id, today),
            "token_usage": {
                "input_tokens": await self.get_tokens(org_id, today, "input"),
                "output_tokens": await self.get_tokens(org_id, today, "output"),
            },
            "request_count": await self.get_request_count(org_id, today),
        }

    async def check_alerts(self, org_id: str) -> list[dict]:
        """检查成本告警"""
        alerts = []
        today_cost = await self.get_cost(org_id, datetime.utcnow().date())
        monthly_cost = await self.get_monthly_cost(org_id)
        budget = await self.get_budget(org_id)

        # 日支出异常：超过月预算的 1/20（按 20 工作日计算）
        daily_threshold = budget.monthly / 20
        if today_cost > daily_threshold:
            alerts.append({
                "level": "warning",
                "message": f"Daily spend ${today_cost:.2f} exceeds threshold ${daily_threshold:.2f}",
            })

        # 月预算使用率
        usage_pct = monthly_cost / budget.monthly * 100
        if usage_pct > 80:
            alerts.append({
                "level": "critical" if usage_pct > 95 else "warning",
                "message": f"Monthly budget {usage_pct:.1f}% used (${monthly_cost:.2f}/${budget.monthly:.2f})",
            })

        return alerts
```

---

## 13. 常见陷阱与最佳实践

以下总结 AI 后端开发中最常见的 8 个陷阱，每个都附有错误做法和正确做法的对比：

### ❌ 陷阱 1：同步阻塞调用 LLM

```python
# ❌ 同步调用：一个请求阻塞一个线程，10 个线程只能服务 10 个并发用户
import requests

@app.post("/chat")
def chat_sync(request: ChatRequest):
    response = requests.post(
        "https://api.openai.com/v1/chat/completions",
        json={"model": "gpt-4o", "messages": request.messages},
    )
    return response.json()
```

```python
# ✅ 全链路 async/await：一个进程可以同时处理数百个 LLM 请求
import httpx

@app.post("/chat")
async def chat_async(request: ChatRequest):
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            "https://api.openai.com/v1/chat/completions",
            json={"model": "gpt-4o", "messages": request.messages},
        )
    return response.json()
```

**关键点**：AI 后端是典型的 I/O 密集场景——CPU 几乎不做计算，大部分时间在等 LLM 返回。异步模式下，等待期间可以服务其他请求，吞吐量提升 10-100 倍。

---

### ❌ 陷阱 2：无限制接受请求

```python
# ❌ 无任何限制：一个恶意用户可以无限发送请求，耗尽所有 LLM 额度
@app.post("/chat")
async def chat(request: ChatRequest):
    return await llm_client.chat(request.messages)
```

```python
# ✅ Token 级别速率限制 + 预算上限
@app.post("/chat")
async def chat(request: ChatRequest, user: User = Depends(verify_api_key)):
    # 1. 检查 RPM（每分钟请求数）
    if await is_rate_limited(user.id, limit=user.rpm_limit):
        raise HTTPException(429, "Rate limit exceeded")

    # 2. 检查 TPM（每分钟 Token 数）
    estimated_tokens = count_tokens(str(request.messages))
    if await would_exceed_tpm(user.id, estimated_tokens, limit=user.tpm_limit):
        raise HTTPException(429, "Token rate limit exceeded")

    # 3. 检查预算上限
    if await get_user_spend(user.id) >= user.max_budget:
        raise HTTPException(403, "Budget exceeded")

    return await llm_client.chat(request.messages)
```

**关键点**：LLM 调用不仅消耗计算资源，更消耗真金白银。必须在请求、Token、预算三个维度做限制。

---

### ❌ 陷阱 3：把 API Key 硬编码

```python
# ❌ Key 写在代码里：泄露到 Git 历史后无法撤回
OPENAI_API_KEY = "sk-proj-abc123..."
```

```python
# ✅ Virtual Keys + 环境变量 + 密钥轮换
import os

# 1. 从环境变量读取（通过 K8s Secret 或 Vault 注入）
OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]

# 2. 用 Virtual Keys 分发给用户（不暴露原始 Key）
user_key = await key_manager.create_key(
    user_id="user-123",
    allowed_models=["gpt-4o-mini"],  # 限制可用模型
    max_budget=10.0,                  # 限制预算
    expires_in=timedelta(days=30),    # 30 天过期
)

# 3. 定期轮换原始 Key
await key_manager.rotate_key("old-key-id")
```

**关键点**：永远不要在代码中硬编码 API Key。使用 Virtual Keys 层隔离用户与原始 Key，并定期轮换。

---

### ❌ 陷阱 4：流式响应不处理中途错误

```python
# ❌ 流式生成中途异常直接崩溃，客户端只看到连接断开
async def stream_bad():
    async for token in llm_stream():
        yield f"data: {token}\n\n"
    # 如果 llm_stream 中途抛异常？客户端看到连接突然断开，毫无信息
```

```python
# ✅ SSE error event + 客户端重连
async def stream_good():
    try:
        async for token in llm_stream():
            yield f"data: {json.dumps({'choices': [{'delta': {'content': token}}]})}\n\n"
        yield "data: [DONE]\n\n"
    except Exception as e:
        # 通过 SSE event 通知客户端具体错误
        yield f"event: error\ndata: {json.dumps({'error': {'message': str(e)}})}\n\n"
        yield "data: [DONE]\n\n"
```

**关键点**：HTTP 状态码在流式响应开始后就锁定了（200）。中途错误必须通过 SSE event 机制通知客户端，而不是依赖连接断开。

---

### ❌ 陷阱 5：所有模型走同一个接口

```python
# ❌ 直接调用各家 SDK，每换一个模型要改代码
if model == "gpt-4o":
    response = openai.chat.completions.create(...)
elif model == "claude-3-5-sonnet":
    response = anthropic.messages.create(...)  # 完全不同的 API 格式
elif model == "gemini-1.5-pro":
    response = genai.generate_content(...)     # 又一套 API
```

```python
# ✅ 统一网关 + 模型路由策略
from litellm import Router

router = Router(model_list=[
    {"model_name": "default", "litellm_params": {"model": "gpt-4o"}},
    {"model_name": "default", "litellm_params": {"model": "claude-3-5-sonnet"}},
], routing_strategy="latency-based-routing")

# 一行代码切换模型，无需修改业务逻辑
response = await router.acompletion(model="default", messages=messages)
```

**关键点**：使用 LiteLLM 等统一网关将模型差异封装在基础设施层，业务代码不感知 Provider 差异。

---

### ❌ 陷阱 6：日志只记录 HTTP 状态码

```python
# ❌ 传统 Web 日志：只有 HTTP 层面信息
logger.info(f"POST /chat 200 OK 3200ms")
# 完全看不到：用了多少 Token？花了多少钱？模型返回质量如何？
```

```python
# ✅ OpenTelemetry traces + token 计数 + 成本追踪
logger.info(
    "llm_request_completed",
    extra={
        "request_id": request_id,
        "model": "gpt-4o",
        "tokens_input": 1500,
        "tokens_output": 800,
        "cost_usd": 0.035,
        "ttft_ms": 450,         # 首 Token 时间
        "total_ms": 3200,
        "finish_reason": "stop",
        "user_id": user_id,
        "cache_hit": False,
    },
)
```

**关键点**：AI 应用的日志必须包含 Token 用量、成本、模型信息、延迟指标。传统 HTTP 状态码远远不够。

---

### ❌ 陷阱 7：忽略 backpressure

```python
# ❌ 生产者不关心消费者速度，内存无限增长
async def stream_no_backpressure():
    buffer = []
    async for token in llm_stream():  # LLM 以 50 tok/s 生成
        buffer.append(token)          # 客户端只能消费 5 tok/s
        # buffer 持续膨胀，最终 OOM
```

```python
# ✅ 队列 + 背压感知的流式传输
async def stream_with_backpressure():
    queue = asyncio.Queue(maxsize=100)  # 有界队列

    async def producer():
        async for token in llm_stream():
            await queue.put(token)  # 队列满时自动阻塞（背压）
        await queue.put(None)  # 结束信号

    asyncio.create_task(producer())

    while True:
        token = await queue.get()
        if token is None:
            break
        yield f"data: {json.dumps({'choices': [{'delta': {'content': token}}]})}\n\n"
```

**关键点**：使用有界队列在生产者（LLM）和消费者（客户端）之间建立背压机制。当客户端消费慢时，自动减缓 LLM 输出的缓冲速率。

---

### ❌ 陷阱 8：单点部署

```python
# ❌ 单实例部署，无健康检查，更新时服务中断
# docker run -d my-ai-app  # 挂了就挂了
```

```yaml
# ✅ 多副本 + 健康检查 + 优雅关闭
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ai-backend
spec:
  replicas: 3                     # 至少 3 副本
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1           # 滚动更新：最多 1 个不可用
      maxSurge: 1
  template:
    spec:
      containers:
      - name: ai-backend
        livenessProbe:
          httpGet:
            path: /health
            port: 8000
          periodSeconds: 15
        readinessProbe:
          httpGet:
            path: /ready
            port: 8000
          periodSeconds: 10
        lifecycle:
          preStop:
            exec:
              command: ["/bin/sh", "-c", "sleep 30"]  # 等待 in-flight 请求
      terminationGracePeriodSeconds: 60
```

**关键点**：AI 服务的长连接特性要求更长的优雅关闭时间（30-60 秒）。使用多副本 + 滚动更新确保零停机部署。

---

## 总结

AI 应用后端的核心挑战在于将异步、长耗时、高成本的 LLM 调用封装为稳定、可观测、可扩展的 API 服务。关键设计决策：

1. **框架选型**：FastAPI 凭借 async-native、自动文档、Pydantic 验证、依赖注入成为 AI 后端事实标准
2. **流式优先**：SSE 是 AI Chat 场景的最佳选择，需要完善的错误处理和背压机制
3. **网关统一**：LiteLLM 解耦业务逻辑与 Provider 选择，便于降本切换
4. **认证分层**：Virtual Keys + RBAC + 多租户隔离，从身份、权限、资源三个维度保护 AI 服务
5. **中间件链**：七层中间件架构（认证 → 限流 → 校验 → 追踪 → 成本 → 缓存 → 容错）
6. **上下文管理**：Redis 热存储 + PostgreSQL 冷归档，树形结构支持分支对话
7. **全链路追踪**：OpenTelemetry + Langfuse 定位质量与性能问题
8. **多层防护**：Circuit Breaker + Fallback + Budget 三重保障系统稳定性
9. **生产就绪**：深度健康检查 + 优雅关闭 + 多副本水平扩展
