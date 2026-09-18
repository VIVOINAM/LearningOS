"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {edit,fields}=require('../core/task-fields'),{parse}=require('../core/task-index');
test('任务内联字段往返：ID、中文、多行、注释符号、CRLF 与旧元数据保留',()=>{
 const source='---\r\nkeep: yes\r\n---\r\n- [ ] 原标题 📅 2026-10-01 <!-- plan:%7B%7D -->\r\n- [ ] other\r\n';
 const original=parse(source,'02 项目/a.md')[0];
 const first=edit(source,original,{title:'新标题',details:'第一行\n第二行 -->',next_action:'推导',estimated_pomodoros:2,budget_unit_minutes:50},'id-1');
 const task=parse(first.content,original.path)[0];assert.equal(task.id,'id-1');assert.equal(task.details,'第一行\n第二行 -->');assert.equal(task.due,'2026-10-01');assert.equal(task.revision,1);assert.ok(first.content.includes('<!-- plan:%7B%7D -->'));assert.ok(first.content.endsWith('- [ ] other\r\n'));
 assert.throws(()=>edit(first.content,original,{title:'覆盖'},'id-2'));
 const second=edit(first.content,task,{estimated_pomodoros:3},'unused');assert.equal(parse(second.content,task.path)[0].budget_unit_minutes,50);
 assert.throws(()=>edit(first.content,task,{estimated_pomodoros:0},'unused'));
 assert.throws(()=>edit(first.content,task,{due:'2026-02-30'},'unused'));
 assert.equal(fields('<!-- los:broken -->').invalid,true);
});
test('重复 ID 拒绝修改，删除任务不能被内联写入复活',()=>{
 const content='- [ ] a <!-- task:1 -->\n- [ ] b <!-- task:1 -->';const task=parse(content,'a.md')[0];assert.throws(()=>edit(content,task,{details:'x'},'u'));
 assert.throws(()=>edit('<!-- deleted-task:x -->',task,{details:'x'},'u'));
});
