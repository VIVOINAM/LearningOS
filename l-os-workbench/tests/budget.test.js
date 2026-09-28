"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),core=require('../../shared/timer-core'),{budget}=require('../budget');
test('taskId 在启动/暂停/恢复/结算/规范化后保留，预算包含零散用时且去重',()=>{
 const now=Date.now();let timer=core.start(core.initial({taskId:'a'}),'task',1500,now-120000);
 timer=core.pause(timer,now);assert.equal(timer.taskId,'a');timer=core.start(timer,'task',1500,now);assert.equal(timer.taskId,'a');
 const session=core.finish(timer,false,now);assert.equal(session.taskId,'a');assert.equal(session.seconds,120);assert.equal(session.durationSeconds,1500);
 const task={id:'a',estimated_pomodoros:1,budget_unit_minutes:25};const b=budget(task,[session,session],timer,core);assert.equal(b.seconds,120);
 assert.equal(budget(task,[{...session,slices:undefined,id:'b',seconds:1600}],core.initial(),core).state,'over');
 assert.equal(budget({...task,estimated_pomodoros:null},[],timer,core).state,'unset');
 assert.equal(budget(task,[{...session,slices:undefined,taskId:'other'}],core.initial(),core).seconds,0);
});
