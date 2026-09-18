const {Notice}=require('obsidian');
const {el,button}=require('./study-ui.js');
const {renderMarkdown,markdownOwner}=require('./markdown-render.js');
const {toObsidianMarkdown,hasMath,changesOnPaste}=require('./formula-model.js');

/**
 * 右栏速记板，接替 5.5 的手写板。
 *
 * 平板上的笔没有压感、接触面积被钳死（5.4.1–5.4.5 测过），手写出来的公式比原书还难认；
 * 而看讲义、问 AI 时手上本来就有排好的文本——只是定界符是 \( \) 和 \[ \]，
 * 直接贴进 Obsidian 只能看到满屏反斜杠。
 *
 * 这里把粘贴的一整段（夹着中文、列表、多段公式的那种）翻译成 Markdown 再整段渲染：
 * 看到的是排好版的公式和文字，不是源码。也可以接着打字，边打边看。
 */

function mountFormulaPad(engine:any,ctx:any,parent:HTMLElement) {
  const currentPage=()=>Number(ctx.pdf?.currentPageNumber)||1;
  const sourcePath=engine.notePath(ctx.path);
  const wrap=el(parent,'div','cs-formula-wrap');

  const input=el(wrap,'textarea','cs-formula-input') as HTMLTextAreaElement;
  input.rows=4;
  // 提示话写在 placeholder 里，不占一条常驻的横栏：
  // 面板窄到 260px 时，那条提示会把按钮挤成换行的碎字。
  input.placeholder='粘贴讲义或 AI 回答：\\( \\) 与 \\[ \\] 会自动换成 Obsidian 的公式写法，下方直接排好版。也可以接着打字。';
  input.setAttribute('aria-label','速记源码');
  input.spellcheck=false;

  // 动作行紧跟输入框，排在预览上方：粘一整段讲义下来预览能有两千像素高，
  // 按钮跟在后面就得一路滚到底才按得到，而底部又正好压在状态栏下面。
  const actions=el(wrap,'div','cs-formula-actions');
  const clear=button(actions,'清空',()=>{input.value='';renderPreview();input.focus();},'cw-link cs-formula-action');
  const save=button(actions,'存为卡片',async()=>{
    const note=toObsidianMarkdown(input.value);
    if(!note){new Notice('先粘贴或输入内容。');input.focus();return;}
    const page=currentPage();
    await engine.add(ctx.path,{page,note,kind:'highlight'});
    input.value='';renderPreview();render();
    // 切回附近笔记：新卡片就在那儿，比在这里再列一遍同样的内容诚实。
    ctx.setTab?.('notes');
    new Notice(`已存为第 ${page} 页的卡片。`);
  },'cw-primary cs-formula-save');
  clear.setAttribute('aria-label','清空速记内容');

  const preview=el(wrap,'div','cs-formula-preview');
  preview.setAttribute('aria-live','polite');
  preview.setAttribute('aria-label','排版预览');

  function renderPreview() {
    if(ctx.closed)return;
    const markdown=toObsidianMarkdown(input.value);
    if(!markdown){
      preview.replaceChildren();preview.classList.remove('markdown-rendered','is-raw');
      el(preview,'span','cs-formula-placeholder','排版预览');
      return;
    }
    renderMarkdown(engine.p.app,ctx.mdOwner,preview,markdown,sourcePath);
  }

  // 打字时不必每个键都重排一次：Markdown+MathJax 走一遍比一次按键贵得多。
  let timer:any=null;
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(renderPreview,220);};

  // 粘贴：只在真翻译了定界符时接管，否则交给浏览器默认行为（输入法、撤销栈都更完整）。
  input.addEventListener('paste',(event:ClipboardEvent)=>{
    const text=event.clipboardData?.getData('text/plain');
    if(!text||!changesOnPaste(text))return;
    event.preventDefault();
    input.setRangeText(toObsidianMarkdown(text),input.selectionStart||0,input.selectionEnd||0,'end');
    renderPreview();
  });
  input.addEventListener('input',schedule);
  input.addEventListener('keydown',(event:KeyboardEvent)=>{
    // Ctrl/Cmd+Enter 存卡片：和批注弹窗里的习惯一致。
    if(!event.isComposing&&event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();save.click();}
  });

  // 存到哪一页写在按钮上，而不是再添一条常驻的页码标签：
  // 按钮本来就该说清楚自己要干什么，翻页后看一眼就知道会挂到哪页。
  function render() {
    if(ctx.closed)return;
    const page=currentPage();
    save.textContent=`存到第 ${page} 页`;
    save.setAttribute('aria-label',`把当前内容存成第 ${page} 页的卡片`);
  }

  render();renderPreview();
  return {wrap,render,focus(){input.focus();},dispose(){clearTimeout(timer);}};
}

module.exports={mountFormulaPad};
