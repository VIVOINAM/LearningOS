"use strict";

// L-OS 3.0 - PDF study engine (self-contained migration).
// Moved out of the v1.7 workbench monolith; local dependencies are explicit modules.

const { Modal, Notice } = require("obsidian");
const T = require("../../shared/timer-core.js");
const { clean, day, isTextbook } = require("./study-utils.js");
const { el, button } = require("./study-ui.js");
const { STUDY_COLORS, studyColor, parseStudyTags, parseStudyCategories, parseStudyLinks, mergeStudyRects } = require("./study-model.js");
const { StudyGoalModal } = require("./study-modals.js");

const {StorageManager,reference}=require('./storage-manager.ts');
const {mountPanel,renderCards}=require('./view-panel.ts');
const {installPdfNavigation}=require('./pdf-navigation.js');
const {PdfOverlay,revealRegion}=require('./pdf-overlay.ts');
const {dimPages}=require('./immersive.js');
const TASK_PATH = "00 工作台/今日任务.md";

class StudyEngine {
  constructor(plugin) {
    this.clips=new StorageManager(plugin.app.vault);this.report=e=>new Notice('操作未完成：'+e.message);
    this.p=plugin; this.contexts=new Map(); this.pending=new Map(); this.stopped=false;
    this.data=plugin.data.study ||= {records:{},cursor:null,goal:{minutes:120,pages:30}};
    this.data.records ||= {};
    const oldDefault=this.data.goal?.minutes===50&&this.data.goal?.pages===10;
    this.data.goal=oldDefault?{minutes:120,pages:30}:Object.assign({minutes:120,pages:30},this.data.goal||{});
  }
  // 5.6 起不再读写 record.ink（手写注记）。旧笔迹原样留在元数据里，不解析也不清理：
  // 删掉只为省几 KB，却让「换回去」变成不可能。
  record(path) {
    const record=this.data.records[path] ||= {position:null,annotations:[],daily:{},dailyPages:{},next:'',updatedAt:0};
    record.annotations ||= [];
    record.dailyPages ||= {};
    record.pagesSeen=[...new Set([...(record.pagesSeen||[]),...Object.values(record.dailyPages).flat()])].sort((a,b)=>a-b);
    record.totalPages=Math.max(0,Math.floor(Number(record.totalPages)||0));
    for(const annotation of record.annotations) {
      annotation.color=studyColor(annotation.color);
      annotation.tags=parseStudyTags(annotation.tags);
      annotation.categories=parseStudyCategories(annotation.categories);
      // 5.6.2 起「LaTeX 公式」不再是独立字段：两个输入框做同一件事，写哪个都对不上。
      // 旧卡片里的公式并进批注，原样裹在 $$ 里，不丢东西。
      if(annotation.latex){annotation.note=[annotation.note,'$$\n'+String(annotation.latex)+'\n$$'].filter(Boolean).join('\n\n');delete annotation.latex;}
      annotation.links=parseStudyLinks(annotation.links);
      annotation.rects ||= [];
      annotation.resolved=annotation.resolved===true;
    }
    return record;
  }
  totals(path) {
    const r=this.record(path);
    const historical=this.p.data.sessions.filter(s=>s.phase==='focus'&&s.task===`阅读：${path}`&&s.endedAt<(this.data.startedAt||0)).reduce((n,s)=>n+s.seconds,0);
    return historical+Object.values(r.daily).reduce((a,b)=>a+b,0);
  }
  settle() {
    this.data.startedAt ||= Date.now();
    const timer=this.p.timerCore||T, t=this.p.data.timer;
    const elapsed=t.id?Math.max(0,Math.min(t.duration,t.duration-timer.remaining(t))):0;
    const c=this.data.cursor;
    // 换了一段（点「继续专注」、开新任务）时 id 会变。此前这一轮整个跳过，
    // 于是每段从开始到第一次结算之间的时间都丢了——连着继续几段就丢几次。
    // 新一段从 0 走到 elapsed 的这段时间同样是本书的专注时间，记在当前这本上。
    // c 为空（从未结算过）时不补：那段时间可能根本不在这台机器上发生。
    const started=Boolean(c&&t.id&&c.id!==t.id);
    const path=started?(this.data.activePath||null):c?.path;
    const delta=started?elapsed:(c&&c.id===t.id?Math.max(0,elapsed-c.elapsed):0);
    if(path&&delta&&t.phase==='focus'){const r=this.record(path),key=day();r.daily[key]=(r.daily[key]||0)+delta;}
    this.data.cursor={id:t.id,elapsed,path:this.data.activePath||null};
  }
  select(path) { this.settle(); this.data.activePath=path; this.data.cursor.path=path;this.record(path).updatedAt=Date.now(); }
  summary() {
    const records=Object.values(this.data.records), today=day();
    return {seconds:records.reduce((n,r)=>n+(r.daily[today]||0),0),books:records.filter(r=>(r.daily[today]||0)>0).length,
      questions:records.reduce((n,r)=>n+r.annotations.filter(a=>a.kind==='question'&&!a.resolved).length,0),
      newQuestions:records.reduce((n,r)=>n+r.annotations.filter(a=>a.kind==='question'&&day(a.createdAt)===today).length,0)};
  }
  dailyStats(key=day()) {
    this.settle();
    const records=Object.values(this.data.records), entries=Object.entries(this.data.records), pages=new Set();
    for(const [path,record] of entries)for(const page of record.dailyPages?.[key]||[])pages.add(`${path}:${page}`);
    return {seconds:records.reduce((n,r)=>n+(r.daily[key]||0),0),pages:pages.size};
  }
  dailyProgress(key=day()) {
    const stats=this.dailyStats(key), goal=this.data.goal;
    const minutePercent=Math.min(100,Math.round(stats.seconds/60/Math.max(1,goal.minutes)*100));
    const pagePercent=Math.min(100,Math.round(stats.pages/Math.max(1,goal.pages)*100));
    return {...stats,goal,percent:goal.pages?Math.round((minutePercent+pagePercent)/2):minutePercent,minutePercent,pagePercent};
  }
  async setGoal(minutes,pages) {
    minutes=Math.min(1440,Math.max(1,Math.round(Number(minutes)||120)));pages=Math.min(1000,Math.max(0,Math.round(Number(pages)||0)));
    return this.p.run(async()=>{this.data.goal={minutes,pages};await this.p.save();await this.p.refresh();});
  }
  goalModal() { new StudyGoalModal(this.p,this).open(); }
  notePath(path) { return `03 知识库/教材笔记/${path.replace(/\.pdf$/i,'.md')}`; }
  annotationPosition(annotation) { return {page:annotation.page,rectY:annotation.rects?.[0]?.y}; }
  annotationHeading(annotation, link) {
    const kind=annotation.kind==='question'?(annotation.resolved?'已解决疑问':'待解决疑问'):annotation.kind==='bookmark'?'书签':'高亮与批注';
    const color=STUDY_COLORS[studyColor(annotation.color)];
    const tags=annotation.tags?.length?` · 标签：${annotation.tags.map(tag=>`#${tag}`).join(' ')}`:'';
    const categories=annotation.categories?.length?` · 分类：${annotation.categories.join('、')}`:'';
    return `### ${kind} · ${link(annotation.page)} · ${color}${categories}${tags}`;
  }
  studyMarkdown(path) {
    const r=this.record(path), source=this.p.app.vault.getAbstractFileByPath(path);
    const link=page=>source&&this.p.app.fileManager?.generateMarkdownLink?this.p.app.fileManager.generateMarkdownLink(source,this.notePath(path),`#page=${page}`,`第 ${page} 页`):`[第 ${page} 页](<${encodeURI(path).replace(/#/g,'%23')}#page=${page}>)`;
    const lines=['<!-- cw-study -->','## 学习记录',`- 教材：[打开 PDF](<${encodeURI(path).replace(/#/g,'%23')}>)`,`- 上次位置：${r.position?link(r.position.page):'尚未记录'}`,`- 累计专注：${(this.totals(path)/60).toFixed(1)} 分钟`,`- 下次继续：${clean(r.next||'未填写')}`,''];
    for(const a of r.annotations) {
      lines.push(this.annotationHeading(a,link),`<!-- study:${a.id} -->`);
      if(a.imagePath||a.text)lines.push(reference(path,{...a,note:''}));
      if(a.note)lines.push(a.note);
      if(a.categories?.length)lines.push(`分类：${a.categories.join('、')}`);
      if(a.links?.length)lines.push(`关联：${a.links.map(item=>item.label?`${link(item.page)}（${item.label}）`:link(item.page)).join('、')}`);
      lines.push('');
    }
    lines.push('<!-- /cw-study -->');
    return lines.join('\n');
  }
  async syncNote(path) {
    const block=this.studyMarkdown(path);
    const f=await this.p.ensure(this.notePath(path),`# ${path.split('/').at(-1).replace(/\.pdf$/i,'')} · 学习笔记\n\n## 自由笔记\n\n`);
    await this.p.app.vault.process(f,c=>c.includes('<!-- cw-study -->')?c.replace(/<!-- cw-study -->[\s\S]*?<!-- \/cw-study -->/,()=>block):c+'\n'+block+'\n');
    return f;
  }
  async openNote(path) { const f=await this.p.run(()=>this.syncNote(path)); await this.p.open(f.path); }
  exportPath(path) {
    const safe=path.replace(/\.pdf$/i,'').replace(/[\\/:*?"<>|]/g,'-').replace(/\s+/g,' ').trim().slice(0,150);
    return `03 知识库/教材笔记/导出/${safe} · 学习记录.md`;
  }
  async exportMarkdown(path) {
    const f=await this.p.run(async()=>{
      const target=await this.p.ensure(this.exportPath(path),`# ${path.split('/').at(-1).replace(/\.pdf$/i,'')} · 学习记录\n\n`);
      const content=this.studyMarkdown(path).replace(/^<!-- cw-study -->\n|\n<!-- \/cw-study -->$/g,'');
      await this.p.app.vault.process(target,()=>content+'\n');
      return target;
    });
    await this.p.open(f.path);new Notice('已导出学习笔记 Markdown。');
  }
  async add(path, input) {
    const page=Math.max(1,Math.floor(Number(input.page)||1));
    const categories=parseStudyCategories(input.categories),kind=input.kind||(categories.includes('疑问卡壳（待解决）')?'question':'highlight');
    const annotation={id:Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),page,kind,text:String(input.text||''),note:String(input.note||''),color:studyColor(input.color),tags:parseStudyTags(input.tags),categories,links:parseStudyLinks(input.links),imagePath:input.imagePath||undefined,rects:mergeStudyRects(input.rects),createdAt:Date.now(),resolved:false};
    return this.p.run(async()=>{
      const record=this.record(path);record.annotations.push(annotation);
      try{await this.p.save();}catch(error){record.annotations=record.annotations.filter(a=>a.id!==annotation.id);throw error;}
      for(const ctx of this.contexts.values())if(ctx.path===path)ctx.activeAnnotationId=annotation.id;
      this.redraw(path);
      try{await this.syncNote(path);}catch(error){new Notice('卡片已保存，但教材笔记同步失败：'+error.message);}
      await this.p.refresh();return annotation;
    });
  }
  async resolve(path,id) { return this.p.run(async()=>{const a=this.record(path).annotations.find(a=>a.id===id);if(a)a.resolved=!a.resolved;await this.p.save();await this.syncNote(path);this.redraw(path);await this.p.refresh();}); }
  async edit(path,id,fields) { return this.p.run(async()=>{const a=this.record(path).annotations.find(a=>a.id===id),values=typeof fields==='string'?{note:fields}:fields||{};if(a){if('note' in values)a.note=String(values.note||'');if('color' in values)a.color=studyColor(values.color);if('tags' in values)a.tags=parseStudyTags(values.tags);if('categories' in values)a.categories=parseStudyCategories(values.categories);if('links' in values)a.links=parseStudyLinks(values.links);}await this.p.save();await this.syncNote(path);this.redraw(path);}); }
  async remove(path,id) { return this.p.run(async()=>{const r=this.record(path);this.p.removedIds.add(id);r.annotations=r.annotations.filter(a=>a.id!==id);await this.p.save();await this.syncNote(path);this.redraw(path);await this.p.refresh();}); }
  async next(path,text) { return this.p.run(async()=>{this.record(path).next=text;await this.p.save();await this.syncNote(path);await this.p.refresh();}); }
  async task(path,start,end) {
    start=Number(start);end=Number(end);
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<start)throw Error('请输入有效页码范围。');
    const f=this.p.app.vault.getAbstractFileByPath(path);if(!isTextbook(f))throw Error('教材不存在。');
    return this.p.run(async()=>{
      const file=await this.p.ensure(TASK_PATH,'# 今日任务\n');
      const target=encodeURIComponent(JSON.stringify({path,page:start,end}));
      await this.p.app.vault.process(file,c=>c+`\n- [ ] 学习 ${f.basename} 第 ${start}–${end} 页 <!-- study-task:${target} -->\n`);
      await this.p.refresh();
    });
  }
  taskTarget(raw) { try {const m=raw?.match(/<!-- study-task:([^ ]+) -->/);return m?JSON.parse(decodeURIComponent(m[1])):null;}catch{return null;} }
  async openTask(task) {
    const target=this.taskTarget(task.raw);if(!target)return this.p.selectTask(task.text);
    const f=this.p.app.vault.getAbstractFileByPath(target.path);if(!isTextbook(f))throw Error('教材已移动或删除。');
    await this.p.openTextbook(f);const ctx=await this.attachFile(f);if(ctx)await this.jump(ctx,{page:target.page});
  }
  position(ctx) {
    const pdf=ctx.pdf, page=pdf.currentPageNumber||1, div=pdf.getPageView(page-1)?.div;
    return {page,scale:pdf.currentScaleValue||'page-width',top:ctx.scroll.scrollTop,left:ctx.scroll.scrollLeft,
      pageOffset:div?ctx.scroll.scrollTop-div.offsetTop:0};
  }
  capture(ctx) {
    if(ctx.restoring||ctx.leaf.view?.file?.path!==ctx.path)return;
    const position=this.position(ctx),page=position.page,record=this.record(ctx.path),key=day();record.position=position;record.totalPages=Math.max(record.totalPages,Number(ctx.pdf.pagesCount)||0);record.pagesSeen=[...new Set([...record.pagesSeen,page])].sort((a,b)=>a-b);record.dailyPages[key]=[...(record.dailyPages[key]||[]).filter(item=>item!==page),page];record.updatedAt=Date.now();
  }
  async jump(ctx,position) {
    if(!position||ctx.closed)return;
    ctx.restoring=true;
    try {
      if(position.scale)ctx.pdf.currentScaleValue=position.scale;
      const page=Math.max(1,Math.min(ctx.pdf.pagesCount||1,position.page||1));
      ctx.pdf.currentPageNumber=page;
      await new Promise(resolve=>ctx.win.requestAnimationFrame(()=>ctx.win.requestAnimationFrame(resolve)));
      if(ctx.closed)return;
      const div=ctx.pdf.getPageView(page-1)?.div;
      if(position.pageOffset!==undefined&&div)ctx.scroll.scrollTop=div.offsetTop+position.pageOffset;
      if(position.rectY!==undefined&&div)ctx.scroll.scrollTop=div.offsetTop+Math.max(0,position.rectY*div.clientHeight-60);
      if(position.left!==undefined)ctx.scroll.scrollLeft=position.left;
    } finally {ctx.restoring=false;}
    this.capture(ctx);ctx.selection=null;if(ctx.selectionLabel)ctx.selectionLabel.textContent='在 PDF 中选择文字后，可高亮或记录疑问。';this.paint(ctx);
  }
  rememberNavigation(ctx,position) {
    if(!ctx||ctx.closed||ctx.restoring)return false;
    const remembered=ctx.navigationHistory?.remember(position||this.position(ctx))||false;
    this.updateNavigationControls(ctx);return remembered;
  }
  updateNavigationControls(ctx) {
    if(!ctx)return;
    if(ctx.navBack)ctx.navBack.disabled=!ctx.navigationHistory?.canBack();
    if(ctx.navForward)ctx.navForward.disabled=!ctx.navigationHistory?.canForward();
  }
  async navigateHistory(ctx,direction) {
    if(!ctx||ctx.closed)return false;
    const target=ctx.navigationHistory?.take(direction,this.position(ctx));
    if(!target){this.updateNavigationControls(ctx);return false;}
    await this.jump(ctx,target);this.updateNavigationControls(ctx);return true;
  }
  async reveal(ctx, annotation) {
    this.rememberNavigation(ctx);
    ctx.root.classList.remove('cw-study-collapsed');ctx.win.dispatchEvent(new ctx.win.Event('resize'));
    ctx.activeAnnotationId=annotation.id;this.renderList(ctx);
    if(annotation.rects?.length)await revealRegion(ctx,annotation.page,annotation.rects[0]);
    else await this.jump(ctx,this.annotationPosition(annotation));
    const marks=[...ctx.scroll.querySelectorAll('.cw-study-highlight')].filter(mark=>mark.dataset.annotationId===annotation.id);
    for(const mark of marks){mark.classList.remove('cw-study-highlight-focus');void mark.offsetWidth;mark.classList.add('cw-study-highlight-focus');}
    if(marks.length)setTimeout(()=>marks.forEach(mark=>mark.classList.remove('cw-study-highlight-focus')),1800);
    const card=ctx.list?.querySelector(`[data-annotation-id="${annotation.id}"]`);if(card){card.scrollIntoView({behavior:'smooth',block:'nearest'});card.classList.remove('cs-card-focus');void card.offsetWidth;card.classList.add('cs-card-focus');card.focus({preventScroll:true});setTimeout(()=>card.classList.remove('cs-card-focus'),2200);}
  }
  async attachFile(file) {
    const leaf=this.p.app.workspace.getLeavesOfType('pdf').find(l=>l.view?.file?.path===file.path);
    if(!leaf)return null;
    const prior=this.contexts.get(leaf);if(prior?.path===file.path&&!prior.closed)return prior;
    if(this.pending.has(leaf)){await this.pending.get(leaf);return leaf.view?.file?.path===file.path?this.attachFile(file):null;}
    const promise=this.attach(leaf,file);this.pending.set(leaf,promise);
    try{return await promise;}finally{this.pending.delete(leaf);}
  }
  async attach(leaf,file) {
    // Verified against the installed native viewer: view.viewer is a thenable PDF wrapper.
    const viewer=leaf.view.viewer;if(!viewer?.then)return null;
    let timeout;
    try {
      const child=await Promise.race([new Promise(resolve=>viewer.then(resolve)),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('PDF 加载超时，请重新打开教材。')),20000);})]);
      if(this.stopped||leaf.view.file?.path!==file.path)return null;
      const pdf=child.pdfViewer?.pdfViewer,scroll=child.pdfViewer?.dom?.viewerContainerEl;
      if(!pdf||!scroll)throw Error('当前 PDF 阅读器不支持学习面板。');
      const until=Date.now()+20000;
      while(!pdf.pagesCount||(child.file&&child.file.path!==file.path)){if(this.stopped||leaf.view.file?.path!==file.path)return null;if(Date.now()>until)throw Error('PDF 尚未加载完成，请重新打开。');await new Promise(r=>setTimeout(r,100));}
      await pdf.firstPagePromise;
      if(this.stopped||leaf.view.file?.path!==file.path)return null;
      const old=this.contexts.get(leaf);if(old)this.dispose(old);
      const ctx={leaf,path:file.path,child,pdf,scroll,win:scroll.ownerDocument.defaultView,closed:false,restoring:true,selection:null};
      this.contexts.set(leaf,ctx);installPdfNavigation(this,ctx);this.panel(ctx);ctx.overlay=new PdfOverlay(this,ctx);
      const changed=()=>{if(!ctx.restoring){this.capture(ctx);clearTimeout(ctx.saveTimer);ctx.saveTimer=setTimeout(()=>this.p.run(()=>this.p.save()).catch(console.error),700);}this.paint(ctx);};
      ctx.changed=changed;scroll.addEventListener('scroll',changed,{passive:true});
      ctx.mouseup=()=>this.selection(ctx);scroll.addEventListener('mouseup',ctx.mouseup);
      ctx.keyup=()=>this.selection(ctx);scroll.addEventListener('keyup',ctx.keyup);
      ctx.observer=new ctx.win.MutationObserver(()=>this.paint(ctx));
      ctx.observer.observe(child.pdfViewer.dom.viewerEl,{childList:true});
      ctx.bus=child.pdfViewer.eventBus;
      ctx.rendered=()=>this.paint(ctx);ctx.bus?._on('pagerendered',ctx.rendered);
      ctx.bus?._on('scalechanging',changed);
      const requested=new URLSearchParams(String(child.pdfViewer.subpath||'').replace(/^#/,''));
      await this.jump(ctx,requested.has('page')?{page:Number(requested.get('page'))}:this.record(file.path).position||{page:1});
      return ctx;
    } finally {clearTimeout(timeout);}
  }
  selection(ctx) {
    const selection=ctx.scroll.ownerDocument.getSelection();if(!selection?.rangeCount||selection.isCollapsed){if(!ctx.overlay?.drag){ctx.selection=null;if(ctx.overlay?.bar?.dataset.mode==='selection')ctx.overlay.hide();}return;}
    const range=selection.getRangeAt(0), node=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
    const pageEl=node?.closest('.page[data-page-number]');if(!pageEl||!ctx.scroll.contains(pageEl))return;
    const end=range.endContainer.nodeType===1?range.endContainer:range.endContainer.parentElement;
    if(end?.closest('.page[data-page-number]')!==pageEl){ctx.selection=null;ctx.selectionLabel.textContent='请在单页内选择文字。';return;}
    const b=pageEl.getBoundingClientRect();
    ctx.selection={page:Number(pageEl.dataset.pageNumber),text:selection.toString()||range.toString(),rects:[...range.getClientRects()].filter(r=>r.width>0&&r.height>0).map(r=>({x:Math.max(0,(r.left-b.left-pageEl.clientLeft)/pageEl.clientWidth),y:Math.max(0,(r.top-b.top-pageEl.clientTop)/pageEl.clientHeight),w:Math.min(1,r.width/pageEl.clientWidth),h:Math.min(1,r.height/pageEl.clientHeight)}))};
    ctx.selectionLabel.textContent='已选：'+ctx.selection.text.slice(0,70);
    ctx.overlay?.text({...ctx.selection},range.getBoundingClientRect());
  }
  panel(ctx) { mountPanel(this,ctx); }
  renderList(ctx) { renderCards(this,ctx); }
  async clearCards(path) { return this.p.run(async()=>{const record=this.record(path);for(const a of record.annotations)this.p.removedIds.add(a.id);record.annotations=[];await this.p.save();await this.syncNote(path);this.redraw(path);}); }
  paint(ctx) {
    if(ctx.closed)return;
    const currentPage=Number(ctx.pdf.currentPageNumber)||1;ctx.location.textContent=`${currentPage} / ${ctx.pdf.pagesCount}`;if(ctx.progress)ctx.progress.value=currentPage/Math.max(1,ctx.pdf.pagesCount);
    // 沉浸阅读时，翻页与新渲染的页都要跟上：当前页清晰，其余页退到背景里。
    if(this.p.immersive)dimPages(ctx.scroll,currentPage,true);
    if(ctx.cardsPage!==currentPage){ctx.cardsPage=currentPage;this.renderList(ctx);ctx.formulaPad?.render();}
    for(const page of ctx.scroll.querySelectorAll('.page[data-page-number]')) {
      let layer=page.querySelector(':scope > .cw-study-highlights');
      const marks=this.record(ctx.path).annotations.filter(a=>a.page===Number(page.dataset.pageNumber)&&a.rects.length);
      const signature=marks.map(a=>a.id+':'+a.resolved+':'+studyColor(a.color)).join(',');if(layer?.dataset.signature===signature)continue;
      if(!layer)layer=el(page,'div','cw-study-highlights');layer.dataset.signature=signature;layer.replaceChildren();
      for(const a of marks)for(const rect of mergeStudyRects(a.rects)){const mark=el(layer,'span',`cw-study-highlight${a.kind==='crop'?' cw-study-crop-highlight':''}`);mark.dataset.annotationId=a.id;mark.dataset.color=studyColor(a.color);mark.dataset.kind=a.kind;mark.setAttribute('role','button');mark.setAttribute('aria-label',a.kind==='crop'?'编辑或删除公式截图':'编辑或删除高亮');mark.style.cssText=`left:${rect.x*100}%;top:${rect.y*100}%;width:${rect.w*100}%;height:${rect.h*100}%;`;}
    }
  }
  redraw(path) { for(const ctx of this.contexts.values())if(ctx.path===path){this.renderList(ctx);ctx.formulaPad?.render();this.paint(ctx);} }
  async checkpoint(leaf) {
    const ctx=this.contexts.get(leaf);if(!ctx)return;
    this.capture(ctx);clearTimeout(ctx.saveTimer);this.settle();
    if(ctx.nextInput)this.record(ctx.path).next=ctx.nextInput.value;
    await this.p.run(async()=>{await this.p.save();await this.syncNote(ctx.path);});
  }
  overview(onlyPath) {
    const modal=new Modal(this.p.app);
    modal.onOpen=()=>{
      modal.contentEl.classList.add('cw-study-overview-modal');
      el(modal.contentEl,'h2','',onlyPath?onlyPath.split('/').at(-1):'学习回顾与待解疑问');
      const list=el(modal.contentEl,'div','cw-library-results');
      const paths=onlyPath?[onlyPath]:Object.keys(this.data.records).filter(path=>{const r=this.record(path);return r.updatedAt||r.annotations.length;}).sort((a,b)=>this.record(b).updatedAt-this.record(a).updatedAt);
      if(!paths.length)el(list,'p','cw-muted','打开一本教材，开始留下学习记录。');
      for(const path of paths) {
        const r=this.record(path),row=el(list,'section','cw-study-item');el(row,'h3','',path.split('/').at(-1));
        el(row,'p','cw-muted',`第 ${r.position?.page||1} 页 · ${(this.totals(path)/60).toFixed(1)} 分钟${r.next?' · 下次：'+r.next:''}`);
        const open=async position=>{const file=this.p.app.vault.getAbstractFileByPath(path);if(!isTextbook(file))throw Error('教材已移动或删除。');await this.p.openTextbook(file);const ctx=await this.attachFile(file);if(position&&ctx)await this.jump(ctx,typeof position==='number'?{page:position}:position);modal.close();};
        button(row,'继续学习',()=>open(),'cw-link');button(row,'教材笔记',()=>this.openNote(path),'cw-link');button(row,'导出 Markdown',()=>this.exportMarkdown(path),'cw-link');
        for(const a of r.annotations.filter(a=>a.kind==='question'&&!a.resolved))button(row,`? 第 ${a.page} 页：${a.note||a.text}`,()=>open(this.annotationPosition(a)),'cw-link');
      }
    };modal.open();
  }
  async pulse() {
    if(this.stopped)return;this.settle();
    for(const ctx of this.contexts.values()) {
      if(!ctx.root.isConnected||ctx.leaf.view?.file?.path!==ctx.path){this.dispose(ctx);continue;}
      this.capture(ctx);this.paint(ctx);
    }
    await this.p.save();for(const v of this.p.views)v.updateBooks();
  }
  dispose(ctx) {
    ctx.formulaPad?.dispose();ctx.mdOwner?.unload();ctx.mdCache?.clear();ctx.settleObserver?.disconnect();clearTimeout(ctx.settleTimer);ctx.overlay?.dispose();ctx.resizeCleanup?.();clearTimeout(ctx.regionTimer);ctx.scroll.querySelectorAll('.cs-region-focus').forEach(e=>e.remove());this.capture(ctx);ctx.closed=true;clearTimeout(ctx.saveTimer);ctx.observer?.disconnect();
    ctx.scroll.removeEventListener('scroll',ctx.changed);ctx.scroll.removeEventListener('mouseup',ctx.mouseup);ctx.scroll.removeEventListener('keyup',ctx.keyup);
    if(ctx.navigationClick)ctx.scroll.removeEventListener('click',ctx.navigationClick,true);clearTimeout(ctx.navigationProbe);
    ctx.bus?._off('pagerendered',ctx.rendered);ctx.bus?._off('scalechanging',ctx.changed);
    ctx.panel?.remove();ctx.reopen?.remove();ctx.root?.classList.remove('cw-study-host','cw-study-collapsed');
    ctx.scroll.querySelectorAll('.cw-study-highlights').forEach(e=>e.remove());this.contexts.delete(ctx.leaf);
  }
  unload() { this.settle();this.stopped=true;for(const ctx of [...this.contexts.values()])this.dispose(ctx);return this.p.save(); }
}

module.exports = { StudyEngine };
