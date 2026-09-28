const {validRect}=require('./storage-manager.ts');
const {revealRegion}=require('./pdf-overlay.ts');
function installNavigation(plugin:any) {
  const app=plugin.app;
  const open=async(path:string,page:number,rect:any)=>{
    const file=app.vault.getAbstractFileByPath(path);if(file?.extension!=='pdf')return;
    let ctx=[...plugin.engine.contexts.values()].find((c:any)=>c.path===path&&!c.closed) as any;
    if(!ctx){await app.workspace.openLinkText(path,'',false);ctx=await plugin.engine.attachFile(file);}
    if(ctx){await app.workspace.revealLeaf(ctx.leaf);const annotation=plugin.engine.record(path).annotations.find((a:any)=>a.page===page&&a.rects?.some((r:any)=>Math.abs(r.x-rect.x)<.002&&Math.abs(r.y-rect.y)<.002));if(annotation)await plugin.engine.reveal(ctx,annotation);else await revealRegion(ctx,page,rect);}
  };
  const click=(event:MouseEvent)=>{
    if(event.button!==0||event.ctrlKey||event.metaKey)return;
    const target=event.target as Element;if(!target?.closest)return;
    const imageEmbed=target.closest('.internal-embed');
    const adjacent=imageEmbed?.nextElementSibling;
    const anchor=target.closest('a.internal-link')||(adjacent?.matches('a.internal-link')?adjacent:null);
    const href=anchor?.getAttribute('data-href')||anchor?.getAttribute('href')||'';
    if(href.includes('&studyRect=')) {
      const [path,fragment]=href.split('#'),params=new URLSearchParams(fragment);
      const parts=(params.get('studyRect')||'').split(',').map(Number),page=Number(params.get('page'));
      try {
        if(parts.length!==4||!Number.isInteger(page)||page<1)return;
        const rect=validRect({x:parts[0],y:parts[1],w:parts[2],h:parts[3]});
        const source=app.workspace.getActiveFile()?.path||'';
        const file=app.metadataCache.getFirstLinkpathDest(path,source)||app.vault.getAbstractFileByPath(path);
        if(!file)return;event.preventDefault();event.stopImmediatePropagation();void open(file.path,page,rect).catch(plugin.engine.report);
      }catch{return;}
    }else {
      const embed=target.closest('.internal-embed');const src=embed?.getAttribute('src')||'';
      if(!src)return;
      const file=app.metadataCache.getFirstLinkpathDest(src,app.workspace.getActiveFile()?.path||'')||app.vault.getAbstractFileByPath(src);
      if(!file)return;
      for(const [path,record] of Object.entries(plugin.engine.data.records) as [string,any][]){
        const a=record.annotations.find((a:any)=>a.imagePath===file.path);
        if(a?.rects?.[0]){event.preventDefault();event.stopImmediatePropagation();void open(path,a.page,a.rects[0]).catch(plugin.engine.report);return;}
      }
    }
  };
  const docs=new Set<Document>();
  const bind=(doc:Document)=>{if(docs.has(doc))return;docs.add(doc);plugin.registerDomEvent(doc,'click',click,true);};
  bind(document);
  plugin.registerEvent(app.workspace.on('window-open',(_leaf:any,win:any)=>bind(win.document)));
  plugin.addCommand({id:'capture-pdf-region',name:'框选 PDF 公式（再次执行取消）',callback:()=>{
    const ctx=plugin.engine.contexts.get(app.workspace.activeLeaf);if(ctx)ctx.overlay.toggle();
  }});
}
module.exports={installNavigation};
