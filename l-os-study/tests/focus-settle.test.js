"use strict";

// 专注时长归到哪本书：settle 每轮把新走的秒数记进当天。
// 5.6.5 之前，换一段（点「继续专注」）时整轮跳过，每段开头到第一次结算之间的时间都丢了。
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { bundle } = require("../../tools/bundler");

function loadEngine() {
  const sandbox = { module: { exports: {} }, console, setTimeout, clearTimeout, URL, Date, Math,
    document: { createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, setAttribute() {}, addEventListener() {} }) } };
  sandbox.require = name => name === "obsidian"
    ? { Modal: class { open() {} }, Notice: class {}, Menu: class {}, Component: class { load() {} unload() {} }, MarkdownRenderer: { render: async () => {} } }
    : require(name);
  vm.runInNewContext(bundle(require.resolve("../core/study-engine.js")).code, sandbox);
  return sandbox.module.exports.StudyEngine;
}

/** 一台只认 remaining 的假计时器：直接摆布 id / phase / 已走秒数。 */
function harness(activePath = "book/a.pdf", { seed = true } = {}) {
  const StudyEngine = loadEngine();
  const timer = { id: null, phase: "focus", duration: 1500, elapsed: 0 };
  const plugin = {
    app: { vault: { getAbstractFileByPath: () => null }, fileManager: null },
    timerCore: { remaining: (t) => t.duration - t.elapsed },
    data: { study: { records: {}, cursor: null, activePath }, get timer() { return timer; }, sessions: [] },
    run: (fn) => fn(), save: async () => {},
  };
  const engine = new StudyEngine(plugin);
  engine.data.activePath = activePath;
  // 真实运行时 pulse 从插件加载就每 5 秒结算一次，开一段之前游标早就在了。
  if (seed) engine.settle();
  return {
    engine, timer, plugin,
    seconds: (path = activePath) => Object.values(engine.record(path).daily || {}).reduce((a, b) => a + b, 0),
    /** 走 n 秒再结算一次，模拟 5 秒一次的 pulse。 */
    run: (n) => { timer.elapsed = Math.min(timer.duration, timer.elapsed + n); engine.settle(); },
    /** 开新的一段：id 变、已走秒数归零。 */
    restart: () => { timer.id = `s${Math.random()}`; timer.elapsed = 0; },
  };
}

test("同一段内：每轮只补新走的那几秒", () => {
  const h = harness();
  h.restart();
  h.run(5); h.run(5); h.run(5);
  assert.equal(h.seconds(), 15);
});

test("换段不再丢时间：继续专注的第一轮结算要把这一段开头的秒数补上", () => {
  const h = harness();
  h.restart();
  for (let i = 0; i < 4; i += 1) h.run(5);   // 第一段 20 秒
  assert.equal(h.seconds(), 20);

  // 一段跑完 → 计时器回到 idle（id 为空），再点继续专注开新的一段
  h.timer.id = null; h.timer.elapsed = 0; h.engine.settle();
  h.restart();
  h.run(5);
  assert.equal(h.seconds(), 25, "新一段开头那 5 秒必须记上，此前整轮跳过");
  h.run(5);
  assert.equal(h.seconds(), 30);
});

test("连着继续三段，一秒不差", () => {
  const h = harness();
  for (let seg = 0; seg < 3; seg += 1) {
    h.restart();
    for (let i = 0; i < 6; i += 1) h.run(10);  // 每段 60 秒
    h.timer.id = null; h.timer.elapsed = 0; h.engine.settle();
  }
  assert.equal(h.seconds(), 180);
});

test("休息段不计入教材学习时长", () => {
  const h = harness();
  h.restart(); h.run(30);
  h.timer.id = null; h.engine.settle();
  h.timer.phase = "break"; h.restart();
  h.run(300);
  assert.equal(h.seconds(), 30, "休息的 300 秒不算读书");
});

test("冷启动不凭空补时间：从未结算过时只落一个游标", () => {
  const h = harness("book/a.pdf", { seed: false });
  h.restart();
  h.timer.elapsed = 900;      // 计时器已经跑了 15 分钟，但本机从未结算过
  h.engine.settle();
  assert.equal(h.seconds(), 0, "那 15 分钟未必发生在这台机器上，不能凭空记账");
  h.run(5);
  assert.equal(h.seconds(), 5);
});

test("没有当前教材时不乱记账", () => {
  const h = harness(null);
  h.restart();
  h.run(30);
  assert.deepEqual(Object.keys(h.engine.data.records), []);
});
