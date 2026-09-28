"use strict";

/**
 * 粘贴来的一段话 → Obsidian 认得的 Markdown。
 *
 * 讲义、聊天记录、AI 回答里的公式用的是 LaTeX 的定界符：行内 \( \)、独占一行 \[ \]。
 * Obsidian 的 Markdown 只认 $ 和 $$，原样贴进去看到的就是满屏反斜杠。
 * 这里只翻译定界符，公式内容一个字符都不动——改内容就等于替人做题。
 */

const MAX_LENGTH = 20000; // 一次粘贴的上限；再长的整章内容属于文件，不属于侧栏速记

// 代码块与行内代码整段跳过：里面的 \( 是代码，不是公式。
const CODE = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g;
const DISPLAY = /\\\[([\s\S]*?)\\\]/g;
const INLINE = /\\\(([\s\S]*?)\\\)/g;
const FENCE = "$$";

function convertSegment(text) {
  return text
    // 独占一行的公式前后各留一个空行，否则 \[..\]\[..\] 连写会被挤成一段。
    .replace(DISPLAY, (_, body) => `\n\n${FENCE}\n${body.trim()}\n${FENCE}\n\n`)
    // 行内公式两侧不能留空格：Obsidian 的 $…$ 里紧跟空格就不当公式解析。
    .replace(INLINE, (_, body) => `$${body.trim()}$`);
}

/**
 * 整段只有一个行内公式时，提升成独占一行。
 * 单独复制一个矩阵是最常见的用法，行内排版会把它压扁成一行小字。
 */
function promoteLoneFormula(text) {
  const match = text.trim().match(/^\$([^$][\s\S]*?)\$$/);
  if (!match || match[1].includes("$")) return text;
  return `${FENCE}\n${match[1].trim()}\n${FENCE}`;
}

function toObsidianMarkdown(value) {
  const text = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    // 从 Word、网页复制来的不换行空格：肉眼是空格，MathJax 当作未知字符。
    .replace(/[     ]/g, " ")
    .slice(0, MAX_LENGTH);
  // split 带捕获组时分隔符落在奇数位，正好把代码原样让过去。
  const converted = text.split(CODE).map((part, i) => (i % 2 ? part : convertSegment(part))).join("");
  return promoteLoneFormula(converted).replace(/\n{3,}/g, "\n\n").trim();
}

/** 这段文本里有没有需要排版的数学。没有就别去动 Markdown 渲染器。 */
const hasMath = (value) => /\\\(|\\\[|\$/.test(String(value ?? ""));

/** 粘贴时是否值得代替浏览器默认行为：只有真翻译了定界符才接管。 */
const changesOnPaste = (value) => toObsidianMarkdown(value) !== String(value ?? "").trim();

module.exports = { MAX_LENGTH, toObsidianMarkdown, hasMath, changesOnPaste };
