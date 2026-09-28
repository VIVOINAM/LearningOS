const test=require('node:test');
const assert=require('node:assert/strict');
const {courseProgress}=require('../learning-hub-model');
const graph={course:'a',concepts:[{id:'c-one',title:'合力'},{id:'c-two',title:'力矩'},{id:'c-old',retired:true}]};
const record=(course,concept,level,at,source='quiz',questions=[['q01',true]])=>({course,concept,level,at,source,basis:{questions}});
test('证据按课程隔离，最新自评不冒充自测验证，退休概念不计入',()=>{
  const p=courseProgress(graph,[record('a','c-one','applied','1'),record('b','c-one','review','9'),record('a','c-two','understood','1'),record('a','c-two','applied','2','manual'),record('a','c-old','applied','3')]);
  assert.deepEqual(p.applied.map(c=>c.id),['c-one']);assert.deepEqual(p.self.map(c=>c.id),['c-two']);assert.equal(p.review.length,0);
});
test('有笔记或图谱不等于掌握；撤销计分的记录不能证明掌握',()=>{
  assert.equal(courseProgress(graph).pending,2);
  const p=courseProgress(graph,[record('a','c-one','applied','1'),record('a','c-one','unknown','2','quiz',[])]);
  assert.equal(p.applied.length,0);assert.equal(p.pending,2);
});
test('同一时间后写入的结果生效，错误表现进入补强',()=>{
  const p=courseProgress(graph,[record('a','c-one','applied','1'),record('a','c-one','review','1','quiz',[['q01',false]])]);
  assert.equal(p.applied.length,0);assert.deepEqual(p.review.map(c=>c.id),['c-one']);
});
