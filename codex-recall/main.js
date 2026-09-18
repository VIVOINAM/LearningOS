"use strict";
const {Plugin, Notice, Modal, MarkdownRenderer, Component} = require('obsidian');
const {schedule} = require('./core/scheduler');
const {splitKey, makeKey, renameKey} = require('./core/keys');
class ReviewModal extends Modal {
  constructor(plugin, key) {
    super(plugin.app); this.plugin = plugin; this.key = key;
    const {path, cardId} = splitKey(key); this.path = path; this.cardId = cardId;
  }
  /** 卡片键要问 codex-study 要内容；它没启用就只能退回「去打开原文」。 */
  card() {
    if (!this.cardId) return null;
    return this.app.plugins.getPlugin('codex-study')?.findCard?.(this.path, this.cardId) || null;
  }
  onOpen() {
    const root = this.contentEl; root.classList.add('cr-review');
    this.component = new Component(); this.component.load();
    const book = this.path.split('/').pop().replace(/\.(md|pdf)$/i, '');
    const card = this.card();
    if (this.cardId) {
      root.createEl('h2', {text: card ? `${book} · 第 ${card.page} 页` : book});
      root.createEl('p', {text: card?.prompt || '先回想这张卡片讲的是什么，再展开核对。'});
    } else {
      root.createEl('h2', {text: book});
      root.createEl('p', {text:'先回想这篇笔记的核心结论、适用条件和一个例子，再展开核对。'});
    }
    const answer = root.createDiv('cr-answer');
    const reveal = root.createEl('button', {text: this.cardId ? '展开卡片，核对回忆' : '展开笔记，核对回忆'});
    const actions = root.createDiv('cr-ratings');
    const ratings = [];
    for (const [id, label] of [['again','忘记 · 10 分钟'],['hard','吃力'],['good','记得'],['easy','熟练']]) {
      const button = actions.createEl('button', {text:label}); button.disabled = true; ratings.push(button);
      button.onclick = async () => {
        ratings.forEach(b => b.disabled = true);
        try { await this.plugin.rate(this.key, id); this.close(); }
        catch (e) { new Notice(e.message); ratings.forEach(b => b.disabled = false); }
      };
    }
    reveal.onclick = async () => {
      reveal.disabled = true;
      try {
        if (this.cardId) {
          const current = this.card();
          if (!current) throw Error('卡片已删除，或 Codex 学习未启用');
          await MarkdownRenderer.render(this.app, current.body, answer, this.path, this.component);
          // 坐标双链早就在了，评分完能直接回到那一页——这是卡片比整篇笔记
          // 更值得当复习单元的地方。
          const jump = answer.createEl('button', {text:`跳回第 ${current.page} 页`});
          jump.onclick = () => {
            const study = this.app.plugins.getPlugin('codex-study');
            if (!study?.revealCard) return new Notice('Codex 学习未启用');
            study.revealCard(this.path, this.cardId).catch(e => new Notice(e.message));
          };
        } else {
          const file = this.app.vault.getAbstractFileByPath(this.path);
          if (!file) throw Error('笔记已移动或删除');
          await MarkdownRenderer.render(this.app, await this.app.vault.cachedRead(file), answer, this.path, this.component);
        }
        reveal.hidden = true; ratings.forEach(b => b.disabled = false);
      } catch (e) { new Notice(e.message); reveal.disabled = false; }
    };
  }
  onClose() { this.component?.unload(); this.contentEl.empty(); }
}
class Recall extends Plugin {
  async onload() {
    const saved = await this.loadData();
    if (saved?.schemaVersion > 1) throw Error('复习数据来自更高版本，请更新插件。');
    this.data = {schemaVersion:1, cards:{}, history:[], ...saved};
    this.apiVersion = 1; this.queue = Promise.resolve();
    this.addCommand({id:'add-current', name:'将当前笔记加入间隔复习', callback:() => {
      const file = this.app.workspace.getActiveFile?.();
      if (!file || file.extension !== 'md') return new Notice('请先打开 Markdown 笔记。');
      this.add(file.path).then(() => new Notice('已加入复习队列')).catch(e => new Notice(e.message));
    }});
    this.addCommand({id:'next', name:'打开下一条到期内容', callback:() => {
      const card = this.list().find(c => c.due <= Date.now());
      if (card) this.review(card.key);
      else new Notice('暂无到期内容');
    }});
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      this.mutate(data => {
        for (const key of Object.keys(data.cards)) {
          const next = renameKey(key, oldPath, file.path);
          if (next === key) continue;
          data.cards[next] = data.cards[key]; delete data.cards[key];
        }
      }).catch(e => new Notice(e.message));
    }));
  }
  mutate(fn) {
    const next = this.queue.then(async () => {
      const data = JSON.parse(JSON.stringify(this.data)); fn(data);
      await this.saveData(data); this.data = data;
      this.app.workspace.trigger('codex-recall:changed');
    });
    this.queue = next.catch(() => {}); return next;
  }
  /**
   * 队列。条目的 key 是调度用的键，path 是它所在的文件——卡片条目两者不同，
   * 所以调用方要用 key 去 review / remove / rate，用 path 去判断文件还在不在。
   */
  list() {
    return Object.entries(this.data.cards)
      .map(([key, card]) => ({...card, key, ...splitKey(key)}))
      .filter(item => this.app.vault.getAbstractFileByPath(item.path))
      .sort((a,b) => a.due - b.due || a.key.localeCompare(b.key));
  }
  review(key) { new ReviewModal(this, key).open(); }
  /** key 可以是笔记路径，也可以是 `<文件>#<卡片 id>`（见 core/keys.js）。 */
  add(key) {
    const {path, cardId} = splitKey(key);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) return Promise.reject(Error('文件不存在'));
    if (!cardId && !/\.md$/i.test(path)) return Promise.reject(Error('只有 Markdown 笔记能整篇加入复习'));
    return this.mutate(data => { if (!data.cards[key]) data.cards[key] = {due:Date.now(), interval:0, addedAt:Date.now()}; });
  }
  has(key) { return Object.hasOwn(this.data.cards, key); }
  addCard(path, cardId) { return this.add(makeKey(path, cardId)); }
  remove(key) { return this.mutate(data => { delete data.cards[key]; }); }
  rate(key, rating) { return this.mutate(data => {
    if (!data.cards[key]) throw Error('这一条不在复习队列中');
    const card = schedule(data.cards[key], rating);
    data.cards[key] = {...data.cards[key], ...card};
    data.history.push({key, path:splitKey(key).path, rating, time:card.reviewedAt, interval:card.interval});
  }); }
}
module.exports = Recall;
