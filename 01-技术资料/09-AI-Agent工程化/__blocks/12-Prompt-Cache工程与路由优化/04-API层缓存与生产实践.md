## 9. 生产实践

### 9.1 监控指标体系

```python
# Prometheus 监控指标定义
from prometheus_client import (
    Counter, Gauge, Histogram, Summary,
)

# 核心指标
cache_hit_total = Counter(
    "prompt_cache_hit_total",
    "Total cache hits",
    ["gpu_id", "prefix_type"],
)
cache_miss_total = Counter(
    "prompt_cache_miss_total",
    "Total cache misses",
    ["gpu_id", "prefix_type"],
)
cache_hit_ratio = Gauge(
    "prompt_cache_hit_ratio",
    "Cache hit ratio (5min rolling)",
    ["gpu_id"],
)

# 容量指标
cache_memory_bytes = Gauge(
    "prompt_cache_memory_bytes",
    "Cache memory usage in bytes",
    ["gpu_id", "level"],  # level: l1/l2/l3
)
cache_entries_total = Gauge(
    "prompt_cache_entries_total",
    "Number of cached entries",
    ["gpu_id"],
)
cache_eviction_total = Counter(
    "prompt_cache_eviction_total",
    "Total cache evictions",
    ["gpu_id", "reason"],  # reason: lru/memory/manual
)

# 性能指标
prefill_duration_seconds = Histogram(
    "prompt_prefill_duration_seconds",
    "Prefill computation duration",
    ["gpu_id", "cache_status"],  # hit/miss
    buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5],
)
cache_transfer_duration_seconds = Histogram(
    "prompt_cache_transfer_seconds",
    "L2/L3 to L1 transfer duration",
    ["source_level"],
    buckets=[0.001, 0.005, 0.01, 0.05, 0.1],
)
```

### 9.2 关键告警规则

```yaml
# Prometheus AlertManager 告警规则
groups:
  - name: prompt_cache_alerts
    rules:
      # 命中率下降告警
      - alert: CacheHitRateDrop
        expr: prompt_cache_hit_ratio < 0.5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Cache hit rate dropped below 50%"
          description: >
            GPU {{ $labels.gpu_id }} cache hit rate
            is {{ $value | humanizePercentage }}.
            Possible causes: routing misconfiguration,
            cache eviction pressure, or traffic pattern
            change.

      # 显存压力告警
      - alert: CacheMemoryPressure
        expr: >
          prompt_cache_memory_bytes{level="l1"}
          / gpu_total_memory_bytes > 0.85
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "GPU KV Cache memory > 85%"
          description: >
            Risk of OOM. Consider increasing eviction
            aggressiveness or adding GPU capacity.

      # 淘汰率异常告警
      - alert: HighEvictionRate
        expr: >
          rate(prompt_cache_eviction_total[5m]) > 100
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High cache eviction rate"
```

### 9.3 容量规划

```
┌────────────────────────────────────────────────────────┐
│                   容量规划公式                           │
├────────────────────────────────────────────────────────┤
│                                                        │
│  1. 估算热门前缀数量:                                    │
│     N_prefix = 独立 System Prompt 数量                  │
│     例: 10 个业务场景 × 3 个版本 = 30 个前缀             │
│                                                        │
│  2. 估算单个前缀的 KV Cache 大小:                        │
│     Size_per_prefix = 2 × L × H × D × T × dtype       │
│     例 (70B, FP16, 2000 tokens):                       │
│     = 2 × 80 × 8 × 128 × 2000 × 2 ≈ 640 MB           │
│                                                        │
│  3. 总 L1 缓存需求:                                     │
│     L1_total = N_prefix × Size_per_prefix              │
│     = 30 × 640 MB ≈ 19.2 GB                           │
│                                                        │
│  4. GPU 显存分配:                                       │
│     总显存 = 模型权重 + KV Cache(活跃) + KV Cache(缓存)  │
│     80 GB = 35 GB + 25 GB + 20 GB                     │
│     → L1 缓存容量约 20 GB → 可缓存 ~31 个前缀           │
│                                                        │
│  5. 不够？选项:                                         │
│     a. 启用 L2 offload（CPU 内存）                      │
│     b. 缩短前缀长度                                     │
│     c. 使用量化 KV Cache（FP8 → 显存减半）              │
│     d. 增加 GPU 数量（分摊缓存压力）                     │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### 9.4 多租户 LLM 服务架构

```
┌───────────────────────────────────────────────────────────────┐
│               多租户 LLM 服务缓存架构                          │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────────────────────────────────┐        │
│  │                  API Gateway                      │        │
│  │  - 认证 / 限流 / 计费                              │        │
│  │  - Prompt 标准化                                   │        │
│  │  - 提取 prefix_key                                │        │
│  └────────────────────┬─────────────────────────────┘        │
│                       │                                       │
│  ┌────────────────────▼─────────────────────────────┐        │
│  │            Cache-Aware Router                     │        │
│  │  - 一致性哈希路由                                  │        │
│  │  - 负载感知调度                                    │        │
│  │  - 健康检查 + 故障转移                             │        │
│  └────┬──────────┬──────────┬──────────┬────────────┘        │
│       │          │          │          │                      │
│  ┌────▼───┐ ┌────▼───┐ ┌────▼───┐ ┌────▼───┐               │
│  │ GPU 0  │ │ GPU 1  │ │ GPU 2  │ │ GPU 3  │               │
│  │ vLLM   │ │ vLLM   │ │ vLLM   │ │ vLLM   │               │
│  │ +APC   │ │ +APC   │ │ +APC   │ │ +APC   │               │
│  ├────────┤ ├────────┤ ├────────┤ ├────────┤               │
│  │L1 Cache│ │L1 Cache│ │L1 Cache│ │L1 Cache│               │
│  │Tenant: │ │Tenant: │ │Tenant: │ │Tenant: │               │
│  │ A, D   │ │ B, E   │ │ C, F   │ │ A, G   │               │
│  └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘               │
│      │          │          │          │                      │
│  ┌───▼──────────▼──────────▼──────────▼────┐                │
│  │          L2: Host Memory Pool            │                │
│  │     (溢出缓存 + 预热候选)                 │                │
│  └──────────────────┬──────────────────────┘                │
│                     │                                        │
│  ┌──────────────────▼──────────────────────┐                │
│  │        L3: Redis Cluster / NVMe         │                │
│  │   (跨节点共享 + 持久化 + 灾备)           │                │
│  └─────────────────────────────────────────┘                │
│                                                               │
│  租户隔离策略:                                                 │
│  - 每个租户的缓存配额独立计算                                  │
│  - 大租户的 SP 优先 Push 副本到多个 GPU                        │
│  - 小租户共享 GPU，按 LRU 自然竞争缓存空间                     │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

### 9.5 TypeScript 路由层实现参考

```typescript
import { createHash } from "crypto";

interface RouteDecision {
  endpoint: string;
  cacheHit: boolean;
  fallback: boolean;
}

interface GPUNode {
  endpoint: string;
  healthy: boolean;
  load: number; // 0-1
  cachedPrefixes: Set<string>;
}

class PromptCacheRouter {
  private nodes: Map<string, GPUNode> = new Map();
  private ring: Array<{ hash: number; endpoint: string }> = [];
  private readonly virtualNodes = 150;

  constructor(endpoints: string[]) {
    for (const ep of endpoints) {
      this.addNode(ep);
    }
  }

  addNode(endpoint: string): void {
    this.nodes.set(endpoint, {
      endpoint,
      healthy: true,
      load: 0,
      cachedPrefixes: new Set(),
    });

    for (let i = 0; i < this.virtualNodes; i++) {
      const hash = this.hash(`${endpoint}:v${i}`);
      this.ring.push({ hash, endpoint });
    }
    this.ring.sort((a, b) => a.hash - b.hash);
  }

  route(systemPrompt: string): RouteDecision {
    const prefixKey = this.normalizePrompt(systemPrompt);
    const prefixHash = this.hash(prefixKey);

    // 1. 尝试缓存亲和路由
    const preferred = this.findOnRing(prefixHash);
    const prefNode = this.nodes.get(preferred);

    if (prefNode?.healthy && prefNode.load < 0.9) {
      return {
        endpoint: preferred,
        cacheHit: prefNode.cachedPrefixes.has(prefixKey),
        fallback: false,
      };
    }

    // 2. 降级：选择负载最低的健康节点
    const fallbackNode = this.selectLeastLoaded();
    return {
      endpoint: fallbackNode.endpoint,
      cacheHit: false,
      fallback: true,
    };
  }

  private normalizePrompt(prompt: string): string {
    return prompt.trim().replace(/\s+/g, " ");
  }

  private hash(key: string): number {
    const digest = createHash("md5")
      .update(key)
      .digest("hex");
    return parseInt(digest.substring(0, 8), 16);
  }

  private findOnRing(hash: number): string {
    for (const entry of this.ring) {
      if (entry.hash >= hash) return entry.endpoint;
    }
    return this.ring[0].endpoint;
  }

  private selectLeastLoaded(): GPUNode {
    let best: GPUNode | null = null;
    for (const node of this.nodes.values()) {
      if (
        node.healthy &&
        (!best || node.load < best.load)
      ) {
        best = node;
      }
    }
    if (!best) throw new Error("No healthy nodes");
    return best;
  }
}
```

---

## 10. 常见陷阱与最佳实践

### 陷阱 1：忽略 Prompt 标准化

❌ **错误做法**：直接使用原始 Prompt 作为缓存键

```python
# 两个语义相同但格式不同的 Prompt → Cache MISS
prompt_a = "You are a helpful assistant. "     # 末尾空格
prompt_b = "You are a helpful assistant."      # 无空格
# token 化后序列不同 → 路由到不同 GPU → 缓存未命中
```

✅ **正确做法**：标准化后再计算缓存键

```python
def normalize(prompt: str) -> str:
    return " ".join(prompt.strip().split())

# normalize(prompt_a) == normalize(prompt_b) → 同一缓存
```

### 陷阱 2：Round-Robin 路由导致缓存失效

❌ **错误做法**：使用标准轮询负载均衡

```nginx
# Nginx 默认 round-robin → 每个 GPU 都缓存一份
upstream llm_backend {
    server gpu-0:8000;
    server gpu-1:8000;
    server gpu-2:8000;
}
```

✅ **正确做法**：基于 Prompt 哈希的一致性路由

```nginx
upstream llm_backend {
    hash $prompt_prefix_hash consistent;
    server gpu-0:8000;
    server gpu-1:8000;
    server gpu-2:8000;
}
```

### 陷阱 3：将采样参数纳入缓存键

❌ **错误做法**：temperature 不同导致缓存未命中

```python
# 相同 Prompt，不同 temperature → 不同缓存键 → MISS
key_a = hash(messages + "temp=0.7")
key_b = hash(messages + "temp=0.3")
# 但 KV Cache 与 temperature 无关！
```

✅ **正确做法**：缓存键只包含影响 KV Cache 的参数

```python
# 只用 messages 和 model 计算缓存键
cache_key = hash(json.dumps(messages) + model_name)
# temperature/top_p/max_tokens 等采样参数不参与
```

### 陷阱 4：Few-shot 示例顺序随机化

❌ **错误做法**：每次请求随机排列 Few-shot 示例

```python
import random
examples = [ex1, ex2, ex3, ex4, ex5]
random.shuffle(examples)  # 每次顺序不同
prompt = system + "\n".join(examples) + query
# → 每次 Token 序列不同 → 无法复用缓存
```

✅ **正确做法**：固定示例顺序，作为静态模板

```python
# 示例按固定顺序排列，所有请求共享同一前缀
TEMPLATE = system + "\n".join(
    sorted(examples, key=lambda e: e["id"])
)
prompt = TEMPLATE + query
# → 所有请求的 TEMPLATE 部分完全相同 → 高命中率
```

### 陷阱 5：缓存过期导致周期性延迟毛刺

❌ **错误做法**：完全依赖自然过期

```
时间线:
t=0    缓存写入 → t=5min 过期 → t=5min+1s 第一个 MISS
                                → 延迟从 50ms 跳到 500ms
                                → 用户感知明显毛刺
```

✅ **正确做法**：定期"保活"刷新热门缓存

```python
async def keep_cache_alive(
    hot_prefixes: list[str],
    interval_seconds: int = 120,  # 每 2 分钟刷新
):
    """在缓存过期前发送保活请求。"""
    while True:
        for prefix in hot_prefixes:
            await client.generate(
                messages=[
                    {"role": "system", "content": prefix},
                    {"role": "user", "content": "."},
                ],
                max_tokens=1,
            )
        await asyncio.sleep(interval_seconds)
```

### 陷阱 6：缓存命中率监控缺失

❌ **错误做法**：部署了缓存但不监控命中率

```python
# 没有任何监控 → 不知道缓存是否生效
response = await llm.generate(messages)
```

✅ **正确做法**：全链路监控 + 告警

```python
async def generate_with_metrics(messages):
    prefix_hash = compute_cache_key(messages)
    gpu = router.select_gpu(prefix_hash)
    
    start = time.monotonic()
    response = await llm.generate(
        endpoint=gpu, messages=messages
    )
    duration = time.monotonic() - start
    
    # 记录指标
    is_hit = response.usage.get("cached_tokens", 0) > 0
    if is_hit:
        cache_hit_total.labels(gpu=gpu).inc()
    else:
        cache_miss_total.labels(gpu=gpu).inc()
    
    prefill_duration_seconds.labels(
        gpu=gpu,
        cache_status="hit" if is_hit else "miss",
    ).observe(duration)
    
    return response
```

### 陷阱 7：扩容时未考虑缓存预热

❌ **错误做法**：直接将流量切到新节点

```
新 GPU 加入 → 立即接收 100% 流量 → 全部 MISS
→ Prefill 计算量暴增 → 新节点过载 → 级联故障
```

✅ **正确做法**：渐进式流量切换 + 预热

```python
async def graceful_scale_up(new_gpu: str):
    # 阶段 1: 预热（不接收真实流量）
    await warm_up_cache(
        router, client,
        system_prompts=get_hot_prefixes(),
    )
    
    # 阶段 2: 灰度（只接收 10% 流量）
    router.set_weight(new_gpu, weight=0.1)
    await asyncio.sleep(300)  # 观察 5 分钟
    
    # 阶段 3: 全量
    router.set_weight(new_gpu, weight=1.0)
```

---

> **总结**：Prompt Cache 工程的核心在于三个协同：**推理引擎的 KV Cache 管理**提供底层能力，**缓存感知路由**确保请求到达正确的 GPU，**命中率优化工程**保证最大化缓存价值。三者缺一不可——单独优化推理引擎的缓存策略，如果路由层是轮询的，命中率永远不会超过 1/N。
