# Docker 面试题

> Docker 与容器化技术高频面试题，覆盖容器核心原理、Docker 架构、网络存储、Compose 编排及容器安全，按难度分三层（⭐基础 / ⭐⭐进阶 / ⭐⭐⭐高级）。

## 相关链接

- 对应技术资料：[Docker 与容器化技术](../../01-技术资料/06-DevOps与云计算/01-Docker与容器化技术.md)

---

## 目录

1. [⭐ 基础题（必会）](#1-基础题必会)
2. [⭐⭐ 进阶题](#2-进阶题)
3. [⭐⭐⭐ 高级题](#3-高级题)
4. [场景设计题](#4-场景设计题)

---

## 🔥 高频考点速记

> 面试中最常被问到的核心知识点，按出现频率排序。建议优先掌握前 5 项。

| # | 考点 | 核心要点（一句话） | 出题概率 |
|---|------|-------------------|----------|
| 1 | 容器 vs 虚拟机 | 容器共享内核(Namespace隔离)，VM独立内核(Hypervisor) | ★★★★★ |
| 2 | Namespace 隔离 | PID/NET/MNT/UTS/IPC/USER 六种隔离 | ★★★★★ |
| 3 | 镜像分层与缓存 | OverlayFS CoW，dockerfile 指令顺序影响缓存 | ★★★★☆ |
| 4 | Cgroups 资源限制 | cpu/memory/pids 限制，v2统一层级 | ★★★★☆ |
| 5 | 多阶段构建 | 减小镜像体积，编译环境与运行环境分离 | ★★★★☆ |
| 6 | 网络模式 | bridge(默认)/host(共享网络)/overlay(跨主机)/macvlan | ★★★★☆ |
| 7 | 容器安全 | 非root运行/Capabilities最小化/seccomp/AppArmor | ★★★☆☆ |
| 8 | Docker Compose | 多容器编排，depends_on + healthcheck | ★★★★☆ |
| 9 | 数据持久化 | volume(推荐)/bind mount/tmpfs | ★★★★☆ |
| 10 | 镜像优化 | distroless/alpine/多阶段/.dockerignore/层合并 | ★★★☆☆ |

---

## 1. ⭐ 基础题（必会）

### Q1：容器与虚拟机的核心区别是什么？

**考察点**：基础概念理解

**答**：

| 维度       | 容器                       | 虚拟机                   |
|------------|----------------------------|--------------------------|
| 隔离机制   | Linux Namespace（进程级）  | Hypervisor（硬件级）     |
| 内核       | 共享宿主机内核             | 独立 Guest OS 内核       |
| 启动时间   | 毫秒级                     | 秒~分钟级                |
| 资源开销   | MB 级（无 Guest OS）       | GB 级                    |
| 安全隔离   | 较弱（共享内核）           | 强（完全隔离）           |

容器本质是**宿主机上的一组被隔离的进程**，通过 Namespace 提供资源视图隔离，通过 Cgroups 提供资源限制，通过 OverlayFS 提供文件系统隔离。虚拟机则是在 Hypervisor 之上运行完整的操作系统。

---

### Q2：Docker 镜像和容器的关系是什么？

**答**：

- **镜像（Image）**：只读的分层文件系统，包含应用运行所需的所有文件（代码、运行时、库、配置）。镜像由多个只读层（Layer）叠加而成，每一层对应 Dockerfile 中的一条指令。
- **容器（Container）**：镜像的运行实例。启动容器时，Docker 在镜像的所有只读层之上叠加一个**可写层（upperdir）**，容器对文件系统的修改都发生在这一层。
- 关系类比：镜像 = 类（Class），容器 = 实例（Instance）。多个容器可以基于同一镜像运行，共享只读层，各自拥有独立的可写层。

```
镜像（只读层堆叠）          容器 A 的可写层
  Layer 4: COPY app       ← writable layer（container A）
  Layer 3: RUN pip install ← writable layer（container B）
  Layer 2: COPY reqs      （各容器独立，互不干扰）
  Layer 1: FROM python
```

---

### Q3：Dockerfile 中 COPY 和 ADD 的区别？

**答**：

| 指令 | 功能                         | 推荐场景                   |
|------|------------------------------|----------------------------|
| COPY | 单纯复制文件/目录到镜像      | 绝大多数场景（推荐）        |
| ADD  | 复制 + 支持 URL 下载 + 自动解压 tar | 仅在需要自动解压时使用  |

**最佳实践**：优先用 `COPY`，因为行为透明可预期。`ADD` 的自动解压和 URL 下载功能容易产生意外行为，且不利于层缓存（URL 内容变化无法被缓存检测到）。

```dockerfile
# ✅ 推荐
COPY app.tar.gz /tmp/
RUN tar xzf /tmp/app.tar.gz -C /app && rm /tmp/app.tar.gz

# ❌ 避免（ADD 自动解压，行为不直观）
ADD app.tar.gz /app/
```

---

### Q4：CMD 和 ENTRYPOINT 的区别？

**答**：

- **ENTRYPOINT**：定义容器启动时执行的命令，不可被 `docker run` 后的参数覆盖（但可用 `--entrypoint` 覆盖）。
- **CMD**：提供默认参数，可被 `docker run <image> <args>` 中的 `<args>` 覆盖。

```dockerfile
# 常见组合模式（推荐）
ENTRYPOINT ["python", "app.py"]   # 固定执行 python app.py
CMD ["--port", "8080"]            # 默认参数，可被覆盖

# docker run myimage                → python app.py --port 8080
# docker run myimage --port 9090   → python app.py --port 9090
# docker run --entrypoint bash myimage → bash（覆盖 ENTRYPOINT）
```

**注意**：使用 exec 格式（JSON 数组）而非 shell 格式，避免 PID 1 是 `/bin/sh -c`，从而导致信号无法正确传递给应用进程（容器 `docker stop` 时无法优雅关闭）。

---

### Q5：docker run -p 和 --expose 的区别？

**答**：

- `--expose <port>`：只是在镜像元数据中声明容器监听某端口，**不实际发布**，仅作文档用途。等同于 Dockerfile 中的 `EXPOSE`。
- `-p <host_port>:<container_port>`：**实际发布**端口，在宿主机 iptables 中添加 DNAT 规则，将宿主机端口流量转发到容器端口。
- `-P`（大写）：将所有 `EXPOSE` 声明的端口自动映射到宿主机随机高位端口。

```bash
$ docker run -p 8080:80 nginx    # 宿主机 8080 → 容器 80
$ docker run -p 127.0.0.1:8080:80 nginx  # 只绑定本地，不对外暴露
$ docker run -P nginx            # 自动映射所有 EXPOSE 端口
```

---

### Q6：什么是 Docker 数据卷（Volume），有哪几种挂载类型？

**答**：

Docker 提供三种数据持久化方式：

| 类型           | 声明方式                     | 数据位置                              | 适用场景                   |
|----------------|------------------------------|---------------------------------------|----------------------------|
| Named Volume   | `-v pgdata:/var/lib/pgsql`   | `/var/lib/docker/volumes/pgdata/`     | 生产数据持久化（推荐）     |
| Bind Mount     | `-v /host/path:/container`   | 宿主机任意路径                         | 开发热重载、配置文件注入   |
| tmpfs Mount    | `--tmpfs /tmp`               | 内存（重启消失）                       | 敏感临时数据、提升性能     |

```bash
# Named Volume（Docker 管理，跨容器共享）
$ docker volume create pgdata
$ docker run -v pgdata:/var/lib/postgresql/data postgres

# Bind Mount（宿主机路径映射）
$ docker run -v $(pwd)/src:/app/src:ro myapp  # :ro 只读挂载

# tmpfs（内存挂载，不持久化）
$ docker run --tmpfs /tmp:rw,size=64m myapp
```

---

### Q7：如何查看容器的资源使用情况？

**答**：

```bash
# 实时监控（流式输出）
$ docker stats

# 只显示一次快照（适合脚本）
$ docker stats --no-stream --format \
  "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}"

# 查看容器内进程
$ docker top <container>

# 查看 cgroup 原始数据
$ cat /sys/fs/cgroup/system.slice/docker-<id>.scope/memory.current

# 通过 Docker API 获取 metrics（适合监控系统）
$ curl --unix-socket /var/run/docker.sock \
  http://localhost/containers/<id>/stats?stream=false
```

---

## 2. ⭐⭐ 进阶题

### Q8：详细解释 Docker overlay2 存储驱动的工作原理

**答**：

overlay2 基于 Linux OverlayFS 实现镜像分层存储，涉及四个关键目录：

- **lowerdir**：多个只读镜像层，从上到下按优先级叠加，最多 128 层。
- **upperdir**：容器可写层，所有写操作发生在这里。
- **workdir**：OverlayFS 内部临时目录（原子操作所需）。
- **merged**：将 lowerdir + upperdir 合并后呈现给容器的统一视图。

**写时复制（Copy-on-Write）流程**：
1. **读文件**：从 merged 视图读取，内核按 upperdir → lowerdir 顺序查找，找到即返回。不实际复制文件，直接访问。
2. **写文件**：
   - 若文件在 upperdir 中存在，直接修改。
   - 若文件只在 lowerdir 中，触发 **copy-up**：将文件从 lowerdir 复制到 upperdir，再修改 upperdir 中的副本。lowerdir 原文件不变。
3. **删除文件**：在 upperdir 中创建同名的 **whiteout 文件**（`c 0 0` 的字符设备），使 merged 视图中该文件不可见。

```bash
# 查看实际挂载参数
$ cat /proc/mounts | grep overlay
# overlay /var/lib/docker/overlay2/<id>/merged overlay
#   rw,lowerdir=<l1>:<l2>:<l3>,upperdir=<u>,workdir=<w> 0 0
```

---

### Q9：Docker 网络中，容器间如何通信？跨主机如何通信？

**答**：

**同主机容器间通信**：

1. **同一自定义 bridge 网络**：Docker 内嵌 DNS 服务（127.0.0.11），容器可通过**服务名/容器名**直接解析。推荐这种方式，避免使用 IP 硬编码。
2. **不同网络**：默认无法直接通信，需用 `docker network connect` 将容器加入同一网络，或通过端口映射经宿主机转发。
3. **默认 docker0 bridge**：不支持 DNS 解析，只能通过 IP 通信（因此不推荐默认网络）。

```bash
$ docker network create appnet
$ docker run -d --name redis --network appnet redis
$ docker run -d --name app --network appnet myapp
# app 容器内 redis://redis:6379 即可访问
```

**跨主机容器通信**：

1. **Docker Overlay 网络（Swarm 模式）**：使用 VXLAN 封装，在物理网络之上构建虚拟 L2 网络，容器获得跨主机可路由的 IP。
2. **Kubernetes 网络（CNI）**：通过 Flannel、Calico、Cilium 等 CNI 插件实现跨节点 Pod 网络。
3. **Host 网络 + 服务发现**：容器使用宿主机 IP，通过 Consul/etcd 等做服务注册发现（传统方案）。

---

### Q10：多阶段构建有什么优势？如何最大化利用层缓存？

**答**：

**多阶段构建优势**：
1. **镜像体积大幅减小**：编译器、测试框架、构建工具不进入生产镜像（Go 应用可从 800MB→8MB）。
2. **安全攻击面减小**：生产镜像无 shell、无包管理器，大幅减少可利用的漏洞。
3. **构建环境与运行环境分离**：可以使用包含完整工具链的构建镜像，同时保持生产镜像极简。

**最大化层缓存的关键技巧**：

```
原则：将变化频率低的指令放前面，高频变化的放后面

典型顺序（Python/Node.js）：
  1. FROM <base>          ← 最低频（基础镜像版本）
  2. RUN apt-get install ← 低频（系统依赖变化不频繁）
  3. COPY 依赖清单文件   ← 中频（requirements.txt / package.json）
  4. RUN 安装依赖        ← 中频（取决于上一步是否变化）
  5. COPY 源代码         ← 高频（每次提交都变化）
  6. RUN 构建            ← 高频（随代码变化）
```

CI 场景：使用 `--cache-from` 从远端仓库拉取缓存镜像，避免每次 CI 都从头构建。

---

### Q11：如何限制容器的 CPU 和内存使用？底层是如何实现的？

**答**：

```bash
# CPU 限制
$ docker run --cpus="1.5" myapp           # 最多使用 1.5 个 CPU 核心
$ docker run --cpu-shares=512 myapp       # 相对权重（软限制，默认 1024）
$ docker run --cpuset-cpus="0,1" myapp    # 绑定到 CPU 0 和 1

# 内存限制
$ docker run --memory="512m" myapp        # 硬限制 512MB
$ docker run --memory="512m" \
             --memory-swap="512m" myapp   # 禁用 swap
$ docker run --memory-reservation="256m" myapp  # 软限制
```

**底层实现（Cgroups）**：

- `--cpus="1.5"` → 写入 `/sys/fs/cgroup/.../cpu.max`（v2）或 `cpu.cfs_quota_us=150000, cpu.cfs_period_us=100000`（v1）
- `--memory="512m"` → 写入 `memory.max`（v2）或 `memory.limit_in_bytes`（v1）
- 超出内存限制时，内核 OOM Killer 终止容器内进程，`docker ps` 会看到容器以 `OOMKilled` 状态退出（`exit code 137`）。

---

### Q12：Docker Compose 的 depends_on 能保证服务启动顺序吗？

**答**：

**能保证启动顺序，但不能保证服务就绪**。

`depends_on` 默认只等依赖容器的**进程启动**（`service_started`），不等服务实际可用。例如 PostgreSQL 容器进程启动后还需要几秒初始化，此时应用连接会失败。

解决方案：

1. **`condition: service_healthy`**（推荐）：配合 `healthcheck` 等待服务真正健康后再启动依赖服务。
2. **应用层重试**：在应用代码中实现数据库连接重试（指数退避），而非依赖 Compose 的顺序控制（更健壮）。
3. **wait-for-it / dockerize**：入口脚本中用工具轮询依赖服务端口。

```yaml
services:
  db:
    image: postgres:16
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      retries: 5

  app:
    depends_on:
      db:
        condition: service_healthy  # 等待 db 健康检查通过
```

---

### Q13：什么是 Docker 的 BuildKit？有哪些优势？

**答**：

BuildKit 是 Docker 18.09+ 引入的新一代构建引擎，Docker 23.0+ 已默认启用。

**核心优势**：

| 特性                   | 传统 builder        | BuildKit                          |
|------------------------|---------------------|-----------------------------------|
| 并发构建               | 串行                | 并行（DAG 依赖分析）              |
| 缓存挂载               | 不支持              | `--mount=type=cache`（持久缓存）  |
| 跨平台构建             | 不支持              | `--platform linux/amd64,arm64`    |
| Secret 传递            | 只能通过 ARG（不安全）| `--secret`（不进入镜像层）       |
| SSH 转发               | 不支持              | `--ssh`（私有仓库克隆）           |
| 构建缓存导出           | 不支持              | `--cache-to/from registry`        |

```dockerfile
# BuildKit 特性示例

# RUN --mount=type=cache：pip/apt 缓存不计入镜像层
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt

# --secret：安全传递构建时密钥（不写入镜像）
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    npm ci

# 使用方式
$ DOCKER_BUILDKIT=1 docker build --secret id=npmrc,src=.npmrc .
# 或 docker buildx build（buildx 默认使用 BuildKit）
```

---

## 3. ⭐⭐⭐ 高级题

### Q14：详细说明 Linux Namespace 的 6 种类型及其作用

**答**：

| Namespace | 隔离内容                                        | 内核版本 | Docker 使用 |
|-----------|-------------------------------------------------|----------|-------------|
| PID       | 进程 ID 空间，容器内 PID=1 与宿主机隔离         | 3.8      | ✅ 默认启用  |
| NET       | 网络栈（网卡、IP、路由、iptables）               | 2.6.24   | ✅ 默认启用  |
| MNT       | 文件系统挂载点视图                              | 2.4.19   | ✅ 默认启用  |
| UTS       | hostname 和 domainname                          | 2.6.19   | ✅ 默认启用  |
| IPC       | System V IPC 和 POSIX 消息队列                  | 2.6.19   | ✅ 默认启用  |
| USER      | 用户 ID 和组 ID 映射（rootless 容器的基础）      | 3.8      | ⚠️ 需配置    |
| Cgroup    | Cgroup 根目录视图（容器内看不到宿主机 cgroup 树）| 4.6      | ✅ 默认启用  |
| Time      | 时钟偏移（CLOCK_MONOTONIC / BOOTTIME）          | 5.6      | ❌ 不使用    |

**关键细节**：

- **PID Namespace**：容器内 PID 1 承担 init 职责（回收僵尸进程），`tini` 常被用作容器 init 进程。
- **NET Namespace**：每个容器有独立 `lo` 和 `eth0`（veth pair 的一端），与宿主机通过 `docker0` bridge 通信。
- **USER Namespace**：允许容器内 UID 0（root）映射到宿主机普通用户（如 UID 100000），是 rootless 容器的核心。开启需配置 `userns-remap`。

---

### Q15：Cgroups v1 和 v2 的主要区别是什么？对容器有何影响？

**答**：

**架构差异**：

- **v1**：各子系统（cpu、memory、blkio 等）各自维护独立的层级树，一个进程可以同时在多棵树中的不同位置，导致配置复杂，资源管理不一致。
- **v2**：统一单一层级树，所有子系统共用同一进程层级，配置更一致，且增加了 PSI（Pressure Stall Information）压力感知。

**对容器的影响**：

1. **内存 + Swap 联动**：v1 需要同时设置 `memory.limit_in_bytes` 和 `memory.memsw.limit_in_bytes`；v2 分开的 `memory.max` 和 `memory.swap.max`，更直观。
2. **Rootless 容器**：v2 支持非特权用户管理自己的 cgroup，是 rootless Docker/Podman 的必要条件。
3. **Kubernetes**：K8s 1.25+ 将 cgroups v2 设为默认，推荐生产环境升级（内核 5.8+，systemd 244+）。
4. **CPU 限制精度**：v2 的 `cpu.weight`（基于权重）替代 v1 的 `cpu.shares`，语义更清晰。

```bash
# 检查系统使用哪个版本
$ stat -f -c %T /sys/fs/cgroup
# tmpfs → v1（legacy mode）
# cgroup2fs → v2（unified mode）
# 或查看 Docker info
$ docker info | grep "Cgroup Version"
```

---

### Q16：如何实现容器镜像的供应链安全？

**答**：

容器供应链安全需要覆盖镜像的**构建、存储、分发、运行**全链路：

**1. 构建阶段**
- 使用官方基础镜像，固定精确标签（`python:3.11.8-slim-bookworm`），不用 `latest`。
- 启用 BuildKit `--secret` 避免密钥泄露到镜像层。
- 在 CI 中集成 Trivy/Snyk 扫描，发现 CRITICAL 漏洞阻断流水线。
- 使用多阶段构建 + distroless/scratch，最小化运行时攻击面。

**2. 存储阶段**
- 启用私有仓库（Harbor / ECR / GCR），避免使用未经审核的公共镜像。
- 启用仓库镜像扫描（Harbor + Trivy 集成）。

**3. 分发阶段（镜像签名）**
```bash
# Cosign（Sigstore）对镜像进行无密钥签名
$ cosign sign --key cosign.key myregistry/myapp:v1.0
# 验证签名
$ cosign verify --key cosign.pub myregistry/myapp:v1.0

# 使用 Notation（CNCF）签名
$ notation sign myregistry/myapp:v1.0
```

**4. 运行阶段**
- Kubernetes 中配置 Admission Controller（Kyverno / OPA Gatekeeper）验证镜像签名。
- 只允许来自受信任仓库的镜像（ImagePolicyWebhook）。
- 启用 seccomp / AppArmor / Capabilities 限制运行时权限。

**5. SBOM（软件物料清单）**
```bash
# 生成 SBOM
$ trivy image --format spdx-json --output sbom.json myapp:v1.0
# 或使用 syft
$ syft myapp:v1.0 -o spdx-json > sbom.json
```

---

### Q17：为什么容器内 PID 1 特殊？如何正确处理信号？

**答**：

**PID 1 的特殊性**：

在 Linux 中，PID 1（init 进程）有以下特殊行为：
1. **僵尸进程回收**：普通进程退出后父进程需调用 `wait()` 回收，否则成为僵尸。若父进程已退出，孤儿进程会被 reparent 到 PID 1，由 PID 1 负责回收。
2. **信号处理**：Linux 内核对 PID 1 特殊对待 —— **未注册处理函数的信号会被忽略**（包括 `SIGTERM`）。这意味着 `docker stop` 发送的 `SIGTERM` 可能被容器内的 PID 1 进程忽略，导致等待 10s 超时后强制 `SIGKILL`。

**常见问题场景**：

```dockerfile
# ❌ shell 格式（PID 1 是 sh，不是 node）
CMD node server.js
# /bin/sh -c "node server.js" → sh 是 PID 1，不转发 SIGTERM 给 node

# ✅ exec 格式（node 直接是 PID 1）
CMD ["node", "server.js"]
```

**使用 tini 作为 init 进程**（处理多进程 + 信号转发）：

```dockerfile
# 方式 1：在 Dockerfile 中安装 tini
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]

# 方式 2：docker run 时使用 --init
$ docker run --init myapp
# Docker 会自动使用内置的 tini
```

**正确实现信号处理（Node.js 示例）**：

```javascript
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, graceful shutdown...');
  await server.close();        // 停止接受新连接
  await db.disconnect();       // 关闭数据库连接
  process.exit(0);
});
```

---

### Q18：Docker 容器网络中 veth pair 和 bridge 是如何工作的？

**答**：

Docker bridge 网络的底层实现流程：

```
创建容器时，Docker/containerd 执行：

1. ip link add veth-host type veth peer name veth-container
   # 创建一对虚拟网卡（veth pair），像一根网线两端

2. ip link set veth-container netns <container-netns>
   # 将 veth-container 端移入容器的 NET Namespace

3. ip link set veth-host master docker0
   # 将 veth-host 端接入 docker0 bridge

4. 在容器 Namespace 内：
   ip addr add 172.17.0.2/16 dev eth0  # 命名为 eth0
   ip route add default via 172.17.0.1  # 默认路由指向 docker0

5. 宿主机上 iptables MASQUERADE 规则（NAT）：
   iptables -t nat -A POSTROUTING -s 172.17.0.0/16 ! -o docker0 -j MASQUERADE
   # 容器访问外网时，源 IP 替换为宿主机 IP（SNAT）
```

**数据包流向（容器 A → 外网）**：

```
容器 A（172.17.0.2）
  → eth0（容器端 veth）
  → veth-host（宿主机端 veth）
  → docker0 bridge（172.17.0.1）
  → iptables MASQUERADE（SNAT: 172.17.0.2 → 宿主机 IP）
  → eth0（宿主机物理网卡）
  → 外网
```

---

## 4. 场景设计题

### Q19：如何设计一个安全、高效的 Docker 镜像构建 CI/CD 流水线？

**答**：

```yaml
# GitHub Actions 完整流水线示例
name: Docker Build & Push

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
      security-events: write

    steps:
      # 1. 检出代码
      - uses: actions/checkout@v4

      # 2. 设置 BuildKit（支持缓存）
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      # 3. 登录镜像仓库
      - name: Login to Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      # 4. 提取元数据（版本标签）
      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=ref,event=branch
            type=semver,pattern={{version}}
            type=sha,prefix=sha-

      # 5. 构建并推送（利用 registry cache）
      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta.outputs.tags }}
          cache-from: type=registry,ref=ghcr.io/${{ github.repository }}:cache
          cache-to: type=registry,ref=ghcr.io/${{ github.repository }}:cache,mode=max
          platforms: linux/amd64,linux/arm64

      # 6. 安全扫描（构建后立即扫描）
      - name: Run Trivy scanner
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ghcr.io/${{ github.repository }}:${{ steps.meta.outputs.version }}
          format: sarif
          output: trivy-results.sarif
          exit-code: 1               # CRITICAL 漏洞阻断流水线
          severity: CRITICAL,HIGH

      # 7. 上传扫描结果到 GitHub Security
      - name: Upload Trivy results
        uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: trivy-results.sarif

      # 8. 镜像签名（可选，供应链安全）
      - name: Sign image with Cosign
        if: github.event_name != 'pull_request'
        run: |
          cosign sign --yes \
            ghcr.io/${{ github.repository }}@${{ steps.build.outputs.digest }}
```

---

### Q20：容器内应用内存泄漏，如何排查和解决？

**答**：

**排查步骤**：

```bash
# 1. 实时监控内存趋势
$ docker stats --format "{{.MemUsage}}\t{{.MemPerc}}" myapp
# 观察内存是否持续增长

# 2. 查看 OOM 事件
$ docker inspect myapp | grep -A3 '"OOMKilled"'
$ dmesg | grep -i "out of memory"
$ journalctl -k | grep "oom_kill"

# 3. 进入容器，使用 pmap/valgrind（需容器有工具）
$ docker exec myapp cat /proc/1/status | grep VmRSS
$ docker exec myapp cat /proc/1/smaps_rollup

# 4. 堆转储（以 Java 为例）
$ docker exec -u root myapp jmap -dump:live,format=b,file=/tmp/heap.hprof <pid>
$ docker cp myapp:/tmp/heap.hprof .
# 用 MAT / VisualVM 分析 heap dump

# 5. Python 内存分析
$ docker exec myapp python -c "
import tracemalloc
tracemalloc.start()
# ... 触发泄漏 ...
snapshot = tracemalloc.take_snapshot()
for stat in snapshot.statistics('lineno')[:10]:
    print(stat)
"
```

**防护措施**：

```bash
# 设置内存硬限制（容器 OOM 时自动重启）
$ docker run -d \
  --memory="512m" \
  --memory-swap="512m" \
  --restart=on-failure:3 \
  myapp

# Docker Compose 中配置
services:
  app:
    deploy:
      resources:
        limits:
          memory: 512M
    restart: on-failure
```

---

### Q21：如何排查容器网络连通性问题？

**答**：

```bash
# 1. 验证容器网络配置
$ docker exec myapp ip addr           # 查看容器 IP
$ docker exec myapp ip route          # 查看路由表
$ docker exec myapp cat /etc/resolv.conf  # 查看 DNS 配置

# 2. 测试容器间连通性
$ docker exec app ping redis          # 通过服务名 ping
$ docker exec app nc -zv redis 6379   # TCP 端口连通性
$ docker exec app curl -v http://api:8080/health  # HTTP 连通性

# 3. 检查 DNS 解析
$ docker exec app nslookup redis      # 服务名解析
$ docker exec app dig redis @127.0.0.11  # 指定 Docker DNS

# 4. 查看网络配置
$ docker network inspect appnet       # 查看网络中的容器和配置
$ docker inspect app | python3 -m json.tool | grep -A10 '"Networks"'

# 5. 宿主机层面排查
$ iptables -L -n -t nat | grep DOCKER  # 查看 Docker iptables 规则
$ bridge link                          # 查看 bridge 接口
$ ip netns list                        # 列出所有 Network Namespace

# 6. 常见问题与解决
# 问题：容器能 ping 通 IP 但无法解析服务名
# 原因：使用了默认 docker0 网络（不支持 DNS）
# 解决：创建自定义 bridge 网络并重启容器

# 问题：容器无法访问外网
# 检查：sysctl net.ipv4.ip_forward（应为 1）
# 检查：iptables MASQUERADE 规则是否存在
$ sudo sysctl net.ipv4.ip_forward
$ sudo iptables -t nat -L POSTROUTING -n
```

---

> **延伸阅读**
> - 对应技术资料：[Docker 与容器化技术](../../01-技术资料/06-DevOps与云计算/01-Docker与容器化技术.md)
> - [Linux Namespace 内核文档](https://www.kernel.org/doc/html/latest/admin-guide/namespaces/compatibility-list.html)
> - [Cgroups v2 内核文档](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html)
