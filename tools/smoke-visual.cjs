const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'C:/Users/longf/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'../../workbench-checks/visual');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage();const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:1440,height:900});
 await page.setContent('<style>*{box-sizing:border-box}html,body{height:100%;margin:0}body{--font-interface:"Segoe UI","Microsoft YaHei",sans-serif}button,input{font:inherit}</style><div class="workspace-leaf-content" data-type="codex-workbench" style="height:100%"><div class="view-content" style="height:100%"></div></div>');
 // 令牌在 shared/tokens.css，由 tools/build.js 内联进产物样式。夹具读的是源码样式，
 // 必须自己按同样顺序补上，否则渲染出来的是一套没有任何 --os-* 的界面——
 // 字号、留白、描边全落到浏览器默认值，断言等于在测另一个东西。
 await page.addStyleTag({content:fs.readFileSync(path.join(root,'shared/tokens.css'),'utf8')});
 await page.addStyleTag({content:fs.readFileSync(path.join(root,'codex-workbench/styles.css'),'utf8')});
 // 5.4：el / btn 已合并到 shared/dom.js，各模块的 require 桩都要能解析它。
 await page.addScriptTag({content:`window.domModule=(()=>{const module={exports:{}};${fs.readFileSync(path.join(root,'shared/dom.js'),'utf8')};return module.exports;})();`});
 await page.addScriptTag({content:`window.dateModule=(()=>{const module={exports:{}};${fs.readFileSync(path.join(root,'shared/date.js'),'utf8')};return module.exports;})();window.previewModel=(()=>{const module={exports:{}};const require=name=>{if(name==='../shared/date')return window.dateModule;throw Error('Unexpected fixture dependency: '+name);};${fs.readFileSync(path.join(root,'codex-workbench/console-model.js'),'utf8')};return module.exports;})();`});
 await page.addScriptTag({content:`window.dueModule=(()=>{const module={exports:{}};const require=()=>({});${fs.readFileSync(path.join(root,'codex-workbench/due.js'),'utf8')};return module.exports;})();`});
 for(const [name,file]of [['budgetModule','budget.js'],['editorModule','action-editor.js']])await page.addScriptTag({content:`window.${name}=(()=>{const module={exports:{}};const require=n=>n.includes('shared/dom')?window.domModule:{};${fs.readFileSync(path.join(root,'codex-workbench',file),'utf8')};return module.exports;})();`});
 await page.addStyleTag({content:fs.readFileSync(path.join(root,'codex-capture/styles.css'),'utf8')});
 // 桩要还原 Obsidian 真实的 .modal > .modal-content > contentEl 结构，
 // 否则 styles.css 里 .modal:has(...) 的限高规则一条都不会命中，弹窗布局断言就等于在测桩。
 await page.addScriptTag({content:`window.FixtureModal=class {
   constructor(){
     this.containerEl=document.createElement('div');this.containerEl.className='modal-container';
     this.containerEl.style.cssText='position:fixed;inset:0;z-index:999;display:flex;align-items:center;justify-content:center';
     this.modalEl=document.createElement('div');this.modalEl.className='modal';
     this.modalEl.style.cssText='background:#fff8ef;max-width:94vw';
     this.wrapEl=document.createElement('div');this.wrapEl.className='modal-content';
     this.contentEl=document.createElement('div');
     this.wrapEl.append(this.contentEl);this.modalEl.append(this.wrapEl);this.containerEl.append(this.modalEl);
   }
   open(){document.body.append(this.containerEl);this.onOpen?.();}
   close(){this.containerEl.remove();this.onClose?.();}
 };`});
 await page.addScriptTag({content:`window.TaskModal=(()=>{const module={exports:{}};const require=n=>n==='obsidian'?{Modal:window.FixtureModal,Notice:class{}}:n.includes('shared/dom')?window.domModule:{day:()=>previewModel.dayKey()};${fs.readFileSync(path.join(root,'codex-capture/task-modal.js'),'utf8')};return module.exports.TaskModal;})();`});
 await page.addScriptTag({content:`window.detailModalModule=(()=>{const module={exports:{}};const require=n=>n==='obsidian'?{Modal:window.FixtureModal,Notice:class{constructor(t){window.lastNotice=t}}}:n.includes('shared/dom')?window.domModule:window.editorModule;${fs.readFileSync(path.join(root,'codex-workbench/detail-modal.js'),'utf8')};return module.exports;})();`});
 await page.addScriptTag({content:`window.ConsoleView=(()=>{const module={exports:{}};const require=name=>name.includes('shared/dom')?window.domModule:name.includes('console-model')?window.previewModel:name.includes('due')?window.dueModule:name.includes('detail-modal')?window.detailModalModule:name.includes('action-editor')?window.editorModule:name.includes('budget')?window.budgetModule:{ItemView:class{constructor(){this.contentEl=document.querySelector('.view-content')}registerEvent(){}},Notice:class{constructor(t){window.lastNotice=t}},Modal:window.FixtureModal,setIcon(e,name){e.textContent=({sun:'☀','check-square':'✓','book-open':'▤',flame:'♨',files:'▱','rotate-ccw':'↶'})[name]||'○'}};${fs.readFileSync(path.join(root,'codex-workbench/console-view.js'),'utf8')};return module.exports.ConsoleView;})();`});
 const courses=JSON.parse(fs.readFileSync(path.join(root,'codex-workbench/main.js'),'utf8').match(/const COURSES = (\[.*\]);/)[1]);
 await page.evaluate(async courses=>{
   const day=previewModel.dayKey();
   const files=Array.from({length:85},(_,i)=>({path:`03 知识库/学习笔记/${i===0?'数学分析 · 多元函数的微分与积分':'知识卡片 '+i}.md`,basename:i===0?'数学分析 · 多元函数的微分与积分':'知识卡片 '+i,extension:'md',stat:{mtime:Date.now()-i*1000}}));
   files.push({path:'book/数学分析 II · 教材.pdf',basename:'数学分析 II · 教材',extension:'pdf',stat:{mtime:1}});
   const tasks=Array.from({length:85},(_,i)=>({id:'task-'+i,index:i,text:['完成第三章例题，整理偏导数的几何意义','复习伯努利方程的适用条件','整理材料科学课堂笔记','推导连续性方程并检查量纲'][i%4]+(i>3?' '+i:''),path:'02 项目/本周学习计划.md',raw:'- [ ] test '+i,priority:i===0?2:0,done:false,scheduled:i<8?day:'',due:i===1?'2026-09-01':''}));
   const timer={status:'idle',phase:'focus',remaining:1500,duration:1500,task:''};
   const sessions=[{phase:'focus',seconds:1800,endedAt:Date.now(),task:'整理数学分析笔记',completed:true}];
   const records={'book/数学分析 II · 教材.pdf':{position:{page:42},annotations:[{kind:'question',note:'如何理解隐函数定理的局部性？',page:37}],daily:{[day]:1800},dailyPages:{[day]:[35,36,37,38,39,40,41,42]}}};
   const focus={manifest:{version:'4.5.0'},settings:()=>({focusMinutes:p.data.focusMinutes,breakMinutes:p.data.breakMinutes}),setSettings:async patch=>Object.assign(p.data,patch)};
 const capture={index:{all:async()=>tasks},createProject:async name=>{const file={path:'02 项目/'+name+'.md',basename:name,extension:'md'};files.push(file);return file;},renameProject:async(file,name)=>{const old=file.path;file.path='02 项目/'+name+'.md';file.basename=name;window.projectRename={old,name:file.path};return file;},deleteProject:async file=>{window.projectDeleted=file.path;files.splice(files.indexOf(file),1);},readProject:async()=>({}),patchProject:async(file,before,patch)=>{window.projectPatch=patch;},patchTask:async(t,patch)=>{if(window.rejectPatch)throw Error('模拟写入失败');Object.assign(t,patch);if(patch.title)t.text=patch.title;return t;},addTask:async text=>{tasks.push({id:'new',text,raw:'- [ ] '+text,path:'00 工作台/今日任务.md',scheduled:day});},manifest:{version:'4.0.0'},listTasks:async({filter='open',query=''}={})=>tasks.filter(t=>(filter==='deleted'?t.deleted:!t.deleted&&(filter==='done'?t.done:!t.done))&&(filter!=='today'||t.scheduled===day||t.due)&&(filter!=='overdue'||t.due)&&(t.text+t.path).includes(query)),taskStats:async()=>({open:tasks.filter(t=>!t.done).length,done:tasks.filter(t=>t.done).length}),createNote:()=>{window.noteCreated=true;},updateNote:async(file,action)=>{window.noteAction=action;if(action==='delete')files.splice(files.indexOf(file),1);},deleteTask:async t=>{t.deleted=true;},updateTask:async(t,action)=>{if(action==='restore')t.deleted=false;if(action==='done')t.done=true;if(action==='reopen')t.done=false;if(action==='today')t.scheduled=day;if(action==='unschedule')t.scheduled='';}};
   const cards=[{path:files[0].path,due:Date.now()-1000,interval:1,reviews:2}];
   const recall={manifest:{version:'1.0.0'},list:()=>cards,add:async path=>{if(!cards.some(c=>c.path===path))cards.push({path,due:0});},remove:async path=>{cards.splice(cards.findIndex(c=>c.path===path),1);},review:()=>{window.reviewOpened=true;}};
   const owners={'codex-focus':focus,'codex-capture':capture,'codex-recall':recall};
   const p={manifest:{version:'4.1.1'},views:new Set(),data:{timer,sessions,focusMinutes:25,breakMinutes:5,priorities:{[day]:'理解多元微积分，把关键推导写清楚'},lastTextbook:'book/数学分析 II · 教材.pdf'},study:{data:{records},overview:()=>{}},
    app:{plugins:{getPlugin:id=>owners[id]},workspace:{on:()=>({})},vault:{getFiles:()=>files,getMarkdownFiles:()=>files.filter(f=>f.extension==='md'),cachedRead:async()=> '# 多元函数的微分\n\n全微分描述函数在一点附近的线性变化。\n\n## 核心关系\n\ndf = fₓ dx + fᵧ dy\n\n存在偏导数，并不意味着函数在该点可微。需要检查各方向的变化能否统一为线性近似。\n\n## 下一次复习\n\n试着画出切平面，解释误差项为什么必须是高阶无穷小。'},metadataCache:{getFileCache:()=>({frontmatter:{tags:['数学','微积分']}}),resolvedLinks:{}}},
    focusSelection:{read:async()=>window.chosenFocus||'',select:async task=>{window.chosenFocus=task.id;return task;}},save:async()=>{},run:async fn=>fn(),open:async path=>{window.openedPath=path;},openDaily:async()=>{},captureTask:()=>{window.captured=true;},captureNote:()=>{},captureProject:()=>{},openVersionLog:()=>{},
    minutes:()=>timer.phase==='focus'?p.data.focusMinutes:p.data.breakMinutes,timerCore:{remaining:t=>t.remaining},
    toggle:async task=>{timer.task=task;timer.status=timer.status==='running'?'paused':'running';},stop:async()=>{timer.status='idle';},setPhase:async phase=>timer.phase=phase,
    updatePriority:async value=>{p.data.priorities[day]=value;},startPlan:async t=>{timer.task=t.text;timer.status='running';},
    courseCatalog:()=>courses,courseStateFor:c=>({next:c.id==='052475'?'第三章 · 完成全微分与复合函数求导练习':'整理本周课堂笔记，完成配套习题',exam:'2026-12-22'}),courseBooksFor:()=>[files.at(-1).path],courseStatsFor:()=>({minutes:50,questions:1}),startCourse:async()=>{},openCourse:async()=>{},configureCourse:()=>{},openTextbook:async f=>{window.openedPath=f.path;},openLastTextbook:async()=>{},
   };
   owners['codex-study']={engine:p.study,manifest:{version:'3.6.0'}};owners['codex-workbench']=p;
   p.dailyAudit=async()=>({seconds:1500,switches:1,interruptions:1,projects:{'02 项目/数学学习.md':900,'独立任务 / 临时杂项':600},done:[],pending:tasks.slice(0,3),outputs:files.slice(0,2)});p.daily=async()=>({path:'05 日记/'+day+'.md'});p.saveDailyFeedback=async()=>{};p.setTomorrow=async()=>{};p.rolloverDaily=async()=>{};files.push({path:'02 项目/本周学习计划.md',basename:'本周学习计划',extension:'md',stat:{mtime:1}});capture.app=p.app;capture.captureTask=options=>new TaskModal(capture,options).open();capture.createTask=async value=>{if(window.failCreate)throw Error('模拟保存失败');window.createdTask=value;};p.captureTask=()=>capture.captureTask();window.v=new ConsoleView({},p);window.fixtureTasks=tasks;await v.onOpen();
 },courses);
 const results=[];
 for(const theme of ['light','dark']){
  await page.evaluate(t=>document.body.className=t==='dark'?'theme-dark':'',theme);
  for(const [width,height] of [[1600,900],[1100,720],[760,640],[420,720],[360,600],[900,400],[320,480]]){
   await page.setViewportSize({width,height});
   // 5.3 侧栏：十项分三组后必须仍然装得下。宽松高度下导航区不许出现滚动；
   // 矮窗口允许导航区自己滚，但「快速捕获」等底部按钮必须始终留在视口内。
   {
    const rail=await page.evaluate(()=>{
      const nav=document.querySelector('.os-nav'),foot=document.querySelector('.os-rail-foot');
      const railEl=document.querySelector('.os-rail'),r=railEl.getBoundingClientRect(),f=foot.getBoundingClientRect();
      return {navScrolls:nav.scrollHeight>nav.clientHeight+1,
              buttons:nav.querySelectorAll('.os-nav-button').length,
              headings:nav.querySelectorAll('.os-nav-heading').length,
              footInside:f.bottom<=r.bottom+1&&f.top>=r.top-1&&f.height>0};
    });
    assert.equal(rail.buttons,5,`导航项数异常：${rail.buttons}`);
    assert.ok(rail.footInside,`侧栏底部按钮被挤出视口：${JSON.stringify({width,height})}`);
    if(height>=700&&width>=1100)assert.ok(!rail.navScrolls,`${width}x${height} 下导航区不应滚动`);
   }
   // 5.3：十个去处全部是顶层导航，学习与回顾不再有页内分段。
   for(const tab of ['today','tasks','projects','courses','books','questions','knowledge','daily','heatmap','recall']){
    await page.evaluate(tab=>v.setTab(tab),tab);await page.waitForTimeout(60);
    const result=await page.evaluate(tab=>{
      const bounded=['.os-root','.os-app','.os-main','.os-content','.os-today-grid','.os-audit-board'];
      const broken=bounded.flatMap(s=>[...document.querySelectorAll(s)]).filter(e=>e.clientHeight>0&&(e.scrollHeight>e.clientHeight+2||e.scrollWidth>e.clientWidth+2)).map(e=>({class:e.className,client:[e.clientWidth,e.clientHeight],scroll:[e.scrollWidth,e.scrollHeight]}));
      const bodyOverflow=document.documentElement.scrollHeight>innerHeight+2||document.documentElement.scrollWidth>innerWidth+2;
      const heatmap=tab==='heatmap'?(()=>{
        const wrap=document.querySelector('.os-heatmap-chart-wrap'),weekdays=[...document.querySelectorAll('.os-heatmap-weekdays span')],cells=[...document.querySelectorAll('.os-heatmap-cell')];
        const alignment=weekdays.map((label,index)=>{const a=label.getBoundingClientRect(),b=cells[index]?.getBoundingClientRect();return b?Math.abs((a.top+a.height/2)-(b.top+b.height/2)):Infinity;});
        return {scrollWidth:wrap?.scrollWidth||0,clientWidth:wrap?.clientWidth||0,maxRowDelta:Math.max(...alignment)};
      })():null;
       const auditFields=tab==='daily'?[...document.querySelectorAll('.os-audit-field input,.os-audit-card select')].map(field=>{const a=field.getBoundingClientRect(),b=field.closest('.os-audit-card-body').getBoundingClientRect(),style=getComputedStyle(field);return {left:a.left,right:a.right,parentLeft:b.left,parentRight:b.right,boxSizing:style.boxSizing,maxWidth:style.maxWidth};}):null;
       const projectFields=tab==='projects'?[...document.querySelectorAll('.os-project-container>.os-input')].map(field=>{const a=field.getBoundingClientRect(),b=field.parentElement.getBoundingClientRect();return {left:a.left,right:a.right,parentLeft:b.left,parentRight:b.right};}):null;
       return {broken,bodyOverflow,heatmap,auditFields,projectFields};
    },tab);
     if(tab==='daily'){assert.equal(await page.locator('.os-audit-board').evaluate(e=>e.scrollHeight===e.clientHeight&&getComputedStyle(e).overflowY==='hidden'),true);assert.equal(await page.locator('.os-audit-card').count(),6);assert.equal(result.auditFields.length,5);assert.ok(result.auditFields.every(field=>field.left>=field.parentLeft-1&&field.right<=field.parentRight+1&&field.boxSizing==='border-box'&&field.maxWidth!=='none'),JSON.stringify(result.auditFields));if(width===420&&theme==='light')await page.screenshot({path:path.join(out,'daily-mobile.png')});}
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
 await page.evaluate(()=>document.body.className='');await page.setViewportSize({width:1100,height:720});await page.evaluate(()=>v.setTab('tasks'));
 await page.getByPlaceholder('搜索任务或来源笔记').fill('伯努利');await page.waitForTimeout(200);
 assert.ok(await page.locator('.os-task-row').count()>0);assert.equal(await page.locator('.os-task-title').filter({hasText:'多元'}).count(),0);
 await page.locator('.os-check').first().click();assert.equal(await page.evaluate(()=>fixtureTasks.filter(t=>t.done).length),1);
 await page.evaluate(()=>v.setTab('knowledge'));await page.locator('.os-note-row').first().click();assert.ok(await page.locator('.os-excerpt').textContent());
 await page.getByRole('button',{name:'加入复习',exact:true}).click();
 await page.evaluate(()=>v.setTab('today'));await page.getByRole('button',{name:'开始专注',exact:true}).click();assert.equal(await page.getByRole('button',{name:'暂停',exact:true}).count(),1);
 await page.setViewportSize({width:420,height:720});await page.getByRole('button',{name:'专注与阅读',exact:true}).click();assert.equal(await page.locator('.os-today-right').isVisible(),true);assert.equal(await page.locator('.os-today-left').isVisible(),false);
 await page.setViewportSize({width:1100,height:720});await page.evaluate(()=>v.setTab('tasks'));
 await page.locator('.os-row-actions').first().getByRole('button',{name:'删除',exact:true}).click();
 await page.getByRole('button',{name:'已删除',exact:true}).click();assert.equal(await page.locator('.os-task-row').count(),1);
 await page.getByRole('button',{name:'恢复',exact:true}).click();assert.equal(await page.locator('.os-task-row').count(),0);
 await page.evaluate(()=>v.setTab('knowledge'));await page.getByRole('button',{name:'新建笔记',exact:true}).click();assert.equal(await page.evaluate(()=>window.noteCreated),true);
 await page.locator('.os-note-row').first().click();await page.getByRole('button',{name:'标记完成',exact:true}).click();assert.equal(await page.evaluate(()=>window.noteAction),'done');
 await page.getByRole('button',{name:'置为待办',exact:true}).click();assert.equal(await page.evaluate(()=>window.noteAction),'reopen');
 await page.getByRole('button',{name:'删除笔记',exact:true}).click();assert.equal(await page.evaluate(()=>window.noteAction),'delete');
 await page.evaluate(()=>v.setTab('today'));
 await page.evaluate(()=>v.setTab('tasks'));await page.getByRole('button',{name:'待办',exact:true}).click();
 const firstRow=page.locator('.os-task-row').first();
 // 5.4：任务行动作平时收起、悬停或键盘聚焦时显现；且必须留在 Tab 顺序里。
 {
  const actions=firstRow.locator('.os-row-actions');
  assert.equal(await actions.evaluate(e=>getComputedStyle(e).opacity),'0','动作应默认收起');
  await firstRow.hover();await page.waitForTimeout(200);
  assert.equal(await actions.evaluate(e=>getComputedStyle(e).opacity),'1','悬停后动作应显现');
  const reachable=await actions.evaluate(e=>[...e.querySelectorAll('button')].every(b=>b.offsetParent!==null&&getComputedStyle(b).visibility!=='hidden'));
  assert.ok(reachable,'动作按钮不得移出 Tab 顺序');
  await page.mouse.move(0,0);await page.waitForTimeout(200);
  await firstRow.locator('.os-row-actions button').first().focus();await page.waitForTimeout(200);
  assert.equal(await actions.evaluate(e=>getComputedStyle(e).opacity),'1','键盘聚焦时动作应显现');
 }
await firstRow.getByRole('button',{name:'补充详情'}).click();
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
       .map(e=>e.className||e.tagName);
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
 await firstRow.getByRole('button',{name:'补充详情'}).click();await page.locator('.os-detail-modal').waitFor();
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
 await firstRow.getByRole('button',{name:'设为今日要务'}).click();assert.equal(await firstRow.getAttribute('data-focus'),'true');
 await page.evaluate(()=>v.setTab('projects'));
 await page.getByRole('button',{name:'新建 / 管理项目',exact:true}).click();await page.getByPlaceholder('新项目名称',{exact:true}).fill('内联测试项目');await page.getByRole('button',{name:'创建项目',exact:true}).click();
 await page.getByLabel('项目下一步',{exact:true}).fill('在行动页补充项目');await page.getByLabel('项目下一步',{exact:true}).press('Tab');await page.waitForTimeout(60);
  await page.setViewportSize({width:420,height:720});const projectModalFields=await page.locator('.os-project-editor input,.os-project-editor select').evaluateAll(fields=>fields.map(field=>{const a=field.getBoundingClientRect(),b=field.closest('.os-project-editor').getBoundingClientRect();return {left:a.left,right:a.right,parentLeft:b.left,parentRight:b.right};}));assert.ok(projectModalFields.every(field=>field.left>=field.parentLeft-1&&field.right<=field.parentRight+1),JSON.stringify(projectModalFields));await page.setViewportSize({width:1100,height:720});
  assert.equal(await page.evaluate(()=>window.projectPatch.next),'在行动页补充项目');assert.equal(await page.evaluate(()=>v.tab),'projects');
 await page.getByRole('button',{name:'收起项目设置',exact:true}).click();await page.evaluate(()=>{for(const e of document.querySelectorAll('body>div'))if(e.style.position==='fixed')e.remove();});
 await page.evaluate(()=>v.refresh(true));await page.getByRole('button',{name:'编辑项目',exact:true}).last().click();assert.equal(await page.getByLabel('项目名称',{exact:true}).inputValue(),'内联测试项目');await page.getByLabel('项目名称',{exact:true}).fill('重命名测试项目');await page.getByLabel('项目名称',{exact:true}).press('Tab');await page.waitForTimeout(60);assert.equal(await page.evaluate(()=>window.projectRename.name),'02 项目/重命名测试项目.md');await page.getByRole('button',{name:'收起项目设置',exact:true}).click();await page.evaluate(()=>{for(const e of document.querySelectorAll('body>div'))if(e.style.position==='fixed')e.remove();});await page.evaluate(()=>v.refresh(true));page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'删除项目',exact:true}).last().click();await page.waitForTimeout(60);assert.equal(await page.evaluate(()=>window.projectDeleted),'02 项目/重命名测试项目.md');
 await page.evaluate(()=>v.setTab('today'));
 assert.match(await page.locator('.os-focus-widget>strong').textContent(),/完成第三章/);
 await page.screenshot({path:path.join(out,'focus-selected.png')});
 await page.evaluate(()=>v.setTab('tasks'));
 await page.getByPlaceholder('添加今日任务，Enter 设置番茄数').fill('今日快速任务');await page.getByRole('button',{name:'添加',exact:true}).click();
  assert.equal(await page.getByLabel('任务名称 *',{exact:true}).inputValue(),'今日快速任务');await page.getByRole('button',{name:'+1🍅',exact:true}).click();await page.locator('.los-task-modal').evaluate(e=>e.scrollTop=e.scrollHeight);await page.getByRole('button',{name:'创建任务',exact:true}).evaluate(button=>button.form.requestSubmit(button));
 assert.equal(await page.evaluate(()=>window.createdTask.repeat),'once');assert.equal(await page.evaluate(()=>window.createdTask.estimated_pomodoros),'2');assert.equal(await page.evaluate(()=>window.createdTask.scheduled===previewModel.dayKey()),true);
 await page.getByRole('button',{name:'＋ 新任务',exact:true}).click();await page.getByLabel('任务名称 *',{exact:true}).fill('完整任务');await page.getByLabel('所属项目',{exact:true}).selectOption('02 项目/本周学习计划.md');await page.getByLabel('优先级',{exact:true}).selectOption('P1');await page.getByLabel('周期与重复',{exact:true}).selectOption('weekly');await page.getByLabel('预计成果 / 完成标准',{exact:true}).fill('交付一张卡片');await page.getByRole('button',{name:'＋ 添加子任务',exact:true}).click();await page.getByLabel('子任务内容',{exact:true}).fill('完成推导');
   await page.getByText('高级设置',{exact:true}).click();await page.getByLabel('单番茄时长（分钟）',{exact:true}).fill('40');await page.evaluate(()=>document.querySelector('.los-task-modal').scrollTop=0);await page.screenshot({path:path.join(out,'task-modal.png')});for(const width of [420,360]){await page.setViewportSize({width,height:720});assert.equal(await page.locator('.los-task-modal').evaluate(e=>e.scrollWidth<=e.clientWidth+2),true);const taskModalFields=await page.locator('.los-task-modal input:not([type=checkbox]),.los-task-modal select,.los-task-modal textarea').evaluateAll(fields=>fields.map(field=>{const a=field.getBoundingClientRect(),b=field.closest('.los-task-modal').getBoundingClientRect();return {left:a.left,right:a.right,parentLeft:b.left,parentRight:b.right,visible:a.width>0&&a.height>0};}));assert.ok(taskModalFields.filter(field=>field.visible).every(field=>field.left>=field.parentLeft-1&&field.right<=field.parentRight+1),JSON.stringify(taskModalFields));}await page.setViewportSize({width:1100,height:720});await page.locator('.los-task-modal').evaluate(e=>e.scrollTop=e.scrollHeight);await page.evaluate(()=>window.failCreate=true);await page.getByRole('button',{name:'创建任务',exact:true}).evaluate(button=>button.form.requestSubmit(button));assert.equal(await page.getByLabel('任务名称 *',{exact:true}).inputValue(),'完整任务');await page.evaluate(()=>window.failCreate=false);await page.getByRole('button',{name:'创建任务',exact:true}).evaluate(button=>button.form.requestSubmit(button));assert.equal(await page.evaluate(()=>window.createdTask.checklist[0].text),'完成推导');assert.equal(await page.evaluate(()=>window.createdTask.repeat),'weekly');
 await page.evaluate(()=>v.setTab('daily'));assert.equal(await page.locator('.os-audit-card').count(),6);assert.equal(await page.locator('.os-audit-card').first().locator('details[open]').count(),1);await page.screenshot({path:path.join(out,'daily-compact.png')});await page.evaluate(()=>v.setTab('today'));
 assert.equal(await page.locator('.os-focus-picker').first().getAttribute('open'),null);
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

 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'layout-results.json'),JSON.stringify({results,errors,interactions:'search, complete, delete/restore, note CRUD controls, preview, recall, timer, mobile pane, weather, duplicate title'},null,2));
 console.log(`Passed ${results.length} layout checks and interactive flows. Screenshots: ${out}`);await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
