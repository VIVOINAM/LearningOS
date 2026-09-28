"use strict";

// The queue keys are TFile objects, so renames cannot bypass serialization.
class NoteStore {
  constructor(app) { this.app = app; this.pending = new WeakMap(); }
  run(file, operation) {
    if (!file || file.extension !== 'md') return Promise.reject(Error('请选择 Markdown 笔记'));
    const result = (this.pending.get(file) || Promise.resolve()).then(() => {
      if (this.app.vault.getAbstractFileByPath(file.path) !== file) throw Error('笔记已移动或删除，请刷新');
      return operation();
    });
    this.pending.set(file, result.catch(() => {}));
    return result;
  }
  async create(title, body = '') {
    const name = String(title).replace(/[\\/:*?"<>|#\[\]^\r\n]/g, ' ').trim().slice(0,80).replace(/[. ]+$/g,'');
    if (!name) throw Error('笔记标题不能为空');
    const id = globalThis.crypto.randomUUID();
    const content = `---\ntype: note\nstatus: todo\nid: ${id}\ncreated: ${new Date().toISOString()}\n---\n# ${name}\n\n${body}\n`;
    const folder='01 收件箱';
    if(!this.app.vault.getAbstractFileByPath(folder)) {
      try {await this.app.vault.createFolder(folder);}catch(e){if(!this.app.vault.getAbstractFileByPath(folder))throw e;}
    }
    for(let n=0;n<1000;n++) {
      const path=`${folder}/${name}${n?' '+n:''}.md`;
      if(this.app.vault.getAbstractFileByPath(path))continue;
      try {return await this.app.vault.create(path,content);}catch(e){if(!this.app.vault.getAbstractFileByPath(path))throw e;}
    }
    throw Error('同名笔记过多，请换一个标题');
  }
  transition(file, action) {
    return this.run(file, async () => {
      if (action === 'delete') {
        // Obsidian manages links/events and its recoverable local trash.
        await this.app.fileManager.trashFile(file);
      } else {
        if (!['done','reopen'].includes(action)) throw Error('不支持的笔记状态');
        // Never base writes on the asynchronously refreshed metadata cache.
        await this.app.fileManager.processFrontMatter(file, fm => {
          fm.status = action === 'done' ? 'done' : 'todo';
          fm.updated = new Date().toISOString();
          if (action === 'done') fm.completed = fm.completed || fm.updated;
          else delete fm.completed;
        });
      }
      this.app.workspace.trigger('l-os-capture:changed');
    });
  }
}
module.exports = {NoteStore};
