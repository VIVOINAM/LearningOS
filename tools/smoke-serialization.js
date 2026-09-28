"use strict";
const assert=require('node:assert/strict'),Module=require('node:module');
const original=Module._load;
Module._load=function(name){if(name==='obsidian')return {Plugin:class{},ItemView:class{},Modal:class{},Notice:class{},parseYaml:text=>Object.fromEntries(text.split('\n').filter(s=>s.includes(':')).map(s=>{const i=s.indexOf(':');return [s.slice(0,i).trim(),s.slice(i+1).trim()];}))};return original.apply(this,arguments);};
const {FocusSelection}=require('../l-os-workbench/focus-selection'),{openReading}=require('../shared/open-reading'),Workbench=require('../l-os-workbench/main');
(async()=>{
 const files=new Map(),events=[];let fail=false;
 const tasks=[{id:'a',text:'A'},{id:'b',text:'B'}];
 const app={vault:{getAbstractFileByPath:path=>files.get(path),read:async f=>f.text},fileManager:{processFrontMatter:async(f,fn)=>{if(fail)throw Error('disk full');const fm={keep:'yes'};fn(fm);f.text='---\n'+Object.entries(fm).map(([k,v])=>k+': '+v).join('\n')+'\n---\n# day';}},workspace:{trigger:(...e)=>events.push(e)}};
 const priorityWrites=[];
 const p={app,captureOwner:()=>({index:{all:async()=>tasks}}),ensure:async(path,text)=>{if(!files.has(path))files.set(path,{path,text});return files.get(path);},
  writePriorityDirect:async(key,text)=>{priorityWrites.push([key,text]);}};
 const store=new FocusSelection(p);
 await Promise.all([store.select(tasks[0],'2026-09-13'),store.select(tasks[1],'2026-09-13')]);assert.equal(await store.read('2026-09-13'),'b');
 // 选定今日要务时，除 frontmatter 外还要写进日记正文的「今天最重要的一件事」。
 assert.deepEqual(priorityWrites,[['2026-09-13','A'],['2026-09-13','B']]);
 const reopened=new FocusSelection(p);assert.equal(await reopened.read('2026-09-13'),'b');assert.equal(await reopened.read('2026-09-14'),'');
 fail=true;await assert.rejects(store.select(tasks[0],'2026-09-13'));assert.equal(await store.read('2026-09-13'),'b');fail=false;
 // frontmatter 写失败时不得继续写正文，否则两处会不一致。
 assert.equal(priorityWrites.length,2);
 tasks[0].deleted=true;await assert.rejects(store.select(tasks[0],'2026-09-13'));assert.equal(events.length,2);
 let state,created=0,revealed=0;
 const leaf={view:{file:{path:'a.md'}},setViewState:async s=>{state=s;}};
 const navigation={vault:{getAbstractFileByPath:()=>({extension:'md'})},workspace:{getLeavesOfType:()=>[leaf],getLeaf:()=>{created++;return leaf;},revealLeaf:async()=>{revealed++;}}};
 await openReading(navigation,'a.md');assert.equal(created,0);assert.equal(state.state.mode,'preview');assert.equal(revealed,1);
 const dashboard={getViewType:()=> 'l-os-workbench'},source={view:{file:{path:'a.md'},getViewType:()=> 'markdown'},detach(){this.detached=(this.detached||0)+1;}};
 let release;const pending=new Promise(r=>release=r);
 const home={app:{workspace:{activeLeaf:source}},views:new Set([{flushEdits:async()=>{},setTab:async t=>assert.equal(t,'today')}]),data:{timer:{status:'idle'}},readingFlow:{dismiss(){}},study:{checkpoint:async()=>{}},activate:async()=>pending,refresh:async()=>{}};
 const first=Workbench.prototype.returnHome.call(home),second=Workbench.prototype.returnHome.call(home);assert.equal(first,second);release();await first;assert.equal(source.detached,1);
 const other={view:{file:{path:'old.md'},getViewType:()=> 'markdown'},detach(){throw Error('must not close switched page');}};
 home.app.workspace.activeLeaf=other;home.activate=async()=>{other.view.file={path:'new.md'};};await Workbench.prototype.returnHome.call(home);
 home.app.workspace.activeLeaf={view:dashboard,detach(){throw Error('must not close dashboard');}};home.activate=async()=>{};await Workbench.prototype.returnHome.call(home);
 home.app.workspace.activeLeaf=source;home.activate=async()=>{throw Error('activation failed');};await assert.rejects(Workbench.prototype.returnHome.call(home));assert.equal(source.detached,1);
 console.log('串行化与回滚集成通过： serialized focus/reload/rollback/deleted target, reading leaf reuse, return deduplication/source isolation/failure preservation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
