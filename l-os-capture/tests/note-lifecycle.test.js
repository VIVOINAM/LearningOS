'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {NoteStore}=require('../core/note-store'), tasks=require('../core/task-index');
test('删除/撤销保留 CRLF、YAML、正文和相邻任务，拒绝重复撤销',()=>{
  const original='---\r\nstatus: todo\r\n---\r\n# 测试\r\n- [ ] a <!-- task:unique -->\r\n- [ ] b\r\n';
  const task=tasks.parse(original,'00 工作台/今日任务.md')[0];
  const removed=tasks.update(original,task,'delete');
  assert.equal(tasks.select(tasks.parse(removed,task.path)).length,1);
  const trash=tasks.select(tasks.parse(removed,task.path),{filter:'deleted'});
  assert.equal(trash.length,1);assert.equal(tasks.update(removed,trash[0],'restore'),original);
  assert.equal(tasks.update(removed,task,'restore'),original);
  assert.throws(()=>tasks.update(original,task,'restore'));
  const done=tasks.update(original,task,'done');
  assert.ok(done.includes(' -->\r\n- [ ] b'));
  assert.equal(tasks.update(done,tasks.parse(done,task.path)[0],'reopen'),original);
});
test('笔记状态更新按文件串行，保留其他 YAML 字段；失败后继续，删除后拒绝写入',async()=>{
  const file={path:'a.md',extension:'md'}, files=new Map([[file.path,file]]);
  const fm={tags:['keep'],custom:{a:1}}, events=[];let active=0,max=0,fail=false;
  const app={vault:{getAbstractFileByPath:p=>files.get(p)},workspace:{trigger:e=>events.push(e)},fileManager:{
    async processFrontMatter(f,fn){active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,2));active--;if(fail){fail=false;throw Error('disk');}fn(fm);},
    async trashFile(f){files.delete(f.path);},
  }};
  const store=new NoteStore(app);
  await Promise.all([store.transition(file,'done'),store.transition(file,'reopen'),store.transition(file,'done')]);
  assert.equal(max,1);assert.equal(fm.status,'done');assert.ok(fm.completed);assert.deepEqual(fm.custom,{a:1});assert.deepEqual(fm.tags,['keep']);
  fail=true;await assert.rejects(store.transition(file,'reopen'));assert.equal(fm.status,'done');
  await store.transition(file,'reopen');assert.equal(fm.status,'todo');assert.equal(fm.completed,undefined);
  // A renamed TFile retains its queue identity.
  files.delete(file.path);file.path='renamed.md';files.set(file.path,file);
  const deletion=store.transition(file,'delete'), late=store.transition(file,'done');
  await deletion;await assert.rejects(late,/删除/);assert.equal(files.size,0);
});
test('同名笔记并发创建不覆盖，标题换行及 YAML 字符不会注入元数据',async()=>{
  const files=new Map(),app={vault:{getAbstractFileByPath:p=>files.get(p),async createFolder(p){files.set(p,{path:p});},async create(path,content){assert.ok(!files.has(path));const f={path,content};files.set(path,f);return f;}}};
  const store=new NoteStore(app);
  const [a,b]=await Promise.all([store.create('same: title\nstatus: done','body'),store.create('same: title\nstatus: done','body')]);
  assert.notEqual(a.path,b.path);assert.match(a.content,/status: todo/);assert.ok(a.content.endsWith('body\n'));
});
