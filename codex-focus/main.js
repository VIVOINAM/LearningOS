"use strict";

const { Plugin, Notice } = require("obsidian");
const core = require("./core/timer-core.js");

const LEGACY_WORKBENCH_DATA = ".obsidian/plugins/codex-workbench/data.json";
const SETTINGS_LIMITS = { focusMinutes: [1, 180], breakMinutes: [1, 60] };

function clamp(value, min, max, fallback) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    focusMinutes: clamp(source.focusMinutes, ...SETTINGS_LIMITS.focusMinutes, 25),
    breakMinutes: clamp(source.breakMinutes, ...SETTINGS_LIMITS.breakMinutes, 5),
  };
}

function normalizeSessions(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((session) => session && typeof session === "object" && Number(session.seconds) > 0);
}

function normalizeData(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    schemaVersion: 3,
    timer: core.normalize(source.timer),
    sessions: normalizeSessions(source.sessions),
    settings: normalizeSettings(source.settings),
  };
}

function hasStoredFocus(value) {
  if (!value || typeof value !== "object") return false;
  return Boolean(value.timer || (Array.isArray(value.sessions) && value.sessions.length) || value.focusMinutes || value.breakMinutes);
}

class CodexFocus extends Plugin {
  async onload() {
    this.queue = Promise.resolve();
    const raw = await this.loadData();
    this.data = normalizeData(raw);
    if (!hasStoredFocus(raw)) await this.migrateLegacy();
    this.data.timer = core.reconcile(this.data.timer);
    this.apiVersion = 1;
    this.operations = Promise.resolve();
    for (const [id,name,action] of [['toggle','开始 / 暂停专注','toggle'],['stop','结束当前计时','finish']]) {
      this.addCommand({id,name,callback:() => this.dispatch(action).catch(e => new Notice(e.message))});
    }
    this.addCommand({id:'break',name:'切换到休息',callback:()=>this.dispatch('phase',{phase:'break'}).catch(e=>new Notice(e.message))});
    this.addCommand({id:'focus',name:'切换到专注',callback:()=>this.dispatch('phase',{phase:'focus'}).catch(e=>new Notice(e.message))});
    this.registerInterval(window.setInterval(() => {
      const timer = this.data.timer;
      if (timer.status === 'running' && core.remaining(timer) <= 0) this.dispatch('finish').catch(e => console.error('专注结算失败',e));
    }, 1000));
  }

  // Serialized transitions are owned here, so timing survives workbench unloads.
  dispatch(action, options = {}) {
    const run = this.operations.then(async () => {
      if (action === 'read' && this.data.timer.status !== 'idle') {
        if(options.auto)return null;
        throw Error('已有计时正在进行，请先结束');
      }
      const before = JSON.parse(JSON.stringify(this.data)), timer = this.data.timer;
      let session = null;
      this.app.workspace.trigger('codex-focus:before-change');
      const expired = timer.status === 'running' && core.remaining(timer) <= 0;
      const taskSeconds=Math.max(60,Math.min(10800,(Number(options.minutes)||this.data.settings.focusMinutes)*60));
      if (action === 'start') {
        if (timer.status === 'idle' || expired || timer.phase === 'break') {
          if (timer.status !== 'idle') {
            session = core.finish(timer, expired);
            if (session.seconds > 0 && !this.data.sessions.some(s => s.id === session.id)) this.data.sessions.push(session);
          }
          this.data.timer = core.start(core.initial({phase:'focus', taskId:options.taskId||'', project:options.project||''}), String(options.task||'自由专注'), taskSeconds);
        } else {
          const switched = core.switchTask(timer, options);
          this.data.timer = switched.status === 'paused' ? core.start(switched, switched.task, switched.duration) : switched;
        }
      } else if (action === 'finish' || expired) {
        if (timer.status === 'idle') return null;
        session = core.finish(timer, expired);
        if (session.seconds > 0 && !this.data.sessions.some(s => s.id === session.id)) this.data.sessions.push(session);
        this.data.timer = {...core.initial(),phase:expired?(timer.phase==='focus'?'break':'focus'):timer.phase,task:timer.task,taskId:timer.taskId};
      } else if (action === 'switch') {
        this.data.timer = core.switchTask(timer, options);
      } else if (action === 'read') {
        this.data.timer = core.start({...timer,phase:'focus',taskId:options.taskId||''},String(options.task||'阅读专注'),this.data.settings.focusMinutes*60);
      } else if (action === 'pause') {
        this.data.timer = core.pause(timer);
      } else if (action === 'phase') {
        if (timer.status !== 'idle') throw Error('请先结束当前计时');
        if (!['focus','break'].includes(options.phase)) throw Error('无效计时阶段');
        this.data.timer = {...timer,phase:options.phase};
      } else if (action === 'select') {
        if (timer.status !== 'idle') throw Error('请先结束当前计时');
        this.data.timer = {...timer,task:String(options.task||'')};
      } else if (action === 'toggle') {
        const phase = timer.phase;
        const seconds = this.data.settings[phase==='focus'?'focusMinutes':'breakMinutes'] * 60;
        this.data.timer = timer.status==='running' ? core.pause(timer) : core.start({...timer,phase,project:timer.status==='idle'?(options.project||''):timer.project,taskId:timer.status==='idle'?(options.taskId||''):timer.taskId},String(options.task||timer.task||'自由专注'),seconds);
      } else throw Error('无效计时操作');
      try { await this.save(); } catch(e) { this.data = before; throw e; }
      this.app.workspace.trigger('codex-focus:changed');
      if (session) {
        this.app.workspace.trigger('codex-focus:finished',session);
        new Notice(session.completed?'本段计时完成，记录已保存。':'计时已结束，实际时长已保存。');
      }
      return session;
    });
    this.operations = run.catch(() => {}); return run;
  }
  markLogged(id) {
    const run = this.operations.then(async () => {
      const session = this.data.sessions.find(s=>s.id===id);
      if (session && !session.logged) { session.logged=true; try {await this.save();} catch(e){session.logged=false;throw e;} }
    });
    this.operations = run.catch(()=>{});return run;
  }

  async migrateLegacy() {
    try {
      const text = await this.app.vault.adapter.read(LEGACY_WORKBENCH_DATA);
      const legacy = JSON.parse(text);
      if (!hasStoredFocus(legacy)) return false;

      this.data.timer = core.normalize(legacy.timer);
      this.data.sessions = normalizeSessions(legacy.sessions);
      if (legacy.focusMinutes || legacy.breakMinutes) {
        this.data.settings = normalizeSettings({
          focusMinutes: legacy.focusMinutes,
          breakMinutes: legacy.breakMinutes,
        });
      }
      await this.save();
      console.info("codex-focus: 已从 v1.7 workbench 迁移计时状态与专注记录。");
      return true;
    } catch (error) {
      if (!/ENOENT|no such file|not found/i.test(String(error?.message || error))) {
        console.warn("codex-focus: 旧计时数据迁移失败。", error);
      }
      return false;
    }
  }

  save() {
    const snapshot = JSON.parse(JSON.stringify(this.data));
    const next = this.queue.then(() => this.saveData(snapshot));
    this.queue = next.catch((error) => console.error("codex-focus: 保存失败", error));
    return next;
  }

  state() {
    return this.data.timer;
  }

  sessions() {
    return this.data.sessions;
  }

  settings() {
    return { ...this.data.settings };
  }

  replaceData(patch) {
    const run=this.operations.then(async()=>{
      const before=this.data;
      this.data={...before,...patch};
      try{await this.save();}catch(e){this.data=before;throw e;}
      this.app.workspace.trigger('codex-focus:changed');
      return this.data;
    });
    this.operations=run.catch(()=>{});return run;
  }
  setState(timer) {return this.replaceData({timer:core.normalize(timer)}).then(data=>data.timer);}
  setSessions(sessions) {return this.replaceData({sessions:normalizeSessions(sessions)}).then(data=>data.sessions);}

  setSettings(patch = {}) {
    const run = this.operations.then(async () => {
      const before=this.data.settings;
      this.data.settings=normalizeSettings({...before,...patch});
      try {await this.save();}catch(e){this.data.settings=before;throw e;}
      this.app.workspace.trigger('codex-focus:changed');
      return this.settings();
    });
    this.operations=run.catch(()=>{});return run;
  }

  clear() {
    return this.replaceData({timer:core.initial()});
  }
}

Object.assign(CodexFocus.prototype, core);

module.exports = CodexFocus;
