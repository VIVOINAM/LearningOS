"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../core/capture-model.js");

const TASKS = [
  "# 今日任务",
  "",
  "- [ ] 任务 A <!-- task:1 -->",
  "- [x] 任务 B <!-- task:2 --> <!-- done:2026-09-12 -->",
  "- [X] 任务 C",
  "- [ ] 任务 D <!-- task:4 --> <!-- done:2026-09-12 --> <!-- plan:%7B%7D -->",
  "这是普通段落",
].join("\n");

test("clean / sanitizeProjectName：清洗标题与非法文件名", () => {
  assert.equal(model.clean("  a\nb  "), "a b");
  assert.equal(model.sanitizeProjectName('  重构:工作台/v3.0? <测试>  '), "重构 工作台 v3.0 测试");
  assert.equal(model.sanitizeProjectName("..."), "");
});

test("taskLine / inboxEntry：生成稳定的 Markdown 行", () => {
  assert.equal(model.taskLine("  新任务  ", 123), "- [ ] 新任务 <!-- task:123 -->");
  assert.throws(() => model.taskLine("   "), /不能为空/);

  const localTime = new Date(2026, 8, 12, 13, 45, 6).getTime();
  assert.equal(model.inboxEntry("想法", localTime), "## 2026-09-12 13:45:06\n\n想法");
});

test("parseTaskLines：复选框是完成真值，元数据只做补充", () => {
  const tasks = model.parseTaskLines(TASKS);
  assert.equal(tasks.length, 4);

  assert.equal(tasks[0].done, false);
  assert.equal(tasks[0].text, "任务 A");

  assert.equal(tasks[1].done, true);
  assert.equal(tasks[1].doneDate, "2026-09-12");

  assert.equal(tasks[2].done, true);
  assert.equal(tasks[2].doneDate, null);
  assert.equal(tasks[2].text, "任务 C");

  assert.equal(tasks[3].done, false);
  assert.equal(tasks[3].doneDate, "2026-09-12");
  assert.equal(tasks[3].text, "任务 D");
});

test("normalizeTaskLines：未勾选行删除残留 done 标记，只改该行", () => {
  const result = model.normalizeTaskLines(TASKS);
  assert.equal(result.changed, 1);
  assert.doesNotMatch(result.content.split("\n")[5], /done:2026-09-12/);
  assert.match(result.content.split("\n")[6], /普通段落/);
  assert.match(result.content, /- \[x\] 任务 B <!-- task:2 --> <!-- done:2026-09-12 -->/);
});

test("taskStats：首页与日记汇总使用同一口径", () => {
  const stats = model.taskStats(TASKS, "2026-09-12");
  assert.deepEqual(stats, {
    open: 2,
    doneToday: 1,
    doneUnknownDate: 1,
    total: 4,
  });
});

test("markTaskDone：勾选后补完成日期，重复调用幂等", () => {
  const tasks = model.parseTaskLines(TASKS);
  const once = model.markTaskDone(TASKS, tasks[0], "2026-09-13");
  assert.match(once, /- \[x\] 任务 A <!-- task:1 --> <!-- done:2026-09-13 -->/);

  const twice = model.markTaskDone(once, { index: tasks[0].index, raw: once.split("\n")[2] }, "2026-09-13");
  assert.equal((twice.match(/done:2026-09-13/g) || []).length, 1);
});

test("markTaskDone：行号漂移时按原始行兜底查找", () => {
  const tasks = model.parseTaskLines(TASKS);
  const moved = { index: 999, raw: tasks[0].raw };
  const result = model.markTaskDone(TASKS, moved, "2026-09-13");
  assert.match(result, /- \[x\] 任务 A/);
});

test("removeTaskLine：按原始行删除，不误删其他任务", () => {
  const tasks = model.parseTaskLines(TASKS);
  const result = model.removeTaskLine(TASKS, tasks[0]);
  assert.doesNotMatch(result, /任务 A/);
  assert.match(result, /任务 B/);
});

test("projectTemplate：新项目只创建项目骨架，不自动添加子任务", () => {
  const content = model.projectTemplate("测试项目");
  assert.match(content, /type: project/);
  assert.match(content, /status: 进行中/);
  assert.match(content, /# 测试项目/);
  assert.match(content, /## 下一步行动/);
  assert.doesNotMatch(content, /^- \[ \]/m);
});

test("renameProjectContent：只替换项目主标题并保留正文与换行格式", () => {
  const source = "---\r\ntype: project\r\n---\r\n# 旧项目\r\n\r\n## 目标\r\n保留这段内容\r\n";
  const result = model.renameProjectContent(source, "新项目");
  assert.match(result, /^---\r\ntype: project\r\n---\r\n# 新项目\r\n/);
  assert.match(result, /## 目标\r\n保留这段内容/);
  assert.doesNotMatch(result, /旧项目/);
  assert.throws(() => model.renameProjectContent(source, "..."), /不能为空/);
});
