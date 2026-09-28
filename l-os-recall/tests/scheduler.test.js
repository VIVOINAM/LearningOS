const {test}=require('node:test');const assert=require('node:assert/strict');
const {schedule}=require('../core/scheduler');
test('首次复习评分、遗忘十分钟重学与长期间隔',()=>{
  const now=Date.UTC(2026,8,12);
  assert.equal(schedule({},'again',now).due,now+600000);
  assert.equal(schedule({},'good',now).interval,1);
  assert.equal(schedule({},'easy',now).interval,4);
  const next=schedule(schedule({},'good',now),'good',now+86400000);
  assert.equal(next.interval,3);assert.equal(next.reviews,2);
  assert.equal(schedule(next,'again',now).lapses,1);
  assert.throws(()=>schedule({},'invalid',now));
});
test('频繁评分不能把难度推到范围之外',()=>{
  let card={};for(let i=0;i<100;i++)card=schedule(card,'again',1000);
  assert.equal(card.ease,1.3);assert.equal(card.lapses,100);
  for(let i=0;i<30;i++)card=schedule(card,'easy',1000);
  assert.equal(card.ease,3);
});
