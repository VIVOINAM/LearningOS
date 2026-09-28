"use strict";
/*
 * 有概念图谱的课：课程页、列表模式、概念卡。导图模式在 mind-map-view.js，概念卡两边共用。
 * 图谱只读；这里唯一会写的是掌握度记录（手动改档位）和界面偏好（模式、展开的章）。
 */
const {Notice}=require('obsidian');
const {el,btn}=require('../shared/dom');
const {renderMarkdown,markdownOwner}=require('../l-os-study/core/markdown-render');
const {scan}=require('./reading-rail-model');
const {LEVELS}=require('./learning-hub-model');
const G=require('./knowledge-graph');
const Mastery=require('./mastery');
const KStore=require('./knowledge-store');
const {renderMindMap}=require('./mind-map-view');
const action=(parent,label,fn,cls='os-quiet')=>btn(parent,label,fn,`os-button ${cls}`,e=>new Notice(e.message));
const shortDate=key=>{const m=/^\d{4}-(\d{2})-(\d{2})$/.exec(key||'');return m?`${+m[1]}/${+m[2]}`:'';};
async function openSource(plugin,path,heading){await plugin.open(path);if(heading)await plugin.app.workspace.openLinkText(`${path}#${heading}`,'',false);}

/** 档位的形状：空心 / 叹号 / 半实心 / 实心。颜色之外再给一道线索。 */
function masteryMark(parent,level){const mark=el(parent,'span',`os-mastery-mark is-${level}`,level==='review'?'!':'');mark.setAttribute('aria-label',LEVELS[level]);mark.setAttribute('role','img');return mark;}

/** 这门课的界面偏好：模式、导图里展开的章。存在 data.json，只是界面状态，不是知识数据。 */
function prefsOf(plugin,course){
  const all=plugin.data.knowledgeView||={mode:{},open:{}};
  return {
    mode:all.mode?.[course]||'mind',
    open:all.open?.[course]||null,
    save:async patch=>{all.mode||={};all.open||={};if(patch.mode)all.mode[course]=patch.mode;if(patch.open)all.open[course]=patch.open;await plugin.save();},
  };
}

/** 课堂笔记里一节自己的正文：到下一个标题为止。 */
async function leadOf(plugin,source){
  const file=plugin.app.vault.getAbstractFileByPath(source.path);if(!file)return null;
  const text=await plugin.app.vault.cachedRead(file),lines=text.replace(/\r\n?/g,'\n').split('\n'),{headings}=scan(text);
  const i=headings.findIndex(h=>h.heading===source.heading);if(i<0)return null;
  const end=headings[i+1]?.line??lines.length;
  return lines.slice(headings[i].line+1,end).join('\n').trim();
}

/**
 * 概念卡：列表模式的右栏、导图模式的侧滑卡是同一张。返回清理函数（卸掉 Markdown 渲染组件）。
 * ctx.jump(id) 跳到另一个概念；ctx.setLevel(concept, level) 写掌握度。
 */
function renderCard(ctx,container,concept,{back}={}){
  const p=ctx.plugin,model=ctx.model,owner=markdownOwner(),md=(target,text,path)=>renderMarkdown(p.app,owner,target,text,path||concept.sources[0]?.path||'');
  container.replaceChildren();
  if(back)action(container,back.label,back.fn,'os-map-back os-quiet');
  const chapter=model.chapterOf(concept);
  el(container,'p','os-overline',`第${chapter?.order??'?'}章 ${chapter?.title||''} ›`);
  const head=el(container,'div','os-concept-head');el(head,'h2','',concept.title);
  if(concept.fresh)el(head,'span','os-concept-new','新').title='本周新学';
  el(container,'p','os-muted os-concept-date',`${shortDate(concept.firstTaught)} 讲`);
  const levels=el(container,'div','os-segments os-concept-levels');levels.setAttribute('role','group');levels.setAttribute('aria-label','掌握程度');
  for(const [id,title] of Object.entries(LEVELS)){const b=action(levels,title,()=>concept.level===id?null:ctx.setLevel(concept,id),concept.level===id?'is-active':'');b.setAttribute('aria-pressed',String(concept.level===id));}
  el(container,'p','os-concept-basis',`依据：${Mastery.basisLabel(concept.record)}`);
  md(el(container,'div','os-concept-summary'),concept.summary);
  if(concept.formulas?.length){el(container,'h3','','关键公式');md(el(container,'div','os-concept-formulas'),concept.formulas.map(f=>`$$\n${f}\n$$`).join('\n\n'));}
  if(concept.points?.length){el(container,'h3','','要点');md(el(container,'div','os-concept-points'),concept.points.map(x=>`- ${x}`).join('\n'));}
  const links=[['先修',concept.prereqs||[]],['后续',concept.successors||[]],['相关',concept.related||[]]].map(([label,ids])=>[label,ids.filter(id=>model.byId.has(id))]).filter(([,ids])=>ids.length);
  if(links.length){const box=el(container,'div','os-concept-links');for(const [label,ids] of links){const row=el(box,'div','os-concept-relation');el(row,'span','os-muted',label);for(const id of ids){const other=model.byId.get(id),chip=action(row,'',()=>ctx.jump(id),'os-concept-chip');masteryMark(chip,other.level);el(chip,'span','',other.title);}}}
  if(concept.examples?.length){el(container,'h3','',`例题 · ${concept.examples.length}`);const list=el(container,'div','os-concept-examples');for(const e of concept.examples)action(list,e.title||e.heading,()=>openSource(p,e.path,e.heading));}
  // 课堂笔记原文默认折叠：概念卡先给结论，原文要看再展开。展开时才去读文件。
  const excerpt=el(container,'details','os-concept-excerpt');el(excerpt,'summary','',`课堂笔记原文 · ${concept.sources.length} 节`);
  let loaded=false;
  excerpt.addEventListener('toggle',async()=>{
    if(!excerpt.open||loaded)return;loaded=true;
    for(const s of concept.sources){
      const block=el(excerpt,'section','os-concept-excerpt-block');
      el(block,'p','os-overline',`${s.path.split('/').pop().replace(/\.md$/,'')} · ${s.heading}`);
      const body=el(block,'div','os-concept-excerpt-body','正在读取…');
      try{const lead=await leadOf(p,s);if(lead==null){body.textContent='这一节在笔记里找不到了。';continue;}if(!lead){body.textContent='这一节的内容都在它下面的小节里。';continue;}md(body,lead,s.path);}
      catch(e){body.textContent='读取失败：'+e.message;}
    }
  });
  const linked=ctx.outcomes.filter(o=>o.course===ctx.graph.course&&o.concepts.some(k=>ctx.model.resolve(k)===concept.id));
  if(linked.length){el(container,'h3','','记忆线索');for(const o of linked)action(container,o.cue,()=>ctx.view.showOutcomes(o.course,o.path));}
  const actions=el(container,'div','os-detail-actions');
  action(actions,'打开课堂笔记',()=>openSource(p,concept.sources[0].path,concept.sources[0].heading),'os-primary');
  return ()=>owner.unload();
}

function renderList(ctx,body){
  const {model,state}=ctx;
  const layout=el(body,'div','os-map-layout'),tree=el(layout,'nav','os-concept-tree'),detail=el(layout,'article','os-concept-detail');
  layout.classList.toggle('has-concept',!!state.mobile);tree.dataset.scroll='concept-tree';detail.dataset.scroll='concept-detail';tree.setAttribute('aria-label',`${ctx.graph.title} 概念`);
  const visible=model.concepts.filter(c=>G.matchesFilter(c,state.filter));
  if(!visible.length){ctx.view.empty(tree,state.filter==='review'?'没有需巩固的概念':'本周没有新学的概念','换回「全部」查看整门课。');detail.hidden=true;return;}
  if(!visible.some(c=>c.id===state.key))state.key=visible[0].id;
  let cleanup=null;ctx.addCleanup(()=>cleanup?.());
  const rows=new Map();
  const show=c=>{cleanup?.();cleanup=renderCard(ctx,detail,c,{back:{label:'← 概念列表',fn:()=>{state.mobile=false;layout.classList.remove('has-concept');}}});detail.scrollTop=0;};
  const select=id=>{state.key=id;state.mobile=true;layout.classList.add('has-concept');for(const [key,b] of rows){b.classList.toggle('is-active',key===id);b.setAttribute('aria-pressed',String(key===id));}show(model.byId.get(id));};
  ctx.jump=id=>{if(!visible.some(c=>c.id===id)){state.filter='all';return ctx.rerender(id);}select(id);rows.get(id)?.scrollIntoView?.({block:'nearest'});};
  for(const ch of model.chapters){
    const concepts=model.inChapter(ch.id).filter(c=>G.matchesFilter(c,state.filter));
    if(ch.status==='planned'){if(state.filter==='all')el(tree,'p','os-concept-chapter is-planned',`第${ch.order}章 ${ch.title}（未学）`);continue;}
    if(!concepts.length)continue;
    el(tree,'p','os-concept-chapter',`第${ch.order}章 ${ch.title}`);
    for(const c of concepts){
      const b=action(tree,'',()=>select(c.id),`os-concept-node${state.key===c.id?' is-active':''}`);b.dataset.key=c.id;b.title=c.title;b.setAttribute('aria-pressed',String(state.key===c.id));
      masteryMark(b,c.level);el(b,'span','os-concept-title',c.title);if(c.fresh)el(b,'span','os-concept-new','新').title='本周新学';
      rows.set(c.id,b);
    }
  }
  show(model.byId.get(state.key));
  rows.get(state.key)?.scrollIntoView?.({block:'nearest'});
}

/**
 * 课程页。env: {graph, course, latest, outcomes, panel}
 * 返回前把清理函数挂到 view.knowledgeCleanup，换页时卸掉渲染组件和导图的事件。
 */
function renderGraphCourse(view,env){
  const p=view.plugin,{graph,panel}=env,state=view.mapState,prefs=prefsOf(p,graph.course);
  state.filter||='all';
  const cleanups=[];view.knowledgeCleanup=()=>{for(const fn of cleanups.splice(0))fn();};
  const ctx={view,plugin:p,graph,state,prefs,outcomes:env.outcomes,addCleanup:fn=>cleanups.push(fn),
    model:G.courseModel(graph,env.latest,key=>Mastery.inWeek(key)),
    setLevel:async(concept,level)=>{await KStore.setLevel(p,concept.id,graph.course,level);state.key=concept.id;await view.refresh(true);},
    rerender:id=>{if(id)state.key=id;draw();}};
  if(state.key&&!ctx.model.byId.has(state.key))state.key=ctx.model.resolve(state.key);
  if(!state.key&&state.source)state.key=ctx.model.concepts.find(c=>c.sources.some(s=>s.path===state.source))?.id||'';
  const mode=state.mode||prefs.mode;
  view.pageStatusEl.textContent=`${graph.title} · ${ctx.model.concepts.length} 个概念`;
  const bar=el(panel.body,'div','os-map-toolbar');
  const modes=el(bar,'div','os-segments');modes.setAttribute('role','group');modes.setAttribute('aria-label','显示方式');
  for(const [id,label] of [['mind','导图'],['list','列表']]){const b=action(modes,label,async()=>{if(mode===id)return;state.mode=id;await prefs.save({mode:id});await view.refresh(true);},mode===id?'is-active':'');b.setAttribute('aria-pressed',String(mode===id));}
  const filters=el(bar,'div','os-segments');filters.setAttribute('role','group');filters.setAttribute('aria-label','筛选概念');
  const filterButtons=[];
  for(const [id,label] of Object.entries(G.FILTERS)){const b=action(filters,label,()=>{state.filter=id;for(const [fid,fb] of filterButtons){fb.classList.toggle('is-active',fid===id);fb.setAttribute('aria-pressed',String(fid===id));}draw();},state.filter===id?'is-active':'');b.setAttribute('aria-pressed',String(state.filter===id));filterButtons.push([id,b]);}
  const host=el(panel.body,'div','os-map-host');
  function draw(){
    for(const fn of cleanups.splice(0))fn();
    host.replaceChildren();
    if(mode==='mind')renderMindMap(ctx,host,{renderCard});
    else renderList(ctx,host);
  }
  draw();
}

module.exports={renderGraphCourse,renderCard,masteryMark};
