"use strict";
const { Plugin, Modal, Notice, parseYaml, loadMathJax } = require('obsidian');
const {openReading}=require('../shared/open-reading');
const {FocusSelection}=require('./focus-selection');
const {ensureFile} = require('../shared/vault-utils');
const {el, btn: domBtn} = require('../shared/dom');
const {ReadingFlow} = require('./reading-flow');
const {ReadingRail} = require('./reading-rail');
const {EstimateModal} = require('./estimate-modal');
const {estimateSuggestion, hasWorked} = require('./console-model');
const {insertQuickNote} = require('./scratchpad-model');
const {parseTimetable, todayAgenda, activeOn} = require('./timetable-model');
const CN = require('./class-notes');
const {focusExplorerFolder} = require('./focus-explorer');
const { ConsoleView, NAV: NAV_TABS, LEAF_LABELS, LEAVES } = require("./console-view.js");
// A bundled fallback keeps the workbench compatible when the standalone timer plugin is disabled.
const T = require("../shared/disabled-timer.js");
const VIEW = 'codex-workbench';
// 旧主面板留下的十个路径常量只剩版本日志还在用，其余九个已随 V4 导航移除。
const PATH = { versions: '00 工作台/版本迭代.md' };
const isTextbook = f => !!f && /\.pdf$/i.test(f.path);
const { day } = require("../shared/date");
function countdownDays(value, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const [year, month, date] = value.split('-').map(Number);
  const target = new Date(0); target.setUTCFullYear(year, month - 1, date); target.setUTCHours(0,0,0,0);
  if (year < 1 || target.getUTCFullYear() !== year || target.getUTCMonth() !== month - 1 || target.getUTCDate() !== date) return null;
  return Math.round((target.getTime() - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
}
const clean = s => String(s).replace(/[\r\n]+/g, ' ').trim();
const table = s => clean(s).replace(/\|/g, '／');
const button = (parent, text, action, cls='') =>
  domBtn(parent, text, action, `cw-button ${cls}`, error => new Notice(error.message));
const COURSES = [{"id": "060116", "title": "材料科学与技术", "italian": "SCIENZA E TECNOLOGIA DEI MATERIALI", "semester": 2, "credits": 10, "teacher": "DIAMANTI MARIA VITTORIA"}, {"id": "057274", "title": "静力学与结构力学", "italian": "STATICA E SCIENZA DELLE COSTRUZIONI", "semester": 1, "credits": 10, "teacher": "BRUGGI MATTEO"}, {"id": "060112", "title": "化工过程计算", "italian": "CALCOLI DI PROCESSO DELL’INGEGNERIA CHIMICA", "semester": 1, "credits": 5, "teacher": "MEHL MARCO"}, {"id": "086552", "title": "电工学", "italian": "ELETTROTECNICA", "semester": 1, "credits": 7, "teacher": "SPADACINI GIORDANO"}, {"id": "089257", "title": "流体力学与化工基础", "italian": "MECCANICA DEI FLUIDI CON FONDAMENTI DI INGEGNERIA CHIMICA", "semester": 1, "credits": 10, "teacher": "FRASSOLDATI ALESSIO"}, {"id": "052475", "title": "数学分析 II", "italian": "ANALISI MATEMATICA II", "semester": 2, "credits": 10, "teacher": "COLOMBO FABRIZIO"}, {"id": "060110", "title": "工业实验", "italian": "SPERIMENTAZIONE INDUSTRIALE", "semester": 2, "credits": 5, "teacher": "STAGNI ALESSANDRO"}, {"id": "097536", "title": "化工工程热物理基础", "italian": "FONDAMENTI DI FISICA TECNICA PER L’INGEGNERIA CHIMICA", "semester": 2, "credits": 5, "teacher": "CELLESI FRANCESCO"}, {"id": "082919", "title": "数学分析 I 与几何", "italian": "ANALISI MATEMATICA I E GEOMETRIA", "semester": 1, "credits": 10, "teacher": "DELLORE FILIPPO"}];
const coursePath = c => `03 知识库/我的课程/2026-27/${c.id} ${c.title}.md`;
const courseState = (p,c) => Object.assign({next:'',exam:'',books:[],folders:[]},p.data.courses?.[c.id]);
function courseBooks(p,c) {
 const state=courseState(p,c),files=p.app?.vault?.getFiles?.()||[];
 const folders=state.folders.map(path=>path.replace(/\/$/,''));
 return [...new Set([...state.books,...files.filter(f=>isTextbook(f)&&folders.some(folder=>f.path.startsWith(folder+'/'))).map(f=>f.path).sort((a,b)=>a.localeCompare(b,'zh-CN',{numeric:true}))])];
}
// 一门课可以关联很多份教材。凡是「只能要一份」的地方都走这里：
// 优先上次在读的那一份，否则按排序取第一份，而不是永远取第一份。
const preferredBook = (p,c,paths=courseBooks(p,c)) =>
  (paths.includes(p.data.lastTextbook)?p.data.lastTextbook:paths[0])||'';
function courseStats(p,c) {
  const start=new Date();start.setDate(start.getDate()-(start.getDay()+6)%7);const monday=day(start);
  let seconds=0,questions=0;
  for(const path of courseBooks(p,c)) {
    const r=p.study?.data?.records?.[path];if(!r)continue;
    for(const [date,value] of Object.entries(r.daily||{}))if(date>=monday&&date<=day())seconds+=value;
    questions+=(r.annotations||[]).filter(a=>a.kind==='question'&&!a.resolved).length;
  }
  return {minutes:Math.round(seconds/60),questions};
}
class CourseSettings extends Modal {
  constructor(p,c){super(p.app);this.p=p;this.c=c;}
  onOpen(){
    const p=this.p,c=this.c,state=courseState(p,c),root=this.contentEl;root.classList.add('cw-capture-modal');
    el(root,'h2','',c.title+' · 设置');el(root,'p','cw-muted',c.italian);
    const field=(label,type,value)=>{const wrap=el(root,'label','cw-countdown-field',label),input=el(wrap,'input','');input.type=type;input.value=value;return input;};
    const next=field('学到哪里 / 下一步','text',state.next);next.placeholder='例如：第三章，完成例题 3.2';
    const exam=field('考试日期（可留空）','date',state.exam);exam.min='0001-01-01';exam.max='9999-12-31';
    el(root,'p','cw-muted','关联教材后，按这些 PDF 汇总本周学习时长和待解疑问。第一份为默认学习教材。');
    el(root,'h3','','关联文件夹');
    el(root,'p','cw-muted','自动包含所选文件夹及子文件夹中的 PDF，之后新增教材也会自动纳入。');
    const folderList=el(root,'div','cw-course-picker'),folderChecks=[];
    const folderPaths=[...new Set([...state.folders,...(p.app.vault.getAllLoadedFiles?.()||[]).filter(f=>Array.isArray(f.children)&&f.path!=='/').map(f=>f.path)])].sort((a,b)=>a.localeCompare(b,'zh-CN',{numeric:true}));
    const search=el(root,'input','cw-library-search');search.placeholder='筛选文件夹';search.setAttribute('aria-label','筛选关联文件夹');folderList.before(search);
    for(const path of folderPaths){const label=el(folderList,'label','cw-course-book-choice'),cb=el(label,'input','');cb.type='checkbox';cb.checked=state.folders.includes(path);el(label,'span','',path);folderChecks.push({path,cb,label});}
    search.oninput=()=>{for(const item of folderChecks)item.label.hidden=!item.path.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase());};
    if(!folderPaths.length)el(folderList,'p','cw-muted','请先在当前 Obsidian 库中创建教材文件夹。');
    const individual=el(root,'details','');el(individual,'summary','','单独关联 PDF（可选）');
    // 库里一有几十份 PDF（插图、讲义），不带筛选就翻不动；路径也要排序，否则顺序由扫盘顺序决定。
    const paths=[...new Set([...state.books,...(p.app.vault.getFiles?.()||[]).filter(isTextbook).map(f=>f.path)])].sort((a,b)=>a.localeCompare(b,'zh-CN',{numeric:true}));
    const bookSearch=el(individual,'input','cw-library-search');bookSearch.placeholder='筛选 PDF（文件名或所在文件夹都行）';bookSearch.setAttribute('aria-label','筛选单独关联的 PDF');
    const list=el(individual,'div','cw-course-picker'),checks=[];
    if(!paths.length)el(list,'p','cw-muted','请先将 PDF 放入 book、教材或课程文件文件夹。');
    for(const path of paths){const label=el(list,'label','cw-course-book-choice'),cb=el(label,'input','');cb.type='checkbox';cb.checked=state.books.includes(path);el(label,'span','',path);checks.push({path,cb,label});}
    // 筛掉的条目只是藏起来，勾选状态照样算进保存，免得筛完再保存把已选的丢了。
    bookSearch.oninput=()=>{const q=bookSearch.value.trim().toLocaleLowerCase();for(const item of checks)item.label.hidden=!!q&&!item.path.toLocaleLowerCase().includes(q);};
    const actions=el(root,'div','cw-modal-actions');
    const save=button(actions,'保存',async()=>{
      if(exam.value&&countdownDays(exam.value)===null){new Notice('请选择有效考试日期。');return;}
      save.disabled=true;
      try{await p.run(async()=>{p.data.courses||={};const previous=p.data.courses[c.id];p.data.courses[c.id]={next:clean(next.value),exam:exam.value,books:checks.filter(x=>x.cb.checked).map(x=>x.path),folders:folderChecks.filter(x=>x.cb.checked).map(x=>x.path)};try{await p.save();}catch(e){p.data.courses[c.id]=previous;throw e;}await p.syncCourse(c);await p.refresh();});this.close();}finally{save.disabled=false;}
    },'cw-primary');button(actions,'取消',()=>this.close(),'cw-link');
  }
  onClose(){this.contentEl.empty();}
}
// 关联了两份以上教材时，「打开教材」先问一句要哪一份。
// 一份的时候不弹——为一个没得选的选择多点一次，不值。
class CourseBooks extends Modal {
  constructor(p,c,paths){super(p.app);this.p=p;this.c=c;this.paths=paths;}
  onOpen(){
    const p=this.p,root=this.contentEl;root.classList.add('cw-capture-modal');
    const header=el(root,'div','cw-course-books-header');
    el(header,'h2','',this.c.title+' · 选一份教材');
    button(header,'打开本地文件夹',()=>p.openCourseFolder(this.c),'cw-link cw-open-course-folder');
    const last=preferredBook(p,this.c,this.paths);
    const search=el(root,'input','cw-library-search');
    search.placeholder='筛选教材（文件名或所在文件夹都行）';search.setAttribute('aria-label','筛选这门课的教材');
    const list=el(root,'div','cw-library-results'),rows=[];
    // 上次在读的排在最前：教材一多，最常回去的就是它。
    for(const path of [last,...this.paths.filter(x=>x!==last)].filter(Boolean)) {
      const row=button(list,'',async()=>{
        const file=p.app.vault.getAbstractFileByPath(path);
        if(!isTextbook(file)){new Notice('这份教材已移动或删除，请在课程设置里重新关联。');return;}
        this.close();await p.openTextbook(file);
      },'cw-course-book-open');
      const main=el(row,'span','cw-course-book-main');
      el(main,'strong','',path.split('/').pop().replace(/\.pdf$/i,''));
      el(main,'span','cw-muted',path);
      if(path===last)el(row,'span','cw-muted','上次在读');
      rows.push({path,row});
    }
    search.oninput=()=>{const q=search.value.trim().toLocaleLowerCase();for(const item of rows)item.row.hidden=!!q&&!item.path.toLocaleLowerCase().includes(q);};
    // 一百份的时候，敲几个字直接回车比用鼠标翻快得多。
    search.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();rows.find(item=>!item.row.hidden)?.row.click();}};
    const actions=el(root,'div','cw-modal-actions');
    button(actions,'管理关联',()=>{this.close();new CourseSettings(p,this.c).open();},'cw-link');
    button(actions,'取消',()=>this.close(),'cw-link');
    search.focus();
  }
  onClose(){this.contentEl.empty();}
}
function planInfo(task) { try {const match=task.raw?.match(/<!-- plan:([^ ]+) -->/);return match?JSON.parse(decodeURIComponent(match[1])):{};}catch{return {};} }
function createWorkbenchData(plugin) {
  const raw = plugin.rawData;
  return new Proxy(raw, {
    get(target, prop, receiver) {
      const focus = plugin.focus;
      if (prop === 'timer') return focus?.state?.() || target.timer;
      if (prop === 'sessions') return focus?.sessions?.() || target.sessions || [];
      if (prop === 'focusMinutes') return focus?.settings?.().focusMinutes ?? target.focusMinutes;
      if (prop === 'breakMinutes') return focus?.settings?.().breakMinutes ?? target.breakMinutes;
      return Reflect.get(target, prop, receiver);
    },
    set(target, prop, value) {
      if (['timer','sessions','focusMinutes','breakMinutes'].includes(prop)) throw Error('计时数据请通过 Codex 专注 API 更新');
      target[prop] = value; return true;
    },
  });
}

class CodexWorkbench extends Plugin {
  async onload() {
    this.views = new Set(); this.queue = Promise.resolve(); this.writeQueue = Promise.resolve();
    this.rawData = Object.assign(
      {
        timer: T.initial(),
        focusMinutes: 25,
        breakMinutes: 5,
        priorities: {},
        consoleReviewPane: 'daily',
        quickNotesDraft: '',
        sessions: [],
      },
      await this.loadData()
    );
    this.focus = this.app.plugins.getPlugin('codex-focus') || null;
    this.data = createWorkbenchData(this);
    this.readingRail=new ReadingRail(this);this.readingRail.start();
    this.focusSelection=new FocusSelection(this);
    this.readingFlow = new ReadingFlow(this);
    this.register(() => {this.readingFlow.dispose();});
    Object.defineProperty(this, 'timerCore', {
      configurable: true,
      get: () => this.focus || T,
    });
    this.study = this.app.plugins.getPlugin('codex-study')?.engine || null;
    // The study plugin owns its engine lifecycle. Workbench only borrows its API.
    this.bindOwners = () => {
      this.focus = this.app.plugins.getPlugin('codex-focus') || null;
      this.study = this.app.plugins.getPlugin('codex-study')?.engine || null;
    };
    this.app.workspace.onLayoutReady(() => {
      this.focus = this.app.plugins.getPlugin('codex-focus') || null;
      const studyPlugin = this.app.plugins.getPlugin('codex-study');
      if (studyPlugin?.engine && this.study !== studyPlugin.engine) {
        this.study = studyPlugin.engine;
        this.refresh().catch(console.error);
      }
    });
    this.registerView(VIEW, leaf => new ConsoleView(leaf, this));
    this.addRibbonIcon('layout-dashboard', '打开个人工作台', () => this.activate());
    this.addCommand({id:'open', name:'打开个人工作台', callback:()=>this.activate()});
    this.addCommand({id:'daily', name:'打开今日笔记', callback:()=>this.openDaily()});
    // 接管 codex-iteration 的唯一入口。日志改为构建产物后那个插件只剩这个按钮，
    // 不值得为它留一个插件；这里只加命令，不加 ribbon 图标和导航项。
    this.addCommand({id:'versions', name:'打开版本迭代', callback:()=>this.openVersionLog()});
    // 五个顶层入口拿 Alt+1–5。6.3 之前是十项占满 Alt+1–9 加 Alt+0，
    // 而其中几项（疑问常年 1 条）根本不值得一个快捷键。
    NAV_TABS.forEach(([id, label], index) => {
      this.addCommand({
        id: `go-${id}`,
        name: `切换到「${label}」`,
        hotkeys: [{modifiers:['Alt'], key:String(({today:1,tasks:2,learn:3,knowledge:4,review:5,schedule:6,summaries:7})[id] || index + 1)}],
        callback: () => this.goTab(id),
      });
    });
    // 页内分段仍然各自是一个命令，只是不带默认快捷键：去处一个没少，
    // 你原来绑在「切换到大项目」上的键也还在。
    const tops = new Set(NAV_TABS.map(([id]) => id));
    for (const id of LEAVES) {
      if (tops.has(id)) continue;
      this.addCommand({id: `go-${id}`, name: `切换到「${LEAF_LABELS[id]}」`, callback: () => this.goTab(id)});
    }
    // Bind directly to rendered Markdown links. Obsidian otherwise treats the
    // hash as a heading link in the current note instead of opening this view.
    this.registerMarkdownPostProcessor(root => {
      const source=this.app.workspace.getLeavesOfType('markdown').find(leaf=>leaf.containerEl?.contains(root));
      if(source?.containerEl&&!source.containerEl.querySelector('.os-floating-return')){
        const back=button(source.containerEl,'⌂ 返回工作台',()=>this.returnHome(source),'os-floating-return');
        this.register(()=>back.remove());
      }
      root.querySelectorAll('a[href="#codex-workbench-home"]').forEach(link => {
        if (link.dataset.cwWorkbenchHome) return;
        link.dataset.cwWorkbenchHome = 'true';
        this.registerDomEvent(link, 'click', event => {
          event.preventDefault();
          event.stopImmediatePropagation();
          const source=this.app.workspace.getLeavesOfType('markdown').find(leaf=>leaf.containerEl?.contains(link));
          this.returnHome(source).catch(e => new Notice(`工作台：${e.message}`));
        });
      });
    });
    this.registerEvent(this.app.workspace.on('file-open', file => {
      if (!isTextbook(file)) return;
      this.beginReading(file).catch(console.error);
      this.study?.attachFile?.(file)?.catch?.(error => new Notice(error.message));
    }));
    this.status = this.addStatusBarItem(); this.status.onclick = () => this.returnHome().catch(e=>new Notice(e.message));
    const readingControls=this.addStatusBarItem(); readingControls.classList.add('cw-reading-controls');
    this.readingToggle=button(readingControls,'暂停',()=>this.resumeReading(),'cw-link');
    this.readingStop=button(readingControls,'结束',()=>this.stop(),'cw-link');
    button(readingControls,'⌂ 工作台',()=>this.returnHome(),'cw-link');
    this.registerInterval(window.setInterval(() => this.tickViews(), 1000));
    this.registerEvent(this.app.workspace.on('codex-focus:finished', session => this.readingFlow.finished(session)));
    this.registerEvent(this.app.workspace.on('codex-focus:finished', () => this.run(async()=>{await this.flushLogs();await this.syncDailySummary();await this.refresh();})));
    this.registerEvent(this.app.workspace.on('codex-focus:changed', () => this.tickViews()));
    let debounce;
    const changed = () => { clearTimeout(debounce); debounce = setTimeout(()=>this.run(async()=>{ await this.syncDailySummary(); await this.refresh(); }).catch(console.error), 250); };
    for (const event of ['modify','create','delete','rename']) this.registerEvent(this.app.vault.on(event, (file,oldPath)=>{this.focusSelection.invalidate(file);if(oldPath)this.focusSelection.invalidate({path:oldPath});changed();}));
    this.registerEvent(this.app.metadataCache.on('changed', changed)); this.register(()=>clearTimeout(debounce));
    // 课堂笔记：粘贴 / 拖进来的图片存进这门课自己的「附件」，复制来的 \(…\) \[…\] 改成 $ 写法。
    this.registerEvent(this.app.workspace.on('editor-paste', (evt, editor, info) => this.classNotePaste(evt, editor, info)));
    this.registerEvent(this.app.workspace.on('editor-drop', (evt, editor, info) => this.classNoteDrop(evt, editor, info)));
    this.addCommand({id:'class-note', name:'打开今天的课堂笔记', callback:()=>this.openCurrentClassNote().catch(e=>new Notice(e.message))});
    this.addCommand({id:'normalize-math', name:'把当前笔记的公式改成 Obsidian 写法', editorCallback:editor=>this.normalizeEditorMath(editor)});
    this.app.workspace.onLayoutReady(() => this.loadMathPreamble());
    this.app.workspace.onLayoutReady(() => this.run(async () => { await this.flushLogs(); await this.syncDailySummary(); await this.activate(); }));
    this.app.workspace.onLayoutReady(() => this.maybeSyncClassTasks());
  }
  run(fn) { const next = this.queue.then(fn); this.queue = next.catch(e=>{ console.error(e); new Notice(`工作台：${e.message}`); }); return next; }
  async addPlan(text, info = {}) {
    await this.captureOwner().addTask(text, info);
    await this.syncDailySummary(); await this.refresh();
  }
  async startPlan(task,{openDocument=true}={}){
    const info=planInfo(task),c=COURSES.find(c=>c.id===info.course),target=this.study?.taskTarget(task.raw);
    const path=info.path||target?.path||(c?preferredBook(this,c):'');
    const file=path?this.app.vault.getAbstractFileByPath(path):null;
    if(openDocument&&path&&!isTextbook(file))throw Error('关联教材已移动或删除，请重新关联。');
    if(!task.id)Object.assign(task,await this.captureOwner().patchTask(task,{}));
    if((await this.captureOwner().index.all()).filter(t=>t.id===task.id&&!t.deleted).length!==1)throw Error('任务 ID 不唯一，请检查复制的任务行');
    await this.askEstimate(task);
    await this.focusOwner().dispatch('start', {task:task.text,taskId:task.id,minutes:task.budget_unit_minutes,project:task.project||(task.path.startsWith('02 项目/')?task.path:'')});

    if(file&&openDocument){await this.openTextbook(file);const page=info.path?info.page:target?.page;if(page&&this.study){const ctx=await this.study.attachFile(file);if(ctx)await this.study.jump(ctx,{page});}}
    await this.refresh();
  }
  /**
   * 第一次真正开工时问一次估算。做过的任务不问，已经估过的不问，
   * 「先不估」和直接关掉一样——这一问永远不挡住开始专注。
   */
  async askEstimate(task) {
    if (Number(task.estimated_pomodoros) > 0) return;
    if (hasWorked(this.data.sessions || [], task.id)) return;
    let tasks = [];
    try { tasks = await this.captureOwner().index.all(); } catch { tasks = []; }
    const suggestion = estimateSuggestion({tasks: tasks.filter(t => !t.deleted), task});
    // 弹窗出不来就当作「先不估」。这一问是个可有可无的补充，
    // 任何情况下都不该把开始专注卡住。
    const choice = await new Promise(resolve => {
      try { new EstimateModal(this.app, task, suggestion, resolve).open(); }
      catch (error) { console.warn('codex-workbench: 估算弹窗未能打开', error); resolve(0); }
    });
    if (!(choice > 0)) return;
    const unit = task.budget_unit_minutes || this.focus?.settings?.().focusMinutes || 25;
    Object.assign(task, await this.captureOwner().patchTask(task, {estimated_pomodoros: choice, budget_unit_minutes: unit}));
  }

  async syncCourse(c) {
    const state=courseState(this,c),stats=courseStats(this,c);
    const block=['<!-- cw-course -->','## 工作台课程信息',`- 学年：2026/27 · 第 ${c.semester} 学期 · ${c.credits} 学分`,`- 课程代码：${c.id}`,`- 原名：${c.italian}`,`- 教师：${c.teacher}`,`- 下次继续：${state.next||'未填写（在工作台课程设置中修改）'}`,`- 考试日期：${state.exam||'未设置'}`,`- 本周教材学习：${stats.minutes} 分钟 · ${stats.questions} 个待解疑问`,'','### 关联文件夹',...(state.folders.length?state.folders.map(path=>`- ${path}（含子文件夹 PDF）`):['未关联文件夹']),'','### 关联教材',...(courseBooks(this,c).length?courseBooks(this,c).map(path=>`- [[${path}]]`):['暂无，请在工作台课程设置中关联。']),'<!-- /cw-course -->'].join('\n');
    const file=await this.ensure(coursePath(c),`# ${c.title}\n\n## 课件与资料\n\n## 课堂笔记\n\n## 习题与错题\n\n## 复习计划\n\n`);
    await this.app.vault.process(file,text=>text.includes('<!-- cw-course -->')?text.replace(/<!-- cw-course -->[\s\S]*?<!-- \/cw-course -->/,()=>block):text+'\n'+block+'\n');
    return file;
  }
  async openCourse(c) { await this.run(()=>this.syncCourse(c)); await this.open(coursePath(c)); }
  async startCourse(c) {
    const paths=courseBooks(this,c);
    if(paths.length>1){new CourseBooks(this,c,paths).open();return;}
    const file=this.app.vault.getAbstractFileByPath(preferredBook(this,c,paths));
    if(!isTextbook(file)){new Notice('请先关联可用教材，再开始学习。');new CourseSettings(this,c).open();return;}
    await this.openTextbook(file);
  }
  async openCourseFolder(c) {
    const {resolve, relative, isAbsolute} = require('node:path');
    const {shell} = require('electron');
    const base = this.app.vault.adapter.getBasePath?.();
    if (!base) throw Error('当前设备无法打开本地文件夹');
    const folders = courseState(this,c).folders;
    const candidates = [...folders,`课程文件/${c.id} ${c.title}`];
    const folder = candidates.find(path=>Array.isArray(this.app.vault.getAbstractFileByPath(path)?.children));
    if (!folder) throw Error('课程文件夹不存在，请先在课程设置中关联文件夹');
    const root = resolve(base), target = resolve(root,folder);
    const inside = relative(root,target);
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw Error('课程文件夹路径无效');
    const error = await shell.openPath(target);
    if (error) throw Error(`无法打开课程文件夹：${error}`);
    if (!(await focusExplorerFolder(target)) && process.platform === 'win32') new Notice('文件夹已打开，但未能将窗口切到最前面');
  }
  async openTextbooks() {
    await this.activate();
    for (const view of this.views) await view.setTab('books');
  }
  async openTextbook(file) {
    if(!isTextbook(file)||!this.app.vault.getAbstractFileByPath(file.path)) throw Error('教材已移动或删除，请重新选择。');
    const existing=this.app.workspace.getLeavesOfType('pdf').find(leaf=>leaf.view?.file?.path===file.path);
    if(existing) await this.app.workspace.revealLeaf(existing);
    else await this.open(file.path);
    await this.beginReading(file);
    await this.study?.attachFile(file);
  }
  async openLastTextbook() {
    const file=this.app.vault.getAbstractFileByPath(this.data.lastTextbook||'');
    if(!isTextbook(file)) return this.openTextbooks();
    await this.openTextbook(file);
  }
  beginReading(file) { return this.run(async()=>{
    if(!isTextbook(file)) return;
    this.study?.select(file.path);
    this.data.lastTextbook=file.path;
    await this.save(); await this.readingFlow.opened(file); this.tickViews(); for(const v of this.views)v.updateBooks();
  }); }
  save() {
    const snapshot = JSON.parse(JSON.stringify(this.data));
    if (this.focus) {
      delete snapshot.timer;
      delete snapshot.sessions;
      delete snapshot.focusMinutes;
      delete snapshot.breakMinutes;
    }
    if (this.study) delete snapshot.study;
    for (const key of ['weatherCity','weatherLocation','weatherCache','scratchpad','countdown']) delete snapshot[key];
    snapshot.schemaVersion = 4;
    const next = this.writeQueue.then(() => this.saveData(snapshot));
    this.writeQueue = next.catch(() => {});
    return next;
  }
  /** 打开工作台并切到指定页，供导航命令使用。 */
  async goTab(id) {
    await this.activate();
    const view = this.app.workspace.getLeavesOfType(VIEW)[0]?.view;
    if (view?.setTab) await view.setTab(id);
  }
  async activate() { let leaf = this.app.workspace.getLeavesOfType(VIEW)[0]; if (!leaf) { leaf = this.app.workspace.getLeaf('tab'); await leaf.setViewState({type:VIEW, active:true}); } await this.app.workspace.revealLeaf(leaf); }
  returnHome(sourceLeaf=this.app.workspace.activeLeaf) {
    if(this.returning)return this.returning;
    const sourceView=sourceLeaf?.view,sourceFile=sourceView?.file;
    const run=(async()=>{
      for(const view of this.views)await view.flushEdits?.();
      this.readingFlow.dismiss();
      if(this.data.timer.status==='running')await this.focusOwner().dispatch('pause');
      await this.study?.checkpoint(sourceLeaf);
      await this.activate();
      for(const view of this.views)await view.setTab('today');
      if(sourceLeaf&&sourceView?.getViewType?.()!==VIEW&&sourceLeaf.view===sourceView&&sourceView?.file===sourceFile)sourceLeaf.detach();
      await this.refresh();
    })();
    this.returning=run.finally(()=>{this.returning=null;});return this.returning;
  }
  async openTask(task) {
    const file=this.app.vault.getAbstractFileByPath(task.path);
    if(!file)throw Error('任务来源已移动或删除');
    const content=await this.app.vault.read(file), lines=content.split('\n');
    const raw=task.deleted?`<!-- deleted-task:${encodeURIComponent(task.raw)} -->`:task.raw;
    const index=lines[task.index]?.replace(/\r$/,'')===raw.replace(/\r$/,'')?task.index:lines.findIndex(line=>line.replace(/\r$/,'')===raw.replace(/\r$/,''));
    if(index<0)throw Error('任务已变化，请刷新后重试');
    await this.open(file.path);
  }
  open(path) {return openReading(this.app,path);}
  async refresh() { await Promise.all([...this.views].map(v=>v.refresh())); }
  tickViews() { this.bindOwners(); this.study?.settle(); this.maybeSyncClassTasks(); if(this.readingToggle) { const t=this.data.timer; const rl=t.status==='running'?'暂停':t.status==='paused'?'继续':(this.readingFile()?'继续专注':(t.phase==='focus'?'开始专注':'开始休息')); if(this.readingToggle.textContent!==rl)this.readingToggle.textContent=rl; this.readingStop.disabled=t.status==='idle'; } for (const v of this.views) v.tick(); const t=this.data.timer; const label = t.status==='idle' ? '◈ 工作台' : `◷ ${t.phase==='focus'?'专注':'休息'} ${Math.ceil(this.timerCore.remaining(t)/60)} 分钟${t.status==='paused'?' · 暂停':''}`;
    // 同理：这行字一分钟才变一次，却每秒被重写一遍。
    if (this.status.textContent !== label) this.status.textContent = label; }
  minutes() { return this.data.timer.phase === 'focus' ? this.data.focusMinutes : this.data.breakMinutes; }
  setPhase(phase) { return this.focusOwner().dispatch('phase', {phase}); }
  focusOwner() {
    const owner = this.app.plugins.getPlugin('codex-focus');
    if (!owner?.dispatch) throw Error('请启用或更新 Codex 专注插件');
    return owner;
  }
  selectTask(text) { return this.focusOwner().dispatch('select', {task:clean(text)}); }
  clearTask() { return this.selectTask(''); }
  /** 当前正在读的那本 PDF；不在 PDF 里就是 null。 */
  readingFile() {
    const view=this.app.workspace.activeLeaf?.view;
    return view?.getViewType?.()==='pdf'?(view.file||null):null;
  }
  /**
   * 阅读状态栏那一排是读书时用的。一段专注跑完后 phase 会翻到休息，
   * 走通用的 toggle 会开一段休息计时，而休息时间不计入教材学习时长——
   * 在 PDF 里按这个按钮，本意一定是接着读。
   * 怎么继续交给 readingFlow.resume：弹窗开着、上下文重挂那些事都在那边。
   */
  async resumeReading(task=this.data.timer.task) {
    const file=this.focusOwner().state().status==='idle'?this.readingFile():null;
    if(!file)return this.toggle(task);
    await this.readingFlow.resume(file);
    this.tickViews();
  }
  async toggle(task=this.data.timer.task) {
    const owner=this.focusOwner();let taskId=owner.state().taskId||'';
    if(owner.state().status==='idle'&&owner.state().phase==='focus'){
      taskId=await this.focusSelection.read();
      const target=(await this.captureOwner().index.all()).find(t=>t.id===taskId&&!t.deleted&&!t.done);
      if(target){await this.startPlan(target,{openDocument:false});this.tickViews();return;}else{taskId='';task='自由专注';}
    }
    await owner.dispatch('toggle',{task,taskId});this.tickViews();
  }
  async stop() { await this.focusOwner().dispatch('finish'); await this.flushLogs(); await this.syncDailySummary(); this.tickViews(); }
  // 版本日志由 tools/deploy.js 从 CHANGELOG.md 整篇生成，这里只负责打开。
  // 此前工作台在 onload 时把自己 manifest 里的 changes 写进日志，于是日志记的是
  // 「这台机器碰巧加载过什么」而不是「发布了什么」。
  async openVersionLog() { return this.open(PATH.versions); }
  ensure(path, text) { return ensureFile(this.app, path, text); }
  daily(time=Date.now()) { return this.ensure(`05 日记/${day(time)}.md`, `---\ntype: daily\ndate: ${day(time)}\n---\n# ${day(time)}\n\n<div class="cw-return-home"><a href="#codex-workbench-home">⌂ 返回工作台首页</a></div>\n\n## 今日聚焦\n\n<!-- cw-priority -->\n今天最重要的一件事：\n<!-- /cw-priority -->\n\n## 随手记录\n\n## 今日复盘\n- 今天推进了什么：\n- 卡在哪里：\n- 明天的第一步：\n\n## 专注记录\n\n| 结束时间 | 任务 | 分钟 | 结果 |\n| --- | --- | ---: | --- |\n`); }
  async openDaily() { return this.run(async()=>{const f=await this.daily(); await this.open(f.path);}); }
  async archiveQuickNote(markdown) {
    return this.run(async()=>{
      const file=await this.daily();
      await this.app.vault.process(file,content=>insertQuickNote(content,markdown));
      this.data.quickNotesDraft='';
      await this.save();
    });
  }
  async writePriority(key = day()) { const f=await this.daily(new Date(key+'T12:00:00').getTime()); const value=`<!-- cw-priority -->\n今天最重要的一件事：${this.data.priorities[key] || ''}\n<!-- /cw-priority -->`; await this.app.vault.process(f,c=>c.includes('<!-- cw-priority -->')?c.replace(/<!-- cw-priority -->[\s\S]*?<!-- \/cw-priority -->/,()=>value):c+'\n'+value+'\n'); }
  updatePriority(value, showNotice = false, key = day()) { return this.run(async()=>{ this.data.priorities[key] = clean(value); await this.save(); await this.writePriority(key); await this.syncDailySummary(); if(showNotice) new Notice('今日要务已保存到日记。'); }); }
  /** 不经过 this.run 的要务写入：供 FocusSelection 在自己的队列里调用，避免队列自锁。 */
  async writePriorityDirect(key, text) { this.data.priorities[key] = clean(text); await this.save(); await this.writePriority(key); }
  async taskStats() {
    return this.app.plugins.getPlugin('codex-capture')?.taskStats?.() || {done:0,open:0};
  }
  async dailyAudit(key,includeLive=true) {
    const {audit}=require('./daily-audit');
    const tasks=await this.captureOwner().index.all(),sessions=[...this.data.sessions];
    const timer=this.data.timer;
    if(includeLive&&timer.status!=='idle'&&timer.phase==='focus'){const live=this.timerCore.checkpoint(timer);sessions.push({...live,live:true,endedAt:Date.now(),seconds:live.slices.reduce((n,s)=>n+s.seconds,0)});}
    const report=audit(sessions,tasks,key);
    const files=this.app.vault.getMarkdownFiles?.()||[];
    report.outputs=files.filter(file=>{
      if(/^(05 日记|00 工作台|08 插件开发|99 模板|07 归档|版本管理)\//.test(file.path))return false;
      if(!file.stat||![file.stat.ctime,file.stat.mtime].some(t=>t&&day(t)===key))return false;
      const cache=this.app.metadataCache.getFileCache(file)||{},fm=cache.frontmatter||{};
      const tags=[...(cache.tags||[]).map(t=>t.tag),...(Array.isArray(fm.tags)?fm.tags:String(fm.tags||'').split(/[,\s]+/))];
      return file.path.startsWith('03 知识库/')||tags.some(t=>/^#?learning(?:\/|$)/.test(t));
    });
    const file=this.app.vault.getAbstractFileByPath(`05 日记/${key}.md`);
    if(file){const raw=await this.app.vault.cachedRead(file),yaml=raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);const fm=yaml?(parseYaml(yaml[1])||{}):{};for(const t of fm.rollover_tasks||[])if(!report.pending.some(x=>x.id===t.id))report.pending.push(t);}
    return report;
  }
  async saveDailyFeedback(file,field,value){
    if(!['aha','energy','attention','friction'].includes(field))throw Error('无效反馈字段');
    if(['energy','attention'].includes(field)&&value!==''&&(!Number.isInteger(Number(value))||Number(value)<1||Number(value)>5))throw Error('评分须为 1–5 的整数');
    await this.app.fileManager.processFrontMatter(file,fm=>{fm[field]=value;});
    if(field==='aha')await this.app.vault.process(file,text=>{const block=`<!-- los-aha -->\n> [!tip] 一句话洞察\n> ${String(value).replace(/[\r\n]+/g,' ')}\n<!-- /los-aha -->`;return text.includes('<!-- los-aha -->')?text.replace(/<!-- los-aha -->[\s\S]*?<!-- \/los-aha -->/,()=>block):text+'\n'+block+'\n';});
  }
  async setTomorrow(key,task){
    const {nextDay}=require('./daily-audit'),next=nextDay(key),file=await this.daily(new Date(key+'T12:00:00').getTime());
    const stable=await this.focusSelection.select(task,next);
    if(stable.scheduled===key||stable.due&&stable.due<=key)await this.app.fileManager.processFrontMatter(file,fm=>{const rows=Array.isArray(fm.rollover_tasks)?fm.rollover_tasks:[];fm.rollover_tasks=[...rows.filter(t=>t.id!==stable.id),{id:stable.id,text:stable.text,path:stable.path,rolledOver:true}];});
    await this.captureOwner().patchTask(stable,{scheduled:next});
    await this.app.fileManager.processFrontMatter(file,fm=>{fm.tomorrow_task_id=stable.id;fm.tomorrow_task=stable.text;});
  }
  async rolloverDaily(key){
    return this.run(async()=>{
      const {nextDay}=require('./daily-audit'),report=await this.dailyAudit(key),next=nextDay(key),file=await this.daily(new Date(key+'T12:00:00').getTime());
      const current=await this.captureOwner().index.all();
      const pending=current.filter(t=>!t.done&&!t.deleted&&t.scheduled!==next&&report.pending.some(x=>x.id===t.id&&!!t.id||x.path===t.path&&x.text===t.text));
      await this.app.fileManager.processFrontMatter(file,fm=>{fm.rollover_tasks=report.pending.map(t=>({id:t.id||t.path+':'+t.index,text:t.text,path:t.path,rolledOver:true}));});
      for(const t of pending)await this.captureOwner().patchTask(t,{scheduled:next});
      await this.syncDailySummary(new Date(key+'T12:00:00').getTime());
    });
  }
  async syncDailySummary(time = Date.now()) {
    const key=day(time),f=await this.daily(time),report=await this.dailyAudit(key,false),block=require('./daily-audit').markdown(report,key);
    const update=c=>c.includes('<!-- cw-daily-summary -->')?c.replace(/<!-- cw-daily-summary -->[\s\S]*?<!-- \/cw-daily-summary -->/,()=>block):c.trimEnd()+'\n\n'+block+'\n';
    const current=await this.app.vault.cachedRead(f);if(update(current)!==current)await this.app.vault.process(f,update);
  }
  async flushLogs() {
    if (!this.app.plugins.getPlugin('codex-focus')?.markLogged) return;
    for(const s of this.data.sessions.filter(s=>!s.logged)) {
      if(s.phase==='focus') { const f=await this.daily(s.endedAt); const marker=`<!-- focus:${s.id} -->`; const time=new Date(s.endedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}); const row=`| ${time} | ${table(s.slices?.length?s.slices.map(x=>x.task+' '+(x.seconds/60).toFixed(2)+'分').join('；'):s.task)} | ${(s.seconds/60).toFixed(1)} | ${s.completed?'完成':'提前结束'} | ${marker}`;
        await this.app.vault.process(f,c=>{ if(c.includes(marker)) return c; const header='| --- | --- | ---: | --- |'; const at=c.indexOf(header); if(at<0) return c+`\n## 专注记录\n\n| 结束时间 | 任务 | 分钟 | 结果 |\n${header}\n${row}\n`; const insert=at+header.length; return c.slice(0,insert)+'\n'+row+c.slice(insert); });
      }
      if(s.phase==='focus'){const days=new Set((s.slices?.length?s.slices:[s]).flatMap(x=>{const keys=[];let t=x.startedAt??x.endedAt;while(t<x.endedAt){keys.push(day(t));const d=new Date(t);d.setHours(24,0,0,0);t=d.getTime();}keys.push(day(x.endedAt-1));return keys;}));for(const key of days)await this.syncDailySummary(new Date(key+'T12:00:00').getTime());}
      await this.focusOwner().markLogged(s.id);
    }
  }
  captureOwner() {
    const owner = this.app.plugins.getPlugin('codex-capture');
    if (!owner?.listTasks) throw Error('请启用或更新 Codex 捕获插件');
    return owner;
  }
  async tasks() { return this.app.plugins.getPlugin('codex-capture')?.listTasks?.() || []; }
  async completeTask(task) { await this.captureOwner().updateTask(task, 'done'); await this.syncDailySummary(); }
  captureTask() { return this.captureOwner().captureTask(); }
  captureNote() { return this.captureOwner().captureNote(); }
  captureProject() { return this.captureOwner().captureProject(); }
  configureCourse(course) { new CourseSettings(this, course).open(); }

}

// V4 presentation API: pure view layer reads these, no direct access to module globals.
CodexWorkbench.prototype.courseCatalog = function () { return COURSES; };
// 今日排序要用：任务挂在哪门课上，以及每门课现在有多急。
// planInfo 解析的是任务行尾那段 <!-- plan:... -->，课程 id 就在里面。
// 自动建的「总结笔记」任务没有 plan 注释，课程代码在标签里。
CodexWorkbench.prototype.courseIdFor = function (task) { return planInfo(task).course || CN.courseOfTask(task); };
CodexWorkbench.prototype.courseUrgencyMap = function () {
  const out = {};
  for (const c of COURSES) out[c.id] = {exam: courseState(this, c).exam, weekMinutes: courseStats(this, c).minutes};
  return out;
};
CodexWorkbench.prototype.courseStateFor = function (course) { return courseState(this, course); };
CodexWorkbench.prototype.courseBooksFor = function (course) { return courseBooks(this, course); };
CodexWorkbench.prototype.preferredBookFor = function (course) { return preferredBook(this, course); };
CodexWorkbench.prototype.courseStatsFor = function (course) { return courseStats(this, course); };
CodexWorkbench.prototype.courseNotePath = function (course) { return coursePath(course); };
/**
 * 课表：库里 frontmatter 带 `type: timetable` 的笔记，一学期一篇。
 * 选哪一篇：今天落在哪篇的学期里就用哪篇；都不在，取最近一个还没开始的；
 * 再没有，取最后结束的那篇（寒暑假里仍然能翻上学期的课表）。
 * 按路径加修改时间缓存——今日页每次刷新都要问一次，不能每次都读盘解析。
 */
CodexWorkbench.prototype.timetable = async function (now = new Date()) {
  const vault = this.app.vault, cache = this.app.metadataCache;
  const files = (vault.getMarkdownFiles?.() || []).filter(file => {
    const type = cache?.getFileCache?.(file)?.frontmatter?.type;
    return type ? type === 'timetable' : /课表/.test(file.basename);
  });
  if (!files.length) return null;
  this.timetableCache ||= new Map();
  const parsed = [];
  for (const file of files) {
    const key = `${file.path}@${file.stat?.mtime || 0}`;
    let entry = this.timetableCache.get(file.path);
    if (entry?.key !== key) {
      const text = await (vault.cachedRead?.(file) || vault.read(file));
      entry = {key, value: {path: file.path, ...parseTimetable(text)}};
      this.timetableCache.set(file.path, entry);
    }
    if (entry.value.slots.length) parsed.push(entry.value);
  }
  if (!parsed.length) return null;
  const today = day(now.getTime());
  const span = t => [t.slots.map(s => s.from).filter(Boolean).sort()[0] || '', t.semesterEnd || ''];
  const current = parsed.find(t => { const [a, b] = span(t); return a <= today && (!b || today <= b); });
  if (current) return current;
  const upcoming = parsed.filter(t => span(t)[0] > today).sort((a, b) => span(a)[0].localeCompare(span(b)[0]))[0];
  return upcoming || parsed.sort((a, b) => span(b)[1].localeCompare(span(a)[1]))[0];
};
CodexWorkbench.prototype.openTimetable = async function () {
  const t = await this.timetable();
  if (!t) { new Notice('库里还没有课表笔记（frontmatter 写 type: timetable）。'); return; }
  await this.open(t.path);
};

/**
 * 课堂笔记（见 class-notes.js）。今日页「今天的课」点一行进这里：没有就按模板建，
 * 然后在编辑模式打开——库的默认打开方式是阅读模式，上课要的是能直接打字。
 */
CodexWorkbench.prototype.ensureClassNote = async function (course, key, now = new Date()) {
  const path = CN.notePath(course, key);
  const existing = this.app.vault.getAbstractFileByPath(path);
  if (existing) return {file: existing, created: false};
  const t = await this.timetable(now);
  const sessions = (t?.slots || []).filter(s => s.course.id === course.id && activeOn(s, key))
    .map(s => ({start: s.start, end: s.end, room: s.room, address: t.rooms[s.room]?.address.split(' · ')[0] || ''}));
  const file = await ensureFile(this.app, path, CN.noteTemplate({course, key, sessions, coursePath: coursePath(course)}));
  return {file, created: true};
};
CodexWorkbench.prototype.openClassNote = async function (course, now = new Date()) {
  const key = day(now.getTime());
  const {file, created} = await this.ensureClassNote(course, key, now);
  const leaf = this.app.workspace.getLeavesOfType('markdown').find(l => l.view?.file?.path === file.path) || this.app.workspace.getLeaf('tab');
  await leaf.setViewState({type: 'markdown', state: {file: file.path, mode: 'source', source: false}, active: true});
  await this.app.workspace.revealLeaf(leaf);
  // 新建的笔记把光标放到「课堂记录」下面那一行，打开就能记。
  const editor = leaf.view?.editor;
  if (created && editor) {
    const at = editor.getValue().split('\n').findIndex(line => line === '## 课堂记录');
    if (at >= 0) { editor.setCursor({line: at + 1, ch: 0}); editor.focus?.(); }
  }
  return file;
};
/** 命令「打开今天的课堂笔记」：正在上的那节，否则下一节，否则今天最后一节。 */
CodexWorkbench.prototype.openCurrentClassNote = async function (now = new Date()) {
  const t = await this.timetable(now);
  const agenda = t ? todayAgenda(t.slots, now) : [];
  const pick = agenda.find(a => a.state === 'now') || agenda.find(a => a.state === 'next') || agenda.at(-1);
  if (!pick) { new Notice('今天没有课'); return; }
  await this.openClassNote(pick.slot.course, now);
};
/**
 * 今天有课的每门课，在「下一步行动」里挂一条「总结笔记」任务（P2、一个番茄）。
 * 一天一次：启动时一次，过了午夜由每秒那一拍发现日期变了再来一次。
 * 按标签去重，删掉的任务也算建过——删了就是不要，不该第二天早上又冒出来。
 */
CodexWorkbench.prototype.maybeSyncClassTasks = function () {
  const today = day();
  if (!this.app.workspace.layoutReady || this.classTasksDay === today) return;
  this.classTasksDay = today;
  this.run(() => this.syncClassTasks()).catch(() => { this.classTasksDay = ''; });
};
CodexWorkbench.prototype.syncClassTasks = async function (now = new Date()) {
  const capture = this.app.plugins.getPlugin('codex-capture');
  if (!capture?.createTask || !capture.index) return 0;
  const t = await this.timetable(now);
  if (!t) return 0;
  const key = day(now.getTime());
  const all = await capture.index.all();
  let made = 0;
  for (const {course} of CN.todayCourses(todayAgenda(t.slots, now))) {
    if (all.some(task => CN.hasTaskTag(task, CN.taskTag(key, course.id)))) continue;
    await capture.createTask(CN.taskSpec(course, key));
    made++;
  }
  if (made) { await this.syncDailySummary(); await this.refresh(); }
  return made;
};

CodexWorkbench.prototype.classNotePaste = function (evt, editor, info) {
  const note = CN.parseNotePath(info?.file?.path);
  if (!note || evt.defaultPrevented || !evt.clipboardData) return;
  const images = [...evt.clipboardData.files].filter(f => f.type.startsWith('image/'));
  if (images.length) {
    evt.preventDefault();
    this.saveClassImages(images, note, info.file.path).then(text => editor.replaceSelection(text)).catch(e => new Notice(`图片没存上：${e.message}`));
    return;
  }
  const text = evt.clipboardData.getData('text/plain');
  const fixed = text && CN.normalizeMath(text);
  if (!text || fixed === text) return;
  evt.preventDefault();
  editor.replaceSelection(fixed);
};
CodexWorkbench.prototype.classNoteDrop = function (evt, editor, info) {
  const note = CN.parseNotePath(info?.file?.path);
  if (!note || evt.defaultPrevented || !evt.dataTransfer) return;
  const images = [...evt.dataTransfer.files].filter(f => f.type.startsWith('image/'));
  // 混着别的文件（PDF 之类）就整个交还给 Obsidian，免得拆成两半各走各的。
  if (!images.length || images.length !== evt.dataTransfer.files.length) return;
  evt.preventDefault();
  // 放到松手的位置。editor.cm 是 CodeMirror 6 的视图，拿不到就退回光标处。
  const at = editor.cm?.posAtCoords?.({x: evt.clientX, y: evt.clientY});
  this.saveClassImages(images, note, info.file.path).then(text => {
    if (at == null) editor.replaceSelection(text);
    else editor.replaceRange(text, editor.offsetToPos(at));
  }).catch(e => new Notice(`图片没存上：${e.message}`));
};
/** 存进「代码 课名/附件/」，名字是「日期 课名 时分秒」；返回要插进正文的嵌入链接。 */
CodexWorkbench.prototype.saveClassImages = async function (files, note, sourcePath) {
  const vault = this.app.vault, folder = CN.attachmentFolder(note.course);
  if (!vault.getAbstractFileByPath(folder)) {
    try { await vault.createFolder(folder); } catch (error) { if (!vault.getAbstractFileByPath(folder)) throw error; }
  }
  const links = [];
  for (const file of files) {
    const ext = ((/\.([A-Za-z0-9]+)$/.exec(file.name || '') || [])[1] || file.type.split('/')[1] || 'png').toLowerCase().replace('jpeg', 'jpg');
    const name = CN.imageName(note.course, note.key, new Date(), ext);
    let path = `${folder}/${name}`;
    for (let n = 2; vault.getAbstractFileByPath(path); n++) path = `${folder}/${name.replace(/(\.[^.]+)$/, `-${n}$1`)}`;
    const saved = await vault.createBinary(path, await file.arrayBuffer());
    links.push('!' + this.app.fileManager.generateMarkdownLink(saved, sourcePath));
  }
  return links.join('\n');
};
CodexWorkbench.prototype.normalizeEditorMath = function (editor) {
  const text = editor.getValue(), fixed = CN.normalizeMath(text);
  if (fixed === text) { new Notice('没有需要改的公式写法'); return; }
  const cursor = editor.getCursor();
  editor.setValue(fixed);
  editor.setCursor({line: Math.min(cursor.line, editor.lineCount() - 1), ch: 0});
  new Notice('公式已改成 $ / $$ 写法');
};
/**
 * 给 MathJax 定义一组常用宏（\dv \pdv \abs \R …，见 CN.MATH_PREAMBLE）。
 * MathJax 里 \newcommand 定义一次之后后面的公式都认；已经渲染过的阅读视图重画一遍。
 */
CodexWorkbench.prototype.loadMathPreamble = async function () {
  if (typeof loadMathJax !== 'function') return;
  try {
    await loadMathJax();
    if (!window.MathJax?.tex2chtml) return;
    window.MathJax.tex2chtml(CN.MATH_PREAMBLE);
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) leaf.view?.previewMode?.rerender?.(true);
  } catch (error) { console.warn('[codex-workbench] 公式宏没加载上', error); }
};
module.exports = CodexWorkbench;
