"use strict";
const assert = require('node:assert/strict'), Module = require('node:module'), path = require('node:path');
const events = () => {const handlers = new Map(); return {
  on(name,fn){const list=handlers.get(name)||[];list.push(fn);handlers.set(name,list);return {name,fn};},
  trigger(name,...args){for(const fn of handlers.get(name)||[])fn(...args);}
};};
const files=new Map(), stored=new Map();let rejectSave=false;
class Plugin {
  constructor(app,manifest){this.app=app;this.manifest=manifest;}
  async loadData(){return stored.get(this.manifest.id)||null;}
  async saveData(data){if(rejectSave)throw Error('disk full');stored.set(this.manifest.id,JSON.parse(JSON.stringify(data)));}
  addCommand(){} registerEvent(){} registerInterval(){}
}
const original=Module._load;
Module._load=function(name){if(name==='obsidian')return {Plugin,Modal:class{},Notice:class{}};return original.apply(this,arguments);};
global.window={setInterval:()=>0};
const vault=Object.assign(events(),{
  getAbstractFileByPath:p=>files.get(p),getMarkdownFiles:()=>[...files.values()].filter(f=>f.path.endsWith('.md')),
  cachedRead:async f=>f.content,process:async(f,fn)=>{f.content=fn(f.content);vault.trigger('modify',f);},
  adapter:{read:async()=>{throw Error('ENOENT');}},
});
const app={vault,workspace:events(),plugins:{getPlugin:id=>instances[id]}};const instances={};
const load=async id=>{const C=require(path.join(__dirname,'../dist/plugins',id,'main.js'));const p=new C(app,{id});instances[id]=p;await p.onload();return p;};
async function main(){
  const capture=await load('codex-capture');
  const f={path:'02 项目/test.md',content:'- [ ] important 📅 2026-09-01',stat:{mtime:1,size:10}};files.set(f.path,f);
  const task=(await capture.listTasks())[0];await capture.updateTask(task,'done');assert.match(f.content,/- \[x\]/);
  await assert.rejects(capture.updateTask(task,'done'));assert.equal((await capture.listTasks()).length,0);
  const focus=await load('codex-focus');await focus.dispatch('start',{task:'test'});
  assert.equal(focus.state().status,'running');await focus.dispatch('toggle');assert.equal(focus.state().status,'paused');
  const before=JSON.stringify(focus.data);rejectSave=true;await assert.rejects(focus.dispatch('toggle'));assert.equal(JSON.stringify(focus.data),before);rejectSave=false;
  await focus.dispatch('toggle');await focus.dispatch('finish');assert.equal(focus.state().status,'idle');
  const expired=focus.start(focus.initial(),'expiration',1,Date.now()-2000);await focus.setState(expired);
  await Promise.all([focus.dispatch('finish'),focus.dispatch('finish')]);
  assert.equal(focus.sessions().filter(s=>s.task==='expiration').length,1);
  const recall=await load('codex-recall');await Promise.all([recall.add(f.path),recall.add(f.path)]);assert.equal(recall.list().length,1);
  await recall.rate(f.path,'good');const due=recall.list()[0].due;
  const reloaded=await load('codex-recall');assert.equal(reloaded.list()[0].due,due);
  rejectSave=true;await assert.rejects(reloaded.rate(f.path,'again'));assert.equal(reloaded.list()[0].due,due);rejectSave=false;
  await reloaded.rate(f.path,'again');assert.equal(reloaded.data.history.length,2);
  await reloaded.remove(f.path);assert.equal(reloaded.list().length,0);assert.equal(files.get(f.path),f);
  console.log('owner 集成通过： source writeback, timer rollback/expiry, review persistence/rollback, independent use.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
