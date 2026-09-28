"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const ROOT = path.resolve(__dirname, "..");
const VAULT = path.resolve(ROOT, "..");
const STAGE_MODE = process.argv.includes("--stage");
const PLUGIN_ROOT = STAGE_MODE ? path.join(ROOT, "dist", "plugins") : path.join(VAULT, ".obsidian", "plugins");
const PLUGINS = require("./plugins");

class MockPlugin {}
class MockItemView {}
class MockModal {}
class MockNotice {}
class MockMenu {}
const obsidian = {
  Plugin: MockPlugin,
  ItemView: MockItemView,
  FileView: MockItemView,
  Modal: MockModal,
  Notice: MockNotice,
  Menu: MockMenu,
  requestUrl: async () => ({ json: {} }),
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "obsidian") return obsidian;
  return originalLoad.apply(this, arguments);
};

let failed = false;
for (const id of PLUGINS) {
  const built = path.join(PLUGIN_ROOT, id, "main.js");
  if (!fs.existsSync(built)) {
    failed = true;
    console.error(`[缺少产物] ${id}: ${built}`);
    continue;
  }
  try {
    delete require.cache[require.resolve(built)];
    const exported = require(built);
    if (typeof exported !== "function") throw new Error("main.js 未导出插件类");
    console.log(`[加载通过] ${id}`);
  } catch (error) {
    failed = true;
    console.error(`[加载失败] ${id}: ${error.stack || error.message}`);
  }
}

Module._load = originalLoad;
if (failed) process.exitCode = 1;
else console.log("全部插件产物可被 CommonJS 正常加载。");