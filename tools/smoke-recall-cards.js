"use strict";

/**
 * 闭环 A 的端到端检查：codex-study 的一张卡片进 codex-recall 的队列，
 * 复习、评分、改名、移出，旧的整篇笔记条目全程不受影响。
 *
 * 6.2 之前这条路根本不存在——在整个 codex-study 里 grep "recall" 返回零结果。
 */

const assert = require("node:assert/strict");
const Module = require("node:module");

const files = new Map();
const stored = new Map();
const handlers = new Map();

class Plugin {
  constructor(app, manifest) { this.app = app; this.manifest = manifest; }
  async loadData() { return stored.get(this.manifest.id) || null; }
  async saveData(data) { stored.set(this.manifest.id, JSON.parse(JSON.stringify(data))); }
  addCommand() {} registerEvent() {} registerInterval() {}
}
const notices = [];
const original = Module._load;
Module._load = function (name) {
  if (name === "obsidian") return { Plugin, Modal: class {}, Notice: class { constructor(t) { notices.push(t); } }, MarkdownRenderer: {}, Component: class { load() {} unload() {} } };
  return original.apply(this, arguments);
};

const app = {
  vault: {
    getAbstractFileByPath: (p) => files.get(p) || null,
    on(name, fn) { handlers.set(name, [...(handlers.get(name) || []), fn]); return {}; },
    trigger(name, ...args) { for (const fn of handlers.get(name) || []) fn(...args); },
  },
  workspace: { trigger() {}, on() { return {}; } },
  plugins: { plugins: {}, getPlugin(id) { return this.plugins[id] || null; } },
};

const Recall = require("../codex-recall/main.js");
const { splitKey, makeKey } = require("../codex-recall/core/keys.js");

const NOTE = "03 知识库/学习笔记/极限.md";
const BOOK = "book/数学分析 II.pdf";
const CARD = "k3x9-ab12cd";

files.set(NOTE, { path: NOTE, extension: "md", content: "# 极限\n定义与例子。" });
files.set(BOOK, { path: BOOK, extension: "pdf" });

// 旧数据：只有笔记键，没有卡片键。迁移必须是空操作。
stored.set("codex-recall", {
  schemaVersion: 1,
  cards: { [NOTE]: { due: Date.now() - 1000, interval: 3, addedAt: 1 } },
  history: [],
});

(async () => {
  const recall = new Recall(app, { id: "codex-recall" });
  app.plugins.plugins["codex-recall"] = recall;
  await recall.onload();

  // 1. 旧的笔记条目原样还在，key 就是路径。
  let list = recall.list();
  assert.equal(list.length, 1, "旧数据应原样保留");
  assert.equal(list[0].key, NOTE);
  assert.equal(list[0].path, NOTE);
  assert.equal(list[0].cardId, "", "笔记条目没有卡片后缀");

  // 2. 加一张卡片。
  await recall.addCard(BOOK, CARD);
  list = recall.list();
  assert.equal(list.length, 2);
  const card = list.find((c) => c.cardId);
  assert.ok(card, "卡片条目应出现在队列里");
  assert.equal(card.key, `${BOOK}#${CARD}`);
  assert.equal(card.path, BOOK, "path 指向文件，用来判断它还在不在");
  assert.equal(card.cardId, CARD);
  assert.equal(recall.has(card.key), true);

  // 3. 重复加入是幂等的，不会把已有的调度重置。
  const before = JSON.stringify(recall.data.cards[card.key]);
  await recall.addCard(BOOK, CARD);
  assert.equal(recall.list().length, 2, "重复加入不新增");
  assert.equal(JSON.stringify(recall.data.cards[card.key]), before, "重复加入不重置进度");

  // 4. 评分走的是同一套调度，历史同时记 key 和 path。
  await recall.rate(card.key, "good");
  const entry = recall.data.history.at(-1);
  assert.equal(entry.key, card.key);
  assert.equal(entry.path, BOOK);
  assert.ok(recall.data.cards[card.key].interval > 0, "评分后应排出下次间隔");
  assert.ok(recall.data.cards[card.key].due > Date.now(), "评分后不该还是到期状态");

  // 5. 教材改名，卡片键跟着走，笔记键不受影响。
  const renamed = "教材/数学分析 II.pdf";
  files.delete(BOOK); files.set(renamed, { path: renamed, extension: "pdf" });
  app.vault.trigger("rename", { path: renamed }, BOOK);
  await recall.queue;
  assert.ok(recall.has(`${renamed}#${CARD}`), "改名后卡片键应指向新路径");
  assert.equal(recall.has(`${BOOK}#${CARD}`), false, "旧键应删除");
  assert.equal(recall.has(NOTE), true, "笔记键不受教材改名影响");

  // 6. 文件不在了就不该出现在队列里（但数据留着，避免误删调度）。
  files.delete(renamed);
  assert.equal(recall.list().length, 1, "文件消失的条目不进队列");
  assert.equal(recall.has(`${renamed}#${CARD}`), true, "但数据仍在，文件回来还能接上");
  files.set(renamed, { path: renamed, extension: "pdf" });

  // 7. 移出队列用 key。
  await recall.remove(`${renamed}#${CARD}`);
  assert.equal(recall.list().length, 1);
  assert.equal(recall.list()[0].key, NOTE);

  // 8. 整篇加入仍然只接受 Markdown。
  await assert.rejects(() => recall.add(renamed), /Markdown/);
  await assert.rejects(() => recall.add("不存在.md"), /不存在/);

  // 9. 键的组合与拆分对得上。
  assert.equal(splitKey(makeKey(renamed, CARD)).path, renamed);

  console.log("闭环 A 通过：卡片入队 / 幂等 / 评分 / 改名跟随 / 文件消失 / 移出 / 笔记条目不受影响。");
})().catch((error) => { console.error(error); process.exitCode = 1; });
