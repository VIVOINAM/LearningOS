"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { insertQuickNote } = require("../scratchpad-model.js");

const WHEN = new Date(2026, 8, 19, 14, 8);

test("闪念插进随手记录并保留后续日记结构", () => {
  const daily = "# 2026-09-19\n\n## 随手记录\n\n## 今日复盘\n- 今天推进了什么：\n";
  const next = insertQuickNote(daily, "动量是 $p=mv$。", WHEN);
  assert.match(next, /## 随手记录\n\n### 闪念 14:08\n\n动量是 \$p=mv\$。\n\n## 今日复盘/);
  assert.match(next, /- 今天推进了什么：/);
});

test("没有随手记录小节时补建，空内容不改文件", () => {
  const daily = "# 2026-09-19\n";
  assert.equal(insertQuickNote(daily, "", WHEN), daily);
  assert.match(insertQuickNote(daily, "一个想法", WHEN), /## 随手记录\n\n### 闪念 14:08\n\n一个想法/);
});
