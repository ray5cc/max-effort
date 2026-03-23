import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"05-系统设计 — 技术资料","description":"","frontmatter":{},"headers":[],"relativePath":"01-技术资料/05-系统设计/index.md","filePath":"01-技术资料/05-系统设计/README.md","lastUpdated":1774066204000}');
const _sfc_main = { name: "01-技术资料/05-系统设计/index.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="_05-系统设计-—-技术资料" tabindex="-1">05-系统设计 — 技术资料 <a class="header-anchor" href="#_05-系统设计-—-技术资料" aria-label="Permalink to &quot;05-系统设计 — 技术资料&quot;">&amp;ZeroWidthSpace;</a></h1><blockquote><p>覆盖 LLM 推理优化、分布式训练、分布式系统、消息队列与流处理、经典系统设计等核心技术。</p></blockquote><h2 id="相关链接" tabindex="-1">相关链接 <a class="header-anchor" href="#相关链接" aria-label="Permalink to &quot;相关链接&quot;">&amp;ZeroWidthSpace;</a></h2><ul><li>对应面试指南：<a href="./../../02-面试指南/05-系统设计面试/">05-系统设计面试</a></li></ul><h2 id="文档列表" tabindex="-1">文档列表 <a class="header-anchor" href="#文档列表" aria-label="Permalink to &quot;文档列表&quot;">&amp;ZeroWidthSpace;</a></h2><table tabindex="0"><thead><tr><th>序号</th><th>文件名</th><th>覆盖技术知识点</th><th>关联面试题</th></tr></thead><tbody><tr><td>01</td><td><a href="./01-LLM推理引擎优化.html">01-LLM推理引擎优化.md</a></td><td>KV Cache / PagedAttention / Continuous Batching / 量化 / CPU 推理（vLLM、TensorRT-LLM、llama.cpp）</td><td><a href="./../../02-面试指南/05-系统设计面试/01-LLM推理引擎面试题.html">面试题</a></td></tr><tr><td>02</td><td><a href="./02-分布式训练技术.html">02-分布式训练技术.md</a></td><td>ZeRO Stage 1/2/3 / 张量并行 / 流水线并行 / 3D 并行（DeepSpeed、Megatron-LM）</td><td><a href="./../../02-面试指南/05-系统设计面试/02-分布式训练面试题.html">面试题</a></td></tr><tr><td>03</td><td><a href="./03-分布式系统基础.html">03-分布式系统基础.md</a></td><td>CAP/PACELC / Raft 深度 / Multi-Raft / 分布式事务(2PC/Saga/TCC/Temporal) / 分片 / 副本 / 缓存一致性 / Redis Cluster / 服务注册中心 / 容错 / 分布式锁 / CRDT / Gossip</td><td><a href="./../../02-面试指南/05-系统设计面试/03-分布式系统面试题.html">面试题</a></td></tr><tr><td>04</td><td><a href="./04-消息队列与流处理.html">04-消息队列与流处理.md</a></td><td>Kafka深度(Controller/ISR/KRaft/副本同步/Exactly-Once/分层存储) / Pulsar(BookKeeper/多租户) / RocketMQ(延迟消息/事务消息) / Flink(窗口/水位线/Checkpoint) / 流处理引擎对比 / 消息可靠性 / 消息积压运维</td><td><a href="./../../02-面试指南/05-系统设计面试/04-消息队列面试题.html">面试题</a></td></tr><tr><td>05</td><td><a href="./05-经典系统设计案例.html">05-经典系统设计案例.md</a></td><td>短链系统 / Feed流 / 即时通讯 / 搜索引擎 / 秒杀系统 / 分布式文件存储 / 通用设计模式</td><td><a href="./../../02-面试指南/05-系统设计面试/06-经典系统设计面试题.html">面试题</a></td></tr></tbody></table><h2 id="说明" tabindex="-1">说明 <a class="header-anchor" href="#说明" aria-label="Permalink to &quot;说明&quot;">&amp;ZeroWidthSpace;</a></h2><ul><li>每篇文档聚焦<strong>通用技术原理</strong>，开源项目作为参考实现引用</li><li>ASCII 图示 + 代码示例，深入浅出</li></ul><h2 id="导航" tabindex="-1">导航 <a class="header-anchor" href="#导航" aria-label="Permalink to &quot;导航&quot;">&amp;ZeroWidthSpace;</a></h2><ul><li>← <a href="./../">技术资料总目录</a></li><li>↔ <a href="./../../02-面试指南/05-系统设计面试/">对应面试指南</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("01-技术资料/05-系统设计/README.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const README = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  README as default
};
