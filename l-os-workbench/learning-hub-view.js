"use strict";
const {Modal,Notice}=require('obsidian');
const {el,btn}=require('../shared/dom');
const {renderMarkdown,markdownOwner}=require('../l-os-study/core/markdown-render');
const {isSummaryNote,noteBody}=require('./summary-notes');
const {LEVELS,topicsFromNote,buildMap,outcomeEntry,courseProgress}=require('./learning-hub-model');
const Store=require('./learning-hub-store');
const KStore=require('./knowledge-store');
const G=require('./knowledge-graph');
const Mastery=require('./mastery');
const {renderGraphCourse}=require('./concept-map-view');
const action=(parent,label,fn,cls='os-quiet')=>btn(parent,label,fn,`os-button ${cls}`,e=>new Notice(e.message));
const outcomesOf=view=>view.snapshot.files.map(f=>outcomeEntry(f,view.plugin.app.metadataCache?.getFileCache?.(f)?.frontmatter)).filter(Boolean).sort((a,b)=>b.updatedAt-a.updatedAt);
async function readMap(view){
  const p=view.plugin,cache=p.app.metadataCache,courses=p.courseCatalog?.()||[];
  const parsed=p.knowledgeTopicCache||=new Map(),files=view.snapshot.files.filter(isSummaryNote),live=new Set(files.map(f=>f.path));
  for(const path of parsed.keys())if(!live.has(path))parsed.delete(path);
  const results=await Promise.all(files.map(async file=>{
    try{const fm=cache?.getFileCache?.(file)?.frontmatter,version=`${file.stat?.mtime}:${file.stat?.size}:${JSON.stringify(fm||{})}`;
      if(file.stat?.mtime&&parsed.get(file.path)?.version===version)return parsed.get(file.path).result;
      const result={topics:topicsFromNote(file,await p.app.vault.cachedRead(file),fm,courses)};parsed.set(file.path,{version,result});return result;}
    catch(error){return {topics:[],error:`${file.basename}：${error.message}`};}
  }));
  return {nodes:buildMap(results.flatMap(r=>r.topics),p.data.knowledgeMap),errors:results.filter(r=>r.error).map(r=>r.error)};
}
/**
 * 知识地图要的全部数据：标题解析（没有图谱的课回退用、也给覆盖检查用）、概念图谱、掌握度记录。
 * 图谱或掌握度文件坏了不让整页挂掉：坏的那份报出来，其余照常。
 */
async function readKnowledge(view){
  const p=view.plugin,{nodes,errors}=await readMap(view),{graphs,problems}=await KStore.loadGraphs(p,view.snapshot.files);
  let latest=new Map(),masteryError='';
  try{latest=Mastery.latestByConcept((await KStore.readMastery(p)).records);}catch(e){masteryError=e.message;}
  let unmatched=[];
  if(!masteryError&&graphs.size){try{const r=await KStore.migrateLegacy(p,graphs);unmatched=r.unmatched;if(r.migrated)latest=Mastery.latestByConcept((await KStore.readMastery(p)).records);}catch(e){console.error(e);}}
  return {nodes,errors,graphs,problems,latest,masteryError,unmatched};
}
/** 关联概念的候选：有图谱的课用图谱里的概念，其余用标题解析出的知识点。 */
function linkable(nodes,graphs){
  const out=nodes.filter(n=>!graphs.has(n.course));
  for(const g of graphs.values())for(const c of g.concepts)if(!c.retired)out.push({key:c.id,course:String(g.course),title:c.title});
  return out;
}
function courseChoices(parent,courses,value,label,change){
  const select=el(parent,'select','os-input');select.setAttribute('aria-label',label);
  el(select,'option','','选择课程').value='';for(const c of courses)el(select,'option','',c.title).value=c.id;
  select.value=value;select.onchange=()=>change(select.value);return select;
}
function markdownLinks(view,body,path){body.addEventListener('click',event=>{const link=event.target.closest?.('a.internal-link');if(!link)return;event.preventDefault();event.stopPropagation();const target=link.getAttribute('data-href')||link.getAttribute('href');if(target)Promise.resolve(view.plugin.app.workspace.openLinkText(target,path,false)).catch(e=>new Notice(e.message));});}
async function openSource(plugin,source){const at=source.indexOf('#'),path=at<0?source:source.slice(0,at);await plugin.open(path);if(at>=0)await plugin.app.workspace.openLinkText(source,'',false);}

class MemoryNoteModal extends Modal {
  constructor(view,nodes,seed={}){super(view.plugin.app);this.view=view;this.nodes=nodes;this.seed=seed;}
  onOpen(){
    const root=this.contentEl,p=this.view.plugin,seed=this.seed;root.classList.add('os-memory-editor');
    el(root,'h2','','提炼记忆笔记');el(root,'p','os-muted','留下能让你想起知识点的提示与要点，完整推导留在课堂笔记里。');
    const field=(label,tag='input',value='',placeholder='')=>{const wrap=el(root,'label','os-memory-field');el(wrap,'span','',label);const input=el(wrap,tag,'os-input');input.value=value;input.placeholder=placeholder;input.setAttribute('aria-label',label);return input;};
    let course=seed.course||'';
    const c=courseChoices(root,p.courseCatalog(),course,'成果所属课程',value=>{course=value;drawConcepts();});
    const title=field('记忆笔记标题','input',seed.title||'','例如：静止流体受力，一张图串起三个公式');
    const cue=field('回想提示','textarea','','用一句问题、一个场景或一组关键词，唤起这次课的知识');cue.rows=2;
    const body=field('精简要点','textarea','','写下最少但足够的线索：核心关系、公式适用条件、易混点。支持公式和图片。');body.rows=7;
    const source=field('课堂笔记来源','input',seed.source||'','笔记路径，可带 #小节标题');
    const concepts=el(root,'div','os-memory-concepts');const checked=new Set(seed.key?[seed.key]:[]);
    const drawConcepts=()=>{concepts.replaceChildren();el(concepts,'strong','','关联知识点');const available=this.nodes.filter(n=>n.course===course);if(!available.length)el(concepts,'p','os-muted','这门课还没有可关联的知识点。');for(const n of available){const label=el(concepts,'label','os-memory-check');const input=el(label,'input');input.type='checkbox';input.checked=checked.has(n.key);input.onchange=()=>input.checked?checked.add(n.key):checked.delete(n.key);el(label,'span','',n.title);}};
    drawConcepts();const error=el(root,'p','os-memory-error');error.setAttribute('role','alert');
    const footer=el(root,'div','os-detail-actions');let saving=false;
    action(footer,'取消',()=>this.close());
    const save=action(footer,'保存记忆笔记',async()=>{
      if(saving)return;saving=true;save.disabled=true;error.textContent='';
      try{const file=await Store.saveOutcome(p,{title:title.value,cue:cue.value,course:c.value,source:source.value,body:body.value,concepts:this.nodes.filter(n=>n.course===c.value&&checked.has(n.key)).map(n=>n.key)});this.close();this.view.outcomeState={course:c.value,path:file.path};await this.view.setTab('outcomes');}
      catch(e){error.textContent=e.message;saving=false;save.disabled=false;}
    },'os-primary');
  }
  onClose(){this.contentEl.replaceChildren();}
}


const dateLabel=key=>{const d=new Date(`${key}T12:00:00`);return Number.isNaN(d.getTime())?'':d.toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'short'});};
const classNotesOf=(view,code)=>view.snapshot.files.filter(f=>isSummaryNote(f)&&(f.path.split('/')[4]||'').startsWith(code+' '));
const noteDay=file=>{const m=/^\d{4}-(\d{2})-(\d{2})/.exec(file.basename||'');return m?`${+m[1]}/${+m[2]}`:file.basename;};
// 后台任务/计时事件不改变地图内容。只在图谱、掌握记录、课堂笔记或
// 关联精简笔记变化时重建，保留详情卡的滚动、展开状态和公式 DOM。
function knowledgeRevision(view){
  const p=view.plugin,files=p.app.vault.getFiles?.()||[];
  const rows=[];
  for(const f of files){
    const fm=p.app.metadataCache?.getFileCache?.(f)?.frontmatter;
    if(isSummaryNote(f)||f.path.startsWith('03 知识库/知识地图/')||fm?.type==='learning-outcome')
      rows.push([f.path,f.stat?.mtime,f.stat?.size,fm]);
  }
  rows.sort((a,b)=>a[0].localeCompare(b[0]));
  return JSON.stringify([rows,p.courseCatalog?.()||[],p.data.knowledgeMap,Mastery.isoWeek()]);
}
async function renderKnowledgeMap(view){
  const p=view.plugin,generation=view.generation,state=view.mapState||={course:'',key:'',expanded:[]};
  const alive=()=>!view.closed&&view.generation===generation;
  const panel=view.panel(view.content,'知识地图','','os-fill os-map-panel');
  el(panel.body,'p','os-muted','正在整理课程知识点…');
  const {nodes,errors,graphs,problems,latest,masteryError,unmatched}=await readKnowledge(view);if(!alive())return;
  const outcomes=outcomesOf(view),courses=[...(p.courseCatalog?.()||[])];
  for(const n of nodes)if(!courses.some(c=>String(c.id)===n.course))courses.push({id:n.course,title:n.courseTitle});
  for(const g of graphs.values())if(!courses.some(c=>String(c.id)===String(g.course)))courses.push({id:String(g.course),title:g.title});
  panel.body.replaceChildren();panel.body.classList.add('os-map-body');
  const warn=(summary,lines)=>{const warning=el(panel.body,'details','os-map-warning');el(warning,'summary','',summary);for(const line of lines)el(warning,'p','',line);};
  if(errors.length)warn(`${errors.length} 篇笔记未能读取`,errors);
  if(problems.length)warn(`${problems.length} 份概念图谱没通过检查，这几门课暂按课堂笔记标题显示`,problems.flatMap(x=>x.errors.slice(0,6).map(e=>`${x.file}：${e}`)));
  if(masteryError)warn('掌握度记录读不出来，档位暂时都显示为待自评',[masteryError,'文件：'+Mastery.MASTERY_PATH]);
  if(unmatched.length)warn(`${unmatched.length} 条旧版自评对不上新概念`,unmatched.map(k=>{try{return decodeURIComponent(k.slice(k.indexOf(':')+1));}catch{return k;}}));
  if(!state.course){
    // 只给有课堂笔记的课画卡。九门课里一半是下学期的，九张卡里五张写着「还没有知识点」，要找的那几张反而埋在里面。
    const withTopics=courses.filter(c=>graphs.has(String(c.id))||nodes.some(n=>n.course===String(c.id))),rest=courses.filter(c=>!withTopics.includes(c));
    view.pageStatusEl.textContent=`${withTopics.length} 门课有课堂知识点`;
    const grid=el(panel.body,'div','os-map-courses');
    for(const c of withTopics){
      const graph=graphs.get(String(c.id));
      const items=graph?graph.concepts.filter(x=>!x.retired).map(x=>({status:latest.get(x.id)?.level||'unknown',examples:x.examples||[]})):nodes.filter(n=>n.course===String(c.id));
      const count=id=>items.filter(n=>n.status===id).length;
      const card=action(grid,'',async()=>{Object.assign(state,{course:String(c.id),key:'',source:'',expanded:[],mobile:false,cardOpen:false,mode:''});await view.refresh(true);},'os-map-course');
      el(card,'span','os-overline',c.id);el(card,'h3','',c.title);
      el(card,'p','os-muted',`${items.length} 个${graph?'概念':'知识点'} · ${items.reduce((n,t)=>n+t.examples.length,0)} 道例题`);
      const bar=el(card,'span','os-map-mastery');bar.setAttribute('aria-label',`能应用 ${count('applied')} 个，已理解 ${count('understood')} 个，需巩固 ${count('review')} 个，待自评 ${count('unknown')} 个`);
      for(const id of ['applied','understood','review','unknown'])if(count(id))el(bar,'i',`is-${id}`).style.flexGrow=String(count(id));
      // 有课堂笔记还没整理进图谱：待办提醒，整理完就消失，不是常驻计数。
      const stale=graph?G.staleNotes(graph,classNotesOf(view,String(c.id))):[];
      if(stale.length)el(card,'p','os-map-stale',`${stale.map(noteDay).join('、')} 笔记未整理`);
      else if(!graph)el(card,'p','os-map-stale is-quiet','还没整理成概念图谱');
      el(card,'span','os-map-enter','展开知识地图 →');
    }
    if(!withTopics.length)view.empty(grid,'还没有课堂知识点','课堂笔记整理成概念图谱后，会出现在这里。');
    if(rest.length)el(panel.body,'p','os-map-rest',`${rest.map(c=>c.title).join('、')}：还没有课堂笔记。`);
    return;
  }
  const course=courses.find(c=>String(c.id)===state.course),graph=graphs.get(state.course);
  action(panel.tools,'← 全部课程',async()=>{Object.assign(state,{course:'',key:'',source:'',cardOpen:false,mode:''});await view.refresh(true);});
  action(panel.tools,'这门课的学习进展',()=>view.showOutcomes(state.course));
  if(graph)return renderGraphCourse(view,{graph,panel,latest,outcomes});
  renderLegacyCourse(view,{panel,course,nodes,outcomes});
}

/** 过渡期：还没有概念图谱的课，继续按 7.4 的标题解析列出来。导图要等图谱整理好。 */
function renderLegacyCourse(view,{panel,course,nodes,outcomes}){
  const p=view.plugin,state=view.mapState,topics=nodes.filter(n=>n.course===state.course);
  view.pageStatusEl.textContent=`${course?.title||state.course} · ${topics.length} 个知识点`;
  const bar=el(panel.body,'div','os-map-toolbar'),modes=el(bar,'div','os-segments');
  const mind=action(modes,'导图',()=>{});mind.disabled=true;mind.title='这门课还没整理成概念图谱，导图要等图谱整理好';action(modes,'列表',()=>{},'is-active');
  el(bar,'span','os-muted os-map-note','这门课还没整理成概念图谱，暂按课堂笔记标题列出');
  if(!topics.length){view.empty(panel.body,'还没有知识点','整理课堂笔记的章节与小节后，这里会呈现主题结构。');if(course)action(panel.body,'打开课程',()=>p.openCourse(course),'os-primary');return;}
  if(state.source&&!state.key)state.key=topics.find(n=>n.sources.some(s=>s.path===state.source))?.key||'';
  const byKey=new Map(topics.map(n=>[n.key,n]));
  // A single primary hierarchy avoids drawing the same topic several times.
  const parent=new Map();for(const n of topics){const candidate=n.parents.find(k=>byKey.has(k));if(!candidate)continue;let cursor=candidate,cycle=false;const seen=new Set([n.key]);while(cursor){if(seen.has(cursor)){cycle=true;break;}seen.add(cursor);cursor=parent.get(cursor);}if(!cycle)parent.set(n.key,candidate);}
  const children=new Map();for(const n of topics){const key=parent.get(n.key)||'';if(!children.has(key))children.set(key,[]);children.get(key).push(n);}
  // 顶层主题按第一次出现的那节课分组，一节课一组，按日期排。
  const roots=[...(children.get('')||[])].sort((a,b)=>a.firstDate.localeCompare(b.firstDate));
  if(!byKey.has(state.key))state.key=roots[0].key;
  const expanded=new Set(state.expanded||[]);let ancestor=parent.get(state.key);while(ancestor){expanded.add(ancestor);ancestor=parent.get(ancestor);}
  const layout=el(panel.body,'div','os-map-layout'),tree=el(layout,'nav','os-concept-tree'),detail=el(layout,'article','os-concept-detail');layout.classList.toggle('has-concept',!!state.mobile);tree.dataset.scroll='concept-tree';detail.dataset.scroll='concept-detail';tree.setAttribute('aria-label',`${course?.title||state.course} 知识点`);
  const branchRoot=el(tree,'div');
  let owner=null;view.knowledgeCleanup=()=>{owner?.unload();owner=null;};
  const select=n=>{for(let a=parent.get(n.key);a;a=parent.get(a))expanded.add(a);state.expanded=[...expanded];state.key=n.key;state.mobile=true;layout.classList.add('has-concept');paint();show(n);detail.scrollTop=0;};
  const paint=()=>{
    branchRoot.replaceChildren();
    const row=(n,container)=>{const group=el(container,'div','os-concept-branch');const line=el(group,'div','os-concept-row');
      const has=children.has(n.key),open=expanded.has(n.key);
      const toggle=action(line,has?(open?'▾':'▸'):'',()=>{open?expanded.delete(n.key):expanded.add(n.key);state.expanded=[...expanded];paint();},'os-concept-toggle');toggle.setAttribute('aria-label',`展开或收起 ${n.title}`);toggle.setAttribute('aria-expanded',String(open));toggle.disabled=!has;
      const button=action(line,'',()=>select(n),`os-concept-node${state.key===n.key?' is-active':''}`);button.dataset.key=n.key;button.title=n.title;button.setAttribute('aria-pressed',String(state.key===n.key));
      const mark=el(button,'span',`os-mastery-mark is-${n.status}`,n.status==='review'?'!':'');mark.setAttribute('aria-label',LEVELS[n.status]);mark.setAttribute('role','img');el(button,'span','os-concept-title',n.title);
      if(has&&open){const sub=el(group,'div','os-concept-children');for(const c of children.get(n.key))row(c,sub);}
    };
    let date=null;
    for(const n of roots){if(n.firstDate!==date){date=n.firstDate;el(branchRoot,'p','os-concept-lecture',dateLabel(date)||'未注明日期');}row(n,branchRoot);}
  };
  function show(node){
    owner?.unload();owner=null;detail.replaceChildren();
    action(detail,'← 知识点列表',()=>{state.mobile=false;layout.classList.remove('has-concept');},'os-map-back os-quiet');
    if(parent.has(node.key)){const up=byKey.get(parent.get(node.key));action(detail,`${up.title} ›`,()=>select(up),'os-concept-up os-quiet');}
    el(detail,'h2','',node.title);
    const levels=el(detail,'div','os-segments os-concept-levels');levels.setAttribute('role','group');levels.setAttribute('aria-label','我的掌握情况');
    for(const [id,title] of Object.entries(LEVELS)){const b=action(levels,title,async()=>{if(node.status===id)return;try{await Store.setStatus(p,node.key,id);node.status=id;paint();show(node);}catch(e){new Notice(e.message);}},node.status===id?'is-active':'');b.setAttribute('aria-pressed',String(node.status===id));}
    // 课堂笔记里这一节自己的正文，就地渲染：看一眼这个概念讲了什么，不用切到笔记里去。
    const source=node.sources[0],excerpt=el(detail,'section','os-concept-excerpt');excerpt.setAttribute('aria-label','课堂笔记原文');
    el(excerpt,'p','os-overline',`${dateLabel(source.date)||source.path.split('/').pop()} · 课堂笔记`);
    if(source.lead){const body=el(excerpt,'div','os-concept-excerpt-body');owner=markdownOwner();renderMarkdown(p.app,owner,body,source.lead,source.path);markdownLinks(view,body,source.path);}
    else if(children.has(node.key)){el(excerpt,'p','os-muted','这一节的内容都在下面几个小节里：');const list=el(excerpt,'div','os-concept-subs');for(const c of children.get(node.key))action(list,c.title,()=>select(c));}
    else el(excerpt,'p','os-muted','这一节只有标题。');
    if(node.examples.length){el(detail,'h3','',`例题 · ${node.examples.length}`);const list=el(detail,'div','os-concept-examples');for(const e of node.examples)action(list,e.title,()=>openSource(p,e.path+'#'+e.heading));}
    const linked=outcomes.filter(o=>o.course===node.course&&o.concepts.includes(node.key));
    if(linked.length){el(detail,'h3','','记忆线索');for(const o of linked)action(detail,o.cue,()=>view.showOutcomes(node.course,o.path));}
    if(node.sources.length>1){const sources=el(detail,'details','os-concept-sources');el(sources,'summary','',`其他课堂来源 · ${node.sources.length-1} 处`);
      for(const s of node.sources.slice(1))action(sources,`${dateLabel(s.date)||s.path.split('/').pop()} · ${s.heading}`,()=>openSource(p,s.path+'#'+s.heading));}
    const actions=el(detail,'div','os-detail-actions');action(actions,'打开课堂笔记',()=>openSource(p,node.sources[0].path+'#'+node.sources[0].heading),'os-primary');
  }
  paint();show(byKey.get(state.key));
  tree.querySelector('.os-concept-node.is-active')?.scrollIntoView?.({block:'nearest'});
}

async function renderOutcomes(view){
  const p=view.plugin,generation=view.generation,state=view.outcomeState||={course:'',path:''};
  const alive=()=>!view.closed&&view.generation===generation;
  const panel=view.panel(view.content,'学习进展','','os-fill os-outcome-panel');panel.body.classList.add('os-outcome-body','os-progress-body');
  el(panel.body,'p','os-muted','正在汇总学习记录…');
  const {graphs,problems}=await KStore.loadGraphs(p,view.snapshot.files);
  let records=[],error='';
  try{records=(await KStore.readMastery(p)).records;}catch(e){error='掌握记录暂时读不出来，能力状态未显示。';}
  if(!alive())return;
  panel.body.replaceChildren();
  if(error||problems.length)el(panel.body,'p','os-map-warning',error||'部分知识地图读取失败，对应课程暂不显示能力状态。');
  const entries=outcomesOf(view),courses=[...(p.courseCatalog?.()||[])];
  for(const g of graphs.values())if(!courses.some(c=>String(c.id)===String(g.course)))courses.push({id:String(g.course),title:g.title});
  for(const f of view.snapshot.files.filter(isSummaryNote)){
    const folder=f.path.split('/')[4],id=folder.split(' ')[0];
    if(!courses.some(c=>String(c.id)===id))courses.push({id,title:folder.slice(id.length).trim()||id});
  }
  for(const e of entries)if(e.course&&!courses.some(c=>String(c.id)===e.course))courses.push({id:e.course,title:e.course});
  const toolbar=el(panel.body,'div','os-outcome-toolbar');
  const select=courseChoices(toolbar,courses,state.course,'学习进展课程',value=>{state.course=value;draw();});select.options[0].textContent='全部课程';
  const overview=el(panel.body,'div','os-progress-overview');
  const list=el(panel.body,'div','os-progress-list');
  const inactive=el(panel.body,'details','os-progress-inactive');
  function draw(){
    list.replaceChildren();overview.replaceChildren();inactive.replaceChildren();inactive.hidden=true;
    const shown=courses.filter(c=>!state.course||String(c.id)===state.course);
    const relevant=entries.filter(e=>!state.course||e.course===state.course);
    const heading=el(overview,'div');el(heading,'p','os-overline','学习进展');el(heading,'h2','','精简笔记');
    el(heading,'p','os-muted','关键概念与解题方法，打开即可回看。');
    const total=el(overview,'div','os-progress-total');el(total,'strong','',String(relevant.length));el(total,'span','','份笔记');
    const hasContent=c=>{const id=String(c.id);return entries.some(e=>e.course===id)||classNotesOf(view,id).length||(graphs.get(id)?.chapters||[]).some(ch=>ch.status==='learned')||records.some(r=>String(r.course)===id);};
    const active=shown.filter(hasContent),waiting=shown.filter(c=>!hasContent(c));
    active.sort((a,b)=>Number(entries.some(e=>e.course===String(b.id)))-Number(entries.some(e=>e.course===String(a.id))));
    if(!state.course&&waiting.length){inactive.hidden=false;el(inactive,'summary','',`尚未开始 · ${waiting.length} 门课`);const links=el(inactive,'div','os-progress-waiting');for(const c of waiting)action(links,c.title,()=>{state.course=String(c.id);select.value=state.course;draw();});}
    view.pageStatusEl.textContent=`${shown.length} 门课 · 学到哪，会什么，接下来补什么`;
    if(!shown.length){view.empty(list,'还没有课程记录','添加课程或课堂笔记后，这里会汇总学习进展。');return;}
    for(const course of state.course?shown:active){
      const id=String(course.id),graph=graphs.get(id),notes=classNotesOf(view,id),saved=entries.filter(e=>e.course===id);
      const progress=courseProgress(graph||{course:id,concepts:[]},records);
      const card=el(list,'section','os-progress-course');card.dataset.course=id;
      const head=el(card,'header','os-progress-course-head');
      el(head,'span','os-progress-monogram',course.title.slice(0,1)).setAttribute('aria-hidden','true');
      const caption=el(head,'div');el(caption,'p','os-overline',id);el(caption,'h3','',course.title);
      const learned=(graph?.chapters||[]).filter(c=>c.status==='learned');
      el(card,'p','os-muted os-progress-position',learned.length?`已学至 · ${learned.at(-1).title}`:notes.length?`已整理 ${notes.length} 篇课堂笔记`:'还没有课堂笔记');
      const notebook=el(card,'div','os-progress-notebook');
      const noteHead=el(notebook,'div','os-progress-note-heading');el(noteHead,'strong','','精简笔记');el(noteHead,'span','os-muted',saved.length?`${saved.length} 份`:'待提炼');
      const noteLink=(parent,e)=>{
        const link=action(parent,'',()=>p.open(e.path),'os-progress-note');link.setAttribute('aria-label',e.title);
        const copy=el(link,'span','os-progress-note-copy');el(copy,'strong','',e.title);
        if(e.cue&&e.cue!==e.title)el(copy,'span','os-progress-note-cue',e.cue);
        el(link,'span','os-progress-note-arrow','↗').setAttribute('aria-hidden','true');
      };
      for(const e of saved.slice(0,2))noteLink(notebook,e);
      if(saved.length>2){const more=el(notebook,'details','os-progress-more');el(more,'summary','',`其余 ${saved.length-2} 份笔记`);for(const e of saved.slice(2))noteLink(more,e);}
      if(!saved.length)el(notebook,'p','os-progress-note-empty',notes.length?'课堂笔记已整理，精简笔记待提炼。':'学习后，在这里留下关键方法。');
      const line=(label,items)=>{
        if(!items.length)return;
        const row=el(card,'div','os-progress-row');el(row,'span','os-progress-label',label);
        const links=el(row,'div','os-progress-concepts');
        for(const c of items.slice(0,2))action(links,c.title,()=>view.showMap(id,c.id)).title=Mastery.basisLabel(c.record);
        if(items.length>2)action(links,`另 ${items.length-2} 项`,()=>view.showMap(id));
      };
      line('自测 · 能应用',progress.applied);line('自测 · 已理解',progress.understood);
      line('待补强',progress.review);line('自评 · 待验证',progress.self);
      if(!progress.applied.length&&!progress.understood.length&&!progress.review.length&&!progress.self.length)el(card,'p','os-progress-empty',error?'掌握情况暂不可用':'○ 掌握情况待自测验证');
      const paths=new Set([...notes.map(f=>f.path),...saved.map(e=>e.path)]);
      const due=(view.snapshot.cards||[]).filter(c=>paths.has(c.path||c.key)&&c.due<=Date.now());
      const actions=el(card,'div','os-progress-actions');
      action(actions,'知识地图',()=>view.showMap(id));
      action(actions,progress.review.length?'去自测补强':'周五自测',()=>{view.quizState={week:'',course:id,redo:null};return view.setTab('quiz');});
      if(notes.length)action(actions,'课堂笔记',()=>{view.summaryState={query:'',course:id,date:'',path:'',mobileDetail:false};return view.setTab('summaries');});
      if(due.length)action(actions,`回顾 ${due.length} 项`,()=>view.owner('l-os-recall')?.review(due[0].key));
    }
  }
  draw();
}
module.exports={renderKnowledgeMap,renderOutcomes,MemoryNoteModal,knowledgeRevision};
