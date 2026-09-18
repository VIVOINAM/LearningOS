const test=require('node:test'),assert=require('node:assert/strict');
const c=require('../../shared/timer-core');
const {audit}=require('../../codex-workbench/daily-audit');
const {budget}=require('../../codex-workbench/budget');
test('25分钟在13分钟切换：780秒与720秒，保持番茄ID和截止时间',()=>{
 const at=new Date(2026,8,14,10).getTime();let t=c.start(c.initial({taskId:'a',project:'A'}),'任务A',1500,at);const id=t.id,end=t.endAt;
 t=c.switchTask(t,{taskId:'b',task:'任务B',project:'B'},at+780000);
 assert.equal(t.id,id);assert.equal(t.endAt,end);t=c.normalize(JSON.parse(JSON.stringify(t)));
 const s=c.finish(t,true,end+5000);assert.equal(s.seconds,1500);assert.deepEqual(s.slices.map(x=>x.seconds),[780,720]);
 const report=audit([s,s],[],'2026-09-14');assert.equal(report.seconds,1500);assert.deepEqual(report.projects,{A:780,B:720});assert.equal(report.switches,1);
 assert.equal(budget({id:'a'},[s],c.initial(),c).seconds,780);assert.equal(budget({id:'b'},[s],c.initial(),c).seconds,720);
});
test('暂停不计费；暂停中切换后继续；毫秒精度保持',()=>{
 const at=new Date(2026,8,14,10).getTime();let t=c.start(c.initial({taskId:'a'}),'A',1500,at);
 t=c.pause(t,at+12345);t=c.switchTask(t,{taskId:'b',task:'B'},at+60000);t=c.start(t,'B',1500,at+100000);
 const s=c.finish(t,false,at+103456);assert.equal(s.seconds,15.801);assert.deepEqual(s.slices.map(x=>x.seconds),[12.345,3.456]);assert.equal(s.interruptions.length,1);
});
test('跨午夜按当地日期切片，暂停间隔不分摊，旧记录可读',()=>{
 const at=new Date(2026,8,14,23,59).getTime();let t=c.start(c.initial({taskId:'a'}),'A',1500,at);
 const s=c.finish(t,false,at+120000);assert.equal(audit([s],[],'2026-09-14').seconds,60);assert.equal(audit([s],[],'2026-09-15').seconds,60);
 assert.equal(audit([{id:'old',phase:'focus',seconds:30,endedAt:at}],[],'2026-09-14').seconds,30);
 assert.equal(audit([{id:'paused-old',phase:'focus',seconds:30,startedAt:at-900000,endedAt:at}],[],'2026-09-14').seconds,30);
});
