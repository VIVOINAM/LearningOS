const assert=require('node:assert/strict'),Module=require('node:module');
const original=Module._load,notices=[];Module._load=function(name){if(name==='obsidian')return {Plugin:class{},Modal:class{},Notice:class{constructor(message){notices.push(message);}}};return original.apply(this,arguments);};
const Focus=require('../l-os-focus/main'),core=require('../shared/timer-core'),Capture=require('../l-os-capture/main'),creation=require('../l-os-capture/core/task-create'),index=require('../l-os-capture/core/task-index');
(async()=>{
 const f=Object.create(Focus.prototype);f.operations=Promise.resolve();f.app={workspace:{trigger(){}}};f.save=async()=>{};f.data={timer:core.initial(),sessions:[],settings:{focusMinutes:25}};
 await f.dispatch('start',{task:'A',taskId:'a',minutes:40});assert.equal(f.data.timer.duration,2400);const id=f.data.timer.id,end=f.data.timer.endAt;
 await f.dispatch('start',{task:'B',taskId:'b',minutes:15});assert.equal(f.data.timer.id,id);assert.equal(f.data.timer.endAt,end);assert.equal(f.data.timer.taskId,'b');
 await f.dispatch('pause');await f.dispatch('start',{task:'C',taskId:'c'});assert.equal(f.data.timer.status,'running');assert.equal(f.data.timer.id,id);
 f.data.timer=core.start(core.initial({phase:'break'}),'休息',300,Date.now()-10000);await f.dispatch('start',{task:'D',taskId:'d'});assert.equal(f.data.timer.phase,'focus');assert.equal(f.data.timer.taskId,'d');assert.equal(f.data.sessions.at(-1).phase,'break');
 f.data.timer=core.start(core.initial({taskId:'d'}),'D',60,Date.now()-70000);await f.dispatch('start',{task:'E',taskId:'e'});assert.equal(f.data.timer.taskId,'e');assert.equal(f.data.sessions.at(-1).seconds,60);
 const saved=JSON.stringify(f.data);f.save=async()=>{throw Error('disk full');};await assert.rejects(f.dispatch('start',{task:'F',taskId:'f'}));assert.equal(JSON.stringify(f.data),saved);
 let content=creation.line({title:'重复任务',scheduled:'2026-09-14',repeat:'daily',reminder_at:'2026-01-01T09:00'},'r'),file={path:'test.md'};
 const p=Object.create(Capture.prototype);p.queue=Promise.resolve();p.app={vault:{getAbstractFileByPath:()=>file,process:async(_,fn)=>content=fn(content)},workspace:{trigger(){}}};p.index={all:async()=>index.parse(content,file.path),invalidate(){}};
 let task=(await p.index.all())[0];await p.checkReminders();assert.equal(notices.filter(t=>t.startsWith('任务提醒')).length,1);await p.checkReminders();assert.equal(notices.filter(t=>t.startsWith('任务提醒')).length,1);
 task=(await p.index.all())[0];await p.updateTask(task,'done');assert.equal((await p.index.all()).length,2);task=(await p.index.all())[0];await p.updateTask(task,'reopen');task=(await p.index.all())[0];await p.updateTask(task,'done');assert.equal((await p.index.all()).length,2);
 console.log('计时与周期任务集成通过： start/switch/resume/break/expiry/custom duration/rollback, reminder dedupe, recurring completion/reopen dedupe.');
})().catch(e=>{console.error(e);process.exitCode=1;});
