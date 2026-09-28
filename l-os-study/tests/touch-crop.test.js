"use strict";

// 触控框选：待命与拖拽时必须阻止页面平移，否则笔一拖就变成翻页。
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { bundle } = require("../../tools/bundler");

function loadOverlay() {
  const sandbox = { module: { exports: {} }, console, setTimeout, clearTimeout, URL, document: { createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }) } };
  sandbox.require = name => name === "obsidian"
    ? { Notice: class {}, Modal: class { open() {} }, Menu: class {}, renderMath: () => ({}) }
    : require(name);
  vm.runInNewContext(bundle(require.resolve("../core/pdf-overlay.ts")).code, sandbox);
  return sandbox.module.exports.PdfOverlay;
}

function fakeTarget(log, label) {
  return {
    label,
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener: (name, fn, options) => log.push({ target: label, name, fn, options }),
    removeEventListener: () => {},
    ownerDocument: { defaultView: null },
  };
}

function build() {
  const PdfOverlay = loadOverlay();
  const log = [];
  const scroll = fakeTarget(log, "scroll");
  const win = fakeTarget(log, "win");
  win.document = fakeTarget(log, "document");
  win.getSelection = () => null;
  const overlay = new PdfOverlay({ report() {} }, { scroll, win, path: "a.pdf" });
  return { overlay, log };
}

test("注册了非被动的 touchmove：被动监听里 preventDefault 无效，拦不住平移", () => {
  const { log } = build();
  const entry = log.find(e => e.name === "touchmove");
  assert.ok(entry, "必须监听 touchmove");
  assert.equal(entry.target, "scroll");
  assert.equal(entry.options?.passive, false, "passive 必须显式为 false");
  assert.equal(entry.options?.capture, true);
});

test("待命或拖拽时阻止默认行为，空闲时放行页面滚动", () => {
  const { overlay, log } = build();
  // 调真正注册进去的那个处理函数，而不是在测试里重写一遍判断。
  const handler = log.find(e => e.name === "touchmove").fn;
  let prevented = 0;
  const event = { preventDefault: () => prevented++ };

  overlay.armed = false; overlay.drag = null;
  handler(event);
  assert.equal(prevented, 0, "空闲时手指必须还能滚页");

  overlay.armed = true;
  handler(event);
  assert.equal(prevented, 1, "按 Z 待命后不能再被页面平移抢走");

  overlay.armed = false; overlay.drag = { id: 1 };
  handler(event);
  assert.equal(prevented, 2, "拖拽过程中同样要拦住");
});
