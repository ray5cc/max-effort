# SSE 分布式推送与数据一致性 — 面试题

> 覆盖分布式 SSE 推送架构、事件持久化、数据一致性、高并发与高可用设计

## 相关链接
- 对应技术资料：[SSE分布式推送与数据一致性](../../01-技术资料/09-AI-Agent工程化/04-SSE分布式推送与数据一致性.md)

## 题目列表

| 题号 | 题目 | 难度 |
|------|------|------|
| Q1 | 单节点 SSE 为什么无法水平扩展？负载均衡器背后会发生什么？ | ⭐ 基础 |
| Q2 | 什么是 Last-Event-ID？SSE 断线重连机制是如何工作的？ | ⭐ 基础 |
| Q3 | SSE vs WebSocket：AI 流式输出场景下如何选型？ | ⭐ 基础 |
| Q4 | 集群环境下如何路由 SSE 响应？Sticky Sessions 和消息总线各有什么利弊？ | ⭐⭐ 进阶 |
| Q5 | Redis Pub/Sub Channel-per-Session 模式的设计与权衡 | ⭐⭐ 进阶 |
| Q6 | SSE 事件持久化存储选型：Redis Streams vs Kafka vs PostgreSQL | ⭐⭐ 进阶 |
| Q7 | 如何实现 At-Least-Once 投递语义与幂等消费？ | ⭐⭐ 进阶 |
| Q8 | SSE 流式推送中的背压控制策略 | ⭐⭐ 进阶 |
| Q9 | 分布式 SSE 的连接注册表如何设计？ | ⭐⭐ 进阶 |
| Q10 | 设计一个支撑百万 DAU 的 AI Chatbot SSE 推送架构 | ⭐⭐⭐ 高级 |
| Q11 | 跨区域 SSE 高可用架构设计 | ⭐⭐⭐ 高级 |
| Q12 | 分布式 SSE 中如何保证事件有序投递？ | ⭐⭐⭐ 高级 |
| Q13 | 场景设计：为 AI 编程助手（类 GitHub Copilot）设计 SSE 流式推送基础设施 | 🎯 场景设计 |
| Q14 | 场景设计：部署期间 SSE 连接断开，设计零停机部署方案 | 🎯 场景设计 |

## 🔥 高频考点速记

| # | 考点 | 核心要点 | 出题概率 |
|---|------|---------|---------|
| 1 | 单节点 SSE 瓶颈 | 文件描述符上限 / 内存消耗 / 单点故障 / 事件路由失败 | ★★★★★ |
| 2 | Channel-per-Session | 每会话一个 Pub/Sub 频道 → 精准路由 → 避免广播风暴 | ★★★★★ |
| 3 | Last-Event-ID 重连 | 浏览器原生自动重连 → 携带 Last-Event-ID → 服务端重放丢失事件 | ★★★★★ |
| 4 | 事件持久化选型 | Redis Streams（短期）/ Kafka（大规模）/ PostgreSQL（结构化查询） | ★★★★☆ |
| 5 | 背压控制 | 缓冲区上限 → token 合并 → 慢消费者检测 → 优雅降级 | ★★★★☆ |
| 6 | 连接注册表 | Redis Hash 注册 → TTL + 心跳续期 → lookup 路由 | ★★★☆☆ |

---

## 参考答案

### Q1: 单节点 SSE 为什么无法水平扩展？负载均衡器背后会发生什么？

<details>
<summary>参考答案</summary>

**核心结论：单节点 SSE 有三大硬性瓶颈（连接数上限、内存消耗、单点故障），集群部署后最致命的问题是"事件的生产者和连接的持有者不在同一节点"。**

#### 三大瓶颈

| 瓶颈维度 | 具体表现 | 量化指标 |
|----------|---------|---------|
| **连接数上限** | 每个 SSE 连接占用一个 TCP socket（文件描述符） | 单进程默认 1024，调优后约 65K |
| **内存消耗** | 每个连接需要维护读写缓冲区和应用层状态 | 每连接 ~10-50 KB，1 万连接 ≈ 100-500 MB |
| **单点故障** | 服务器宕机 = 所有连接断开 + 所有推送中断 | MTTR 直接影响用户体验 |

#### 负载均衡器背后的致命问题

```
用户 ──SSE──→ 负载均衡器 ──→ 实例 B (持有 SSE 连接)
用户 ──POST──→ 负载均衡器 ──→ 实例 A (处理聊天请求) ──→ LLM 推理

问题：LLM 产生的 tokens 在实例 A 上，但 SSE 连接在实例 B 上！
      tokens 如何到达实例 B？
```

这是分布式 SSE 的**核心挑战**：事件的生产者（Worker）和连接的持有者（SSE 节点）分离后，需要一个中间件（消息总线）来桥接。

#### 负载均衡器的 SSE 特殊困境

- **L4（TCP）**：连接建立后固定绑定一个后端，无法中途切换
- **L7（HTTP）**：可以做 Cookie/Header 路由，但 SSE 长连接会导致连接分布不均
- **Round Robin 失效**：SSE 是长连接，新连接不断被分配到已有大量连接的节点

#### 面试追问

- **问：如何估算单节点能支撑多少 SSE 连接？**
  答：8 核 16GB 服务器，每连接约 20KB，理论上限 ~50 万。但考虑 GC 压力和消息吞吐，实际建议 5-10 万连接/节点。
- **问：负载均衡器用 Least-Connections 策略行不行？**
  答：比 Round Robin 更适合 SSE 场景，因为它会优先把新连接分配到连接数最少的节点，但仍无法解决"事件路由"问题。

</details>

---

### Q2: 什么是 Last-Event-ID？SSE 断线重连机制是如何工作的？

<details>
<summary>参考答案</summary>

**Last-Event-ID 是 SSE 协议原生的断线恢复机制——服务端给每个事件设置 `id` 字段，浏览器断线重连时自动在请求头带上最后收到的事件 ID，服务端据此重放丢失的事件。**

#### 工作流程

```
时刻 T1: 正常推送
Server → Client:  id: evt-001\ndata: {"token":"你"}\n\n
Server → Client:  id: evt-002\ndata: {"token":"好"}\n\n
Server → Client:  id: evt-003\ndata: {"token":"，"}\n\n

时刻 T2: 网络中断 ⚡ (evt-004, evt-005 在中断期间产生)

时刻 T3: 浏览器自动重连 (默认 3 秒后)
Client → Server:  GET /sse
                  Last-Event-ID: evt-003    ← 浏览器自动携带

时刻 T4: 服务端从 evt-003 之后重放
Server → Client:  id: evt-004\ndata: {"token":"世"}\n\n
Server → Client:  id: evt-005\ndata: {"token":"界"}\n\n
(继续实时推送...)
```

#### SSE 事件格式中 id 字段的作用

```
id: evt-042              ← 事件 ID（浏览器记住这个值）
event: token             ← 事件类型
data: {"content":"好"}    ← 事件数据
                          ← 空行表示事件结束
```

- 浏览器内部维护 `lastEventId` 属性
- 每收到一个带 `id` 的事件，自动更新 `lastEventId`
- 连接断开时，浏览器自动发起重连，并在请求头中带上 `Last-Event-ID`

#### 服务端处理 Last-Event-ID 的关键代码

```python
async def sse_endpoint(request):
    session_id = request.query_params["session_id"]
    last_event_id = request.headers.get("last-event-id")

    async def event_generator():
        # 阶段 1: 重放丢失的事件
        if last_event_id:
            missed = await event_store.replay_events(session_id, last_event_id)
            for event in missed:
                yield {"id": event["event_id"], "event": event["event"], "data": event["data"]}

        # 阶段 2: 切换到实时流
        async for event in subscribe_realtime(session_id):
            yield {"id": event["event_id"], "event": event["event"], "data": event["data"]}

    return EventSourceResponse(event_generator())
```

#### 注意事项

| 要点 | 说明 |
|------|------|
| 持久化是前提 | 要支持重放，事件必须持久化到 Redis Streams / Kafka 等存储 |
| 重连间隔可控 | 服务端可以通过 `retry: 5000\n` 字段设置重连间隔（毫秒） |
| Fetch API 不支持 | `fetch()` + ReadableStream 方式不支持自动重连，需手动实现 |
| EventSource 原生支持 | `new EventSource(url)` 原生支持自动重连和 Last-Event-ID |

#### 面试追问

- **问：如果事件已经过期（被 Redis Streams 清理了）怎么办？**
  答：服务端发现 last_event_id 对应的事件不存在时，应返回特殊事件告知客户端"数据已过期，需要全量刷新"。
- **问：如果用 Fetch API 怎么手动实现类似机制？**
  答：客户端维护 `lastEventId` 变量，断线后在重连请求的 URL 参数或自定义 Header 中传递。

</details>

---

### Q3: SSE vs WebSocket：AI 流式输出场景下如何选型？

<details>
<summary>参考答案</summary>

**SSE 是 AI 流式输出的首选。原因是：LLM 输出是单向的（模型→用户），SSE 的 HTTP 原生协议、自动重连、代理兼容性完美匹配该场景。WebSocket 的双向能力属于"过度设计"。**

#### 核心对比

| 维度 | SSE | WebSocket |
|------|-----|-----------|
| **方向** | 单向（Server → Client） | 双向 |
| **协议** | HTTP 原生 | 独立协议 ws:// |
| **重连** | 浏览器自动重连 + Last-Event-ID | 需手动实现 |
| **代理兼容** | 优秀（CDN / Nginx 原生支持 HTTP） | 需 Upgrade 协议支持 |
| **数据格式** | 文本（text/event-stream） | 文本 / 二进制 |
| **连接限制** | HTTP/1.1 每域名 6 个；HTTP/2 无此限制 | 无限制 |
| **调试** | `curl -N` 即可观察 | 需要专用工具 |

#### 为什么 LLM 选 SSE 而非 WebSocket

```
LLM 交互模型：
  用户输入 ──HTTP POST──→ 后端 ──→ LLM 推理
  LLM 输出 ──SSE 流───→ 用户（token by token）

关键事实：
1. LLM 输出是单向的（模型 → 用户），不需要双向通道
2. 用户输入是独立的 HTTP POST 请求，不需要复用 SSE 连接
3. SSE 基于标准 HTTP，所有代理/CDN/LB 天然支持
4. OpenAI / Anthropic / Google 全部采用 SSE 作为流式协议
```

#### 什么时候选 WebSocket？

| 场景 | 选 WebSocket 的理由 |
|------|---------------------|
| 多人实时协作编辑 | 需要双向实时同步（如 Google Docs） |
| 在线游戏 | 低延迟双向通信 + 二进制数据 |
| 实时音视频信令 | 双向控制信号交换 |
| 聊天室（非 AI） | 多用户消息广播 + 客户端主动推送 |

#### 面试追问

- **问：HTTP/2 下 SSE 有什么优势？**
  答：HTTP/2 多路复用解决了 HTTP/1.1 每域名 6 连接的限制，多个 SSE 流可以共享一个 TCP 连接，大幅减少资源消耗。
- **问：有没有同时用 SSE 和 WebSocket 的场景？**
  答：有。例如 AI 编程助手可以用 SSE 接收代码建议流，同时用 WebSocket 做光标位置同步和协作编辑。
- **问：gRPC Server Streaming 相比 SSE 有什么优劣？**
  答：gRPC 性能更好（Protobuf + HTTP/2），但浏览器不原生支持，需要 gRPC-Web 代理。SSE 在 Web 端更简单直接。

</details>

---

### Q4: 集群环境下如何路由 SSE 响应？Sticky Sessions 和消息总线各有什么利弊？

<details>
<summary>参考答案</summary>

**两种主流方案：Sticky Sessions 简单但扩展性差，消息总线（Redis Pub/Sub / Kafka / NATS）灵活但引入额外组件。生产中通常从 Sticky Sessions 起步，10 万+ DAU 后演进到消息总线。**

#### 方案一：Sticky Sessions（会话亲和性）

```
┌──────┐     ┌────────────────┐     ┌──────────┐
│用户 A│────→│  负载均衡器      │────→│ 实例 A   │  ← Cookie: srv=A
│      │     │  (IP Hash /    │     └──────────┘
│      │     │   Cookie 亲和)  │     ┌──────────┐
│用户 B│────→│                │────→│ 实例 B   │  ← Cookie: srv=B
└──────┘     └────────────────┘     └──────────┘

核心思路：同一用户的所有请求（POST + SSE）路由到同一实例
         → 事件生产和连接持有在同一节点，无需跨节点通信
```

| 维度 | 优点 | 缺点 |
|------|------|------|
| 实现复杂度 | 简单，LB 原生支持 | — |
| 连接路由 | 天然解决 | — |
| 负载均衡 | — | 热点问题：大用户的实例负载过高 |
| 水平扩展 | — | 扩容时已有连接不会迁移 |
| 故障恢复 | — | 实例宕机需重建亲和关系 |
| 滚动更新 | — | 需要 connection draining，更新速度慢 |

**适用场景**：小规模（< 10 实例，< 10 万 DAU）

#### 方案二：消息总线

```
┌──────────┐  publish   ┌─────────────┐  subscribe  ┌──────────┐
│  Worker  │───────────→│  消息总线     │────────────→│ SSE 节点 │
│ (处理请求)│            │ (Redis/Kafka) │            │ (持有连接) │
└──────────┘            └─────────────┘             └──────────┘

核心思路：Worker 将事件发布到消息总线
         SSE 节点订阅对应用户的频道
         → 无论 Worker 和 SSE 节点在哪，事件都能送达
```

| 维度 | 优点 | 缺点 |
|------|------|------|
| 服务解耦 | SSE 和业务逻辑完全分离 | — |
| 水平扩展 | SSE 节点独立扩缩，无状态 | — |
| 故障恢复 | 重连到任意节点即可 | — |
| 运维复杂度 | — | 多引入一个组件（Redis/Kafka） |
| 延迟 | — | 经消息总线增加 1-10ms |

**适用场景**：中大规模（> 10 万 DAU），微服务架构

#### 演进路线

```
10 万 DAU          100 万 DAU            1000 万 DAU
Sticky Sessions → 消息总线+服务分离 → 跨区域 Active-Active
```

#### 面试追问

- **问：从 Sticky Sessions 迁移到消息总线需要改什么？**
  答：1）将 SSE 网关独立为专用服务；2）引入 Redis Pub/Sub 或 Kafka 作为消息总线；3）Worker 从直接写 SSE 改为发布到消息总线；4）SSE 网关从直接读 LLM 改为订阅消息总线。
- **问：如果用 Sticky Sessions，实例宕机怎么办？**
  答：用户 SSE 断开→浏览器自动重连→LB 分配到新实例→新实例建立新 SSE 连接。如果有事件持久化，配合 Last-Event-ID 可无损恢复。

</details>

---

### Q5: Redis Pub/Sub Channel-per-Session 模式的设计与权衡

<details>
<summary>参考答案</summary>

**Channel-per-Session 是分布式 SSE 推送的核心设计模式：每个用户会话对应一个独立的 Redis Pub/Sub 频道（如 `sse:session:{sessionId}`），实现精准路由，避免广播风暴。**

#### 完整流程

```
1. 用户建立 SSE 连接
   浏览器 ──SSE──→ LB ──→ SSE 节点 B
                          │
2. SSE 节点 B 注册连接 + 订阅频道
   Registry: {session_123: node_B}
   SUBSCRIBE sse:session:session_123

3. 用户发送聊天请求（普通 HTTP POST）
   浏览器 ──POST──→ LB ──→ Worker 节点 A

4. Worker A 调用 LLM → 获得 streaming tokens

5. Worker A 将 tokens 发布到用户频道
   PUBLISH sse:session:session_123 → {"token": "你"}

6. SSE 节点 B 收到消息 → 推送给用户
   Redis ──→ SSE 节点 B ──SSE──→ 浏览器
```

#### 核心代码

```typescript
// SSE 节点：处理连接并订阅频道
class SSEConnectionHandler {
  async handleConnection(sessionId: string, res: ServerResponse) {
    // 1. 设置 SSE 响应头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    });

    // 2. 注册到连接注册表
    await redis.hset(`sse:registry:${sessionId}`, { node_id: NODE_ID });

    // 3. 订阅用户专属频道
    const channel = `sse:session:${sessionId}`;
    await subscriber.subscribe(channel);

    // 4. 消息转发
    subscriber.on('message', (ch, message) => {
      if (ch === channel) {
        const event = JSON.parse(message);
        res.write(`id: ${event.id}\nevent: ${event.event}\ndata: ${event.data}\n\n`);
      }
    });

    // 5. 清理
    res.on('close', async () => {
      await subscriber.unsubscribe(channel);
      await redis.del(`sse:registry:${sessionId}`);
    });
  }
}
```

#### 权衡分析

| 维度 | 优势 | 代价 |
|------|------|------|
| **路由精准** | 只有持有连接的节点收到消息，无广播浪费 | 频道数量 = 在线会话数，Redis 需管理大量频道 |
| **实时性** | Redis Pub/Sub 延迟 < 1ms | 火即忘：订阅者离线时消息丢失 |
| **简单性** | 一个 SUBSCRIBE + 一个 PUBLISH 搞定 | 需配合 Streams 做持久化才能支持断线重连 |
| **扩展性** | 新增 SSE 节点只需订阅对应频道 | 单个 Redis 节点有订阅数上限（百万级） |

#### 与广播模式对比

| 模式 | 描述 | 消息浪费 | 适用场景 |
|------|------|---------|---------|
| **Channel-per-Session** | 每会话一个频道 | 无浪费 | 用户级推送（AI 对话） |
| **广播 Fan-out** | 所有节点收到所有事件，本地过滤 | 大量浪费 | 全局通知、系统公告 |

#### 面试追问

- **问：百万在线用户意味着百万个 Redis 频道，Redis 扛得住吗？**
  答：单个 Redis 节点可支持百万级 Pub/Sub 频道。但建议用 Redis Cluster 分片：按 session_id 哈希分配到不同分片，分散订阅压力。
- **问：为什么不用 Redis Streams 代替 Pub/Sub 做实时推送？**
  答：Streams 需要消费者主动拉取（XREAD BLOCK），延迟比 Pub/Sub 高。最佳实践是 Pub/Sub 做实时推送 + Streams 做持久化，双管齐下。

</details>

---

### Q6: SSE 事件持久化存储选型：Redis Streams vs Kafka vs PostgreSQL

<details>
<summary>参考答案</summary>

**事件持久化是 SSE 断线重连的前提。选型取决于三个维度：保留时长、吞吐量需求、查询需求。短期缓冲选 Redis Streams，大规模事件溯源选 Kafka，需要关联查询选 PostgreSQL。**

#### 为什么需要事件持久化

| 场景 | 说明 | 无持久化的后果 |
|------|------|--------------|
| **断线重连** | 网络闪断 3-5 秒 | 丢失中间 tokens，回复内容不完整 |
| **页面刷新** | 用户刷新浏览器 | 已收到的内容全部丢失 |
| **节点故障转移** | SSE 节点宕机 | 迁移前后的事件丢失 |

#### 选型决策树

```
需要事件持久化吗？
├── 否 → Redis Pub/Sub（纯推送，不存储）
└── 是
    ├── 保留时长 < 24h？
    │   ├── 是 → Redis Streams（内存高效，自动过期）
    │   └── 否
    │       ├── 需要无限回放 → Kafka（磁盘存储，无限保留）
    │       └── 需要 SQL 查询 → PostgreSQL（结构化查询，灵活）
    └── 需要跨区域复制？
        ├── 是 → Kafka（原生 MirrorMaker 支持）
        └── 否 → Redis Streams 或 NATS JetStream
```

#### 详细对比

| 维度 | Redis Streams | Kafka | PostgreSQL |
|------|--------------|-------|-----------|
| **写入延迟** | < 1ms | 2-10ms | 5-20ms |
| **吞吐量** | 10 万/s（单节点） | 百万/s（集群） | 1-5 万/s |
| **保留策略** | MAXLEN / MINID | 时间/大小/紧凑 | 手动分区+清理 |
| **查询能力** | 范围查询、消费者组 | Offset 查询 | 全 SQL |
| **运维成本** | 低 | 高 | 中 |
| **最佳场景** | 短期事件缓冲 | 大规模事件溯源 | 需要关联查询 |

#### Redis Streams 事件存储示例

```python
class SSEEventStore:
    """基于 Redis Streams 的事件持久化"""

    async def append_event(self, session_id: str, event: dict) -> str:
        stream_key = f"sse:stream:{session_id}"
        entry_id = await self.redis.xadd(
            stream_key,
            {"event_id": event["id"], "event": event["event"], "data": event["data"]},
            maxlen=1000,  # 自动修剪，保留最近 1000 条
        )
        await self.redis.expire(stream_key, 3600)  # 1 小时过期
        return entry_id

    async def replay_events(self, session_id: str, last_event_id: str) -> list:
        """从指定位置重放事件（断线重连用）"""
        stream_key = f"sse:stream:{session_id}"
        return await self.redis.xrange(stream_key, min=f"({last_event_id}", max="+")
```

#### 面试追问

- **问：为什么 Redis Streams 的 XADD 要设 MAXLEN？**
  答：防止内存无限增长。AI 对话场景每个会话约 500-2000 个 token 事件，设 MAXLEN=2000 足够覆盖一次完整回复。
- **问：什么时候需要同时用 Redis Streams 和 Kafka？**
  答：千万级 DAU 场景：Redis Streams 做热数据（24 小时内）用于断线重连，Kafka 做冷数据用于审计、分析和跨区域复制。
- **问：PostgreSQL 做事件持久化的最大瓶颈是什么？**
  答：写入吞吐量。单节点 1-5 万 TPS 远低于 Redis Streams。但可以通过分区表 + 批量插入优化到 10 万级别。

</details>

---

### Q7: 如何实现 At-Least-Once 投递语义与幂等消费？

<details>
<summary>参考答案</summary>

**SSE + Last-Event-ID 天然支持 At-Least-Once 语义（至少一次投递）。但"至少一次"意味着可能重复投递，因此客户端必须实现幂等消费——通过事件 ID 去重，安全地处理重复事件。**

#### At-Least-Once 投递流程

```
正常投递:
Server ──evt-001──→ Client ✅
Server ──evt-002──→ Client ✅

网络中断 ⚡ (evt-003 在中断期间产生)

重连后:
Client ──Last-Event-ID: evt-002──→ Server
Server ──evt-003──→ Client ✅  (补发丢失事件)

可能的重复:
Server ──evt-002──→ Client ⚠️  (边界情况：evt-002 可能被再次投递)
```

#### 为什么会重复？

重复发生在**断线边界**：客户端收到了 evt-002 但还没更新 lastEventId 就断线了，重连后带的 Last-Event-ID 仍是 evt-001，导致 evt-002 被重放。

#### 幂等消费者实现

```typescript
class IdempotentSSEConsumer {
  private processedIds: Set<string> = new Set();
  private maxWindowSize = 1000;

  handleEvent(event: MessageEvent): void {
    const eventId = event.lastEventId;

    // 去重检查
    if (this.processedIds.has(eventId)) {
      console.log(`跳过重复事件: ${eventId}`);
      return;
    }

    // 处理事件
    this.processEvent(event);

    // 记录已处理
    this.processedIds.add(eventId);

    // 维护窗口大小，防止内存泄漏
    if (this.processedIds.size > this.maxWindowSize) {
      const oldest = this.processedIds.values().next().value;
      this.processedIds.delete(oldest);
    }
  }
}
```

#### 关键设计要点

| 要点 | 说明 |
|------|------|
| **事件 ID 全局唯一** | 推荐格式 `{sessionId}-{sequence}`，如 `sess_abc-042` |
| **滑动窗口去重** | 用 Set 记录最近 N 个已处理事件 ID，防止 OOM |
| **幂等操作设计** | Token 追加用 `seq` 定位而非 `append`，重复执行结果相同 |
| **事务性 Outbox** | 生产者端保证"业务写入 + 事件发布"原子性 |

#### Transactional Outbox 模式（生产者端保障）

```
┌──────────┐     ┌──────────────────────────────┐
│  Worker  │     │     数据库（事务边界）          │
│          │────→│  ┌──────────┐  ┌───────────┐ │
│  开始事务 │     │  │ 业务表    │  │ Outbox 表 │ │
└──────────┘     │  │(消息记录) │  │(待发事件)  │ │
                 │  └──────────┘  └───────────┘ │
                 └──────────────┬───────────────┘
                                │ 轮询/CDC
                         ┌──────▼──────┐
                         │ Relay 进程   │──publish──→ 消息总线
                         └─────────────┘
```

#### 面试追问

- **问：为什么不用 Exactly-Once？**
  答：分布式系统中 Exactly-Once 实际上是 At-Least-Once + 幂等消费的组合。纯协议级 Exactly-Once 需要分布式事务，代价过高。SSE 场景中 At-Least-Once + 客户端去重已足够。
- **问：Outbox 表的轮询间隔如何设置？**
  答：100ms 左右。太短浪费 CPU，太长增加端到端延迟。也可以用 PostgreSQL LISTEN/NOTIFY 或 CDC（如 Debezium）代替轮询。

</details>

---

### Q8: SSE 流式推送中的背压控制策略

<details>
<summary>参考答案</summary>

**背压（Backpressure）是指消费者处理速度跟不上生产者的情况。在 SSE 场景中，LLM 产生 tokens 的速度（~100 tokens/s）可能快于慢网络客户端的消费速度。如果不控制，服务端缓冲区会无限增长直到 OOM。**

#### 类比

水管系统：水泵（LLM）的出水速度比水龙头（客户端网络）快，管道中水压持续升高，最终爆管。背压机制就是"减压阀"。

#### 三种策略对比

```
┌─────────┐    ┌──────────────┐    ┌──────────────────┐
│ LLM     │    │ 发送缓冲区    │    │ 客户端            │
│ 100 t/s │──→│ (有界队列)    │──→│ (可能很慢)        │
└─────────┘    │ max = 256    │    │ 2G 手机网络       │
               └──────┬───────┘    └──────────────────┘
                      │
      缓冲区满时的策略:
      ├── 策略 1: 阻塞生产者 ❌ （可能阻塞 LLM 线程）
      ├── 策略 2: 丢弃旧事件 ❌ （丢失 token）
      └── 策略 3: 合并事件   ✅ （推荐）
          把 ["你", "好", "世", "界"] 合并为 "你好世界" 一次发送
```

#### Token 合并实现

```python
class BackpressureBuffer:
    def __init__(self, max_size: int = 256, merge_threshold: int = 64):
        self.queue = asyncio.Queue(maxsize=max_size)
        self.merge_threshold = merge_threshold

    async def put(self, event: dict) -> bool:
        if self.queue.qsize() >= self.merge_threshold:
            await self._merge_pending_tokens()  # 触发合并
        try:
            self.queue.put_nowait(event)
            return True
        except asyncio.QueueFull:
            self.dropped_count += 1
            return False

    async def _merge_pending_tokens(self):
        """将连续的 token 事件合并为一个"""
        temp, merged_content = [], []
        while not self.queue.empty():
            event = self.queue.get_nowait()
            if event.get("event") == "token":
                merged_content.append(json.loads(event["data"])["content"])
            else:
                if merged_content:
                    temp.append({"event": "token",
                                 "data": json.dumps({"content": "".join(merged_content), "merged": True})})
                    merged_content = []
                temp.append(event)
        if merged_content:
            temp.append({"event": "token",
                         "data": json.dumps({"content": "".join(merged_content), "merged": True})})
        for event in temp:
            await self.queue.put(event)
```

#### 降级策略梯度

| 降级等级 | 触发条件 | 策略 |
|---------|---------|------|
| Level 0 正常 | — | 完整功能 |
| Level 1 轻度 | CPU > 70% 或连接 > 40K | 每 5 个 token 合并推送 |
| Level 2 中度 | CPU > 80% 或连接 > 50K | 关闭心跳、暂停事件持久化 |
| Level 3 重度 | CPU > 90% 或连接 > 55K | 拒绝新连接，返回 503 + Retry-After |
| Level 4 极端 | CPU > 95% 或连接 > 60K | SSE → HTTP Polling 降级 |

#### 面试追问

- **问：token 合并后客户端怎么处理？**
  答：对前端渲染无影响——无论是一个个 token 到达还是一批到达，都是追加到输出区域。甚至合并后渲染更流畅，减少了 DOM 更新次数。
- **问：如何检测慢消费者？**
  答：监控每个连接的缓冲区利用率。如果持续 > 80% 超过 30 秒，标记为慢消费者，可以主动断开并让客户端重连。
- **问：背压控制应该在哪一层实现？**
  答：SSE 网关层。不应在 Worker 层（会阻塞 LLM 推理线程），也不应在消息总线层（会影响其他消费者）。

</details>

---

### Q9: 分布式 SSE 的连接注册表如何设计？

<details>
<summary>参考答案</summary>

**连接注册表（Connection Registry）是分布式 SSE 的"通讯录"——记录每个会话的 SSE 连接位于哪个节点上。类比酒店前台的房客登记簿：每位房客入住时登记房间号，退房时注销，有人找房客时查登记簿即可。**

#### 核心设计

```python
class ConnectionRegistry:
    """基于 Redis Hash 的分布式连接注册表"""

    def __init__(self, redis_client, node_id: str, ttl: int = 60):
        self.redis = redis_client
        self.node_id = node_id
        self.ttl = ttl

    async def register(self, session_id: str, user_id: str):
        """用户建立 SSE 连接时注册"""
        key = f"sse:registry:{session_id}"
        await self.redis.hset(key, mapping={
            "node_id": self.node_id,
            "user_id": user_id,
            "connected_at": str(time.time()),
        })
        await self.redis.expire(key, self.ttl)

    async def unregister(self, session_id: str):
        """用户断开时注销"""
        await self.redis.delete(f"sse:registry:{session_id}")

    async def heartbeat(self, session_id: str):
        """续期注册信息，防止过期"""
        await self.redis.expire(f"sse:registry:{session_id}", self.ttl)

    async def lookup(self, session_id: str) -> dict | None:
        """查询连接所在节点"""
        return await self.redis.hgetall(f"sse:registry:{session_id}")
```

#### 生命周期管理

```
SSE 连接建立
  │
  ├── register(session_id, user_id)    ← 写入 Redis
  │
  ├── 每 15 秒心跳
  │   └── heartbeat(session_id)         ← 续期 TTL
  │
  └── 连接关闭（正常断开 / 异常断开）
      └── unregister(session_id)        ← 删除 Redis Key

TTL 兜底：如果节点宕机导致没有执行 unregister，
         TTL 过期后注册信息自动清除（防止幽灵注册）
```

#### 关键设计考量

| 设计点 | 方案 | 原因 |
|--------|------|------|
| **存储** | Redis Hash | 低延迟、支持字段级读写 |
| **TTL** | 60 秒 + 心跳续期 | 防止幽灵注册（节点宕机后注册残留） |
| **心跳间隔** | 15 秒 | TTL 的 1/4，确保在过期前续期 |
| **分片** | 按 session_id 哈希 | 避免单节点 Redis 瓶颈 |
| **并发安全** | Redis 单线程 | 天然无竞态条件 |

#### 故障转移中的注册表更新

```
节点 A 宕机 → 用户重连到节点 C

节点 C 检查旧注册:
  old_reg = lookup(session_id)  → {node_id: "A"}

节点 A 已宕机？
  ├── 是 → 直接覆盖注册: register(session_id) → {node_id: "C"}
  └── 否 → 通知节点 A 关闭旧连接，然后覆盖注册
```

#### 面试追问

- **问：如果 Redis 本身挂了怎么办？**
  答：1）注册表使用 Redis Sentinel 或 Cluster 保证高可用；2）注册表短暂不可用时，SSE 连接仍正常工作（只影响新连接的注册和旧连接的查找）；3）可以降级到内存注册表+广播模式。
- **问：能不能用 etcd 或 ZooKeeper 做注册表？**
  答：可以，但不推荐。SSE 注册表的特点是高频写（每 15 秒心跳×连接数），etcd/ZooKeeper 的写吞吐远低于 Redis。它们更适合低频变更的服务发现场景。

</details>

---

### Q10: 设计一个支撑百万 DAU 的 AI Chatbot SSE 推送架构

<details>
<summary>参考答案</summary>

**百万 DAU → 峰值约 10 万在线 → 约 5 万并发 SSE 连接。核心架构是"SSE 网关 + 消息总线 + Worker 集群"三层分离，用 Redis Cluster 做 Pub/Sub + Streams，支持水平扩展和断线恢复。**

#### 容量规划

| 指标 | 数值 | 计算依据 |
|------|------|---------|
| DAU | 100 万 | 业务目标 |
| 峰值在线 | ~10 万 | DAU × 10% |
| 并发 SSE | ~5 万 | 50% 在线用户在对话 |
| SSE 节点 | 4-6 台 | 每节点 1 万连接（留余量） |
| Redis 分片 | 6 节点 | 3 主 3 从 |

#### 架构图

```
┌──────┐    ┌──────────┐    ┌──────────────────────────┐
│      │SSE │  L7 LB   │    │    SSE 网关集群           │
│      │───→│(Least    │───→│ ┌────────┐ ┌────────┐   │
│      │    │ Conn)    │    │ │节点 1   │ │节点 2   │   │
│ 用户 │    └──────────┘    │ │10K连接  │ │10K连接  │   │
│      │                    │ └───┬────┘ └───┬────┘   │
│      │    ┌──────────┐    └─────┼──────────┼────────┘
│      │───→│  API LB  │         │subscribe │
│      │POST│          │   ┌─────▼──────────▼────────┐
└──────┘    └────┬─────┘   │   Redis Cluster         │
                 │         │   (Pub/Sub + Streams)    │
            ┌────▼─────┐   └────────────▲─────────────┘
            │ API 集群  │               │ publish
            │ ┌──────┐ │        ┌───────┴───────┐
            │ │实例 1 │─────→   │ Worker 集群    │
            │ │实例 2 │ │       │ (LLM 调用)    │
            │ └──────┘ │       └───────┬───────┘
            └──────────┘               │
                                ┌──────▼──────┐
                                │  LLM 推理   │
                                │  (GPU 集群)  │
                                └─────────────┘
```

#### 请求处理流程

```
1. 用户建立 SSE 连接 → LB 分配到 SSE 节点 B
   SSE 节点 B:
     - 注册到连接注册表
     - 订阅 Redis Pub/Sub 频道 sse:session:{sessionId}

2. 用户发送聊天消息 → POST 到 API 集群
   API 服务:
     - 保存消息到 DB
     - 将任务放入队列 → Worker

3. Worker 消费任务 → 调用 LLM 推理
   Worker:
     - 逐 token 发布到 Redis:
       PUBLISH sse:session:{sessionId} → {"token": "你"}
       XADD sse:stream:{sessionId} → {"token": "你"}  (持久化)

4. SSE 节点 B 收到 Pub/Sub 消息 → 写入用户 SSE 连接
```

#### 关键组件设计

| 组件 | 职责 | 技术选型 | 扩展方式 |
|------|------|---------|---------|
| SSE 网关 | 维持长连接、消息转发 | Node.js / Go | 按连接数自动扩缩 |
| API 服务 | 业务逻辑、任务派发 | Python / Go | 无状态水平扩展 |
| Worker | LLM 调用、事件发布 | Python (async) | 按任务队列深度扩缩 |
| 消息总线 | Pub/Sub + 持久化 | Redis Cluster | 分片扩展 |
| 连接注册表 | 会话-节点映射 | Redis Hash | 与消息总线共用集群 |

#### 高可用保障

- **SSE 网关无状态**：宕机后用户自动重连到其他节点，配合 Last-Event-ID 无损恢复
- **Redis Cluster**：主从复制 + 自动 failover
- **Worker 幂等**：相同任务重复执行结果一致
- **优雅降级**：连接数 > 80% 时启动 token 合并，> 95% 时拒绝新连接

#### 面试追问

- **问：SSE 网关用 Node.js 还是 Go？**
  答：Go 更适合大规模长连接（goroutine 轻量、GC 压力小），Node.js 更适合快速开发。超过 5 万连接/节点建议 Go。
- **问：Redis Cluster 的 Pub/Sub 有什么坑？**
  答：Redis Cluster 的 Pub/Sub 会广播到所有节点（非分片），大量频道时可能造成带宽压力。解决方案：使用 Sharded Pub/Sub（Redis 7.0+）按频道名哈希到对应分片。
- **问：如果 LLM 推理服务延迟很高（30 秒+），SSE 连接会超时吗？**
  答：不会，因为 SSE 连接在等待 LLM 期间持续接收心跳（每 15 秒一次 `: heartbeat\n\n`），保持连接活跃。LLM 响应到达后才开始推送 tokens。

</details>

---

### Q11: 跨区域 SSE 高可用架构设计

<details>
<summary>参考答案</summary>

**千万级 DAU 需要多区域 Active-Active 部署。核心原则是"就近接入、本地推理、跨区域元数据同步"——用户连接和 LLM 推理在同一区域完成（避免跨区延迟），只同步会话元数据以支持区域切换。**

#### 架构图

```
┌──────────────┐
│  DNS 智能解析 │  GeoDNS: 就近接入
└──────┬───────┘
       │
┌──────▼────────────────────┐  ┌────────────────────────────┐
│     区域 A (北京)          │  │     区域 B (上海)           │
│                            │  │                            │
│  CDN 边缘节点 (SSE 透传)   │  │  CDN 边缘节点 (SSE 透传)    │
│         │                  │  │         │                  │
│  ┌──────▼──────┐           │  │  ┌──────▼──────┐           │
│  │  SSE 网关    │           │  │  │  SSE 网关    │           │
│  │  (20 节点)   │           │  │  │  (20 节点)   │           │
│  │  25 万连接   │           │  │  │  25 万连接   │           │
│  └──────┬──────┘           │  │  └──────┬──────┘           │
│  ┌──────▼──────┐           │  │  ┌──────▼──────┐           │
│  │Redis Cluster│◄──────────────►│Redis Cluster │           │
│  │ (6 节点)    │  跨区域同步 │  │  │ (6 节点)    │           │
│  └──────┬──────┘           │  │  └──────┬──────┘           │
│  ┌──────▼──────┐           │  │  ┌──────▼──────┐           │
│  │Worker + GPU │           │  │  │Worker + GPU  │           │
│  └─────────────┘           │  │  └──────────────┘           │
└────────────────────────────┘  └────────────────────────────┘
```

#### 三大设计原则

| 原则 | 说明 | 实现方式 |
|------|------|---------|
| **就近接入** | 用户连接到地理最近的区域 | GeoDNS + Anycast |
| **本地闭环** | SSE 连接、LLM 推理在同一区域 | 避免跨区网络延迟（30-100ms） |
| **元数据同步** | 会话元数据跨区域复制 | Redis 跨区域复制 / Kafka MirrorMaker |

#### 跨区域需要同步什么？

| 数据类型 | 是否跨区域同步 | 原因 |
|---------|--------------|------|
| SSE 连接状态 | ❌ 否 | 连接是区域内的，跨区域没意义 |
| 事件流数据 | ❌ 否 | 实时性要求高，跨区延迟不可接受 |
| 用户会话元数据 | ✅ 是 | 用户切换区域时需要恢复会话上下文 |
| 对话历史 | ✅ 是 | 任何区域都能展示完整对话 |
| 连接注册表 | ❌ 否 | 区域内路由即可 |

#### 区域故障转移流程

```
1. 区域 A 整体不可用 💥
2. DNS 健康检查检测到区域 A 故障 (~30 秒)
3. DNS 将区域 A 的用户切换到区域 B
4. 用户 SSE 重连 → 连接到区域 B
5. 区域 B 从同步的元数据中恢复用户会话
6. 新的 LLM 请求在区域 B 本地处理

RTO (恢复时间): 30-60 秒
RPO (数据丢失): 取决于元数据同步延迟 (~1 秒)
```

#### 面试追问

- **问：跨区域 Redis 同步用什么方案？**
  答：三种选择：1）Redis 企业版的 Active-Active Geo-Replication（最简单）；2）Kafka MirrorMaker 做事件中继；3）自建 CDC 管道。推荐方案 1 或 2。
- **问：如果用户在北京发消息，但 LLM 只在上海部署怎么办？**
  答：这是 GPU 资源受限时的常见场景。可以在北京区域只部署 SSE 网关 + API 服务，LLM 请求通过专线路由到上海。但要注意跨区延迟会增加首 token 时间。
- **问：Active-Active 和 Active-Passive 怎么选？**
  答：< 500 万 DAU 用 Active-Passive（一个区域主用，另一个备用），运维简单。> 500 万 DAU 用 Active-Active（两个区域同时服务），资源利用率更高。

</details>

---

### Q12: 分布式 SSE 中如何保证事件有序投递？

<details>
<summary>参考答案</summary>

**AI 回复的 tokens 必须严格有序（"你好世界" ≠ "界世好你"）。有序保证需要在三个层级同时实现：生产者端串行发送、消息总线分区有序、消费者端序列号校验。**

#### 三层有序保证

```
          有序保证链路
┌──────────┐    ┌──────────────┐    ┌──────────────┐
│ 生产者端  │───→│  消息总线     │───→│  消费者端     │
│ 串行发送  │    │  分区/频道有序 │    │  序列号校验   │
└──────────┘    └──────────────┘    └──────────────┘

Layer 1: 同一 session 的 tokens 由同一 Worker 线程串行发布
Layer 2: Redis Pub/Sub 单频道有序；Kafka 同分区有序
Layer 3: 每个事件携带递增序列号，消费者检测并重排
```

| 层级 | 保证方式 | 失败场景 |
|------|---------|---------|
| **生产者** | 单会话单线程串行发送 | Worker 故障后换 Worker，需保证序列号延续 |
| **消息总线** | 频道/分区级有序 | Redis 主从切换可能丢最后几条消息 |
| **消费者** | 序列号 + 乱序缓冲区 | 缓冲区有上限，极端乱序时可能超限 |

#### 消费者端乱序重排实现

```python
class OrderedEventConsumer:
    """带顺序校验的事件消费者"""

    def __init__(self):
        self.expected_seq = 1
        self.buffer: dict[int, dict] = {}  # 乱序缓冲区

    async def consume(self, event: dict) -> list[dict]:
        seq = event["seq"]

        if seq == self.expected_seq:
            # 顺序正确，直接输出
            result = [event]
            self.expected_seq += 1
            # 检查缓冲区中是否有后续事件可以连续输出
            while self.expected_seq in self.buffer:
                result.append(self.buffer.pop(self.expected_seq))
                self.expected_seq += 1
            return result

        elif seq > self.expected_seq:
            # 收到未来事件，暂存缓冲区
            self.buffer[seq] = event
            return []

        else:
            # 收到过期事件（重复），丢弃
            return []
```

#### 为什么消息总线有序，还需要消费者端校验？

| 场景 | 可能导致乱序的原因 |
|------|-------------------|
| **Worker 重试** | Worker A 发送 evt-5 后崩溃，Worker B 接手时可能先发 evt-6 再补发 evt-5 |
| **Redis 主从切换** | 主节点故障，从节点可能丢失最后几条未同步的消息 |
| **网络抖动** | TCP 层面不会乱序，但重连后 replay 的消息可能与实时消息交错 |
| **多频道合并** | 如果一个用户同时有多个事件源（如系统通知 + AI 回复） |

#### 事件 ID 设计最佳实践

```
格式: {session_id}-{sequence}
示例: sess_abc123-001, sess_abc123-002, sess_abc123-003

要求:
  - session 内单调递增
  - 全局唯一（session_id 保证跨会话唯一）
  - 可排序（数值比较确定顺序）
```

#### 面试追问

- **问：Kafka 能保证全局有序吗？**
  答：不能。Kafka 只保证分区内有序。要保证单用户有序，需要将同一用户的消息路由到同一分区（按 user_id 或 session_id 做 partition key）。
- **问：如果缓冲区中等不到某个序列号的事件怎么办？**
  答：设置超时机制（如 5 秒）。超时后认为该事件丢失，跳过该序列号，继续处理后续事件，同时上报告警。客户端可以请求服务端补发。

</details>

---

### Q13: 场景设计：为 AI 编程助手（类 GitHub Copilot）设计 SSE 流式推送基础设施

<details>
<summary>参考答案</summary>

**AI 编程助手的 SSE 推送与普通 Chatbot 有显著不同：延迟敏感（开发者不愿等）、多流并发（内联补全 + Chat + 代码解释同时进行）、内容结构化（代码块需要完整才有意义）。**

#### 需求分析

| 维度 | Chatbot | AI 编程助手 | 差异影响 |
|------|---------|-----------|---------|
| **延迟容忍度** | 1-2 秒首 token 可接受 | < 200ms 期望 | 需要更近的推理节点 |
| **并发流数量** | 通常 1 个 | 3-5 个并发 | 连接复用更重要 |
| **内容语义** | 自然语言，按字可渲染 | 代码，半行代码不可渲染 | 需要语义级分块 |
| **取消频率** | 低 | 极高（用户继续打字即取消） | 快速取消机制关键 |
| **会话生命周期** | 分钟级 | 小时级（开发全天） | 连接稳定性更重要 |

#### 架构设计

```
┌──────────────────────────────────────────────────────────┐
│                  AI 编程助手 SSE 架构                      │
│                                                          │
│  ┌────────┐                                              │
│  │  IDE   │   单一 SSE 连接（多路复用）                    │
│  │ Client │──SSE──→ 边缘 PoP ──→ SSE 网关               │
│  │        │         (< 20ms)       │                     │
│  └────────┘                        │                     │
│                                    │ 按 stream_id 分发   │
│                              ┌─────▼─────┐               │
│                              │  消息路由   │               │
│                              │  (Redis)   │               │
│                              └─────┬─────┘               │
│                    ┌───────────────┼───────────┐         │
│                    ▼               ▼           ▼         │
│              ┌──────────┐  ┌──────────┐ ┌──────────┐    │
│              │补全 Worker│  │Chat Worker│ │解释 Worker│    │
│              │(轻量模型) │  │(大模型)   │ │(中等模型)  │    │
│              └──────────┘  └──────────┘ └──────────┘    │
└──────────────────────────────────────────────────────────┘
```

#### 多流复用协议设计

```
单个 SSE 连接承载多个逻辑流：

event: completion
id: stream_1-001
data: {"stream_id":"stream_1","type":"inline","content":"func"}

event: completion
id: stream_1-002
data: {"stream_id":"stream_1","type":"inline","content":"tion hello()"}

event: chat
id: stream_2-001
data: {"stream_id":"stream_2","type":"chat","content":"这个函数"}

event: completion
id: stream_1-003
data: {"stream_id":"stream_1","type":"inline","content":" {\n  return"}

event: done
id: stream_1-done
data: {"stream_id":"stream_1","type":"inline","status":"complete"}
```

#### 快速取消机制

```typescript
// 用户继续打字 → 取消当前补全 → 发起新补全
class CompletionManager {
  private activeStreams = new Map<string, AbortController>();

  async requestCompletion(context: CodeContext): Promise<void> {
    // 取消之前的补全请求
    const prevController = this.activeStreams.get('inline');
    if (prevController) {
      prevController.abort();
      // 通知服务端取消（通过独立 HTTP 请求）
      await fetch(`/api/cancel/${prevController.streamId}`, { method: 'POST' });
    }

    const controller = new AbortController();
    this.activeStreams.set('inline', controller);

    // 新的补全请求
    await fetch('/api/complete', {
      method: 'POST',
      body: JSON.stringify({ context, stream_id: crypto.randomUUID() }),
      signal: controller.signal,
    });
  }
}
```

#### 代码级分块策略

```python
# 不按 token 分块，而是按语义单元分块
class CodeChunker:
    """将 LLM 输出按代码语义分块"""

    def __init__(self):
        self.buffer = ""

    def add_token(self, token: str) -> list[str]:
        self.buffer += token
        chunks = []

        # 在语义边界处输出：行末、分号、花括号
        while True:
            boundary = self._find_boundary(self.buffer)
            if boundary == -1:
                break
            chunks.append(self.buffer[:boundary + 1])
            self.buffer = self.buffer[boundary + 1:]

        return chunks  # 每个 chunk 是一个完整的代码行或语句

    def _find_boundary(self, text: str) -> int:
        for delim in ['\n', ';', '{', '}']:
            idx = text.find(delim)
            if idx != -1:
                return idx
        return -1
```

#### 面试追问

- **问：为什么不用多个 SSE 连接而是多流复用？**
  答：HTTP/1.1 每域名限制 6 个连接，IDE 可能同时需要补全、Chat、解释、诊断等多个流。复用单连接避免连接数限制，且减少 TCP 握手开销。
- **问：边缘 PoP 在这里的作用是什么？**
  答：TCP 连接终结在边缘 PoP，减少 TLS 握手延迟。SSE 长连接在边缘维持，内部通过持久连接转发到源站，首 token 延迟降低 30-100ms。
- **问：对比 GitHub Copilot 的真实实现，你的设计有什么不同？**
  答：Copilot 实际使用 HTTP POST + 流式响应（非 EventSource），因为 IDE 插件不受浏览器 6 连接限制。本设计偏向 Web IDE 场景。

</details>

---

### Q14: 场景设计：部署期间 SSE 连接断开，设计零停机部署方案

<details>
<summary>参考答案</summary>

**SSE 长连接让滚动更新变得棘手——强制关闭连接导致用户体验中断。零停机部署的核心是 Connection Draining（连接排空）：新请求路由到新 Pod，旧 Pod 等待现有连接自然关闭或超时后才销毁。**

#### 问题分析

```
常规滚动更新的问题：

时刻 T0: Pod-v1 持有 1000 个 SSE 连接
时刻 T1: 部署 v2，K8s 开始终止 Pod-v1
时刻 T2: Pod-v1 收到 SIGTERM
时刻 T3: 30 秒后（terminationGracePeriodSeconds）强制 SIGKILL
         → 1000 个 SSE 连接全部断开！
         → 1000 个用户同时看到"连接中断"

问题：
1. 大量用户同时断线 → 体验差
2. 同时重连 → 重连风暴 → 可能压垮新 Pod
3. 正在推送的 LLM 回复中断 → 数据不完整
```

#### 零停机方案：Connection Draining

```
┌──────────────────────────────────────────────────────────────┐
│              零停机部署流程                                     │
│                                                              │
│  T0: 部署开始                                                 │
│  ┌──────────────────────────────────────────────────┐        │
│  │ LB 路由表: Pod-v1 (1000 连接)                      │        │
│  └──────────────────────────────────────────────────┘        │
│                                                              │
│  T1: 启动新 Pod                                               │
│  ┌──────────────────────────────────────────────────┐        │
│  │ LB 路由表: Pod-v1 (1000 连接) + Pod-v2 (0 连接)    │        │
│  └──────────────────────────────────────────────────┘        │
│                                                              │
│  T2: Pod-v2 就绪，标记 Pod-v1 不接受新连接                     │
│  ┌──────────────────────────────────────────────────┐        │
│  │ LB 路由表: Pod-v1 (1000 旧连接, 不接受新连接)       │        │
│  │            Pod-v2 (接受新连接)                      │        │
│  └──────────────────────────────────────────────────┘        │
│                                                              │
│  T3: Pod-v1 开始 Drain                                       │
│  - 向所有 SSE 连接发送 retry: 0 + 关闭事件                     │
│  - 等待正在进行的 LLM 推送完成                                 │
│  - 每 5 秒关闭 100 个空闲连接（分批断开避免风暴）               │
│                                                              │
│  T4: Pod-v1 所有连接关闭（或超时），Pod-v1 销毁                 │
│  ┌──────────────────────────────────────────────────┐        │
│  │ LB 路由表: Pod-v2 (全部连接)                        │        │
│  └──────────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────────┘
```

#### Kubernetes 配置

```yaml
apiVersion: apps/v1
kind: Deployment
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1         # 先启动新 Pod
      maxUnavailable: 0   # 不允许同时有 Pod 不可用
  template:
    spec:
      terminationGracePeriodSeconds: 300  # 5 分钟优雅终止
      containers:
        - name: sse-gateway
          lifecycle:
            preStop:
              exec:
                command:
                  - /bin/sh
                  - -c
                  - "curl -X POST localhost:8080/admin/drain && sleep 270"
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 8080
            periodSeconds: 5
```

#### 服务端 Drain 处理

```python
class GracefulShutdown:
    """SSE 网关优雅关闭处理器"""

    def __init__(self):
        self.draining = False
        self.active_connections: list[SSEConnection] = []

    async def start_drain(self):
        """开始连接排空"""
        self.draining = True

        # 1. 从 LB 摘除（readiness probe 返回 false）
        self.ready = False

        # 2. 等待正在进行的 LLM 推送完成（最多等 60 秒）
        active_pushes = [c for c in self.active_connections if c.is_pushing]
        await asyncio.wait_for(
            asyncio.gather(*[c.wait_push_complete() for c in active_pushes]),
            timeout=60,
        )

        # 3. 分批关闭空闲连接（每批 100 个，间隔 5 秒）
        idle_connections = [c for c in self.active_connections if not c.is_pushing]
        for batch in chunks(idle_connections, 100):
            for conn in batch:
                # 发送重连提示：让客户端立即重连到新 Pod
                await conn.send_event({
                    "event": "reconnect",
                    "data": json.dumps({"reason": "server_upgrade"}),
                })
                await conn.close()
            await asyncio.sleep(5)  # 分批间隔，避免重连风暴

    async def handle_new_connection(self, request):
        """Drain 模式下拒绝新连接"""
        if self.draining:
            return Response(status=503, headers={"Retry-After": "1"})
        # 正常处理...
```

#### 客户端配合

```typescript
// 客户端处理 reconnect 事件
eventSource.addEventListener('reconnect', (event) => {
  const data = JSON.parse(event.data);
  if (data.reason === 'server_upgrade') {
    // 立即重连（不等默认的 3 秒重试间隔）
    eventSource.close();
    // 短暂随机延迟，避免所有客户端同时重连
    const jitter = Math.random() * 2000;  // 0-2 秒随机抖动
    setTimeout(() => {
      connectSSE(lastEventId);  // 带 Last-Event-ID 重连
    }, jitter);
  }
});
```

#### 关键指标

| 指标 | 目标值 | 监控方式 |
|------|--------|---------|
| 部署期间连接断开数 | 0（理想）/ < 1%（可接受） | Prometheus counter |
| 重连风暴峰值 | < 正常重连率 5x | 每分钟重连数 |
| Drain 耗时 | < 5 分钟 | 部署流水线计时 |
| 部署期间事件丢失 | 0 | 投递率监控 |

#### 面试追问

- **问：如果 Drain 超时了（5 分钟内没排空），怎么办？**
  答：强制关闭剩余连接。客户端通过 EventSource 自动重连 + Last-Event-ID 恢复。这是可接受的降级——比无限等待好。
- **问：蓝绿部署和滚动更新哪个对 SSE 更友好？**
  答：蓝绿部署更友好。可以先启动完整的绿色环境，切换流量后给蓝色环境充足的 Drain 时间。但资源成本翻倍。
- **问：除了 Connection Draining，还有什么方案？**
  答：1）客户端主动健康检查：定期请求 /health，发现 draining 时主动重连；2）WebSocket 的 Close Frame 可以携带原因码，比 SSE 的 reconnect 事件更标准化。

</details>
