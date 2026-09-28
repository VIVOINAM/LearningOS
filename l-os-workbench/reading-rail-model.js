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

/** 一行里的第一张本地或网络图片；不是图片的嵌入（笔记、PDF）不算。alt 是图下的那句说明（![[x.png|400]] 的 400 是尺寸，不算）。 */
function imageIn(line) {
  const wiki = /!\[\[([^\]|#]+)(#[^\]|]*)?(\|[^\]]*)?\]\]/.exec(line);
  if (wiki && IMAGE.test(wiki[1].trim())) {
    const pipe = (wiki[3] || "").slice(1).trim();
    return { markdown: wiki[0], link: wiki[1].trim(), alt: /^\d+(x\d+)?$/.test(pipe) ? "" : pipe };
  }
  const md = /!\[([^\]]*)\]\(\s*<?([^)>]+?)>?(\s+"[^"]*")?\s*\)/.exec(line);
  if (md) {
    const link = md[2].trim();
    if (IMAGE.test(link.split(/[?#]/)[0])) return { markdown: md[0], link, alt: md[1].replace(/\|\s*\d+(x\d+)?\s*$/, "").trim() };
  }
  return null;
}

/**
 * 标题末尾的页码拆出来，放到目录行右边当徽标：「4.2 静水总压力（spinte，p.26–30）」
 * → 标题「4.2 静水总压力（spinte）」、页码「p.26–30」。只认结尾那一对括号——
 * 「讲义 p.1–32：衡算方程」里的页码是标题的一部分，不拆。
 */
const PAGES = /\s*([（(])\s*(?:([^（）()]*?)\s*[，,；;]\s*)?(?:pp?\.\s*|(?:PDF\s*)?第\s*)(\d+(?:\s*[–—~-]\s*\d+)?)\s*页?\s*[）)]\s*$/i;
function pageOf(heading) {
  const text = String(heading || "");
  const m = PAGES.exec(text);
  if (!m || m.index === 0) return { title: text, page: "" };
  const close = m[1] === "（" ? "）" : ")";
  const kept = m[2] ? /^\s*/.exec(m[0])[0] + m[1] + m[2] + close : "";
  return { title: text.slice(0, m.index) + kept, page: "p." + m[3].replace(/\s/g, "").replace(/[—~-]/g, "–") };
}

/** 当前章节和它的每一级上级（标题下标）。 */
function chainOf(headings, active) {
  const chain = new Set();
  if (!headings?.[active]) return chain;
  let level = headings[active].level + 1;
  for (let i = active; i >= 0; i--) if (headings[i].level < level) { chain.add(i); level = headings[i].level; }
  return chain;
}

/**
 * 手风琴：读到哪一章就展开哪一章（连同它的直属小节），和它同级的别的章收起来。
 * 只收「读到的那条链」的兄弟：在篇首、还没进任何一章时什么都不收——整份目录就是这时候最有用。
 * 用户亲手折过、展开过的听用户的（overrides：下标 → 是否折起）；expandAll 是「全部展开」。
 */
function foldedSet(headings, active, overrides = new Map(), expandAll = false) {
  const list = headings || [], chain = chainOf(list, active), folded = new Set();
  const parentOf = list.map((h, i) => { for (let j = i - 1; j >= 0; j--) if (list[j].level < h.level) return j; return -1; });
  const siblingsOf = new Set([...chain].map((i) => parentOf[i]));
  list.forEach((h, i) => {
    if (!((list[i + 1]?.level || 0) > h.level)) return;
    const auto = !expandAll && !chain.has(i) && siblingsOf.has(parentOf[i]);
    if (overrides.has(i) ? overrides.get(i) : auto) folded.add(i);
  });
  return folded;
}

/**
 * 这一节的图：标题下直属的图（不含小节里的）。自己没有，就往上找最近一个直属有图的上级——
 * 读「2.1 总质量衡算」时，它上级「第 2 章」开头那张通用控制体图就是这一节要对照的图。
 * 再往上都没有，就是没有；不把整本讲义三十张图塞进来。
 */
function sectionFigures(doc, active) {
  if (!doc) return [];
  if (!doc.headings.length || active < 0) return doc.figures.filter((f) => !f.section);
  for (const i of [...chainOf(doc.headings, active)]) {
    const own = doc.figures.filter((f) => f.section === doc.headings[i]);
    if (own.length) return own;
  }
  return [];
}

/** 一节有几张图时默认看哪张：已经滚过屏幕顶上的最后一张（正在读它下面的推导），都还没滚到就第一张。 */
function pickFigure(figures, topLine) {
  if (!figures?.length) return -1;
  let pick = 0;
  figures.forEach((f, i) => { if (f.line < Number(topLine)) pick = i; });
  return pick;
}

/**
 * 栏怎么摆，只看笔记这一格有多宽。目录永远在左边——和书的目录、IDE 的文件树一个方向，
 * 眼睛从左往右是「在哪一章 → 读正文 → 对照图」。
 * - three：目录 | 正文 | 题图，三列。正文至少留 560。
 * - stack：目录 | 正文，题图卡收进左栏、跟在目录下面。
 * - compact：从左上角拉出来的抽屉。
 */
const DOC_MIN = 560;
function layoutMode(hostWidth) {
  const w = Number(hostWidth) || 0;
  if (w <= 0) return "stack";
  if (w < 860) return "compact";
  return w >= 1180 ? "three" : "stack";
}
/** 三列时左边目录的宽：200–420，缺省 260。 */
const navWidth = (value) => Math.max(200, Math.min(420, Math.round(Number(value)) || 260));
/**
 * 三列时右边题图的宽：300–640，而且不许把正文挤到 560 以下。
 * 没拖过（null）就是自动：正文一行只排 760，宽窗口下正文这一列两边剩的白边归题图，至少 380。
 * 扁宽的题图在 380 宽的栏里只有一百多像素高，字看不清；这些白边本来就空着。
 */
const DOC_ROOM = 840;
const figWidth = (value, hostWidth = Infinity, nav = 260) => {
  const room = Number(hostWidth) - Number(nav);
  const want = value == null ? Math.max(380, room - DOC_ROOM) : Math.round(Number(value)) || 380;
  return Math.max(300, Math.min(640, room - DOC_MIN, want));
};

/**
 * 源码切成块：围栏整块，其余是空行隔开的连续行，标题单独一块。
 * type：heading / math / code / figure（首行是一张图）/ table / quote / list / para。
 */
const LIST = /^\s*(?:[-*+]|\d+[.)])\s/;
function blocksOf(lines, inside, skip) {
  const blocks = [];
  for (let i = skip + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    const fence = inside[i];
    if (fence) { blocks.push({ start: i, end: fence.end, type: fence.mark === "$$" ? "math" : "code", text: lines.slice(i, fence.end + 1).join("\n") }); i = fence.end; continue; }
    if (headingOf(lines[i])) { blocks.push({ start: i, end: i, type: "heading", text: t }); continue; }
    let end = i;
    while (end + 1 < lines.length && lines[end + 1].trim() && !headingOf(lines[end + 1]) && !inside[end + 1]) end++;
    const type = t.startsWith("!") && imageIn(t) && imageIn(t).markdown === t ? "figure"
      : t.startsWith("|") ? "table" : t.startsWith(">") ? "quote" : LIST.test(lines[i]) ? "list" : "para";
    blocks.push({ start: i, end, type, text: lines.slice(i, end + 1).join("\n").trim() });
    i = end;
  }
  return blocks;
}

/** 图注：紧跟在图后的一整行斜体，或以「图 3｜」「图中」开头的一段。「上图……」是讲图的话，算引导语。 */
const CAPTION = /^(?:[*_](?![*_\s])[\s\S]*[^*_\s][*_]|图\s*\d+\s*[｜|:：][\s\S]*|图中[\s\S]*)$/;
/** 引导语：图前面那一段说「下图」「如图」的；没有就看图后面以「上图」「读图」开头的那段。 */
const LEAD_BEFORE = /下图|如下图|如图|见图|左图|右图|示意图|（图\s*[a-z\d]）/;
const LEAD_AFTER = /^(?:\*\*)?(?:上图|读图|由图|从图)/;

/** 扫一遍源码：标题和题图，都带行号。题图记下它属于哪个标题，以及它的图注和引导语。 */
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
    if (image) figures.push({ line: i, ...image, section: current, caption: "", lead: "" });
  });
  const blocks = blocksOf(lines, inside, skip);
  const at = new Map(blocks.map((b, k) => [b.start, k]));
  for (const figure of figures) {
    const k = at.get(figure.line);
    if (k == null || blocks[k].type !== "figure") continue;
    const b = blocks[k], rest = b.text.split("\n").slice(1).join("\n").trim();
    const next = blocks[k + 1], prev = blocks[k - 1];
    let after = k + 1;
    if (rest && CAPTION.test(rest)) figure.caption = rest;
    else if (!rest && next?.type === "para" && CAPTION.test(next.text)) { figure.caption = next.text; after = k + 2; }
    if (prev?.type === "para" && LEAD_BEFORE.test(prev.text) && !CAPTION.test(prev.text)) figure.lead = prev.text;
    else if (blocks[after]?.type === "para" && LEAD_AFTER.test(blocks[after].text)) figure.lead = blocks[after].text;
  }
  return { headings, figures, blocks, lines: lines.length };
}

// ---- 本题卡 -----------------------------------------------------------------
// 习题课笔记：翻到第三页的解答时要对照的是「图 + 题面」，不是只有一张图。
// 所以跟随的单位是「题」：读到一道题的任何一页（含它的小节），卡片都是这道题的题面和图。

/** 题目标题：「例 3：…」「2.6 例题：…」「巩固题 A」「Esercizio 2」。「习题课」「例题逐题解析」是一组题的容器，不算。 */
const PROBLEM_TITLE = /^(?:\d+(?:\.\d+)*\s*[.、．·]?\s*)?(?:例题(?=[\s：:（(\d])|习题(?!课)|练习题?\s*[\dA-Z一二三四五六七八九十]|巩固题|思考题|Esercizio|Exercise|Problem|例\s*[\dA-Z一二三四五六七八九十]|题\s*[\dA-Z])/i;
/** 题面段：以「题目」「已知」「求」「来源」开头（可带加粗）。 */
const STEM = /^(?:\*\*)?\s*(?:题目|已知|求|来源|条件|数据|题意|原题|要求)[\s*：:，,。]/;

const directEnd = (doc, i) => doc.headings[i + 1]?.line ?? doc.lines;
function subtreeEnd(doc, i) {
  const level = doc.headings[i].level;
  for (let j = i + 1; j < doc.headings.length; j++) if (doc.headings[j].level <= level) return doc.headings[j].line;
  return doc.lines;
}
const blocksIn = (doc, from, to) => (doc.blocks || []).filter((b) => b.start > from && b.start < to);

function isProblem(doc, i) {
  const h = doc?.headings?.[i];
  if (!h) return false;
  if (PROBLEM_TITLE.test(h.heading)) return true;
  // 要真有「题目：」这个标签——「**题目最常见的给法是……**」是讲解，不是题。
  return blocksIn(doc, h.line, directEnd(doc, i)).slice(0, 6).some((b) => b.type === "para" && /^(?:\*\*题目\*\*\s*[：:]|\*\*题目[：:]\*\*|题目[：:])/.test(b.text));
}
const BOLD_LABEL = /^\*\*[^*]+\*\*/;

const figureItem = (f) => ({ kind: "figure", line: f.line, markdown: f.markdown, alt: f.alt, caption: f.caption, lead: f.lead });

/**
 * 一道题的题面：从标题往下，取图、图注和题面段，碰到解答（公式、表格、别的加粗小标题、普通段落）就停。
 * 开头的提示框（「本题数值是为说明方法而设」）跳过；第一段正文没有标签也算题面（图可以在它前面），
 * 以加粗小标题开头的（「**第一步**」）不算。图后面「图中 1 为油籽……以 1 kg/s 为基准」这种散文图注
 * 讲的是题给的数据，按题面排；斜体的「*图 3｜……*」才是图注。
 * 这道题（含小节）里后面的图接在题面后面；一张图也没有，就找点名了本题编号的图（「例 2.4 与例 2.5」）
 * 和正文里说到的「图 3」。
 */
function problemCard(doc, i) {
  const h = doc.headings[i], end = subtreeEnd(doc, i);
  const items = [], used = new Set();
  const blocks = blocksIn(doc, h.line, directEnd(doc, i));
  const byLine = new Map(doc.figures.map((f) => [f.line, f]));
  let opened = false;
  for (let k = 0; k < blocks.length; k++) {
    const b = blocks[k];
    if (b.type === "figure") {
      const f = byLine.get(b.start);
      // 题面里的图不带引导语：引导它的那段就是题面，已经在卡里了。
      const prose = f?.caption && !/^[*_]/.test(f.caption);
      if (f) { items.push({ ...figureItem(f), lead: "", caption: prose ? "" : f.caption }); used.add(f.line); }
      const separate = f?.caption && blocks[k + 1]?.text === f.caption;
      if (prose) { items.push({ kind: "text", line: separate ? blocks[k + 1].start : f.line + 1, markdown: f.caption }); opened = true; }
      if (separate) k++;
      continue;
    }
    if (b.type === "quote" && !opened && !items.length) continue;
    const last = items.at(-1);
    if (b.type === "para" && (STEM.test(b.text) || (!opened && !BOLD_LABEL.test(b.text)))) { items.push({ kind: "text", line: b.start, markdown: b.text }); opened = true; continue; }
    if (b.type === "list" && last?.kind === "text" && /[：:]\s*$/.test(last.markdown)) { items.push({ kind: "text", line: b.start, markdown: b.text }); continue; }
    break;
  }
  const own = doc.figures.filter((f) => f.line > h.line && f.line < end);
  for (const f of own) if (!used.has(f.line)) items.push(figureItem(f));
  const text = (doc.blocks || []).filter((b) => b.start > h.line && b.start < end).map((b) => b.text).join("\n");
  // 借来的图不带引导语：那段话讲的是别的题。
  items.unshift(...borrowedFigures(doc, i, text).map((f) => ({ ...figureItem(f), lead: "" })));
  return items.length ? finish({ kind: "problem", index: i, heading: h.heading, line: h.line, items }) : null;
}

/** 别处的图：本题一张图都没有时，前面 alt / 图注里点了本题编号的；以及正文说到的「图 N」。 */
function borrowedFigures(doc, i, text) {
  const h = doc.headings[i], out = [];
  const has = (f) => out.includes(f);
  const said = (f) => `${f.alt}\n${f.caption}`;
  const own = doc.figures.some((f) => f.line > h.line && f.line < subtreeEnd(doc, i));
  if (!own) {
    let parent = -1;
    for (let j = i - 1; j >= 0; j--) if (doc.headings[j].level < h.level) { parent = doc.headings[j].line; break; }
    const labels = new Set();
    for (const m of h.heading.matchAll(/(?:例|题|巩固题|习题|练习)\s*([A-Z]|\d+(?:\.\d+)*)(?![\d.])/g)) labels.add(m[1]);
    const lead = /^(\d+\.\d+(?:\.\d+)*)\s/.exec(h.heading);
    if (lead) labels.add(lead[1]);
    for (const label of labels) {
      const re = new RegExp(`(?:^|[^\\d.A-Za-z])${label.replace(/\./g, "\\.")}(?![\\d.]*\\d|[A-Za-z])`);
      for (const f of doc.figures) if (f.line > parent && f.line < h.line && /[例题]/.test(said(f)) && re.test(said(f)) && !has(f)) out.push(f);
    }
  }
  for (const m of text.matchAll(/图\s*(\d+)(?![\d.])/g)) {
    const n = m[1], re = new RegExp(`^\\s*[*_]?\\s*图\\s*${n}(?!\\d)`);
    for (const f of doc.figures) if ((re.test(f.caption) || re.test(f.alt)) && !has(f) && !(f.line > h.line && f.line < subtreeEnd(doc, i))) out.push(f);
  }
  return out.sort((a, b) => a.line - b.line);
}

/** 当前那张：滚过屏幕顶上的最后一张图。markdown 是整张卡拼起来的源码（钉住、放大都用它）。 */
function finish(card) {
  card.markdown = card.items.map(itemMarkdown).join("\n\n");
  return card;
}
function itemMarkdown(item) {
  if (item.kind === "text") return item.markdown;
  return [item.markdown, item.caption, item.lead].filter(Boolean).join("\n\n");
}

/**
 * 题图卡显示什么：读到的地方在一道题里（它自己或某一级上级是题目）就是这道题的本题卡；
 * 否则是这一节的图（sectionFigures），每张图带着图注和引导语。current 是该高亮的那一项。
 */
function card(doc, active, topLine) {
  if (!doc) return null;
  let result = null;
  for (const i of chainOf(doc.headings, active)) if (isProblem(doc, i)) { result = problemCard(doc, i); if (result) break; }
  if (!result) {
    const figures = sectionFigures(doc, active);
    if (!figures.length) return null;
    const index = figures[0].section ? doc.headings.indexOf(figures[0].section) : -1;
    result = finish({ kind: "section", index, heading: figures[0].section?.heading || "", line: figures[0].line, items: figures.map(figureItem) });
  }
  const figures = result.items.map((item, k) => ({ line: item.kind === "figure" ? item.line : Infinity, k })).filter((f) => f.line !== Infinity);
  const pick = pickFigure(figures, topLine);
  result.current = pick < 0 ? -1 : figures[pick].k;
  if (result.kind === "section" && result.current >= 0) result.line = result.items[result.current].line;
  return result;
}

/** 源码第 line 行落在哪道题里（钉住题里的图时整道题一起钉）。不在题里是 null。 */
function problemAt(doc, line) {
  const active = activeIndex(doc?.headings, line);
  for (const i of chainOf(doc?.headings, active)) if (isProblem(doc, i)) return problemCard(doc, i);
  return null;
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

module.exports = {
  eligible, railWidth, pinValue, blockAt, imageIn, scan, activeIndex, outlineRows,
  pageOf, chainOf, foldedSet, sectionFigures, pickFigure, layoutMode, navWidth, figWidth,
  isProblem, problemCard, card, problemAt, itemMarkdown,
};
