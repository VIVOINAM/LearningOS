"use strict";
const {Modal,Notice}=require('obsidian');
const {ActionEditor,plainTitle}=require('./action-editor');
const {el: node}=require('../shared/dom');

/**
 * 「补充详情」弹窗。
 *
 * 行内展开会把任务行撑高，一条任务展开后整张列表就得滚动。放进限高弹窗后，
 * 六个字段一屏可见，只有子任务多到放不下时才在自己的区域内滚。
 *
 * 关闭时统一结算：退出编辑集合 → flush 未保存的改动 → 刷新视图。
 */
class DetailModal extends Modal {
  constructor(view,task){super(view.plugin.app);this.view=view;this.task=task;}
  onOpen(){
    const root=this.contentEl;root.replaceChildren();root.classList.add('os-detail-modal');
    const head=node(root,'div','os-detail-head');
    node(head,'h2','','补充详情');
    node(head,'p','os-detail-source',[plainTitle(this.task.text),this.task.path].filter(Boolean).join(' · '));
    this.editor=new ActionEditor(this.view,root,this.task);
    this.view.editors.add(this.editor);
    const done=node(this.editor.actions,'button','mod-cta','完成');done.type='button';
    done.onclick=()=>this.close();
    this.editor.focus();
  }
  onClose(){
    const editor=this.editor;this.editor=null;
    if(!editor){this.contentEl.empty();return;}
    editor.open=false;this.view.editors.delete(editor);
    Promise.resolve(editor.flush())
      .catch(error=>{new Notice('详情未保存：'+(error?.message||error));})
      .then(()=>{this.contentEl.empty();return this.view.refresh(true);})
      .catch(console.error);
  }
}
module.exports={DetailModal};
