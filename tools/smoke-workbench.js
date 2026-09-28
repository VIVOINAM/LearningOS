"use strict";

/** L-OS 3.0 workbench onload smoke test with a minimal DOM mock. */

const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..");
const PLUGIN_ROOT = path.join(ROOT, "dist", "plugins");

function fakeElement(tag = "div") {
  const element = {
    tagName: String(tag).toUpperCase(),
    children: [],
    className: "",
    textContent: "",
    value: "",
    hidden: false,
    disabled: false,
    dataset: {},
    style: { setProperty() {}, removeProperty() {}, cssText: "" },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {},
    getAttribute() { return null; },
    appendChild(child) { this.children.push(child); return child; },
    insertBefore(child) { this.children.push(child); return child; },
    replaceChildren() { this.children = []; },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    focus() {},
    click() {},
    getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
    empty() { this.children = []; },
    remove() {},
    set onclick(value) { this._onclick = value; },
    get onclick() { return this._onclick; },
  };
  return element;
}

global.document = {
  createElement: (tag) => fakeElement(tag),
  createElementNS: (_ns, tag) => fakeElement(tag),
  createTextNode: (text) => ({ textContent: String(text) }),
  querySelector: () => null,
  addEventListener() {},
  removeEventListener() {},
};
global.window = { setInterval: () => 0, clearInterval: () => {}, addEventListener() {}, dispatchEvent() {} };

class MockFile {
  constructor(filePath, content = "") {
    this.path = filePath;
    this.content = content;
    this.basename = filePath.split("/").pop().replace(/\.[^.]+$/, "");
    this.extension = filePath.split(".").pop();
    this.stat = { mtime: Date.now(), ctime: Date.now(), size: content.length };
  }
}

class MockPlugin {
  constructor(app, manifest) { this.app = app; this.manifest = manifest || {}; this.__data = null; }
  async loadData() { return this.__data; }
  async saveData(data) { this.__data = data; }
  addCommand() {}
  addRibbonIcon() {}
  registerInterval() {}
  registerEvent() {}
  registerDomEvent() {}
  register() {}
  registerView(type, factory) { this.__views = this.__views || {}; this.__views[type] = factory; }
  registerMarkdownPostProcessor() {}
  addStatusBarItem() { return fakeElement("div"); }
}

class MockVault {
  constructor(legacy) {
    this.legacy = legacy;
    this.files = new Map();
    // 同 smoke-lifecycle：l-os-study 的元数据走 vault.adapter，stub 需要 exists 与真正的写入。
    this.written = new Map();
    this.adapter = {
      exists: async (p) => this.written.has(p) || this.files.has(p),
      read: async (p) => {
        if (this.written.has(p)) return this.written.get(p);
        if (p === ".obsidian/plugins/l-os-workbench/data.json" && this.legacy) return JSON.stringify(this.legacy);
        const error = new Error(`ENOENT: ${p}`);
        error.code = "ENOENT";
        throw error;
      },
      // 真实 Vault 里 adapter.write 出来的文件同样会被索引到，stub 要保持这一点。
      write: async (p, text) => {
        this.written.set(p, text);
        const file = this.files.get(p);
        if (file && !file.folder) file.content = text;
        else this.files.set(p, new MockFile(p, text));
      },
    };
  }
  on() { return {}; }
  getAbstractFileByPath(p) { return this.files.get(p) || null; }
  createFolder(p) { if (this.files.has(p)) throw new Error("Folder already exists"); this.files.set(p, { path: p, folder: true }); }
  async create(p, text) { if (this.files.has(p)) throw new Error("File already exists"); const file = new MockFile(p, text); this.files.set(p, file); return file; }
  async process(file, fn) { file.content = fn(file.content || ""); return file; }
  async cachedRead(file) { return file.content || ""; }
  getMarkdownFiles() { return [...this.files.values()].filter((file) => file.path.endsWith(".md")); }
  getFiles() { return [...this.files.values()]; }
}

const obsidian = {
  parseYaml: text => Object.fromEntries(text.split('\n').filter(s=>s.includes(':')).map(s=>{const i=s.indexOf(':');return [s.slice(0,i).trim(),s.slice(i+1).trim()];})),
  Plugin: MockPlugin,
  ItemView: class ItemView { constructor(leaf) { this.leaf = leaf; this.containerEl = fakeElement(); this.contentEl = fakeElement(); } registerEvent() {} },
  Modal: class Modal { constructor(app) { this.app = app; this.contentEl = fakeElement(); } open() {} close() {} },
  Notice: class Notice {},
  Component: class Component { load() {} unload() {} },
  MarkdownRenderer: { render: async (_app, markdown, target) => { target.textContent = markdown; } },
  Menu: class Menu {},
  setIcon: () => {},
  requestUrl: async () => ({ json: { current: { temperature_2m: 20, weather_code: 0 } } }),
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "obsidian") return obsidian;
  return originalLoad.apply(this, arguments);
};

function makeApp(legacy) {
  const vault = new MockVault(legacy);
  const plugins = {};
  const app = {
    vault,
    plugins: { plugins, getPlugin: (id) => plugins[id] || null },
    workspace: {
      onLayoutReady: (fn) => fn(),
      on: () => ({}),
      trigger: () => {},
      getLeavesOfType: () => [],
      getLeaf: () => ({ setViewState: async () => {} }),
      revealLeaf: async () => {},
      openLinkText: async () => {},
      activeLeaf: null,
    },
    metadataCache: { on: () => ({}), getFileCache: () => null },
  };
  return app;
}

function load(id) {
  const built = path.join(PLUGIN_ROOT, id, "main.js");
  delete require.cache[require.resolve(built)];
  return require(built);
}

async function main() {
  const legacy = {
    focusMinutes: 50,
    breakMinutes: 10,
    priorities: { [new Date().toISOString().slice(0, 10)]: "重要事项" },
    countdown: { title: "学期结束", date: "2026-12-22" },
  };
  const app = makeApp(legacy);
  app.vault.files.set("00 工作台/今日任务.md", new MockFile("00 工作台/今日任务.md", "# 今日任务\n\n- [ ] 复习数学分析\n- [ ] 整理流体笔记 <!-- plan:%7B%22estimate%22%3A2%7D -->\n"));
  app.vault.files.set("01 收件箱/收件箱.md", new MockFile("01 收件箱/收件箱.md", "# 收件箱\n\n## 2026-09-12 10:00\n\n一个想法\n"));
  app.vault.files.set("book/a.pdf", new MockFile("book/a.pdf", ""));
  app.vault.files.set("03 知识库/note.md", new MockFile("03 知识库/note.md", "# 笔记\n"));
  app.vault.files.set("02 项目/proj.md", new MockFile("02 项目/proj.md", "---\ntype: project\nstatus: 进行中\nnext: 写下一章\ndue: 2026-09-20\n---\n# 项目\n"));

  const Focus = load("l-os-focus");
  const focus = new Focus(app, { id: "l-os-focus", version: "3.0.0" });
  app.plugins.plugins["l-os-focus"] = focus;
  await focus.onload();

  const Study = load("l-os-study");
  const study = new Study(app, { id: "l-os-study", version: "3.0.0" });
  app.plugins.plugins["l-os-study"] = study;
  await study.onload();

  const Capture = load("l-os-capture");
  const capture = new Capture(app, { id: "l-os-capture", version: "3.0.0" });
  app.plugins.plugins["l-os-capture"] = capture;
  await capture.onload();

  const Workbench = load("l-os-workbench");
  const workbench = new Workbench(app, { id: "l-os-workbench", version: "4.1.1" });
  workbench.__data = { ...legacy, lastTextbook: "book/a.pdf" };
  app.plugins.plugins["l-os-workbench"] = workbench;
  await workbench.onload();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(workbench.focus, focus, "workbench should bind l-os-focus");
  assert.equal(workbench.study, study.engine, "workbench should bind l-os-study engine");
  assert.equal(workbench.data.timer.task, "", "timer proxy should read focus state");
  assert.equal(workbench.data.focusMinutes, 50, "focus settings should migrate from legacy workbench data");
  assert.equal(workbench.refreshWeather, undefined, "V4 removes weather networking");
  const factory = workbench.__views && workbench.__views["l-os-workbench"];
  assert.ok(factory, "workbench should register console view factory");
  const leaf = { view: null };
  const view = factory(leaf);
  await view.onOpen();
  assert.ok(view.content && view.content.children.length > 0, "console view should render cards");
  view.tick();
  for (const tab of ["today", "tasks", "study", "heatmap", "knowledge", "review"]) {
    view.tab = tab;
    await view.refresh();
    assert.ok(view.content.children.length > 0, `tab ${tab} should render`);
  }
  view.onClose();

  // 一门课可以关联很多份教材：一份直接开，多份先让人选，一份都没有时不要静默失败。
  app.vault.files.set("book/b.pdf", new MockFile("book/b.pdf", ""));
  const course = workbench.courseCatalog()[0];
  const opened = [];
  workbench.openTextbook = async (file) => { opened.push(file.path); };
  workbench.data.courses = { [course.id]: { next: "", exam: "", books: [], folders: [] } };

  await workbench.startCourse(course);
  assert.deepEqual(opened, [], "没关联教材时不该打开任何 PDF");

  workbench.data.courses[course.id].books = ["book/a.pdf"];
  assert.equal(workbench.courseBooksFor(course).length, 1);
  await workbench.startCourse(course);
  assert.deepEqual(opened, ["book/a.pdf"], "只有一份时应当直接打开，不要多一次点击");

  workbench.data.courses[course.id].books = ["book/a.pdf", "book/b.pdf"];
  assert.equal(workbench.courseBooksFor(course).length, 2, "两份都要算进来，否则下一条断言会假过");
  await workbench.startCourse(course);
  assert.deepEqual(opened, ["book/a.pdf"], "两份以上时应当先弹选择，而不是替人挑一份");

  // 只能要一份的地方（任务跳转、选择弹窗的排序）优先上次在读的那一份。
  workbench.data.lastTextbook = "book/b.pdf";
  assert.equal(workbench.preferredBookFor(course), "book/b.pdf", "应当优先上次在读的那一份");
  workbench.data.lastTextbook = "book/不在这门课.pdf";
  assert.equal(workbench.preferredBookFor(course), "book/a.pdf", "上次在读的不属于这门课时退回第一份");

  // 关联文件夹里的 .m 进课程主页的「关联代码」：按子目录分组、目录名只写一次；E00 排在「附加练习」前面（和资料索引一致），
  // 同一目录里按数字排序；直接放在课程文件夹里的脚本不缩进；文件夹外的不算；没有 .m 的课不出这一节。
  const folder = "课程文件/测试课";
  const X = "02 习题课/附加练习 Esercizi", E = "02 习题课/E00 Intro";
  for (const p of [`${folder}/${X}/ex10_b.m`, `${folder}/${X}/ex2_a.m`, `${folder}/${E}/E00_00_x.m`, `${folder}/main.m`, `${folder}/${X}/讲义.pdf`, "别处/x.m"])
    app.vault.files.set(p, new MockFile(p, ""));
  workbench.data.courses[course.id].folders = [folder];
  assert.deepEqual(workbench.courseCodeFor(course).map(r => r.label), ["main.m", `${E}/E00_00_x.m`, `${X}/ex2_a.m`, `${X}/ex10_b.m`]);
  const coursePage = await workbench.syncCourse(course);
  const expected = ["### 关联代码", `- [[${folder}/main.m|main.m]]`, "- E00 Intro", `\t- [[${folder}/${E}/E00_00_x.m|E00_00_x.m]]`,
    "- 附加练习 Esercizi", `\t- [[${folder}/${X}/ex2_a.m|ex2_a.m]]`, `\t- [[${folder}/${X}/ex10_b.m|ex10_b.m]]`, "<!-- /cw-course -->"].join("\n");
  assert.ok(coursePage.content.includes(expected), coursePage.content);
  workbench.data.courses[course.id].folders = [];
  assert.ok(!(await workbench.syncCourse(course)).content.includes("### 关联代码"), "没有 .m 的课不该多出一节");

  console.log("workbench onload smoke：通过");
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(error.stack || error.message); process.exit(1); });
