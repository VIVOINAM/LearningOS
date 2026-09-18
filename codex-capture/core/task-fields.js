"use strict";
const ID=/<!--\s*task:([^>\s]+)\s*-->/;
const META=/\s*<!-- los:(.*?) -->/g;
function fields(raw) {
  let meta={};const match=raw.match(/<!-- los:(.*?) -->/);
  if(match) {try{meta=JSON.parse(decodeURIComponent(match[1]));}catch(e){return {id:raw.match(ID)?.[1]||'',invalid:true};}}
  return {...meta,id:raw.match(ID)?.[1]||'',revision:Number(meta.revision)||0};
}
function edit(content, task, patch, id) {
  const eol=content.includes('\r\n')?'\r\n':'\n',lines=content.split(/\r?\n/);
  const currentId=task.id||fields(task.raw).id;
  const matches=lines.map((line,i)=>(currentId?fields(line).id===currentId:line===task.raw.replace(/\r$/,''))?i:-1).filter(i=>i>=0);
  if(matches.length!==1)throw Error('任务已移动、删除或存在重复 ID，请刷新后重试');
  const index=matches[0],raw=lines[index];
  if(raw!==task.raw.replace(/\r$/,''))throw Error('任务已被其他视图修改；草稿已保留，请重新载入后合并');
  if(!/^\s*- \[[ xX]\] /.test(raw))throw Error('任务已删除');
  const before=fields(raw);if(before.invalid)throw Error('任务元数据损坏，请先检查原文');
  const allowed=['next_action','details','estimated_pomodoros','budget_unit_minutes','project','category','priority_level','outcome','repeat','repeat_interval','duration_days','due_at','reminder_at','reminder_sent','tags','references','checklist'];
  const meta={...before,schema:2,revision:before.revision+1};delete meta.id;
  for(const key of allowed)if(Object.hasOwn(patch,key))meta[key]=patch[key];
  if(meta.estimated_pomodoros!==null&&meta.estimated_pomodoros!==undefined&&(!Number.isInteger(meta.estimated_pomodoros)||meta.estimated_pomodoros<1||meta.estimated_pomodoros>99))throw Error('预计番茄数须为 1–99 的整数，或留空');
  if(!meta.budget_unit_minutes)meta.budget_unit_minutes=25;
  if(!Number.isInteger(meta.budget_unit_minutes)||meta.budget_unit_minutes<1||meta.budget_unit_minutes>180)throw Error('预算单位无效');
  for(const key of ['next_action','details','project'])if(meta[key]!==undefined)meta[key]=String(meta[key]).slice(0,key==='details'?10000:1000);
  let line=raw.replace(META,'');
  if(Object.hasOwn(patch,'title')) {
    const title=String(patch.title).replace(/[\r\n]+/g,' ').replace(/<!--.*?-->/g,'').trim();
    if(!title)throw Error('标题不能为空');
    const comments=line.match(/<!--.*?-->/g)||[];
    const due=line.match(/(?:📅\s*|due::\s*)\d{4}-\d{2}-\d{2}/)?.[0]||'';
    line=line.match(/^\s*- \[[ xX]\] /)[0]+title+' '+comments.join(' ');
    if(due&&!/(?:📅\s*|due::\s*)\d{4}-\d{2}-\d{2}/.test(title))line+=' '+due;
  }
  if(Object.hasOwn(patch,'due')) {
    const due=String(patch.due||'');
    if(due&&(!/^\d{4}-\d{2}-\d{2}$/.test(due)||Number.isNaN(Date.parse(due))||new Date(due).toISOString().slice(0,10)!==due))throw Error('截止日期无效');
    line=line.replace(/\s*(?:📅\s*|due::\s*)\d{4}-\d{2}-\d{2}/g,'');
    if(due)line+=' 📅 '+due;
  }
  if(Object.hasOwn(patch,'scheduled')) {
    const value=String(patch.scheduled||'backlog');
    if(value!=='backlog'&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))throw Error('计划日期无效');
    line=line.replace(/\s*<!--\s*scheduled:[^>]+-->/g,'')+` <!-- scheduled:${value} -->`;
  }
  if(!currentId)line+=` <!-- task:${id} -->`;
  lines[index]=line.trimEnd()+` <!-- los:${encodeURIComponent(JSON.stringify(meta))} -->`;
  return {content:lines.join(eol),id:currentId||id};
}
module.exports={fields,edit};
