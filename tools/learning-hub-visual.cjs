const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const legibility=require('./legibility.cjs');
// 知识地图与学习成果：用库里真实的静力学三篇笔记和它的概念图谱，外加一门还没有图谱的课（化工过程计算）验过渡期。
module.exports=async function hubChecks(page,out){
  const vault=path.resolve(__dirname,'../..');
  const DIR='03 知识库/我的课程/2026-27/课堂笔记/';
  const notes=['057274 静力学与结构力学/2026-09-22 静力学与结构力学.md','057274 静力学与结构力学/2026-09-23 静力学与结构力学.md','057274 静力学与结构力学/2026-09-24 静力学与结构力学.md','060112 化工过程计算/2026-09-24 化工过程计算.md'].map(p=>DIR+p);
  const graphPath='03 知识库/知识地图/057274 静力学与结构力学.json';
  const fixtures=[...notes,graphPath].map(rel=>({path:rel,body:fs.readFileSync(path.join(vault,rel),'utf8')}));
  const graph=JSON.parse(fixtures.at(-1).body);
  await page.evaluate(async({fixtures})=>{
    const p=v.plugin,files=p.app.vault.getFiles();
    // 修改时间早于图谱的 integratedAt：这三篇都算已整理。
    window.hubFiles=fixtures.map(f=>({path:f.path,basename:f.path.split('/').pop().replace(/\.[^.]+$/,''),extension:f.path.split('.').pop(),stat:{mtime:Date.parse('2026-09-25T12:00:00Z'),size:f.body.length},body:f.body}));files.push(...hubFiles);
    window.hubOld={read:p.app.vault.cachedRead,cache:p.app.metadataCache.getFileCache};
    p.app.vault.cachedRead=async f=>f.body??hubOld.read(f);p.app.vault.read=async f=>f.body??'';
    p.app.metadataCache.getFileCache=f=>f.fm?{frontmatter:f.fm}:hubOld.cache(f);
    const folders=new Set();
    p.app.vault.getAbstractFileByPath=path=>files.find(f=>f.path===path)||(folders.has(path)?{}:null);
    p.app.vault.createFolder=async path=>folders.add(path);
    p.app.vault.create=async(path,body)=>{
      const fm={};if(path.endsWith('.md'))for(const line of body.split('\n').slice(1)){if(line==='---')break;const at=line.indexOf(':');if(at<0)continue;const key=line.slice(0,at),raw=line.slice(at+1).trim();try{fm[key]=JSON.parse(raw);}catch{fm[key]=raw;}}
      const f={path,body,fm,extension:path.split('.').pop(),basename:path.split('/').pop().replace(/\.[^.]+$/,''),stat:{mtime:Date.now()}};files.push(f);hubFiles.push(f);return f;
    };
    p.app.vault.process=async(f,fn)=>{f.body=fn(f.body);f.stat={mtime:Date.now(),size:f.body.length};return f.body;};
    p.app.workspace.openLinkText=async(target,source,leaf)=>{window.hubOpened={target,source,leaf};};
    p.app.workspace.getLeaf=()=>({openFile:async(f,options)=>{window.hubEdited={path:f.path,options};}});
    const recall=v.owner('l-os-recall');window.hubQueue=[];recall.list=()=>hubQueue;recall.has=key=>hubQueue.some(c=>c.key===key);recall.add=async key=>hubQueue.push({key,path:key,due:0});recall.review=key=>{window.hubReview=key;};
    await v.showMap();
  },{fixtures});
  assert.equal(await page.locator('.os-nav-button').filter({hasText:'知识地图'}).count(),1);
  // ---- 课程首页：有图谱的课数概念，没有图谱的课说明原因；三篇都整理过，不出「未整理」 ----
  assert.equal(await page.locator('.os-map-course').count(),2);
  const statics=page.locator('.os-map-course').filter({hasText:'静力学与结构力学'});
  assert.match(await statics.innerText(),/20 个概念 · 21 道例题/);
  assert.equal(await statics.locator('.os-map-stale').count(),0);
  assert.match(await page.locator('.os-map-course').filter({hasText:'化工过程计算'}).innerText(),/还没整理成概念图谱/);
  await page.screenshot({path:path.join(out,'map-course-home.png')});

  // ---- 导图：首次进入默认导图；已学四章展开，六个未学章是虚线节点；节点互不重叠 ----
  await statics.click();
  await page.waitForSelector('.os-mind-node.is-concept');
  assert.equal(await page.locator('.os-mind-node.is-concept').count(),20);
  assert.equal(await page.locator('.os-mind-node.is-planned').count(),6);
  assert.equal(await page.locator('.os-mind-node.is-leaf').count(),0,'第四层默认收起');
  const boxes=await page.locator('.os-mind-node').evaluateAll(ns=>ns.map(n=>({id:n.dataset.id,...(r=>({l:r.left,t:r.top,r:r.right,b:r.bottom}))(n.getBoundingClientRect())})));
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];assert.ok(!(a.l<b.r-1&&b.l<a.r-1&&a.t<b.b-1&&b.t<a.b-1),`${a.id} 与 ${b.id} 重叠`);}
  // 适应窗口之后整张图都在视口里
  const vp=await page.locator('.os-mind-viewport').evaluate(e=>{const r=e.getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom};});
  for(const b of boxes)assert.ok(b.l>=vp.l-1&&b.r<=vp.r+1&&b.t>=vp.t-1&&b.b<=vp.b+1,`${b.id} 在视口外`);
  // 左右两侧都有章
  const root=boxes.find(b=>b.id==='root'),chapters=boxes.filter(b=>b.id.startsWith('ch:'));
  assert.ok(chapters.some(c=>c.r<root.l)&&chapters.some(c=>c.l>root.r),'章节应分到左右两侧');
  await page.screenshot({path:path.join(out,'mind-overview.png')});

  // ---- 点概念：侧滑概念卡、长出要点、先修和后续画虚线弧、其余概念变淡 ----
  await page.locator('.os-mind-node[data-id="c-couple"]').click();
  await page.waitForSelector('.os-mind.has-card');
  assert.equal(await page.locator('.os-mind-card h2').innerText(),'力偶与等效力偶');
  const couple=graph.concepts.find(c=>c.id==='c-couple');
  assert.equal(await page.locator('.os-mind-node.is-leaf').count(),couple.points.length);
  assert.equal(await page.locator('.os-mind-arc').count(),2,'一个先修（力对点之矩）+ 一个后续（力的平移）');
  assert.ok(await page.locator('.os-mind-node.is-concept.is-dim').count()>=15);
  assert.equal(await page.locator('.os-mind-card .os-concept-basis').innerText(),'依据：还没有自测记录');
  assert.equal(await page.locator('.os-mind-card details.os-concept-excerpt').getAttribute('open'),null,'原文默认折叠');
  await page.waitForTimeout(400);// 等平移和概念卡滑入的动画走完再量
  const selectedBox=await page.locator('.os-mind-node[data-id="c-couple"]').evaluate(e=>e.getBoundingClientRect().right);
  const cardLeft=await page.locator('.os-mind-card').evaluate(e=>e.getBoundingClientRect().left);
  assert.ok(selectedBox<=cardLeft,'选中的节点不被概念卡挡住');
  const leafRight=await page.locator('.os-mind-node.is-leaf').evaluateAll(ns=>Math.max(...ns.map(n=>n.getBoundingClientRect().right)));
  assert.ok(leafRight<=await page.locator('.os-mind-card').evaluate(e=>e.getBoundingClientRect().left)+1,'长出来的要点也不被概念卡挡住');
  await page.waitForTimeout(400);// 概念卡滑入的动画
  await page.screenshot({path:path.join(out,'mind-selected.png')});
  // 概念卡里的「后续」可以点过去
  await page.locator('.os-mind-card .os-concept-chip').filter({hasText:'力的平移'}).click();
  assert.equal(await page.locator('.os-mind-card h2').innerText(),'力的平移：力 + 力偶');
  // 手动改档位：写进掌握度记录（只追加），节点换成需巩固的颜色和叹号，依据写「手动」
  await page.locator('.os-mind-card .os-concept-levels').getByRole('button',{name:'需巩固',exact:true}).click();
  await page.waitForSelector('.os-mind-node[data-id="c-force-translation"].is-review');
  const mastery=await page.evaluate(()=>JSON.parse(hubFiles.find(f=>f.path==='03 知识库/知识地图/掌握度.json').body));
  assert.deepEqual(mastery.records.map(r=>[r.concept,r.level,r.source]),[['c-force-translation','review','manual']]);
  assert.match(await page.locator('.os-mind-card .os-concept-basis').innerText(),/手动/);
  // 原文展开时才读文件
  await page.locator('.os-mind-card details.os-concept-excerpt summary').click();
  await page.waitForFunction(()=>document.querySelector('.os-mind-card .os-concept-excerpt-body')?.textContent.length>20);
  const stable=await page.evaluate(async()=>{
    const card=document.querySelector('.os-mind-card'),excerpt=card.querySelector('details'),body=card.querySelector('.os-concept-excerpt-body');
    card.scrollTop=80;const top=card.scrollTop,generation=v.generation,transform=document.querySelector('.os-mind-stage').style.transform;
    let changes=0;const observer=new MutationObserver(rows=>changes+=rows.length);observer.observe(card,{childList:true,subtree:true});
    for(let i=0;i<5;i++){await v.refresh();v.tick();}
    await Promise.resolve();observer.disconnect();
    return {same:card===document.querySelector('.os-mind-card'),body:body===document.querySelector('.os-concept-excerpt-body'),open:excerpt.open,scroll:card.scrollTop===top,generation:generation===v.generation,transform:transform===document.querySelector('.os-mind-stage').style.transform,changes};
  });
  assert.deepEqual(stable,{same:true,body:true,open:true,scroll:true,generation:true,transform:true,changes:0},'后台刷新保留详情卡和原文，不闪烁、不重置滚动');
  // 图谱实际修改仍自动刷新；只修改浏览器内存夹具。
  await page.evaluate(async()=>{
    const f=hubFiles.find(f=>f.path.endsWith('057274 静力学与结构力学.json'));
    const graph=JSON.parse(f.body);graph.concepts.find(c=>c.id==='c-force-translation').summary+=' 更新验证。';
    f.body=JSON.stringify(graph);f.stat.mtime++;f.stat.size=f.body.length;await v.refresh();
  });
  assert.match(await page.locator('.os-mind-card .os-concept-summary').innerText(),/更新验证/);
  // Esc 收起
  await page.locator('.os-mind-card h2').click();await page.keyboard.press('Escape');
  await page.waitForSelector('.os-mind:not(.has-card)');

  // ---- 平移、缩放、键盘；拖动不算点击 ----
  const transform=()=>page.locator('.os-mind-stage').evaluate(e=>e.style.transform);
  const before=await transform();
  const node=await page.locator('.os-mind-node[data-id="c-rigid-body"]').boundingBox();
  await page.mouse.move(node.x+node.width/2,node.y+node.height/2);await page.mouse.down();await page.mouse.move(node.x+120,node.y+60,{steps:6});await page.mouse.up();
  assert.notEqual(await transform(),before);
  assert.equal(await page.locator('.os-mind.has-card').count(),0,'拖动结束不能打开概念卡');
  await page.locator('.os-mind-viewport').hover();await page.keyboard.down('Control');await page.mouse.wheel(0,-240);await page.keyboard.up('Control');
  assert.match(await transform(),/scale\((?!1\))/);
  assert.equal(await page.locator('.os-mind-viewport').evaluate(e=>getComputedStyle(e).touchAction),'none');
  await page.locator('.os-mind').focus();await page.keyboard.press('0');
  await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('.os-mind-node.is-focus').count(),1);
  const focused=await page.locator('.os-mind-node.is-focus').getAttribute('data-id');
  await page.keyboard.press('Enter');
  if(focused.startsWith('c-'))await page.waitForSelector('.os-mind.has-card');
  // ---- 筛选：导图里不符合的变淡，不删 ----
  await page.getByRole('group',{name:'筛选概念'}).getByRole('button',{name:'需巩固',exact:true}).click();
  assert.equal(await page.locator('.os-mind-node.is-concept').count(),20);
  assert.equal(await page.locator('.os-mind-node.is-concept:not(.is-faded)').count(),1);
  await page.getByRole('group',{name:'筛选概念'}).getByRole('button',{name:'全部',exact:true}).click();

  // ---- 列表模式：章 → 概念两层；未学章一行虚线；没有日期分组和「例题（9/23）」节点 ----
  await page.getByRole('group',{name:'显示方式'}).getByRole('button',{name:'列表',exact:true}).click();
  await page.waitForSelector('.os-concept-tree');
  assert.equal(await page.locator('.os-concept-tree .os-concept-node').count(),20);
  assert.equal(await page.locator('.os-concept-chapter.is-planned').count(),6);
  assert.equal(await page.locator('.os-concept-lecture').count(),0);
  const titles=await page.locator('.os-concept-title').allInnerTexts();
  assert.ok(titles.every(t=>!/例题|速查|自测/.test(t)),titles.join(' | '));
  await page.locator('.os-concept-node').filter({hasText:'刚体平衡方程'}).click();
  assert.equal(await page.locator('.os-concept-detail .os-concept-examples .os-button').count(),2);
  await page.locator('.os-concept-detail .os-concept-examples .os-button').first().click();
  assert.match(await page.evaluate(()=>hubOpened.target),/2026-09-23 静力学与结构力学\.md#7\. 官方例题一/);
  await page.getByRole('group',{name:'筛选概念'}).getByRole('button',{name:'需巩固',exact:true}).click();
  assert.equal(await page.locator('.os-concept-tree .os-concept-node').count(),1);
  await page.getByRole('group',{name:'筛选概念'}).getByRole('button',{name:'全部',exact:true}).click();
  // 模式按课程记住
  assert.equal(await page.evaluate(()=>v.plugin.data.knowledgeView.mode['057274']),'list');
  await page.screenshot({path:path.join(out,'map-list.png')});

  // ---- 过渡期：没有图谱的课按标题解析列出，导图按钮置灰 ----
  await page.getByRole('button',{name:'← 全部课程',exact:true}).click();
  await page.locator('.os-map-course').filter({hasText:'化工过程计算'}).click();
  assert.ok(await page.locator('.os-concept-node').count()>1);
  assert.ok(await page.getByRole('button',{name:'导图',exact:true}).isDisabled());
  assert.equal(await page.getByRole('button',{name:'连接知识点',exact:true}).count(),0);

  // ---- 学习进展：按课程汇总证据，旧笔记仍可直接打开，不再占用右侧阅读框 ----
  await page.evaluate(async()=>{
    await hubStore.saveOutcome(v.plugin,{title:'合力与合力矩，必须一起保留',course:'057274',cue:'把力搬到另一个点，少了什么？',concepts:['c-force-translation'],body:'移动力的作用点时，需要补上力偶。'});
    await v.showOutcomes('057274');
  });
  assert.equal(await page.locator('.os-progress-course').count(),1);
  assert.equal(await page.locator('.os-memory-detail').count(),0);
  assert.equal(await page.locator('.os-nav-button').filter({hasText:'学习进展'}).count(),1);
  assert.match(await page.locator('.os-progress-course').innerText(),/待补强/);
  assert.equal(await page.locator('.os-progress-course').getByRole('button',{name:'力的平移：力 + 力偶',exact:true}).count(),1);
  await page.locator('.os-progress-course').getByRole('button',{name:'力的平移：力 + 力偶',exact:true}).click();
  assert.equal(await page.locator('.os-concept-node.is-active').getAttribute('data-key'),'c-force-translation');
  await page.evaluate(()=>v.showOutcomes('057274'));
  assert.equal(await page.locator('.os-progress-note').count(),1,'精简笔记直接可见');
  await page.evaluate(()=>{window.progressOldOpen=v.plugin.open;v.plugin.open=async path=>window.progressOpened=path;});
  await page.getByRole('button',{name:'合力与合力矩，必须一起保留',exact:true}).click();
  assert.match(await page.evaluate(()=>progressOpened),/学习成果/);
  await page.evaluate(async()=>{const path=progressOpened;progressOpened='';await v.showOutcomes('',path);v.plugin.open=progressOldOpen;});
  assert.match(await page.evaluate(()=>progressOpened),/学习成果/,'旧概念和回顾链接仍打开笔记');
  await page.evaluate(async()=>{hubQueue.push({key:progressOpened,path:progressOpened,due:0});await v.refresh(true);});
  await page.getByRole('button',{name:'回顾 1 项',exact:true}).click();
  assert.equal(await page.evaluate(()=>hubReview),await page.evaluate(()=>progressOpened));
  await page.getByRole('button',{name:'课堂笔记',exact:true}).click();
  assert.equal(await page.evaluate(()=>v.summaryState.course),'057274');
  await page.evaluate(()=>v.showOutcomes());
  await page.getByLabel('学习进展课程',{exact:true}).selectOption('060112');
  assert.equal(await page.locator('.os-progress-course').count(),1);
  assert.match(await page.locator('.os-progress-course').innerText(),/掌握情况待自测验证/);
  // ---- 四种宽度 × 深浅色：两种模式都不横向溢出 ----
  for(const theme of ['light','dark'])for(const width of [1440,760,420,320]){
    await page.setViewportSize({width,height:900});await page.evaluate(t=>document.body.className=t==='dark'?'theme-dark':'',theme);
    for(const module of ['mind','list','outcomes']){
      await page.evaluate(async module=>{if(module==='outcomes')return v.showOutcomes('057274');v.plugin.data.knowledgeView.mode['057274']=module;await v.showMap('057274','c-couple');},module);
      const dims=await page.locator(module==='outcomes'?'.os-outcome-body':'.os-map-body').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth}));
      assert.ok(dims.scroll<=dims.width+1,JSON.stringify({theme,width,module,dims}));
      if(width===1440||width===420){await page.waitForTimeout(module==='mind'?400:0);await page.screenshot({path:path.join(out,`${module}-${theme}-${width}.png`)});}
    }
  }
  await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>document.body.className='');
  assert.equal(await page.evaluate(()=>hubFiles.filter(f=>f.fm?.type==='learning-outcome').length),1);
  await page.evaluate(()=>v.showOutcomes('060112'));
  assert.equal(await page.locator('.os-memory-card').count(),0);
  await page.evaluate(()=>v.showOutcomes('057274'));
  const progressRows=await legibility.measure(page,{anchors:[['课程','.os-progress-course h3','课程卡'],['笔记标题','.os-progress-note-copy strong','笔记卡'],['笔记提示','.os-progress-note-cue','笔记卡'],['入口','.os-progress-actions .os-button','课程卡']],minAnchors:4});
  assert.deepEqual(legibility.report(progressRows).bad,[],'学习进展文字与入口对比度达标');

  // ---- 可读性闸门：四档节点都在场，摆到八种最坏背景上量 ----
  await page.evaluate(async()=>{
    const f=hubFiles.find(f=>f.path==='03 知识库/知识地图/掌握度.json'),doc=JSON.parse(f.body),at=new Date().toISOString();
    doc.records.push({concept:'c-couple',course:'057274',level:'understood',source:'manual',at},{concept:'c-moment-point',course:'057274',level:'applied',source:'manual',at});
    f.body=JSON.stringify(doc);v.plugin.data.knowledgeView.mode['057274']='mind';await v.showMap('057274');
  });
  await page.locator('.os-mind').focus();await page.keyboard.press('0');await page.waitForTimeout(400);
  const report=(rows,label)=>{const {bad,worst}=legibility.report(rows);
    if(bad.length)assert.fail(`可读性闸门（${label}）：${rows.length} 次取样里 ${bad.length} 处低于 ${legibility.MIN}\n`+bad.slice(0,20).map(r=>`  ${r.theme==='light'?'浅':'深'} / ${r.backdrop} / ${r.name}（${r.on}） 底 ${r.bg} 字 ${r.ink} = ${r.value.toFixed(2)}`).join('\n'));
    console.log(`可读性（${label}）：${rows.length} 次取样全部达标，最难的一处 ${worst.theme==='light'?'浅':'深'} / ${worst.backdrop} / ${worst.name} = ${worst.value.toFixed(2)}`);};
  report(await legibility.measure(page,{anchors:legibility.MAP_ANCHORS,minAnchors:9}),'知识导图');
  await page.locator('.os-mind-node[data-id="c-couple"]').click();await page.waitForTimeout(400);
  report(await legibility.measure(page,{anchors:legibility.MAP_CARD_ANCHORS,minAnchors:5}),'概念卡');
  for(const [theme,file] of [['','mind-wallpaper.png'],['theme-dark ','mind-wallpaper-dark.png']]){
    await page.evaluate(t=>{document.documentElement.style.setProperty('--os-scrim-opacity','0');document.body.style.setProperty('--os-wallpaper','linear-gradient(#045295 0%,#8fc7ee 60%,#dff1ff 100%)');document.body.className=t+'os-wallpaper-on';},theme);
    await page.waitForTimeout(120);await page.screenshot({path:path.join(out,file)});
  }
  await page.evaluate(()=>{document.body.style.removeProperty('--os-wallpaper');document.documentElement.style.removeProperty('--os-scrim-opacity');document.body.className='';});
};
