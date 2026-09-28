const {Notice}=require('obsidian');
const {el,button}=require('./study-ui.js');
const {AnnotationCapture}=require('./study-modals.js');
const {STUDY_COLORS,studyColor}=require('./study-model.js');
const {reference,validRect}=require('./storage-manager.ts');
type Rect={x:number;y:number;w:number;h:number};

function detectEnclosingFrame(canvas:HTMLCanvasElement,point:{x:number;y:number},bounds:DOMRect):Rect|null {
  if(!canvas.width||!canvas.height||!bounds.width||!bounds.height)return null;
  const px=Math.max(0,Math.min(canvas.width-1,Math.round((point.x-bounds.left)/bounds.width*canvas.width)));
  const py=Math.max(0,Math.min(canvas.height-1,Math.round((point.y-bounds.top)/bounds.height*canvas.height)));
  let image:ImageData;try{image=canvas.getContext('2d',{willReadFrequently:true})!.getImageData(0,0,canvas.width,canvas.height);}catch{return null;}
  const {data,width,height}=image,minWidth=Math.max(80,Math.round(width*.2)),gapLimit=Math.max(2,Math.round(width/900));
  const ink=(x:number,y:number)=>{if(x<0||x>=width||y<0||y>=height)return false;const i=(y*width+x)*4,r=data[i],g=data[i+1],b=data[i+2],a=data[i+3];return a>30&&(Math.min(r,g,b)<225||Math.max(r,g,b)-Math.min(r,g,b)>16);};
  const runs=(y:number)=>{const found:{y:number;left:number;right:number}[]=[];let start=-1,last=-1,gap=0;for(let x=0;x<width;x++){if(ink(x,y)){if(start<0)start=x;last=x;gap=0;}else if(start>=0&&++gap>gapLimit){if(last-start+1>=minWidth&&start<=px&&last>=px)found.push({y,left:start,right:last});start=-1;last=-1;gap=0;}}if(start>=0&&last-start+1>=minWidth&&start<=px&&last>=px)found.push({y,left:start,right:last});return found;};
  const collect=(from:number,to:number,step:number)=>{const list:{y:number;left:number;right:number}[]=[];for(let y=from;step<0?y>=to:y<=to;y+=step){for(const run of runs(y)){const prior=list.at(-1);if(prior&&Math.abs(prior.y-y)<=3&&Math.abs(prior.left-run.left)<6&&Math.abs(prior.right-run.right)<6)continue;list.push(run);if(list.length>=30)return list;}}return list;};
  const above=collect(py-1,0,-1),below=collect(py+1,height-1,1),verticalCoverage=(x:number,top:number,bottom:number)=>{let hits=0,total=Math.max(1,bottom-top+1);for(let y=top;y<=bottom;y++)if(ink(x,y)||ink(x-1,y)||ink(x+1,y)||ink(x-2,y)||ink(x+2,y))hits++;return hits/total;},bestVertical=(center:number,top:number,bottom:number,search:number)=>{let best={x:center,coverage:0};for(let x=Math.max(0,center-search);x<=Math.min(width-1,center+search);x++){const coverage=verticalCoverage(x,top,bottom);if(coverage>best.coverage)best={x,coverage};}return best;};
  for(const top of above)for(const bottom of below){const span=Math.max(top.right-top.left,bottom.right-bottom.left),tolerance=Math.max(8,span*.035);if(bottom.y-top.y<12||Math.abs(top.left-bottom.left)>tolerance||Math.abs(top.right-bottom.right)>tolerance)continue;const leftHint=Math.round((top.left+bottom.left)/2),rightHint=Math.round((top.right+bottom.right)/2),search=Math.min(18,Math.round(tolerance));const leftEdge=bestVertical(leftHint,top.y,bottom.y,search),rightEdge=bestVertical(rightHint,top.y,bottom.y,search);if(leftEdge.coverage<.5||rightEdge.coverage<.5||rightEdge.x-leftEdge.x<minWidth)continue;const left=leftEdge.x,right=rightEdge.x,pad=2;return {x:Math.max(0,left-pad)/width,y:Math.max(0,top.y-pad)/height,w:Math.min(width-1,right+pad)/width-Math.max(0,left-pad)/width,h:Math.min(height-1,bottom.y+pad)/height-Math.max(0,top.y-pad)/height};}
  return null;
}

function localRect(a:{x:number;y:number},b:{x:number;y:number},bounds:DOMRect):Rect {
  const clamp=(n:number)=>Math.max(0,Math.min(1,n));
  const x1=clamp((a.x-bounds.left)/bounds.width),y1=clamp((a.y-bounds.top)/bounds.height);
  const x2=clamp((b.x-bounds.left)/bounds.width),y2=clamp((b.y-bounds.top)/bounds.height);
  return {x:Math.min(x1,x2),y:Math.min(y1,y2),w:Math.abs(x1-x2),h:Math.abs(y1-y2)};
}
async function cropCanvas(canvas:HTMLCanvasElement,r:Rect):Promise<ArrayBuffer> {
  validRect(r);if(!canvas.width||!canvas.height)throw Error('页面尚未渲染，请稍后重试。');
  const out=canvas.ownerDocument.createElement('canvas');
  const x=Math.floor(r.x*canvas.width+1e-7),y=Math.floor(r.y*canvas.height+1e-7);
  const w=Math.min(canvas.width-x,Math.ceil((r.x+r.w)*canvas.width-1e-7)-x),h=Math.min(canvas.height-y,Math.ceil((r.y+r.h)*canvas.height-1e-7)-y);
  if(w*h>32000000)throw Error('截图区域过大，请缩小选区。');
  out.width=w;out.height=h;
  const context=out.getContext('2d');if(!context)throw Error('无法创建截图画布。');
  context.drawImage(canvas,x,y,w,h,0,0,w,h);
  try {const blob=await new Promise<Blob>((resolve,reject)=>out.toBlob(b=>b?resolve(b):reject(Error('截图编码失败')),'image/png'));return await blob.arrayBuffer();}
  finally {out.width=out.height=0;}
}
async function cropPage(ctx:any,page:number,r:Rect,canvas:HTMLCanvasElement):Promise<ArrayBuffer> {
  validRect(r);
  const view=ctx.pdf.getPageView(page-1),pdfPage=view?.pdfPage;
  if(!pdfPage?.getViewport||!pdfPage?.render)return cropCanvas(canvas,r);
  // Re-render only the selected area at >= 144 dpi. No full-page bitmap allocation.
  const viewport=pdfPage.getViewport({scale:Math.max(2,view.viewport?.scale||1),rotation:view.viewport?.rotation||0});
  const x=Math.floor(r.x*viewport.width),y=Math.floor(r.y*viewport.height);
  const out=canvas.ownerDocument.createElement('canvas');
  const width=Math.ceil((r.x+r.w)*viewport.width)-x,height=Math.ceil((r.y+r.h)*viewport.height)-y;
  if(width*height>32000000)throw Error('高清截图过大，请缩小选区。');
  out.width=width;out.height=height;
  try {
    await pdfPage.render({canvasContext:out.getContext('2d'),viewport,transform:[1,0,0,1,-x,-y],background:'rgb(255,255,255)'}).promise;
    const blob=await new Promise<Blob>((resolve,reject)=>out.toBlob(b=>b?resolve(b):reject(Error('截图编码失败')),'image/png'));
    return await blob.arrayBuffer();
  }finally{out.width=out.height=0;}
}
class PdfOverlay {
  quick=false;busy=false;
  engine:any;ctx:any;bar:HTMLElement|null=null;box:HTMLElement|null=null;drag:any=null;armed=false;cleanups:(()=>void)[]=[];token=0;selectionTimer:any=null;
  constructor(engine:any,ctx:any) {
    this.engine=engine;this.ctx=ctx;
    this.listen(ctx.scroll,'pointerdown',(e:PointerEvent)=>this.down(e),true);
    // 触控设备上，光靠 preventDefault 拦不住页面平移。待命时由 .cs-crop-mode 的
    // touch-action 兜住；拖拽过程中再用一个非被动的 touchmove 双保险——
    // Alt 拖拽这条路径不挂类名，只能靠这一层。
    this.listen(ctx.scroll,'touchmove',(e:TouchEvent)=>{if(this.drag||this.armed)e.preventDefault();},{passive:false,capture:true});
    this.listen(ctx.win,'pointermove',(e:PointerEvent)=>this.move(e),true);
    this.listen(ctx.win,'pointerup',(e:PointerEvent)=>{void this.up(e).catch(engine.report);},true);
    this.listen(ctx.win,'pointercancel',()=>this.cancel(),true);
    // Releasing Alt may briefly blur the Electron/PDF window (native menu handling).
    // Only an unfinished drag is cancellable; a completed crop and its toolbar must survive.
    this.listen(ctx.win,'blur',()=>{if(this.drag)this.cancel();else{this.armed=false;this.ctx.scroll.classList.remove('cs-crop-mode');}});
    this.listen(ctx.win,'keydown',(e:KeyboardEvent)=>{if(e.key==='Escape')this.cancel();});
    this.listen(ctx.scroll,'scroll',()=>{if(!this.drag)this.hide();});
    this.listen(ctx.win.document,'selectionchange',()=>{
      const selection=ctx.win.getSelection();
      clearTimeout(this.selectionTimer);
      if(this.bar?.dataset.mode==='selection'&&!this.drag&&(!selection||selection.isCollapsed||!selection.toString().trim()))this.selectionTimer=setTimeout(()=>{const current=ctx.win.getSelection();if(this.bar?.dataset.mode==='selection'&&!this.drag&&(!current||current.isCollapsed||!current.toString().trim()))this.hide();},30);
    });
    this.listen(ctx.win.document,'pointerdown',(e:PointerEvent)=>{if(this.bar&&!this.bar.contains(e.target as Node)&&!(e.target as Element)?.closest?.('.cw-study-highlight'))this.hide();},true);
    this.listen(ctx.scroll,'click',(e:MouseEvent)=>this.highlightClick(e),true);
  }
  listen(target:any,name:string,fn:any,capture:any=false){target.addEventListener(name,fn,capture);this.cleanups.push(()=>target.removeEventListener(name,fn,capture));}
  hide(){this.bar?.remove();this.bar=null;this.box?.remove();this.box=null;this.token++;}
  finish(){this.hide();this.ctx.selection=null;this.ctx.win.getSelection()?.removeAllRanges();}
  cancel(){this.drag=null;this.armed=false;this.quick=false;this.ctx.scroll.classList.remove('cs-crop-mode');this.hide();}
  async quickCapture() {
    if(this.busy)return;
    if(this.armed){this.cancel();return;}
    const selection=this.ctx.win.getSelection();
    if(selection?.rangeCount&&!selection.isCollapsed){
      const range=selection.getRangeAt(0);
      const element=(node:Node)=>node.nodeType===1?node as Element:node.parentElement;
      const page=element(range.startContainer)?.closest('.page[data-page-number]');
      if(!page||!this.ctx.scroll.contains(page))return;
      if(element(range.endContainer)?.closest('.page[data-page-number]')!==page){new Notice('请只选择同一页内的公式。');return;}
      const canvas=page.querySelector('canvas') as HTMLCanvasElement;
      if(!canvas?.width){new Notice('页面尚未渲染，请稍后重试。');return;}
      const boxes=Array.from(range.getClientRects()).filter((r:DOMRect)=>r.width>0&&r.height>0);
      if(!boxes.length)return;
      const rect=localRect({x:Math.min(...boxes.map((r:DOMRect)=>r.left))-4,y:Math.min(...boxes.map((r:DOMRect)=>r.top))-4},{x:Math.max(...boxes.map((r:DOMRect)=>r.right))+4,y:Math.max(...boxes.map((r:DOMRect)=>r.bottom))+4},canvas.getBoundingClientRect());
      this.hide();await this.saveQuick(Number((page as HTMLElement).dataset.pageNumber),rect,canvas);return;
    }
    this.hide();this.quick=true;this.armed=true;this.ctx.scroll.classList.add('cs-crop-mode');
    new Notice('点击带边框的公式，或拖框选取；松开自动保存，Esc 取消。',3000);
  }
  async saveQuick(page:number,rect:Rect,canvas:HTMLCanvasElement,data?:ArrayBuffer) {
    if(this.busy)return;
    this.busy=true;const token=this.token;
    try {
      const bytes=data||await cropPage(this.ctx,page,rect,canvas);
      if(this.ctx.closed||token!==this.token)return;
      const imagePath=await this.engine.clips.saveCrop(this.ctx.path,page,bytes);
      await this.engine.add(this.ctx.path,{page,rects:[rect],kind:'crop',text:'',imagePath});
      if(token===this.token)this.finish();
      new Notice('公式图片已保存',1500);
    }finally{this.busy=false;}
  }
  toggle(){this.armed=!this.armed;this.ctx.scroll.classList.toggle('cs-crop-mode',this.armed);}
  down(e:PointerEvent) {
    if(this.busy)return;
    if(e.button!==0||!(e.altKey||this.armed))return;
    const page=(e.target as Element).closest('.page[data-page-number]');
    const canvas=page?.querySelector('canvas') as HTMLCanvasElement;
    if(!canvas||!canvas.width)return;
    e.preventDefault();e.stopImmediatePropagation();this.hide();this.ctx.win.getSelection()?.removeAllRanges();
    this.drag={page,canvas,start:{x:e.clientX,y:e.clientY},bounds:canvas.getBoundingClientRect(),id:e.pointerId};
    this.box=el(this.ctx.win.document.body,'div','cs-crop-box');this.move(e);
  }
  move(e:PointerEvent) {
    if(!this.drag||this.drag.id!==e.pointerId)return;e.preventDefault();
    const r=localRect(this.drag.start,{x:e.clientX,y:e.clientY},this.drag.bounds),b=this.drag.bounds;
    this.drag.rect=r;Object.assign(this.box!.style,{left:b.left+r.x*b.width+'px',top:b.top+r.y*b.height+'px',width:r.w*b.width+'px',height:r.h*b.height+'px'});
  }
  async up(e:PointerEvent) {
    if(!this.drag||this.drag.id!==e.pointerId)return;
    e.preventDefault();e.stopImmediatePropagation();this.move(e);
    const d=this.drag,quick=this.quick;this.drag=null;this.armed=false;this.quick=false;this.ctx.scroll.classList.remove('cs-crop-mode');
    if(d.rect.w*d.bounds.width<5||d.rect.h*d.bounds.height<5){const detected=detectEnclosingFrame(d.canvas,d.start,d.bounds);if(!detected){this.hide();new Notice('未检测到完整边框，请按住 Alt 手动拖拽。');return;}d.rect=detected;const b=d.bounds;Object.assign(this.box!.style,{left:b.left+detected.x*b.width+'px',top:b.top+detected.y*b.height+'px',width:detected.w*b.width+'px',height:detected.h*b.height+'px'});}
    if(quick){await this.saveQuick(Number(d.page.dataset.pageNumber),d.rect,d.canvas);return;}
    const token=this.token,data=await cropPage(this.ctx,Number(d.page.dataset.pageNumber),d.rect,d.canvas);
    if(token!==this.token||this.ctx.closed)return;
    const selected={page:Number(d.page.dataset.pageNumber),rects:[d.rect],kind:'crop',text:''};
    // Persist at most once even if both actions are used.
    let saved:Promise<string>|null=null;
    const ensure=()=>saved||=(this.engine.clips.saveCrop(this.ctx.path,selected.page,data).catch((e:any)=>{saved=null;throw e;}));
    const b=this.box!.getBoundingClientRect();
    // 复制引用的同时必须记录批注。此前这里只把 PNG 写进 Vault、把链接丢到剪贴板，
    // 不粘贴就等于丢失：图片名是 32 位随机十六进制，元数据里没有任何索引，
    // 重载后既看不到切片，也无从找回那张图。
    const copyReference=async()=>{
      const imagePath=await ensure();
      await this.ctx.win.navigator.clipboard.writeText(reference(this.ctx.path,{...selected,imagePath}));
      await this.engine.add(this.ctx.path,{...selected,imagePath});
      new Notice('已复制引用，并保存到侧栏');
      this.finish();
    };
    this.toolbar(b,[['复制引用并保存',copyReference],
      ['保存并写说明',()=>{this.hide();const previewUrl=this.ctx.win.URL.createObjectURL(new Blob([data],{type:'image/png'}));new AnnotationCapture(this.engine.p,'保存公式卡片',{...selected,copyReference,previewUrl,revokePreview:true},async(fields:any)=>{const imagePath=await ensure();await this.engine.add(this.ctx.path,{...selected,...fields,imagePath});this.finish();}).open();}]],{mode:'crop'});
  }
  text(selected:any,bounds:DOMRect) {
    if(this.drag)return;this.hide();
    let color='yellow';const copyReference=()=>this.ctx.win.navigator.clipboard.writeText(reference(this.ctx.path,selected));
    this.toolbar(bounds,[['高亮',async()=>{await this.engine.add(this.ctx.path,{...selected,color,kind:'highlight'});this.finish();}],
      ['批注',()=>new AnnotationCapture(this.engine.p,'添加批注',{...selected,color,copyReference},async(fields:any)=>{await this.engine.add(this.ctx.path,{...selected,...fields});this.finish();}).open()],
      ['复制文字引用',async()=>{await copyReference();this.finish();}]],{color,onColor:(value:string)=>color=value});
  }
  highlightClick(e:MouseEvent) {
    const mark=(e.target as Element)?.closest?.('.cw-study-highlight') as HTMLElement|null;if(!mark)return;
    const annotation=this.engine.record(this.ctx.path).annotations.find((a:any)=>a.id===mark.dataset.annotationId);if(!annotation)return;
    e.preventDefault();e.stopImmediatePropagation();this.ctx.win.getSelection()?.removeAllRanges();
    this.toolbar(mark.getBoundingClientRect(),[['删除高亮',async()=>{await this.engine.remove(this.ctx.path,annotation.id);this.finish();}],['编辑批注',()=>new AnnotationCapture(this.engine.p,'编辑卡片',annotation,(fields:any)=>this.engine.edit(this.ctx.path,annotation.id,fields)).open()]],{color:studyColor(annotation.color),onColor:async(value:string)=>{await this.engine.edit(this.ctx.path,annotation.id,{color:value});},mode:'highlight'});
  }
  toolbar(bounds:DOMRect,actions:[string,()=>any][],options?:{color?:string,onColor?:(value:string)=>any,mode?:string}) {
    this.bar?.remove();const bar=el(this.ctx.win.document.body,'div','cs-selection-toolbar');this.bar=bar;
    bar.dataset.mode=options?.mode||'selection';bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','选区操作');bar.onmousedown=(e:MouseEvent)=>e.preventDefault();
    if(options?.onColor&&options.color){const palette=el(bar,'div','cs-toolbar-palette');for(const [value,label] of Object.entries(STUDY_COLORS)){const swatch=button(palette,'',async()=>{options.color=value;paint();await options.onColor!(value);},'cw-color-swatch');swatch.dataset.color=value;swatch.title=label as string;swatch.setAttribute('aria-label',label as string);}const paint=()=>{for(const item of palette.children)item.setAttribute('aria-pressed',String((item as HTMLElement).dataset.color===options.color));};paint();}
    for(const [label,action] of actions)button(bar,label,action);
    const width=bar.getBoundingClientRect().width,height=bar.getBoundingClientRect().height;
    bar.style.left=Math.max(8,Math.min(this.ctx.win.innerWidth-width-8,bounds.left+(bounds.width-width)/2))+'px';
    bar.style.top=(bounds.top>height+12?bounds.top-height-8:Math.min(this.ctx.win.innerHeight-height-8,bounds.bottom+8))+'px';
  }
  dispose(){clearTimeout(this.selectionTimer);this.cancel();this.cleanups.forEach(fn=>fn());}
}
async function revealRegion(ctx:any,page:number,r:Rect) {
  validRect(r);ctx.pdf.currentPageNumber=page;
  await new Promise<void>(resolve=>ctx.win.requestAnimationFrame(()=>ctx.win.requestAnimationFrame(resolve)));
  if(ctx.closed)return;
  const div=ctx.pdf.getPageView(page-1)?.div;if(!div)return;
  ctx.scroll.querySelectorAll('.cs-region-focus').forEach((e:Element)=>e.remove());
  const mark=el(div,'div','cs-region-focus');
  Object.assign(mark.style,{left:r.x*100+'%',top:r.y*100+'%',width:r.w*100+'%',height:r.h*100+'%'});
  mark.scrollIntoView({behavior:'smooth',block:'center',inline:'center'});
  clearTimeout(ctx.regionTimer);ctx.regionTimer=setTimeout(()=>mark.remove(),2400);
}
module.exports={PdfOverlay,revealRegion};
