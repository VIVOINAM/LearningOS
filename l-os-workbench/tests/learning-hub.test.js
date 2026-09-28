"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../learning-hub-model'),Store=require('../learning-hub-store');
const file={path:'03 知识库/我的课程/2026-27/课堂笔记/060112 化工过程计算/2026-09-22 化工过程计算.md',basename:'2026-09-22 化工过程计算',extension:'md',stat:{mtime:1}};
test('地图只读取真实标题层级，代码和公式里的井号不成为知识点',()=>{
  const text='---\ntype: class-note\n---\n# 课堂记录\n## 课堂记录\n### 1. 质量守恒\n完整推导\n#### 1.1 稳态条件\n$$\n# 不是标题\n$$\n```python\n## 不是概念\n```\n## 课后总结\n';
  const nodes=M.topicsFromNote(file,text);
  assert.deepEqual(nodes.map(n=>n.title),['质量守恒','稳态条件']);assert.equal(nodes[1].parent,nodes[0].key);
  assert.match(nodes[0].source.body,/完整推导/);assert.match(nodes[1].source.body,/# 不是标题/);
  assert.equal(nodes[0].source.heading,'1. 质量守恒');
});
test('重复概念合并来源，不以复习次数、笔记存在与否推断掌握',()=>{
  const topics=M.topicsFromNote(file,'# 标题\n## 1. 质量守恒\n条件。');
  const next={...topics[0],source:{...topics[0].source,path:'另一篇.md',date:'2026-09-23'}};
  const nodes=M.buildMap([...topics,next]);assert.equal(nodes.length,1);assert.equal(nodes[0].sources.length,2);assert.equal(nodes[0].status,'unknown');
  const state=M.withStatus({},nodes[0].key,'understood');assert.equal(M.buildMap(topics,state)[0].status,'understood');
  assert.throws(()=>M.withStatus({},nodes[0].key,'自动掌握'));
});
test('精简笔记包含记忆提示和多个概念关系，完整保留作者公式与来源',()=>{
  const value={title:'压力从哪里来？',course:'060112',cue:'画一个微元，如何写平衡？',concepts:['a','b','a'],body:'$$\np=\\rho gh\n$$\n\n适用条件：密度不变。',source:file.path+'#稳态条件'};
  const text=M.outcomeMarkdown(value);assert.match(text,/concepts: \["a","b"\]/);assert.ok(text.includes(value.body));assert.ok(text.includes(value.cue));
  assert.equal(M.outcomeEntry(file,{type:'class-note'}),null);
  assert.deepEqual(M.outcomeEntry(file,{type:'learning-outcome',concepts:['a','b'],cue:value.cue}).concepts,['a','b']);
  assert.throws(()=>M.outcomeMarkdown({...value,body:''}));
});
test('保存自评失败恢复内存，已存在的成果文件不会被覆写',async()=>{
  const p={data:{knowledgeMap:{statuses:{a:'review'}}},run:fn=>fn(),save:async()=>{throw Error('磁盘故障');}};
  await assert.rejects(Store.setStatus(p,'a','applied'));assert.equal(p.data.knowledgeMap.statuses.a,'review');
  const files=new Map(),folders=new Set(),vault={getAbstractFileByPath:path=>files.get(path)||(folders.has(path)?{}:null),createFolder:async path=>folders.add(path),create:async(path,body)=>{const f={path,body};files.set(path,f);return f;}};
  const plugin={app:{vault},courseCatalog:()=>[{id:'060112',title:'化工过程计算'}],run:fn=>fn()};
  const value={title:'同名笔记',course:'060112',cue:'提示',body:'原版'};
  const first=await Store.saveOutcome(plugin,value),second=await Store.saveOutcome(plugin,{...value,body:'新版'});
  assert.notEqual(first.path,second.path);assert.match(first.body,/原版/);assert.match(second.body,/新版/);
});

// ---- 用库里真实的课堂笔记验：地图里只剩概念，例题挂在概念上，一道都不丢 ----
const fs=require('node:fs'),path=require('node:path');
const VAULT=path.resolve(__dirname,'../../..');
const NOTES=path.join(VAULT,'03 知识库/我的课程/2026-27/课堂笔记');
const realTopics=()=>{
  const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(x=>x.isDirectory()?walk(path.join(d,x.name)):[path.join(d,x.name)]);
  return walk(NOTES).filter(f=>f.endsWith('.md')).flatMap(f=>{
    const rel=path.relative(VAULT,f).split(path.sep).join('/');
    return M.topicsFromNote({path:rel,basename:path.basename(f,'.md'),extension:'md'},fs.readFileSync(f,'utf8'));
  });
};
test('标题清理：去掉编号、日期、章次、习题课前缀和括号里的页码，留下术语原名',()=>{
  assert.equal(M.titleOf('9/14　向量与力的合成'),'向量与力的合成');
  assert.equal(M.titleOf('第 1 章　引言：系统与压力（p.3–5）'),'引言：系统与压力');
  assert.equal(M.titleOf('斯蒂文定律（Legge di Stevin，p.22–24）'),'斯蒂文定律（Legge di Stevin）');
  assert.equal(M.titleOf('最大值及其行列位置（PDF 第 1、4 页）'),'最大值及其行列位置');
  assert.equal(M.titleOf('习题课 E01：宏观物料衡算（例 2、3、5）'),'宏观物料衡算');
  assert.equal(M.titleOf('2.1 合力与合力矩要同时保留'),'合力与合力矩要同时保留');
  assert.equal(M.titleOf('叉积（prodotto vettoriale）'),'叉积（prodotto vettoriale）');
});
test('学习指引整节跳过；笔记骨架标题透明，小节往上提',()=>{
  const text='# 课\n## 课堂记录\n### 0 · 这份习题课在练什么\n#### 不该出现\n### 1. 质量守恒\n正文\n### 公式速查与易错点\n## 课后总结\n### 自测（答案附后）\n';
  assert.deepEqual(M.topicsFromNote(file,text).map(t=>t.title),['质量守恒']);
});
test('例题：挂在最近的概念上；整篇习题课的一串题归到带日期的「例题」节点；「X：六道例题」的概念是 X',()=>{
  const text='# 课\n## 等效电阻：六道例题\n### 例 1：串联\n#### 解法一\n### 例 2：并联\n## 例题逐题解析\n### 2.1 吊钩\n### 2.2 节点板\n## 7. 官方例题一：简支梁\n';
  const nodes=M.buildMap(M.topicsFromNote(file,text));
  assert.deepEqual(nodes.map(n=>[n.title,n.examples.map(e=>e.title)]),[
    ['等效电阻',['例 1：串联','例 2：并联']],
    ['例题逐题解析（9/22）',['吊钩','节点板']],
    ['例题（9/22）',['官方例题一：简支梁']],
  ]);
});
test('真实课堂笔记：没有指引节和例题成为知识点，47 道例题全部挂上，一道不丢',()=>{
  const topics=realTopics(),nodes=M.buildMap(topics);
  const bad=nodes.filter(n=>/^(?:官方例题|例\s*\d|巩固题)|速查|自测|对照阅读|课后作业|验证记录|一条主线|这份习题课/.test(n.title)).map(n=>n.title);
  assert.deepEqual(bad,[]);
  const examples=topics.filter(t=>t.example);
  assert.ok(examples.length>=40,`例题 ${examples.length}`);
  assert.deepEqual(examples.filter(e=>!nodes.some(n=>n.key===e.owner)).map(e=>e.title),[]);
  const find=title=>nodes.find(n=>n.title===title);
  assert.equal(find('等效电阻')?.examples.length,6);
  assert.equal(find('例题逐题解析（9/24）')?.examples.length,10);
  assert.equal(find('宏观物料衡算')?.examples.length,3);
  assert.ok(find('斯蒂文定律（Legge di Stevin）'));
  // 每个知识点都知道第一次在哪天讲，地图按它分组。
  assert.ok(nodes.every(n=>/^\d{4}-\d{2}-\d{2}$/.test(n.firstDate)));
});
