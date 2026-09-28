"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { releases, releaseFor, versions } = require("../changelog.js");
const { render } = require("../version-log.js");
const { idFor, labelFor } = require("../modules.js");

const SAMPLE = [
  "# Learning OS 更新日志",
  "",
  "> 说明段落，不该被当成条目。",
  "",
  "## 6.0.0",
  "",
  "- 全产品条目一",
  "",
  "### 工作台",
  "",
  "- 工作台条目",
  "  折行接在上一条后面",
  "",
  "### 学习",
  "",
  "- 学习条目",
  "",
  "## 5.6.5 · 2026-09-18",
  "",
  "### 学习",
  "",
  "- 旧版本条目",
  "",
].join("\n");

test("按版本与模块解析", () => {
  const all = releases(SAMPLE);
  assert.equal(all.length, 2);
  assert.deepEqual(versions(SAMPLE), ["6.0.0", "5.6.5"]);

  const current = all[0];
  assert.equal(current.version, "6.0.0");
  assert.equal(current.date, "", "未发布的版本没有日期");
  assert.deepEqual(current.sections.map((s) => s.module), [null, "工作台", "学习"]);
  assert.deepEqual(current.sections[0].bullets, ["全产品条目一"]);
  assert.equal(current.sections[1].bullets[0], "工作台条目 折行接在上一条后面");

  assert.equal(all[1].date, "2026-09-18");
});

test("说明段落不算条目", () => {
  const current = releaseFor(SAMPLE, "6.0.0");
  const texts = current.sections.flatMap((s) => s.bullets);
  assert.ok(!texts.some((t) => t.includes("不该被当成条目")));
});

test("版本号可带或不带 v 前缀，找不到返回 null", () => {
  assert.ok(releaseFor(SAMPLE, "v6.0.0"));
  assert.equal(releaseFor(SAMPLE, "9.9.9"), null);
  assert.equal(releaseFor(SAMPLE, ""), null);
});

test("CRLF 与 LF 结果一致", () => {
  assert.deepEqual(releases(SAMPLE.replace(/\n/g, "\r\n")), releases(SAMPLE));
});

test("版本迭代.md 是纯产物：同样的输入渲染两次结果相同", () => {
  // 此前日志由插件加载时追加，重复与漏记都靠事后去重补救；产物不需要幂等逻辑，
  // 但这条测试守住「整篇重写」这个前提。
  assert.equal(render(SAMPLE), render(SAMPLE));
});

test("渲染保留版本锚点与模块名", () => {
  const out = render(SAMPLE);
  assert.match(out, /^# 版本迭代/);
  assert.match(out, /请勿手改/);
  assert.match(out, /## v6\.0\.0 · 未发布/);
  assert.match(out, /## v5\.6\.5 · 2026-09-18/);
  assert.match(out, /\*\*工作台\*\*/);
  assert.equal((out.match(/<!-- l-os-version:6\.0\.0 -->/g) || []).length, 1);
});

test("模块名与插件 id 双向对应", () => {
  assert.equal(idFor("工作台"), "l-os-workbench");
  assert.equal(labelFor("l-os-study"), "学习");
  assert.equal(idFor("不存在的模块"), undefined);
  // 已删除的插件仍要认得，否则历史小节会被当成写错的模块名。
  assert.equal(idFor("版本迭代"), "l-os-iteration");
});
