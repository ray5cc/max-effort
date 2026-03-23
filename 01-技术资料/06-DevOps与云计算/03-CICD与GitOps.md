# 03-CICD与GitOps

> CI/CD（持续集成/持续交付/持续部署）与 GitOps 是现代软件交付的核心实践，
> 通过自动化流水线和 Git 驱动的声明式运维，实现快速、可靠、可追溯的软件发布。

## 相关链接

- 对应面试题：[CI/CD 面试题](../../02-面试指南/06-DevOps与云计算面试/03-CICD面试题.md)
- 上一篇：[Kubernetes 核心技术](./02-Kubernetes核心技术.md)
- [DevOps 与云计算总目录](./)

---

## 目录

1. [CI/CD 核心概念](#1-cicd-核心概念)
   - 1.1 [三者的区别](#11-持续集成--持续交付--持续部署的区别)
   - 1.2 [Pipeline 设计原则](#12-pipeline-设计原则)
   - 1.3 [代码质量门禁](#13-代码质量门禁)
2. [GitHub Actions 深度解析](#2-github-actions-深度解析)
   - 2.1 [核心概念](#21-核心概念workflow--job--step--action)
   - 2.2 [矩阵策略](#22-矩阵策略matrix-strategy)
   - 2.3 [复合 Action 与可重用工作流](#23-复合-action-与可重用工作流)
   - 2.4 [自托管 Runner](#24-自托管-runner)
   - 2.5 [Secrets / Environments / OIDC](#25-secrets--environments--oidc-认证)
   - 2.6 [完整实战 Workflow](#26-完整实战-workflow)
3. [GitOps 模式](#3-gitops-模式)
   - 3.1 [GitOps 四大原则](#31-gitops-四大原则)
   - 3.2 [ArgoCD 架构详解](#32-argocd-架构详解)
   - 3.3 [Flux CD 核心概念](#33-flux-cd-核心概念)
   - 3.4 [GitOps vs 传统 CI/CD](#34-gitops-vs-传统-cicd)
4. [容器镜像 CI/CD](#4-容器镜像-cicd)
   - 4.1 [多架构镜像构建](#41-多架构镜像构建)
   - 4.2 [镜像仓库对比](#42-镜像仓库对比)
   - 4.3 [镜像签名与验证](#43-镜像签名与验证)

---

## 1. CI/CD 核心概念

### 1.1 持续集成 / 持续交付 / 持续部署的区别

三个概念递进叠加，自动化程度逐步提升：

```diagram
开发者提交代码
      │
      ▼
┌─────────────────────────────────────────────────────────┐
│  持续集成 (CI — Continuous Integration)                  │
│                                                         │
│  代码合并 → 自动构建 → 自动测试 → 质量检查               │
│  目标：快速发现集成问题，保持主干可构建                   │
└─────────────────────────────────────────────────────────┘
      │  CI 通过
      ▼
┌─────────────────────────────────────────────────────────┐
│  持续交付 (CD — Continuous Delivery)                     │
│                                                         │
│  制品打包 → 部署到 Staging → 验收测试 → 等待人工审批      │
│  目标：随时保持软件处于可发布状态（发布是手动触发的）     │
└─────────────────────────────────────────────────────────┘
      │  人工审批（可选）
      ▼
┌─────────────────────────────────────────────────────────┐
│  持续部署 (CD — Continuous Deployment)                   │
│                                                         │
│  自动部署到生产 → 监控告警 → 自动回滚                    │
│  目标：全自动，代码合并即上线                            │
└─────────────────────────────────────────────────────────┘
```

| 维度 | 持续集成 (CI) | 持续交付 (Delivery) | 持续部署 (Deployment) |
|------|--------------|--------------------|-----------------------|
| 自动化范围 | 构建 + 测试 | CI + 发布准备 | CI + CD + 生产部署 |
| 生产部署触发 | 手动 | 手动审批 | 全自动 |
| 发布频率 | 每次提交 | 随时可发布 | 每次提交即上线 |
| 风险控制 | 测试覆盖 | 审批流程 | 监控 + 自动回滚 |
| 适用场景 | 所有团队 | 多数团队 | 高度成熟团队 |

**典型流水线全景图：**

```diagram
  Git Push
     │
     ▼
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  Source   │───▶│  Build   │───▶│  Test    │───▶│  Scan    │
│  Control  │    │  & Lint  │    │  Suite   │    │ Security │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
                                                      │
                                                      ▼
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ Production│◀───│  Stage   │◀───│  Build   │◀───│ Artifact │
│  Deploy  │    │  Deploy  │    │  Image   │    │  Store   │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
     │
     ▼
┌──────────┐
│ Monitor  │
│ & Alert  │
└──────────┘
```

---

### 1.2 Pipeline 设计原则

**快速反馈（Fast Feedback）**

- 将最快速的检查放在流水线最前面（lint < unit test < integration test < e2e test）
- 单次 CI 耗时目标：< 10 分钟（绿色通道），< 30 分钟（完整流程）
- 失败快速失败（fail fast），避免浪费后续资源

```
执行顺序（按耗时升序排列）:
  静态分析（30s）→ 单元测试（2min）→ 集成测试（5min）→ E2E（15min）
```

**可重复（Reproducible）**

- 使用固定版本的依赖（lock 文件：package-lock.json / poetry.lock / go.sum）
- 构建环境容器化，避免"在我机器上能跑"
- 相同的输入必须产生相同的输出（Hermetic Builds）
- 使用内容哈希而非 `latest` 标签引用依赖

**可回滚（Rollback-Ready）**

- 每个部署制品保留版本标识（Git commit SHA / semver）
- 支持一键回滚到任意历史版本
- 数据库变更使用向前兼容迁移（先扩展，后收缩）
- 蓝绿部署 / 金丝雀发布保留旧版本流量路径

---

### 1.3 代码质量门禁

质量门禁（Quality Gate）是 Pipeline 中阻止低质量代码进入下游的卡点：

```diagram
代码提交
   │
   ├─▶ [Lint] ESLint / golangci-lint / Ruff
   │         ↓ 不通过则阻断
   │
   ├─▶ [Format] Prettier / gofmt / Black
   │         ↓ 不通过则阻断
   │
   ├─▶ [Unit Test] Jest / pytest / go test
   │         ↓ 覆盖率 < 80% 则阻断
   │
   ├─▶ [Security Scan]
   │    ├── SAST: Semgrep / CodeQL / SonarQube
   │    ├── Dependency: Dependabot / Snyk / Trivy
   │    └── Secret Scan: gitleaks / trufflehog
   │         ↓ 高危漏洞则阻断
   │
   └─▶ [Coverage Report] 上传到 Codecov / SonarCloud
```

**常用工具速览：**

| 类型 | 工具 | 语言/生态 | 说明 |
|------|------|----------|------|
| Lint | ESLint | JavaScript/TypeScript | 语法与风格检查 |
| Lint | golangci-lint | Go | 聚合多种 Go linter |
| Lint | Ruff | Python | 极速 Python linter（Rust 实现） |
| 格式化 | Prettier | JS/TS/CSS/Markdown | 统一代码风格 |
| 单元测试 | Jest / Vitest | JavaScript/TypeScript | 前端测试框架 |
| 单元测试 | pytest | Python | Python 测试框架 |
| SAST | CodeQL | 多语言 | GitHub 原生静态分析 |
| SAST | Semgrep | 多语言 | 规则驱动的静态分析 |
| 依赖扫描 | Trivy | 容器/代码 | 镜像与依赖漏洞扫描 |
| Secret 扫描 | gitleaks | Git 历史 | 检测泄露的密钥 |
| 覆盖率 | Codecov | 多语言 | 覆盖率可视化与趋势 |

---

## 2. GitHub Actions 深度解析

### 2.1 核心概念：Workflow / Job / Step / Action

```diagram
Workflow（.github/workflows/ci.yml）
  │
  ├── 触发器（on: push / pull_request / schedule / workflow_dispatch）
  │
  ├── Job A（runs-on: ubuntu-latest）
  │     ├── Step 1: actions/checkout@v4        ← Action（社区/官方）
  │     ├── Step 2: run: npm install            ← Shell 命令
  │     └── Step 3: run: npm test
  │
  └── Job B（depends on Job A via needs:）
        ├── Step 1: 下载 Job A 产生的 Artifact
        └── Step 2: 部署
```

**层次关系说明：**

| 层次 | 说明 | 运行环境 |
|------|------|---------|
| Workflow | 完整的自动化流程，由 YAML 文件定义 | — |
| Job | 工作流中的独立任务单元，默认并行 | 独立虚拟机/容器 |
| Step | Job 中的顺序执行步骤 | 共享同一虚拟机 |
| Action | 可复用的步骤模块（来自 Marketplace 或本地） | 当前 Step 内 |

**最小可运行 Workflow 示例：**

```yaml
# .github/workflows/hello.yml
name: Hello World

on:
  push:
    branches: [main]
  pull_request:

jobs:
  greet:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Say Hello
        run: echo "Hello, ${{ github.actor }}!"

      - name: Show Context
        run: |
          echo "Branch: ${{ github.ref_name }}"
          echo "Commit: ${{ github.sha }}"
          echo "Event:  ${{ github.event_name }}"
```

---

### 2.2 矩阵策略（Matrix Strategy）

矩阵策略允许用一个 Job 定义，自动展开为多个并行任务：

```yaml
# 测试多版本 Node.js + 多操作系统的组合
jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false          # 某个矩阵失败不立即取消其他
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
        node: [18, 20, 22]
        exclude:
          - os: windows-latest
            node: 18            # 排除特定组合
        include:
          - os: ubuntu-latest
            node: 22
            experimental: true  # 为特定组合附加变量

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js ${{ matrix.node }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: npm

      - run: npm ci
      - run: npm test

      - name: Upload Coverage（仅 Ubuntu + Node 20）
        if: matrix.os == 'ubuntu-latest' && matrix.node == 20
        uses: codecov/codecov-action@v4
```

**动态矩阵（从 JSON 生成）：**

```yaml
jobs:
  # Job 1：生成矩阵配置
  setup:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.gen.outputs.matrix }}
    steps:
      - id: gen
        run: |
          echo 'matrix={"service":["api","worker","scheduler"]}' >> $GITHUB_OUTPUT

  # Job 2：使用动态矩阵
  build:
    needs: setup
    runs-on: ubuntu-latest
    strategy:
      matrix: ${{ fromJson(needs.setup.outputs.matrix) }}
    steps:
      - run: echo "Building ${{ matrix.service }}"
```

---

### 2.3 复合 Action 与可重用工作流

**复合 Action（Composite Action）**：将多个步骤封装为可复用模块。

```yaml
# .github/actions/setup-node-project/action.yml
name: Setup Node Project
description: 安装依赖并配置 Node.js 环境

inputs:
  node-version:
    description: Node.js 版本
    default: '20'
  working-directory:
    description: 工作目录
    default: '.'

outputs:
  cache-hit:
    description: 是否命中缓存
    value: ${{ steps.cache.outputs.cache-hit }}

runs:
  using: composite
  steps:
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: ${{ inputs.node-version }}
        cache: npm
        cache-dependency-path: ${{ inputs.working-directory }}/package-lock.json

    - name: Install Dependencies
      shell: bash
      working-directory: ${{ inputs.working-directory }}
      run: npm ci --prefer-offline
```

**调用复合 Action：**

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: ./.github/actions/setup-node-project
    with:
      node-version: '20'
```

**可重用工作流（Reusable Workflow）**：更大粒度的复用，可跨仓库调用。

```yaml
# .github/workflows/reusable-deploy.yml
name: Reusable Deploy

on:
  workflow_call:                 # 声明为可调用工作流
    inputs:
      environment:
        required: true
        type: string
      image-tag:
        required: true
        type: string
    secrets:
      deploy-key:
        required: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}
    steps:
      - name: Deploy to ${{ inputs.environment }}
        run: |
          echo "Deploying ${{ inputs.image-tag }} to ${{ inputs.environment }}"
        env:
          DEPLOY_KEY: ${{ secrets.deploy-key }}
```

**调用可重用工作流：**

```yaml
jobs:
  deploy-staging:
    uses: ./.github/workflows/reusable-deploy.yml
    with:
      environment: staging
      image-tag: ${{ needs.build.outputs.image-tag }}
    secrets:
      deploy-key: ${{ secrets.STAGING_DEPLOY_KEY }}
```

---

### 2.4 自托管 Runner

自托管 Runner 适用于以下场景：

- 需要访问内网资源（数据库、私有 Registry）
- 需要特殊硬件（GPU、ARM）
- 对构建速度要求高（本地缓存）
- 安全合规要求（代码不出内网）

```diagram
GitHub Actions 服务
        │
        │  HTTPS 长轮询
        ▼
┌──────────────────┐
│  Self-hosted     │
│  Runner          │
│                  │
│  runner service  │──▶  执行 Job
│  (runs-on: self- │
│   hosted)        │
└──────────────────┘
     内网环境
        │
        ├── 私有 Docker Registry
        ├── 内部 K8s 集群
        └── 数据库/缓存服务
```

**Runner 安装（Linux）：**

```bash
# 1. 在 GitHub 仓库/组织页面获取 token
# Settings → Actions → Runners → New self-hosted runner

# 2. 下载并配置
mkdir actions-runner && cd actions-runner
curl -o actions-runner-linux-x64-2.319.0.tar.gz -L \
  https://github.com/actions/runner/releases/download/v2.319.0/actions-runner-linux-x64-2.319.0.tar.gz
tar xzf ./actions-runner-linux-x64-2.319.0.tar.gz

# 3. 注册
./config.sh --url https://github.com/org/repo --token <TOKEN>

# 4. 作为系统服务运行
sudo ./svc.sh install
sudo ./svc.sh start
```

**在 Workflow 中使用：**

```yaml
jobs:
  build:
    runs-on: [self-hosted, linux, x64, gpu]  # 标签匹配
    steps:
      - run: nvidia-smi  # 使用 GPU
```

---

### 2.5 Secrets / Environments / OIDC 认证

**Secrets 层级：**

```diagram
Organization Secrets（所有仓库可用）
    └── Repository Secrets（当前仓库）
            └── Environment Secrets（指定环境，可设审批）
```

**Environments（环境保护规则）：**

```yaml
jobs:
  deploy-production:
    runs-on: ubuntu-latest
    environment:
      name: production              # 关联 GitHub Environment
      url: https://app.example.com  # 部署后的 URL（显示在 PR）
    steps:
      - name: Deploy
        run: ./deploy.sh
        env:
          API_KEY: ${{ secrets.PROD_API_KEY }}  # Environment-level secret
```

Environment 可配置：
- **Required reviewers**：部署前需指定人员审批
- **Wait timer**：延迟 N 分钟后才允许部署
- **Deployment branches**：只允许特定分支部署

**OIDC（OpenID Connect）无密钥认证原理：**

传统方式需要将云厂商长期凭证存储为 Secret，存在泄露风险。
OIDC 通过短期令牌消除了这一风险：

```diagram
GitHub Actions Runner
        │
        │  1. 请求 OIDC token（包含仓库/分支/环境信息）
        ▼
GitHub OIDC Provider
        │
        │  2. 颁发签名的 JWT（有效期 ~10 分钟）
        ▼
Cloud Provider（AWS/GCP/Azure）
        │
        │  3. 验证 JWT 签名 + 检查 claim（repo/branch 匹配策略）
        │  4. 颁发短期访问令牌
        ▼
GitHub Actions Runner
        │  5. 使用短期令牌调用云 API
```

**AWS OIDC 示例：**

```yaml
permissions:
  id-token: write   # 必须声明，才能请求 OIDC token
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Configure AWS Credentials via OIDC
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789:role/GitHubActionsRole
          aws-region: us-east-1
          # 无需存储 AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY

      - name: Deploy to ECS
        run: aws ecs update-service --cluster prod --service api --force-new-deployment
```

---

### 2.6 完整实战 Workflow

以下是一个覆盖：代码检查 → 测试 → Docker 构建 → 推送 → 部署的完整示例：

```yaml
# .github/workflows/ci-cd.yml
name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
  release:
    types: [published]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  # ──────────────────────────────────────
  # Job 1: 代码质量检查
  # ──────────────────────────────────────
  lint-and-test:
    name: Lint & Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install Dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Type Check
        run: npm run typecheck

      - name: Unit Tests
        run: npm run test:coverage

      - name: Upload Coverage
        uses: codecov/codecov-action@v4
        with:
          token: ${{ secrets.CODECOV_TOKEN }}
          fail_ci_if_error: true

  # ──────────────────────────────────────
  # Job 2: 安全扫描
  # ──────────────────────────────────────
  security:
    name: Security Scan
    runs-on: ubuntu-latest
    permissions:
      security-events: write
    steps:
      - uses: actions/checkout@v4

      - name: Run Trivy Dependency Scan
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: fs
          scan-ref: .
          format: sarif
          output: trivy-results.sarif

      - name: Upload Trivy Results to GitHub Security
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: trivy-results.sarif

  # ──────────────────────────────────────
  # Job 3: 构建 Docker 镜像
  # ──────────────────────────────────────
  build-image:
    name: Build & Push Image
    runs-on: ubuntu-latest
    needs: [lint-and-test, security]
    permissions:
      contents: read
      packages: write
      id-token: write     # OIDC
    outputs:
      image-digest: ${{ steps.push.outputs.digest }}
      image-tag: ${{ steps.meta.outputs.tags }}

    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}  # 自动提供，无需手动配置

      - name: Extract Docker Metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=ref,event=branch
            type=ref,event=pr
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha,prefix=sha-,format=short

      - name: Build and Push
        id: push
        uses: docker/build-push-action@v5
        with:
          context: .
          platforms: linux/amd64,linux/arm64   # 多架构
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha          # GitHub Actions 缓存
          cache-to: type=gha,mode=max
          provenance: true              # SLSA 出处证明
          sbom: true                    # 生成 SBOM

      - name: Sign Image with cosign
        if: github.event_name != 'pull_request'
        uses: sigstore/cosign-installer@v3
      - run: |
          cosign sign --yes \
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}@${{ steps.push.outputs.digest }}
        if: github.event_name != 'pull_request'
        env:
          COSIGN_EXPERIMENTAL: true

  # ──────────────────────────────────────
  # Job 4: 部署到 Staging
  # ──────────────────────────────────────
  deploy-staging:
    name: Deploy to Staging
    runs-on: ubuntu-latest
    needs: build-image
    if: github.ref == 'refs/heads/develop'
    environment:
      name: staging
      url: https://staging.example.com
    steps:
      - uses: actions/checkout@v4

      - name: Update Staging Manifests
        run: |
          # GitOps：更新 K8s 清单中的镜像 tag
          cd k8s/overlays/staging
          kustomize edit set image app=${{ needs.build-image.outputs.image-tag }}
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add .
          git commit -m "chore: update staging image to ${{ github.sha }}"
          git push

  # ──────────────────────────────────────
  # Job 5: 部署到 Production（需要审批）
  # ──────────────────────────────────────
  deploy-production:
    name: Deploy to Production
    runs-on: ubuntu-latest
    needs: build-image
    if: github.event_name == 'release'
    environment:
      name: production
      url: https://app.example.com
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS Credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: us-east-1

      - name: Deploy to EKS
        run: |
          aws eks update-kubeconfig --name prod-cluster --region us-east-1
          kubectl set image deployment/app \
            app=${{ needs.build-image.outputs.image-tag }} \
            -n production
          kubectl rollout status deployment/app -n production --timeout=5m
```

---

## 3. GitOps 模式

### 3.1 GitOps 四大原则

GitOps 由 Weaveworks 于 2017 年提出，核心思想：**Git 是系统期望状态的唯一可信来源（Single Source of Truth）**。

```diagram
┌─────────────────────────────────────────────────────────┐
│                    GitOps 四大原则                        │
├────────────────┬────────────────────────────────────────┤
│ 1. 声明式配置   │ 系统状态用声明式描述（K8s YAML），而非  │
│ Declarative    │ 命令式脚本（kubectl apply 而非 kubectl  │
│                │ create/patch/delete 序列）             │
├────────────────┼────────────────────────────────────────┤
│ 2. 版本化存储   │ 所有配置存储在 Git 中，具备完整版本历   │
│ Versioned      │ 史、变更审计、分支管理和 PR 评审能力     │
├────────────────┼────────────────────────────────────────┤
│ 3. 自动拉取    │ 由运行在集群内部的 Agent 主动拉取 Git   │
│ Pulled         │ 状态并应用，而非外部 CI 推送变更（Pull  │
│                │ vs Push 模式，安全性更高）              │
├────────────────┼────────────────────────────────────────┤
│ 4. 持续调谐    │ Agent 持续监控实际状态与期望状态的差异  │
│ Continuously   │ 并自动修复（Drift Detection + Auto      │
│ Reconciled     │ Remediation）                          │
└────────────────┴────────────────────────────────────────┘
```

**Push vs Pull 部署模式对比：**

```diagram
Push 模式（传统 CI/CD）:
  CI 服务器
     │
     │  kubectl apply（需要 kubeconfig 凭证）
     ▼
  K8s 集群 ← 外部访问，需要暴露 API Server


Pull 模式（GitOps）:
  Git 仓库
     ▲
     │  poll/watch（只需出站网络）
     │
  GitOps Agent（在集群内部）
     │
     │  kubectl apply（本地调用，无需暴露 API Server）
     ▼
  K8s 集群 ← 更安全，无入站凭证风险
```

---

### 3.2 ArgoCD 架构详解

ArgoCD 是目前最流行的 GitOps 工具，基于 Kubernetes 原生 CRD 实现。

**架构组件：**

```diagram
┌─────────────────────────────────────────────────────────┐
│                      ArgoCD 架构                         │
│                                                         │
│  ┌─────────────┐    ┌──────────────┐    ┌────────────┐  │
│  │   API       │    │  Application  │    │   Repo     │  │
│  │  Server     │    │  Controller   │    │  Server    │  │
│  │  (UI/CLI/   │    │  (调谐循环)   │    │  (拉取Git) │  │
│  │   gRPC)     │    │              │    │            │  │
│  └─────────────┘    └──────────────┘    └────────────┘  │
│         │                  │                  │         │
│         └──────────────────┼──────────────────┘         │
│                            │                            │
│                    ┌───────────────┐                    │
│                    │   Redis Cache  │                    │
│                    └───────────────┘                    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │              Dex (OIDC Provider)                 │    │
│  │       SSO 集成 (GitHub/GitLab/LDAP/SAML)        │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

**核心 CRD：Application**

```yaml
# argocd-application.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io  # 删除 App 时级联删除 K8s 资源
spec:
  project: default

  # 来源：Git 仓库
  source:
    repoURL: https://github.com/org/gitops-repo
    targetRevision: main          # 分支/Tag/Commit SHA
    path: k8s/overlays/production

    # 支持多种配置格式
    # Helm Chart：
    # chart: my-app
    # helm:
    #   valueFiles: [values-prod.yaml]
    #   parameters:
    #     - name: replicas
    #       value: "3"
    #
    # Kustomize（自动检测）：
    # kustomize:
    #   images:
    #     - ghcr.io/org/app:v1.2.3

  # 目标：K8s 集群 + 命名空间
  destination:
    server: https://kubernetes.default.svc  # 本集群
    namespace: production

  # 同步策略
  syncPolicy:
    automated:
      prune: true       # 删除 Git 中已移除的资源
      selfHeal: true    # 自动修复手动变更（Drift）
      allowEmpty: false # 防止意外删除所有资源
    syncOptions:
      - CreateNamespace=true          # 自动创建命名空间
      - PrunePropagationPolicy=foreground
      - RespectIgnoreDifferences=true
    retry:
      limit: 5
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m

  # 忽略某些字段的 Drift（如 HPA 动态修改的 replicas）
  ignoreDifferences:
    - group: apps
      kind: Deployment
      jsonPointers:
        - /spec/replicas
```

**AppProject（多租户隔离）：**

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: team-backend
  namespace: argocd
spec:
  description: 后端团队项目

  # 允许使用的 Git 仓库
  sourceRepos:
    - 'https://github.com/org/backend-*'
    - 'https://charts.helm.sh/stable'

  # 允许部署的目标集群和命名空间
  destinations:
    - namespace: 'backend-*'
      server: https://kubernetes.default.svc

  # 允许使用的 K8s 资源类型（白名单）
  clusterResourceWhitelist:
    - group: ''
      kind: Namespace

  # 命名空间级资源（默认全部允许，可设黑名单）
  namespaceResourceBlacklist:
    - group: ''
      kind: ResourceQuota

  # RBAC
  roles:
    - name: developer
      description: 开发者只能同步，不能删除
      policies:
        - p, proj:team-backend:developer, applications, get, team-backend/*, allow
        - p, proj:team-backend:developer, applications, sync, team-backend/*, allow
      groups:
        - org:backend-team
```

**ApplicationSet（批量管理 Application）：**

```yaml
# 用生成器自动为每个集群/环境创建 Application
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: cluster-addons
  namespace: argocd
spec:
  generators:
    # 列表生成器
    - list:
        elements:
          - cluster: dev
            url: https://dev.k8s.example.com
          - cluster: staging
            url: https://staging.k8s.example.com
          - cluster: prod
            url: https://prod.k8s.example.com

    # Git 目录生成器（扫描 Git 目录自动生成）
    # - git:
    #     repoURL: https://github.com/org/gitops
    #     revision: HEAD
    #     directories:
    #       - path: clusters/*

  template:
    metadata:
      name: '{{cluster}}-addons'
    spec:
      project: default
      source:
        repoURL: https://github.com/org/gitops
        targetRevision: HEAD
        path: 'addons/{{cluster}}'
      destination:
        server: '{{url}}'
        namespace: kube-system
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
```

**同步状态说明：**

```
Application 健康状态：
  Healthy    ✅  所有资源运行正常
  Degraded   ⚠️  部分资源异常（如 Pod CrashLoopBackOff）
  Progressing 🔄  资源正在更新中
  Missing    ❓  资源不存在
  Unknown    ❔  无法确定状态

同步状态：
  Synced     ✅  实际状态 == 期望状态
  OutOfSync  ⚠️  实际状态 != 期望状态（Drift 或新提交）
  Unknown    ❔  无法比较
```

---

### 3.3 Flux CD 核心概念

Flux v2 是另一款主流 GitOps 工具，由 CNCF 孵化，架构更加模块化。

**Flux 核心控制器：**

| 控制器 | 职责 | 主要 CRD |
|--------|------|---------|
| source-controller | 拉取 Git/Helm/OCI 源 | GitRepository, HelmRepository, OCIRepository |
| kustomize-controller | 应用 Kustomize 配置 | Kustomization |
| helm-controller | 管理 Helm Release | HelmRelease |
| notification-controller | 发送告警通知 | Alert, Provider, Receiver |
| image-automation-controller | 自动更新镜像 Tag | ImageUpdateAutomation, ImagePolicy |

**Flux 典型配置：**

```yaml
# 1. 声明 Git 源
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: my-app
  namespace: flux-system
spec:
  interval: 1m           # 每分钟拉取检查
  url: https://github.com/org/gitops-repo
  ref:
    branch: main
  secretRef:
    name: github-token   # Git 认证

---
# 2. 声明 Kustomization（应用配置）
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: my-app
  namespace: flux-system
spec:
  interval: 10m
  path: ./k8s/overlays/production
  prune: true            # 删除已移除资源
  sourceRef:
    kind: GitRepository
    name: my-app
  healthChecks:          # 等待资源健康
    - apiVersion: apps/v1
      kind: Deployment
      name: my-app
      namespace: production
  postBuild:
    substituteFrom:       # 变量替换
      - kind: ConfigMap
        name: cluster-vars

---
# 3. 镜像自动更新策略
apiVersion: image.toolkit.fluxcd.io/v1beta2
kind: ImagePolicy
metadata:
  name: my-app
  namespace: flux-system
spec:
  imageRepositoryRef:
    name: my-app
  policy:
    semver:
      range: '>=1.0.0 <2.0.0'  # 自动跟踪此范围内最新版本
```

---

### 3.4 GitOps vs 传统 CI/CD

| 维度 | 传统 CI/CD (Push) | GitOps (Pull) |
|------|------------------|---------------|
| **部署触发** | CI Pipeline 主动推送 | Agent 检测 Git 变更后拉取 |
| **凭证位置** | CI 服务器持有 kubeconfig | 凭证在集群内，无需暴露 |
| **漂移检测** | 无自动检测 | 持续调谐，自动修复 |
| **回滚方式** | 重新运行旧 Pipeline | git revert 即回滚 |
| **审计追踪** | CI 日志 + 部署脚本 | Git 提交历史 = 完整审计 |
| **多集群管理** | 需要管理多套凭证 | 每集群一个 Agent，中心化配置 |
| **工具耦合** | 强依赖 CI 工具 | 与 CI 工具解耦 |
| **学习曲线** | 相对平缓 | 需要理解声明式理念 |
| **配置漂移** | 可能存在（手动操作） | 自动检测并修复 |
| **代表工具** | Jenkins / GitHub Actions | ArgoCD / Flux CD |

**GitOps 工作流示意：**

```diagram
开发者
  │
  │  git push（修改 K8s 清单）
  ▼
Git 仓库（配置态）
  │
  │  ArgoCD/Flux 监听变更
  ▼
GitOps Agent（集群内）
  │
  │  比较期望态 vs 实际态
  ├── 相同 → 无操作
  └── 不同 → kubectl apply（同步）
             ↓
         K8s 集群（实际态）
```

---

## 4. 容器镜像 CI/CD

### 4.1 多架构镜像构建

随着 ARM 架构（Apple Silicon、AWS Graviton）普及，多架构镜像构建成为必要实践。

**核心工具：**

- **Docker Buildx**：Docker 的扩展构建工具，支持多平台
- **QEMU**：用于在 x86 机器上模拟 ARM 构建（速度较慢）
- **BuildKit**：Buildx 底层构建引擎，支持并发构建

**本地多架构构建：**

```bash
# 1. 创建多平台 builder（使用 QEMU 模拟）
docker buildx create --name multiarch --driver docker-container --use
docker buildx inspect --bootstrap

# 查看支持的平台
docker buildx inspect multiarch

# 2. 构建并推送多架构镜像
docker buildx build \
  --platform linux/amd64,linux/arm64,linux/arm/v7 \
  --tag ghcr.io/org/app:v1.0.0 \
  --push \
  .

# 3. 验证多架构清单
docker buildx imagetools inspect ghcr.io/org/app:v1.0.0
```

**原生构建（更快）：在 CI 中使用真实 ARM Runner：**

```yaml
jobs:
  build-amd64:
    runs-on: ubuntu-latest       # x86_64
    steps:
      - uses: docker/build-push-action@v5
        with:
          platforms: linux/amd64
          outputs: type=image,name=ghcr.io/org/app,push-by-digest=true,name-canonical=true,push=true

  build-arm64:
    runs-on: [self-hosted, arm64]  # 真实 ARM Runner（速度比 QEMU 快 10x）
    steps:
      - uses: docker/build-push-action@v5
        with:
          platforms: linux/arm64
          outputs: type=image,name=ghcr.io/org/app,push-by-digest=true,name-canonical=true,push=true

  # 合并两个架构的 digest 为一个 manifest list
  merge:
    runs-on: ubuntu-latest
    needs: [build-amd64, build-arm64]
    steps:
      - uses: docker/build-push-action@v5
        with:
          platforms: linux/amd64,linux/arm64
          tags: ghcr.io/org/app:latest
          # 合并已有 digest
```

**Dockerfile 多架构最佳实践：**

```dockerfile
# 使用 BuildKit 的平台变量
ARG TARGETPLATFORM
ARG BUILDPLATFORM
ARG TARGETOS
ARG TARGETARCH

FROM --platform=$BUILDPLATFORM golang:1.22 AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# 交叉编译：在 amd64 构建机上编译 arm64 二进制
RUN GOOS=$TARGETOS GOARCH=$TARGETARCH go build -o server .

# 最终镜像：极小化
FROM --platform=$TARGETPLATFORM gcr.io/distroless/static:nonroot
COPY --from=builder /app/server /server
ENTRYPOINT ["/server"]
```

---

### 4.2 镜像仓库对比

| 特性 | Docker Hub | GitHub Container Registry (GHCR) | Harbor |
|------|-----------|-----------------------------------|--------|
| **类型** | 公共云 | 公共云 | 自托管 |
| **免费限制** | 公共无限，私有 1 个 | 公共无限，私有受 Actions 存储限制 | 无限（自建） |
| **拉取速率限制** | 匿名 100次/6h，认证 200次/6h | 无明确限制 | 无 |
| **集成** | 广泛（默认 Registry） | 与 GitHub Actions/Packages 深度集成 | K8s/LDAP/AD/OIDC |
| **漏洞扫描** | 付费计划 | 通过 Dependabot | 内置（Trivy/Clair） |
| **镜像签名** | Notary v1 | cosign | cosign/Notary |
| **复制/代理** | 有限 | 无 | 强（复制规则/代理缓存） |
| **审计日志** | 基础 | GitHub 审计日志 | 完整 |
| **适用场景** | 开源项目 | GitHub 生态项目 | 企业私有部署 |

**Harbor 代理缓存（解决拉取限速问题）：**

```yaml
# Harbor 中配置代理缓存
# 仓库 → 新建仓库 → 选择"代理缓存"
# 上游端点: https://registry-1.docker.io

# 使用代理缓存（K8s 中配置 imagePullPolicy）
# image: harbor.internal/dockerhub-proxy/library/nginx:1.25
#                         ↑ 自动缓存 Docker Hub 镜像
```

---

### 4.3 镜像签名与验证

镜像签名解决供应链安全问题：确保部署的镜像是由可信的 CI/CD 流水线构建的，未被篡改。

**cosign（Sigstore 项目）工作原理：**

```diagram
构建阶段（CI/CD）:
  镜像推送到 Registry
       │
       ▼
  cosign sign（使用 OIDC 令牌，无需密钥文件）
       │
       ▼
  签名存储在 OCI Registry（与镜像同仓库，不同 tag）
  或 Sigstore Transparency Log（Rekor，公共账本）


验证阶段（部署前）:
  cosign verify
       │
       ├── 从 Registry/Rekor 获取签名
       ├── 验证签名对应的 OIDC 身份（如：github.com/org/repo）
       └── 验证通过 → 允许部署
           验证失败 → 拒绝部署（K8s Admission Webhook）
```

**cosign 实践：**

```bash
# 安装 cosign
brew install cosign   # macOS
# 或
go install github.com/sigstore/cosign/v2/cmd/cosign@latest

# 生成密钥对（传统方式，不推荐用于 CI）
cosign generate-key-pair

# 使用密钥签名
cosign sign --key cosign.key ghcr.io/org/app@sha256:abc123...

# 验证签名
cosign verify --key cosign.pub ghcr.io/org/app@sha256:abc123...

# 无密钥签名（Keyless，推荐在 CI 中使用）
# 在 GitHub Actions 中：
COSIGN_EXPERIMENTAL=1 cosign sign ghcr.io/org/app@sha256:abc123...
# 自动使用 OIDC 令牌，签名记录到 Rekor 公共账本

# 验证无密钥签名
cosign verify \
  --certificate-identity "https://github.com/org/repo/.github/workflows/ci.yml@refs/heads/main" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  ghcr.io/org/app:v1.0.0
```

**在 Kubernetes 中强制验证签名（Policy Controller）：**

```yaml
# 安装 sigstore policy-controller
# helm install policy-controller sigstore/policy-controller -n cosign-system

# 创建 ClusterImagePolicy
apiVersion: policy.sigstore.dev/v1alpha1
kind: ClusterImagePolicy
metadata:
  name: require-signed-images
spec:
  images:
    - glob: "ghcr.io/org/**"         # 匹配的镜像范围
  authorities:
    - keyless:
        url: https://fulcio.sigstore.dev
        identities:
          - issuer: https://token.actions.githubusercontent.com
            subjectRegExp: "https://github.com/org/.*"
      ctlog:
        url: https://rekor.sigstore.dev
```

**SBOM（软件物料清单）生成：**

```bash
# 使用 syft 生成 SBOM
syft ghcr.io/org/app:v1.0.0 -o spdx-json > sbom.json

# 使用 cosign 将 SBOM 附加到镜像
cosign attach sbom --sbom sbom.json ghcr.io/org/app:v1.0.0

# 在 GitHub Actions 中（docker/build-push-action 自动支持）
- uses: docker/build-push-action@v5
  with:
    sbom: true         # 自动生成并附加 SBOM
    provenance: true   # 生成 SLSA 出处证明
```

**供应链安全 SLSA 框架等级：**

```
SLSA Level 0: 无任何保证
SLSA Level 1: 有构建脚本，有出处证明（Provenance）
SLSA Level 2: 使用托管构建服务（如 GitHub Actions），出处不可篡改
SLSA Level 3: 防篡改构建，出处由构建服务签名
SLSA Level 4: 两人审查，密封构建（Hermetic）
```

---

## 总结

| 主题 | 核心要点 |
|------|---------|
| CI/CD 层次 | CI（集成）→ 持续交付（随时可发布）→ 持续部署（自动上线） |
| Pipeline 原则 | 快速反馈、可重复构建、支持回滚 |
| GitHub Actions | Workflow > Job > Step > Action；矩阵/复用/OIDC 是进阶重点 |
| GitOps | 声明式 + Git 为唯一真相 + Pull 模式 + 自动调谐 |
| ArgoCD | Application CRD + 自动同步 + 漂移修复 + 多租户 AppProject |
| 多架构镜像 | Buildx + QEMU 或原生 ARM Runner，合并 Manifest List |
| 镜像安全 | cosign 签名 + Policy Controller 准入验证 + SBOM |

---

*最后更新：2025 年 | 相关资料：[DevOps 总目录](./) | [CI/CD 面试题](../../02-面试指南/06-DevOps与云计算面试/03-CICD面试题.md)*
