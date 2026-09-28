"use strict";

// 读 PDF 时从状态栏继续：一段专注跑完后 phase 会翻到休息，
// 此时按下去必须开专注段——开成休息段的话，这段时间不计入教材学习时长，而且悄无声息。
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const handlers = new Map(), stored = new Map();
const workspace = {
  on(n, f) { handlers.set(n, [...(handlers.get(n) || []), f]); return {}; },
  trigger(n, ...a) { for (const f of handlers.get(n) || []) f(...a); },
};
const elem = () => ({ addClass() {}, createEl() { return { ...elem(), focus() {} }; } });
class Modal { constructor() { this.contentEl = elem(); } open() { this.onOpen?.(); } close() { this.onClose?.(); } }
class Plugin {
  constructor(app, m) { this.app = app; this.manifest = m; }
  loadData() { return stored.get(this.manifest.id); }
  async saveData(d) { stored.set(this.manifest.id, structuredClone(d)); }
  addCommand() {} registerEvent() {} registerInterval() {}
}
const original = Module._load;
Module._load = function (n) {
  if (n === "obsidian") return { Plugin, Modal, Notice: class {} };
  return original.apply(this, arguments);
};
global.window = { setInterval: () => 0 };

const Focus = require("../../l-os-focus/main.js");
const { ReadingFlow } = require("../reading-flow.js");

/** 只搭出 resumeReading 用得到的那几样；真正的继续逻辑在 ReadingFlow.resume 里，这里只包一层「空闲且在 PDF 里」的门禁。 */
async function build({ inPdf = true } = {}) {
  const app = { workspace, vault: { adapter: { read: async () => { throw Error("ENOENT"); } } }, plugins: { getPlugin: (id) => (id === "l-os-focus" ? focus : null) } };
  const focus = new Focus(app, { id: "l-os-focus-" + Math.random() });
  await focus.onload();

  const file = { path: "book/a.pdf", basename: "a" };
  const pdfLeaf = { view: { file, getViewType: () => "pdf" }, detach() {} };
  const otherLeaf = { view: { getViewType: () => "markdown" } };
  workspace.activeLeaf = inPdf ? pdfLeaf : otherLeaf;
  workspace.getLeavesOfType = () => [pdfLeaf];
  workspace.revealLeaf = async () => {};

  const toggled = [];
  const wb = {
    app, focusOwner: () => focus, views: new Set(), activate: async () => {},
    study: { checkpoint: async () => {} },
    data: { timer: focus.state() },
    tickViews() {},
    toggle(task) { toggled.push(task ?? null); },
    readingFile() {
      const view = this.app.workspace.activeLeaf?.view;
      return view?.getViewType?.() === "pdf" ? (view.file || null) : null;
    },
    async resumeReading(task) {
      const target = this.focusOwner().state().status === "idle" ? this.readingFile() : null;
      if (!target) return this.toggle(task);
      await this.readingFlow.resume(target);
      this.tickViews();
    },
  };
  wb.readingFlow = new ReadingFlow(wb);
  workspace.on("l-os-focus:finished", (s) => wb.readingFlow.finished(s));
  return { wb, focus, file, toggled, pdfLeaf };
}

/** 让当前这段立刻到期并结算，等同于跑满一段。 */
async function expire(focus) {
  await focus.setState({ ...focus.state(), endAt: Date.now() - 100, remaining: 0 });
  await focus.dispatch("finish");
}

test("跑完一段后从状态栏继续：开的是专注段，不是休息段", async () => {
  const { wb, focus, file } = await build();
  await wb.readingFlow.opened(file);
  assert.equal(focus.state().phase, "focus");

  await expire(focus);
  assert.equal(focus.state().phase, "break", "番茄钟跑完会把 phase 翻到休息");
  assert.equal(focus.state().status, "idle");

  wb.readingFlow.modal.close();          // 用 Esc 关掉完成弹窗
  await wb.resumeReading();
  assert.equal(focus.state().phase, "focus", "在 PDF 里继续，必须是专注段");
  assert.equal(focus.state().status, "running");
});

test("继续后完成弹窗的上下文要重新挂上，下一段跑完还会问你继续还是休息", async () => {
  const { wb, focus, file } = await build();
  await wb.readingFlow.opened(file);
  await expire(focus);
  wb.readingFlow.modal.close();

  await wb.resumeReading();
  assert.ok(wb.readingFlow.context, "没有上下文，下一段跑完就不再弹窗了");
  assert.equal(wb.readingFlow.context.id, focus.state().id);
});

test("弹窗还开着时按状态栏，走弹窗自己的继续，不是个死按钮", async () => {
  const { wb, focus, file } = await build();
  await wb.readingFlow.opened(file);
  const first = focus.state().id;
  await expire(focus);
  assert.ok(wb.readingFlow.pending, "此时弹窗开着");

  await wb.resumeReading();
  assert.equal(focus.state().status, "running");
  assert.equal(focus.state().phase, "focus");
  assert.notEqual(focus.state().id, first);
});

test("不在 PDF 里时不改行为，照旧走通用的 toggle", async () => {
  const { wb, toggled, focus } = await build({ inPdf: false });
  assert.equal(focus.state().status, "idle");
  await wb.resumeReading("自由专注");
  assert.deepEqual(toggled, ["自由专注"], "非阅读场景不该被接管");
});

test("计时进行中照旧走 toggle（暂停），不重开一段", async () => {
  const { wb, focus, file, toggled } = await build();
  await wb.readingFlow.opened(file);
  const id = focus.state().id;
  await wb.resumeReading("阅读：a");
  assert.deepEqual(toggled, ["阅读：a"]);
  assert.equal(focus.state().id, id, "不该换一段");
});
