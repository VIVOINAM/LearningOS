"use strict";

/**
 * 课程卡上「笔记」「真题」两个按钮打开的索引笔记，和资料索引放在一起：
 *
 *   课程文件/057274 静力学与结构力学/057274 课堂笔记索引.md
 *   课程文件/057274 静力学与结构力学/057274 真题索引.md
 *
 * 一行一个链接，按文件名排——课堂笔记和真题的文件名都以日期开头，按名排就是按时间。
 * 整篇由工作台生成，每次重写；课程主页不再列这些。
 * 不放进「课堂笔记/」：那里的每篇 md 都会被当成课堂笔记，进「总结」页、挂阅读栏。
 *
 * 纯函数，不依赖 Obsidian，可直接 node --test。
 */

const CN = require("./class-notes");

const FILES = "课程文件";
const EXAMS = "03 真题";
const byName = (a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }) || a.path.localeCompare(b.path, "zh-CN");
const baseName = (path) => path.split("/").pop().replace(/\.[^.]+$/, "");
const courseFolder = (course) => `${FILES}/${course.id} ${course.title}`;
const noteIndexPath = (course) => `${courseFolder(course)}/${course.id} 课堂笔记索引.md`;
const examIndexPath = (course) => `${courseFolder(course)}/${course.id} 真题索引.md`;
const link = (path, name) => `- [[${path.replace(/\.md$/, "")}|${name}]]`;

/** 这门课的课堂笔记：[{path, name}]，从早到晚。按课程代码认，不看课名。 */
function noteEntries(course, paths = []) {
  return paths.filter((path) => CN.parseNotePath(path)?.course.id === course.id)
    .map((path) => ({ path, name: baseName(path) }))
    .sort(byName);
}

/**
 * 这门课的真题：课程文件夹里任何一层「03 真题」下面的文件，本学年和「往年 2025-26/03 真题」都算。
 * group 是去掉「03 真题」之后的位置：本学年的为空，往年的是「往年 2025-26」。
 */
function examEntries(course, paths = []) {
  const root = `${FILES}/${course.id} `;
  return paths.filter((path) => path.startsWith(root) && path.split("/").slice(2, -1).includes(EXAMS))
    .map((path) => ({ path, name: baseName(path), group: path.split("/").slice(2, -1).filter((s) => s !== EXAMS).join(" / ") }))
    .sort(byName);
}

function header(course, what, homePath) {
  return [
    `# ${course.id} ${course.title} · ${what}`,
    "",
    `课程主页：[[${homePath.replace(/\.md$/, "")}|${course.title}]] · 资料：[[${courseFolder(course)}/${course.id} 资料索引|资料索引]]`,
    `由工作台生成，按文件名（日期开头）排序；在课程卡上点「${what === "课堂笔记" ? "笔记" : "真题"}」会重新生成。`,
    "",
  ];
}

function noteIndexText(course, paths, homePath) {
  const entries = noteEntries(course, paths);
  return [
    ...header(course, "课堂笔记", homePath),
    `## 共 ${entries.length} 篇`,
    "",
    ...(entries.length ? entries.map((e) => link(e.path, e.name)) : ["还没有课堂笔记。上课那天在今日页「今天的课」点这门课，会自动建一篇。"]),
    "",
  ].join("\n");
}

function examIndexText(course, paths, homePath) {
  const entries = examEntries(course, paths);
  const groups = new Map();
  for (const e of entries) {
    if (!groups.has(e.group)) groups.set(e.group, []);
    groups.get(e.group).push(e);
  }
  // 本学年在前，往年在后。
  const order = [...groups.keys()].sort((a, b) => (a ? 1 : 0) - (b ? 1 : 0) || a.localeCompare(b, "zh-CN"));
  const body = order.flatMap((g) => [`## ${g || "本学年 2026-27"}（${groups.get(g).length}）`, "", ...groups.get(g).map((e) => link(e.path, e.name)), ""]);
  return [
    ...header(course, "往年真题", homePath),
    ...(body.length ? body : ["这门课还没有真题。下载后放进课程文件夹的「03 真题」，往届的放「往年 2025-26/03 真题」。", ""]),
  ].join("\n");
}

module.exports = { noteEntries, examEntries, noteIndexPath, examIndexPath, noteIndexText, examIndexText };
