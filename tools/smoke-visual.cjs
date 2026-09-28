const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const legibility=require('./legibility.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'C:/Users/longf/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.env.VISUAL_OUTPUT_DIR||path.resolve(root,'../../workbench-checks/visual'));fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage();const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:1440,height:900});
 await page.setContent('<style>*{box-sizing:border-box}html,body{height:100%;margin:0}body{--font-interface:"Segoe UI","Microsoft YaHei",sans-serif}button,input{font:inherit}</style><div class="workspace-leaf-content" data-type="l-os-workbench" style="height:100%"><div class="view-content" style="height:100%"></div></div>');
 // 令牌在 shared/tokens.css，由 tools/build.js 内联进产物样式。夹具读的是源码样式，
 // 必须自己按同样顺序补上，否则渲染出来的是一套没有任何 --os-* 的界面——
 // 字号、留白、描边全落到浏览器默认值，断言等于在测另一个东西。
 await page.addStyleTag({content:fs.readFileSync(path.join(root,'shared/tokens.css'),'utf8')});
 await page.addStyleTag({content:fs.readFileSync(path.join(root,'shared/components.css'),'utf8')});
 await page.addStyleTag({content:fs.readFileSync(path.join(root,'l-os-workbench/styles.css'),'utf8')});
 // 5.4：el / btn 已合并到 shared/dom.js，各模块的 require 桩都要能解析它。
 await page.addScriptTag({content:`window.domModule=(()=>{const module={exports:{}};${fs.readFileSync(path.join(root,'shared/dom.js'),'utf8')};return module.exports;})();`});
 await page.addScriptTag({content:`window.dateModule=(()=>{const module={exports:{}};${fs.readFileSync(path.join(root,'shared/date.js'),'utf8')};return module.exports;})();window.previewModel=(()=>{const module={exports:{}};const require=name=>{if(name==='../shared/date')return window.dateModule;throw Error('Unexpected fixture dependency: '+name);};${fs.readFileSync(path.join(root,'l-os-workbench/console-model.js'),'utf8')};return module.exports;})();`});
 // 课表模型是纯函数，没有依赖。喂它仓库里那篇真的课表笔记，而不是手写一份：
 // 笔记改了格式、解析跟不上，这里第一个知道。
 await page.addScriptTag({content:`window.timetableModel=(()=>{const module={exports:{}};${fs.readFileSync(path.join(root,'l-os-workbench/timetable-model.js'),'utf8')};return module.exports;})();`});
 await page.evaluate(text=>{window.timetableData={path:'00 工作台/Polimi 2026-27 第一学期课表.md',...timetableModel.parseTimetable(text)};},fs.readFileSync(path.join(root,'../00 工作台/Polimi 2026-27 第一学期课表.md'),'utf8'));
 // 课堂回顾的账本也用真模型，喂同一篇课表。
 await page.addScriptTag({content:`window.classLedgerModel=(()=>{const module={exports:{}};const require=()=>window.timetableModel;${fs.readFileSync(path.join(root,'l-os-workbench/class-ledger.js'),'utf8')};return module.exports;})();`});
 await page.addScriptTag({content:`window.formulaModel=(()=>{const module={exports:{}};${fs.readFileSync(path.join(root,'l-os-study/core/formula-model.js'),'utf8')};return module.exports;})();window.markdownModule={renderMarkdown(_app,_owner,target,markdown){target.textContent=markdown;target.classList.add('markdown-rendered');},markdownOwner(){return{load(){},unload(){}};}};`});
 await page.addScriptTag({content:`window.dueModule=(()=>{const module={exports:{}};const require=()=>({});${fs.readFileSync(path.join(root,'l-os-workbench/due.js'),'utf8')};return module.exports;})();`});
 for(const [name,file]of [['budgetModule','budget.js'],['editorModule','action-editor.js']])await page.addScriptTag({content:`window.${name}=(()=>{const module={exports:{}};const require=n=>n.includes('shared/dom')?window.domModule:{};${fs.readFileSync(path.join(root,'l-os-workbench',file),'utf8')};return module.exports;})();`});
 await page.addStyleTag({content:fs.readFileSync(path.join(root,'l-os-capture/styles.css'),'utf8')});
 await page.addStyleTag({content:fs.readFileSync(path.join(root,'l-os-widgets/styles.css'),'utf8')});
 await page.addScriptTag({content:`window.widgetCore=(()=>{const module={exports:{}};const require=n=>window.dateModule;${fs.readFileSync(path.join(root,'l-os-widgets/core/widgets.js'),'utf8')};return module.exports;})();`});
 // 桩要还原 Obsidian 真实的 .modal > .modal-content > contentEl 结构，
 // 否则 styles.css 里 .modal:has(...) 的限高规则一条都不会命中，弹窗布局断言就等于在测桩。
 await page.addScriptTag({content:`window.FixtureModal=class {
   constructor(){
     this.containerEl=document.createElement('div');this.containerEl.className='modal-container';
     this.containerEl.style.cssText='position:fixed;inset:0;z-index:999;display:flex;align-items:center;justify-content:center';
     this.modalEl=document.createElement('div');this.modalEl.className='modal';
     this.modalEl.style.cssText='background:#fff8ef;max-width:94vw;max-height:80vh;overflow:hidden';
     this.wrapEl=document.createElement('div');this.wrapEl.className='modal-content';
     this.contentEl=document.createElement('div');
     this.wrapEl.append(this.contentEl);this.modalEl.append(this.wrapEl);this.containerEl.append(this.modalEl);
   }
   open(){document.body.append(this.containerEl);this.onOpen?.();}
   close(){this.containerEl.remove();this.onClose?.();}
 };`});
 await page.addScriptTag({content:`window.TaskModal=(()=>{const module={exports:{}};const require=n=>n==='obsidian'?{Modal:window.FixtureModal,Notice:class{}}:n.includes('shared/dom')?window.domModule:{day:()=>previewModel.dayKey()};${fs.readFileSync(path.join(root,'l-os-capture/task-modal.js'),'utf8')};return module.exports.TaskModal;})();`});
 await page.addScriptTag({content:`window.detailModalModule=(()=>{const module={exports:{}};const require=n=>n==='obsidian'?{Modal:window.FixtureModal,Notice:class{constructor(t){window.lastNotice=t}}}:n.includes('shared/dom')?window.domModule:window.editorModule;${fs.readFileSync(path.join(root,'l-os-workbench/detail-modal.js'),'utf8')};return module.exports;})();`});
 // FixtureModal 必须先就位：WidgetSettings extends Modal，Modal 是 undefined 时
 // 整个 IIFE 抛在 addScriptTag 里，而 addScriptTag 不会因此失败——window.LOSWidgets
 // 只是静悄悄地不存在。
 // 挂件走的是真正的 main.js，只把 Plugin 外壳和 requestUrl 换成桩：左栏要验的是
 // 「挂件把那段空白填上之后，底部按钮还在不在视口里」，验一份抄写版等于没验。
 await page.addScriptTag({content:`window.LOSWidgets=(()=>{const module={exports:{}};const require=n=>n==='obsidian'?{Plugin:class{async loadData(){return window.widgetData||null}async saveData(d){window.widgetData=d}addCommand(){}registerInterval(){}registerDomEvent(t,e,fn){t.addEventListener(e,fn)}},Modal:window.FixtureModal,Notice:class{constructor(t){window.lastNotice=t}},requestUrl:async()=>({json:{current:{temperature_2m:17.4,weather_code:2}}}),setIcon(e,name){const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("data-icon",name);e.append(svg);}}:n.includes('shared/dom')?window.domModule:n.includes('shared/date')?window.dateModule:window.widgetCore;${fs.readFileSync(path.join(root,'l-os-widgets/main.js'),'utf8')};return module.exports;})();`});
 for(const [name,file] of [['summaryModel','summary-notes.js'],['summaryView','summary-view.js']])await page.addScriptTag({content:`window.${name}=(()=>{const module={exports:{}};const require=n=>n.includes('shared/dom')?window.domModule:n.includes('summary-notes')?window.summaryModel:n.includes('markdown-render')?window.markdownModule:{Notice:class{}};${fs.readFileSync(path.join(root,'l-os-workbench',file),'utf8')};return module.exports;})();`});
 for(const [name,file] of [['studyCardModel','l-os-study/core/study-model.js'],['recallKeys','l-os-recall/core/keys.js'],['knowledgeModel','l-os-workbench/knowledge-model.js'],['knowledgeView','l-os-workbench/knowledge-view.js']])await page.addScriptTag({content:`window.${name}=(()=>{const module={exports:{}};const require=n=>n.includes('shared/dom')?window.domModule:n.includes('summary-notes')?window.summaryModel:n.includes('study-model')?window.studyCardModel:n.includes('core/keys')?window.recallKeys:n.includes('knowledge-model')?window.knowledgeModel:n.includes('detail-modal')?window.detailModalModule:n.includes('markdown-render')?window.markdownModule:{Notice:class{}};${fs.readFileSync(path.join(root,file),'utf8')};return module.exports;})();`});
 // 知识地图的模块按依赖顺序装：图谱、掌握度、导图布局在视图之前。require 桩按名字查表。
 await page.evaluate(()=>{const table={'shared/dom':'domModule','shared/date':'dateModule','summary-notes':'summaryModel','reading-rail-model':'railModel','vault-utils':'vaultUtils','learning-hub-model':'hubModel','learning-hub-store':'hubStore','knowledge-graph':'graphModel','/mastery':'masteryModel','knowledge-store':'kStore','mind-map-layout':'mindLayout','mind-map-view':'mindView','concept-map-view':'conceptView','quiz-model':'quizModel','quiz-store':'quizStore','quiz-view':'quizView','markdown-render':'markdownModule'};
   window.hubRequire=n=>{for(const [k,v] of Object.entries(table))if(n.includes(k))return window[v];return {Modal:window.FixtureModal,Notice:class{constructor(message){window.lastNotice=message}}};};});
 for(const [name,file] of [['railModel','l-os-workbench/reading-rail-model.js'],['vaultUtils','shared/vault-utils.js'],['hubModel','l-os-workbench/learning-hub-model.js'],['hubStore','l-os-workbench/learning-hub-store.js'],['graphModel','l-os-workbench/knowledge-graph.js'],['masteryModel','l-os-workbench/mastery.js'],['kStore','l-os-workbench/knowledge-store.js'],['mindLayout','l-os-workbench/mind-map-layout.js'],['mindView','l-os-workbench/mind-map-view.js'],['conceptView','l-os-workbench/concept-map-view.js'],['hubView','l-os-workbench/learning-hub-view.js'],['quizModel','l-os-workbench/quiz-model.js'],['quizStore','l-os-workbench/quiz-store.js'],['quizView','l-os-workbench/quiz-view.js']])await page.addScriptTag({content:`window.${name}=(()=>{const module={exports:{}};const require=window.hubRequire;${fs.readFileSync(path.join(root,file),'utf8')};return module.exports;})();`});
 // 7.4 自编教材：模型是纯函数，视图只要 dom 和 Notice。
 await page.addScriptTag({content:`window.ownBooksModel=(()=>{const module={exports:{}};${fs.readFileSync(path.join(root,'l-os-workbench/own-books-model.js'),'utf8')};return module.exports;})();`});
 await page.addScriptTag({content:`window.ownBooksView=(()=>{const module={exports:{}};const require=n=>n.includes('shared/dom')?window.domModule:n.includes('own-books-model')?window.ownBooksModel:{Notice:class{constructor(t){window.lastNotice=t}}};${fs.readFileSync(path.join(root,'l-os-workbench/own-books-view.js'),'utf8')};return module.exports;})();`});
 await page.addScriptTag({content:`window.ConsoleView=(()=>{const module={exports:{}};const require=name=>name.includes('own-books-view')?window.ownBooksView:name.includes('learning-hub-view')?window.hubView:name.includes('quiz-view')?window.quizView:name.includes('timetable-model')?window.timetableModel:name.includes('class-ledger')?window.classLedgerModel:name.includes('shared/dom')?window.domModule:name.includes('knowledge-view')?window.knowledgeView:name.includes('summary-view')?window.summaryView:name.includes('console-model')?window.previewModel:name.includes('formula-model')?window.formulaModel:name.includes('markdown-render')?window.markdownModule:name.includes('due')?window.dueModule:name.includes('detail-modal')?window.detailModalModule:name.includes('action-editor')?window.editorModule:name.includes('budget')?window.budgetModule:{ItemView:class{constructor(){this.contentEl=document.querySelector('.view-content')}registerEvent(){}},Notice:class{constructor(t){window.lastNotice=t}},Modal:window.FixtureModal,setIcon(e,name){e.textContent=({sun:'☀','check-square':'✓','book-open':'▤',flame:'♨',files:'▱','rotate-ccw':'↶'})[name]||'○'}};${fs.readFileSync(path.join(root,'l-os-workbench/console-view.js'),'utf8')};return module.exports.ConsoleView;})();`});
 const courses=JSON.parse(fs.readFileSync(path.join(root,'l-os-workbench/main.js'),'utf8').match(/const COURSES = (\[.*\]);/)[1]);
 await page.evaluate(async courses=>{
   const day=previewModel.dayKey();
   const files=Array.from({length:85},(_,i)=>({path:`03 知识库/学习笔记/${i===0?'数学分析 · 多元函数的微分与积分':'知识卡片 '+i}.md`,basename:i===0?'数学分析 · 多元函数的微分与积分':'知识卡片 '+i,extension:'md',stat:{mtime:Date.now()-i*1000}}));
   files.push({path:'book/数学分析 II · 教材.pdf',basename:'数学分析 II · 教材',extension:'pdf',stat:{mtime:1}});
   const tasks=Array.from({length:85},(_,i)=>({id:'task-'+i,index:i,text:['完成第三章例题，整理偏导数的几何意义','复习伯努利方程的适用条件','整理材料科学课堂笔记','推导连续性方程并检查量纲'][i%4]+(i>3?' '+i:''),path:'02 项目/本周学习计划.md',raw:'- [ ] test '+i,priority:i===0?2:0,done:false,scheduled:i<8?day:'',due:i===1?'2026-09-01':''}));
   const timer={status:'idle',phase:'focus',remaining:1500,duration:1500,task:''};
   const sessions=[{phase:'focus',seconds:1800,endedAt:Date.now(),task:'整理数学分析笔记',completed:true}];
   const records={'book/数学分析 II · 教材.pdf':{position:{page:42},totalPages:320,annotations:[{kind:'question',note:'如何理解隐函数定理的局部性？',page:37}],daily:{[day]:1800},dailyPages:{[day]:[35,36,37,38,39,40,41,42]}}};
   const focus={manifest:{version:'4.5.0'},settings:()=>({focusMinutes:p.data.focusMinutes,breakMinutes:p.data.breakMinutes}),setSettings:async patch=>Object.assign(p.data,patch)};
 const capture={index:{all:async()=>tasks},createProject:async name=>{const file={path:'02 项目/'+name+'.md',basename:name,extension:'md'};files.push(file);return file;},renameProject:async(file,name)=>{const old=file.path;file.path='02 项目/'+name+'.md';file.basename=name;window.projectRename={old,name:file.path};return file;},deleteProject:async file=>{window.projectDeleted=file.path;files.splice(files.indexOf(file),1);},readProject:async()=>({}),patchProject:async(file,before,patch)=>{window.projectPatch=patch;},patchTask:async(t,patch)=>{if(window.rejectPatch)throw Error('模拟写入失败');Object.assign(t,patch);if(patch.title)t.text=patch.title;return t;},addTask:async text=>{tasks.push({id:'new',text,raw:'- [ ] '+text,path:'00 工作台/今日任务.md',scheduled:day});},manifest:{version:'4.0.0'},listTasks:async({filter='open',query=''}={})=>tasks.filter(t=>(filter==='deleted'?t.deleted:!t.deleted&&(filter==='done'?t.done:!t.done))&&(filter!=='today'||t.scheduled===day||t.due)&&(filter!=='overdue'||t.due)&&(t.text+t.path).includes(query)),taskStats:async()=>({open:tasks.filter(t=>!t.done).length,done:tasks.filter(t=>t.done).length}),createNote:()=>{window.noteCreated=true;},updateNote:async(file,action)=>{window.noteAction=action;file.status=action==='done'?'done':'todo';if(action==='delete')files.splice(files.indexOf(file),1);},deleteTask:async t=>{t.deleted=true;},updateTask:async(t,action)=>{if(action==='restore')t.deleted=false;if(action==='done')t.done=true;if(action==='reopen')t.done=false;if(action==='today')t.scheduled=day;if(action==='unschedule')t.scheduled='';}};
   const cards=[{path:files[0].path,due:Date.now()-1000,interval:1,reviews:2}];
   const recall={manifest:{version:'1.0.0'},list:()=>cards,add:async path=>{if(!cards.some(c=>c.path===path))cards.push({path,due:0});},remove:async path=>{cards.splice(cards.findIndex(c=>c.path===path),1);},review:()=>{window.reviewOpened=true;}};
   const owners={'l-os-focus':focus,'l-os-capture':capture,'l-os-recall':recall};
   const p={manifest:{version:'4.1.1'},views:new Set(),data:{timer,sessions,focusMinutes:25,breakMinutes:5,priorities:{[day]:'理解多元微积分，把关键推导写清楚'},lastTextbook:'book/数学分析 II · 教材.pdf'},study:{data:{records},overview:()=>{}},
    app:{plugins:{getPlugin:id=>owners[id]},workspace:{on:()=>({})},vault:{getFiles:()=>files,getMarkdownFiles:()=>files.filter(f=>f.extension==='md'),cachedRead:async()=> '# 多元函数的微分\n\n全微分描述函数在一点附近的线性变化。\n\n## 核心关系\n\ndf = fₓ dx + fᵧ dy\n\n存在偏导数，并不意味着函数在该点可微。需要检查各方向的变化能否统一为线性近似。\n\n## 下一次复习\n\n试着画出切平面，解释误差项为什么必须是高阶无穷小。'},metadataCache:{getFileCache:f=>({frontmatter:{tags:['数学','微积分'],status:f.status}}),resolvedLinks:{}}},
    focusSelection:{read:async()=>window.chosenFocus||'',select:async task=>{window.chosenFocus=task.id;return task;}},save:async()=>{},run:async fn=>fn(),open:async path=>{window.openedPath=path;},openDaily:async()=>{},captureTask:()=>{window.captured=true;},captureNote:()=>{},captureProject:()=>{},openVersionLog:()=>{},
    minutes:()=>timer.phase==='focus'?p.data.focusMinutes:p.data.breakMinutes,timerCore:{remaining:t=>t.remaining},
    toggle:async task=>{timer.task=task;timer.status=timer.status==='running'?'paused':'running';},stop:async()=>{timer.status='idle';},setPhase:async phase=>timer.phase=phase,
    updatePriority:async value=>{p.data.priorities[day]=value;},startPlan:async t=>{timer.task=t.text;timer.status='running';},
    courseCatalog:()=>courses,timetable:async()=>window.timetableData,courseStateFor:c=>({next:c.id==='052475'?'第三章 · 完成全微分与复合函数求导练习':'整理本周课堂笔记，完成配套习题',exam:'2026-12-22'}),courseBooksFor:()=>[files.at(-1).path],courseStatsFor:()=>({minutes:50,questions:1}),startCourse:async()=>{},openCourse:async()=>{},openClassNote:async c=>{window.openedClassNote=c.title;},configureCourse:()=>{},openTextbook:async f=>{window.openedPath=f.path;},openLastTextbook:async()=>{},
   };
   owners['l-os-study']={engine:p.study,manifest:{version:'3.6.0'}};owners['l-os-workbench']=p;
   // 四个挂件全开，倒计日给两条：满配下左栏最挤，底部按钮最容易被顶出去。
   window.widgetData={order:[{id:'clock',on:true,slot:'top'},{id:'quote',on:true,slot:'bottom'},{id:'countdown',on:true,slot:'bottom'},{id:'weather',on:true,slot:'header'}],clock:{seconds:true,date:true},countdown:{items:[{name:'期末考',date:'2027-01-05'},{name:'开题报告',date:'2026-12-01'}],max:3},weather:{lat:45.46,lon:9.19,place:'米兰',refreshMinutes:60}};
   window.widgets=new LOSWidgets();await window.widgets.onload();owners['l-os-widgets']=window.widgets;
   // 课堂回顾：固定在 2026-09-24 周四（三门课），四种状态各来一行，前两天留几篇欠账。
   const written={'2026-09-24/057274':18.5,'2026-09-24/086552':1.4,'2026-09-24/060112':'shell','2026-09-23/086552':30.6,'2026-09-23/089257':null,'2026-09-22/060112':'shell','2026-09-22/089257':12.2};
   p.classLedger=async()=>{const ledger=classLedgerModel.buildLedger({timetable:window.timetableData,today:'2026-09-24',since:'2026-09-22',note:(course,key)=>{const k=key+'/'+course.id;if(!(k in written))return{exists:false,shell:false,pages:null};const w=written[k];return w==='shell'?{exists:true,shell:true,pages:0}:{exists:true,shell:false,pages:w};}});for(const row of ledger.next.rows)row.last=row.course.id==='089257'?null:{key:'2026-09-24',path:'笔记/'+row.course.id+'.md'};return ledger;};
   p.setNoteCourse=async(id,on)=>{window.noteCourse={id,on};};files.push({path:'02 项目/本周学习计划.md',basename:'本周学习计划',extension:'md',stat:{mtime:1}});capture.app=p.app;capture.captureTask=options=>new TaskModal(capture,options).open();capture.createTask=async value=>{if(window.failCreate)throw Error('模拟保存失败');window.createdTask=value;};p.captureTask=()=>capture.captureTask();window.v=new ConsoleView({},p);window.fixtureTasks=tasks;await v.onOpen();
 },courses);
 if(process.env.HUB_ONLY==='1'){await require('./learning-hub-visual.cjs')(page,out);await require('./quiz-visual.cjs')(page,out);assert.deepEqual(errors,[]);await browser.close();console.log('Learning hub visual checks passed.');return;}
 await require('./summary-visual.cjs')(page,out);
 await require('./knowledge-visual.cjs')(page,out);
 if(process.env.KNOWLEDGE_ONLY==='1'){assert.deepEqual(errors,[]);await browser.close();console.log('Knowledge and summary visual checks passed.');return;}
 const results=[];
 for(const theme of ['light','dark']){
  await page.evaluate(t=>document.body.className=t==='dark'?'theme-dark':'',theme);
  for(const [width,height] of [[1600,900],[1100,720],[760,640],[420,720],[360,600],[900,400],[320,480]]){
   await page.setViewportSize({width,height});
   // 5.3 侧栏：十项分三组后必须仍然装得下。宽松高度下导航区不许出现滚动；
   // 矮窗口允许导航区自己滚，但底部按钮（7.4 起只剩「模块与版本」）必须始终留在视口内。
   {
    const rail=await page.evaluate(()=>{
      const nav=document.querySelector('.os-nav'),foot=document.querySelector('.os-rail-foot');
      const railEl=document.querySelector('.os-rail'),r=railEl.getBoundingClientRect(),f=foot.getBoundingClientRect();
      const vis=e=>e&&!e.hidden&&getComputedStyle(e).display!=='none';
      const top=document.querySelector('.os-widgets-top'),bottom=document.querySelector('.os-widgets-bottom');
      const hosts=[top,bottom].filter(vis);
      const shown=hosts.length>0;
      const t=document.querySelector('.ow-clock-time');
      const clockLines=t?Math.round(t.getBoundingClientRect().height/parseFloat(getComputedStyle(t).lineHeight)):0;
      const clockClipped=!!t&&t.scrollWidth>t.clientWidth+1;
      const navTop=nav.getBoundingClientRect().top;
      return {widgets:shown?{
                cards:hosts.reduce((n,h)=>n+h.querySelectorAll('.ow-card').length,0),
                topCards:vis(top)?top.querySelectorAll('.ow-card').length:0,
                overflowX:hosts.some(h=>h.scrollWidth>h.clientWidth+1),
                clockLines,clockClipped,
                clockAboveNav:!!t&&t.getBoundingClientRect().bottom<=navTop+1,
                abovefoot:hosts.every(h=>h.getBoundingClientRect().bottom<=f.top+1)}:null,
              navScrolls:nav.scrollHeight>nav.clientHeight+1,
              buttons:nav.querySelectorAll('.os-nav-button').length,
              headings:nav.querySelectorAll('.os-nav-heading').length,
              footInside:f.bottom<=r.bottom+1&&f.top>=r.top-1&&f.height>0};
    });
   // 6.4：页头那一块挂件横排在标题和右上角按钮之间。它最容易出的问题不是自己长歪，
   // 而是把「今日日记 / ＋新任务」挤出页头——所以量的是那两个按钮还在不在页头框内。
   {
    const head=await page.evaluate(()=>{
      const h=document.querySelector('.os-widgets-header'),header=document.querySelector('.os-header');
      const vis=e=>e&&!e.hidden&&getComputedStyle(e).display!=='none';
      if(!vis(h))return null;
      const b=header.getBoundingClientRect(),r=h.getBoundingClientRect();
      const acts=[...document.querySelectorAll('.os-header-actions button')].map(e=>e.getBoundingClientRect());
      const rows=new Set([...h.querySelectorAll('.ow-card')].map(c=>Math.round(c.getBoundingClientRect().top)));
      return {cards:h.querySelectorAll('.ow-card').length,rows:rows.size,
              // 7.0：自绘图标。不只断言「有个 svg」——空的 svg 也是 svg，
              // 而幕画不出来时正好就是那样。要求它真画了形，并且落在已知的十幕里。
              icon:(()=>{const a=h.querySelector('.ow-art');
                return !!a&&a.childElementCount>0&&/ow-art-is-[a-z-]+/.test(a.getAttribute('class')||'');})(),
              // 读数块：温度当主，天气和地名退成底下一行小字。
              read:!!h.querySelector('.ow-wx-temp')&&!!h.querySelector('.ow-wx-meta'),
              inHeader:r.left>=b.left-1&&r.right<=b.right+1&&r.top>=b.top-1&&r.bottom<=b.bottom+1,
              actionsInHeader:acts.every(a=>a.right<=b.right+1&&a.left>=b.left-1),
              overlaps:acts.some(a=>a.left<r.right-1&&a.right>r.left+1)};
    });
    if(head){
      assert.equal(head.cards,1,`页头应当只有天气一块：${JSON.stringify({width,height,head})}`);
      assert.equal(head.rows,1,`页头挂件换行了：${JSON.stringify({width,height,head})}`);
      assert.ok(head.icon,`页头天气没画出图标，或画出来是个空 svg：${JSON.stringify({width,height})}`);
      assert.ok(head.read,`页头天气不是读数块（缺温度或缺元信息）：${JSON.stringify({width,height})}`);
      assert.ok(head.inHeader,`页头挂件超出页头范围：${JSON.stringify({width,height,head})}`);
      assert.ok(head.actionsInHeader,`页头挂件把右上角按钮挤出了页头：${JSON.stringify({width,height,head})}`);
      assert.ok(!head.overlaps,`页头挂件和右上角按钮重叠：${JSON.stringify({width,height,head})}`);
    } else assert.ok(width<=800,`页头挂件不该在 ${width}x${height} 下消失`);
   }
    // 7.0 加了第六项「课表」。数字写死是故意的：导航多一项少一项都该有人看见。
    // 知识拆成「知识地图」「周五自测」「学习进展」之后是 9 项，7.4 加「自编教材」是 10 项。
    assert.equal(rail.buttons,10,`导航项数异常：${rail.buttons}`);
    // 6.4：挂件区接管了导航和底部按钮之间的空档。它 flex-basis 为 0 且自带滚动，
    // 所以「挤不出底部按钮」这条不是自动成立的——宽松尺寸下四块全画得出，窄/矮时整块收起。
    if(rail.widgets){
      assert.ok(rail.widgets.cards>0,`挂件区显示着却一块都没画：${JSON.stringify({width,height})}`);
      // 读数折行是 6.4 的原始 bug：「上午 7:55:50」在 196px 的左栏里放不下，
      // 卡片从 62px 长到 99px，四个挂件一起把挂件区顶出一条滚动条。
      // 折行和裁切要分开量：white-space:nowrap 之后读数不会再折，太长就变成悄悄被切掉，
      // 高度一点不变。两条都在，才既守住 nowrap 这条规则，也守住「字符串别再变长」。
      // 6.4 的位置契约：时间默认落在导航上方那一块。搬错槽位不会报错、也不会溢出，
      // 只是安静地跑到导航底下去——只有拿它和导航的 y 坐标比一下才看得出来。
      assert.ok(rail.widgets.clockAboveNav,`时间没有落在导航上方：${JSON.stringify({width,height})}`);
      assert.equal(rail.widgets.topCards,1,`导航上方那块应当只有时间一块，实际 ${rail.widgets.topCards} 块`);
      assert.ok(!rail.widgets.clockClipped,`时钟读数被裁掉了：${JSON.stringify({width,height})}`);
      assert.equal(rail.widgets.clockLines,1,`时钟读数折成了 ${rail.widgets.clockLines} 行：${JSON.stringify({width,height})}`);
      assert.ok(!rail.widgets.overflowX,`挂件横向溢出左栏：${JSON.stringify({width,height})}`);
      assert.ok(rail.widgets.abovefoot,`挂件区压到了底部按钮上：${JSON.stringify({width,height})}`);
      if(width>=1100&&height>=700)assert.equal(rail.widgets.cards,3,`宽松尺寸下左栏应有三块挂件（天气在页头）：${JSON.stringify({width,height})}`);
    } else assert.ok(width<=800||height<=560,`挂件区不该在 ${width}x${height} 下消失`);
    assert.ok(rail.footInside,`侧栏底部按钮被挤出视口：${JSON.stringify({width,height})}`);
    if(height>=700&&width>=1100)assert.ok(!rail.navScrolls,`${width}x${height} 下导航区不应滚动`);
   }
   // 5.3：十个去处全部是顶层导航，学习与回顾不再有页内分段。
   for(const tab of ['today','tasks','projects','courses','books','questions','knowledge','daily','heatmap','recall','schedule']){
    await page.evaluate(tab=>v.setTab(tab),tab);await page.waitForTimeout(60);
    const result=await page.evaluate(tab=>{
      const bounded=['.os-root','.os-app','.os-main','.os-content','.os-today-grid','.os-ledger'];
      const broken=bounded.flatMap(s=>[...document.querySelectorAll(s)]).filter(e=>e.clientHeight>0&&(e.scrollHeight>e.clientHeight+2||e.scrollWidth>e.clientWidth+2)).map(e=>({class:e.className,client:[e.clientWidth,e.clientHeight],scroll:[e.scrollWidth,e.scrollHeight]}));
      const bodyOverflow=document.documentElement.scrollHeight>innerHeight+2||document.documentElement.scrollWidth>innerWidth+2;
      const heatmap=tab==='heatmap'?(()=>{
        const wrap=document.querySelector('.os-heatmap-chart-wrap'),weekdays=[...document.querySelectorAll('.os-heatmap-weekdays span')],cells=[...document.querySelectorAll('.os-heatmap-cell')];
        const alignment=weekdays.map((label,index)=>{const a=label.getBoundingClientRect(),b=cells[index]?.getBoundingClientRect();return b?Math.abs((a.top+a.height/2)-(b.top+b.height/2)):Infinity;});
        return {scrollWidth:wrap?.scrollWidth||0,clientWidth:wrap?.clientWidth||0,maxRowDelta:Math.max(...alignment)};
      })():null;
       const ledgerRows=tab==='daily'?[...document.querySelectorAll('.os-ledger-row')].map(row=>{const a=row.getBoundingClientRect(),col=row.closest('.os-ledger-col').getBoundingClientRect();const parts=[...row.children].map(c=>c.getBoundingClientRect());return {text:row.textContent,left:a.left,right:a.right,colLeft:col.left,colRight:col.right,inside:parts.every(p=>p.left>=a.left-1&&p.right<=a.right+1),overflow:row.scrollWidth>row.clientWidth+1};}):null;
       const projectFields=tab==='projects'?[...document.querySelectorAll('.os-project-container>.os-input')].map(field=>{const a=field.getBoundingClientRect(),b=field.parentElement.getBoundingClientRect();return {left:a.left,right:a.right,parentLeft:b.left,parentRight:b.right};}):null;
       return {broken,bodyOverflow,heatmap,ledgerRows,projectFields};
    },tab);
     if(tab==='heatmap')assert.equal(await page.evaluate(()=>v.tab),'daily');
     if(tab==='daily'){assert.equal(await page.locator('.os-ledger-col').count(),6);if(width>=1100){const fit=await page.evaluate(()=>{const body=document.querySelector('.os-ledger-panel>.os-panel-body'),card=document.querySelector('.os-heat-chart').getBoundingClientRect(),grid=document.querySelector('.os-heatmap-grid').getBoundingClientRect(),legend=document.querySelector('.os-heat-chart .os-heatmap-legend').getBoundingClientRect();return {scroll:body.scrollHeight,client:body.clientHeight,gridBottom:grid.bottom,legendBottom:legend.bottom,cardBottom:card.bottom,viewport:innerHeight,cell:document.querySelector('.os-heatmap-cell').getBoundingClientRect().height,cardHeight:card.height,containerType:getComputedStyle(document.querySelector('.os-heat-chart')).containerType,rows:getComputedStyle(document.querySelector('.os-heatmap-grid')).gridTemplateRows,weeks:document.querySelectorAll('.os-heat-chart .os-heatmap-months span').length,gridRight:grid.right,cardRight:card.right,labels:[...document.querySelectorAll('.os-heat-chart .os-heatmap-weekdays span')].map(e=>e.textContent).join('')};});assert.ok(fit.scroll<=fit.client+1&&fit.legendBottom<=fit.cardBottom+1&&fit.cardBottom<=fit.viewport&&fit.cell>=8,`回顾在 ${width}x${height} 下一屏放不下：${JSON.stringify(fit)}`);assert.ok(fit.weeks>=12&&fit.cardRight-fit.gridRight<=fit.cell+5+30,`热力方格没铺满卡：${JSON.stringify(fit)}`);assert.equal(fit.labels,fit.cell>=14?'一二三四五六日':'一三五日',JSON.stringify(fit));if(width===1600)assert.ok(fit.weeks>12,`宽屏应多于 12 周：${JSON.stringify(fit)}`);}assert.equal(await page.locator('.os-sections').evaluate(e=>e.hidden),true);assert.equal(await page.locator('.os-heatmap-grid').count(),1);assert.equal(result.ledgerRows.length,3+3+3+2);assert.ok(result.ledgerRows.every(r=>r.inside&&!r.overflow&&r.left>=r.colLeft-1&&r.right<=r.colRight+1),JSON.stringify(result.ledgerRows.filter(r=>!(r.inside&&!r.overflow&&r.left>=r.colLeft-1&&r.right<=r.colRight+1))));if(width===420&&theme==='light')await page.screenshot({path:path.join(out,'daily-mobile.png')});}
     if(tab==='projects'&&result.projectFields.length){assert.ok(result.projectFields.every(field=>field.left>=field.parentLeft-1&&field.right<=field.parentRight+1),JSON.stringify(result.projectFields));}
    if(tab==='heatmap'){assert.ok(result.heatmap.scrollWidth<=result.heatmap.clientWidth+1,JSON.stringify(result.heatmap));assert.ok(result.heatmap.maxRowDelta<=1,JSON.stringify(result.heatmap));
     // 选中格用 outline 画描边。outline 不占布局空间，所以 scrollWidth 永远发现不了它被裁：
     // 必须按 outline-width + outline-offset 手算出描边范围，再和容器裁剪框比。
     const ring=await page.evaluate(()=>{
       const wrap=document.querySelector('.os-heatmap-chart-wrap'),cell=document.querySelector('.os-heatmap-cell.is-selected');
       if(!wrap||!cell)return null;
       const cs=getComputedStyle(cell),ws=getComputedStyle(wrap);
       const out=(parseFloat(cs.outlineWidth)||0)+(parseFloat(cs.outlineOffset)||0);
       const c=cell.getBoundingClientRect(),w=wrap.getBoundingClientRect();
       return {out,clipX:ws.overflowX,clipY:ws.overflowY,
               left:c.left-out,right:c.right+out,top:c.top-out,bottom:c.bottom+out,
               wl:w.left,wr:w.right,wt:w.top,wb:w.bottom};
     });
     if(ring){
       const clipped=ring.clipX!=='visible'||ring.clipY!=='visible';
       if(clipped){
         assert.ok(ring.right<=ring.wr+0.5,`选中格描边被右边界裁掉：${JSON.stringify({width,height,...ring})}`);
         assert.ok(ring.left>=ring.wl-0.5,`选中格描边被左边界裁掉：${JSON.stringify({width,height,...ring})}`);
         assert.ok(ring.bottom<=ring.wb+0.5,`选中格描边被下边界裁掉：${JSON.stringify({width,height,...ring})}`);
         assert.ok(ring.top>=ring.wt-0.5,`选中格描边被上边界裁掉：${JSON.stringify({width,height,...ring})}`);
       }
     }
    }
    results.push({theme,width,height,tab,...result});assert.deepEqual(result.broken,[],JSON.stringify(results.at(-1)));assert.equal(result.bodyOverflow,false);
    if(theme==='light'&&width===1600)await page.screenshot({path:path.join(out,tab+'.png')});
    if(theme==='dark'&&width===1600&&tab==='today')await page.screenshot({path:path.join(out,'today-dark.png')});
    if(theme==='light'&&width===420&&tab==='today')await page.screenshot({path:path.join(out,'today-mobile.png')});
   }
  }
 }
 // ---- 闸门四：对抗性背景。量的是真正挂载的界面，不是示意结构。 ----
 // 前三道闸门管令牌和构图，管不到「一张没见过的照片」。这一道把界面摆在
 // 八种最坏背景上（含「没挂壁纸」那条路径），在文字锚点处采样它真正压着的
 // 合成底色。--os-scrim-opacity 强制设成 0，也就是用户把图片可见度滑到 100
 // 的最坏情况——托底层不跟那个滑块走，这里量的正是「滑到底之后还剩什么」。
 await page.setViewportSize({width:1600,height:900});
 await page.evaluate(()=>v.setTab('today'));
 {
  const rows=await legibility.measure(page);
  const {bad,worst}=legibility.report(rows);
  if(bad.length){
   const lines=bad.slice(0,20).map(r=>`  ${r.theme==='light'?'浅':'深'} / ${r.backdrop} / ${r.name}（${r.on}）`
     +` 底 ${r.bg} 字 ${r.ink} = ${r.value.toFixed(2)}`).join('\n');
   assert.fail(`可读性闸门：${rows.length} 次取样里 ${bad.length} 处低于 ${legibility.MIN}\n${lines}`);
  }
  console.log(`可读性：${rows.length} 次取样全部达标，最难的一处 `
    +`${worst.theme==='light'?'浅':'深'} / ${worst.backdrop} / ${worst.name} = ${worst.value.toFixed(2)}`);
  // 课表页单独量一趟：它的文字大多压在实色课块上，不在玻璃上，
  // 「照理不受壁纸影响」得量出来才算数。
  await page.evaluate(()=>v.setTab('schedule'));await page.waitForTimeout(80);
  {
   const rows=await legibility.measure(page,{anchors:legibility.SCHEDULE_ANCHORS,minAnchors:7});
   const {bad,worst}=legibility.report(rows);
   if(bad.length)assert.fail(`可读性闸门（课表）：${rows.length} 次取样里 ${bad.length} 处低于 ${legibility.MIN}\n`
     +bad.slice(0,20).map(r=>`  ${r.theme==='light'?'浅':'深'} / ${r.backdrop} / ${r.name}（${r.on}） 底 ${r.bg} 字 ${r.ink} = ${r.value.toFixed(2)}`).join('\n'));
   console.log(`可读性（课表）：${rows.length} 次取样全部达标，最难的一处 ${worst.theme==='light'?'浅':'深'} / ${worst.backdrop} / ${worst.name} = ${worst.value.toFixed(2)}`);
   for(const [theme,file] of [['','schedule-wallpaper.png'],['theme-dark ','schedule-wallpaper-dark.png']]){
    await page.evaluate(t=>{document.documentElement.style.setProperty('--os-scrim-opacity','0');document.body.style.setProperty('--os-wallpaper','linear-gradient(#045295 0%,#8fc7ee 60%,#dff1ff 100%)');document.body.className=t+'os-wallpaper-on';},theme);
    await page.waitForTimeout(120);await page.screenshot({path:path.join(out,file)});
   }
   await page.evaluate(()=>{document.body.style.removeProperty('--os-wallpaper');document.documentElement.style.removeProperty('--os-scrim-opacity');document.body.className='';});
  }
  // 课表交互：点一节 → 右上卡换成那一节、只它一块高亮；再点一次换回「下一节 / 正在上」。
  // 翻周改的是页头那行周次；「本周」回来。选中态不许靠重建整页实现（会闪），所以断言块还是原来那个节点。
  {
   const first=page.locator('.os-class').first();
   const title=await first.locator('.os-class-title').textContent();
   const node=await first.evaluateHandle(e=>e);
   await first.click();
   assert.equal(await page.locator('.os-class.is-selected').count(),1);
   assert.equal(await page.locator('.os-class-focus .os-panel-head h2').textContent(),title);
   assert.match(await page.locator('.os-class-focus .os-overline').textContent(),/所选时段/);
   assert.equal(await node.evaluate(e=>e.isConnected),true,'选中一节不该重建整张网格');
   await first.click();
   assert.equal(await page.locator('.os-class.is-selected').count(),0);
   assert.doesNotMatch(await page.locator('.os-class-focus .os-overline').textContent(),/所选时段/);
   const before=await page.locator('.os-page-status').textContent();
   await page.getByRole('button',{name:'下一周',exact:true}).click();await page.waitForTimeout(60);
   const after=await page.locator('.os-page-status').textContent();
   assert.notEqual(after,before,`翻到下一周，页头周次应当变：${before}`);
   assert.equal(await page.getByRole('button',{name:'本周',exact:true}).isDisabled(),false);
   await page.getByRole('button',{name:'本周',exact:true}).click();await page.waitForTimeout(60);
   assert.equal(await page.locator('.os-page-status').textContent(),before);
   // 学期之外：翻到二十周以后，网格要空、要说一句话，不能是一张默默的白板。
   for(let i=0;i<20;i++){await page.getByRole('button',{name:'下一周',exact:true}).click();}
   await page.waitForTimeout(60);
   assert.equal(await page.locator('.os-class').count(),0);
   assert.match(await page.locator('.os-week-empty').textContent(),/学期之外/);
   await page.getByRole('button',{name:'本周',exact:true}).click();await page.waitForTimeout(60);
  }
  await page.evaluate(()=>v.setTab('today'));await page.waitForTimeout(80);
  // 今日页那张卡点一行，要打开同一门课的课堂笔记，留在今日页；课表从卡头的「课表 →」去。
  if(await page.locator('.os-class-row').count()){
   const name=await page.locator('.os-class-row-main strong').first().textContent();
   await page.locator('.os-class-row').first().click();await page.waitForTimeout(80);
   assert.equal(await page.evaluate(()=>window.openedClassNote),name);
   assert.notEqual(await page.locator('.os-heading h1').textContent(),'课表');
   await page.locator('.os-today-classes').getByRole('button',{name:'课表 →'}).click();await page.waitForTimeout(80);
   assert.equal(await page.locator('.os-heading h1').textContent(),'课表');
   await page.evaluate(()=>v.setTab('today'));await page.waitForTimeout(80);
  }
  // 留两张壁纸下的截图。其余截图都在平色底上拍的，而这一版改的东西
  // 只有在照片上才看得出来——没有它，评审时只能看数字。
  for(const [theme,file] of [['','today-wallpaper.png'],['theme-dark ','today-wallpaper-dark.png']]){
   await page.evaluate(t=>{
    document.documentElement.style.setProperty('--os-scrim-opacity','0');   // 滑块滑到底
    document.body.style.setProperty('--os-wallpaper',
      'linear-gradient(#045295 0%,#8fc7ee 60%,#dff1ff 100%)');
    document.body.className=t+'os-wallpaper-on';
   },theme);
   await page.waitForTimeout(120);
   await page.screenshot({path:path.join(out,file)});
  }
  await page.evaluate(()=>{
   document.body.style.removeProperty('--os-wallpaper');
   document.documentElement.style.removeProperty('--os-scrim-opacity');
  });
 }
 await page.evaluate(()=>document.body.className='');await page.setViewportSize({width:1100,height:720});await page.evaluate(()=>v.setTab('tasks'));
 await page.getByPlaceholder('搜索任务或来源笔记').fill('伯努利');await page.waitForTimeout(200);
 assert.ok(await page.locator('.os-task-row').count()>0);assert.equal(await page.locator('.os-task-title').filter({hasText:'多元'}).count(),0);
 await page.locator('.os-check').first().click();assert.equal(await page.evaluate(()=>fixtureTasks.filter(t=>t.done).length),1);
 await page.evaluate(()=>v.setTab('library'));await page.locator('.os-note-row').first().click();assert.ok(await page.locator('.os-knowledge-markdown').textContent());
 await page.getByRole('button',{name:'开始回忆',exact:true}).click();
 // 6.6 的形变 CTA：空闲时只有开始键，跑起来才裂成 暂停 / 结束。
 // 按名字找按钮在这里靠不住——今日要务卡里也有一个「开始专注」，
 // 而站里那个现在带着 ▶。按结构找，再验两个状态各自该有什么。
 await page.evaluate(()=>v.setTab('today'));
 // 倒计时更新只改变化的数字；刷新今日页保留表盘，不重播起始动画。
 {
   const stable = await page.evaluate(async()=>{
     const t=v.plugin.data.timer,keep={...t};
     t.status='running';t.duration=1500;t.remaining=542;v.tick();
     const dial=v.dialEl, digits=[...v.timerDigits];
     const positions=()=>v.timerDigits.map(e=>e.getBoundingClientRect().x);
     const before=positions();
     t.remaining=541;v.tick();
     const sameDigits=digits.every((e,i)=>e===v.timerDigits[i]);
     const fixed=positions().every((x,i)=>Math.abs(x-before[i])<.1);
     await v.refresh();
     const sameDial=dial===v.dialEl&&dial.isConnected;
     const reading=v.timerEl.textContent;
     // 三位分钟数仍然完整显示。
     t.remaining=10800;t.duration=10800;v.tick();
     const longReading=v.timerEl.textContent;
     Object.assign(t,keep);v.tick();
     return {sameDigits,fixed,sameDial,reading,longReading};
   });
   assert.deepEqual(stable,{sameDigits:true,fixed:true,sameDial:true,reading:'09:01',longReading:'180:00'});
 }
 const cta=page.locator('.os-focus-controls .os-primary'),stop=page.locator('.os-focus-controls .os-stop');
 // 验证数字的实际文本边界位于圆环内部，覆盖最小表盘与三位分钟数。
 {
   const overflow=await page.evaluate(()=>{
     const t=v.plugin.data.timer,keep={...t},dial=v.dialEl,failures=[];
     const width=dial.style.width;
     for(const size of [116,150,200]){
       dial.style.width=size+'px';
       for(const seconds of [220,542,1500,5999,6000,10800]){
         Object.assign(t,{status:'paused',duration:10800,remaining:seconds});v.tick();
         const d=dial.getBoundingClientRect(),cx=d.x+d.width/2,cy=d.y+d.height/2;
         const radius=d.width*.45;
         for(const digit of v.timerDigits){
           const range=document.createRange();range.selectNodeContents(digit);
           const r=range.getBoundingClientRect();
           for(const x of [r.left,r.right])for(const y of [r.top,r.bottom]){
             if(Math.hypot(x-cx,y-cy)>radius)failures.push({size,reading:v.timerEl.textContent});
           }
         }
       }
     }
     dial.style.width=width;Object.assign(t,keep);v.tick();
     return failures;
   });
   assert.deepEqual(overflow,[],'倒计时文字必须完整落在圆环内并留出间距');
 }
 assert.equal(await stop.isVisible(),false,'空闲时不该摆一个按不动的「结束」');
 // 等形变走完：flex-grow 有 340ms 过渡，80ms 时量到的是半路上的比例。
 await cta.click();await page.waitForTimeout(480);
 assert.match(await cta.textContent(),/暂停/,'跑起来开始键应变成暂停');
 assert.equal(await stop.isVisible(),true,'跑起来才出现结束键');
 {
   // 65 / 35。两个按钮在同一个 flex 行里，比例不对时宽度立刻看得出来。
   const w=await page.evaluate(()=>[document.querySelector('.os-focus-controls .os-primary').getBoundingClientRect().width,
                                    document.querySelector('.os-focus-controls .os-stop').getBoundingClientRect().width]);
   const share=w[0]/(w[0]+w[1]);
   assert.ok(share>0.58&&share<0.72,`暂停键占比 ${(share*100).toFixed(0)}%，应在 65% 上下`);
 }
 {
   // 进度环画的是已过：刚开始跑时几乎没有弧，而不是整整一圈。
   const dial=await page.evaluate(()=>{const a=document.querySelector('[data-arc]');
     return {len:Number(a.getAttribute('stroke-dasharray')),off:Number(getComputedStyle(a).strokeDashoffset.replace('px',''))};});
   // 容差：computed style 把 dashoffset 取到三位小数，和 dasharray 的原值差在小数点后第四位。
   assert.ok(dial.len>0&&dial.off>0&&dial.off<=dial.len+0.01,'刚起步时已过的弧应当接近于零：'+JSON.stringify(dial));

   // 圆点必须落在弧的末端。这一条是量出来的，不是看出来的——
   // 第一版把 -90° 加了两遍，圆点和弧尾差整整 90°，而上面那条断言照样通过：
   // 弧长是对的，只有圆点在别处。两者都在屏幕坐标系里比，跨过 SVG 自己的 -90° 旋转。
   //
   // 先暂停再量：跑起来时圆点带着 1s 的线性过渡，随时都在去往下一个位置的路上。
   await cta.click();await page.waitForTimeout(160);
   const gap=await page.evaluate(()=>{
     const arc=document.querySelector('[data-arc]'),bead=document.querySelector('.os-dial-bead');
     const len=Number(arc.getAttribute('stroke-dasharray'));
     const off=Number(getComputedStyle(arc).strokeDashoffset.replace('px',''));
     const drawn=len-off;                       // 已画出的弧长
     const p=arc.getPointAtLength(drawn);       // 弧尾在 SVG 用户坐标里的位置
     const m=arc.getScreenCTM();                // 连同 -90° 旋转一起映射到屏幕
     const tip={x:m.a*p.x+m.c*p.y+m.e, y:m.b*p.x+m.d*p.y+m.f};
     const r=bead.getBoundingClientRect();
     const dot={x:r.left+r.width/2, y:r.top+r.height/2};
     return {dist:Math.hypot(tip.x-dot.x,tip.y-dot.y), r:r.width/2};
   });
   assert.ok(gap.dist<=Math.max(3,gap.r),`圆点离弧尾 ${gap.dist.toFixed(1)}px，应当落在弧的末端上`);

   // 方向：圆点必须顺时针往前扫，不是逆时针往回退。
   // 这一条上面那条几何断言抓不到——画「剩余」时圆点同样死死贴在弧尾上，
   // 只是两个一起往回走。一张静止的截图也看不出来，只有隔着时间量两次才知道。
   {
     const dir=await page.evaluate(async()=>{
       const wrap=document.querySelector('.os-dial-bead-wrap');
       const ang=()=>{const m=new DOMMatrixReadOnly(getComputedStyle(wrap).transform);
         return (Math.atan2(m.b,m.a)*180/Math.PI+360)%360;};
       const t=v.plugin.data.timer,keep={...t};
       // 夹具的 remaining 是个定值，自己不会走：手动往下拨两格，隔着过渡量两次。
       t.status='running';t.duration=1500;t.remaining=1400;v.tick();
       await new Promise(r=>setTimeout(r,1100));const a=ang();
       t.remaining=1100;v.tick();
       await new Promise(r=>setTimeout(r,1100));const b=ang();
       Object.assign(t,keep);v.tick();
       return {a:Number(a.toFixed(1)),b:Number(b.toFixed(1))};
     });
     assert.ok(dir.b>dir.a,`时间走了，圆点却从 ${dir.a}° 退到 ${dir.b}°——进度环画的该是已过，不是剩余`);
   }
   await cta.click();await page.waitForTimeout(160);   // 恢复运行，后面的断言接着用
 }
 {
   // 三档模式：界面上三个，底下仍然是两个 phase。切到长休要真的把分钟数改掉，
   // 而不是只让按钮亮起来——后者看起来一样，读数却纹丝不动。
   await page.locator('.os-focus-controls .os-stop').click();await page.waitForTimeout(80);
   assert.equal(await page.locator('.os-modes .os-mode').count(),3);
   await page.getByRole('tab',{name:'长休 15m'}).click();await page.waitForTimeout(120);
   assert.equal(await page.locator('.os-time').textContent(),'15:00','切到长休读数要跟着变');
   assert.equal(await page.locator('.os-modes .os-mode.is-active').textContent(),'长休 15m');
   await page.getByRole('tab',{name:'专注 25m'}).click();await page.waitForTimeout(120);
   assert.equal(await page.locator('.os-time').textContent(),'25:00');
   // 轮次珠子：四颗，今天完成过一段就该点亮一颗。
   assert.equal(await page.locator('.os-bead').count(),4);
   assert.ok(await page.locator('.os-bead.is-done').count()>=1,'夹具里今天有一段完成的专注，至少该亮一颗');
 }
 {
   // 空转的 tick 不许碰 DOM。
   //
   // tick 每秒跑一次，而里面大半的文字一秒都不会变。textContent 赋值即使内容一模一样
   // 也会拆掉旧文本节点再建一个，于是按钮、任务标题、项目名每秒重绘一遍——
   // 那个带渐变和阴影的大漆按钮尤其看得出来。这条断言把「没变就别写」钉死。
   //
   // 只看 childList 和 characterData：paintDial 每拍写 style 是应该的，那是它的工作。
   const churn=await page.evaluate(()=>{
     const t=v.plugin.data.timer,keep={...t};
     t.status='idle';v.tick();          // 先跑一次让所有文字落到稳态
     const root=document.querySelector('.os-focus');
     // 直接读 takeRecords 的返回值，不依赖回调——回调是微任务，
     // 而 page.evaluate 这一段是同步跑完的，回调根本轮不上。
     // 第一版就栽在这儿：takeRecords() 清空队列却没人看，断言永远是 0。
     const mo=new MutationObserver(()=>{});
     mo.observe(root,{childList:true,characterData:true,subtree:true});
     for(let i=0;i<3;i++)v.tick();
     const recs=mo.takeRecords();
     mo.disconnect();
     Object.assign(t,keep);v.tick();
     return {hits:recs.length, seen:recs.slice(0,4).map(m=>m.type+'@'+(m.target.className||m.target.parentElement?.className||m.target.nodeName))};
   });
   assert.equal(churn.hits,0,`状态没变的三次 tick 改动了 DOM ${churn.hits} 次：${churn.seen.join(', ')}`);
 }
 // 7.0 三栏之后窄屏的分档没变，但三栏各归哪一档要逐栏验：
 // 「专注与阅读」只留专注栏，「今日行动」留要务栏和行动栏。
 await page.setViewportSize({width:420,height:720});await page.getByRole('button',{name:'专注与阅读',exact:true}).click();
 assert.equal(await page.locator('.os-today-col.is-focus').isVisible(),true,'专注与阅读档应显示专注栏');
 assert.equal(await page.locator('.os-today-col.is-intent').isVisible(),false,'专注与阅读档不该显示今日要务');
 assert.equal(await page.locator('.os-today-col.is-actions').isVisible(),false,'专注与阅读档不该显示下一步行动');
 await page.getByRole('button',{name:'今日行动',exact:true}).click();
 assert.equal(await page.locator('.os-today-col.is-focus').isVisible(),false,'今日行动档不该显示专注栏');
 assert.equal(await page.locator('.os-today-col.is-intent').isVisible(),true,'今日行动档应显示今日要务');
 assert.equal(await page.locator('.os-today-col.is-actions').isVisible(),true,'今日行动档应显示下一步行动');
 await page.getByRole('button',{name:'专注与阅读',exact:true}).click();
 await page.setViewportSize({width:1100,height:720});await page.evaluate(()=>v.setTab('tasks'));
 // 7.0：动作收起时 pointer-events 也关掉——看不见的东西不该能点。
 // 所以要先把鼠标移到行上，和真人的操作顺序一致。
 await page.locator('.os-task-row').first().hover();
 await page.locator('.os-row-actions').first().getByRole('button',{name:'删除',exact:true}).click();
 await page.getByRole('button',{name:'已删除',exact:true}).click();assert.equal(await page.locator('.os-task-row').count(),1);
 await page.locator('.os-task-row').first().hover();
 await page.getByRole('button',{name:'恢复',exact:true}).click();assert.equal(await page.locator('.os-task-row').count(),0);
 await page.evaluate(()=>v.setTab('library'));await page.getByRole('button',{name:'新建笔记',exact:true}).click();assert.equal(await page.evaluate(()=>window.noteCreated),true);
 await page.locator('.os-note-row').first().click();await page.getByRole('button',{name:'标记完成',exact:true}).click();assert.equal(await page.evaluate(()=>window.noteAction),'done');
 await page.getByRole('button',{name:'置为待办',exact:true}).click();assert.equal(await page.evaluate(()=>window.noteAction),'reopen');
 await page.getByRole('button',{name:'删除笔记',exact:true}).click();assert.equal(await page.evaluate(()=>window.noteAction),'delete');
 await page.evaluate(()=>v.setTab('today'));
 await page.evaluate(()=>v.setTab('tasks'));await page.getByRole('button',{name:'待办',exact:true}).click();
 const firstRow=page.locator('.os-task-row').first();
 // 5.4：任务行动作平时收起、悬停或键盘聚焦时显现；且必须留在 Tab 顺序里。
 {
  const actions=firstRow.locator('.os-row-actions');
  // 等浮现走完：6.6 把这条过渡从 120ms 拉到 220ms 并统一了缓动，
  // 200ms 时量到的是 0.999——不是没显现，是还差最后一点。
  assert.equal(await actions.evaluate(e=>getComputedStyle(e).opacity),'0','动作应默认收起');
  // 7.0：收起时不占行宽，也不接收点击。前者是这次三栏布局的前提——
  // 原来 flex:none + opacity:0 让它在 495px 的行里永久占着 286px，
  // 任务标题只剩 164px，折行、药丸被截。
  assert.equal(await actions.evaluate(e=>getComputedStyle(e).position),'absolute','收起的动作不许占行宽');
  assert.equal(await actions.evaluate(e=>getComputedStyle(e).pointerEvents),'none','收起的动作不许能点');
  const mainWide=await firstRow.locator('.os-row-main').evaluate(e=>e.getBoundingClientRect().width);
  const rowWide=await firstRow.evaluate(e=>e.getBoundingClientRect().width);
  assert.ok(mainWide>rowWide*0.7,`任务标题应占行宽的大半，实测 ${Math.round(mainWide)}/${Math.round(rowWide)}`);
  await firstRow.hover();await page.waitForTimeout(400);
  assert.equal(await actions.evaluate(e=>getComputedStyle(e).opacity),'1','悬停后动作应显现');
  assert.equal(await actions.evaluate(e=>getComputedStyle(e).pointerEvents),'auto','悬停后动作要能点');
  const reachable=await actions.evaluate(e=>[...e.querySelectorAll('button')].every(b=>b.offsetParent!==null&&getComputedStyle(b).visibility!=='hidden'));
  assert.ok(reachable,'动作按钮不得移出 Tab 顺序');
  await page.mouse.move(0,0);await page.waitForTimeout(400);
  await firstRow.locator('.os-row-actions button').first().focus();await page.waitForTimeout(400);
  assert.equal(await actions.evaluate(e=>getComputedStyle(e).opacity),'1','键盘聚焦时动作应显现');
 }
await firstRow.hover();await page.waitForTimeout(300);await firstRow.getByRole('button',{name:'补充详情'}).click();
 await page.locator('.os-detail-modal').waitFor();
 await page.getByLabel('下一步',{exact:true}).fill('在行动页完成推导');await page.getByLabel('下一步',{exact:true}).press('Tab');await page.waitForTimeout(60);
 assert.equal(await page.evaluate(()=>fixtureTasks[0].next_action),'在行动页完成推导');assert.equal(await page.evaluate(()=>v.tab),'tasks');
 await page.getByLabel('预计番茄数',{exact:true}).fill('2');await page.getByLabel('预计番茄数',{exact:true}).press('Tab');await page.waitForTimeout(60);
 assert.equal(await page.evaluate(()=>fixtureTasks[0].estimated_pomodoros),2);
 await page.evaluate(()=>{v.plugin.data.sessions.push({id:'budget-test',taskId:fixtureTasks[0].id,phase:'focus',seconds:3100});v.tick();});
 assert.equal(await firstRow.getAttribute('data-budget'),'over');
 await page.evaluate(()=>window.rejectPatch=true);await page.getByLabel('详细说明',{exact:true}).fill('保存失败仍保留的草稿');await page.getByLabel('详细说明',{exact:true}).press('Tab');await page.waitForTimeout(60);
 assert.equal(await page.getByLabel('详细说明',{exact:true}).inputValue(),'保存失败仍保留的草稿');assert.match(await page.locator('.os-detail-form .os-save-state').textContent(),/未保存/);
 await page.evaluate(()=>window.rejectPatch=false);await page.getByRole('button',{name:'重试保存',exact:true}).click();
 // 诉求就是一屏看完：弹窗本体在宽窄两种视口下都不得出现滚动。
 for(const size of [{width:1100,height:720},{width:420,height:720}]){
   await page.setViewportSize(size);await page.waitForTimeout(60);
   // 只量外层尺寸没有意义：溢出会被 .os-detail-form 的 overflow:hidden 裁掉，
   // 外层 scrollHeight 不变，而字段其实已经被切没了。直接量每个字段在不在可见框内。
   const layout=await page.locator('.os-detail-modal').evaluate(root=>{
     const b=root.getBoundingClientRect();
     const parts=[...root.querySelectorAll('.os-editor-field,.os-detail-actions button,.os-detail-actions .os-save-state')]
       .map(e=>{const r=e.getBoundingClientRect();return {name:(e.textContent||'').trim().slice(0,10),top:r.top,bottom:r.bottom,left:r.left,right:r.right};});
     const scrollers=[...root.querySelectorAll('*')]
       .filter(e=>e.scrollHeight>e.clientHeight+1&&!e.classList.contains('os-detail-list'))
       // 带上超出多少、以及里面每一块多高：只报类名的话，失败时只能猜。
       .map(e=>`${e.className||e.tagName} ${e.scrollHeight}/${e.clientHeight} [${[...e.children].map(c=>`${c.className||c.tagName}:${Math.round(c.getBoundingClientRect().height)}`).join(' ')}]`);
     return {box:{top:b.top,bottom:b.bottom,left:b.left,right:b.right},parts,scrollers};
   });
   assert.deepEqual(layout.scrollers,[],'补充详情弹窗出现非预期滚动容器：'+JSON.stringify({...size,scrollers:layout.scrollers}));
   assert.ok(layout.parts.length>=7,'字段数量异常：'+layout.parts.length);
   for(const part of layout.parts){
     assert.ok(part.top>=layout.box.top-1&&part.bottom<=layout.box.bottom+1&&part.left>=layout.box.left-1&&part.right<=layout.box.right+1,
       '补充详情内容超出弹窗可见范围：'+JSON.stringify({...size,part,box:layout.box}));
   }
 }
 await page.setViewportSize({width:1100,height:720});await page.waitForTimeout(60);
 await page.screenshot({path:path.join(out,'detail-modal.png')});
 await page.locator('.os-detail-modal').getByRole('button',{name:'完成',exact:true}).click();
 await page.locator('.os-detail-modal').waitFor({state:'detached'});
 // 子任务多到放不下时：弹窗封顶在上限，只有子任务列表自己滚，字段仍然全部可见。
 await page.evaluate(()=>{fixtureTasks[0].checklist=Array.from({length:24},(_,i)=>({text:'子任务 '+(i+1)+' · 验证长清单时的滚动边界',done:i%3===0}));});
 await firstRow.hover();await firstRow.getByRole('button',{name:'补充详情'}).click();await page.locator('.os-detail-modal').waitFor();
 const long=await page.locator('.os-detail-modal').evaluate(root=>{
   const b=root.getBoundingClientRect(),list=root.querySelector('.os-detail-list');
   const parts=[...root.querySelectorAll('.os-editor-field,.os-detail-actions button')]
     .map(e=>{const r=e.getBoundingClientRect();return {name:(e.textContent||'').trim().slice(0,10),top:r.top,bottom:r.bottom};});
   const scrollers=[...root.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+1&&!e.classList.contains('os-detail-list')).map(e=>e.className);
   return {height:b.height,top:b.top,bottom:b.bottom,listScrolls:!!list&&list.scrollHeight>list.clientHeight+1,scrollers,parts};
 });
 assert.ok(long.listScrolls,'长清单未在子任务区内部滚动');
 assert.deepEqual(long.scrollers,[],'子任务之外出现滚动容器：'+JSON.stringify(long.scrollers));
 assert.ok(long.height<=620+1,'弹窗超过高度上限：'+long.height);
 for(const part of long.parts)assert.ok(part.top>=long.top-1&&part.bottom<=long.bottom+1,'长清单下字段被挤出可见范围：'+JSON.stringify(part));
 await page.screenshot({path:path.join(out,'detail-modal-checklist.png')});
 await page.locator('.os-detail-modal').getByRole('button',{name:'完成',exact:true}).click();
 await page.locator('.os-detail-modal').waitFor({state:'detached'});
 await page.evaluate(()=>{delete fixtureTasks[0].checklist;});
 await firstRow.hover();await firstRow.getByRole('button',{name:'设为今日要务'}).click();assert.equal(await firstRow.getAttribute('data-focus'),'true');
 await page.evaluate(()=>v.setTab('projects'));
 await page.getByRole('button',{name:'新建 / 管理项目',exact:true}).click();await page.getByPlaceholder('新项目名称',{exact:true}).fill('内联测试项目');await page.getByRole('button',{name:'创建项目',exact:true}).click();
 await page.getByLabel('项目下一步',{exact:true}).fill('在行动页补充项目');await page.getByLabel('项目下一步',{exact:true}).press('Tab');await page.waitForTimeout(60);
  await page.setViewportSize({width:420,height:720});const projectModalFields=await page.locator('.os-project-editor input,.os-project-editor select').evaluateAll(fields=>fields.map(field=>{const a=field.getBoundingClientRect(),b=field.closest('.os-project-editor').getBoundingClientRect();return {left:a.left,right:a.right,parentLeft:b.left,parentRight:b.right};}));assert.ok(projectModalFields.every(field=>field.left>=field.parentLeft-1&&field.right<=field.parentRight+1),JSON.stringify(projectModalFields));await page.setViewportSize({width:1100,height:720});
  assert.equal(await page.evaluate(()=>window.projectPatch.next),'在行动页补充项目');assert.equal(await page.evaluate(()=>v.tab),'projects');
 await page.getByRole('button',{name:'收起项目设置',exact:true}).click();await page.evaluate(()=>{for(const e of document.querySelectorAll('body>div'))if(e.style.position==='fixed')e.remove();});
 await page.evaluate(()=>v.refresh(true));await page.getByRole('button',{name:'编辑项目',exact:true}).last().click();assert.equal(await page.getByLabel('项目名称',{exact:true}).inputValue(),'内联测试项目');await page.getByLabel('项目名称',{exact:true}).fill('重命名测试项目');await page.getByLabel('项目名称',{exact:true}).press('Tab');await page.waitForTimeout(60);assert.equal(await page.evaluate(()=>window.projectRename.name),'02 项目/重命名测试项目.md');await page.getByRole('button',{name:'收起项目设置',exact:true}).click();await page.evaluate(()=>{for(const e of document.querySelectorAll('body>div'))if(e.style.position==='fixed')e.remove();});await page.evaluate(()=>v.refresh(true));page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'删除项目',exact:true}).last().click();await page.waitForTimeout(60);assert.equal(await page.evaluate(()=>window.projectDeleted),'02 项目/重命名测试项目.md');
 await page.evaluate(()=>v.setTab('today'));
 // 7.1 起今日页中间那张卡是「今日课程」，不再显示今日要务；7.4 连专注台的绑定条也拿掉了，
 // 要务只在行动页那一行上标出来（上面 data-focus 已验）。
 // 课程随真实日期变（夹具用的是真课表），这里只断言卡在、有内容。
 assert.ok((await page.locator('.os-course-intent-title, .os-course-intent-empty').first().textContent()).trim());
 {
   // 阅读进度条：只在知道总页数时出现，宽度按 页/总页 算。
   const bar=await page.evaluate(()=>{const t=document.querySelector('.os-read-track');
     return t?{有:true,占比:t.querySelector('.os-read-fill').style.width,标签:t.getAttribute('aria-label')}:{有:false};});
   assert.equal(bar.有,true,'夹具的教材记录带 totalPages，应当画出进度条');
   assert.equal(bar.占比,'13.1%','42 / 320');
 }
 await page.screenshot({path:path.join(out,'focus-selected.png')});
 await page.evaluate(()=>v.setTab('tasks'));
 await page.getByPlaceholder('添加今日任务，Enter 设置番茄数').fill('今日快速任务');await page.getByRole('button',{name:'添加',exact:true}).click();
  assert.equal(await page.getByLabel('任务名称 *',{exact:true}).inputValue(),'今日快速任务');await page.getByRole('button',{name:'+1🍅',exact:true}).click();await page.locator('.los-task-modal').evaluate(e=>e.scrollTop=e.scrollHeight);await page.getByRole('button',{name:'创建任务',exact:true}).evaluate(button=>button.form.requestSubmit(button));
 assert.equal(await page.evaluate(()=>window.createdTask.repeat),'once');assert.equal(await page.evaluate(()=>window.createdTask.estimated_pomodoros),'2');assert.equal(await page.evaluate(()=>window.createdTask.scheduled===previewModel.dayKey()),true);
 await page.getByRole('button',{name:'＋ 新任务',exact:true}).click();await page.getByLabel('任务名称 *',{exact:true}).fill('完整任务');await page.getByLabel('所属项目',{exact:true}).selectOption('02 项目/本周学习计划.md');await page.getByLabel('优先级',{exact:true}).selectOption('P1');await page.getByLabel('周期与重复',{exact:true}).selectOption('weekly');await page.getByLabel('预计成果 / 完成标准',{exact:true}).fill('交付一张卡片');await page.getByRole('button',{name:'＋ 添加子任务',exact:true}).click();await page.getByLabel('子任务内容',{exact:true}).fill('完成推导');
   await page.getByText('高级设置',{exact:true}).click();await page.getByLabel('单番茄时长（分钟）',{exact:true}).fill('40');await page.evaluate(()=>document.querySelector('.los-task-modal').scrollTop=0);await page.screenshot({path:path.join(out,'task-modal.png')});for(const width of [420,360]){await page.setViewportSize({width,height:720});assert.equal(await page.locator('.los-task-modal').evaluate(e=>e.scrollWidth<=e.clientWidth+2),true);const taskModalFields=await page.locator('.los-task-modal input:not([type=checkbox]),.los-task-modal select,.los-task-modal textarea').evaluateAll(fields=>fields.map(field=>{const a=field.getBoundingClientRect(),b=field.closest('.los-task-modal').getBoundingClientRect();return {left:a.left,right:a.right,parentLeft:b.left,parentRight:b.right,visible:a.width>0&&a.height>0};}));assert.ok(taskModalFields.filter(field=>field.visible).every(field=>field.left>=field.parentLeft-1&&field.right<=field.parentRight+1),JSON.stringify(taskModalFields));}await page.setViewportSize({width:1100,height:720});await page.locator('.los-task-modal').evaluate(e=>e.scrollTop=e.scrollHeight);await page.evaluate(()=>window.failCreate=true);await page.getByRole('button',{name:'创建任务',exact:true}).evaluate(button=>button.form.requestSubmit(button));assert.equal(await page.getByLabel('任务名称 *',{exact:true}).inputValue(),'完整任务');await page.evaluate(()=>window.failCreate=false);await page.getByRole('button',{name:'创建任务',exact:true}).evaluate(button=>button.form.requestSubmit(button));assert.equal(await page.evaluate(()=>window.createdTask.checklist[0].text),'完成推导');assert.equal(await page.evaluate(()=>window.createdTask.repeat),'weekly');
 await page.evaluate(()=>v.setTab('today'));await page.waitForTimeout(60);await page.locator('.os-heat-mini').click();await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>v.tab),'daily');assert.ok(await page.locator('.os-heat-chart').evaluate(e=>{const body=e.closest('.os-panel-body'),a=e.getBoundingClientRect(),b=body.getBoundingClientRect();return a.top>=b.top-1&&a.top<b.bottom;}),'点小热力图之后热力那一行应在视口里');await page.evaluate(()=>v.setTab('daily'));await page.waitForTimeout(60);assert.deepEqual(await page.locator('.os-ledger-col').first().locator('.os-ledger-row').evaluateAll(rows=>rows.map(r=>r.className.match(/is-(missing|empty|measuring|short|done)/)[1])),['done','measuring','missing']);assert.deepEqual(await page.locator('.os-ledger-col').nth(1).locator('.os-ledger-row').evaluateAll(rows=>rows.map(r=>r.className.match(/is-(missing|empty|measuring|short|done)/)[1])),['done','short','empty']);assert.equal(await page.locator('.os-ledger-col').nth(1).locator('.os-ledger-pages').nth(1).innerText(),'1.4 / 2 页');assert.deepEqual(await page.locator('.os-ledger-backlog .os-ledger-row').evaluateAll(rows=>rows.map(r=>r.className.match(/is-(missing|empty|measuring|short|done)/)[1])),['empty','missing']);const nextRows=page.locator('.os-ledger-col').nth(2).locator('.os-ledger-row');assert.equal(await nextRows.count(),3);assert.equal(await nextRows.nth(1).isDisabled(),true);assert.equal(await nextRows.nth(1).evaluate(e=>getComputedStyle(e).opacity),'1');await page.locator('.os-ledger-col').nth(1).locator('.os-ledger-row').first().click();assert.equal(await page.evaluate(()=>window.openedClassNote),'静力学与结构力学');await page.getByRole('button',{name:'选择课程',exact:true}).click();assert.equal(await page.locator('.os-note-course input').count(),4);await page.getByLabel('化工过程计算 记课堂笔记',{exact:true}).uncheck();await page.waitForTimeout(30);assert.deepEqual(await page.evaluate(()=>window.noteCourse),{id:'060112',on:false});await page.keyboard.press('Escape');await page.evaluate(()=>document.querySelector('.modal-container')?.remove());await page.screenshot({path:path.join(out,'daily-compact.png')});await page.evaluate(()=>v.setTab('today'));
 // 今日页不再有要务选择器，也没有绑定条。
 assert.equal(await page.locator('.os-focus-picker, .os-focus-bind').count(),0);
 await page.evaluate(()=>{const e=document.createElement('div');e.className='markdown-preview-view';e.style.position='fixed';e.innerHTML='<div class="inline-title">版本迭代</div><h1>版本迭代</h1>';document.body.append(e);});
 assert.equal(await page.locator('.inline-title').isVisible(),false);assert.equal(await page.locator('.markdown-preview-view h1').isVisible(),true);
 // 同屏可见任务行数。6.1 之前是 5 条：行高 117px，其中一行是从不填的预算字段
 // 渲染出的固定噪声。这里量的是「完整落在面板可视区内」的行，不是 DOM 里的总数。
 await page.setViewportSize({width:1600,height:900});
 await page.evaluate(()=>v.setTab('tasks'));await page.waitForTimeout(220);
 const density=await page.evaluate(()=>{
  const rows=[...document.querySelectorAll('.os-task-row')];
  if(!rows.length)return {visible:0,pitch:0};
  const body=rows[0].closest('[data-scroll],.os-panel-body')||rows[0].parentElement;
  const box=body.getBoundingClientRect();
  const visible=rows.filter(r=>{const b=r.getBoundingClientRect();return b.top>=box.top-0.5&&b.bottom<=box.bottom+0.5;}).length;
  const pitch=rows.length>1?Math.round(rows[1].getBoundingClientRect().top-rows[0].getBoundingClientRect().top):0;
  return {visible,pitch};
 });
 console.log(`行动页密度：同屏 ${density.visible} 条，行距 ${density.pitch}px`);
 assert.ok(density.visible>=9,`同屏可见任务行 ${density.visible} 条，6.1 起不应少于 9（6.0 是 5 条）`);
 assert.ok(density.pitch>0&&density.pitch<=70,`行距 ${density.pitch}px，应不超过 70（6.0 是 117）`);

 // 6.4 挂件设置弹窗。新弹窗最容易出的问题是字段横向溢出——
 // 这里量的是每个输入框在不在弹窗可见框内，而不是弹窗自己 scrollWidth 有没有变，
 // 后者会被 overflow-x:hidden 裁掉，量不出来。
 await page.evaluate(()=>v.setTab('today'));
 {
  await page.setViewportSize({width:1100,height:720});await page.waitForTimeout(80);
  const fit=await page.evaluate(()=>{
   const stats=document.querySelector('.os-stats .os-panel-body'),scratch=document.querySelector('.os-scratchpad .os-panel-body');
   return {stats:[stats.clientHeight,stats.scrollHeight],scratch:[scratch.clientHeight,scratch.scrollHeight]};
  });
  assert.ok(fit.stats[1]<=fit.stats[0]+1,'统计卡不应出现模块内滚动：'+JSON.stringify(fit));
  assert.ok(fit.scratch[1]<=fit.scratch[0]+1,'闪念卡外层不应出现模块内滚动：'+JSON.stringify(fit));
  const scratch=page.getByLabel('快捷闪念草稿',{exact:true});
  await scratch.fill(String.raw`动量 \( p=mv \)`);await page.waitForTimeout(360);
  assert.equal(await page.locator('.os-scratchpad-preview').textContent(),'动量 $p=mv$','闪念预览应转换 LaTeX 定界符');
  assert.equal(await page.evaluate(()=>v.plugin.data.quickNotesDraft),String.raw`动量 \( p=mv \)`,'草稿应自动写入工作台数据');
  const columns=await page.evaluate(()=>({scratch:document.querySelector('.os-scratchpad').parentElement.className,stats:document.querySelector('.os-stats').parentElement.className}));
  assert.equal(columns.scratch,columns.stats,'快捷闪念必须和统计数据在同一中间栏');
  await page.getByLabel('清空快捷闪念草稿',{exact:true}).click();
  assert.equal(await scratch.inputValue(),'','清空后输入框应为空');
  assert.equal(await page.evaluate(()=>v.plugin.data.quickNotesDraft),'','清空后持久化草稿也应为空');
  await page.screenshot({path:path.join(out,'scratchpad-middle.png')});
 }
 // 7.4：挂件设置从左栏挪到页头右上角，左栏不再有这个入口，也不再有「快速捕获」。
 {
  const entry=await page.evaluate(()=>{
    const gear=document.querySelector('.os-header-gear'),header=document.querySelector('.os-header').getBoundingClientRect();
    const r=gear?.getBoundingClientRect(),last=[...document.querySelectorAll('.os-header-actions>button')].filter(b=>!b.hidden).pop();
    return {gear:!!gear&&!gear.hidden&&r.width>0,inHeader:!!r&&r.right<=header.right+1&&r.top>=header.top-1,last:last===gear,
      railGear:!!document.querySelector('.os-rail .ow-gear'),capture:!!document.querySelector('.os-rail .os-capture'),
      railText:document.querySelector('.os-rail').textContent};
  });
  assert.ok(entry.gear&&entry.inHeader&&entry.last,'挂件设置应在页头右上角最后一个：'+JSON.stringify(entry));
  assert.ok(!entry.railGear&&!entry.railText.includes('挂件设置'),'左栏不应再有挂件设置');
  assert.ok(!entry.capture&&!entry.railText.includes('快速捕获'),'左栏不应再有快速捕获');
 }
 await page.getByRole('button',{name:'挂件设置',exact:true}).click();
 await page.locator('.ow-settings').waitFor();
 assert.equal(await page.locator('.ow-order-row').count(),4,'四个挂件都应出现在排序列表里');
 {
  await page.locator('.ow-section').filter({hasText:'背景'}).evaluate(d=>{d.open=true;});
  const level=page.getByLabel('背景图可见度百分比',{exact:true});
  assert.equal(await level.inputValue(),'14','新安装的背景图可见度默认应为 14%');
  await level.fill('38');await level.press('Tab');await page.waitForTimeout(60);
  const wallpaper=await page.evaluate(()=>({
   visibility:widgetData.wallpaper.visibility,
   scrim:document.documentElement.style.getPropertyValue('--os-scrim-opacity').trim(),
   computed:getComputedStyle(document.querySelector('.os-root')).getPropertyValue('--os-scrim').trim(),
  }));
  assert.equal(wallpaper.visibility,38,'拖动百分比后应保存');
  assert.equal(wallpaper.scrim,'0.62','38% 图片可见度应换算为 62% 遮罩');
  assert.match(wallpaper.computed,/0\.62\)/,'工作台实际使用的遮罩必须读到调节值');
 }
 for(const size of [{width:1100,height:720},{width:420,height:720}]){
  await page.setViewportSize(size);await page.waitForTimeout(60);
  await page.evaluate(()=>{for(const d of document.querySelectorAll('.ow-section'))d.open=true;});
  const fields=await page.locator('.ow-settings').evaluate(root=>{
    const b=root.getBoundingClientRect();
    return [...root.querySelectorAll('input,textarea,button')].map(e=>{const r=e.getBoundingClientRect();return {name:(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,12),left:r.left,right:r.right,wide:r.width>0,boxLeft:b.left,boxRight:b.right};});
  });
  for(const field of fields.filter(x=>x.wide))assert.ok(field.left>=field.boxLeft-1&&field.right<=field.boxRight+1,'挂件设置字段溢出弹窗：'+JSON.stringify({...size,field}));
 }
 await page.setViewportSize({width:1100,height:720});await page.waitForTimeout(60);
 {
  // 滚到底之后，「关闭」必须落在弹窗可见框内。这一条才是用户的诉求：够得着。
  await page.evaluate(()=>{const p=document.querySelector('.ow-settings');p.scrollTop=p.scrollHeight;});
  await page.waitForTimeout(60);
  const reach=await page.evaluate(()=>{
    const panel=document.querySelector('.ow-settings'),modal=panel.closest('.modal');
    const m=modal.getBoundingClientRect(),p=panel.getBoundingClientRect();
    const close=[...panel.querySelectorAll('.ow-actions button')].pop().getBoundingClientRect();
    return {panelBelow:p.bottom-m.bottom,closeBelow:close.bottom-m.bottom,scrolls:panel.scrollHeight>panel.clientHeight+1};
  });
  assert.ok(reach.panelBelow<=1,`挂件设置面板伸出弹窗 ${Math.round(reach.panelBelow)}px，会被裁掉`);
  assert.ok(reach.closeBelow<=1,`滚到底后「关闭」仍在弹窗外 ${Math.round(reach.closeBelow)}px，够不着`);
 }
 await page.screenshot({path:path.join(out,'widgets-settings.png')});
 // 玻璃浓度：拖动要实时写到根节点的 --os-glass-tint，面板的底色要真的跟着变淡；松手才保存。
 {
  const tint=page.getByLabel('玻璃浓度：0 极清透，100 全着色',{exact:true});
  const before=await page.evaluate(()=>{const s=getComputedStyle(document.querySelector('.os-panel'));return s.backgroundImage+'|'+s.backgroundColor;});
  await tint.fill('0');
  assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--os-glass-tint').trim()),'0');
  const after=await page.evaluate(()=>{const s=getComputedStyle(document.querySelector('.os-panel'));return s.backgroundImage+'|'+s.backgroundColor;});
  assert.notEqual(after,before,'玻璃浓度拖到 0，面板底色应当变');
  assert.equal(await page.evaluate(()=>window.widgets.data.wallpaper.glassTint),0);
  await tint.fill('50');
  assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--os-glass-tint').trim()),'0.5');
 }
 // 关掉一个挂件立刻落盘并重画左栏：设置弹窗没有「保存」按钮，这条是它的契约。
 await page.getByLabel('显示天气挂件',{exact:true}).uncheck();await page.waitForTimeout(60);
 assert.equal(await page.locator('.os-widgets .ow-card').count(),3,'取消勾选后左栏应少一块');
 await page.getByLabel('显示天气挂件',{exact:true}).check();await page.waitForTimeout(60);
 assert.equal(await page.locator('.os-widgets .ow-card').count(),4);
 // 语录清空后恢复默认，而不是留下一块空卡片。
 await page.getByLabel('语录，每行一句',{exact:true}).fill('');await page.getByLabel('语录，每行一句',{exact:true}).press('Tab');await page.waitForTimeout(60);
 assert.ok((await page.locator('.ow-quote-text').textContent()).length>0,'清空语录后应回落到默认几句');
 {
  // 位置是三档轮换：导航上 -> 导航下 -> 页头 -> 回到导航上。每一档都要真的搬过去、立即落盘。
  const place=page.getByLabel(/^时间：/);
  const where=async()=>page.evaluate(()=>widgetData.order.find(e=>e.id==='clock').slot);
  await place.click();await page.waitForTimeout(80);
  assert.equal(await where(),'bottom','第一次点击应当换到导航下');
  assert.equal(await page.locator('.os-widgets-top .ow-card').count(),0,'时间搬走后上面那块应当空掉');
  assert.equal(await page.locator('.os-widgets-top').evaluate(e=>getComputedStyle(e).display),'none','上面那块空了要整块收起，不留一道缝');
  await place.click();await page.waitForTimeout(80);
  assert.equal(await where(),'header','第二次点击应当换到页头');
  assert.equal(await page.locator('.os-widgets-header .ow-card').count(),2,'页头这时应当是天气加时间两块');
  await place.click();await page.waitForTimeout(80);
  assert.equal(await where(),'top','第三次点击应当轮回导航上');
  assert.equal(await page.locator('.os-widgets-top .ow-card').count(),1,'轮回之后要搬得回来');
 }
 {
   // 拿不到 Node 时的退化路径。夹具的 require 桩给不出真正的 fs，
   // 正是移动端和任何非桌面环境的处境：壁纸默认开着，但必须安静地什么都不做——
   // 不设 --os-wallpaper、不抛异常、背景退回那两道渐变。
   const fallback=await page.evaluate(()=>({
     设了壁纸:document.body.style.getPropertyValue("--os-wallpaper").trim(),
     背景:getComputedStyle(document.querySelector(".os-root")).backgroundImage,
   }));
   assert.equal(fallback.设了壁纸,"","读不到聚焦目录时不该设壁纸变量");
   assert.match(fallback.背景,/radial-gradient/,"背景要退回那两道渐变");
   assert.ok(!fallback.背景.includes("url("),"退化之后背景里不该有图片层："+fallback.背景.slice(0,80));
 }
 await page.getByRole('button',{name:'关闭',exact:true}).click();
 await page.locator('.ow-settings').waitFor({state:'detached'});
 // 7.4 自编教材页。夹具里没有登记表，book/ 下那份教材应当以「未登记」出现，而不是空页。
 {
  await page.evaluate(()=>v.setTab('ownbooks'));await page.waitForTimeout(60);
  const own=await page.evaluate(()=>({title:document.querySelector('.os-heading h1').textContent,
    active:document.querySelector('.os-nav-button.is-active')?.textContent,
    groups:[...document.querySelectorAll('.os-own-series h3')].map(h=>h.textContent),
    rows:document.querySelectorAll('.os-own-book').length,
    status:document.querySelector('.os-page-status').textContent,
    registry:[...document.querySelectorAll('.os-page-ownbooks .os-tools button')].map(b=>b.textContent)}));
  assert.equal(own.title,'自编教材');
  assert.match(own.active,/自编教材/);
  assert.deepEqual(own.groups,['未登记'],'book/ 下没登记的 PDF 应归进未登记：'+JSON.stringify(own));
  assert.equal(own.rows,1);
  assert.match(own.status,/^1 本/);
  assert.deepEqual(own.registry,['新建登记表']);
  await page.screenshot({path:path.join(out,'own-books.png')});
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'layout-results.json'),JSON.stringify({results,errors,interactions:'search, complete, delete/restore, note CRUD controls, preview, recall, timer, mobile pane, weather, duplicate title'},null,2));
 console.log(`Passed ${results.length} layout checks and interactive flows. Screenshots: ${out}`);await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
