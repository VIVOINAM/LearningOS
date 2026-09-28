"use strict";

/**
 * L-OS 3.5 Learning OS 控制台纯逻辑。
 * 只做聚合和排序，不碰 Obsidian API / DOM，便于 node:test 直接覆盖。
 */

const DAY_MS = 86400000;

const { day: dayKey } = require("../shared/date");

function startOfWeek(time = Date.now()) {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return date.getTime();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function secondsToMinutes(seconds) {
  return Math.max(0, Math.round((Number(seconds) || 0) / 60));
}

function timerRemaining(timer, now = Date.now()) {
  const endAt = Number(timer?.endAt);
  if (timer?.status === "running" && Number.isFinite(endAt)) {
    return Math.max(0, (endAt - now) / 1000);
  }
  return Math.max(0, Number(timer?.remaining) || 0);
}

function liveFocusSeconds(timer, now = Date.now()) {
  if (!timer || timer.phase !== "focus" || !timer.id) return 0;
  const duration = Math.max(0, Number(timer.duration) || 0);
  return Math.max(0, duration - timerRemaining(timer, now));
}

function focusSnapshot({ sessions = [], timer = {}, settings = {}, now = Date.now() } = {}) {
  const today = dayKey(now);
  const weekStart = startOfWeek(now);
  const focusSessions = sessions.filter((session) => session && session.phase === "focus" && Number(session.seconds) > 0);
  const todaySessions = focusSessions.filter((session) => dayKey(session.endedAt) === today);
  const weekSessions = focusSessions.filter((session) => Number(session.endedAt) >= weekStart);
  const liveSeconds = liveFocusSeconds(timer, now);
  const todaySeconds = sum(todaySessions.map((session) => session.seconds)) + liveSeconds;
  const weekSeconds = sum(weekSessions.map((session) => session.seconds)) + liveSeconds;
  const totalSeconds = sum(focusSessions.map((session) => session.seconds));

  const focusDays = new Map();
  for (const session of focusSessions) {
    if (!Number.isFinite(Number(session.endedAt))) continue;
    const key = dayKey(session.endedAt);
    focusDays.set(key, (focusDays.get(key) || 0) + (Number(session.seconds) || 0));
  }

  let streak = 0;
  const cursor = new Date(now);
  cursor.setHours(12, 0, 0, 0);
  if (!focusDays.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (focusDays.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return {
    todaySeconds,
    todayMinutes: secondsToMinutes(todaySeconds),
    weekSeconds,
    weekMinutes: secondsToMinutes(weekSeconds),
    totalHours: Math.round(totalSeconds / 360) / 10,
    todaySessions: todaySessions.length,
    completedToday: todaySessions.filter((session) => session.completed).length,
    liveSeconds,
    streak,
    focusDays,
    targetMinutes: Math.max(1, Number(settings.focusMinutes) || 25),
  };
}

function studySnapshot(study = {}, now = Date.now()) {
  const today = dayKey(now);
  const records = study.records && typeof study.records === "object" ? study.records : {};
  let todaySeconds = 0;
  let todayPages = 0;
  let totalSeconds = 0;
  let questionOpen = 0;
  let questionTotal = 0;
  let booksToday = 0;
  const recent = [];

  for (const [path, record] of Object.entries(records)) {
    if (!record || typeof record !== "object") continue;
    const daily = record.daily && typeof record.daily === "object" ? record.daily : {};
    const dailyPages = record.dailyPages && typeof record.dailyPages === "object" ? record.dailyPages : {};
    const todayRecordSeconds = Number(daily[today]) || 0;
    const todayRecordPages = Array.isArray(dailyPages[today]) ? dailyPages[today].length : 0;

    todaySeconds += todayRecordSeconds;
    todayPages += todayRecordPages;
    totalSeconds += sum(Object.values(daily));
    if (todayRecordSeconds > 0) booksToday += 1;

    for (const annotation of Array.isArray(record.annotations) ? record.annotations : []) {
      if (annotation?.kind !== "question") continue;
      questionTotal += 1;
      if (!annotation.resolved) questionOpen += 1;
    }

    recent.push({
      path,
      record,
      updatedAt: Number(record.updatedAt) || 0,
      totalMinutes: secondsToMinutes(sum(Object.values(daily))),
    });
  }

  recent.sort((a, b) => b.updatedAt - a.updatedAt);

  return {
    todaySeconds,
    todayMinutes: secondsToMinutes(todaySeconds),
    todayPages,
    totalMinutes: secondsToMinutes(totalSeconds),
    totalHours: Math.round(totalSeconds / 360) / 10,
    recordCount: recent.length,
    booksToday,
    questionOpen,
    questionTotal,
    recent,
    goal: {
      minutes: Math.max(0, Number(study.goal?.minutes) || 0),
      pages: Math.max(0, Number(study.goal?.pages) || 0),
    },
  };
}

function heatmapData(sessions = [], { weeks = 12, now = Date.now() } = {}) {
  const focusSessions = sessions
    .filter((session) => session?.phase === "focus" && Number(session.seconds) > 0 && Number.isFinite(Number(session.endedAt)))
    .map((session) => {
      const endedAt = Number(session.endedAt);
      const seconds = Number(session.seconds);
      const rawStartedAt = Number(session.startedAt);
      return {
        id: session.id ? String(session.id) : "",
        task: String(session.task || "自由专注"),
        seconds,
        completed: session.completed === true,
        endedAt,
        startedAt: Number.isFinite(rawStartedAt) ? rawStartedAt : endedAt - seconds * 1000,
      };
    });
  const daySeconds = new Map();
  const daySessions = new Map();
  for (const session of focusSessions) {
    const key = dayKey(session.endedAt);
    daySeconds.set(key, (daySeconds.get(key) || 0) + Number(session.seconds));
    if (!daySessions.has(key)) daySessions.set(key, []);
    daySessions.get(key).push(session);
  }
  for (const sessionsForDay of daySessions.values()) sessionsForDay.sort((a, b) => a.endedAt - b.endedAt);

  const end = new Date(now);
  end.setHours(12, 0, 0, 0);
  const offset = (end.getDay() + 6) % 7;
  end.setDate(end.getDate() - offset + 6);
  const start = new Date(end);
  start.setDate(start.getDate() - (weeks * 7 - 1));

  const days = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const key = dayKey(cursor);
    const sessionsForDay = daySessions.get(key) || [];
    const seconds = daySeconds.get(key) || 0;
    days.push({
      key,
      seconds,
      minutes: secondsToMinutes(seconds),
      count: sessionsForDay.length,
      sessions: sessionsForDay,
      level: seconds === 0 ? 0 : seconds < 1500 ? 1 : seconds < 3600 ? 2 : seconds < 7200 ? 3 : 4,
    });
  }
  return {
    days,
    daySeconds,
    daySessions,
    weeks,
    totalSeconds: sum(days.map((day) => day.seconds)),
    totalSessions: days.reduce((total, day) => total + day.count, 0),
    activeDays: days.filter((day) => day.count > 0).length,
  };
}

function courseSnapshot({ course, state = {}, books = [], study = {}, now = Date.now() } = {}) {
  const studyRecords = study.records && typeof study.records === "object" ? study.records : {};
  const today = dayKey(now);
  const weekStart = startOfWeek(now);
  let seenPages = 0;
  let totalPages = 0;
  let questionOpen = 0;
  let lastRead = 0;
  let weekSeconds = 0;
  let todaySeconds = 0;

  for (const path of books) {
    const record = studyRecords[path];
    if (!record) continue;
    const recordTotal = Number(record.totalPages) || 0;
    if (recordTotal > 0) totalPages += recordTotal;
    const pages = Array.isArray(record.pagesSeen) ? record.pagesSeen.length : 0;
    seenPages += Math.min(recordTotal || pages, pages);
    lastRead = Math.max(lastRead, Number(record.updatedAt) || 0);
    todaySeconds += Number(record.daily?.[today]) || 0;
    for (const [key, seconds] of Object.entries(record.daily || {})) {
      const [year, month, date] = String(key).split("-").map(Number);
      const time = new Date(year, month - 1, date, 12, 0, 0, 0).getTime();
      if (Number.isFinite(time) && time >= weekStart) weekSeconds += Number(seconds) || 0;
    }
    for (const annotation of Array.isArray(record.annotations) ? record.annotations : []) {
      if (annotation?.kind === "question" && !annotation.resolved) questionOpen += 1;
    }
  }

  return {
    course,
    state,
    books,
    progress: totalPages > 0 ? clamp(seenPages / totalPages, 0, 1) : 0,
    seenPages,
    totalPages,
    questionOpen,
    lastRead,
    weekMinutes: secondsToMinutes(weekSeconds),
    todayMinutes: secondsToMinutes(todaySeconds),
    next: String(state.next || ""),
    exam: String(state.exam || ""),
  };
}

function knowledgeSnapshot(files = [], now = Date.now()) {
  const folders = new Map();
  let notes = 0;
  let pdfs = 0;
  const recent = [];
  const today = dayKey(now);

  for (const file of files) {
    if (!file?.path) continue;
    const first = file.path.split("/")[0] || "根目录";
    if (/\.pdf$/i.test(file.path)) {
      pdfs += 1;
    } else if (/\.md$/i.test(file.path)) {
      notes += 1;
      folders.set(first, (folders.get(first) || 0) + 1);
      recent.push(file);
    }
  }

  recent.sort((a, b) => Number(b.stat?.mtime || 0) - Number(a.stat?.mtime || 0));
  return {
    notes,
    pdfs,
    folders: [...folders.entries()].sort((a, b) => b[1] - a[1]),
    recent: recent.slice(0, 8),
    updatedToday: recent.filter((file) => dayKey(file.stat?.mtime || 0) === today).length,
  };
}

function taskTitle(value) {
  return String(value || "").replace(/(?:📅\s*|due::\s*)\d{4}-\d{2}-\d{2}/g, "").trim();
}

function projectTitleForTask(task = {}) {
  const reference = task.project || (/^02 项目\//.test(String(task.path || "")) ? task.path : "");
  const basename = String(reference).replace(/\\/g, "/").split("/").filter(Boolean).pop() || "";
  return basename.replace(/\.md$/i, "").trim();
}

/**
 * 任务行的标题与归属。
 *
 * 标题永远是任务本身，项目名降为行尾的一个 chip。
 * 5.1.1 到 6.0 之间是反过来的——项目名当主标题、任务降为 11px 的灰色副标题，
 * 于是同一个项目下连着五行都写着「本周学习计划」，真正区分它们的信息
 * 反而最小。列表的作用是让人一眼挑出要做的那条：
 * 项目归属是筛选用的，不是识别用的。
 */
function taskPresentation(task = {}, { showProject = true } = {}) {
  const childTitle = taskTitle(task.text);
  const projectTitle = projectTitleForTask(task);
  return {
    title: childTitle,
    project: showProject ? projectTitle : "",
    projectTitle,
    childTitle,
  };
}

/**
 * 课程紧迫度。考试越近越急，最近越没碰过越急。
 *
 * 数据一直都在——课程页知道每门课的考试日期和本周时长——只是从来没流到
 * 今日页去。于是今日的「下一步行动」只按优先级和截止日期排，
 * 而「哪门课要来不及了」这个问题界面上没人回答。
 */
function courseUrgency({ exam = "", weekMinutes = 0, now = Date.now() } = {}) {
  let score = 0;
  const state = dueStateDays(exam, now);
  if (state !== null && state >= 0) {
    // 考试已经过去的课不再加权：它急过了。
    if (state <= 3) score += 200;
    else if (state <= 7) score += 120;
    else if (state <= 14) score += 70;
    else if (state <= 30) score += 30;
  }
  // 本周一分钟没碰过的课，比每天都在读的课更需要被推到眼前。
  const minutes = Math.max(0, Number(weekMinutes) || 0);
  if (minutes === 0) score += 40;
  else if (minutes < 60) score += 20;
  return score;
}

function dueStateDays(value, now) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const [y, m, d] = value.split("-").map(Number);
  const stamp = Date.UTC(y, m - 1, d);
  if (new Date(stamp).toISOString().slice(0, 10) !== value) return null;
  const today = new Date(now);
  return Math.round((stamp - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / DAY_MS);
}

/**
 * 今日「下一步行动」的排序。
 *
 * 原来这里是 priorityActions：一个把任务、课程、项目、疑问混在一起打分的
 * 模型，四十行，带一个测试，但没有任何视图调用它——它想做的正是这件事，
 * 只是从没接上，而且课程那一档打的是 `80 + weekMinutes`，
 * 本周读得越多排越前，方向正好反了。
 *
 * 现在只排任务，不产出别的种类：今日页仍然只放任务行，界面上一个新元素都不加，
 * 变的只是顺序。课程的紧迫度通过任务身上的 course 传进来。
 */
function rankTodayTasks({ tasks = [], courses = {}, courseOf = (task) => task.course || "", currentTask = "", now = Date.now() } = {}) {
  const scored = tasks.map((task, index) => {
    let score = 0;
    if (task.text && task.text === currentTask) score += 1000;
    const due = dueStateDays(task.due, now);
    if (due !== null) score += due < 0 ? 300 : due === 0 ? 200 : Math.max(0, 120 - due * 8);
    score += (Number(task.priority) || 0) * 40;
    // courseOf 让调用方自己决定怎么从任务读出课程，免得为了排序去克隆任务对象
    // ——克隆会打断 taskRows 的身份判定和「当前要务」的引用比较。
    const id = courseOf(task);
    const course = id ? courses[id] : null;
    if (course) score += courseUrgency({ ...course, now });
    return { task, score, index };
  });
  // 分数相同时保持原顺序，免得每次刷新列表都在手底下重排。
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map((item) => item.task);
}
/**
 * 给一个还没估过的任务推荐番茄数。
 *
 * 不强制填写——强制只会被绕开，结果就是 6.1 之前那样：字段存在、budget.js
 * 会算超时，但填充率是 0%，于是每一行都挂着「未估算」。改成开工时问一次，
 * 并且先给一个从你自己历史里算出来的默认值，你按一下确认就行。
 *
 * 同项目的样本够多（≥3）就用同项目的，否则用全部；都没有就给 2。
 * 用中位数不用平均数：偶尔一个「估 20 个番茄」的大任务不该把默认值拽走。
 */
function estimateSuggestion({ tasks = [], task = {} } = {}) {
  const pick = (list) => list
    .filter((item) => item !== task)
    .map((item) => Number(item.estimated_pomodoros))
    .filter((n) => Number.isFinite(n) && n > 0);
  const key = task.project || "";
  const siblings = pick(tasks.filter((item) => (item.project || "") === key));
  const sample = siblings.length >= 3 ? siblings : pick(tasks);
  if (!sample.length) return 2;
  const sorted = [...sample].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return clamp(Math.round(median), 1, 8);
}

/**
 * 估得准不准。闭环 B 的另一半：光问不反馈，估算就只是个多余的字段。
 *
 * 只统计「估过且已完成」的任务——没估过的进来会把比值拉成假的乐观。
 * 一条都没有就返回 null，调用方据此不显示，而不是显示一个 0/0。
 */
function estimateAccuracy(tasks = []) {
  const counted = tasks
    .map((task) => ({
      estimated: Math.max(0, Number(task.estimated_pomodoros) || 0),
      actual: Math.max(0, Number(task.completedPomodoros) || 0),
    }))
    .filter((item) => item.estimated > 0);
  if (!counted.length) return null;
  const estimated = counted.reduce((n, item) => n + item.estimated, 0);
  const actual = counted.reduce((n, item) => n + item.actual, 0);
  return {
    tasks: counted.length,
    estimated,
    actual,
    // 正数是超出，负数是提前收工；估了 0 个的任务已经被滤掉，不会除零。
    ratio: Math.round((actual / estimated) * 100) / 100,
  };
}

/** 这个任务之前有没有真的做过——做过就不再问估算，问也晚了。 */
function hasWorked(sessions = [], taskId = "") {
  if (!taskId) return false;
  return sessions.some((s) => s.taskId === taskId || s.slices?.some((x) => x.taskId === taskId));
}

module.exports = {dayKey, clamp, focusSnapshot, studySnapshot, heatmapData, courseSnapshot, knowledgeSnapshot, taskPresentation, rankTodayTasks, courseUrgency, estimateSuggestion, estimateAccuracy, hasWorked};
