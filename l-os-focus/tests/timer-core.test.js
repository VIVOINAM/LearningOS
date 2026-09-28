"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../core/timer-core.js");

const NOW = 1_800_000_000_000;

test("initial：默认 25 分钟专注、空闲状态", () => {
  const timer = T.initial();
  assert.equal(timer.phase, "focus");
  assert.equal(timer.status, "idle");
  assert.equal(timer.duration, 1500);
  assert.equal(timer.remaining, 1500);
  assert.equal(timer.endAt, null);
  assert.equal(timer.task, "");
  assert.equal(timer.id, null);
  assert.equal(timer.startedAt, null);
});

test("start：从空闲开始，设置结束时间与任务", () => {
  const timer = T.start(T.initial(), "  完成工作台重构  ", 1500, NOW);
  assert.equal(timer.status, "running");
  assert.equal(timer.task, "完成工作台重构");
  assert.equal(timer.duration, 1500);
  assert.equal(timer.endAt, NOW + 1500 * 1000);
  assert.equal(timer.startedAt, NOW);
  assert.equal(typeof timer.id, "string");
  assert.equal(T.remaining(timer, NOW + 60_000), 1440);
});

test("start：running 状态重复调用不会重置", () => {
  const first = T.start(T.initial(), "任务", 1500, NOW);
  const second = T.start(first, "另一个任务", 300, NOW + 10_000);
  assert.deepEqual(second, first);
});

test("pause：冻结剩余时间并清除 endAt", () => {
  const running = T.start(T.initial(), "任务", 1500, NOW);
  const paused = T.pause(running, NOW + 300_000);
  assert.equal(paused.status, "paused");
  assert.equal(paused.remaining, 1200);
  assert.equal(paused.endAt, null);
  assert.equal(paused.task, "任务");
});

test("pause 后再 start：从剩余时间继续，不吞掉已过时间", () => {
  const running = T.start(T.initial(), "任务", 1500, NOW);
  const paused = T.pause(running, NOW + 300_000);
  const resumed = T.start(paused, "任务", 1500, NOW + 900_000);
  assert.equal(resumed.status, "running");
  assert.equal(resumed.remaining, 1200);
  assert.equal(resumed.endAt, NOW + 900_000 + 1200 * 1000);
  assert.equal(resumed.startedAt, NOW);
});

test("finish：完整结束，秒数与结束时间正确", () => {
  const running = T.start(T.initial(), "任务", 1500, NOW);
  const session = T.finish(running, true, NOW + 1500 * 1000 + 5_000);
  assert.equal(session.phase, "focus");
  assert.equal(session.task, "任务");
  assert.equal(session.seconds, 1500);
  assert.equal(session.completed, true);
  assert.equal(session.startedAt, NOW);
  assert.equal(session.endedAt, NOW + 1500 * 1000);
});

test("finish：提前结束，按实际经过秒数记录", () => {
  const running = T.start(T.initial(), "任务", 1500, NOW);
  const session = T.finish(running, false, NOW + 90_000);
  assert.equal(session.seconds, 90);
  assert.equal(session.completed, false);
  assert.equal(session.startedAt, NOW);
  assert.equal(session.endedAt, NOW + 90_000);
});

test("finish：空闲状态没有会话可记", () => {
  assert.equal(T.finish(T.initial(), true, NOW), null);
});

test("remaining：小于 0 时钳到 0", () => {
  const running = T.start(T.initial(), "任务", 1500, NOW);
  assert.equal(T.remaining(running, NOW + 2_000_000), 0);
});

test("normalize：坏数据回落到合法值", () => {
  const timer = T.normalize({
    phase: "xxx",
    status: "yyy",
    duration: -1,
    remaining: "bad",
    endAt: "bad",
    task: 123,
  });
  assert.equal(timer.phase, "focus");
  assert.equal(timer.status, "idle");
  assert.equal(timer.duration, 1500);
  assert.equal(timer.remaining, 1500);
  assert.equal(timer.endAt, null);
  assert.equal(timer.task, "123");
});

test("setPhase：只有空闲时能切换专注/休息", () => {
  const idle = T.setPhase(T.initial(), "break");
  assert.equal(idle.phase, "break");

  const running = T.start(T.initial(), "任务", 1500, NOW);
  const ignored = T.setPhase(running, "break");
  assert.equal(ignored.phase, "focus");
  assert.equal(ignored.status, "running");
});

test("reconcile：running 但 endAt 无效时退回暂停，避免卡死", () => {
  const broken = T.normalize({ status: "running", duration: 1500, remaining: 1500, endAt: null });
  const fixed = T.reconcile(broken, NOW);
  assert.equal(fixed.status, "paused");
  assert.equal(fixed.remaining, 1500);
  assert.equal(fixed.endAt, null);
});

test("reconcile：endAt 已过则剩余归零，交给上层结算", () => {
  const expired = T.reconcile(
    T.normalize({ status: "running", duration: 1500, remaining: 1500, endAt: NOW - 1 }),
    NOW
  );
  assert.equal(expired.status, "running");
  assert.equal(expired.remaining, 0);
});
