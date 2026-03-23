import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"03-数据库面试 — 面试指南","description":"","frontmatter":{},"headers":[],"relativePath":"02-面试指南/03-数据库面试/index.md","filePath":"02-面试指南/03-数据库面试/README.md","lastUpdated":1774066204000}');
const _sfc_main = { name: "02-面试指南/03-数据库面试/index.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="_03-数据库面试-—-面试指南" tabindex="-1">03-数据库面试 — 面试指南 <a class="header-anchor" href="#_03-数据库面试-—-面试指南" aria-label="Permalink to &quot;03-数据库面试 — 面试指南&quot;">&amp;ZeroWidthSpace;</a></h1><blockquote><p>数据库方向面试题目与解析，涵盖关系型数据库、NoSQL 及缓存技术。</p></blockquote><h2 id="文档列表" tabindex="-1">文档列表 <a class="header-anchor" href="#文档列表" aria-label="Permalink to &quot;文档列表&quot;">&amp;ZeroWidthSpace;</a></h2><table tabindex="0"><thead><tr><th>序号</th><th>文件</th><th>描述</th><th>对应技术资料</th></tr></thead><tbody><tr><td>01</td><td><a href="./01-向量数据库面试题.html">01-向量数据库面试题.md</a></td><td>向量嵌入 / ANN 搜索 / HNSW / IVF / Chroma / Milvus 架构 / 混合搜索 22 道分层面试题</td><td><a href="./../../01-技术资料/03-数据库/01-向量数据库.html">技术资料</a></td></tr><tr><td>02</td><td><a href="./02-Redis面试题.html">02-Redis面试题.md</a></td><td>Redis 数据结构底层(SDS/listpack/skiplist/quicklist) / 持久化深度(RDB COW/AOF重写/混合) / 内存管理 / 集群架构(16384slots/Gossip/脑裂) / Pipeline vs 事务 vs Lua / Redlock争议 / 布隆过滤器 / 排行榜 / 分布式限流 / 延迟队列 33 道分层面试题</td><td><a href="./../../01-技术资料/03-数据库/02-Redis核心技术.html">技术资料</a></td></tr><tr><td>03</td><td><a href="./03-PostgreSQL面试题.html">03-PostgreSQL面试题.md</a></td><td>进程架构 / MVCC 可见性判断 / HOT 更新 / WAL / Checkpoint / B-tree High Key / SSI / VACUUM / XID Wraparound / BRIN / EXPLAIN 22 道分层面试题</td><td><a href="./../../01-技术资料/03-数据库/03-PostgreSQL核心技术.html">技术资料</a></td></tr><tr><td>04</td><td><a href="./04-MySQL-InnoDB面试题.html">04-MySQL-InnoDB面试题.md</a></td><td>Buffer Pool LRU / B+树聚簇索引 / MVCC Read View / Next-Key Lock / Change Buffer / Doublewrite / 崩溃恢复 / 死锁 / 索引优化 22 道分层面试题</td><td><a href="./../../01-技术资料/03-数据库/04-MySQL-InnoDB核心技术.html">技术资料</a></td></tr><tr><td>05</td><td><a href="./05-MongoDB面试题.html">05-MongoDB面试题.md</a></td><td>BSON / WiredTiger / 复制集 / 分片 / 事务 / Embedding vs Referencing / 聚合管道 / 索引设计 / 性能调优 30 道分层面试题</td><td><a href="./../../01-技术资料/03-数据库/05-MongoDB核心技术.html">技术资料</a></td></tr><tr><td>06</td><td><a href="./06-Elasticsearch面试题.html">06-Elasticsearch面试题.md</a></td><td>倒排索引 / 分词器 / Query DSL / 聚合分析 / 分布式架构 / Mapping 设计 / BM25 评分 / 深分页优化 / ILM 生命周期 / 性能调优 24 道分层面试题</td><td><a href="./../../01-技术资料/03-数据库/06-Elasticsearch核心技术.html">技术资料</a></td></tr></tbody></table><h2 id="高频考点方向" tabindex="-1">高频考点方向 <a class="header-anchor" href="#高频考点方向" aria-label="Permalink to &quot;高频考点方向&quot;">&amp;ZeroWidthSpace;</a></h2><ul><li>MySQL 索引原理（B+树）</li><li>MySQL 事务与锁</li><li>SQL 优化与执行计划</li><li>Redis 数据结构与底层实现</li><li>Redis 持久化、集群、主从复制</li><li>MySQL vs MongoDB 对比</li><li>数据库设计与范式</li></ul><h2 id="导航" tabindex="-1">导航 <a class="header-anchor" href="#导航" aria-label="Permalink to &quot;导航&quot;">&amp;ZeroWidthSpace;</a></h2><ul><li>← <a href="./../">面试指南总目录</a></li><li>↔ <a href="./../../01-技术资料/03-数据库/">数据库技术资料</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("02-面试指南/03-数据库面试/README.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const README = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  README as default
};
