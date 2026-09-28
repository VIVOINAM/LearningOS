"use strict";
const {Modal,Notice}=require('obsidian');
const model=require('./core/capture-model');
const {el}=require('../shared/dom');
class TaskModal extends Modal {
 constructor(plugin,options={}){super(plugin.app);this.p=plugin;this.options=options;}
 onOpen(){
  const o=this.options,t=o.task||{},quick=!!o.quick,root=this.contentEl;root.replaceChildren();root.classList.add('los-task-modal');
  el(root,'h2','',t.id?'编辑任务':quick?'添加今日任务':'创建任务');
  const form=el(root,'form','los-task-form'),body=el(form,'div','los-form-body'),fields={};
  const field=(p,key,label,type='text',value='')=>{const wrap=el(p,'label','los-form-field');el(wrap,'span','',label);const e=el(wrap,type==='textarea'?'textarea':type==='select'?'select':'input');if(!['textarea','select'].includes(type))e.type=type;e.setAttribute('aria-label',label);e.value=value??'';if(type==='textarea')e.rows=2;fields[key]=e;return e;};
  const select=(p,key,label,choices,value)=>{const e=field(p,key,label,'select');for(const [v,label] of choices)el(e,'option','',label).value=v;e.value=value;return e;};
  const title=field(body,'title','任务名称 *','text',(t.text||o.title||'').replace(/(?:📅\s*|due::\s*)\d{4}-\d{2}-\d{2}/g,'').trim());title.required=true;title.maxLength=500;
  const core=el(body,'div','los-form-grid');
  const files=this.p.app.vault.getMarkdownFiles().filter(f=>f.path.startsWith('02 项目/')&&f.path!=='02 项目/项目导航.md');
  const projects=[['','独立任务'],...files.map(f=>[f.path,f.basename])];if(t.project&&!projects.some(x=>x[0]===t.project))projects.push([t.project,t.project]);
  const project=select(core,'project','所属项目（可选）',projects,t.project||o.project||'');
  project.setAttribute('aria-label','所属项目');
  const tomato=el(core,'div','los-form-field');const estimate=field(tomato,'estimated_pomodoros','预计番茄数','number',t.estimated_pomodoros||1);estimate.min=1;estimate.max=99;
  const steps=el(tomato,'div','los-stepper');for(const [n,label] of [[-1,'−1🍅'],[1,'+1🍅']]){const b=el(steps,'button','',label);b.type='button';b.onclick=()=>estimate.value=String(Math.max(1,Math.min(99,(Number(estimate.value)||1)+n)));}
  if(quick)el(body,'p','los-form-hint','今日任务 · 单次 · 1 天');
  const more=quick?el(body,'details','los-form-more'):body;if(quick)el(more,'summary','','补充详情');
  const basics=el(more,'div','los-form-grid');
  field(basics,'category','分类','text',t.category||'');select(basics,'priority_level','优先级',[['P1','P1 紧急'],['P2','P2 高'],['P3','P3 普通'],['P4','P4 低']],t.priority_level||'P3');
  field(basics,'due_at','截止时间','datetime-local',t.due_at||(t.due?t.due+'T23:59':''));field(basics,'reminder_at','提醒时间','datetime-local',t.reminder_at||'');
  field(more,'details','任务描述','textarea',t.details||'');field(more,'outcome','预计成果 / 完成标准','textarea',t.outcome||'');
  if(!quick){const row=el(more,'div','los-form-grid');select(row,'repeat','周期与重复',[['once','单次'],['daily','每天'],['weekly','每周'],['custom','自定义（每 N 天）']],t.repeat||'once');const interval=field(row,'repeat_interval','间隔天数','number',t.repeat_interval||1);interval.min=1;interval.max=365;const sync=()=>interval.parentElement.hidden=fields.repeat.value!=='custom';fields.repeat.onchange=sync;sync();}
  const checks=el(more,'section','los-checklist');el(checks,'h3','','拆解子任务');const list=el(checks,'div');this.checks=[];
  const addCheck=(text='',done=false)=>{const row=el(list,'div','los-check-row'),check=el(row,'input');check.type='checkbox';check.checked=done;check.setAttribute('aria-label','子任务完成');const value=el(row,'input');value.value=text;value.placeholder='一个可执行的小步骤';value.setAttribute('aria-label','子任务内容');const remove=el(row,'button','','移除');remove.type='button';const item={row,check,value};this.checks.push(item);remove.onclick=()=>{row.remove();this.checks=this.checks.filter(x=>x!==item);};value.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();addCheck().focus();}};return value;};
  for(const c of t.checklist||[])addCheck(c.text,c.done);const add=el(checks,'button','','＋ 添加子任务');add.type='button';add.onclick=()=>addCheck().focus();
  const advanced=el(more,'details','los-form-more');el(advanced,'summary','','高级设置');const unit=field(advanced,'budget_unit_minutes','单番茄时长（分钟）','number',t.budget_unit_minutes||25);unit.min=1;unit.max=180;
  field(advanced,'tags','标签 #Tag','text',t.tags||'');field(advanced,'references','附件路径 / 参考链接','textarea',t.references||'');
  const status=el(form,'p','los-form-status');status.setAttribute('role','status');
  const footer=el(form,'div','los-form-actions'),cancel=el(footer,'button','','取消');cancel.type='button';cancel.onclick=()=>this.close();const save=el(footer,'button','mod-cta',t.id?'保存修改':'创建任务');save.type='submit';
  form.onsubmit=async e=>{e.preventDefault();if(save.disabled)return;save.disabled=true;status.textContent='保存中…';try{const value={...t,...Object.fromEntries(Object.entries(fields).map(([k,e])=>[k,e.value])),scheduled:quick?model.day():t.scheduled||o.scheduled||model.day(),repeat:quick?'once':fields.repeat.value,checklist:this.checks.map(c=>({text:c.value.value,done:c.check.checked}))};await this.p.createTask(value,o.task);this.close();o.onSaved?.();}catch(e){status.textContent=e.message;new Notice(e.message);save.disabled=false;}};
  title.focus();
 }
}
module.exports={TaskModal};
