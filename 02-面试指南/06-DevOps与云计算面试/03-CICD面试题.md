# 03-CICD面试题

> CI/CD 与 GitOps 高频面试题，涵盖持续集成/交付/部署核心概念、GitHub Actions 深度用法、GitOps 原则与工具链。

## 相关链接

- 对应技术资料：[CI/CD与GitOps](../../01-技术资料/06-DevOps与云计算/03-CICD与GitOps.md)
- 所属分类：[DevOps与云计算面试](./)

---

## 目录

1. [⭐ 基础题](#基础题)
2. [⭐⭐ 进阶题](#进阶题)
3. [⭐⭐⭐ 高阶题](#高阶题)

---

## 🔥 高频考点速记

> 面试中最常被问到的核心知识点，按出现频率排序。建议优先掌握前 5 项。

| #   | 考点            | 核心要点（一句话）                                     | 出题概率 |
| --- | --------------- | ------------------------------------------------------ | -------- |
| 1   | CI vs CD vs CD  | 持续集成(构建测试)/持续交付(可部署)/持续部署(自动发布) | ★★★★★    |
| 2   | GitHub Actions  | Workflow/Job/Step/Action，矩阵策略                     | ★★★★★    |
| 3   | GitOps 原则     | Git=唯一真实来源，声明式+自动化reconcile               | ★★★★☆    |
| 4   | ArgoCD          | Application CRD，同步策略(手动/自动)，Health检查       | ★★★★☆    |
| 5   | Pipeline 设计   | lint→test→build→deploy，质量门禁                       | ★★★★★    |
| 6   | 镜像安全        | Trivy扫描/cosign签名/SBOM/SLSA供应链安全               | ★★★☆☆    |
| 7   | 蓝绿/金丝雀部署 | 蓝绿(双环境切换)，金丝雀(渐进式流量)                   | ★★★★☆    |
| 8   | OIDC 认证       | 无需存储长期密钥，GitHub Actions→云平台                | ★★★☆☆    |
| 9   | 自托管 Runner   | 敏感环境/GPU构建/自定义硬件                            | ★★★☆☆    |
| 10  | 多环境管理      | Kustomize overlay / Helm values / 分支策略             | ★★★★☆    |

---

## 基础题

### 1. ⭐ CI、CD（持续交付）和 CD（持续部署）有什么区别？

**参考答案：**

| 概念       | 全称                   | 核心区别                                           |
| ---------- | ---------------------- | -------------------------------------------------- |
| CI         | Continuous Integration | 开发者频繁合并代码，每次合并触发自动化构建与测试   |
| CD（交付） | Continuous Delivery    | 代码可随时部署到生产环境，但**需人工审批**触发部署 |
| CD（部署） | Continuous Deployment  | 通过所有测试后**自动部署**到生产环境，无需人工干预 |

**关键知识点：**

- CI 解决"集成地狱"问题，频繁小批量合并 > 低频大批量合并
- 持续交付强调"随时可部署"能力，而非一定部署
- 持续部署要求完整的自动化测试覆盖和监控回滚能力

**延伸：** 大多数团队实践持续交付而非持续部署，生产发布仍需人工决策。

---

### 2. ⭐ GitHub Actions 中 Workflow、Job、Step、Action 的关系是什么？

**参考答案：**

```
Workflow（.github/workflows/xxx.yml）
└── Job（runs-on: ubuntu-latest）
    ├── Step 1（uses: actions/checkout@v4）
    ├── Step 2（run: npm test）
    └── Step 3（uses: docker/build-push-action@v5）
```

| 概念     | 说明                                                        |
| -------- | ----------------------------------------------------------- |
| Workflow | 由事件触发的自动化流程，对应一个 YAML 文件                  |
| Job      | Workflow 中的独立执行单元，运行在独立的 Runner 上，默认并行 |
| Step     | Job 中的顺序执行步骤，共享同一 Runner 环境和文件系统        |
| Action   | 可复用的 Step 逻辑，可来自 Marketplace 或本地               |

**关键知识点：**

- Job 之间默认并行，用 `needs` 声明依赖后串行
- Step 之间共享工作目录和环境变量
- Action 是最小复用单元，分为 Docker/JavaScript/Composite 三种类型

---

### 3. ⭐ 什么是 Pipeline 设计原则？

**参考答案：**

**核心原则（FIRST）：**

1. **Fast（快速）**：快速反馈，失败提前暴露；单元测试 < 集成测试 < E2E 测试
2. **Isolated（隔离）**：每次运行环境一致，避免"在我机器上没问题"
3. **Repeatable（可重复）**：相同输入始终产生相同输出（幂等性）
4. **Self-validating（自验证）**：明确的通过/失败信号，无需人工判断
5. **Timely（及时）**：在代码提交后立即触发，延迟反馈失去价值

**流水线阶段划分：**

```
代码提交 → Lint/格式检查(30s) → 单元测试(2min) → 构建(3min) → 集成测试(5min) → 安全扫描 → 部署
```

---

### 4. ⭐ GitHub Actions 如何管理 Secrets？

**参考答案：**

**三个层级：**

```
Organization Secrets  → 跨仓库共享
Repository Secrets    → 单仓库使用
Environment Secrets   → 特定环境（staging/production）使用，可配置 reviewer 审批
```

**使用方式：**

```yaml
steps:
  - name: Deploy
    env:
      API_KEY: ${{ secrets.API_KEY }}
    run: deploy.sh
```

**安全特性：**

- Secrets 值在日志中自动被 `***` 掩码
- Fork PR 无法访问父仓库 Secrets（防止恶意 PR 窃取密钥）
- 推荐结合 OIDC 完全消除静态密钥

---

### 5. ⭐ 什么是 GitOps？核心原则是什么？

**参考答案：**

GitOps 是以 Git 作为**声明式基础设施**唯一可信来源的运维模式。

**四大原则（Weaveworks 定义）：**

1. **声明式（Declarative）**：系统期望状态以声明方式存储（Kubernetes YAML）
2. **版本化且不可变（Versioned & Immutable）**：所有变更通过 Git 提交，历史可追溯
3. **自动拉取（Pulled Automatically）**：Agent 主动拉取 Git 变更，而非 CI 推送
4. **持续调谐（Continuously Reconciled）**：Agent 持续比较实际状态与期望状态并修正漂移

**Pull vs Push 模型：**

```
Push（传统 CI/CD）：CI Pipeline → kubectl apply → 集群
Pull（GitOps）：   Git → ArgoCD/Flux 检测变更 → 自动同步到集群
```

---

### 6. ⭐ 什么是 ArgoCD？它解决了什么问题？

**参考答案：**

ArgoCD 是声明式 GitOps CD 工具，运行在 Kubernetes 集群内，持续监控 Git 仓库并将集群状态同步到期望状态。

**核心解决问题：**

- 传统 CI/CD 需要 CI 服务器拥有 kubectl 访问权限（安全风险）
- 配置漂移（Config Drift）：有人手动 kubectl apply 导致实际状态与 Git 不一致
- 缺乏可见性：无法直观看到集群实际状态与期望状态的差异

**ArgoCD 核心概念：**

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
spec:
  source:
    repoURL: https://github.com/org/gitops-repo
    path: apps/my-app
    targetRevision: main
  destination:
    server: https://kubernetes.default.svc
    namespace: production
  syncPolicy:
    automated:
      prune: true # 删除 Git 中已移除的资源
      selfHeal: true # 修复手动修改导致的漂移
```

---

### 7. ⭐ 如何在 GitHub Actions 中构建和推送 Docker 镜像？

**参考答案：**

```yaml
name: Build and Push Docker Image
on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and Push
        uses: docker/build-push-action@v5
        with:
          push: true
          tags: ghcr.io/${{ github.repository }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

**关键点：** 使用 `docker/setup-buildx-action` 启用 BuildKit，`cache-from/cache-to: type=gha` 利用 GitHub Actions Cache 加速构建。

---

## 进阶题

### 8. ⭐⭐ GitHub Actions 的矩阵策略（Matrix Strategy）如何使用？

**参考答案：**

矩阵策略允许用一份 Job 配置并行运行多个变体：

```yaml
jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
        node: [18, 20, 22]
        exclude:
          - os: windows-latest
            node: 22 # 排除特定组合
      fail-fast: false # 一个失败不取消其他
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - run: npm test
```

**动态矩阵（从脚本生成）：**

```yaml
jobs:
  prepare:
    outputs:
      matrix: ${{ steps.set-matrix.outputs.matrix }}
    steps:
      - id: set-matrix
        run: echo "matrix=$(cat matrix.json)" >> $GITHUB_OUTPUT

  build:
    needs: prepare
    strategy:
      matrix: ${{ fromJson(needs.prepare.outputs.matrix) }}
```

**关键知识点：** 矩阵组合数 = 各维度值数量之积，`exclude` 减少组合，`include` 添加额外组合。

---

### 9. ⭐⭐ 什么是可重用工作流（Reusable Workflow）？与复合 Action 有何区别？

**参考答案：**

**可重用工作流（Reusable Workflow）：**

```yaml
# .github/workflows/reusable-deploy.yml
on:
  workflow_call:
    inputs:
      environment:
        required: true
        type: string
    secrets:
      DEPLOY_KEY:
        required: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}
    steps:
      - run: deploy.sh
        env:
          DEPLOY_KEY: ${{ secrets.DEPLOY_KEY }}
```

```yaml
# 调用方
jobs:
  deploy-prod:
    uses: org/repo/.github/workflows/reusable-deploy.yml@main
    with:
      environment: production
    secrets:
      DEPLOY_KEY: ${{ secrets.DEPLOY_KEY }}
```

**对比：**

| 特性                | 可重用工作流      | 复合 Action  |
| ------------------- | ----------------- | ------------ |
| 可以有多个 Job      | ✅                | ❌（单 Job） |
| 可使用 Secrets      | ✅（需显式传递）  | ❌           |
| 跨仓库使用          | ✅                | ✅           |
| 在调用者 Job 中执行 | ❌（独立 Runner） | ✅           |
| 访问调用者文件系统  | ❌                | ✅           |

---

### 10. ⭐⭐ 解释 GitHub Actions 的 OIDC 认证原理，为什么比静态密钥更安全？

**参考答案：**

**传统方式（静态密钥）：**

```
GitHub Actions → 使用 AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY 访问 AWS
问题：密钥长期有效，泄露后攻击者可持续访问
```

**OIDC 方式（动态临时凭证）：**

```
1. GitHub Actions 向 GitHub OIDC Provider 请求 JWT Token（包含 repo/workflow/ref 等声明）
2. 将 JWT 发送给 AWS STS AssumeRoleWithWebIdentity
3. AWS 验证 JWT 签名（公钥来自 GitHub OIDC Discovery URL）
4. AWS 返回 15 分钟有效的临时 STS 凭证
5. 使用临时凭证访问 AWS 资源
```

```yaml
# GitHub Actions OIDC 配置
permissions:
  id-token: write # 必须授予此权限
  contents: read

steps:
  - uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: arn:aws:iam::123456789:role/github-actions-role
      aws-region: us-east-1
      # 无需传入任何静态密钥！
```

**安全优势：**

- 凭证生命周期 ≤ 1小时，泄露影响面极小
- 可通过 IAM 条件限制只有特定 repo/branch/env 才能 assume role
- 消除 Secrets 轮换负担

---

### 11. ⭐⭐ ArgoCD 的 App of Apps 模式是什么？

**参考答案：**

App of Apps 是 ArgoCD 管理多应用的最佳实践：创建一个"根应用"，其 Git 路径下存放多个子 Application 的 YAML，ArgoCD 自动同步这些子 Application。

```
Git 仓库结构：
apps/
├── root-app.yaml          # 根应用，指向 apps/ 目录
├── frontend.yaml          # 子应用
├── backend.yaml           # 子应用
└── database.yaml          # 子应用
```

```yaml
# root-app.yaml（根应用）
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: root-app
spec:
  source:
    path: apps # 指向包含所有子 Application YAML 的目录
    repoURL: https://github.com/org/gitops-repo
  destination:
    server: https://kubernetes.default.svc
    namespace: argocd
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

**优势：** 单点管理所有应用，新增应用只需提交 Application YAML 到 Git，无需手动操作 ArgoCD UI。

---

### 12. ⭐⭐ 如何实现多架构（amd64/arm64）Docker 镜像构建？

**参考答案：**

```yaml
steps:
  - name: Set up QEMU
    uses: docker/setup-qemu-action@v3
    # QEMU 模拟 arm64 指令集（较慢）

  - name: Set up Docker Buildx
    uses: docker/setup-buildx-action@v3
    # Buildx 创建支持多平台的 Builder

  - name: Build multi-arch image
    uses: docker/build-push-action@v5
    with:
      platforms: linux/amd64,linux/arm64
      push: true
      tags: myapp:latest
```

**两种多架构构建策略：**

| 策略        | 原理                       | 速度        | 适用场景               |
| ----------- | -------------------------- | ----------- | ---------------------- |
| QEMU 模拟   | 用软件模拟目标 CPU         | 慢（5-10x） | 小项目 / 无原生 Runner |
| 原生 Runner | 在对应架构的 Runner 上构建 | 快          | 大型项目 / 追求速度    |

**原生 Runner 策略（推荐）：**

```yaml
jobs:
  build:
    strategy:
      matrix:
        include:
          - platform: linux/amd64
            runs-on: ubuntu-latest
          - platform: linux/arm64
            runs-on: ubuntu-24.04-arm # GitHub 原生 ARM Runner
    steps:
      - name: Build single-arch image
        uses: docker/build-push-action@v5
        with:
          platforms: ${{ matrix.platform }}
          outputs: type=image,push-by-digest=true

  merge:
    needs: build
    steps:
      - name: Create and push manifest
        uses: docker/build-push-action@v5
        with:
          push: true
          tags: myapp:latest
```

---

### 13. ⭐⭐ 如何设计一个高效的 CI/CD 流水线来最小化反馈时间？

**参考答案：**

**分层并行策略：**

```
提交触发
  ↓
Layer 1（并行，30s）：Lint + 格式检查 + 类型检查
  ↓（全部通过）
Layer 2（并行，2min）：单元测试（按模块分片） + 安全依赖扫描
  ↓（全部通过）
Layer 3（3min）：Docker 镜像构建（利用缓存）
  ↓
Layer 4（并行，5min）：集成测试 + Staging 部署
  ↓
Layer 5（手动审批）：Production 部署
```

**关键优化手段：**

1. **测试分片**：将测试套件分成 N 份并行运行
2. **缓存复用**：npm/pip 依赖缓存 + Docker Layer 缓存
3. **增量测试**：只测试变更影响的模块（`nx affected`）
4. **快速失败**：Lint 失败立即停止，不等耗时测试
5. **条件跳过**：文档变更跳过测试流水线

---

### 14. ⭐⭐ Flux CD 与 ArgoCD 有何区别？如何选择？

**参考答案：**

| 维度           | ArgoCD                   | Flux CD                        |
| -------------- | ------------------------ | ------------------------------ |
| UI             | 功能丰富的 Web UI        | 无内置 UI（可用 Weave GitOps） |
| 多租户         | AppProject 隔离          | 命名空间级别隔离               |
| 多集群         | 中心化管理多集群         | Hub-Spoke 或每集群独立部署     |
| Helm 支持      | 原生支持                 | HelmRelease CRD                |
| Kustomize 支持 | 原生支持                 | Kustomization CRD              |
| 通知集成       | notifications-controller | alert-provider                 |
| CNCF 毕业状态  | 已毕业                   | 已毕业                         |
| 学习曲线       | 较平缓（UI 辅助）        | 较陡（纯 CRD）                 |

**选择建议：**

- 需要可视化 Dashboard → ArgoCD
- 偏好纯 GitOps / 无 UI → Flux
- 企业多团队多集群 → ArgoCD（AppProject 隔离更成熟）
- 喜欢 Kubernetes 原生 CRD 风格 → Flux

---

## 高阶题

### 15. ⭐⭐⭐ 解释 OIDC Token 的 JWT 结构，GitHub 如何保证其不被伪造？

**参考答案：**

GitHub Actions OIDC Token 是一个 JWT，结构为 `header.payload.signature`：

**Payload 示例：**

```json
{
  "jti": "example-id",
  "sub": "repo:org/repo:ref:refs/heads/main",
  "aud": "https://github.com/org",
  "ref": "refs/heads/main",
  "sha": "abc123",
  "repository": "org/repo",
  "repository_owner": "org",
  "workflow": "deploy",
  "job_workflow_ref": "org/repo/.github/workflows/deploy.yml@refs/heads/main",
  "runner_environment": "github-hosted",
  "iat": 1735000000,
  "exp": 1735000900 // 15分钟后过期
}
```

**防伪造机制：**

1. **非对称签名**：GitHub 使用私钥（RS256）对 JWT 签名，公钥发布在 `https://token.actions.githubusercontent.com/.well-known/jwks`
2. **AWS/Azure 验证**：云厂商从 JWKS 获取公钥，验证签名 → 无法伪造
3. **Audience 限制**：Token 的 `aud` 字段绑定到特定 IAM Role 的信任策略
4. **短过期时间**：15分钟 TTL，过期后即使泄露也无法使用
5. **IAM 条件约束**：

```json
{
  "Condition": {
    "StringLike": {
      "token.actions.githubusercontent.com:sub": "repo:org/repo:ref:refs/heads/main"
    }
  }
}
```

只有来自 `org/repo` 的 `main` 分支的 Workflow 才能 Assume Role。

---

### 16. ⭐⭐⭐ 镜像签名与供应链安全（cosign + SLSA）如何工作？

**参考答案：**

**软件供应链攻击威胁：**

- SolarWinds 攻击：恶意代码注入构建系统
- 攻击者替换 Docker Hub 上的官方镜像
- 依赖投毒（Dependency Confusion）

**cosign Keyless 签名流程：**

```
1. CI 运行时向 Fulcio CA 请求短期证书（基于 OIDC Token 身份验证）
2. Fulcio 颁发包含 CI 身份信息的 X.509 证书（工作流 URL）
3. cosign 使用短期私钥对镜像 digest 签名
4. 签名和证书存入 Rekor 透明日志（不可篡改）
5. 私钥立即丢弃，无需密钥管理！
```

```yaml
# CI 签名步骤
- name: Sign image with cosign
  uses: sigstore/cosign-installer@v3

- run: |
    cosign sign \
      --yes \
      ghcr.io/org/app@${{ steps.build.outputs.digest }}
  env:
    COSIGN_EXPERIMENTAL: "true" # 启用 Keyless

# 验证签名
- run: |
    cosign verify \
      --certificate-identity-regexp="https://github.com/org/repo/.github/workflows/.*" \
      --certificate-oidc-issuer="https://token.actions.githubusercontent.com" \
      ghcr.io/org/app:latest
```

**SLSA（Supply chain Levels for Software Artifacts）级别：**
| 级别 | 要求 |
|------|------|
| SLSA 1 | 构建过程文档化，生成 Provenance |
| SLSA 2 | 使用版本控制 + 托管构建服务 |
| SLSA 3 | 硬化构建平台，不可篡改 Provenance |
| SLSA 4 | 两人审查 + 封闭可重现构建 |

---

### 17. ⭐⭐⭐ 如何设计大规模 GitOps 架构以支持 100+ 个微服务、10+ 个集群？

**参考答案：**

**仓库结构设计：**

```
gitops-repo/
├── clusters/
│   ├── prod-us-east-1/
│   │   ├── cluster-config.yaml   # 集群级配置（监控/网络/安全策略）
│   │   └── apps/                 # 该集群部署的应用
│   ├── prod-eu-west-1/
│   └── staging/
├── apps/
│   ├── base/                     # Kustomize base，所有环境共享
│   │   └── my-service/
│   │       ├── deployment.yaml
│   │       └── kustomization.yaml
│   └── overlays/
│       ├── staging/              # Staging 环境差异配置
│       └── production/           # 生产环境差异配置
└── charts/                       # Helm Charts
```

**ArgoCD ApplicationSet 批量管理：**

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: all-services
spec:
  generators:
    - matrix:
        generators:
          - git:
              repoURL: https://github.com/org/gitops-repo
              directories:
                - path: apps/overlays/production/*
          - clusters:
              selector:
                matchLabels:
                  region: us-east-1
  template:
    spec:
      source:
        path: "{{path}}"
      destination:
        server: "{{server}}"
```

**关键设计决策：**

1. **单一仓库 vs 多仓库**：应用代码与配置分离，配置可按团队/环境分仓库
2. **推广策略**：镜像 tag 更新通过 PR 自动提交（image-updater），人工审批合并到 prod
3. **Secret 管理**：Git 中不存储明文 Secret，使用 External Secrets Operator 从 Vault/AWS SSM 拉取
4. **多集群 RBAC**：每个团队只能管理自己 namespace 的 Application（AppProject 限制）
5. **Sync Wave**：控制同步顺序（CRD → Namespace → 基础设施 → 应用）

---

### 18. ⭐⭐⭐ 如何实现零停机的渐进式交付（Progressive Delivery）？

**参考答案：**

**工具选型：Argo Rollouts**

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: my-service
spec:
  replicas: 10
  strategy:
    canary:
      steps:
        - setWeight: 5 # 5% 流量到新版本
        - pause: { duration: 5m } # 等待 5 分钟观察指标
        - setWeight: 20 # 20% 流量
        - pause: {} # 无限期暂停，等待人工审批
        - setWeight: 50
        - pause: { duration: 10m }
        - setWeight: 100 # 全量切换
      analysis:
        templates:
          - templateName: success-rate
        args:
          - name: service-name
            value: my-service
---
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: success-rate
spec:
  metrics:
    - name: success-rate
      interval: 1m
      successCondition: "result[0] >= 0.95" # 成功率 >= 95%
      failureLimit: 3
      provider:
        prometheus:
          address: http://prometheus:9090
          query: |
            sum(rate(http_requests_total{status!~"5..",app="{{args.service-name}}"}[5m]))
            /
            sum(rate(http_requests_total{app="{{args.service-name}}"}[5m]))
```

**自动回滚机制：**

- 如果 AnalysisRun 中指标超过 `failureLimit`，Rollout 自动回滚
- 与 ArgoCD 集成：ArgoCD 检测到 Rollout 回滚时标记 App 为 Degraded

**蓝绿部署（Blue-Green）：**

```yaml
strategy:
  blueGreen:
    activeService: my-service-active
    previewService: my-service-preview
    autoPromotionEnabled: false # 需人工审批
    scaleDownDelaySeconds: 600 # 旧版本保留 10 分钟用于回滚
```

---

### 19. ⭐⭐⭐ 分析一个 GitHub Actions Workflow 性能优化案例

**参考答案：**

**原始 Workflow（慢，15 分钟）：**

```yaml
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci # 每次重新安装，3 分钟
      - run: npm run lint
      - run: npm run test # 全量测试，8 分钟
      - run: npm run build # Docker 构建，4 分钟，无缓存
```

**优化后 Workflow（快，4 分钟）：**

```yaml
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/cache@v4
        with:
          path: ~/.npm
          key: npm-${{ hashFiles('**/package-lock.json') }}
      - run: npm ci
      - run: npm run lint

  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        shard: [1, 2, 3, 4] # 4 个并行分片
    steps:
      - uses: actions/checkout@v4
      - uses: actions/cache@v4
        with:
          path: ~/.npm
          key: npm-${{ hashFiles('**/package-lock.json') }}
      - run: npm ci
      - run: npm run test -- --shard=${{ matrix.shard }}/4 # 分片测试

  build:
    needs: [lint, test]
    runs-on: ubuntu-latest
    steps:
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v5
        with:
          cache-from: type=gha # GitHub Actions Cache
          cache-to: type=gha,mode=max
```

**优化效果分析：**
| 优化点 | 原来 | 优化后 | 提升 |
|-------|------|-------|------|
| npm install | 3min | 10s（缓存命中） | 18x |
| 测试并行化 | 8min | 2min（4分片） | 4x |
| Docker 构建缓存 | 4min | 40s | 6x |
| 总耗时（串行→并行） | 15min | 4min | 3.75x |

---

### 20. ⭐⭐⭐ 解释 GitOps 中配置漂移（Config Drift）检测与自动修复机制

**参考答案：**

**配置漂移的来源：**

1. 工程师直接 `kubectl patch/edit` 修改了生产资源（紧急修复）
2. 集群自动伸缩修改了 `replicas`
3. 运行时 Admission Webhook 注入了额外字段
4. 存储系统或 Operator 更新了状态字段

**ArgoCD 漂移检测原理：**

```
每隔 3 分钟（默认）或 Git 推送 Webhook 触发：
1. 从 Git 获取期望状态（YAML/Helm/Kustomize 渲染结果）
2. 从 K8s API Server 获取实际状态（managed fields）
3. 对比两者差异 → 生成 diff
4. 如果 selfHeal=true → 自动执行 kubectl apply 覆盖漂移
5. 发送通知到 Slack/PagerDuty
```

**平衡自动修复与运维灵活性：**

```yaml
syncPolicy:
  automated:
    selfHeal: true # 自动修复漂移
    prune: true # 删除 Git 中不存在的资源
  syncOptions:
    - RespectIgnoreDifferences=true # 忽略指定字段的漂移

ignoreDifferences:
  - group: apps
    kind: Deployment
    jsonPointers:
      - /spec/replicas # HPA 管理 replicas，忽略此字段漂移
  - group: ""
    kind: ConfigMap
    name: kube-proxy
    namespace: kube-system
    jsonPointers:
      - /data # 系统 ConfigMap，忽略内容漂移
```

**最佳实践：** 对 HPA 管理的 `replicas` 字段设置 `ignoreDifferences`，避免 ArgoCD 与 HPA 相互覆盖。

---

### 21. ⭐⭐⭐ 如何构建满足 SOC2/ISO27001 审计要求的 CI/CD 合规流水线？

**参考答案：**

**合规 CI/CD 的核心要求：**

1. **访问控制与职责分离（Separation of Duties）：**

```yaml
# GitHub Branch Protection Rules（通过 API/Terraform 配置）
branch_protection:
  required_reviews: 2 # 至少 2 个审批
  require_code_owner_reviews: true
  dismiss_stale_reviews: true # 新提交后旧审批失效
  restrict_pushes: # 禁止直接推送到 main
    - role: admin
  required_status_checks:
    - "ci/security-scan"
    - "ci/tests"
```

2. **不可变构建（Immutable Builds）：**

```yaml
# 使用 Git SHA 而非 latest tag
image: myapp@sha256:abc123... # 固定 digest，不用 :latest
```

3. **审计日志（Audit Trail）：**

- 所有部署通过 ArgoCD（有完整的 sync history）
- 镜像 digest 追溯到具体 Git commit（通过 cosign attestation）
- GitHub Actions 日志保留 90 天（可导出到 S3）

4. **安全扫描门禁：**

```yaml
- name: SAST Scan
  uses: github/codeql-action/analyze@v3

- name: Container Scan
  uses: aquasecurity/trivy-action@master
  with:
    exit-code: "1" # 发现 HIGH/CRITICAL 漏洞则失败
    severity: "HIGH,CRITICAL"

- name: Secret Detection
  uses: trufflesecurity/trufflehog@main
```

5. **变更审批流程：**

```
开发者 PR → Code Review（≥2 人）→ CI 通过 → Security 审批
→ 合并到 main → ArgoCD 自动同步 Staging
→ 人工测试验证 → Product Owner 审批 → ArgoCD 手动同步 Production
```

每一步都有 GitHub Events 记录，满足"变更管理流程"的审计要求。

---

## 延伸阅读

- [GitHub Actions 官方文档](https://docs.github.com/en/actions)
- [ArgoCD 官方文档](https://argo-cd.readthedocs.io/)
- [Flux CD 官方文档](https://fluxcd.io/docs/)
- [OpenGitOps 规范](https://opengitops.dev/)
- [cosign 与 Sigstore](https://docs.sigstore.dev/)
- [SLSA 供应链安全框架](https://slsa.dev/)
- [DORA Metrics（DevOps 四大指标）](https://dora.dev/devops-capabilities/)
