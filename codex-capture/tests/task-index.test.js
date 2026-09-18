const {test} = require('node:test');
const assert = require('node:assert/strict');
const {eligible,parse,update,select,TaskIndex} = require('../core/task-index');
test('索引只读取行动材料，排除模板、归档与代码围栏',()=>{
  for(const path of ['08 插件开发/docs/a.md','07 归档/a.md','99 模板/a.md','00 工作台/版本迭代.md'])assert.equal(eligible(path),false);
  assert.equal(eligible('02 项目/a.md'),true);
  const tasks=parse('---\ntitle: test\n- [ ] frontmatter\n---\n```markdown\n- [ ] example\n```\n~~~\n- [ ] example2\n~~~\n- [ ] actual 📅 2026-09-01 ⏫','02 项目/a.md');
  assert.equal(tasks.length,1);assert.equal(tasks[0].index,10);assert.equal(tasks[0].due,'2026-09-01');assert.equal(tasks[0].priority,2);
});
test('任务写回拒绝歧义，不覆盖并发修改，允许无歧义行号漂移',()=>{
  const content='heading\n- [ ] task\n',task=parse(content,'02 项目/a.md')[0];
  assert.match(update('inserted\n'+content,task,'done','2026-09-12'),/- \[x\] task <!-- done:2026-09-12 -->/);
  assert.throws(()=>update('changed\n- [ ] changed\n',task,'done'));
  assert.throws(()=>update('- [ ] task\nother\n- [ ] task',task,'done'));
  assert.equal(update(content,task,'today','2026-09-12'),'heading\n- [ ] task <!-- scheduled:2026-09-12 -->\n');
});
test('今天、逾期、完成状态与移出今天可以往返',()=>{
  const path='00 工作台/今日任务.md',source='- [ ] old task';
  const legacy=parse(source,path)[0];assert.ok(legacy.scheduled);
  const moved=update(source,legacy,'unschedule');assert.equal(parse(moved,path)[0].scheduled,'backlog');
  const tasks=parse('- [ ] later 📅 2026-10-01\n- [ ] due 📅 2026-09-01\n- [x] done\n- [ ] scheduled <!-- scheduled:2026-09-12 -->','02 项目/a.md');
  assert.equal(select(tasks,{filter:'today',today:'2026-09-12'}).length,2);
  assert.equal(select(tasks,{filter:'overdue',today:'2026-09-12'}).length,1);
  assert.equal(select(tasks,{filter:'done'}).length,1);
  const completed=update(source,legacy,'done');const reopened=update(completed,parse(completed,path)[0],'reopen');assert.equal(reopened,source);
});
test('任务缓存复用未变文件，编辑与删除后不会残留',async()=>{
  let reads=0;const file={path:'02 项目/a.md',stat:{mtime:1,size:12}},files=[file];let text='- [ ] one';
  const vault={getMarkdownFiles:()=>files,cachedRead:async()=>{reads++;return text;}};
  const index=new TaskIndex(vault);await index.all();await index.all();assert.equal(reads,1);
  text='- [ ] two';index.invalidate(file);assert.equal((await index.all())[0].text,'two');assert.equal(reads,2);
  files.pop();assert.deepEqual(await index.all(),[]);assert.equal(index.cache.size,0);
});
