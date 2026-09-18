"use strict";

/**
 * 模块名与插件 id 的对应。
 *
 * CHANGELOG.md 里用中文模块名分节（`### 工作台`），因为日志是给人读的；
 * 构建时按这张表把条目分回各插件。写错模块名由 tools/check.js 挡住。
 */

// 输出顺序按阅读习惯：工作台在前，其余按使用频度。
// 注意这和 tools/plugins.js 的顺序不同，那一份是加载依赖顺序。
//
// 这张表覆盖日志里出现过的全部模块名，包含已经删掉的插件——历史条目不追认，
// 6.0 之前的「版本迭代」小节还在日志里，删掉映射会让 check 把它当写错的模块名。
// 「现在有哪些插件」看 tools/plugins.js，不看这里。
const LABELS = {
  "codex-workbench": "工作台",
  "codex-capture": "捕获",
  "codex-focus": "专注",
  "codex-study": "学习",
  "codex-recall": "复习",
  "codex-iteration": "版本迭代",
};

const ORDER = Object.keys(LABELS);
const IDS = new Map(Object.entries(LABELS).map(([id, label]) => [label, id]));

/** 中文模块名 -> 插件 id；未知模块名返回 undefined。 */
function idFor(label) {
  return IDS.get(String(label || "").trim());
}

/** 插件 id -> 中文模块名。 */
function labelFor(id) {
  return LABELS[id];
}

module.exports = { LABELS, ORDER, idFor, labelFor };
