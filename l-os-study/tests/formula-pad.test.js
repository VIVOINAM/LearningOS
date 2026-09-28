"use strict";

// 速记板的接线：粘贴要翻译定界符并整段渲染，存卡片要把 Markdown 落到当前页。
// 翻译规则本身在 formula-model.test.js 里测；这里只测"粘进去会发生什么"。
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { bundle } = require("../../tools/bundler");

function fakeElement(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    value: "",
    textContent: "",
    children: [],
    dataset: {},
    style: {},
    classes: new Set(),
    listeners: new Map(),
    classList: {
      add: (...names) => names.forEach(n => node.classes.add(n)),
      remove: (...names) => names.forEach(n => node.classes.delete(n)),
      contains: name => node.classes.has(name),
      toggle: (name, on) => (on ? node.classes.add(name) : node.classes.delete(name)),
    },
    appendChild(child) { node.children.push(child); return child; },
    replaceChildren(...next) { node.children = next; },
    setAttribute() {},
    focus() {},
    addEventListener(name, fn) { node.listeners.set(name, fn); },
    removeEventListener() {},
    // 真 textarea 的语义：把选区换成 text，光标落到末尾。
    setRangeText(text, start, end) { node.value = node.value.slice(0, start) + text + node.value.slice(end); },
  };
  Object.defineProperty(node, "className", { set(v) { for (const n of String(v).split(/\s+/)) if (n) node.classes.add(n); }, get: () => [...node.classes].join(" ") });
  return node;
}

function mount({ page = 7, renderThrows = false } = {}) {
  const rendered = [];
  const added = [];
  const tabs = [];
  const sandbox = { module: { exports: {} }, console, setTimeout, clearTimeout, URL, document: { createElement: fakeElement } };
  sandbox.require = name => name === "obsidian"
    ? {
        Notice: class {}, Modal: class { open() {} }, Menu: class {},
        Component: class { load() {} unload() {} },
        MarkdownRenderer: { render: async (app, md, target) => { rendered.push(md); if (renderThrows) throw new Error("mathjax 炉子没点着"); target.appendChild(fakeElement("div")); } },
      }
    : require(name);
  vm.runInNewContext(bundle(require.resolve("../core/formula-pad.ts")).code, sandbox);

  const engine = {
    p: { app: {} },
    notePath: path => `03 知识库/教材笔记/${path.replace(/\.pdf$/, ".md")}`,
    record: () => ({ annotations: [] }),
    add: async (path, input) => { added.push({ path, ...input }); },
  };
  const ctx = { path: "book.pdf", closed: false, pdf: { currentPageNumber: page }, win: {}, mdOwner: {}, setTab: key => tabs.push(key) };
  const parent = fakeElement("div");
  sandbox.module.exports.mountFormulaPad(engine, ctx, parent);
  const wrap = parent.children[0];
  return { wrap, rendered, added, tabs, input: wrap.children.find(c => c.tagName === "TEXTAREA") };
}

const paste = (input, text) => {
  let prevented = 0;
  input.listeners.get("paste")({ clipboardData: { getData: () => text }, preventDefault: () => prevented++ });
  return prevented;
};

const saveButton = wrap => wrap.children.find(c => c.classes.has("cs-formula-actions")).children.find(c => c.classes.has("cs-formula-save"));

const PASTED = "这一定理是在说：\n\\[ \\boxed{PA=LU} \\]\n这些换行由 \\(P\\) 记录。";
const CONVERTED = "这一定理是在说：\n\n$$\n\\boxed{PA=LU}\n$$\n\n这些换行由 $P$ 记录。";

test("粘贴一整段：翻译定界符后落进输入框并立即整段渲染", () => {
  const { input, rendered } = mount();
  assert.equal(paste(input, PASTED), 1, "翻译了定界符就必须接管这次粘贴");
  assert.equal(input.value, CONVERTED);
  assert.equal(rendered.at(-1), CONVERTED, "渲染的是翻译后的 Markdown，不是原始源码");
});

test("没有定界符可翻译时放行：输入法与撤销栈交回浏览器", () => {
  const { input, rendered } = mount();
  const before = rendered.length;
  assert.equal(paste(input, "一句普通的话"), 0, "不该 preventDefault");
  assert.equal(input.value, "", "默认粘贴由浏览器完成，这里不写值");
  assert.equal(rendered.length, before, "没接管就不该额外渲染");
});

test("存为卡片：Markdown 落到当前页，存完清空并切回附近笔记", async () => {
  const { wrap, input, added, tabs } = mount({ page: 42 });
  input.value = PASTED;
  await saveButton(wrap).listeners.get("click")({ stopPropagation() {} });

  assert.deepEqual(added, [{ path: "book.pdf", page: 42, note: CONVERTED, kind: "highlight" }]);
  assert.equal(input.value, "", "存完清空，下一段直接粘");
  assert.deepEqual(tabs, ["notes"], "切回附近笔记，让新卡片看得见");
});

test("空输入不落盘，也不切标签", async () => {
  const { wrap, added, tabs } = mount();
  await saveButton(wrap).listeners.get("click")({ stopPropagation() {} });
  assert.deepEqual(added, []);
  assert.deepEqual(tabs, []);
});

test("渲染失败退回源码，不把面板留空", async () => {
  const { wrap, input, rendered } = mount({ renderThrows: true });
  const preview = wrap.children.find(c => c.classes.has("cs-formula-preview"));
  paste(input, PASTED);
  assert.equal(rendered.at(-1), CONVERTED, "试过一次");
  await new Promise(r => setTimeout(r, 0)); // 等那个被拒绝的 Promise 落地
  assert.equal(preview.classes.has("is-raw"), true);
  assert.equal(preview.textContent, CONVERTED, "退回源码，不是一片空白");
});
