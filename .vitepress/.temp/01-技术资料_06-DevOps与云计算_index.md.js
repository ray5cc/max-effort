import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"06-DevOps与云计算 — 技术资料","description":"","frontmatter":{},"headers":[],"relativePath":"01-技术资料/06-DevOps与云计算/index.md","filePath":"01-技术资料/06-DevOps与云计算/README.md","lastUpdated":1774066204000}');
const _sfc_main = { name: "01-技术资料/06-DevOps与云计算/index.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="_06-devops与云计算-—-技术资料" tabindex="-1">06-DevOps与云计算 — 技术资料 <a class="header-anchor" href="#_06-devops与云计算-—-技术资料" aria-label="Permalink to &quot;06-DevOps与云计算 — 技术资料&quot;">&amp;ZeroWidthSpace;</a></h1><blockquote><p>DevOps 与云计算学习文档，涵盖 CI/CD、容器化、云服务及运维最佳实践。</p></blockquote><h2 id="相关链接" tabindex="-1">相关链接 <a class="header-anchor" href="#相关链接" aria-label="Permalink to &quot;相关链接&quot;">&amp;ZeroWidthSpace;</a></h2><ul><li>对应面试指南：<a href="./../../02-面试指南/06-DevOps与云计算面试/">06-DevOps与云计算面试</a></li></ul><h2 id="文档列表" tabindex="-1">文档列表 <a class="header-anchor" href="#文档列表" aria-label="Permalink to &quot;文档列表&quot;">&amp;ZeroWidthSpace;</a></h2><table tabindex="0"><thead><tr><th>序号</th><th>文件</th><th>描述</th><th>对应面试题</th></tr></thead><tbody><tr><td>01</td><td><a href="./01-Docker与容器化技术.html">Docker 与容器化技术</a></td><td>Namespace/Cgroups/OverlayFS 核心原理、Docker 架构与组件、Dockerfile 最佳实践、网络存储模型、Compose 编排、容器安全</td><td><a href="./../../02-面试指南/06-DevOps与云计算面试/01-Docker面试题.html">Docker 面试题</a></td></tr><tr><td>02</td><td><a href="./02-Kubernetes核心技术.html">Kubernetes 核心技术</a></td><td>K8s 架构（Control Plane/Node 组件）、核心资源对象（Pod/Deployment/StatefulSet/Service/Ingress）、调度机制、存储系统（PV/PVC/CSI）、网络模型（CNI/NetworkPolicy）、生产运维（RBAC/HPA/Helm/蓝绿/金丝雀）</td><td><a href="./../../02-面试指南/06-DevOps与云计算面试/02-Kubernetes面试题.html">Kubernetes 面试题</a></td></tr><tr><td>03</td><td><a href="./03-CICD与GitOps.html">CI/CD 与 GitOps</a></td><td>CI/CD 核心概念（持续集成/交付/部署）、GitHub Actions 深度解析（Workflow/Job/Step/矩阵/OIDC）、GitOps 模式（ArgoCD/Flux CD/声明式调谐）、容器镜像 CI/CD（多架构构建/镜像签名/cosign）</td><td><a href="./../../02-面试指南/06-DevOps与云计算面试/03-CICD面试题.html">CI/CD 面试题</a></td></tr></tbody></table><h2 id="主要内容方向" tabindex="-1">主要内容方向 <a class="header-anchor" href="#主要内容方向" aria-label="Permalink to &quot;主要内容方向&quot;">&amp;ZeroWidthSpace;</a></h2><ul><li>Linux 基础与命令</li><li>Docker 与容器化</li><li>Kubernetes（K8s）</li><li>CI/CD（GitHub Actions、Jenkins、GitLab CI）</li><li>云服务（AWS / GCP / 阿里云）</li><li>监控与可观测性（Prometheus、Grafana、ELK）</li><li>Infrastructure as Code（Terraform、Ansible）</li></ul><h2 id="导航" tabindex="-1">导航 <a class="header-anchor" href="#导航" aria-label="Permalink to &quot;导航&quot;">&amp;ZeroWidthSpace;</a></h2><ul><li>← <a href="./../">技术资料总目录</a></li><li>↔ <a href="./../../02-面试指南/06-DevOps与云计算面试/">DevOps与云计算面试指南</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("01-技术资料/06-DevOps与云计算/README.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const README = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  README as default
};
