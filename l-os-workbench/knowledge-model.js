"use strict";
const {isSummaryNote, summaryEntry, validDate} = require('./summary-notes');
const {cardReview} = require('../l-os-study/core/study-model');
const {makeKey} = require('../l-os-recall/core/keys');

const TYPES = {class:'课堂笔记', note:'其他笔记', card:'教材卡片', question:'教材疑问'};
function isKnowledgeFile(file) {
  return file.extension === 'md' && !/^(\.|00 工作台\/|05 日记\/|07 归档\/|08 插件开发\/|99 模板\/|版本管理\/)/.test(file.path)
    && !file.path.split('/').some(part => ['_assets','附件'].includes(part));
}
const cleanLink = value => String(value || '').replace(/^\[\[|\]\]$/g,'').split('|')[0].split('#')[0].trim();
function referencePaths(task, resolve) {
  const raw = String(task.references || '');
  const links = [...raw.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1]);
  const plain = raw.replace(/\[\[[^\]]+\]\]/g,'').split(/\r?\n|;/);
  return [...links,...plain].map(cleanLink).filter(Boolean).map(p => resolve?.(p,task.path) || p);
}
function knowledgeEntries({files=[], metadata=()=>({}), courses=[], booksFor=()=>[], tasks=[], records={}, cards=[], resolve, now=Date.now()}={}) {
  const queue = new Map(cards.map(c => [c.key || c.path,c]));
  const books = new Map(courses.map(c => [String(c.id),booksFor(c) || []]));
  const references = tasks.filter(t => !t.deleted).map(task => ({task,paths:referencePaths(task,resolve)}));
  const entries = [];
  for (const file of files.filter(isKnowledgeFile)) {
    const fm = metadata(file) || {};
    if (['task','project','timetable','course'].includes(fm.type) || /(?:课堂笔记索引|真题索引|导航)$/.test(file.basename)) continue;
    const summary = isSummaryNote(file) ? summaryEntry(file,fm,'',courses) : null;
    const rawCourse = cleanLink(fm.course);
    const found = courses.find(c => String(c.id) === rawCourse || c.title === rawCourse || rawCourse.split('/').pop()?.startsWith(c.id+' '));
    const courseId = summary?.code || String(found?.id || (fm.type === 'class-note' ? rawCourse : ''));
    const course = courses.find(c => String(c.id) === courseId);
    const type = summary || fm.type === 'class-note' ? 'class' : 'note';
    const date = summary?.date || validDate(fm.date);
    const linked = references.filter(({task,paths}) => task.path === file.path || paths.includes(file.path)
      || type === 'class' && date && courseId && String(task.tags || '').split(/[\s,]+/).some(t => t.replace(/^#/,'') === `课堂笔记/${date}/${courseId}`)).map(x => x.task);
    entries.push({key:file.path,path:file.path,file,title:file.basename,type,date,courseIds:courseId?[courseId]:[],
      course:course?.title || summary?.course || fm.course_title || '',summary:!!summary,tasks:linked,
      books:books.get(courseId) || [],status:fm.status || '',updatedAt:file.stat?.mtime || 0,
      search:`${file.path} ${fm.tags || ''} ${fm.course_title || ''} ${date} ${courseId} ${course?.title || summary?.course || ''}`});
  }
  const existing = new Set(files.map(f => f.path));
  for (const [path,record] of Object.entries(records)) {
    if (!existing.has(path)) continue;
    const related = courses.filter(c => books.get(String(c.id))?.includes(path));
    for (const annotation of record.annotations || []) {
      if (!annotation.id) continue;
      let key; try { key=makeKey(path,annotation.id); } catch { continue; }
      const card = cardReview(annotation,path);
      entries.push({key,path,cardId:annotation.id,title:card.title,type:annotation.kind==='question'?'question':'card',
        courseIds:related.map(c=>String(c.id)),course:related.map(c=>c.title).join(' / '),date:'',tasks:[],books:[],
        body:card.body,resolved:card.resolved,page:card.page,updatedAt:annotation.updatedAt || record.updatedAt || 0,
        search:`${card.title} ${card.body} ${annotation.tags || ''} ${related.map(c=>c.id+' '+c.title).join(' ')}`});
    }
  }
  return entries.map(entry => {
    const review = queue.get(entry.key);
    return {...entry,review,reviewState:review?(review.due<=now?'due':'scheduled'):'new',search:entry.search.toLocaleLowerCase()};
  }).sort((a,b) => b.updatedAt-a.updatedAt || a.key.localeCompare(b.key));
}
function filterKnowledge(entries,{query='',course='',type='',review=''}={}) {
  const q=query.trim().toLocaleLowerCase();
  return entries.filter(e => (!q || e.search.includes(q)) && (!course || e.courseIds.includes(course))
    && (!type || e.type===type) && (!review || e.reviewState===review));
}
module.exports={TYPES,isKnowledgeFile,knowledgeEntries,filterKnowledge};
