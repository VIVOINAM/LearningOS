"use strict";
const {renderSummaries,summaryRevision}=require('./summary-view');
const {renderKnowledge}=require('./knowledge-view');
const {renderKnowledgeMap,renderOutcomes,knowledgeRevision}=require('./learning-hub-view');
const {renderQuiz}=require('./quiz-view');
const {renderOwnBooks}=require('./own-books-view');
const {DetailModal}=require('./detail-modal');
const {el, btn: domBtn}=require('../shared/dom');
const {budget}=require('./budget');
const {ItemView, Modal, Notice, setIcon} = require('obsidian');
const {dueState} = require('./due');
const {renderMarkdown,markdownOwner} = require('../l-os-study/core/markdown-render');
const {toObsidianMarkdown,changesOnPaste} = require('../l-os-study/core/formula-model');
const TT = require('./timetable-model');
const CL = require('./class-ledger');
const {dayKey, focusSnapshot, studySnapshot, heatmapData, taskPresentation, rankTodayTasks} = require('./console-model');
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
  // 自编教材紧跟学习：教材页是全库 PDF 检索，这一页只管自己写的书——写到哪、按哪份计划写。
  ['ownbooks','自编教材','book-marked',['ownbooks']],
  ['summaries','总结笔记','notebook-pen',['summaries']],
  ['knowledge','知识地图','network',['knowledge']],
  // 周五自测和知识地图平级：答题结果写回地图的掌握度，两者一来一回。
  ['quiz','周五自测','clipboard-check',['quiz']],
  ['outcomes','学习进展','lightbulb',['outcomes','recall']],
  // 学习热力原来是回顾里的第二段，7.4 并进课堂回顾那一页的下半截，回顾只剩一页。
  ['review','回顾','flame',['daily']],
  // 课表排在最后而不是紧挨今日：前五项的 Alt+1–5 用了一个多月，插在中间会把
  // 后面三个键全部挪一位。一个新入口的代价不该由已经练熟的手指来付。
  ['schedule','课表','calendar-days',['schedule']],
];
// 分段标签。顶层入口的名字是「行动」，进去之后第一段叫「任务清单」——
// 同一个 id 在两处的措辞不同是故意的：一个回答「去哪」，一个回答「看什么」。
const LEAF_LABELS = {
  today:'今日', tasks:'行动清单', projects:'大项目',
  courses:'课程', books:'教材', questions:'待解疑问',
  ownbooks:'自编教材',
  summaries:'总结笔记',
  knowledge:'知识地图', quiz:'周五自测', outcomes:'学习进展', library:'资料索引', recall:'间隔复习',
  daily:'回顾',
  schedule:'课表',
};
const LEAVES = [...NAV.flatMap(([,,,ids]) => ids),'library'];
// 快捷键按 id 固定，不按侧栏顺序：新入口插在中间，已经练熟的 Alt+1–9 一个都不挪。
const NAV_KEYS={today:1,tasks:2,learn:3,knowledge:4,review:5,schedule:6,summaries:7,outcomes:8,quiz:9,ownbooks:0};
const PARENT_OF = new Map(NAV.flatMap(([nav,,,ids]) => ids.map(id => [id, nav])));
PARENT_OF.set('library','learn');
const SECTIONS_OF = new Map(NAV.map(([nav,,,ids]) => [nav, ids]));
/** 顶层入口的 id 也接受：落到它的第一个分段。 */
// 并掉的分段：旧 id（存下来的 consoleTab、链接、命令）落到它并进去的那一页。
const MERGED = {heatmap:'daily'};
const resolveTab = (id) => (SECTIONS_OF.has(id) ? SECTIONS_OF.get(id)[0] : MERGED[id] || id);
// 学习页的三个分段直接对应三个 tab，renderStudy 仍按 studyMode 分支。
// 课表时段的身份。同一门课同一天可以有两节（周一的数学分析），所以要带上开始时间和教室。
const classKey = (slot) => `${slot.day}-${slot.start}-${slot.course.id}-${slot.room}`;
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
const MODULES = [['l-os-capture','行动与捕获'],['l-os-focus','专注计时'],['l-os-study','PDF 学习'],['l-os-recall','间隔复习'],['l-os-workbench','工作台']];
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
  getViewType() { return 'l-os-workbench'; }
  getDisplayText() { return 'Learning OS'; }
  getIcon() { return 'layout-dashboard'; }
  owner(id) { return this.plugin.app.plugins.getPlugin(id); }
  async onOpen() {
    this.closed = false; this.plugin.views.add(this); this.renderShell();
    this.registerEvent(this.plugin.app.workspace.on('learningos:focus-changed', () => this.refresh().catch(console.error)));
    this.registerEvent(this.plugin.app.workspace.on('l-os-recall:changed', () => this.refresh().catch(console.error)));
    this.registerEvent(this.plugin.app.workspace.on('l-os-capture:changed', () => this.refresh().catch(console.error)));
    this.registerEvent(this.plugin.app.workspace.on('l-os-focus:changed', () => this.refresh().catch(console.error)));
    this.registerEvent(this.plugin.app.workspace.on('l-os-focus:finished', () => this.refresh().catch(console.error)));
    if(this.plugin.app.metadataCache?.on)this.registerEvent(this.plugin.app.metadataCache.on('changed',file=>{if(this.tab==='summaries'&&file.path.includes('/课堂笔记/'))this.refresh().catch(console.error);if(this.tab==='ownbooks'&&(file.path==='04 创作/自编教材.md'||file.path.startsWith('02 项目/')))this.refresh().catch(console.error);}));
    await this.refresh();
  }
  async onClose() { this.outcomeCleanup?.();this.outcomeCleanup=null;this.knowledgeCleanup?.();this.knowledgeCleanup=null;this.quizCleanup?.();this.quizCleanup=null; this.summaryCleanup?.();this.summaryCleanup=null; this.heatObserver?.disconnect(); this.closed = true; ++this.generation; this.plugin.views.delete(this); if(this.quickNotesTimer){clearTimeout(this.quickNotesTimer);await this.plugin.save().catch(console.error);} clearTimeout(this.quickNotesPreviewTimer); this.quickNotesOwner?.unload?.(); for (const mount of this.widgetMounts || []) mount.destroy?.(); this.widgetMounts = []; this.widgetMount = null; clearTimeout(this.searchTimer); clearTimeout(this.blurTimer); }
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
      case 'daily': {
        const n = s.timetable ? CL.noteCourseIds(s.timetable).size : 0;
        return [n ? `${n} 门课记笔记` : '', `本周专注 ${s.focus?.weekMinutes || 0} 分钟`].filter(Boolean).join(' · ');
      }
      case 'schedule': {
        const t = s.timetable;
        if (!t) return '还没有课表';
        const anchor = TT.addDays(new Date(), 7 * (this.scheduleWeek || 0));
        const week = TT.weekView(t.slots, anchor);
        const n = TT.weekNumber(t.slots, anchor);
        const minutes = week.days.flatMap(d => d.items).reduce((sum, {slot}) => sum + TT.minutes(slot.end) - TT.minutes(slot.start), 0);
        const [y1, y2] = String(t.meta.academic_year || '').split('-');
        const term = y1 && y2 ? `${y1}/${y2.slice(2)} 第${['', '一', '二'][Number(t.meta.semester)] || t.meta.semester}学期` : '';
        return [term, n ? `第 ${n} 周` : '学期外', week.count ? `${week.count} 节课 · ${+(minutes / 60).toFixed(1)} 小时` : '这周没有课'].filter(Boolean).join(' · ');
      }
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
    // 哪个挂件去哪一块由 l-os-widgets 的设置决定，工作台只负责提供地方。
    this.widgetTop = el(rail, 'div', 'os-widgets os-widgets-top');
    const nav = el(rail, 'nav', 'os-nav'); nav.setAttribute('aria-label', '工作台导航'); this.nav = new Map();
    // 五项，不再需要分组标题——十项才需要。
    for (const [id, label, icon] of NAV) {
      const b = btn(nav, '', () => this.setTab(id), 'os-nav-button'); b.title = label;
      const mark = el(b, 'span', 'os-icon'); setIcon?.(mark, icon); el(b, 'span', 'os-nav-label', label); this.nav.set(id,b);
    }
    // 导航和底部按钮之间那段空白是布局逼出来的：nav 撑开、foot 贴底，中间永远空着。
    // 6.4 把它交给 l-os-widgets。插件没装就什么都不发生——这块 div 保持 hidden，
    // 空白回到 6.3 的样子：工作台不因为少一个可选插件而少一块功能。
    this.widgetHost = el(rail, 'div', 'os-widgets os-widgets-bottom');
    const foot = el(rail, 'div', 'os-rail-foot');
    // 7.4 拿掉了「＋ 快速捕获」：独立笔记另有命令，左栏底部只留模块信息。
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
    // 挂件设置从左栏挪到右上角：左栏那个入口要鼠标移进去才浮出来，而且占着挂件区的一行。
    // 放在最右端，只画齿轮——它是设置，不是常用操作，不该和「新任务」一样宽。
    this.widgetGear = btn(actions, '', () => this.owner('l-os-widgets')?.openSettings?.(), 'os-quiet os-header-gear');
    this.widgetGear.setAttribute('aria-label', '挂件设置'); this.widgetGear.title = '挂件设置';
    setIcon?.(el(this.widgetGear, 'span', 'os-icon'), 'settings');
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
   * 左栏挂件。l-os-widgets 负责内容，工作台只负责给它一块地方和一个生命周期。
   * 插件停用、或者根本没装，这里拿到 undefined，容器 hidden，左栏和 6.3 一样。
   */
  mountWidgets() {
    for (const mount of this.widgetMounts || []) mount.destroy?.();
    const widgets = this.owner('l-os-widgets');
    const mounts = [
      [this.widgetTop, 'top'],
      [this.widgetHost, 'bottom'],
      [this.widgetHeader, 'header'],
    ].map(([host, slot]) => {
      const mount = widgets?.renderRail?.(host, {slot}) || null;
      // 只判断「插件在不在」。空不空是渲染结果，会随设置变，而设置改动只走
      // l-os-widgets 自己的 repaint()，工作台不会被通知——所以那件事交给 CSS：
      // 挂件区空的时候带 data-empty，样式表按它收起来。
      host.hidden = !mount;
      return mount;
    }).filter(Boolean);
    this.widgetMounts = mounts;
    this.widgetMount = mounts[0] || null;
    if (this.widgetGear) this.widgetGear.hidden = !widgets?.openSettings;
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
    this.scheduleWeek = 0; this.scheduleSelected = '';
    this.plugin.data.consoleTab = this.tab;
    await this.plugin.save(); await this.refresh(true);
  }
  async refresh(force = false) {
    if (this.closed || !this.content) return;
    // 自测的选项、输入和计时属于当前题面。后台的文件/专注事件不能
    // 清空它并重新排版公式；切题、返回课程和手动刷新均显式传 force。
    // quizCleanup 在异步读取题库前已建立，也保护仍在加载中的题面。
    if (!force && this.tab === 'quiz' && this.quizCleanup) return;
    const notesRevision=this.tab==='summaries'?summaryRevision(this):null;
    if(!force&&notesRevision!==null&&this.renderedSummaryRevision===notesRevision&&this.content.classList.contains('os-page-summaries'))return;
    const mapRevision=this.tab==='knowledge'?knowledgeRevision(this):null;
    if(!force&&mapRevision!==null&&this.renderedMapRevision===mapRevision&&this.content.classList.contains('os-page-knowledge'))return;
    if(force)await this.flushEdits();
    if(!force&&[...this.editors].some(e=>e.open)){this.dirty=true;return;}
    const active = document.activeElement;
    if (!force && this.content.contains?.(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active?.tagName)) { this.dirty = true; return; }
    const request = ++this.generation;
    const scroll = [...this.content.querySelectorAll('[data-scroll]')].map(e => [e.dataset.scroll,e.scrollTop]);
    const p = this.plugin; p.bindOwners?.();
    // 挂件插件可能在工作台开着的时候被启用或停用。只在「有没有」变了的时候重挂，
    // 每次 refresh 都重建的话，设置弹窗里刚改的顺序会在下一次刷新时闪一下。
    if (!!this.widgetMount !== !!this.owner('l-os-widgets')) this.mountWidgets();
    const capture = this.owner('l-os-capture');
    const [tasks, stats] = await Promise.all([capture?.listTasks?.({filter:this.filter,query:this.tab === 'tasks' ? this.query : ''}) || [], capture?.taskStats?.() || {open:0,done:0}]);
    const todayTasks = await capture?.listTasks?.({filter:'today'}) || [];
    const allTasks=await capture?.index?.all?.()||tasks;
    this.focusId=await p.focusSelection?.read?.()||'';
    // 课表只有今日、课表和课堂回顾三页要用。解析结果按修改时间缓存在插件上，这里只是取。
    const timetable = ['today','schedule','daily'].includes(this.tab)
      ? await Promise.resolve(p.timetable?.()).catch(error => { console.error(error); return null; }) : null;
    if (request !== this.generation || this.closed) return;
    const files = p.app.vault.getFiles?.() || [];
    this.snapshot = {allTasks,tasks, todayTasks, stats, files, notes:files.filter(noteFile), focus:focusSnapshot({sessions:p.data.sessions,timer:p.data.timer}), heatmap:heatmapData(p.data.sessions), study:studySnapshot(p.study?.data || {}), cards:this.owner('l-os-recall')?.list?.() || [], timetable};
    this.titleEl.textContent = LEAF_LABELS[this.tab] || '今日';
    this.pageStatusEl.textContent = this.pageStatus();
    const parent = PARENT_OF.get(this.tab);
    for (const [id,b] of this.nav) { b.classList.toggle('is-active', id === parent); b.setAttribute('aria-current', id === parent ? 'page' : 'false'); }
    this.renderSections(parent);
    // 今日页的数据刷新复用专注面板，避免拆掉正在播放的圆环与读数。
    const keepFocus = this.tab === 'today' && this.focusPanel?.isConnected && this.focusPanelOwner === this.owner('l-os-focus');
    if (!keepFocus) { this.focusPanel = null; this.timerEl = null; }
    this.outcomeCleanup?.();this.outcomeCleanup=null;this.knowledgeCleanup?.();this.knowledgeCleanup=null;this.quizCleanup?.();this.quizCleanup=null;this.summaryCleanup?.();this.summaryCleanup=null;this.heatObserver?.disconnect();this.heatObserver=null;
    this.content.className = `os-content os-page-${this.tab}`; this.content.replaceChildren();this.editors.clear();this.taskRows.clear();this.focusCard=null;
    this.statusEl.textContent = `${stats.open} 项待办 · ${this.snapshot.cards.filter(c => c.due <= Date.now()).length} 篇待复习`;
    if (!capture?.listTasks) this.statusEl.textContent = '行动索引未启用 · 在模块与版本中检查插件';
    switch (this.tab) {
      case 'projects': this.renderProjects(); break;
      case 'tasks': this.renderTasks(); break;
      case 'courses': case 'books': case 'questions': this.studyMode = STUDY_TABS[this.tab]; this.renderStudy(); break;
      case 'knowledge': await renderKnowledgeMap(this); break;
      case 'quiz': await renderQuiz(this); break;
      case 'outcomes': await renderOutcomes(this); break;
      case 'library': this.renderKnowledge(); break;
      case 'summaries': await renderSummaries(this); break;
      case 'ownbooks': await renderOwnBooks(this); break;
      case 'daily': await this.renderDaily(); break;
      case 'recall': this.renderRecall(); break;
      case 'schedule': this.renderSchedule(); break;
      default: this.renderToday();
    }
    if(request!==this.generation || this.closed)return;
    this.renderedMapRevision=this.tab==='knowledge'?mapRevision:null;
    this.renderedSummaryRevision=this.tab==='summaries'?notesRevision:null;
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
  async chooseFocus(task){
    const p=this.plugin,request=(p.focusRequest||0)+1,selectedDay=dayKey();p.focusRequest=request;
    p.focusPreview={day:selectedDay,task,message:'同步中…'};for(const v of p.views){for(const t of v.taskRows.keys())v.paintTask(t);}
    try{await this.flushEdits();if(p.focusRequest!==request)return;const stable=await p.focusSelection.select(task,selectedDay);Object.assign(task,stable);if(p.focusRequest===request){p.focusPreview=null;for(const v of p.views){v.focusId=stable.id;const known=v.snapshot?.allTasks?.find(t=>t.id===stable.id||t.raw===task.raw);if(known)Object.assign(known,stable);else v.snapshot?.allTasks?.push(stable);for(const t of v.taskRows.keys())v.paintTask(t);}}}
    catch(e){if(p.focusRequest===request){p.focusPreview=null;for(const v of p.views){for(const t of v.taskRows.keys())v.paintTask(t);}}throw e;}
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
    await this.owner('l-os-capture').deleteProject(file);
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
    const createName=input(createRow,'新项目名称');btn(createRow,'创建项目',async()=>{const file=await this.owner('l-os-capture').createProject(createName.value);createName.value='';projects.push(file);el(select,'option','',file.basename).value=String(projects.length-1);select.value=String(projects.length-1);await load();},'os-quiet');
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
      const fm=await this.owner('l-os-capture').readProject(file);
      const values={};
      const titleWrap=el(fields,'label','os-editor-field');el(titleWrap,'span','', '项目名称');values.name=input(titleWrap,'项目名称',file.basename);
      for(const [key,label]of [['goal','项目目标'],['next','项目下一步'],['due','项目截止日期']]){const wrap=el(fields,'label','os-editor-field');el(wrap,'span','',label);values[key]=input(wrap,label,fm[key]||'');if(key==='due')values[key].type='date';}
      const status=el(fields,'span','os-save-state','修改后自动保存');let saved={name:file.basename,goal:fm.goal||'',next:fm.next||'',due:fm.due||''},queue=Promise.resolve();
      if(editor)this.editors.delete(editor);
      editor={open:true,flush:()=>{const run=queue.then(async()=>{const next=Object.fromEntries(Object.entries(values).map(([k,e])=>[k,e.value]));if(JSON.stringify(next)===JSON.stringify(saved))return;status.textContent='保存中…';try{
        if(next.name!==saved.name){const renamed=await this.owner('l-os-capture').renameProject(activeFile,next.name);activeFile=renamed||activeFile;projects[index]=activeFile;select.options[index].textContent=activeFile.basename;saved.name=activeFile.basename;values.name.value=activeFile.basename;}
        const metadata={goal:next.goal,next:next.next,due:next.due};const before={goal:saved.goal,next:saved.next,due:saved.due};
        if(JSON.stringify(metadata)!==JSON.stringify(before)){await this.owner('l-os-capture').patchProject(activeFile,before,metadata);Object.assign(saved,metadata);}
        status.textContent='已保存到项目';
      }catch(e){status.textContent='未保存：'+e.message;throw e;}});queue=run.catch(()=>{});return run;}};this.editors.add(editor);
      for(const field of Object.values(values))field.onchange=()=>editor.flush().catch(()=>{});
      btn(fields,'重试保存',()=>editor.flush(),'os-quiet');
      btn(fields,'新增子任务',()=>this.owner('l-os-capture').captureTask({project:activeFile.path,scheduled:'backlog'}),'os-quiet');
    };
    select.onchange=()=>load().catch(e=>new Notice(e.message));
    const selectedIndex=projects.findIndex(file=>file.path===selectedPath);if(selectedIndex>=0){select.value=String(selectedIndex);load().catch(e=>new Notice(e.message));}
  }
  renderToday() {
    this.focusCard = null;
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
    el(intent,'p','os-overline','今日课程');
    this.renderCourseIntent(intent);
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
    this.renderTodayClasses(actionCol);
    const action = this.panel(actionCol,'下一步行动','按紧迫度排序：逾期、今天截止、考试临近的课','os-grow');
    btn(action.tools,'全部行动 →',()=>this.setTab('tasks'),'os-quiet');
    if (!this.snapshot.todayTasks.length) {
      this.empty(action.body,'今天还没有安排','新建任务，或到行动页把已有事项安排到今天。');
      btn(action.body,'安排一个行动',()=>this.plugin.captureTask(),'os-primary');
    }
    for (const task of ranked) this.taskRow(action.body,task,true);
  }
  renderCourseIntent(parent) {
    const timetable = this.snapshot.timetable;
    const agenda = timetable ? TT.todayAgenda(timetable.slots, new Date()) : [];
    if (!agenda.length) {
      el(parent,'p','os-course-intent-empty',timetable?'今天没有课':'尚未关联课表');
      btn(parent,'查看课表 →',()=>this.setTab('schedule'),'os-quiet');
      return;
    }
    const current = agenda.find(item=>item.state==='now') || agenda.find(item=>item.state==='next') || agenda.find(item=>item.state==='later') || agenda.at(-1);
    const course = current.slot.course;
    const distinct = new Set(agenda.map(item=>item.slot.course.id));
    el(parent,'strong','os-course-intent-title',course.title);
    el(parent,'p','os-course-intent-meta',`${current.slot.start}–${current.slot.end} · ${current.slot.room}${distinct.size>1?` · 今天共 ${distinct.size} 门课`:''}`);
    const actions = el(parent,'div','os-course-intent-actions');
    btn(actions,'课程笔记 →',()=>this.plugin.openCourse(course),'os-quiet');
    btn(actions,'打开教材',()=>this.plugin.startCourse(course),'os-quiet');
  }
  /**
   * 统计数据。三块读数加一张近 12 周的热力图。
   *
   * 读数原来挂在「今日要务」那张卡里，和「今天做哪一件」挤在一起。那张卡问的是
   * 一个决定，这三个数回答的是一次回顾——两件事不该共用一张卡，也不该共用一个标题。
   *
   * 热力图读的是同一份 snapshot.heatmap，和回顾页下半截的学习热力同源。
   * 这里只画格子，不做选中态：两处各存一份「当前选的是哪天」一定会漂，
   * 而这块的职责只是「最近在不在学」。点它跳到回顾页、滚到热力那一行，详情归那里。
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
    const mini = btn(stats.body,'',()=>{this.revealHeat=true;return this.setTab('daily');},'os-heat-mini');
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
      // 画出来的位置是假的，比不画更糟。totalPages 由 l-os-study 在打开 PDF 时写入。
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
  /**
   * 今日页「今天的课」。放在行动栏最上面：它和「下一步行动」回答的是同一个问题
   * （接下来做什么），只是一个由课表定、一个由自己定。
   * 没课的日子只剩一行，告诉你下一节在什么时候——不画一张空卡。
   */
  renderTodayClasses(parent) {
    this.todayClasses = null;
    const t = this.snapshot.timetable;
    if (!t) return;
    const card = this.panel(parent,'今天的课','','os-today-classes');
    btn(card.tools,'课表 →',()=>this.setTab('schedule'),'os-quiet');
    this.todayClasses = {card, t, colors:TT.palette(t.slots)};
    this.paintTodayClasses();
  }
  paintTodayClasses() {
    const state = this.todayClasses;
    if (!state?.card.panel.isConnected) return;
    const {card, t, colors} = state, now = new Date();
    const agenda = TT.todayAgenda(t.slots, now);
    card.body.replaceChildren();
    card.panel.classList.toggle('is-empty', !agenda.length);
    if (!agenda.length) {
      const next = TT.nextClass(t.slots, now);
      el(card.body,'p','os-class-none', next ? `今天没有课 · 下一节 ${TT.relative(next)} · ${next.slot.course.title}` : '今天没有课');
      return;
    }
    for (const {slot, state: when, startsIn, endsIn} of agenda) {
      // 点一行进这门课今天的课堂笔记（没有就建）。去课表的入口在卡头的「课表 →」。
      const row = btn(card.body,'',()=>this.plugin.openClassNote(slot.course),`os-class-row is-${when} is-c${colors.get(slot.course.id)}`);
      row.title = '打开今天的课堂笔记';
      const time = el(row,'span','os-class-row-time');
      el(time,'strong','',slot.start); el(time,'span','',slot.end);
      const main = el(row,'span','os-class-row-main');
      el(main,'strong','',slot.course.title);
      el(main,'span','',[slot.room, t.rooms[slot.room]?.address.split(' · ')[0]].filter(Boolean).join(' · '));
      if (when === 'now') el(row,'span','os-chip',`进行中 · 还剩 ${endsIn} 分`);
      else if (when === 'next') el(row,'span','os-chip is-warm',startsIn < 60 ? `${startsIn} 分钟后` : '下一节');
      row.setAttribute('aria-label',`${slot.start} 到 ${slot.end}，${slot.course.title}，教室 ${slot.room}${when==='done'?'，已结束':''}，打开课堂笔记`);
    }
  }
  /**
   * 课表页：左边一周的时间网格，右边「正在上 / 下一节」和本学期课程。
   *
   * 网格按分钟定位、按面板高度伸缩（每小时至少 40px，再矮就滚），
   * 互相重叠的课并排成几列而不是叠在一起——官方课表里本来就有重叠，
   * 画成叠在一起等于藏掉其中一节。
   */
  renderSchedule() {
    this.nowLine = null; this.classFocus = null;
    const t = this.snapshot.timetable;
    if (!t) {
      const card = this.panel(this.content,'还没有课表','','os-grow');
      this.empty(card.body,'库里还没有课表笔记','新建一篇笔记，frontmatter 写 type: timetable，正文放一张「星期 | 时间 | 课程 | 教室 | 起始日期 | 结束日期」的表格。改表格就是改课表。');
      return;
    }
    const now = new Date();
    this.scheduleWeek ||= 0;
    const anchor = TT.addDays(now, 7 * this.scheduleWeek);
    const week = TT.weekView(t.slots, anchor);
    const number = TT.weekNumber(t.slots, anchor);
    const colors = TT.palette(t.slots);
    const clashes = TT.conflicts(t.slots);
    const clashed = new Set(clashes.flatMap(c => [classKey(c.a), classKey(c.b)]));
    const layout = el(this.content,'div','os-schedule');

    const first = week.days[0].date, last = week.days[week.days.length - 1].date;
    const range = first.getMonth() === last.getMonth()
      ? `${first.getMonth()+1} 月 ${first.getDate()}–${last.getDate()} 日`
      : `${first.getMonth()+1} 月 ${first.getDate()} 日 – ${last.getMonth()+1} 月 ${last.getDate()} 日`;
    const board = this.panel(layout, number ? `第 ${number} 周` : '学期外', range, 'os-schedule-board');
    const step = (label, aria, offset) => { const b = btn(board.tools,label,()=>this.shiftWeek(offset),'os-quiet os-week-step'); b.setAttribute('aria-label',aria); return b; };
    step('‹','上一周',-1);
    const home = btn(board.tools,'本周',()=>this.shiftWeek(0),'os-quiet'); home.disabled = this.scheduleWeek === 0;
    step('›','下一周',1);

    const {first: h0, last: h1} = TT.hourRange(t.slots);
    const span = (h1 - h0) * 60;
    const grid = el(board.body,'div','os-week');
    grid.style.setProperty('--days', String(week.days.length));
    grid.style.setProperty('--hours', String(h1 - h0));
    el(grid,'span','os-week-corner');
    const todayKey = TT.keyOf(now);
    for (const day of week.days) {
      const head = el(grid,'div',`os-week-head${day.key === todayKey ? ' is-today' : ''}`);
      el(head,'span','os-week-weekday',day.label);
      el(head,'strong','os-week-date',String(day.date.getDate()));
    }
    const axis = el(grid,'div','os-week-axis');
    for (let h = h0; h <= h1; h++) el(axis,'span','os-week-hour',`${String(h).padStart(2,'0')}:00`).style.top = `${(h - h0) / (h1 - h0) * 100}%`;
    for (const day of week.days) {
      const col = el(grid,'div',`os-week-col${day.key === todayKey ? ' is-today' : ''}`);
      col.setAttribute('aria-label',`${day.label} ${day.items.length} 节课`);
      for (const {slot, lane, lanes} of day.items) {
        const key = classKey(slot);
        const block = btn(col,'',()=>this.selectClass(key),`os-class is-c${colors.get(slot.course.id)}`);
        block.dataset.key = key;
        block.style.top = `${(TT.minutes(slot.start) - h0 * 60) / span * 100}%`;
        block.style.height = `${(TT.minutes(slot.end) - TT.minutes(slot.start)) / span * 100}%`;
        block.style.left = `calc(${lane / lanes * 100}% + 2px)`;
        block.style.width = `calc(${100 / lanes}% - 4px)`;
        block.classList.toggle('is-narrow', lanes > 1);
        block.classList.toggle('is-selected', key === this.scheduleSelected);
        block.classList.toggle('is-clash', clashed.has(key));
        el(block,'strong','os-class-title',slot.course.title);
        el(block,'span','os-class-meta',`${slot.start}–${slot.end}`);
        el(block,'span','os-class-meta',slot.room);
        block.setAttribute('aria-label',`${day.label} ${slot.start} 到 ${slot.end}，${slot.course.title}，教室 ${slot.room}`);
        block.setAttribute('aria-pressed', String(key === this.scheduleSelected));
      }
      if (day.key === todayKey) { this.nowLine = el(col,'i','os-now-line'); this.nowLine.setAttribute('aria-hidden','true'); this.nowRange = [h0, h1]; }
    }
    if (!week.count) {
      const note = el(board.body,'p','os-week-empty', number ? '这周没有课。' : `这周在学期之外。本学期到 ${t.semesterEnd || '期末'}，点「本周」回到今天。`);
      note.setAttribute('role','status');
    }
    this.paintNowLine();

    const side = el(layout,'div','os-schedule-side');
    const focusHost = el(side,'div','os-class-focus-host');
    this.classFocus = {host: focusHost, t, colors, clashes};
    this.paintClassFocus();
    this.renderCourseKey(side, t, colors, clashes);
  }
  shiftWeek(offset) {
    this.scheduleWeek = offset === 0 ? 0 : (this.scheduleWeek || 0) + offset;
    this.scheduleSelected = '';
    return this.refresh(true);
  }
  selectClass(key) {
    this.scheduleSelected = this.scheduleSelected === key ? '' : key;
    // 只换选中态和右边那张卡，不重建整页：网格里十几块课，重建一次闪一下。
    for (const block of this.content.querySelectorAll('.os-class')) {
      const on = block.dataset.key === this.scheduleSelected;
      block.classList.toggle('is-selected', on);
      block.setAttribute('aria-pressed', String(on));
    }
    this.paintClassFocus();
  }
  /** 此刻线：只画在今天那一列，只在时间轴范围之内。 */
  paintNowLine() {
    const line = this.nowLine;
    if (!line?.isConnected) return;
    const [h0, h1] = this.nowRange, now = new Date();
    const at = (now.getHours() * 60 + now.getMinutes() - h0 * 60) / ((h1 - h0) * 60);
    line.hidden = at < 0 || at > 1;
    line.style.top = `${(Math.max(0, Math.min(1, at)) * 100).toFixed(2)}%`;
  }
  /**
   * 右上那张卡。默认回答「现在该去哪」：正在上的那节，否则下一节。
   * 点了网格里的某一节，就换成那一节；再点一次（或点「回到下一节」）换回来。
   */
  paintClassFocus() {
    const state = this.classFocus;
    if (!state?.host.isConnected) return;
    const {host, t, colors, clashes} = state, now = new Date();
    let slot = t.slots.find(s => classKey(s) === this.scheduleSelected), overline = '所选时段', picked = !!slot;
    if (!slot) {
      const current = TT.todayAgenda(t.slots, now).find(a => a.state === 'now');
      const next = TT.nextClass(t.slots, now);
      if (current) { slot = current.slot; overline = `正在上 · 还剩 ${current.endsIn} 分钟`; }
      else if (next) { slot = next.slot; overline = `下一节 · ${TT.relative(next)}`; }
    }
    host.replaceChildren();
    if (!slot) { const card = this.panel(host,'接下来没有课','','os-class-focus'); el(card.body,'p','os-muted',`本学期的课到 ${t.semesterEnd || '期末'} 为止。`); return; }
    const card = this.panel(host, slot.course.title, overline, `os-class-focus is-c${colors.get(slot.course.id)}`);
    const time = el(card.body,'div','os-class-time');
    el(time,'strong','',slot.start);
    el(time,'span','',`– ${slot.end} · ${TT.WEEKDAY_LABELS[slot.day]}`);
    const place = t.rooms[slot.room] || {};
    const where = el(card.body,'dl','os-class-facts');
    const fact = (term, value) => { if (!value) return; el(where,'dt','',term); el(where,'dd','',value); };
    // 地址是「街道 · 楼栋」，拆成两行：找教室时先认楼栋和楼层，街道是去校区时才看的。
    const [street, ...building] = String(place.address || '').split(' · ');
    fact('教室', slot.room);
    fact('楼栋', [building.join(' · '), place.floor].filter(Boolean).join(' · '));
    fact('地址', street);
    fact('教师', t.courses[slot.course.id]?.teacher);
    const notes = el(card.body,'div','os-chip-row');
    if (slot.doubtful) el(notes,'span','os-chip is-warm',`官方结束日期 ${slot.officialTo} · 待核实`);
    for (const c of clashes.filter(c => c.a === slot || c.b === slot)) {
      const other = c.a === slot ? c.b : c.a;
      el(notes,'span','os-chip is-alert',`与${other.course.title}重叠 ${c.start}–${c.end}`);
    }
    if (!notes.childElementCount) notes.remove();
    const actions = el(card.body,'div','os-class-actions');
    const catalog = (this.plugin.courseCatalog?.() || []).find(c => c.id === slot.course.id);
    if (slot.course.link) btn(actions,'课程笔记',()=>this.plugin.open(`${slot.course.link}.md`),'os-quiet');
    if (catalog) btn(actions,'开始学习',()=>this.plugin.startCourse(catalog),'os-primary');
    if (picked) btn(card.tools,'回到下一节',()=>this.selectClass(this.scheduleSelected),'os-quiet');
  }
  /** 本学期课程：色标、每周几节几小时。点一行打开那门课的笔记。 */
  renderCourseKey(parent, t, colors, clashes) {
    const byCourse = new Map();
    for (const slot of t.slots) {
      const entry = byCourse.get(slot.course.id) || {course: slot.course, count: 0, minutes: 0};
      entry.count++; entry.minutes += TT.minutes(slot.end) - TT.minutes(slot.start);
      byCourse.set(slot.course.id, entry);
    }
    const total = [...byCourse.values()].reduce((sum, e) => sum + e.minutes, 0);
    const card = this.panel(parent,'本学期课程',`${byCourse.size} 门 · 每周 ${+(total / 60).toFixed(1)} 小时`,'os-course-key');
    const list = el(card.body,'div','os-course-key-list');
    for (const entry of [...byCourse.values()].sort((a, b) => colors.get(a.course.id) - colors.get(b.course.id))) {
      const row = btn(list,'',()=>entry.course.link && this.plugin.open(`${entry.course.link}.md`),`os-course-key-row is-c${colors.get(entry.course.id)}`);
      el(row,'i','os-course-swatch');
      el(row,'strong','',entry.course.title);
      el(row,'span','',`${entry.count} 节 · ${+(entry.minutes / 60).toFixed(1)} 小时`);
    }
    // 隐藏的课不画进网格，但在这里留一行：不然它就是悄悄少了一门，过两周连自己都忘了为什么。
    const hidden = new Map((t.hiddenSlots || []).map(s => [s.course.id, s.course]));
    for (const course of hidden.values()) {
      const row = btn(list,'',()=>course.link && this.plugin.open(`${course.link}.md`),'os-course-key-row is-hidden');
      el(row,'i','os-course-swatch');
      el(row,'strong','',course.title);
      el(row,'span','','不上课 · 已隐藏');
      row.title = '课表笔记 frontmatter 的 hidden_courses 里列着它';
    }
    const foot = el(card.body,'div','os-course-key-foot');
    const pills = el(foot,'div','os-chip-row');
    if (clashes.length) el(pills,'span','os-chip is-alert',`官方课表有 ${clashes.length} 处重叠`);
    const doubtful = new Set(t.slots.filter(s => s.doubtful).map(s => s.course.title));
    if (doubtful.size) el(pills,'span','os-chip is-warm',`${[...doubtful].join('、')}结束日期待核实`);
    if (t.skipped?.length) el(pills,'span','os-chip is-alert',`${t.skipped.length} 行没读懂`);
    if (!pills.childElementCount) pills.remove();
    btn(foot,'打开课表笔记 ↗',()=>this.plugin.open(t.path),'os-quiet');
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
    const check = btn(row,task.done?'✓':'',async()=>{await this.flushEdits();await this.owner('l-os-capture').updateTask(task,task.done?'reopen':'done');await this.refresh(true);},'os-check');
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
    if(task.deleted){btn(actions,'恢复',async()=>{await this.flushEdits();await this.owner('l-os-capture').updateTask(task,'restore');await this.refresh(true);},'os-quiet');return;}
    // 每行都有同名按钮，可访问名必须带上任务本身，否则读屏只会听到一串「设为今日要务」。
    btn(actions,'设为今日要务',()=>this.chooseFocus(task),'os-quiet').setAttribute('aria-label',`设为今日要务：${task.text}`);
    btn(actions,'补充详情',()=>{new DetailModal(this,task).open();},'os-quiet').setAttribute('aria-label',`补充详情：${task.text}`);
    btn(actions,'删除',async()=>{await this.flushEdits();await this.owner('l-os-capture').deleteTask(task);await this.refresh(true);},'os-quiet');
    if (!task.done) {
      if (!compact) btn(actions,task.scheduled===dayKey()?'移出今天':'安排今天',async()=>{await this.flushEdits();await this.owner('l-os-capture').updateTask(task,task.scheduled===dayKey()?'unschedule':'today');await this.refresh(true);},'os-quiet');
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
    this.focusPanelOwner = this.owner('l-os-focus');
    if (!this.owner('l-os-focus')) {this.empty(focus.body,'专注插件未启用','在 Obsidian 插件设置中启用 L-OS 专注。');return;}

    // 凹陷的分段控件。选中项是一块浮在槽里的象牙玻璃。
    const modes = el(focus.body,'div','os-modes'); modes.setAttribute('role','tablist');
    this.modeButtons = new Map();
    for (const [id,label,phase,minutes] of FOCUS_MODES) {
      const b = btn(modes,label,async()=>{
        if (p.data.timer.status !== 'idle') throw Error('计时进行中，先结束再切换模式');
        if (p.data.timer.phase !== phase) await p.setPhase(phase);
        await this.owner('l-os-focus').setSettings({[phase==='focus'?'focusMinutes':'breakMinutes']:minutes});
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
      await this.owner('l-os-focus').setSettings({[phase==='focus'?'focusMinutes':'breakMinutes']:next});
      this.mode = ''; this.tick(); this.paintModes();
    };
    btn(stepper,'−',()=>nudge(-5),'os-step').setAttribute('aria-label','减少 5 分钟');
    btn(stepper,'+',()=>nudge(5),'os-step').setAttribute('aria-label','增加 5 分钟');

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

  tick() {
    if(this.closed)return;
    for(const task of this.taskRows.keys())this.paintTask(task);
    const today=dayKey();
    if(this.lastDay&&this.lastDay!==today)this.refresh().catch(console.error);
    // 课表按分钟走：「进行中 / 下一节」和那条此刻线。只在分钟变了时动，
    // 不在每秒那一拍上重画——这一拍还喂着番茄钟。
    const minute=Math.floor(Date.now()/60000);
    if(minute!==this.scheduleMinute){this.scheduleMinute=minute;this.paintTodayClasses();this.paintClassFocus();this.paintNowLine();}
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

    // 形变 CTA：空闲时只有一个通栏的大漆按钮，跑起来才裂成 暂停 / 结束。
    // 空闲时留一个按不动的「结束」，是在界面上摆一个永远没用的东西。
    const running = t.status!=='idle';
    setText(this.startButton,t.status==='running'?'⏸ 暂停':t.status==='paused'?'▶ 继续':t.phase==='focus'?'▶ 开始专注':'▶ 开始休息');
    setText(this.stopButton,'⏹ 结束');
    this.stopButton.hidden=!running;
    // 直接拿着容器的引用，不从按钮往上摸 parentElement——
    // 后者在无头 DOM 里是 undefined，而 smoke 就跑在那上面。
    this.focusControls.classList.toggle('is-running',running);
    if (!this.owner('l-os-focus')) {this.startButton.disabled=true;this.stopButton.disabled=true;}
  }
  updateBooks() { if (!this.closed) this.refresh().catch(console.error); }
  renderProjects() {
    const panel=this.panel(this.content,'大项目','目标 → 子任务','os-fill');
    btn(panel.tools,'新建 / 管理项目',()=>this.openProjectManager(),'os-quiet');
    for(const file of this.snapshot.files.filter(f=>f.extension==='md'&&f.path.startsWith('02 项目/')&&f.path!=='02 项目/项目导航.md')){
      const card=el(panel.body,'section','os-project-container');el(card,'h2','os-project-title',file.basename);
      // 四个动作收成一行：「添加子任务」是这张卡最常用的那个，给实底；
      // 「删除项目」推到最右，和其余三个隔开——破坏性动作不与普通动作同排同级。
      const actions=el(card,'div','os-project-actions');
      btn(actions,'＋ 添加子任务',()=>this.owner('l-os-capture').captureTask({project:file.path,scheduled:'backlog'}),'os-primary');
      btn(actions,'打开项目笔记',()=>this.plugin.open(file.path));
      btn(actions,'编辑项目',()=>this.openProjectManager(file.path));
      btn(actions,'删除项目',()=>this.deleteProject(file),'os-quiet os-danger os-project-delete');
      const tasks=this.snapshot.allTasks.filter(t=>!t.deleted&&(t.project===file.path||t.project===file.basename||!t.project&&t.path===file.path));
      const unassigned=this.snapshot.allTasks.filter(t=>!t.done&&!t.deleted&&!t.project&&!t.path.startsWith('02 项目/'));
      const attach=el(card,'select','os-input');el(attach,'option','','挂载已有独立任务').value='';unassigned.forEach((t,i)=>el(attach,'option','',t.text).value=String(i));attach.onchange=async()=>{if(attach.value==='')return;try{await this.owner('l-os-capture').patchTask(unassigned[Number(attach.value)],{project:file.path});await this.refresh(true);}catch(e){new Notice(e.message);}};
      // 每日小结里同样的「完成多少」有进度条，这里原来只有一行字。
      const done=tasks.filter(t=>t.done).length;
      const progress=el(card,'div','os-project-progress');
      el(progress,'span','',`${done} / ${tasks.length} 子任务完成`);
      const track=el(progress,'div','os-read-track');el(track,'span','os-read-fill').style.width=`${tasks.length?(done/tasks.length*100).toFixed(1):0}%`;
      for(const task of tasks)this.taskRow(card,task,false,{showProject:false});
    }
  }
  /**
   * 课堂回顾（数据见 class-ledger.js）：上一个上课日该补的、今天该记的、下一个上课日该准备的，
   * 下面是更早还没写完的。点一行打开那篇课堂笔记，没有就按模板建。
   *
   * 原来这一页是「这一天」的时间审计加几个复盘框，写进日记。框一个字都没填过，
   * 专注时段和热力页重复——每天真在写的是课堂笔记，这一页就只管它。
   */
  async renderDaily() {
    const panel=this.panel(this.content,'回顾','','os-fill os-ledger-panel');
    panel.head.hidden=true;
    const ledger=await this.plugin.classLedger?.();
    if(!panel.body.isConnected)return;
    if(!ledger){this.empty(panel.body,'还没有课表','库里放一篇 frontmatter 写 type: timetable 的课表笔记，这里按它列出每节课的笔记。');this.renderHeat(el(panel.body,'div','os-ledger'));return;}
    const colors=TT.palette(this.snapshot.timetable?.slots||[]);
    const board=el(panel.body,'div','os-ledger');
    const column=(label,day,none)=>{
      const col=el(board,'section','os-ledger-col');col.setAttribute('aria-label',label);
      const head=el(col,'header','os-ledger-head');el(head,'h3','',label);
      if(day.key)el(head,'span','',dayLabel(day.key));
      if(!day.rows.length)el(col,'p','os-ledger-none',none);
      return col;
    };
    const state=(parent,row)=>{
      const {note,status}=row,pages=note.pages,box=el(parent,'span','os-ledger-state');
      if(status==='missing')el(box,'span','os-chip is-alert','未建');
      else if(status==='empty')el(box,'span','os-chip is-warm','空壳');
      else if(status==='measuring')el(box,'span','os-ledger-pages',note.failed?'量不出页数':'正在量页数');
      else if(status==='done'){el(box,'span','os-chip','已总结');el(box,'span','os-ledger-pages',`${pages.toFixed(1)} 页`);}
      else{
        el(box,'span','os-ledger-pages',`${pages.toFixed(1)} / ${CL.TARGET_PAGES} 页`);
        const track=el(box,'span','os-read-track');el(track,'span','os-read-fill').style.width=`${Math.min(100,pages/CL.TARGET_PAGES*100).toFixed(1)}%`;
      }
      return box;
    };
    const noteRow=(parent,row,{withDate=false}={})=>{
      const {course,key,status}=row;
      const r=btn(parent,'',()=>this.plugin.openClassNote(course,dateForDay(key)),`os-ledger-row is-${status} is-c${colors.get(course.id)||1}`);
      el(r,'i','os-course-swatch');
      const main=el(r,'span','os-ledger-main');
      el(main,'strong','',course.title);
      el(main,'span','',withDate?dayLabel(key):row.sessions.map(s=>`${s.start}–${s.end}`).join('、'));
      state(r,row);
      const pages=row.note.pages;
      r.setAttribute('aria-label',`${dayLabel(key)} ${course.title}：${CL.STATUS_LABEL[status]}${pages?`，${pages.toFixed(1)} 页`:''}。${status==='missing'?'新建':'打开'}课堂笔记`);
      return r;
    };
    const prev=column('上次',ledger.prev,'还没上过课');
    for(const row of ledger.prev.rows)noteRow(prev,row);
    const today=column('今天',ledger.today,'今天没有课');
    btn(el(today.querySelector('.os-ledger-head'),'div','os-ledger-tools'),'选择课程',()=>this.openNoteCourses(),'os-quiet');
    for(const row of ledger.today.rows)noteRow(today,row);
    // 下一个上课日：笔记还不存在，点一行打开这门课上一次的笔记——上课前翻一遍上次讲到哪。
    const next=column('下次',ledger.next,'学期内没有下一节了');
    for(const row of ledger.next.rows){
      const last=row.last;
      const r=btn(next,'',()=>last&&this.plugin.open(last.path),`os-ledger-row is-next is-c${colors.get(row.course.id)||1}`);
      r.disabled=!last;
      el(r,'i','os-course-swatch');
      const main=el(r,'span','os-ledger-main');
      el(main,'strong','',row.course.title);
      el(main,'span','',row.sessions.map(s=>`${s.start}–${s.end} · ${s.room}`).join('、'));
      el(r,'span','os-ledger-pages',last?`上次 ${dayLabel(last.key)}`:'还没有笔记');
      r.setAttribute('aria-label',`${dayLabel(row.key)} ${row.course.title}，${row.sessions.map(s=>`${s.start} 到 ${s.end}，教室 ${s.room}`).join('；')}。${last?`打开 ${dayLabel(last.key)} 的课堂笔记`:'这门课还没有课堂笔记'}`);
    }
    // 更早还没写完的：没有就不画这一块。
    if(ledger.backlog.length){
      board.classList.add('has-backlog');
      const more=el(board,'section','os-ledger-col os-ledger-backlog');more.setAttribute('aria-label','更早还没写完');
      const head=el(more,'header','os-ledger-head');el(head,'h3','',`更早还没写完 · ${ledger.backlog.length}`);
      el(head,'span','',`最近 ${CL.BACKLOG_DAYS} 天`);
      const list=el(more,'div','os-ledger-list');
      for(const row of ledger.backlog)noteRow(list,row,{withDate:true});
    }
    this.renderHeat(board);
    // 从今日页的小热力图点过来：直接滚到热力那一行。
    if(this.revealHeat){this.revealHeat=false;this.heatSection?.scrollIntoView?.({block:'start'});}
  }
  /** 哪些课记笔记。写回课表笔记的 frontmatter（no_notes），关窗后刷新。 */
  openNoteCourses() {
    const t=this.snapshot.timetable;
    if(!t)return;
    const modal=new Modal(this.plugin.app);
    modal.onOpen=()=>{
      const root=modal.contentEl;root.classList.add('os-modules','os-modules-modal','os-note-courses');
      el(root,'h2','','记课堂笔记的课');
      el(root,'p','','默认是课表上有时间的课。取消勾选的课不再出现在课堂回顾里，也不再每天挂「总结笔记」任务。设置写在课表笔记的 no_notes 里。');
      for(const {course,on} of CL.timetableCourses(t)){
        const row=el(root,'label','os-file-row os-note-course');
        const box=el(row,'input');box.type='checkbox';box.checked=on;box.setAttribute('aria-label',`${course.title} 记课堂笔记`);
        el(row,'strong','',course.title);
        box.onchange=async()=>{box.disabled=true;try{await this.plugin.setNoteCourse(course.id,box.checked);}catch(e){box.checked=!box.checked;new Notice(e.message);}finally{box.disabled=false;}};
      }
    };
    modal.onClose=()=>this.refresh(true).catch(console.error);
    modal.open();
  }
  renderTasks() {
    const panel = this.panel(this.content,'行动清单','','os-fill');
    btn(panel.tools,'大项目 →',()=>this.setTab('projects'),'os-quiet');
    const toolbar=el(panel.panel,'div','os-toolbar');panel.panel.insertBefore(toolbar,panel.body);
    const quick=el(toolbar,'form','os-quick-task');const text=input(quick,'添加今日任务，Enter 设置番茄数');const add=el(quick,'button','os-button','添加');add.type='submit';quick.onsubmit=async e=>{e.preventDefault();if(add.disabled)return;add.disabled=true;try{await this.flushEdits();this.owner('l-os-capture').captureTask({quick:true,title:text.value,onSaved:()=>{text.value='';this.refresh(true).catch(console.error);}});}catch(error){new Notice(error.message);}finally{add.disabled=false;}};
    const tabs=el(toolbar,'div','os-segments');
    for (const [id,label] of [['open','待办'],['today','今天'],['overdue','逾期'],['done','已完成'],['deleted','已删除']]) btn(tabs,label,()=>{this.filter=id;this.listPage=0;return this.refresh(true);},this.filter===id?'is-active':'');
    const draw = async()=>{
      const query=this.query,filter=this.filter;
      await this.flushEdits();
      const tasks=await this.owner('l-os-capture')?.listTasks?.({filter,query})||[];
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
          const card=el(grid,'article','os-course');el(card,'p','os-overline',`${c.id} · 第 ${c.semester} 学期 · ${c.credits} 学分`);
          // 课名本身就是进课程主页的入口；放在 h3 里的真按钮，键盘和笔都够得着。
          const name=el(el(card,'h3'),'button','os-course-title',c.title);name.type='button';name.onclick=()=>this.plugin.openCourse(c).catch(e=>new Notice(e.message));
          el(card,'p','os-course-next',state.next||'写下这门课的下一步');
          // 元数据做成药丸：原来是一行跑字「1 份教材 50 分钟 / 本周 考试 2026-12-22」，三件事粘在一起分不开。
          const meta=el(card,'div','os-row-meta');el(meta,'span','os-chip',`${books.length} 份教材`);el(meta,'span','os-chip',`本周 ${stats.minutes} 分钟`);if(state.exam)el(meta,'span','os-chip is-warm','考试 '+state.exam);
          const actions=el(card,'div','os-course-actions');btn(actions,books.length?'打开教材':'关联教材',()=>this.plugin.startCourse(c),'os-primary');
          btn(actions,'知识地图',()=>this.showMap(c.id),'os-quiet');btn(actions,'学习进展',()=>this.showOutcomes(c.id),'os-quiet');btn(actions,'真题',()=>this.plugin.openExamIndex(c),'os-quiet');btn(actions,'设置',()=>this.plugin.configureCourse(c),'os-quiet');
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
  /**
   * 学习热力：回顾页账本下面那一行，左边两栏宽的方格，右边一栏是选中那天的时段。
   * 原来是回顾里单独一段，要在页头切过去；账本三栏占不满一页，下面空着一大块，就搬下来了。
   * 页头那四个大数字（今日番茄、今日时长、近 12 周番茄、有记录天数）不再单列：
   * 今天的两项就是右栏选中今天时的读数，另两项并进方格上面那一行说明。
   *
   * 横轴是周，周数跟着卡的宽度走：格子边长由这一行的高度定（一屏放下），
   * 固定 12 周时两栏宽的卡只铺满左半边。现在放得下几周就画几周，至少 12、至多 53（一年）。
   * 窗口变了只重画方格，不重画整页。纵轴是星期几，格子够大就七天都标。
   */
  renderHeat(board) {
    this.heatObserver?.disconnect(); this.heatObserver = null;
    // 一年的数据一次算好：右栏要能查到任何一格那天，方格按宽度截最近几周。
    const heat = heatmapData(this.plugin.data.sessions || [], {weeks: 53});
    const todayKey = dayKey();
    const today = heat.days.find(day => day.key === todayKey) || {key:todayKey,seconds:0,minutes:0,count:0,sessions:[],level:0};
    const selected = heat.days.find(day => day.key === this.heatmapDay) || today;
    this.heatmapDay = selected.key;
    const section = (cls, label) => {
      const col = el(board,'section',`os-ledger-col ${cls}`); col.setAttribute('aria-label',label);
      const head = el(col,'header','os-ledger-head'); el(head,'h3','',label);
      return {col, head};
    };

    const chart = section('os-heat-chart','学习热力');
    this.heatSection = chart.col;
    const summary = el(chart.head,'span','');
    const heatmapLine = el(chart.col,'div','os-heatmap-line');
    const legend = el(chart.col,'div','os-heatmap-legend');
    el(legend,'span','os-muted','少');
    for (const level of [0,1,2,3,4]) el(legend,'i',`os-heat-swatch os-heat-level-${level}`);
    el(legend,'span','os-muted','多');
    el(legend,'span','os-muted os-heatmap-hint','按每日专注时长加深 · 点一天看那天的时段');
    let shown = '';
    const paint = () => {
      const {weeks, labels} = this.heatAxes(heatmapLine);
      if (`${weeks}/${labels}` === shown) return;
      shown = `${weeks}/${labels}`;
      const days = heat.days.slice(-weeks * 7);
      summary.textContent = `近 ${weeks} 周 · ${days.filter(d => d.count).length} 天有记录 · ${days.reduce((n, d) => n + d.count, 0)} 个番茄钟`;
      heatmapLine.replaceChildren();
      heatmapLine.style.setProperty('--heat-weeks', String(weeks));
      const weekdays = el(heatmapLine,'div','os-heatmap-weekdays');
      for (const label of labels === 'all' ? ['一','二','三','四','五','六','日'] : ['一','','三','','五','','日']) el(weekdays,'span','',label);
      const chartWrap = el(heatmapLine,'div','os-heatmap-chart-wrap');
      const months = el(chartWrap,'div','os-heatmap-months');
      months.style.gridTemplateColumns = `repeat(${weeks}, var(--heat-cell))`;
      let previousMonth = '';
      for (let week = 0; week < weeks; week++) {
        const first = days[week * 7];
        const month = first?.key?.slice(0, 7) || '';
        const label = month && month !== previousMonth ? `${dateForDay(first.key).getMonth() + 1}月` : '';
        // 最左边那一列常是上个月的尾巴：离下个月不到两列就不标，免得「4月」「5月」挤在一起。
        const nextMonth = days[(week + 2) * 7]?.key?.slice(0, 7);
        const cramped = week === 0 && nextMonth && nextMonth !== month;
        el(months,'span','',cramped ? '' : label); previousMonth = month;
      }
      const grid = el(chartWrap,'div','os-heatmap-grid');
      grid.style.gridTemplateColumns = `repeat(${weeks}, var(--heat-cell))`;
      for (const [index, day] of days.entries()) {
        const cell = btn(grid,'',()=>{this.heatmapAll=false;this.heatmapDay=day.key;return this.refresh(true);},`os-heatmap-cell os-heat-level-${day.level}${day.key===selected.key&&!this.heatmapAll?' is-selected':''}`);
        cell.style.gridColumn = String(Math.floor(index / 7) + 1); cell.style.gridRow = String(index % 7 + 1);
        cell.title = dayTooltip(day); cell.setAttribute('aria-label',dayTooltip(day));
        if (day.key > todayKey) { cell.classList.add('is-future'); cell.disabled = true; }
      }
    };
    paint();
    const RO = this.contentEl?.ownerDocument?.defaultView?.ResizeObserver;
    if (RO) { this.heatObserver = new RO(() => { if (heatmapLine.isConnected) paint(); }); this.heatObserver.observe(chart.col); }

    const detail = section('os-heat-detail',this.heatmapAll?'全部专注记录':'当日记录');
    const tools = el(detail.head,'div','os-ledger-tools');
    btn(tools,'今天',()=>{this.heatmapAll=false;this.heatmapDay=todayKey;return this.refresh(true);},'os-quiet');
    btn(tools,this.heatmapAll?'看这一天':'全部记录',()=>{this.heatmapAll=!this.heatmapAll;this.listPage=0;return this.refresh(true);},'os-quiet');
    const body = detail.col;
    if (this.heatmapAll) {
      const all = [...this.plugin.data.sessions].filter(s => s.phase === 'focus').sort((a,b) => b.endedAt - a.endedAt);
      if (!all.length) { this.empty(body,'还没有专注记录','完成一段专注后，这里会按时间倒序列出全部番茄钟。'); return; }
      el(body,'p','os-overline',`共 ${all.length} 个番茄钟 · 按结束时间倒序`);
      this.pageRows(body,all,s => {
        const row = el(body,'div','os-file-row');
        const copy = el(row,'div','os-row-main'); el(copy,'strong','',s.task);
        el(copy,'p','os-muted',`${dayLabel(dayKey(s.endedAt))} · ${sessionRange(s)}`);
        el(row,'span','os-tag',`${durationLabel(s.seconds)} · ${s.completed?'完成':'提前结束'}`);
      });
      return;
    }
    el(body,'h4','os-heat-day-title',dayLabel(selected.key));
    const dayStats = el(body,'div','os-heat-day-stats');
    for (const [value,label] of [[selected.count,'番茄钟'],[durationLabel(selected.seconds),'总时长']]) {
      const metric = el(dayStats,'div'); el(metric,'strong','',String(value)); el(metric,'span','',label);
    }
    if (!selected.sessions.length) {
      el(body,'p','os-ledger-none','这天没有番茄钟；完成一段专注后，这里显示开始—结束时段和实际时长。');
      return;
    }
    const sessions = el(body,'div','os-heat-session-list');
    for (const session of selected.sessions) {
      const row = el(sessions,'div','os-heat-session');
      const time = el(row,'div','os-heat-session-time'); el(time,'strong','',sessionRange(session)); el(time,'span','os-tag',durationLabel(session.seconds));
      const copy = el(row,'div','os-row-main'); el(copy,'strong','',session.task); el(copy,'p','os-muted',session.completed?'完整完成':'提前结束');
    }
  }
  /**
   * 方格画几周、星期几标几个。格子边长取这一行上算好的 --heat-h（按卡的高度，见 styles.css），
   * 再看这一行的宽度放得下几周。一栏竖排（窄屏）时高度不限制格子，照旧 12 周。
   */
  heatAxes(line) {
    const fallback = {weeks: 12, labels: 'odd'};
    try {
      const win = line.ownerDocument.defaultView, board = line.closest('.os-ledger');
      if (!board || win.getComputedStyle(board).gridTemplateColumns.split(' ').length < 2) return fallback;
      const byHeight = Math.max(8, Math.min(40, parseFloat(win.getComputedStyle(line).getPropertyValue('--heat-h')) || 30));
      const weeks = Math.max(12, Math.min(53, Math.floor((line.clientWidth - 36) / (byHeight + 5))));
      const cell = Math.min(byHeight, (line.clientWidth - 36) / weeks - 5);
      return {weeks, labels: cell >= 14 ? 'all' : 'odd'};
    } catch { return fallback; }
  }
  renderKnowledge() { return renderKnowledge(this); }
  async showKnowledge(course='', key='') {
    this.knowledgeState={query:'',course,type:'',review:'',key,mobile:!!key,jump:true};
    await this.setTab('library');
  }
  async showMap(course='',key='',source='') {
    this.mapState={course,key,source,expanded:[],mobile:!!(key||source),cardOpen:!!(key||source)};
    await this.setTab('knowledge');
  }
  async showOutcomes(course='',path='') {
    if(path)return this.plugin.open(path);
    this.outcomeState={course,path};
    await this.setTab('outcomes');
  }
  async showSummary(entry) {
    this.summaryState={query:'',course:entry.courseIds[0]||'',date:entry.date||'',path:entry.path,mobileDetail:true};
    await this.setTab('summaries');
  }
  renderRecall() {
    const panel=this.panel(this.content,'间隔复习','','os-fill');
    btn(panel.tools,'写今日复盘',()=>this.plugin.openDaily(),'os-quiet');
    const toolbar=el(panel.panel,'div','os-toolbar');panel.panel.insertBefore(toolbar,panel.body);
    const segments=el(toolbar,'div','os-segments');
    for(const [id,label] of [['due','到期复习'],['all','全部队列']])btn(segments,label,()=>{this.reviewMode=id;this.listPage=0;return this.refresh(true);},(this.reviewMode||'due')===id?'is-active':'');
    const recall=this.owner('l-os-recall');if(!recall){this.empty(panel.body,'复习插件未启用','请启用 L-OS 间隔复习。学习进展仍可查看已有的学习与自测记录。');return;}
    const cards=this.snapshot.cards.filter(c=>this.reviewMode==='all'||c.due<=Date.now());
    if(!cards.length){this.empty(panel.body,'这一轮完成了','去学习进展看看待补强的内容，或在读 PDF 时把某张卡片加入队列。');btn(panel.body,'看学习进展',()=>this.setTab('outcomes'),'os-primary');}
    // 队列里现在有两种东西：整篇笔记，和 l-os-study 的卡片。
    // key 是调度键，path 是它所在的文件——卡片两者不同，操作一律用 key。
    const study=this.owner('l-os-study');
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
      btn(row,'查看关联内容',()=>this.snapshot.files.some(f=>f.path===c.path&&this.plugin.app.metadataCache?.getFileCache?.(f)?.frontmatter?.type==='learning-outcome')?this.showOutcomes('',c.path):this.showKnowledge('',c.key),'os-quiet');
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
      el(modal.contentEl,'p','os-muted',`导航快捷键：${NAV.map(([id,label])=>`Alt+${NAV_KEYS[id]} ${label}`).join(' · ')}。可在 Obsidian 快捷键设置中搜索「L-OS 工作台：切换到」改键。窄窗口用页内切换查看行动或专注，列表可单独滚动。`);
    };modal.open();
  }
}
module.exports = {ConsoleView, NAV, NAV_KEYS, LEAF_LABELS, LEAVES};
