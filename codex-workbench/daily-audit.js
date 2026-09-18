"use strict";
const {dayKey}=require('./console-model');
function nextDay(key){const [y,m,d]=key.split('-').map(Number);return dayKey(new Date(y,m-1,d+1).getTime());}
function slices(s){return s.slices?.length?s.slices:[{...s,startedAt:s.endedAt-s.seconds*1000,legacy:true}];}
function completedPomodoros(sessions,start,end){
  const byId=new Map(),byText=new Map(),seen=new Set();
  for(const s of sessions){
    const endedAt=Number(s.endedAt);
    if(s.id&&seen.has(String(s.id)))continue;
    if(s.id)seen.add(String(s.id));
    if(s.phase!=='focus'||s.completed!==true||!Number.isFinite(endedAt)||endedAt<start||endedAt>=end)continue;
    const references=s.slices?.length?s.slices:[s],ids=new Set(),texts=new Set();
    for(const reference of references){
      if(reference.taskId)ids.add(String(reference.taskId));
      else if(reference.task)texts.add(String(reference.task));
    }
    for(const id of ids)byId.set(id,(byId.get(id)||0)+1);
    for(const text of texts)byText.set(text,(byText.get(text)||0)+1);
  }
  return {byId,byText};
}
function audit(sessions,tasks,key){
  const [y,m,d]=key.split('-').map(Number),start=new Date(y,m-1,d).getTime(),end=new Date(y,m-1,d+1).getTime();
  const result={seconds:0,switches:0,interruptions:0,projects:{},tasks:{},slices:[],done:tasks.filter(t=>!t.deleted&&t.done&&t.doneDate===key),pending:tasks.filter(t=>!t.deleted&&!t.done&&(t.scheduled===key||t.due&&t.due<=key)),outputs:[]};
  const seen=new Set();
  for(const s of sessions){if(s.phase!=='focus'||s.id&&seen.has(s.id))continue;if(s.id)seen.add(s.id);
    result.switches+=(s.switches||[]).filter(t=>t>=start&&t<end).length;
    result.interruptions+=(s.interruptions||[]).filter(t=>t>=start&&t<end).length;
    if(!s.live&&!s.completed&&s.endedAt>=start&&s.endedAt<end)result.interruptions++;
    for(const slice of slices(s)){
      const a=Math.max(start,slice.startedAt),b=Math.min(end,slice.endedAt);if(!(b>a))continue;
      const seconds=(b-a)/1000;const task=tasks.find(t=>t.id&&t.id===slice.taskId);
      const project=slice.project??(task?.project||(task?.path.startsWith('02 项目/')?task.path:''));
      const name=project||'独立任务 / 临时杂项',id=slice.taskId||slice.task||'自由专注';
      result.seconds+=seconds;result.projects[name]=(result.projects[name]||0)+seconds;
      const row=result.tasks[id]||(result.tasks[id]={text:slice.task||task?.text||'自由专注',seconds:0,project:name});row.seconds+=seconds;
      result.slices.push({...slice,startedAt:a,endedAt:b,seconds,project:name});
    }
  }
  const completed=completedPomodoros(sessions,start,end);
  result.done=result.done.map(task=>{
    const id=task.id?completed.byId.get(String(task.id)):null;
    const completedPomodoros=Number(id??completed.byText.get(String(task.text))??0);
    const estimatedPomodoros=Number(task.estimated_pomodoros);
    return {...task,completedPomodoros,completionPercent:Number.isFinite(estimatedPomodoros)&&estimatedPomodoros>0?completedPomodoros/estimatedPomodoros*100:null};
  });
  return result;
}
const safe=s=>String(s||'').replace(/[\r\n|]/g,' ').replace(/\[/g,'\\[').replace(/\]/g,'\\]');
function pomodoroLabel(task){
  const completed=Math.max(0,Number(task.completedPomodoros)||0),estimated=Math.max(0,Number(task.estimated_pomodoros)||0);
  return estimated>0?`完成 ${completed}/${estimated} 个番茄钟 · ${Math.round(completed/estimated*100)}%`:`完成 ${completed} 个番茄钟`;
}
function markdown(report,key){return ['<!-- cw-daily-summary -->','## 每日小结（自动时间审计）',`- 日期：${key}`,`- 有效专注：${(report.seconds/60).toFixed(2)} 分钟`, `- 切换：${report.switches} 次；打断：${report.interruptions} 次`,'','### 项目工时分布',...Object.entries(report.projects).map(([p,s])=>`- ${safe(p)}：${(s/60).toFixed(2)} 分钟（${report.seconds?(s/report.seconds*100).toFixed(1):0}%）`),'','### 任务工时',...Object.values(report.tasks).map(t=>`- ${safe(t.text)}：${(t.seconds/60).toFixed(2)} 分钟 · ${safe(t.project)}`),'','### 时间切片','| 开始 | 结束 | 任务 | 秒 |','| --- | --- | --- | ---: |',...report.slices.map(s=>`| ${new Date(s.startedAt).toLocaleTimeString('zh-CN',{hour12:false})} | ${new Date(s.endedAt).toLocaleTimeString('zh-CN',{hour12:false})} | ${safe(s.task)} | ${s.seconds.toFixed(3)} |`),'','### 今日完成',...(report.done.length?report.done.map(t=>`- ✓ ${safe(t.text)} · ${pomodoroLabel(t)}（[[${t.path}]]）`):['- 暂无']),'','### 今日未完（待流转至次日）',...(report.pending.length?report.pending.map(t=>`- ○ ${safe(t.text)}（[[${t.path}]]）`):['- 暂无']),'','### 今日产出沉淀',...(report.outputs.length?report.outputs.map(f=>`- [[${f.path}]]`):['- 暂无当天创建或修改的核心笔记']),'<!-- /cw-daily-summary -->'].join('\n');}
module.exports={audit,markdown,nextDay};
