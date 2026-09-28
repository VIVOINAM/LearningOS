const assert=require('node:assert/strict');
const path=require('node:path');
module.exports=async function summaryChecks(page,out){
  await page.evaluate(async()=>{
    const p=v.plugin,files=p.app.vault.getFiles();
    window.summaryFixtureOriginalRead=p.app.vault.cachedRead;
    window.summaryFixtureOriginalCache=p.app.metadataCache.getFileCache;
    const create=(name,course,body,date)=>({path:`03 知识库/我的课程/2026-27/课堂笔记/${course}/${name}.md`,basename:name,extension:'md',body,date,stat:{mtime:1}});
    window.summaryFixtures=[
      create('2026-09-23 电工学','086552 电工学','# 电工学\n\n## 今日要点\n\n基尔霍夫定律描述节点电流和回路电压之间的关系。\n\n## 课后总结\n\n先统一电流参考方向，再列出方程。','2026-09-23'),
      create('2026-09-22 流体力学与化工基础','089257 流体力学与化工基础','# 流体力学\n\n伯努利方程适用于沿流线的定常、不可压缩、无黏流动。\n\n## 易错点\n\n使用前检查条件。\n'+ '完整正文'.repeat(600),'2026-09-22'),
      create('未标日期','060112 化工过程计算','',''),
      create('_assets/附件说明','086552 电工学','不应出现','2026-09-24')
    ];files.push(...summaryFixtures);
    p.app.vault.cachedRead=async f=>summaryFixtures.includes(f)?f.body:summaryFixtureOriginalRead(f);
    p.app.metadataCache.getFileCache=f=>summaryFixtures.includes(f)?{frontmatter:{date:f.date}}:summaryFixtureOriginalCache(f);
    p.app.vault.getAbstractFileByPath=path=>files.find(f=>f.path===path);
    p.app.workspace.getLeaf=()=>({openFile:async(f,options)=>{window.summaryEdit={path:f.path,options};}});
    await v.setTab('summaries');
  });
  assert.equal(await page.locator('.os-summary-row').count(),3);
  assert.equal(await page.locator('.os-nav-button.is-active .os-nav-label').innerText(),'总结笔记');
  assert.match(await page.locator('.os-summary-heading').innerText(),/电工学/);
  await page.getByRole('button',{name:'在 Obsidian 中编辑 ↗'}).click();
  assert.equal(await page.evaluate(()=>summaryEdit.options.state.mode),'source');
  await page.getByLabel('搜索总结笔记',{exact:true}).fill('伯努利');
  assert.equal(await page.locator('.os-summary-row').count(),1);
  await page.waitForFunction(()=>document.querySelector('.os-summary-markdown')?.textContent.length>1800);
  assert.ok((await page.locator('.os-summary-markdown').innerText()).length>1800);
  // 无关后台刷新不得拆除正文、重排公式或丢失阅读位置。
  const stable = await page.evaluate(async()=>{
    document.activeElement?.blur();
    const detail=document.querySelector('.os-summary-detail');
    const body=detail.querySelector('.os-summary-markdown');
    detail.scrollTop=180;
    const top=detail.scrollTop;
    const observer=new MutationObserver(()=>{});
    observer.observe(detail,{childList:true,subtree:true,characterData:true});
    for(let i=0;i<3;i++)await v.refresh();
    const mutations=observer.takeRecords().length;observer.disconnect();
    return {same:body===document.querySelector('.os-summary-markdown'),top:detail.scrollTop,expected:top,mutations};
  });
  assert.equal(stable.same,true);assert.equal(stable.top,stable.expected);assert.equal(stable.mutations,0);
  await page.getByRole('button',{name:'清除筛选',exact:true}).click();
  await page.getByLabel('筛选课程',{exact:true}).selectOption('086552');
  await page.getByLabel('筛选日期',{exact:true}).fill('2026-09-22');
  assert.equal(await page.locator('.os-summary-row').count(),0);
  await page.getByRole('button',{name:'清除筛选',exact:true}).click();
  // Refresh must retain the current selection and pick up changed/deleted source files.
  await page.evaluate(async()=>{document.activeElement?.blur();summaryFixtures[0].body='修改后的课堂总结';summaryFixtures[0].stat.mtime++;await v.refresh();});
  await page.waitForFunction(()=>document.querySelector('.os-summary-markdown')?.textContent.includes('修改后的'));
  assert.match(await page.locator('.os-summary-markdown').innerText(),/修改后的/);
  await page.evaluate(async()=>{const files=v.plugin.app.vault.getFiles();files.splice(files.indexOf(summaryFixtures[0]),1);await v.refresh();});
  assert.equal(await page.locator('.os-summary-row').count(),2);
  assert.match(await page.locator('.os-summary-heading').innerText(),/流体力学/);
  await page.evaluate(async()=>{v.plugin.app.vault.getFiles().push(summaryFixtures[0]);await v.refresh(true);});
  for(const theme of ['light','dark'])for(const width of [1440,760,420,320]){
    await page.setViewportSize({width,height:800});await page.evaluate(t=>document.body.className=t==='dark'?'theme-dark':'',theme);
    if(width<=420 && await page.getByRole('button',{name:'← 返回列表',exact:true}).isVisible())await page.getByRole('button',{name:'← 返回列表',exact:true}).click();
    await page.locator('.os-summary-row').first().click();
    const sizes=await page.locator('.os-summary-detail').evaluate(e=>({scroll:e.scrollWidth,width:e.clientWidth,visible:getComputedStyle(e).display!=='none'}));
    assert.ok(sizes.visible&&sizes.scroll<=sizes.width+1,JSON.stringify({width,sizes}));
    if(width<=420){await page.getByRole('button',{name:'← 返回列表',exact:true}).click();assert.ok(await page.locator('.os-summary-list').isVisible());await page.locator('.os-summary-row').first().click();}
    if(width===1440||width===420)await page.screenshot({path:path.join(out,`summaries-${theme}-${width}.png`)});
  }
  await page.evaluate(async()=>{
    const p=v.plugin,files=p.app.vault.getFiles();for(const file of summaryFixtures){const at=files.indexOf(file);if(at>=0)files.splice(at,1);}
    await v.refresh(true);if(document.querySelectorAll('.os-summary-row').length)throw Error('删除后存在过期条目');
    p.app.vault.cachedRead=summaryFixtureOriginalRead;p.app.metadataCache.getFileCache=summaryFixtureOriginalCache;
    await v.setTab('today');
  });
};
