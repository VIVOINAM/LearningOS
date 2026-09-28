const test=require('node:test');
const assert=require('node:assert/strict');
const {isSummaryNote,summaryEntry,filterSummaries,noteBody}=require('../summary-notes');
const file=(name,folder='089257 流体力学与化工基础')=>({path:`03 知识库/我的课程/2026-27/课堂笔记/${folder}/${name}.md`,basename:name,extension:'md'});
test('仅关联课程下的课堂笔记，排除附件和其他笔记',()=>{
  assert.ok(isSummaryNote(file('2026-09-22 流体力学')));
  assert.ok(!isSummaryNote(file('_assets/说明')));
  assert.ok(!isSummaryNote({...file('课程主页'),path:'03 知识库/我的课程/2026-27/089257 课程主页.md'}));
  assert.ok(!isSummaryNote({...file('截图'),extension:'png'}));
});
test('日期属性优先，非法日期回退文件名，课程按文件夹归属',()=>{
  const f=file('2026-09-22 流体力学');
  assert.equal(summaryEntry(f,{date:'2026-09-23',course:'错误代码'}).date,'2026-09-23');
  assert.equal(summaryEntry(f,{date:'2026-02-30'}).date,'2026-09-22');
  assert.equal(summaryEntry(file('未命名'),{date:'invalid'}).date,'');
  assert.equal(summaryEntry(f,{course:'错误代码'}).code,'089257');
  assert.equal(summaryEntry(f,{date:new Date('2026-09-21T00:00:00Z')}).date,'2026-09-21');
});
test('完整正文可搜索、日期倒序，未知日期放最后，筛选组合生效',()=>{
  const notes=[summaryEntry(file('无日期'),{},'未分类'),summaryEntry(file('2026-09-22 流体力学'),{},'x'.repeat(3000)+'伯努利'),summaryEntry(file('2026-09-23 电工学','086552 电工学'),{},'阻抗')];
  assert.deepEqual(filterSummaries(notes).map(e=>e.date),['2026-09-23','2026-09-22','']);
  assert.equal(filterSummaries(notes,{query:'伯努利',course:'089257',date:'2026-09-22'}).length,1);
  assert.equal(filterSummaries(notes,{query:'阻抗',course:'089257'}).length,0);
  assert.equal(noteBody('---\r\ndate: 2026-09-22\r\n---\r\n# 标题\n$$x$$'),'# 标题\n$$x$$');
});
