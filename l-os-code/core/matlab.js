"use strict";

/**
 * .m 文件的解码、分行和着色。纯函数，不碰 DOM，测试直接跑。
 *
 * 着色是自己写的一个逐行扫描器，而不是把代码包进 ```matlab 交给 Obsidian 的 Prism：
 * Prism 分不清转置 `a'` 和字符串开头，`x = A'; s = 'abc';` 会把中间那段当成字符串一路染过去；
 * 它也不认 `%{ … %}` 块注释和 `%%` 分节。课程代码里这三样到处都是。
 */

const KEYWORDS = new Set([
  "break", "case", "catch", "classdef", "continue", "else", "elseif", "end", "for", "function",
  "global", "if", "otherwise", "parfor", "persistent", "return", "spmd", "switch", "try", "while",
  "arguments", "properties", "methods", "events", "enumeration",
]);

/**
 * 字节 → 文本。课程文件大多是 UTF-8，但老讲义的脚本常是 Windows 意大利语环境下存的
 * Windows-1252（è 是单字节 0xE8），按 UTF-8 读会变成一串 �。先严格按 UTF-8 解，失败再退。
 */
function decode(bytes) {
  let b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0xFF && b[1] === 0xFE) return { text: new TextDecoder("utf-16le").decode(b.subarray(2)), encoding: "UTF-16LE" };
  if (b[0] === 0xFE && b[1] === 0xFF) return { text: new TextDecoder("utf-16be").decode(b.subarray(2)), encoding: "UTF-16BE" };
  if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) b = b.subarray(3);
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(b), encoding: "UTF-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(b), encoding: "Windows-1252" };
  }
}

/** CRLF / CR 统一成 LF；文件末尾那一个换行不算一行空行。 */
function splitLines(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** 行首缩进的列数，制表符按 4 列。折行时续行缩到代码起点之后，靠的就是它。 */
function indentOf(line) {
  let cols = 0;
  for (const ch of line) {
    if (ch === " ") cols += 1;
    else if (ch === "\t") cols += 4 - (cols % 4);
    else break;
  }
  return cols;
}

// 这几种记号紧贴在 ' 前面时，' 是转置；否则是字符串开头。空格隔开的 `[a 'b']` 里是字符串。
const TRANSPOSE_AFTER = new Set(["id", "num", "close", "tr"]);
const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?[ijIJ]?/;
const IDENT = /^[A-Za-z_]\w*/;
const FUNCTION_NAME = /^\s*function\b\s*(?:(?:\[[^\]]*\]|[A-Za-z_]\w*)\s*=\s*)?([A-Za-z_][\w.]*)/;

function push(tokens, t, v) {
  if (!v) return;
  const last = tokens[tokens.length - 1];
  if (last && last.t === t) last.v += v;
  else tokens.push({ t, v });
}

/** 字符串从 start 处的引号起，到配对的引号止；连写两个引号是转义。没闭合就到行尾。 */
function stringEnd(line, start, quote) {
  let i = start + 1;
  while (i < line.length) {
    if (line[i] === quote) {
      if (line[i + 1] === quote) { i += 2; continue; }
      return i + 1;
    }
    i += 1;
  }
  return line.length;
}

function scanLine(line) {
  const tokens = [];
  const def = FUNCTION_NAME.exec(line);
  const defAt = def ? def[0].length - def[1].length : -1;
  let prev = "", i = 0;
  while (i < line.length) {
    const rest = line.slice(i), ch = line[i];
    if (ch === " " || ch === "\t") {
      const run = /^[ \t]+/.exec(rest)[0];
      push(tokens, "text", run); i += run.length; prev = "space"; continue;
    }
    if (ch === "%" || rest.startsWith("...")) { push(tokens, "com", rest); break; }
    if (ch === '"') {
      const end = stringEnd(line, i, '"');
      push(tokens, "str", line.slice(i, end)); i = end; prev = "str"; continue;
    }
    if (ch === "'") {
      if (TRANSPOSE_AFTER.has(prev)) { push(tokens, "text", ch); i += 1; prev = "tr"; continue; }
      const end = stringEnd(line, i, "'");
      push(tokens, "str", line.slice(i, end)); i = end; prev = "str"; continue;
    }
    if (rest.startsWith(".'")) { push(tokens, "text", ".'"); i += 2; prev = "tr"; continue; }
    const num = /^[.\d]/.test(ch) && NUMBER.exec(rest);
    if (num) { push(tokens, "num", num[0]); i += num[0].length; prev = "num"; continue; }
    const id = IDENT.exec(rest);
    if (id) {
      const word = id[0];
      // 结构体字段 s.end、s.for 不是关键字。
      const field = line[i - 1] === ".";
      // 函数定义行里的函数名（classdef 里的 set.Prop 连点一起算）。
      if (i === defAt) { push(tokens, "def", def[1]); i += def[1].length; prev = "id"; continue; }
      push(tokens, !field && KEYWORDS.has(word) ? "kw" : "text", word);
      i += word.length; prev = "id"; continue;
    }
    push(tokens, "text", ch); i += 1;
    prev = ")]}".includes(ch) ? "close" : "other";
  }
  return tokens;
}

/**
 * 整个文件着色。返回每行 {tokens, indent, section}：
 * - tokens：{t, v}，t 是 text / kw / str / com / num / def / sec
 * - section：`%%` 开头的分节行（MATLAB 编辑器里那条分隔线）
 * 拼回所有 v 恰好等于原行，着色不改动任何一个字符。
 */
function highlight(text) {
  let block = 0;
  return splitLines(text).map(line => {
    const trimmed = line.trim(), indent = indentOf(line);
    // %{ 和 %} 必须独占一行才算块注释的边界，可以嵌套。
    if (trimmed === "%{") { block += 1; return { tokens: [{ t: "com", v: line }], indent, section: false }; }
    if (block > 0) {
      if (trimmed === "%}") block -= 1;
      return { tokens: line ? [{ t: "com", v: line }] : [], indent, section: false };
    }
    if (/^%%(?:\s|$)/.test(trimmed)) return { tokens: [{ t: "sec", v: line }], indent, section: true };
    return { tokens: scanLine(line), indent, section: false };
  });
}

module.exports = { KEYWORDS, decode, splitLines, indentOf, highlight };
