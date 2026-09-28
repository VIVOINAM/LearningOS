"use strict";
function budget(task,sessions,timer,core) {
  const id=task.id,seen=new Set();let seconds=0,rounds=0;
  const original=sessions||[],completedIds=new Set();
  for(const s of original)if(s.completed&&s.phase==='focus'&&(s.slices?.some(x=>x.taskId===id)||s.taskId===id))completedIds.add(s.id);
  sessions=original.flatMap(s=>s.slices?.length?s.slices.map((x,i)=>({...s,...x,id:s.id+':'+i,completed:false})):({...s,completed:false}));
  if(timer&&timer.status!=='idle'&&core.checkpoint){if(!original.some(s=>s.id===timer.id)){const live=core.checkpoint(timer);sessions=[...sessions,...live.slices.map((s,i)=>({...s,id:'live:'+i,phase:timer.phase}))];}timer=null;}
  rounds=completedIds.size;
  for(const s of sessions||[])if(id&&s.taskId===id&&s.phase==='focus'&&!seen.has(s.id)){seen.add(s.id);seconds+=Math.max(0,Number(s.seconds)||0);if(s.completed)rounds++;}
  if(id&&timer?.taskId===id&&timer.phase==='focus'&&timer.status!=='idle'&&!seen.has(timer.id))seconds+=core.elapsed?core.elapsed(timer):Math.max(0,timer.duration-core.remaining(timer));
  const unit=Number(task.budget_unit_minutes)||25,estimate=Number(task.estimated_pomodoros)||0,limit=estimate*unit*60;
  return {seconds,rounds,used:seconds/(unit*60),estimate,state:!estimate?'unset':seconds>limit?'over':seconds>=limit*.8?'near':'normal',overMinutes:Math.ceil(Math.max(0,seconds-limit)/60)};
}
module.exports={budget};
