"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { cardReview } = require("../core/study-model.js");

test("引文在上、批注在下，不是二选一", () => {
  // 5.4.0 起卡片列表就是这么排的：note || text 二选一时，写了批注就看不到原文，
  // 复习的时候尤其要命——你需要的正是「原文说了什么」对上「我当时怎么想」。
  const card = cardReview({id:"a-bbbb", page:37, text:"设 f 在 x0 可微", note:"可微 ⇒ 连续，反过来不成立"}, "book/数学分析 II.pdf");
  assert.equal(card.body, "> 设 f 在 x0 可微\n\n可微 ⇒ 连续，反过来不成立");
  assert.equal(card.title, "数学分析 II · 第 37 页");
  assert.equal(card.page, 37);
  assert.equal(card.kind, "");
});

test("多行引文每行都带引用符", () => {
  const card = cardReview({id:"a-bbbb", text:"第一行\r\n第二行\n第三行"}, "book/a.pdf");
  assert.equal(card.body, "> 第一行\n> 第二行\n> 第三行");
});

test("疑问卡片的提示语只说去回想什么，不透露答案", () => {
  const card = cardReview({id:"a-bbbb", kind:"question", note:"隐函数定理为什么只保证局部？"}, "book/a.pdf");
  assert.equal(card.kind, "疑问");
  assert.match(card.prompt, /卡在哪里/);
  assert.ok(!card.prompt.includes("隐函数"), "提示语不该把内容漏出来");
});

test("截图卡片嵌图片，图片在引文之前", () => {
  const card = cardReview({id:"a-bbbb", kind:"region", imagePath:"03 知识库/教材切片/x.png", note:"这张图说明了边界条件"}, "book/a.pdf");
  assert.equal(card.kind, "截图");
  assert.equal(card.body, "![[03 知识库/教材切片/x.png]]\n\n这张图说明了边界条件");
});

test("空卡片说明白它是空的，而不是渲染出一个空白面板", () => {
  assert.equal(cardReview({id:"a-bbbb"}, "book/a.pdf").body, "（这张卡片没有文字内容）");
});

test("页码非法时退回第 1 页，不产生 NaN 标题", () => {
  for (const page of [undefined, 0, -3, "abc", 2.7]) {
    const card = cardReview({id:"a-bbbb", page}, "book/a.pdf");
    assert.ok(Number.isInteger(card.page) && card.page >= 1, String(page));
    assert.ok(!card.title.includes("NaN"), String(page));
  }
});
