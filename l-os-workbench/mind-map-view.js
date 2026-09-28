"use strict";
/*
 * 知识地图的导图模式：课程居中、章节分左右、概念一层、选中概念时长出要点。
 *
 * 节点是普通按钮，绝对定位；连线是底下一张 SVG。尺寸先量再排（mind-map-layout.js），
 * 所以字号、缩放、中英文混排都不用猜宽度。
 * 画布设了 touch-action: none：平板上手写笔降级成触控，不设的话浏览器把拖动当成滚动吃掉。
 */
const {el}=require('../shared/dom');
const L=require('./mind-map-layout');
const G=require('./knowledge-graph');
const {LEVELS}=require('./learning-hub-model');
const SVG='http://www.w3.org/2000/svg';
const PAD=40,MIN=.25,MAX=2.5,CARD=400;
const circled=n=>n>=1&&n<=20?String.fromCharCode(0x245F+n):`(${n})`;
/** 叶子节点放不下公式，只留字：去掉 $ 和命令名。全文在 title 和概念卡里。 */
const plain=s=>String(s).replace(/\$([^$]*)\$/g,(_,m)=>m.replace(/\\(?:vec|mathbf|hat|bar|overrightarrow|tfrac|frac|sqrt|mathrm|text)\b/g,'').replace(/\\[a-zA-Z]+/g,'').replace(/[{}^_]/g,'')).replace(/`/g,'').replace(/\s+/g,' ').trim();
const clip=(s,n=20)=>s.length>n?s.slice(0,n-1)+'…':s;
const svgEl=(parent,tag,attrs={})=>{const node=document.createElementNS(SVG,tag);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,v);parent?.appendChild(node);return node;};
const reduced=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

function renderMindMap(ctx,host,{renderCard}){
  const {model,state,graph,prefs,view}=ctx;
  const memory=view.mindCamera||={};
  let camera=memory[graph.course]||null;
  const defaults=model.chapters.filter(c=>c.status==='learned').map(c=>c.id);
  const open=new Set(prefs.open||defaults);
  let selected=state.cardOpen&&model.byId.has(state.key)?state.key:'';
  let focusId=selected||'root',layout=null,cardCleanup=null;
  const elements=new Map();

  const wrap=el(host,'div','os-mind');wrap.tabIndex=0;wrap.setAttribute('role','application');wrap.setAttribute('aria-label',`${graph.title} 知识导图。方向键在节点间移动，Enter 打开，加减号缩放，0 适应窗口`);
  const viewport=el(wrap,'div','os-mind-viewport');
  const stage=el(viewport,'div','os-mind-stage');
  const edges=svgEl(stage,'svg',{class:'os-mind-edges','aria-hidden':'true'});
  const arcs=svgEl(stage,'svg',{class:'os-mind-arcs','aria-hidden':'true'});
  const defs=svgEl(arcs,'defs');const marker=svgEl(defs,'marker',{id:`os-mind-arrow-${graph.course}`,viewBox:'0 0 10 10',refX:'9',refY:'5',markerWidth:'7',markerHeight:'7',orient:'auto-start-reverse'});svgEl(marker,'path',{d:'M0,0 L10,5 L0,10 z',class:'os-mind-arrow'});
  const controls=el(wrap,'div','os-mind-controls');
  const control=(label,title,fn)=>{const b=el(controls,'button','os-button os-quiet',label);b.type='button';b.title=title;b.setAttribute('aria-label',title);b.addEventListener('click',e=>{e.stopPropagation();fn();});return b;};
  control('−','缩小',()=>zoomBy(1/1.25));control('+','放大',()=>zoomBy(1.25));control('适应窗口','把整张图放进窗口',()=>fit(true));
  const card=el(wrap,'aside','os-mind-card');card.dataset.scroll='mind-card';card.setAttribute('aria-label','概念卡');
  const cardHead=el(card,'div','os-mind-card-head');const close=el(cardHead,'button','os-button os-quiet','收起');close.type='button';close.addEventListener('click',e=>{e.stopPropagation();deselect();});
  const cardBody=el(card,'div','os-mind-card-body');
  ctx.addCleanup(()=>{cardCleanup?.();cardCleanup=null;memory[graph.course]=camera;});

  const apply=(animate=false)=>{
    if(!camera)return;
    stage.classList.toggle('is-animating',animate&&!reduced());
    stage.style.transform=`translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
    memory[graph.course]=camera;
  };
  const size=()=>({w:viewport.clientWidth,h:viewport.clientHeight});
  const cardWidth=()=>selected&&wrap.classList.contains('has-card')?Math.min(CARD,size().w*.9):0;
  function fit(animate){
    if(!layout)return;const {w,h}=size();if(!w||!h)return;
    const b=layout.stageBounds;camera=L.fitView(b,w-cardWidth(),h,{pad:24,max:1.2,min:MIN});apply(animate);
  }
  function zoomBy(factor,cx,cy){
    if(!camera)return;const {w,h}=size();cx??=(w-cardWidth())/2;cy??=h/2;
    const scale=Math.max(MIN,Math.min(MAX,camera.scale*factor)),k=scale/camera.scale;
    camera={scale,x:cx-(cx-camera.x)*k,y:cy-(cy-camera.y)*k};apply(cx==null);
  }
  /** 屏幕上的位置 ↔ 舞台坐标。 */
  const screenOf=id=>{const n=layout?.nodes.get(id);return n&&camera?{x:camera.x+n.sx*camera.scale,y:camera.y+n.sy*camera.scale}:null;};
  /**
   * 让一个节点连同它刚长出来的要点都在可见区域里（不被概念卡挡住）；已经可见就不动。
   * 放不下时以节点本身为准：要点可以拖过去看，节点不能被挡住。
   */
  function reveal(id,animate=true){
    const n=layout?.nodes.get(id);if(!n||!camera)return;
    const {w,h}=size(),right=w-cardWidth()-24,left=24,s=camera.scale;
    const box=list=>{let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;for(const m of list){x0=Math.min(x0,camera.x+(m.sx-m.w/2)*s);x1=Math.max(x1,camera.x+(m.sx+m.w/2)*s);y0=Math.min(y0,camera.y+(m.sy-m.h/2)*s);y1=Math.max(y1,camera.y+(m.sy+m.h/2)*s);}return {x0,x1,y0,y1};};
    const own=box([n]),group=box([n,...[...layout.nodes.values()].filter(m=>m.parent===id)]);
    const fits=group.x1-group.x0<=right-left&&group.y1-group.y0<=h-48,b=fits?group:own;
    let dx=0,dy=0;if(b.x1>right)dx=right-b.x1;if(b.x0+dx<left)dx=left-b.x0;if(b.y0<24)dy=24-b.y0;else if(b.y1>h-24)dy=h-24-b.y1;
    if(dx||dy){camera={...camera,x:camera.x+dx,y:camera.y+dy};apply(animate);}
  }

  /** 要画的树：收起的章不带子节点；只有选中的概念长出第四层。 */
  function tree(){
    const root={id:'root',kind:'root',children:[]};
    for(const ch of model.chapters){
      const node={id:`ch:${ch.id}`,kind:'chapter',chapter:ch,children:[]};root.children.push(node);
      if(ch.status!=='learned'||!open.has(ch.id))continue;
      for(const c of model.inChapter(ch.id)){
        const cn={id:c.id,kind:'concept',concept:c,children:[]};node.children.push(cn);
        if(c.id!==selected)continue;
        (c.points||[]).forEach((pt,i)=>cn.children.push({id:`${c.id}#p${i}`,kind:'leaf',concept:c,text:pt,children:[]}));
        if(c.examples?.length)cn.children.push({id:`${c.id}#ex`,kind:'leaf',concept:c,text:`例题 · ${c.examples.length}`,examples:true,children:[]});
      }
    }
    return root;
  }
  function nodeElement(n){
    const b=el(stage,'button',`os-mind-node is-${n.kind}`);b.type='button';b.tabIndex=-1;b.dataset.id=n.id;
    if(n.kind==='root'){el(b,'span','',graph.title);b.title='适应窗口';}
    else if(n.kind==='chapter'){
      const ch=n.chapter,planned=ch.status!=='learned';
      b.classList.toggle('is-planned',planned);b.classList.toggle('is-collapsed',!planned&&!open.has(ch.id));
      el(b,'span','os-mind-order',circled(ch.order));el(b,'span','',planned?`${ch.title}（未学）`:ch.title);
      b.setAttribute('aria-expanded',String(!planned&&open.has(ch.id)));
      if(planned)b.title='还没讲到';
    }else if(n.kind==='concept'){
      const c=n.concept;b.classList.add(`is-${c.level}`);
      const mark=el(b,'span',`os-mastery-mark is-${c.level}`,c.level==='review'?'!':'');mark.setAttribute('aria-hidden','true');
      el(b,'span','',c.title);if(c.fresh)el(b,'span','os-concept-new','新');
      b.setAttribute('aria-label',`${c.title}，${LEVELS[c.level]}${c.fresh?'，本周新学':''}`);
      if(!G.matchesFilter(c,state.filter))b.classList.add('is-faded');
    }else{const t=plain(n.text);el(b,'span','',clip(t,n.examples?30:22));b.title=t;}
    return b;
  }
  function paint(anchor=null){
    const before=anchor?screenOf(anchor):null;
    for(const node of [...stage.children])if(node!==edges&&node!==arcs)node.remove();
    elements.clear();
    const root=tree();
    const measure=n=>{const b=nodeElement(n);elements.set(n.id,{el:b,node:n});return {id:n.id,w:Math.ceil(b.offsetWidth)||80,h:Math.ceil(b.offsetHeight)||28,children:n.children.map(measure)};};
    layout=L.layoutMindMap(measure(root));
    const {left,top,right,bottom}=layout.bounds,W=right-left+PAD*2,H=bottom-top+PAD*2;
    for(const n of layout.nodes.values()){n.sx=n.x-left+PAD;n.sy=n.y-top+PAD;const e=elements.get(n.id).el;e.style.left=`${n.sx-n.w/2}px`;e.style.top=`${n.sy-n.h/2}px`;}
    layout.stageBounds={left:0,top:0,right:W,bottom:H};
    stage.style.width=`${W}px`;stage.style.height=`${H}px`;
    for(const svg of [edges,arcs]){svg.setAttribute('width',W);svg.setAttribute('height',H);svg.setAttribute('viewBox',`0 0 ${W} ${H}`);}
    edges.replaceChildren();
    for(const e of layout.edges){
      const a=layout.nodes.get(e.from),b=layout.nodes.get(e.to),s=e.side;
      const x1=a.depth===0?a.sx+s*a.w/2:a.sx+s*a.w/2,y1=a.sy,x2=b.sx-s*b.w/2,y2=b.sy,mx=(x1+x2)/2;
      const kind=elements.get(e.to).node.kind,planned=elements.get(e.to).node.chapter?.status==='planned';
      svgEl(edges,'path',{d:`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`,class:`os-mind-edge is-${kind}${planned?' is-planned':''}`});
    }
    paintSelection();
    if(!camera){requestAnimationFrame(()=>{if(!camera){fit(false);}});fit(false);}
    else if(before){const after=screenOf(anchor);if(after){camera={...camera,x:camera.x+before.x-after.x,y:camera.y+before.y-after.y};}apply(false);}
    else apply(false);
    markFocus();
  }
  /** 选中概念：它的先修（指向它）和后续（从它出发）画虚线弧，其余概念变淡。 */
  function paintSelection(){
    for(const node of [...arcs.children])if(node!==defs)node.remove();
    const c=selected&&model.byId.get(selected);
    const keep=c?new Set([c.id,...(c.prereqs||[]),...(c.successors||[])]):null;
    for(const [id,{el:b,node}] of elements){
      b.classList.toggle('is-selected',id===selected);
      b.classList.toggle('is-dim',!!keep&&node.kind==='concept'&&!keep.has(id));
      if(node.kind==='concept')b.setAttribute('aria-pressed',String(id===selected));
    }
    if(!c)return;
    const arc=(from,to,cls)=>{
      const a=layout.nodes.get(from),b=layout.nodes.get(to);if(!a||!b)return;
      const dx=b.sx-a.sx,dy=b.sy-a.sy,len=Math.hypot(dx,dy)||1,bend=Math.min(80,len*.25);
      const cx=(a.sx+b.sx)/2-dy/len*bend,cy=(a.sy+b.sy)/2+dx/len*bend;
      // 起止点落在节点边框外一点，箭头不压字。
      const trim=(n,tx,ty)=>{const ux=tx-n.sx,uy=ty-n.sy,k=Math.min(Math.abs((n.w/2+4)/(ux||1e-6)),Math.abs((n.h/2+4)/(uy||1e-6)));return [n.sx+ux*Math.min(1,k),n.sy+uy*Math.min(1,k)];};
      const [x1,y1]=trim(a,cx,cy),[x2,y2]=trim(b,cx,cy);
      svgEl(arcs,'path',{d:`M${x1},${y1} Q${cx},${cy} ${x2},${y2}`,class:`os-mind-arc ${cls}`,'marker-end':`url(#os-mind-arrow-${graph.course})`});
    };
    for(const p of c.prereqs||[])arc(p,c.id,'is-prereq');
    for(const s of c.successors||[])arc(c.id,s,'is-next');
  }
  const markFocus=()=>{for(const [id,{el:b}] of elements)b.classList.toggle('is-focus',id===focusId&&wrap.matches(':focus-within'));};

  function showCard(){
    cardCleanup?.();cardCleanup=null;
    const c=selected&&model.byId.get(selected);
    wrap.classList.toggle('has-card',!!c);
    if(!c){cardBody.replaceChildren();return;}
    cardCleanup=renderCard(ctx,cardBody,c);card.scrollTop=0;
  }
  function select(id,{anchor=id,pan=true}={}){
    const c=model.byId.get(id);if(!c)return;
    if(!open.has(c.chapter)){open.add(c.chapter);prefs.save({open:[...open]});}
    selected=id;focusId=id;state.key=id;state.cardOpen=true;
    paint(model.byId.has(anchor)&&layout?.nodes.has(anchor)?anchor:null);showCard();if(pan)reveal(id);
  }
  function deselect(){
    if(!selected)return;const was=selected;selected='';state.cardOpen=false;
    paint(was);showCard();wrap.focus({preventScroll:true});
  }
  ctx.jump=id=>select(id,{anchor:selected});
  function activate(id){
    const hit=elements.get(id);if(!hit)return;const n=hit.node;
    if(n.kind==='root')return fit(true);
    if(n.kind==='chapter'){if(n.chapter.status!=='learned')return;open.has(n.chapter.id)?open.delete(n.chapter.id):open.add(n.chapter.id);prefs.save({open:[...open]});focusId=id;
      if(selected&&!open.has(model.byId.get(selected)?.chapter)){selected='';state.cardOpen=false;showCard();}
      return paint(id);}
    if(n.kind==='concept')return select(n.concept.id);
    if(n.kind==='leaf'){select(n.concept.id);const target=n.examples&&cardBody.querySelector('.os-concept-examples');if(target)card.scrollTop=target.offsetTop-60;}
  }

  // ---- 指针：拖动平移、两指捏合；点在节点上且没拖动才算点击 ----
  const pointers=new Map();let drag=null,pinch=null,suppress=false;
  viewport.addEventListener('pointerdown',e=>{
    if(!camera||(e.button!==0&&e.pointerType==='mouse'))return;
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pointers.size===1)drag={x:e.clientX,y:e.clientY,cam:{...camera},moved:false,id:e.pointerId};
    if(pointers.size===2){const [a,b]=[...pointers.values()];pinch={d:Math.hypot(a.x-b.x,a.y-b.y)||1,cam:{...camera},mx:(a.x+b.x)/2,my:(a.y+b.y)/2};drag=null;}
  });
  viewport.addEventListener('pointermove',e=>{
    if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    const rect=viewport.getBoundingClientRect();
    if(pinch&&pointers.size>=2){const [a,b]=[...pointers.values()],d=Math.hypot(a.x-b.x,a.y-b.y)||1;
      const scale=Math.max(MIN,Math.min(MAX,pinch.cam.scale*d/pinch.d)),k=scale/pinch.cam.scale,cx=pinch.mx-rect.left,cy=pinch.my-rect.top;
      camera={scale,x:cx-(cx-pinch.cam.x)*k+((a.x+b.x)/2-pinch.mx),y:cy-(cy-pinch.cam.y)*k+((a.y+b.y)/2-pinch.my)};apply(false);suppress=true;return;}
    if(!drag||drag.id!==e.pointerId)return;
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(!drag.moved&&Math.hypot(dx,dy)<5)return;
    if(!drag.moved){drag.moved=true;suppress=true;viewport.setPointerCapture?.(e.pointerId);viewport.classList.add('is-dragging');}
    camera={...drag.cam,x:drag.cam.x+dx,y:drag.cam.y+dy};apply(false);
  });
  const end=e=>{pointers.delete(e.pointerId);if(pointers.size<2)pinch=null;if(drag?.id===e.pointerId){drag=null;viewport.classList.remove('is-dragging');}};
  viewport.addEventListener('pointerup',end);viewport.addEventListener('pointercancel',end);
  // 拖动结束时浏览器仍会补一个 click：拦在捕获阶段，不让它落到节点上。
  viewport.addEventListener('click',e=>{
    if(suppress){suppress=false;e.stopPropagation();e.preventDefault();return;}
    const b=e.target.closest?.('.os-mind-node');
    if(b){e.stopPropagation();focusId=b.dataset.id;activate(b.dataset.id);return;}
    deselect();
  },true);
  viewport.addEventListener('wheel',e=>{
    e.preventDefault();if(!camera)return;const rect=viewport.getBoundingClientRect();
    // Obsidian 里触控板捏合就是 Ctrl + 滚轮。
    if(e.ctrlKey||e.metaKey)zoomBy(Math.exp(-e.deltaY*.01),e.clientX-rect.left,e.clientY-rect.top);
    else{camera={...camera,x:camera.x-(e.shiftKey?e.deltaY:e.deltaX),y:camera.y-(e.shiftKey?0:e.deltaY)};apply(false);}
  },{passive:false});
  wrap.addEventListener('keydown',e=>{
    if(e.target.closest?.('.os-mind-card'))return e.key==='Escape'?(e.preventDefault(),deselect()):undefined;
    const dir={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'}[e.key];
    if(dir){e.preventDefault();const next=L.neighbour(layout.nodes,focusId,dir);if(next){focusId=next;markFocus();reveal(next);}return;}
    if(e.key==='Enter'||e.key===' '){e.preventDefault();activate(focusId);return;}
    if(e.key==='+'||e.key==='='){e.preventDefault();zoomBy(1.25);return;}
    if(e.key==='-'||e.key==='_'){e.preventDefault();zoomBy(1/1.25);return;}
    if(e.key==='0'){e.preventDefault();fit(true);return;}
    if(e.key==='Escape'&&selected){e.preventDefault();deselect();}
  });
  wrap.addEventListener('focusin',markFocus);wrap.addEventListener('focusout',()=>setTimeout(markFocus,0));

  paint();showCard();
  if(selected)requestAnimationFrame(()=>reveal(selected,false));
}
module.exports={renderMindMap};
