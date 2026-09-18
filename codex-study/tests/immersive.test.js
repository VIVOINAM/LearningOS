"use strict";

// 沉浸阅读只做减法：进入时加 class、当前页以外降透明度，退出时全部还原。
const test = require("node:test");
const assert = require("node:assert/strict");
const { IMMERSIVE_CLASS, DIM_CLASS, setImmersive, dimPages } = require("../core/immersive.js");

const fakeClassList = () => {
  const set = new Set();
  return { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c), has: c => set.has(c),
    toggle: (c, on) => { if (on) set.add(c); else set.delete(c); return set.has(c); } };
};
const fakePage = number => ({ dataset: { pageNumber: String(number) }, classList: fakeClassList() });
const fakeScroll = pages => ({ querySelectorAll: () => pages });

test("setImmersive：开关 body 标记，缺少 body 时安全返回", () => {
  const body = { classList: fakeClassList() };
  setImmersive(body, true);
  assert.equal(body.classList.has(IMMERSIVE_CLASS), true);
  setImmersive(body, false);
  assert.equal(body.classList.has(IMMERSIVE_CLASS), false);
  assert.equal(setImmersive(null, true), false);
  assert.equal(setImmersive({}, true), false);
});

test("dimPages：当前页保持清晰，其余页降透明度", () => {
  const pages = [fakePage(11), fakePage(12), fakePage(13)];
  dimPages(fakeScroll(pages), 12, true);
  assert.deepEqual(pages.map(p => p.classList.has(DIM_CLASS)), [true, false, true]);

  // 翻页后跟着走，旧的当前页要重新变暗。
  dimPages(fakeScroll(pages), 13, true);
  assert.deepEqual(pages.map(p => p.classList.has(DIM_CLASS)), [true, true, false]);
});

test("dimPages：退出沉浸后清干净，不留残影", () => {
  const pages = [fakePage(1), fakePage(2)];
  dimPages(fakeScroll(pages), 2, true);
  dimPages(fakeScroll(pages), 2, false);
  assert.deepEqual(pages.map(p => p.classList.has(DIM_CLASS)), [false, false]);
});

test("dimPages：页码是字符串也能对上，没有滚动容器时不报错", () => {
  const pages = [fakePage(7)];
  dimPages(fakeScroll(pages), "7", true);
  assert.equal(pages[0].classList.has(DIM_CLASS), false);
  assert.doesNotThrow(() => dimPages(null, 1, true));
  assert.doesNotThrow(() => dimPages({}, 1, true));
});
