'use strict';
const assert=require('node:assert/strict'), Module=require('node:module');
const handlers=new Map(), stored=new Map();let fail=false, modalCount=0;
const workspace={on(name,fn){handlers.set(name,[...(handlers.get(name)||[]),fn]);return {};},trigger(name,...args){for(const fn of handlers.get(name)||[])fn(...args);}};
const elem=()=>({addClass(){},createEl(){return {...elem(),focus(){}};}});
class Modal{constructor(){this.contentEl=elem();}open(){modalCount++;this.onOpen?.();}close(){this.onClose?.();}}
class Plugin{constructor(app,manifest){this.app=app;this.manifest=manifest;}loadData(){return stored.get(this.manifest.id);}async saveData(d){if(fail)throw Error('disk full');stored.set(this.manifest.id,structuredClone(d));}addCommand(){}registerEvent(){}registerInterval(){}}
const original=Module._load;
Module._load=function(name){if(name==='obsidian')return {Plugin,Modal,Notice:class{}};return original.apply(this,arguments);};
global.window={setInterval:()=>0};
const Focus=require('../codex-focus/main'),{ReadingFlow}=require('../codex-workbench/reading-flow'),{dueState}=require('../codex-workbench/due');
(async()=>{
  const app={workspace,vault:{adapter:{read:async()=>{throw Error('ENOENT');}}},plugins:{getPlugin:()=>focus}};
  const focus=new Focus(app,{id:'focus'});await focus.onload();
  const file={path:'book/a.pdf',basename:'a'}, otherFile={path:'book/b.pdf'}, leaves=[];
  const leaf={view:{file},detach(){leaves.splice(leaves.indexOf(this),1);}},other={view:{file:otherFile}};leaves.push(leaf,other);
  workspace.activeLeaf=leaf;workspace.getLeavesOfType=()=>leaves;workspace.revealLeaf=async l=>{workspace.activeLeaf=l;};
  let checkpoint=0,tab='',home=0;
  const p={app,focusOwner:()=>focus,views:new Set([{setTab:async t=>{tab=t;}}]),activate:async()=>{home++;},study:{checkpoint:async()=>{checkpoint++;}}};
  const flow=new ReadingFlow(p);workspace.on('codex-focus:finished',s=>flow.finished(s));
  await Promise.all([flow.opened(file),flow.opened(file)]);
  const id=focus.state().id;assert.equal(focus.state().status,'running');assert.equal(flow.context.id,id);
  await flow.opened(file);assert.equal(focus.state().id,id);
  await focus.dispatch('pause');await flow.opened(file);assert.equal(focus.state().status,'paused');
  const expired={...focus.state(),status:'running',endAt:Date.now()-100,remaining:0};await focus.setState(expired);
  await Promise.all([focus.dispatch('finish'),focus.dispatch('finish')]);assert.equal(modalCount,1);assert.equal(focus.sessions().filter(s=>s.id===id).length,1);
  await flow.opened(file);assert.equal(focus.state().status,'idle');
  await flow.choose('continue');flow.modal.close();assert.equal(focus.state().phase,'focus');assert.equal(focus.state().status,'running');assert.notEqual(focus.state().id,id);assert.equal(workspace.activeLeaf,leaf);assert.equal(leaves.length,2);
  await focus.setState({...focus.state(),endAt:Date.now()-100});await focus.dispatch('finish');assert.equal(modalCount,2);
  await flow.choose('rest');flow.modal.close();assert.equal(checkpoint,1);assert.equal(home,1);assert.equal(tab,'today');assert.deepEqual(leaves,[other]);
  assert.equal(focus.state().status,'idle');
  fail=true;const settings=focus.settings();await assert.rejects(focus.setSettings({focusMinutes:40}));assert.deepEqual(focus.settings(),settings);fail=false;
  await focus.setSettings({focusMinutes:40});assert.equal(focus.settings().focusMinutes,40);
  flow.dispose();
  assert.equal(dueState('2026-02-30'),null);assert.equal(dueState('2026-09-13',new Date(2026,8,13)).days,0);assert.equal(dueState('2026-09-12',new Date(2026,8,13)).level,'overdue');
  console.log('阅读与计时集成通过： PDF deduplication/pause/expiry/continue/rest, leaf isolation, settings rollback, calendar boundaries.');
})().catch(e=>{console.error(e);process.exitCode=1;});
