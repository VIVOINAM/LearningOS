"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../console-model.js");

const NOW = new Date(2026, 8, 12, 15, 0, 0).getTime(); // 2026-09-12

test("focusSnapshot：今日、本周、连续天数与实时专注", () => {
  const sessions = [
    { id: "a", phase: "focus", seconds: 1500, completed: true, endedAt: NOW - 3600000 },
    { id: "b", phase: "focus", seconds: 600, completed: false, endedAt: NOW - 86400000 },
    { id: "c", phase: "break", seconds: 300, completed: true, endedAt: NOW },
  ];
  const timer = { id: "live", phase: "focus", status: "running", duration: 1200, remaining: 600, endAt: NOW + 600000 };
  const snapshot = model.focusSnapshot({ sessions, timer, settings: { focusMinutes: 50 }, now: NOW });
  assert.equal(snapshot.todayMinutes, 35); // 25 + 10 live
  assert.equal(snapshot.weekMinutes, 45);
  assert.equal(snapshot.completedToday, 1);
  assert.equal(snapshot.targetMinutes, 50);
  assert.equal(snapshot.streak, 2);
});

test("studySnapshot：今日分钟、页数、疑问与最近教材", () => {
  const study = {
    records: {
      "book/a.pdf": {
        updatedAt: NOW,
        daily: { "2026-09-12": 600, "2026-09-11": 300 },
        dailyPages: { "2026-09-12": [1, 2, 3] },
        annotations: [{ kind: "question", resolved: false }, { kind: "question", resolved: true }],
      },
    },
    goal: { minutes: 120, pages: 30 },
  };
  const snapshot = model.studySnapshot(study, NOW);
  assert.equal(snapshot.todayMinutes, 10);
  assert.equal(snapshot.todayPages, 3);
  assert.equal(snapshot.totalMinutes, 15);
  assert.equal(snapshot.questionOpen, 1);
  assert.equal(snapshot.recent[0].path, "book/a.pdf");
});

test("heatmapData：生成固定周数并分级", () => {
  const sessions = [
    { phase: "focus", seconds: 1200, endedAt: NOW },
    { phase: "focus", seconds: 4000, endedAt: NOW - 86400000 },
  ];
  const heat = model.heatmapData(sessions, { weeks: 2, now: NOW });
  assert.equal(heat.days.length, 14);
  const today = heat.days.find((day) => day.key === "2026-09-12");
  assert.equal(today.level, 1);
  assert.equal(today.minutes, 20);
  assert.equal(today.count, 1);
  assert.equal(today.sessions[0].startedAt, NOW - 1200000);
  assert.equal(heat.totalSessions, 2);
  assert.equal(heat.activeDays, 2);
});

test("courseSnapshot：汇总课程阅读进度与本周分钟", () => {
  const course = { id: "060116", title: "材料科学与技术" };
  const study = {
    records: {
      "book/a.pdf": {
        totalPages: 100,
        pagesSeen: [1, 2, 3, 4],
        daily: { "2026-09-12": 1200, "2026-09-08": 600 },
        annotations: [{ kind: "question", resolved: false }],
        updatedAt: NOW,
      },
    },
  };
  const snapshot = model.courseSnapshot({ course, state: { next: "读第三章" }, books: ["book/a.pdf"], study, now: NOW });
  assert.equal(snapshot.progress, 0.04);
  assert.equal(snapshot.questionOpen, 1);
  assert.equal(snapshot.weekMinutes, 30);
  assert.equal(snapshot.next, "读第三章");
});

test("knowledgeSnapshot：统计按顶层文件夹聚合", () => {
  const files = [
    { path: "03 知识库/a.md", stat: { mtime: NOW } },
    { path: "03 知识库/b.md", stat: { mtime: NOW - 86400000 } },
    { path: "book/a.pdf", stat: { mtime: NOW } },
  ];
  const snapshot = model.knowledgeSnapshot(files, NOW);
  assert.equal(snapshot.notes, 2);
  assert.equal(snapshot.pdfs, 1);
  assert.deepEqual(snapshot.folders[0], ["03 知识库", 2]);
});

test("taskPresentation：标题永远是任务本身，项目名降为 chip", () => {
  const project = model.taskPresentation({path: "02 项目/小资.md", text: "明确项目完成标准"});
  assert.equal(project.title, "明确项目完成标准");
  assert.equal(project.project, "小资");

  const linked = model.taskPresentation({project: "02 项目/最终发布.md", text: "打包插件"});
  assert.equal(linked.title, "打包插件");
  assert.equal(linked.project, "最终发布");

  const independent = model.taskPresentation({path: "00 工作台/今日任务.md", text: "独立任务"});
  assert.equal(independent.title, "独立任务");
  assert.equal(independent.project, "");

  // showProject:false 时不显示归属，但标题不变——这是今日页那种已经按项目分组的场景。
  const inProject = model.taskPresentation({project: "02 项目/最终发布.md", text: "打包插件"}, {showProject: false});
  assert.equal(inProject.title, "打包插件");
  assert.equal(inProject.project, "");
});

test("rankTodayTasks：当前任务排最前，同分保持原顺序", () => {
  const tasks = [{text:"甲"},{text:"乙"},{text:"丙"}];
  assert.deepEqual(model.rankTodayTasks({tasks}).map(t => t.text), ["甲","乙","丙"], "全同分就别重排");
  assert.equal(model.rankTodayTasks({tasks, currentTask:"丙"})[0].text, "丙");
});

test("rankTodayTasks：逾期 > 今天截止 > 还早", () => {
  const now = Date.UTC(2026, 8, 18);
  const tasks = [{text:"还早",due:"2026-10-18"},{text:"今天",due:"2026-09-18"},{text:"逾期",due:"2026-09-01"}];
  assert.deepEqual(model.rankTodayTasks({tasks, now}).map(t => t.text), ["逾期","今天","还早"]);
});

test("rankTodayTasks：考试临近的课，它的任务被推到前面", () => {
  const now = Date.UTC(2026, 8, 18);
  const courses = {
    "052475": {exam:"2026-09-20", weekMinutes:300},
    "060112": {exam:"2026-12-22", weekMinutes:300},
  };
  const tasks = [{text:"远期课的任务",course:"060112"},{text:"三天后考试",course:"052475"}];
  assert.deepEqual(model.rankTodayTasks({tasks, courses, now}).map(t => t.text), ["三天后考试","远期课的任务"]);
});

test("courseUrgency：越近越急，考完就不再加权", () => {
  const now = Date.UTC(2026, 8, 18);
  const at = exam => model.courseUrgency({exam, weekMinutes:300, now});
  assert.ok(at("2026-09-20") > at("2026-09-24"), "三天后比六天后急");
  assert.ok(at("2026-09-24") > at("2026-10-10"), "六天后比三周后急");
  assert.equal(at("2026-09-01"), 0, "考完的课不再加权");
  assert.equal(at(""), 0, "没填考试日期就不加权");
  assert.equal(at("2026-02-30"), 0, "非法日期当没填");
});

test("courseUrgency：本周没碰过的课更急", () => {
  const now = Date.UTC(2026, 8, 18);
  const cold = model.courseUrgency({exam:"", weekMinutes:0, now});
  const warm = model.courseUrgency({exam:"", weekMinutes:30, now});
  const hot = model.courseUrgency({exam:"", weekMinutes:300, now});
  assert.ok(cold > warm && warm > hot);
  assert.equal(hot, 0);
});

test("estimateSuggestion：没有历史时给 2，而不是 0 或空", () => {
  assert.equal(model.estimateSuggestion({tasks: [], task: {}}), 2);
  assert.equal(model.estimateSuggestion({tasks: [{estimated_pomodoros: 0}], task: {}}), 2);
});

test("estimateSuggestion：用中位数，一个特别大的任务拽不走默认值", () => {
  const tasks = [{estimated_pomodoros: 2}, {estimated_pomodoros: 2}, {estimated_pomodoros: 3}, {estimated_pomodoros: 20}];
  assert.equal(model.estimateSuggestion({tasks, task: {}}), 3);
});

test("estimateSuggestion：同项目样本够多就用同项目的", () => {
  const tasks = [
    {project: "A", estimated_pomodoros: 1}, {project: "A", estimated_pomodoros: 1}, {project: "A", estimated_pomodoros: 1},
    {project: "B", estimated_pomodoros: 8}, {project: "B", estimated_pomodoros: 8},
  ];
  assert.equal(model.estimateSuggestion({tasks, task: {project: "A"}}), 1);
  // B 只有两条，不够，退回全部样本的中位数。
  assert.equal(model.estimateSuggestion({tasks, task: {project: "B"}}), 1);
});

test("estimateSuggestion：不拿自己当样本，结果夹在 1–8", () => {
  const self = {project: "A", estimated_pomodoros: 99};
  assert.equal(model.estimateSuggestion({tasks: [self], task: self}), 2);
  const big = [{estimated_pomodoros: 99}, {estimated_pomodoros: 99}];
  assert.equal(model.estimateSuggestion({tasks: big, task: {}}), 8);
});

test("hasWorked：分片里的 taskId 也算做过", () => {
  assert.equal(model.hasWorked([], "t1"), false);
  assert.equal(model.hasWorked([{taskId: "t1"}], "t1"), true);
  assert.equal(model.hasWorked([{slices: [{taskId: "t1"}]}], "t1"), true);
  assert.equal(model.hasWorked([{taskId: "t2"}], "t1"), false);
  // 没有 id 的任务谈不上做过没做过，不该因此跳过提问。
  assert.equal(model.hasWorked([{taskId: ""}], ""), false);
});

test("estimateAccuracy：只算估过的，一条都没有就不显示", () => {
  assert.equal(model.estimateAccuracy([]), null);
  assert.equal(model.estimateAccuracy([{completedPomodoros: 3}]), null, "没估过的不该凑出一个比值");

  const report = model.estimateAccuracy([
    {estimated_pomodoros: 2, completedPomodoros: 3},
    {estimated_pomodoros: 4, completedPomodoros: 4},
    {completedPomodoros: 9},
  ]);
  assert.deepEqual(report, {tasks: 2, estimated: 6, actual: 7, ratio: 1.17});
});

test("estimateAccuracy：提前收工是负差，不是错误", () => {
  const report = model.estimateAccuracy([{estimated_pomodoros: 5, completedPomodoros: 2}]);
  assert.equal(report.actual - report.estimated, -3);
  assert.equal(report.ratio, 0.4);
});
