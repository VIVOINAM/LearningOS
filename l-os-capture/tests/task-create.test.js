const test=require('node:test'),assert=require('node:assert/strict');
const create=require('../core/task-create'),index=require('../core/task-index');
test('完整任务字段序列化往返、优先级排序、日期与预算校验',()=>{
 const value={title:'写一张卡片',scheduled:'2026-09-14',project:'02 项目/A.md',priority_level:'P1',estimated_pomodoros:3,budget_unit_minutes:40,details:'描述\n第二行',category:'学习',repeat:'weekly',outcome:'交付卡片',due_at:'2026-09-14T18:00',reminder_at:'2026-09-14T17:30',tags:'#learning',references:'[[参考]]',checklist:[{text:'推导',done:true},{text:'输出',done:false}]};
 const task=index.parse(create.line(value,'a'),'02 项目/A.md')[0];assert.equal(task.priority,4);assert.equal(task.outcome,value.outcome);assert.equal(task.estimated_pomodoros,3);assert.equal(task.checklist[0].done,true);assert.equal(task.scheduled,value.scheduled);assert.equal(task.reminder_at,value.reminder_at);
 assert.throws(()=>create.normalize({title:''}));assert.throws(()=>create.normalize({title:'A',estimated_pomodoros:0}));assert.throws(()=>create.normalize({title:'A',due:'2026-02-30'}));
});

test('今日任务可以不归属项目',()=>{
 const line=create.line({title:'独立今日任务',scheduled:'2026-09-14'},'independent');
 const task=index.parse(line,'00 工作台/今日任务.md')[0];
 assert.equal(task.project,'');
 assert.equal(task.scheduled,'2026-09-14');
});
test('完成后创建独立周期实例，重置清单与提醒，跨月日期正确',()=>{
 const raw=create.line({title:'每日复习',scheduled:'2026-01-31',repeat:'daily',reminder_at:'2026-01-31T09:00',checklist:[{text:'卡片',done:true}]},'a');const t=index.parse(raw,'a.md')[0];const next=index.parse(create.repeatLine(t,'2026-01-31','b'),'a.md')[0];assert.equal(next.id,'b');assert.equal(next.scheduled,'2026-02-01');assert.equal(next.checklist[0].done,false);assert.equal(next.reminder_at,'2026-02-01T09:00');assert.equal(next.reminder_sent,'');assert.equal(create.nextDate('2026-12-31','custom',3),'2027-01-03');assert.equal(create.repeatLine({...t,repeat:'once'},'2026-01-31','c'),null);
});
