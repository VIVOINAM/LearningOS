"use strict";

// 5.6.2 退役了独立的「LaTeX 公式」字段。旧卡片里的公式必须并进批注，不能在读取时静悄悄丢掉。
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

const engineWith = annotations => {
  const StudyEngine = loadEngine();
  const plugin = {
    app: { vault: { getAbstractFileByPath: () => null }, fileManager: null },
    data: { study: { records: { "book.pdf": { annotations, daily: {}, dailyPages: {}, position: null, next: "" } } }, sessions: [] },
    run: fn => fn(), save: async () => {},
  };
  return new StudyEngine(plugin);
};

test("旧的 latex 并进批注，裹在 $$ 里，字段本身清掉", () => {
  const engine = engineWith([{ id: "a", page: 3, note: "这一步是消元", latex: "\\begin{pmatrix} 1&0\\\\ 2&1 \\end{pmatrix}" }]);
  const [annotation] = engine.record("book.pdf").annotations;

  assert.equal(annotation.note, "这一步是消元\n\n$$\n\\begin{pmatrix} 1&0\\\\ 2&1 \\end{pmatrix}\n$$");
  assert.equal("latex" in annotation, false, "字段要真的删掉，不是留个空串");
});

test("只有公式没有批注时，批注就是那个公式，不留空行", () => {
  const engine = engineWith([{ id: "a", page: 3, note: "", latex: "PA=LU" }]);
  assert.equal(engine.record("book.pdf").annotations[0].note, "$$\nPA=LU\n$$");
});

test("没有 latex 的卡片一个字不动；重复读取不会反复追加", () => {
  const engine = engineWith([{ id: "a", page: 3, note: "一句普通批注" }, { id: "b", page: 4, note: "有公式 $x^2$" }]);
  engine.record("book.pdf");
  const [plain, withMath] = engine.record("book.pdf").annotations;
  assert.equal(plain.note, "一句普通批注");
  assert.equal(withMath.note, "有公式 $x^2$");
});

test("迁移是幂等的：读两次不会把公式贴两遍", () => {
  const engine = engineWith([{ id: "a", page: 3, note: "消元", latex: "PA=LU" }]);
  engine.record("book.pdf");
  engine.record("book.pdf");
  assert.equal(engine.record("book.pdf").annotations[0].note, "消元\n\n$$\nPA=LU\n$$");
});

test("导出的教材笔记里不再单独写一段 $$：批注本身已经带着公式", () => {
  const engine = engineWith([{ id: "a", page: 3, note: "消元", latex: "PA=LU" }]);
  const markdown = engine.studyMarkdown("book.pdf");
  assert.equal(markdown.split("$$").length - 1, 2, "只有并进批注的那一对 $$");
  assert.ok(markdown.includes("消元\n\n$$\nPA=LU\n$$"));
});
