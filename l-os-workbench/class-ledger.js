"use strict";

/**
 * 课堂回顾的账本：课表上的每一节课，笔记写到哪一步了。
 *
 * 回顾页原来是一份「这一天」的时间审计，外加几个复盘输入框，写进日记——十几篇日记里
 * 那几个框一个字都没填过。真正每天在写的是课堂笔记，所以回顾改成对课堂笔记的账：
 * 上一个上课日该补的、今天该记的、下一个上课日该准备的，再加上更早还没写完的。
 *
 * - 哪些课要记：课表里有时间的课（`hidden_courses` 已经在解析时去掉），
 *   再去掉课表 frontmatter 里 `no_notes` 列出的。和 hidden_courses 分开：
 *   「不去上」和「去上但不记笔记」是两回事，前者连课表页都不画。
 * - 状态四级：未建 → 空壳（只有模板）→ 不足两页 → 已总结。
 *   页数是翻页阅读里的页，按一个固定的参考页面量（见 note-pages.js），不按当前窗口：
 *   窗口一缩放状态就来回跳，而「已总结」会顺手勾掉任务，勾掉的不会再撤回。
 * - 「上一个 / 下一个上课日」按有课的日子算，不按日历：周末的「昨天」是一片空白。
 *
 * 纯函数，不依赖 Obsidian，可直接 node --test。
 */

const TT = require("./timetable-model");

/** 超过这么多页算写完了（「总结要超过两页」）。 */
const TARGET_PAGES = 2;
/** 「更早还没写完」往回看多少天。再早的就是翻篇了，堆在那里只会让人不想打开这一页。 */
const BACKLOG_DAYS = 14;
/** 往前 / 往后找上课日最多找多少天（寒假、考试周都在这个范围里）。 */
const SEARCH_DAYS = 45;

const dateOf = (key) => new Date(`${key}T12:00:00`);
const shift = (key, n) => TT.keyOf(TT.addDays(dateOf(key), n));

/** 课表 frontmatter 里列出的「不记笔记」课程代码。 */
function skipped(meta = {}) {
  return new Set(String(meta.no_notes || "").match(/\d{6}/g) || []);
}

/** 课表里有时间的课，按第一次出现的顺序：[{course, on}]。on=false 是在 no_notes 里。 */
function timetableCourses(timetable) {
  const skip = skipped(timetable?.meta);
  const out = new Map();
  for (const slot of timetable?.slots || []) {
    if (!out.has(slot.course.id)) out.set(slot.course.id, { course: slot.course, on: !skip.has(slot.course.id) });
  }
  return [...out.values()];
}

/** 要记笔记的课的代码。 */
function noteCourseIds(timetable) {
  return new Set(timetableCourses(timetable).filter((c) => c.on).map((c) => c.course.id));
}

/** 这一天要记笔记的课，同一门课一天几节并成一项：[{course, sessions}]，按第一节开始时间排。 */
function coursesOn(slots = [], ids, key) {
  const out = new Map();
  const list = slots.filter((s) => ids.has(s.course.id) && TT.activeOn(s, key))
    .sort((a, b) => TT.minutes(a.start) - TT.minutes(b.start));
  for (const slot of list) {
    if (!out.has(slot.course.id)) out.set(slot.course.id, { course: slot.course, sessions: [] });
    out.get(slot.course.id).sessions.push(slot);
  }
  return [...out.values()];
}

/** 从 key 往 dir（-1 / 1）方向找最近的上课日，不含 key 本身。找不到返回 ""。 */
function classDay(slots, ids, key, dir, limit = SEARCH_DAYS) {
  for (let i = 1; i <= limit; i++) {
    const candidate = shift(key, dir * i);
    if (coursesOn(slots, ids, candidate).length) return candidate;
  }
  return "";
}

/**
 * 笔记是不是只有模板：标题、那一行「时间 · 教室 · 课程主页」、「课堂记录」「课后总结」两个空标题。
 * 自己写的一个字都算内容。
 */
function isShell(text) {
  const body = String(text || "").replace(/^﻿?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
  const lines = body.split(/\r?\n/);
  let seenTitle = false, seenInfo = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!seenTitle && /^# /.test(line)) { seenTitle = true; continue; }
    if (seenTitle && !seenInfo && (/\|课程主页\]\]/.test(line) || /^\d{1,2}:\d{2}\s*[–—-]/.test(line))) { seenInfo = true; continue; }
    if (/^##\s*(课堂记录|课后总结)\s*$/.test(line)) continue;
    return false;
  }
  return true;
}

/**
 * 一篇笔记的状态。note：{exists, shell, pages}；pages 为 null 表示还没量出来。
 * missing 未建 · empty 空壳 · measuring 正在量 · short 不足两页 · done 已总结
 */
function noteStatus(note) {
  if (!note?.exists) return "missing";
  if (note.shell) return "empty";
  if (note.pages == null) return "measuring";
  return note.pages > TARGET_PAGES ? "done" : "short";
}

const STATUS_LABEL = { missing: "未建", empty: "空壳", measuring: "正在量页数", short: "不足两页", done: "已总结" };

/**
 * 回顾页的全部数据。
 *
 * - timetable：插件的 timetable()（已去掉 hidden_courses）。
 * - today：YYYY-MM-DD。
 * - note(course, key)：{path, exists, shell, pages}，由插件从库里查。
 * - since：最早一篇课堂笔记的日期。「更早还没写完」不往它之前算——开始记笔记之前的课
 *   一节一节列成「未建」，是在追一笔从来没打算记的账。
 *
 * 返回 {courses, prev, today, next, backlog}；prev / today / next 是 {key, rows}，
 * 找不到上课日时 key 为 ""。行：{course, sessions, key, note, status}。
 */
function buildLedger({ timetable, today, note, since = "" }) {
  const slots = timetable?.slots || [];
  const ids = noteCourseIds(timetable);
  const rows = (key) => key ? coursesOn(slots, ids, key).map(({ course, sessions }) => {
    const n = note(course, key);
    return { course, sessions, key, note: n, status: noteStatus(n) };
  }) : [];
  const prevKey = classDay(slots, ids, today, -1);
  const nextKey = classDay(slots, ids, today, 1);
  const backlog = [];
  if (since && prevKey) {
    const from = [since, shift(today, -BACKLOG_DAYS)].sort().at(-1);
    for (let key = shift(prevKey, -1); key >= from; key = shift(key, -1)) {
      for (const row of rows(key)) if (row.status !== "done") backlog.push(row);
    }
  }
  return {
    courses: timetableCourses(timetable),
    prev: { key: prevKey, rows: rows(prevKey) },
    today: { key: today, rows: rows(today) },
    next: { key: nextKey, rows: rows(nextKey) },
    backlog,
  };
}

module.exports = {
  TARGET_PAGES, BACKLOG_DAYS, STATUS_LABEL,
  skipped, timetableCourses, noteCourseIds, coursesOn, classDay, isShell, noteStatus, buildLedger,
};
