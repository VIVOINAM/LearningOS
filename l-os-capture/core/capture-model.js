"use strict";

/**
 * L-OS 3.0 · 捕获与任务模型纯逻辑
 *
 * 统一规则：
 * 1. 复选框 `- [x]` 是完成状态的唯一真值；
 * 2. `<!-- done:YYYY-MM-DD -->` 只作为完成日期补充，不再参与“是否完成”判断；
 * 3. 未勾选却残留 done 标记的行，在整理时删掉 done 标记，防止统计自相矛盾；
 * 4. 所有统计只从这一套解析器出，首页 / 日记汇总 / 任务笔记共用。
 */

const TASK_RE = /^(\s*)- \[([ xX])\]\s+(.*)$/;
const DONE_RE = /<!--\s*done:(\d{4}-\d{2}-\d{2})\s*-->/;
const META_RE = /\s*<!--[\s\S]*?-->/g;

function clean(value) {
  return String(value == null ? "" : value)
    .replace(/[\r\n]+/g, " ")
    .trim();
}

const { day } = require("../../shared/date");

function timeLabel(time = Date.now()) {
  const date = new Date(time);
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map(value => String(value).padStart(2, "0"))
    .join(":");
}

function sanitizeProjectName(value) {
  return clean(value)
    .replace(/[\\/:*?"<>|#\[\]^]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 80)
    .trim();
}

function taskLine(text, now = Date.now()) {
  const title = clean(text);
  if (!title) throw new Error("任务内容不能为空。");
  return `- [ ] ${title} <!-- task:${now} -->`;
}

function inboxEntry(text, now = Date.now()) {
  const body = String(text || "").trim();
  if (!body) throw new Error("随手记内容不能为空。");
  return `## ${day(now)} ${timeLabel(now)}\n\n${body}`;
}

function parseTaskLines(content) {
  return String(content || "")
    .split("\n")
    .map((raw, index) => {
      const match = raw.replace(/\r$/, '').match(TASK_RE);
      if (!match) return null;

      const done = match[2].toLowerCase() === "x";
      const metadata = raw.match(/<!--[\s\S]*?-->/g) || [];
      const doneMatch = raw.match(DONE_RE);
      const text = match[3].replace(META_RE, "").trim();

      return {
        index,
        raw,
        text,
        done,
        doneDate: doneMatch ? doneMatch[1] : null,
        metadata,
      };
    })
    .filter(Boolean);
}

/**
 * 整理任务行：未勾选行删除残留 done 标记；返回新文本与改动条数。
 */
function normalizeTaskLines(content) {
  let changed = 0;
  const lines = String(content || "").split("\n").map(raw => {
    const match = raw.replace(/\r$/, '').match(TASK_RE);
    if (!match) return raw;
    const done = match[2].toLowerCase() === "x";
    if (done) return raw;
    if (!DONE_RE.test(raw)) return raw;
    changed += 1;
    return raw.replace(/\s*<!--\s*done:\d{4}-\d{2}-\d{2}\s*-->/g, "");
  });
  return { content: lines.join("\n"), changed };
}

function taskStats(content, dateKey = day()) {
  const tasks = parseTaskLines(content);
  return {
    open: tasks.filter(task => !task.done).length,
    doneToday: tasks.filter(task => task.done && task.doneDate === dateKey).length,
    doneUnknownDate: tasks.filter(task => task.done && !task.doneDate).length,
    total: tasks.length,
  };
}

/**
 * 勾选任务：按原始行匹配（优先 index），避免行号漂移；重复调用幂等。
 */
function markTaskDone(content, task, dateKey = day()) {
  const lines = String(content || "").split("\n");
  let index = Number.isInteger(task?.index) && lines[task.index] === task.raw ? task.index : lines.indexOf(task?.raw);
  if (index < 0) throw new Error("任务已被修改，请刷新后重试。");

  let line = lines[index];
  line = line.replace(/^(\s*)- \[[ xX]\]/, "$1- [x]");
  if (!DONE_RE.test(line)) line += ` <!-- done:${dateKey} -->`;
  lines[index] = line;
  return lines.join("\n");
}

function removeTaskLine(content, task) {
  const lines = String(content || "").split("\n");
  const index = Number.isInteger(task?.index) && lines[task.index] === task.raw ? task.index : lines.indexOf(task?.raw);
  if (index < 0) throw new Error("任务已被修改，请刷新后重试。");
  lines.splice(index, 1);
  return lines.join("\n");
}

function projectTemplate(name) {
  return [
    "---",
    "type: project",
    "status: 进行中",
    "next: 写下第一个可执行动作",
    "due: ",
    "---",
    `# ${name}`,
    "",
    '<div class="cw-return-home"><a href="#l-os-workbench-home">⌂ 返回工作台首页</a></div>',
    "",
    "## 目标",
    "",
    "## 下一步行动",
    "",
    "## 资料与记录",
    "",
    "## 回顾",
    "",
  ].join("\n");
}

function renameProjectContent(content, name) {
  const title = sanitizeProjectName(name);
  if (!title) throw new Error("项目名称不能为空");
  const source = String(content || "");
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  const heading = lines.findIndex(line => /^\s*#\s+/.test(line));
  if (heading >= 0) {
    lines[heading] = `# ${title}`;
    return lines.join(eol);
  }

  const frontmatterEnd = lines[0]?.trim() === "---"
    ? lines.findIndex((line, index) => index > 0 && line.trim() === "---")
    : -1;
  lines.splice(frontmatterEnd >= 0 ? frontmatterEnd + 1 : 0, 0, `# ${title}`, "");
  return lines.join(eol);
}

module.exports = {clean, day, timeLabel, sanitizeProjectName, taskLine, inboxEntry, parseTaskLines, normalizeTaskLines, taskStats, markTaskDone, removeTaskLine, projectTemplate, renameProjectContent};
