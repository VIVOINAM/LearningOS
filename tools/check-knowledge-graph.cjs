"use strict";
// agent 每次更新概念图谱后运行：node tools/check-knowledge-graph.cjs [课程代码…]
// 规则见 docs/知识图谱与出题规范.md。上一版取 git HEAD 里的同名文件，用来查概念 ID 有没有消失。
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const G=require('../l-os-workbench/knowledge-graph');
const vault=path.resolve(__dirname,'../..'),dir=path.join(vault,G.GRAPH_DIR);
const only=process.argv.slice(2);
const read=rel=>{try{return fs.readFileSync(path.join(vault,rel),'utf8');}catch{return null;}};
const previous=rel=>{try{return JSON.parse(execFileSync('git',['show',`HEAD:${rel}`],{cwd:vault,encoding:'utf8',stdio:['ignore','pipe','ignore']}));}catch{return null;}};
function check(){
  const files=fs.existsSync(dir)?fs.readdirSync(dir).filter(f=>G.isGraphPath(`${G.GRAPH_DIR}/${f}`)&&(!only.length||only.some(c=>f.startsWith(c+' ')))):[];
  if(!files.length){console.log('没有要检查的概念图谱。');return 0;}
  let failed=0;
  for(const name of files){
    const rel=`${G.GRAPH_DIR}/${name}`;let graph,errors;
    try{graph=JSON.parse(read(rel));errors=G.structureErrors(graph);}catch(e){errors=[`JSON 解析失败：${e.message}`];}
    if(!errors.length)errors=G.deepErrors(graph,read,previous(rel));
    if(errors.length){failed++;console.log(`✗ ${name}`);for(const e of errors)console.log(`  - ${e}`);}
    else{const live=graph.concepts.filter(c=>!c.retired);console.log(`✓ ${name}：${graph.chapters.length} 章 · ${live.length} 个概念 · ${live.reduce((n,c)=>n+(c.examples||[]).length,0)} 道例题 · ${graph.notes.length} 篇笔记`);}
  }
  return failed;
}
module.exports={check};
if(require.main===module)process.exitCode=check()?1:0;
