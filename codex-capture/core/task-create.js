"use strict";
const model=require('./capture-model');
function date(value,label){if(value&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))throw Error(label+'无效');return value||'';}
function normalize(value={}){
 const title=model.clean(value.title||'');if(!title)throw Error('请填写任务名称');
 const estimate=Number(value.estimated_pomodoros??1),unit=Number(value.budget_unit_minutes||25),interval=Number(value.repeat_interval||1);
 if(!Number.isInteger(estimate)||estimate<1||estimate>99)throw Error('预计番茄数须为 1–99');
 if(!Number.isInteger(unit)||unit<1||unit>180)throw Error('单番茄时长须为 1–180 分钟');
 if(!Number.isInteger(interval)||interval<1||interval>365)throw Error('自定义周期须为 1–365 天');
 const repeat=value.repeat||'once';if(!['once','daily','weekly','custom'].includes(repeat))throw Error('重复规则无效');
 const priority_level=value.priority_level||'P3';if(!/^P[1-4]$/.test(priority_level))throw Error('优先级无效');
 if(value.reminder_at&&!Number.isFinite(Date.parse(value.reminder_at)))throw Error('提醒时间无效');
 if(value.due_at&&!Number.isFinite(Date.parse(value.due_at)))throw Error('截止时间无效');
 return {title,details:String(value.details||''),project:String(value.project||''),category:String(value.category||''),priority_level,estimated_pomodoros:estimate,budget_unit_minutes:unit,due:date(value.due_at?value.due_at.slice(0,10):value.due,'截止日期'),due_at:value.due_at||'',reminder_at:value.reminder_at||'',reminder_sent:value.reminder_sent===value.reminder_at?value.reminder_sent||'':'',scheduled:date(value.scheduled==='backlog'?'':value.scheduled,'计划日期')||'backlog',repeat,repeat_interval:interval,duration_days:1,outcome:String(value.outcome||''),tags:String(value.tags||''),references:String(value.references||''),checklist:(value.checklist||[]).filter(t=>String(t.text||'').trim()).map(t=>({text:String(t.text).trim(),done:!!t.done}))};
}
function line(value,id){const v=normalize(value),{title,due,scheduled,...meta}=v;return model.taskLine(title,id)+(due?' 📅 '+due:'')+` <!-- scheduled:${scheduled} --> <!-- los:${encodeURIComponent(JSON.stringify({...meta,schema:3,revision:0}))} -->`;}
function nextDate(key,repeat,interval=1){const [y,m,d]=key.split('-').map(Number);return model.day(new Date(y,m-1,d+(repeat==='weekly'?7:repeat==='custom'?Number(interval):1)).getTime());}
function repeatLine(task,today,id){
 if(!task.repeat||task.repeat==='once')return null;
 const next=nextDate(task.scheduled&&task.scheduled!=='backlog'&&task.scheduled>today?task.scheduled:today,task.repeat,task.repeat_interval);
 const shifted={...task,title:task.text.replace(/(?:📅\s*|due::\s*)\d{4}-\d{2}-\d{2}/g,'').trim(),scheduled:next,checklist:(task.checklist||[]).map(t=>({...t,done:false}))};
 const offset=Math.round((new Date(next+'T12:00:00')-new Date((task.scheduled&&task.scheduled!=='backlog'?task.scheduled:today)+'T12:00:00'))/86400000);
 for(const field of ['due_at','reminder_at'])if(task[field]){const dt=new Date(task[field]);dt.setDate(dt.getDate()+offset);shifted[field]=model.day(dt.getTime())+task[field].slice(10);}
 if(task.due&&!task.due_at){const dt=new Date(task.due+'T12:00:00');dt.setDate(dt.getDate()+offset);shifted.due=model.day(dt.getTime());}
 return line(shifted,id)+` <!-- repeat-of:${task.id||encodeURIComponent(task.raw)} -->`;
}
module.exports={normalize,line,nextDate,repeatLine};
