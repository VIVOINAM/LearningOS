"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const m = require("../course-index");
const CN = require("../class-notes");

const COURSE = { id: "057274", title: "静力学与结构力学" };
const HOME = "03 知识库/我的课程/2026-27/057274 静力学与结构力学.md";

test("索引笔记和资料索引放在一起，不进「课堂笔记/」", () => {
  assert.equal(m.noteIndexPath(COURSE), "课程文件/057274 静力学与结构力学/057274 课堂笔记索引.md");
  assert.equal(m.examIndexPath(COURSE), "课程文件/057274 静力学与结构力学/057274 真题索引.md");
  assert.equal(CN.isClassNote(m.noteIndexPath(COURSE)), false);
});

test("笔记索引：只要这门课的课堂笔记，从早到晚，一行一个链接", () => {
  const paths = [
    CN.notePath(COURSE, "2026-09-24"),
    CN.notePath(COURSE, "2026-09-22"),
    CN.notePath({ id: "086552", title: "电工学" }, "2026-09-23"),
    HOME,
  ];
  const text = m.noteIndexText(COURSE, paths, HOME);
  const dir = CN.folderOf(COURSE);
  assert.match(text, /^# 057274 静力学与结构力学 · 课堂笔记\n/);
  assert.match(text, /\[\[03 知识库\/我的课程\/2026-27\/057274 静力学与结构力学\|静力学与结构力学\]\]/);
  assert.ok(text.includes(`## 共 2 篇\n\n- [[${dir}/2026-09-22 静力学与结构力学|2026-09-22 静力学与结构力学]]\n- [[${dir}/2026-09-24 静力学与结构力学|2026-09-24 静力学与结构力学]]\n`));
  assert.ok(!text.includes("电工学"));
  assert.match(m.noteIndexText({ id: "052475", title: "数学分析 II" }, paths, HOME), /还没有课堂笔记/);
});

test("真题索引：任何一层「03 真题」都算，本学年在前、往年在后，别的文件夹和别的课不算", () => {
  const paths = [
    "课程文件/057274 静力学与结构力学/往年 2025-26/03 真题/2025-02-10 期末 题目.pdf",
    "课程文件/057274 静力学与结构力学/03 真题/2024-01-18 期末 计算题 题目.pdf",
    "课程文件/057274 静力学与结构力学/03 真题/2023-11-07 期中1 静定结构题 解答.pdf",
    "课程文件/057274 静力学与结构力学/02 习题课/E01 Statica punto materiale.pdf",
    "课程文件/086552 电工学/03 真题/2024-01-18 期末 题目.pdf",
  ];
  assert.deepEqual(m.examEntries(COURSE, paths).map((e) => [e.name, e.group]), [
    ["2023-11-07 期中1 静定结构题 解答", ""],
    ["2024-01-18 期末 计算题 题目", ""],
    ["2025-02-10 期末 题目", "往年 2025-26"],
  ]);
  const text = m.examIndexText(COURSE, paths, HOME);
  const now = text.indexOf("## 本学年 2026-27（2）"), past = text.indexOf("## 往年 2025-26（1）");
  assert.ok(now > 0 && past > now);
  // 链接保留 .pdf 扩展名，否则 Obsidian 找不到文件。
  assert.ok(text.includes("- [[课程文件/057274 静力学与结构力学/03 真题/2023-11-07 期中1 静定结构题 解答.pdf|2023-11-07 期中1 静定结构题 解答]]"));
  assert.match(m.examIndexText({ id: "060112", title: "化工过程计算" }, paths, HOME), /还没有真题/);
});
