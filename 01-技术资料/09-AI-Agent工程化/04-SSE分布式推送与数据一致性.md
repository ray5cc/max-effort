# SSE 分布式推送与数据一致性

> 深入解析 SSE 在微服务架构和集群部署下的推送设计、持久化存储与数据一致性保障，支撑高并发和高可用场景

## 相关链接

- 对应面试题：[SSE分布式推送与数据一致性面试题](../../02-面试指南/09-AI-Agent工程化面试/04-SSE分布式推送与数据一致性面试题.md)
- 相关技术资料：[流式传输与实时通信](./03-流式传输与实时通信.md)

## TL;DR 速览

- **单节点 SSE 无法水平扩展**：用户连接绑定在某一台服务器上，集群部署后"推送找不到连接"是核心痛点
- **消息总线是分布式 SSE 的枢纽**：通过 Redis Pub/Sub、Kafka 或 NATS 将事件从生产者扇出到持有连接的节点
- **Channel-per-Session 模式**：每个用户会话对应一个独立的消息通道，实现精准路由，避免广播风暴
- **事件持久化支撑断线重连**：Redis Streams 或 Kafka 作为事件日志，配合 `Last-Event-ID` 实现无损恢复
- **幂等消费 + 有序投递**：通过事件 ID 去重和分区有序保证数据一致性
- **背压控制防止雪崩**：慢消费者检测 + 缓冲区上限 + 丢弃策略，保护整体系统稳定性
- **多节点故障转移**：连接注册表 + 健康检查 + 自动重连，实现秒级故障切换
- **生产架构分层演进**：从 10 万到 1000 万 DAU，从 Sticky Session 到消息总线到跨区域 Active-Active

## 目录

1. [为什么需要分布式 SSE 推送？](#1-为什么需要分布式-sse-推送)
2. [SSE 在微服务架构中的挑战](#2-sse-在微服务架构中的挑战)
3. [分布式推送架构设计](#3-分布式推送架构设计)
4. [SSE 事件持久化存储](#4-sse-事件持久化存储)
5. [数据一致性保障](#5-数据一致性保障)
6. [高并发设计](#6-高并发设计)
7. [高可用设计](#7-高可用设计)
8. [监控与运维](#8-监控与运维)
9. [生产实践案例：AI Chatbot 万级到千万级 DAU](#9-生产实践案例ai-chatbot-万级到千万级-dau)
10. [常见陷阱与最佳实践](#10-常见陷阱与最佳实践)

---

## 1. 为什么需要分布式 SSE 推送？

### 1.1 单节点 SSE 的天花板

**生活类比**：想象一家只有一个服务员的餐厅。当客人少时，服务员可以逐桌通知"您的菜好了"；但当客人超过 100 桌，服务员根本跑不过来。更糟糕的是，如果这个服务员请病假，所有客人都收不到通知了。

单节点 SSE 在生产环境会遇到三个硬性瓶颈：

| 瓶颈维度 | 具体表现 | 量化指标 |
|----------|---------|---------|
| **连接数上限** | 每个 SSE 连接占用一个 TCP socket，受操作系统文件描述符限制 | 单进程默认 1024，调优后约 65K |
| **内存消耗** | 每个连接需要维护读写缓冲区和应用层状态 | 每连接约 10-50 KB，1 万连接 ≈ 100-500 MB |
| **单点故障** | 服务器宕机意味着所有连接断开，所有推送中断 | MTTR（恢复时间）直接影响用户体验 |

```
┌─────────────────────────────────────────────────────┐
│                  单节点 SSE 架构                      │
│                                                     │
│  ┌──────┐  SSE   ┌──────────────┐   ┌───────────┐  │
│  │用户 A│───────→│              │   │           │  │
│  └──────┘        │              │   │  LLM      │  │
│  ┌──────┐  SSE   │  SSE 服务器   │←──│  推理服务  │  │
│  │用户 B│───────→│  (单节点)     │   │           │  │
│  └──────┘        │              │   └───────────┘  │
│  ┌──────┐  SSE   │  连接数上限！  │                  │
│  │用户 C│───────→│  单点故障！    │                  │
│  └──────┘        └──────────────┘                   │
└─────────────────────────────────────────────────────┘
    问题：服务器挂了，所有用户都断连
```

### 1.2 真实场景：AI Chatbot 的集群部署困境

一个典型的 AI Chatbot 请求流程：

1. 用户在浏览器发起聊天请求
2. 负载均衡器将 HTTP 请求路由到后端实例 A
3. 实例 A 将请求转发给 LLM 推理服务
4. LLM 推理服务产生 streaming tokens
5. **问题来了**：tokens 应该推送给用户，但用户的 SSE 连接可能在实例 B 上！

```
┌──────┐     ┌────────────┐     ┌──────────┐     ┌───────────┐
│      │ SSE │            │     │ 实例 A    │     │           │
│ 用户 │────→│ 负载均衡器  │────→│ (处理请求)│────→│ LLM 推理  │
│      │     │            │     └──────────┘     │ 服务      │
│      │     │            │     ┌──────────┐     │           │
│      │     │            │────→│ 实例 B    │     │  tokens   │
│      │     │            │     │ (持有SSE) │←─ ─ ─ ─ ─ ─ ─?│
└──────┘     └────────────┘     └──────────┘     └───────────┘
                                     ↑
                          tokens 要怎么到达这里？
```

**这就是分布式 SSE 的核心挑战**：在多实例部署下，**事件的生产者和连接的持有者不在同一个节点**。

### 1.3 分布式 SSE 要解决的三大问题

| 问题 | 描述 | 类比 |
|------|------|------|
| **路由问题** | 事件如何找到持有目标连接的节点？ | 快递员如何找到收件人住在哪栋楼？ |
| **持久化问题** | 用户断线重连后如何补发丢失的事件？ | 你错过了几条语音消息，如何回放？ |
| **一致性问题** | 如何保证事件不丢、不重、有序？ | 连续剧要按集数顺序看，不能跳集、重播 |

---

## 2. SSE 在微服务架构中的挑战

### 2.1 负载均衡器与长连接的矛盾

**类比**：普通餐厅的领位员（负载均衡器）按"哪桌空闲就坐哪桌"分配座位。但 SSE 长连接就像"包厢客人"——一坐就是几个小时。领位员按空闲率分配，结果所有新客人都被引到同一个包厢（因为其他包厢都被长连接占满了）。

**问题分析**：

```
┌───────────────────────────────────────────────────────────┐
│             负载均衡器的 SSE 困境                           │
│                                                           │
│  ┌────────────┐                                           │
│  │ L7 负载均衡 │    Round Robin 策略                       │
│  │            │                                           │
│  │ 请求 1 ───────→ 实例 A (SSE 长连接 → 一直占用)          │
│  │ 请求 2 ───────→ 实例 B (SSE 长连接 → 一直占用)          │
│  │ 请求 3 ───────→ 实例 C (SSE 长连接 → 一直占用)          │
│  │ 请求 4 ───────→ 实例 A (已有大量连接，负载不均!)         │
│  └────────────┘                                           │
│                                                           │
│  问题 1: 活跃连接数分布不均                                 │
│  问题 2: 健康检查无法感知连接级别的负载                       │
│  问题 3: 滚动更新时大量连接被强制断开                        │
└───────────────────────────────────────────────────────────┘
```

**L4 vs L7 负载均衡的影响**：

| 层级 | 行为 | SSE 影响 |
|------|------|---------|
| **L4 (TCP)** | 基于 IP/端口转发，不解析 HTTP | 连接建立后固定绑定到一个后端，无法中途切换 |
| **L7 (HTTP)** | 解析 HTTP 头部，支持路由规则 | 可以根据 Cookie/Header 做会话亲和，但增加代理开销 |

### 2.2 Service Mesh 下的 SSE 陷阱

在 Service Mesh（如 Istio/Envoy）环境中，SSE 面临额外的挑战：

**超时配置**：Sidecar 代理默认的请求超时（通常 15-60 秒）会杀死 SSE 长连接。必须将 SSE 路由的超时设为 0 或极大值。

**重试机制冲突**：Service Mesh 的自动重试逻辑会在 SSE 连接中断时重新发起请求，可能导致重复事件或连接风暴。

```yaml
# Istio VirtualService 配置示例 — SSE 路由特殊处理
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
spec:
  http:
    - match:
        - uri:
            prefix: /api/sse
      route:
        - destination:
            host: sse-service
      timeout: 0s           # 禁用超时
      retries:
        attempts: 0         # 禁用自动重试
```

### 2.3 会话亲和性（Sticky Sessions）的代价

**什么是 Sticky Sessions？** 通过 Cookie 或 IP Hash 将同一用户的所有请求路由到同一个后端实例。

```
┌──────┐     ┌────────────────┐     ┌──────────┐
│      │     │  负载均衡器      │     │ 实例 A   │
│用户 A│────→│  Cookie: srv=A  │────→│ (固定)   │
│      │     │                │     └──────────┘
│      │     │                │     ┌──────────┐
│用户 B│────→│  Cookie: srv=B  │────→│ 实例 B   │
│      │     │                │     │ (固定)   │
└──────┘     └────────────────┘     └──────────┘
```

**Sticky Sessions 的优缺点**：

| 维度 | 优点 | 缺点 |
|------|------|------|
| 实现复杂度 | 简单，负载均衡器原生支持 | — |
| 连接路由 | 请求和 SSE 连接在同一实例 | — |
| 负载均衡 | — | 热点问题：大用户绑定的实例负载过高 |
| 水平扩展 | — | 扩容时已有连接不会迁移 |
| 故障恢复 | — | 实例宕机后需要重新建立亲和关系 |
| 滚动更新 | — | 需要 connection draining，更新变慢 |

**结论**：Sticky Sessions 适合小规模部署（< 10 个实例），但不是分布式 SSE 的长远方案。

---

## 3. 分布式推送架构设计

### 3.1 Fan-out 模式概述

**类比**：广播电台模式。电台（事件生产者）只需要向发射塔（消息总线）发送信号一次，所有收音机（SSE 节点）都能收到。每个收音机只需要将信号转发给正在收听的听众（用户连接）。

```
┌──────────────────────────────────────────────────────────────┐
│                    Fan-out 推送架构                            │
│                                                              │
│  ┌───────────┐    publish    ┌──────────────┐                │
│  │ 事件生产者 │──────────────→│              │                │
│  │ (Worker)  │              │  消息总线     │                │
│  └───────────┘              │  (Redis/     │                │
│  ┌───────────┐    publish   │   Kafka/     │                │
│  │ 事件生产者 │──────────────→│   NATS)      │                │
│  │ (Worker)  │              │              │                │
│  └───────────┘              └──────┬───────┘                │
│                                    │ subscribe               │
│                    ┌───────────────┼───────────────┐         │
│                    ▼               ▼               ▼         │
│              ┌──────────┐   ┌──────────┐   ┌──────────┐     │
│              │ SSE 节点 A│   │ SSE 节点 B│   │ SSE 节点 C│     │
│              │ [连接1,2] │   │ [连接3,4] │   │ [连接5,6] │     │
│              └──────────┘   └──────────┘   └──────────┘     │
│                   │              │              │            │
│                   ▼              ▼              ▼            │
│              用户 1,2        用户 3,4        用户 5,6         │
└──────────────────────────────────────────────────────────────┘
```

Fan-out 有两种主要变体：

| 模式 | 描述 | 适用场景 |
|------|------|---------|
| **广播 Fan-out** | 所有节点都收到所有事件，本地过滤 | 全局通知、系统公告 |
| **定向 Fan-out** | 只有持有目标连接的节点收到事件 | 用户级推送（AI 回复、个人消息） |

### 3.2 消息总线方案对比

#### Redis Pub/Sub

**特点**：火即忘（Fire-and-Forget），无持久化，订阅者离线时消息丢失。

```python
# 事件生产者（Worker 端）
import redis.asyncio as redis

async def publish_sse_event(
    redis_client: redis.Redis,
    session_id: str,
    event_data: dict
):
    """将事件发布到用户会话专属频道"""
    channel = f"sse:session:{session_id}"
    await redis_client.publish(channel, json.dumps({
        "id": event_data["event_id"],
        "event": event_data["type"],      # "token" | "done" | "error"
        "data": event_data["payload"],
        "timestamp": time.time()
    }))
```

```python
# SSE 节点（连接持有者）
async def subscribe_session_events(
    redis_client: redis.Redis,
    session_id: str
):
    """订阅用户会话频道，将事件转发到 SSE 连接"""
    pubsub = redis_client.pubsub()
    channel = f"sse:session:{session_id}"
    await pubsub.subscribe(channel)

    async for message in pubsub.listen():
        if message["type"] == "message":
            event = json.loads(message["data"])
            yield format_sse_event(event)
```

#### Kafka / 持久化消息队列

**特点**：持久化、有序、可重放，但延迟略高（毫秒级 vs 微秒级）。

```
┌──────────┐   produce   ┌─────────────────────────────┐
│  Worker  │────────────→│  Topic: sse-events           │
└──────────┘             │  ┌─────────────────────────┐ │
                         │  │ Partition 0 (user hash) │ │
                         │  │ [e1] [e2] [e3] [e4]     │ │
                         │  └─────────────────────────┘ │
                         │  ┌─────────────────────────┐ │
                         │  │ Partition 1 (user hash) │ │
                         │  │ [e5] [e6] [e7]          │ │
                         │  └─────────────────────────┘ │
                         └──────────────┬──────────────┘
                                        │ consume
                         ┌──────────────┼──────────────┐
                         ▼              ▼              ▼
                    SSE 节点 A     SSE 节点 B     SSE 节点 C
```

#### 方案对比

| 维度 | Redis Pub/Sub | Redis Streams | Kafka | NATS JetStream |
|------|--------------|---------------|-------|----------------|
| **延迟** | 微秒级 | 微秒级 | 毫秒级 | 微秒级 |
| **持久化** | ❌ 无 | ✅ 有 | ✅ 有 | ✅ 有 |
| **消息回放** | ❌ 不支持 | ✅ 支持 | ✅ 支持 | ✅ 支持 |
| **有序性** | ✅ 单频道有序 | ✅ 流内有序 | ✅ 分区有序 | ✅ 流内有序 |
| **运维复杂度** | 低 | 低 | 高 | 中 |
| **适合场景** | 实时推送（可容忍丢失） | 需要回放的推送 | 大规模事件溯源 | 低延迟 + 持久化 |

### 3.3 连接注册表（Connection Registry）

**类比**：酒店前台的房客登记簿。每位房客（SSE 连接）入住时登记在哪个房间（哪个节点），退房时注销。有人找房客时，前台一查登记簿就知道该去哪个房间找。

```python
class ConnectionRegistry:
    """基于 Redis 的分布式连接注册表"""

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
        """用户断开 SSE 连接时注销"""
        await self.redis.delete(f"sse:registry:{session_id}")

    async def heartbeat(self, session_id: str):
        """续期注册信息，防止过期"""
        await self.redis.expire(f"sse:registry:{session_id}", self.ttl)

    async def lookup(self, session_id: str) -> dict | None:
        """查询连接所在节点"""
        return await self.redis.hgetall(f"sse:registry:{session_id}")
```

### 3.4 Channel-per-Session 模式

**这是分布式 SSE 推送的核心设计模式**。每个用户会话对应一个专属的消息通道：

```
┌────────────────────────────────────────────────────────────────┐
│              Channel-per-Session 完整流程                       │
│                                                                │
│  1. 用户建立 SSE 连接                                           │
│     浏览器 ──SSE──→ 负载均衡器 ──→ SSE 节点 B                    │
│                                   │                            │
│  2. SSE 节点 B 注册连接 + 订阅频道                               │
│     Registry: {session_123: node_B}                            │
│     Subscribe: sse:session:session_123                         │
│                                                                │
│  3. 用户发送聊天请求（普通 HTTP POST）                            │
│     浏览器 ──POST──→ 负载均衡器 ──→ Worker 节点 A                │
│                                                                │
│  4. Worker A 处理请求，调用 LLM                                  │
│     Worker A ──→ LLM 推理服务 ──→ streaming tokens              │
│                                                                │
│  5. Worker A 将 tokens 发布到用户频道                             │
│     Worker A ──publish──→ Redis sse:session:session_123         │
│                                                                │
│  6. SSE 节点 B 收到消息，推送给用户                               │
│     Redis ──→ SSE 节点 B ──SSE──→ 浏览器                        │
└────────────────────────────────────────────────────────────────┘
```

**TypeScript 实现示例**：

```typescript
// SSE 连接处理器（Node.js）
import { Redis } from 'ioredis';

interface SSEEvent {
  id: string;
  event: string;
  data: string;
}

class SSEConnectionHandler {
  private redis: Redis;
  private subscriber: Redis;
  private nodeId: string;

  constructor(redis: Redis, nodeId: string) {
    this.redis = redis;
    this.subscriber = redis.duplicate();
    this.nodeId = nodeId;
  }

  async handleConnection(
    sessionId: string,
    userId: string,
    res: ServerResponse
  ): Promise<void> {
    // 1. 设置 SSE 响应头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',   // 禁用 Nginx 缓冲
    });

    // 2. 注册连接到注册表
    const registryKey = `sse:registry:${sessionId}`;
    await this.redis.hset(registryKey, {
      node_id: this.nodeId,
      user_id: userId,
      connected_at: Date.now().toString(),
    });
    await this.redis.expire(registryKey, 60);

    // 3. 订阅用户频道
    const channel = `sse:session:${sessionId}`;
    await this.subscriber.subscribe(channel);

    // 4. 心跳定时器
    const heartbeatTimer = setInterval(() => {
      res.write(': heartbeat\n\n');
      this.redis.expire(registryKey, 60);
    }, 15000);

    // 5. 消息转发
    this.subscriber.on('message', (ch: string, message: string) => {
      if (ch === channel) {
        const event: SSEEvent = JSON.parse(message);
        res.write(`id: ${event.id}\n`);
        res.write(`event: ${event.event}\n`);
        res.write(`data: ${event.data}\n\n`);
      }
    });

    // 6. 连接关闭时清理
    res.on('close', async () => {
      clearInterval(heartbeatTimer);
      await this.subscriber.unsubscribe(channel);
      await this.redis.del(registryKey);
    });
  }
}
```

```typescript
// Worker 端：将 LLM 响应推送到用户频道
class LLMResponsePublisher {
  private redis: Redis;

  async publishTokens(
    sessionId: string,
    llmStream: AsyncIterable<string>
  ): Promise<void> {
    const channel = `sse:session:${sessionId}`;
    let sequence = 0;

    for await (const token of llmStream) {
      const event: SSEEvent = {
        id: `${sessionId}-${++sequence}`,
        event: 'token',
        data: JSON.stringify({ content: token, seq: sequence }),
      };
      await this.redis.publish(channel, JSON.stringify(event));
    }

    // 发送完成信号
    await this.redis.publish(channel, JSON.stringify({
      id: `${sessionId}-${++sequence}`,
      event: 'done',
      data: JSON.stringify({ total_tokens: sequence - 1 }),
    }));
  }
}
```

---

## 4. SSE 事件持久化存储

### 4.1 为什么需要事件持久化？

**类比**：看直播时网络中断了 30 秒，重新连接后，你希望能从断点继续看，而不是错过那 30 秒的内容。事件持久化就是直播平台的"回放缓冲区"。

三个必须持久化的场景：

| 场景 | 说明 | 无持久化的后果 |
|------|------|--------------|
| **断线重连** | 用户网络闪断 3-5 秒 | 丢失中间的 tokens，回复内容不完整 |
| **页面刷新** | 用户刷新浏览器页面 | 已经收到的内容全部丢失 |
| **节点故障转移** | SSE 节点宕机，连接迁移到新节点 | 迁移前后的事件丢失 |

### 4.2 存储选型对比

```
┌─────────────────────────────────────────────────────────┐
│              事件持久化存储选型决策树                       │
│                                                         │
│  需要事件持久化吗？                                       │
│  ├── 否 → Redis Pub/Sub (纯推送，不存储)                  │
│  └── 是                                                  │
│      ├── 保留时长 < 24h？                                 │
│      │   ├── 是 → Redis Streams (内存高效，自动过期)       │
│      │   └── 否                                          │
│      │       ├── 需要无限回放？                            │
│      │       │   ├── 是 → Kafka (磁盘存储，无限保留)       │
│      │       │   └── 否 → PostgreSQL (结构化查询，灵活)    │
│      └── 需要跨区域复制？                                  │
│          ├── 是 → Kafka (原生支持)                         │
│          └── 否 → Redis Streams 或 NATS JetStream         │
└─────────────────────────────────────────────────────────┘
```

#### 详细对比

| 维度 | Redis Streams | Kafka | PostgreSQL |
|------|--------------|-------|-----------|
| **写入延迟** | < 1ms | 2-10ms | 5-20ms |
| **吞吐量** | 10 万/s (单节点) | 百万/s (集群) | 1-5 万/s |
| **保留策略** | MAXLEN / MINID | 时间/大小/紧凑 | 手动分区 + 清理 |
| **查询能力** | 范围查询、消费者组 | Offset 查询 | 全 SQL |
| **持久化** | AOF/RDB | 磁盘日志 | WAL |
| **运维成本** | 低 | 高 | 中 |
| **最佳场景** | 短期事件缓冲 | 大规模事件溯源 | 需要关联查询 |

### 4.3 事件日志设计

**基于 Redis Streams 的事件日志**：

```python
class SSEEventStore:
    """基于 Redis Streams 的 SSE 事件持久化存储"""

    def __init__(self, redis_client, max_events: int = 1000, ttl: int = 3600):
        self.redis = redis_client
        self.max_events = max_events
        self.ttl = ttl

    async def append_event(
        self,
        session_id: str,
        event_type: str,
        data: str,
        event_id: str | None = None,
    ) -> str:
        """追加事件到会话的事件流"""
        stream_key = f"sse:stream:{session_id}"
        entry_id = await self.redis.xadd(
            stream_key,
            {
                "event_id": event_id or str(uuid.uuid4()),
                "event": event_type,
                "data": data,
                "timestamp": str(time.time()),
            },
            maxlen=self.max_events,  # 自动修剪
        )
        await self.redis.expire(stream_key, self.ttl)
        return entry_id

    async def replay_events(
        self,
        session_id: str,
        last_event_id: str = "0-0",
    ) -> list[dict]:
        """从指定位置重放事件（用于断线重连）"""
        stream_key = f"sse:stream:{session_id}"
        entries = await self.redis.xrange(
            stream_key,
            min=f"({last_event_id}",  # 排他性起始 ID
            max="+",
        )
        return [
            {
                "stream_id": entry_id,
                "event_id": fields["event_id"],
                "event": fields["event"],
                "data": fields["data"],
            }
            for entry_id, fields in entries
        ]

    async def get_latest_id(self, session_id: str) -> str | None:
        """获取最新事件 ID"""
        stream_key = f"sse:stream:{session_id}"
        entries = await self.redis.xrevrange(stream_key, count=1)
        return entries[0][0] if entries else None
```

### 4.4 保留策略与事件重放

**保留策略设计**：

| 策略 | Redis Streams 实现 | Kafka 实现 | 适用场景 |
|------|-------------------|-----------|---------|
| **按数量** | `XADD ... MAXLEN 1000` | — | 短对话，限制内存 |
| **按时间** | `XADD ... MINID <timestamp>` | `retention.ms` | 固定过期窗口 |
| **按大小** | 结合 MAXLEN + 监控 | `retention.bytes` | 存储成本敏感 |
| **永久保留** | 不推荐（内存成本高） | `retention.ms=-1` | 审计、合规要求 |

**断线重连的事件重放流程**：

```
┌──────┐                    ┌──────────┐               ┌────────────┐
│ 客户端│                    │ SSE 节点  │               │ Event Store│
└──┬───┘                    └────┬─────┘               └─────┬──────┘
   │                             │                           │
   │ SSE 连接建立                 │                           │
   │ Last-Event-ID: evt-042      │                           │
   │────────────────────────────→│                           │
   │                             │                           │
   │                             │ 查询 evt-042 之后的事件     │
   │                             │──────────────────────────→│
   │                             │                           │
   │                             │ 返回 [evt-043, evt-044,   │
   │                             │       evt-045]            │
   │                             │←──────────────────────────│
   │                             │                           │
   │ event: token                │                           │
   │ id: evt-043                 │                           │
   │ data: {"content": "你"}     │                           │
   │←───────────────────────────│                           │
   │                             │                           │
   │ event: token                │                           │
   │ id: evt-044                 │                           │
   │ data: {"content": "好"}     │                           │
   │←───────────────────────────│                           │
   │                             │                           │
   │ (重放完成，切换到实时推送)      │                           │
   │←── 实时事件流 ──────────────│                           │
   │                             │                           │
```

---

## 5. 数据一致性保障

### 5.1 At-Least-Once 投递语义

**类比**：重要快递的签收机制。快递员送到但没人签收，就第二天再送一次。可能会多送（你已经拿到了但系统没更新），但绝不会不送。

SSE 天然支持 At-Least-Once 语义，通过 `Last-Event-ID` 机制实现：

```python
async def handle_sse_connection(request, response, event_store, redis_sub):
    """支持 At-Least-Once 投递的 SSE 连接处理"""
    session_id = request.params["session_id"]

    # 1. 获取客户端报告的最后接收事件 ID
    last_event_id = request.headers.get("Last-Event-ID", "0-0")

    # 2. 重放丢失的事件（At-Least-Once 的关键步骤）
    missed_events = await event_store.replay_events(session_id, last_event_id)
    for event in missed_events:
        await response.write(format_sse(event))

    # 3. 切换到实时推送
    async for event in redis_sub.listen(f"sse:session:{session_id}"):
        # 同时写入 Event Store（持久化）
        await event_store.append_event(
            session_id, event["event"], event["data"], event["id"]
        )
        await response.write(format_sse(event))
```

### 5.2 幂等消费者设计

**为什么需要幂等？** At-Least-Once 意味着同一事件可能被投递多次，客户端必须能安全地处理重复事件。

```typescript
// 客户端幂等消费者实现
class IdempotentSSEConsumer {
  // 已处理事件 ID 的集合（滑动窗口）
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

  private processEvent(event: MessageEvent): void {
    const data = JSON.parse(event.data);
    switch (event.type) {
      case 'token':
        this.appendToken(data.content);
        break;
      case 'done':
        this.finishResponse();
        break;
      case 'error':
        this.handleError(data);
        break;
    }
  }
}
```

### 5.3 事件顺序保证

**为什么顺序重要？** AI 回复的 tokens 必须按顺序组装："你" → "好" → "，" → "世" → "界"。如果乱序，就变成了乱码。

**顺序保证的层级**：

| 层级 | 保证方式 | 实现 |
|------|---------|------|
| **生产者端** | 单会话单线程发送 | 同一个 session 的 tokens 由同一个 Worker 线程串行发布 |
| **消息总线** | 分区/频道有序 | Redis Pub/Sub 单频道有序；Kafka 同一 Partition 有序 |
| **消费者端** | 序列号校验 | 每个事件携带递增序列号，消费者检测并重排 |

```python
class OrderedEventConsumer:
    """带顺序校验的事件消费者"""

    def __init__(self):
        self.expected_seq = 1
        self.buffer: dict[int, dict] = {}  # 乱序缓冲区

    async def consume(self, event: dict) -> list[dict]:
        """消费事件，返回可按序处理的事件列表"""
        seq = event["seq"]

        if seq == self.expected_seq:
            # 顺序正确，直接输出
            result = [event]
            self.expected_seq += 1

            # 检查缓冲区是否有后续事件
            while self.expected_seq in self.buffer:
                result.append(self.buffer.pop(self.expected_seq))
                self.expected_seq += 1

            return result

        elif seq > self.expected_seq:
            # 收到未来事件，缓冲等待
            self.buffer[seq] = event
            return []

        else:
            # 收到过期事件（重复），丢弃
            return []
```

### 5.4 Last-Event-ID 恢复机制

SSE 协议原生支持断线恢复。浏览器在重连时自动发送 `Last-Event-ID` 请求头：

```
┌─────────────────────────────────────────────────────────┐
│              Last-Event-ID 恢复流程                      │
│                                                         │
│  时刻 T1: 正常推送                                       │
│  Server → Client: id:evt-001\ndata:{"token":"你"}\n\n   │
│  Server → Client: id:evt-002\ndata:{"token":"好"}\n\n   │
│  Server → Client: id:evt-003\ndata:{"token":"，"}\n\n   │
│                                                         │
│  时刻 T2: 网络中断 ⚡                                    │
│  (Server 继续产生 evt-004, evt-005)                      │
│                                                         │
│  时刻 T3: 客户端自动重连                                  │
│  Client → Server: GET /sse                              │
│                    Last-Event-ID: evt-003                │
│                                                         │
│  时刻 T4: 服务器从 evt-003 之后开始重放                    │
│  Server → Client: id:evt-004\ndata:{"token":"世"}\n\n   │
│  Server → Client: id:evt-005\ndata:{"token":"界"}\n\n   │
│  (继续实时推送...)                                       │
└─────────────────────────────────────────────────────────┘
```

**服务端处理 Last-Event-ID 的关键代码**：

```python
async def sse_endpoint(request):
    """SSE 端点，支持 Last-Event-ID 断线恢复"""
    session_id = request.query_params["session_id"]
    last_event_id = request.headers.get("last-event-id")

    async def event_generator():
        # 阶段 1：重放丢失的事件
        if last_event_id:
            missed = await event_store.replay_events(session_id, last_event_id)
            for event in missed:
                yield {
                    "id": event["event_id"],
                    "event": event["event"],
                    "data": event["data"],
                }

        # 阶段 2：切换到实时流
        async for event in subscribe_realtime(session_id):
            yield {
                "id": event["event_id"],
                "event": event["event"],
                "data": event["data"],
            }

    return EventSourceResponse(event_generator())
```

### 5.5 分布式事务模式

在 SSE 推送场景中，常见的分布式一致性问题：**事件写入存储成功，但发布到消息总线失败**（或反过来）。

**Transactional Outbox 模式**：

```
┌────────────────────────────────────────────────────────────┐
│              Transactional Outbox 模式                      │
│                                                            │
│  ┌──────────┐     ┌─────────────────────────────────┐      │
│  │  Worker   │     │        数据库 (事务边界)          │      │
│  │          │     │  ┌───────────┐  ┌────────────┐  │      │
│  │  1. 开始 ├────→│  │ 业务表     │  │ Outbox 表  │  │      │
│  │  事务    │     │  │ (消息记录) │  │ (待发事件) │  │      │
│  │          │     │  └───────────┘  └────────────┘  │      │
│  └──────────┘     └─────────────────┬───────────────┘      │
│                                     │                      │
│                    2. 轮询/CDC       │                      │
│                                     ▼                      │
│                              ┌────────────┐                │
│                              │ Relay 进程  │                │
│                              │ (读取Outbox │                │
│                              │  发布到消息  │                │
│                              │  总线)      │                │
│                              └──────┬─────┘                │
│                                     │ 3. publish           │
│                                     ▼                      │
│                              ┌────────────┐                │
│                              │  消息总线   │                │
│                              │  (Redis/   │                │
│                              │   Kafka)   │                │
│                              └────────────┘                │
└────────────────────────────────────────────────────────────┘
```

```python
class TransactionalOutbox:
    """事务性 Outbox：保证事件写入和业务操作的原子性"""

    async def save_and_publish(
        self,
        db_session,
        message_record: dict,
        sse_event: dict,
    ):
        """在同一个数据库事务中保存业务数据和待发事件"""
        async with db_session.begin():
            # 1. 保存业务数据
            await db_session.execute(
                insert(messages).values(message_record)
            )
            # 2. 写入 Outbox 表（同一事务）
            await db_session.execute(
                insert(outbox_events).values({
                    "event_id": sse_event["id"],
                    "event_type": sse_event["event"],
                    "payload": json.dumps(sse_event["data"]),
                    "status": "pending",
                    "created_at": datetime.utcnow(),
                })
            )
        # 事务提交后，Relay 进程会轮询 Outbox 表并发布到消息总线

    async def relay_loop(self):
        """Relay 进程：轮询 Outbox 表，发布到消息总线"""
        while True:
            pending = await self.db.fetch_all(
                select(outbox_events)
                .where(outbox_events.c.status == "pending")
                .order_by(outbox_events.c.created_at)
                .limit(100)
            )
            for event in pending:
                try:
                    await self.redis.publish(
                        f"sse:session:{event['session_id']}",
                        event["payload"],
                    )
                    await self.db.execute(
                        update(outbox_events)
                        .where(outbox_events.c.event_id == event["event_id"])
                        .values(status="published")
                    )
                except Exception:
                    # 发布失败，下次轮询重试（At-Least-Once）
                    pass

            await asyncio.sleep(0.1)  # 100ms 轮询间隔
```

---

## 6. 高并发设计

### 6.1 连接池与资源管理

**类比**：一个电话客服中心。每个坐席（连接）都需要占用一条电话线路（文件描述符）和一张桌子（内存）。当坐席全部占满时，新来电只能排队或被拒绝。

**单节点连接数规划**：

```
┌──────────────────────────────────────────────────┐
│           单节点资源规划（8 核 16GB 服务器）        │
│                                                  │
│  操作系统限制:                                    │
│    └── 文件描述符: ulimit -n 65535               │
│    └── TCP 连接数: 约 60,000 (留 5K 给系统)      │
│                                                  │
│  每连接资源消耗:                                   │
│    ├── TCP 缓冲区: ~8 KB (收+发)                 │
│    ├── 应用层状态: ~4 KB (session, buffer)        │
│    ├── Goroutine/协程: ~8 KB (Go) / ~1 KB (异步) │
│    └── 合计: ~20 KB/连接                         │
│                                                  │
│  安全上限计算:                                    │
│    └── 16GB × 60% (留 40% 给应用) ÷ 20KB        │
│    └── ≈ 500,000 理论上限                        │
│    └── 实际建议: 50,000 - 100,000 连接/节点       │
│        (考虑 GC 压力、消息吞吐等因素)              │
└──────────────────────────────────────────────────┘
```

```python
class ConnectionLimiter:
    """连接数限制器，防止单节点过载"""

    def __init__(self, max_connections: int = 50000):
        self.max_connections = max_connections
        self.current_count = 0
        self._lock = asyncio.Lock()

    async def acquire(self) -> bool:
        """尝试获取连接许可"""
        async with self._lock:
            if self.current_count >= self.max_connections:
                return False
            self.current_count += 1
            return True

    async def release(self):
        """释放连接许可"""
        async with self._lock:
            self.current_count -= 1

    @property
    def utilization(self) -> float:
        """当前连接利用率"""
        return self.current_count / self.max_connections
```

### 6.2 背压控制

**类比**：水管系统。如果水龙头（消费者）的流速比水泵（生产者）慢，管道内的水压会持续升高，最终爆管。背压机制就是在管道中安装一个"减压阀"。

```
┌───────────────────────────────────────────────────────────┐
│                    背压控制策略                             │
│                                                           │
│  LLM 生成速度: ~100 tokens/s                              │
│  网络发送速度: 取决于客户端网络状况                          │
│                                                           │
│  ┌─────────┐    ┌─────────────┐    ┌──────────────────┐   │
│  │ LLM     │    │ 发送缓冲区   │    │ 客户端            │   │
│  │ 生产者  │──→│ (有界队列)   │──→│ (可能很慢)        │   │
│  │100 t/s  │    │ max=256     │    │ 2G 手机网络       │   │
│  └─────────┘    └──────┬──────┘    └──────────────────┘   │
│                        │                                   │
│       缓冲区满时的策略:                                     │
│       ├── 策略 1: 阻塞生产者（可能阻塞 LLM 线程 ❌）        │
│       ├── 策略 2: 丢弃旧事件（可能丢 token ❌）             │
│       └── 策略 3: 合并事件（推荐 ✅）                       │
│           把 ["你", "好", "世", "界"] 合并为                │
│           一次发送 "你好世界"                               │
└───────────────────────────────────────────────────────────┘
```

```python
class BackpressureBuffer:
    """带背压控制的事件缓冲区"""

    def __init__(self, max_size: int = 256, merge_threshold: int = 64):
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=max_size)
        self.merge_threshold = merge_threshold
        self.dropped_count = 0
        self.merged_count = 0

    async def put(self, event: dict) -> bool:
        """放入事件，带背压处理"""
        if self.queue.qsize() >= self.merge_threshold:
            # 触发合并：将队列中连续的 token 事件合并
            await self._merge_pending_tokens()

        try:
            self.queue.put_nowait(event)
            return True
        except asyncio.QueueFull:
            # 缓冲区已满，记录指标
            self.dropped_count += 1
            return False

    async def _merge_pending_tokens(self):
        """合并队列中连续的 token 事件"""
        temp = []
        merged_content = []

        while not self.queue.empty():
            event = self.queue.get_nowait()
            if event.get("event") == "token" and merged_content is not None:
                data = json.loads(event["data"])
                merged_content.append(data["content"])
            else:
                # 非 token 事件，先刷出合并的 tokens
                if merged_content:
                    temp.append({
                        "event": "token",
                        "data": json.dumps({
                            "content": "".join(merged_content),
                            "merged": True
                        }),
                    })
                    self.merged_count += len(merged_content) - 1
                    merged_content = []
                temp.append(event)

        if merged_content:
            temp.append({
                "event": "token",
                "data": json.dumps({
                    "content": "".join(merged_content),
                    "merged": True
                }),
            })

        for event in temp:
            await self.queue.put(event)
```

### 6.3 事件批处理

**对于高吞吐场景**，可以将多个事件打包成一次 SSE 消息发送，减少系统调用开销：

```python
class BatchedSSEWriter:
    """批量写入 SSE 事件，减少系统调用"""

    def __init__(self, response, flush_interval: float = 0.05, max_batch: int = 10):
        self.response = response
        self.flush_interval = flush_interval  # 50ms 刷新间隔
        self.max_batch = max_batch
        self.buffer: list[str] = []

    async def write_event(self, event: dict):
        """缓冲事件，达到阈值或超时时批量刷新"""
        formatted = f"id: {event['id']}\nevent: {event['event']}\ndata: {event['data']}\n\n"
        self.buffer.append(formatted)

        if len(self.buffer) >= self.max_batch:
            await self.flush()

    async def flush(self):
        """批量发送缓冲的事件"""
        if self.buffer:
            batch = "".join(self.buffer)
            await self.response.write(batch.encode())
            self.buffer.clear()

    async def start_flush_timer(self):
        """定时刷新，保证延迟上限"""
        while True:
            await asyncio.sleep(self.flush_interval)
            await self.flush()
```

### 6.4 水平扩展策略

```
┌──────────────────────────────────────────────────────────────┐
│                   SSE 服务水平扩展架构                        │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐     │
│  │                 负载均衡层 (L7)                       │     │
│  │  Least-Connections 策略 + 健康检查                    │     │
│  └────────────┬──────────┬──────────┬─────────────────┘     │
│               │          │          │                        │
│         ┌─────▼────┐ ┌───▼──────┐ ┌▼─────────┐             │
│         │SSE 节点 1 │ │SSE 节点 2│ │SSE 节点 3 │  ← 可弹性伸缩│
│         │20K 连接   │ │20K 连接  │ │20K 连接   │             │
│         └─────┬────┘ └───┬──────┘ └┬─────────┘             │
│               │          │         │                         │
│         ┌─────▼──────────▼─────────▼─────────┐              │
│         │          消息总线 (Redis Cluster)     │              │
│         │   分片 0    分片 1    分片 2           │              │
│         └────────────────────────────────────┘              │
│                          ↑                                   │
│                   ┌──────┴──────┐                            │
│                   │ Worker 集群  │                            │
│                   │ (事件生产者) │                            │
│                   └─────────────┘                            │
└──────────────────────────────────────────────────────────────┘
```

**关键扩展策略**：

| 策略 | 实现方式 | 扩展效果 |
|------|---------|---------|
| **SSE 节点独立扩缩** | 按连接数指标自动扩缩容 | 线性增加连接容量 |
| **消息总线分片** | Redis Cluster 或 Kafka Partition | 消息吞吐量线性增长 |
| **注册表分片** | 按 session_id Hash 分片 | 查询不成为瓶颈 |
| **连接数感知调度** | 负载均衡器优先分配到低连接数节点 | 均匀分布连接 |

### 6.5 单节点连接数上限与调优

```bash
# Linux 系统级调优（生产环境必须）

# 1. 文件描述符限制
echo "* soft nofile 1048576" >> /etc/security/limits.conf
echo "* hard nofile 1048576" >> /etc/security/limits.conf

# 2. TCP 连接相关内核参数
sysctl -w net.core.somaxconn=65535
sysctl -w net.ipv4.tcp_max_syn_backlog=65535
sysctl -w net.core.netdev_max_backlog=65535

# 3. TCP keepalive（检测死连接）
sysctl -w net.ipv4.tcp_keepalive_time=60
sysctl -w net.ipv4.tcp_keepalive_intvl=10
sysctl -w net.ipv4.tcp_keepalive_probes=6

# 4. 端口范围（作为客户端连接消息总线时需要）
sysctl -w net.ipv4.ip_local_port_range="1024 65535"
```

---

## 7. 高可用设计

### 7.1 多节点故障转移

**类比**：航空公司的候补机制。当某架航班取消（节点宕机），乘客（连接）自动被改签到其他航班（节点），而不需要乘客重新购票。

```
┌─────────────────────────────────────────────────────────────┐
│              SSE 节点故障转移流程                              │
│                                                             │
│  正常状态:                                                   │
│  用户 A ──SSE──→ 节点 1 (Registry: {user_A: node_1})        │
│  用户 B ──SSE──→ 节点 2 (Registry: {user_B: node_2})        │
│                                                             │
│  节点 1 宕机 💥:                                             │
│  1. 健康检查检测到节点 1 不可用 (3 次失败, ~15s)               │
│  2. 负载均衡器将节点 1 从池中移除                              │
│  3. 用户 A 的 SSE 连接断开                                   │
│  4. 浏览器自动重连 (EventSource 原生行为)                     │
│  5. 重连请求被路由到节点 3 (新节点)                            │
│  6. 节点 3 处理重连:                                         │
│     a. 读取 Last-Event-ID                                   │
│     b. 从 Event Store 重放丢失事件                           │
│     c. 更新 Registry: {user_A: node_3}                      │
│     d. 订阅用户 A 的消息频道                                  │
│  7. 用户 A 无感知地恢复推送                                   │
└─────────────────────────────────────────────────────────────┘
```

```python
class SSEFailoverHandler:
    """SSE 故障转移处理器"""

    def __init__(self, event_store, registry, redis_sub):
        self.event_store = event_store
        self.registry = registry
        self.redis_sub = redis_sub

    async def handle_reconnection(
        self,
        session_id: str,
        last_event_id: str | None,
        node_id: str,
    ):
        """处理故障转移后的重连"""
        # 1. 检查旧注册是否过期（旧节点是否已宕机）
        old_reg = await self.registry.lookup(session_id)
        if old_reg and old_reg["node_id"] != node_id:
            # 旧节点仍然存活，可能是重复连接
            # 通知旧节点关闭旧连接
            await self.redis_sub.publish(
                f"sse:control:{old_reg['node_id']}",
                json.dumps({"action": "close", "session_id": session_id}),
            )

        # 2. 更新注册信息到新节点
        await self.registry.register(session_id, node_id)

        # 3. 重放丢失的事件
        if last_event_id:
            missed = await self.event_store.replay_events(
                session_id, last_event_id
            )
            return missed
        return []
```

### 7.2 优雅降级

当系统压力过大或组件故障时，SSE 服务应按优先级逐步降级：

```
┌───────────────────────────────────────────────────────────┐
│                 SSE 服务降级策略梯度                        │
│                                                           │
│  Level 0 (正常):  完整功能                                 │
│  ────────────────────────────────────────                  │
│  Level 1 (轻度):  降低推送频率                              │
│    └── token 合并：每 5 个 token 合并推送                   │
│  ────────────────────────────────────────                  │
│  Level 2 (中度):  关闭非核心功能                            │
│    └── 停止心跳、关闭事件持久化                              │
│  ────────────────────────────────────────                  │
│  Level 3 (重度):  拒绝新连接                               │
│    └── 返回 503 + Retry-After 头                          │
│  ────────────────────────────────────────                  │
│  Level 4 (极端):  切换到轮询模式                            │
│    └── SSE → HTTP Polling (每 2 秒轮询一次)                │
└───────────────────────────────────────────────────────────┘
```

```python
class GracefulDegradation:
    """优雅降级控制器"""

    def __init__(self):
        self.level = 0
        self.thresholds = {
            1: {"cpu": 70, "connections": 40000, "memory": 70},
            2: {"cpu": 80, "connections": 50000, "memory": 80},
            3: {"cpu": 90, "connections": 55000, "memory": 90},
            4: {"cpu": 95, "connections": 60000, "memory": 95},
        }

    async def evaluate(self, metrics: dict) -> int:
        """根据当前指标评估降级等级"""
        new_level = 0
        for level, threshold in sorted(self.thresholds.items()):
            if (metrics.get("cpu", 0) >= threshold["cpu"]
                or metrics.get("connections", 0) >= threshold["connections"]
                or metrics.get("memory", 0) >= threshold["memory"]):
                new_level = level

        if new_level != self.level:
            self.level = new_level
            await self._apply_degradation(new_level)

        return self.level

    async def _apply_degradation(self, level: int):
        """应用降级策略"""
        if level >= 1:
            self.token_merge_count = 5
        if level >= 3:
            self.reject_new_connections = True
```

### 7.3 健康检查与熔断

**SSE 节点的健康检查需要特殊设计**，因为 HTTP 探针无法反映连接级别的健康状况：

```python
class SSEHealthChecker:
    """SSE 节点多维度健康检查"""

    async def check(self) -> dict:
        """返回节点健康状态"""
        checks = {
            "status": "healthy",
            "connections": {
                "current": self.connection_limiter.current_count,
                "max": self.connection_limiter.max_connections,
                "utilization": self.connection_limiter.utilization,
            },
            "redis": await self._check_redis(),
            "event_store": await self._check_event_store(),
            "backpressure": {
                "dropped_events": self.buffer.dropped_count,
                "merged_events": self.buffer.merged_count,
            },
        }

        # 综合判断
        if checks["connections"]["utilization"] > 0.95:
            checks["status"] = "degraded"
        if not checks["redis"]["connected"]:
            checks["status"] = "unhealthy"

        return checks

    async def _check_redis(self) -> dict:
        try:
            latency_start = time.monotonic()
            await self.redis.ping()
            latency = (time.monotonic() - latency_start) * 1000
            return {"connected": True, "latency_ms": latency}
        except Exception as e:
            return {"connected": False, "error": str(e)}
```

**消息总线熔断器**：

```python
class CircuitBreaker:
    """消息总线连接的熔断器"""

    CLOSED = "closed"       # 正常
    OPEN = "open"           # 熔断（拒绝请求）
    HALF_OPEN = "half_open" # 尝试恢复

    def __init__(self, failure_threshold: int = 5, recovery_timeout: float = 30):
        self.state = self.CLOSED
        self.failure_count = 0
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.last_failure_time = 0

    async def call(self, func, *args, **kwargs):
        """通过熔断器调用外部服务"""
        if self.state == self.OPEN:
            if time.time() - self.last_failure_time > self.recovery_timeout:
                self.state = self.HALF_OPEN
            else:
                raise CircuitBreakerOpenError("熔断器已打开，拒绝请求")

        try:
            result = await func(*args, **kwargs)
            if self.state == self.HALF_OPEN:
                self.state = self.CLOSED
                self.failure_count = 0
            return result
        except Exception as e:
            self.failure_count += 1
            self.last_failure_time = time.time()
            if self.failure_count >= self.failure_threshold:
                self.state = self.OPEN
            raise
```

### 7.4 跨区域部署

**大规模场景下需要多区域 Active-Active 部署**：

```
┌─────────────────────────────────────────────────────────────────┐
│               跨区域 SSE 部署架构                                │
│                                                                 │
│  ┌────────────────────────┐    ┌────────────────────────┐       │
│  │      区域 A (北京)      │    │      区域 B (上海)      │       │
│  │                        │    │                        │       │
│  │  ┌────────┐ ┌────────┐ │    │ ┌────────┐ ┌────────┐ │       │
│  │  │SSE 节点│ │SSE 节点│ │    │ │SSE 节点│ │SSE 节点│ │       │
│  │  │  A-1   │ │  A-2   │ │    │ │  B-1   │ │  B-2   │ │       │
│  │  └───┬────┘ └───┬────┘ │    │ └───┬────┘ └───┬────┘ │       │
│  │      └────┬─────┘      │    │     └────┬─────┘      │       │
│  │      ┌────▼─────┐      │    │     ┌────▼─────┐      │       │
│  │      │Redis 主节点│◄────────────►│Redis 主节点│      │       │
│  │      │ (区域 A)  │ 跨区域│    │     │ (区域 B)  │      │       │
│  │      └──────────┘ 复制  │    │     └──────────┘      │       │
│  └────────────────────────┘    └────────────────────────┘       │
│                                                                 │
│  DNS 智能解析：用户就近接入最近的区域                               │
│  跨区域事件同步：通过 Redis 跨区域复制或 Kafka MirrorMaker          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. 监控与运维

### 8.1 核心监控指标

| 指标类别 | 指标名 | 含义 | 告警阈值（参考） |
|---------|--------|------|----------------|
| **连接** | `sse_connections_active` | 当前活跃 SSE 连接数 | > 80% 容量 |
| **连接** | `sse_connections_total` | 累计连接数（含已关闭） | 环比突增 > 200% |
| **连接** | `sse_connection_duration_seconds` | 连接持续时间分布 | P99 > 3600s 需关注 |
| **事件** | `sse_events_published_total` | 已发布事件总数 | — |
| **事件** | `sse_events_delivered_total` | 已投递事件总数 | 投递率 < 99% |
| **事件** | `sse_events_dropped_total` | 因背压丢弃的事件数 | > 0 需关注 |
| **延迟** | `sse_event_latency_ms` | 事件从生产到投递的延迟 | P99 > 500ms |
| **重连** | `sse_reconnections_total` | 客户端重连次数 | 突增 > 500% |
| **缓冲** | `sse_buffer_utilization` | 发送缓冲区利用率 | > 80% |

### 8.2 Prometheus 指标采集示例

```python
from prometheus_client import Counter, Gauge, Histogram

# 连接指标
sse_connections_active = Gauge(
    "sse_connections_active",
    "当前活跃 SSE 连接数",
    ["node_id"],
)
sse_connections_total = Counter(
    "sse_connections_total",
    "累计 SSE 连接数",
    ["node_id", "status"],  # status: established, closed, rejected
)

# 事件指标
sse_events_total = Counter(
    "sse_events_total",
    "SSE 事件总数",
    ["node_id", "event_type", "status"],  # status: published, delivered, dropped
)

# 延迟指标
sse_event_latency = Histogram(
    "sse_event_latency_seconds",
    "事件投递延迟",
    ["node_id"],
    buckets=[0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0, 5.0],
)

# 在事件投递时记录
async def deliver_event(event: dict, response):
    publish_time = event.get("timestamp", time.time())
    latency = time.time() - publish_time

    sse_event_latency.labels(node_id=NODE_ID).observe(latency)
    sse_events_total.labels(
        node_id=NODE_ID, event_type=event["event"], status="delivered"
    ).inc()

    await response.write(format_sse(event))
```

### 8.3 消息延迟监控与告警

```
┌────────────────────────────────────────────────────────────┐
│            SSE 延迟分段监控                                  │
│                                                            │
│  端到端延迟 = T_produce + T_bus + T_deliver                 │
│                                                            │
│  ┌──────────┐    T_produce    ┌──────────┐                 │
│  │  Worker   │───────────────→│ 消息总线  │                 │
│  │ (LLM 响应)│   (< 1ms)     │          │                 │
│  └──────────┘                │          │                 │
│                              │          │    T_bus        │
│                              │          │   (1-10ms)     │
│                              └────┬─────┘                 │
│                                   │                       │
│                                   │ T_deliver             │
│                                   │ (< 5ms)              │
│                              ┌────▼─────┐                 │
│                              │ SSE 节点  │                 │
│                              │ → 用户    │                 │
│                              └──────────┘                 │
│                                                            │
│  正常: 端到端 < 20ms                                       │
│  警告: 端到端 50-200ms                                     │
│  严重: 端到端 > 500ms                                      │
└────────────────────────────────────────────────────────────┘
```

### 8.4 告警策略

```yaml
# 告警规则示例 (Prometheus AlertManager 格式)
groups:
  - name: sse_alerts
    rules:
      # P0: SSE 服务不可用
      - alert: SSEServiceDown
        expr: up{job="sse-service"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "SSE 服务节点 {{ $labels.instance }} 不可用"

      # P1: 连接数接近上限
      - alert: SSEConnectionsHigh
        expr: >
          sse_connections_active / sse_connections_max > 0.85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "SSE 连接利用率超过 85%，当前 {{ $value | humanizePercentage }}"

      # P1: 事件投递延迟过高
      - alert: SSELatencyHigh
        expr: >
          histogram_quantile(0.99, rate(sse_event_latency_seconds_bucket[5m])) > 0.5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "SSE P99 投递延迟超过 500ms"

      # P2: 事件丢弃率异常
      - alert: SSEEventsDropped
        expr: >
          rate(sse_events_total{status="dropped"}[5m]) > 0
        for: 3m
        labels:
          severity: warning
        annotations:
          summary: "SSE 节点 {{ $labels.node_id }} 出现事件丢弃"

      # P1: 大规模重连风暴
      - alert: SSEReconnectionStorm
        expr: >
          rate(sse_reconnections_total[1m]) > 100
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "SSE 重连风暴：每分钟重连超过 100 次"
```

---

## 9. 生产实践案例：AI Chatbot 万级到千万级 DAU

### 9.1 核心场景描述

一个 AI 聊天产品的典型交互流程：

1. 用户在 Web 端输入问题并发送
2. 前端通过 HTTP POST 提交聊天请求
3. 后端收到请求后调用 LLM 推理服务
4. LLM 逐 token 生成回复（流式输出）
5. 后端通过 SSE 将 tokens 实时推送给前端
6. 前端逐字渲染，形成"打字机效果"

**核心挑战**：在集群部署下，步骤 2 的 HTTP POST 和步骤 5 的 SSE 推送可能落在不同的服务器上。

### 9.2 10 万 DAU 方案：Sticky Sessions

**规模预估**：10 万 DAU → 峰值约 1 万在线 → 约 5000 并发 SSE 连接

```
┌──────────────────────────────────────────────────────────┐
│           10 万 DAU 架构：Sticky Sessions                 │
│                                                          │
│  ┌──────┐     ┌─────────────────┐     ┌──────────────┐  │
│  │      │     │   Nginx L7 LB    │     │  实例 1       │  │
│  │      │────→│   (IP Hash /     │────→│  SSE + API   │  │
│  │ 用户 │     │    Cookie 亲和)   │     │  2500 连接   │  │
│  │      │     │                 │     ├──────────────┤  │
│  │      │     │                 │────→│  实例 2       │  │
│  └──────┘     └─────────────────┘     │  SSE + API   │  │
│                                       │  2500 连接   │  │
│               ┌──────────────┐        ├──────────────┤  │
│               │  Redis       │←───────│  共享 Session │  │
│               │  (Session)   │        └──────────────┘  │
│               └──────────────┘                          │
│                                       ┌──────────────┐  │
│                                       │  LLM 推理    │  │
│                                       │  (2 GPU 节点) │  │
│                                       └──────────────┘  │
│                                                          │
│  优点: 简单，SSE 和 API 在同一实例                         │
│  缺点: 负载不均，扩容困难                                  │
└──────────────────────────────────────────────────────────┘
```

**Nginx 配置**：

```nginx
upstream sse_backend {
    ip_hash;  # 基于客户端 IP 的会话亲和
    server 10.0.1.1:8000;
    server 10.0.1.2:8000;
}

server {
    location /api/chat/sse {
        proxy_pass http://sse_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;           # 关键：禁用代理缓冲
        proxy_cache off;
        proxy_read_timeout 3600s;      # SSE 长连接超时
        chunked_transfer_encoding off;

        # SSE 专属头
        add_header X-Accel-Buffering no;
        add_header Cache-Control no-cache;
    }
}
```

### 9.3 100 万 DAU 方案：消息总线 + 服务分离

**规模预估**：100 万 DAU → 峰值约 10 万在线 → 约 5 万并发 SSE 连接

**关键变化**：将 SSE 连接管理和业务处理分离为独立服务。

```
┌────────────────────────────────────────────────────────────────┐
│           100 万 DAU 架构：消息总线 + 服务分离                   │
│                                                                │
│  ┌──────┐    ┌──────────┐    ┌──────────────────────────┐      │
│  │      │SSE │  L7 LB   │    │    SSE 网关集群           │      │
│  │      │───→│(Least    │───→│ ┌────────┐ ┌────────┐   │      │
│  │      │    │ Conn)    │    │ │节点 1   │ │节点 2   │   │      │
│  │ 用户 │    └──────────┘    │ │25K 连接 │ │25K 连接 │   │      │
│  │      │                    │ └───┬────┘ └───┬────┘   │      │
│  │      │    ┌──────────┐    └─────┼──────────┼────────┘      │
│  │      │───→│  API LB  │          │subscribe │               │
│  │      │POST│          │    ┌─────▼──────────▼────────┐      │
│  └──────┘    └────┬─────┘    │   Redis Cluster         │      │
│                   │          │   (Pub/Sub + Streams)    │      │
│              ┌────▼─────┐    └─────────────▲────────────┘      │
│              │ API 集群  │                  │ publish           │
│              │ ┌──────┐  │           ┌─────┴────────┐          │
│              │ │实例 1 │──────────→  │ Worker 集群   │          │
│              │ └──────┘  │  enqueue  │ (LLM 调用)   │          │
│              │ ┌──────┐  │           │ ┌──────────┐ │          │
│              │ │实例 2 │  │           │ │ Worker 1 │ │          │
│              │ └──────┘  │           │ │ Worker 2 │ │          │
│              └───────────┘           │ │ Worker 3 │ │          │
│                                      │ └──────────┘ │          │
│                                      └──────────────┘          │
│                                             │                  │
│                                      ┌──────▼──────┐           │
│                                      │  LLM 推理   │           │
│                                      │  (GPU 集群)  │           │
│                                      └─────────────┘           │
└────────────────────────────────────────────────────────────────┘
```

**请求处理流程**：

```python
# API 服务：接收聊天请求，异步派发任务
async def chat_handler(request):
    session_id = request.json["session_id"]
    message = request.json["message"]

    # 1. 保存消息到数据库
    await db.save_message(session_id, message)

    # 2. 将 LLM 调用任务放入队列
    task_id = str(uuid.uuid4())
    await task_queue.enqueue({
        "task_id": task_id,
        "session_id": session_id,
        "message": message,
        "model": "gpt-4",
    })

    return {"task_id": task_id, "status": "processing"}


# Worker 服务：消费任务队列，调用 LLM，发布 SSE 事件
async def worker_loop():
    while True:
        task = await task_queue.dequeue()
        session_id = task["session_id"]
        channel = f"sse:session:{session_id}"

        try:
            # 调用 LLM 推理服务
            seq = 0
            async for token in llm_client.stream_chat(task["message"]):
                seq += 1
                event = {
                    "id": f"{session_id}-{seq}",
                    "event": "token",
                    "data": json.dumps({"content": token, "seq": seq}),
                    "timestamp": time.time(),
                }
                # 同时发布到 Pub/Sub 和写入 Streams
                await redis.publish(channel, json.dumps(event))
                await redis.xadd(
                    f"sse:stream:{session_id}", event, maxlen=2000
                )

            # 发送完成事件
            await redis.publish(channel, json.dumps({
                "id": f"{session_id}-done",
                "event": "done",
                "data": json.dumps({"total": seq}),
            }))

        except Exception as e:
            await redis.publish(channel, json.dumps({
                "id": f"{session_id}-error",
                "event": "error",
                "data": json.dumps({"message": str(e)}),
            }))
```

### 9.4 1000 万 DAU 方案：跨区域 Active-Active

**规模预估**：1000 万 DAU → 峰值约 100 万在线 → 约 50 万并发 SSE 连接

```
┌──────────────────────────────────────────────────────────────────┐
│          1000 万 DAU 架构：跨区域 Active-Active                   │
│                                                                  │
│  ┌──────────────┐                                                │
│  │  DNS 智能解析 │  GeoDNS: 就近接入                              │
│  └──────┬───────┘                                                │
│         │                                                        │
│  ┌──────▼───────────────────┐  ┌────────────────────────────┐    │
│  │     区域 A (北京)         │  │     区域 B (上海)           │    │
│  │                          │  │                            │    │
│  │  CDN 边缘节点 (SSE 透传)  │  │  CDN 边缘节点 (SSE 透传)   │    │
│  │         │                │  │         │                  │    │
│  │  ┌──────▼──────┐         │  │  ┌──────▼──────┐           │    │
│  │  │  SSE 网关    │         │  │  │  SSE 网关    │           │    │
│  │  │  (20 节点)   │         │  │  │  (20 节点)   │           │    │
│  │  │  25 万连接   │         │  │  │  25 万连接   │           │    │
│  │  └──────┬──────┘         │  │  └──────┬──────┘           │    │
│  │         │                │  │         │                  │    │
│  │  ┌──────▼──────┐         │  │  ┌──────▼──────┐           │    │
│  │  │ Redis Cluster│◄───────────►│ Redis Cluster│           │    │
│  │  │ (6 节点)     │ 跨区域  │  │  │ (6 节点)     │           │    │
│  │  └──────┬──────┘ 同步    │  │  └──────┬──────┘           │    │
│  │         │                │  │         │                  │    │
│  │  ┌──────▼──────┐         │  │  ┌──────▼──────┐           │    │
│  │  │ Worker 集群  │         │  │  │ Worker 集群  │           │    │
│  │  │ + GPU 推理   │         │  │  │ + GPU 推理   │           │    │
│  │  └─────────────┘         │  │  └─────────────┘           │    │
│  └──────────────────────────┘  └────────────────────────────┘    │
│                                                                  │
│  关键设计:                                                        │
│  1. 用户连接和 LLM 推理在同一区域完成（避免跨区延迟）                 │
│  2. 会话元数据跨区域同步（用户切换区域时可恢复）                      │
│  3. 每个区域独立可用（单区域故障不影响其他区域）                      │
└──────────────────────────────────────────────────────────────────┘
```

**各阶段规模对比**：

| 维度 | 10 万 DAU | 100 万 DAU | 1000 万 DAU |
|------|----------|-----------|------------|
| **并发连接** | ~5,000 | ~50,000 | ~500,000 |
| **SSE 节点** | 2 (合并部署) | 4-6 (独立服务) | 40+ (多区域) |
| **消息总线** | 不需要 | Redis Cluster | Redis Cluster × 2 区域 |
| **推送模式** | Sticky Session | Channel-per-Session | Channel + 区域路由 |
| **事件持久化** | 内存缓冲 | Redis Streams | Redis Streams + Kafka |
| **故障恢复** | 手动重启 | 自动 failover | 跨区域自动切换 |
| **部署区域** | 单区域 | 单区域多可用区 | 多区域 Active-Active |

---

## 10. 常见陷阱与最佳实践

### 陷阱 1：忽略 Nginx/代理缓冲

❌ **错误做法**：使用默认 Nginx 配置代理 SSE

```nginx
# ❌ 默认配置会缓冲 SSE 响应，导致客户端收不到实时事件
location /sse {
    proxy_pass http://backend;
}
```

✅ **正确做法**：禁用缓冲、设置正确的超时和头

```nginx
# ✅ SSE 专属配置
location /sse {
    proxy_pass http://backend;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;             # 关键！禁用代理缓冲
    proxy_cache off;
    proxy_read_timeout 86400s;       # 24小时超时
    chunked_transfer_encoding off;
    add_header X-Accel-Buffering no; # 禁用 Nginx 内部缓冲
}
```

### 陷阱 2：不处理 SSE 连接泄漏

❌ **错误做法**：客户端断开后不清理服务端资源

```python
# ❌ 连接断开时没有清理注册信息和订阅
async def sse_handler(request):
    async for event in subscribe(session_id):
        yield format_sse(event)
    # 客户端断开后，订阅和注册信息残留 → 内存泄漏
```

✅ **正确做法**：使用 try/finally 确保清理

```python
# ✅ 完整的生命周期管理
async def sse_handler(request):
    session_id = request.params["session_id"]
    try:
        await registry.register(session_id, NODE_ID)
        await subscriber.subscribe(f"sse:session:{session_id}")

        async for event in subscriber.listen():
            yield format_sse(event)
    finally:
        # 无论正常断开还是异常断开，都执行清理
        await subscriber.unsubscribe(f"sse:session:{session_id}")
        await registry.unregister(session_id)
        sse_connections_active.labels(node_id=NODE_ID).dec()
```

### 陷阱 3：Redis Pub/Sub 作为唯一推送通道

❌ **错误做法**：仅依赖 Redis Pub/Sub，不做持久化

```python
# ❌ Pub/Sub 是 fire-and-forget，订阅者离线时消息丢失
await redis.publish(channel, event_data)
# 如果用户此时正在重连，这条消息就永远丢失了
```

✅ **正确做法**：Pub/Sub + Streams 双写

```python
# ✅ 同时写入实时通道和持久化存储
async def publish_event(session_id: str, event: dict):
    channel = f"sse:session:{session_id}"
    stream = f"sse:stream:{session_id}"
    payload = json.dumps(event)

    # 1. 写入 Streams（持久化，支持重放）
    await redis.xadd(stream, {"data": payload}, maxlen=2000)

    # 2. 发布到 Pub/Sub（实时推送）
    await redis.publish(channel, payload)

    # 顺序很重要：先持久化再推送
    # 确保重连时一定能找到事件
```

### 陷阱 4：不设置连接数上限

❌ **错误做法**：无限接受新 SSE 连接

```python
# ❌ 没有连接数限制，高流量时 OOM 或文件描述符耗尽
async def sse_endpoint(request):
    return EventSourceResponse(event_generator())
```

✅ **正确做法**：实施连接数限制和优雅拒绝

```python
# ✅ 连接数限制 + 友好的拒绝响应
async def sse_endpoint(request):
    if not await connection_limiter.acquire():
        return JSONResponse(
            status_code=503,
            headers={"Retry-After": "5"},
            content={"error": "服务器连接数已满，请稍后重试"},
        )

    try:
        return EventSourceResponse(event_generator())
    finally:
        await connection_limiter.release()
```

### 陷阱 5：心跳间隔设置不当

❌ **错误做法**：不发送心跳或间隔过长

```python
# ❌ 没有心跳，代理/防火墙可能在 60 秒后关闭"空闲"连接
async def event_generator():
    async for event in subscribe(session_id):
        yield format_sse(event)
```

✅ **正确做法**：定期发送 SSE 注释作为心跳

```python
# ✅ 每 15 秒发送心跳，保持连接活跃
async def event_generator():
    heartbeat_interval = 15  # 秒

    async for event in subscribe_with_timeout(session_id, heartbeat_interval):
        if event is None:
            # 超时，发送心跳（SSE 注释不会触发客户端事件）
            yield ": heartbeat\n\n"
        else:
            yield format_sse(event)
```

### 陷阱 6：EventSource 重连风暴

❌ **错误做法**：服务端故障时让所有客户端同时重连

```python
# ❌ 固定的重连间隔，所有客户端同时重连导致"惊群效应"
# （浏览器 EventSource 默认约 3 秒后重连）
```

✅ **正确做法**：通过 `retry` 字段控制重连间隔，加入抖动

```python
# ✅ 服务端通过 retry 字段控制客户端重连间隔
import random

async def sse_endpoint(request):
    # 设置带抖动的重连间隔 (3-8 秒)
    retry_ms = 3000 + random.randint(0, 5000)

    async def generator():
        yield f"retry: {retry_ms}\n\n"  # 告诉客户端重连间隔
        async for event in event_stream():
            yield format_sse(event)

    return EventSourceResponse(generator())
```

### 最佳实践总结

| 实践 | 说明 |
|------|------|
| **分离 SSE 网关和业务服务** | SSE 连接管理是 I/O 密集型，业务处理是 CPU 密集型，分离后可独立扩缩 |
| **Pub/Sub + Streams 双写** | 实时推送 + 持久化，两者缺一不可 |
| **连接注册表 + TTL** | 带过期的注册信息，自动清理死连接 |
| **心跳间隔 15 秒** | 短于大多数代理的空闲超时（通常 60 秒） |
| **重连抖动** | 避免惊群效应，保护服务端 |
| **连接数上限** | 按节点资源规划安全上限，超限返回 503 |
| **事件 ID 单调递增** | 便于重放和去重，使用 `{session}-{sequence}` 格式 |
| **监控四大指标** | 连接数、事件投递率、延迟、重连率 |
