"use strict";

/**
 * 复习条目的键。
 *
 * 6.2 之前调度单元只有「整篇笔记」，键就是笔记路径。于是 codex-study 产出的
 * 卡片——引文、批注、公式、截图，都带着 PDF 坐标——没有任何路径进入复习队列：
 * 在整个 codex-study 里 grep "recall" 返回零结果，捕获系统和复习系统互不相识。
 * 你在第 37 页卡住写下的那个疑问，永远不会自己回到你面前。
 *
 * 现在键有两种：
 *   "03 知识库/笔记.md"              整篇笔记
 *   "book/数学分析.pdf#k3x9-ab12"    某本书里的一张卡片
 *
 * 旧键一个字符都不用改：没有卡片后缀就是笔记，迁移是空操作。
 *
 * 用 '#' 当分隔符是跟着 Obsidian 的链接写法走的，但文件名里其实允许出现 '#'。
 * 所以这里不是「见到 # 就拆」：从最后一个 '#' 拆，且后缀必须长得像
 * codex-study 生成的 id（`Date.now().toString(36)-六位随机`）才算卡片键。
 * 一篇叫「读书笔记#3.md」的笔记不会被误判。
 */

const SEP = "#";
const CARD_ID = /^[0-9a-z]+-[0-9a-z]{4,12}$/i;

/** 拆成 {path, cardId}；不是卡片键时 cardId 为空串。 */
function splitKey(key) {
  const text = String(key || "");
  const at = text.lastIndexOf(SEP);
  if (at <= 0) return { path: text, cardId: "" };
  const suffix = text.slice(at + SEP.length);
  if (!CARD_ID.test(suffix)) return { path: text, cardId: "" };
  return { path: text.slice(0, at), cardId: suffix };
}

/** 组合成键；cardId 为空时就是笔记路径本身。 */
function makeKey(path, cardId = "") {
  const id = String(cardId || "").trim();
  if (!id) return String(path || "");
  if (!CARD_ID.test(id)) throw new Error(`卡片 id 格式不对：${id}`);
  return `${path}${SEP}${id}`;
}

function isCardKey(key) {
  return !!splitKey(key).cardId;
}

/** 文件改名后把键上的路径部分跟着换掉，卡片后缀原样保留。 */
function renameKey(key, oldPath, newPath) {
  const { path, cardId } = splitKey(key);
  if (path !== oldPath && !path.startsWith(`${oldPath}/`)) return key;
  return makeKey(newPath + path.slice(oldPath.length), cardId);
}

module.exports = { splitKey, makeKey, isCardKey, renameKey, SEP };
