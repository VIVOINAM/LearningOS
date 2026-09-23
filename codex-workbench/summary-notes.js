"use strict";

// Index the existing notes in every academic year; attachments never enter the list.
function isSummaryNote(file) {
  return file.extension === 'md' && /^03 知识库\/我的课程\/[^/]+\/课堂笔记\/[^/]+\/.+\.md$/i.test(file.path)
    && !file.path.split('/').includes('_assets');
}
function validDate(value) {
  const text = value instanceof Date ? value.toISOString().slice(0,10) : String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const date = new Date(text + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === text ? text : '';
}
function noteBody(text) {
  return String(text || '').replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
}
function summaryEntry(file, frontmatter = {}, text = '', courses = []) {
  const folder = file.path.split('/')[4];
  const code = folder.match(/^(\d+)\s/)?.[1] || folder;
  const course = courses.find(c => c.id === code)?.title || folder.replace(/^\d+\s+/, '');
  const date = validDate(frontmatter.date) || validDate(file.basename.match(/^(\d{4}-\d{2}-\d{2})/)?.[1]);
  const body = noteBody(text);
  const excerpt = body.replace(/<!--[^]*?-->/g,'').replace(/^#+\s.*$/gm,'')
    .replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g,'')
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g,(_,target,label)=>label||target)
    .replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*`>#]/g,'').replace(/\s+/g,' ').trim().slice(0,140);
  return {file, path:file.path, title:file.basename, code, course, date, body, excerpt,
    search:`${file.basename} ${course} ${code} ${body}`.toLocaleLowerCase()};
}
function filterSummaries(entries, {query='', course='', date=''} = {}) {
  const q = query.trim().toLocaleLowerCase();
  return entries.filter(e => (!course || e.code === course) && (!date || e.date === date) && (!q || e.search.includes(q)))
    .sort((a,b) => b.date.localeCompare(a.date) || a.course.localeCompare(b.course,'zh-CN') || a.path.localeCompare(b.path));
}
module.exports = {isSummaryNote, validDate, noteBody, summaryEntry, filterSummaries};
