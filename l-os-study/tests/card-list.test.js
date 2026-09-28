"use strict";

// 卡片列表纯逻辑：搜索覆盖面、筛选、近邻窗口、按页分组、标题回退。
const test = require("node:test");
const assert = require("node:assert/strict");
const { matchesQuery, matchesFilters, cardTitle, selectCards, groupByPage, anchorIndex, NEARBY_RADIUS } = require("../core/card-list.js");

const card = (over = {}) => ({ id: "a", page: 10, color: "yellow", kind: "highlight", text: "", note: "", categories: [], tags: [], createdAt: 1, ...over });

test("matchesQuery：分类与标签也要能搜到", () => {
  assert.equal(matchesQuery(card({ categories: ["定理 / 公式 / 运算法则"] }), "定理"), true);
  assert.equal(matchesQuery(card({ tags: ["期中"] }), "期中"), true);
  assert.equal(matchesQuery(card({ page: 38 }), "38"), true);
  assert.equal(matchesQuery(card({ text: "仿射子空间" }), "不存在"), false);
  assert.equal(matchesQuery(card(), ""), true);
});

test("matchesFilters：颜色多选取并集，疑问只留未解决的", () => {
  const colors = new Set(["mint", "blue"]);
  assert.equal(matchesFilters(card({ color: "mint" }), { colors }), true);
  assert.equal(matchesFilters(card({ color: "yellow" }), { colors }), false);
  assert.equal(matchesFilters(card({ color: "yellow" }), { colors: new Set() }), true);
  assert.equal(matchesFilters(card({ kind: "question" }), { questionOnly: true }), true);
  assert.equal(matchesFilters(card({ kind: "question", resolved: true }), { questionOnly: true }), false);
  assert.equal(matchesFilters(card({ kind: "highlight" }), { questionOnly: true }), false);
});

test("cardTitle：截图卡片没有标题是正常的，由缩略图辨认", () => {
  assert.equal(cardTitle(card({ note: "我的理解", text: "原文" })), "我的理解");
  assert.equal(cardTitle(card({ text: "原文" })), "原文");
  assert.equal(cardTitle(card({ imagePath: "a.png" })), "");
  assert.equal(cardTitle(card({ note: "   " })), "");
});

test("selectCards：当前页 ±2 进近邻窗口，按页正序；其余按距离折叠", () => {
  assert.equal(NEARBY_RADIUS, 2);
  const cards = [
    card({ id: "p20", page: 20 }), card({ id: "p12", page: 12 }), card({ id: "p8", page: 8 }),
    card({ id: "p10b", page: 10, createdAt: 20 }), card({ id: "p10a", page: 10, createdAt: 10 }), card({ id: "p13", page: 13 }),
  ];
  const { nearby, rest, total, nearest } = selectCards(cards, 10);
  assert.equal(total, 6);
  assert.equal(nearby.map(a => a.id).join(), "p8,p10a,p10b,p12");
  assert.equal(rest.map(a => a.id).join(), "p13,p20");
  assert.equal(nearest.id, "p13");
});

test("selectCards：筛选与查询叠加，空输入不报错", () => {
  const cards = [card({ id: "hit", page: 10, note: "隐函数定理", color: "mint" }), card({ id: "miss", page: 10, note: "别的", color: "yellow" })];
  assert.equal(selectCards(cards, 10, { query: "隐函数" }).nearby.map(a => a.id).join(), "hit");
  assert.equal(selectCards(cards, 10, { colors: new Set(["mint"]) }).nearby.map(a => a.id).join(), "hit");
  assert.equal(selectCards(cards, 10, { query: "隐函数", colors: new Set(["yellow"]) }).total, 0);
  assert.equal(selectCards(undefined, undefined, undefined).total, 0);
});

test("groupByPage：同页合并成一组并保持传入顺序", () => {
  const groups = groupByPage([card({ page: 8 }), card({ page: 10, id: "x" }), card({ page: 10, id: "y" }), card({ page: 12 })]);
  assert.deepEqual(groups.map(g => [g.page, g.cards.length]), [[8, 1], [10, 2], [12, 1]]);
  assert.deepEqual(groupByPage([]), []);
});

test("anchorIndex：本页有笔记就对准那一组的中线", () => {
  assert.deepEqual(anchorIndex([10, 11, 12], 11), { index: 1, edge: "center" });
  assert.deepEqual(anchorIndex([12], 12), { index: 0, edge: "center" });
});

test("anchorIndex：本页没笔记就对准它该在的那道缝，上一页在上半、下一页在下半", () => {
  // 11 页没笔记：对准 12 那组的上沿，10 的笔记自然落在上半屏。
  assert.deepEqual(anchorIndex([10, 12], 11), { index: 1, edge: "top" });
  // 当前页在全部笔记之后：对准最后一组的下沿，不要把列表顶到看不见的地方。
  assert.deepEqual(anchorIndex([10, 11], 30), { index: 1, edge: "bottom" });
  // 当前页在全部笔记之前：对准第一组的上沿。
  assert.deepEqual(anchorIndex([20, 21], 5), { index: 0, edge: "top" });
});

test("anchorIndex：没有任何分组时不对中", () => {
  assert.equal(anchorIndex([], 3), null);
  assert.equal(anchorIndex(null, 3), null);
});
