"use strict";
/*
 * 周五自测：左栏与知识地图平级的一项。
 * 入口按课程列本周题库；作答一题一屏，每答一题立即写进作答文件；答完一门出结果，并把档位写回知识地图。
 * 判分、换算都在 quiz-model.js，这里只管界面。没有角标、没有倒计时。
 */
const {Notice}=require('obsidian');
const {el,btn}=require('../shared/dom');
const {renderMarkdown,markdownOwner}=require('../l-os-study/core/markdown-render');
const {LEVELS}=require('./learning-hub-model');
const Q=require('./quiz-model');
const Mastery=require('./mastery');
const KStore=require('./knowledge-store');
const QStore=require('./quiz-store');
const action=(parent,label,fn,cls='os-quiet')=>btn(parent,label,fn,`os-button ${cls}`,e=>new Notice(e.message));
async function openSource(plugin,source){await plugin.open(source.path);await plugin.app.workspace.openLinkText(`${source.path}#${source.heading}`,'',false);}
const TYPE={single:'单选',multiple:'多选（全部选对才算对）',truefalse:'判断',numeric:'数值'};

/** 一门课的作答进度：首次作答了几题；重做时另算。 */
function progress(doc,block){
  const first=Q.firstAttempts(doc,block.course),answered=block.questions.filter(q=>first[q.id]);
  const scored=answered.filter(q=>!first[q.id].flagged);
  return {first,answered:answered.length,total:block.questions.length,done:answered.length===block.questions.length,
    correct:scored.filter(q=>Q.isCorrect(q,first[q.id])).length,scored:scored.length};
}
/** 把一次作答写成人读的话。 */
function describe(q,r){
  if(!r)return '未作答';
  if(r.flagged&&!r.choice&&r.value==null&&r.bool==null&&r.unsure)return '标为有问题，跳过';
  if(r.unsure)return '不确定';
  if(q.type==='numeric')return `${r.value} ${q.unit==='—'?'':q.unit}`.trim();
  if(q.type==='truefalse')return r.bool?'正确':'错误';
  return (r.choice||[]).map(i=>q.options[i]).join('；');
}
function correctText(q){
  if(q.type==='numeric')return `${q.answer.value} ${q.unit==='—'?'':q.unit}`.trim();
  if(q.type==='truefalse')return q.answer?'正确':'错误';
  return q.answer.map(i=>q.options[i]).join('；');
}

async function renderQuiz(view){
  const p=view.plugin,generation=view.generation,alive=()=>!view.closed&&view.generation===generation;
  const state=view.quizState||={week:'',course:'',redo:null};
  const panel=view.panel(view.content,'周五自测','','os-fill os-quiz-panel');panel.body.classList.add('os-quiz-body');
  const owner=markdownOwner();view.quizCleanup=()=>owner.unload();
  const md=(target,text,path='')=>renderMarkdown(p.app,owner,target,text,path);
  const weeks=QStore.quizWeeks(view.snapshot.files),thisWeek=Mastery.isoWeek();
  const week=state.week||thisWeek;
  const {graphs}=await KStore.loadGraphs(p,view.snapshot.files);if(!alive())return;
  const loaded=await QStore.loadQuiz(p,week,graphs);if(!alive())return;
  if(!loaded){
    view.pageStatusEl.textContent=week;
    view.empty(panel.body,'本周还没有出题','周五总结完本周笔记后，让 agent 出题；题库放进「03 知识库/周五自测」就会出现在这里。');
    const past=weeks.filter(w=>w!==week);
    if(past.length){const row=el(panel.body,'p','os-quiz-past','以前的题：');for(const w of past.slice(0,4))action(row,w,async()=>{Object.assign(state,{week:w,course:'',redo:null});await draw();});}
    return;
  }
  if(loaded.errors.length){
    view.pageStatusEl.textContent=`${week} · 题库没通过检查`;
    const box=el(panel.body,'div','os-map-warning');el(box,'p','',`题库 ${loaded.path} 没通过检查，先不加载。让 agent 修好后运行 node tools/check-quiz.cjs。`);for(const e of loaded.errors.slice(0,20))el(box,'p','',e);
    return;
  }
  const quiz=loaded.quiz;
  let latest=new Map();try{latest=Mastery.latestByConcept((await KStore.readMastery(p)).records);}catch(e){new Notice('掌握度记录读不出来：'+e.message);}
  let doc;try{doc=await QStore.readAnswers(p,week);}catch(e){view.empty(panel.body,'作答文件读不出来',e.message);return;}
  if(!alive())return;
  async function draw(){if(alive())await view.refresh(true);}

  // ---- 入口：本周题库按课程分组 ----
  if(!state.course){
    const total=quiz.courses.reduce((n,c)=>n+c.questions.length,0);
    view.pageStatusEl.textContent=`${week} · ${quiz.courses.length} 门课 · ${total} 题`;
    if(week!==thisWeek){const back=el(panel.body,'p','os-quiz-past',`正在看 ${week} 的题。`);action(back,'回到本周',async()=>{Object.assign(state,{week:'',course:''});await draw();});}
    const grid=el(panel.body,'div','os-quiz-courses');
    for(const block of quiz.courses){
      const g=graphs.get(block.course),pr=progress(doc,block);
      const card=el(grid,'section','os-quiz-course');
      el(card,'span','os-overline',block.course);el(card,'h3','',g?.title||block.course);
      el(card,'p','os-muted',pr.done?`首次作答 ${pr.correct} / ${pr.scored} 对`:pr.answered?`已答 ${pr.answered} / ${pr.total}`:`${pr.total} 题 · 概念 ${block.questions.filter(q=>q.level==='concept').length} · 应用 ${block.questions.filter(q=>q.level==='application').length}`);
      const bar=el(card,'span','os-quiz-progress');el(bar,'i').style.width=`${Math.round(pr.answered/pr.total*100)}%`;
      action(card,pr.done?'查看结果':pr.answered?'继续':'开始',async()=>{Object.assign(state,{course:block.course,redo:null});await draw();},pr.done?'os-quiet':'os-primary');
    }
    return;
  }

  const block=quiz.courses.find(c=>c.course===state.course);
  if(!block){state.course='';return draw();}
  const graph=graphs.get(block.course),title=graph?.title||block.course,conceptTitle=id=>graph?.concepts.find(c=>c.id===id)?.title||id;
  action(panel.tools,'← 全部课程',async()=>{Object.assign(state,{course:'',redo:null});await draw();});
  const pr=progress(doc,block);

  // ---- 作答：首次作答没做完，或正在重做 ----
  const redoing=state.redo!=null&&state.redo<block.questions.length;
  if(!pr.done||redoing){
    const index=redoing?state.redo:block.questions.findIndex(q=>!pr.first[q.id]);
    const q=block.questions[index],shownAt=Date.now();
    view.pageStatusEl.textContent=`${title} · 第 ${index+1} 题 / 共 ${block.questions.length} 题${redoing?' · 重做练习，不计分':''}`;
    const card=el(panel.body,'article','os-quiz-card');card.dataset.scroll='quiz-card';
    const meta=el(card,'p','os-overline',`${TYPE[q.type]} · ${q.concepts.map(conceptTitle).join('、')}`);meta.title=q.level==='concept'?'概念题':'应用题';
    md(el(card,'div','os-quiz-stem'),q.stem,q.source.path);
    const answer=el(card,'div','os-quiz-answer');
    let response=null;const confirmRow=el(card,'div','os-quiz-actions');
    const submit=async(r,flagged=false)=>{
      const attempt={course:block.course,question:q.id,response:r,at:new Date().toISOString(),seconds:Math.round((Date.now()-shownAt)/1000),first:!redoing,...(flagged?{flagged:true}:{})};
      await QStore.recordAttempt(p,week,attempt);
      if(redoing)state.redo++;
      await draw();
    };
    const choices=[];
    const setChoice=(value,multi)=>{
      if(multi){const set=new Set(response?.choice||[]);set.has(value)?set.delete(value):set.add(value);response={choice:[...set]};}
      else response=q.type==='truefalse'?{bool:value}:{choice:[value]};
      for(const [v,b] of choices){const on=q.type==='truefalse'?response.bool===v:(response.choice||[]).includes(v);b.classList.toggle('is-selected',on);b.setAttribute('aria-pressed',String(on));}
      confirm.disabled=q.type==='multiple'?!(response.choice||[]).length:false;
    };
    if(q.type==='single'||q.type==='multiple'){
      // 选项顺序按「周 / 课 / 题号」稳定打乱：避开 agent 爱把答案放第一个的偏好，续做时顺序不变。
      for(const i of Q.shuffledOrder(q.options.length,`${week}/${block.course}/${q.id}`)){
        const b=el(answer,'button','os-quiz-option');b.type='button';b.setAttribute('aria-pressed','false');md(el(b,'span'),q.options[i],q.source.path);
        b.addEventListener('click',()=>setChoice(i,q.type==='multiple'));choices.push([i,b]);
      }
    }else if(q.type==='truefalse'){
      for(const [label,v] of [['正确',true],['错误',false]]){const b=el(answer,'button','os-quiz-option is-short',label);b.type='button';b.setAttribute('aria-pressed','false');b.addEventListener('click',()=>setChoice(v));choices.push([v,b]);}
    }else{
      const row=el(answer,'label','os-quiz-numeric');const input=el(row,'input','os-input');input.type='text';input.inputMode='decimal';input.placeholder='填数字';input.setAttribute('aria-label','你的答案');
      if(q.unit&&q.unit!=='—')el(row,'span','os-muted',q.unit);
      input.addEventListener('input',()=>{const v=Number(input.value.replace(',','.').replace(/[−–]/g,'-'));response=input.value.trim()&&Number.isFinite(v)?{value:v}:null;confirm.disabled=!response;});
      input.addEventListener('keydown',e=>{if(e.key==='Enter'&&response){e.preventDefault();confirm.click();}});
      setTimeout(()=>input.focus(),0);
    }
    action(confirmRow,'不确定',()=>submit({unsure:true}),'os-quiet os-quiz-unsure').title='按没掌握算，不去赌';
    action(confirmRow,'这题有问题',()=>submit({unsure:true},true),'os-quiet').title='标记后这题不计分，下次出题时避开';
    const confirm=action(confirmRow,index+1===block.questions.length?'提交，看结果':'下一题',()=>response&&submit(response),'os-primary');confirm.disabled=true;
    // 键盘：数字键选第几个选项，Enter 确认。
    card.tabIndex=-1;card.addEventListener('keydown',e=>{if(e.target.tagName==='INPUT')return;const n=Number(e.key);if(n>=1&&n<=choices.length){e.preventDefault();choices[n-1][1].click();}else if(e.key==='Enter'&&!confirm.disabled){e.preventDefault();confirm.click();}});
    setTimeout(()=>{if(q.type!=='numeric')card.focus({preventScroll:true});},0);
    return;
  }

  // ---- 结果：判分（第一次进来时），写回掌握度，列出每题 ----
  let graded=doc.graded?.[block.course];
  if(!graded){graded=await QStore.gradeCourse(p,week,block,latest);if(!alive())return;}
  state.redo=null;
  view.pageStatusEl.textContent=`${title} · 首次作答 ${pr.correct} / ${pr.scored} 对`;
  const top=el(panel.body,'section','os-quiz-summary');
  const flagged=block.questions.filter(q=>pr.first[q.id]?.flagged).length;
  el(top,'h2','',`${pr.correct} / ${pr.scored} 对`);
  if(flagged)el(top,'p','os-muted',`${flagged} 题标为有问题，不计分。`);
  const changes=Object.entries(graded.levels||{});
  if(changes.length){
    el(top,'h3','','掌握度变化');const list=el(top,'div','os-quiz-changes');
    for(const [c,level] of changes){const from=graded.before?.[c]||'unknown',row=action(list,'',()=>view.showMap(block.course,c),'os-quiz-change');
      el(row,'span','os-quiz-change-title',conceptTitle(c));const m=el(row,'span',`os-quiz-change-level${from===level?' is-same':''}`);
      el(m,'span',`os-mastery-mark is-${from}`,from==='review'?'!':'');el(m,'span','',LEVELS[from]);el(m,'span','os-muted','→');el(m,'span',`os-mastery-mark is-${level}`,level==='review'?'!':'');el(m,'span','',LEVELS[level]);}
  }
  const tools=el(top,'div','os-detail-actions');
  action(tools,'重做练习',async()=>{state.redo=0;await draw();}).title='重做不改掌握度，只算第一次';
  action(tools,'去知识地图',()=>view.showMap(block.course),'os-quiet');
  const latestRedo=id=>[...doc.attempts].reverse().find(a=>a.course===block.course&&a.question===id&&!a.first&&!a.flagged);
  const list=el(panel.body,'div','os-quiz-results');list.dataset.scroll='quiz-results';
  block.questions.forEach((q,i)=>{
    const r=pr.first[q.id],ok=!r?.flagged&&Q.isCorrect(q,r),item=el(list,'article',`os-quiz-result ${r?.flagged?'is-flagged':ok?'is-right':'is-wrong'}`);
    const head=el(item,'div','os-quiz-result-head');
    el(head,'span','os-quiz-mark',r?.flagged?'—':ok?'✓':r?.unsure?'?':'✗').setAttribute('aria-label',r?.flagged?'有问题，不计分':ok?'答对':r?.unsure?'不确定':'答错');
    el(head,'strong','',`第 ${i+1} 题`);el(head,'span','os-muted',`${q.level==='concept'?'概念题':'应用题'} · ${q.concepts.map(conceptTitle).join('、')}`);
    md(el(item,'div','os-quiz-stem'),q.stem,q.source.path);
    const answers=el(item,'dl','os-quiz-compare');
    el(answers,'dt','','你的答案');md(el(answers,'dd'),describe(q,r),q.source.path);
    el(answers,'dt','','正确答案');md(el(answers,'dd'),correctText(q),q.source.path);
    const redo=latestRedo(q.id);if(redo){el(answers,'dt','','重做');el(answers,'dd','',`${describe(q,redo.response)} ${Q.isCorrect(q,redo.response)?'✓':'✗'}`);}
    md(el(item,'div','os-quiz-explanation'),q.explanation,q.source.path);
    const row=el(item,'div','os-detail-actions');
    action(row,'看课堂笔记原文',()=>openSource(p,q.source));
    if(!r?.flagged)action(row,'这题有问题',async()=>{
      await QStore.recordAttempt(p,week,{course:block.course,question:q.id,response:r||{unsure:true},at:new Date().toISOString(),seconds:0,first:false,flagged:true});
      await QStore.gradeCourse(p,week,block,latest);
      new Notice(`第 ${i+1} 题已标为有问题，不再计分；掌握度已重算。`);await draw();
    }).title='答案或题目有错时用：这题不计分，下次出题时 agent 会避开';
    else el(row,'span','os-muted','已标为有问题，不计分');
  });
}
module.exports={renderQuiz,progress,describe,correctText};
