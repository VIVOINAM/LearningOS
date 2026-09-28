"use strict";
const {el,btn:domBtn}=require('../shared/dom');
const {Notice}=require('obsidian');
const M=require('./own-books-model');
const btn=(parent,label,action,cls='')=>domBtn(parent,label,action,`os-button ${cls}`,error=>new Notice(error.message||String(error)));

// 登记表不存在时建一份最小的。字段写全，下一本照着抄就行。
const TEMPLATE=`---
type: own-books
---
# 自编教材

<div class="cw-return-home"><a href="#l-os-workbench-home">⌂ 返回工作台首页</a></div>

工作台「自编教材」页读的就是这一篇。二级标题是系列，三级标题是一本书；系列下、第一本书之前的字段是整个系列的缺省值。
字段：状态（计划中 / 编写中 / 暂停 / 已完成）、PDF、源目录、计划、进度（如 3/7 篇）、页数（如 120/200）、下一步、截止、更新、说明。
没写的状态、下一步、截止跟着「计划」那篇项目笔记走。

## 未分组

### 新书名
- 状态：计划中
- 计划：
- 进度：0/1 章
`;

function resolver(app,files){
  const paths=new Set(files.map(f=>f.path));
  return link=>{
    if(!link)return '';
    const hit=app.metadataCache?.getFirstLinkpathDest?.(link,M.REGISTRY);
    if(hit?.path)return hit.path;
    for(const p of [link,link+'.md',link+'.pdf'])if(paths.has(p))return p;
    // Obsidian 的链接可以只写文件名：同名文件只有一个时认它。
    const name=link.split('/').pop();
    const same=files.filter(f=>f.basename===name||f.path.split('/').pop()===name);
    return same.length===1?same[0].path:'';
  };
}

async function readShelf(view){
  const app=view.plugin.app,files=view.snapshot.files||[];
  const registry=files.find(f=>f.path===M.REGISTRY);
  const text=registry?await app.vault.cachedRead(registry).catch(()=>''):'';
  const plan=path=>{const file=files.find(f=>f.path===path);return file?app.metadataCache?.getFileCache?.(file)?.frontmatter||null:null;};
  return {registry,groups:M.buildShelf({series:M.parseRegistry(text),pdfs:files.filter(f=>f.extension==='pdf').map(f=>f.path),resolve:resolver(app,files),plan})};
}

const STATUS_CLASS={'编写中':'is-warm','暂停':'is-alert','计划中':''};

function bookRow(view,parent,book){
  const p=view.plugin,files=view.snapshot.files||[];
  const row=el(parent,'article','os-own-book');row.dataset.status=book.status;
  const main=el(row,'div','os-row-main');
  el(main,'strong','os-own-book-title',book.title);
  const meta=el(main,'div','os-row-meta');
  el(meta,'span',`os-chip ${STATUS_CLASS[book.status]??''}`.trim(),book.status||'未填状态');
  if(book.progress?.total)el(meta,'span','os-chip',`${book.progress.done}/${book.progress.total}${book.progress.unit?' '+book.progress.unit:''}`);
  if(book.pages?.done)el(meta,'span','os-chip',book.pages.total?`${book.pages.done} / ${book.pages.total} 页`:`${book.pages.done} 页`);
  if(book.due)el(meta,'span','os-chip is-warm','截止 '+book.due);
  if(book.updated)el(meta,'span','os-own-book-date','更新 '+book.updated);
  if(book.next)el(main,'p','os-own-book-next','下一步：'+book.next);
  if(book.note)el(main,'p','os-muted',book.note);
  if(book.missingPdf)el(main,'p','os-own-book-warn','登记的 PDF 在库里找不到：'+book.pdf);
  // 进度条只在知道完成度时画——没填进度的在写的书，画一根空条是在编数字。
  if(book.done!==null&&book.done!==undefined&&book.status!=='已完成'){
    const track=el(main,'div','os-read-track');const fill=el(track,'span','os-read-fill');
    fill.style.width=`${(book.done*100).toFixed(1)}%`;
    track.setAttribute('role','progressbar');track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');
    track.setAttribute('aria-valuenow',String(Math.round(book.done*100)));track.setAttribute('aria-label',`${book.title} 编写进度 ${Math.round(book.done*100)}%`);
  }
  const actions=el(row,'div','os-own-book-actions');
  const pdf=book.pdf&&files.find(f=>f.path===book.pdf);
  if(pdf)btn(actions,'阅读',()=>p.openTextbook(pdf),'os-quiet');
  if(book.planPath)btn(actions,'编写计划',()=>p.open(book.planPath),'os-quiet');
  // l-os-study 给每本 PDF 建的学习笔记，路径是固定规则：教材笔记/<PDF 路径去掉 .pdf>.md。
  const notes=pdf&&`03 知识库/教材笔记/${pdf.path.replace(/\.pdf$/i,'')}.md`;
  if(notes&&files.some(f=>f.path===notes))btn(actions,'学习笔记',()=>p.open(notes),'os-quiet');
}

async function renderOwnBooks(view){
  const request=view.generation;
  const {registry,groups}=await readShelf(view);
  if(request!==view.generation||view.closed)return;
  view.pageStatusEl.textContent=M.shelfSummary(groups);
  const panel=view.panel(view.content,'自编教材','登记表 · 04 创作/自编教材.md','os-fill');
  const openRegistry=async()=>{const file=await view.plugin.ensure(M.REGISTRY,TEMPLATE);await view.plugin.open(file.path);};
  btn(panel.tools,registry?'编辑登记表':'新建登记表',openRegistry,'os-quiet');
  if(!groups.some(g=>g.books.length)){
    view.empty(panel.body,'还没有登记自编教材','在登记表里按「系列 → 书」写下书名、状态、PDF 和编写计划；book/ 里的 PDF 也会自动出现在这里。');
    return;
  }
  for(const group of groups){
    if(!group.books.length)continue;
    const section=el(panel.body,'section','os-own-series');section.setAttribute('aria-label',group.name);
    const head=el(section,'header','os-own-series-head');
    el(head,'h3','',group.name);
    const done=group.books.filter(b=>b.status==='已完成').length;
    el(head,'span','os-muted',group.stray?`book/ 里有、登记表里没有的 ${group.books.length} 份 PDF`:`${group.books.length} 本 · ${done} 本完成`);
    if(group.next)el(section,'p','os-own-book-next os-own-series-next','系列下一步：'+group.next);
    if(group.note)el(section,'p','os-muted os-own-series-note',group.note);
    for(const book of group.books)bookRow(view,section,book);
  }
}

module.exports={renderOwnBooks,readShelf,TEMPLATE};
