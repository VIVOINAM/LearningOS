"use strict";

/**
 * 课堂笔记：一节课一篇，按课程分文件夹。
 *
 *   03 知识库/我的课程/2026-27/课堂笔记/060112 化工过程计算/2026-09-22 化工过程计算.md
 *   03 知识库/我的课程/2026-27/课堂笔记/060112 化工过程计算/附件/2026-09-22 化工过程计算 101530.png
 *
 * 文件夹和 课程文件/ 一样叫「代码 中文名」，文件名以日期开头——按名排序就是按时间。
 * 同一门课一天只有一篇：一天上两次的课记在同一页上，任务也只挂一条。
 *
 * 纯函数，不依赖 Obsidian，可直接 node --test。
 */

const ROOT = "03 知识库/我的课程/2026-27/课堂笔记";
const CATEGORY = "课堂笔记";
const WEEKDAY = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const pad = (n) => String(n).padStart(2, "0");
const keyOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
/** 文件名里不能有的字符换成全角，免得课名里偶尔的「/」把路径切开。 */
const safe = (s) => String(s).replace(/[\\/:*?"<>|#^[\]]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).trim();

const folderOf = (course) => `${ROOT}/${course.id} ${safe(course.title)}`;
const notePath = (course, key) => `${folderOf(course)}/${key} ${safe(course.title)}.md`;
const attachmentFolder = (course) => `${folderOf(course)}/附件`;

/** 反过来：从路径认出是哪门课哪一天。不是课堂笔记返回 null。 */
function parseNotePath(path) {
  const m = new RegExp(`^${ROOT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/(\\d{6}) ([^/]+)/(\\d{4}-\\d{2}-\\d{2}) [^/]+\\.md$`).exec(String(path || ""));
  return m ? { course: { id: m[1], title: m[2] }, key: m[3] } : null;
}
const isClassNote = (path) => !!parseNotePath(path);

/**
 * 新笔记的正文。属性面板在这个库里是隐藏的，所以日期、时间、教室在正文第一行再写一遍——
 * frontmatter 给机器读，那一行给人读。不预填示例内容。
 */
function noteTemplate({ course, key, sessions = [], coursePath = "" }) {
  const date = new Date(`${key}T12:00:00`);
  const times = sessions.map((s) => `${s.start}–${s.end}`);
  const rooms = [...new Set(sessions.map((s) => s.room).filter(Boolean))];
  const places = [...new Set(sessions.map((s) => s.address).filter(Boolean))];
  const yaml = [
    "---",
    "type: class-note",
    `course: "${course.id}"`,
    `course_title: ${course.title}`,
    `date: ${key}`,
    times.length ? `time: ${times.join(", ")}` : "",
    rooms.length ? `room: ${rooms.join(", ")}` : "",
    "cssclasses:",
    "  - class-note",
    "---",
  ].filter(Boolean);
  const line = [...times, ...rooms, ...places, coursePath ? `[[${coursePath.replace(/\.md$/, "")}|课程主页]]` : ""].filter(Boolean).join(" · ");
  return [
    ...yaml,
    `# ${course.title} · ${date.getMonth() + 1} 月 ${date.getDate()} 日（${WEEKDAY[date.getDay()]}）`,
    "",
    line,
    "",
    "## 课堂记录",
    "",
    "",
    "## 课后总结",
    "",
    "",
  ].join("\n");
}

/** 自动任务的标签：日期 + 课程代码。用它认「这一条已经建过了」，删掉的也算，免得删了又冒出来。 */
const taskTag = (key, id) => `${CATEGORY}/${key}/${id}`;

/**
 * 今天每门课一条「总结笔记」任务。标题统一成「总结笔记 · 课名 · 月-日」：
 * 带日期是因为没做完的会留到明天，明天同一门课又会来一条，两条得分得开。
 * 默认 P2、一个番茄；不挂项目——一天三四节课，挂在「下一步行动」里就够了。
 */
function taskSpec(course, key) {
  return {
    title: `总结笔记 · ${course.title} · ${key.slice(5)}`,
    category: CATEGORY,
    priority_level: "P2",
    estimated_pomodoros: 1,
    scheduled: key,
    tags: taskTag(key, course.id),
    references: notePath(course, key),
  };
}

/** 任务是哪门课的自动任务：从标签读课程代码，排序时用它接上课程紧迫度。 */
function courseOfTask(task) {
  const m = new RegExp(`(?:^|[\\s,])${CATEGORY}/\\d{4}-\\d{2}-\\d{2}/(\\d{6})(?=$|[\\s,])`).exec(String(task?.tags || ""));
  return m ? m[1] : "";
}
const hasTaskTag = (task, tag) => String(task?.tags || "").split(/[\s,]+/).includes(tag);

/**
 * 今天的课按课程归并：[{course, sessions:[slot…]}]，按第一节的开始时间排。
 * agenda 是 timetable-model.todayAgenda 的结果。
 */
function todayCourses(agenda = []) {
  const out = new Map();
  for (const { slot } of agenda) {
    if (!out.has(slot.course.id)) out.set(slot.course.id, { course: slot.course, sessions: [] });
    out.get(slot.course.id).sessions.push(slot);
  }
  return [...out.values()];
}

/**
 * 把别处复制来的 LaTeX 改写成 Obsidian 认的写法。
 *
 * Obsidian 只认 `$…$` 和 `$$…$$`。从 ChatGPT、Overleaf、讲义源码复制过来的公式
 * 多半是 `\(…\)`、`\[…\]`，或者光着的 `\begin{align}…\end{align}`——粘进来只是一串反斜杠。
 * 这里只改分隔符，不碰公式本身；代码块、行内代码和已经是 `$` 的公式原样跳过。
 * `\\[4pt]`（换行加间距）前面还有一个反斜杠，不是 `\[`，不能误伤。
 *
 * 和 codex-study/core/formula-model 不是一回事：那个管侧栏速记的一小段，会截断到两万字、
 * 压掉所有连续空行、把单独一个公式提成独立公式——拿来改一整篇笔记，这三样都是破坏。
 */
const ENVS = "equation|align|alignat|gather|multline|flalign|eqnarray";
// 一遍扫完，最左边的先匹配：`\[ \begin{align}…\end{align} \]` 只包一层 `$$`，
// `\[…\]` 里面的 `\(` 也跟着被吞掉，不会再被改一次。
const DELIMS = new RegExp(
  "(?<!\\\\)\\\\\\[([\\s\\S]+?)(?<!\\\\)\\\\\\]" +
  `|(\\\\begin\\{(${ENVS})(\\*?)\\}[\\s\\S]*?\\\\end\\{\\3\\4\\})` +
  "|(?<!\\\\)\\\\\\(([\\s\\S]+?)(?<!\\\\)\\\\\\)",
  "g",
);
// 受保护的片段：围栏代码、行内代码、已有的 $$…$$ 与 $…$。
const GUARD = /(^|\n)(```|~~~)[\s\S]*?(?:\n\2[^\n]*(?=\n|$)|$)|`[^`\n]*`|\$\$[\s\S]+?\$\$|(?<![\\$])\$(?!\s*\$)(?:\\.|[^$\n\\])+?\$/g;
const OPEN = "\u0000B", CLOSE = "\u0000E";
function normalizeMath(text) {
  const source = String(text ?? "");
  let out = "", last = 0;
  for (const m of source.matchAll(GUARD)) {
    out += convert(source.slice(last, m.index)) + tidyInline(m[0]);
    last = m.index + m[0].length;
  }
  out += convert(source.slice(last));
  if (!out.includes(OPEN)) return out;
  // 独立公式自成一段：前后各空一行，`$$` 单独占一行。只动公式紧挨着的空白，
  // 别处用户自己留的空行不碰。
  out = out
    .replace(new RegExp(`[ \\t]*\\n*[ \\t]*${OPEN}`, "g"), "\n\n$$$$\n")
    .replace(new RegExp(`${CLOSE}[ \\t]*\\n*`, "g"), "\n$$$$\n\n");
  if (!/^\s/.test(source)) out = out.replace(/^\n+/, "");
  if (!/\s$/.test(source)) out = out.replace(/\n+$/, "");
  return out;
}
function convert(chunk) {
  return chunk.replace(DELIMS, (_, display, env, _name, _star, inline) =>
    inline !== undefined ? `$${inline.trim()}$` : `${OPEN}${(display ?? env).trim()}${CLOSE}`);
}
/**
 * `$ x^2 $` 这种内侧带空格的，Obsidian 不当公式。只在内容明显是公式时收掉空格——
 * 「$5 和 $6」这种价钱不能被改成公式。
 */
function tidyInline(piece) {
  if (!/^\$[^$]/.test(piece) || piece.startsWith("$$")) return piece;
  const inner = piece.slice(1, -1);
  if (inner === inner.trim() || !/[\\^_=]/.test(inner)) return piece;
  return `$${inner.trim()}$`;
}
/**
 * 常用宏。Obsidian 的 MathJax 没带 physics 包，`\dv`、`\pdv`、`\abs` 这些
 * 在讲义和 AI 回答里到处都是，不定义就是一片红字。
 */
const MATH_PREAMBLE = [
  "\\newcommand{\\R}{\\mathbb{R}}",
  "\\newcommand{\\N}{\\mathbb{N}}",
  "\\newcommand{\\Z}{\\mathbb{Z}}",
  "\\newcommand{\\Q}{\\mathbb{Q}}",
  "\\newcommand{\\C}{\\mathbb{C}}",
  "\\newcommand{\\dd}{\\mathrm{d}}",
  "\\newcommand{\\dv}[2]{\\frac{\\mathrm{d}#1}{\\mathrm{d}#2}}",
  "\\newcommand{\\pdv}[2]{\\frac{\\partial #1}{\\partial #2}}",
  "\\newcommand{\\abs}[1]{\\left\\lvert #1\\right\\rvert}",
  "\\newcommand{\\norm}[1]{\\left\\lVert #1\\right\\rVert}",
  "\\newcommand{\\vb}[1]{\\mathbf{#1}}",
  "\\newcommand{\\degC}{{}^{\\circ}\\mathrm{C}}",
].join("");

/** 粘贴图片的文件名：日期 课名 时分秒。重名时调用方在后面加 -2、-3。 */
function imageName(course, key, now = new Date(), ext = "png") {
  return `${key} ${safe(course.title)} ${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.${ext}`;
}

module.exports = {
  ROOT, CATEGORY, keyOf, folderOf, notePath, attachmentFolder, parseNotePath, isClassNote,
  noteTemplate, taskTag, taskSpec, courseOfTask, hasTaskTag, todayCourses,
  normalizeMath, MATH_PREAMBLE, imageName,
};
