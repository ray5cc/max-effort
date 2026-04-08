# 高性能 API 网关内核设计

> 从请求生命周期到插件体系的 API 网关工程实践——提取 Kong/Envoy 的设计精髓，教你从零设计一个生产级网关内核

## 相关链接

- 对应面试题：[高性能API网关内核设计面试题](../../02-面试指南/09-AI-Agent工程化面试/09-高性能API网关内核设计面试题.md)
- 相关技术资料：[AI网关与流量治理](./10-AI网关与流量治理.md)

## TL;DR 速览

1. **API 网关 = 反向代理 + 可编程中间件链**，其核心价值在于将认证、限流、监控等横切关注点从业务服务中剥离
2. **请求生命周期分阶段执行**（类似 Kong 的 8 阶段模型），每个阶段有明确的职责边界，插件只在特定阶段运行
3. **插件体系 = 生命周期钩子 + 作用域继承 + 优先级排序**，实现"全局 → 服务 → 路由 → 消费者"四级配置覆盖
4. **限流算法各有取舍**：固定窗口简单但有边界突发问题，令牌桶适合允许突发的场景，滑动窗口是精度与内存的折中
5. **健康检查 = 主动探测 + 被动统计**，两者结合才能既快速发现故障又避免误判
6. **AI 网关需要特化设计**：SSE 流代理（禁用缓冲）、Token 计数（成本管控）、长连接管理（超时策略）
7. **可观测性必须嵌入网关内核**，而非事后追加——每个阶段的耗时、每个插件的决策都应被记录
8. **水平扩展的关键是无状态数据面**，所有共享状态（路由表、限流计数器）外置到 Redis/PostgreSQL

---

## 目录

1. [为什么需要 API 网关？](#1-为什么需要-api-网关动机与问题背景)
2. [请求生命周期与处理阶段](#2-请求生命周期与处理阶段)
3. [插件/中间件体系设计](#3-插件中间件体系设计)
4. [限流算法工程实现](#4-限流算法工程实现)
5. [认证与鉴权插件设计](#5-认证与鉴权插件设计)
6. [请求/响应转换管线](#6-请求响应转换管线)
7. [上游健康检查与服务发现](#7-上游健康检查与服务发现)
8. [高性能网络模型](#8-高性能网络模型)
9. [可观测性钩子设计](#9-可观测性钩子设计)
10. [AI 网关特化设计](#10-ai-网关特化设计)
11. [常见陷阱与最佳实践](#11-常见陷阱与最佳实践)
12. [从单机到集群：网关的水平扩展](#12-从单机到集群网关的水平扩展)

---

## 1. 为什么需要 API 网关？（动机与问题背景）

### 1.1 微服务架构的横切关注点问题

想象一个拥有 50 个微服务的电商系统。每个服务都需要：

- 验证用户身份（JWT/API Key）
- 限制请求频率（防止滥用）
- 记录访问日志（审计与排查）
- 转换请求/响应格式（版本兼容）
- 收集指标（监控与告警）

如果每个服务自己实现这些功能，会出现：

```
❌ 没有网关的世界：

客户端 ──→ 用户服务   [认证] [限流] [日志] [监控]
客户端 ──→ 订单服务   [认证] [限流] [日志] [监控]
客户端 ──→ 商品服务   [认证] [限流] [日志] [监控]
客户端 ──→ 支付服务   [认证] [限流] [日志] [监控]
           ...       × 50 个服务，每个都重复实现

✅ 有网关的世界：

客户端 ──→ API 网关 [认证] [限流] [日志] [监控] ──→ 用户服务
                                                  ──→ 订单服务
                                                  ──→ 商品服务
                                                  ──→ 支付服务
```

> **类比：大楼的门禁 + 前台 + 安检系统**
>
> API 网关就像一栋大楼的入口管理系统。所有访客（请求）都必须经过同一个入口，
> 在这里完成身份验证（刷卡）、访客登记（日志）、安检（限流/WAF）、
> 引导到正确楼层（路由）。大楼里的每间办公室（微服务）不需要各自配备安检设备，
> 只需要专注自己的业务。

### 1.2 AI 应用为什么需要专用网关？

传统 API 网关（如 Kong、NGINX）设计时假设的是「短请求-短响应」模式，但 AI/LLM 应用打破了这个假设：

| 特性 | 传统 API | AI/LLM API |
|------|---------|------------|
| 响应时间 | 10-500ms | 5s-120s |
| 响应格式 | JSON 一次返回 | SSE 流式分块返回 |
| 计费模型 | 按请求次数 | 按 Token 数量 |
| 资源成本 | CPU 密集 | GPU 密集（$2-60/百万 Token） |
| 负载均衡 | Round-robin 足够 | 需考虑 GPU 利用率和模型亲和性 |
| 安全威胁 | SQL 注入、XSS | Prompt 注入、越狱攻击 |

因此，AI 网关需要在传统网关基础上增加：

- **SSE 流代理**：不能缓冲整个响应再转发，必须逐块透传
- **Token 计数器**：在网关层统计输入/输出 Token，用于成本管控
- **模型感知路由**：根据模型可用性、成本、延迟选择上游
- **Prompt 安全检测**：在网关层拦截恶意 Prompt

### 1.3 开源网关的设计谱系

理解不同网关的设计哲学，有助于提取最佳实践：

```
┌────────────────────────────────────────────────────────────────┐
│                     API 网关设计谱系                            │
├──────────┬────────────┬──────────────┬────────────────────────┤
│  NGINX   │   Kong     │   Envoy      │   Traefik              │
│          │            │              │                        │
│ C 实现    │ Lua 插件   │ C++ 实现      │ Go 实现                │
│ 配置驱动  │ 数据库驱动  │ xDS API 驱动  │ 自动发现驱动            │
│ 同步模型  │ 请求阶段模型│ Filter Chain │ 中间件管道              │
│ 高性能    │ 高可扩展    │ 云原生        │ 简单易用               │
│          │            │              │                        │
│ 启发：    │ 启发：      │ 启发：        │ 启发：                 │
│ 事件驱动  │ 阶段模型    │ Filter 设计  │ 服务发现集成            │
│ 零拷贝    │ 插件体系    │ 可观测性     │ 热加载配置              │
└──────────┴────────────┴──────────────┴────────────────────────┘
```

---

## 2. 请求生命周期与处理阶段

### 2.1 Kong 的阶段模型：设计灵感

Kong（基于 OpenResty/NGINX）将请求处理划分为 8 个阶段，每个阶段有明确职责：

```
                          Kong 请求阶段模型
                          ─────────────────

  客户端请求
      │
      ▼
┌─────────────────┐
│ ssl_certificate  │  TLS 握手阶段：选择证书、SNI 路由
└────────┬────────┘
         ▼
┌─────────────────┐
│    rewrite       │  请求改写：URI 重写、Header 修改（路由匹配前）
└────────┬────────┘
         ▼
┌─────────────────┐
│    access        │  访问控制：认证、鉴权、限流、IP 黑白名单
└────────┬────────┘
         ▼
┌─────────────────┐
│   balancer       │  负载均衡：选择上游节点、重试策略
└────────┬────────┘
         ▼
┌─────────────────┐
│  header_filter   │  响应头过滤：修改/添加/删除响应头
└────────┬────────┘
         ▼
┌─────────────────┐
│   body_filter    │  响应体过滤：修改/转换响应体（可多次调用）
└────────┬────────┘
         ▼
┌─────────────────┐
│      log         │  日志阶段：记录请求/响应信息、推送指标
└────────┬────────┘
         ▼
  返回客户端
```

**为什么要分阶段？** 因为不同的功能需要在不同的时机执行：

- 认证必须在路由到上游之前完成（否则未授权请求会打到后端）
- 限流必须在认证之后（需要知道是谁在请求）
- 响应头修改必须在响应体发送之前（HTTP 协议要求）
- 日志记录必须在所有处理完成之后（需要完整的请求-响应信息）

### 2.2 设计自己的请求生命周期

提取 Kong/Envoy 的精髓，设计一个清晰的阶段模型：

```python
from enum import IntEnum, auto
from dataclasses import dataclass, field
from typing import Any, Callable, Awaitable
import time
import asyncio


class Phase(IntEnum):
    """请求处理阶段，按执行顺序排列。
    
    设计原则：
    1. 每个阶段有明确的职责边界
    2. 阶段间通过 Context 传递数据
    3. 任何阶段都可以短路（提前终止请求）
    """
    INIT        = auto()  # 初始化：解析请求、创建上下文
    REWRITE     = auto()  # 改写：URI 重写、Header 预处理
    AUTH        = auto()  # 认证：身份验证、Token 解析
    ACCESS      = auto()  # 访问控制：权限检查、限流
    ROUTE       = auto()  # 路由匹配：确定上游服务
    BALANCE     = auto()  # 负载均衡：选择具体节点
    UPSTREAM    = auto()  # 上游调用：转发请求到后端
    RESP_HEADER = auto()  # 响应头处理：修改响应头
    RESP_BODY   = auto()  # 响应体处理：转换响应体
    LOG         = auto()  # 日志：记录、指标收集
    CLEANUP     = auto()  # 清理：释放资源、连接回收


@dataclass
class GatewayRequest:
    """网关请求对象"""
    method: str
    path: str
    headers: dict[str, str] = field(default_factory=dict)
    query_params: dict[str, str] = field(default_factory=dict)
    body: bytes = b""
    client_ip: str = ""


@dataclass
class GatewayResponse:
    """网关响应对象"""
    status_code: int = 200
    headers: dict[str, str] = field(default_factory=dict)
    body: bytes = b""
    is_streaming: bool = False


@dataclass
class RequestContext:
    """请求上下文 —— 贯穿整个请求生命周期的数据载体。
    
    类比：像一张随身携带的「旅行清单」，每经过一个关卡（阶段），
    工作人员会在上面盖章、添加信息，后续关卡可以参考前面的记录。
    """
    request: GatewayRequest
    response: GatewayResponse = field(default_factory=GatewayResponse)
    
    # 阶段执行数据
    consumer: dict | None = None      # 认证后的用户信息
    matched_route: dict | None = None  # 匹配到的路由
    upstream_target: str | None = None # 选中的上游节点
    
    # 阶段执行追踪
    phase_timings: dict[str, float] = field(default_factory=dict)
    
    # 短路标志：任何阶段可设为 True 来终止后续阶段
    aborted: bool = False
    abort_status: int = 0
    abort_message: str = ""
    
    # 通用数据存储：插件可以在这里存取跨阶段数据
    store: dict[str, Any] = field(default_factory=dict)

    def abort(self, status: int, message: str):
        """短路请求 —— 阻止后续阶段执行"""
        self.aborted = True
        self.abort_status = status
        self.abort_message = message
        self.response.status_code = status
        self.response.body = message.encode()


# 中间件类型定义
PhaseHandler = Callable[[RequestContext], Awaitable[None]]


class PhaseRunner:
    """阶段执行器 —— 按顺序执行各阶段的中间件。
    
    这是网关的核心调度器，类似于 Kong 的 OpenResty 阶段执行模型，
    但用 Python 实现，更易于理解和扩展。
    """
    
    def __init__(self):
        # 每个阶段对应一组按优先级排序的处理器
        self._handlers: dict[Phase, list[tuple[int, str, PhaseHandler]]] = {
            phase: [] for phase in Phase
        }
    
    def register(self, phase: Phase, handler: PhaseHandler, 
                 priority: int = 100, name: str = ""):
        """注册阶段处理器。priority 越小越先执行。"""
        self._handlers[phase].append((priority, name, handler))
        self._handlers[phase].sort(key=lambda x: x[0])
    
    async def execute(self, ctx: RequestContext):
        """按阶段顺序执行所有处理器"""
        for phase in Phase:
            if ctx.aborted and phase not in (Phase.LOG, Phase.CLEANUP):
                # 请求被短路，但 LOG 和 CLEANUP 阶段必须执行
                continue
            
            start_time = time.monotonic()
            
            for priority, name, handler in self._handlers[phase]:
                try:
                    await handler(ctx)
                    if ctx.aborted and phase not in (Phase.LOG, Phase.CLEANUP):
                        break
                except Exception as e:
                    # LOG 和 CLEANUP 阶段的异常不应影响响应
                    if phase in (Phase.LOG, Phase.CLEANUP):
                        print(f"[WARN] {phase.name}/{name} error: {e}")
                    else:
                        ctx.abort(500, f"Internal error in {phase.name}/{name}")
                        break
            
            elapsed = time.monotonic() - start_time
            ctx.phase_timings[phase.name] = elapsed


# 使用示例
async def demo():
    runner = PhaseRunner()
    
    # 注册一个简单的认证处理器
    async def auth_handler(ctx: RequestContext):
        api_key = ctx.request.headers.get("X-API-Key")
        if not api_key:
            ctx.abort(401, "Missing API Key")
            return
        ctx.consumer = {"id": "user-123", "plan": "pro"}
    
    # 注册日志处理器
    async def log_handler(ctx: RequestContext):
        total = sum(ctx.phase_timings.values())
        print(f"[{ctx.response.status_code}] {ctx.request.method} "
              f"{ctx.request.path} - {total*1000:.1f}ms")
        for phase, timing in ctx.phase_timings.items():
            print(f"  {phase}: {timing*1000:.2f}ms")
    
    runner.register(Phase.AUTH, auth_handler, priority=10, name="api-key-auth")
    runner.register(Phase.LOG, log_handler, priority=100, name="access-log")
    
    # 执行请求
    req = GatewayRequest(method="GET", path="/api/users",
                         headers={"X-API-Key": "sk-abc123"})
    ctx = RequestContext(request=req)
    await runner.execute(ctx)
```

### 2.3 中间件链模式：洋葱模型 vs 管道模型

两种主流的中间件组织模式：

```
洋葱模型（Koa/Express 风格）              管道模型（Kong/Envoy 风格）
─────────────────────────              ────────────────────────

┌─────────────────────────┐            ┌──────┐ ┌──────┐ ┌──────┐
│ Middleware A (before)    │            │ 阶段1 │→│ 阶段2 │→│ 阶段3 │
│  ┌─────────────────────┐│            │ 认证  │ │ 限流  │ │ 路由  │
│  │ Middleware B (before)││            └──────┘ └──────┘ └──────┘
│  │  ┌─────────────────┐││                │        │        │
│  │  │   Handler       │││            ┌──────┐ ┌──────┐ ┌──────┐
│  │  └─────────────────┘││            │ 插件A │ │ 插件C │ │ 插件E │
│  │ Middleware B (after) ││            │ 插件B │ │ 插件D │ │      │
│  └─────────────────────┘│            └──────┘ └──────┘ └──────┘
│ Middleware A (after)     │
└─────────────────────────┘            每个阶段内可有多个插件，
                                       阶段间严格顺序执行
每个中间件同时控制
请求和响应两个方向
```

**Kong 选择管道模型的原因**：阶段边界清晰，插件只需关注自己的阶段，降低了插件开发复杂度。洋葱模型虽然灵活，但中间件之间的耦合更紧密（每个中间件需要决定何时调用 `next()`）。

我们的设计采用**管道模型**，这与 Kong/Envoy 的实践一致。

---

## 3. 插件/中间件体系设计

### 3.1 插件接口设计

> **类比：像乐高积木**
>
> 每个插件是一块乐高积木，有标准的凸点（接口）和凹槽（生命周期钩子）。
> 你可以自由组合不同的积木来搭建不同的功能。
> 有些积木是底板（全局插件，如日志），有些是装饰件（路由插件，如限流），
> 可以选择性地添加到特定位置。

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass
class PluginConfig:
    """插件配置"""
    name: str
    enabled: bool = True
    config: dict[str, Any] = field(default_factory=dict)
    

class GatewayPlugin(ABC):
    """网关插件基类 —— 定义插件在各阶段的钩子方法。
    
    设计灵感来自 Kong 的 Plugin 接口，每个方法对应一个请求阶段。
    插件只需覆盖自己关心的阶段方法，其他阶段自动跳过。
    """
    
    # 插件元信息
    NAME: str = ""
    VERSION: str = "1.0.0"
    PRIORITY: int = 1000  # 越大越先执行（Kong 惯例）
    
    def __init__(self, config: dict[str, Any]):
        self.config = config
    
    # === 请求阶段钩子 ===
    
    async def on_rewrite(self, ctx: RequestContext) -> None:
        """请求改写阶段"""
        pass
    
    async def on_auth(self, ctx: RequestContext) -> None:
        """认证阶段"""
        pass
    
    async def on_access(self, ctx: RequestContext) -> None:
        """访问控制阶段"""
        pass
    
    async def on_balance(self, ctx: RequestContext) -> None:
        """负载均衡阶段"""
        pass
    
    async def on_response_header(self, ctx: RequestContext) -> None:
        """响应头阶段"""
        pass
    
    async def on_response_body(self, ctx: RequestContext) -> None:
        """响应体阶段"""
        pass
    
    async def on_log(self, ctx: RequestContext) -> None:
        """日志阶段"""
        pass

    # === 生命周期钩子 ===
    
    async def init(self) -> None:
        """插件初始化（网关启动时调用）"""
        pass
    
    async def destroy(self) -> None:
        """插件销毁（网关关闭时调用）"""
        pass
    
    def validate_config(self) -> list[str]:
        """验证配置，返回错误列表（空列表表示配置有效）"""
        return []
```

### 3.2 插件管理器：作用域与优先级

Kong 的一个精妙设计是**四级作用域继承**：全局 → 服务 → 路由 → 消费者。更具体的配置会覆盖更宽泛的配置。

```python
from enum import Enum


class PluginScope(Enum):
    GLOBAL   = "global"    # 对所有请求生效
    SERVICE  = "service"   # 对某个服务的所有路由生效
    ROUTE    = "route"     # 对某条路由生效
    CONSUMER = "consumer"  # 对某个消费者生效


@dataclass
class PluginBinding:
    """插件绑定 —— 将插件实例绑定到特定作用域"""
    plugin: GatewayPlugin
    scope: PluginScope
    scope_id: str | None = None  # 非 GLOBAL 时指定具体的 service/route/consumer ID
    enabled: bool = True


class PluginManager:
    """插件管理器 —— 管理插件的注册、作用域解析和执行。
    
    核心职责：
    1. 维护插件注册表
    2. 根据请求上下文解析适用的插件列表
    3. 按优先级排序后注入到 PhaseRunner
    """
    
    def __init__(self):
        self._bindings: list[PluginBinding] = []
        self._plugin_registry: dict[str, type[GatewayPlugin]] = {}
    
    def register_plugin_type(self, plugin_class: type[GatewayPlugin]):
        """注册插件类型"""
        self._plugin_registry[plugin_class.NAME] = plugin_class
    
    def bind(self, plugin_name: str, config: dict, 
             scope: PluginScope = PluginScope.GLOBAL,
             scope_id: str | None = None) -> PluginBinding:
        """绑定插件到指定作用域"""
        plugin_class = self._plugin_registry[plugin_name]
        instance = plugin_class(config)
        
        errors = instance.validate_config()
        if errors:
            raise ValueError(f"Plugin config invalid: {errors}")
        
        binding = PluginBinding(
            plugin=instance, scope=scope, scope_id=scope_id
        )
        self._bindings.append(binding)
        return binding
    
    def resolve_plugins(self, ctx: RequestContext) -> list[GatewayPlugin]:
        """根据请求上下文解析适用的插件列表。
        
        解析规则（模仿 Kong 的作用域覆盖）：
        1. 收集所有匹配的绑定
        2. 同名插件，更具体的作用域覆盖更宽泛的
        3. 按 PRIORITY 降序排列
        """
        matched: dict[str, PluginBinding] = {}
        
        # 按作用域从宽到窄收集，窄作用域覆盖宽作用域
        scope_order = [
            PluginScope.GLOBAL,
            PluginScope.SERVICE,
            PluginScope.ROUTE,
            PluginScope.CONSUMER,
        ]
        
        for scope in scope_order:
            for binding in self._bindings:
                if not binding.enabled:
                    continue
                if binding.scope != scope:
                    continue
                
                # 检查作用域匹配
                if scope == PluginScope.GLOBAL:
                    matched[binding.plugin.NAME] = binding
                elif scope == PluginScope.SERVICE and ctx.matched_route:
                    if binding.scope_id == ctx.matched_route.get("service_id"):
                        matched[binding.plugin.NAME] = binding
                elif scope == PluginScope.ROUTE and ctx.matched_route:
                    if binding.scope_id == ctx.matched_route.get("route_id"):
                        matched[binding.plugin.NAME] = binding
                elif scope == PluginScope.CONSUMER and ctx.consumer:
                    if binding.scope_id == ctx.consumer.get("id"):
                        matched[binding.plugin.NAME] = binding
        
        # 按优先级降序排列
        plugins = [b.plugin for b in matched.values()]
        plugins.sort(key=lambda p: p.PRIORITY, reverse=True)
        return plugins
    
    def integrate_with_runner(self, runner: PhaseRunner):
        """将插件注入到 PhaseRunner 中"""
        phase_method_map = {
            Phase.REWRITE:     "on_rewrite",
            Phase.AUTH:        "on_auth",
            Phase.ACCESS:      "on_access",
            Phase.BALANCE:     "on_balance",
            Phase.RESP_HEADER: "on_response_header",
            Phase.RESP_BODY:   "on_response_body",
            Phase.LOG:         "on_log",
        }
        
        for phase, method_name in phase_method_map.items():
            async def make_handler(ctx, pm=self, mn=method_name):
                plugins = pm.resolve_plugins(ctx)
                for plugin in plugins:
                    method = getattr(plugin, mn)
                    # 只调用被覆盖的方法（跳过基类默认实现）
                    if method.__func__ is not getattr(GatewayPlugin, mn):
                        await method(ctx)
                        if ctx.aborted:
                            break
            
            runner.register(phase, make_handler, name="plugin-manager")
```

### 3.3 插件配置热更新

生产环境中，修改插件配置不能重启网关。实现热更新的关键是**配置版本化 + 原子替换**：

```python
import json
import hashlib
from threading import Lock


class HotConfigManager:
    """热配置管理器 —— 支持不停机更新插件配置。
    
    设计思路：
    1. 配置变更通知（轮询 DB / Watch etcd / Webhook）
    2. 新配置验证
    3. 创建新的插件实例
    4. 原子替换旧实例（利用引用赋值的原子性）
    5. 销毁旧实例
    """
    
    def __init__(self, plugin_manager: PluginManager):
        self._pm = plugin_manager
        self._config_hash: str = ""
        self._lock = Lock()
    
    def _compute_hash(self, config: dict) -> str:
        raw = json.dumps(config, sort_keys=True)
        return hashlib.sha256(raw.encode()).hexdigest()[:16]
    
    async def apply_config(self, new_config: dict) -> bool:
        """应用新配置（热更新核心流程）"""
        new_hash = self._compute_hash(new_config)
        if new_hash == self._config_hash:
            return False  # 配置未变更
        
        with self._lock:
            # 1. 验证新配置
            errors = self._validate_config(new_config)
            if errors:
                raise ValueError(f"Config validation failed: {errors}")
            
            # 2. 构建新的绑定列表
            new_bindings: list[PluginBinding] = []
            for entry in new_config.get("plugins", []):
                binding = self._pm.bind(
                    plugin_name=entry["name"],
                    config=entry.get("config", {}),
                    scope=PluginScope(entry.get("scope", "global")),
                    scope_id=entry.get("scope_id"),
                )
                new_bindings.append(binding)
            
            # 3. 初始化新插件
            for binding in new_bindings:
                await binding.plugin.init()
            
            # 4. 原子替换（Python 引用赋值是原子的）
            old_bindings = self._pm._bindings
            self._pm._bindings = new_bindings
            
            # 5. 销毁旧插件
            for binding in old_bindings:
                await binding.plugin.destroy()
            
            self._config_hash = new_hash
            return True
    
    def _validate_config(self, config: dict) -> list[str]:
        errors = []
        for entry in config.get("plugins", []):
            if "name" not in entry:
                errors.append("Plugin entry missing 'name'")
            elif entry["name"] not in self._pm._plugin_registry:
                errors.append(f"Unknown plugin: {entry['name']}")
        return errors
```

---

## 4. 限流算法工程实现

### 4.1 为什么限流是网关的核心功能？

> **类比：高速公路的收费站**
>
> 想象一条高速公路入口。如果不限流，早高峰时所有车辆同时涌入，
> 公路会瘫痪（服务过载）。收费站（限流器）的作用是控制进入公路的车流量，
> 保证公路上的车辆能正常通行。不同的限流算法就像不同的收费策略：
>
> - **固定窗口**：每小时放行 1000 辆（简单但在小时交界处可能突发 2000 辆）
> - **滑动窗口**：任意连续 60 分钟内最多 1000 辆（精确但需要记录每辆车的时间）
> - **令牌桶**：桶里有令牌，每秒产生 N 个，车来了拿一个令牌（允许短暂突发）
> - **漏桶**：固定速率放行，多余的排队等待（输出速率恒定）

### 4.2 五种限流算法实现

#### 算法 1：固定窗口计数器（Fixed Window Counter）

```python
import time
import redis


class FixedWindowLimiter:
    """固定窗口限流器
    
    原理：将时间划分为固定大小的窗口，每个窗口有独立的计数器。
    优点：实现简单，内存开销小（每个窗口仅一个计数器）。
    缺点：窗口边界处可能出现 2 倍突发流量。
    
    例：限制 100 req/min，在第 59 秒和第 61 秒各来 100 个请求，
    实际 2 秒内处理了 200 个请求（远超预期速率）。
    """
    
    def __init__(self, r: redis.Redis, limit: int, window_seconds: int):
        self.redis = r
        self.limit = limit
        self.window = window_seconds
    
    def allow(self, key: str) -> tuple[bool, dict]:
        window_start = int(time.time()) // self.window
        redis_key = f"rl:fw:{key}:{window_start}"
        
        pipe = self.redis.pipeline()
        pipe.incr(redis_key)
        pipe.expire(redis_key, self.window)
        count, _ = pipe.execute()
        
        remaining = max(0, self.limit - count)
        return count <= self.limit, {
            "limit": self.limit,
            "remaining": remaining,
            "reset": (window_start + 1) * self.window,
        }
```

#### 算法 2：滑动窗口日志（Sliding Window Log）

```python
class SlidingWindowLogLimiter:
    """滑动窗口日志限流器
    
    原理：记录每个请求的时间戳，统计窗口内的请求数。
    优点：精度最高，无突发问题。
    缺点：内存开销大（需存储窗口内所有请求的时间戳）。
    
    适用：请求量不大但精度要求高的场景（如 API Key 的日限额）。
    """
    
    def __init__(self, r: redis.Redis, limit: int, window_seconds: int):
        self.redis = r
        self.limit = limit
        self.window = window_seconds
    
    def allow(self, key: str) -> tuple[bool, dict]:
        now = time.time()
        redis_key = f"rl:swl:{key}"
        window_start = now - self.window
        
        # 使用 Sorted Set，score 为时间戳
        # Lua 脚本保证原子性
        lua_script = """
        local key = KEYS[1]
        local now = tonumber(ARGV[1])
        local window_start = tonumber(ARGV[2])
        local limit = tonumber(ARGV[3])
        local ttl = tonumber(ARGV[4])
        
        -- 清除过期记录
        redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)
        
        -- 统计当前窗口内的请求数
        local count = redis.call('ZCARD', key)
        
        if count < limit then
            -- 添加当前请求
            redis.call('ZADD', key, now, now .. '-' .. math.random(1000000))
            redis.call('EXPIRE', key, ttl)
            return {1, limit - count - 1}
        else
            redis.call('EXPIRE', key, ttl)
            return {0, 0}
        end
        """
        
        result = self.redis.eval(
            lua_script, 1, redis_key,
            str(now), str(window_start), str(self.limit), str(self.window)
        )
        
        allowed = result[0] == 1
        remaining = result[1]
        return allowed, {
            "limit": self.limit,
            "remaining": remaining,
            "reset": int(now + self.window),
        }
```

#### 算法 3：滑动窗口计数器（Sliding Window Counter）

```python
class SlidingWindowCounterLimiter:
    """滑动窗口计数器 —— 精度与内存的最佳平衡。
    
    原理：结合固定窗口和滑动窗口的优点。
    维护两个固定窗口（当前 + 上一个），用加权计算近似滑动窗口内的请求数。
    
    公式：estimated_count = prev_count × (1 - elapsed_ratio) + curr_count
    
    例：窗口 60s，当前窗口过去了 20s（即 elapsed_ratio = 20/60 ≈ 0.33）
    estimated = prev_count × 0.67 + curr_count
    
    优点：仅需 2 个计数器，接近滑动窗口的精度。
    Kong 和 Cloudflare 在生产中使用此算法。
    """
    
    def __init__(self, r: redis.Redis, limit: int, window_seconds: int):
        self.redis = r
        self.limit = limit
        self.window = window_seconds
    
    def allow(self, key: str) -> tuple[bool, dict]:
        now = time.time()
        current_window = int(now) // self.window
        prev_window = current_window - 1
        elapsed_in_current = now - current_window * self.window
        weight = 1 - elapsed_in_current / self.window
        
        lua_script = """
        local curr_key = KEYS[1]
        local prev_key = KEYS[2]
        local limit = tonumber(ARGV[1])
        local weight = tonumber(ARGV[2])
        local ttl = tonumber(ARGV[3])
        
        local prev_count = tonumber(redis.call('GET', prev_key) or '0')
        local curr_count = tonumber(redis.call('GET', curr_key) or '0')
        
        local estimated = prev_count * weight + curr_count
        
        if estimated < limit then
            redis.call('INCR', curr_key)
            redis.call('EXPIRE', curr_key, ttl * 2)
            return {1, math.floor(limit - estimated - 1)}
        else
            return {0, 0}
        end
        """
        
        curr_key = f"rl:swc:{key}:{current_window}"
        prev_key = f"rl:swc:{key}:{prev_window}"
        
        result = self.redis.eval(
            lua_script, 2, curr_key, prev_key,
            str(self.limit), str(weight), str(self.window)
        )
        
        allowed = result[0] == 1
        remaining = result[1]
        return allowed, {
            "limit": self.limit,
            "remaining": remaining,
            "reset": int((current_window + 1) * self.window),
        }
```

#### 算法 4：令牌桶（Token Bucket）

```python
class TokenBucketLimiter:
    """令牌桶限流器
    
    原理：桶中有一定数量的令牌，每个请求消耗一个令牌。
    令牌按固定速率补充，桶满时停止补充。
    
    优点：允许短暂突发流量（桶中存量令牌可以应对突发）。
    适用：对突发流量友好的场景，如用户操作触发的 API 调用。
    
    参数：
    - capacity：桶容量（允许的最大突发量）
    - refill_rate：每秒补充的令牌数（稳态速率）
    """
    
    def __init__(self, r: redis.Redis, capacity: int, refill_rate: float):
        self.redis = r
        self.capacity = capacity
        self.refill_rate = refill_rate
    
    def allow(self, key: str, tokens: int = 1) -> tuple[bool, dict]:
        redis_key = f"rl:tb:{key}"
        now = time.time()
        
        lua_script = """
        local key = KEYS[1]
        local capacity = tonumber(ARGV[1])
        local refill_rate = tonumber(ARGV[2])
        local now = tonumber(ARGV[3])
        local requested = tonumber(ARGV[4])
        
        local data = redis.call('HMGET', key, 'tokens', 'last_refill')
        local tokens = tonumber(data[1]) or capacity
        local last_refill = tonumber(data[2]) or now
        
        -- 补充令牌
        local elapsed = now - last_refill
        local refilled = math.min(capacity, tokens + elapsed * refill_rate)
        
        local allowed = 0
        local remaining = 0
        
        if refilled >= requested then
            remaining = refilled - requested
            allowed = 1
        else
            remaining = refilled
            allowed = 0
        end
        
        redis.call('HMSET', key, 'tokens', remaining, 'last_refill', now)
        redis.call('EXPIRE', key, math.ceil(capacity / refill_rate) * 2)
        
        return {allowed, math.floor(remaining)}
        """
        
        result = self.redis.eval(
            lua_script, 1, redis_key,
            str(self.capacity), str(self.refill_rate),
            str(now), str(tokens)
        )
        
        allowed = result[0] == 1
        remaining = result[1]
        return allowed, {
            "limit": self.capacity,
            "remaining": remaining,
            "retry_after": 0 if allowed else (tokens / self.refill_rate),
        }
```

#### 算法 5：漏桶（Leaky Bucket）

```python
class LeakyBucketLimiter:
    """漏桶限流器
    
    原理：请求进入桶中排队，以固定速率从桶底漏出处理。
    桶满时直接拒绝新请求。
    
    优点：输出速率恒定，保护下游服务不受突发流量冲击。
    缺点：不能利用突发来提高吞吐量，响应延迟可能增加。
    
    适用：需要严格控制下游请求速率的场景（如调用第三方付费 API）。
    """
    
    def __init__(self, r: redis.Redis, capacity: int, leak_rate: float):
        self.redis = r
        self.capacity = capacity
        self.leak_rate = leak_rate  # 每秒漏出的请求数
    
    def allow(self, key: str) -> tuple[bool, dict]:
        redis_key = f"rl:lb:{key}"
        now = time.time()
        
        lua_script = """
        local key = KEYS[1]
        local capacity = tonumber(ARGV[1])
        local leak_rate = tonumber(ARGV[2])
        local now = tonumber(ARGV[3])
        
        local data = redis.call('HMGET', key, 'water', 'last_leak')
        local water = tonumber(data[1]) or 0
        local last_leak = tonumber(data[2]) or now
        
        -- 漏水：计算自上次以来漏出的量
        local elapsed = now - last_leak
        local leaked = elapsed * leak_rate
        water = math.max(0, water - leaked)
        
        local allowed = 0
        if water < capacity then
            water = water + 1
            allowed = 1
        end
        
        redis.call('HMSET', key, 'water', water, 'last_leak', now)
        redis.call('EXPIRE', key, math.ceil(capacity / leak_rate) * 2)
        
        return {allowed, math.floor(capacity - water)}
        """
        
        result = self.redis.eval(
            lua_script, 1, redis_key,
            str(self.capacity), str(self.leak_rate), str(now)
        )
        
        allowed = result[0] == 1
        remaining = result[1]
        return allowed, {
            "limit": self.capacity,
            "remaining": remaining,
        }
```

### 4.3 限流算法对比

| 算法 | 精度 | 内存 | 突发支持 | 分布式复杂度 | 典型使用者 |
|------|------|------|---------|-------------|-----------|
| 固定窗口 | ★★☆ | ★☆☆ | ❌ 有边界突发 | 低 | 简单内部 API |
| 滑动窗口日志 | ★★★ | ★★★ | ❌ | 中 | API Key 日限额 |
| 滑动窗口计数器 | ★★★ | ★☆☆ | ❌ | 低 | **Kong / Cloudflare** |
| 令牌桶 | ★★☆ | ★☆☆ | ✅ 允许突发 | 中 | **AWS API Gateway** |
| 漏桶 | ★★☆ | ★☆☆ | ❌ 平滑输出 | 中 | 调用第三方 API |

### 4.4 多维度限流

真实网关需要支持多维度限流：按消费者、按路由、按服务，甚至组合限流：

```python
class MultiDimensionRateLimiter:
    """多维度限流器 —— 支持按不同维度组合限流"""
    
    def __init__(self, r: redis.Redis):
        self.redis = r
        self.limiters = {
            "sliding_window": SlidingWindowCounterLimiter,
            "token_bucket": TokenBucketLimiter,
        }
    
    def check(self, ctx: RequestContext, rules: list[dict]) -> tuple[bool, dict]:
        """检查多条限流规则，任何一条不通过则拒绝。
        
        rules 示例：
        [
            {"dimension": "consumer", "limit": 100, "window": 60, "algo": "sliding_window"},
            {"dimension": "route",    "limit": 1000, "window": 60, "algo": "sliding_window"},
            {"dimension": "global",   "limit": 10000, "window": 60, "algo": "sliding_window"},
        ]
        """
        results = []
        for rule in rules:
            key = self._build_key(ctx, rule["dimension"])
            algo = rule.get("algo", "sliding_window")
            
            if algo == "sliding_window":
                limiter = SlidingWindowCounterLimiter(
                    self.redis, rule["limit"], rule["window"]
                )
            elif algo == "token_bucket":
                limiter = TokenBucketLimiter(
                    self.redis, rule["limit"], rule.get("refill_rate", rule["limit"] / rule["window"])
                )
            else:
                continue
            
            allowed, info = limiter.allow(key)
            results.append((allowed, info, rule["dimension"]))
            
            if not allowed:
                return False, {
                    "rejected_by": rule["dimension"],
                    **info,
                }
        
        # 所有规则都通过
        min_remaining = min(r[1]["remaining"] for r in results) if results else 0
        return True, {"remaining": min_remaining}
    
    def _build_key(self, ctx: RequestContext, dimension: str) -> str:
        if dimension == "consumer" and ctx.consumer:
            return f"consumer:{ctx.consumer['id']}"
        elif dimension == "route" and ctx.matched_route:
            return f"route:{ctx.matched_route['route_id']}"
        elif dimension == "service" and ctx.matched_route:
            return f"service:{ctx.matched_route.get('service_id', 'default')}"
        else:
            return "global"
```

---

## 5. 认证与鉴权插件设计

### 5.1 认证策略的可组合设计

网关需要支持多种认证方式，且应该可以灵活组合。设计一个**策略模式**的认证框架：

```python
from abc import ABC, abstractmethod
import jwt
import hashlib
import hmac
import time


class AuthStrategy(ABC):
    """认证策略基类"""
    
    @abstractmethod
    async def authenticate(self, ctx: RequestContext) -> dict | None:
        """执行认证。成功返回用户信息 dict，失败返回 None。"""
        pass
    
    @abstractmethod
    def extract_credentials(self, ctx: RequestContext) -> str | None:
        """从请求中提取凭证"""
        pass


class APIKeyAuthStrategy(AuthStrategy):
    """API Key 认证策略"""
    
    def __init__(self, key_store: dict[str, dict]):
        # key_store: {"sk-abc123": {"id": "user-1", "plan": "pro"}, ...}
        self.key_store = key_store
    
    def extract_credentials(self, ctx: RequestContext) -> str | None:
        # 支持多种位置：Header / Query Param
        key = ctx.request.headers.get("X-API-Key")
        if not key:
            key = ctx.request.query_params.get("api_key")
        return key
    
    async def authenticate(self, ctx: RequestContext) -> dict | None:
        key = self.extract_credentials(ctx)
        if not key:
            return None
        
        # 用 hash 查找，避免存储明文 Key
        key_hash = hashlib.sha256(key.encode()).hexdigest()
        return self.key_store.get(key_hash)


class JWTAuthStrategy(AuthStrategy):
    """JWT 认证策略"""
    
    def __init__(self, secret: str, algorithms: list[str] = None,
                 issuer: str | None = None):
        self.secret = secret
        self.algorithms = algorithms or ["HS256"]
        self.issuer = issuer
    
    def extract_credentials(self, ctx: RequestContext) -> str | None:
        auth_header = ctx.request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            return auth_header[7:]
        return None
    
    async def authenticate(self, ctx: RequestContext) -> dict | None:
        token = self.extract_credentials(ctx)
        if not token:
            return None
        
        try:
            payload = jwt.decode(
                token, self.secret,
                algorithms=self.algorithms,
                issuer=self.issuer,
                options={"require": ["exp", "sub"]},
            )
            return {
                "id": payload["sub"],
                "claims": payload,
                "auth_method": "jwt",
            }
        except jwt.ExpiredSignatureError:
            return None
        except jwt.InvalidTokenError:
            return None


class CompositeAuthPlugin(GatewayPlugin):
    """可组合的认证插件 —— 支持多种认证策略。
    
    设计思路：
    1. 按优先级尝试每种认证策略
    2. 任一策略成功则认证通过
    3. 所有策略都失败则拒绝请求
    4. 认证结果写入 ctx.consumer 供下游使用
    """
    
    NAME = "composite-auth"
    PRIORITY = 2000  # 高优先级，确保在限流等插件之前执行
    
    def __init__(self, config: dict):
        super().__init__(config)
        self.strategies: list[AuthStrategy] = []
        self.anonymous_allowed = config.get("anonymous", False)
    
    def add_strategy(self, strategy: AuthStrategy):
        self.strategies.append(strategy)
    
    async def on_auth(self, ctx: RequestContext):
        for strategy in self.strategies:
            cred = strategy.extract_credentials(ctx)
            if cred is None:
                continue  # 此策略不适用，尝试下一个
            
            consumer = await strategy.authenticate(ctx)
            if consumer:
                ctx.consumer = consumer
                ctx.store["auth_method"] = consumer.get("auth_method", "unknown")
                return  # 认证成功
            else:
                # 提供了凭证但无效 → 直接拒绝
                ctx.abort(401, "Invalid credentials")
                return
        
        # 没有找到任何凭证
        if not self.anonymous_allowed:
            ctx.abort(401, "Authentication required")
        else:
            ctx.consumer = {"id": "anonymous", "plan": "free"}
```

### 5.2 RBAC 与 ABAC 鉴权

认证解决了「你是谁」，鉴权解决「你能做什么」：

```python
@dataclass
class Permission:
    resource: str  # e.g., "orders", "users"
    action: str    # e.g., "read", "write", "delete"


class RBACAuthorizer:
    """基于角色的访问控制"""
    
    def __init__(self):
        self.role_permissions: dict[str, set[tuple[str, str]]] = {}
    
    def grant(self, role: str, resource: str, action: str):
        if role not in self.role_permissions:
            self.role_permissions[role] = set()
        self.role_permissions[role].add((resource, action))
    
    def check(self, roles: list[str], resource: str, action: str) -> bool:
        for role in roles:
            perms = self.role_permissions.get(role, set())
            if (resource, action) in perms or ("*", "*") in perms:
                return True
        return False


class ABACAuthorizer:
    """基于属性的访问控制 —— 更灵活的策略引擎"""
    
    def __init__(self):
        self.policies: list[dict] = []
    
    def add_policy(self, policy: dict):
        """添加策略。
        
        policy 示例：
        {
            "effect": "allow",
            "conditions": {
                "consumer.plan": ["pro", "enterprise"],
                "request.method": ["DELETE"],
                "time.hour": {"gte": 9, "lte": 17},  # 仅工作时间
            }
        }
        """
        self.policies.append(policy)
    
    def evaluate(self, attributes: dict) -> bool:
        for policy in self.policies:
            if self._match_conditions(policy["conditions"], attributes):
                return policy["effect"] == "allow"
        return False  # 默认拒绝
    
    def _match_conditions(self, conditions: dict, attrs: dict) -> bool:
        for key, expected in conditions.items():
            actual = attrs.get(key)
            if isinstance(expected, list):
                if actual not in expected:
                    return False
            elif isinstance(expected, dict):
                if "gte" in expected and actual < expected["gte"]:
                    return False
                if "lte" in expected and actual > expected["lte"]:
                    return False
            else:
                if actual != expected:
                    return False
        return True


class AuthorizationPlugin(GatewayPlugin):
    """鉴权插件"""
    
    NAME = "authorization"
    PRIORITY = 1900  # 在认证之后、限流之前
    
    def __init__(self, config: dict):
        super().__init__(config)
        self.rbac = RBACAuthorizer()
        self.abac = ABACAuthorizer()
    
    async def on_access(self, ctx: RequestContext):
        if not ctx.consumer:
            return  # 未认证，由认证插件处理
        
        route = ctx.matched_route or {}
        resource = route.get("resource", "default")
        action = self._method_to_action(ctx.request.method)
        
        # RBAC 检查
        roles = ctx.consumer.get("roles", [])
        if not self.rbac.check(roles, resource, action):
            ctx.abort(403, f"Forbidden: insufficient role for {action} on {resource}")
            return
    
    def _method_to_action(self, method: str) -> str:
        return {
            "GET": "read", "HEAD": "read",
            "POST": "write", "PUT": "write", "PATCH": "write",
            "DELETE": "delete",
        }.get(method, "read")
```

---

## 6. 请求/响应转换管线

### 6.1 转换插件的核心抽象

```python
import json
from typing import AsyncIterator


class TransformPlugin(GatewayPlugin):
    """请求/响应转换插件"""
    
    NAME = "transform"
    PRIORITY = 1500
    
    def __init__(self, config: dict):
        super().__init__(config)
        self.request_transforms = config.get("request", {})
        self.response_transforms = config.get("response", {})
    
    async def on_rewrite(self, ctx: RequestContext):
        """请求转换"""
        rt = self.request_transforms
        
        # Header 注入
        for key, value in rt.get("add_headers", {}).items():
            ctx.request.headers[key] = value
        
        # Header 删除
        for key in rt.get("remove_headers", []):
            ctx.request.headers.pop(key, None)
        
        # 路径重写
        if "path_rewrite" in rt:
            import re
            pattern, replacement = rt["path_rewrite"]
            ctx.request.path = re.sub(pattern, replacement, ctx.request.path)
        
        # Body 转换（如 XML → JSON）
        if rt.get("body_format") == "xml_to_json":
            ctx.request.body = self._xml_to_json(ctx.request.body)
            ctx.request.headers["Content-Type"] = "application/json"
    
    async def on_response_header(self, ctx: RequestContext):
        """响应头转换"""
        rt = self.response_transforms
        
        for key, value in rt.get("add_headers", {}).items():
            ctx.response.headers[key] = value
        
        for key in rt.get("remove_headers", []):
            ctx.response.headers.pop(key, None)
        
        # 添加安全头
        if rt.get("security_headers", False):
            ctx.response.headers.update({
                "X-Content-Type-Options": "nosniff",
                "X-Frame-Options": "DENY",
                "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
            })
    
    def _xml_to_json(self, xml_body: bytes) -> bytes:
        # 简化实现，实际需要用 xml.etree.ElementTree
        return xml_body  # placeholder


class SSETransformPlugin(GatewayPlugin):
    """SSE 流式响应转换插件 —— AI 网关的关键组件。
    
    处理 LLM 的 SSE 输出流：
    1. 逐块透传（不缓冲整个响应）
    2. 可选：注入额外字段（如 token 计数、成本信息）
    3. 可选：格式转换（如 OpenAI 格式 → 自定义格式）
    """
    
    NAME = "sse-transform"
    PRIORITY = 1400
    
    async def on_response_header(self, ctx: RequestContext):
        if ctx.response.headers.get("Content-Type", "").startswith("text/event-stream"):
            ctx.response.is_streaming = True
            # 确保不缓冲 SSE 流
            ctx.response.headers["X-Accel-Buffering"] = "no"
            ctx.response.headers["Cache-Control"] = "no-cache"
            ctx.response.headers["Connection"] = "keep-alive"
    
    async def transform_sse_chunk(self, chunk: bytes, ctx: RequestContext) -> bytes:
        """转换单个 SSE 块。
        
        输入格式（OpenAI 风格）：
        data: {"id":"chatcmpl-xxx","choices":[{"delta":{"content":"Hello"}}]}
        
        可在此处注入额外信息或转换格式。
        """
        if not chunk.startswith(b"data: "):
            return chunk
        
        data_str = chunk[6:].strip()
        if data_str == b"[DONE]":
            # 在流结束时注入统计信息
            token_count = ctx.store.get("total_tokens", 0)
            stats_event = (
                f'data: {{"type":"usage","total_tokens":{token_count}}}\n\n'
            )
            return chunk + stats_event.encode()
        
        try:
            data = json.loads(data_str)
            # 统计 token（简化：按字符数估算）
            content = ""
            for choice in data.get("choices", []):
                delta = choice.get("delta", {})
                content += delta.get("content", "")
            
            ctx.store["total_tokens"] = ctx.store.get("total_tokens", 0) + len(content) // 4
            return chunk
        except json.JSONDecodeError:
            return chunk
```

---

## 7. 上游健康检查与服务发现

### 7.1 健康检查的必要性

> **类比：医院的体检系统**
>
> - **主动健康检查**（Active）：像定期体检 —— 每隔一段时间主动检查各项指标，
>   即使没有感觉不适也能提前发现问题。
> - **被动健康检查**（Passive）：像根据症状就诊 —— 发现请求失败（出现症状）
>   后才标记节点不健康。
>
> 两者结合才能既快速发现故障（被动），又避免误判（主动确认恢复）。

### 7.2 健康检查状态机

```
                    健康检查状态机
                    ──────────────

    ┌──────────┐   连续失败 ≥ N 次    ┌──────────────┐
    │ HEALTHY  │ ─────────────────→ │  UNHEALTHY   │
    │ (健康)    │                     │ (不健康)      │
    └──────────┘                     └──────────────┘
         ▲                                  │
         │                                  │
         │  连续成功 ≥ M 次                    │ 主动探测成功
         │                                  ▼
         │                           ┌──────────────┐
         └────────────────────────── │  RECOVERING  │
                                     │ (恢复中)      │
                                     └──────────────┘
    
    HEALTHY：    正常接收流量
    UNHEALTHY：  从负载均衡池中移除，仅接受主动探测
    RECOVERING： 接收少量试探流量（渐进恢复）
```

### 7.3 健康检查器实现

```python
import asyncio
import aiohttp
from dataclasses import dataclass, field
from enum import Enum
from collections import deque
import time


class HealthState(Enum):
    HEALTHY     = "healthy"
    UNHEALTHY   = "unhealthy"
    RECOVERING  = "recovering"


@dataclass
class UpstreamTarget:
    """上游目标节点"""
    address: str          # "host:port"
    weight: int = 100     # 负载均衡权重
    state: HealthState = HealthState.HEALTHY
    
    # 健康检查统计
    consecutive_failures: int = 0
    consecutive_successes: int = 0
    total_requests: int = 0
    total_failures: int = 0
    last_check_time: float = 0
    
    # 被动检查窗口
    recent_results: deque = field(default_factory=lambda: deque(maxlen=100))


@dataclass
class HealthCheckConfig:
    """健康检查配置"""
    # 主动检查配置
    active_enabled: bool = True
    active_path: str = "/health"
    active_interval: float = 10.0       # 秒
    active_timeout: float = 5.0         # 秒
    active_healthy_threshold: int = 3   # 连续成功 N 次标记为健康
    active_unhealthy_threshold: int = 3 # 连续失败 N 次标记为不健康
    active_healthy_http_statuses: list[int] = field(
        default_factory=lambda: [200, 302]
    )
    
    # 被动检查配置
    passive_enabled: bool = True
    passive_unhealthy_threshold: int = 5  # 窗口内失败 N 次标记为不健康
    passive_unhealthy_http_statuses: list[int] = field(
        default_factory=lambda: [500, 502, 503, 504]
    )


class HealthChecker:
    """健康检查器 —— 结合主动和被动检查。
    
    参考 Kong 的健康检查实现：
    https://docs.konghq.com/gateway/latest/how-kong-works/health-checks/
    """
    
    def __init__(self, config: HealthCheckConfig):
        self.config = config
        self.targets: dict[str, UpstreamTarget] = {}
        self._running = False
    
    def add_target(self, address: str, weight: int = 100):
        self.targets[address] = UpstreamTarget(address=address, weight=weight)
    
    # === 被动健康检查 ===
    
    def record_result(self, address: str, status_code: int, latency: float):
        """记录请求结果（由网关主流程调用）。
        
        这就是被动健康检查：基于真实流量的响应来判断健康状态。
        """
        target = self.targets.get(address)
        if not target:
            return
        
        if not self.config.passive_enabled:
            return
        
        target.total_requests += 1
        is_failure = status_code in self.config.passive_unhealthy_http_statuses
        target.recent_results.append(not is_failure)
        
        if is_failure:
            target.total_failures += 1
            target.consecutive_failures += 1
            target.consecutive_successes = 0
            
            if (target.consecutive_failures >= self.config.passive_unhealthy_threshold
                    and target.state == HealthState.HEALTHY):
                self._mark_unhealthy(target, "passive: consecutive failures")
        else:
            target.consecutive_successes += 1
            target.consecutive_failures = 0
    
    # === 主动健康检查 ===
    
    async def start_active_checks(self):
        """启动主动健康检查循环"""
        if not self.config.active_enabled:
            return
        
        self._running = True
        while self._running:
            await self._check_all_targets()
            await asyncio.sleep(self.config.active_interval)
    
    async def stop(self):
        self._running = False
    
    async def _check_all_targets(self):
        """并发检查所有目标"""
        tasks = [self._check_target(t) for t in self.targets.values()]
        await asyncio.gather(*tasks, return_exceptions=True)
    
    async def _check_target(self, target: UpstreamTarget):
        """主动探测单个目标"""
        url = f"http://{target.address}{self.config.active_path}"
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    url, timeout=aiohttp.ClientTimeout(total=self.config.active_timeout)
                ) as resp:
                    target.last_check_time = time.time()
                    
                    if resp.status in self.config.active_healthy_http_statuses:
                        self._handle_active_success(target)
                    else:
                        self._handle_active_failure(target, f"HTTP {resp.status}")
        except Exception as e:
            target.last_check_time = time.time()
            self._handle_active_failure(target, str(e))
    
    def _handle_active_success(self, target: UpstreamTarget):
        target.consecutive_successes += 1
        target.consecutive_failures = 0
        
        if target.state == HealthState.UNHEALTHY:
            target.state = HealthState.RECOVERING
            print(f"[HEALTH] {target.address}: UNHEALTHY → RECOVERING")
        
        if (target.state == HealthState.RECOVERING
                and target.consecutive_successes >= self.config.active_healthy_threshold):
            target.state = HealthState.HEALTHY
            print(f"[HEALTH] {target.address}: RECOVERING → HEALTHY")
    
    def _handle_active_failure(self, target: UpstreamTarget, reason: str):
        target.consecutive_failures += 1
        target.consecutive_successes = 0
        
        if (target.consecutive_failures >= self.config.active_unhealthy_threshold
                and target.state != HealthState.UNHEALTHY):
            self._mark_unhealthy(target, f"active: {reason}")
    
    def _mark_unhealthy(self, target: UpstreamTarget, reason: str):
        target.state = HealthState.UNHEALTHY
        print(f"[HEALTH] {target.address}: → UNHEALTHY ({reason})")
    
    # === 负载均衡集成 ===
    
    def get_healthy_targets(self) -> list[UpstreamTarget]:
        """返回可用于负载均衡的目标列表"""
        result = []
        for target in self.targets.values():
            if target.state == HealthState.HEALTHY:
                result.append(target)
            elif target.state == HealthState.RECOVERING:
                # 恢复中的节点给予较低的权重
                recovering = UpstreamTarget(
                    address=target.address,
                    weight=target.weight // 4,  # 25% 权重
                    state=target.state,
                )
                result.append(recovering)
        return result
```

### 7.4 加权轮询负载均衡

```python
class WeightedRoundRobinBalancer:
    """加权轮询负载均衡器（参考 NGINX 的平滑加权轮询算法）"""
    
    def __init__(self, health_checker: HealthChecker):
        self.health_checker = health_checker
        self._current_weights: dict[str, int] = {}
    
    def select(self) -> UpstreamTarget | None:
        """选择下一个目标节点（NGINX 平滑加权轮询）。
        
        算法步骤：
        1. 每个节点的 current_weight += effective_weight
        2. 选择 current_weight 最大的节点
        3. 被选中的节点 current_weight -= total_weight
        
        效果：权重高的节点被选中次数多，但不会连续选中，
        而是均匀分散在选择序列中。
        """
        targets = self.health_checker.get_healthy_targets()
        if not targets:
            return None
        
        total_weight = sum(t.weight for t in targets)
        
        # 初始化 current_weight
        for t in targets:
            if t.address not in self._current_weights:
                self._current_weights[t.address] = 0
        
        # 清理已移除的目标
        active_addrs = {t.address for t in targets}
        self._current_weights = {
            k: v for k, v in self._current_weights.items() if k in active_addrs
        }
        
        # 步骤 1：增加权重
        for t in targets:
            self._current_weights[t.address] += t.weight
        
        # 步骤 2：选择最大
        selected = max(targets, key=lambda t: self._current_weights[t.address])
        
        # 步骤 3：减少被选中节点的权重
        self._current_weights[selected.address] -= total_weight
        
        return selected
```

---

## 8. 高性能网络模型

### 8.1 事件驱动 I/O

高性能网关的基石是非阻塞事件驱动 I/O。以下是核心概念的简化实现：

```
                    事件驱动 I/O 模型
                    ─────────────────

    ┌────────────┐
    │  客户端连接  │ ×10000
    └─────┬──────┘
          │
          ▼
    ┌────────────────────────┐
    │     epoll/kqueue        │   OS 内核的事件通知机制
    │  "哪些 fd 有事件？"      │   一次调用返回所有就绪 fd
    └─────────┬──────────────┘
              │ 返回就绪的 fd 列表
              ▼
    ┌────────────────────────┐
    │    事件循环（单线程）     │   逐个处理就绪事件
    │                        │   没有线程切换开销
    │  for fd in ready_fds:  │
    │    handle(fd)           │   处理器不能阻塞！
    └────────────────────────┘

    对比传统模型（每连接一线程）：
    - 10000 连接 = 10000 线程 = 巨大的内存和调度开销
    - 事件驱动：10000 连接 = 1 个线程 + epoll
```

```go
// Go 语言实现高性能网关的核心循环（利用 goroutine）
// Go 的 runtime 底层已使用 epoll，goroutine 是轻量级协程

package main

import (
    "context"
    "fmt"
    "io"
    "net"
    "net/http"
    "net/http/httputil"
    "net/url"
    "sync"
    "time"
)

// ConnectionPool 管理到上游的连接池
type ConnectionPool struct {
    mu       sync.Mutex
    pools    map[string]*http.Transport
    maxConns int
}

func NewConnectionPool(maxConns int) *ConnectionPool {
    return &ConnectionPool{
        pools:    make(map[string]*http.Transport),
        maxConns: maxConns,
    }
}

func (cp *ConnectionPool) GetTransport(upstream string) *http.Transport {
    cp.mu.Lock()
    defer cp.mu.Unlock()

    if t, ok := cp.pools[upstream]; ok {
        return t
    }

    t := &http.Transport{
        MaxIdleConns:        cp.maxConns,
        MaxIdleConnsPerHost: cp.maxConns,
        IdleConnTimeout:     90 * time.Second,
        // 关键：启用 keep-alive 复用连接
        DisableKeepAlives: false,
        // 关键：使用自定义 DialContext 支持连接超时
        DialContext: (&net.Dialer{
            Timeout:   5 * time.Second,
            KeepAlive: 30 * time.Second,
        }).DialContext,
        // 响应头超时
        ResponseHeaderTimeout: 30 * time.Second,
    }

    cp.pools[upstream] = t
    return t
}

// GracefulShutdown 优雅关闭
func GracefulShutdown(server *http.Server, timeout time.Duration) {
    ctx, cancel := context.WithTimeout(context.Background(), timeout)
    defer cancel()

    // 1. 停止接受新连接
    // 2. 等待现有请求完成（最多 timeout 时间）
    // 3. 强制关闭未完成的连接
    if err := server.Shutdown(ctx); err != nil {
        fmt.Printf("Shutdown error: %v\n", err)
    }
}
```

### 8.2 性能调优参数

| 参数 | 说明 | 推荐值 | 原因 |
|------|------|--------|------|
| `MaxIdleConnsPerHost` | 每个上游的最大空闲连接 | 100-500 | 避免频繁建立 TCP 连接 |
| `IdleConnTimeout` | 空闲连接超时 | 90s | 平衡连接复用和资源占用 |
| `ReadTimeout` | 读取请求的超时 | 30s | 防止慢客户端占用资源 |
| `WriteTimeout` | 写入响应的超时 | 120s（AI 场景） | LLM 响应时间长 |
| `SO_REUSEPORT` | 端口复用 | 启用 | 多进程监听同一端口，内核级负载均衡 |
| `TCP_NODELAY` | 禁用 Nagle 算法 | 启用 | 减少小包延迟（SSE 场景关键） |
| Buffer Size | 读写缓冲区大小 | 4-16KB | 普通 API；SSE 场景用更小的缓冲 |

### 8.3 零拷贝与缓冲管理

```python
# 零拷贝概念说明：减少数据在内核空间和用户空间之间的拷贝次数

# 传统方式（4 次拷贝）：
# 磁盘 → 内核缓冲区 → 用户空间 → 内核 socket 缓冲区 → 网卡
#
# sendfile 零拷贝（2 次拷贝）：
# 磁盘 → 内核缓冲区 → 网卡（直接 DMA 传输）

# 在 Python 中使用 sendfile（适用于静态文件代理）
import os
import socket


def serve_file_zero_copy(client_sock: socket.socket, filepath: str):
    """使用 sendfile 零拷贝发送文件"""
    fd = os.open(filepath, os.O_RDONLY)
    file_size = os.fstat(fd).st_size
    
    # 发送 HTTP 头
    header = (
        f"HTTP/1.1 200 OK\r\n"
        f"Content-Length: {file_size}\r\n"
        f"\r\n"
    ).encode()
    client_sock.sendall(header)
    
    # 零拷贝发送文件内容
    offset = 0
    while offset < file_size:
        sent = os.sendfile(client_sock.fileno(), fd, offset, file_size - offset)
        offset += sent
    
    os.close(fd)


# SSE 流式场景的缓冲管理
class StreamBuffer:
    """流式缓冲管理器 —— 适用于 SSE 代理场景。
    
    核心原则：不要缓冲整个响应，而是逐块转发。
    但也不能每个字节都转发（系统调用开销太大），
    需要找到合适的粒度：按 SSE 事件边界切分。
    """
    
    def __init__(self, max_buffer_size: int = 4096):
        self.buffer = bytearray()
        self.max_size = max_buffer_size
    
    def feed(self, data: bytes) -> list[bytes]:
        """输入数据，输出完整的 SSE 事件列表"""
        self.buffer.extend(data)
        events = []
        
        while True:
            # SSE 事件以 \n\n 结尾
            idx = self.buffer.find(b"\n\n")
            if idx == -1:
                break
            
            event = bytes(self.buffer[:idx + 2])
            self.buffer = self.buffer[idx + 2:]
            events.append(event)
        
        # 防止缓冲区无限增长（格式错误的流）
        if len(self.buffer) > self.max_size:
            overflow = bytes(self.buffer)
            self.buffer.clear()
            events.append(overflow)
        
        return events
```

---

## 9. 可观测性钩子设计

### 9.1 三大支柱：Metrics、Traces、Logs

```
                    可观测性架构
                    ──────────

                ┌──────────────┐
                │   Dashboard   │  Grafana / 自定义 UI
                └──────┬───────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
  ┌───────────┐  ┌───────────┐  ┌───────────┐
  │  Metrics   │  │  Traces   │  │   Logs    │
  │ Prometheus │  │  Jaeger   │  │   ELK     │
  │            │  │  Zipkin   │  │  Loki     │
  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘
        │              │              │
        └──────────────┼──────────────┘
                       │
              ┌────────┴────────┐
              │  Gateway Core   │
              │                 │
              │  Phase: INIT    │ ← 创建 trace span
              │  Phase: AUTH    │ ← 记录认证结果
              │  Phase: ACCESS  │ ← 记录限流决策
              │  Phase: UPSTREAM│ ← 记录上游延迟
              │  Phase: LOG     │ ← 汇总输出所有指标
              └─────────────────┘
```

### 9.2 可观测性插件实现

```python
import time
import json
from dataclasses import dataclass, field
from collections import defaultdict
import uuid


@dataclass
class MetricsCollector:
    """指标收集器 —— 收集网关运行时的指标数据"""
    
    # 计数器
    counters: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    # 直方图（存储延迟分布）
    histograms: dict[str, list[float]] = field(
        default_factory=lambda: defaultdict(list)
    )
    
    def increment(self, name: str, labels: dict = None, value: int = 1):
        key = self._key(name, labels)
        self.counters[key] += value
    
    def observe(self, name: str, value: float, labels: dict = None):
        key = self._key(name, labels)
        self.histograms[key].append(value)
    
    def _key(self, name: str, labels: dict = None) -> str:
        if labels:
            label_str = ",".join(f'{k}="{v}"' for k, v in sorted(labels.items()))
            return f"{name}{{{label_str}}}"
        return name
    
    def to_prometheus(self) -> str:
        """导出为 Prometheus 格式"""
        lines = []
        for key, value in self.counters.items():
            lines.append(f"{key} {value}")
        for key, values in self.histograms.items():
            if values:
                avg = sum(values) / len(values)
                p99 = sorted(values)[int(len(values) * 0.99)] if values else 0
                lines.append(f"{key}_avg {avg:.6f}")
                lines.append(f"{key}_p99 {p99:.6f}")
                lines.append(f"{key}_count {len(values)}")
        return "\n".join(lines)


class ObservabilityPlugin(GatewayPlugin):
    """可观测性插件 —— 在各阶段收集指标、生成日志和 trace。"""
    
    NAME = "observability"
    PRIORITY = 3000  # 最高优先级，确保第一个执行
    
    def __init__(self, config: dict):
        super().__init__(config)
        self.metrics = MetricsCollector()
        self.enable_tracing = config.get("tracing", True)
        self.enable_access_log = config.get("access_log", True)
    
    async def on_rewrite(self, ctx: RequestContext):
        # 创建请求级 trace
        trace_id = ctx.request.headers.get(
            "traceparent", ""
        ).split("-")[1] if "traceparent" in ctx.request.headers else uuid.uuid4().hex[:32]
        
        span_id = uuid.uuid4().hex[:16]
        
        ctx.store["trace_id"] = trace_id
        ctx.store["span_id"] = span_id
        ctx.store["request_start"] = time.monotonic()
        
        # W3C Trace Context 传播
        if self.enable_tracing:
            ctx.request.headers["traceparent"] = (
                f"00-{trace_id}-{span_id}-01"
            )
        
        self.metrics.increment("gateway_requests_total", {
            "method": ctx.request.method,
            "path": self._normalize_path(ctx.request.path),
        })
    
    async def on_log(self, ctx: RequestContext):
        # 计算总延迟
        total_latency = time.monotonic() - ctx.store.get("request_start", time.monotonic())
        
        labels = {
            "method": ctx.request.method,
            "status": str(ctx.response.status_code),
            "route": ctx.matched_route.get("route_id", "unknown") if ctx.matched_route else "unknown",
        }
        
        # 记录指标
        self.metrics.observe("gateway_request_duration_seconds", total_latency, labels)
        self.metrics.increment("gateway_responses_total", labels)
        
        if ctx.response.status_code >= 500:
            self.metrics.increment("gateway_errors_total", labels)
        
        # 结构化访问日志
        if self.enable_access_log:
            log_entry = {
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "trace_id": ctx.store.get("trace_id", ""),
                "method": ctx.request.method,
                "path": ctx.request.path,
                "status": ctx.response.status_code,
                "latency_ms": round(total_latency * 1000, 2),
                "client_ip": ctx.request.client_ip,
                "consumer": ctx.consumer.get("id") if ctx.consumer else None,
                "upstream": ctx.upstream_target,
                "phase_timings": {
                    k: round(v * 1000, 2) for k, v in ctx.phase_timings.items()
                },
                "auth_method": ctx.store.get("auth_method"),
            }
            # 实际生产中输出到文件/Kafka/stdout
            print(json.dumps(log_entry, ensure_ascii=False))
    
    def _normalize_path(self, path: str) -> str:
        """路径归一化：/users/123 → /users/:id（避免高基数指标）"""
        import re
        normalized = re.sub(r'/\d+', '/:id', path)
        normalized = re.sub(r'/[0-9a-f-]{36}', '/:uuid', normalized)
        return normalized
```

---

## 10. AI 网关特化设计

### 10.1 SSE 流代理

LLM API 返回的 SSE 流需要特殊处理——**不能缓冲**，必须逐块透传：

```python
import asyncio
import aiohttp
from typing import AsyncIterator


class SSEProxy:
    """SSE 流代理 —— AI 网关的核心组件。
    
    关键设计点：
    1. 禁用所有缓冲（proxy_buffering off）
    2. 逐块透传，不等待完整响应
    3. 支持客户端断开检测
    4. 支持超时控制（LLM 可能需要 120s+）
    """
    
    async def proxy_sse(
        self,
        upstream_url: str,
        request_body: dict,
        headers: dict,
        client_writer: asyncio.StreamWriter,
    ) -> dict:
        """代理 SSE 流请求"""
        stats = {
            "total_chunks": 0,
            "total_bytes": 0,
            "first_token_ms": 0,
            "total_ms": 0,
        }
        
        start_time = time.monotonic()
        first_chunk = True
        
        timeout = aiohttp.ClientTimeout(
            total=300,      # 总超时 5 分钟
            connect=10,     # 连接超时 10 秒
            sock_read=120,  # 读取超时 120 秒（两个 chunk 之间）
        )
        
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(
                upstream_url,
                json=request_body,
                headers={
                    **headers,
                    "Accept": "text/event-stream",
                },
            ) as resp:
                # 先发送响应头
                resp_headers = (
                    f"HTTP/1.1 {resp.status} OK\r\n"
                    f"Content-Type: text/event-stream\r\n"
                    f"Cache-Control: no-cache\r\n"
                    f"Connection: keep-alive\r\n"
                    f"X-Accel-Buffering: no\r\n"
                    f"\r\n"
                )
                client_writer.write(resp_headers.encode())
                await client_writer.drain()
                
                # 逐块透传
                async for chunk in resp.content.iter_any():
                    if first_chunk:
                        stats["first_token_ms"] = (
                            (time.monotonic() - start_time) * 1000
                        )
                        first_chunk = False
                    
                    stats["total_chunks"] += 1
                    stats["total_bytes"] += len(chunk)
                    
                    try:
                        client_writer.write(chunk)
                        await client_writer.drain()
                    except (ConnectionResetError, BrokenPipeError):
                        # 客户端断开
                        break
        
        stats["total_ms"] = (time.monotonic() - start_time) * 1000
        return stats
```

### 10.2 Token 计数与成本管控

```python
import tiktoken


class TokenCounter:
    """Token 计数器 —— 在网关层统计 Token 使用量。
    
    为什么在网关层做？
    1. 统一计费：所有模型的 Token 消耗在同一处统计
    2. 预算控制：在转发前检查是否超出预算
    3. 成本路由：根据预估 Token 数选择更经济的模型
    """
    
    def __init__(self):
        self._encoders: dict[str, tiktoken.Encoding] = {}
    
    def _get_encoder(self, model: str) -> tiktoken.Encoding:
        if model not in self._encoders:
            try:
                self._encoders[model] = tiktoken.encoding_for_model(model)
            except KeyError:
                self._encoders[model] = tiktoken.get_encoding("cl100k_base")
        return self._encoders[model]
    
    def count_input_tokens(self, model: str, messages: list[dict]) -> int:
        """计算输入 Token 数（请求转发前）"""
        encoder = self._get_encoder(model)
        total = 0
        for msg in messages:
            total += 4  # 消息格式开销
            total += len(encoder.encode(msg.get("content", "")))
            total += len(encoder.encode(msg.get("role", "")))
        total += 2  # 对话格式开销
        return total
    
    def count_output_tokens(self, model: str, text: str) -> int:
        """计算输出 Token 数（从 SSE 流中累积）"""
        encoder = self._get_encoder(model)
        return len(encoder.encode(text))


class CostRouter:
    """基于成本的路由决策器"""
    
    # 价格：美元/百万 Token（input/output）
    MODEL_PRICING = {
        "gpt-4o":         {"input": 2.50,  "output": 10.00},
        "gpt-4o-mini":    {"input": 0.15,  "output": 0.60},
        "claude-sonnet":  {"input": 3.00,  "output": 15.00},
        "claude-haiku":   {"input": 0.25,  "output": 1.25},
    }
    
    def __init__(self, token_counter: TokenCounter):
        self.counter = token_counter
    
    def estimate_cost(self, model: str, input_tokens: int, 
                      estimated_output_tokens: int = 500) -> float:
        """预估请求成本（美元）"""
        pricing = self.MODEL_PRICING.get(model, {"input": 1.0, "output": 1.0})
        input_cost = input_tokens / 1_000_000 * pricing["input"]
        output_cost = estimated_output_tokens / 1_000_000 * pricing["output"]
        return input_cost + output_cost
    
    def select_model(self, messages: list[dict], 
                     budget_per_request: float = 0.01,
                     preferred_models: list[str] = None) -> str:
        """根据预算选择模型。
        
        策略：优先选择偏好模型中能满足预算的最优模型。
        """
        candidates = preferred_models or list(self.MODEL_PRICING.keys())
        
        for model in candidates:
            input_tokens = self.counter.count_input_tokens(model, messages)
            cost = self.estimate_cost(model, input_tokens)
            if cost <= budget_per_request:
                return model
        
        # 预算不足，选择最便宜的
        cheapest = min(
            candidates,
            key=lambda m: self.MODEL_PRICING.get(m, {}).get("input", float('inf'))
        )
        return cheapest
```

### 10.3 Prompt 注入检测插件

```python
import re


class PromptInjectionDetector:
    """Prompt 注入检测 —— 作为网关插件在请求到达 LLM 前拦截。
    
    检测策略（多层防御）：
    1. 关键词匹配（快速但易绕过）
    2. 模式匹配（正则表达式）
    3. 语义分析（需调用分类模型，可选）
    """
    
    # 高风险模式
    INJECTION_PATTERNS = [
        r"ignore\s+(previous|above|all)\s+(instructions?|prompts?|rules?)",
        r"you\s+are\s+now\s+(?:a|an|the)\s+",
        r"(?:system|admin|root)\s*:\s*",
        r"(?:forget|disregard|override)\s+(?:everything|all|your)",
        r"jailbreak|DAN|do\s+anything\s+now",
        r"pretend\s+(?:you|to)\s+(?:are|be)\s+",
        r"(?:repeat|print|output|show)\s+(?:your|the)\s+(?:system|initial)\s+(?:prompt|instructions?)",
    ]
    
    def __init__(self, threshold: float = 0.7):
        self.threshold = threshold
        self._compiled = [re.compile(p, re.IGNORECASE) for p in self.INJECTION_PATTERNS]
    
    def detect(self, text: str) -> tuple[bool, float, list[str]]:
        """检测文本是否包含 Prompt 注入。
        
        返回：(is_injection, confidence, matched_patterns)
        """
        matched = []
        for pattern in self._compiled:
            if pattern.search(text):
                matched.append(pattern.pattern)
        
        if not matched:
            return False, 0.0, []
        
        confidence = min(1.0, len(matched) * 0.3 + 0.4)
        return confidence >= self.threshold, confidence, matched


class PromptGuardPlugin(GatewayPlugin):
    """Prompt 安全网关插件"""
    
    NAME = "prompt-guard"
    PRIORITY = 1800  # 在认证之后、转发之前
    
    def __init__(self, config: dict):
        super().__init__(config)
        self.detector = PromptInjectionDetector(
            threshold=config.get("threshold", 0.7)
        )
        self.action = config.get("action", "block")  # block / warn / log
    
    async def on_access(self, ctx: RequestContext):
        if ctx.request.headers.get("Content-Type") != "application/json":
            return
        
        try:
            body = json.loads(ctx.request.body)
        except json.JSONDecodeError:
            return
        
        # 检查 messages 中的用户输入
        messages = body.get("messages", [])
        for msg in messages:
            if msg.get("role") != "user":
                continue
            
            content = msg.get("content", "")
            is_injection, confidence, patterns = self.detector.detect(content)
            
            if is_injection:
                ctx.store["prompt_injection_detected"] = True
                ctx.store["injection_confidence"] = confidence
                
                if self.action == "block":
                    ctx.abort(
                        403,
                        json.dumps({
                            "error": "prompt_injection_detected",
                            "message": "Request blocked: potential prompt injection",
                            "confidence": confidence,
                        })
                    )
                    return
                elif self.action == "warn":
                    ctx.response.headers["X-Prompt-Guard"] = "warning"
```

### 10.4 模型感知负载均衡

```python
@dataclass
class ModelEndpoint:
    """模型端点"""
    address: str
    model: str
    max_concurrent: int = 10
    current_load: int = 0
    avg_latency_ms: float = 0
    gpu_utilization: float = 0  # 0-1


class ModelAwareBalancer:
    """模型感知负载均衡器 —— 考虑 GPU 利用率和模型亲和性。
    
    与传统 Round-Robin 不同，AI 负载均衡需要考虑：
    1. GPU 显存利用率（避免 OOM）
    2. 模型是否已加载（避免冷启动）
    3. 当前并发请求数（KV Cache 竞争）
    """
    
    def __init__(self):
        self.endpoints: dict[str, list[ModelEndpoint]] = {}
    
    def register(self, endpoint: ModelEndpoint):
        if endpoint.model not in self.endpoints:
            self.endpoints[endpoint.model] = []
        self.endpoints[endpoint.model].append(endpoint)
    
    def select(self, model: str) -> ModelEndpoint | None:
        candidates = self.endpoints.get(model, [])
        if not candidates:
            return None
        
        # 过滤掉过载的端点
        available = [
            ep for ep in candidates
            if ep.current_load < ep.max_concurrent
            and ep.gpu_utilization < 0.9
        ]
        
        if not available:
            return None
        
        # 加权评分：综合考虑负载、延迟、GPU 利用率
        def score(ep: ModelEndpoint) -> float:
            load_score = 1 - (ep.current_load / ep.max_concurrent)
            latency_score = 1 / (1 + ep.avg_latency_ms / 1000)
            gpu_score = 1 - ep.gpu_utilization
            return load_score * 0.4 + latency_score * 0.3 + gpu_score * 0.3
        
        return max(available, key=score)
```

---

## 11. 常见陷阱与最佳实践

### ❌ 陷阱 1：在网关层缓冲 SSE 流
```python
# ❌ 错误：等待完整响应再转发
async def proxy_bad(upstream_url, client):
    resp = await aiohttp.get(upstream_url)
    body = await resp.read()  # 等待完整响应！
    client.write(body)        # 用户要等 30 秒才看到第一个字
```

```python
# ✅ 正确：逐块透传 SSE 流
async def proxy_good(upstream_url, client):
    async with aiohttp.get(upstream_url) as resp:
        async for chunk in resp.content.iter_any():
            client.write(chunk)
            await client.drain()  # 用户几乎即时看到输出
```

### ❌ 陷阱 2：限流 Key 使用高基数字段
```python
# ❌ 错误：用完整 URL 作为限流 Key
key = f"rl:{request.url}"  # /users/123, /users/456... 每个用户都是独立 Key
# 结果：限流器内存暴涨，且无法真正保护后端

# ✅ 正确：用归一化路径
key = f"rl:{normalize(request.path)}"  # /users/:id → 所有用户共享一个限流桶
```

### ❌ 陷阱 3：健康检查不区分主动/被动
```python
# ❌ 错误：只用被动检查 → 短暂网络抖动就标记节点不健康
def on_error(target):
    target.state = UNHEALTHY  # 一次失败就下线？太激进了！

# ✅ 正确：被动标记不健康后，用主动检查确认和恢复
def on_error(target):
    target.consecutive_failures += 1
    if target.consecutive_failures >= threshold:
        target.state = UNHEALTHY
        start_active_probe(target)  # 主动探测确认并检测恢复
```

### ❌ 陷阱 4：插件执行顺序不确定
```python
# ❌ 错误：依赖插件注册顺序
plugins = [RateLimitPlugin(), AuthPlugin()]  # 先限流后认证？
# 结果：未认证的请求也占用限流配额

# ✅ 正确：用优先级明确排序
class AuthPlugin(GatewayPlugin):
    PRIORITY = 2000  # 高优先级，先执行

class RateLimitPlugin(GatewayPlugin):
    PRIORITY = 1000  # 低优先级，后执行
# 执行顺序：Auth(2000) → RateLimit(1000) → ...
```

### ❌ 陷阱 5：网关存储有状态数据
```python
# ❌ 错误：限流计数器存在内存中
class InMemoryLimiter:
    counters = {}  # 重启丢失，多实例不共享

# ✅ 正确：外置到 Redis
class RedisLimiter:
    def __init__(self, redis_client):
        self.redis = redis_client  # 多实例共享，持久化
```

### ❌ 陷阱 6：日志中包含敏感信息
```python
# ❌ 错误：日志中记录完整 Authorization 头
log.info(f"Request headers: {request.headers}")  
# 日志泄露了 JWT Token / API Key！

# ✅ 正确：脱敏处理
def sanitize_headers(headers: dict) -> dict:
    sensitive = {"authorization", "x-api-key", "cookie"}
    return {
        k: ("***" if k.lower() in sensitive else v)
        for k, v in headers.items()
    }
log.info(f"Request headers: {sanitize_headers(request.headers)}")
```

### ❌ 陷阱 7：Metrics 标签基数爆炸
```python
# ❌ 错误：把用户 ID 作为 Metrics 标签
metrics.increment("requests", labels={"user_id": "user-12345"})
# 10 万用户 = 10 万个时间序列 → Prometheus OOM

# ✅ 正确：用低基数标签
metrics.increment("requests", labels={
    "method": "GET",     # 基数 ~7
    "status": "200",     # 基数 ~50
    "route": "/api/v1/users/:id",  # 归一化后基数 ~100
})
```

### ❌ 陷阱 8：忽略优雅关闭
```python
# ❌ 错误：直接杀进程
# kill -9 gateway_pid  ← 正在处理的请求全部中断

# ✅ 正确：优雅关闭
import signal

def shutdown_handler(signum, frame):
    # 1. 停止接受新连接
    server.stop_accepting()
    # 2. 等待现有请求完成（设超时）
    server.drain(timeout=30)
    # 3. 关闭连接池
    connection_pool.close()
    # 4. 刷新日志和指标
    metrics.flush()
    logger.flush()
    # 5. 退出
    sys.exit(0)

signal.signal(signal.SIGTERM, shutdown_handler)
```

---

## 12. 从单机到集群：网关的水平扩展

### 12.1 无状态数据面设计

水平扩展的第一原则：**网关实例必须是无状态的**。

```
                    控制面 / 数据面 分离架构
                    ────────────────────────

    ┌──────────────────────────────────────────────────┐
    │                  控制面 (Control Plane)            │
    │                                                  │
    │  ┌───────────┐  ┌───────────┐  ┌───────────┐    │
    │  │ Admin API  │  │ Config DB │  │ Dashboard  │    │
    │  │           │  │ (PostgreSQL│  │           │    │
    │  └─────┬─────┘  └─────┬─────┘  └───────────┘    │
    │        │              │                          │
    │        └──────┬───────┘                          │
    │               │ 配置下发 (Push / Pull)             │
    └───────────────┼──────────────────────────────────┘
                    │
         ┌──────────┼──────────┐
         ▼          ▼          ▼
    ┌─────────┐ ┌─────────┐ ┌─────────┐
    │ 数据面 1 │ │ 数据面 2 │ │ 数据面 3 │   无状态
    │ Gateway  │ │ Gateway  │ │ Gateway  │   可任意扩缩
    │ Instance │ │ Instance │ │ Instance │
    └────┬────┘ └────┬────┘ └────┬────┘
         │          │          │
         │    ┌─────┴─────┐    │
         └───→│   Redis    │←──┘    共享状态
              │ (限流/缓存) │        （外置存储）
              └───────────┘
```

### 12.2 配置同步与一致性

```typescript
// TypeScript 实现配置同步器
interface GatewayConfig {
  version: number;
  routes: RouteConfig[];
  plugins: PluginConfig[];
  upstreams: UpstreamConfig[];
}

interface RouteConfig {
  id: string;
  path: string;
  methods: string[];
  serviceId: string;
  plugins: PluginConfig[];
}

interface PluginConfig {
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

interface UpstreamConfig {
  id: string;
  targets: { address: string; weight: number }[];
  healthCheck: HealthCheckConfig;
}

class ConfigSynchronizer {
  private currentConfig: GatewayConfig | null = null;
  private configVersion = 0;
  private pollInterval = 5000; // 5 秒轮询
  private configSource: string;

  constructor(configSource: string) {
    this.configSource = configSource;
  }

  /**
   * 长轮询配置变更（参考 Kong 的混合模式）
   * 
   * 控制面推送 vs 数据面拉取：
   * - Push（WebSocket）：实时性好，但控制面需维护所有连接
   * - Pull（长轮询）：实现简单，延迟可接受（5-10 秒）
   * - Kong 混合模式使用 Push（WebSocket + mTLS）
   */
  async startSync(onUpdate: (config: GatewayConfig) => Promise<void>): Promise<void> {
    while (true) {
      try {
        const response = await fetch(
          `${this.configSource}/config?version=${this.configVersion}`,
          {
            headers: { "If-None-Match": `"${this.configVersion}"` },
            signal: AbortSignal.timeout(30000), // 长轮询 30 秒超时
          }
        );

        if (response.status === 304) {
          // 配置未变更
          continue;
        }

        if (response.ok) {
          const newConfig: GatewayConfig = await response.json();

          // 版本检查（防止回退）
          if (newConfig.version <= this.configVersion) {
            continue;
          }

          // 验证配置
          const errors = this.validateConfig(newConfig);
          if (errors.length > 0) {
            console.error("Config validation failed:", errors);
            continue;
          }

          // 原子更新
          await onUpdate(newConfig);
          this.currentConfig = newConfig;
          this.configVersion = newConfig.version;
          console.log(`Config updated to version ${newConfig.version}`);
        }
      } catch (error) {
        console.error("Config sync error:", error);
        await new Promise(resolve => setTimeout(resolve, this.pollInterval));
      }
    }
  }

  private validateConfig(config: GatewayConfig): string[] {
    const errors: string[] = [];

    // 检查路由冲突
    const paths = new Set<string>();
    for (const route of config.routes) {
      const key = `${route.methods.join(",")}:${route.path}`;
      if (paths.has(key)) {
        errors.push(`Duplicate route: ${key}`);
      }
      paths.add(key);
    }

    // 检查插件引用
    const knownPlugins = new Set([
      "composite-auth", "rate-limit", "transform",
      "observability", "prompt-guard", "sse-transform",
    ]);
    for (const plugin of config.plugins) {
      if (!knownPlugins.has(plugin.name)) {
        errors.push(`Unknown plugin: ${plugin.name}`);
      }
    }

    return errors;
  }
}
```

### 12.3 蓝绿部署与金丝雀发布

```
                    网关蓝绿部署
                    ──────────

    阶段 1：蓝色（当前版本）正常运行
    ─────────────────────────────
    
    LB ──→ [Blue v1.0] [Blue v1.0] [Blue v1.0]
    
    
    阶段 2：部署绿色（新版本），但不接流量
    ─────────────────────────────
    
    LB ──→ [Blue v1.0] [Blue v1.0] [Blue v1.0]
           [Green v1.1] [Green v1.1] [Green v1.1]  ← 内部测试
    
    
    阶段 3：金丝雀 —— 将 5% 流量切到绿色
    ─────────────────────────────
    
    LB ─95%→ [Blue v1.0] [Blue v1.0] [Blue v1.0]
       ─5%→  [Green v1.1]
    
    
    阶段 4：逐步扩大绿色流量（25% → 50% → 100%）
    ─────────────────────────────
    
    LB ─100%→ [Green v1.1] [Green v1.1] [Green v1.1]
              [Blue v1.0] ← 保留用于回滚，无流量
```

网关的蓝绿部署需要注意的特殊问题：

1. **长连接迁移**：SSE/WebSocket 连接不能直接切断，需要等待自然结束
2. **配置版本兼容**：新旧版本网关可能同时运行，配置格式需要向后兼容
3. **限流状态连续**：切换过程中 Redis 限流计数器不受影响（因为外置存储）

---

## 延伸阅读

| 资源 | 说明 |
|------|------|
| [Kong Gateway 源码](https://github.com/Kong/kong) | Lua 插件体系和阶段模型的参考实现 |
| [Envoy Proxy 架构](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview) | Filter Chain 和 xDS 配置的工业级实现 |
| [NGINX 开发指南](https://nginx.org/en/docs/dev/development_guide.html) | 事件驱动模型和高性能网络编程 |
| [Traefik 文档](https://doc.traefik.io/traefik/) | Go 实现的云原生网关，自动服务发现 |
| [OpenResty 最佳实践](https://moonbingning.gitbooks.io/openresty-best-practices/) | Lua + NGINX 的可编程网关实践 |
