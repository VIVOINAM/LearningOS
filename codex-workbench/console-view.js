"use strict";
const {DetailModal}=require('./detail-modal');
const {el, btn: domBtn}=require('../shared/dom');
const {budget}=require('./budget');
const {ItemView, Modal, Notice, setIcon} = require('obsidian');
const {dueState} = require('./due');
const {renderMarkdown,markdownOwner} = require('../codex-study/core/markdown-render');
const {toObsidianMarkdown,changesOnPaste} = require('../codex-study/core/formula-model');
const {dayKey, focusSnapshot, studySnapshot, heatmapData, taskPresentation, estimateAccuracy, rankTodayTasks} = require('./console-model');
// 5.3 把六个页内分段提到了顶层，理由是「藏得太深」。6.3 收回去，理由是
// 那六个目的地的数据量撑不起一个顶层入口——疑问常年 1 条，课程九张卡片里
// 八张写着同一句模板下一步。把 1 条数据提到顶层，得到的是一个 550px 空白的
// 页面和一个永远用不到的 Alt+6。
//
// 去处一个没少：它们变成页内分段，每个仍然是独立的 tab id，
// 命令、链接、setTab 调用全部照旧可用，只是不再各占一格侧栏。
const NAV = [
  ['today','今日','sun',['today']],
  ['tasks','行动','check-square',['tasks','projects']],
  ['learn','学习','graduation-cap',['courses','books','questions']],
  ['knowledge','知识','files',['knowledge','recall']],
  ['review','回顾','flame',['daily','heatmap']],
];
// 分段标签。顶层入口的名字是「行动」，进去之后第一段叫「任务清单」——
// 同一个 id 在两处的措辞不同是故意的：一个回答「去哪」，一个回答「看什么」。
const LEAF_LABELS = {
  today:'今日', tasks:'行动清单', projects:'大项目',
  courses:'课程', books:'教材', questions:'待解疑问',
  knowledge:'笔记库', recall:'间隔复习',
  daily:'每日小结', heatmap:'学习热力',
};
const LEAVES = NAV.flatMap(([,,,ids]) => ids);
const PARENT_OF = new Map(NAV.flatMap(([nav,,,ids]) => ids.map(id => [id, nav])));
const SECTIONS_OF = new Map(NAV.map(([nav,,,ids]) => [nav, ids]));
/** 顶层入口的 id 也接受：落到它的第一个分段。 */
const resolveTab = (id) => (SECTIONS_OF.has(id) ? SECTIONS_OF.get(id)[0] : id);
// 学习页的三个分段直接对应三个 tab，renderStudy 仍按 studyMode 分支。
const STUDY_TABS = {courses:'courses', books:'books', questions:'questions'};
// 历史 consoleTab：V5.1 及更早的 study/review，以及 V5.2 的 review + consoleReviewPane。
const LEGACY_TABS = {study:'courses', review:'recall'};
// 三档模式：[id, 标签, phase, 分钟]。短休和长休共用 break——
// timer-core 的 PHASES 只有 focus/break，加第三个要动共享状态机和它的迁移。
const FOCUS_MODES = [['focus','专注 25m','focus',25],['short','短休 5m','break',5],['long','长休 15m','break',15]];
const FOCUS_TARGET = 4;
// 进度环的几何。半径 46、线宽 1.5，留 4 的余量给末端那颗圆点不被裁掉。
const DIAL_R = 46;
const DIAL_LEN = 2 * Math.PI * DIAL_R;
// 圆点放进一个绕中心旋转的组里，而不是每拍改 cx/cy。
// 改坐标的话，两点之间的过渡走的是直线——圆点会横穿圆盘内部抄近路，
// 而不是贴着弧线走。旋转一个组，运动轨迹天然就是那条弧。
// 组的基准位置在 3 点钟方向（未旋转坐标系），SVG 整体有 -90° 的 CSS 旋转，
// 所以渲染出来落在 12 点——和 <circle> 的描边起点一致。
const DIAL_SVG = `<svg class="os-dial-svg" viewBox="0 0 100 100" aria-hidden="true">
  <circle class="os-dial-track" cx="50" cy="50" r="${DIAL_R}"/>
  <circle class="os-dial-arc" data-arc cx="50" cy="50" r="${DIAL_R}"
    stroke-dasharray="${DIAL_LEN}" stroke-dashoffset="0"/>
  <g class="os-dial-bead-wrap" data-bead>
    <circle class="os-dial-glow" cx="${50 + DIAL_R}" cy="50" r="5.4"/>
    <circle class="os-dial-bead" cx="${50 + DIAL_R}" cy="50" r="2.6"/>
  </g>
</svg>`;
const MODULES = [['codex-capture','行动与捕获'],['codex-focus','专注计时'],['codex-study','PDF 学习'],['codex-recall','间隔复习'],['codex-workbench','工作台']];
const btn = (parent, label, action, cls = '') =>
  domBtn(parent, label, action, `os-button ${cls}`, error => new Notice(error.message || String(error)));
function input(parent, placeholder, value = '') {
  const e = el(parent, 'input', 'os-input'); e.type = 'text'; e.placeholder = placeholder; e.value = value; e.setAttribute('aria-label', placeholder); return e;
}
function title(path) { return String(path || '').split('/').pop().replace(/\.(md|pdf)$/i, ''); }
/**
 * 内容没变就不写。
 *
 * textContent 赋值会拆掉旧的文本节点再建一个，即使字符串一模一样——
 * 这些调用全在每秒一次的 tick 路径上，于是一堆一秒都不会变的文字
 * （按钮标签、任务标题、项目名）每秒重绘一次。带渐变和阴影的按钮尤其明显。
 */
function setText(node, value) { if (node && node.textContent !== value) node.textContent = value; }
function clock(seconds) { const n = Math.max(0, Math.ceil(seconds || 0)); return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`; }
function noteFile(f) { return f.extension === 'md' && !/^(\.|08 插件开发\/|99 模板\/|版本管理\/)/.test(f.path); }
function previewText(text, heading = '') { return String(text || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').replace(/<!--[^]*?-->/g,'').replace(/^\s*# ([^\r\n]+)\r?\n/, (line,title) => title.trim()===heading ? '' : line).slice(0, 1800); }
function dateForDay(key) {
  const [year, month, date] = String(key || '').split('-').map(Number);
  return new Date(year, month - 1, date, 12, 0, 0, 0);
}
function dayLabel(key) {
  return dateForDay(key).toLocaleDateString('zh-CN', {month:'long', day:'numeric', weekday:'short'});
}
function timeLabel(time) {
  const value = Number(time);
  return Number.isFinite(value) ? new Date(value).toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit'}) : '--:--';
}
function durationLabel(seconds) {
  const minutes = Math.max(0, Math.round((Number(seconds) || 0) / 60));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}
function sessionRange(session) { return `${timeLabel(session.startedAt)}–${timeLabel(session.endedAt)}`; }
function dayTooltip(day) {
  if (!day.count) return `${day.key}：暂无番茄钟`;
  return `${day.key}：${day.count} 个番茄钟 · ${durationLabel(day.seconds)} · ${day.sessions.map(sessionRange).join('、')}`;
}

class ConsoleView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf); this.plugin = plugin;
    // V5.2 把 daily/heatmap 存成 review + consoleReviewPane，这里还原成顶层 tab。
    const saved = plugin.data.consoleTab;
    const restored = resolveTab(saved === 'review' ? (plugin.data.consoleReviewPane || 'recall') : (LEGACY_TABS[saved] || saved));
    this.tab = LEAVES.includes(restored) ? restored : 'today';
    this.query = ''; this.filter = 'open'; this.studyMode = 'courses'; this.mobilePane = 'actions'; this.heatmapDay = dayKey();
    this.editors=new Set();this.taskRows=new Map();
    this.generation = 0; this.closed = false; this.selectedPath = ''; this.listPage = 0;
  }
  getViewType() { return 'codex-workbench'; }
  getDisplayText() { return 'Learning OS'; }
  getIcon() { return 'layout-dashboard'; }
  owner(id) { return this.plugin.app.plugins.getPlugin(id); }
  async onOpen() {
    this.closed = false; this.plugin.views.add(this); this.renderShell();
    this.registerEvent(this.plugin.app.workspace.on('learningos:focus-changed', () => this.refresh().catch(console.error)));
    this.registerEvent(this.plugin.app.workspace.on('codex-recall:changed', () => this.refresh().catch(console.error)));
    this.registerEvent(this.plugin.app.workspace.on('codex-capture:changed', () => this.refresh().catch(console.error)));
    this.registerEvent(this.plugin.app.workspace.on('codex-focus:changed', () => this.refresh().catch(console.error)));
    this.registerEvent(this.plugin.app.workspace.on('codex-focus:finished', () => this.refresh().catch(console.error)));
    await this.refresh();
  }
  async onClose() { this.closed = true; ++this.generation; this.plugin.views.delete(this); if(this.quickNotesTimer){clearTimeout(this.quickNotesTimer);await this.plugin.save().catch(console.error);} clearTimeout(this.quickNotesPreviewTimer); this.quickNotesOwner?.unload?.(); for (const mount of this.widgetMounts || []) mount.destroy?.(); this.widgetMounts = []; this.widgetMount = null; clearTimeout(this.searchTimer); clearTimeout(this.blurTimer); }
  /**
   * 页头第二行：这一页自己的状态。
   *
   * 6.1 之前这个位置是走秒时钟加天气，十个页面一模一样，而页面标题被压在下面
   * 当成 13px 的一行小字。现在标题就是标题，下面这行每页不同——页头唯一
   * 值得占的位置，是回答「这一页现在什么情况」。
   * 页脚那行是全局状态（待办 / 待复习），两者不重复。
   */
  pageStatus() {
    const s = this.snapshot || {};
    const now = Date.now();
    const open = (s.allTasks || []).filter(t => !t.done && !t.deleted);
    const count = (n, unit) => `${n} ${unit}`;
    switch (this.tab) {
      case 'today': {
        const date = new Date().toLocaleDateString('zh-CN', {month:'long', day:'numeric', weekday:'long'});
        return `${date} · 把今天，留给重要的事。`;
      }
      case 'tasks': {
        const due = open.filter(t => dueState(t.due)?.days === 0).length;
        const late = open.filter(t => (dueState(t.due)?.days ?? 0) < 0).length;
        const parts = [count(open.length, '项待办')];
        if (due) parts.push(count(due, '项今天截止'));
        if (late) parts.push(count(late, '项逾期'));
        return parts.join(' · ');
      }
      case 'projects':
        return count((s.files || []).filter(f => f.extension === 'md' && f.path.startsWith('02 项目/') && f.path !== '02 项目/项目导航.md').length, '个大项目');
      case 'courses': {
        const courses = this.plugin.courseCatalog?.() || [];
        const soon = courses
          .map(c => dueState(this.plugin.courseStateFor?.(c)?.exam))
          .filter(d => d && d.days >= 0)
          .sort((a, b) => a.days - b.days)[0];
        return [count(courses.length, '门课'), soon ? `最近一场考试${soon.days === 0 ? '就是今天' : ` 还有 ${soon.days} 天`}` : ''].filter(Boolean).join(' · ');
      }
      case 'books':
        return count((s.files || []).filter(f => f.extension === 'pdf').length, '本教材');
      case 'questions': {
        const openCount = s.study?.questionOpen || 0;
        return openCount ? count(openCount, '个待解疑问') : '没有待解疑问';
      }
      case 'knowledge':
        return count((s.notes || []).length, '篇笔记');
      case 'daily':
        return dayLabel(this.summaryDay || dayKey());
      case 'heatmap':
        return `本周 ${s.focus?.weekMinutes || 0} 分钟 · 连续 ${s.focus?.streak || 0} 天`;
      case 'recall': {
        const cards = s.cards || [];
        const due = cards.filter(c => c.due <= now).length;
        return due ? `${due} 篇到期 · 共 ${cards.length} 篇` : `没有到期的 · 共 ${cards.length} 篇`;
      }
      default:
        return '';
    }
  }
  renderShell() {
    const root = this.contentEl; root.replaceChildren(); root.classList.add('os-root');
    const app = el(root, 'div', 'os-app');
    const rail = el(app, 'aside', 'os-rail');
    const brand = el(rail, 'div', 'os-brand'); el(brand, 'span', 'os-mark', 'L');
    el(brand, 'div', 'os-wordmark', 'Learning OS');
    // 左栏有两块交给挂件：这一块在品牌和导航之间，另一块在导航和底部按钮之间。
    // 哪个挂件去哪一块由 codex-widgets 的设置决定，工作台只负责提供地方。
    this.widgetTop = el(rail, 'div', 'os-widgets os-widgets-top');
    const nav = el(rail, 'nav', 'os-nav'); nav.setAttribute('aria-label', '工作台导航'); this.nav = new Map();
    // 五项，不再需要分组标题——十项才需要。
    for (const [id, label, icon] of NAV) {
      const b = btn(nav, '', () => this.setTab(id), 'os-nav-button'); b.title = label;
      const mark = el(b, 'span', 'os-icon'); setIcon?.(mark, icon); el(b, 'span', 'os-nav-label', label); this.nav.set(id,b);
    }
    // 导航和底部按钮之间那段空白是布局逼出来的：nav 撑开、foot 贴底，中间永远空着。
    // 6.4 把它交给 codex-widgets。插件没装就什么都不发生——这块 div 保持 hidden，
    // 空白回到 6.3 的样子：工作台不因为少一个可选插件而少一块功能。
    this.widgetHost = el(rail, 'div', 'os-widgets os-widgets-bottom');
    const foot = el(rail, 'div', 'os-rail-foot');
    btn(foot, '＋ 快速捕获', () => this.plugin.captureNote(), 'os-capture');
    btn(foot, '模块与版本', () => this.showModules(), 'os-quiet');
    el(foot, 'span', 'os-local', '完全离线');
    const main = el(app, 'main', 'os-main');
    const header = el(main, 'header', 'os-header');
    const heading = el(header, 'div', 'os-heading'); this.titleEl = el(heading, 'h1');
    const subhead = el(heading, 'div', 'os-subhead');
    this.sectionEl = el(subhead, 'nav', 'os-sections'); this.sectionEl.setAttribute('aria-label', '页内分段');
    this.pageStatusEl = el(subhead, 'p', 'os-page-status');
    const actions = el(header, 'div', 'os-header-actions');
    // 第三块挂件区。天气默认落这里：它一行就说完，塞进左栏得竖着摆成一张 85px 的卡。
    // 放在 actions 里面而不是它旁边——actions 的 flex-basis 是 46%，按钮靠右端排，
    // 挂件搁在外面就会被那 46% 的空盒子推到页头正中间，孤零零悬着。
    this.widgetHeader = el(actions, 'div', 'os-widgets os-widgets-header');
    btn(actions, '今日日记', () => this.plugin.openDaily(), 'os-quiet');
    btn(actions, '＋ 新任务', () => this.plugin.captureTask(), 'os-primary');
    this.content = el(main, 'div', 'os-content');
    // 三块 host 都建好之后再挂。放在建完左栏那块就挂，页头那块还不存在。
    this.mountWidgets();
    const status = el(main, 'footer', 'os-footer'); this.statusEl = el(status, 'span');
    btn(status, '刷新', async() => {await this.flushEdits();return this.refresh(true);}, 'os-quiet');
    // 导航按键由 main.js 注册为 Obsidian 命令（默认 Alt+1–6，可改键）。
    // 这里不再自己监听 keydown，否则改键后旧的 Alt+N 仍会抢先生效。
    root.addEventListener('focusout', () => { clearTimeout(this.blurTimer); this.blurTimer=setTimeout(()=>{if(this.dirty&&!this.closed)this.refresh().catch(console.error);},0); });
  }
  /**
   * 左栏挂件。codex-widgets 负责内容，工作台只负责给它一块地方和一个生命周期。
   * 插件停用、或者根本没装，这里拿到 undefined，容器 hidden，左栏和 6.3 一样。
   */
  mountWidgets() {
    for (const mount of this.widgetMounts || []) mount.destroy?.();
    const widgets = this.owner('codex-widgets');
    const mounts = [
      [this.widgetTop, 'top'],
      [this.widgetHost, 'bottom'],
      [this.widgetHeader, 'header'],
    ].map(([host, slot]) => {
      const mount = widgets?.renderRail?.(host, {slot}) || null;
      // 只判断「插件在不在」。空不空是渲染结果，会随设置变，而设置改动只走
      // codex-widgets 自己的 repaint()，工作台不会被通知——所以那件事交给 CSS：
      // 挂件区空的时候带 data-empty，样式表按它收起来。
      host.hidden = !mount;
      return mount;
    }).filter(Boolean);
    this.widgetMounts = mounts;
    this.widgetMount = mounts[0] || null;
  }
  async flushEdits(){for(const editor of this.editors)await editor.flush();}
  /** 页内分段。只有一段的入口（今日）不显示这一行。 */
  renderSections(parent) {
    const ids = SECTIONS_OF.get(parent) || [];
    this.sectionEl.replaceChildren();
    this.sectionEl.hidden = ids.length < 2;
    if (ids.length < 2) return;
    for (const id of ids) {
      const b = btn(this.sectionEl, LEAF_LABELS[id] || id, () => this.setTab(id), `os-section ${id === this.tab ? 'is-active' : ''}`);
      b.setAttribute('aria-current', id === this.tab ? 'page' : 'false');
    }
  }
  async setTab(id) {
    await this.flushEdits();this.editors.clear();
    this.tab = resolveTab(id); this.query = ''; this.listPage = 0; this.selectedPath = '';
    this.plugin.data.consoleTab = this.tab;
    await this.plugin.save(); await this.refresh(true);
  }
  async refresh(force = false) {
    if (this.closed || !this.content) return;
    if(force)await this.flushEdits();
    if(!force&&[...this.editors].some(e=>e.open)){this.dirty=true;return;}
    const active = document.activeElement;
    if (!force && this.content.contains?.(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active?.tagName)) { this.dirty = true; return; }
    const request = ++this.generation;
    const scroll = [...this.content.querySelectorAll('[data-scroll]')].map(e => [e.dataset.scroll,e.scrollTop]);
    const p = this.plugin; p.bindOwners?.();
    // 挂件插件可能在工作台开着的时候被启用或停用。只在「有没有」变了的时候重挂，
    // 每次 refresh 都重建的话，设置弹窗里刚改的顺序会在下一次刷新时闪一下。
    if (!!this.widgetMount !== !!this.owner('codex-widgets')) this.mountWidgets();
    const capture = this.owner('codex-capture');
    const [tasks, stats] = await Promise.all([capture?.listTasks?.({filter:this.filter,query:this.tab === 'tasks' ? this.query : ''}) || [], capture?.taskStats?.() || {open:0,done:0}]);
    const todayTasks = await capture?.listTasks?.({filter:'today'}) || [];
    const allTasks=await capture?.index?.all?.()||tasks;
    this.focusId=await p.focusSelection?.read?.()||'';
    if (request !== this.generation || this.closed) return;
    const files = p.app.vault.getFiles?.() || [];
    this.snapshot = {allTasks,tasks, todayTasks, stats, files, notes:files.filter(noteFile), focus:focusSnapshot({sessions:p.data.sessions,timer:p.data.timer}), heatmap:heatmapData(p.data.sessions), study:studySnapshot(p.study?.data || {}), cards:this.owner('codex-recall')?.list?.() || []};
    this.titleEl.textContent = LEAF_LABELS[this.tab] || '今日';
    this.pageStatusEl.textContent = this.pageStatus();
    const parent = PARENT_OF.get(this.tab);
    for (const [id,b] of this.nav) { b.classList.toggle('is-active', id === parent); b.setAttribute('aria-current', id === parent ? 'page' : 'false'); }
    this.renderSections(parent);
    // 今日页的数据刷新复用专注面板，避免拆掉正在播放的圆环与读数。
    const keepFocus = this.tab === 'today' && this.focusPanel?.isConnected && this.focusPanelOwner === this.owner('codex-focus');
    if (!keepFocus) { this.focusPanel = null; this.timerEl = null; }
    this.content.className = `os-content os-page-${this.tab}`; this.content.replaceChildren();this.editors.clear();this.taskRows.clear();this.focusCard=null;
    this.statusEl.textContent = `${stats.open} 项待办 · ${this.snapshot.cards.filter(c => c.due <= Date.now()).length} 篇待复习`;
    if (!capture?.listTasks) this.statusEl.textContent = '行动索引未启用 · 在模块与版本中检查插件';
    switch (this.tab) {
      case 'projects': this.renderProjects(); break;
      case 'tasks': this.renderTasks(); break;
      case 'courses': case 'books': case 'questions': this.studyMode = STUDY_TABS[this.tab]; this.renderStudy(); break;
      case 'knowledge': this.renderKnowledge(); break;
      case 'daily': await this.renderDaily(); break;
      case 'heatmap': this.renderHeatmap(); break;
      case 'recall': this.renderRecall(); break;
      default: this.renderToday();
    }
    for (const [key,top] of scroll) { const e = [...this.content.querySelectorAll('[data-scroll]')].find(e => e.dataset.scroll === key); if (e) e.scrollTop = top; }
    this.dirty = false; this.tick();
  }
  panel(parent, heading, overline = '', cls = '') {
    const panel = el(parent, 'section', `os-panel ${cls}`);
    const head = el(panel, 'header', 'os-panel-head'); const block = el(head, 'div');
    if (overline) el(block, 'p', 'os-overline', overline);
    // 导航收敛后页面标题就是这一页的名字，面板再写一遍就是同一个词叠两次
    // （十页里有六页一字不差）。重名时不画 h2，aria-label 仍走 heading。
    if (heading !== this.titleEl?.textContent) el(block, 'h2', '', heading);
    const tools = el(head, 'div', 'os-tools'); const body = el(panel, 'div', 'os-panel-body');
    body.dataset.scroll = heading; body.tabIndex = 0; body.setAttribute('aria-label', heading);
    return {panel,head,tools,body};
  }
  empty(parent, heading, detail = '') { const e = el(parent,'div','os-empty'); el(e,'strong','',heading); if (detail) el(e,'p','',detail); return e; }
  search(parent, placeholder, redraw) {
    const field = input(parent, placeholder, this.query);
    field.addEventListener('input', () => { this.query = field.value; this.listPage = 0; clearTimeout(this.searchTimer); this.searchTimer = setTimeout(()=>Promise.resolve().then(redraw).catch(e=>new Notice(e.message)),100); });
    return field;
  }
  pageRows(parent, values, render) {
    const size = 60, max = Math.max(0, Math.ceil(values.length/size)-1); this.listPage = Math.min(this.listPage,max);
    for (const value of values.slice(this.listPage*size,(this.listPage+1)*size)) render(value);
    if (max) {
      const pages = el(parent, 'div', 'os-pagination');
      const prev = btn(pages,'上一页',()=>{this.listPage--;return this.refresh(true);}); prev.disabled = this.listPage === 0;
      el(pages,'span','',`${this.listPage+1} / ${max+1} · ${values.length} 项`);
      const next = btn(pages,'下一页',()=>{this.listPage++;return this.refresh(true);}); next.disabled = this.listPage === max;
    }
  }
  paintTask(task) {
    const record=this.taskRows.get(task);if(!record)return;
    const p=this.plugin,b=budget(task,p.data.sessions,p.data.timer,p.timerCore);
    record.row.dataset.budget=b.state;
    const selected=p.focusPreview?.day===dayKey()?p.focusPreview.task?.id===task.id&&!!task.id||p.focusPreview.task===task:this.focusId===task.id&&!!task.id;
    record.row.dataset.focus=String(!!selected);
    const display=taskPresentation(task,{showProject:record.showProject});
    if(record.heading)setText(record.heading,display.title);
    if(record.projectEl){setText(record.projectEl,display.project);record.projectEl.hidden=!display.project;}
    // 预算只在真有数据时出现：估过，或者已经花过时间。没估也没做过的任务
    // 不需要每行都被告知「未估算」。
    const shown=b.estimate>0||b.seconds>0;
    record.budgetEl.hidden=!shown&&!task.next_action;
    const spent=b.estimate>0?`已用 ${b.used.toFixed(1)} / ${b.estimate} 个番茄`:`已用 ${b.used.toFixed(1)} 个番茄`;
    const tail=b.state==='over'?` · 超出 ${b.overMinutes} 分钟`:b.state==='near'?' · 接近预计':'';
    setText(record.budgetEl,[task.next_action||'',shown?spent+tail:''].filter(Boolean).join(' · '));
  }
  renderFocusWidget(parent) {
    this.focusCard=el(parent,'div','os-focus-widget');this.focusHeading=el(this.focusCard,'strong');this.focusFeedback=el(this.focusCard,'p','os-muted');this.focusFeedback.setAttribute('role','status');
    const picker=el(this.focusCard,'details','os-focus-picker');picker.open=!this.focusId;el(picker,'summary','','更换今日要务');
    const select=el(picker,'select','os-input');select.setAttribute('aria-label','选择今日要务');el(select,'option','','选择任务，自动设为今日要务').value='';
    const tasks=(this.snapshot.allTasks||[]).filter(t=>!t.done&&!t.deleted);
    tasks.forEach((task,i)=>{const option=el(select,'option','',task.text);option.value=String(i);});
    select.onchange=()=>{if(select.value!=='')this.chooseFocus(tasks[Number(select.value)]).then(()=>{picker.open=false;}).catch(e=>new Notice(e.message));};
    btn(this.focusCard,'开始专注',async()=>{const id=await this.plugin.focusSelection.read();const task=(await this.owner('codex-capture').index.all()).find(t=>t.id===id&&!t.deleted&&!t.done);if(!task)throw Error('请先选择待办任务');await this.plugin.startPlan(task,{openDocument:false});},'os-quiet').setAttribute('aria-label','开始专注：今日要务');
    this.paintFocus();
  }
  paintFocus(){
    if(!this.focusCard)return;
    const preview=this.plugin.focusPreview?.day===dayKey()?this.plugin.focusPreview:null;
    const task=preview?.task||(this.snapshot.allTasks||[]).find(t=>t.id===this.focusId&&!!t.id);
    this.focusCard.dataset.focus=String(!!task);
    setText(this.focusHeading,task?`${task.deleted?'已删除：':task.done?'已完成：':''}${task.text}`:'选择一项今天最值得完成的行动');
    setText(this.focusFeedback,preview?.message||(task?'已记录到今日日记 · 选择后自动保存':this.focusId?'原今日要务无法定位，请重新选择':'在行动行点“设为今日要务”，或从下方选择'));
  }
  async chooseFocus(task){
    const p=this.plugin,request=(p.focusRequest||0)+1,selectedDay=dayKey();p.focusRequest=request;
    p.focusPreview={day:selectedDay,task,message:'同步中…'};for(const v of p.views){v.paintFocus();for(const t of v.taskRows.keys())v.paintTask(t);}
    try{await this.flushEdits();if(p.focusRequest!==request)return;const stable=await p.focusSelection.select(task,selectedDay);Object.assign(task,stable);if(p.data.timer.status!=='idle'&&p.data.timer.phase==='focus')await p.startPlan(stable,{openDocument:false});if(p.focusRequest===request){p.focusPreview=null;for(const v of p.views){v.focusId=stable.id;const known=v.snapshot?.allTasks?.find(t=>t.id===stable.id||t.raw===task.raw);if(known)Object.assign(known,stable);else v.snapshot?.allTasks?.push(stable);v.paintFocus();for(const t of v.taskRows.keys())v.paintTask(t);}}}
    catch(e){if(p.focusRequest===request){p.focusPreview=null;for(const v of p.views){v.paintFocus();for(const t of v.taskRows.keys())v.paintTask(t);if(v.focusFeedback)v.focusFeedback.textContent='未同步：'+e.message+'；请重新选择重试';}}throw e;}
  }
  openProjectManager(selectedPath=''){
    const modal=new Modal(this.plugin.app);
    modal.onOpen=()=>{modal.contentEl.classList.add('os-project-modal');this.renderProjectEditor(modal.contentEl,selectedPath,modal);};
    modal.onClose=()=>this.refresh(true).catch(console.error);
    modal.open();
  }
  async deleteProject(file,modal=null){
    if(!file)return;
    const tasks=this.snapshot.allTasks.filter(task=>!task.deleted&&(task.path===file.path||task.project===file.path||task.project===file.basename));
    const detail=tasks.length?`；其中包含 ${tasks.length} 个子任务`:'。';
    if(!window.confirm(`确定将项目“${file.basename}”移入回收站吗${detail}？项目文件及其中任务可从 Obsidian 回收站恢复。`))return;
    await this.flushEdits();
    await this.owner('codex-capture').deleteProject(file);
    if(modal)modal.close();else await this.refresh(true);
    new Notice(`项目“${file.basename}”已移入回收站`);
  }
  renderProjectEditor(parent,selectedPath='',modal=null){
    if(parent.querySelector('.os-project-editor'))return;
    const root=el(parent,'div','os-project-editor');parent.prepend(root);
    const createRow=el(root,'div','os-project-create-row');
    const select=el(createRow,'select','os-input');select.setAttribute('aria-label','选择项目');el(select,'option','','选择项目').value='';
    const projects=this.snapshot.files.filter(f=>f.extension==='md'&&f.path.startsWith('02 项目/')&&f.path!=='02 项目/项目导航.md');
    projects.forEach((f,i)=>{el(select,'option','',f.basename).value=String(i);});
    const createName=input(createRow,'新项目名称');btn(createRow,'创建项目',async()=>{const file=await this.owner('codex-capture').createProject(createName.value);createName.value='';projects.push(file);el(select,'option','',file.basename).value=String(projects.length-1);select.value=String(projects.length-1);await load();},'os-quiet');
    const fields=el(root,'div','os-project-fields');const footer=el(root,'div','os-project-editor-actions');let editor,activeFile=null;
    const deleteButton=btn(footer,'删除当前项目',()=>this.deleteProject(activeFile,modal),'os-quiet os-danger');deleteButton.disabled=true;
    const collapse=btn(footer,'收起项目设置',async()=>{if(editor){await editor.flush();editor.open=false;this.editors.delete(editor);}if(modal)modal.close();else root.remove();},'os-quiet');
    const load=async()=>{
      if(editor)await editor.flush();
      fields.replaceChildren();activeFile=null;deleteButton.disabled=true;
      if(select.value==='')return;
      const index=Number(select.value),file=projects[index];
      if(!file)return;
      activeFile=file;deleteButton.disabled=false;
      const fm=await this.owner('codex-capture').readProject(file);
      const values={};
      const titleWrap=el(fields,'label','os-editor-field');el(titleWrap,'span','', '项目名称');values.name=input(titleWrap,'项目名称',file.basename);
      for(const [key,label]of [['goal','项目目标'],['next','项目下一步'],['due','项目截止日期']]){const wrap=el(fields,'label','os-editor-field');el(wrap,'span','',label);values[key]=input(wrap,label,fm[key]||'');if(key==='due')values[key].type='date';}
      const status=el(fields,'span','os-save-state','修改后自动保存');let saved={name:file.basename,goal:fm.goal||'',next:fm.next||'',due:fm.due||''},queue=Promise.resolve();
      if(editor)this.editors.delete(editor);
      editor={open:true,flush:()=>{const run=queue.then(async()=>{const next=Object.fromEntries(Object.entries(values).map(([k,e])=>[k,e.value]));if(JSON.stringify(next)===JSON.stringify(saved))return;status.textContent='保存中…';try{
        if(next.name!==saved.name){const renamed=await this.owner('codex-capture').renameProject(activeFile,next.name);activeFile=renamed||activeFile;projects[index]=activeFile;select.options[index].textContent=activeFile.basename;saved.name=activeFile.basename;values.name.value=activeFile.basename;}
        const metadata={goal:next.goal,next:next.next,due:next.due};const before={goal:saved.goal,next:saved.next,due:saved.due};
        if(JSON.stringify(metadata)!==JSON.stringify(before)){await this.owner('codex-capture').patchProject(activeFile,before,metadata);Object.assign(saved,metadata);}
        status.textContent='已保存到项目';
      }catch(e){status.textContent='未保存：'+e.message;throw e;}});queue=run.catch(()=>{});return run;}};this.editors.add(editor);
      for(const field of Object.values(values))field.onchange=()=>editor.flush().catch(()=>{});
      btn(fields,'重试保存',()=>editor.flush(),'os-quiet');
      btn(fields,'新增子任务',()=>this.owner('codex-capture').captureTask({project:activeFile.path,scheduled:'backlog'}),'os-quiet');
    };
    select.onchange=()=>load().catch(e=>new Notice(e.message));
    const selectedIndex=projects.findIndex(file=>file.path===selectedPath);if(selectedIndex>=0){select.value=String(selectedIndex);load().catch(e=>new Notice(e.message));}
  }
  renderToday() {
    const mobile = el(this.content,'div','os-mobile-switch');
    for (const [id,label] of [['actions','今日行动'],['focus','专注与阅读']]) btn(mobile,label,()=>{this.mobilePane=id;return this.refresh(true);},this.mobilePane===id?'is-active':'');
    // 三栏：专注与阅读 / 今日要务与统计 / 下一步行动。
    //
    // 6.x 一直是两栏（左：今日要务 + 下一步行动，右：专注 + 阅读），于是左栏
    // 同时装着「今天做哪一件」和「今天还剩哪些」——一个决定和一份清单叠在一列里，
    // 谁也不像主角。拆成三栏之后每一栏只回答一个问题：现在在干什么、
    // 今天最重要的是什么、接下来做什么。
    const layout = el(this.content,'div',`os-today-grid os-mobile-${this.mobilePane}`);

    const focusCol = el(layout,'div','os-today-col is-focus');
    this.renderFocus(focusCol);
    this.renderResume(focusCol);

    const intentCol = el(layout,'div','os-today-col is-intent');
    const intent = el(intentCol,'section','os-intent');
    el(intent,'p','os-overline','今日要务');
    this.renderFocusWidget(intent);
    this.renderStats(intentCol);
    this.renderQuickNotes(intentCol);
    // 排序里加了课程紧迫度：考试临近、本周没碰过的课，它的任务排到前面。
    // 界面上不加任何新元素，变的只是顺序——课程页早就知道考试日期和本周时长，
    // 只是这些数从来没流到今日页来。
    const ranked = rankTodayTasks({
      tasks: this.snapshot.todayTasks,
      courses: this.plugin.courseUrgencyMap?.() || {},
      courseOf: task => this.plugin.courseIdFor?.(task) || '',
      currentTask: this.plugin.data.timer?.task || '',
    });
    const actionCol = el(layout,'div','os-today-col is-actions');
    const action = this.panel(actionCol,'下一步行动','按紧迫度排序：逾期、今天截止、考试临近的课','os-grow');
    btn(action.tools,'全部行动 →',()=>this.setTab('tasks'),'os-quiet');
    if (!this.snapshot.todayTasks.length) {
      this.empty(action.body,'今天还没有安排','新建任务，或到行动页把已有事项安排到今天。');
      btn(action.body,'安排一个行动',()=>this.plugin.captureTask(),'os-primary');
    }
    for (const task of ranked) this.taskRow(action.body,task,true);
  }
  /**
   * 统计数据。三块读数加一张近 12 周的热力图。
   *
   * 读数原来挂在「今日要务」那张卡里，和「今天做哪一件」挤在一起。那张卡问的是
   * 一个决定，这三个数回答的是一次回顾——两件事不该共用一张卡，也不该共用一个标题。
   *
   * 热力图读的是同一份 snapshot.heatmap，和「回顾 → 学习热力」那页同源。
   * 这里只画格子，不做选中态：两处各存一份「当前选的是哪天」一定会漂，
   * 而这块的职责只是「最近在不在学」。点它跳到那一页，详情归那一页。
   */
  renderStats(parent) {
    const stats = this.panel(parent,'统计数据','','os-stats');
    const tiles = el(stats.body,'div','os-stat-tiles');
    for (const [value,label] of [
      [this.snapshot.stats.done,'今日完成'],
      [this.snapshot.focus.todayMinutes,'专注分钟'],
      [this.snapshot.study.todayPages,'阅读页数'],
    ]) {
      const tile = el(tiles,'div','os-stat-tile');
      el(tile,'strong','',String(value));
      el(tile,'span','',label);
    }

    const heat = this.snapshot.heatmap;
    if (!heat?.days?.length) return;
    const todayKey = dayKey();
    const mini = btn(stats.body,'',()=>this.setTab('heatmap'),'os-heat-mini');
    mini.title = `近 ${heat.weeks} 周 · ${heat.totalSessions} 个番茄钟 · ${heat.activeDays} 天有记录`;
    mini.setAttribute('aria-label',`${mini.title}，点击查看学习热力`);
    const grid = el(mini,'span','os-heat-mini-grid');
    grid.style.gridTemplateColumns = `repeat(${heat.weeks}, minmax(0, 1fr))`;
    for (const [index,day] of heat.days.entries()) {
      const cell = el(grid,'i',`os-heat-cell os-heat-level-${day.level}${day.key>todayKey?' is-future':''}`);
      cell.style.gridColumn = String(Math.floor(index/7)+1);
      cell.style.gridRow = String(index%7+1);
    }
  }
  renderResume(parent) {
    const resume = this.panel(parent,'继续阅读','','os-resume');
    const path = this.plugin.data.lastTextbook;
    if (path) {
      el(resume.body,'strong','os-book-title',title(path));
      const record = this.plugin.study?.data?.records?.[path];
      const page = record?.position?.page, total = Number(record?.totalPages) || 0;
      el(resume.body,'p','os-muted',page ? `上次停在第 ${page} 页` : '打开教材，接着上次的思路');
      // 进度条只在知道总页数时画。不知道就不画——用「已读页数 / 未知」凑一根条，
      // 画出来的位置是假的，比不画更糟。totalPages 由 codex-study 在打开 PDF 时写入。
      if (page && total > 0) {
        const track = el(resume.body,'div','os-read-track');
        const fill = el(track,'span','os-read-fill');
        const portion = Math.max(0, Math.min(1, page / total));
        fill.style.width = `${(portion * 100).toFixed(1)}%`;
        track.setAttribute('role','progressbar');
        track.setAttribute('aria-valuemin','0'); track.setAttribute('aria-valuemax',String(total));
        track.setAttribute('aria-valuenow',String(page));
        track.setAttribute('aria-label',`阅读进度：第 ${page} 页，共 ${total} 页`);
        track.title = `${page} / ${total} 页 · ${Math.round(portion*100)}%`;
      }
      btn(resume.body,'打开教材 ↗',()=>this.plugin.openLastTextbook(),'os-quiet');
    } else {el(resume.body,'p','os-muted','从课程或教材库开始，阅读位置会保存在这里。');btn(resume.body,'选择教材',()=>this.setTab('books'),'os-quiet');}
  }
  /** 学习中随手记，不切页、不碰当前番茄钟；归档时才写今日日记。 */
  renderQuickNotes(parent) {
    const card = this.panel(parent,'闪念','自动保存','os-scratchpad');
    const input = el(card.body,'textarea','os-scratchpad-input');
    input.rows = 3; input.value = this.plugin.data.quickNotesDraft || '';
    input.placeholder = '丢下一句想法；粘贴 \\( \\) 或 \\[ \\] 公式会自动排版…';
    input.setAttribute('aria-label','快捷闪念草稿'); input.spellcheck = false;
    const preview = el(card.body,'div','os-scratchpad-preview');
    preview.setAttribute('aria-live','polite'); preview.setAttribute('aria-label','闪念排版预览');
    this.quickNotesOwner ||= markdownOwner();
    const paint = () => {
      const markdown = toObsidianMarkdown(input.value);
      if (!markdown) {
        preview.replaceChildren(); preview.classList.remove('markdown-rendered','is-raw');
        el(preview,'span','os-scratchpad-placeholder','LaTeX 与 Markdown 预览'); return;
      }
      renderMarkdown(this.plugin.app,this.quickNotesOwner,preview,markdown,`05 日记/${dayKey()}.md`);
    };
    const persist = () => {
      this.plugin.data.quickNotesDraft = input.value.slice(0,20000);
      clearTimeout(this.quickNotesTimer);
      this.quickNotesTimer = setTimeout(() => this.plugin.save().catch(error => new Notice(`闪念未保存：${error.message}`)),320);
    };
    const clear = async () => {
      clearTimeout(this.quickNotesTimer); input.value=''; this.plugin.data.quickNotesDraft='';
      await this.plugin.save(); paint(); input.focus();
    };
    const archive = async () => {
      clearTimeout(this.quickNotesTimer); const markdown=toObsidianMarkdown(input.value);
      if(!markdown){new Notice('先写下一点内容。');input.focus();return;}
      await this.plugin.archiveQuickNote(markdown);input.value='';paint();input.focus();new Notice('闪念已写入今日日记。');
    };
    btn(card.tools,'清空',clear,'os-quiet').setAttribute('aria-label','清空快捷闪念草稿');
    btn(card.tools,'存入日记',archive,'os-primary').setAttribute('aria-label','把快捷闪念写入今日日记');
    input.addEventListener('input',()=>{persist();clearTimeout(this.quickNotesPreviewTimer);this.quickNotesPreviewTimer=setTimeout(paint,220);});
    input.addEventListener('paste',event=>{const text=event.clipboardData?.getData('text/plain');if(!text||!changesOnPaste(text))return;event.preventDefault();input.setRangeText(toObsidianMarkdown(text),input.selectionStart||0,input.selectionEnd||0,'end');persist();paint();});
    input.addEventListener('keydown',event=>{if(!event.isComposing&&event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();archive().catch(error=>new Notice(error.message));}});
    paint();
  }
  taskRow(parent, task, compact = false, options = {}) {
    const showProject = options.showProject !== false;
    const display = taskPresentation(task, {showProject});
    const row = el(parent,'div',`os-task-row ${task.done?'is-done':''}`);
    const check = btn(row,task.done?'✓':'',async()=>{await this.flushEdits();await this.owner('codex-capture').updateTask(task,task.done?'reopen':'done');await this.refresh(true);},'os-check');
    check.disabled=!!task.deleted;
    check.setAttribute('aria-label',`${task.done?'重新打开':'完成'}：${task.text}`);
    const detail = el(row,'div','os-row-main');
    const heading = el(detail,'div','os-task-title',display.title);
    // 一条元数据行，全部是 chip。此前这里是两行：一行纯文字元数据，
    // 一行固定渲染的预算字符串——而预算字段从来没人填，于是 100% 的行上
    // 挂着同一句「已用 0.0 / 未估算 · 完成 0 轮」。
    const meta = el(detail,'div','os-row-meta');
    const projectEl = el(meta,'span','os-chip os-chip-project');
    if (!display.projectTitle || !showProject) el(meta,'span','os-source',title(task.path));
    if (task.due) {
      const due=dueState(task.due);
      const badge=el(meta,'span',`os-chip ${!task.done&&due?`os-${due.level}`:''}`,task.done?task.due:due?due.label:'截止日期无效');
      badge.title=task.due;
    }
    if (task.priority) el(meta,'span','os-chip os-priority',task.priority_level||(task.priority===2?'高优先':'重要'));
    if (task.scheduled === dayKey()) el(meta,'span','os-chip','今天');
    const budgetEl=el(meta,'span','os-chip os-budget');budgetEl.setAttribute('role','status');
    this.taskRows.set(task,{row,detail,budgetEl,heading,projectEl,showProject});this.paintTask(task);
    const actions = el(row,'div','os-row-actions');
    if(task.deleted){btn(actions,'恢复',async()=>{await this.flushEdits();await this.owner('codex-capture').updateTask(task,'restore');await this.refresh(true);},'os-quiet');return;}
    // 每行都有同名按钮，可访问名必须带上任务本身，否则读屏只会听到一串「设为今日要务」。
    btn(actions,'设为今日要务',()=>this.chooseFocus(task),'os-quiet').setAttribute('aria-label',`设为今日要务：${task.text}`);
    btn(actions,'补充详情',()=>{new DetailModal(this,task).open();},'os-quiet').setAttribute('aria-label',`补充详情：${task.text}`);
    btn(actions,'删除',async()=>{await this.flushEdits();await this.owner('codex-capture').deleteTask(task);await this.refresh(true);},'os-quiet');
    if (!task.done) {
      if (!compact) btn(actions,task.scheduled===dayKey()?'移出今天':'安排今天',async()=>{await this.flushEdits();await this.owner('codex-capture').updateTask(task,task.scheduled===dayKey()?'unschedule':'today');await this.refresh(true);},'os-quiet');
      const start = btn(actions,'开始专注',async()=>{await this.flushEdits();await this.plugin.startPlan(task,{openDocument:false});this.tick();},'os-quiet');
      start.setAttribute('aria-label',`开始专注：${task.text}`);
      start.disabled = !this.owner('codex-focus');
    }
  }
  /**
   * 专注台。
   *
   * 三档模式（专注 / 短休 / 长休）走的是两个 phase：短休和长休都是 break，
   * 只是分钟数不同。timer-core 的 PHASES 是 ['focus','break']，加第三个要动
   * 共享状态机和它的迁移，而这里要的只是「一键切到 15 分钟」——
   * 界面上是三档，底下仍然是两态。
   */
  renderFocus(parent) {
    if (this.focusPanel) { parent.appendChild(this.focusPanel); return; }
    const p = this.plugin; const focus = this.panel(parent,'专注时间','','os-focus os-grow');
    this.focusPanel = focus.panel;
    this.focusPanelOwner = this.owner('codex-focus');
    if (!this.owner('codex-focus')) {this.empty(focus.body,'专注插件未启用','在 Obsidian 插件设置中启用 Codex 专注。');return;}

    // 凹陷的分段控件。选中项是一块浮在槽里的象牙玻璃。
    const modes = el(focus.body,'div','os-modes'); modes.setAttribute('role','tablist');
    this.modeButtons = new Map();
    for (const [id,label,phase,minutes] of FOCUS_MODES) {
      const b = btn(modes,label,async()=>{
        if (p.data.timer.status !== 'idle') throw Error('计时进行中，先结束再切换模式');
        if (p.data.timer.phase !== phase) await p.setPhase(phase);
        await this.owner('codex-focus').setSettings({[phase==='focus'?'focusMinutes':'breakMinutes']:minutes});
        this.mode = id; await this.refresh(true);
      },'os-mode');
      b.setAttribute('role','tab');
      this.modeButtons.set(id,b);
    }

    // 读数和它外面那圈进度环。环画在 SVG 里：两条同心圆弧，底下一条是刻度轨，
    // 上面一条按剩余比例收缩，末端跟着一颗小圆点。
    const dial = el(focus.body,'div','os-dial');
    dial.innerHTML = DIAL_SVG;
    this.dialEl = dial;
    this.dialPainted = false;
    this.dialArc = dial.querySelector('[data-arc]');
    this.dialBead = dial.querySelector('[data-bead]');
    const face = el(dial,'div','os-dial-face');
    this.timerEl = el(face,'div','os-time'); this.timerEl.setAttribute('role','timer');
    this.timerDigits = [];
    // 悬浮在读数上才浮出来的加减号：调时长不再需要底下单独一张卡。
    const stepper = el(face,'div','os-time-step');
    const cap = () => p.data.timer.phase === 'focus' ? 180 : 60;
    const nudge = async (delta) => {
      if (p.data.timer.status !== 'idle') throw Error('计时进行中，时长改不了');
      const phase = p.data.timer.phase;
      // 夹在范围内再提交，而不是超出时抛错：加减号是连点的东西。
      const next = Math.min(cap(), Math.max(1, p.minutes() + delta));
      await this.owner('codex-focus').setSettings({[phase==='focus'?'focusMinutes':'breakMinutes']:next});
      this.mode = ''; this.tick(); this.paintModes();
    };
    btn(stepper,'−',()=>nudge(-5),'os-step').setAttribute('aria-label','减少 5 分钟');
    btn(stepper,'+',()=>nudge(5),'os-step').setAttribute('aria-label','增加 5 分钟');

    // 任务绑定。没绑时是「＋ 关联任务」，绑上之后显示任务名，点开还能换。
    this.timerTask = btn(focus.body,'',()=>this.openFocusPicker(),'os-focus-bind');

    // 目标轮次的小珠子。实心的是今天已完成的专注段，空心的是还没走到的。
    this.beadsEl = el(focus.body,'div','os-beads'); this.beadsEl.setAttribute('role','img');

    const actions = el(focus.body,'div','os-focus-controls');
    this.focusControls = actions;
    this.startButton = btn(actions,'开始专注',async()=>{await p.toggle(p.data.timer.task || '自由专注');this.tick();},'os-primary');
    this.stopButton = btn(actions,'结束',async()=>{await p.stop();await this.refresh(true);},'os-quiet os-stop');
    this.phaseButton = this.startButton; // tick 里旧的引用还在用，指向一个不会报错的节点
  }

  /** 分段控件的选中态。手动调过分钟数之后三档都不亮——那时的时长不属于任何一档。 */
  paintModes() {
    if (!this.modeButtons) return;
    const p = this.plugin, t = p.data.timer, minutes = p.minutes();
    const hit = FOCUS_MODES.find(([,,phase,m]) => phase === t.phase && m === minutes);
    for (const [id,,,] of FOCUS_MODES.map(m=>[m[0],m[1],m[2],m[3]])) {
      const b = this.modeButtons.get(id);
      const on = !!hit && hit[0] === id;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.disabled = t.status !== 'idle';
    }
  }

  /**
   * 进度环画的是**已过**，不是剩余。
   *
   * 第一版画的是剩余：整圈起步，随时间收缩。数字上没错，看着却是反的——
   * 弧在缩、圆点贴着弧尾逆时针往回退，而人盯着倒计时时期待的是一根像表针那样
   * 顺时针扫过去的东西。改成已过之后：起步空环、圆点在十二点，随时间顺时针长出来，
   * 一段专注正好扫满一圈，圆点始终在进度的头上。
   *
   * 过渡只在 running 时开，时长正好等于一拍（1s，线性）：每秒到一个新值、
   * 用整整一秒匀速走到位，接起来就是连续的。短于一拍会走走停停，
   * 长于一拍会永远落在后面。
   *
   * 暂停和归零时必须关掉过渡——归零是 100% 跳回 0%，带着过渡的话
   * 圆点会倒着绕一整圈，弧线也会反向缩回去。
   */
  paintDial() {
    if (!this.dialArc) return;
    const p = this.plugin, t = p.data.timer;
    const total = Math.max(1, t.status === 'idle' ? p.minutes()*60 : (t.duration || p.minutes()*60));
    const left = t.status === 'idle' ? total : Math.max(0, p.timerCore.remaining(t));
    const done = 1 - Math.max(0, Math.min(1, left / total));   // 已过的比例
    const live = t.status === 'running';
    // 先决定过渡开不开，再写新值：顺序反了，这一拍的跳变会带着上一拍的过渡。
    this.dialEl.classList.toggle('is-live', live && this.dialPainted);
    this.dialArc.style.strokeDashoffset = String(DIAL_LEN * (1 - done));
    // 组绕中心转，基准在 12 点。SVG 整体已经 -90°，这里不能再减一次——
    // 减两次的结果是圆点比弧尾整整差 90°，看着像两个互不相干的东西。
    this.dialBead.style.transform = `rotate(${done * 360}deg)`;
    this.dialBead.style.opacity = t.status === 'idle' ? '0' : '1';
    if (!this.dialPainted) {
      // 新挂载的表盘先落在当前进度，下一拍才启用动画，避免从整圈倒放。
      this.dialEl.getBoundingClientRect?.();
      this.dialPainted = true;
    }
  }

  /** 轮次珠子。今天完成了几段专注就点亮几颗，超过四段按四颗封顶。 */
  /**
   * 轮次珠子。建一次，之后只切 class。
   *
   * 原来每拍 replaceChildren 重建四个节点——一秒一次拆了重搭，屏幕上就是在闪。
   * 一秒钟里这四颗珠子几乎永远不变，重建的是同样的东西。
   */
  paintBeads() {
    if (!this.beadsEl) return;
    const done = Math.min(FOCUS_TARGET, this.snapshot?.focus?.completedToday ?? 0);
    if (this.beadsEl.childElementCount !== FOCUS_TARGET) {
      this.beadsEl.replaceChildren();
      for (let i = 0; i < FOCUS_TARGET; i++) el(this.beadsEl,'span','os-bead');
    }
    [...this.beadsEl.children].forEach((bead,i) => bead.classList.toggle('is-done', i < done));
    this.beadsEl.setAttribute('aria-label', `今日目标 ${FOCUS_TARGET} 段，已完成 ${done} 段`);
  }

  /** 点任务绑定条：展开今日要务的选择器，没有就跳去行动页。 */
  async openFocusPicker() {
    if (this.tab !== 'today') { await this.setTab('today'); }
    const picker = this.content.querySelector('.os-focus-picker');
    if (!picker) return;
    picker.open = true;
    picker.scrollIntoView({block:'nearest'});
    picker.querySelector('select')?.focus();
  }
  tick() {
    if(this.closed)return;
    for(const task of this.taskRows.keys())this.paintTask(task);this.paintFocus();
    const today=dayKey();
    if(this.lastDay&&this.lastDay!==today)this.refresh().catch(console.error);
    this.lastDay=today;
    if (!this.timerEl || this.closed) return;
    const p=this.plugin,t=p.data.timer;
    const reading = clock(t.status==='idle'?p.minutes()*60:p.timerCore.remaining(t));
    this.timerEl.classList.toggle('is-long', reading.length > 5);
    if (this.timerDigits.length !== reading.length) {
      this.timerEl.replaceChildren();
      this.timerDigits = [...reading].map(char => el(this.timerEl,'span',char === ':' ? 'os-time-colon' : 'os-time-digit',char));
    } else {
      [...reading].forEach((char, i) => setText(this.timerDigits[i], char));
    }
    this.paintDial(); this.paintBeads(); this.paintModes();

    // 任务绑定条。没绑就是一句邀请，绑上了带一个圆点和下拉记号——
    // 后者是在说「这里还能点」，前一版那行纯文字看不出可点。
    const bound = t.status==='idle'
      ? (this.snapshot?.allTasks||[]).find(task=>task.id===this.focusId&&!task.done&&!task.deleted)?.text
      : (t.task && t.task!=='自由专注' ? t.task : '');
    setText(this.timerTask, bound ? `● 正在进行：${bound} ▾` : '＋ 关联任务');
    this.timerTask.classList.toggle('is-bound', !!bound);

    // 形变 CTA：空闲时只有一个通栏的大漆按钮，跑起来才裂成 暂停 / 结束。
    // 空闲时留一个按不动的「结束」，是在界面上摆一个永远没用的东西。
    const running = t.status!=='idle';
    setText(this.startButton,t.status==='running'?'⏸ 暂停':t.status==='paused'?'▶ 继续':t.phase==='focus'?'▶ 开始专注':'▶ 开始休息');
    setText(this.stopButton,'⏹ 结束');
    this.stopButton.hidden=!running;
    // 直接拿着容器的引用，不从按钮往上摸 parentElement——
    // 后者在无头 DOM 里是 undefined，而 smoke 就跑在那上面。
    this.focusControls.classList.toggle('is-running',running);
    if (!this.owner('codex-focus')) {this.startButton.disabled=true;this.stopButton.disabled=true;}
  }
  updateBooks() { if (!this.closed) this.refresh().catch(console.error); }
  renderProjects() {
    const panel=this.panel(this.content,'大项目','目标 → 子任务','os-fill');
    btn(panel.tools,'新建 / 管理项目',()=>this.openProjectManager(),'os-quiet');
    for(const file of this.snapshot.files.filter(f=>f.extension==='md'&&f.path.startsWith('02 项目/')&&f.path!=='02 项目/项目导航.md')){
      const card=el(panel.body,'section','os-project-container');el(card,'h2','os-project-title',file.basename);
      btn(card,'打开项目笔记',()=>this.plugin.open(file.path),'os-quiet');
      btn(card,'编辑项目',()=>this.openProjectManager(file.path),'os-quiet');
      const tasks=this.snapshot.allTasks.filter(t=>!t.deleted&&(t.project===file.path||t.project===file.basename||!t.project&&t.path===file.path));
      btn(card,'＋ 添加子任务',()=>this.owner('codex-capture').captureTask({project:file.path,scheduled:'backlog'}),'os-quiet');
      btn(card,'删除项目',()=>this.deleteProject(file),'os-quiet os-danger');
      const unassigned=this.snapshot.allTasks.filter(t=>!t.done&&!t.deleted&&!t.project&&!t.path.startsWith('02 项目/'));
      const attach=el(card,'select','os-input');el(attach,'option','','挂载已有独立任务').value='';unassigned.forEach((t,i)=>el(attach,'option','',t.text).value=String(i));attach.onchange=async()=>{if(attach.value==='')return;try{await this.owner('codex-capture').patchTask(unassigned[Number(attach.value)],{project:file.path});await this.refresh(true);}catch(e){new Notice(e.message);}};
      el(card,'p','os-muted',`${tasks.filter(t=>t.done).length} / ${tasks.length} 子任务完成`);
      for(const task of tasks)this.taskRow(card,task,false,{showProject:false});
    }
  }
  async renderDaily() {
    const panel=this.panel(this.content,'每日小结','','os-fill os-daily-panel');
    const key=this.summaryDay||dayKey(),date=input(panel.tools,'小结日期',key);date.type='date';date.onchange=()=>{if(date.value){this.summaryDay=date.value;this.refresh(true).catch(console.error);}};
    btn(panel.tools,'存入日记',async()=>{await this.plugin.syncDailySummary(dateForDay(key).getTime());new Notice('每日小结已保存');},'os-quiet');
    const report=await this.plugin.dailyAudit(key);if(!panel.body.isConnected)return;
    panel.body.classList.add('os-audit-board');panel.body.removeAttribute('data-scroll');
    const card=(heading)=>{const root=el(panel.body,'section','os-audit-card');el(root,'h3','',heading);const body=el(root,'div','os-audit-card-body');body.tabIndex=0;body.setAttribute('aria-label',heading);return body;};
    const time=card('时间分布');el(time,'strong','os-audit-metric',`${(report.seconds/60).toFixed(1)} 分钟`);el(time,'p','os-muted',`切换 ${report.switches} · 打断 ${report.interruptions}`);
    for(const [name,seconds] of Object.entries(report.projects)){const row=el(time,'div','os-audit-row');el(row,'span','',`${name==='独立任务 / 临时杂项'?'独立任务':title(name)} · ${report.seconds?(seconds/report.seconds*100).toFixed(1):0}%`);const bar=el(row,'progress');bar.max=report.seconds||1;bar.value=seconds;}
    const detail=el(time,'details','os-focus-picker');detail.open=true;el(detail,'summary','','任务工时');for(const t of Object.values(report.tasks||{}))el(detail,'p','',`${t.text} · ${(t.seconds/60).toFixed(2)} 分钟`);
    const done=card(`今日完成 · ${report.done.length}`),pending=card(`未完 / 流转 · ${report.pending.length}`);
    for(const [parent,tasks] of [[done,report.done],[pending,report.pending]]){for(const t of tasks){const completed=Math.max(0,Number(t.completedPomodoros)||0),estimated=Math.max(0,Number(t.estimated_pomodoros)||0),pomodoros=parent===done?(estimated>0?` · 完成 ${completed}/${estimated} 个番茄钟 · ${Math.round(completed/estimated*100)}%`:` · 完成 ${completed} 个番茄钟`):'';btn(parent,(t.rolledOver?'已流转 · ':'')+t.text+pomodoros,()=>this.plugin.open(t.path),'os-quiet');}if(!tasks.length)el(parent,'p','os-muted','暂无');}
    // 闭环 B 的反馈侧：估过的任务实际花了多少。没有估过的任务就不显示这一行——
    // 显示一个 0/0 比不显示更糟。
    const accuracy=estimateAccuracy(report.done);
    if(accuracy){
      const diff=accuracy.actual-accuracy.estimated;
      const verdict=diff===0?'刚好':diff>0?`超出 ${diff} 个`:`提前 ${-diff} 个`;
      el(done,'p','os-muted',`${accuracy.tasks} 件估过的事：估了 ${accuracy.estimated} 个番茄，实际 ${accuracy.actual} 个 · ${verdict}`);
    }
    btn(pending,'流转到次日',async()=>{await this.plugin.rolloverDaily(key);await this.refresh(true);},'os-quiet');
    const outputs=card(`今日产出 · ${report.outputs.length}`);for(const f of report.outputs)btn(outputs,f.basename,()=>this.plugin.open(f.path),'os-quiet');if(!report.outputs.length)el(outputs,'p','os-muted','暂无产出笔记');
    const file=await this.plugin.daily(dateForDay(key).getTime());const fm=this.plugin.app.metadataCache.getFileCache(file)?.frontmatter||{};
    const cognition=card('洞察与阻力'),tomorrow=card('状态与明日');
    for(const [field,label,parent] of [['aha','一句话洞察',cognition],['friction','卡点 / 阻力',cognition],['energy','能量 1–5',tomorrow],['attention','专注 1–5',tomorrow]]){const wrap=el(parent,'label','os-audit-field');el(wrap,'span','',label);const value=input(wrap,'',fm[field]||'');value.setAttribute('aria-label',label);if(['energy','attention'].includes(field)){value.type='number';value.min=1;value.max=5;}value.onchange=()=>this.plugin.saveDailyFeedback(file,field,value.value).catch(e=>new Notice(e.message));}
    const one=el(tomorrow,'select','os-input');one.setAttribute('aria-label','次日第一要务');el(one,'option','','次日第一要务').value='';const options=this.snapshot.allTasks.filter(t=>!t.done&&!t.deleted);options.forEach((t,i)=>{const o=el(one,'option','',t.text);o.value=String(i);o.selected=t.id===fm.tomorrow_task_id;});one.onchange=async()=>{if(one.value==='')return;try{await this.plugin.setTomorrow(key,options[Number(one.value)]);new Notice('已锁定次日第一要务');}catch(e){new Notice(e.message);}};
  }
  renderTasks() {
    const panel = this.panel(this.content,'行动清单','','os-fill');
    btn(panel.tools,'大项目 →',()=>this.setTab('projects'),'os-quiet');
    const toolbar=el(panel.panel,'div','os-toolbar');panel.panel.insertBefore(toolbar,panel.body);
    const quick=el(toolbar,'form','os-quick-task');const text=input(quick,'添加今日任务，Enter 设置番茄数');const add=el(quick,'button','os-button','添加');add.type='submit';quick.onsubmit=async e=>{e.preventDefault();if(add.disabled)return;add.disabled=true;try{await this.flushEdits();this.owner('codex-capture').captureTask({quick:true,title:text.value,onSaved:()=>{text.value='';this.refresh(true).catch(console.error);}});}catch(error){new Notice(error.message);}finally{add.disabled=false;}};
    const tabs=el(toolbar,'div','os-segments');
    for (const [id,label] of [['open','待办'],['today','今天'],['overdue','逾期'],['done','已完成'],['deleted','已删除']]) btn(tabs,label,()=>{this.filter=id;this.listPage=0;return this.refresh(true);},this.filter===id?'is-active':'');
    const draw = async()=>{
      const query=this.query,filter=this.filter;
      await this.flushEdits();
      const tasks=await this.owner('codex-capture')?.listTasks?.({filter,query})||[];
      if (query!==this.query||filter!==this.filter) return;
      if (!panel.body.isConnected && panel.body.isConnected!==undefined) return;
      panel.body.replaceChildren();this.editors.clear();this.taskRows.clear(); if (!tasks.length) this.empty(panel.body,'没有匹配的行动','直接添加任务，或调整筛选条件。');
      this.pageRows(panel.body,tasks,t=>this.taskRow(panel.body,t));
    };
    this.search(toolbar,'搜索任务或来源笔记',draw); draw().catch(console.error);
  }
  renderStudy() {
    const captions={courses:['课程','九门课与关联教材'],books:['教材','全库 PDF 检索'],questions:['待解疑问','批注里还没想通的地方']};
    const [heading,overline]=captions[this.studyMode]||captions.courses;
    const panel=this.panel(this.content,heading,overline,'os-fill');
    const toolbar=el(panel.panel,'div','os-toolbar');panel.panel.insertBefore(toolbar,panel.body);
    const draw=()=>{
      panel.body.replaceChildren();const q=this.query.trim().toLowerCase();
      if (this.studyMode==='courses') {
        const grid=el(panel.body,'div','os-course-grid');
        for (const c of this.plugin.courseCatalog().filter(c=>`${c.title} ${c.italian} ${c.id}`.toLowerCase().includes(q))) {
          const state=this.plugin.courseStateFor(c),books=this.plugin.courseBooksFor(c),stats=this.plugin.courseStatsFor(c);
          const card=el(grid,'article','os-course');el(card,'p','os-overline',`${c.id} · 第 ${c.semester} 学期 · ${c.credits} 学分`);el(card,'h3','',c.title);
          el(card,'p','os-course-next',state.next||'写下这门课的下一步');
          const meta=el(card,'div','os-row-meta');el(meta,'span','',`${books.length} 份教材`);el(meta,'span','',`${stats.minutes} 分钟 / 本周`);if(state.exam)el(meta,'span','','考试 '+state.exam);
          const actions=el(card,'div','os-course-actions');btn(actions,books.length?'打开教材':'关联教材',()=>this.plugin.startCourse(c),'os-primary');
          btn(actions,'笔记',()=>this.plugin.openCourse(c),'os-quiet');btn(actions,'设置',()=>this.plugin.configureCourse(c),'os-quiet');
        }
        if(!grid.children.length)this.empty(panel.body,'没有匹配的课程');
      } else if(this.studyMode==='books') {
        const books=this.snapshot.files.filter(f=>f.extension==='pdf'&&f.path.toLowerCase().includes(q));
        if(!books.length)this.empty(panel.body,'还没有匹配的教材','将 PDF 放入库中，或缩短搜索关键词。');
        this.pageRows(panel.body,books,file=>{const row=el(panel.body,'div','os-file-row');const d=el(row,'div','os-row-main');el(d,'strong','',file.basename);el(d,'p','os-muted',file.path);btn(row,'阅读',()=>this.plugin.openTextbook(file),'os-quiet');});
      } else {
        let count=0;
        for (const [path,r] of Object.entries(this.plugin.study?.data?.records||{})) for(const a of r.annotations||[]) if(a.kind==='question'&&!a.resolved&&`${path} ${a.note} ${a.text}`.toLowerCase().includes(q)) {
          count++;const row=el(panel.body,'div','os-file-row');const d=el(row,'div','os-row-main');el(d,'strong','',a.note||a.text||'未命名疑问');el(d,'p','os-muted',`${title(path)} · 第 ${a.page||1} 页`);
          btn(row,'查看',()=>this.plugin.study.overview(path),'os-quiet');btn(row,'转为行动',async()=>{await this.plugin.addPlan('解决：'+(a.note||a.text||'教材疑问'),{path,page:a.page||1});new Notice('已加入今天');},'os-quiet');
        }
        if(!count)this.empty(panel.body,this.plugin.study?'没有待解疑问':'学习插件未启用','在 PDF 批注中标记疑问，会出现在这里。');
      }
    };
    this.search(toolbar,'搜索课程、教材或疑问',draw);draw();
  }
  renderHeatmap() {
    const heat = this.snapshot.heatmap;
    const todayKey = dayKey();
    const today = heat.days.find(day => day.key === todayKey) || {key:todayKey,seconds:0,minutes:0,count:0,sessions:[],level:0};
    const selected = heat.days.find(day => day.key === this.heatmapDay) || today;
    this.heatmapDay = selected.key;

    const summary = el(this.content,'div','os-heat-summary');
    for (const [value,label] of [[today.count,'今日番茄'],[durationLabel(today.seconds),'今日时长'],[heat.totalSessions,'近12周番茄'],[heat.activeDays,'有记录天数']]) {
      const metric = el(summary,'div'); el(metric,'strong','',String(value)); el(metric,'span','',label);
    }

    const layout = el(this.content,'div','os-heat-layout');
    const chart = this.panel(layout,'学习热力','近 12 周专注节奏','os-heatmap-panel');
    el(chart.body,'p','os-heatmap-caption',`颜色按每日专注总时长加深，共 ${heat.totalSessions} 个番茄钟；点击任意日期查看时段。`);
    const heatmapLine = el(chart.body,'div','os-heatmap-line');
    const weekdays = el(heatmapLine,'div','os-heatmap-weekdays');
    for (const label of ['一','','三','','五','','日']) el(weekdays,'span','',label);
    const chartWrap = el(heatmapLine,'div','os-heatmap-chart-wrap');
    const months = el(chartWrap,'div','os-heatmap-months');
    months.style.gridTemplateColumns = `repeat(${heat.weeks}, minmax(0, 1fr))`;
    let previousMonth = '';
    for (let week = 0; week < heat.weeks; week++) {
      const first = heat.days[week * 7];
      const month = first?.key?.slice(0, 7) || '';
      const label = month && month !== previousMonth ? `${dateForDay(first.key).getMonth() + 1}月` : '';
      el(months,'span','',label); previousMonth = month;
    }
    const grid = el(chartWrap,'div','os-heatmap-grid');
    grid.style.gridTemplateColumns = `repeat(${heat.weeks}, minmax(0, 1fr))`;
    for (const [index, day] of heat.days.entries()) {
      const cell = btn(grid,'',()=>{this.heatmapDay=day.key;return this.refresh(true);},`os-heatmap-cell os-heat-level-${day.level}${day.key===selected.key?' is-selected':''}`);
      cell.style.gridColumn = String(Math.floor(index / 7) + 1); cell.style.gridRow = String(index % 7 + 1);
      cell.title = dayTooltip(day); cell.setAttribute('aria-label',dayTooltip(day));
      if (day.key > todayKey) { cell.classList.add('is-future'); cell.disabled = true; }
    }
    const legend = el(chart.body,'div','os-heatmap-legend');
    el(legend,'span','os-muted','少');
    for (const level of [0,1,2,3,4]) el(legend,'i',`os-heat-swatch os-heat-level-${level}`);
    el(legend,'span','os-muted','多');

    const detail = this.panel(layout,this.heatmapAll?'全部专注记录':'当日记录',this.heatmapAll?'按结束时间倒序':'番茄钟时段与时长','os-heat-detail');
    btn(detail.tools,'今天',()=>{this.heatmapAll=false;this.heatmapDay=todayKey;return this.refresh(true);},'os-quiet');
    btn(detail.tools,this.heatmapAll?'看这一天':'全部记录',()=>{this.heatmapAll=!this.heatmapAll;this.listPage=0;return this.refresh(true);},'os-quiet');
    if (this.heatmapAll) {
      const all = [...this.plugin.data.sessions].filter(s => s.phase === 'focus').sort((a,b) => b.endedAt - a.endedAt);
      if (!all.length) { this.empty(detail.body,'还没有专注记录','完成一段专注后，这里会按时间倒序列出全部番茄钟。'); return; }
      el(detail.body,'p','os-overline',`共 ${all.length} 个番茄钟`);
      this.pageRows(detail.body,all,s => {
        const row = el(detail.body,'div','os-file-row');
        const copy = el(row,'div','os-row-main'); el(copy,'strong','',s.task);
        el(copy,'p','os-muted',`${dayLabel(dayKey(s.endedAt))} · ${sessionRange(s)}`);
        el(row,'span','os-tag',`${durationLabel(s.seconds)} · ${s.completed?'完成':'提前结束'}`);
      });
      return;
    }
    el(detail.body,'p','os-overline',selected.key);
    el(detail.body,'h3','os-heat-day-title',dayLabel(selected.key));
    const dayStats = el(detail.body,'div','os-heat-day-stats');
    for (const [value,label] of [[selected.count,'番茄钟'],[durationLabel(selected.seconds),'总时长']]) {
      const metric = el(dayStats,'div'); el(metric,'strong','',String(value)); el(metric,'span','',label);
    }
    if (!selected.sessions.length) {
      this.empty(detail.body,'这天还没有番茄钟','完成一段专注后，这里会显示开始—结束时段和实际时长。');
      return;
    }
    const sessions = el(detail.body,'div','os-heat-session-list');
    for (const session of selected.sessions) {
      const row = el(sessions,'div','os-heat-session');
      const time = el(row,'div','os-heat-session-time'); el(time,'strong','',sessionRange(session)); el(time,'span','os-tag',durationLabel(session.seconds));
      const copy = el(row,'div','os-row-main'); el(copy,'strong','',session.task); el(copy,'p','os-muted',session.completed?'完整完成':'提前结束');
    }
  }
  renderKnowledge() {
    const panel=this.panel(this.content,'笔记库','','os-fill');
    btn(panel.tools,'新建笔记',()=>this.owner('codex-capture').createNote(),'os-primary');
    btn(panel.tools,'随手记',()=>this.plugin.captureNote(),'os-quiet');
    const toolbar=el(panel.panel,'div','os-toolbar');panel.panel.insertBefore(toolbar,panel.body);
    panel.body.classList.add('os-knowledge-body');
    const list=el(panel.body,'div','os-note-list');list.dataset.scroll='notes';list.tabIndex=0;
    const detail=el(panel.body,'div','os-note-detail');detail.dataset.scroll='preview';detail.tabIndex=0;
    const select=async file=>{
      this.selectedPath=file.path;const selected=file.path;detail.replaceChildren();panel.body.classList.add('has-selection');
      btn(detail,'← 返回列表',()=>{panel.body.classList.remove('has-selection');this.selectedPath='';},'os-mobile-back os-quiet');
      el(detail,'h2','',file.basename);el(detail,'p','os-muted',file.path);
      const actions=el(detail,'div','os-detail-actions');btn(actions,'打开笔记 ↗',()=>this.plugin.open(file.path),'os-primary');
      const capture=this.owner('codex-capture');
      btn(actions,'标记完成',async()=>{await capture.updateNote(file,'done');new Notice('笔记已完成');},'os-quiet');
      btn(actions,'置为待办',async()=>{await capture.updateNote(file,'reopen');new Notice('笔记已置为待办');},'os-quiet');
      btn(actions,'删除笔记',async()=>{await capture.updateNote(file,'delete');this.selectedPath='';await this.refresh(true);new Notice('笔记已移入回收站');},'os-quiet');
      const recall=this.owner('codex-recall');const add=btn(actions,'加入复习',async()=>{await recall.add(file.path);new Notice('已加入间隔复习');},'os-quiet');add.disabled=!recall;
      const excerpt=el(detail,'pre','os-excerpt','正在读取…');
      try {const text=await this.plugin.app.vault.cachedRead(file);if(this.selectedPath===selected)excerpt.textContent=previewText(text,file.basename)||'这篇笔记暂时为空。';} catch(e){excerpt.textContent='读取失败：'+e.message;}
      const links=this.plugin.app.metadataCache?.resolvedLinks?.[file.path]||{};
      const backlinks=Object.entries(this.plugin.app.metadataCache?.resolvedLinks||{}).filter(([,targets])=>targets[file.path]);
      el(detail,'h3','','关联笔记');
      for(const path of [...new Set([...Object.keys(links),...backlinks.map(([p])=>p)])].slice(0,12))btn(detail,title(path),()=>this.plugin.open(path),'os-related os-quiet');
      if(!Object.keys(links).length&&!backlinks.length)el(detail,'p','os-muted','暂无双向链接。');
    };
    const draw=()=>{
      list.replaceChildren();const q=this.query.toLowerCase().trim();
      const files=this.snapshot.notes.filter(f=>{
        const fm=this.plugin.app.metadataCache?.getFileCache?.(f)?.frontmatter||{};
        return `${f.path} ${JSON.stringify(fm.tags||[])}`.toLowerCase().includes(q);
      }).sort((a,b)=>(b.stat?.mtime||0)-(a.stat?.mtime||0));
      if(!files.length)this.empty(list,'没有匹配的笔记');
      this.pageRows(list,files,f=>{const row=btn(list,'',()=>select(f),'os-note-row');el(row,'strong','',f.basename);el(row,'span','os-muted',f.path);const fm=this.plugin.app.metadataCache?.getFileCache?.(f)?.frontmatter; if(fm?.status)el(row,'span','os-tag',fm.status==='done'?'已完成':fm.status==='todo'?'待办':String(fm.status));});
    };
    this.search(toolbar,'搜索笔记路径或标签',draw);draw();
    const selected=this.snapshot.notes.find(f=>f.path===this.selectedPath);
    if(selected)select(selected);else this.empty(detail,'选择一篇笔记','预览内容、查看关联笔记，或加入间隔复习。');
  }
  renderRecall() {
    const panel=this.panel(this.content,'间隔复习','','os-fill');
    btn(panel.tools,'写今日复盘',()=>this.plugin.openDaily(),'os-quiet');
    const toolbar=el(panel.panel,'div','os-toolbar');panel.panel.insertBefore(toolbar,panel.body);
    const segments=el(toolbar,'div','os-segments');
    for(const [id,label] of [['due','到期复习'],['all','全部队列']])btn(segments,label,()=>{this.reviewMode=id;this.listPage=0;return this.refresh(true);},(this.reviewMode||'due')===id?'is-active':'');
    const recall=this.owner('codex-recall');if(!recall){this.empty(panel.body,'复习插件未启用','请启用 Codex 间隔复习，再从知识页添加笔记。');return;}
    const cards=this.snapshot.cards.filter(c=>this.reviewMode==='all'||c.due<=Date.now());
    if(!cards.length){this.empty(panel.body,'这一轮完成了','从知识页整篇加入笔记，或在读 PDF 时把某张卡片加入队列。');btn(panel.body,'去选择笔记',()=>this.setTab('knowledge'),'os-primary');}
    // 队列里现在有两种东西：整篇笔记，和 codex-study 的卡片。
    // key 是调度键，path 是它所在的文件——卡片两者不同，操作一律用 key。
    const study=this.owner('codex-study');
    this.pageRows(panel.body,cards,c=>{
      const card=c.cardId?study?.findCard?.(c.path,c.cardId):null;
      const row=el(panel.body,'div','os-file-row');const d=el(row,'div','os-row-main');
      el(d,'strong','',card?card.title:title(c.path));
      const meta=el(d,'div','os-row-meta');
      if(c.cardId)el(meta,'span','os-chip',card?(card.kind||'卡片'):'卡片已删除');
      el(meta,'span','os-chip',`${c.reviews||0} 次复习`);
      el(meta,'span','os-chip',c.due<=Date.now()?'现在到期':`${new Date(c.due).toLocaleDateString('zh-CN')} 到期`);
      el(meta,'span','os-chip',`间隔 ${c.interval||0} 天`);
      btn(row,'开始回忆',()=>recall.review(c.key),'os-primary');
      btn(row,'移出队列',async()=>{await recall.remove(c.key);await this.refresh(true);},'os-quiet');});
  }
  showModules() {
    const modal=new Modal(this.plugin.app);modal.onOpen=()=>{
      // 五个模块锁步同一个版本号，所以只显示一个。此前逐个读 owner.manifest.version
      // 显示五个数字，那是它们各自漂移时代的遗留；兜底字面量 '5.4.0' 也早已过期。
      const version=this.plugin.manifest?.version || '';
      modal.contentEl.classList.add('os-modules','os-modules-modal');el(modal.contentEl,'h2','',`Learning OS ${version}`);el(modal.contentEl,'p','','模块可以单独停用，版本随整体发布。');
      for(const [id,label] of MODULES){const owner=this.owner(id);const row=el(modal.contentEl,'div','os-file-row');el(row,'strong','',label);el(row,'span','',owner?'已启用':'未启用');}
      btn(modal.contentEl,'打开版本迭代',()=>{modal.close();return this.plugin.openVersionLog();},'os-primary');
      el(modal.contentEl,'p','os-muted',`导航快捷键：${NAV.map(([,label],i)=>`Alt+${i+1} ${label}`).join(' · ')}。可在 Obsidian 快捷键设置中搜索「Codex 工作台：切换到」改键。窄窗口用页内切换查看行动或专注，列表可单独滚动。`);
    };modal.open();
  }
}
module.exports = {ConsoleView, NAV, LEAF_LABELS, LEAVES};
