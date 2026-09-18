"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../core/study-model.js");

test("studyColor：迁移旧色并回落到经典黄", () => {
  assert.equal(model.studyColor("green"), "mint");
  assert.equal(model.studyColor("red"), "coral");
  assert.equal(model.studyColor("purple"), "purple");
  assert.equal(model.studyColor("unknown"), "yellow");
});

test("parseStudyTags：去重、去井号、限制数量", () => {
  assert.deepEqual(model.parseStudyTags("#考点, 复习 考点\n概念"), ["考点", "复习", "概念"]);
});

test("parseStudyCategories：迁移旧分类并拒绝未知值", () => {
  assert.deepEqual(model.parseStudyCategories("概念,不存在,例题"), ["核心定义 / 术语", "典型例题 / 经典反例"]);
  assert.deepEqual(model.parseStudyCategories(["疑问卡壳（待解决）", "高阶应用（延伸拓展）"]), ["疑问卡壳（待解决）", "高阶应用（延伸拓展）"]);
});

test("parseStudyLinks：解析页码与标签并去重", () => {
  assert.deepEqual(model.parseStudyLinks("12:定理1.2；12:定理1.2；34"), [
    { page: 12, label: "定理1.2" },
    { page: 34, label: "" },
  ]);
});

test("mergeStudyRects：合并同一行相邻矩形", () => {
  const merged = model.mergeStudyRects([
    { x: 0.1, y: 0.2, w: 0.1, h: 0.02 },
    { x: 0.21, y: 0.2, w: 0.1, h: 0.02 },
    { x: 0.1, y: 0.5, w: 0.1, h: 0.02 },
  ]);
  assert.equal(merged.length, 2);
  assert.equal(Number(merged[0].w.toFixed(2)), 0.21);
});
