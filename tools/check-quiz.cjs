"use strict";
// agent 出完本周题库后运行：node tools/check-quiz.cjs [2026-W39]
// 规则见 docs/知识图谱与出题规范.md「二、周五自测题库」。不合格的题库插件拒绝加载。
const fs=require('node:fs'),path=require('node:path');
const G=require('../l-os-workbench/knowledge-graph'),Q=require('../l-os-workbench/quiz-model');
const vault=path.resolve(__dirname,'../..');
const read=rel=>{try{return fs.readFileSync(path.join(vault,rel),'utf8');}catch{return null;}};
function graphs(){
  const dir=path.join(vault,G.GRAPH_DIR),out=new Map();
  for(const f of fs.existsSync(dir)?fs.readdirSync(dir):[])if(G.isGraphPath(`${G.GRAPH_DIR}/${f}`)){const g=JSON.parse(read(`${G.GRAPH_DIR}/${f}`));out.set(String(g.course),g);}
  return out;
}
// Obsidian 的 ![[名字]] 按文件名找；只在课堂笔记附件里找，题目只许引用笔记里已有的图。
const images=()=>{const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(x=>x.isDirectory()?walk(path.join(d,x.name)):[x.name]);return new Set(walk(path.join(vault,'03 知识库/我的课程')));};
function deep(){
  const sections=new Map(),names=images();
  return {exists:(p,h)=>{if(!sections.has(p)){const t=read(p);sections.set(p,t==null?null:G.sectionsOf(t));}return !!sections.get(p)?.has(h);},image:name=>names.has(name.split('/').pop())};
}
function check(only=process.argv.slice(2)){
  const dir=path.join(vault,Q.QUIZ_DIR);
  const files=fs.existsSync(dir)?fs.readdirSync(dir).filter(f=>Q.isQuizPath(`${Q.QUIZ_DIR}/${f}`)&&(!only.length||only.some(w=>f.startsWith(w)))):[];
  if(!files.length){console.log('没有要检查的题库。');return 0;}
  const g=graphs(),d=deep();let failed=0;
  for(const f of files){
    let quiz,errors;try{quiz=JSON.parse(read(`${Q.QUIZ_DIR}/${f}`));errors=Q.quizErrors(quiz,g,d);}catch(e){errors=[`JSON 解析失败：${e.message}`];}
    if(errors.length){failed++;console.log(`✗ ${f}`);for(const e of errors)console.log(`  - ${e}`);continue;}
    const qs=quiz.courses.flatMap(c=>c.questions),count=k=>qs.filter(k).length;
    console.log(`✓ ${f}：${quiz.courses.length} 门 · ${qs.length} 题（概念 ${count(q=>q.level==='concept')} / 应用 ${count(q=>q.level==='application')}；单选 ${count(q=>q.type==='single')} · 多选 ${count(q=>q.type==='multiple')} · 判断 ${count(q=>q.type==='truefalse')} · 数值 ${count(q=>q.type==='numeric')}）`);
  }
  return failed;
}
module.exports={check};
if(require.main===module)process.exitCode=check()?1:0;
