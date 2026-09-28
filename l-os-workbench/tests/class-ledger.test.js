"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const L = require("../class-ledger");
const TT = require("../timetable-model");
const CN = require("../class-notes");

// 喂仓库里那篇真的课表：hidden_courses 去掉数学分析 I 之后，剩下有时间的是四门课。
const VAULT = path.resolve(__dirname, "../../..");
const REAL = fs.readFileSync(path.join(VAULT, "00 工作台/Polimi 2026-27 第一学期课表.md"), "utf8");
const real = () => ({ path: "课表.md", ...TT.parseTimetable(REAL) });
const withSkip = (ids) => {
  const t = real();
  t.meta = { ...t.meta, no_notes: ids.join(", ") };
  return t;
};

test("要记笔记的课：课表上有时间的课，去掉 hidden_courses 和 no_notes", () => {
  const ids = [...L.noteCourseIds(real())].sort();
  assert.deepEqual(ids, ["057274", "060112", "086552", "089257"]);
  assert.ok(!ids.includes("082919"), "数学分析 I 只为考试资格选课，不去上，也不记笔记");
  const skipped = L.timetableCourses(withSkip(["060112"]));
  assert.equal(skipped.length, 4, "不记笔记的课仍列在选择框里，只是不勾");
  assert.equal(skipped.find((c) => c.course.id === "060112").on, false);
  assert.ok(!L.noteCourseIds(withSkip(["060112"])).has("060112"));
});

test("no_notes 也认 Obsidian 属性面板写成的多行列表", () => {
  const text = REAL.replace("hidden_courses:", "no_notes:\n  - \"086552\"\nhidden_courses:");
  assert.ok(!L.noteCourseIds({ ...TT.parseTimetable(text) }).has("086552"));
});

test("一天的课按课程并项，按第一节开始时间排", () => {
  const t = real(), ids = L.noteCourseIds(t);
  // 2026-09-22 周二：化工过程计算 08:15、流体力学 10:15、静力学 14:15（数学分析 I 被隐藏）
  const day = L.coursesOn(t.slots, ids, "2026-09-22");
  assert.deepEqual(day.map((d) => d.course.id), ["060112", "089257", "057274"]);
  // 周一流体力学上两节（10:15 和 13:15），并成一项
  const monday = L.coursesOn(t.slots, ids, "2026-09-21");
  const fluid = monday.find((d) => d.course.id === "089257");
  assert.deepEqual(fluid.sessions.map((s) => s.start), ["10:15", "13:15"]);
});

test("上一个 / 下一个上课日按有课的日子算：周六的上次是周四，下次是周一", () => {
  const t = real(), ids = L.noteCourseIds(t);
  assert.equal(L.classDay(t.slots, ids, "2026-09-26", -1), "2026-09-24");
  assert.equal(L.classDay(t.slots, ids, "2026-09-26", 1), "2026-09-28");
  // 学期开始之前没有上次
  assert.equal(L.classDay(t.slots, ids, "2026-09-14", -1), "");
});

test("空壳：只剩模板的笔记；自己写的一个字都算内容", () => {
  const course = { id: "060112", title: "化工过程计算" };
  const shell = CN.noteTemplate({ course, key: "2026-09-22", sessions: [{ start: "08:15", end: "10:15", room: "9.0.1" }], coursePath: "03 知识库/我的课程/2026-27/060112 化工过程计算.md" });
  assert.equal(L.isShell(shell), true);
  assert.equal(L.isShell(CN.noteTemplate({ course, key: "2026-09-22" })), true, "没有时段、没有课程主页的模板也是空壳");
  assert.equal(L.isShell(shell.replace("## 课堂记录\n", "## 课堂记录\n\n质量守恒\n")), false);
  assert.equal(L.isShell(shell + "\n![[板书.png]]\n"), false);
  // 库里的空壳迟早会写满（原先当样本的 09-22 化工过程计算已补写），所以空壳只用上面的模板查；
  // 库里写满了的静力学不是空壳。
  const notes = path.join(VAULT, CN.ROOT);
  const read = (p) => fs.readFileSync(path.join(notes, p), "utf8");
  assert.equal(L.isShell(read("057274 静力学与结构力学/2026-09-24 静力学与结构力学.md")), false);
});

test("状态：超过两页才算已总结，刚好两页不算", () => {
  assert.equal(L.noteStatus({ exists: false }), "missing");
  assert.equal(L.noteStatus({ exists: true, shell: true, pages: 0 }), "empty");
  assert.equal(L.noteStatus({ exists: true, shell: false, pages: null }), "measuring");
  assert.equal(L.noteStatus({ exists: true, shell: false, pages: 1.4 }), "short");
  assert.equal(L.noteStatus({ exists: true, shell: false, pages: 2 }), "short");
  assert.equal(L.noteStatus({ exists: true, shell: false, pages: 2.1 }), "done");
});

test("账本：周六看上周四、今天没课、下周一；更早没写完的不往开始记笔记之前追", () => {
  const t = real();
  const written = {
    "2026-09-22/057274": 3.1, "2026-09-22/089257": 1.2, "2026-09-22/060112": "shell",
    "2026-09-24/057274": 2.6, "2026-09-24/086552": 1.8,
  };
  const note = (course, key) => {
    const w = written[`${key}/${course.id}`];
    if (w === undefined) return { exists: false, shell: false, pages: null };
    return w === "shell" ? { exists: true, shell: true, pages: 0 } : { exists: true, shell: false, pages: w };
  };
  const ledger = L.buildLedger({ timetable: t, today: "2026-09-26", note, since: "2026-09-22" });
  assert.equal(ledger.prev.key, "2026-09-24");
  assert.deepEqual(ledger.prev.rows.map((r) => [r.course.id, r.status]), [["057274", "done"], ["086552", "short"], ["060112", "missing"]]);
  assert.deepEqual(ledger.today.rows, []);
  assert.equal(ledger.next.key, "2026-09-28");
  assert.deepEqual(ledger.next.rows.map((r) => r.course.id), ["057274", "089257", "086552"]);
  // 9/23 周三三门课都没有笔记，9/22 缺一篇、空壳一篇、不足两页一篇；写完的 9/22 静力学不在里面。
  // 9/21 周一在开始记笔记之前，不算。新的在前。
  assert.deepEqual(ledger.backlog.map((r) => `${r.key} ${r.course.id} ${r.status}`), [
    "2026-09-23 086552 missing", "2026-09-23 089257 missing", "2026-09-23 057274 missing",
    "2026-09-22 060112 empty", "2026-09-22 089257 short",
  ]);
});

test("账本：还没开始记笔记时没有欠账；更早的只往回看两周", () => {
  const t = real(), note = () => ({ exists: false, shell: false, pages: null });
  assert.deepEqual(L.buildLedger({ timetable: t, today: "2026-09-26", note, since: "" }).backlog, []);
  const late = L.buildLedger({ timetable: t, today: "2026-11-20", note, since: "2026-09-22" });
  assert.ok(late.backlog.every((r) => r.key >= "2026-11-06"), late.backlog.map((r) => r.key).join(" "));
  assert.ok(late.backlog.length > 0);
});
