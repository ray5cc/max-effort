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

```
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

```
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

```
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

```
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

## 总结

AI 应用后端的核心挑战在于将异步、长耗时、高成本的 LLM 调用封装为稳定、可观测、可扩展的 API 服务。关键设计决策：

1. **流式优先**：SSE 是 AI Chat 场景的最佳选择，显著提升用户体验
2. **网关统一**：LiteLLM 解耦业务逻辑与 Provider 选择，便于降本切换
3. **上下文管理**：Redis 热存储 + PostgreSQL 冷归档，滑动窗口控制成本
4. **全链路追踪**：Langfuse Trace/Span/Generation 定位质量与性能问题
5. **多层防护**：Circuit Breaker + Fallback + Budget 三重保障系统稳定性
