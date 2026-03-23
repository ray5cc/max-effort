# Docker 与容器化技术

> 深入解析容器核心原理（Namespace / Cgroups / OverlayFS）、Docker 架构组件、Dockerfile 最佳实践、网络存储模型、Docker Compose 编排及容器安全体系。

## 相关链接

- 对应面试题：[Docker 面试题](../../02-面试指南/06-DevOps与云计算面试/01-Docker面试题.md)

---

## 目录

1. [容器核心原理](#1-容器核心原理)
   - 1.1 [容器 vs 虚拟机](#11-容器-vs-虚拟机)
   - 1.2 [Linux Namespace 隔离机制](#12-linux-namespace-隔离机制)
   - 1.3 [Cgroups 资源限制](#13-cgroups-资源限制)
   - 1.4 [Union Filesystem（OverlayFS）](#14-union-filesystemoverlayfs)
   - 1.5 [OCI 标准](#15-oci-标准)
2. [Docker 架构与核心组件](#2-docker-架构与核心组件)
   - 2.1 [整体架构](#21-整体架构)
   - 2.2 [镜像层级与构建缓存](#22-镜像层级与构建缓存)
   - 2.3 [Dockerfile 最佳实践](#23-dockerfile-最佳实践)
   - 2.4 [网络模式](#24-网络模式)
   - 2.5 [存储驱动](#25-存储驱动)
3. [Docker Compose 与编排基础](#3-docker-compose-与编排基础)
   - 3.1 [核心语法](#31-核心语法)
   - 3.2 [服务依赖与健康检查](#32-服务依赖与健康检查)
   - 3.3 [多环境配置管理](#33-多环境配置管理)
4. [容器安全](#4-容器安全)
   - 4.1 [运行时安全](#41-运行时安全)
   - 4.2 [镜像安全扫描](#42-镜像安全扫描)
   - 4.3 [最小基础镜像](#43-最小基础镜像)
5. [常用命令速查](#5-常用命令速查)

---

## 1. 容器核心原理

### 1.1 容器 vs 虚拟机

容器与虚拟机（VM）代表两种不同粒度的隔离方案：

```diagram
┌─────────────────────────────────────────────────────────────────┐
│                     容器架构 (Container)                         │
├──────────────┬──────────────┬──────────────┬────────────────────┤
│  Container A │  Container B │  Container C │    Container D     │
│  (App + Libs)│  (App + Libs)│  (App + Libs)│    (App + Libs)    │
├──────────────┴──────────────┴──────────────┴────────────────────┤
│                    Container Runtime (containerd / runc)         │
├─────────────────────────────────────────────────────────────────┤
│                    Host OS Kernel (共享)                         │
├─────────────────────────────────────────────────────────────────┤
│                    Hardware / Hypervisor (物理机)                │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     虚拟机架构 (VM)                              │
├─────────────────────┬───────────────────────────────────────────┤
│       VM 1          │              VM 2                         │
│  ┌───────────────┐  │  ┌─────────────────────────────────────┐  │
│  │  App + Libs   │  │  │          App + Libs                 │  │
│  ├───────────────┤  │  ├─────────────────────────────────────┤  │
│  │  Guest OS     │  │  │          Guest OS                   │  │
│  └───────────────┘  │  └─────────────────────────────────────┘  │
├─────────────────────┴───────────────────────────────────────────┤
│                    Hypervisor (KVM / VMware / Xen)               │
├─────────────────────────────────────────────────────────────────┤
│                    Host OS Kernel                                │
├─────────────────────────────────────────────────────────────────┤
│                    Hardware                                      │
└─────────────────────────────────────────────────────────────────┘
```

| 维度         | 容器                      | 虚拟机                   |
|--------------|---------------------------|--------------------------|
| 启动时间     | 毫秒级（< 1s）            | 秒~分钟级                |
| 内存开销     | MB 级（共享内核）         | GB 级（含 Guest OS）     |
| 隔离级别     | 进程级（Namespace）       | 硬件级（Hypervisor）     |
| 内核共享     | 共享宿主机内核            | 独立内核                 |
| 镜像大小     | MB 级（layered fs）       | GB 级（完整 OS 镜像）    |
| 可移植性     | 极强（OCI 标准）          | 较强（OVF 标准）         |
| 安全隔离     | 较弱（共享内核风险）      | 强（完全隔离）           |
| 资源利用率   | 高（共享内核，低开销）    | 较低（Guest OS 占用）    |

---

### 1.2 Linux Namespace 隔离机制

Namespace 是 Linux 内核提供的轻量级进程隔离机制，每个 Namespace 为进程提供独立的系统资源视图。Docker 组合使用以下 6 种 Namespace 实现容器隔离。

#### PID Namespace — 进程隔离

PID Namespace 为容器内进程提供独立的进程 ID 空间，容器内第一个进程 PID=1，与宿主机的 PID 完全隔离。

```diagram
宿主机进程树：                    容器内进程树：
PID 1  (systemd)                  PID 1  (nginx)      ← 实际宿主机 PID 8421
PID 2  (kthreadd)                 PID 2  (worker)     ← 实际宿主机 PID 8422
...                               PID 3  (worker)
PID 8421 (nginx)   ←─────────────────────────────── 映射关系由内核维护
```

```bash
# 验证 PID Namespace 隔离
# 宿主机查看 nginx 容器进程
$ docker run -d --name nginx nginx:alpine
$ ps aux | grep nginx
# 显示宿主机真实 PID（如 8421）

# 在容器内查看进程
$ docker exec nginx ps aux
# PID 1 是 nginx master，PID 2+ 是 worker
# 容器内看不到宿主机其他进程

# 使用 unshare 手动创建 PID Namespace（了解底层）
$ sudo unshare --pid --fork --mount-proc /bin/bash
# 在新 shell 中：
$ ps aux   # 只看到当前 bash(PID=1) 和 ps(PID=2)
```

```c
/* 内核层：clone 系统调用创建 PID Namespace */
// flags 中加入 CLONE_NEWPID
int child_pid = clone(child_fn, stack_top,
                      CLONE_NEWPID | SIGCHLD, NULL);
```

#### NET Namespace — 网络隔离

NET Namespace 为每个容器提供独立的网络栈，包括网卡、IP 地址、路由表、iptables 规则等。

```diagram
┌─────────────────────────────────────────────────────────────────┐
│ 宿主机 NET Namespace                                             │
│  eth0: 192.168.1.100   lo: 127.0.0.1                            │
│  docker0 bridge: 172.17.0.1                                     │
│     │                                                           │
│  veth pair (veth0 ↔ eth0 in container)                          │
└───────────────────────┬─────────────────────────────────────────┘
                        │ veth pair
┌───────────────────────▼─────────────────────────────────────────┐
│ 容器 A NET Namespace                                             │
│  eth0: 172.17.0.2   lo: 127.0.0.1                               │
│  route: default via 172.17.0.1                                  │
└─────────────────────────────────────────────────────────────────┘
```

```bash
# 查看容器网络 Namespace
$ docker inspect nginx | grep -i "pid"
# 获取容器 PID（如 8421）

$ sudo nsenter -t 8421 -n ip addr
# 在容器的 NET Namespace 中执行 ip addr，看到独立网卡

# 手动创建 NET Namespace（底层原理演示）
$ sudo ip netns add myns
$ sudo ip netns exec myns ip link list
# 只显示 lo，没有 eth0

# 创建 veth pair 连接两个 Namespace
$ sudo ip link add veth0 type veth peer name veth1
$ sudo ip link set veth1 netns myns
$ sudo ip addr add 10.0.0.1/24 dev veth0 && sudo ip link set veth0 up
$ sudo ip netns exec myns ip addr add 10.0.0.2/24 dev veth1
$ sudo ip netns exec myns ip link set veth1 up
$ ping 10.0.0.2   # 宿主机可以 ping 通容器内虚拟网卡
```

#### MNT Namespace — 挂载点隔离

MNT Namespace 使每个容器拥有独立的文件系统挂载视图，容器内的 mount/umount 操作不影响宿主机。

```bash
# 查看容器挂载点（与宿主机隔离）
$ docker exec nginx mount | grep "overlay"
# overlay on / type overlay (rw,relatime,...)

# 宿主机查看对应挂载
$ cat /proc/mounts | grep docker
# 能看到 overlay 挂载信息，但容器内不可见宿主机全部挂载

# 手动演示 MNT Namespace
$ sudo unshare --mount /bin/bash
$ mount --bind /tmp/newroot /mnt   # 只在新 Namespace 中生效
$ cat /proc/mounts | grep newroot  # 能看到
# 退出后宿主机 /proc/mounts 中没有该条目
```

#### UTS Namespace — 主机名隔离

UTS（Unix Timesharing System）Namespace 允许容器拥有独立的 hostname 和 domainname。

```bash
# 容器内 hostname 与宿主机隔离
$ docker run --rm alpine hostname
# 输出：6f3a2b8c1d4e（容器 ID 前 12 位）

$ docker run --rm --hostname myapp alpine hostname
# 输出：myapp

# 验证宿主机 hostname 不受影响
$ hostname
# 输出：宿主机真实主机名

# 手动创建 UTS Namespace
$ sudo unshare --uts /bin/bash
$ hostname newname
$ hostname   # 输出 newname
# 另一个终端：hostname  → 宿主机名不变
```

#### IPC Namespace — 进程间通信隔离

IPC Namespace 隔离 System V IPC 对象（消息队列、信号量、共享内存）和 POSIX 消息队列。

```bash
# 默认情况下容器 IPC 与宿主机隔离
$ ipcmk -Q                        # 宿主机创建消息队列
# Message queue id: 0

$ docker run --rm alpine ipcs -q  # 容器内看不到宿主机消息队列
# ------ Message Queues --------
# (空)

# 使用 --ipc=host 共享宿主机 IPC Namespace（不推荐生产使用）
$ docker run --rm --ipc=host alpine ipcs -q
# 能看到宿主机的消息队列

# 两个容器共享 IPC（用于高性能共享内存通信）
$ docker run -d --name sender --ipc=shareable alpine sleep 3600
$ docker run -d --name receiver --ipc=container:sender alpine sleep 3600
```

#### USER Namespace — 用户隔离

USER Namespace 允许容器内的 root（UID=0）映射到宿主机的非特权用户（如 UID=1000），是实现 rootless 容器的关键。

```bash
# 查看 UID 映射关系
$ docker run --rm alpine cat /proc/self/uid_map
# 在启用 userns-remap 的 Docker 中：
#  0   100000   65536
# 容器内 UID 0~65535  →  宿主机 UID 100000~165535

# 配置 Docker 启用 userns-remap
# /etc/docker/daemon.json
{
  "userns-remap": "default"
}

# 验证 rootless 容器效果
$ docker run --rm alpine id
# uid=0(root) gid=0(root)   ← 容器内看起来是 root

$ ps aux | grep sleep
# 宿主机上实际运行在非特权 UID（如 100000）下

# 手动创建 USER Namespace
$ unshare --user --map-root-user /bin/bash
$ id   # uid=0(root) 但宿主机上实际是普通用户
$ cat /proc/self/uid_map  # 0  <host_uid>  1
```

---

### 1.3 Cgroups 资源限制

Cgroups（Control Groups）是 Linux 内核的资源限制机制，限制和计量进程组的 CPU、内存、磁盘 I/O、网络带宽等资源。

#### Cgroups v1 vs v2 对比

| 特性               | Cgroups v1                    | Cgroups v2                        |
|--------------------|-------------------------------|-----------------------------------|
| 挂载点             | `/sys/fs/cgroup/<subsystem>/` | `/sys/fs/cgroup/`（统一层级）     |
| 层级结构           | 各子系统独立层级              | 统一单一层级                      |
| 线程粒度控制       | 不支持                        | 支持（threaded mode）             |
| 内存 swap 控制     | memory.memsw.limit_in_bytes   | memory.swap.max                   |
| PSI 压力指标       | 不支持                        | 支持（memory/cpu/io.pressure）    |
| rootless 支持      | 有限                          | 完整支持                          |
| Kubernetes 支持    | 部分                          | 推荐（K8s 1.25+ 默认启用）        |

#### CPU 限制

```bash
# Docker CPU 限制（--cpus 内部通过 cgroup cpu.cfs_quota_us 实现）
$ docker run -d --cpus="1.5" --name cpu-limited nginx

# 查看对应 cgroup 配置（v1）
$ cat /sys/fs/cgroup/cpu/docker/<container-id>/cpu.cfs_quota_us
# 150000  （1.5 核 × 100000μs）
$ cat /sys/fs/cgroup/cpu/docker/<container-id>/cpu.cfs_period_us
# 100000  （100ms 周期）

# 查看对应 cgroup 配置（v2）
$ cat /sys/fs/cgroup/system.slice/docker-<id>.scope/cpu.max
# 150000 100000

# CPU 份额（软限制，空闲时可突破）
$ docker run -d --cpu-shares=512 nginx     # 默认 1024，此处为 50% 权重
$ docker run -d --cpu-shares=1024 redis

# 绑定特定 CPU 核心（CPU affinity）
$ docker run -d --cpuset-cpus="0,2" nginx  # 只使用 CPU 0 和 2

# 手动写入 cgroup（v2 示例）
$ echo "200000 1000000" > /sys/fs/cgroup/mygroup/cpu.max
# 限制为 20% CPU（200ms/1000ms 周期内最多运行 200ms）
```

#### Memory 限制

```bash
# 硬限制内存（超出则 OOM Kill）
$ docker run -d --memory="512m" nginx

# 内存软限制（系统内存紧张时回收）
$ docker run -d --memory="512m" --memory-reservation="256m" nginx

# 禁止使用 swap（生产推荐）
$ docker run -d --memory="512m" --memory-swap="512m" nginx
# memory-swap == memory 时，禁用 swap

# 验证限制生效（v2）
$ cat /sys/fs/cgroup/system.slice/docker-<id>.scope/memory.max
# 536870912  （512 × 1024 × 1024 bytes）

# OOM 事件监控
$ docker stats nginx
# 观察 MEM USAGE / LIMIT 列

# 手动 cgroup v2 内存限制
$ mkdir /sys/fs/cgroup/mygroup
$ echo $$ > /sys/fs/cgroup/mygroup/cgroup.procs   # 将当前进程加入
$ echo $((256*1024*1024)) > /sys/fs/cgroup/mygroup/memory.max
```

#### Block I/O 限制

```bash
# 限制磁盘读写速率（字节/秒）
$ docker run -d \
  --device-read-bps /dev/sda:10mb \
  --device-write-bps /dev/sda:5mb \
  nginx

# 限制 IOPS
$ docker run -d \
  --device-read-iops /dev/sda:1000 \
  --device-write-iops /dev/sda:500 \
  nginx

# 验证（v1）
$ cat /sys/fs/cgroup/blkio/docker/<id>/blkio.throttle.read_bps_device
# 8:0  10485760   （主次设备号 : 字节/秒）

# v2 使用 io.max
$ cat /sys/fs/cgroup/docker/<id>/io.max
# 8:0 rbps=10485760 wbps=5242880 riops=max wiops=max
```

#### PIDs 限制

```bash
# 防止 fork 炸弹：限制容器内进程总数
$ docker run -d --pids-limit=100 nginx

# 验证
$ cat /sys/fs/cgroup/pids/docker/<id>/pids.max
# 100

# cgroup v2
$ cat /sys/fs/cgroup/docker/<id>/pids.max
# 100
```

---

### 1.4 Union Filesystem（OverlayFS）

OverlayFS（overlay2）是 Docker 默认的存储驱动，基于联合文件系统实现镜像分层存储。

#### OverlayFS 分层原理

```diagram
镜像构建层（只读）                       容器层（可写）
                                          ┌──────────────────┐
                                          │   upperdir       │  ← 容器写入层
                                          │   (可读写)       │
                                          └─────────┬────────┘
                                                    │ overlay 合并
┌─────────────────────────────────────────┐         │
│   lowerdir (镜像层，只读，从上到下叠加) │─────────┘
│                                         │
│  Layer 4: COPY app/ /app               │  ← 最新层（最上）
│  ─────────────────────────────         │
│  Layer 3: RUN pip install              │
│  ─────────────────────────────         │
│  Layer 2: COPY requirements.txt .      │
│  ─────────────────────────────         │
│  Layer 1: FROM python:3.11-slim        │  ← 基础层（最下）
└─────────────────────────────────────────┘
                    │
                    ▼
              workdir（内部临时层）
                    │
                    ▼
┌─────────────────────────────────────────┐
│      merged（容器内看到的文件系统）      │
│  = lowerdir + upperdir 的透明合并       │
└─────────────────────────────────────────┘
```

#### OverlayFS 核心目录结构

```bash
# Docker overlay2 数据目录（/var/lib/docker/overlay2/）
$ ls /var/lib/docker/overlay2/
# <layer-id>/
#   diff/      ← 该层的文件内容
#   link       ← 短链接符号名
#   lower      ← 指向下层的链接
#   merged/    ← 挂载后的合并视图（仅运行中容器有）
#   work/      ← OverlayFS 内部工作目录

# 查看运行中容器的 overlay 挂载
$ docker inspect <container-id> | python3 -m json.tool | grep -A5 '"GraphDriver"'
# "Data": {
#   "LowerDir": "/var/lib/docker/overlay2/<id>/diff:...",
#   "MergedDir": "/var/lib/docker/overlay2/<id>/merged",
#   "UpperDir": "/var/lib/docker/overlay2/<id>/diff",
#   "WorkDir": "/var/lib/docker/overlay2/<id>/work"
# }

# 实际 mount 命令（内核层）
$ mount -t overlay overlay \
  -o lowerdir=/layer3/diff:/layer2/diff:/layer1/diff,\
     upperdir=/container/diff,\
     workdir=/container/work \
  /container/merged
```

#### 写时复制（Copy-on-Write）

```
读文件：直接从 lowerdir 读取，不复制
写文件：
  1. 检查 upperdir 是否存在该文件
  2. 若不存在，从 lowerdir 复制到 upperdir（copy-up）
  3. 在 upperdir 中修改文件
  4. merged 视图展示 upperdir 中的版本

删除文件：在 upperdir 中创建 whiteout 文件（.wh.<filename>）
          覆盖 lowerdir 中的同名文件，使其在 merged 视图中不可见
```

```bash
# 验证 CoW 行为
$ docker run -it ubuntu bash
root@container:# echo "hello" >> /etc/hosts  # 写入只读层中的文件
root@container:# exit

# 宿主机查看 upperdir
$ ls /var/lib/docker/overlay2/<container-layer>/diff/etc/
# hosts   ← 被 copy-up 到 upperdir

# 原始镜像层中的 /etc/hosts 未被修改
$ ls /var/lib/docker/overlay2/<image-layer>/diff/etc/
# hosts   ← 原始文件保持不变
```

---

### 1.5 OCI 标准

OCI（Open Container Initiative）是 Linux 基金会旗下的开放标准，定义了容器的运行时规范和镜像规范，确保跨平台、跨运行时的互操作性。

| 规范                       | 说明                                          | 实现                          |
|----------------------------|-----------------------------------------------|-------------------------------|
| OCI Runtime Spec           | 容器生命周期（create/start/stop/delete）       | runc、crun、kata-containers   |
| OCI Image Spec             | 镜像格式（manifest/config/layers）             | Docker、Podman、Buildah       |
| OCI Distribution Spec      | 镜像仓库推送/拉取 API                          | Docker Registry、Harbor       |

```bash
# runc 是最主流的 OCI Runtime 实现
$ runc --version
# runc version 1.1.12

# OCI bundle 结构（runc 直接运行容器所需）
mycontainer/
├── config.json    ← OCI Runtime Spec（容器配置）
└── rootfs/        ← 容器根文件系统

# 生成示例 config.json
$ runc spec   # 在 bundle 目录中生成默认配置

# 查看 Docker 使用的 containerd -> runc 调用链
$ journalctl -u docker | grep "containerd"
# 可看到 containerd 如何调用 runc 创建容器
```

---

## 2. Docker 架构与核心组件

### 2.1 整体架构

```diagram
用户层：
  docker CLI / Docker Desktop / 第三方工具
       │  REST API / Unix Socket
       ▼
┌──────────────────────────────────────────────────────────────┐
│                    Docker Daemon (dockerd)                   │
│                                                              │
│  ┌──────────────┐  ┌─────────────┐  ┌────────────────────┐  │
│  │  Image 管理  │  │ Network 管理 │  │   Volume 管理      │  │
│  └──────────────┘  └─────────────┘  └────────────────────┘  │
│                                                              │
│  gRPC API                                                    │
└───────────────────┬──────────────────────────────────────────┘
                    │ gRPC
       ┌────────────▼─────────────────────────────────────┐
       │              containerd                          │
       │                                                  │
       │  ┌──────────────────┐  ┌───────────────────────┐ │
       │  │  Image Service   │  │  Snapshot Service     │ │
       │  │  (镜像 pull/push)│  │  (OverlayFS 层管理)   │ │
       │  └──────────────────┘  └───────────────────────┘ │
       │  ┌──────────────────┐  ┌───────────────────────┐ │
       │  │  Task Service    │  │  Content Store        │ │
       │  │  (容器生命周期)  │  │  (镜像层内容存储)     │ │
       │  └──────────────────┘  └───────────────────────┘ │
       │                                                  │
       │  containerd-shim-runc-v2 (每容器一个 shim 进程) │
       └───────────────────┬──────────────────────────────┘
                           │ OCI Runtime API
              ┌────────────▼─────────────────┐
              │          runc                │
              │  (调用 clone/unshare 系统调用│
              │   创建 Namespace + Cgroup)   │
              └────────────┬─────────────────┘
                           │
              ┌────────────▼─────────────────┐
              │        Container Process      │
              │   (在隔离环境中运行的应用)    │
              └──────────────────────────────┘
```

**各组件职责：**

| 组件                 | 职责                                          | 重启 Docker 后 |
|----------------------|-----------------------------------------------|----------------|
| dockerd              | 接受 CLI 请求，管理镜像/网络/卷                | 守护进程重启   |
| containerd           | 管理容器生命周期，与 shim 交互                 | 独立于 dockerd |
| containerd-shim      | 每容器一个，保持 stdin/stdout，父进程退出不影响容器 | 容器存活      |
| runc                 | 一次性进程，调用内核 API 创建容器后退出        | —              |

---

### 2.2 镜像层级与构建缓存

#### 镜像层级结构

```
docker image inspect nginx | python3 -m json.tool | grep -A30 '"RootFS"'
# "RootFS": {
#   "Type": "layers",
#   "Layers": [
#     "sha256:e3b0c44298fc1c...",  ← 基础层（FROM debian:bookworm-slim）
#     "sha256:9d21b12d5fab1b...",  ← apt-get install
#     "sha256:7e0b7f6b4f9c2a...",  ← COPY nginx config
#     "sha256:ab3d4e5f6a7b8c..."   ← ENTRYPOINT / CMD
#   ]
# }
```

#### 构建缓存机制

Docker 按 Dockerfile 指令顺序构建，对每条指令计算缓存键：

```
缓存键 = hash(父层ID + 指令类型 + 指令参数)

缓存命中条件：
  - RUN/COPY/ADD：父层 ID + 指令内容完全一致（COPY 还比对文件内容哈希）
  - FROM/ENV/ARG：父层 ID + 指令值完全一致

缓存失效规则：
  - 某一层缓存失效 → 其后所有层必须重新构建（级联失效）
  - --no-cache：跳过所有缓存
  - --cache-from：使用远端镜像作为缓存源（CI 场景常用）
```

```bash
# 缓存失效示例：COPY 变化导致后续层全部重建
# ❌ 不优化写法
FROM python:3.11-slim
COPY . /app              # 任何文件变化都使此层及后续层缓存失效
RUN pip install -r /app/requirements.txt  # 每次都重跑

# ✅ 优化写法：先 COPY 依赖文件，利用缓存跳过 pip install
FROM python:3.11-slim
COPY requirements.txt /app/
RUN pip install -r /app/requirements.txt  # 只有 requirements.txt 变化才重跑
COPY . /app                                # 代码变化只影响此层以后

# CI 中使用远端缓存
$ docker buildx build \
  --cache-from type=registry,ref=myregistry/myapp:cache \
  --cache-to type=registry,ref=myregistry/myapp:cache,mode=max \
  -t myregistry/myapp:latest .
```

---

### 2.3 Dockerfile 最佳实践

#### 多阶段构建（Multi-stage Build）

多阶段构建可大幅减小生产镜像体积，将构建工具链与运行时完全分离。

```dockerfile
# ================================
# Go 应用多阶段构建示例
# ================================

# 阶段 1：构建阶段（builder）
FROM golang:1.22-alpine AS builder

# 安装构建依赖
RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /build

# 先复制 go.mod/go.sum，利用缓存跳过 go mod download
COPY go.mod go.sum ./
RUN go mod download

# 复制源码并构建（CGO_ENABLED=0 生成静态二进制）
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-w -s" -o /app/server ./cmd/server

# ─────────────────────────────────

# 阶段 2：生产镜像（最小化）
FROM scratch

# 从构建阶段复制必要文件
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=builder /app/server /server

# 非 root 用户（scratch 镜像中通过 USER 指令指定数字 UID）
USER 65534:65534

EXPOSE 8080
ENTRYPOINT ["/server"]
```

```dockerfile
# ================================
# Node.js / Next.js 多阶段构建示例
# ================================

# 阶段 1：安装依赖
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./
RUN \
  if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm ci; \
  elif [ -f pnpm-lock.yaml ]; then yarn global add pnpm && pnpm i --frozen-lockfile; \
  else echo "No lockfile found." && exit 1; fi

# 阶段 2：构建应用
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED 1
RUN yarn build

# 阶段 3：生产运行时
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

# 创建非 root 用户
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# 只复制必要文件（不包含 node_modules 源码）
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT 3000
ENV HOSTNAME "0.0.0.0"
CMD ["node", "server.js"]
```

```dockerfile
# ================================
# Java Spring Boot 多阶段构建
# ================================

# 阶段 1：Maven 构建
FROM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /build

# 先复制 pom.xml，预下载依赖（利用缓存）
COPY pom.xml .
RUN mvn dependency:go-offline -B

# 复制源码并构建
COPY src ./src
RUN mvn package -DskipTests -B

# 使用 Spring Boot layertools 分解 JAR（进一步优化层缓存）
RUN java -Djarmode=layertools -jar target/*.jar extract

# 阶段 2：生产镜像
FROM eclipse-temurin:21-jre-jammy

RUN addgroup --system --gid 1001 spring \
    && adduser --system --uid 1001 --gid 1001 spring
USER spring:spring

WORKDIR /app

# 按变化频率从低到高分层复制（最大化缓存命中）
COPY --from=builder /build/dependencies/ ./
COPY --from=builder /build/spring-boot-loader/ ./
COPY --from=builder /build/snapshot-dependencies/ ./
COPY --from=builder /build/application/ ./

EXPOSE 8080
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
```

#### .dockerignore 配置

```dockerignore
# ================================
# .dockerignore 最佳实践
# ================================

# 版本控制
.git
.gitignore
.gitattributes

# 文档
README.md
CHANGELOG.md
docs/
*.md

# 测试与 CI
**/*_test.go
**/*.test.js
**/*.spec.ts
.github/
Jenkinsfile
.gitlab-ci.yml

# 本地开发配置
.env
.env.*
!.env.example
docker-compose*.yml
docker-compose*.yaml

# 构建产物（避免误带入）
dist/
build/
target/
.next/
node_modules/   # ← 关键！避免把本地 node_modules 复制进去

# IDE 和 OS
.idea/
.vscode/
.DS_Store
Thumbs.db

# 日志和临时文件
*.log
*.tmp
tmp/
```

#### Dockerfile 层缓存优化原则

```
优化原则总结：

1. 将变化频率低的指令放前面（FROM > COPY deps > RUN install > COPY src）
2. 合并 RUN 指令减少层数，但保持逻辑清晰
3. 在同一 RUN 中清理缓存（apt clean / pip cache purge）
4. 使用 COPY 而非 ADD（ADD 会自动解压，行为不透明）
5. 明确指定 WORKDIR，不使用相对路径
6. 使用精确的镜像标签，避免 latest（保证构建可重复）
7. 非 root 用户运行（USER 指令放 RUN install 后）
8. EXPOSE 只是文档性注释，不自动发布端口
```

```dockerfile
# ❌ 反面示例：层数多、缓存差、以 root 运行
FROM ubuntu:latest
RUN apt-get update
RUN apt-get install -y python3
RUN apt-get install -y pip
COPY . /app
RUN pip install -r /app/requirements.txt
CMD python3 /app/app.py

# ✅ 正面示例：精简、缓存友好、安全
FROM python:3.11-slim AS base

# 合并 apt 安装并清理缓存（单层）
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先复制依赖文件（低频变化）
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 创建非 root 用户
RUN adduser --disabled-password --gecos '' appuser

# 再复制代码（高频变化，放最后）
COPY --chown=appuser:appuser . .

USER appuser
EXPOSE 8000
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "app:app"]
```

---

### 2.4 网络模式

Docker 支持多种网络驱动，适用于不同场景：

| 网络模式   | 驱动         | IP 地址           | 端口映射   | 隔离性 | 适用场景                      |
|------------|--------------|-------------------|------------|--------|-------------------------------|
| bridge     | bridge       | 私有 172.17.0.x   | 需要 -p    | 中     | 单机容器默认，开发测试         |
| host       | host         | 共享宿主机 IP      | 不需要     | 低     | 高性能网络，监控 Agent         |
| overlay    | overlay      | 虚拟子网（跨主机）| 需要 -p    | 高     | Docker Swarm / K8s 集群       |
| macvlan    | macvlan      | 物理网络真实 IP    | 不需要     | 高     | 容器直连物理网络，网络设备管理 |
| ipvlan     | ipvlan       | 共享 MAC          | 不需要     | 高     | 云环境 MAC 数量受限时          |
| none       | null         | 无                | 无         | 最高   | 安全沙箱，自定义网络           |

```bash
# bridge 网络（默认）
$ docker network ls
# NETWORK ID   NAME      DRIVER   SCOPE
# abc123       bridge    bridge   local
# def456       host      host     local
# ghi789       none      null     local

# 创建自定义 bridge 网络（推荐，提供 DNS 解析）
$ docker network create \
  --driver bridge \
  --subnet 172.20.0.0/16 \
  --gateway 172.20.0.1 \
  mynet

# 同一自定义网络内的容器可通过服务名互相访问
$ docker run -d --name redis --network mynet redis:7-alpine
$ docker run -d --name app --network mynet myapp
# app 容器内：redis://redis:6379  ← 通过容器名 DNS 解析

# host 网络（容器直接使用宿主机网络栈）
$ docker run -d --network host nginx
# 无需 -p 映射，直接监听宿主机 80 端口
# 注意：Linux 专属，macOS/Windows 上无效

# overlay 网络（Swarm 模式跨主机通信）
$ docker swarm init
$ docker network create \
  --driver overlay \
  --attachable \
  myoverlay
# 跨宿主机的容器可在此网络中通信（底层使用 VXLAN）

# macvlan 网络（容器获得真实 MAC 和 IP）
$ docker network create \
  --driver macvlan \
  --subnet 192.168.1.0/24 \
  --gateway 192.168.1.1 \
  -o parent=eth0 \
  mymacvlan
$ docker run -d \
  --network mymacvlan \
  --ip 192.168.1.200 \
  nginx
# 路由器可以直接看到容器的 MAC 地址
```

---

### 2.5 存储驱动

| 存储驱动       | 底层技术     | 性能          | 稳定性 | 适用场景                        |
|----------------|--------------|---------------|--------|---------------------------------|
| overlay2       | OverlayFS    | 高（Page Cache 共享）| 高   | 现代 Linux 默认，推荐生产      |
| devicemapper   | Device Mapper| 中（直接 I/O）| 中     | RHEL/CentOS 旧版，已逐步废弃    |
| btrfs          | Btrfs        | 高（子卷快照）| 中     | 需要文件系统级快照功能          |
| zfs            | ZFS          | 高（写时复制）| 高     | 需要企业级存储功能              |
| vfs            | 普通目录复制 | 低            | 高     | 调试/测试，不推荐生产           |

```bash
# 查看当前存储驱动
$ docker info | grep "Storage Driver"
# Storage Driver: overlay2

# 配置存储驱动（/etc/docker/daemon.json）
{
  "storage-driver": "overlay2",
  "storage-opts": [
    "overlay2.size=20G"       # 容器可写层大小限制
  ]
}

# 查看镜像层磁盘使用
$ docker system df
# TYPE            TOTAL   ACTIVE  SIZE      RECLAIMABLE
# Images          15      3       4.521GB   3.2GB (70%)
# Containers      3       2       1.2GB     0B (0%)
# Local Volumes   8       4       512MB     256MB (50%)

# 清理无用资源
$ docker system prune -a --volumes  # 危险！清理所有未使用镜像/容器/卷
$ docker image prune               # 只清理 dangling 镜像（无标签镜像）
```

---

## 3. Docker Compose 与编排基础

### 3.1 核心语法

```yaml
# docker-compose.yml 完整示例（电商应用）
version: "3.9"

services:
  # ─────────── 数据库服务 ───────────
  postgres:
    image: postgres:16-alpine
    container_name: shop_postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: shopdb
      POSTGRES_USER: shopuser
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    volumes:
      - pg_data:/var/lib/postgresql/data   # 命名卷：数据持久化
      - ./init-scripts:/docker-entrypoint-initdb.d:ro  # 初始化 SQL
    ports:
      - "127.0.0.1:5432:5432"              # 只绑定本地，不暴露外网
    networks:
      - backend
    secrets:
      - db_password
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U shopuser -d shopdb"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  # ─────────── 缓存服务 ───────────
  redis:
    image: redis:7-alpine
    container_name: shop_redis
    restart: unless-stopped
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
    networks:
      - backend
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 3

  # ─────────── 应用服务 ───────────
  app:
    build:
      context: .
      dockerfile: Dockerfile
      target: production          # 多阶段构建：指定阶段
      args:
        APP_VERSION: ${APP_VERSION:-1.0.0}
    image: myregistry/shop-app:${APP_VERSION:-latest}
    container_name: shop_app
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy  # 等待 postgres 健康检查通过
      redis:
        condition: service_healthy
    environment:
      - DATABASE_URL=postgresql://shopuser@postgres:5432/shopdb
      - REDIS_URL=redis://redis:6379
      - LOG_LEVEL=${LOG_LEVEL:-info}
    env_file:
      - .env.production            # 外部环境变量文件
    ports:
      - "8080:8080"
    volumes:
      - ./uploads:/app/uploads     # 绑定挂载：用户上传文件
    networks:
      - frontend
      - backend
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 512M
        reservations:
          cpus: "0.25"
          memory: 128M
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  # ─────────── 反向代理 ───────────
  nginx:
    image: nginx:1.25-alpine
    container_name: shop_nginx
    restart: unless-stopped
    depends_on:
      - app
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
      - ./nginx/logs:/var/log/nginx
    networks:
      - frontend

# ─────────── 卷定义 ───────────
volumes:
  pg_data:
    driver: local
  redis_data:
    driver: local

# ─────────── 网络定义 ───────────
networks:
  frontend:
    driver: bridge
  backend:
    driver: bridge
    internal: true                 # 内部网络，无法访问外网

# ─────────── Secrets ───────────
secrets:
  db_password:
    file: ./secrets/db_password.txt
```

---

### 3.2 服务依赖与健康检查

```yaml
# 健康检查类型示例
services:
  # HTTP 健康检查
  api:
    image: myapi
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s      # 每 30s 检查一次
      timeout: 10s       # 单次检查超时
      retries: 3         # 连续 3 次失败才标记 unhealthy
      start_period: 40s  # 启动宽限期（期间失败不计入 retries）

  # TCP 健康检查
  mysql:
    image: mysql:8
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5

  # 自定义脚本检查
  elasticsearch:
    image: elasticsearch:8.11.0
    healthcheck:
      test: >
        CMD-SHELL curl -s http://localhost:9200/_cluster/health |
        grep -q '"status":"green"\|"status":"yellow"'
      interval: 20s
      timeout: 10s
      retries: 6
      start_period: 60s

  # 依赖关系配置（condition 模式）
  worker:
    image: myworker
    depends_on:
      mysql:
        condition: service_healthy
      elasticsearch:
        condition: service_healthy
      kafka:
        condition: service_started  # 只等启动，不等健康（默认）
```

```bash
# Compose 常用命令
$ docker compose up -d                # 后台启动
$ docker compose up -d --build        # 强制重新构建
$ docker compose ps                   # 查看服务状态
$ docker compose logs -f app          # 跟踪应用日志
$ docker compose exec app bash        # 进入容器
$ docker compose restart app          # 重启单个服务
$ docker compose scale worker=3       # 扩缩容（v3 改用 --scale）
$ docker compose --profile debug up   # 启动特定 profile 的服务
$ docker compose down -v              # 停止并删除容器+卷（危险）
```

---

### 3.3 多环境配置管理

```bash
# 项目目录结构（多环境）
myapp/
├── docker-compose.yml          # 基础配置（所有环境共用）
├── docker-compose.override.yml # 开发环境覆盖（本地默认加载）
├── docker-compose.prod.yml     # 生产环境覆盖
├── docker-compose.test.yml     # 测试环境覆盖
├── .env                        # 默认环境变量（不提交 git）
├── .env.example                # 环境变量模板（提交 git）
└── .env.production             # 生产环境变量（加密存储）
```

```yaml
# docker-compose.yml（基础配置）
services:
  app:
    image: myapp:${APP_VERSION}
    environment:
      - APP_ENV=${APP_ENV}
      - DATABASE_URL=${DATABASE_URL}

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
```

```yaml
# docker-compose.override.yml（开发环境，自动合并）
services:
  app:
    build: .                      # 开发环境本地构建
    volumes:
      - .:/app                    # 热重载：挂载本地代码
      - /app/node_modules         # 排除 node_modules（匿名卷）
    environment:
      - DEBUG=true
      - LOG_LEVEL=debug
    ports:
      - "3000:3000"
      - "9229:9229"               # Node.js 调试端口

  postgres:
    ports:
      - "5432:5432"               # 开发环境暴露数据库端口
```

```yaml
# docker-compose.prod.yml（生产环境）
services:
  app:
    restart: always
    deploy:
      replicas: 3
      resources:
        limits:
          cpus: "2.0"
          memory: 1G
    logging:
      driver: "fluentd"
      options:
        fluentd-address: "localhost:24224"

  postgres:
    volumes:
      - /data/postgres:/var/lib/postgresql/data  # 宿主机路径持久化
```

```bash
# 使用指定配置文件
$ docker compose -f docker-compose.yml \
                 -f docker-compose.prod.yml \
                 up -d

# 或通过环境变量
$ COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml \
  docker compose up -d

# .env 文件（自动加载）
APP_VERSION=2.1.0
APP_ENV=development
DATABASE_URL=postgresql://user:pass@postgres:5432/mydb
POSTGRES_PASSWORD=supersecret123
LOG_LEVEL=info
```

---

## 4. 容器安全

### 4.1 运行时安全

#### 非 root 用户运行

```dockerfile
# 方式 1：Dockerfile 中创建专用用户
FROM node:20-alpine
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
COPY --chown=appuser:appgroup . .
USER appuser    # 切换到非 root 用户
CMD ["node", "server.js"]

# 方式 2：使用数字 UID（无需 /etc/passwd 条目）
FROM scratch
COPY server /server
USER 65534:65534    # nobody:nogroup
CMD ["/server"]
```

```bash
# 运行时强制非 root
$ docker run --user 1000:1000 nginx
$ docker run --user nobody nginx

# 防止容器内 sudo/su 提权（只读 passwd）
$ docker run --user 1000 -v /dev/null:/etc/passwd:ro myimage

# 验证容器运行用户
$ docker exec mycontainer whoami
$ docker exec mycontainer id
```

#### Seccomp 配置

Seccomp（Secure Computing Mode）过滤容器可以调用的系统调用，大幅减小攻击面。

```bash
# Docker 默认 seccomp 配置文件屏蔽了 ~44 个危险系统调用
# 查看默认配置
$ docker info | grep seccomp
# Security Options: seccomp Profile: builtin

# 使用自定义 seccomp 配置（最小权限原则）
$ docker run --security-opt seccomp=/path/to/seccomp.json nginx

# 禁用 seccomp（不推荐，调试用）
$ docker run --security-opt seccomp=unconfined nginx
```

```json
// 自定义 seccomp 配置示例（只允许 nginx 所需的系统调用）
{
  "defaultAction": "SCMP_ACT_ERRNO",
  "architectures": ["SCMP_ARCH_X86_64", "SCMP_ARCH_AARCH64"],
  "syscalls": [
    {
      "names": [
        "accept4", "bind", "close", "connect", "epoll_create1",
        "epoll_ctl", "epoll_wait", "exit_group", "fcntl", "fstat",
        "futex", "getrlimit", "getsockname", "getsockopt", "ioctl",
        "listen", "mmap", "mprotect", "munmap", "open", "openat",
        "read", "recvfrom", "sendfile", "setsockopt", "socket",
        "stat", "write", "writev"
      ],
      "action": "SCMP_ACT_ALLOW"
    }
  ]
}
```

#### AppArmor 配置

```bash
# 查看 AppArmor 状态
$ sudo aa-status

# Docker 默认为容器加载 docker-default profile
# 查看默认 profile
$ cat /etc/apparmor.d/docker-default

# 使用自定义 AppArmor profile
$ docker run --security-opt apparmor=my-profile nginx

# 加载自定义 profile
$ sudo apparmor_parser -r -W /etc/apparmor.d/my-docker-profile
```

```
# AppArmor profile 示例（限制 nginx 容器）
#include <tunables/global>

profile my-nginx flags=(attach_disconnected,mediate_deleted) {
  #include <abstractions/base>
  #include <abstractions/nameservice>

  network inet stream,
  network inet6 stream,

  /usr/sbin/nginx mr,
  /etc/nginx/** r,
  /var/log/nginx/** rw,
  /var/run/nginx.pid rw,
  /tmp/** rw,

  deny /bin/sh mx,    # 禁止执行 shell
  deny @{PROC}/sys/kernel/** w,
}
```

#### Capabilities 控制

```bash
# 查看容器默认 Capabilities
$ docker run --rm alpine cat /proc/1/status | grep Cap
# CapPrm:  00000000a80425fb  （Docker 默认保留的 capabilities）

# 最小权限：删除所有 capabilities 后按需添加
$ docker run --cap-drop ALL \
             --cap-add NET_BIND_SERVICE \   # 允许绑定 < 1024 端口
             nginx

# 完全特权模式（危险！仅用于特殊场景如 Docker-in-Docker）
$ docker run --privileged nginx

# 常见 capabilities 说明
# NET_BIND_SERVICE：绑定 1024 以下端口
# NET_ADMIN：网络配置
# SYS_PTRACE：strace 调试
# SYS_ADMIN：挂载文件系统、修改内核参数
# CHOWN：修改文件所有权
```

---

### 4.2 镜像安全扫描

#### Trivy 扫描

```bash
# 安装 Trivy
$ brew install aquasecurity/trivy/trivy        # macOS
$ sudo apt-get install trivy                   # Ubuntu/Debian

# 扫描镜像漏洞
$ trivy image nginx:latest
# 2024-01-15 [INFO] Detecting OS...
# 2024-01-15 [INFO] Detecting Debian vulnerabilities...
#
# nginx:latest (debian 12.4)
# ═══════════════════════════════
# Total: 142 (UNKNOWN: 0, LOW: 87, MEDIUM: 37, HIGH: 15, CRITICAL: 3)
#
# ┌──────────────────┬───────────────┬──────────┬────────┐
# │   Library        │ Vulnerability │ Severity │ Fixed  │
# ├──────────────────┼───────────────┼──────────┼────────┤
# │ libssl3          │ CVE-2024-0727 │ HIGH     │ 3.0.12 │
# └──────────────────┴───────────────┴──────────┴────────┘

# 只显示 HIGH 和 CRITICAL
$ trivy image --severity HIGH,CRITICAL nginx:latest

# 扫描本地 Dockerfile 的配置问题（Misconfiguration）
$ trivy config --severity HIGH,CRITICAL Dockerfile

# 集成到 CI/CD（返回非 0 表示发现漏洞）
$ trivy image --exit-code 1 --severity CRITICAL myapp:latest
# 若发现 CRITICAL 漏洞，CI 流水线失败

# 扫描文件系统
$ trivy fs --security-checks vuln,config .

# 输出 SARIF 格式（供 GitHub Security 展示）
$ trivy image --format sarif --output trivy-results.sarif myapp:latest
```

```yaml
# GitHub Actions 集成示例
# .github/workflows/security.yml
name: Security Scan

on: [push, pull_request]

jobs:
  trivy-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build image
        run: docker build -t myapp:${{ github.sha }} .

      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: myapp:${{ github.sha }}
          format: sarif
          output: trivy-results.sarif
          severity: CRITICAL,HIGH
          exit-code: 1

      - name: Upload Trivy scan results to GitHub Security tab
        uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: trivy-results.sarif
```

#### Clair 扫描

```bash
# Clair 是 Quay.io 开源的容器镜像漏洞扫描工具
# 适合私有化部署场景

# 使用 Docker Compose 启动 Clair
# docker-compose.clair.yml
version: "3"
services:
  clair-db:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: password
      POSTGRES_DB: clair

  clair:
    image: quay.io/projectquay/clair:4.7.1
    depends_on:
      - clair-db
    environment:
      CLAIR_CONF: /config/config.yaml
    volumes:
      - ./clair-config:/config

# 通过 clairctl 提交扫描
$ clairctl report --host http://localhost:6060 myimage:latest
```

---

### 4.3 最小基础镜像

| 基础镜像         | 大小        | 特点                                      | 适用语言/场景          |
|------------------|-------------|-------------------------------------------|------------------------|
| scratch          | 0 B         | 完全空镜像，无任何文件系统                 | Go/Rust 静态二进制     |
| distroless       | 2–20 MB     | 无 shell/包管理器，只含运行时依赖          | Go/Java/Python/Node.js |
| alpine           | ~5 MB       | musl libc + busybox，有 sh 和 apk         | 通用，需调试能力       |
| debian:slim      | ~30 MB      | 最小化 Debian，有 apt                      | 需要 glibc 兼容的应用  |
| ubuntu:minimal   | ~30 MB      | 最小化 Ubuntu                             | 需要 Ubuntu 生态       |
| chainguard       | 2–10 MB     | Wolfi base，默认无 CVE，无 shell           | 安全要求高的生产环境   |

```dockerfile
# ─────────────── scratch 镜像（Go 静态二进制）───────────────
FROM golang:1.22-alpine AS builder
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-w -s" -o app .

FROM scratch
# 仅复制必要文件：CA 证书（HTTPS 需要）+ 时区数据 + 二进制
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=builder /build/app /app
USER 65534:65534
ENTRYPOINT ["/app"]
# 最终镜像 ~8MB，无 shell，无包管理器，极小攻击面

# ─────────────── distroless 镜像（Java）───────────────
FROM eclipse-temurin:21-jdk-jammy AS builder
WORKDIR /build
COPY . .
RUN ./gradlew bootJar --no-daemon

FROM gcr.io/distroless/java21-debian12
COPY --from=builder /build/build/libs/app.jar /app.jar
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app.jar"]
# distroless 没有 sh，docker exec 无法进入 shell（安全优势）

# ─────────────── distroless 镜像（Python）───────────────
FROM python:3.11-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --prefix=/install --no-cache-dir -r requirements.txt

FROM gcr.io/distroless/python3-debian12
COPY --from=builder /install /usr/local
COPY --from=builder /app /app
WORKDIR /app
COPY . .
USER nonroot:nonroot
CMD ["app.py"]

# ─────────────── alpine 镜像（通用，带 shell）───────────────
FROM python:3.11-alpine
# 注意：alpine 使用 musl libc，部分 C 扩展需要额外编译依赖
RUN apk add --no-cache libpq gcc musl-dev
RUN adduser -D -u 1000 appuser
WORKDIR /app
COPY --chown=appuser:appuser requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --chown=appuser:appuser . .
USER appuser
CMD ["python", "app.py"]
```

```bash
# 镜像大小对比（Node.js 应用示例）
$ docker images | grep myapp
# myapp:node-latest      1.1GB
# myapp:node-alpine      180MB
# myapp:node-slim        240MB
# myapp:distroless       95MB
# myapp:multistage       85MB    ← 多阶段 + distroless 最优

# 镜像瘦身工具：dive（分析各层内容）
$ brew install dive
$ dive myapp:latest
# 交互式查看每层文件变化，找出可以优化的层

# 镜像签名（Cosign，供应链安全）
$ cosign sign --key cosign.key myregistry/myapp:latest
$ cosign verify --key cosign.pub myregistry/myapp:latest
```

---

## 5. 常用命令速查

```bash
# ─────────── 镜像操作 ───────────
$ docker pull nginx:1.25-alpine          # 拉取镜像
$ docker build -t myapp:1.0 .            # 构建镜像
$ docker build --no-cache -t myapp .     # 不使用缓存构建
$ docker tag myapp:1.0 registry/myapp:1.0  # 打标签
$ docker push registry/myapp:1.0         # 推送到仓库
$ docker images                          # 列出本地镜像
$ docker image ls --filter dangling=true # 列出悬空镜像
$ docker image prune                     # 清理悬空镜像
$ docker rmi myapp:1.0                   # 删除镜像
$ docker history myapp:1.0              # 查看镜像构建历史
$ docker inspect myapp:1.0              # 查看镜像详情
$ docker save myapp:1.0 | gzip > myapp.tar.gz  # 导出镜像
$ docker load < myapp.tar.gz            # 导入镜像

# ─────────── 容器操作 ───────────
$ docker run -d -p 8080:80 --name web nginx      # 后台运行
$ docker run -it --rm alpine sh                  # 交互式，退出删除
$ docker run -e ENV=prod --env-file .env myapp   # 环境变量
$ docker run -v $(pwd):/app -v /app/node_modules myapp  # 挂载
$ docker ps                                      # 运行中的容器
$ docker ps -a                                   # 所有容器
$ docker stop web && docker rm web               # 停止并删除
$ docker restart web                             # 重启
$ docker logs -f --tail 100 web                  # 跟踪日志
$ docker exec -it web bash                       # 进入容器
$ docker exec -u root web bash                   # 以 root 进入
$ docker cp web:/etc/nginx/nginx.conf .          # 从容器复制文件
$ docker cp ./config.conf web:/etc/nginx/        # 复制到容器
$ docker stats --no-stream                       # 资源使用快照
$ docker top web                                 # 容器内进程列表
$ docker inspect web                             # 容器详细信息
$ docker diff web                                # 文件系统变化

# ─────────── 网络操作 ───────────
$ docker network ls                              # 列出网络
$ docker network create mynet                    # 创建网络
$ docker network connect mynet web               # 连接容器到网络
$ docker network disconnect mynet web            # 断开
$ docker network inspect mynet                   # 网络详情
$ docker network rm mynet                        # 删除网络

# ─────────── 卷操作 ───────────
$ docker volume ls                               # 列出卷
$ docker volume create pgdata                    # 创建卷
$ docker volume inspect pgdata                   # 卷详情
$ docker volume rm pgdata                        # 删除卷
$ docker volume prune                            # 清理未使用卷

# ─────────── 系统维护 ───────────
$ docker system df                               # 磁盘使用
$ docker system prune                            # 清理无用资源
$ docker system info                             # 系统信息
$ docker events                                  # 实时事件流

# ─────────── Docker Compose ───────────
$ docker compose up -d                           # 启动服务
$ docker compose up -d --build                   # 重新构建后启动
$ docker compose down                            # 停止并删除容器
$ docker compose down -v                         # 同时删除卷
$ docker compose ps                              # 服务状态
$ docker compose logs -f app                     # 跟踪服务日志
$ docker compose exec app bash                   # 进入服务容器
$ docker compose run --rm app pytest             # 一次性运行命令
$ docker compose pull                            # 拉取最新镜像
$ docker compose config                          # 验证并查看配置
$ docker compose --profile prod up -d            # 启用 profile
```

---

> **延伸阅读**
> - [Docker 官方文档](https://docs.docker.com)
> - [OCI Spec](https://opencontainers.org)
> - [Trivy 文档](https://trivy.dev)
> - [Distroless 镜像](https://github.com/GoogleContainerTools/distroless)
> - 对应面试题：[Docker 面试题](../../02-面试指南/06-DevOps与云计算面试/01-Docker面试题.md)
