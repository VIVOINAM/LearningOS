"use strict";

/**
 * L-OS 3.0 lifecycle smoke test.
 *
 * 它不替真实 Obsidian 实机验收，但会在 Node 中用最小 app/vault mock：
 * - 加载 dist/plugins 下的自包含 main.js；
 * - 走一遍 focus / capture / iteration / study 的 onload；
 * - 验证旧 workbench 数据能迁移到 focus 与 study owner。
 */

const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..");
const PLUGIN_ROOT = path.join(ROOT, "dist", "plugins");
const TODAY = new Date().toISOString().slice(0, 10);

class MockPlugin {
  constructor(app) {
    this.app = app;
    this.__listeners = [];
  }
  async loadData() { return this.__data || null; }
  async saveData(data) { this.__data = data; }
  addCommand() {}
  addRibbonIcon() {}
  registerInterval() {}
  registerEvent() {}
  registerDomEvent() {}
  register() {}
}

class MockFile {
  constructor(path, content = "") {
    this.path = path;
    this.content = content;
    this.basename = path.split("/").pop().replace(/\.[^.]+$/, "");
    this.extension = path.split(".").pop();
    this.stat = { mtime: Date.now(), ctime: Date.now(), size: content.length };
  }
}

class MockVault {
  on() { return {}; }
  constructor(legacy) {
    this.legacy = legacy;
    this.files = new Map();
    // l-os-study 5.2 起用 vault.adapter 直接读写元数据：stub 必须实现 exists 并真的存住写入，
    // 否则插件一加载就抛 exists is not a function。
    this.written = new Map();
    this.adapter = {
      exists: async (p) => this.written.has(p) || this.files.has(p),
      read: async (p) => {
        if (this.written.has(p)) return this.written.get(p);
        if (p === ".obsidian/plugins/l-os-workbench/data.json" && this.legacy) {
          return JSON.stringify(this.legacy);
        }
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
  getAbstractFileByPath(p) { return this.files.get(p) || null; }
  createFolder(p) {
    if (this.files.has(p)) throw new Error("Folder already exists");
    this.files.set(p, { path: p, folder: true });
  }
  async create(p, text) {
    if (this.files.has(p)) throw new Error("File already exists");
    const file = new MockFile(p, text);
    this.files.set(p, file);
    return file;
  }
  async process(file, fn) {
    file.content = fn(file.content || "");
    return file;
  }
  async cachedRead(file) { return file.content || ""; }
  async read(file) { return file.content || ""; }
  async modify(file,text) { file.content=text; }
  getMarkdownFiles() { return [...this.files.values()].filter((file) => file.path.endsWith(".md")); }
  getFiles() { return [...this.files.values()]; }
}

const obsidian = {
  Plugin: MockPlugin,
  ItemView: class {},
  Modal: class {},
  Notice: class {},
  Menu: class {},
  requestUrl: async () => ({ json: { current: { temperature_2m: 20, weather_code: 0 } } }),
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "obsidian") return obsidian;
  return originalLoad.apply(this, arguments);
};
global.window = { setInterval: () => 0, clearInterval: () => {}, addEventListener: () => {} };
global.document = {};

function makeApp(legacy) {
  const vault = new MockVault(legacy);
  const plugins = {};
  const app = {
    vault,
    plugins: {
      plugins,
      getPlugin: (id) => plugins[id] || null,
    },
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
    timer: { phase: "focus", status: "paused", duration: 1800, remaining: 600, endAt: null, task: "旧任务", id: "focus-1" },
    sessions: [{ id: "s1", task: "旧任务", phase: "focus", seconds: 900, completed: false, endedAt: Date.now() }],
    focusMinutes: 50,
    breakMinutes: 10,
    study: {
      records: {
        "book/a.pdf": {
          position: { page: 7 },
          annotations: [{ id: "q1", kind: "question", page: 7, text: "why" }],
          daily: { [TODAY]: 120 },
          next: "继续",
        },
      },
      goal: { minutes: 90, pages: 12 },
      cursor: null,
      activePath: "book/a.pdf",
      startedAt: 0,
    },
  };

  const app = makeApp(legacy);

  const Focus = load("l-os-focus");
  const focus = new Focus(app, { id: "l-os-focus", version: "3.0.0" });
  app.plugins.plugins["l-os-focus"] = focus;
  await focus.onload();
  assert.equal(focus.state().task, "旧任务");
  assert.equal(focus.sessions().length, 1);
  assert.equal(focus.settings().focusMinutes, 50);

  const Study = load("l-os-study");
  const study = new Study(app, { id: "l-os-study", version: "3.0.0" });
  app.plugins.plugins["l-os-study"] = study;
  await study.onload();
  assert.ok(study.engine, "study engine should be created");
  assert.equal(study.data.study.records["book/a.pdf"].next, "继续");
  assert.equal(study.data.study.goal.minutes, 90);
  await study.run(() => study.engine.settle());
  await study.save();
  const reloadedStudy=new Study(app,{id:'l-os-study',version:'5.2.0'});
  await reloadedStudy.onload();
  assert.equal(reloadedStudy.data.study.records['book/a.pdf'].next,'继续');
  assert.ok(app.vault.getAbstractFileByPath('03 知识库/教材切片/学习元数据.json'));

  const Capture = load("l-os-capture");
  const capture = new Capture(app, { id: "l-os-capture", version: "3.0.0" });
  await capture.onload();
  assert.equal(typeof capture.taskModel.parseTaskLines, "function");

  console.log("生命周期 smoke：focus / study / capture 全部通过。");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
