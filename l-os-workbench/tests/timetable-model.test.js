"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const m = require("../timetable-model");

const NOTE = `---
type: timetable
academic_year: 2026-2027
semester: 1
---
# 课表

| 星期 | 时间 | 课程 | 教室 | 起始日期 | 结束日期（官方原值） |
| --- | --- | --- | --- | --- | --- |
| 周一 | 08:15–10:15 | [[03 知识库/我的课程/2026-27/057274 静力学与结构力学\\|静力学与结构力学]] | 6.0.1 | 2026-09-14 | 2027-12-20 ⚠ 待核实 |
| 周一 | 08:15–11:15 | [[03 知识库/我的课程/2026-27/082919 数学分析 I 与几何\\|数学分析 I 与几何]] | 5.0.1 | 2026-09-14 | 2026-12-21 |
| 周一 | 10:15–12:15 | [[03 知识库/我的课程/2026-27/089257 流体力学与化工基础\\|流体力学与化工基础]] | 6.0.1 | 2026-09-14 | 2026-12-21 |
| 周二 | 8:15-10:15 | [[03 知识库/我的课程/2026-27/060112 化工过程计算\\|化工过程计算]] | 9.0.1 | 2026-09-15 | 2026-12-22 |
| 周四 | 16:15–18:15 | [[03 知识库/我的课程/2026-27/060112 化工过程计算\\|化工过程计算]] | 26.1.6 | 2026-09-17 | 2026-12-17 |
| 周八 | 16:15–18:15 | 坏行 | x | | |

## 教室位置

| 教室 | 地址及楼栋 | 楼层（官方标注） |
| --- | --- | --- |
| 6.0.1 | Piazza Leonardo da Vinci 32 · Edificio 6 | Piano Primo |
| 26.1.2、26.1.6 | Via Golgi 20 · Edificio 26 | Piano Primo |

## 课程名称与教师

| 代码 | LearningOS 课程 | 官方英文名称 | 教师 |
| --- | --- | --- | --- |
| 082919 | [[03 知识库/我的课程/2026-27/082919 数学分析 I 与几何\\|数学分析 I 与几何]] | MATHEMATICAL ANALYSIS I AND GEOMETRY | Dell'Oro Filippo |
`;

// 2026-09-21 是周一。new Date(y, m, d, h, min) 走本地时间，和插件一致。
const at = (d, h = 12, min = 0) => new Date(2026, 8, d, h, min);

test("解析：带 \\| 的课程链接、单位数小时、官方可疑值、教室表", () => {
  const t = m.parseTimetable(NOTE);
  assert.equal(t.meta.type, "timetable");
  assert.equal(t.slots.length, 5);
  assert.deepEqual(t.skipped.length, 1, "坏行不丢，要能说出来");
  const [first] = t.slots;
  assert.deepEqual(first.course, { id: "057274", title: "静力学与结构力学", link: "03 知识库/我的课程/2026-27/057274 静力学与结构力学" });
  assert.equal(first.doubtful, true);
  assert.equal(first.officialTo, "2027-12-20", "官方原值留着，界面要能说出来");
  assert.equal(first.to, "2026-12-22", "但按本学期最晚结束日截断，不画进第二学期");
  assert.equal(t.semesterEnd, "2026-12-22");
  assert.equal(m.activeOn(first, "2027-03-01"), false);
  const tue = t.slots.find((s) => s.day === 2);
  assert.equal(tue.start, "08:15", "8:15 补零，否则字符串比较会错");
  assert.equal(t.rooms["26.1.6"].address, "Via Golgi 20 · Edificio 26");
  assert.equal(t.rooms["26.1.2"].floor, "Piano Primo");
  assert.deepEqual(t.courses["082919"], { teacher: "Dell'Oro Filippo", official: "MATHEMATICAL ANALYSIS I AND GEOMETRY" });
});

test("仓库里真实的课表笔记能被解析，且没有解析不了的行", () => {
  const fs = require("node:fs"), path = require("node:path");
  const file = path.resolve(__dirname, "../../../00 工作台/Polimi 2026-27 第一学期课表.md");
  if (!fs.existsSync(file)) return;
  const t = m.parseTimetable(fs.readFileSync(file, "utf8"));
  assert.ok(t.slots.length >= 10);
  assert.deepEqual(t.skipped, []);
  for (const slot of t.slots) {
    assert.match(slot.course.id, /^\d{6}$/, `课程代码没解析出来：${slot.course.title}`);
    assert.ok(slot.room, `${slot.course.title} 没有教室`);
  }
});

test("重叠分列：互相重叠的一簇并排，不重叠的独占整宽", () => {
  const t = m.parseTimetable(NOTE);
  const monday = t.slots.filter((s) => s.day === 1);
  const out = m.lanes(monday);
  const by = (id) => out.find((x) => x.slot.course.id === id);
  assert.equal(by("057274").lanes, 2);
  assert.equal(by("082919").lanes, 2);
  // 同时开始的，长的那节放左边；10:15 那节接在 08:15–10:15 空出来的那一列
  assert.equal(by("082919").lane, 0);
  assert.equal(by("057274").lane, 1);
  assert.equal(by("089257").lane, 1);
  assert.equal(by("089257").lanes, 2);
  const solo = m.lanes([t.slots.find((s) => s.day === 2)]);
  assert.deepEqual([solo[0].lane, solo[0].lanes], [0, 1]);
});

test("起止日期：学期外不上课；周视图不画空的周末", () => {
  const t = m.parseTimetable(NOTE);
  const statics = t.slots[0];
  assert.equal(m.activeOn(statics, "2026-09-14"), true);
  assert.equal(m.activeOn(statics, "2026-09-07"), false);
  const week = m.weekView(t.slots, at(23));
  assert.equal(week.monday, "2026-09-21");
  assert.deepEqual(week.days.map((d) => d.label), ["周一", "周二", "周三", "周四", "周五"]);
  assert.equal(week.count, 5);
  const before = m.weekView(t.slots, new Date(2026, 8, 9, 12));
  assert.equal(before.count, 0);
});

test("今天的课：已结束 / 进行中 / 下一节只有一个", () => {
  const t = m.parseTimetable(NOTE);
  const states = m.todayAgenda(t.slots, at(21, 10, 30)).map((x) => `${x.slot.course.id}:${x.state}`);
  assert.deepEqual(states, ["057274:done", "082919:now", "089257:now"]);
  const early = m.todayAgenda(t.slots, at(21, 7, 0)).map((x) => x.state);
  assert.deepEqual(early, ["next", "later", "later"]);
});

test("下一节课：跨天、相对说法", () => {
  const t = m.parseTimetable(NOTE);
  const n = m.nextClass(t.slots, at(21, 11, 0));
  assert.equal(n.slot.start, "08:15");
  assert.equal(n.key, "2026-09-22");
  assert.equal(m.relative(n), "明天 08:15");
  const soon = m.nextClass(t.slots, at(21, 9, 45));
  assert.equal(soon.slot.start, "10:15");
  assert.equal(m.relative(soon), "30 分钟后");
  assert.equal(m.relative(m.nextClass(t.slots, at(21, 7, 0))), "1 小时 15 分后");
  assert.equal(m.nextClass([], at(21)), null);
});

test("冲突：同一天时间重叠才算", () => {
  const t = m.parseTimetable(NOTE);
  const c = m.conflicts(t.slots);
  assert.deepEqual(c.map((x) => `${x.start}-${x.end}`), ["08:15-10:15", "10:15-11:15"]);
});

test("学期周次与时间轴", () => {
  const t = m.parseTimetable(NOTE);
  assert.equal(m.weekNumber(t.slots, at(14)), 1);
  assert.equal(m.weekNumber(t.slots, at(23)), 2);
  assert.equal(m.weekNumber(t.slots, new Date(2026, 8, 1)), 0);
  assert.deepEqual(m.hourRange(t.slots), { first: 8, last: 19 }, "18:15 下课，时间轴要画到 19 点");
});

test("hidden_courses：不画、不算冲突，但官方行照样解析、学期起止不变", () => {
  const withHidden = NOTE.replace("semester: 1\n", 'semester: 1\nhidden_courses: ["082919"]\n');
  const all = m.parseTimetable(NOTE), t = m.parseTimetable(withHidden);
  assert.equal(t.slots.length, all.slots.length - 1);
  assert.deepEqual(t.hiddenSlots.map((s) => s.course.id), ["082919"]);
  assert.ok(!t.slots.some((s) => s.course.id === "082919"));
  assert.deepEqual(m.conflicts(t.slots), [], "数学分析一藏，官方那几处重叠就没有了");
  assert.equal(t.semesterEnd, all.semesterEnd);
  // YAML 的几种写法都认：列表、逗号、单个值
  assert.equal(m.parseTimetable(NOTE.replace("semester: 1\n", "semester: 1\nhidden_courses: 082919, 057274\n")).hiddenSlots.length, 2);
  // Obsidian 属性面板写出来的多行列表
  const block = m.parseTimetable(NOTE.replace("semester: 1\n", 'semester: 1\nhidden_courses:\n  - "082919"\n'));
  assert.deepEqual(block.hiddenSlots.map((s) => s.course.id), ["082919"]);
  assert.equal(block.meta.semester, "1");
});

test("配色按课程代码定，表格换行序不换颜色", () => {
  const t = m.parseTimetable(NOTE);
  const a = m.palette(t.slots), b = m.palette([...t.slots].reverse());
  assert.deepEqual([...a], [...b]);
  assert.equal(a.get("057274"), 1);
});
