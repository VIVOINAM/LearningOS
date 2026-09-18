"use strict";
const {fields}=require('./task-fields');
const model = require('./capture-model');

// Markdown remains the source of truth. Generated docs and archived material
// are deliberately outside the action index; fenced examples aren't tasks.
function eligible(path) {
  return /\.md$/i.test(path) && !/^(?:\.|07 归档\/|08 插件开发\/|99 模板\/|版本管理\/)/.test(path)
    && (path === '00 工作台/今日任务.md' || /^(01 收件箱|02 项目|03 知识库|04 创作|05 日记)\//.test(path));
}
function parse(content, path) {
  let fence = null, yaml = false; const deleted=[];
  const masked = String(content).split('\n').map((line, index) => {
    if (index === 0 && line.trim() === '---') { yaml = true; return ''; }
    if (yaml) { if (line.trim() === '---') yaml = false; return ''; }
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      return '';
    }
    if(!fence) {
      const removed=line.trim().match(/^<!-- deleted-task:(.*) -->$/);
      if(removed) {
        try {const task=model.parseTaskLines(decodeURIComponent(removed[1]))[0];if(task)deleted.push({...task,path,index,deleted:true});}catch(e){/* Keep malformed tombstones untouched. */}
        return '';
      }
    }
    return fence ? '' : line;
  }).join('\n');
  return [...model.parseTaskLines(masked),...deleted].map(task => ({
    ...task, ...fields(task.raw), path, due: task.raw.match(/(?:📅\s*|due::\s*)(\d{4}-\d{2}-\d{2})/)?.[1] || '',
    priority: /^P[1-4]$/.test(fields(task.raw).priority_level)?5-Number(fields(task.raw).priority_level.slice(1)):/⏫|🔺|#urgent\b/.test(task.raw) ? 2 : /🔼|#important\b/.test(task.raw) ? 1 : 0,
    scheduled: task.raw.match(/<!--\s*scheduled:(\d{4}-\d{2}-\d{2}|backlog)\s*-->/)?.[1] || (path === '00 工作台/今日任务.md' ? model.day() : ''),
  }));
}
function locate(lines, task) {
  if (lines[task.index] === task.raw) return task.index;
  const matches = lines.map((line, i) => line === task.raw ? i : -1).filter(i => i >= 0);
  if (matches.length !== 1) throw Error('任务已变化或存在同名行，请刷新后重试。');
  return matches[0];
}
function update(content, task, action, today = model.day()) {
  const eol=content.includes('\r\n')?'\r\n':'\n';
  const originalRaw=task.raw;
  task={...task,raw:task.raw.replace(/\r$/, '')};
  const lines = content.split(/\r?\n/);
  const tombstone = `<!-- deleted-task:${encodeURIComponent(originalRaw)} -->`;
  if (action === 'restore') {
    const matches=lines.map((line,i)=>line===tombstone?i:-1).filter(i=>i>=0);
    if(matches.length!==1)throw Error('删除记录已变化，无法安全撤销');
    lines[matches[0]]=task.raw;return lines.join(eol);
  }
  const index = locate(lines, task);
  if (action === 'done') {
    lines[index] = lines[index].replace(/- \[[ xX]\]/, '- [x]').replace(/\s*<!--\s*done:[^>]+-->/g, '') + ` <!-- done:${today} -->`;
  } else if (action === 'reopen') {
    lines[index] = lines[index].replace(/- \[[xX]\]/, '- [ ]').replace(/\s*<!--\s*done:[^>]+-->/g, '');
  } else if (action === 'today') {
    lines[index] = lines[index].replace(/\s*<!--\s*scheduled:[^>]+-->/g, '') + ` <!-- scheduled:${today} -->`;
  } else if (action === 'unschedule') {
    lines[index] = lines[index].replace(/\s*<!--\s*scheduled:[^>]+-->/g, '') + ' <!-- scheduled:backlog -->';
  } else if(action === 'delete') {
    lines[index] = tombstone;
  } else throw Error('不支持的任务操作');
  return lines.join(eol);
}
function select(tasks, {filter = 'open', query = '', today = model.day()} = {}) {
  const q = query.trim().toLocaleLowerCase();
  return tasks.filter(t => (!q || `${t.text} ${t.path}`.toLocaleLowerCase().includes(q)) && (
    filter === 'deleted' ? t.deleted : !t.deleted && (filter === 'done' ? t.done : !t.done && (filter === 'today' ? t.scheduled === today || !!t.due && t.due <= today : filter === 'overdue' ? !!t.due && t.due < today : true))
  )).sort((a,b) => b.priority - a.priority || (a.due || '9999').localeCompare(b.due || '9999') || a.path.localeCompare(b.path) || a.index - b.index);
}
class TaskIndex {
  constructor(vault) { this.vault = vault; this.cache = new Map(); this.revisions = new Map(); }
  invalidate(file) { if (file?.path) { this.cache.delete(file.path); this.revisions.set(file.path, (this.revisions.get(file.path) || 0) + 1); } }
  async all() {
    const files = this.vault.getMarkdownFiles().filter(f => eligible(f.path));
    const paths = new Set(files.map(f => f.path));
    for (const path of this.cache.keys()) if (!paths.has(path)) this.cache.delete(path);
    const result = [];
    for (const file of files) {
      const stamp = `${file.stat?.mtime}:${file.stat?.size}`, revision = this.revisions.get(file.path) || 0;
      let entry = this.cache.get(file.path);
      if (!entry || entry.stamp !== stamp) {
        entry = {stamp, tasks: parse(await this.vault.cachedRead(file), file.path)};
        if (revision === (this.revisions.get(file.path) || 0)) this.cache.set(file.path, entry);
      }
      result.push(...entry.tasks.map(t=>t.path==='00 工作台/今日任务.md'&&!/<!--\s*scheduled:/.test(t.raw)?{...t,scheduled:model.day()}:t));
    }
    return result;
  }
}
module.exports = {eligible, parse, update, select, TaskIndex};
