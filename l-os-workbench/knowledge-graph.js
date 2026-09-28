"use strict";
/*
 * 概念图谱：agent 从课堂笔记整理出来、写在库里的 JSON（03 知识库/知识地图/<代码 课程>.json）。
 * 这里只有纯函数：插件加载时做结构检查，tools/check-knowledge-graph.cjs 再加上读文件的深检查。
 * 规则见 docs/知识图谱与出题规范.md。
 */
const {scan}=require('./reading-rail-model');
const {topicsFromNote}=require('./learning-hub-model');
const GRAPH_DIR='03 知识库/知识地图';
const ID=/^c-[a-z0-9]+(?:-[a-z0-9]+)*$/,CHAPTER=/^ch\d{2}$/,DATE=/^\d{4}-\d{2}-\d{2}$/;
const isGraphPath=path=>path.startsWith(GRAPH_DIR+'/')&&/\/\d+ [^/]+\.json$/.test(path);
const text=v=>typeof v==='string'&&v.trim()!=='';
const list=v=>Array.isArray(v)?v:[];

/** 插件加载时就查的部分：不读别的文件。有错就整份不用，回退到标题解析。 */
function structureErrors(graph){
  const errors=[],say=(where,msg)=>errors.push(`${where}：${msg}`);
  if(!graph||typeof graph!=='object'||Array.isArray(graph))return ['不是 JSON 对象'];
  if(!/^\d+$/.test(String(graph.course||'')))say('course','缺少课程代码');
  if(!text(graph.title))say('title','缺少课程名');
  for(const key of ['notes','chapters','concepts'])if(!Array.isArray(graph[key]))say(key,'应为数组');
  const chapters=new Set();
  for(const [i,c] of list(graph.chapters).entries()){
    const at=`chapters[${i}]`;
    if(!CHAPTER.test(c?.id||''))say(at,`章节 ID「${c?.id}」应为 ch01 这种格式`);
    else if(chapters.has(c.id))say(at,`章节 ID ${c.id} 重复`);
    chapters.add(c?.id);
    if(!Number.isFinite(c?.order))say(at,'缺少 order');
    if(!text(c?.title))say(at,'缺少标题');
    if(!['learned','planned'].includes(c?.status))say(at,'status 只能是 learned 或 planned');
  }
  const ids=new Set(),live=new Set();
  for(const c of list(graph.concepts)){if(ids.has(c?.id))say(c.id,'概念 ID 重复');ids.add(c?.id);if(!c?.retired)live.add(c?.id);}
  const legacy=new Map();
  for(const [i,c] of list(graph.concepts).entries()){
    const at=c?.id||`concepts[${i}]`;
    if(!ID.test(c?.id||''))say(at,'概念 ID 应为 c- 加小写英文短语');
    if(!chapters.has(c?.chapter))say(at,`章节 ${c?.chapter} 不存在`);
    if(!text(c?.title))say(at,'缺少标题');
    if(c?.retired)continue;
    if(!text(c?.summary))say(at,'缺少一句话摘要');
    if(!DATE.test(c?.firstTaught||''))say(at,'firstTaught 应为 YYYY-MM-DD');
    for(const key of ['formulas','points','prereqs','related','sources','examples','legacyKeys'])if(c?.[key]!=null&&!Array.isArray(c[key]))say(at,`${key} 应为数组`);
    if(!list(c?.sources).length)say(at,'至少要有一处课堂来源');
    for(const s of [...list(c?.sources),...list(c?.examples)])if(!text(s?.path)||!text(s?.heading))say(at,'来源和例题都要写 path 与 heading');
    for(const kind of ['prereqs','related'])for(const other of list(c?.[kind])){
      if(other===c.id)say(at,`${kind} 指向了自己`);
      else if(!ids.has(other))say(at,`${kind} 里的 ${other} 不存在`);
      else if(!live.has(other))say(at,`${kind} 里的 ${other} 已退役`);
    }
    for(const key of list(c?.legacyKeys)){if(legacy.has(key)&&legacy.get(key)!==c.id)say(at,`旧键同时属于 ${legacy.get(key)}`);legacy.set(key,c.id);}
  }
  const cycle=prereqCycle(list(graph.concepts));
  if(cycle)say('prereqs',`先修关系成环：${cycle.join(' → ')}`);
  return errors;
}

/** 先修图里的一个环（没有就返回 null）。 */
function prereqCycle(concepts){
  const edges=new Map(concepts.filter(c=>!c?.retired).map(c=>[c.id,list(c.prereqs)])),state=new Map(),path=[];
  const visit=id=>{
    if(state.get(id)===2||!edges.has(id))return null;
    if(state.get(id)===1)return [...path.slice(path.indexOf(id)),id];
    state.set(id,1);path.push(id);
    for(const next of edges.get(id)){const found=visit(next);if(found)return found;}
    path.pop();state.set(id,2);return null;
  };
  for(const id of edges.keys()){const found=visit(id);if(found)return found;}
  return null;
}

/** 每个标题自己那一节的全文（到下一个同级或更高的标题为止），公式抽查用。 */
function sectionsOf(source){
  const lines=String(source).replace(/\r\n?/g,'\n').split('\n'),{headings}=scan(source),out=new Map();
  headings.forEach((h,i)=>{let end=lines.length;for(let j=i+1;j<headings.length;j++)if(headings[j].level<=h.level){end=headings[j].line;break;}
    if(!out.has(h.heading))out.set(h.heading,lines.slice(h.line+1,end).join('\n'));});
  return out;
}
const squash=s=>String(s).replace(/\s+/g,'');

/**
 * 读文件的深检查：来源与例题的标题存在、公式能在来源原文里找到、笔记没有漏整理的小节。
 * read(path) 返回笔记全文，文件不存在时返回 null。previous 是上一版图谱，用来查有没有概念 ID 消失。
 */
function deepErrors(graph,read,previous=null){
  const errors=[],say=(where,msg)=>errors.push(`${where}：${msg}`),cache=new Map();
  const note=path=>{if(!cache.has(path)){const body=read(path);cache.set(path,body==null?null:{body,sections:sectionsOf(body)});}return cache.get(path);};
  const exists=(at,s,kind)=>{const n=note(s.path);if(!n){say(at,`${kind}文件不存在：${s.path}`);return null;}if(!n.sections.has(s.heading)){say(at,`${kind}标题不存在：${s.path.split('/').pop()}#${s.heading}`);return null;}return n;};
  for(const n of list(graph.notes))if(!note(n.path))say('notes',`笔记不存在：${n.path}`);
  const covered=new Set(),legacy=new Set(),mark=s=>covered.add(`${s.path}#${s.heading}`);
  for(const c of list(graph.concepts)){
    for(const s of list(c.sources)){mark(s);if(!c.retired)exists(c.id,s,'来源');}
    for(const e of list(c.examples)){mark(e);if(!c.retired)exists(c.id,e,'例题');}
    for(const key of list(c.legacyKeys))legacy.add(key);
    if(c.retired)continue;
    const texts=list(c.sources).map(s=>note(s.path)?.sections.get(s.heading)).filter(t=>t!=null).map(squash);
    for(const f of list(c.formulas))if(!texts.some(t=>t.includes(squash(f))))say(c.id,`公式在来源原文里找不到：${f}`);
  }
  for(const s of list(graph.ignored)){mark(s);if(!text(s.reason))say('ignored',`${s.heading} 缺少原因`);exists('ignored',s,'跳过的');}
  // 覆盖检查：旧标题解析器从「地图本身」退为「检查 agent 有没有漏」。
  for(const n of list(graph.notes)){
    const body=note(n.path)?.body;if(body==null)continue;
    const file={path:n.path,basename:n.path.split('/').pop().replace(/\.md$/,''),extension:'md'};
    for(const t of topicsFromNote(file,body)){
      if(covered.has(`${t.source.path}#${t.source.heading}`)||(!t.example&&legacy.has(t.key)))continue;
      say(file.basename,`${t.example?'例题':'小节'}没有归进任何概念，也没列进 ignored：${t.source.heading}`);
    }
  }
  if(previous){const now=new Set(list(graph.concepts).map(c=>c.id));for(const c of list(previous.concepts))if(!now.has(c.id))say(c.id,'上一版有这个概念，这一版不见了；删除请改成 retired: true');}
  return errors;
}

/** 一门课还有哪些课堂笔记没整理进图谱：没收录的，或收录后又改过的。 */
function staleNotes(graph,files){
  const done=new Map(list(graph?.notes).map(n=>[n.path,Date.parse(n.integratedAt)||0]));
  return files.filter(f=>!done.has(f.path)||(f.stat?.mtime||0)>done.get(f.path)+60000);
}

/**
 * 界面用的一门课：章节按顺序，概念带上当前档位、最新记录、是否本周新学、后续概念。
 * latest 是概念 ID → 最新掌握度记录；fresh(dateKey) 判断是否在本周。
 */
function courseModel(graph,latest=new Map(),fresh=()=>false){
  const chapters=[...list(graph.chapters)].sort((a,b)=>a.order-b.order);
  const live=list(graph.concepts).filter(c=>!c.retired),after=new Map();
  for(const c of live)for(const p of list(c.prereqs)){if(!after.has(p))after.set(p,[]);after.get(p).push(c.id);}
  const concepts=live.map(c=>{const record=latest.get(c.id)||null;return {...c,level:record?.level||'unknown',record,fresh:fresh(c.firstTaught),successors:after.get(c.id)||[]};});
  const byId=new Map(concepts.map(c=>[c.id,c])),legacy=new Map();
  for(const c of concepts)for(const key of list(c.legacyKeys))legacy.set(key,c.id);
  return {chapters,concepts,byId,legacy,
    inChapter:id=>concepts.filter(c=>c.chapter===id),
    chapterOf:c=>chapters.find(ch=>ch.id===c.chapter),
    // 学习成果里存的可能是旧键，也可能是新 ID。
    resolve:key=>byId.has(key)?key:legacy.get(key)||''};
}
const FILTERS={all:'全部',review:'需巩固',fresh:'本周新学'};
const matchesFilter=(c,filter)=>filter==='review'?c.level==='review':filter==='fresh'?c.fresh:true;

module.exports={GRAPH_DIR,isGraphPath,structureErrors,deepErrors,prereqCycle,sectionsOf,staleNotes,courseModel,FILTERS,matchesFilter};
