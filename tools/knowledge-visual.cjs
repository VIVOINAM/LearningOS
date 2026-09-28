const assert=require('node:assert/strict');
const path=require('node:path');
module.exports=async function knowledgeChecks(page,out){
  await page.setViewportSize({width:1440,height:900});
  await page.evaluate(async()=>{
    const p=v.plugin,files=p.app.vault.getFiles(),study=v.owner('l-os-study'),recall=v.owner('l-os-recall');
    window.knowledgeOriginal={read:p.app.vault.cachedRead,cache:p.app.metadataCache.getFileCache,books:p.courseBooksFor,records:study.engine.data.records,reveal:study.revealCard,recall:{list:recall.list,add:recall.add,remove:recall.remove,review:recall.review}};
    const base='03 知识库/我的课程/2026-27/课堂笔记/060112 化工过程计算/';
    window.knowledgeFixtures=[{path:base+'2026-09-22 化工过程计算.md',basename:'2026-09-22 化工过程计算',extension:'md',stat:{mtime:Date.now()+10000}},
      {path:base+'2026-09-21 化工过程计算.md',basename:'2026-09-21 化工过程计算',extension:'md',stat:{mtime:Date.now()+9000}},
      {path:'教材/化工过程.pdf',basename:'化工过程',extension:'pdf',stat:{mtime:1}}];
    files.push(...knowledgeFixtures);
    p.app.vault.cachedRead=async f=>knowledgeFixtures.includes(f)?'# 物料衡算\n\n质量守恒\n\n'+('完整推导。'.repeat(600)):knowledgeOriginal.read(f);
    p.app.metadataCache.getFileCache=f=>knowledgeFixtures.includes(f)?{frontmatter:{type:'class-note',course:'060112'}}:knowledgeOriginal.cache(f);
    p.courseBooksFor=c=>c.id==='060112'?[knowledgeFixtures[2].path]:[];
    study.engine.data.records={[knowledgeFixtures[2].path]:{updatedAt:1,annotations:[{id:'abc-1234',page:7,kind:'question',note:'系统边界如何确定？'}]}};
    study.revealCard=async(path,id)=>{window.knowledgeRevealed={path,id};};
    window.knowledgeQueue=[];
    recall.list=()=>knowledgeQueue;
    recall.add=async key=>{if(!knowledgeQueue.some(c=>c.key===key))knowledgeQueue.push({key,...recallKeys.splitKey(key),due:0,reviews:0});};
    recall.remove=async key=>{knowledgeQueue=knowledgeQueue.filter(c=>c.key!==key);};
    recall.review=key=>{window.knowledgeReviewed=key;};
    window.knowledgeTask={id:'knowledge-task',text:'总结笔记 · 化工过程计算 · 09-22',path:'01 收件箱/总结.md',tags:'课堂笔记/2026-09-22/060112',done:false};
    fixtureTasks.push(knowledgeTask);
    await v.showKnowledge('060112');
  });
  assert.equal(await page.locator('.os-note-row').count(),3);
  assert.match(await page.locator('.os-knowledge-connections').innerText(),/待完成 · 总结笔记/);
  assert.ok((await page.locator('.os-knowledge-markdown').innerText()).length>1800);
  await page.getByRole('button',{name:'翻页阅读',exact:true}).click();
  assert.match(await page.evaluate(()=>openedPath),/2026-09-22/);
  await page.getByRole('button',{name:'加入复习',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'开始回忆',exact:true}).count(),1);
  await page.getByRole('button',{name:'开始回忆',exact:true}).click();
  assert.match(await page.evaluate(()=>knowledgeReviewed),/2026-09-22/);
  await page.getByRole('button',{name:'在总结笔记中查看',exact:true}).click();
  assert.equal(await page.locator('.os-summary-row').count(),1);
  await page.evaluate(()=>v.showKnowledge('060112',knowledgeFixtures[0].path));
  assert.match(await page.locator('.os-note-detail h2').innerText(),/2026-09-22/);
  await page.evaluate(async()=>{knowledgeTask.done=true;await v.refresh(true);});
  assert.match(await page.locator('.os-knowledge-connections').innerText(),/已完成 · 总结笔记/);
  await page.getByLabel('知识类型',{exact:true}).selectOption('question');
  assert.equal(await page.locator('.os-note-row').count(),1);
  await page.getByRole('button',{name:'返回教材原文',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>knowledgeRevealed),{path:'教材/化工过程.pdf',id:'abc-1234'});
  await page.getByRole('button',{name:'加入复习',exact:true}).click();
  assert.ok(await page.evaluate(()=>knowledgeQueue.some(c=>c.key==='教材/化工过程.pdf#abc-1234')));
  await page.getByRole('button',{name:'移出复习',exact:true}).click();
  assert.equal(await page.evaluate(()=>knowledgeQueue.filter(c=>c.cardId).length),0);
  await page.getByLabel('知识复习状态',{exact:true}).selectOption('due');
  assert.equal(await page.locator('.os-note-row').count(),0);
  await page.getByRole('button',{name:'清除筛选',exact:true}).click();
  await page.getByLabel('知识课程',{exact:true}).selectOption('060112');
  await page.getByLabel('搜索知识',{exact:true}).fill('系统边界');
  assert.equal(await page.locator('.os-note-row').count(),1);
  await page.getByLabel('搜索知识',{exact:true}).fill('');
  await page.getByLabel('知识类型',{exact:true}).selectOption('class');
  for(const theme of ['light','dark'])for(const width of [1440,760,420,320]){
    await page.setViewportSize({width,height:900});await page.evaluate(t=>document.body.className=t==='dark'?'theme-dark':'',theme);
    const back=page.getByRole('button',{name:'← 返回列表',exact:true});if(await back.isVisible())await back.click();
    await page.locator('.os-note-row').first().click();
    const size=await page.locator('.os-note-detail').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth,visible:getComputedStyle(e).display!=='none'}));
    assert.ok(size.visible&&size.scroll<=size.width+1,JSON.stringify({theme,width,size}));
    if(width===1440||width===420)await page.screenshot({path:path.join(out,`knowledge-${theme}-${width}.png`)});
    if(width<=420){await back.click();assert.ok(await page.locator('.os-note-list').isVisible());}
  }
  await page.setViewportSize({width:1440,height:900});
  // Delete and rename must be reflected by the next snapshot; asynchronous old reads cannot restore a removed selection.
  await page.evaluate(async()=>{const files=v.plugin.app.vault.getFiles();files.splice(files.indexOf(knowledgeFixtures[0]),1);await v.refresh(true);});
  assert.equal(await page.locator('.os-note-row').count(),1);
  assert.match(await page.locator('.os-note-detail h2').innerText(),/2026-09-21/);
  await page.getByRole('button',{name:'清除筛选',exact:true}).click();
  await page.getByRole('button',{name:'下一页',exact:true}).click();
  assert.match(await page.locator('.os-pagination').innerText(),/2 \/ 2/);
  // A reverse jump from recall can target an entry beyond the first page.
  const target=await page.locator('.os-note-row').last().getAttribute('data-key');
  await page.evaluate(key=>v.showKnowledge('',key),target);
  assert.equal(await page.locator('.os-note-row.is-active').getAttribute('data-key'),target);
  await page.getByRole('button',{name:'上一页',exact:true}).click();
  assert.match(await page.locator('.os-pagination').innerText(),/1 \/ 2/);
  await page.evaluate(async()=>{
    window.knowledgeGetPlugin=v.plugin.app.plugins.getPlugin;
    v.plugin.app.plugins.getPlugin=id=>['l-os-capture','l-os-recall','l-os-study'].includes(id)?null:knowledgeGetPlugin(id);
    await v.refresh(true);
  });
  assert.ok(await page.getByRole('button',{name:'新建笔记',exact:true}).isDisabled());
  assert.ok(await page.getByRole('button',{name:'加入复习',exact:true}).isDisabled());
  await page.evaluate(()=>{v.plugin.app.plugins.getPlugin=knowledgeGetPlugin;});
  await page.evaluate(async()=>{
    const p=v.plugin,files=p.app.vault.getFiles(),study=v.owner('l-os-study');
    for(const file of knowledgeFixtures){const at=files.indexOf(file);if(at>=0)files.splice(at,1);}
    fixtureTasks.splice(fixtureTasks.indexOf(knowledgeTask),1);
    p.app.vault.cachedRead=knowledgeOriginal.read;p.app.metadataCache.getFileCache=knowledgeOriginal.cache;p.courseBooksFor=knowledgeOriginal.books;
    study.engine.data.records=knowledgeOriginal.records;study.revealCard=knowledgeOriginal.reveal;
    Object.assign(v.owner('l-os-recall'),knowledgeOriginal.recall);v.knowledgeState=null;document.body.className='';await v.setTab('today');
  });
};
