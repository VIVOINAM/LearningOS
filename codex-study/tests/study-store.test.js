"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const store = require("../core/study-store.js");

test("defaultStudy：默认目标与空记录", () => {
  const study = store.defaultStudy();
  assert.deepEqual(study.records, {});
  assert.deepEqual(study.goal, { minutes: 120, pages: 30 });
  assert.equal(store.isEmptyStudy(study), true);
});

test("normalizeStudy：坏数据收敛，records 保持对象", () => {
  const study = store.normalizeStudy({
    records: { "a.pdf": { annotations: "bad", totalPages: "-3" } },
    goal: { minutes: 50 },
  });
  assert.deepEqual(study.records["a.pdf"].annotations, []);
  assert.equal(study.records["a.pdf"].totalPages, 0);
  assert.equal(study.goal.minutes, 50);
  assert.equal(study.goal.pages, 30);
});

test("importLegacyStudy：新数据非空时以新数据为准", () => {
  const current = { records: { "new.pdf": { next: "继续" } } };
  const legacy = { records: { "old.pdf": { next: "旧" } } };
  const result = store.importLegacyStudy(current, legacy);
  assert.equal(result.imported, false);
  assert.ok(result.study.records["new.pdf"]);
  assert.equal(result.study.records["old.pdf"], undefined);
});

test("importLegacyStudy：新数据为空时导入 v1.7 study", () => {
  const legacy = {
    records: { "book/卷1.pdf": { position: { page: 48 }, annotations: [{ id: "a1" }] } },
    goal: { minutes: 90, pages: 10 },
  };
  const result = store.importLegacyStudy(store.defaultStudy(), legacy);
  assert.equal(result.imported, true);
  assert.equal(result.study.records["book/卷1.pdf"].position.page, 48);
  assert.equal(result.study.goal.minutes, 90);
});

test("importLegacyStudy：只有目标变化也要迁移", () => {
  const result = store.importLegacyStudy(store.defaultStudy(), { records: {}, goal: { minutes: 90, pages: 10 } });
  assert.equal(result.imported, true);
  assert.equal(result.study.goal.minutes, 90);
  assert.equal(result.study.goal.pages, 10);
});

test("importLegacyStudy：legacy 无效时安全返回空数据", () => {
  const result = store.importLegacyStudy(store.defaultStudy(), null);
  assert.equal(result.imported, false);
  assert.equal(store.isEmptyStudy(result.study), true);
});

test("applyStudy：写回同一个对象引用，StudyEngine 不失联", () => {
  const target = store.defaultStudy();
  const reference = target;
  store.applyStudy(target, { records: { "x.pdf": { next: "继续" } } });
  assert.equal(reference, target);
  assert.ok(reference.records["x.pdf"]);
});
