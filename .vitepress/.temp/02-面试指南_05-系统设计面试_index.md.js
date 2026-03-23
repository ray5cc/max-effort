import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"05-系统设计面试 — 面试指南","description":"","frontmatter":{},"headers":[],"relativePath":"02-面试指南/05-系统设计面试/index.md","filePath":"02-面试指南/05-系统设计面试/README.md","lastUpdated":1774066204000}');
const _sfc_main = { name: "02-面试指南/05-系统设计面试/index.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="_05-系统设计面试-—-面试指南" tabindex="-1">05-系统设计面试 — 面试指南 <a class="header-anchor" href="#_05-系统设计面试-—-面试指南" aria-label="Permalink to &quot;05-系统设计面试 — 面试指南&quot;">&amp;ZeroWidthSpace;</a></h1><blockquote><p>系统设计方向高频面试题，覆盖 LLM 推理优化、分布式训练、分布式系统、消息队列与经典系统设计。</p></blockquote><h2 id="相关链接" tabindex="-1">相关链接 <a class="header-anchor" href="#相关链接" aria-label="Permalink to &quot;相关链接&quot;">&amp;ZeroWidthSpace;</a></h2><ul><li>对应技术资料：<a href="./../../01-技术资料/05-系统设计/">05-系统设计</a></li></ul><h2 id="面试题目录" tabindex="-1">面试题目录 <a class="header-anchor" href="#面试题目录" aria-label="Permalink to &quot;面试题目录&quot;">&amp;ZeroWidthSpace;</a></h2><table tabindex="0"><thead><tr><th>序号</th><th>文件名</th><th>覆盖知识点</th><th>关联技术资料</th></tr></thead><tbody><tr><td>01</td><td><a href="./01-LLM推理引擎面试题.html">01-LLM推理引擎面试题.md</a></td><td>KV Cache / PagedAttention / Continuous Batching / vLLM / TensorRT-LLM / llama.cpp</td><td><a href="./../../01-技术资料/05-系统设计/01-LLM推理引擎优化.html">技术资料</a></td></tr><tr><td>02</td><td><a href="./02-分布式训练面试题.html">02-分布式训练面试题.md</a></td><td>ZeRO 原理 / 3D 并行 / 通信原语 / 混合精度 / Pipeline 调度 / DeepSpeed·Megatron-LM 30 道分层题</td><td><a href="./../../01-技术资料/05-系统设计/02-分布式训练技术.html">技术资料</a></td></tr><tr><td>03</td><td><a href="./03-分布式系统面试题.html">03-分布式系统面试题.md</a></td><td>CAP/PACELC / Raft / 分布式事务 / 一致性哈希 / 缓存 / 分布式锁 / 熔断限流 / CRDTs / 服务发现 / 可观测性 30 道分层题</td><td><a href="./../../01-技术资料/05-系统设计/03-分布式系统基础.html">技术资料</a></td></tr><tr><td>04</td><td><a href="./04-消息队列面试题.html">04-消息队列面试题.md</a></td><td>Kafka 深度 / Pulsar 架构 / 消息可靠性 / 顺序消息 / 消息积压 / Flink 流处理 / 延迟消息 / 事务 30 道分层题</td><td><a href="./../../01-技术资料/05-系统设计/04-消息队列与流处理.html">技术资料</a></td></tr><tr><td>06</td><td><a href="./06-经典系统设计面试题.html">06-经典系统设计面试题.md</a></td><td>短链系统 / Feed 流 / 即时通讯 / 搜索引擎 / 秒杀系统 / 分布式文件存储 25 道分层面试题</td><td><a href="./../../01-技术资料/05-系统设计/05-经典系统设计案例.html">技术资料</a></td></tr></tbody></table><h2 id="导航" tabindex="-1">导航 <a class="header-anchor" href="#导航" aria-label="Permalink to &quot;导航&quot;">&amp;ZeroWidthSpace;</a></h2><ul><li>← <a href="./../">面试指南总目录</a></li><li>↔ <a href="./../../01-技术资料/05-系统设计/">对应技术资料</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("02-面试指南/05-系统设计面试/README.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const README = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  README as default
};
