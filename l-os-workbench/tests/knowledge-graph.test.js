"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const G=require('../knowledge-graph');
const VAULT=path.resolve(__dirname,'../../..');
const read=rel=>{try{return fs.readFileSync(path.join(VAULT,rel),'utf8');}catch{return null;}};
const NOTE='03 知识库/我的课程/2026-27/课堂笔记/060112 化工过程计算/2026-09-22 化工过程计算.md';
const text='---\ntype: class-note\n---\n# 课\n## 1. 质量守恒\n稳态时 $$\\dot m_{in}=\\dot m_{out}$$\n### 1.1 稳态条件\n正文\n## 2. 能量守恒\n正文\n### 例 1：换热器\n## 3. 一页速查\n';
const fake=p=>p===NOTE?text:null;
const base=()=>({course:'060112',title:'化工过程计算',notes:[{path:NOTE,integratedAt:'2026-09-26T00:00:00Z'}],
  chapters:[{id:'ch01',order:1,title:'衡算',status:'learned'},{id:'ch02',order:2,title:'反应',status:'planned'}],
  concepts:[
    {id:'c-mass-balance',chapter:'ch01',title:'质量守恒',firstTaught:'2026-09-22',summary:'进等于出。',formulas:['\\dot m_{in}=\\dot m_{out}'],points:[],prereqs:[],related:[],
      sources:[{path:NOTE,heading:'1. 质量守恒'},{path:NOTE,heading:'1.1 稳态条件'}],examples:[],legacyKeys:[]},
    {id:'c-energy-balance',chapter:'ch01',title:'能量守恒',firstTaught:'2026-09-22',summary:'能量也守恒。',formulas:[],points:[],prereqs:['c-mass-balance'],related:[],
      sources:[{path:NOTE,heading:'2. 能量守恒'}],examples:[{path:NOTE,heading:'例 1：换热器',title:'换热器'}],legacyKeys:[]},
  ],ignored:[]});
const all=g=>[...G.structureErrors(g),...G.deepErrors(g,fake)];

test('合格的图谱没有错误',()=>assert.deepEqual(all(base()),[]));
test('结构：ID 格式与重复、章节不存在、先修指向不存在或退役的概念、先修成环',()=>{
  let g=base();g.concepts[1].id='c-mass-balance';assert.ok(G.structureErrors(g).some(e=>/重复/.test(e)));
  g=base();g.concepts[0].id='Mass';assert.ok(G.structureErrors(g).some(e=>/c- 加小写/.test(e)));
  g=base();g.concepts[0].chapter='ch09';assert.ok(G.structureErrors(g).some(e=>/章节 ch09 不存在/.test(e)));
  g=base();g.concepts[1].prereqs=['c-nope'];assert.ok(G.structureErrors(g).some(e=>/c-nope 不存在/.test(e)));
  g=base();g.concepts[0].retired=true;assert.ok(G.structureErrors(g).some(e=>/已退役/.test(e)));
  g=base();g.concepts[0].prereqs=['c-energy-balance'];assert.ok(G.structureErrors(g).some(e=>/成环/.test(e)));
  g=base();g.concepts[1].legacyKeys=g.concepts[0].legacyKeys=['060112:x'];assert.ok(G.structureErrors(g).some(e=>/旧键同时属于/.test(e)));
  g=base();g.concepts[0].sources=[];assert.ok(G.structureErrors(g).some(e=>/至少要有一处/.test(e)));
});
test('深检查：标题不存在、公式在原文里找不到、上一版的概念不见了',()=>{
  let g=base();g.concepts[0].sources[1].heading='1.1 稳态';assert.ok(G.deepErrors(g,fake).some(e=>/标题不存在/.test(e)));
  g=base();g.concepts[0].formulas=['\\dot m_{in}=0'];assert.ok(G.deepErrors(g,fake).some(e=>/公式在来源原文里找不到/.test(e)));
  // 公式比对忽略空白
  g=base();g.concepts[0].formulas=['\\dot m_{in} = \\dot m_{out}'];assert.deepEqual(G.deepErrors(g,fake),[]);
  const prev=base();prev.concepts.push({id:'c-old',chapter:'ch01',title:'旧'});
  assert.ok(G.deepErrors(base(),fake,prev).some(e=>/c-old.*不见了/.test(e)));
});
test('覆盖检查：漏掉的小节和例题都报出来；列进 ignored 或旧键就算覆盖',()=>{
  let g=base();g.concepts[0].sources.pop();
  assert.ok(G.deepErrors(g,fake).some(e=>/小节没有归进任何概念.*1\.1 稳态条件/.test(e)));
  g.ignored.push({path:NOTE,heading:'1.1 稳态条件',reason:'只是条件说明'});assert.deepEqual(G.deepErrors(g,fake),[]);
  g=base();g.concepts[1].examples=[];assert.ok(G.deepErrors(g,fake).some(e=>/例题没有归进/.test(e)));
  g=base();g.concepts[0].sources.pop();g.concepts[0].legacyKeys=['060112:%E7%A8%B3%E6%80%81%E6%9D%A1%E4%BB%B6'];assert.deepEqual(G.deepErrors(g,fake),[]);
});
test('未整理的笔记：没收录的，和收录后又改过的',()=>{
  const g=base(),at=Date.parse(g.notes[0].integratedAt);
  const files=[{path:NOTE,stat:{mtime:at-1}},{path:'b.md',stat:{mtime:1}}];
  assert.deepEqual(G.staleNotes(g,files).map(f=>f.path),['b.md']);
  files[0].stat.mtime=at+3600e3;assert.deepEqual(G.staleNotes(g,files).map(f=>f.path),[NOTE,'b.md']);
});
test('库里真实的概念图谱全部通过校验',()=>{
  const dir=path.join(VAULT,G.GRAPH_DIR);
  const files=fs.existsSync(dir)?fs.readdirSync(dir).filter(f=>G.isGraphPath(`${G.GRAPH_DIR}/${f}`)):[];
  assert.ok(files.length>=1);
  for(const f of files){const g=JSON.parse(read(`${G.GRAPH_DIR}/${f}`));assert.deepEqual([...G.structureErrors(g),...G.deepErrors(g,read)],[],f);}
});
