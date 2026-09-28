"use strict";

const { Plugin, Modal, Notice, parseYaml } = require("obsidian");
const {edit}=require('./core/task-fields');
const {openReading}=require('../shared/open-reading');
const {NoteStore} = require('./core/note-store');
const {ensureFile, appendBlock} = require('../shared/vault-utils');
const model = require("./core/capture-model.js");
const {TaskIndex, update, select} = require('./core/task-index');

const PATH = {
  inbox: "01 收件箱/收件箱.md",
  tasks: "00 工作台/今日任务.md",
  projects: "02 项目",
};

class CaptureModal extends Modal {
  constructor(plugin, title, placeholder, submit) {
    super(plugin.app);
    this.title = title;
    this.placeholder = placeholder;
    this.submit = submit;
  }

  onOpen() {
    const root = this.contentEl;
    root.empty();
    root.classList.add("cw-capture-input-modal");
    root.createEl("h2", { text: this.title });
    const area = root.createEl("textarea", { attr: { rows: "5", placeholder: this.placeholder } });
    area.addClass("cw-capture-input");
    const actions = root.createDiv("cw-actions");
    const button = actions.createEl("button", { text: "提交" });
    button.addClass("cw-primary");

    const run = async () => {
      if (button.disabled) return;
      const value = area.value.trim();
      if (!value) return new Notice("请输入内容。");
      button.disabled = true;
      try {
        await this.submit(value);
        this.close();
      } catch (error) {
        new Notice(`捕获失败：${error.message}`);
        button.disabled = false;
      }
    };

    button.addEventListener("click", run);
    area.addEventListener("keydown", event => {
      if (event.isComposing || event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      run();
    });
    window.setTimeout(() => area.focus(), 0);
  }
}

/**
 * L-OS 3.0 · 捕获 owner
 *
 * 对 workbench 暴露 v1.7 兼容 API：
 * captureNote / captureTask / captureProject
 *
 * 任务行的解析与统计请使用 this.taskModel，workbench 不再自己写正则。
 */
class LOSCapture extends Plugin {
  async onload() {
    this.registerInterval(window.setInterval(()=>this.checkReminders().catch(console.error),30000));
    this.notes = new NoteStore(this.app);
    this.taskModel = model;
    this.apiVersion = 1;
    this.index = new TaskIndex(this.app.vault);
    this.queue = Promise.resolve();
    for (const event of ['modify', 'create', 'delete', 'rename']) this.registerEvent(this.app.vault.on(event, (file, oldPath) => {
      this.index.invalidate(file);
      if (oldPath) this.index.invalidate({path:oldPath});
    }));

    this.addCommand({id:'new-note',name:'新建独立笔记',callback:()=>this.createNote()});
    for(const [action,name] of [['done','完成当前笔记'],['reopen','当前笔记置为待办'],['delete','删除当前笔记（回收站）']]) {
      this.addCommand({id:'note-'+action,name,checkCallback:checking=>{
        const file=this.app.workspace.getActiveFile();
        if(file?.extension!=='md')return false;
        if(!checking)this.updateNote(file,action).catch(e=>new Notice(e.message));
        return true;
      }});
    }
    this.addCommand({
      id: "capture-note",
      name: "捕获：随手记",
      callback: () => this.captureNote(),
    });
    this.addCommand({
      id: "capture-task",
      name: "捕获：添加今日任务",
      callback: () => this.captureTask(),
    });
    this.addCommand({
      id: "capture-project",
      name: "捕获：新建项目",
      callback: () => this.captureProject(),
    });
  }

  ensure(path, text) { return ensureFile(this.app, path, text); }
  async append(path, content, fallbackTitle) {
    const file = await appendBlock(this.app, path, content, fallbackTitle);
    this.index?.invalidate(file);
    this.app.workspace.trigger('l-os-capture:changed');
    return file;
  }
  createNote() {
    new CaptureModal(this, '新建笔记', '第一行填写标题，Shift+Enter 换行填写正文', async text => {
      const [title, ...body] = text.split('\n');
      const file = await this.notes.create(title, body.join('\n'));
      await openReading(this.app,file.path);
    }).open();
  }
  updateNote(file, action) { return this.notes.transition(file, action); }
  async deleteTask(task) {
    await this.updateTask(task, 'delete');
    const message=document.createElement('span');message.append('任务已删除 ');
    const undo=document.createElement('button');undo.textContent='撤销';message.append(undo);
    const notice=new Notice(message,10000);
    undo.onclick=async()=>{undo.disabled=true;try{await this.updateTask(task,'restore');notice.hide();}catch(e){new Notice(e.message);undo.disabled=false;}};
  }
  async createProject(title) {
    const name=model.sanitizeProjectName(title);if(!name)throw Error('项目名称不能为空');
    if(!this.app.vault.getAbstractFileByPath(PATH.projects)){try{await this.app.vault.createFolder(PATH.projects);}catch(e){if(!this.app.vault.getAbstractFileByPath(PATH.projects))throw e;}}
    const file=await this.app.vault.create(`${PATH.projects}/${name}.md`,model.projectTemplate(name));
    this.app.workspace.trigger('l-os-capture:changed');return file;
  }
  async readProject(file){
    const text=await this.app.vault.read(file),match=text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    return match?parseYaml(match[1])||{}:{};
  }
  async renameProject(file,title){
    const name=model.sanitizeProjectName(title);
    if(!name)throw Error('项目名称不能为空');
    return this.notes.run(file,async()=>{
      const oldPath=file.path,oldName=file.basename,target=`${PATH.projects}/${name}.md`;
      if(oldName===name)return file;
      if(this.app.vault.getAbstractFileByPath(target))throw Error('同名项目已存在，请换一个名称');
      await this.app.vault.process(file,content=>model.renameProjectContent(content,name));
      await this.app.fileManager.renameFile(file,target);
      this.index.invalidate(file);
      this.app.workspace.trigger('l-os-capture:changed');

      // Keep tasks created outside the project linked after the file rename.
      const tasks=(await this.index.all()).filter(task=>task.project===oldPath||task.project===oldName);
      for(const task of tasks)await this.patchTask(task,{project:target});
      return this.app.vault.getAbstractFileByPath(target)||file;
    });
  }
  deleteProject(file){
    return this.notes.run(file,async()=>{
      await this.app.fileManager.trashFile(file);
      this.index.invalidate(file);
      this.app.workspace.trigger('l-os-capture:changed');
    });
  }
  patchProject(file,expected,patch){
    return this.notes.run(file,async()=>{
      await this.app.fileManager.processFrontMatter(file,fm=>{
        for(const key of ['goal','next','due'])if(String(fm[key]||'')!==String(expected[key]||''))throw Error('项目已被其他视图修改，请重新打开项目设置');
        for(const key of ['goal','next','due'])fm[key]=String(patch[key]||'');
      });this.app.workspace.trigger('l-os-capture:changed');
    });
  }
  patchTask(task, patch) {
    const next=this.queue.then(async()=>{
      const file=this.app.vault.getAbstractFileByPath(task.path);if(!file)throw Error('任务来源已删除');
      let id;
      await this.app.vault.process(file,content=>{const result=edit(content,task,patch,globalThis.crypto.randomUUID());id=result.id;return result.content;});
      this.index.invalidate(file);
      const result=(await this.index.all()).find(t=>t.path===file.path&&t.id===id);
      if(!result)throw Error('写入后无法定位任务，请刷新');
      this.app.workspace.trigger('l-os-capture:changed');return result;
    });this.queue=next.catch(()=>{});return next;
  }
  async listTasks(options = {}) { return select(await this.index.all(), options); }
  async taskStats() {
    const tasks = (await this.index.all()).filter(t=>!t.deleted);
    return {open:tasks.filter(t => !t.done).length, done:tasks.filter(t => t.done && t.doneDate === model.day()).length};
  }
  updateTask(task, action) {
    const next = this.queue.then(async () => {
      const file = this.app.vault.getAbstractFileByPath(task.path);
      if (!file) throw Error('任务来源文件已移动或删除');
      await this.app.vault.process(file, content => {
        const result=update(content,task,action);
        if(action!=='done'||task.done||!task.repeat||task.repeat==='once')return result;
        const marker=`<!-- repeat-of:${task.id||encodeURIComponent(task.raw)} -->`;
        if(result.includes(marker))return result;
        const next=require('./core/task-create').repeatLine(task,model.day(),globalThis.crypto.randomUUID());
        return next?result.trimEnd()+'\n'+next+'\n':result;
      });
      this.index.invalidate(file);
      this.app.workspace.trigger('l-os-capture:changed');
    });
    this.queue = next.catch(() => {}); return next;
  }
  captureTask(options={}) { const {TaskModal}=require('./task-modal');new TaskModal(this,options).open(); }
  async createTask(value,task){
    const creation=require('./core/task-create'),v=creation.normalize(value);
    if(v.project&&!this.app.vault.getAbstractFileByPath(v.project))throw Error('所属项目不存在，请重新选择');
    if(task)return this.patchTask(task,v);
    const id=globalThis.crypto.randomUUID(),path=v.project||PATH.tasks;
    await this.append(path,creation.line(v,id),path===PATH.tasks?'# 今日任务\n':'');
    return (await this.index.all()).find(t=>t.id===id);
  }
  async checkReminders(){
    if(this.reminderBusy)return;this.reminderBusy=true;
    try{for(const task of await this.index.all())if(!task.done&&!task.deleted&&task.reminder_at&&task.reminder_sent!==task.reminder_at&&Date.parse(task.reminder_at)<=Date.now()){
      await this.patchTask(task,{reminder_sent:task.reminder_at});new Notice('任务提醒：'+task.text,10000);
    }}finally{this.reminderBusy=false;}
  }
  async addProjectTask(file,text) {
    if(!file.path.startsWith('02 项目/')||file.extension!=='md')throw Error('请选择项目笔记');
    const line=model.taskLine(model.clean(text),`${Date.now()}-${Math.random().toString(36).slice(2,8)}`);
    return this.append(file.path,line+' <!-- scheduled:backlog -->','');
  }
  async addTask(text, info = {}) {
    const title = model.clean(text);
    const line = model.taskLine(title, `${Date.now()}-${Math.random().toString(36).slice(2,8)}`);
    const plan = Object.keys(info).length ? ` <!-- plan:${encodeURIComponent(JSON.stringify(info))} -->` : '';
    return this.append(PATH.tasks, `${line}${plan} <!-- scheduled:${model.day()} -->`, '# 今日任务\n');
  }

  captureNote() {
    new CaptureModal(this, "随手记", "先记下来，不必整理。", async text => {
      await this.append(PATH.inbox, model.inboxEntry(text), "# 收件箱\n");
      new Notice("已存入收件箱");
    }).open();
  }

  captureProject() {
    new CaptureModal(this, "新建项目", "输入项目名称；创建后填写目标与下一步。", async text => {
      const name = model.sanitizeProjectName(text);
      if (!name) throw new Error("请输入有效的项目名称。");
      const path = `${PATH.projects}/${name}.md`;
      if (this.app.vault.getAbstractFileByPath(path)) throw new Error("同名项目已存在，请换一个名称。");
      const file = await this.ensure(path, model.projectTemplate(name));
      await openReading(this.app,file.path);
    }).open();
  }
}

module.exports = LOSCapture;
