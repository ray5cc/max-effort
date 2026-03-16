# 02-Kubernetes核心技术

> Kubernetes（K8s）是 Google 开源的容器编排平台，本文系统梳理 K8s 架构原理、核心资源对象、调度机制、存储系统、网络模型及生产运维实践，覆盖从入门到生产部署的完整知识体系。

## 相关链接

- 对应面试题：[Kubernetes 面试题](../../02-面试指南/06-DevOps与云计算面试/02-Kubernetes面试题.md)
- 上一篇：[Docker 与容器化技术](./01-Docker与容器化技术.md)

## 目录

1. [K8s 架构概览](#1-k8s-架构概览)
2. [核心资源对象](#2-核心资源对象)
3. [调度机制](#3-调度机制)
4. [存储系统](#4-存储系统)
5. [网络模型](#5-网络模型)
6. [生产运维](#6-生产运维)
7. [常用命令速查表](#7-常用命令速查表)

---

## 1. K8s 架构概览

### 1.1 整体架构

Kubernetes 采用 **主从（Master-Worker）** 架构，分为 Control Plane（控制平面）和 Node（工作节点）两层。

```
┌─────────────────────────────────────────────────────────────────────┐
│                        K8s 集群全景图                                │
│                                                                     │
│  ┌──────────────────────────── Control Plane ──────────────────┐    │
│  │                                                              │    │
│  │  ┌──────────────┐   ┌────────────┐   ┌──────────────────┐  │    │
│  │  │ kube-apiserver│◄──│    etcd    │   │ kube-scheduler   │  │    │
│  │  │  （API 网关）  │   │ （状态存储）│   │  （调度决策）     │  │    │
│  │  └──────┬───────┘   └────────────┘   └────────┬─────────┘  │    │
│  │         │                                      │            │    │
│  │         │           ┌──────────────────────────┘            │    │
│  │         ▼           ▼                                        │    │
│  │  ┌──────────────────────────────────────────────────────┐   │    │
│  │  │            kube-controller-manager                    │   │    │
│  │  │  Node / Deployment / ReplicaSet / StatefulSet / ...  │   │    │
│  │  └──────────────────────────────────────────────────────┘   │    │
│  │                                                              │    │
│  │  ┌────────────────────────────────────────────────────────┐  │    │
│  │  │  cloud-controller-manager（可选，对接云厂商 API）        │  │    │
│  │  └────────────────────────────────────────────────────────┘  │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                              │ API                                    │
│         ┌────────────────────┼────────────────────┐                  │
│         ▼                    ▼                    ▼                  │
│  ┌────────────┐      ┌────────────┐      ┌────────────┐             │
│  │   Node 1   │      │   Node 2   │      │   Node N   │             │
│  │            │      │            │      │            │             │
│  │  kubelet   │      │  kubelet   │      │  kubelet   │             │
│  │ kube-proxy │      │ kube-proxy │      │ kube-proxy │             │
│  │  容器运行时  │      │  容器运行时  │      │  容器运行时  │             │
│  │            │      │            │      │            │             │
│  │ ┌──┐ ┌──┐ │      │ ┌──┐ ┌──┐ │      │ ┌──┐ ┌──┐ │             │
│  │ │P1│ │P2│ │      │ │P3│ │P4│ │      │ │P5│ │P6│ │             │
│  │ └──┘ └──┘ │      │ └──┘ └──┘ │      │ └──┘ └──┘ │             │
│  └────────────┘      └────────────┘      └────────────┘             │
└─────────────────────────────────────────────────────────────────────┘
  P = Pod
```

### 1.2 Control Plane 组件

#### kube-apiserver

- K8s 的**唯一入口**，所有操作（kubectl、各 Controller、kubelet）均通过 API Server 交互
- 职责：**认证（Authentication）→ 授权（Authorization）→ 准入控制（Admission）→ 写入 etcd**
- 无状态，可水平扩展；通过 `--etcd-servers` 连接 etcd 集群
- 提供 RESTful API、Watch 机制（List-Watch）供各组件订阅资源变更

```
请求流程：
  kubectl apply -f pod.yaml
       │
       ▼
  kube-apiserver
       │
  ┌────┴────────────────────┐
  │  1. 认证（证书/Token）   │
  │  2. 授权（RBAC/ABAC）   │
  │  3. 准入（MutatingWebhook → ValidatingWebhook）│
  │  4. 持久化到 etcd        │
  └────────────────────────┘
       │
       ▼（Watch 通知）
  kube-scheduler / controller-manager / kubelet
```

#### etcd

- **分布式 KV 存储**，基于 Raft 协议保证强一致性
- 存储 K8s 集群**全量状态**：Node、Pod、Service、ConfigMap、Secret 等所有对象
- 生产建议：独立部署奇数节点（3/5/7）、定期备份（`etcdctl snapshot save`）
- 关键特性：Watch 机制（API Server 监听变更并通知其他组件）、MVCC（多版本并发控制）

#### kube-scheduler

- **调度决策器**：监听未绑定（Unscheduled）Pod，为其选择最优 Node
- 调度流程分两阶段：**过滤（Filter/Predicate）** → **打分（Score/Priority）** → 绑定（Bind）
- 支持自定义调度框架（Scheduling Framework）插件扩展

#### kube-controller-manager

- 集成多个内置 **Controller** 的进程，每个 Controller 负责一种资源的期望状态管理

| Controller | 职责 |
|-----------|------|
| Node Controller | 监控 Node 健康，标记 NotReady 并驱逐 Pod |
| Deployment Controller | 管理 ReplicaSet，实现滚动更新 |
| ReplicaSet Controller | 保证 Pod 副本数与期望一致 |
| StatefulSet Controller | 有序部署/扩缩有状态应用 |
| Job Controller | 管理一次性任务 Pod |
| CronJob Controller | 按 Cron 表达式创建 Job |
| Endpoints Controller | 维护 Service 与 Pod 的端点映射 |
| Namespace Controller | 处理 Namespace 删除级联操作 |
| PVC Controller | 绑定 PVC 与 PV |

### 1.3 Node 组件

#### kubelet

- 运行在每个 Node 上的**节点代理**，负责 Pod 的全生命周期管理
- 向 API Server 注册节点，定期汇报节点状态（心跳）
- 通过 **CRI（Container Runtime Interface）** 调用容器运行时创建/删除容器
- 执行容器健康检查（livenessProbe / readinessProbe / startupProbe）
- 管理本地 Volume 挂载（通过 CSI）

#### kube-proxy

- 运行在每个 Node 上，维护 **Service 的网络规则**（iptables 或 ipvs）
- 实现 ClusterIP、NodePort 的流量转发和负载均衡
- **iptables 模式**：为每个 Service/Endpoint 创建 iptables 规则链，随规则数增长性能下降
- **ipvs 模式**（推荐生产）：使用内核 LVS，O(1) 复杂度查找，支持多种 LB 算法（rr/lc/sh 等）

#### 容器运行时（Container Runtime）

支持 **CRI** 标准的容器运行时：

| 运行时 | 说明 |
|-------|------|
| containerd | 默认推荐，CNCF 项目，轻量高效 |
| CRI-O | 专为 K8s 设计，符合 OCI 标准 |
| Docker Engine | 通过 cri-dockerd 适配（K8s v1.24+ 已移除原生支持）|

```
kubelet → CRI (gRPC) → containerd → runc → 容器
                              │
                         containerd-shim（解耦生命周期）
```

---

## 2. 核心资源对象

### 2.1 Pod

Pod 是 K8s 的**最小调度单元**，封装一个或多个共享网络（同一 IP）和存储（同一 Volume）的容器。

#### Pod 生命周期

```
              ┌─────────────────────────────────────────────────────────┐
              │                    Pod 生命周期                          │
              │                                                          │
              │  创建请求                                                │
              │      │                                                   │
              │      ▼                                                   │
              │  Pending ──── 等待调度/镜像拉取/Init Container 执行 ────► │
              │      │                                                   │
              │      ▼ 所有容器启动                                      │
              │  Running ──── 容器正常运行（探针检测）─────────────────► │
              │      │                    │                              │
              │      ▼                    ▼                              │
              │  Succeeded           Failed                              │
              │  （所有容器           （至少一个容器                       │
              │   正常退出）           非零退出）                          │
              │                                                          │
              │  Unknown：节点失联，状态未知                              │
              └─────────────────────────────────────────────────────────┘
```

#### 容器状态探针

| 探针 | 触发时机 | 失败行为 |
|-----|---------|---------|
| startupProbe | 容器启动期间 | 杀死容器（按 restartPolicy 重启） |
| livenessProbe | 容器运行中持续检测 | 杀死并重启容器 |
| readinessProbe | 容器运行中持续检测 | 从 Service Endpoints 中摘除，不重启 |

#### Pod 设计模式

**Sidecar 模式**：主容器旁注入辅助容器（如日志收集、服务网格 Proxy）

```yaml
# Sidecar 示例：Envoy Proxy 注入
spec:
  containers:
  - name: app
    image: my-app:v1
    ports:
    - containerPort: 8080
  - name: envoy-sidecar
    image: envoyproxy/envoy:v1.28
    ports:
    - containerPort: 9901   # Envoy admin
    volumeMounts:
    - name: envoy-config
      mountPath: /etc/envoy
  volumes:
  - name: envoy-config
    configMap:
      name: envoy-config
```

**Ambassador 模式**：Sidecar 代理外部服务，应用只和本地 localhost 通信

**Adapter 模式**：Sidecar 转换主容器输出格式（如将自定义 metrics 转为 Prometheus 格式）

**Init Container 模式**：在主容器启动前顺序执行初始化任务

```yaml
spec:
  initContainers:
  - name: wait-for-db
    image: busybox
    command: ['sh', '-c', 'until nc -z postgres-svc 5432; do sleep 2; done']
  - name: db-migrate
    image: my-app:v1
    command: ['python', 'manage.py', 'migrate']
  containers:
  - name: app
    image: my-app:v1
```

### 2.2 Deployment

管理无状态应用，提供滚动更新、回滚能力。

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-deployment
  labels:
    app: nginx
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1          # 更新期间最多多出 1 个 Pod
      maxUnavailable: 0    # 更新期间最少 0 个 Pod 不可用
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
      - name: nginx
        image: nginx:1.25
        ports:
        - containerPort: 80
        resources:
          requests:
            cpu: "100m"
            memory: "128Mi"
          limits:
            cpu: "500m"
            memory: "256Mi"
        livenessProbe:
          httpGet:
            path: /healthz
            port: 80
          initialDelaySeconds: 10
          periodSeconds: 5
        readinessProbe:
          httpGet:
            path: /ready
            port: 80
          initialDelaySeconds: 5
          periodSeconds: 3
```

**Deployment → ReplicaSet → Pod** 层级关系：

```
Deployment（期望状态管理）
    │
    ├── ReplicaSet v1（旧版本，replicas=0）
    │       └── Pod（已终止）
    │
    └── ReplicaSet v2（新版本，replicas=3）
            ├── Pod-abc
            ├── Pod-def
            └── Pod-ghi
```

### 2.3 StatefulSet

管理**有状态应用**（数据库、消息队列等），保证 Pod 的稳定网络标识和有序部署。

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mysql
spec:
  serviceName: "mysql-headless"   # 必须指定 Headless Service
  replicas: 3
  selector:
    matchLabels:
      app: mysql
  template:
    metadata:
      labels:
        app: mysql
    spec:
      containers:
      - name: mysql
        image: mysql:8.0
        env:
        - name: MYSQL_ROOT_PASSWORD
          valueFrom:
            secretKeyRef:
              name: mysql-secret
              key: password
        ports:
        - containerPort: 3306
        volumeMounts:
        - name: data
          mountPath: /var/lib/mysql
  volumeClaimTemplates:            # 为每个 Pod 自动创建独立 PVC
  - metadata:
      name: data
    spec:
      accessModes: ["ReadWriteOnce"]
      storageClassName: fast-ssd
      resources:
        requests:
          storage: 20Gi
---
# Headless Service（不分配 ClusterIP，用于 Pod DNS 发现）
apiVersion: v1
kind: Service
metadata:
  name: mysql-headless
spec:
  clusterIP: None
  selector:
    app: mysql
  ports:
  - port: 3306
```

StatefulSet 特性：
- Pod 名称稳定：`mysql-0`、`mysql-1`、`mysql-2`
- DNS 稳定：`mysql-0.mysql-headless.default.svc.cluster.local`
- 有序部署（0→1→2）、有序删除（2→1→0）
- 每个 Pod 绑定独立 PVC，Pod 重建后数据持久

### 2.4 DaemonSet

确保每个（或特定标签的）Node 运行一个 Pod 副本，适用于日志收集、监控、网络插件等。

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: fluentd
  namespace: kube-system
spec:
  selector:
    matchLabels:
      name: fluentd
  template:
    metadata:
      labels:
        name: fluentd
    spec:
      tolerations:                          # 容忍 Master 污点，使其在所有节点运行
      - key: node-role.kubernetes.io/control-plane
        operator: Exists
        effect: NoSchedule
      containers:
      - name: fluentd
        image: fluent/fluentd-kubernetes-daemonset:v1.16
        volumeMounts:
        - name: varlog
          mountPath: /var/log
        - name: varlibdockercontainers
          mountPath: /var/lib/docker/containers
          readOnly: true
      volumes:
      - name: varlog
        hostPath:
          path: /var/log
      - name: varlibdockercontainers
        hostPath:
          path: /var/lib/docker/containers
```

### 2.5 Job 与 CronJob

```yaml
# Job：一次性任务
apiVersion: batch/v1
kind: Job
metadata:
  name: data-migration
spec:
  completions: 1        # 需要成功完成的 Pod 数
  parallelism: 1        # 并行运行的 Pod 数
  backoffLimit: 3       # 失败重试次数
  activeDeadlineSeconds: 600   # 超时时间（秒）
  template:
    spec:
      restartPolicy: OnFailure   # Job Pod 必须为 Never 或 OnFailure
      containers:
      - name: migration
        image: my-app:v1
        command: ["python", "migrate.py"]
---
# CronJob：定时任务
apiVersion: batch/v1
kind: CronJob
metadata:
  name: backup-db
spec:
  schedule: "0 2 * * *"          # 每天凌晨 2 点执行（UTC）
  concurrencyPolicy: Forbid      # 禁止并发执行（上一个未完成则跳过）
  successfulJobsHistoryLimit: 3  # 保留最近 3 个成功 Job
  failedJobsHistoryLimit: 1
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
          - name: backup
            image: postgres:15
            command: ["pg_dump", "-h", "postgres-svc", "mydb"]
```

### 2.6 Service

Service 为 Pod 集合提供稳定的网络访问入口，解耦客户端与 Pod IP 的绑定。

#### Service 类型对比

| 类型 | 说明 | 访问范围 | 适用场景 |
|------|------|---------|---------|
| **ClusterIP** | 分配集群内虚拟 IP，默认类型 | 集群内部 | 服务间内部调用 |
| **NodePort** | 在每个 Node 上开放端口（30000-32767） | 节点 IP + NodePort | 开发测试、简单外部访问 |
| **LoadBalancer** | 调用云厂商 LB API 创建外部 LB | 外部公网 | 生产环境外部访问 |
| **ExternalName** | 将 Service 映射到外部 DNS 名称 | CNAME 重定向 | 访问集群外部服务 |

```yaml
# ClusterIP Service
apiVersion: v1
kind: Service
metadata:
  name: backend-svc
spec:
  type: ClusterIP
  selector:
    app: backend
  ports:
  - protocol: TCP
    port: 80        # Service 端口
    targetPort: 8080  # Pod 端口
---
# NodePort Service
apiVersion: v1
kind: Service
metadata:
  name: frontend-svc
spec:
  type: NodePort
  selector:
    app: frontend
  ports:
  - port: 80
    targetPort: 3000
    nodePort: 30080   # 不指定则随机分配 30000-32767
---
# ExternalName Service（将集群内访问重定向到外部数据库）
apiVersion: v1
kind: Service
metadata:
  name: external-db
spec:
  type: ExternalName
  externalName: rds.ap-northeast-1.amazonaws.com
```

#### Service 流量路径

```
外部请求
    │
    ▼
LoadBalancer（云 LB）
    │
    ▼
NodePort（Node:30080）
    │
    ▼ kube-proxy iptables/ipvs
ClusterIP（10.96.x.x:80）
    │
    ▼ Endpoints（动态维护）
Pod IP:8080（Pod1 / Pod2 / Pod3）
```

### 2.7 Ingress

Ingress 是 HTTP/HTTPS 层的**七层路由规则**，需配合 Ingress Controller（如 nginx-ingress、Traefik）使用。

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  ingressClassName: nginx          # 指定 IngressClass
  tls:
  - hosts:
    - api.example.com
    secretName: api-tls-secret     # 存储 TLS 证书的 Secret
  rules:
  - host: api.example.com
    http:
      paths:
      - path: /api/v1
        pathType: Prefix
        backend:
          service:
            name: api-v1-svc
            port:
              number: 80
      - path: /api/v2
        pathType: Prefix
        backend:
          service:
            name: api-v2-svc
            port:
              number: 80
  - host: admin.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: admin-svc
            port:
              number: 80
```

**流量路由架构**：

```
Internet
    │
    ▼
Ingress Controller Pod（nginx/traefik）
    │
    ├── api.example.com/api/v1  →  api-v1-svc → Pod
    ├── api.example.com/api/v2  →  api-v2-svc → Pod
    └── admin.example.com/      →  admin-svc  → Pod
```

---

## 3. 调度机制

### 3.1 kube-scheduler 调度流程

```
未绑定 Pod 进入调度队列
           │
           ▼
  ┌─── 过滤阶段（Filter）───────────────────────────────┐
  │  遍历所有 Node，排除不满足条件的节点                   │
  │                                                      │
  │  NodeUnschedulable  → 排除 unschedulable 节点         │
  │  NodeResourcesFit   → 排除资源不足节点                │
  │  NodeAffinity       → 排除不满足亲和性的节点           │
  │  TaintToleration    → 排除有不可容忍污点的节点         │
  │  PodTopologySpread  → 排除违反拓扑扩散约束的节点       │
  │  VolumeBinding      → 排除无法绑定 PVC 的节点         │
  └──────────────────────────────────────────────────────┘
           │（候选节点列表）
           ▼
  ┌─── 打分阶段（Score）───────────────────────────────┐
  │  对候选节点打分（0-100），选出最高分节点               │
  │                                                     │
  │  LeastAllocated     → 资源使用率最低的节点优先        │
  │  BalancedAllocation → CPU/Memory 均衡使用            │
  │  ImageLocality      → 本地已有镜像的节点优先          │
  │  NodeAffinity       → 满足软亲和性的节点加分          │
  └─────────────────────────────────────────────────────┘
           │（最高分节点）
           ▼
  绑定（Bind）：写入 Pod.spec.nodeName → kubelet 执行
```

### 3.2 节点选择

#### nodeSelector（简单标签选择）

```yaml
spec:
  nodeSelector:
    disktype: ssd
    region: us-east-1
```

#### nodeAffinity（表达式选择）

```yaml
spec:
  affinity:
    nodeAffinity:
      # 硬性要求：必须满足
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
        - matchExpressions:
          - key: kubernetes.io/arch
            operator: In
            values:
            - amd64
          - key: node-type
            operator: NotIn
            values:
            - spot   # 不调度到 Spot 实例
      # 软性偏好：优先满足，不满足也可调度
      preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 80
        preference:
          matchExpressions:
          - key: disktype
            operator: In
            values:
            - ssd
      - weight: 20
        preference:
          matchExpressions:
          - key: zone
            operator: In
            values:
            - zone-a
```

#### podAffinity / podAntiAffinity

```yaml
spec:
  affinity:
    # Pod 亲和性：与特定 Pod 调度到同一拓扑域（提升局部性）
    podAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
      - labelSelector:
          matchLabels:
            app: cache    # 与 cache Pod 调度到同一 Node
        topologyKey: kubernetes.io/hostname
    # Pod 反亲和性：与特定 Pod 分散调度（提升高可用）
    podAntiAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
      - labelSelector:
          matchLabels:
            app: nginx    # nginx 副本不调度到同一 Node
        topologyKey: kubernetes.io/hostname
      preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          labelSelector:
            matchLabels:
              app: nginx
          topologyKey: topology.kubernetes.io/zone  # 跨 AZ 分散
```

### 3.3 Taints & Tolerations（污点与容忍）

**Taint** 打在 Node 上，阻止 Pod 调度；**Toleration** 打在 Pod 上，允许调度到有对应污点的 Node。

```bash
# 给 Node 打污点
kubectl taint nodes gpu-node01 gpu=true:NoSchedule
kubectl taint nodes master-node node-role.kubernetes.io/control-plane:NoSchedule

# Taint Effect 类型
# NoSchedule      - 不调度（已运行的 Pod 不受影响）
# PreferNoSchedule - 尽量不调度
# NoExecute       - 不调度且驱逐已运行的 Pod
```

```yaml
# Pod 容忍 GPU 节点污点
spec:
  tolerations:
  - key: "gpu"
    operator: "Equal"
    value: "true"
    effect: "NoSchedule"
  - key: "node.kubernetes.io/not-ready"
    operator: "Exists"
    effect: "NoExecute"
    tolerationSeconds: 300   # 节点 NotReady 后最多容忍 300s 再驱逐
```

### 3.4 Resource Requests & Limits

```yaml
spec:
  containers:
  - name: app
    image: my-app:v1
    resources:
      requests:          # 调度依据（scheduler 使用）
        cpu: "250m"      # 0.25 核
        memory: "256Mi"
      limits:            # 上限（超过则 OOM Kill 或 CPU 限速）
        cpu: "1000m"     # 1 核
        memory: "512Mi"
```

#### QoS 类别

| QoS 类别 | 条件 | 被驱逐优先级 | 说明 |
|---------|------|-----------|------|
| **Guaranteed** | requests == limits（CPU 和 Memory 都相等） | 最低（最后被驱逐） | 生产关键服务 |
| **Burstable** | requests < limits 或只设置了一项 | 中 | 一般服务 |
| **BestEffort** | 未设置 requests 和 limits | 最高（最先被驱逐） | 非关键离线任务 |

```
内存压力驱逐顺序：BestEffort → Burstable → Guaranteed
```

### 3.5 拓扑扩散约束（TopologySpreadConstraints）

```yaml
spec:
  topologySpreadConstraints:
  - maxSkew: 1                      # 各拓扑域间最大数量差
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: DoNotSchedule  # 无法满足则不调度（ScheduleAnyway 为软约束）
    labelSelector:
      matchLabels:
        app: nginx
  - maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels:
        app: nginx
```

---

## 4. 存储系统

### 4.1 存储层级

```
┌─────────────────────────────────────────────────────┐
│                    K8s 存储体系                       │
│                                                      │
│  StorageClass（存储类，描述供应器和参数）               │
│       │                                              │
│       │ 动态供应                                      │
│       ▼                                              │
│  PersistentVolume（PV，实际存储资源）                  │
│       │                                              │
│       │ 绑定（Bound）                                 │
│       ▼                                              │
│  PersistentVolumeClaim（PVC，Pod 的存储申请）          │
│       │                                              │
│       │ 挂载                                          │
│       ▼                                              │
│  Pod（消费存储）                                      │
└─────────────────────────────────────────────────────┘
```

### 4.2 PersistentVolume（PV）

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: pv-nfs-001
spec:
  capacity:
    storage: 100Gi
  volumeMode: Filesystem
  accessModes:
  - ReadWriteMany     # 多个 Node 可读写
  persistentVolumeReclaimPolicy: Retain   # PVC 删除后保留数据（Recycle/Delete）
  storageClassName: nfs-storage
  nfs:
    server: 192.168.1.100
    path: /data/k8s/pv001
```

**AccessModes 说明**：

| 访问模式 | 缩写 | 含义 |
|---------|-----|------|
| ReadWriteOnce | RWO | 单个 Node 可读写（多 Pod 在同一 Node 可共享） |
| ReadOnlyMany | ROX | 多个 Node 只读 |
| ReadWriteMany | RWX | 多个 Node 可读写（需存储支持，如 NFS/CephFS）|
| ReadWriteOncePod | RWOP | 单个 Pod 独占读写（K8s 1.22+） |

### 4.3 PersistentVolumeClaim（PVC）

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: mysql-data-pvc
spec:
  accessModes:
  - ReadWriteOnce
  storageClassName: fast-ssd    # 指定 StorageClass（空字符串则绑定无 SC 的 PV）
  resources:
    requests:
      storage: 20Gi
  selector:                     # 可选：通过标签精确绑定特定 PV
    matchLabels:
      env: production
---
# 在 Pod 中使用 PVC
apiVersion: v1
kind: Pod
metadata:
  name: mysql
spec:
  containers:
  - name: mysql
    image: mysql:8.0
    volumeMounts:
    - name: data
      mountPath: /var/lib/mysql
  volumes:
  - name: data
    persistentVolumeClaim:
      claimName: mysql-data-pvc
```

### 4.4 StorageClass 与动态供应

```yaml
# AWS EBS StorageClass
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-ssd
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"  # 设为默认 StorageClass
provisioner: ebs.csi.aws.com       # CSI 驱动
volumeBindingMode: WaitForFirstConsumer  # 延迟到 Pod 调度时再创建 PV（推荐）
reclaimPolicy: Delete              # PVC 删除时自动删除 PV
allowVolumeExpansion: true         # 允许扩容
parameters:
  type: gp3
  iops: "3000"
  throughput: "125"
  encrypted: "true"
---
# GCP Persistent Disk StorageClass
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: standard-rwo
provisioner: pd.csi.storage.gke.io
parameters:
  type: pd-ssd
  replication-type: regional-pd
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
```

**动态供应流程**：

```
用户创建 PVC（指定 StorageClass）
       │
       ▼
external-provisioner（监听 PVC 事件）
       │
       ▼
调用 Cloud API / CSI CreateVolume RPC
       │
       ▼
自动创建 PV 并绑定 PVC
       │
       ▼
Pod 调度到节点，kubelet 调用 CSI NodeStageVolume / NodePublishVolume
       │
       ▼
存储挂载到容器指定路径
```

### 4.5 CSI（Container Storage Interface）

CSI 是 K8s 与存储提供商之间的标准接口，解耦存储驱动与 K8s 核心代码。

```
K8s 控制面                    CSI 驱动（用户态）
────────────────────────────────────────────────
external-attacher       →→→  ControllerPublishVolume
external-provisioner    →→→  CreateVolume / DeleteVolume
external-resizer        →→→  ControllerExpandVolume
external-snapshotter    →→→  CreateSnapshot / DeleteSnapshot

Node 侧
node-driver-registrar   →→→  注册 CSI 驱动到 kubelet
kubelet                 →→→  NodeStageVolume / NodePublishVolume
```

常用 CSI 驱动：

| 存储系统 | CSI 驱动 |
|---------|---------|
| AWS EBS | ebs.csi.aws.com |
| GCP PD | pd.csi.storage.gke.io |
| Azure Disk | disk.csi.azure.com |
| Ceph RBD | rbd.csi.ceph.com |
| CephFS | cephfs.csi.ceph.com |
| NFS | nfs.csi.k8s.io |

---

## 5. 网络模型

### 5.1 K8s 网络基本原则

K8s 网络模型的三条基本规则：
1. **每个 Pod 拥有独立 IP**（Pod 内容器共享网络命名空间）
2. **Pod 之间直接通信，无需 NAT**（跨节点 Pod 通信透明）
3. **Node 和 Pod 之间可以直接通信**

### 5.2 通信模式

```
┌──────────────────────────────────────────────────────────┐
│                   K8s 网络通信全景                         │
│                                                           │
│  ① Pod-to-Pod（同节点）                                   │
│    Pod A (veth0) ──── linux bridge (cbr0) ──── Pod B      │
│                                                           │
│  ② Pod-to-Pod（跨节点）                                   │
│    Pod A → veth → bridge → 隧道(VXLAN/BGP) → 目标节点     │
│    → 目标 bridge → veth → Pod B                           │
│                                                           │
│  ③ Pod-to-Service                                         │
│    Pod → ClusterIP → iptables/ipvs DNAT → Pod            │
│                                                           │
│  ④ External-to-Service                                    │
│    Internet → LB/NodePort → kube-proxy → Pod             │
└──────────────────────────────────────────────────────────┘
```

**DNS 解析链路**：

```
Pod 内查询 backend-svc.default.svc.cluster.local
    │
    ▼
/etc/resolv.conf → nameserver 10.96.0.10（CoreDNS ClusterIP）
    │
    ▼
CoreDNS 查询 Service 记录
    │
    ├── ClusterIP Service → 返回 ClusterIP（10.96.x.x）
    └── Headless Service → 返回 Pod IP 列表（A 记录）
```

### 5.3 CNI 插件对比

| 特性 | Flannel | Calico | Cilium |
|------|--------|--------|--------|
| **数据面** | VXLAN/host-gw | BGP/VXLAN/IP-in-IP | eBPF |
| **网络策略** | ❌ 不支持 | ✅ 完整支持 | ✅ 完整支持（L7 级别）|
| **性能** | 中 | 高（BGP 模式无封装） | 极高（bypass iptables）|
| **加密** | ❌ | ✅ WireGuard | ✅ WireGuard |
| **多集群** | ❌ | ✅ Calico Enterprise | ✅ Cluster Mesh |
| **可观测性** | 基础 | 基础 | 极佳（Hubble）|
| **适用场景** | 简单集群、学习环境 | 企业生产首选 | 大规模、云原生安全 |

**Flannel VXLAN 数据包封装**：

```
源 Pod 原始包
[Pod A IP → Pod B IP | 应用数据]
         │
         ▼ VXLAN 封装（flannel.1）
[Node1 IP → Node2 IP | UDP | VXLAN Header | 原始 Pod 包]
         │
         ▼ 跨节点传输
         │
         ▼ 目标节点解封装
[Pod A IP → Pod B IP | 应用数据] → Pod B
```

**Calico BGP 模式**：

```
Node1 (AS 64512)                Node2 (AS 64512)
┌─────────────────┐             ┌─────────────────┐
│ Pod CIDR:       │ BGP Peering │ Pod CIDR:       │
│ 10.244.1.0/24   │◄───────────►│ 10.244.2.0/24   │
│                 │             │                 │
│ 路由表:          │             │ 路由表:          │
│ 10.244.2.0/24   │             │ 10.244.1.0/24   │
│ via Node2 IP    │             │ via Node1 IP    │
└─────────────────┘             └─────────────────┘
（无封装开销，性能最优）
```

### 5.4 NetworkPolicy

NetworkPolicy 定义 Pod 级别的**网络访问控制**（入站/出站白名单）。

```yaml
# 默认拒绝所有入站流量（先建立默认拒绝，再按需放行）
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: production
spec:
  podSelector: {}   # 匹配所有 Pod
  policyTypes:
  - Ingress
---
# 允许特定流量
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-backend
  namespace: production
spec:
  podSelector:
    matchLabels:
      role: backend     # 保护 backend Pod
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: production    # 来自 production 命名空间
      podSelector:
        matchLabels:
          role: frontend     # 只允许 frontend Pod 访问
    ports:
    - protocol: TCP
      port: 8080
  - from:
    - ipBlock:
        cidr: 10.0.0.0/8    # 允许内网段
        except:
        - 10.0.0.100/32     # 排除特定 IP
  egress:
  - to:
    - podSelector:
        matchLabels:
          role: database
    ports:
    - protocol: TCP
      port: 5432
  - to:                     # 允许 DNS 查询
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: kube-system
    ports:
    - protocol: UDP
      port: 53
```

---

## 6. 生产运维

### 6.1 RBAC（基于角色的访问控制）

```
RBAC 对象关系：
Subject（用户/ServiceAccount/Group）
    │
    └── RoleBinding / ClusterRoleBinding
            │
            └── Role / ClusterRole（权限集合）
                    │
                    └── Rules（resources + verbs）

作用域：
  Role + RoleBinding             = 命名空间级别
  ClusterRole + ClusterRoleBinding = 集群级别
  ClusterRole + RoleBinding       = 命名空间级别（复用集群级别角色定义）
```

```yaml
# ServiceAccount
apiVersion: v1
kind: ServiceAccount
metadata:
  name: app-sa
  namespace: production
---
# Role：命名空间级别权限
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: production
rules:
- apiGroups: [""]              # "" 代表 core API group
  resources: ["pods", "pods/log"]
  verbs: ["get", "list", "watch"]
- apiGroups: ["apps"]
  resources: ["deployments"]
  verbs: ["get", "list", "watch", "update", "patch"]
---
# RoleBinding：将 Role 绑定到 ServiceAccount
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: pod-reader-binding
  namespace: production
subjects:
- kind: ServiceAccount
  name: app-sa
  namespace: production
- kind: User
  name: "jane@example.com"    # 外部用户
  apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: Role
  name: pod-reader
  apiGroup: rbac.authorization.k8s.io
---
# ClusterRole：集群级别权限（可跨命名空间）
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: node-reader
rules:
- apiGroups: [""]
  resources: ["nodes"]
  verbs: ["get", "list", "watch"]
- apiGroups: ["metrics.k8s.io"]
  resources: ["nodes", "pods"]
  verbs: ["get", "list"]
```

### 6.2 ConfigMap 与 Secret

```yaml
# ConfigMap：非敏感配置
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
  namespace: production
data:
  APP_ENV: "production"
  APP_PORT: "8080"
  config.yaml: |
    server:
      host: 0.0.0.0
      port: 8080
    database:
      host: postgres-svc
      port: 5432
---
# Secret：敏感信息（Base64 编码，建议配合 Sealed Secrets 或 External Secrets）
apiVersion: v1
kind: Secret
metadata:
  name: db-credentials
  namespace: production
type: Opaque
data:
  username: cG9zdGdyZXM=      # base64("postgres")
  password: c3VwZXJzZWNyZXQ=  # base64("supersecret")
stringData:                    # 明文，K8s 自动编码（仅用于创建，查询时显示 data）
  api-key: "my-api-key-value"
---
# 在 Pod 中使用 ConfigMap 和 Secret
apiVersion: v1
kind: Pod
metadata:
  name: app
spec:
  containers:
  - name: app
    image: my-app:v1
    env:
    - name: APP_ENV               # 注入单个 ConfigMap 键
      valueFrom:
        configMapKeyRef:
          name: app-config
          key: APP_ENV
    - name: DB_PASSWORD           # 注入单个 Secret 键
      valueFrom:
        secretKeyRef:
          name: db-credentials
          key: password
    envFrom:                      # 批量注入 ConfigMap 所有键（加前缀）
    - configMapRef:
        name: app-config
    volumeMounts:
    - name: config-vol
      mountPath: /etc/app
      readOnly: true
  volumes:
  - name: config-vol              # 挂载 ConfigMap 为文件
    configMap:
      name: app-config
      items:
      - key: config.yaml
        path: config.yaml
```

### 6.3 自动伸缩

#### HPA（Horizontal Pod Autoscaler）

```yaml
# 基于 CPU/Memory 的 HPA
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: nginx-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: nginx-deployment
  minReplicas: 2
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 60   # CPU 使用率超过 60% 扩容
  - type: Resource
    resource:
      name: memory
      target:
        type: AverageValue
        averageValue: 400Mi
  - type: External             # 自定义外部指标（如 Kafka lag）
    external:
      metric:
        name: kafka_consumer_lag
        selector:
          matchLabels:
            topic: orders
      target:
        type: Value
        value: "1000"
  behavior:                    # 伸缩行为控制（避免频繁抖动）
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
      - type: Percent
        value: 100             # 每次最多扩容 100%
        periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300  # 缩容稳定窗口 5 分钟
      policies:
      - type: Pods
        value: 2               # 每次最多缩容 2 个 Pod
        periodSeconds: 60
```

#### VPA（Vertical Pod Autoscaler）

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: nginx-vpa
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: nginx-deployment
  updatePolicy:
    updateMode: "Auto"    # Off/Initial/Recreate/Auto
  resourcePolicy:
    containerPolicies:
    - containerName: nginx
      minAllowed:
        cpu: 100m
        memory: 128Mi
      maxAllowed:
        cpu: 2
        memory: 2Gi
      controlledResources: ["cpu", "memory"]
```

#### Cluster Autoscaler

```
触发条件：
  ① Pending Pod（资源不足无法调度）→ 触发 Scale Up（添加 Node）
  ② Node 利用率持续低于阈值（默认 50%）→ 触发 Scale Down（移除 Node）

Scale Down 前提：
  - Node 上所有 Pod 可以调度到其他节点
  - Pod 不由本地存储绑定
  - Pod 没有 cluster-autoscaler.kubernetes.io/safe-to-evict: "false" 注解
```

### 6.4 Helm 包管理

```
Helm 核心概念：
  Chart    = K8s 应用包（类似 apt 包）
  Release  = Chart 的一次部署实例
  Repository = Chart 仓库（类似 apt 源）
  Values   = Chart 的可配置参数
```

```bash
# 添加 Helm 仓库
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update

# 搜索 Chart
helm search repo bitnami/postgresql

# 安装 Chart（指定 values）
helm install my-postgres bitnami/postgresql \
  --namespace database \
  --create-namespace \
  --set auth.postgresPassword=secret \
  --set primary.persistence.size=50Gi \
  --version 13.2.0

# 使用自定义 values.yaml 安装
helm install my-app ./my-chart \
  -f values-production.yaml \
  --set image.tag=v2.0.0

# 升级
helm upgrade my-postgres bitnami/postgresql \
  --reuse-values \
  --set primary.persistence.size=100Gi

# 回滚
helm rollback my-postgres 1    # 回滚到第 1 个版本

# 查看发布历史
helm history my-postgres
```

**自定义 Chart 结构**：

```
my-app/
├── Chart.yaml          # Chart 元信息（名称/版本/依赖）
├── values.yaml         # 默认配置参数
├── values-prod.yaml    # 生产环境覆盖值
├── templates/
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   ├── configmap.yaml
│   ├── hpa.yaml
│   ├── _helpers.tpl    # 模板辅助函数
│   └── NOTES.txt       # 安装后提示信息
└── charts/             # 子 Chart 依赖
```

```yaml
# Chart.yaml 示例
apiVersion: v2
name: my-app
description: A Helm chart for my application
type: application
version: 1.2.0           # Chart 版本
appVersion: "2.0.0"      # 应用版本
dependencies:
- name: postgresql
  version: "13.x.x"
  repository: https://charts.bitnami.com/bitnami
  condition: postgresql.enabled
```

```yaml
# templates/deployment.yaml（使用模板语法）
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "my-app.fullname" . }}
  labels:
    {{- include "my-app.labels" . | nindent 4 }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      {{- include "my-app.selectorLabels" . | nindent 6 }}
  template:
    spec:
      containers:
      - name: {{ .Chart.Name }}
        image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
        resources:
          {{- toYaml .Values.resources | nindent 12 }}
        {{- if .Values.config }}
        envFrom:
        - configMapRef:
            name: {{ include "my-app.fullname" . }}-config
        {{- end }}
```

### 6.5 部署策略

#### 滚动更新（Rolling Update）

```
滚动更新流程（maxSurge=1, maxUnavailable=0, replicas=3）：

初始状态：  [v1] [v1] [v1]
Step 1：   [v1] [v1] [v1] [v2]  （创建 1 个新 Pod，总数=4）
Step 2：   [v1] [v1] [v2]       （v2 Ready 后，删除 1 个 v1）
Step 3：   [v1] [v1] [v2] [v2]
Step 4：   [v1] [v2] [v2]
Step 5：   [v1] [v2] [v2] [v2]
最终：     [v2] [v2] [v2]
```

```bash
# 触发滚动更新
kubectl set image deployment/nginx-deployment nginx=nginx:1.26

# 暂停滚动更新（用于金丝雀发布阶段观察）
kubectl rollout pause deployment/nginx-deployment

# 恢复滚动更新
kubectl rollout resume deployment/nginx-deployment

# 查看更新状态
kubectl rollout status deployment/nginx-deployment

# 回滚到上一版本
kubectl rollout undo deployment/nginx-deployment

# 回滚到指定版本
kubectl rollout undo deployment/nginx-deployment --to-revision=2

# 查看更新历史
kubectl rollout history deployment/nginx-deployment
```

#### 蓝绿部署（Blue-Green Deployment）

```yaml
# 蓝环境（当前线上）
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-blue
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
      version: blue
  template:
    metadata:
      labels:
        app: myapp
        version: blue
    spec:
      containers:
      - name: app
        image: my-app:v1.0
---
# 绿环境（新版本，预热中）
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-green
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
      version: green
  template:
    metadata:
      labels:
        app: myapp
        version: green
    spec:
      containers:
      - name: app
        image: my-app:v2.0
---
# Service（切换 version 标签即可完成流量切换）
apiVersion: v1
kind: Service
metadata:
  name: app-svc
spec:
  selector:
    app: myapp
    version: blue   # 改为 green 即可一键切换
  ports:
  - port: 80
    targetPort: 8080
```

```bash
# 验证绿环境后，一键切换流量
kubectl patch service app-svc -p '{"spec":{"selector":{"version":"green"}}}'

# 回滚：切回蓝环境
kubectl patch service app-svc -p '{"spec":{"selector":{"version":"blue"}}}'
```

#### 金丝雀发布（Canary Release）

```yaml
# 稳定版本（接收 90% 流量）
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-stable
spec:
  replicas: 9           # 9 个 stable 副本
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
        track: stable
    spec:
      containers:
      - name: app
        image: my-app:v1.0
---
# 金丝雀版本（接收 10% 流量）
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-canary
spec:
  replicas: 1           # 1 个 canary 副本（1/10 = 10% 流量）
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
        track: canary
    spec:
      containers:
      - name: app
        image: my-app:v2.0
---
# Service 同时路由到 stable 和 canary（通过副本比例控制流量比）
apiVersion: v1
kind: Service
metadata:
  name: app-svc
spec:
  selector:
    app: myapp    # 匹配所有带 app=myapp 标签的 Pod
  ports:
  - port: 80
    targetPort: 8080
```

**基于 Ingress 注解的金丝雀**（nginx-ingress）：

```yaml
# 主 Ingress
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
spec:
  rules:
  - host: app.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: app-stable-svc
            port:
              number: 80
---
# 金丝雀 Ingress（10% 流量）
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-canary-ingress
  annotations:
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-weight: "10"   # 10% 流量
    # 也可基于 Header 路由（灰度特定用户）：
    # nginx.ingress.kubernetes.io/canary-by-header: "X-Canary"
    # nginx.ingress.kubernetes.io/canary-by-header-value: "always"
spec:
  rules:
  - host: app.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: app-canary-svc
            port:
              number: 80
```

---

## 7. 常用命令速查表

### 7.1 集群信息

```bash
# 查看集群信息
kubectl cluster-info
kubectl get nodes -o wide
kubectl describe node <node-name>

# 查看组件状态
kubectl get componentstatuses
kubectl get pods -n kube-system

# 查看 API 资源
kubectl api-resources
kubectl api-versions
```

### 7.2 Pod 操作

```bash
# 查看 Pod
kubectl get pods -A -o wide                    # 查看所有命名空间
kubectl get pods -l app=nginx                  # 标签过滤
kubectl get pods --field-selector=status.phase=Running

# 描述/调试
kubectl describe pod <pod-name>
kubectl logs <pod-name> -c <container-name>    # 查看指定容器日志
kubectl logs <pod-name> --previous             # 查看上一个容器日志（崩溃后）
kubectl logs -f <pod-name>                     # 实时跟踪日志

# 进入容器
kubectl exec -it <pod-name> -- /bin/bash
kubectl exec -it <pod-name> -c <container> -- sh

# 端口转发（本地调试）
kubectl port-forward pod/<pod-name> 8080:80
kubectl port-forward svc/<svc-name> 8080:80

# 复制文件
kubectl cp <pod-name>:/path/to/file ./local-file
kubectl cp ./local-file <pod-name>:/path/to/file

# 强制删除卡住的 Pod
kubectl delete pod <pod-name> --grace-period=0 --force
```

### 7.3 Deployment 操作

```bash
# 查看 Deployment
kubectl get deployments
kubectl describe deployment <name>

# 伸缩
kubectl scale deployment <name> --replicas=5

# 更新镜像
kubectl set image deployment/<name> <container>=<image>:<tag>

# 滚动更新管理
kubectl rollout status deployment/<name>
kubectl rollout history deployment/<name>
kubectl rollout undo deployment/<name>
kubectl rollout pause deployment/<name>
kubectl rollout resume deployment/<name>
```

### 7.4 资源管理

```bash
# 资源用量
kubectl top nodes
kubectl top pods -A --sort-by=memory

# 事件查看（排查问题）
kubectl get events --sort-by=.lastTimestamp
kubectl get events -n <namespace> --field-selector=reason=OOMKilling

# 资源配额
kubectl get resourcequota -A
kubectl describe resourcequota <name>

# LimitRange
kubectl get limitrange -A
```

### 7.5 调试与故障排查

```bash
# 临时调试 Pod（完成后自动删除）
kubectl run debug --image=nicolaka/netshoot --rm -it -- bash

# 查看节点资源分配情况
kubectl describe node <node> | grep -A10 "Allocated resources"

# 检查 RBAC 权限
kubectl auth can-i create pods --as=system:serviceaccount:default:app-sa
kubectl auth can-i --list --as=user@example.com

# 查看 Secret
kubectl get secret <name> -o jsonpath='{.data.password}' | base64 -d

# 查看 ConfigMap
kubectl get configmap <name> -o yaml

# 快速创建资源（imperative 方式）
kubectl create namespace staging
kubectl create configmap app-config --from-file=config.yaml
kubectl create secret generic db-secret --from-literal=password=mysecret
kubectl create serviceaccount app-sa

# apply 与 diff
kubectl diff -f deployment.yaml   # 查看将要变更的内容
kubectl apply -f deployment.yaml --dry-run=server  # 服务端 dry-run
```

### 7.6 kubectl 高级用法

```bash
# JSONPath 提取字段
kubectl get pods -o jsonpath='{.items[*].metadata.name}'
kubectl get nodes -o jsonpath='{.items[*].status.addresses[?(@.type=="InternalIP")].address}'

# 自定义列输出
kubectl get pods -o custom-columns='NAME:.metadata.name,NODE:.spec.nodeName,STATUS:.status.phase'

# 标签操作
kubectl label node <node-name> disktype=ssd
kubectl label node <node-name> disktype-       # 删除标签
kubectl annotate deployment <name> kubernetes.io/change-cause="update to v2.0"

# 监听资源变化
kubectl get pods -w

# 多上下文管理
kubectl config get-contexts
kubectl config use-context prod-cluster
kubectl config set-context --current --namespace=production
```

---

## 附录：K8s 版本与特性速查

| K8s 版本 | 重要特性 |
|---------|---------|
| v1.20 | Dockershim 弃用警告 |
| v1.22 | Ingress GA，移除 beta API |
| v1.24 | 移除 Dockershim |
| v1.25 | Pod Security Admission GA，移除 PSP |
| v1.26 | 大量 API 清理，Job 改进 |
| v1.27 | StatefulSet 缩容 PVC 保留策略 GA |
| v1.28 | Sidecar 容器原生支持（Beta） |
| v1.29 | ReadWriteOncePod GA |
| v1.30 | 存储版本迁移 GA |

## 参考资料

- [Kubernetes 官方文档](https://kubernetes.io/docs/)
- [K8s 源码（GitHub）](https://github.com/kubernetes/kubernetes)
- [CNCF 云原生全景图](https://landscape.cncf.io/)
- [Kubernetes the Hard Way](https://github.com/kelseyhightower/kubernetes-the-hard-way)
- 对应面试题：[Kubernetes 面试题](../../02-面试指南/06-DevOps与云计算面试/02-Kubernetes面试题.md)
