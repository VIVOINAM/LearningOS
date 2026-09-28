"use strict";
const {Modal,Notice}=require('obsidian');
class ReadingFlow {
  constructor(plugin){this.p=plugin;this.context=null;this.pending=null;this.disposed=false;}
  async opened(file) {
    if(this.disposed||this.pending)return;
    const focus=this.p.app.plugins.getPlugin('l-os-focus');
    if(!focus?.dispatch)return;
    const leaf=this.p.app.workspace.getLeavesOfType('pdf').find(l=>l===this.p.app.workspace.activeLeaf&&l.view?.file===file)
      ||this.p.app.workspace.getLeavesOfType('pdf').find(l=>l.view?.file?.path===file.path);
    if(!leaf)return;
    await focus.dispatch('read',{task:`阅读：${file.basename||file.path}`,auto:true});
    const timer=focus.state();
    if(timer.phase==='focus'&&timer.status!=='idle')this.context={leaf,file,id:timer.id,taskId:timer.taskId,task:timer.task};
  }
  finished(session) {
    const context=this.context;
    if(this.disposed||!context||session.id!==context.id)return;
    this.context=null;
    const current=this.p.app.plugins.getPlugin('l-os-focus')?.state?.();
    if(current?.status&&current.status!=='idle')return;
    if(!session.completed||session.phase!=='focus'||!this.alive(context))return;
    this.pending=context;
    const modal=new Modal(this.p.app);this.modal=modal;
    modal.onOpen=()=>{
      const root=modal.contentEl;root.addClass('cw-completion-modal');
      root.createEl('h2',{text:'本轮专注已完成'});
      root.createEl('p',{text:'继续阅读，或保存当前位置并回到今日概览休息。'});
      const next=root.createEl('button',{text:'继续专注'}), rest=root.createEl('button',{text:'休息'});
      const run=async action=>{
        if(next.disabled)return;next.disabled=rest.disabled=true;
        try {await this.choose(action);modal.close();}catch(e){new Notice(e.message);next.disabled=rest.disabled=false;}
      };
      next.onclick=()=>run('continue');rest.onclick=()=>run('rest');next.focus();
    };
    // Escape dismisses the choice without closing a reader or starting a timer.
    modal.onClose=()=>{if(this.modal===modal){this.modal=null;this.pending=null;}};
    modal.open();
  }
  /**
   * 状态栏「继续专注」走的那条路。
   *
   * 完成弹窗还开着时走它自己的「继续专注」——opened 在 pending 期间直接返回，
   * 不转一下这个按钮就是个按了没反应的死按钮。
   * 否则交给 opened：它会开一段专注（phase 一定是 focus，不会开成休息），
   * 顺手把完成弹窗的上下文重新挂上，下一段跑完照样问你继续还是休息。
   */
  async resume(file) {
    if(this.pending){await this.choose('continue');this.modal?.close();return;}
    await this.opened(file);
  }
  alive(ctx){return this.p.app.workspace.getLeavesOfType('pdf').includes(ctx.leaf)&&ctx.leaf.view?.file===ctx.file;}
  async choose(action) {
    const ctx=this.pending;if(!ctx||this.disposed)return;
    const focus=this.p.focusOwner();
    if(action==='continue'){
      if(!this.alive(ctx))throw Error('原阅读面板已关闭，请重新打开教材');
      await focus.dispatch('read',{task:ctx.task||`阅读：${ctx.file.basename||ctx.file.path}`,taskId:ctx.taskId||'',auto:false});
      this.context={...ctx,id:focus.state().id};
      await this.p.app.workspace.revealLeaf(ctx.leaf);
    } else if(action==='rest') {
      if(this.alive(ctx))await this.p.study?.checkpoint(ctx.leaf);
      // Navigate first: a failed view activation must not destroy the reader.
      await this.p.activate();
      for(const view of this.p.views)await view.setTab('today');
      if(this.alive(ctx))ctx.leaf.detach();
    }else throw Error('无效的专注选择');
    this.pending=null;
  }
  dismiss(){this.context=null;this.pending=null;this.modal?.close();}
  dispose(){this.disposed=true;this.dismiss();}
}
module.exports={ReadingFlow};
