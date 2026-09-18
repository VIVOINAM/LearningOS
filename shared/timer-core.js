"use strict";

/**
 * CODEX 3.0 · 专注计时纯状态机
 *
 * 这个文件不依赖 Obsidian，可以用 node --test 直接测。
 * 状态字段保持 v1.7 兼容，并为新记录补充 startedAt：phase / status / duration / remaining / endAt / task / id / startedAt
 */

const PHASES = Object.freeze(["focus", "break"]);
const STATUSES = Object.freeze(["idle", "running", "paused"]);

function initial(overrides = {}) {
  return Object.assign(
    {
      phase: "focus",
      status: "idle",
      duration: 1500,
      remaining: 1500,
      endAt: null,
      task: "",
      taskId: "",
      id: null,
      startedAt: null,
    },
    overrides
  );
}

function normalizePhase(phase) {
  return PHASES.includes(phase) ? phase : "focus";
}

function normalizeStatus(status) {
  return STATUSES.includes(status) ? status : "idle";
}

function toNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return number;
}

function normalize(timer) {
  const source = timer && typeof timer === "object" ? timer : {};
  const duration = Math.max(1, Math.round(toNonNegativeNumber(source.duration, 1500) || 1500));
  const rawEndAt = source.endAt === null || source.endAt === undefined || source.endAt === "" ? null : Number(source.endAt);
  const endAt = Number.isFinite(rawEndAt) ? rawEndAt : null;
  const rawStartedAt = source.startedAt === null || source.startedAt === undefined || source.startedAt === "" ? null : Number(source.startedAt);
  const startedAt = Number.isFinite(rawStartedAt) ? rawStartedAt : null;
  const remaining = Math.max(0, toNonNegativeNumber(source.remaining, duration));
  return {
    phase: normalizePhase(source.phase),
    status: normalizeStatus(source.status),
    duration,
    remaining,
    endAt,
    task: String(source.task || ""),
    taskId: String(source.taskId || ""),
    id: source.id ? String(source.id) : null,
    startedAt,
    project: String(source.project || ""),
    slices: Array.isArray(source.slices) ? source.slices.map(s=>({...s})) : (source.status!=='idle'&&duration>remaining?[{task:String(source.task||'自由专注'),taskId:String(source.taskId||''),project:String(source.project||''),startedAt:startedAt??Date.now()-(duration-remaining)*1000,endedAt:(startedAt??Date.now()-(duration-remaining)*1000)+(duration-remaining)*1000,seconds:duration-remaining,legacy:true}]:[]),
    segmentAt: Number.isFinite(source.segmentAt) ? source.segmentAt : (source.status === "running" ? (endAt ? endAt-(source.remaining||duration)*1000 : startedAt) : null),
    switches: Array.isArray(source.switches) ? [...source.switches] : [],
    interruptions: Array.isArray(source.interruptions) ? [...source.interruptions] : [],
  };
}

function newId(now = Date.now()) {
  return `${now}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 剩余秒数；running 状态永远以 endAt 为准，避免上次 tick 的旧值。 */
function remaining(timer, now = Date.now()) {
  const current = normalize(timer);
  if (current.status !== "running") return current.remaining;
  if (!Number.isFinite(current.endAt)) return current.remaining;
  return Math.max(0, (current.endAt - now) / 1000);
}

/** 已经过去的秒数（四舍五入到整秒）。 */
function elapsed(timer, now = Date.now()) {
  const current = normalize(timer);
  if (current.status === "idle") return 0;
  return Math.max(0, Math.round(current.duration - remaining(current, now)));
}

function start(timer, task, seconds, now = Date.now()) {
  const current = normalize(timer);
  if (current.status === "running") return current;

  let base;
  if (current.status === "idle") {
    const duration = Math.max(1, Math.round(toNonNegativeNumber(seconds, 1500) || 1500));
    base = initial({
      phase: current.phase,
      taskId: current.taskId,
      project: current.project,
      slices: [], switches: [], interruptions: [],
      duration,
      remaining: duration,
      task: String(task || "").trim(),
      id: newId(now),
      startedAt: now,
    });
  } else {
    base = current;
  }

  if (base.remaining <= 0) {
    const duration = Math.max(1, Math.round(toNonNegativeNumber(seconds, base.duration) || base.duration));
    base = initial({
      phase: base.phase,
      duration,
      remaining: duration,
      task: String(task || base.task || "").trim(),
      id: newId(now),
      startedAt: now,
    });
  }

  return Object.assign({}, base, {
    status: "running",
    segmentAt: now,
    endAt: now + base.remaining * 1000,
  });
}

function pause(timer, now = Date.now()) {
  const current = normalize(timer);
  if (current.status !== "running") return current;
  return Object.assign({}, checkpoint(current, now), {
    interruptions: [...current.interruptions, now],
    segmentAt: null,
    remaining: remaining(current, now),
    status: "paused",
    endAt: null,
  });
}

/**
 * 结束当前计时，返回一条 session 记录；idle 返回 null。
 * completed=true 表示完整跑完；提前结束为 false。
 */
function finish(timer, completed, now = Date.now()) {
  const current = normalize(timer);
  if (current.status === "idle") return null;

  const settled = checkpoint(current, now);
  const seconds = settled.slices.reduce((n,s)=>n+s.seconds,0);
  const endedAt = completed === true && current.endAt ? current.endAt : now;
  return {
    slices: settled.slices,
    switches: current.switches,
    interruptions: current.interruptions,
    project: current.project,
    id: current.id,
    task: current.task || "自由专注",
    taskId: current.taskId,
    durationSeconds: current.duration,
    phase: current.phase,
    seconds,
    completed: completed === true,
    startedAt: Number.isFinite(current.startedAt) ? current.startedAt : endedAt - seconds * 1000,
    endedAt,
  };
}

/** 切换专注/休息；只在 idle 时允许。 */
function setPhase(timer, phase) {
  const current = normalize(timer);
  if (current.status !== "idle") return current;
  return Object.assign({}, current, { phase: normalizePhase(phase) });
}

/** 持久化状态自愈：running 但 endAt 无效时退回 paused，避免卡死。 */
function reconcile(timer, now = Date.now()) {
  const current = normalize(timer);
  if (current.status !== "running") return current;
  if (!Number.isFinite(current.endAt)) {
    return Object.assign({}, current, { status: "paused", endAt: null });
  }
  if (current.endAt <= now) {
    return Object.assign({}, current, { remaining: 0 });
  }
  return current;
}

function checkpoint(timer, now=Date.now()) {
  const t=normalize(timer), slices=[...t.slices];
  if(t.status==='running' && Number.isFinite(t.segmentAt)) {
    const end=Math.min(now,t.endAt || now);
    if(end>t.segmentAt)slices.push({task:t.task||'自由专注',taskId:t.taskId,project:t.project,startedAt:t.segmentAt,endedAt:end,seconds:(end-t.segmentAt)/1000});
  }
  return {...t,slices,segmentAt:t.status==='running'?Math.min(now,t.endAt||now):null};
}
function switchTask(timer, task, now=Date.now()) {
  const t=normalize(timer);
  if(t.phase!=='focus')throw Error('休息阶段不能切换任务');
  if(t.taskId===(task.taskId||'') && t.task===task.task)return t;
  const next=checkpoint(t,now);
  return {...next,task:String(task.task||'自由专注'),taskId:String(task.taskId||''),project:String(task.project||''),switches:t.status==='idle'?t.switches:[...t.switches,now]};
}
module.exports = {checkpoint, switchTask, initial, normalize, remaining, elapsed, start, pause, finish, setPhase, reconcile};
