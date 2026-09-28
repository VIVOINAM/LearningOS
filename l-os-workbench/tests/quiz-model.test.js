"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const Q=require('../quiz-model'),G=require('../knowledge-graph');
const graph={course:'057274',concepts:[{id:'c-a'},{id:'c-b'},{id:'c-old',retired:true}]};
const graphs=new Map([['057274',graph]]);
const src={path:'x.md',heading:'1. 标题'};
const single=(id,concepts,level='concept',answer=[0])=>({id,concepts,level,type:'single',stem:'题干 $x$',options:['甲','乙','丙','丁'],answer,explanation:'解析',source:src});
const ten=()=>[...Array(10)].map((_,i)=>single(`q${String(i+1).padStart(2,'0')}`,[i<5?'c-a':'c-b'],i%2?'application':'concept'));
const quiz=qs=>({week:'2026-W39',courses:[{course:'057274',questions:qs}]});

test('合格的题库没有错误',()=>assert.deepEqual(Q.quizErrors(quiz(ten()),graphs),[]));
test('题数、答案范围、单选多选、判断与数值题的格式',()=>{
  const bad=(mutate,pattern)=>{const qs=ten();mutate(qs);assert.ok(Q.quizErrors(quiz(qs),graphs).some(e=>pattern.test(e)),String(pattern));};
  bad(qs=>qs.pop(),/应为 10 题/);
  bad(qs=>{qs[0].answer=[4];},/超出选项范围/);
  bad(qs=>{qs[0].answer=[0,1];},/单选题只能有一个答案/);
  bad(qs=>{qs[0].type='multiple';},/多选题至少两个答案/);
  bad(qs=>{qs[0].options=['甲','甲','丙'];},/选项有重复/);
  bad(qs=>{Object.assign(qs[0],{type:'truefalse',options:[],answer:'对'});},/true 或 false/);
  bad(qs=>{Object.assign(qs[0],{type:'numeric',options:[],answer:{value:3},unit:'m'});},/tolerance/);
  bad(qs=>{Object.assign(qs[0],{type:'numeric',options:[],answer:{value:0,tolerance:0.1},unit:'m'});},/答案为 0/);
  bad(qs=>{Object.assign(qs[0],{type:'numeric',options:[],answer:{value:3,tolerance:0.1}});},/单位/);
  bad(qs=>{qs[1].id='q01';},/题号重复/);
  bad(qs=>{qs[0].stem='少一个 $x';},/定界符不成对/);
  bad(qs=>{delete qs[0].source;},/缺少原文出处/);
});
test('概念必须在图谱里且未退役；每个被考的概念至少 2 题',()=>{
  let qs=ten();qs[0].concepts=['c-old'];assert.ok(Q.quizErrors(quiz(qs),graphs).some(e=>/c-old 不在图谱里或已退役/.test(e)));
  qs=ten();qs[0].concepts=['c-a','c-b'];qs[9].concepts=['c-a'];
  for(let i=1;i<9;i++)qs[i].concepts=['c-a'];qs[0].concepts=['c-a','c-b'];
  assert.ok(Q.quizErrors(quiz(qs),graphs).some(e=>/c-b 只考了 1 题/.test(e)));
  assert.ok(Q.quizErrors({week:'2026-W39',courses:[{course:'999999',questions:ten()}]},graphs).some(e=>/没有概念图谱/.test(e)));
});
test('定界符：$$ 块与行内 $ 都要成对，代码里的不算',()=>{
  assert.ok(Q.delimitersBalanced('$$\na=b\n$$ 和 $x$'));
  assert.ok(!Q.delimitersBalanced('$$ a=b $'));
  assert.ok(Q.delimitersBalanced('```matlab\nfprintf("$")\n```'));
  assert.ok(Q.delimitersBalanced('价格 \\$5'));
});
test('判分：单选多选要完全一致，数值按相对或绝对误差，「不确定」一律算错',()=>{
  const m={type:'multiple',answer:[0,2]},n={type:'numeric',answer:{value:-15,tolerance:0.01}},z={type:'numeric',answer:{value:0,abs:0.1}};
  assert.ok(Q.isCorrect(m,{choice:[2,0]}));assert.ok(!Q.isCorrect(m,{choice:[0]}));assert.ok(!Q.isCorrect(m,{choice:[0,1,2]}));
  assert.ok(Q.isCorrect(n,{value:-15.1}));assert.ok(!Q.isCorrect(n,{value:15}));assert.ok(!Q.isCorrect(n,{value:'abc'}));
  assert.ok(Q.isCorrect(z,{value:0.05}));
  assert.ok(Q.isCorrect({type:'truefalse',answer:false},{bool:false}));
  assert.ok(!Q.isCorrect({type:'single',answer:[0]},{choice:[0],unsure:true}));
});
test('换算：概念题有错 → 需巩固；概念全对、应用有错或没考 → 已理解；都对 → 能应用；只考应用题的按应用题',()=>{
  const q=(id,c,level)=>({id,concepts:[c],level,type:'truefalse',answer:true});
  const qs=[q('q01','a','concept'),q('q02','a','application'),q('q03','b','concept'),q('q04','b','application'),q('q05','c','concept'),q('q06','c','concept'),q('q07','d','concept'),q('q08','d','application'),q('q09','e','application'),q('q10','e','application')];
  const T={bool:true},F={bool:false};
  const levels=Q.conceptLevels(qs,{q01:T,q02:T,q03:T,q04:F,q05:T,q06:T,q07:{unsure:true},q08:T,q09:T,q10:T});
  assert.deepEqual(Object.fromEntries([...levels].map(([c,v])=>[c,v.level])),{a:'applied',b:'understood',c:'understood',d:'review',e:'applied'});
  assert.deepEqual(levels.get('b').questions,[['q03',true],['q04',false]]);
  // 标了「这题有问题」的不计分；没作答的概念不出现（维持原档位）
  const flagged=Q.conceptLevels(qs.slice(0,2),{q01:{...F,flagged:true},q02:T});
  assert.equal(flagged.get('a').level,'applied');
  assert.equal(Q.conceptLevels(qs,{}).size,0);
});
test('只算首次作答：重做不改档位；后来标「有问题」也算数',()=>{
  const doc={attempts:[
    {course:'057274',question:'q01',response:{bool:false},first:true},
    {course:'057274',question:'q01',response:{bool:true},first:false},
    {course:'057274',question:'q02',response:{bool:true},first:true},
    {course:'057274',question:'q02',response:{bool:true},first:false,flagged:true},
    {course:'060112',question:'q01',response:{bool:true},first:true}]};
  const first=Q.firstAttempts(doc,'057274');
  assert.deepEqual(first.q01,{bool:false,flagged:false});assert.equal(first.q02.flagged,true);assert.equal(Object.keys(first).length,2);
});
test('选项乱序是稳定的排列：同一题每次一样，不同题不同',()=>{
  const a=Q.shuffledOrder(4,'2026-W39/057274/q01');
  assert.deepEqual(a,Q.shuffledOrder(4,'2026-W39/057274/q01'));assert.deepEqual([...a].sort(),[0,1,2,3]);
  const seen=new Set(Array.from({length:40},(_,i)=>Q.shuffledOrder(4,`s${i}`).join('')));
  assert.ok(seen.size>6,'打乱要真的打乱');
  // 正确答案不总在同一个位置
  const at=Array.from({length:40},(_,i)=>Q.shuffledOrder(4,`2026-W39/x/q${i}`).indexOf(0));
  assert.ok(new Set(at).size===4);
});
test('库里真实的题库全部通过校验（含出处与配图）',()=>{
  const VAULT=path.resolve(__dirname,'../../..'),read=rel=>{try{return fs.readFileSync(path.join(VAULT,rel),'utf8');}catch{return null;}};
  const gs=new Map();for(const f of fs.readdirSync(path.join(VAULT,G.GRAPH_DIR)))if(G.isGraphPath(`${G.GRAPH_DIR}/${f}`)){const g=JSON.parse(read(`${G.GRAPH_DIR}/${f}`));gs.set(g.course,g);}
  const dir=path.join(VAULT,Q.QUIZ_DIR),files=fs.existsSync(dir)?fs.readdirSync(dir).filter(f=>Q.isQuizPath(`${Q.QUIZ_DIR}/${f}`)):[];
  const deep={exists:(p,h)=>{const t=read(p);return t!=null&&G.sectionsOf(t).has(h);},image:()=>true};
  for(const f of files)assert.deepEqual(Q.quizErrors(JSON.parse(read(`${Q.QUIZ_DIR}/${f}`)),gs,deep),[],f);
});
