"use strict";
const {Modal}=require('obsidian');
const {el: node, btn: domBtn}=require('../shared/dom');

/**
 * 开工前问一次「大概几个番茄」。
 *
 * 存在的理由：`estimated_pomodoros` 字段从 4.x 就在，`budget.js` 会算超时、
 * 每日小结会算完成率，但填充率一直是 0%——它藏在「补充详情」弹窗里，
 * 没人会为了填一个数专门点进去。于是一条从来没跑通的链路，
 * 在 100% 的任务行上渲染一句「未估算」。
 *
 * 所以不改成必填（必填只会被绕开），改成：第一次真正开工时问一次，
 * 默认值从你自己的历史里算好，按一下就过。不想估就「先不估」，
 * 照常开始专注——这一问永远不该挡住开工。
 *
 * 只问一次：做过之后就不再问（见 console-model.hasWorked），问也晚了。
 */
class EstimateModal extends Modal {
  constructor(app, task, suggestion, resolve) {
    super(app);
    this.task = task; this.suggestion = suggestion; this.resolve = resolve; this.answered = false;
  }
  onOpen() {
    const root = this.contentEl; root.replaceChildren(); root.classList.add('os-estimate-modal');
    node(root, 'h2', '', '这件事大概几个番茄？');
    node(root, 'p', 'os-muted', '一个番茄 25 分钟。估过之后行动页才显示进度，每日小结也才能告诉你估得准不准。估不准没关系，它只是个参照。');
    const choices = node(root, 'div', 'os-estimate-choices');
    const pick = (value) => { this.answered = true; this.resolve(value); this.close(); };
    for (const value of [...new Set([1, 2, 4, 8, this.suggestion])].sort((a, b) => a - b)) {
      const label = value === this.suggestion ? `${value} · 按你的习惯` : String(value);
      domBtn(choices, label, () => pick(value), `os-button ${value === this.suggestion ? 'os-primary' : ''}`);
    }
    const actions = node(root, 'div', 'os-modal-actions');
    domBtn(actions, '先不估，直接开始', () => { this.answered = true; this.resolve(0); this.close(); }, 'os-button os-quiet');
  }
  // 按 Esc 或点外面关掉，等同于「先不估」：这一问不能变成开工的关卡。
  onClose() { if (!this.answered) this.resolve(0); this.contentEl.empty(); }
}

module.exports = {EstimateModal};
