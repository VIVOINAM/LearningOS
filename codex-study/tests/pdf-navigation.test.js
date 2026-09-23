"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PdfNavigationHistory, copyPosition, movedPosition, pdfLinkTarget } = require("../core/pdf-navigation.js");

test("PDF 跳转历史能返回并再次前进到精确页内位置", () => {
  const history = new PdfNavigationHistory();
  history.remember({ page: 12, scale: "page-width", top: 1200, left: 4, pageOffset: 188 });

  const source = history.take("back", { page: 48, scale: "page-width", top: 6200, left: 0, pageOffset: 310 });
  assert.deepEqual(source, { page: 12, scale: "page-width", top: 1200, left: 4, pageOffset: 188 });
  assert.equal(history.canForward(), true);

  const destination = history.take("forward", source);
  assert.deepEqual(destination, { page: 48, scale: "page-width", top: 6200, left: 0, pageOffset: 310 });
});

test("新跳转会清空前进栈，重复来源不会堆积", () => {
  const history = new PdfNavigationHistory();
  history.remember({ page: 2, pageOffset: 40 });
  history.remember({ page: 2, pageOffset: 40.5 });
  assert.equal(history.back.length, 1);
  history.take("back", { page: 9, pageOffset: 100 });
  assert.equal(history.canForward(), true);
  history.remember({ page: 3, pageOffset: 12 });
  assert.equal(history.canForward(), false);
});

test("位置副本不保留无关状态，跳转变化忽略渲染抖动", () => {
  assert.deepEqual(copyPosition({ page: 3.2, scale: 1.5, pageOffset: 9, secret: "no" }), { page: 3, scale: 1.5, pageOffset: 9 });
  assert.equal(movedPosition({ page: 3, pageOffset: 9 }, { page: 3, pageOffset: 12 }), false);
  assert.equal(movedPosition({ page: 3, pageOffset: 9 }, { page: 4, pageOffset: 9 }), true);
  assert.equal(movedPosition({ page: 3, pageOffset: 9 }, { page: 3, pageOffset: 30 }), true);
});

test("PDF 链接识别不依赖 PDF.js 的具体类名", () => {
  const anchor = {};
  const scroll = { contains: node => node === anchor };
  const target = { nodeType: 1, closest: selector => selector === "a, .linkAnnotation" ? anchor : null };
  assert.equal(pdfLinkTarget(target, scroll), anchor);
  assert.equal(pdfLinkTarget(target, { contains: () => false }), null);
  assert.equal(pdfLinkTarget({ nodeType: 1, closest: () => null }, scroll), null);
});
