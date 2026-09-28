"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { splitKey, makeKey, isCardKey, renameKey } = require("../core/keys.js");

test("笔记键原样不动——旧数据的迁移是空操作", () => {
  assert.deepEqual(splitKey("03 知识库/笔记.md"), { path: "03 知识库/笔记.md", cardId: "" });
  assert.equal(isCardKey("03 知识库/笔记.md"), false);
  assert.equal(makeKey("03 知识库/笔记.md"), "03 知识库/笔记.md");
  assert.equal(makeKey("03 知识库/笔记.md", ""), "03 知识库/笔记.md");
});

test("卡片键拆得出书和卡片", () => {
  const key = makeKey("book/数学分析.pdf", "k3x9-ab12cd");
  assert.equal(key, "book/数学分析.pdf#k3x9-ab12cd");
  assert.deepEqual(splitKey(key), { path: "book/数学分析.pdf", cardId: "k3x9-ab12cd" });
  assert.equal(isCardKey(key), true);
});

test("文件名里带 # 的笔记不会被误判成卡片", () => {
  // 后缀不像 l-os-study 生成的 id，就当它是路径的一部分。
  for (const path of ["03 知识库/读书笔记#3.md", "a#b.md", "#开头.md"]) {
    assert.deepEqual(splitKey(path), { path, cardId: "" }, path);
    assert.equal(isCardKey(path), false, path);
  }
});

test("id 格式不对就拒绝组键，而不是造一个拆不回来的键", () => {
  assert.throws(() => makeKey("book/a.pdf", "不是id"), /格式/);
  assert.throws(() => makeKey("book/a.pdf", "noseparator"), /格式/);
});

test("改名跟着换路径，卡片后缀保留", () => {
  assert.equal(renameKey("book/旧.pdf#k3x9-ab12cd", "book/旧.pdf", "book/新.pdf"), "book/新.pdf#k3x9-ab12cd");
  assert.equal(renameKey("03 知识库/a.md", "03 知识库/a.md", "04 创作/a.md"), "04 创作/a.md");
  // 文件夹改名：前缀匹配也要跟着走。
  assert.equal(renameKey("book/卷一/a.pdf#k3x9-ab12cd", "book", "教材"), "教材/卷一/a.pdf#k3x9-ab12cd");
  // 不相干的键不动。
  assert.equal(renameKey("其他/b.md", "book", "教材"), "其他/b.md");
  // 前缀像但不是同一层级的不动。
  assert.equal(renameKey("bookmarks/c.md", "book", "教材"), "bookmarks/c.md");
});
