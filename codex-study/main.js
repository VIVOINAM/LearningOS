"use strict";
const {openReading}=require("../shared/open-reading");

const { Plugin, Notice, Modal } = require("obsidian");
const {el,button} = require('./core/study-ui');
const store = require("./core/study-store.js");
const { StudyEngine } = require("./core/study-engine.js");
const { setImmersive, dimPages } = require("./core/immersive.js");
const timerCore = require("../shared/timer-core.js");
const { ensureFile } = require("../shared/vault-utils.js");
const { cardReview } = require("./core/study-model.js");

const LEGACY_WORKBENCH_DATA = ".obsidian/plugins/codex-workbench/data.json";

function emptyTimer() {
  return timerCore.initial();
}

class CodexStudy extends Plugin {
  async onload() {
    this.queue = Promise.resolve();
    this.writeQueue = Promise.resolve();
    this.ready = false;
    this.engine = null;
    this.study = store.defaultStudy();
    const {StorageManager}=require('./core/storage-manager.ts');
    this.localStore=new StorageManager(this.app.vault);
    const local=await this.localStore.loadMetadata();

    try {
      const saved = local || await this.loadData();
      if (saved?.study) store.applyStudy(this.study, saved.study);
    } catch (error) {
      console.warn("codex-study: 读取自身数据失败，使用默认值。", error);
    }

    const plugin = this;
    this.storage = {
      study: this.study,
      get timer() {
        const focus = plugin.focus;
        return focus?.state?.() || emptyTimer();
      },
      get sessions() {
        const focus = plugin.focus;
        return focus?.sessions?.() || [];
      },
    };

    await this.migrateLegacy();
    this.engine = new StudyEngine(this);
    require('./core/reference-navigation.ts').installNavigation(this);
    this.ready = true;
    this.immersive = false;
    this.addCommand({
      id: 'toggle-immersive-reading',
      name: '沉浸阅读（隐藏界面，再执行一次退出）',
      callback: () => this.toggleImmersive(),
    });
    this.addCommand({
      id: 'quick-formula-capture',
      name: '快速记下公式（选区截图／点击框选）',
      hotkeys: [{ modifiers: [], key: 'z' }],
      checkCallback: checking => {
        const ctx = this.engine?.contexts.get(this.app.workspace.activeLeaf);
        if (!ctx?.overlay || ctx.closed) return false;
        // 单键快捷键没有修饰键兜底：焦点在输入框里时必须让开，
        // 否则侧栏搜索框里打不出 z。checkCallback 返回 false，按键照常落到输入框。
        const focused = ctx.win?.document?.activeElement;
        if (focused?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(focused?.tagName || '')) return false;
        if (!checking) ctx.overlay.quickCapture().catch(this.engine.report);
        return true;
      },
    });
    this.apiVersion = 1;
    this.registerEvent(this.app.workspace.on('file-open', file => {
      if (file?.extension === 'pdf') {
        this.engine.select(file.path);
        this.engine.attachFile(file).catch(e => new Notice(e.message));
      }
    }));
    this.registerEvent(this.app.workspace.on('codex-focus:before-change', () => this.engine?.settle()));

    this.addCommand({
      id: "open-study-overview",
      name: "打开学习回顾",
      callback: () => this.engine?.overview?.(),
    });
    this.addCommand({
      id: "open-textbooks",
      name: "打开教材库",
      callback: () => {
        const modal = new Modal(this.app);
        modal.onOpen = () => {
          modal.contentEl.classList.add('cs-library');
          el(modal.contentEl,'h2','','教材库');
          const search=el(modal.contentEl,'input','cs-search');search.placeholder='搜索 PDF 文件';search.setAttribute('aria-label','搜索 PDF 文件');
          const list=el(modal.contentEl,'div','cs-results');
          const draw=()=>{list.replaceChildren();const files=this.app.vault.getFiles().filter(f=>f.extension==='pdf'&&f.path.toLowerCase().includes(search.value.toLowerCase()));
            for(const file of files.slice(0,150))button(list,file.basename,async()=>{await this.openTextbook(file);modal.close();});
            el(list,'p','',files.length>150?`共 ${files.length} 份，显示前 150 份，请搜索缩小范围。`:`${files.length} 份教材`);
          };search.oninput=draw;draw();
        };modal.open();
      },
    });

    this.app.workspace.onLayoutReady(() => {
      for (const leaf of this.app.workspace.getLeavesOfType?.('pdf') || []) {
        if (leaf.view?.file) this.engine.attachFile(leaf.view.file).catch(e => console.warn('恢复 PDF 面板失败',e));
      }
      if (store.recordCount(this.study) === 0) {
        this.migrateLegacy()
          .then((imported) => {
            if (imported) this.refresh();
          })
          .catch((error) => console.warn("codex-study: 补迁移失败。", error));
      }
    });

    this.registerInterval(
      window.setInterval(() => {
        if (!this.engine) return;
        this.run(() => this.engine.pulse()).catch((error) => console.warn("codex-study: pulse 失败。", error));
      }, 5000)
    );
  }

  get workbench() {
    return this.app.plugins.getPlugin("codex-workbench");
  }

  get focus() {
    return this.app.plugins.getPlugin("codex-focus");
  }

  get storageRoot() {
    return this.storage;
  }

  get data() {
    return this.storage;
  }

  get views() {
    return this.workbench?.views || new Set();
  }

  get timerCore() {
    return this.focus || timerCore;
  }

  run(fn) {
    const next = this.queue.then(fn);
    this.queue = next.catch((error) => console.error("codex-study:", error));
    return next;
  }

  async migrateLegacy() {
    if (store.recordCount(this.study) > 0) return false;

    try {
      const raw = await this.app.vault.adapter.read(LEGACY_WORKBENCH_DATA);
      const legacy = JSON.parse(raw);
      const result = store.importLegacyStudy(this.study, legacy?.study);
      if (!result.imported) return false;
      store.applyStudy(this.study, result.study);
      await this.save();
      console.info("codex-study: 已从 v1.7 workbench 迁移 PDF 学习数据。");
      return true;
    } catch (error) {
      if (!/ENOENT|no such file|not found/i.test(String(error?.message || error))) {
        console.warn("codex-study: 旧学习数据迁移失败，稍后可重试。", error);
      }
      return false;
    }
  }

  /** 删除标记随元数据保存，跨重载阻止旧快照恢复已删除批注。 */
  get removedIds() { return (this._removedIds ||= new Set(this.study.removedIds || [])); }

  /** Serial disk snapshots preserve missing annotations and durable deletion markers. */
  async save() {
    const next = this.writeQueue.then(async () => {
      const snapshot = { study: JSON.parse(JSON.stringify(this.study)) };
      const removed = new Set(this.removedIds);
      let rescued = 0;
      const onDisk = await this.localStore.loadMetadata();
      for (const id of onDisk?.study?.removedIds || []) removed.add(id);
      for (const [path, record] of Object.entries(onDisk?.study?.records || {})) {
        const saved = Array.isArray(record?.annotations) ? record.annotations : [];
        if (!saved.length) continue;
        const target = (snapshot.study.records[path] ||= { position: null, annotations: [], daily: {}, dailyPages: {}, pagesSeen: [], totalPages: 0, next: "", updatedAt: 0 });
        target.annotations ||= [];
        const present = new Set(target.annotations.map(a => a && a.id));
        for (const annotation of saved) {
          if (!annotation?.id || present.has(annotation.id) || removed.has(annotation.id)) continue;
          target.annotations.push(annotation);
          rescued += 1;
        }
      }
      if (rescued) console.warn(`codex-study: 保存时从磁盘找回 ${rescued} 条内存中缺失的批注。`);
      snapshot.study.removedIds = [...removed];
      for (const record of Object.values(snapshot.study.records)) {
        record.annotations = (record.annotations || []).filter(a => !removed.has(a.id));
      }
      await this.localStore.saveMetadata(snapshot);
    });
    this.writeQueue = next.catch(()=>{}); return next;
  }

  ensure(path, text = "") {
    return ensureFile(this.app, path, text);
  }

  open(path) {
    const workbench = this.workbench;
    if (workbench?.open) return workbench.open(path);
    return openReading(this.app,path);
  }

  refresh() {
    const workbench = this.workbench;
    return workbench?.refresh ? workbench.refresh() : Promise.resolve();
  }

  selectTask(text) {
    if (this.focus?.dispatch) return this.focus.dispatch('select', {task:text});
    new Notice("请先启用 Codex 专注，再切换当前专注事项。");
    return null;
  }

  /**
   * 复习用的两个公开方法。codex-recall 通过 getPlugin 调这里——这是 study
   * 第一次对外提供接口，加它的理由是 6.2 之前捕获系统和复习系统完全不相识：
   * 你在第 37 页卡住写下的疑问、手抄的公式，永远不会自己回到你面前。
   */
  findCard(path, id) {
    const annotation = this.engine?.data?.records?.[path]?.annotations?.find(a => a.id === id);
    return annotation ? cardReview(annotation, path) : null;
  }

  /** 打开这本书并定位到该卡片。PDF 没开就先开。 */
  async revealCard(path, id) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) throw Error("教材已移动或删除");
    const annotation = this.engine?.data?.records?.[path]?.annotations?.find(a => a.id === id);
    if (!annotation) throw Error("卡片已删除");
    let ctx = [...(this.engine.contexts.values() || [])].find(c => c.path === path && !c.closed);
    if (!ctx) { await this.app.workspace.openLinkText(path, "", false); ctx = await this.engine.attachFile(file); }
    if (!ctx) throw Error("无法打开教材");
    await this.app.workspace.revealLeaf(ctx.leaf);
    return this.engine.reveal(ctx, annotation);
  }

  openTextbook(file) {
    const workbench = this.workbench;
    if (workbench?.openTextbook) return workbench.openTextbook(file);
    if (file?.path) return this.app.workspace.openLinkText(file.path, "", "tab");
    return null;
  }

  // 沉浸阅读：隐藏侧栏、标签页头、状态栏与 ribbon，收起学习面板，当前页以外降透明度。
  // 只是藏起来：不改渲染、不动数据、不加任何常驻控件，退出即复原。
  toggleImmersive(next = !this.immersive) {
    this.immersive = next;
    const contexts = [...(this.engine?.contexts.values() || [])].filter(ctx => !ctx.closed);
    const bodies = new Set([document.body, ...contexts.map(ctx => ctx.win?.document?.body)].filter(Boolean));
    for (const body of bodies) setImmersive(body, next);
    for (const ctx of contexts) {
      // 只收起本来展开的面板；退出时不会把你自己收起的那块又弹回来。
      if (next) {
        if (!ctx.root.classList.contains('cw-study-collapsed')) { ctx.root.classList.add('cw-study-collapsed'); ctx.immersiveCollapsed = true; }
      } else if (ctx.immersiveCollapsed) { ctx.root.classList.remove('cw-study-collapsed'); ctx.immersiveCollapsed = false; }
      ctx.win.dispatchEvent(new ctx.win.Event('resize'));
      dimPages(ctx.scroll, ctx.pdf?.currentPageNumber || 1, next);
    }
    return this.immersive;
  }

  async onunload() {
    if (this.immersive) this.toggleImmersive(false);
    if (!this.engine) return;
    try {
      await this.engine.unload();
    } catch (error) {
      console.warn("codex-study: 卸载时保存失败。", error);
    }
  }
}

module.exports = CodexStudy;
