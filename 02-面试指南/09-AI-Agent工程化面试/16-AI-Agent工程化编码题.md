# AI-Agent 工程化编码题

> 涵盖 LLM 推理服务、AI 网关、Agent 编排、流式传输、RAG 管线、MCP 工具开发、微调数据处理等 AI Agent 工程化核心编程题，配有完整实现和解题思路。

## 相关链接

- 对应技术资料：[09-AI-Agent工程化](../../01-技术资料/09-AI-Agent工程化/)

## 目录

1. [⭐ 基础题](#⭐-基础题)
2. [⭐⭐ 进阶题](#⭐⭐-进阶题)
3. [⭐⭐⭐ 高级题](#⭐⭐⭐-高级题)
4. [🎯 场景题](#🎯-场景题)

---

## ⭐ 基础题

### 1. 实现 Token 计数器与成本估算

**题目：** 实现一个函数，对给定的文本估算 Token 数量和 API 调用成本。

**思路：**
- 使用 tiktoken 做精确 Token 计数
- 根据不同模型计费标准计算成本
- 区分 prompt_tokens 和 completion_tokens

**实现（Python）：**

```python
import tiktoken
from dataclasses import dataclass
from typing import Optional

# 模型计费表 ($/1M tokens)
MODEL_PRICING = {
    "gpt-4o": {"input": 2.50, "output": 10.00},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "claude-3.5-sonnet": {"input": 3.00, "output": 15.00},
    "llama-3.1-8b": {"input": 0.05, "output": 0.08},  # 自托管估算
    "llama-3.1-70b": {"input": 0.35, "output": 0.40},
}

@dataclass
class UsageEstimate:
    prompt_tokens: int
    estimated_completion_tokens: int
    total_tokens: int
    estimated_cost_usd: float
    model: str

def count_tokens(text: str, model: str = "gpt-4o") -> int:
    """精确计算 Token 数量"""
    try:
        encoding = tiktoken.encoding_for_model(model)
    except KeyError:
        encoding = tiktoken.get_encoding("cl100k_base")
    return len(encoding.encode(text))

def estimate_cost(
    prompt: str,
    model: str = "gpt-4o",
    max_completion_tokens: int = 1000,
    system_prompt: Optional[str] = None
) -> UsageEstimate:
    """估算单次 API 调用成本"""
    prompt_tokens = count_tokens(prompt, model)
    if system_prompt:
        prompt_tokens += count_tokens(system_prompt, model)
    
    pricing = MODEL_PRICING.get(model, MODEL_PRICING["gpt-4o"])
    cost = (
        prompt_tokens * pricing["input"] / 1_000_000 +
        max_completion_tokens * pricing["output"] / 1_000_000
    )
    
    return UsageEstimate(
        prompt_tokens=prompt_tokens,
        estimated_completion_tokens=max_completion_tokens,
        total_tokens=prompt_tokens + max_completion_tokens,
        estimated_cost_usd=round(cost, 6),
        model=model
    )

# 测试
est = estimate_cost("请解释什么是 PagedAttention", model="gpt-4o", max_completion_tokens=500)
print(f"Prompt Tokens: {est.prompt_tokens}")
print(f"估算成本: ${est.estimated_cost_usd:.4f}")
```

---

### 2. 实现 SSE 流式解析器

**题目：** 实现一个 Server-Sent Events 客户端解析器，能正确处理 OpenAI 格式的流式响应。

**思路：**
- 维护缓冲区处理不完整的行
- 解析 `data: ` 前缀
- 处理 `[DONE]` 终止信号
- 提取 delta content

**实现（Python）：**

```python
import json
import httpx
from typing import AsyncGenerator, Optional
from dataclasses import dataclass

@dataclass
class StreamChunk:
    content: str
    finish_reason: Optional[str] = None
    usage: Optional[dict] = None

async def stream_chat_completion(
    messages: list[dict],
    model: str = "gpt-4o",
    api_key: str = "",
    base_url: str = "https://api.openai.com/v1"
) -> AsyncGenerator[StreamChunk, None]:
    """流式调用 LLM API 并解析 SSE 响应"""
    
    async with httpx.AsyncClient(timeout=120) as client:
        async with client.stream(
            "POST",
            f"{base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            },
            json={
                "model": model,
                "messages": messages,
                "stream": True,
                "stream_options": {"include_usage": True}
            }
        ) as response:
            response.raise_for_status()
            buffer = ""
            
            async for raw_chunk in response.aiter_text():
                buffer += raw_chunk
                
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    line = line.strip()
                    
                    if not line:
                        continue
                    if line == "data: [DONE]":
                        return
                    if not line.startswith("data: "):
                        continue
                    
                    try:
                        data = json.loads(line[6:])  # 去掉 "data: "
                        choice = data.get("choices", [{}])[0]
                        delta = choice.get("delta", {})
                        content = delta.get("content", "")
                        finish_reason = choice.get("finish_reason")
                        usage = data.get("usage")
                        
                        if content or finish_reason or usage:
                            yield StreamChunk(
                                content=content or "",
                                finish_reason=finish_reason,
                                usage=usage
                            )
                    except json.JSONDecodeError:
                        continue

# 使用示例
async def main():
    full_response = ""
    async for chunk in stream_chat_completion(
        messages=[{"role": "user", "content": "Hello"}],
        api_key="sk-xxx"
    ):
        if chunk.content:
            print(chunk.content, end="", flush=True)
            full_response += chunk.content
        if chunk.usage:
            print(f"\n[Usage: {chunk.usage}]")
```

---

### 3. 实现 Exponential Backoff 重试机制

**题目：** 实现一个带指数退避和抖动的 LLM API 调用重试器。

**实现（Python）：**

```python
import asyncio
import random
import time
from functools import wraps
from typing import Type

class RetryableError(Exception):
    """可重试的错误"""
    pass

class RateLimitError(RetryableError):
    retry_after: float = 1.0

class ServerError(RetryableError):
    pass

def retry_with_backoff(
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 60.0,
    exponential_base: float = 2.0,
    jitter: bool = True,
    retryable_exceptions: tuple[Type[Exception], ...] = (RetryableError,)
):
    """装饰器：带指数退避和抖动的重试"""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            last_exception = None
            
            for attempt in range(max_retries + 1):
                try:
                    return await func(*args, **kwargs)
                except retryable_exceptions as e:
                    last_exception = e
                    
                    if attempt == max_retries:
                        break
                    
                    # 计算延迟
                    delay = min(
                        base_delay * (exponential_base ** attempt),
                        max_delay
                    )
                    
                    # 如果是限流错误，使用服务端建议的等待时间
                    if hasattr(e, 'retry_after') and e.retry_after:
                        delay = max(delay, e.retry_after)
                    
                    # 添加抖动（防止多个客户端同时重试 — 惊群效应）
                    if jitter:
                        delay = delay * (0.5 + random.random())
                    
                    print(f"[Retry {attempt+1}/{max_retries}] "
                          f"Error: {e}. Waiting {delay:.1f}s...")
                    await asyncio.sleep(delay)
            
            raise last_exception
        return wrapper
    return decorator

# 使用示例
@retry_with_backoff(max_retries=3, base_delay=1.0)
async def call_llm(prompt: str) -> str:
    """带自动重试的 LLM 调用"""
    response = await httpx.AsyncClient().post(
        "https://api.openai.com/v1/chat/completions",
        json={"model": "gpt-4o", "messages": [{"role": "user", "content": prompt}]}
    )
    if response.status_code == 429:
        retry_after = float(response.headers.get("retry-after", 1))
        error = RateLimitError("Rate limited")
        error.retry_after = retry_after
        raise error
    if response.status_code >= 500:
        raise ServerError(f"Server error: {response.status_code}")
    return response.json()["choices"][0]["message"]["content"]
```

---

## ⭐⭐ 进阶题

### 4. 实现 KV Cache 模拟器

**题目：** 实现一个简化的 KV Cache 管理器，模拟 PagedAttention 的核心逻辑：按 Block 分配显存、维护 Block Table、支持 Prefix Sharing。

**实现（Python）：**

```python
from dataclasses import dataclass, field
from typing import Optional
import numpy as np

BLOCK_SIZE = 16  # 每个 Block 存储 16 个 token 的 KV

@dataclass
class Block:
    block_id: int
    tokens: list[int] = field(default_factory=list)
    ref_count: int = 1  # 引用计数（用于 Copy-on-Write）
    
    @property
    def is_full(self) -> bool:
        return len(self.tokens) >= BLOCK_SIZE
    
    @property
    def num_tokens(self) -> int:
        return len(self.tokens)

class PagedKVCacheManager:
    """模拟 PagedAttention 的 Block 管理器"""
    
    def __init__(self, total_blocks: int = 1000):
        self.total_blocks = total_blocks
        self.free_blocks: list[int] = list(range(total_blocks))
        self.used_blocks: dict[int, Block] = {}
        self.sequence_block_tables: dict[int, list[int]] = {}  # seq_id → [block_ids]
    
    def allocate_block(self) -> Optional[Block]:
        """分配一个空闲 Block"""
        if not self.free_blocks:
            return None  # OOM
        block_id = self.free_blocks.pop(0)
        block = Block(block_id=block_id)
        self.used_blocks[block_id] = block
        return block
    
    def free_block(self, block_id: int):
        """释放一个 Block"""
        block = self.used_blocks.pop(block_id, None)
        if block:
            block.ref_count -= 1
            if block.ref_count <= 0:
                self.free_blocks.append(block_id)
    
    def add_sequence(self, seq_id: int, token_ids: list[int]):
        """为一个序列分配 KV Cache 空间"""
        block_table = []
        current_block = None
        
        for token_id in token_ids:
            if current_block is None or current_block.is_full:
                current_block = self.allocate_block()
                if current_block is None:
                    raise MemoryError("KV Cache OOM: no free blocks")
                block_table.append(current_block.block_id)
            current_block.tokens.append(token_id)
        
        self.sequence_block_tables[seq_id] = block_table
    
    def append_token(self, seq_id: int, token_id: int):
        """自回归生成：追加一个新 token"""
        block_table = self.sequence_block_tables[seq_id]
        last_block = self.used_blocks[block_table[-1]]
        
        if last_block.is_full:
            new_block = self.allocate_block()
            if new_block is None:
                raise MemoryError("KV Cache OOM")
            block_table.append(new_block.block_id)
            last_block = new_block
        
        # Copy-on-Write: 如果 block 被多个序列共享
        if last_block.ref_count > 1:
            last_block.ref_count -= 1
            new_block = self.allocate_block()
            if new_block is None:
                raise MemoryError("KV Cache OOM")
            new_block.tokens = last_block.tokens.copy()
            block_table[-1] = new_block.block_id
            last_block = new_block
        
        last_block.tokens.append(token_id)
    
    def free_sequence(self, seq_id: int):
        """释放一个序列的所有 Block"""
        block_table = self.sequence_block_tables.pop(seq_id, [])
        for block_id in block_table:
            self.free_block(block_id)
    
    def fork_sequence(self, src_seq_id: int, dst_seq_id: int):
        """Fork（用于 beam search / parallel sampling）：共享 Block，Copy-on-Write"""
        src_table = self.sequence_block_tables[src_seq_id]
        dst_table = src_table.copy()
        
        for block_id in dst_table:
            self.used_blocks[block_id].ref_count += 1
        
        self.sequence_block_tables[dst_seq_id] = dst_table
    
    @property
    def utilization(self) -> float:
        """显存利用率"""
        used = self.total_blocks - len(self.free_blocks)
        return used / self.total_blocks
    
    def stats(self) -> dict:
        return {
            "total_blocks": self.total_blocks,
            "used_blocks": self.total_blocks - len(self.free_blocks),
            "free_blocks": len(self.free_blocks),
            "utilization": f"{self.utilization:.1%}",
            "active_sequences": len(self.sequence_block_tables),
        }

# 测试
manager = PagedKVCacheManager(total_blocks=100)

# 模拟处理请求
manager.add_sequence(seq_id=1, token_ids=list(range(50)))  # 50 tokens = 4 blocks
manager.add_sequence(seq_id=2, token_ids=list(range(30)))  # 30 tokens = 2 blocks

# 自回归生成
for i in range(20):
    manager.append_token(seq_id=1, token_id=50 + i)

# Fork（beam search）
manager.fork_sequence(src_seq_id=1, dst_seq_id=3)

print(manager.stats())
# {'total_blocks': 100, 'used_blocks': 10, 'free_blocks': 90, 
#  'utilization': '10.0%', 'active_sequences': 3}

# 释放完成的请求
manager.free_sequence(seq_id=1)
print(manager.stats())
```

---

### 5. 实现 Semantic Cache

**题目：** 实现一个基于语义相似度的 LLM 响应缓存，当新查询与缓存查询语义相似时直接返回缓存结果。

**实现（Python）：**

```python
import numpy as np
import hashlib
import json
import time
from typing import Optional
from dataclasses import dataclass

@dataclass
class CacheEntry:
    query: str
    response: str
    embedding: np.ndarray
    created_at: float
    hit_count: int = 0
    model: str = ""

class SemanticCache:
    """基于语义相似度的 LLM 缓存"""
    
    def __init__(
        self,
        similarity_threshold: float = 0.92,
        max_entries: int = 10000,
        ttl_seconds: float = 3600,
    ):
        self.threshold = similarity_threshold
        self.max_entries = max_entries
        self.ttl = ttl_seconds
        self.entries: list[CacheEntry] = []
        self._embedding_matrix: Optional[np.ndarray] = None
        self._dirty = True
    
    def _cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        """计算余弦相似度"""
        return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-8))
    
    def _batch_cosine_similarity(self, query_emb: np.ndarray) -> np.ndarray:
        """批量计算相似度（向量化加速）"""
        if self._dirty or self._embedding_matrix is None:
            self._embedding_matrix = np.array([e.embedding for e in self.entries])
            self._dirty = False
        
        norms = np.linalg.norm(self._embedding_matrix, axis=1)
        query_norm = np.linalg.norm(query_emb)
        similarities = self._embedding_matrix @ query_emb / (norms * query_norm + 1e-8)
        return similarities
    
    def get(self, query: str, query_embedding: np.ndarray) -> Optional[str]:
        """查找语义相似的缓存"""
        self._evict_expired()
        
        if not self.entries:
            return None
        
        similarities = self._batch_cosine_similarity(query_embedding)
        max_idx = np.argmax(similarities)
        max_sim = similarities[max_idx]
        
        if max_sim >= self.threshold:
            entry = self.entries[max_idx]
            entry.hit_count += 1
            return entry.response
        
        return None
    
    def put(self, query: str, response: str, query_embedding: np.ndarray, model: str = ""):
        """存入缓存"""
        if len(self.entries) >= self.max_entries:
            self._evict_lru()
        
        self.entries.append(CacheEntry(
            query=query,
            response=response,
            embedding=query_embedding,
            created_at=time.time(),
            model=model
        ))
        self._dirty = True
    
    def _evict_expired(self):
        """清除过期条目"""
        now = time.time()
        before = len(self.entries)
        self.entries = [e for e in self.entries if now - e.created_at < self.ttl]
        if len(self.entries) != before:
            self._dirty = True
    
    def _evict_lru(self):
        """清除最少使用的条目"""
        self.entries.sort(key=lambda e: (e.hit_count, e.created_at))
        removed = len(self.entries) // 10  # 移除 10%
        self.entries = self.entries[removed:]
        self._dirty = True
    
    @property
    def stats(self) -> dict:
        return {
            "entries": len(self.entries),
            "max_entries": self.max_entries,
            "threshold": self.threshold,
        }

# 使用示例
cache = SemanticCache(similarity_threshold=0.92)

# 模拟 embedding（实际用 embedding API）
def mock_embed(text: str) -> np.ndarray:
    np.random.seed(hash(text) % 2**32)
    return np.random.randn(1536).astype(np.float32)

# 缓存查询
query1 = "什么是 KV Cache？"
emb1 = mock_embed(query1)
cache.put(query1, "KV Cache 是...", emb1, model="gpt-4o")

# 相似查询命中缓存
query2 = "解释一下 KV Cache 是什么"
emb2 = mock_embed(query2)
result = cache.get(query2, emb2)
print(f"Cache hit: {result is not None}")  # True if embeddings are similar enough
```

---

### 6. 实现简易 ReAct Agent

**题目：** 实现一个基础的 ReAct（Reasoning + Acting）Agent 循环，支持工具调用和多步推理。

**实现（Python）：**

```python
import json
import re
from typing import Callable, Any
from dataclasses import dataclass

@dataclass
class ToolResult:
    output: str
    success: bool

class ReActAgent:
    """简易 ReAct Agent 实现"""
    
    def __init__(
        self,
        llm_call: Callable,  # async (messages) -> str
        tools: dict[str, Callable],
        tool_descriptions: list[dict],
        max_steps: int = 10,
        max_tokens: int = 100000,
    ):
        self.llm = llm_call
        self.tools = tools
        self.tool_descriptions = tool_descriptions
        self.max_steps = max_steps
        self.max_tokens = max_tokens
    
    def _build_system_prompt(self) -> str:
        tools_desc = json.dumps(self.tool_descriptions, indent=2, ensure_ascii=False)
        return f"""你是一个能使用工具的AI助手。每一步你可以:
1. 思考(Thought): 分析当前情况，决定下一步行动
2. 行动(Action): 调用工具，格式为 Action: tool_name(arg1, arg2)
3. 观察(Observation): 接收工具返回结果
4. 最终回答: 用 Final Answer: xxx 给出最终答案

可用工具:
{tools_desc}

重要: 每次只执行一个Action，等待Observation后再继续。"""

    async def run(self, user_query: str) -> str:
        messages = [
            {"role": "system", "content": self._build_system_prompt()},
            {"role": "user", "content": user_query}
        ]
        
        total_tokens = 0
        
        for step in range(self.max_steps):
            # 调用 LLM
            response = await self.llm(messages)
            total_tokens += len(response) // 4  # 粗略估算
            
            if total_tokens > self.max_tokens:
                return "[Token budget exceeded]"
            
            messages.append({"role": "assistant", "content": response})
            
            # 检查是否有最终答案
            if "Final Answer:" in response:
                return response.split("Final Answer:")[-1].strip()
            
            # 解析工具调用
            action_match = re.search(r'Action:\s*(\w+)\((.*?)\)', response, re.DOTALL)
            if action_match:
                tool_name = action_match.group(1)
                tool_args_str = action_match.group(2)
                
                # 执行工具
                result = await self._execute_tool(tool_name, tool_args_str)
                
                observation = f"Observation: {result.output}"
                messages.append({"role": "user", "content": observation})
            else:
                # 没有工具调用也没有最终答案，提示模型
                messages.append({
                    "role": "user", 
                    "content": "请继续分析，使用工具或给出 Final Answer。"
                })
        
        return "[Max steps exceeded]"
    
    async def _execute_tool(self, name: str, args_str: str) -> ToolResult:
        if name not in self.tools:
            return ToolResult(output=f"Error: Unknown tool '{name}'", success=False)
        
        try:
            # 简单参数解析
            args = [a.strip().strip("'\"") for a in args_str.split(",") if a.strip()]
            result = await self.tools[name](*args)
            return ToolResult(output=str(result), success=True)
        except Exception as e:
            return ToolResult(output=f"Error: {type(e).__name__}: {e}", success=False)

# 工具定义示例
async def search_web(query: str) -> str:
    return f"搜索结果: 关于'{query}'的前3条结果..."

async def calculate(expression: str) -> str:
    try:
        result = eval(expression, {"__builtins__": {}}, {})
        return str(result)
    except Exception as e:
        return f"计算错误: {e}"

# 使用
agent = ReActAgent(
    llm_call=mock_llm,
    tools={"search": search_web, "calc": calculate},
    tool_descriptions=[
        {"name": "search", "description": "搜索网络", "parameters": {"query": "str"}},
        {"name": "calc", "description": "数学计算", "parameters": {"expression": "str"}},
    ]
)
```

---

## ⭐⭐⭐ 高级题

### 7. 实现 Continuous Batching 调度器

**题目：** 实现一个简化的 Continuous Batching 调度器，支持请求的动态加入和退出。

**实现（Python）：**

```python
import asyncio
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional
from collections import deque

class RequestState(Enum):
    WAITING = "waiting"       # 在等待队列中
    PREFILL = "prefill"       # 正在做 Prefill（首次前向传播）
    DECODING = "decoding"     # 正在逐 token 生成
    FINISHED = "finished"     # 生成完成

@dataclass
class InferenceRequest:
    request_id: str
    prompt_tokens: list[int]
    max_new_tokens: int = 256
    state: RequestState = RequestState.WAITING
    generated_tokens: list[int] = field(default_factory=list)
    arrival_time: float = field(default_factory=time.time)
    first_token_time: Optional[float] = None
    finish_time: Optional[float] = None

    @property
    def is_finished(self) -> bool:
        return (len(self.generated_tokens) >= self.max_new_tokens or 
                self.state == RequestState.FINISHED)
    
    @property
    def ttft(self) -> Optional[float]:
        """Time to First Token"""
        if self.first_token_time:
            return self.first_token_time - self.arrival_time
        return None

class ContinuousBatchScheduler:
    """Continuous Batching 调度器"""
    
    def __init__(self, max_batch_size: int = 32, max_total_tokens: int = 8192):
        self.max_batch_size = max_batch_size
        self.max_total_tokens = max_total_tokens
        self.waiting_queue: deque[InferenceRequest] = deque()
        self.running_batch: list[InferenceRequest] = []
        self.finished_requests: list[InferenceRequest] = []
    
    def add_request(self, request: InferenceRequest):
        """新请求加入等待队列"""
        self.waiting_queue.append(request)
    
    def _can_add_to_batch(self, request: InferenceRequest) -> bool:
        """检查是否可以加入当前批次"""
        if len(self.running_batch) >= self.max_batch_size:
            return False
        
        # 检查总 Token 数是否超限（所有运行请求的 KV Cache 总量）
        current_tokens = sum(
            len(r.prompt_tokens) + len(r.generated_tokens) 
            for r in self.running_batch
        )
        new_tokens = len(request.prompt_tokens)
        return current_tokens + new_tokens <= self.max_total_tokens
    
    def schedule_step(self) -> list[InferenceRequest]:
        """
        每个推理步骤的调度决策:
        1. 移除已完成的请求（释放 KV Cache 空间）
        2. 从等待队列中加入新请求
        3. 返回当前批次
        """
        # Step 1: 移除已完成的请求
        still_running = []
        for req in self.running_batch:
            if req.is_finished:
                req.state = RequestState.FINISHED
                req.finish_time = time.time()
                self.finished_requests.append(req)
            else:
                still_running.append(req)
        self.running_batch = still_running
        
        # Step 2: 尝试加入新请求（Continuous Batching 的核心！）
        while self.waiting_queue:
            next_req = self.waiting_queue[0]
            if self._can_add_to_batch(next_req):
                next_req = self.waiting_queue.popleft()
                next_req.state = RequestState.PREFILL
                self.running_batch.append(next_req)
            else:
                break  # 批次已满
        
        return self.running_batch
    
    def simulate_decode_step(self):
        """模拟一步解码（实际由 GPU 执行）"""
        for req in self.running_batch:
            if req.state == RequestState.PREFILL:
                req.state = RequestState.DECODING
                req.first_token_time = time.time()
            
            # 模拟生成一个 token
            new_token = len(req.generated_tokens) + 1000  # 假设的 token id
            req.generated_tokens.append(new_token)
            
            # 检查 EOS 或达到最大长度
            if len(req.generated_tokens) >= req.max_new_tokens:
                req.state = RequestState.FINISHED
    
    def stats(self) -> dict:
        return {
            "waiting": len(self.waiting_queue),
            "running": len(self.running_batch),
            "finished": len(self.finished_requests),
            "avg_ttft": (
                sum(r.ttft for r in self.finished_requests if r.ttft) / 
                max(len(self.finished_requests), 1)
            ),
        }

# 模拟运行
scheduler = ContinuousBatchScheduler(max_batch_size=4, max_total_tokens=4096)

# 模拟请求到达
for i in range(10):
    scheduler.add_request(InferenceRequest(
        request_id=f"req-{i}",
        prompt_tokens=list(range(100)),  # 100 tokens prompt
        max_new_tokens=50
    ))

# 模拟推理循环
for step in range(200):
    batch = scheduler.schedule_step()
    if not batch and not scheduler.waiting_queue:
        break
    scheduler.simulate_decode_step()

print(scheduler.stats())
```

---

### 8. 实现 MCP Server（工具提供方）

**题目：** 使用 MCP 协议标准，实现一个提供数据库查询能力的 MCP Server。

**实现（Python）：**

```python
import json
import sys
import asyncio
from typing import Any

class MCPServer:
    """简易 MCP Server 实现（stdio 传输）"""
    
    def __init__(self, name: str, version: str = "1.0.0"):
        self.name = name
        self.version = version
        self.tools: dict[str, dict] = {}
        self.tool_handlers: dict[str, Any] = {}
        self.resources: dict[str, dict] = {}
    
    def tool(self, name: str, description: str, input_schema: dict):
        """注册工具的装饰器"""
        def decorator(func):
            self.tools[name] = {
                "name": name,
                "description": description,
                "inputSchema": input_schema
            }
            self.tool_handlers[name] = func
            return func
        return decorator
    
    async def handle_request(self, request: dict) -> dict:
        """处理 JSON-RPC 2.0 请求"""
        method = request.get("method", "")
        req_id = request.get("id")
        params = request.get("params", {})
        
        try:
            if method == "initialize":
                result = {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": self.name, "version": self.version}
                }
            elif method == "tools/list":
                result = {"tools": list(self.tools.values())}
            elif method == "tools/call":
                tool_name = params.get("name")
                arguments = params.get("arguments", {})
                
                if tool_name not in self.tool_handlers:
                    return self._error(req_id, -32601, f"Unknown tool: {tool_name}")
                
                handler = self.tool_handlers[tool_name]
                output = await handler(**arguments)
                result = {
                    "content": [{"type": "text", "text": str(output)}]
                }
            else:
                return self._error(req_id, -32601, f"Unknown method: {method}")
            
            return {"jsonrpc": "2.0", "id": req_id, "result": result}
        
        except Exception as e:
            return self._error(req_id, -32603, str(e))
    
    def _error(self, req_id, code: int, message: str) -> dict:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": code, "message": message}
        }
    
    async def run_stdio(self):
        """通过 stdin/stdout 运行（MCP stdio 传输）"""
        reader = asyncio.StreamReader()
        protocol = asyncio.StreamReaderProtocol(reader)
        await asyncio.get_event_loop().connect_read_pipe(lambda: protocol, sys.stdin)
        
        while True:
            line = await reader.readline()
            if not line:
                break
            
            try:
                request = json.loads(line.decode())
                response = await self.handle_request(request)
                sys.stdout.write(json.dumps(response) + "\n")
                sys.stdout.flush()
            except json.JSONDecodeError:
                continue

# 使用示例：创建一个数据库查询 MCP Server
server = MCPServer("db-query-server")

@server.tool(
    name="query_database",
    description="Execute a read-only SQL query",
    input_schema={
        "type": "object",
        "properties": {
            "sql": {"type": "string", "description": "SQL query (SELECT only)"},
            "database": {"type": "string", "enum": ["users", "orders"]}
        },
        "required": ["sql", "database"]
    }
)
async def query_database(sql: str, database: str) -> str:
    # 安全检查
    if not sql.strip().upper().startswith("SELECT"):
        raise ValueError("Only SELECT queries allowed")
    
    # 模拟数据库查询
    return json.dumps({"rows": [{"id": 1, "name": "test"}], "count": 1})

# 启动: python mcp_server.py
# asyncio.run(server.run_stdio())
```

---

### 9. 实现微调数据清洗管线

**题目：** 实现一个完整的微调数据清洗 Pipeline，包含去重、质量评分、格式校验、PII 脱敏。

**实现（Python）：**

```python
import json
import hashlib
import re
from dataclasses import dataclass
from typing import Generator

@dataclass
class DataItem:
    instruction: str
    output: str
    quality_score: float = 0.0
    is_valid: bool = True
    rejection_reason: str = ""

class FinetuneDataPipeline:
    """微调数据清洗管线"""
    
    def __init__(self, min_quality_score: float = 3.0):
        self.min_quality = min_quality_score
        self.seen_hashes: set[str] = set()
        self.stats = {
            "total": 0, "deduped": 0, "quality_filtered": 0,
            "format_invalid": 0, "pii_found": 0, "passed": 0
        }
    
    def process(self, items: list[dict]) -> list[DataItem]:
        """执行完整清洗管线"""
        results = []
        for raw in items:
            self.stats["total"] += 1
            item = DataItem(
                instruction=raw.get("instruction", ""),
                output=raw.get("output", "")
            )
            
            # Step 1: 格式校验
            if not self._validate_format(item):
                self.stats["format_invalid"] += 1
                continue
            
            # Step 2: 去重
            if not self._deduplicate(item):
                self.stats["deduped"] += 1
                continue
            
            # Step 3: PII 脱敏
            item = self._remove_pii(item)
            
            # Step 4: 质量评分（简化版，实际应用 LLM 评分）
            item.quality_score = self._score_quality(item)
            if item.quality_score < self.min_quality:
                self.stats["quality_filtered"] += 1
                continue
            
            self.stats["passed"] += 1
            results.append(item)
        
        return results
    
    def _validate_format(self, item: DataItem) -> bool:
        """格式校验"""
        if not item.instruction or not item.output:
            return False
        if len(item.instruction) < 5 or len(item.output) < 10:
            return False
        if len(item.output) > 10000:  # 过长
            return False
        return True
    
    def _deduplicate(self, item: DataItem) -> bool:
        """基于内容哈希去重"""
        content = f"{item.instruction}|||{item.output}"
        content_hash = hashlib.md5(content.encode()).hexdigest()
        if content_hash in self.seen_hashes:
            return False
        self.seen_hashes.add(content_hash)
        return True
    
    def _remove_pii(self, item: DataItem) -> DataItem:
        """PII 脱敏（电话、邮箱、身份证等）"""
        patterns = {
            "phone": r'1[3-9]\d{9}',
            "email": r'[\w.+-]+@[\w-]+\.[\w.-]+',
            "id_card": r'\d{17}[\dXx]',
        }
        
        for pii_type, pattern in patterns.items():
            if re.search(pattern, item.output):
                self.stats["pii_found"] += 1
                item.output = re.sub(pattern, f"[{pii_type.upper()}_REDACTED]", item.output)
                item.instruction = re.sub(pattern, f"[{pii_type.upper()}_REDACTED]", item.instruction)
        
        return item
    
    def _score_quality(self, item: DataItem) -> float:
        """简化质量评分（实际应用中用 GPT-4 评分）"""
        score = 3.0  # 基础分
        
        # 长度合理性
        if 50 < len(item.output) < 2000:
            score += 0.5
        
        # 包含结构化内容（列表、代码等）
        if any(marker in item.output for marker in ["1.", "- ", "```", "**"]):
            score += 0.5
        
        # 指令和输出的相关性（简化：检查关键词重叠）
        instruction_words = set(item.instruction.lower().split())
        output_words = set(item.output.lower().split())
        overlap = len(instruction_words & output_words) / max(len(instruction_words), 1)
        if overlap > 0.1:
            score += 0.5
        
        return min(score, 5.0)

# 测试
pipeline = FinetuneDataPipeline(min_quality_score=3.0)
raw_data = [
    {"instruction": "解释什么是 KV Cache", "output": "KV Cache 是 LLM 推理中的关键优化技术...（详细回答）"},
    {"instruction": "解释什么是 KV Cache", "output": "KV Cache 是 LLM 推理中的关键优化技术...（详细回答）"},  # 重复
    {"instruction": "", "output": ""},  # 无效
    {"instruction": "请联系 13800138000", "output": "好的，我会联系 13800138000"},  # PII
]

cleaned = pipeline.process(raw_data)
print(f"清洗结果: {pipeline.stats}")
print(f"保留: {len(cleaned)} 条")
```

---

## 🎯 场景题

### 10. 设计 AI 网关限流器

**题目：** 设计一个支持多租户、多模型的 AI 网关令牌桶限流器，支持按团队设置 QPM（Queries Per Minute）和 TPM（Tokens Per Minute）限额。

**实现（Python）：**

```python
import time
import asyncio
from dataclasses import dataclass, field
from typing import Optional

@dataclass
class RateLimitConfig:
    qpm: int = 60         # Queries per minute
    tpm: int = 100000     # Tokens per minute
    daily_budget_usd: float = 100.0

@dataclass
class TokenBucket:
    capacity: float
    tokens: float
    refill_rate: float  # tokens per second
    last_refill: float = field(default_factory=time.time)
    
    def try_consume(self, amount: float = 1.0) -> bool:
        """尝试消费 token"""
        now = time.time()
        elapsed = now - self.last_refill
        
        # 补充 token
        self.tokens = min(self.capacity, self.tokens + elapsed * self.refill_rate)
        self.last_refill = now
        
        if self.tokens >= amount:
            self.tokens -= amount
            return True
        return False
    
    def wait_time(self, amount: float = 1.0) -> float:
        """需要等待多久才能消费"""
        if self.tokens >= amount:
            return 0.0
        deficit = amount - self.tokens
        return deficit / self.refill_rate

class AIGatewayRateLimiter:
    """AI 网关多租户限流器"""
    
    def __init__(self):
        self.team_configs: dict[str, RateLimitConfig] = {}
        self.query_buckets: dict[str, TokenBucket] = {}
        self.token_buckets: dict[str, TokenBucket] = {}
        self.daily_spend: dict[str, float] = {}
    
    def register_team(self, team_id: str, config: RateLimitConfig):
        """注册团队限流配置"""
        self.team_configs[team_id] = config
        self.query_buckets[team_id] = TokenBucket(
            capacity=config.qpm,
            tokens=config.qpm,
            refill_rate=config.qpm / 60.0
        )
        self.token_buckets[team_id] = TokenBucket(
            capacity=config.tpm,
            tokens=config.tpm,
            refill_rate=config.tpm / 60.0
        )
        self.daily_spend[team_id] = 0.0
    
    async def check_and_wait(
        self, team_id: str, estimated_tokens: int = 1000
    ) -> tuple[bool, str]:
        """
        检查限流，必要时等待。
        返回 (是否允许, 原因)
        """
        if team_id not in self.team_configs:
            return False, "Unknown team"
        
        config = self.team_configs[team_id]
        
        # 检查日预算
        if self.daily_spend[team_id] >= config.daily_budget_usd:
            return False, f"Daily budget exceeded: ${self.daily_spend[team_id]:.2f}/{config.daily_budget_usd}"
        
        # 检查 QPM
        qps_bucket = self.query_buckets[team_id]
        if not qps_bucket.try_consume(1):
            wait = qps_bucket.wait_time(1)
            if wait > 30:  # 等待超过 30 秒直接拒绝
                return False, f"QPM limit exceeded. Wait {wait:.1f}s"
            await asyncio.sleep(wait)
            qps_bucket.try_consume(1)
        
        # 检查 TPM
        tpm_bucket = self.token_buckets[team_id]
        if not tpm_bucket.try_consume(estimated_tokens):
            wait = tpm_bucket.wait_time(estimated_tokens)
            if wait > 60:
                return False, f"TPM limit exceeded. Wait {wait:.1f}s"
            await asyncio.sleep(wait)
            tpm_bucket.try_consume(estimated_tokens)
        
        return True, "OK"
    
    def record_usage(self, team_id: str, tokens_used: int, cost_usd: float):
        """记录实际用量"""
        self.daily_spend[team_id] = self.daily_spend.get(team_id, 0) + cost_usd

# 使用
limiter = AIGatewayRateLimiter()
limiter.register_team("backend-team", RateLimitConfig(qpm=100, tpm=500000, daily_budget_usd=50))

async def handle_request(team_id: str, prompt: str):
    allowed, reason = await limiter.check_and_wait(team_id, estimated_tokens=2000)
    if not allowed:
        return {"error": reason, "status": 429}
    
    # 调用 LLM...
    response = "..."
    limiter.record_usage(team_id, tokens_used=1500, cost_usd=0.03)
    return {"response": response}
```

---

### 11. 实现 RAG 文档分块器

**题目：** 实现一个支持语义分块和递归分割的文档分块器，适用于 RAG 管线。

**实现（Python）：**

```python
import re
from dataclasses import dataclass
from typing import Optional

@dataclass
class Chunk:
    text: str
    metadata: dict
    start_idx: int
    end_idx: int
    
    @property
    def token_count(self) -> int:
        return len(self.text) // 4  # 粗略估算

class RecursiveChunker:
    """递归字符分块器（类似 LangChain 的 RecursiveCharacterTextSplitter）"""
    
    def __init__(
        self,
        chunk_size: int = 500,
        chunk_overlap: int = 50,
        separators: Optional[list[str]] = None
    ):
        self.chunk_size = chunk_size
        self.overlap = chunk_overlap
        self.separators = separators or [
            "\n## ",      # Markdown H2
            "\n### ",     # Markdown H3  
            "\n\n",       # 段落
            "\n",         # 换行
            "。",         # 中文句号
            ". ",         # 英文句号
            " ",          # 空格
            ""            # 字符级别（最后手段）
        ]
    
    def split(self, text: str, metadata: Optional[dict] = None) -> list[Chunk]:
        """分块入口"""
        metadata = metadata or {}
        chunks = self._recursive_split(text, self.separators)
        
        # 添加 overlap
        result = []
        for i, chunk_text in enumerate(chunks):
            start_idx = text.find(chunk_text)
            result.append(Chunk(
                text=chunk_text.strip(),
                metadata={**metadata, "chunk_index": i},
                start_idx=start_idx,
                end_idx=start_idx + len(chunk_text)
            ))
        
        return [c for c in result if c.text]  # 过滤空块
    
    def _recursive_split(self, text: str, separators: list[str]) -> list[str]:
        """递归分割"""
        if len(text) <= self.chunk_size:
            return [text]
        
        # 找到最佳分隔符
        for sep in separators:
            if sep and sep in text:
                parts = text.split(sep)
                chunks = []
                current = ""
                
                for part in parts:
                    candidate = current + sep + part if current else part
                    
                    if len(candidate) <= self.chunk_size:
                        current = candidate
                    else:
                        if current:
                            chunks.append(current)
                        
                        if len(part) > self.chunk_size:
                            # 这个 part 本身太大，用下一级分隔符继续分
                            sub_chunks = self._recursive_split(
                                part, separators[separators.index(sep)+1:]
                            )
                            chunks.extend(sub_chunks)
                            current = ""
                        else:
                            current = part
                
                if current:
                    chunks.append(current)
                
                return chunks
        
        # 所有分隔符都不行，硬切
        return [text[i:i+self.chunk_size] for i in range(0, len(text), self.chunk_size - self.overlap)]

# 测试
chunker = RecursiveChunker(chunk_size=200, chunk_overlap=30)
document = """
## KV Cache 原理

KV Cache 是 LLM 推理中最重要的优化技术之一。在自回归生成中，每生成一个新 token，都需要与之前所有 token 做 Attention 计算。

### 为什么需要 KV Cache

没有 KV Cache 时，生成第 N 个 token 需要重新计算前 N-1 个 token 的 Key 和 Value 向量。这导致计算量随序列长度平方增长。

KV Cache 将已计算的 K、V 矩阵存储在 GPU 显存中，新 token 只需计算自己的 QKV，然后与缓存的 K、V 做 Attention。

### 显存占用

一个 70B 模型，序列长度 4096，单个请求的 KV Cache 大约占用 2.5GB 显存。这是推理服务中最大的显存消耗项。

## PagedAttention

PagedAttention 是 vLLM 的核心创新，借鉴了操作系统虚拟内存的分页思想。
"""

chunks = chunker.split(document, metadata={"source": "kv_cache_doc.md"})
for chunk in chunks:
    print(f"[Chunk {chunk.metadata['chunk_index']}] ({len(chunk.text)} chars): {chunk.text[:60]}...")
```
