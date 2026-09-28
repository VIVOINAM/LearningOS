"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {knowledgeEntries,filterKnowledge}=require('../knowledge-model');
const file=path=>({path,basename:path.split('/').pop().replace(/\.[^.]+$/,''),extension:path.split('.').pop(),stat:{mtime:10}});
const note=file('03 知识库/我的课程/2026-27/课堂笔记/060112 化工过程计算/2026-09-22 化工过程计算.md');
const older=file(note.path.replaceAll('2026-09-22','2026-09-21'));
const courses=[{id:'060112',title:'化工过程计算'},{id:'086552',title:'电工学'}];
test('课堂笔记只关联明确引用或同课同日的任务；不把课程所有任务算进来',()=>{
  const tasks=[{id:'a',tags:'课堂笔记/2026-09-22/060112',text:'总结'},
    {id:'b',tags:'课堂笔记/2026-09-21/060112',text:'昨天'},
    {id:'c',references:`[[${note.path.replace(/\.md$/,'')}|笔记]]`,path:'任务.md',done:true},
    {id:'d',references:note.path,deleted:true}];
  const entries=knowledgeEntries({files:[note,older],courses,tasks,resolve:p=>p+'.md'});
  const n=entries.find(e=>e.path===note.path);
  assert.equal(n.type,'class');assert.equal(n.course,'化工过程计算');assert.deepEqual(n.tasks.map(t=>t.id),['a','c']);
  assert.deepEqual(entries.find(e=>e.path===older.path).tasks.map(t=>t.id),['b']);
});
test('带空格的原始路径、Wiki 标题锚点和本文件任务精确关联',()=>{
  const tasks=[{id:'raw',references:note.path},{id:'wiki',references:'[[课堂记录#小结|阅读]]',path:'任务.md'},{id:'local',path:note.path},{id:'prefix',references:note.path+'.bak'}];
  const [entry]=knowledgeEntries({files:[note],tasks,resolve:p=>p==='课堂记录'?note.path:null});
  assert.deepEqual(entry.tasks.map(t=>t.id),['raw','wiki','local']);
});
test('教材卡片使用独立复习键，多课程共用教材仍可分别筛选',()=>{
  const pdf=file('教材/计算.pdf');
  const records={[pdf.path]:{annotations:[{id:'abc-1234',kind:'question',page:7,note:'质量守恒',resolved:false},{id:'def-1234',kind:'region',page:8,imagePath:'附件/图.png'}]}};
  const key=pdf.path+'#abc-1234';
  const entries=knowledgeEntries({files:[note,pdf],courses,booksFor:()=>[pdf.path],records,cards:[{key,path:pdf.path,cardId:'abc-1234',due:5,reviews:2}],now:10});
  const card=entries.find(e=>e.key===key);assert.equal(card.reviewState,'due');assert.equal(card.review.reviews,2);
  assert.equal(entries.find(e=>e.cardId==='def-1234').reviewState,'new');
  assert.equal(filterKnowledge(entries,{course:'086552',type:'question',query:'质量守恒',review:'due'}).length,1);
  assert.match(entries.find(e=>e.cardId==='def-1234').body,/附件\/图.png/);
  assert.equal(knowledgeEntries({files:[note],records}).length,1);
});
test('不把工作台、日记、源码、附件索引混入知识，删除和到期状态随快照变化',()=>{
  const files=[note,file('00 工作台/今日.md'),file('05 日记/今天.md'),file('08 插件开发/README.md'),file('03 知识库/_assets/附件说明.md'),file('03 知识库/课堂笔记索引.md')];
  assert.equal(knowledgeEntries({files}).length,1);
  assert.equal(knowledgeEntries({files:[note],cards:[{key:note.path,due:11}],now:10})[0].reviewState,'scheduled');
  assert.equal(knowledgeEntries({files:[note],cards:[{key:note.path,due:11}],now:12})[0].reviewState,'due');
  assert.deepEqual(knowledgeEntries({files:[],cards:[{key:note.path,due:0}]}),[]);
});
test('历史学年与当前课程共用课程筛选，普通笔记保留状态',()=>{
  const historical=file(note.path.replace('2026-27','2025-26'));
  const plain=file('03 知识库/笔记.md');
  const entries=knowledgeEntries({files:[historical,plain],courses,metadata:f=>f===plain?{status:'done',tags:['复习'],course:'[[060112 化工过程计算]]'}:{}});
  assert.equal(filterKnowledge(entries,{course:'060112'}).length,2);
  assert.equal(filterKnowledge(entries,{query:'复习'})[0].status,'done');
});
