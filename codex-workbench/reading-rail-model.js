"use strict";

/**
 * 课堂笔记阅读栏的纯函数部分：不碰 DOM、不碰 Obsidian，可直接 node --test。
 *
 * 阅读模式和编辑模式共用这里的全部判断。两种模式唯一的差别是「屏幕顶上是第几行」
 * 和「点中的东西在第几行」怎么量——量出行号之后，块、题图、当前章节都只看源码。
 * 上一稿按阅读模式的 DOM 取段落，于是编辑模式下什么都做不了，必须先切阅读模式。
 */

const eligible = (file) => file?.extension === "md" && String(file.path).includes("/课堂笔记/") && !/\/(_assets|附件)\//.test(file.path);

/** 栏宽。下限要放得下两行目录，上限给题图留够——题图是这一栏最要紧的东西。 */
const railWidth = (value) => Math.max(260, Math.min(560, Math.round(Number(value)) || 340));

const IMAGE = /\.(png|jpe?g|gif|svg|webp|bmp|avif)$/i;
const FENCE = /^\s*(```+|~~~+|\$\$)/;

/** 一个固定参考。太长的不收：栏里放一整节，等于把正文抄一遍。 */
function pinValue(markdown, label, line = 0) {
  const text = String(markdown || "").trim();
  if (!text) throw Error("这里没有可以钉住的内容。");
  if (text.length > 20000) throw Error("这段太长，先选中需要的几行再钉住。");
  return { markdown: text, label: String(label || "固定参考").slice(0, 80), line: Math.max(0, Number(line) || 0) };
}

/** 每一行是否落在代码块或 $$ 公式块里，以及所在围栏的起止行。 */
function fences(lines) {
  const inside = new Array(lines.length).fill(null);
  let open = null;
  lines.forEach((line, i) => {
    const t = line.trim();
    if (open) {
      inside[i] = open;
      const closes = open.mark === "$$" ? t.endsWith("$$") : t.startsWith(open.mark) && !t.slice(open.mark.length).trim();
      if (closes) { open.end = i; open = null; }
      return;
    }
    const m = FENCE.exec(line);
    if (!m) return;
    const mark = m[1].startsWith("$") ? "$$" : m[1];
    // 单行的 $$ x $$ 不是围栏。
    if (mark === "$$" && t.length > 2 && t.endsWith("$$")) return;
    open = { mark, start: i, end: lines.length - 1 };
    inside[i] = open;
  });
  return inside;
}

/** frontmatter 的结束行（没有就是 -1）。它不是正文，不能被钉住，也不算题图。 */
function frontmatterEnd(lines) {
  if (lines[0]?.trim() !== "---") return -1;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === "---") return i;
  return -1;
}

const headingOf = (line) => /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);

/**
 * 第 line 行所在的那一块 Markdown：围栏内取整个围栏，否则取上下连续的非空行，
 * 碰到标题就停。表格、引用、callout、列表都是「连续非空行」，不用各写一套。
 */
function blockAt(text, line) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const at = Math.max(0, Math.min(lines.length - 1, Math.floor(Number(line) || 0)));
  if (at <= frontmatterEnd(lines)) return null;
  const inside = fences(lines), fence = inside[at];
  if (fence) return { start: fence.start, end: fence.end, markdown: lines.slice(fence.start, fence.end + 1).join("\n").trim() };
  if (!lines[at].trim()) return null;
  if (headingOf(lines[at])) return { start: at, end: at, markdown: lines[at].trim() };
  const joins = (i) => lines[i].trim() && !headingOf(lines[i]) && !inside[i];
  let start = at, end = at;
  while (start > 0 && joins(start - 1)) start--;
  while (end < lines.length - 1 && joins(end + 1)) end++;
  return { start, end, markdown: lines.slice(start, end + 1).join("\n").trim() };
}

/** 一行里的第一张本地或网络图片；不是图片的嵌入（笔记、PDF）不算。 */
function imageIn(line) {
  const wiki = /!\[\[([^\]|#]+)(#[^\]|]*)?(\|[^\]]*)?\]\]/.exec(line);
  if (wiki && IMAGE.test(wiki[1].trim())) return { markdown: wiki[0], link: wiki[1].trim() };
  const md = /!\[[^\]]*\]\(\s*<?([^)>]+?)>?(\s+"[^"]*")?\s*\)/.exec(line);
  if (md) {
    const link = md[1].trim();
    if (IMAGE.test(link.split(/[?#]/)[0])) return { markdown: md[0], link };
  }
  return null;
}

/** 扫一遍源码：标题和题图，都带行号。题图记下它属于哪个标题。 */
function scan(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const inside = fences(lines), skip = frontmatterEnd(lines);
  const headings = [], figures = [];
  let current = null;
  lines.forEach((line, i) => {
    if (i <= skip || inside[i]) return;
    const h = headingOf(line);
    if (h) { current = { line: i, level: h[1].length, heading: h[2] }; headings.push(current); return; }
    const image = imageIn(line);
    if (image) figures.push({ line: i, ...image, section: current });
  });
  return { headings, figures, lines: lines.length };
}

/**
 * 题图跟随：读到一道题的推导时，这道题的图已经滚出屏幕顶上了——
 * 这时把它放到栏里。图还在屏幕上就不放（同一张图看两遍）；这一节读完、
 * 进了下一个同级或更高的标题，就收掉，不让上一题的图赖在那里。
 */
function figureFor(doc, topLine) {
  const top = Number(topLine);
  if (!doc || !Number.isFinite(top)) return null;
  let found = null;
  for (const figure of doc.figures) if (figure.line < top) found = figure; else break;
  if (!found) return null;
  const level = found.section?.level || 6;
  const closed = doc.headings.some((h) => h.line > found.line && h.line <= top && h.level <= level);
  return closed ? null : found;
}

/** 当前章节：屏幕顶上那一行之前（含）的最后一个标题。多给半行，刚贴顶的标题也算读到了。 */
function activeIndex(headings, topLine) {
  const top = Number(topLine);
  if (!headings?.length || !Number.isFinite(top)) return -1;
  let index = -1;
  headings.forEach((h, i) => { if (h.line <= top + 0.5) index = i; });
  return Math.max(0, index);
}

/**
 * 目录行。笔记只有一个 H1 且它在最前面时，它就是标题，不进目录——
 * 上一稿把它画成目录第一行、再套一个选中框，整栏最显眼的东西是一句你已经读过的话。
 * 其余标题按层级缩进，最浅的一级顶格。折叠的标题藏起它下面更深的行。
 */
function outlineRows(headings, folded = new Set()) {
  const list = headings || [];
  const h1 = list.filter((h) => h.level === 1);
  const title = h1.length === 1 && list[0]?.level === 1 ? 0 : -1;
  const body = list.map((h, index) => ({ ...h, index })).filter((h) => h.index !== title);
  const base = Math.min(...body.map((h) => h.level), 6);
  const rows = [];
  let hideBelow = 7;
  body.forEach((h, k) => {
    if (h.level > hideBelow) return;
    hideBelow = 7;
    const parent = (body[k + 1]?.level || 0) > h.level;
    const isFolded = parent && folded.has(h.index);
    rows.push({ index: h.index, heading: h.heading, level: h.level, line: h.line, depth: Math.min(3, h.level - base), parent, folded: isFolded });
    if (isFolded) hideBelow = h.level;
  });
  return { rows, title };
}

module.exports = { eligible, railWidth, pinValue, blockAt, imageIn, scan, figureFor, activeIndex, outlineRows };
