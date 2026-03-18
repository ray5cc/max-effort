# 04-可观测性与SRE

> 从“为什么看不到问题”到“用数据说话”——构建可观测性体系与 SRE 可靠性工程，帮助团队更快定位、恢复并预防事故。

## 相关链接

- 对应面试题：[可观测性与 SRE 面试题](../../02-面试指南/06-DevOps与云计算面试/04-可观测性与SRE面试题.md)
- 上一篇：[CI/CD 与 GitOps](./03-CICD与GitOps.md)
- [DevOps 与云计算总目录](./README.md)

---

## 目录

1. [为什么要做可观测性与 SRE](#1-为什么要做可观测性与-sre)
2. [核心概念与类比](#2-核心概念与类比)
3. [数据采集与埋点实践](#3-数据采集与埋点实践)
4. [平台架构与告警策略](#4-平台架构与告警策略)
5. [事件响应与可靠性工程](#5-事件响应与可靠性工程)
6. [实践案例：K8s 微服务观测栈](#6-实践案例k8s-微服务观测栈)
7. [常见陷阱与最佳实践](#7-常见陷阱与最佳实践)

---

## 1. 为什么要做可观测性与 SRE

- **复杂度激增**：微服务、K8s、Serverless、异步队列让调用链更长，传统“SSH 上去看日志”不再可行。
- **缩短 MTTR**：平均修复时间 (MTTR) 降低 1 分钟，往往意味着更高的收入或 SLA 兑现。
- **容量与成本最优**：通过 SLI/SLO 和 Error Budget，让容量扩缩容更有依据，而非拍脑袋。
- **合规与审计**：日志与事件留痕，支撑安全审计与事后复盘。

> 生活类比：**汽车仪表盘**告诉你车速、油量、引擎警告；缺少仪表盘的车，故障只能靠“听声音”猜。可观测性就是给分布式系统装上可信的仪表。

---

## 2. 核心概念与类比

### 2.1 Observability 三支柱

| 维度 | 作用 | 常见技术 | 类比 |
| ---- | ---- | -------- | ---- |
| Metrics | 定量趋势、SLO 计算 | Prometheus、CloudWatch | 车速表/油量表 |
| Logs | 细节排障、审计 | Loki、ELK、Cloud Logging | 行车记录仪 |
| Traces | 跨服务链路与延迟拆分 | OpenTelemetry、Jaeger、Tempo | 地图导航的“整段路线” |

> 观测是“看”，可观测性是“解释原因的能力”。三支柱是数据形态，真正需要的是让数据能回答“为什么慢/错/贵”。

### 2.2 SLI / SLO / Error Budget

- **SLI（服务指标）**：可量化的体验度量，如请求成功率、P99 延迟。
- **SLO（服务目标）**：对 SLI 设定的目标阈值，如“99.9% 四周滚动窗口”。
- **Error Budget（误差预算）**：1 - SLO；可用来决定发布节奏与风险。

> 类比：网店承诺“次日达”(SLO)，当月能容忍 0.1% 延迟包裹(Error Budget)。预算用完就要“暂停大促 = 冻结发布”。

### 2.3 Golden Signals 与 RED

- **Golden Signals（请求类）**：Latency、Traffic、Errors、Saturation（延迟/流量/错误/饱和）。
- **RED（微服务类）**：Rate、Errors、Duration，偏重 API 网关/服务。

> 类比：餐厅厨房监控：订单速率 Rate、退单率 Errors、出菜耗时 Duration。

### 2.4 Toil、Runbook、Postmortem

- **Toil**：重复、可脚本化的运维劳动，过多会吞噬 SRE 时间。
- **Runbook/Playbook**：标准化操作手册，减少“凭经验”。
- **Blameless Postmortem**：事后复盘关注系统与流程改进，而非责备个人。

---

## 3. 数据采集与埋点实践

### 3.1 指标（Metrics）设计

- 类型选择：`Counter`（累计量）、`Gauge`（瞬时量）、`Histogram`（延迟分布）、`Summary`（分位数）。
- 维度控制：限制高基数标签，如用户 ID；倾向使用“用户分级/区域/版本”。
- 采样与保留：热数据短保留（1-3 天高分辨率），冷数据降采样。

**Prometheus Python 示例（Histogram 延迟监控）**

```python
from prometheus_client import Histogram, start_http_server
import time, random

REQUEST_LATENCY = Histogram(
    "checkout_latency_seconds",
    "Checkout latency histogram",
    buckets=[0.05, 0.1, 0.2, 0.5, 1, 2]
)

def checkout():
    with REQUEST_LATENCY.time():
        time.sleep(random.uniform(0.05, 0.8))

if __name__ == "__main__":
    start_http_server(8000)  # /metrics 暴露
    while True:
        checkout()
```

### 3.2 日志（Logs）落地

- 结构化：JSON 日志包含 `trace_id`/`span_id`/`request_id`，方便与 Traces 关联。
- 分层：应用日志（业务）、访问日志（HTTP）、审计日志（安全）。
- 留痕：保留上下文（用户、版本、机房）且注意隐私脱敏。

**Nginx 访问日志示例（带 Trace 上下文）**

```nginx
log_format trace '$remote_addr - $request [$time_local] '
                 '"$status" $body_bytes_sent '
                 '"$http_user_agent" trace_id=$http_traceparent';
access_log /var/log/nginx/access.log trace;
```

### 3.3 链路追踪（Traces）与 OpenTelemetry

- **上下文传播**：W3C Trace Context (`traceparent`)，避免跨服务丢链。
- **采样策略**：Head Sampling 控制入口采样率；Tail Sampling 用于保留异常样本。
- **Instrumentation**：优先使用官方/社区自动注入，再补关键自定义 Span。

**Node.js OpenTelemetry 入口采样示例**

```javascript
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { TraceIdRatioBasedSampler, ParentBasedSampler } = require('@opentelemetry/sdk-trace-base');

const sdk = new NodeSDK({
  traceExporter: /* OTLP exporter */,
  sampler: new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(0.1) // 10% head sampling
  })
});

sdk.start();
```

### 3.4 业务级 SLI 埋点

- **可用性**：`success / total` 按用户视角定义（比如“结算成功”而非“200 响应”）。
- **延迟**：P50/P90/P99，分业务关键路径。
- **质量**：错误率、回滚次数、重试率；区分客户端/服务端错误。

---

## 4. 平台架构与告警策略

### 4.1 观测栈架构（示意）

```
[Service Pods] ── OTLP Export ─▶ [OpenTelemetry Collector]
        │ Metrics/Logs/Traces          │
        │                               ├─▶ [Prometheus] ──▶ [Alertmanager]
        │                               ├─▶ [Loki/ELK]
        │                               └─▶ [Tempo/Jaeger]
        └──────────▶ [SLO 计算 & 报表] ──▶ [Grafana Dashboard]
```

- Collector 解耦采集与后端，支持限流/采样/批处理。
- 日志、指标、追踪共用 `trace_id`，实现 **跨支柱跳转**。

### 4.2 SLO 告警（多窗口多燃耗）

- **Burn Rate 告警**：短窗口检测暴涨，长窗口保证持续性。

| 窗口 | Burn Rate 阈值 | 触发含义 |
| ---- | -------------- | -------- |
| 5 分钟 | 14.4x | 约 1 小时耗尽预算，快速拉响 |
| 1 小时 | 6x | 持续恶化需要介入 |
| 6 小时 | 3x | 中期问题，安排缓解 |

**PromQL 示例（成功率 SLI = 1 - 错误率）**

```promql
burn_rate_5m = (sum(rate(http_requests_total{status!~"2.."}[5m])) / sum(rate(http_requests_total[5m]))) / (1 - 0.999)
burn_rate_1h = (sum(rate(http_requests_total{status!~"2.."}[1h])) / sum(rate(http_requests_total[1h]))) / (1 - 0.999)
```

### 4.3 告警分级与去重

- **分级**：P0（停服/数据丢失）、P1（核心链路高错误率）、P2（降级/性能问题）、P3（任务失败可重试）。
- **降噪**：抑制规则（同一节点重复）、合并同类告警、维护静默窗口（变更/演练）。
- **路由**：按服务/团队/值班表分派，PagerDuty/飞书/企业微信。

### 4.4 Dashboard 设计

- Golden Signals 起始页 + 深入到服务侧 R.E.D 看板。
- 讲清楚“期望值”与阈值，避免“彩虹图”无决策意义。
- 对核心路径提供“从指标跳转到 Trace”的快速链接。

---

## 5. 事件响应与可靠性工程

### 5.1 事故生命周期（IMOC）

1. **Detection**：告警或用户反馈触发，SLO 告警优先。
2. **Impact Assessment**：评估受影响用户与范围。
3. **Mitigation**：限流、回滚、特性开关、降级。
4. **Outage Communication**：统一对外口径，状态页更新。
5. **Closure & Postmortem**：收敛告警，输出行动项。

### 5.2 Error Budget 政策

- 预算 < 50%：正常发布节奏。
- 预算 0-50%：收紧发布频率，加强灰度/金丝雀。
- 预算耗尽：冻结发布，优先可靠性工作（Refactor/测试/容量）。

### 5.3 Runbook 示例（API 5xx 激增）

1. 查看近 5 分钟错误率/延迟，确认 Burn Rate。
2. 通过 Trace 栈定界：是下游依赖慢，还是自身线程池耗尽。
3. 应急措施：开流量闸门（限流/熔断）、切换只读模式、回滚版本。
4. 记录操作与时间线，为 Postmortem 准备数据。

> 类比：机长处理故障的“检查单”，先做“停飞/切换备份”，再排查原因。

---

## 6. 实践案例：K8s 微服务观测栈

### 6.1 采集与落地

- **指标**：应用以 `/metrics` 暴露；Prometheus 通过 ServiceMonitor 自动发现。
- **日志**：使用 Fluent Bit 将容器标准输出收集到 Loki/ELK，附带 `pod`, `namespace`, `trace_id` 标签。
- **追踪**：Sidecar/SDK 将 OTLP 数据发往集群内 OTel Collector，再分发到 Tempo/Jaeger。

**ServiceMonitor 片段**

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: checkout
spec:
  selector:
    matchLabels:
      app: checkout
  endpoints:
    - port: http-metrics
      interval: 15s
      path: /metrics
      relabelings:
        - sourceLabels: [__meta_kubernetes_pod_node_name]
          targetLabel: node
```

### 6.2 成本与性能

- Trace 采样 5-10%，对高价值请求（支付/下单）进行尾部采样保留。
- 指标压缩：使用 `remote_write` 将历史数据下沉到长保留存储（Thanos/Cortex/Mimir）。
- Dashboard 分级：运维看容量/系统指标，业务看转化率/下单成功率。

### 6.3 成熟度路线图

1. **Level 0**：仅系统监控（节点 CPU/Mem），无业务指标。
2. **Level 1**：Golden Signals + 简单告警。
3. **Level 2**：SLO/预算 + 链路追踪 + Runbook。
4. **Level 3**：自动化回滚/特性开关 + 事后行动跟踪 + 预案演练。

---

## 7. 常见陷阱与最佳实践

- **陷阱：标签爆炸**——在日志/指标中直接用用户 ID、订单号，导致存储暴涨；应映射到分级或采样。
- **陷阱：只看系统指标**——CPU/内存正常但业务 500 飙升；必须以用户视角 SLI 驱动。
- **陷阱：告警风暴**——无抑制/去重策略，值班被淹没；需分级、静默、合并。
- **陷阱：缺少闭环**——告警解决后没有 Postmortem，问题重复发生；应跟踪行动项完成率。
- **最佳实践**：
  - 用 SLO/Error Budget 约束发布节奏，量化可靠性。
  - 统一 TraceID 贯穿日志/指标/链路，便于跳转定位。
  - 定期演练（GameDay/故障注入），验证 Runbook 可执行性。
  - 成本观测并重：监控采集量、存储与查询成本，必要时分层采样。

---

> 对应面试题请见：[可观测性与 SRE 面试题](../../02-面试指南/06-DevOps与云计算面试/04-可观测性与SRE面试题.md)
