"use strict";
const {el, btn} = require('../shared/dom');
const {Notice} = require('obsidian');
const {renderMarkdown, markdownOwner} = require('../codex-study/core/markdown-render');
const {isSummaryNote, summaryEntry, filterSummaries} = require('./summary-notes');

async function renderSummaries(view) {
  const app = view.plugin.app, generation = view.generation;
  const state = view.summaryState ||= {query:'',course:'',date:'',path:'',mobileDetail:false};
  const panel = view.panel(view.content,'总结笔记','','os-fill os-summary-panel');
  panel.head.hidden = true;
  const toolbar = el(panel.panel,'div','os-summary-toolbar'); panel.panel.insertBefore(toolbar,panel.body);
  const search = el(toolbar,'input','os-input'); search.type='search';search.placeholder='搜索标题和正文';search.value=state.query;search.setAttribute('aria-label','搜索总结笔记');
  const course = el(toolbar,'select','os-input'); course.setAttribute('aria-label','筛选课程');el(course,'option','','全部课程').value='';
  const date = el(toolbar,'input','os-input');date.type='date';date.value=state.date;date.setAttribute('aria-label','筛选日期');date.title='留空显示全部日期';
  const action = (root,label,fn,cls='') => btn(root,label,fn,`os-button ${cls}`,error=>new Notice(error.message));
  action(toolbar,'清除筛选',()=>{state.query='';state.course='';state.date='';search.value='';course.value='';date.value='';draw();},'os-quiet');
  panel.body.classList.add('os-summary-body');
  const list = el(panel.body,'div','os-summary-list');list.dataset.scroll='summary-list';list.tabIndex=0;list.setAttribute('aria-label','每日总结笔记');
  const detail = el(panel.body,'article','os-summary-detail');detail.dataset.scroll='summary-detail';detail.tabIndex=0;detail.setAttribute('aria-label','总结笔记正文');
  el(list,'p','os-muted','正在读取笔记…');
  const alive = () => !view.closed && view.generation===generation;
  let entries = [], selection = '';
  // 保留最近看过的正文；切回笔记时直接复用 DOM 和 Markdown 子组件。
  const rendered = new Map();
  let pendingFrame = 0, pendingTimer = 0;
  const cancelPending = () => {
    if (pendingFrame) cancelAnimationFrame(pendingFrame);
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingFrame = pendingTimer = 0;
  };
  view.summaryCleanup = () => {
    cancelPending();
    for (const item of rendered.values()) item.owner?.unload();
    rendered.clear();
  };
  function trimCache() {
    while (rendered.size > 3) {
      const [path, item] = rendered.entries().next().value;
      rendered.delete(path);
      item.owner?.unload();
      item.body.remove();
    }
  }
  function select(entry, explicit=false) {
    if(explicit)state.mobileDetail=true;
    panel.body.classList.toggle('has-selection',state.mobileDetail);
    state.path=entry.path;
    for(const row of list.querySelectorAll('[data-path]')) {
      const selected=row.dataset.path===entry.path;row.classList.toggle('is-active',selected);row.setAttribute('aria-pressed',String(selected));
    }
    if(selection===entry.path)return;
    cancelPending();
    selection=entry.path;detail.replaceChildren();detail.scrollTop=0;
    action(detail,'← 返回列表',()=>{state.mobileDetail=false;panel.body.classList.remove('has-selection');},'os-summary-back os-quiet');
    const head=el(detail,'header','os-summary-heading');
    el(head,'p','os-overline',`${entry.date || '日期未识别'} · ${entry.course}`);
    el(head,'h2','',entry.title.replace(/^\d{4}-\d{2}-\d{2}\s*/,''));
    action(head,'在 Obsidian 中编辑 ↗',async()=>{
      const file=app.vault.getAbstractFileByPath(entry.path);
      if(!file)throw Error('笔记已移动或删除，请刷新列表。');
      await app.workspace.getLeaf('tab').openFile(file,{state:{mode:'source'}});
    },'os-quiet');
    let item = rendered.get(entry.path);
    if (item) { rendered.delete(entry.path); rendered.set(entry.path,item); }
    else {
      item = {body:document.createElement('div'),owner:null,ready:false};
      item.body.className='os-summary-markdown';
      rendered.set(entry.path,item);
    }
    const body=item.body;
    detail.appendChild(body);
    if(!item.ready) {
      if(entry.error) { el(body,'p','os-muted','读取失败：'+entry.error); item.ready=true; }
      else if(!entry.body.trim()) { view.empty(body,'这篇笔记暂时为空','打开原文件，写下今天的课堂记录与课后总结。'); item.ready=true; }
      else {
        body.textContent='正在排版…';
        // 先让按钮选中和右栏标题绘制到屏幕，再开始较重的 Markdown/公式渲染。
        pendingFrame=requestAnimationFrame(() => {
          pendingFrame=0;
          pendingTimer=setTimeout(() => {
            pendingTimer=0;
            if(!alive() || selection!==entry.path) return;
            item.owner=markdownOwner();
            item.ready=true;
            renderMarkdown(app,item.owner,body,entry.body,entry.path);
            trimCache();
          },0);
        });
      }
    }
    trimCache();
    if(!item.linksBound) {
      item.linksBound=true;
      body.addEventListener('click',event=>{
        const link=event.target.closest?.('a.internal-link');if(!link)return;
        event.preventDefault();event.stopPropagation();
        const target=link.getAttribute('data-href') || link.getAttribute('href');
        if(target)Promise.resolve(app.workspace.openLinkText(target,entry.path,event.ctrlKey||event.metaKey)).catch(error=>new Notice(error.message));
      });
    }
  }
  function draw() {
    if(!alive())return;
    const filtered=filterSummaries(entries,state);list.replaceChildren();
    view.pageStatusEl.textContent=`${filtered.length} / ${entries.length} 篇 · 自动关联课堂笔记`;
    let group=null;
    for(const entry of filtered) {
      if(group!==entry.date){group=entry.date;el(list,'h3','os-summary-date',group || '日期未识别');}
      const row=action(list,'',()=>select(entry,true),'os-summary-row');row.dataset.path=entry.path;
      el(row,'strong','',entry.course);
      const subtitle=entry.title.replace(/^\d{4}-\d{2}-\d{2}\s*/,'');
      if(subtitle!==entry.course)el(row,'span','os-summary-subtitle',subtitle);
      el(row,'span','os-summary-excerpt',entry.error?'无法读取，点击查看':entry.excerpt || '暂无正文内容');
    }
    if(!filtered.length){cancelPending();selection='';state.path='';state.mobileDetail=false;panel.body.classList.remove('has-selection');detail.replaceChildren();view.empty(list,entries.length?'没有匹配的笔记':'还没有课堂笔记',entries.length?'试试其他关键词，或清除筛选。':'课程文件夹中的 Markdown 笔记会自动显示在这里。');view.empty(detail,'每日所学，集中回看');return;}
    select(filtered.find(e=>e.path===state.path)||filtered[0]);
  }
  try {
    const files=view.snapshot.files.filter(isSummaryNote);
    entries=await Promise.all(files.map(async file=>{
      let text='',error='';try{text=await app.vault.cachedRead(file);}catch(e){error=e.message;}
      return {...summaryEntry(file,app.metadataCache?.getFileCache?.(file)?.frontmatter||{},text,view.plugin.courseCatalog?.()||[]),error};
    }));
    if(!alive())return;
    const courses=new Map(entries.map(e=>[e.code,e.course]));
    for(const [code,title] of [...courses].sort((a,b)=>a[1].localeCompare(b[1],'zh-CN')))el(course,'option','',title).value=code;
    if(!courses.has(state.course))state.course='';course.value=state.course;
    search.oninput=()=>{state.query=search.value;draw();};
    course.onchange=()=>{state.course=course.value;draw();};
    date.onchange=()=>{state.date=date.value;draw();};
    draw();
  } catch(error) {if(alive()){list.replaceChildren();view.empty(list,'加载失败',error.message);}}
}
module.exports = {renderSummaries};
