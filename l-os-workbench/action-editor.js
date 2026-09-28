"use strict";
const {el: node}=require('../shared/dom');
function plainTitle(text){return String(text||'').replace(/(?:📅\s*|due::\s*)\d{4}-\d{2}-\d{2}/g,'').trim();}

/**
 * 任务「补充详情」表单。
 *
 * 5.2 之前这是插在任务行里的行内展开，一展开就把整行撑高，列表被迫滚动。
 * 现在只负责往给定容器里渲染，由 DetailModal 放进弹窗；自动保存、草稿保留、
 * 冲突重载的语义保持不变（view.flushEdits / refresh 仍依赖 open / pending / flush）。
 */
class ActionEditor {
  constructor(view,container,task) {
    this.view=view;this.task=task;this.queue=Promise.resolve();this.fields={};this.open=true;this.pending=false;
    this.root=node(container,'div','os-detail-form');

    // 两列网格：标题与详细说明占满整行，其余四项两两并排，整体一屏可见。
    const grid=node(this.root,'div','os-detail-grid');
    const definitions=[
      ['title','任务标题','text',plainTitle(task.text),true],
      ['next_action','下一步','text',task.next_action||'',false],
      ['project','所属项目','text',task.project||'',false],
      ['due','截止日期','date',task.due||'',false],
      ['estimated_pomodoros','预计番茄数','number',task.estimated_pomodoros??'',false],
      ['details','详细说明','textarea',task.details||'',true],
    ];
    for(const [key,label,type,value,wide] of definitions){
      const wrap=node(grid,'label',`os-editor-field${wide?' is-wide':''}`);node(wrap,'span','',label);
      const field=node(wrap,type==='textarea'?'textarea':'input','os-input');if(type!=='textarea')field.type=type;else field.rows=3;
      field.value=value;field.setAttribute('aria-label',label);if(type==='number'){field.min='1';field.max='99';}
      this.fields[key]=field;
      field.addEventListener('input',()=>{this.status.textContent='待保存';});
      field.addEventListener('change',()=>this.flush().catch(()=>{}));
      field.addEventListener('keydown',e=>{if(e.isComposing)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();field.value=this.saved[key];}if(e.key==='Enter'&&(type!=='textarea'||e.ctrlKey||e.metaKey)){e.preventDefault();this.flush().catch(()=>{});}});
    }

    const checklist=task.checklist||[];
    if(checklist.length){
      const section=node(this.root,'section','os-detail-checklist');
      node(section,'h3','','子任务');
      const list=node(section,'div','os-detail-list');
      for(const [i,item] of checklist.entries()){
        const label=node(list,'label','os-detail-check');const check=node(label,'input');check.type='checkbox';check.checked=item.done;node(label,'span','',item.text);
        check.onchange=async()=>{check.disabled=true;try{const next=task.checklist.map((x,j)=>j===i?{...x,done:check.checked}:x);Object.assign(task,await view.owner('l-os-capture').patchTask(task,{checklist:next}));this.status.textContent='已保存到任务来源';}catch(e){check.checked=!check.checked;this.status.textContent='未保存：'+e.message;}finally{check.disabled=false;}};
      }
    }

    if(task.outcome||task.references){
      const notes=node(this.root,'div','os-detail-notes');
      if(task.outcome)node(notes,'p','','完成标准：'+task.outcome);
      if(task.references)node(notes,'p','','参考：'+task.references);
    }

    this.saved=this.values();
    const actions=node(this.root,'div','os-detail-actions');
    this.status=node(actions,'span','os-save-state','修改后自动保存');this.status.setAttribute('role','status');
    const complete=node(actions,'button','os-button os-quiet','完整编辑');complete.type='button';
    complete.onclick=async()=>{await this.flush();view.owner('l-os-capture').captureTask({task});};
    const retry=node(actions,'button','os-button os-quiet','重试保存');retry.type='button';retry.onclick=()=>this.flush().catch(()=>{});
    const reload=node(actions,'button','os-button os-quiet','载入最新基线');reload.type='button';
    reload.title='保留输入草稿，重新读取任务后可重试合并';
    reload.onclick=async()=>{
      try{const all=await view.owner('l-os-capture').index.all();const current=all.find(t=>task.id?t.id===task.id:t.path===task.path&&t.index===task.index);if(!current||current.deleted)throw Error('任务已删除');Object.assign(task,current);this.status.textContent='已载入最新版本；检查草稿后重试保存';}catch(e){this.status.textContent=e.message;}
    };
    this.actions=actions;
  }
  focus(){this.fields.next_action?.focus();}
  values(){return Object.fromEntries(Object.entries(this.fields).map(([key,e])=>[key,e.value]));}
  flush(){
    const run=this.queue.then(async()=>{
      const values=this.values(),patch={};
      for(const key of Object.keys(values))if(values[key]!==this.saved[key])patch[key]=values[key];
      if(!Object.keys(patch).length)return;
      if(Object.hasOwn(patch,'estimated_pomodoros')){patch.estimated_pomodoros=patch.estimated_pomodoros===''?null:Number(patch.estimated_pomodoros);if(!this.task.budget_unit_minutes)patch.budget_unit_minutes=this.view.owner('l-os-focus')?.settings?.().focusMinutes||25;}
      this.pending=true;this.status.textContent='保存中…';
      try{
        const task=await this.view.owner('l-os-capture').patchTask(this.task,patch);Object.assign(this.task,task);this.saved=values;
        this.status.textContent=JSON.stringify(this.values())===JSON.stringify(values)?'已保存到任务来源':'待保存';this.view.paintTask?.(this.task);this.view.paintFocus?.();
      }catch(e){this.status.textContent='未保存：'+e.message;throw e;}finally{this.pending=false;}
    });this.queue=run.catch(()=>{});return run;
  }
}
module.exports={ActionEditor,plainTitle};
