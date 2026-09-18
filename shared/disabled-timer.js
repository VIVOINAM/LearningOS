"use strict";

/**
 * CODEX 3.0 · 专注模块未启用时的只读占位。
 *
 * 它不是第二套计时实现：只提供界面渲染所需的默认状态与剩余时间读取；
 * 任何会改变状态的操作都抛出差错，由工作台统一提示启用 codex-focus。
 */

const MESSAGE = "Codex 专注插件未启用，请在第三方插件中启用 codex-focus 后重试。";

function initial(overrides = {}) {
  return Object.assign(
    {
      phase: "focus",
      status: "idle",
      duration: 1500,
      remaining: 1500,
      endAt: null,
      task: "",
      id: null,
    },
    overrides
  );
}

function remaining(timer, now = Date.now()) {
  if (!timer || timer.status !== "running") return Number(timer?.remaining) || 0;
  const endAt = Number(timer.endAt);
  if (!Number.isFinite(endAt)) return Number(timer.remaining) || 0;
  return Math.max(0, (endAt - now) / 1000);
}

function unavailable() {
  const error = new Error(MESSAGE);
  error.code = "CODEX_MODULE_DISABLED";
  throw error;
}

module.exports = {message: MESSAGE, initial, remaining, normalize: (timer) => Object.assign(initial(), timer || {}), elapsed: (timer, now = Date.now()) => Math.max(0, Math.round((Number(timer?.duration) || 0) - remaining(timer, now))), start: unavailable, pause: unavailable, finish: unavailable, setPhase: unavailable, reconcile: (timer) => timer || initial()};