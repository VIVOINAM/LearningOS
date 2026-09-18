"use strict";
const {parseYaml}=require('obsidian');
const {dayKey}=require('./console-model');
class FocusSelection {
  constructor(plugin){this.p=plugin;this.queue=Promise.resolve();this.values=new Map();this.versions=new Map();}
  async read(day=dayKey()) {
    if(this.values.has(day))return this.values.get(day);
    const revision=this.versions.get(day)||0;
    const file=this.p.app.vault.getAbstractFileByPath(`05 日记/${day}.md`);
    let id='';
    if(file){const text=await (this.p.app.vault.read?.(file)||this.p.app.vault.cachedRead(file));const yaml=text.match(/^---\r?\n([\s\S]*?)\r?\n---/);if(yaml)id=parseYaml?.(yaml[1])?.focus_task_id||'';}
    if(revision!==(this.versions.get(day)||0))return this.read(day);
    this.values.set(day,id);
    return this.values.get(day)||'';
  }
  invalidate(file){const match=file?.path?.match(/^05 日记\/(\d{4}-\d{2}-\d{2})\.md$/);if(match){this.values.delete(match[1]);this.versions.set(match[1],(this.versions.get(match[1])||0)+1);}}
  select(task,day=dayKey()) {
    const run=this.queue.then(async()=>{
      const capture=this.p.captureOwner();
      const stable=task.id?task:await capture.patchTask(task,{});
      const current=(await capture.index.all()).filter(t=>t.id===stable.id&&!t.deleted);
      if(current.length!==1)throw Error('目标任务已删除或 ID 不唯一');
      const file=await this.p.ensure(`05 日记/${day}.md`,`---\ntype: daily\ndate: ${day}\n---\n# ${day}\n`);
      await this.p.app.fileManager.processFrontMatter(file,fm=>{fm.focus_task_id=stable.id;fm.focus_revision=(Number(fm.focus_revision)||0)+1;fm.focus_updated_at=new Date().toISOString();});
      // 同时写进正文的「今天最重要的一件事」。此前只写 frontmatter，
      // 而 updatePriority 没有任何调用方，日记正文那一行永远是空的。
      await this.p.writePriorityDirect(day,stable.text);
      this.versions.set(day,(this.versions.get(day)||0)+1);this.values.set(day,stable.id);
      this.p.app.workspace.trigger('learningos:focus-changed',{day,taskId:stable.id});
      return stable;
    });this.queue=run.catch(()=>{});return run;
  }
}
module.exports={FocusSelection};
