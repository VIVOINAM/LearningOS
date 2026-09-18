"use strict";

/**
 * 开工前那一问的契约：它可以什么都不做，但绝不能挡住开始专注。
 *
 * startPlan 是最常按的那条路径，而 6.2 在它中间插了一个弹窗。
 * 弹窗不回调、构造就抛、用户直接关掉——三种情况都必须继续往下走。
 */

const assert = require("node:assert/strict");
const Module = require("node:module");

let modalBehavior = "answer-2";
const opened = [];

class Modal {
  constructor(app) { this.app = app; this.contentEl = fakeEl(); }
  open() {
    opened.push(this);
    if (modalBehavior === "throw-on-open") throw Error("弹窗坏了");
    if (modalBehavior === "never-calls-back") return;
    this.onOpen?.();
    if (modalBehavior === "answer-2") this.pick(2);
    else if (modalBehavior === "skip") this.skip();
    else if (modalBehavior === "dismiss") this.close();
  }
  close() { this.onClose?.(); }
}
function fakeEl() {
  const el = {
    children: [],
    classList: { add() {}, remove() {} },
    replaceChildren() { el.children.length = 0; },
    empty() { el.children.length = 0; },
    appendChild(child) { el.children.push(child); return child; },
    createEl() { return fakeEl(); },
    addEventListener() {},
    setAttribute() {},
    style: {},
  };
  return el;
}

const original = Module._load;
Module._load = function (name) {
  if (name === "obsidian") return { Plugin: class {}, Modal, Notice: class {}, ItemView: class {}, Menu: class { addItem() { return this; } showAtPosition() {} }, setIcon() {}, parseYaml: () => ({}), MarkdownRenderer: { render: async () => {} }, Component: class { load() {} unload() {} } };
  return original.apply(this, arguments);
};
// shared/dom 直接操作 document，夹具里给一个够用的桩。
global.document = { createElement: () => fakeEl() };
global.window = { setInterval: () => 0 };

const CodexWorkbench = require("../codex-workbench/main.js");
const { EstimateModal } = require("../codex-workbench/estimate-modal.js");

// EstimateModal 在 onOpen 里把两个动作挂到实例上，夹具据此模拟点击。
const realOnOpen = EstimateModal.prototype.onOpen;
EstimateModal.prototype.onOpen = function () {
  this.pick = (value) => { this.answered = true; this.resolve(value); this.close(); };
  this.skip = () => { this.answered = true; this.resolve(0); this.close(); };
  try { realOnOpen.call(this); } catch { /* 夹具的 DOM 桩不完整，不影响契约 */ }
};

function host(tasks, sessions, patched) {
  return {
    app: {},
    data: { sessions },
    focus: { settings: () => ({ focusMinutes: 25 }) },
    captureOwner: () => ({
      index: { all: async () => tasks },
      patchTask: async (task, patch) => { patched.push(patch); return { ...task, ...patch }; },
    }),
  };
}

(async () => {
  const ask = CodexWorkbench.prototype.askEstimate;

  // 1. 没估过、没做过 → 问，答 2 就写回去，并补上番茄时长单位。
  {
    const patched = [];
    const task = { id: "t1", text: "推导", project: "A" };
    modalBehavior = "answer-2";
    await ask.call(host([task], [], patched), task);
    assert.equal(patched.length, 1, "应写回一次");
    assert.equal(patched[0].estimated_pomodoros, 2);
    assert.equal(patched[0].budget_unit_minutes, 25, "没设过单位时补默认值");
    assert.equal(task.estimated_pomodoros, 2, "任务对象要就地更新，调用方紧接着就要用");
  }

  // 2. 已经估过 → 不问。
  {
    const patched = [];
    const before = opened.length;
    const task = { id: "t2", estimated_pomodoros: 4 };
    await ask.call(host([task], [], patched), task);
    assert.equal(opened.length, before, "估过的任务不该再弹");
    assert.equal(patched.length, 0);
  }

  // 3. 做过了 → 不问，问也晚了。分片里的 taskId 同样算做过。
  for (const sessions of [[{ taskId: "t3" }], [{ slices: [{ taskId: "t3" }] }]]) {
    const patched = [];
    const before = opened.length;
    const task = { id: "t3" };
    await ask.call(host([task], sessions, patched), task);
    assert.equal(opened.length, before, "做过的任务不该再弹");
    assert.equal(patched.length, 0);
  }

  // 4. 「先不估」与直接关掉：不写任何东西，也不报错。
  for (const behavior of ["skip", "dismiss"]) {
    const patched = [];
    const task = { id: "t4" };
    modalBehavior = behavior;
    await ask.call(host([task], [], patched), task);
    assert.equal(patched.length, 0, behavior);
    assert.equal(task.estimated_pomodoros, undefined, behavior);
  }

  // 5. 弹窗构造/打开就抛 → 当作先不估，继续往下走。
  {
    const patched = [];
    const task = { id: "t5" };
    modalBehavior = "throw-on-open";
    await ask.call(host([task], [], patched), task);
    assert.equal(patched.length, 0);
  }

  // 6. 任务索引读不到也不能卡住——照样问，只是没有历史可参考。
  {
    const patched = [];
    const task = { id: "t6" };
    modalBehavior = "answer-2";
    const broken = host([task], [], patched);
    broken.captureOwner = () => ({ index: { all: async () => { throw Error("索引未就绪"); } }, patchTask: async (t, p) => { patched.push(p); return { ...t, ...p }; } });
    await ask.call(broken, task);
    assert.equal(patched.length, 1, "索引失败不该跳过提问");
  }

  console.log("估算提问通过：只问一次 / 先不估不写 / 关掉不报错 / 弹窗坏了也不挡开工。");
})().catch((error) => { console.error(error); process.exitCode = 1; });
