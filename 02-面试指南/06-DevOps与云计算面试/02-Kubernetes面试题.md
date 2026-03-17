# 02-Kubernetes面试题

> Kubernetes 核心知识分层面试题，覆盖架构原理、资源对象、调度机制、网络存储及生产运维，共 25 道题。

## 相关链接

- 对应技术资料：[Kubernetes 核心技术](../../01-技术资料/06-DevOps与云计算/02-Kubernetes核心技术.md)
- 上一篇：[Docker 面试题](./01-Docker面试题.md)

## 题目列表

| 难度 | 题目 |
|------|------|
| ⭐ | [K8s 和 Docker 有什么关系？](#q1) |
| ⭐ | [Pod 和容器的关系是什么？](#q2) |
| ⭐ | [Deployment、ReplicaSet、Pod 三者的关系？](#q3) |
| ⭐ | [Service 有哪几种类型？分别适用什么场景？](#q4) |
| ⭐ | [ConfigMap 和 Secret 的区别？](#q5) |
| ⭐⭐ | [kube-scheduler 的调度流程是什么？](#q6) |
| ⭐⭐ | [StatefulSet 和 Deployment 的区别？](#q7) |
| ⭐⭐ | [什么是 Taints 和 Tolerations？如何使用？](#q8) |
| ⭐⭐ | [HPA 的工作原理是什么？](#q9) |
| ⭐⭐ | [K8s 的 RBAC 如何工作？Role 和 ClusterRole 的区别？](#q10) |
| ⭐⭐ | [PV、PVC、StorageClass 三者关系？](#q11) |
| ⭐⭐ | [K8s 网络模型的三条基本原则是什么？](#q12) |
| ⭐⭐⭐ | [etcd 在 K8s 中的作用及生产部署建议？](#q13) |
| ⭐⭐⭐ | [kube-proxy 的 iptables 和 ipvs 模式有什么区别？](#q14) |
| ⭐⭐⭐ | [Pod 的 QoS 类别有哪些？调度和驱逐时如何影响？](#q15) |
| ⭐⭐⭐ | [Calico 和 Flannel 的核心区别？生产如何选型？](#q16) |
| ⭐⭐⭐ | [CSI 的架构和动态供应流程？](#q17) |
| ⭐⭐⭐ | [K8s 的 List-Watch 机制是什么？](#q18) |
| ⭐⭐⭐ | [滚动更新、蓝绿部署、金丝雀发布的区别？](#q19) |
| 场景题 | [Pod 一直处于 Pending 状态，如何排查？](#q20) |
| 场景题 | [节点 NotReady 如何处理？](#q21) |
| 场景题 | [如何设计一个高可用的 K8s 生产集群？](#q22) |
| 场景题 | [如何实现零停机的数据库迁移？](#q23) |
| 场景题 | [集群资源不足，Pod 调度失败，如何处理？](#q24) |
| 场景题 | [如何排查 K8s 服务网络不通的问题？](#q25) |

---

## 🔥 高频考点速记

> 面试中最常被问到的核心知识点，按出现频率排序。建议优先掌握前 5 项。

| # | 考点 | 核心要点（一句话） | 出题概率 |
|---|------|-------------------|----------|
| 1 | K8s 架构 | API Server+etcd+Scheduler+Controller+kubelet | ★★★★★ |
| 2 | Pod 生命周期 | Pending→Running→Succeeded/Failed，探针(liveness/readiness/startup) | ★★★★★ |
| 3 | Deployment vs StatefulSet | Deployment无状态(滚动更新)，StatefulSet有状态(稳定标识) | ★★★★☆ |
| 4 | Service 类型 | ClusterIP/NodePort/LoadBalancer/ExternalName | ★★★★★ |
| 5 | 调度策略 | nodeAffinity/podAntiAffinity/Taints+Tolerations | ★★★★☆ |
| 6 | 存储 PV/PVC | 动态供应(StorageClass)+CSI驱动 | ★★★☆☆ |
| 7 | RBAC 权限 | Role/ClusterRole + RoleBinding/ClusterRoleBinding | ★★★★☆ |
| 8 | HPA 自动伸缩 | 基于CPU/Memory/自定义指标自动扩缩Pod | ★★★★☆ |
| 9 | 网络模型 | Pod间直连(CNI)，Service(kube-proxy iptables/ipvs) | ★★★☆☆ |
| 10 | 故障排查 | kubectl describe/logs/exec，Pod Pending/CrashLoopBackOff | ★★★★★ |

---

## ⭐ 基础题

### Q1：K8s 和 Docker 有什么关系？{#q1}

**考察点**：理解容器生态的层次关系

**参考答案**：

Docker 是**容器运行时**，负责构建镜像、运行容器；Kubernetes 是**容器编排平台**，负责管理大规模容器集群。

两者的关系演变：
- **早期**：K8s 直接集成 Docker（通过 dockershim）
- **K8s v1.20**：宣布弃用 dockershim
- **K8s v1.24+**：移除 dockershim，通过 **CRI（Container Runtime Interface）** 标准与 containerd、CRI-O 等运行时交互

本质区别：

| 维度 | Docker | Kubernetes |
|------|--------|-----------|
| 作用 | 单机容器管理 | 多节点集群编排 |
| 调度 | 无 | 自动调度 |
| 自愈 | 无（需手动）| 自动重启/迁移 |
| 伸缩 | 手动 | 自动（HPA/VPA）|
| 网络 | 单机 bridge | 跨节点 CNI 插件 |

---

### Q2：Pod 和容器的关系是什么？{#q2}

**考察点**：K8s 最小调度单元的理解

**参考答案**：

**Pod 是 K8s 的最小调度和部署单元**，一个 Pod 可以包含一个或多个容器。

Pod 内的所有容器：
- **共享网络命名空间**：同一个 IP 地址，通过 `localhost` 互相通信
- **共享存储（Volume）**：可以挂载同一个 Volume 共享文件
- **共享 IPC 命名空间**：可以通过共享内存通信
- **独立文件系统**：各容器有自己的文件系统（来自各自镜像）

为什么引入 Pod 而不直接调度容器？

1. **原子性调度**：紧耦合的容器（如 App + Sidecar）需要始终共存于同一节点
2. **生命周期管理**：多容器作为一个整体启停
3. **共享资源**：网络和存储在容器间共享，通过 **Pause 容器**持有网络命名空间（即使业务容器重启，IP 不变）

---

### Q3：Deployment、ReplicaSet、Pod 三者的关系？{#q3}

**考察点**：K8s 控制器层级设计

**参考答案**：

```
Deployment（管理版本策略）
    │  创建/管理
    ├── ReplicaSet-v1（旧版本）── Pod × 0（已缩容）
    └── ReplicaSet-v2（新版本）── Pod × 3（当前运行）
```

- **Pod**：最小运行单元，承载实际工作负载
- **ReplicaSet**：维护指定数量的 Pod 副本（保证数量一致性），但不提供滚动更新
- **Deployment**：管理 ReplicaSet，提供**滚动更新、回滚、暂停/恢复**等高级能力

实际工作流：
1. `kubectl apply` 创建/更新 Deployment
2. Deployment Controller 创建新的 ReplicaSet
3. ReplicaSet Controller 创建/删除 Pod
4. 滚动更新：逐步扩容新 RS，同步缩容旧 RS

直接使用 ReplicaSet 的场景：当你需要完全自定义版本管理时（罕见）。

---

### Q4：Service 有哪几种类型？分别适用什么场景？{#q4}

**考察点**：K8s 服务暴露机制

**参考答案**：

| 类型 | IP 来源 | 访问范围 | 适用场景 |
|------|--------|---------|---------|
| **ClusterIP**（默认）| 集群内虚拟 IP | 仅集群内 | 服务间内部调用（最常用）|
| **NodePort** | 节点 IP + 随机端口（30000-32767）| 节点 IP 可达的客户端 | 开发测试、裸金属集群外部访问 |
| **LoadBalancer** | 云厂商外部 IP | 公网 | 云上生产环境外部访问 |
| **ExternalName** | DNS CNAME 重定向 | 集群内 | 访问集群外部的服务（如 RDS、第三方 API）|

**Headless Service**（特殊用法）：`clusterIP: None`，不分配 VIP，DNS 直接返回 Pod IP 列表，适用于 StatefulSet 和需要客户端负载均衡的场景。

---

### Q5：ConfigMap 和 Secret 的区别？{#q5}

**考察点**：K8s 配置管理机制

**参考答案**：

| 维度 | ConfigMap | Secret |
|------|----------|--------|
| 用途 | 非敏感配置（环境变量、配置文件）| 敏感数据（密码、Token、TLS 证书）|
| 存储方式 | 明文存储在 etcd | Base64 编码存储（**非加密**）|
| 加密 | 无 | 需额外配置 etcd 静态加密或 Sealed Secrets |
| 大小限制 | 1 MiB | 1 MiB |
| 类型 | 通用 | Opaque / kubernetes.io/tls / kubernetes.io/dockerconfigjson 等 |

**重要**：Secret 的 Base64 只是编码，**不是加密**。生产环境应配合 **Sealed Secrets**（Bitnami）或 **External Secrets Operator**（对接 Vault/AWS SSM）实现真正的密钥安全管理。

使用方式（两者相同）：
- 环境变量注入（`envFrom` / `valueFrom`）
- Volume 挂载为文件
- 在 Pod 启动时作为初始化参数

---

## ⭐⭐ 进阶题

### Q6：kube-scheduler 的调度流程是什么？{#q6}

**考察点**：K8s 调度核心机制

**参考答案**：

kube-scheduler 调度分为三个阶段：

**① 过滤（Filter/Predicate）**：淘汰不满足条件的节点
- `NodeUnschedulable`：排除 `unschedulable=true` 的节点
- `NodeResourcesFit`：排除 CPU/Memory 不足的节点
- `NodeAffinity`：排除不满足节点亲和性规则的节点
- `TaintToleration`：排除有不可容忍污点的节点
- `VolumeBinding`：排除无法绑定所需 PVC 的节点
- `PodTopologySpread`：排除违反拓扑扩散约束的节点

**② 打分（Score/Priority）**：对候选节点打分（0-100）
- `LeastAllocated`：资源使用率低的节点得分高
- `BalancedAllocation`：CPU/Memory 使用均衡的节点得分高
- `ImageLocality`：本地已有所需镜像的节点得分高
- `NodeAffinity`：满足软亲和性的节点额外加分

**③ 绑定（Bind）**：选择最高分节点，写入 `pod.spec.nodeName`，kubelet 监听到变化后执行实际创建

从 K8s 1.15 起，调度器支持 **Scheduling Framework** 插件扩展，可在各阶段（PreFilter / Filter / PostFilter / PreScore / Score / Reserve / Permit / PreBind / Bind / PostBind）插入自定义逻辑。

---

### Q7：StatefulSet 和 Deployment 的区别？{#q7}

**考察点**：有状态 vs 无状态应用管理

**参考答案**：

| 维度 | Deployment | StatefulSet |
|------|-----------|------------|
| Pod 名称 | 随机后缀（nginx-7d4b8-xkcd）| 有序固定（mysql-0, mysql-1）|
| 网络标识 | Pod IP 变化，通过 Service 访问 | 每个 Pod 有固定 DNS（pod-name.headless-svc）|
| 存储 | 共享 PVC 或无状态 | 每个 Pod 独立 PVC（volumeClaimTemplates）|
| 部署顺序 | 并行创建 | 有序（0→1→2），前一个 Ready 才创建下一个 |
| 删除顺序 | 无序 | 有序（N→N-1→...→0）|
| 适用场景 | Web 服务、API、无状态微服务 | 数据库、消息队列、ZooKeeper 等有状态服务 |

**选择依据**：
- 服务实例是否可互换？→ 可互换用 Deployment
- 需要稳定的网络标识（主从发现）？→ 用 StatefulSet
- 每个实例需要独立持久化数据？→ 用 StatefulSet

---

### Q8：什么是 Taints 和 Tolerations？如何使用？{#q8}

**考察点**：K8s 节点隔离机制

**参考答案**：

**Taint（污点）** 打在 Node 上，表示"我不接受没有对应容忍的 Pod"；
**Toleration（容忍）** 打在 Pod 上，表示"我可以接受带有此污点的节点"。

Taint 的 Effect 类型：
- `NoSchedule`：不调度新 Pod（已运行的不受影响）
- `PreferNoSchedule`：尽量不调度（软限制）
- `NoExecute`：不调度且驱逐已运行的不容忍 Pod（可设 `tolerationSeconds` 延迟驱逐）

典型使用场景：
1. **Master 节点隔离**：Control Plane 节点自动有 `node-role.kubernetes.io/control-plane:NoSchedule` 污点
2. **GPU 节点独占**：`kubectl taint nodes gpu-node gpu=true:NoSchedule`，只有 AI 训练 Pod 才有对应 Toleration
3. **节点维护**：`kubectl taint nodes node1 maintenance=true:NoExecute` 驱逐所有 Pod
4. **Spot 实例标记**：标记 Spot 节点，只有接受中断风险的 Pod 才调度上去

---

### Q9：HPA 的工作原理是什么？{#q9}

**考察点**：K8s 自动伸缩机制

**参考答案**：

HPA（Horizontal Pod Autoscaler）通过**周期性采集指标**（默认 15s），与目标阈值对比，计算期望副本数并更新 Deployment/StatefulSet 的 replicas。

**期望副本数计算公式**：
```
desiredReplicas = ceil(currentReplicas × (currentMetricValue / desiredMetricValue))
```

**指标来源**（metrics.k8s.io）：
- **Resource Metrics**：CPU/Memory，由 metrics-server 提供
- **Custom Metrics**：应用自定义指标（通过 custom.metrics.k8s.io），如 QPS、队列长度
- **External Metrics**：外部系统指标（如 Kafka lag、SQS 队列长度）

**伸缩保护机制**：
- `stabilizationWindowSeconds`：稳定窗口，避免频繁抖动（缩容默认 300s，扩容默认 0s）
- `scaleDown.policies`：限制每次缩容的幅度（防止误操作导致大规模缩容）

**HPA vs VPA**：
- HPA：水平扩容，通过增减 Pod 数量应对流量变化（推荐用于无状态服务）
- VPA：垂直扩容，调整单个 Pod 的 CPU/Memory 请求（需重启 Pod，适合有状态服务资源优化）
- 注意：HPA 和 VPA **不建议同时作用于同一 Deployment 的 CPU 指标**（可能冲突）

---

### Q10：K8s 的 RBAC 如何工作？Role 和 ClusterRole 的区别？{#q10}

**考察点**：K8s 安全与访问控制

**参考答案**：

RBAC（Role-Based Access Control）通过四种资源对象控制访问权限：

**对象关系**：
```
Subject（谁）→ RoleBinding/ClusterRoleBinding（绑定）→ Role/ClusterRole（权限）
```

| 对象 | 作用域 | 说明 |
|------|--------|------|
| Role | 命名空间 | 定义命名空间内的权限规则 |
| ClusterRole | 集群（全局）| 定义集群级别权限，可作用于跨命名空间资源（Node/PV/Namespace）|
| RoleBinding | 命名空间 | 将 Role 或 ClusterRole 绑定到命名空间内的 Subject |
| ClusterRoleBinding | 集群 | 将 ClusterRole 绑定到全局 Subject |

**关键用法**：用 `ClusterRole` 定义权限规则，用 `RoleBinding` 在特定命名空间生效 → 复用权限定义，限制作用域。

**最小权限原则**：
- 每个应用创建专属 ServiceAccount
- 只授予必要的 verbs（get/list/watch > create/update/patch > delete）
- 避免使用 `cluster-admin` ClusterRole
- 定期用 `kubectl auth can-i` 审计权限

---

### Q11：PV、PVC、StorageClass 三者关系？{#q11}

**考察点**：K8s 存储抽象层级

**参考答案**：

三者是 K8s 存储的**三层抽象**，实现了存储使用与存储供应的解耦：

```
StorageClass（如何提供存储：哪个 CSI 驱动、什么参数）
    │ 动态供应（Provisioner 自动创建）
    ▼
PersistentVolume（实际的存储资源：1TB NFS / 20GB EBS）
    │ 绑定（Bound，通过 accessMode + capacity 匹配）
    ▼
PersistentVolumeClaim（Pod 的存储申请：我需要 20GB RWO）
    │ 挂载
    ▼
Pod（消费者）
```

**绑定规则**：
- PVC 与 PV 是 1:1 绑定关系
- 绑定后，其他 PVC 无法使用同一 PV（即使 PV 容量有剩余）
- PV 的 `accessModes` 必须包含 PVC 的 `accessModes`
- PV 的 `capacity` 必须 ≥ PVC 的 `requests.storage`

**ReclaimPolicy**：
- `Retain`：PVC 删除后 PV 保留，需手动清理（推荐生产，防止误删数据）
- `Delete`：PVC 删除后自动删除 PV 和底层存储（动态供应默认值）
- `Recycle`：已废弃

---

### Q12：K8s 网络模型的三条基本原则是什么？{#q12}

**考察点**：K8s 网络基础理解

**参考答案**：

K8s 网络模型规定的三条不变原则：

1. **每个 Pod 拥有独立的 IP 地址**（Pod 内容器共享该 IP，通过 localhost 互通）
2. **所有 Pod 之间可以直接通信，无需 NAT**（跨节点 Pod 也不例外）
3. **Node 和 Pod 之间可以直接通信，无需 NAT**

这三条原则屏蔽了底层网络实现差异，应用开发者可以把集群当作一个"平面网络"使用。

具体实现由 CNI 插件负责：
- **Flannel**：VXLAN 封装（有封装开销）或 host-gw（仅限同 L2 网络）
- **Calico**：BGP 路由（无封装，性能最优）或 IPIP/VXLAN
- **Cilium**：eBPF（绕过 iptables，性能极高，支持 L7 NetworkPolicy）

---

## ⭐⭐⭐ 高级题

### Q13：etcd 在 K8s 中的作用及生产部署建议？{#q13}

**考察点**：K8s 核心组件深度理解

**参考答案**：

**etcd 的作用**：K8s 的**唯一状态存储**，存储集群所有对象（Node/Pod/Service/ConfigMap/Secret 等）的期望状态和实际状态。所有组件（包括 API Server）是无状态的，真正的"状态"全在 etcd 中。

**etcd 技术特性**：
- 基于 **Raft 算法**实现强一致性，保证 Leader 选举和日志复制
- 支持 **Watch 机制**，API Server 通过 Watch 获取资源变更，再推送给 controller-manager、scheduler、kubelet
- **MVCC**（多版本并发控制），支持历史版本查询和事务操作

**生产部署建议**：

1. **独立部署**：etcd 与控制面其他组件分离，专属高性能 SSD（低延迟 I/O 是关键）
2. **奇数节点**：3 节点（容忍 1 故障）或 5 节点（容忍 2 故障），不用 2/4 节点（脑裂风险）
3. **定期备份**：
   ```bash
   etcdctl snapshot save /backup/etcd-$(date +%Y%m%d).db \
     --endpoints=https://127.0.0.1:2379 \
     --cacert=/etc/etcd/ca.crt \
     --cert=/etc/etcd/server.crt \
     --key=/etc/etcd/server.key
   ```
4. **监控告警**：关注 `etcd_server_leader_changes_seen_total`（频繁选主）、`etcd_disk_wal_fsync_duration_seconds`（磁盘延迟）
5. **压缩碎片整理**：定期执行 `etcdctl compact` + `etcdctl defrag` 回收空间

---

### Q14：kube-proxy 的 iptables 和 ipvs 模式有什么区别？{#q14}

**考察点**：K8s Service 流量转发底层机制

**参考答案**：

| 维度 | iptables 模式 | ipvs 模式 |
|------|-------------|---------|
| 实现方式 | 内核 netfilter iptables 规则链 | 内核 LVS（Linux Virtual Server）哈希表 |
| 查找复杂度 | O(n)：规则数随 Service/Endpoint 线性增长 | O(1)：哈希表查找，不受 Service 数量影响 |
| 规模瓶颈 | 数千 Service 后性能明显下降 | 支持数万 Service |
| LB 算法 | 仅随机（random）| rr（轮询）/lc（最少连接）/dh（目标哈希）/sh（源哈希）/sed/nq |
| 部署依赖 | 内核标配，无需额外组件 | 需要内核模块 `ip_vs`、`ip_vs_rr` 等 |
| 生产建议 | 小规模集群（<100 Service）| 生产环境推荐 |

**配置方式**：
```yaml
# kube-proxy ConfigMap
apiVersion: v1
kind: ConfigMap
metadata:
  name: kube-proxy
  namespace: kube-system
data:
  config.conf: |
    mode: "ipvs"
    ipvs:
      scheduler: "rr"
```

---

### Q15：Pod 的 QoS 类别有哪些？调度和驱逐时如何影响？{#q15}

**考察点**：K8s 资源管理与优先级

**参考答案**：

K8s 根据 Pod 的 `requests` 和 `limits` 设置，自动分配三种 QoS 类别：

| QoS 类别 | 满足条件 | 驱逐优先级 |
|---------|---------|----------|
| **Guaranteed** | 所有容器的 CPU 和 Memory 均设置了 requests=limits | 最低（最后被驱逐）|
| **Burstable** | 至少一个容器设置了 requests 或 limits，但不满足 Guaranteed | 中 |
| **BestEffort** | 所有容器均未设置 requests 和 limits | 最高（最先被驱逐）|

**对调度的影响**：
- 调度器只使用 `requests` 来决策节点是否有足够资源（不用 limits）
- Guaranteed Pod 的请求更精确，调度结果更可预测

**对驱逐的影响（节点内存压力时）**：
```
驱逐顺序：BestEffort → Burstable（超过 requests 的部分）→ Guaranteed
```

**生产最佳实践**：
- 核心服务设置 `requests=limits`（Guaranteed），确保不被驱逐
- 一般服务设置合理的 `requests`（Burstable），留有 burst 空间
- 离线/批处理任务可用 BestEffort（接受被随时驱逐）

---

### Q16：Calico 和 Flannel 的核心区别？生产如何选型？{#q16}

**考察点**：CNI 插件深度理解

**参考答案**：

**Flannel**：
- 设计目标：简单易用，快速搭建集群网络
- 默认 VXLAN 模式：封装 UDP，有 ~10-20% 性能损耗
- 不支持 NetworkPolicy（需额外安装 Calico 仅用于网络策略）
- 适合：学习环境、小规模内网集群

**Calico**：
- 设计目标：企业级网络安全与高性能
- BGP 模式：无封装，路由层面直接转发，性能接近裸金属（推荐同 L3 网络）
- IPIP/VXLAN 模式：适合跨 L3 环境（如多 VPC、混合云）
- 完整支持 NetworkPolicy（包括 GlobalNetworkPolicy）
- 适合：生产环境首选，特别是安全要求高、规模较大的场景

**Cilium**（新一代）：
- 基于 eBPF，绕过 iptables，性能极高
- 支持 L7 NetworkPolicy（基于 HTTP 方法/路径的访问控制）
- 内置可观测性（Hubble），网络流量可视化
- 适合：大规模云原生集群、零信任安全要求高的场景

**选型建议**：
- 学习/测试 → Flannel
- 企业生产（中大规模）→ Calico（BGP 模式）
- 大规模/高安全/可观测性要求 → Cilium

---

### Q17：CSI 的架构和动态供应流程？{#q17}

**考察点**：K8s 存储扩展机制

**参考答案**：

**CSI（Container Storage Interface）** 是 K8s 与存储厂商之间的标准接口，通过 gRPC 规范解耦。

**CSI 组件架构**：
```
K8s 控制面（Sidecar 容器）          CSI 驱动（存储厂商实现）
─────────────────────────────────────────────────────
external-provisioner      ──RPC──►  CreateVolume()
external-attacher         ──RPC──►  ControllerPublishVolume()
external-resizer          ──RPC──►  ControllerExpandVolume()
external-snapshotter      ──RPC──►  CreateSnapshot()

Node 侧
node-driver-registrar（注册到 kubelet）
kubelet                   ──RPC──►  NodeStageVolume()
                          ──RPC──►  NodePublishVolume()
```

**动态供应流程**（以 AWS EBS 为例）：
1. 用户创建 PVC，指定 `storageClassName: ebs-sc`
2. `external-provisioner` 监听到 PVC，调用 CSI `CreateVolume` RPC → AWS API 创建 EBS 卷
3. K8s 创建对应 PV，并将 PVC 状态设为 `Bound`
4. Pod 调度到节点后，`external-attacher` 调用 `ControllerPublishVolume` → EBS Attach 到 EC2
5. `kubelet` 调用 `NodeStageVolume`（格式化/挂载到 staging 目录）→ `NodePublishVolume`（bind mount 到 Pod 路径）
6. 容器启动，数据卷可用

---

### Q18：K8s 的 List-Watch 机制是什么？{#q18}

**考察点**：K8s 核心通信机制

**参考答案**：

**List-Watch** 是 K8s 各组件与 API Server 之间的**事件驱动通信机制**，实现了组件间的解耦和最终一致性。

**工作流程**：
1. **List**：组件首次启动，通过 HTTP GET 获取所有资源的当前状态（带 `resourceVersion`）
2. **Watch**：基于 `resourceVersion`，建立长连接（HTTP/2 Streaming / WebSocket），监听增量变更事件（ADDED / MODIFIED / DELETED）
3. **Informer 缓存**：客户端（如 controller-manager）在本地维护缓存（Store），减少对 API Server 的直接查询压力

```
组件（如 Deployment Controller）
    │
    ▼
Informer.List() → 获取全量 Deployment，建立本地缓存
    │
    ▼
Informer.Watch() → 监听后续变更
    │
    ▼
事件进入 WorkQueue
    │
    ▼
Reconcile Loop（调谐）：对比期望状态 vs 实际状态 → 执行调整
```

**为什么不用轮询**：
- 轮询有延迟且浪费资源
- Watch 基于事件推送，延迟低、资源效率高
- 结合 Informer 本地缓存，大幅降低 API Server 负载

---

### Q19：滚动更新、蓝绿部署、金丝雀发布的区别？{#q19}

**考察点**：生产发布策略选型

**参考答案**：

| 维度 | 滚动更新 | 蓝绿部署 | 金丝雀发布 |
|------|---------|---------|----------|
| 资源占用 | 低（少量额外 Pod）| 高（双倍资源）| 低（少量新 Pod）|
| 发布速度 | 中（逐批替换）| 快（瞬间切换）| 慢（逐步放量）|
| 回滚速度 | 中（需逐批回滚）| 极快（切回旧版本）| 快（缩容新版本）|
| 风险 | 中（新旧版本短暂共存）| 低（完整测试后切换）| 最低（小范围验证）|
| 适用场景 | 一般服务更新 | 重大版本发布、数据库 schema 变更 | 新功能灰度验证、A/B 测试 |

**选型建议**：
- **日常发布**：滚动更新（K8s 默认，操作简单）
- **重大变更/数据库迁移**：蓝绿部署（切换前完整测试）
- **新功能验证**：金丝雀发布（5% → 20% → 50% → 100% 逐步放量）

---

## 🎯 场景题

### Q20：Pod 一直处于 Pending 状态，如何排查？{#q20}

**参考思路**：

```bash
# 1. 查看 Pod 事件（最关键的第一步）
kubectl describe pod <pod-name> | grep -A 20 Events

# 常见 Pending 原因及对应解决方案：

# ① 资源不足（Insufficient CPU/Memory）
kubectl top nodes                          # 查看节点资源用量
kubectl describe node <node> | grep -A10 "Allocated resources"
# 解决：扩容节点、降低 requests、开启 Cluster Autoscaler

# ② PVC 无法绑定（Unbound PersistentVolumeClaims）
kubectl get pvc                            # 查看 PVC 状态
kubectl describe pvc <pvc-name>
# 解决：检查 StorageClass 是否存在、PV 是否足够

# ③ 调度约束无法满足（节点亲和性/污点）
kubectl get nodes --show-labels
# 解决：检查 nodeSelector/nodeAffinity 是否匹配，检查 Taints 是否有对应 Toleration

# ④ 镜像拉取失败（导致在 Pending，实际是 ContainerCreating）
kubectl describe pod | grep -i "image\|pull"
# 解决：检查镜像名称/标签、ImagePullSecret 是否配置

# ⑤ 资源配额限制（ResourceQuota 超限）
kubectl get resourcequota -n <namespace>
kubectl describe resourcequota

# ⑥ 节点选择器/亲和性无匹配节点
kubectl get nodes -l <label-key>=<label-value>
```

---

### Q21：节点 NotReady 如何处理？{#q21}

**参考思路**：

```bash
# 1. 确认节点状态
kubectl get nodes
kubectl describe node <node-name> | grep -A 10 "Conditions"

# 2. 查看节点事件
kubectl get events --field-selector=involvedObject.name=<node-name>

# 3. SSH 到节点排查

# 检查 kubelet 状态
systemctl status kubelet
journalctl -u kubelet -f --since "10 minutes ago"

# 检查容器运行时
systemctl status containerd
crictl ps  # 查看容器状态

# 检查资源压力
df -h           # 磁盘使用（DiskPressure）
free -h         # 内存使用（MemoryPressure）
ls /var/lib/kubelet/pods | wc -l  # Pod 数量（PIDPressure）

# 检查网络
ping <other-node-ip>
telnet <api-server-ip> 6443

# 4. 常见原因及处理
# - kubelet 停止：systemctl restart kubelet
# - 磁盘满：清理 /var/lib/docker 或 /var/lib/containerd 中悬空镜像
#   crictl rmi --prune
# - 内存 OOM：检查大内存 Pod，调整 limits 或扩容节点
# - 网络分区：检查防火墙规则、安全组
```

---

### Q22：如何设计一个高可用的 K8s 生产集群？{#q22}

**参考思路**：

**控制面高可用**：
- **API Server**：3 个以上副本，前置 L4 负载均衡器（HAProxy / AWS ALB）
- **etcd**：独立部署 3/5 节点，SSD 磁盘，跨 AZ 分布
- **controller-manager / scheduler**：多副本，通过 Leader 选举保证只有一个活跃实例

**工作节点高可用**：
- **多 AZ 部署**：节点跨 3 个可用区，配合 `topologySpreadConstraints` 确保 Pod 跨 AZ 分散
- **节点池分级**：按用途划分（通用 / GPU / 大内存），通过 Taints + NodeAffinity 隔离
- **PDB（PodDisruptionBudget）**：限制同时不可用的 Pod 数，保证节点维护时的可用性

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: app-pdb
spec:
  minAvailable: 2     # 至少 2 个 Pod 保持可用
  selector:
    matchLabels:
      app: critical-service
```

**其他关键配置**：
- 开启 **Cluster Autoscaler**（节点自动伸缩）
- 配置 **Network Policy**（零信任网络）
- 启用 **etcd 加密**（`--encryption-provider-config`）
- 配置 **Audit Log**（审计 API 操作）
- 使用 **OPA Gatekeeper**（策略即代码）

---

### Q23：如何实现零停机的数据库迁移？{#q23}

**参考思路**：

数据库迁移需要解决：**应用代码向前兼容** + **Schema 逐步变更** + **回滚能力**。

**三阶段迁移法（Expand-Migrate-Contract）**：

```
阶段 1：Expand（扩展）
  - 添加新列/表（向后兼容，旧代码不受影响）
  - 部署支持新旧结构的新版应用（双写新旧列）
  
阶段 2：Migrate（迁移）
  - 离线/在线迁移历史数据（小批量，避免锁表）
  - 使用 Job 或 Init Container 执行迁移脚本
  
阶段 3：Contract（收缩）
  - 确认所有数据迁移完成
  - 删除旧列/表（清理阶段）
  - 部署只使用新结构的最终版本
```

**K8s 实现方式**：
- Init Container：Pod 启动前执行 `db migrate`（保证迁移先于应用启动）
- Job：独立执行一次性迁移任务（有重试机制）
- 蓝绿部署：迁移完成后整体切换

---

### Q24：集群资源不足，Pod 调度失败，如何处理？{#q24}

**参考思路**：

```bash
# 1. 确认调度失败原因
kubectl describe pod <pod-name> | grep -A5 Events
# 常见：0/3 nodes are available: 3 Insufficient cpu.

# 2. 查看节点资源实际使用
kubectl top nodes
kubectl describe nodes | grep -E "Allocated|Requests|Limits"

# 短期应急方案：
# ① 手动扩容节点（云厂商控制台或 CLI）
# ② 降低问题 Pod 的 requests（治标）
# ③ 清理僵尸 Pod / Completed Job

# 中期方案：
# ④ 开启 Cluster Autoscaler（触发自动扩容）
# ⑤ 审查 LimitRange，避免默认 requests 过高

# 长期方案：
# ⑥ VPA 优化现有 Pod 的 requests/limits（右尺寸化）
# ⑦ 配置 ResourceQuota 按命名空间合理分配资源
# ⑧ 使用 Spot/Preemptible 节点池承接非关键工作负载（降低成本同时增加容量）
# ⑨ 混部策略：在线服务 + 离线任务共享节点（利用削峰填谷）
```

---

### Q25：如何排查 K8s 服务网络不通的问题？{#q25}

**参考思路**：

分层排查，从 Pod → Service → Ingress 逐步验证：

```bash
# 层 1：确认 Pod 本身正常
kubectl get pods -l app=backend
kubectl exec -it <pod> -- curl localhost:8080/health   # Pod 自身是否响应

# 层 2：确认 Endpoints 正确
kubectl get endpoints backend-svc     # 是否有 Pod IP 列表？
# 若 Endpoints 为空：检查 Service selector 是否与 Pod labels 匹配

# 层 3：验证 ClusterIP 可达
kubectl exec -it debug-pod -- curl http://10.96.x.x:80
# 若不通：检查 kube-proxy 是否正常运行
kubectl get pods -n kube-system | grep kube-proxy
kubectl logs -n kube-system kube-proxy-<node>

# 层 4：DNS 解析是否正常
kubectl exec -it debug-pod -- nslookup backend-svc.default.svc.cluster.local
# 若 DNS 失败：检查 CoreDNS
kubectl get pods -n kube-system -l k8s-app=kube-dns
kubectl logs -n kube-system coredns-<pod>

# 层 5：NetworkPolicy 是否阻断
kubectl get networkpolicy -n <namespace>
# 临时验证：删除 NetworkPolicy 测试是否恢复（生产慎用）

# 层 6：Ingress 层（外部访问）
kubectl describe ingress <name>
kubectl logs -n ingress-nginx deploy/ingress-nginx-controller
# 检查 TLS 证书是否过期
kubectl get secret <tls-secret> -o jsonpath='{.data.tls\.crt}' | base64 -d | openssl x509 -noout -dates
```
