import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"06-DevOps与云计算面试 — 面试指南","description":"","frontmatter":{},"headers":[],"relativePath":"02-面试指南/06-DevOps与云计算面试/index.md","filePath":"02-面试指南/06-DevOps与云计算面试/README.md","lastUpdated":1774066204000}');
const _sfc_main = { name: "02-面试指南/06-DevOps与云计算面试/index.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="_06-devops与云计算面试-—-面试指南" tabindex="-1">06-DevOps与云计算面试 — 面试指南 <a class="header-anchor" href="#_06-devops与云计算面试-—-面试指南" aria-label="Permalink to &quot;06-DevOps与云计算面试 — 面试指南&quot;">&amp;ZeroWidthSpace;</a></h1><blockquote><p>DevOps 与云计算方向面试题目与解析，涵盖容器化、CI/CD 及云服务核心概念。</p></blockquote><h2 id="相关链接" tabindex="-1">相关链接 <a class="header-anchor" href="#相关链接" aria-label="Permalink to &quot;相关链接&quot;">&amp;ZeroWidthSpace;</a></h2><ul><li>对应技术资料：<a href="./../../01-技术资料/06-DevOps与云计算/">06-DevOps与云计算</a></li></ul><h2 id="文档列表" tabindex="-1">文档列表 <a class="header-anchor" href="#文档列表" aria-label="Permalink to &quot;文档列表&quot;">&amp;ZeroWidthSpace;</a></h2><table tabindex="0"><thead><tr><th>序号</th><th>文件</th><th>描述</th><th>对应技术资料</th></tr></thead><tbody><tr><td>01</td><td><a href="./01-Docker面试题.html">Docker 面试题</a></td><td>Docker 核心原理（Namespace/Cgroups/OverlayFS）、镜像与容器、网络存储、Compose、容器安全 21 道分层面试题</td><td><a href="./../../01-技术资料/06-DevOps与云计算/01-Docker与容器化技术.html">Docker 与容器化技术</a></td></tr><tr><td>02</td><td><a href="./02-Kubernetes面试题.html">Kubernetes 面试题</a></td><td>K8s 架构/调度/存储/网络/RBAC/HPA/部署策略 25 道分层面试题（⭐基础/⭐⭐进阶/⭐⭐⭐高级/场景题）</td><td><a href="./../../01-技术资料/06-DevOps与云计算/02-Kubernetes核心技术.html">Kubernetes 核心技术</a></td></tr><tr><td>03</td><td><a href="./03-CICD面试题.html">CI/CD 面试题</a></td><td>CI/CD 核心概念/GitHub Actions/GitOps/ArgoCD/Flux/多架构镜像/cosign 镜像签名 分层面试题</td><td><a href="./../../01-技术资料/06-DevOps与云计算/03-CICD与GitOps.html">CI/CD 与 GitOps</a></td></tr></tbody></table><h2 id="高频考点方向" tabindex="-1">高频考点方向 <a class="header-anchor" href="#高频考点方向" aria-label="Permalink to &quot;高频考点方向&quot;">&amp;ZeroWidthSpace;</a></h2><ul><li>Docker 核心原理（镜像、容器、网络）</li><li>Kubernetes 架构与核心组件</li><li>CI/CD 流水线设计</li><li>Linux 常用命令与 Shell 脚本</li><li>云原生与 Serverless</li><li>监控、告警与日志体系</li></ul><h2 id="导航" tabindex="-1">导航 <a class="header-anchor" href="#导航" aria-label="Permalink to &quot;导航&quot;">&amp;ZeroWidthSpace;</a></h2><ul><li>← <a href="./../">面试指南总目录</a></li><li>↔ <a href="./../../01-技术资料/06-DevOps与云计算/">DevOps与云计算技术资料</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("02-面试指南/06-DevOps与云计算面试/README.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const README = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  README as default
};
