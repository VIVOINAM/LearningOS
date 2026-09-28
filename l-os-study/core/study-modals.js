"use strict";

// L-OS 3.0 - study capture/edit modals.
const { Modal, Notice } = require("obsidian");
const { el, button, studyCategoryPicker } = require("./study-ui.js");
const { renderMarkdown, markdownOwner } = require("./markdown-render.js");
const { toObsidianMarkdown, hasMath, changesOnPaste } = require("./formula-model.js");
const { STUDY_COLORS, studyColor, parseStudyTags, parseStudyLinks } = require("./study-model.js");

class AnnotationCapture extends Modal {
  constructor(plugin, title, annotation, action) { super(plugin.app); this.plugin=plugin; this.title=title; this.annotation=annotation||{}; this.action=action; }
  onOpen() {
    const root=this.contentEl;root.classList.add('cw-capture-modal','cw-annotation-modal');
    const header=el(root,'header','cw-annotation-header');el(header,'h2','',this.title);
    const headerActions=el(header,'div','cw-annotation-header-actions');
    if(this.annotation.copyReference)button(headerActions,'复制引用',this.annotation.copyReference,'cw-link');
    const layout=el(root,'div','cw-annotation-layout');
    const quote=el(layout,'aside','cw-annotation-quote');el(quote,'div','cw-study-field-title',this.annotation.previewUrl||this.annotation.imagePath?'公式区域预览':'原文引用');
    if(this.annotation.previewUrl){const image=el(quote,'img','cw-annotation-preview-image');image.src=this.annotation.previewUrl;image.alt='刚截取的公式区域';}
    else el(quote,'blockquote','',this.annotation.text|| (this.annotation.imagePath?'公式截图':'未选择原文'));
    const form=el(layout,'div','cw-annotation-form');
    const noteLabel=el(form,'label','cw-study-field','批注 / 理解 / 疑问');
    const note=el(noteLabel,'textarea','cw-capture');note.rows=5;note.placeholder='写下你的理解或疑问；粘贴的 \\( \\) 与 \\[ \\] 会自动换成公式写法';note.value=this.annotation.note||'';note.setAttribute('aria-label','批注内容');
    // 5.6.2 之前这里另有一个「LaTeX 公式」字段（输入框 + 符号按钮 + 预览），
    // 和批注框做同一件事，写哪个都对不上。现在只剩批注框，预览只在真有公式时出现。
    const preview=el(noteLabel,'div','cw-latex-preview');preview.setAttribute('aria-live','polite');
    this.owner=markdownOwner();
    const sourcePath=this.plugin.app.workspace.getActiveFile?.()?.path||'';
    const updatePreview=()=>{
      const markdown=toObsidianMarkdown(note.value);
      preview.hidden=!hasMath(markdown);
      if(!preview.hidden)renderMarkdown(this.plugin.app,this.owner,preview,markdown,sourcePath);
    };
    note.addEventListener('input',()=>{clearTimeout(this.previewTimer);this.previewTimer=setTimeout(updatePreview,220);});
    // 只在真翻译了定界符时接管粘贴，否则输入法和撤销栈交回给浏览器。
    note.addEventListener('paste',event=>{
      const text=event.clipboardData?.getData('text/plain');
      if(!text||!changesOnPaste(text))return;
      event.preventDefault();
      note.setRangeText(toObsidianMarkdown(text),note.selectionStart||0,note.selectionEnd||0,'end');
      updatePreview();
    });
    updatePreview();
    const options=el(form,'div','cw-annotation-options');
    const colorField=el(options,'fieldset','cw-color-field');el(colorField,'legend','', '高亮颜色');
    const palette=el(colorField,'div','cw-color-palette');let colorValue=studyColor(this.annotation.color);
    for(const [value,label] of Object.entries(STUDY_COLORS)){const swatch=button(palette,'',()=>selectColor(value),'cw-color-swatch');swatch.dataset.color=value;swatch.title=label;swatch.setAttribute('aria-label',label);}
    const selectColor=value=>{colorValue=studyColor(value);for(const item of palette.children)item.setAttribute('aria-pressed',String(item.dataset.color===colorValue));};selectColor(colorValue);
    const tagsLabel=el(options,'label','cw-study-field','自定义标签（回车创建）');const tags=el(tagsLabel,'input','');tags.placeholder='例如：期中、第二章';tags.value=(this.annotation.tags||[]).join('，');tags.setAttribute('aria-label','自定义标签');
    const suggestions=el(tagsLabel,'div','cw-tag-suggestions');const savedTags=this.plugin.data.study.customTags||[];
    const renderTags=()=>{suggestions.replaceChildren();for(const tag of savedTags)button(suggestions,tag,()=>{const values=parseStudyTags(tags.value);if(!values.includes(tag))tags.value=[...values,tag].join('，');},'cw-tag-pill');};renderTags();
    tags.addEventListener('keydown',event=>{if(event.key!=='Enter'||event.isComposing)return;event.preventDefault();const values=parseStudyTags(tags.value);for(const tag of values)if(!savedTags.includes(tag))savedTags.push(tag);this.plugin.data.study.customTags=savedTags.slice(0,40);void this.plugin.save();renderTags();});
    const readCategories=studyCategoryPicker(form,this.annotation.categories||[]);
    const linksLabel=el(form,'label','cw-study-field','关联页码');const links=el(linksLabel,'input','');links.placeholder='例如：12:定理1.2；34:例题1.5';links.value=(this.annotation.links||[]).map(link=>link.label?`${link.page}:${link.label}`:link.page).join('；');links.setAttribute('aria-label','关联页码');
    const actions=el(form,'div','cw-modal-actions');
    const save=button(actions,'保存到侧栏',async()=>{if(!note.value.trim()&&!this.annotation.text&&this.annotation.kind!=='crop'&&!this.annotation.imagePath){new Notice('请先输入内容。');note.focus();return;}save.disabled=true;try{const parsedTags=parseStudyTags(tags.value);for(const tag of parsedTags)if(!savedTags.includes(tag))savedTags.push(tag);this.plugin.data.study.customTags=savedTags.slice(0,40);await this.action({note:toObsidianMarkdown(note.value),color:colorValue,tags:parsedTags,categories:readCategories(),links:parseStudyLinks(links.value)});this.close();}finally{save.disabled=false;}},'cw-primary');
    button(actions,'取消',()=>this.close(),'cw-link');
    note.addEventListener('keydown',event=>{if(!event.isComposing&&event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();save.click();}});note.focus();
  }
  onClose() { clearTimeout(this.previewTimer);this.owner?.unload();if(this.annotation.revokePreview&&this.annotation.previewUrl)URL.revokeObjectURL(this.annotation.previewUrl);this.contentEl.empty(); }
}
class StudyGoalModal extends Modal {
  constructor(plugin, study) { super(plugin.app); this.study=study; }
  onOpen() {
    const root=this.contentEl;root.classList.add('cw-capture-modal','cw-study-goal-modal');
    el(root,'h2','','设置今日学习目标');el(root,'p','cw-muted','目标按当天累计学习分钟和阅读过的不同页数统计。');
    const fields=el(root,'div','cw-goal-fields');
    const minutesLabel=el(fields,'label','cw-study-option','专注分钟');const minutes=el(minutesLabel,'input','');minutes.type='number';minutes.min='1';minutes.max='1440';minutes.value=this.study.data.goal.minutes;minutes.setAttribute('aria-label','今日专注分钟目标');
    const pagesLabel=el(fields,'label','cw-study-option','阅读页数（0 表示不设目标）');const pages=el(pagesLabel,'input','');pages.type='number';pages.min='0';pages.max='1000';pages.value=this.study.data.goal.pages;pages.setAttribute('aria-label','今日阅读页数目标');
    const actions=el(root,'div','cw-modal-actions');
    const save=button(actions,'保存',async()=>{save.disabled=true;try{await this.study.setGoal(minutes.value,pages.value);this.close();}finally{save.disabled=false;}},'cw-primary');
    button(actions,'取消',()=>this.close(),'cw-link');minutes.focus();
  }
  onClose() { this.contentEl.empty(); }
}

module.exports = { AnnotationCapture, StudyGoalModal };
