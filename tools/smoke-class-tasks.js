"use strict";
// 课堂笔记写满两页后自动勾掉「总结笔记」任务。用捕获插件真的任务索引和改写逻辑：
// 2026-09-26 实机上重载后几次刷新前后脚来勾同一条，第二次按旧行去找对不上，弹出「任务已变化」。
const assert = require('node:assert/strict'), Module = require('node:module');
const original = Module._load;
Module._load = function (name) { if (name === 'obsidian') return {Plugin: class {}, ItemView: class {}, Modal: class {}, Notice: class { constructor(t) { notices.push(t); } }, parseYaml: JSON.parse}; return original.apply(this, arguments); };
const notices = [];
const W = require('../l-os-workbench/main'), CN = require('../l-os-workbench/class-notes');
const {TaskIndex, update} = require('../l-os-capture/core/task-index');
const creation = require('../l-os-capture/core/task-create');

(async () => {
  const statics = {id: '057274', title: '静力学与结构力学'}, fluid = {id: '089257', title: '流体力学与化工基础'};
  const line = (course, key, id) => creation.line(creation.normalize(CN.taskSpec(course, key)), id);
  const file = {path: '00 工作台/今日任务.md', extension: 'md', stat: {mtime: 1, size: 0},
    text: ['# 今日任务', '', line(statics, '2026-09-24', 'a'), '', line(fluid, '2026-09-24', 'b'), ''].join('\n')};
  const vault = {getMarkdownFiles: () => [file], getAbstractFileByPath: p => p === file.path ? file : null, cachedRead: async f => f.text,
    process: async (f, fn) => { f.text = fn(f.text); f.stat = {mtime: f.stat.mtime + 1, size: f.text.length}; }};
  // 和 l-os-capture 的 updateTask 同一个做法：排队、按行改写、改完让索引失效。
  const capture = {index: new TaskIndex(vault), queue: Promise.resolve(), updates: 0,
    updateTask(task, action) {
      const next = this.queue.then(async () => { await vault.process(file, c => update(c, task, action)); this.index.invalidate(file); this.updates++; });
      this.queue = next.catch(() => {}); return next;
    }};
  const p = Object.create(W.prototype);
  p.app = {plugins: {getPlugin: id => id === 'l-os-capture' ? capture : null}};
  const warnings = [], warn = console.warn; console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const done = () => file.text.split('\n').filter(l => /^- \[x\]/.test(l)).length;
    // 三次刷新同时来勾同一条：只改一次，不抛、不弹、不记失败。
    const results = await Promise.all([p.closeClassTask(statics, '2026-09-24'), p.closeClassTask(statics, '2026-09-24'), p.closeClassTask(statics, '2026-09-24')]);
    assert.deepEqual(results, [1, 0, 0]);
    assert.equal(capture.updates, 1);
    assert.equal(done(), 1);
    assert.equal((file.text.match(/<!-- done:/g) || []).length, 1);
    // 读完索引、还没轮到改的时候，这一条被别处（用户手动）勾掉了：照旧不报错。
    const stale = (await capture.index.all()).find(t => t.id === 'b');
    await vault.process(file, c => update(c, stale, 'done'));
    capture.index.invalidate(file);
    const all = capture.index.all.bind(capture.index);
    let first = true;
    capture.index.all = async () => { if (first) { first = false; return (await all()).map(t => t.id === 'b' ? stale : t); } return all(); };
    assert.equal(await p.closeClassTask(fluid, '2026-09-24'), 0);
    assert.equal(done(), 2);
    assert.deepEqual(warnings, []);
    assert.deepEqual(notices, []);
    // 别的课、别的日子的任务不动。
    assert.equal(await p.closeClassTask(statics, '2026-09-23'), 0);
    console.log('总结任务自动勾选通过：并发刷新只改一次 / 已被别处勾掉不报错 / 不弹通知。');
  } finally { console.warn = warn; }
})().catch(error => { console.error(error); process.exitCode = 1; });
