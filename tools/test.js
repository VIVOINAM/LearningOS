"use strict";

/**
 * 离线测试入口。
 *
 * 一些沙箱环境禁止 node --test 的 spawn。这里在一个进程内加载全部
 * node:test 测试文件，仍然使用 Node 内置断言与测试收集器。
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const files = [];
const selected = require('./plugins');
for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (!entry.isDirectory() || !selected.includes(entry.name)) continue;
  const tests = path.join(ROOT, entry.name, "tests");
  if (!fs.existsSync(tests)) continue;
  for (const name of fs.readdirSync(tests)) {
    if (name.endsWith(".test.js")) files.push(path.join(tests, name));
  }
}

// 构建工具自己的测试。此前 CHANGELOG 解析住在 l-os-iteration/core 下，
// 于是构建脚本要 require 一个插件的内部模块才能跑；现在它在 tools/ 里，测试跟过来。
const toolTests = path.join(__dirname, "tests");
if (fs.existsSync(toolTests)) {
  for (const name of fs.readdirSync(toolTests)) {
    if (name.endsWith(".test.js")) files.push(path.join(toolTests, name));
  }
}

if (!files.length) {
  console.error("没有找到测试文件。");
  process.exitCode = 1;
} else {
  for (const file of files) {
    console.log(`# ${path.relative(ROOT, file)}`);
    require(file);
  }
}
