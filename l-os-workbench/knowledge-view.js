"use strict";
const {el,btn}=require('../shared/dom');
const {Notice}=require('obsidian');
const {renderMarkdown,markdownOwner}=require('../l-os-study/core/markdown-render');
const {noteBody}=require('./summary-notes');
const {TYPES,knowledgeEntries,filterKnowledge}=require('./knowledge-model');
const {DetailModal}=require('./detail-modal');

function renderKnowledge(view) {
  const p=view.plugin,app=p.app,generation=view.generation;
  const state=view.knowledgeState ||= {query:'',course:'',type:'',review:'',key:'',mobile:false};
  const courses=p.courseCatalog?.() || [],recall=view.owner('l-os-recall'),study=view.owner('l-os-study'),capture=view.owner('l-os-capture');
  const entries=knowledgeEntries({files:view.snapshot.files,courses,metadata:f=>app.metadataCache?.getFileCache?.(f)?.frontmatter,
    booksFor:c=>p.courseBooksFor?.(c),tasks:view.snapshot.allTasks,records:study?.engine?.data?.records || {},cards:view.snapshot.cards,
    resolve:(link,source)=>app.metadataCache?.getFirstLinkpathDest?.(link,source)?.path});
  const panel=view.panel(view.content,'笔记与教材卡片','','os-fill os-knowledge-panel');
  const action=(root,label,fn,cls='os-quiet')=>btn(root,label,fn,`os-button ${cls}`,e=>new Notice(e.message));
  const alive=()=>!view.closed && view.generation===generation;
  let owner=null,selection=0;
  view.knowledgeCleanup=()=>{selection++;owner?.unload();owner=null;};
  const create=action(panel.tools,'新建笔记',()=>capture.createNote(),'os-primary');create.disabled=!capture?.createNote;
  const quick=action(panel.tools,'随手记',()=>p.captureNote());quick.disabled=!capture?.captureNote;
  const toolbar=el(panel.panel,'div','os-toolbar os-knowledge-toolbar');panel.panel.insertBefore(toolbar,panel.body);
  const search=el(toolbar,'input','os-input');search.type='search';search.placeholder='搜索笔记、标签或卡片内容';search.value=state.query;search.setAttribute('aria-label','搜索知识');
  const selectFilter=(label,key,options)=>{
    const field=el(toolbar,'select','os-input');field.setAttribute('aria-label',label);
    for(const [value,text] of options)el(field,'option','',text).value=value;
    if(!options.some(([value])=>value===state[key]))state[key]='';field.value=state[key];
    field.onchange=()=>{state[key]=field.value;view.listPage=0;draw();};return field;
  };
  const courseNames=new Map(courses.map(c=>[String(c.id),c.title]));
  for(const e of entries)if(e.courseIds.length===1&&!courseNames.has(e.courseIds[0]))courseNames.set(e.courseIds[0],e.course || e.courseIds[0]);
  const courseFilter=selectFilter('知识课程','course',[['','全部课程'],...courseNames]);
  const typeFilter=selectFilter('知识类型','type',[['','全部类型'],...Object.entries(TYPES)]);
  const reviewFilter=selectFilter('知识复习状态','review',[['','全部复习状态'],['new','未加入复习'],['due','到期复习'],['scheduled','已安排复习']]);
  action(toolbar,'清除筛选',()=>{for(const key of ['query','course','type','review'])state[key]='';search.value=courseFilter.value=typeFilter.value=reviewFilter.value='';view.listPage=0;draw();});
  panel.body.classList.add('os-knowledge-body');
  const list=el(panel.body,'div','os-note-list');list.dataset.scroll='knowledge-list';list.tabIndex=0;
  const detail=el(panel.body,'article','os-note-detail');detail.dataset.scroll='knowledge-detail';detail.tabIndex=0;
  const reviewText=e=>!recall?'复习插件未启用':e.reviewState==='new'?'未加入复习':e.reviewState==='due'?'已到期':`${new Date(e.review.due).toLocaleDateString('zh-CN')} 复习`;
  async function select(entry,explicit=false) {
    const request=++selection;owner?.unload();owner=null;
    state.key=entry.key;if(explicit)state.mobile=true;
    panel.body.classList.toggle('has-selection',state.mobile);
    for(const row of list.querySelectorAll('[data-key]')){const on=row.dataset.key===entry.key;row.classList.toggle('is-active',on);row.setAttribute('aria-pressed',String(on));}
    detail.replaceChildren();detail.scrollTop=0;
    action(detail,'← 返回列表',()=>{state.mobile=false;panel.body.classList.remove('has-selection');},'os-mobile-back os-quiet');
    el(detail,'p','os-overline',[TYPES[entry.type],entry.course,entry.date].filter(Boolean).join(' · '));
    el(detail,'h2','',entry.title);
    const meta=el(detail,'div','os-row-meta');el(meta,'span','os-chip',reviewText(entry));
    if(entry.review)el(meta,'span','os-chip',`已复习 ${entry.review.reviews||0} 次 · 间隔 ${entry.review.interval||0} 天`);
    if(entry.type==='question')el(meta,'span','os-chip',entry.resolved?'疑问已解决':'疑问待解决');
    const actions=el(detail,'div','os-detail-actions');
    const open=action(actions,entry.cardId?'返回教材原文':entry.type==='class'?'翻页阅读':'打开笔记 ↗',()=>entry.cardId?study.revealCard(entry.path,entry.cardId):p.open(entry.path),'os-primary');
    open.disabled=!!entry.cardId&&!study?.revealCard;
    if(entry.summary)action(actions,'在总结笔记中查看',()=>view.showSummary(entry));
    const review=action(actions,entry.review?'开始回忆':'加入复习',async()=>{
      if(entry.review)return recall.review(entry.key);
      await recall.add(entry.key);await view.refresh(true);
    });review.disabled=!recall;
    if(entry.review)action(actions,'移出复习',async()=>{await recall.remove(entry.key);await view.refresh(true);});
    if(!entry.cardId){
      action(actions,'编辑笔记',async()=>{const f=app.vault.getAbstractFileByPath(entry.path);if(!f)throw Error('笔记已移动或删除');await app.workspace.getLeaf('tab').openFile(f,{state:{mode:'source'}});});
      if(entry.type==='note'&&capture?.updateNote){
        action(actions,entry.status==='done'?'置为待办':'标记完成',async()=>{await capture.updateNote(entry.file,entry.status==='done'?'reopen':'done');await view.refresh(true);});
        action(actions,'删除笔记',async()=>{await capture.updateNote(entry.file,'delete');state.key='';await view.refresh(true);});
      }
    }
    const related=el(detail,'div','os-knowledge-connections');
    if(entry.tasks.length){
      el(related,'h3','','关联行动');
      for(const task of entry.tasks){const row=el(related,'div','os-knowledge-task');el(row,'span','',`${task.done?'已完成':'待完成'} · ${task.text || task.title}`);action(row,'查看任务',()=>new DetailModal(view,task).open());}
    }else if(entry.type==='class')el(related,'p','os-muted','没有关联的总结任务。');
    const cs=courses.filter(c=>entry.courseIds.includes(String(c.id)));
    if(cs.length||entry.books.length){el(related,'h3','','课程与教材');for(const c of cs)action(related,c.title+' · 课程主页',()=>p.openCourse(c));for(const path of entry.books)action(related,path.split('/').pop(),()=>p.open(path));}
    if(!entry.cardId){
      const links=app.metadataCache?.resolvedLinks || {};
      const paths=[...new Set([...Object.keys(links[entry.path]||{}),...Object.entries(links).filter(([,targets])=>targets[entry.path]).map(([path])=>path)])].filter(path=>path!==entry.path);
      if(paths.length){el(related,'h3','','关联笔记');for(const path of paths)action(related,path.split('/').pop(),()=>p.open(path));}
    }
    el(detail,'h3','',entry.cardId?'卡片内容':'笔记正文');
    const body=el(detail,'div','os-knowledge-markdown','正在读取…');
    try {
      const text=entry.cardId?entry.body:noteBody(await app.vault.cachedRead(entry.file));
      if(!alive()||selection!==request)return;
      owner=markdownOwner();renderMarkdown(app,owner,body,text || '这篇笔记暂时为空。',entry.path);
      body.addEventListener('click',event=>{const link=event.target.closest?.('a.internal-link');if(!link)return;event.preventDefault();event.stopPropagation();const target=link.getAttribute('data-href')||link.getAttribute('href');if(target)Promise.resolve(app.workspace.openLinkText(target,entry.path,event.ctrlKey||event.metaKey)).catch(e=>new Notice(e.message));});
    }catch(error){if(alive()&&selection===request)body.textContent='读取失败：'+error.message;}
  }
  function draw(){
    if(!alive())return;
    const filtered=filterKnowledge(entries,state);list.replaceChildren();
    view.pageStatusEl.textContent=`${filtered.length} / ${entries.length} 项 · ${entries.filter(e=>e.type==='class').length} 篇课堂笔记 · ${entries.filter(e=>e.cardId).length} 张教材卡片 · ${entries.filter(e=>e.reviewState==='due').length} 项到期`;
    view.pageRows(list,filtered,e=>{const row=action(list,'',()=>select(e,true),'os-note-row');row.dataset.key=e.key;el(row,'strong','',e.title);el(row,'span','os-muted',[TYPES[e.type],e.course,e.date].filter(Boolean).join(' · '));el(row,'span','os-muted',[reviewText(e),e.tasks.length?`${e.tasks.filter(t=>t.done).length}/${e.tasks.length} 项行动完成`:''].filter(Boolean).join(' · '));});
    if(!filtered.length){selection++;owner?.unload();owner=null;state.mobile=false;panel.body.classList.remove('has-selection');detail.replaceChildren();view.empty(list,'没有匹配的内容','试试其他课程、类型或复习状态。');view.empty(detail,'课堂笔记与教材卡片会自动出现在这里');return;}
    const page=filtered.slice(view.listPage*60,(view.listPage+1)*60);
    select(page.find(e=>e.key===state.key)||page[0]);
  }
  search.oninput=()=>{state.query=search.value;view.listPage=0;draw();};
  if(state.jump&&state.key){const at=filterKnowledge(entries,state).findIndex(e=>e.key===state.key);if(at>=0)view.listPage=Math.floor(at/60);}
  state.jump=false;
  draw();
}
module.exports={renderKnowledge};
