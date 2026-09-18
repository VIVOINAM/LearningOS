const {Menu,Modal,Notice}=require('obsidian');
const {el,button}=require('./study-ui.js');
const {AnnotationCapture}=require('./study-modals.js');
const {reference}=require('./storage-manager.ts');
const {selectCards,groupByPage,anchorIndex,NEARBY_RADIUS}=require('./card-list.js');
const {mountFormulaPad}=require('./formula-pad.ts');
const {renderMarkdown,markdownOwner}=require('./markdown-render.js');
const {hasMath}=require('./formula-model.js');
const {STUDY_COLORS}=require('./study-model.js');

function mountPanel(engine: any, ctx: any) {
  const root=ctx.leaf.view.contentEl||ctx.leaf.view.containerEl;ctx.root=root;root.classList.add('cw-study-host');
  // 面板里所有 Markdown 渲染共用一个宿主组件，关面板时统一回收子组件。
  ctx.mdOwner=markdownOwner();ctx.mdCache=new Map();
  const initialWidth=Math.max(260,Math.min(420,Number(engine.data.panelWidth)||320));root.style.setProperty('--cw-study-panel-width',initialWidth+'px');
  ctx.panel=el(root,'aside','cw-study-panel cs-inspector');ctx.panel.setAttribute('aria-label','学习批注阅读轨');
  const resizer=el(ctx.panel,'div','cs-inspector-resizer');resizer.setAttribute('role','separator');resizer.setAttribute('aria-label','调整学习批注阅读轨宽度');resizer.setAttribute('aria-orientation','vertical');
  resizer.onpointerdown=(event:PointerEvent)=>{if(event.button!==0)return;event.preventDefault();resizer.setPointerCapture?.(event.pointerId);root.classList.add('cw-study-resizing');const widthAt=(x:number)=>Math.max(260,Math.min(420,root.getBoundingClientRect().right-x));const move=(e:PointerEvent)=>{root.style.setProperty('--cw-study-panel-width',widthAt(e.clientX)+'px');ctx.win.dispatchEvent(new ctx.win.Event('resize'));};const up=async(e:PointerEvent)=>{move(e);root.classList.remove('cw-study-resizing');ctx.win.removeEventListener('pointermove',move,true);ctx.win.removeEventListener('pointerup',up,true);ctx.resizeCleanup=null;engine.data.panelWidth=Math.round(widthAt(e.clientX));await engine.p.save();};ctx.resizeCleanup=()=>{root.classList.remove('cw-study-resizing');ctx.win.removeEventListener('pointermove',move,true);ctx.win.removeEventListener('pointerup',up,true);};ctx.win.addEventListener('pointermove',move,true);ctx.win.addEventListener('pointerup',up,true);};
  const head=el(ctx.panel,'div','cs-inspector-head');const title=el(head,'div','cs-inspector-title');ctx.panelTitle=el(title,'strong','','本页笔记');ctx.panelCount=el(title,'span','cs-page-count','0 条');
  const headActions=el(head,'div','cs-inspector-actions');ctx.location=el(headActions,'span','cs-inspector-location','');
  const menu=button(headActions,'···',()=>{
    const m=new Menu();
    m.addItem((i:any)=>i.setTitle('导出 Markdown').onClick(()=>engine.exportMarkdown(ctx.path).catch(engine.report)));
    m.addItem((i:any)=>i.setTitle('打开教材笔记').onClick(()=>engine.openNote(ctx.path).catch(engine.report)));
    m.addItem((i:any)=>i.setTitle('清空本书卡片…').onClick(()=>{
      const modal=new Modal(engine.p.app);modal.onOpen=()=>{
        el(modal.contentEl,'p','','清空本书卡片？已嵌入笔记的截图文件会保留。');
        button(modal.contentEl,'确认清空',async()=>{await engine.clearCards(ctx.path);modal.close();});
        button(modal.contentEl,'取消',()=>modal.close());
      };modal.open();
    }));
    m.addItem((i:any)=>i.setTitle('收起抽屉').onClick(()=>{root.classList.add('cw-study-collapsed');ctx.win.dispatchEvent(new ctx.win.Event('resize'));}));
    const b=menu.getBoundingClientRect();m.showAtPosition({x:b.left,y:b.bottom});
  });menu.setAttribute('aria-label','学习面板操作');
  ctx.progress=el(ctx.panel,'progress','cs-progress');ctx.progress.max=1;
  ctx.reopen=button(root,'学习',()=>{root.classList.remove('cw-study-collapsed');ctx.win.dispatchEvent(new ctx.win.Event('resize'));},'cw-study-reopen');
  ctx.selectionLabel=el(ctx.panel,'span','');ctx.selectionLabel.hidden=true;
  el(ctx.panel,'p','cs-hint cs-capture-hint','选中文字摘录 · Alt 单击选框 / 拖拽截图');
  // 两个视图：附近笔记 / 公式速记。选中哪个一直听手动的，翻页不抢——
  // 5.5 那版会按当前页的内容自动切，最烦人的地方就是抢走你刚选的东西。
  const tabs=el(ctx.panel,'div','cs-tab-row');tabs.setAttribute('role','tablist');
  ctx.tab='notes';
  const tabButtons=new Map<string,HTMLElement>();
  for(const [key,label] of [['notes','附近笔记'],['formula','公式速记']]) {
    const tab=button(tabs,label as string,()=>setTab(key as string),'cs-tab');
    tab.setAttribute('role','tab');tabButtons.set(key as string,tab);
  }
  const setTab=(key:string)=>{
    ctx.tab=key;
    for(const [value,tab] of tabButtons)tab.setAttribute('aria-selected',String(value===key));
    ctx.panel.classList.toggle('cs-tab-formula',key==='formula');
    if(key==='formula'){ctx.formulaPad?.render();ctx.formulaPad?.focus();}
    // 回到附近笔记先把当前页重新推回正中：刚才在速记页翻过的页没人对过中。
    else {ctx.centeredPage=null;renderCards(engine,ctx);}
  };
  ctx.setTab=setTab;
  ctx.search=el(ctx.panel,'input','cw-study-search');ctx.search.type='search';ctx.search.placeholder='搜索卡片或页码';ctx.search.setAttribute('aria-label','搜索卡片');
  ctx.query='';ctx.search.oninput=()=>{ctx.query=ctx.search.value;renderCards(engine,ctx);};
  // 颜色筛选条：主流阅读器的注释边栏几乎都有这一行，用来在一本书里快速收窄。
  ctx.colorFilter=new Set();ctx.questionOnly=false;
  const filters=el(ctx.panel,'div','cs-filter-row');filters.setAttribute('role','group');filters.setAttribute('aria-label','按颜色或疑问筛选卡片');
  for(const [value,label] of Object.entries(STUDY_COLORS)) {
    const dot=button(filters,'',()=>{
      if(ctx.colorFilter.has(value))ctx.colorFilter.delete(value);else ctx.colorFilter.add(value);
      dot.setAttribute('aria-pressed',String(ctx.colorFilter.has(value)));renderCards(engine,ctx);
    },'cw-color-swatch cs-filter-dot');
    dot.dataset.color=value;dot.title=label as string;dot.setAttribute('aria-label','只看'+label);dot.setAttribute('aria-pressed','false');
  }
  const questionChip=button(filters,'疑问',()=>{
    ctx.questionOnly=!ctx.questionOnly;questionChip.setAttribute('aria-pressed',String(ctx.questionOnly));renderCards(engine,ctx);
  },'cs-filter-chip');
  questionChip.setAttribute('aria-pressed','false');questionChip.setAttribute('aria-label','只看未解决的疑问');
  ctx.list=el(ctx.panel,'div','cs-card-list');renderCards(engine,ctx);
  ctx.formulaPad=mountFormulaPad(engine,ctx,ctx.panel);
  setTab(ctx.tab);
}
/** 当前页应该落在面板正中的那条线（视口坐标）。选哪一组、对哪条边由 anchorIndex 定。 */
function anchorLine(ctx:any,page:number):number|null {
  const groups=[...ctx.list.querySelectorAll('.cs-page-group')] as HTMLElement[];
  const anchor=anchorIndex(groups.map(g=>Number(g.dataset.page)),page);
  if(!anchor)return null;
  const rect=groups[anchor.index].getBoundingClientRect();
  return anchor.edge==='center'?rect.top+rect.height/2:anchor.edge==='top'?rect.top:rect.bottom;
}

/**
 * 把当前页的笔记推到面板正中，尽力而为。
 *
 * 只在列表下方垫半屏：近邻窗口只有 ±2 页，不垫的话最后几页永远滑不到中间。
 * 上方不垫——开头几页就让列表顶着面板顶部，当前页停在最上面比空出半屏好看。
 * 垫的高度只看面板，不看内容，所以重算不会和内容高度互相拉扯。
 */
function centerCurrentPage(ctx:any) {
  const panel=ctx.panel,list=ctx.list;
  if(ctx.closed||ctx.tab!=='notes'||!panel||!list)return;
  const height=panel.clientHeight;
  if(!height)return;
  const pad=String(Math.round(height/2));
  if(list.dataset.pad!==pad){list.style.paddingBottom=pad+'px';list.dataset.pad=pad;}
  const anchor=anchorLine(ctx,Number(ctx.pdf?.currentPageNumber)||1);
  if(anchor===null)return;
  // 开头几页算出来是负数，浏览器会夹到 0：当前页就停在最顶上，这是可以的。
  panel.scrollTop+=anchor-(panel.getBoundingClientRect().top+height/2);
}

/**
 * 对一次中，再盯一小段时间。
 *
 * 卡片里的 Markdown 是异步渲染的，渲染完高度会变，刚对好的中就偏了。
 * 窗口一关就不再插手，你自己滑到哪里就是哪里。
 */
function settleCenter(ctx:any) {
  centerCurrentPage(ctx);
  // 第一次测量时版面未必定稿（面板刚插入、刚从速记页切回来），下一帧再对一次。
  ctx.win?.requestAnimationFrame?.(()=>centerCurrentPage(ctx));
  ctx.settleObserver?.disconnect();
  clearTimeout(ctx.settleTimer);
  const Observer=ctx.win?.ResizeObserver;
  if(!Observer)return;
  const observer=new Observer(()=>centerCurrentPage(ctx));
  // 列表长高了（Markdown 渲染完）要重对；面板本身变高（窗口缩放）也要，
  // 因为垫的高度是按面板算的——只盯列表会漏掉后一种。
  observer.observe(ctx.list);observer.observe(ctx.panel);
  ctx.settleObserver=observer;
  ctx.settleTimer=setTimeout(()=>{observer.disconnect();ctx.settleObserver=null;},800);
}

/**
 * 渲染好的 Markdown 节点按内容缓存。
 *
 * renderCards 每翻一页、每敲一下搜索框都会重建整个列表，
 * 每次都重走一遍 Markdown+MathJax 会把输入卡住。
 * appendChild 会把节点搬过去，所以直接复用同一个 DOM。
 */
function markdownBlock(engine:any,ctx:any,annotation:any,field:string,cls:string,markdown:string):HTMLElement {
  const cache:Map<string,HTMLElement>=ctx.mdCache ||= new Map();
  const key=`${annotation.id}|${field}|${markdown}`;
  let node=cache.get(key);
  if(!node) {
    // 改过的旧版本不再有人要；顺手抢揉掉，别让缓存无限长。
    for(const old of [...cache.keys()])if(old.startsWith(`${annotation.id}|${field}|`))cache.delete(old);
    if(cache.size>200)cache.clear();
    node=el(null,'div',cls);
    renderMarkdown(engine.p.app,ctx.mdOwner,node,markdown,engine.notePath(ctx.path));
    cache.set(key,node);
  }
  return node;
}
function renderCards(engine:any,ctx:any) {
  // 重建列表会丢滚动位置：翻一页侧栏就弹回顶部，找一张卡片要重新滚一次。
  const scrollTop=ctx.panel?.scrollTop||0;
  ctx.list.replaceChildren();
  const query=(ctx.query||'').toLocaleLowerCase().trim();
  const currentPage=Number(ctx.pdf.currentPageNumber)||1;
  const filtering=Boolean(query)||Boolean(ctx.colorFilter?.size)||Boolean(ctx.questionOnly);
  const {nearby,rest,total,nearest}=selectCards(engine.record(ctx.path).annotations,currentPage,
    {query,colors:ctx.colorFilter,questionOnly:ctx.questionOnly});
  ctx.panelTitle.textContent=query?'搜索结果':'附近笔记';
  ctx.panelCount.textContent=`${query?total:nearby.length} 条`;
  const note=(parent:HTMLElement,a:any) => {
    const active=ctx.activeAnnotationId===a.id;
    const row=el(parent,'article',`cs-card${active?' is-active':''}${a.resolved?' is-resolved':''}`);
    row.dataset.annotationId=a.id;row.dataset.color=a.color;row.draggable=true;row.tabIndex=0;
    row.setAttribute('aria-label',`第 ${a.page} 页${a.imagePath?'公式':'摘录'}`);
    const open=()=>{ctx.activeAnnotationId=a.id;renderCards(engine,ctx);engine.reveal(ctx,a).catch(engine.report);};
    row.onclick=(e:MouseEvent)=>{if((e.target as Element).closest('button'))return;open();};
    row.onkeydown=(e:KeyboardEvent)=>{
      if(e.target!==row)return;
      if(e.key==='Enter'||e.key===' '){e.preventDefault();open();return;}
      if(e.key!=='ArrowDown'&&e.key!=='ArrowUp')return;
      // 上下键在卡片之间走，不必一路 Tab 过每个按钮。
      const rows=[...ctx.list.querySelectorAll('.cs-card')] as HTMLElement[];
      const next=rows[rows.indexOf(row)+(e.key==='ArrowDown'?1:-1)];
      if(next){e.preventDefault();next.focus();}
    };
    row.ondragstart=(e:DragEvent)=>{if(!e.dataTransfer)return;e.dataTransfer.effectAllowed='copy';e.dataTransfer.setData('text/plain',reference(ctx.path,a));e.dataTransfer.setData('application/x-codex-study',a.id);};
    el(row,'span','cs-note-marker');const body=el(row,'div','cs-note-body');
    const meta=el(body,'div','cs-card-page',`第 ${a.page} 页 · ${a.imagePath?'公式':'摘录'}`);
    if(a.kind==='question')el(meta,'span',`cs-card-flag${a.resolved?' is-done':''}`,a.resolved?'已解决':'疑问');
    // 引文和自己的批注是两回事：写了批注就把原文藏掉，回看时等于丢了上下文。
    // Zotero 7、Readwise 的边栏都是引文在上、批注在下，分开排版。
    if(a.text)el(body,'blockquote','cs-card-quote',a.text);
    // 带公式的批注按 Markdown 排版；纯文字走原来那条截行的路子，不为一句话启动渲染器。
    if(a.note&&hasMath(a.note))body.appendChild(markdownBlock(engine,ctx,a,'note','cs-card-note-md',a.note));
    else if(a.note)el(body,'p','cs-note-title',a.note);
    if(a.imagePath) {
      const f=engine.p.app.vault.getAbstractFileByPath(a.imagePath);
      if(f){const img=el(body,'img',`cs-card-image${active?' is-active':''}`);img.src=engine.p.app.vault.getResourcePath(f);img.alt=`第 ${a.page} 页公式截图`;img.draggable=false;img.loading='lazy';}
      else el(body,'p','cs-note-missing','截图文件已移动或删除');
    }
    if((a.categories?.length||a.tags?.length)){const labels=[...(a.categories||[]).slice(0,2),...(a.tags||[]).map((tag:string)=>'#'+tag).slice(0,2)];el(body,'div','cs-note-labels',labels.join(' · '));}
    // 动作常驻在 DOM 里、平时淡出：此前只有选中的卡片才有按钮，
    // 想改一张卡片必须先点它，而点击会把 PDF 一起跳走。
    const actions=el(body,'div','cs-card-actions');
    button(actions,'编辑',()=>new AnnotationCapture(engine.p,'编辑卡片',a,(fields:any)=>engine.edit(ctx.path,a.id,fields)).open(),'cw-link');
    const more=button(actions,'···',()=>{
      const menu=new Menu();
      menu.addItem((item:any)=>item.setTitle('复制引用').onClick(()=>ctx.win.navigator.clipboard.writeText(reference(ctx.path,a))));
      // 卡片进复习队列。6.2 之前这条路不存在：study 的卡片和 recall 的队列
      // 互不相识，值得反复看的东西永远不会自己回到你面前。
      // recall 停用时不显示这一项——不给一个按下去没反应的菜单。
      const recall:any=engine.p.app.plugins.getPlugin('codex-recall');
      if(recall?.addCard){
        const queued=recall.has?.(`${ctx.path}#${a.id}`);
        menu.addItem((item:any)=>item.setTitle(queued?'已在复习队列':'加入间隔复习').setDisabled(!!queued)
          .onClick(()=>recall.addCard(ctx.path,a.id).then(()=>new Notice('已加入复习队列')).catch((e:any)=>engine.report(e))));
      }
      if(a.kind==='question')menu.addItem((item:any)=>item.setTitle(a.resolved?'重新标记为疑问':'标记为已解决').onClick(()=>engine.resolve(ctx.path,a.id)));
      menu.addItem((item:any)=>item.setTitle('删除笔记').onClick(()=>engine.remove(ctx.path,a.id)));
      const bounds=more.getBoundingClientRect();menu.showAtPosition({x:bounds.left,y:bounds.bottom});
    },'cw-link');
    more.setAttribute('aria-label','更多笔记操作');
    return row;
  };
  // 近邻窗口按页分组，当前页标出来；页小标题吸顶，滚动时始终知道在看第几页的批注。
  for(const group of groupByPage(nearby)) {
    const section=el(ctx.list,'section','cs-page-group');section.dataset.page=String(group.page);
    const label=el(section,'div','cs-page-label');el(label,'span','',`第 ${group.page} 页`);
    if(group.page===currentPage)el(label,'span','cs-current-label','当前');
    for(const a of group.cards)note(section,a);
  }
  if(!nearby.length&&total) {
    const empty=el(ctx.list,'p','cs-empty-page',filtering?'附近没有符合条件的卡片。':`前后 ${NEARBY_RADIUS} 页没有笔记。`);
    // 空状态不止告诉你"没有"，还给一条去处：最近的一张卡片在哪一页。
    if(nearest)button(empty,`跳到最近的一条 · 第 ${nearest.page} 页`,()=>{ctx.activeAnnotationId=nearest.id;renderCards(engine,ctx);engine.reveal(ctx,nearest).catch(engine.report);},'cw-link cs-empty-jump');
  }
  if(rest.length){
    const details=el(ctx.list,'details','cs-history-group');
    // 展开状态要跟着人走：此前每翻一页都自动合上，刚展开看到一半就没了。
    details.open=Boolean(query)||ctx.historyOpen===true;
    details.ontoggle=()=>{ctx.historyOpen=details.open;};
    const summary=el(details,'summary','');summary.append('本书其他笔记 ');el(summary,'span','cs-history-count',`${rest.length} 条`);
    const content=el(details,'div','cs-history-list');for(const a of rest)note(content,a);
  }
  if(!total)el(ctx.list,'p','cs-hint',filtering?'没有匹配卡片':'框选公式或选中文字，知识卡片将在这里展开。可拖入 Markdown 编辑区。');
  // 翻页时把当前页的笔记推到正中：视线始终落在同一条线上，
  // 不必每翻一页重新找自己在列表的哪个位置。
  // 搜索时不对中（列表已经和「当前页」没关系），但把标记清掉，清空搜索后重新对一次。
  // 点卡片、改筛选、增删改都不动滚动位置，否则列表会在手底下跳。
  if(query)ctx.centeredPage=null;
  if(!query&&ctx.centeredPage!==currentPage){ctx.centeredPage=currentPage;settleCenter(ctx);}
  else if(ctx.panel)ctx.panel.scrollTop=scrollTop;
}
module.exports={mountPanel,renderCards};
