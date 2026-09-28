const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const legibility=require('./legibility.cjs');
// 周五自测：用库里真实的 2026-W39 题库和四份图谱，完整做一门静力学。接在 learning-hub-visual.cjs 之后跑（沿用它的文件夹具）。
module.exports=async function quizChecks(page,out){
  const vault=path.resolve(__dirname,'../..');
  const rels=['03 知识库/知识地图/060112 化工过程计算.json','03 知识库/知识地图/086552 电工学.json','03 知识库/知识地图/089257 流体力学与化工基础.json','03 知识库/周五自测/2026-W39.json'];
  const quiz=JSON.parse(fs.readFileSync(path.join(vault,rels[3]),'utf8')),statics=quiz.courses.find(c=>c.course==='057274');
  await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>document.body.className='');
  await page.evaluate(async fixtures=>{
    const files=v.plugin.app.vault.getFiles();
    for(const f of fixtures){const file={path:f.path,basename:f.path.split('/').pop().replace(/\.json$/,''),extension:'json',stat:{mtime:Date.parse('2026-09-25T12:00:00Z'),size:f.body.length},body:f.body};files.push(file);hubFiles.push(file);}
    // 题库按真实日期找本周；测试固定在 W39，过了这周也照样跑。
    v.quizState={week:'2026-W39',course:'',redo:null};await v.setTab('quiz');
  },rels.map(rel=>({path:rel,body:fs.readFileSync(path.join(vault,rel),'utf8')})));
  assert.equal(await page.locator('.os-nav-button').filter({hasText:'周五自测'}).count(),1);
  assert.equal(await page.locator('.os-quiz-course').count(),4);
  assert.match(await page.locator('.os-page-status').innerText(),/2026-W39 · 4 门课 · 40 题/);
  await page.screenshot({path:path.join(out,'quiz-home.png')});

  // ---- 做静力学：q01 答错、q05 选不确定、q10 答错，其余答对 ----
  await page.locator('.os-quiz-course').filter({hasText:'静力学'}).getByRole('button',{name:'开始'}).click();
  const plan={q01:'wrong',q05:'unsure',q10:'wrong'};
  for(const q of statics.questions){
    await page.waitForSelector('.os-quiz-card');
    assert.match(await page.locator('.os-page-status').innerText(),new RegExp(`第 ${Number(q.id.slice(1))} 题 / 共 10 题`));
    const how=plan[q.id]||'right';
    if(how==='unsure'){await page.getByRole('button',{name:'不确定',exact:true}).click();continue;}
    if(q.type==='numeric')await page.locator('.os-quiz-numeric input').fill(String(how==='right'?q.answer.value:q.answer.value*2));
    else if(q.type==='truefalse')await page.locator('.os-quiz-option').filter({hasText:(how==='right')===q.answer?'正确':'错误'}).click();
    else{const pick=how==='right'?q.answer:[q.options.findIndex((_,i)=>!q.answer.includes(i))];for(const i of pick)await page.locator('.os-quiz-option').filter({hasText:q.options[i]}).first().click();}
    if(q.id==='q03')await page.screenshot({path:path.join(out,'quiz-question.png')});
    if(q.id==='q01'){
      const stable=await page.evaluate(async()=>{
        const card=document.querySelector('.os-quiz-card'),selected=card.querySelector('.is-selected'),generation=v.generation;
        let mutations=0;const observer=new MutationObserver(rows=>mutations+=rows.length);
        observer.observe(card.parentElement,{childList:true,subtree:true});
        for(let i=0;i<5;i++){await v.refresh();v.tick();}
        await Promise.resolve();observer.disconnect();
        return {same:card===document.querySelector('.os-quiz-card'),selected:selected===document.querySelector('.os-quiz-option.is-selected'),generation:v.generation===generation,mutations,enabled:!card.querySelector('.os-primary').disabled};
      });
      assert.deepEqual(stable,{same:true,selected:true,generation:true,mutations:0,enabled:true},'后台刷新保留题面、公式节点和未提交选项');
    }
    await page.locator('.os-quiz-actions .os-primary').click();
  }
  // ---- 结果页：首次作答 7/10；五个概念的档位变化；写进掌握度 ----
  await page.waitForSelector('.os-quiz-summary');
  assert.equal(await page.locator('.os-quiz-summary h2').innerText(),'7 / 10 对');
  assert.equal(await page.locator('.os-quiz-result.is-right').count(),7);
  assert.equal(await page.locator('.os-quiz-result.is-wrong').count(),3);
  const change=title=>page.locator('.os-quiz-change').filter({hasText:title}).locator('.os-quiz-change-level').innerText();
  // 需巩固的图标里有个叹号，innerText 会带上它
  assert.match(await change('分布荷载的合力与作用点'),/待自评\s*→\s*!?\s*需巩固/);
  assert.match(await change('静水压力'),/→\s*能应用/);
  assert.match(await change('刚体平衡方程'),/→\s*!?\s*需巩固/);
  assert.match(await change('约束、反力与自由体图'),/→\s*已理解/);
  assert.match(await change('二力体'),/→\s*已理解/);
  const records=()=>page.evaluate(()=>JSON.parse(hubFiles.find(f=>f.path==='03 知识库/知识地图/掌握度.json').body).records);
  const quizRecords=(await records()).filter(r=>r.source==='quiz');
  assert.equal(quizRecords.length,5);
  assert.deepEqual(quizRecords.find(r=>r.concept==='c-distributed-load').basis,{week:'2026-W39',questions:[['q01',false],['q02',true]]});
  const answers=await page.evaluate(()=>JSON.parse(hubFiles.find(f=>f.path==='03 知识库/周五自测/2026-W39 作答.json').body));
  assert.equal(answers.attempts.filter(a=>a.course==='057274'&&a.first).length,10);
  await page.screenshot({path:path.join(out,'quiz-result.png'),fullPage:false});
  // 同一份自测记录立即汇入学习进展，再从进展返回该课程的自测结果。
  await page.evaluate(()=>v.showOutcomes('057274'));
  assert.match(await page.locator('.os-progress-course').innerText(),/自测 · 能应用/);
  assert.match(await page.locator('.os-progress-course').innerText(),/静水压力/);
  assert.match(await page.locator('.os-progress-course').innerText(),/待补强/);
  await page.screenshot({path:path.join(out,'learning-progress-tested.png')});
  await page.getByRole('button',{name:'去自测补强',exact:true}).click();
  // UI 默认进入本周；夹具固定 W39，避免测试随日历失效。
  await page.evaluate(async()=>{v.quizState.week='2026-W39';await v.refresh(true);});
  await page.waitForSelector('.os-quiz-summary');

  // ---- 标「这题有问题」：q01 不再计分，分布荷载只剩 q02（应用题，对）→ 能应用 ----
  await page.locator('.os-quiz-result').first().getByRole('button',{name:'这题有问题'}).click();
  await page.waitForFunction(()=>document.querySelector('.os-quiz-summary h2')?.textContent==='7 / 9 对');
  assert.match(await change('分布荷载的合力与作用点'),/待自评\s*→\s*能应用/);
  const latestDl=(await records()).filter(r=>r.concept==='c-distributed-load').at(-1);
  assert.equal(latestDl.level,'applied');
  assert.equal(await page.locator('.os-quiz-result.is-flagged').count(),1);

  // ---- 重做：不计分，掌握度不变 ----
  const before=(await records()).length;
  await page.getByRole('button',{name:'重做练习',exact:true}).click();
  assert.match(await page.locator('.os-page-status').innerText(),/重做练习，不计分/);
  await page.getByRole('button',{name:'不确定',exact:true}).click();
  await page.getByRole('button',{name:'← 全部课程',exact:true}).click();
  assert.equal((await records()).length,before);
  assert.match(await page.locator('.os-quiz-course').filter({hasText:'静力学'}).innerText(),/首次作答 7 \/ 9 对/);

  // ---- 续做：答三题离开，卡片写「已答 3 / 10」，继续从第 4 题开始；键盘数字键选选项 ----
  await page.locator('.os-quiz-course').filter({hasText:'电工学'}).getByRole('button',{name:'开始'}).click();
  for(let i=0;i<3;i++){await page.waitForSelector('.os-quiz-card');await page.getByRole('button',{name:'不确定',exact:true}).click();}
  await page.getByRole('button',{name:'← 全部课程',exact:true}).click();
  const elec=page.locator('.os-quiz-course').filter({hasText:'电工学'});
  assert.match(await elec.innerText(),/已答 3 \/ 10/);
  await elec.getByRole('button',{name:'继续'}).click();
  assert.match(await page.locator('.os-page-status').innerText(),/第 4 题/);
  // 第 4 题是数值题：输入后按 Enter 提交；第 5 题单选：数字键选第几个选项
  await page.locator('.os-quiz-numeric input').fill('6');
  await page.locator('.os-quiz-card').focus();
  await page.evaluate(()=>v.refresh());
  assert.equal(await page.locator('.os-quiz-numeric input').inputValue(),'6','输入框失焦后后台刷新仍保留答案');
  await page.locator('.os-quiz-numeric input').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>/第 5 题/.test(document.querySelector('.os-page-status')?.textContent||''));
  await page.locator('.os-quiz-card').focus();await page.keyboard.press('1');
  assert.equal(await page.locator('.os-quiz-option.is-selected').count(),1);

  // ---- 可读性：题干、选项、按钮压在壁纸上 ----
  const rows=await legibility.measure(page,{anchors:[["题干",".os-quiz-stem","玻璃卡"],["选项",".os-quiz-option:not(.is-selected)","实色选项"],["选中选项",".os-quiz-option.is-selected","实色选项"],["题目说明",".os-quiz-card .os-overline","玻璃卡"]],minAnchors:4});
  const {bad,worst}=legibility.report(rows);
  if(bad.length)assert.fail(`可读性闸门（周五自测）：${bad.length} 处低于 ${legibility.MIN}\n`+bad.slice(0,10).map(r=>`  ${r.theme} / ${r.backdrop} / ${r.name} = ${r.value.toFixed(2)}`).join('\n'));
  console.log(`可读性（周五自测）：${rows.length} 次取样全部达标，最难的一处 ${worst.theme==='light'?'浅':'深'} / ${worst.backdrop} / ${worst.name} = ${worst.value.toFixed(2)}`);

  // ---- 知识地图跟着变：分布荷载节点变成「能应用」，依据写自测题号 ----
  await page.evaluate(async()=>{v.plugin.data.knowledgeView.mode['057274']='mind';await v.showMap('057274','c-distributed-load');});
  await page.waitForSelector('.os-mind-node[data-id="c-distributed-load"].is-applied');
  assert.match(await page.locator('.os-mind-card .os-concept-basis').innerText(),/自测 第2题 ✓/);
  assert.equal(await page.locator('.os-mind-node[data-id="c-rigid-equilibrium"].is-review').count(),1);

  // ---- 四种宽度 × 深浅色不横向溢出 ----
  for(const theme of ['light','dark'])for(const width of [1440,760,420,320]){
    await page.setViewportSize({width,height:900});await page.evaluate(t=>document.body.className=t==='dark'?'theme-dark':'',theme);
    for(const screen of ['home','question','result']){
      await page.evaluate(async screen=>{v.quizState={week:'2026-W39',course:screen==='home'?'':screen==='question'?'086552':'057274',redo:null};await v.setTab('quiz');},screen);
      const dims=await page.locator('.os-quiz-body').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth}));
      assert.ok(dims.scroll<=dims.width+1,JSON.stringify({theme,width,screen,dims}));
      if(width===1440||width===420)await page.screenshot({path:path.join(out,`quiz-${screen}-${theme}-${width}.png`)});
    }
  }
  await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>document.body.className='');
};
