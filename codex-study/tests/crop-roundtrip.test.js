"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { StorageManager } = require("../core/storage-manager.ts");
const store = require("../core/study-store.js");

/** 最小 Vault 桩：只实现 StorageManager 用到的几个方法。 */
function fakeVault() {
  const files = new Map();
  const binary = new Map();
  return {
    files, binary,
    adapter: { exists: async p => files.has(p) || files.has(p + "/"), read: async p => files.get(p), write: async (p, text) => { files.set(p, text); } },
    getAbstractFileByPath: p => (files.has(p) || binary.has(p) ? { path: p } : null),
    read: async f => files.get(f.path),
    modify: async (f, text) => { files.set(f.path, text); },
    create: async (p, text) => { files.set(p, text); },
    createBinary: async (p, data) => { binary.set(p, data); },
    createFolder: async p => { files.set(p + "/", ""); },
  };
}

const CROP = {
  id: "crop-1", page: 48, kind: "crop", text: "", note: "特解＋齐次解",
  imagePath: "03 知识库/教材切片/卷1_p48_crop_abc.png",
  rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.05 }],
  createdAt: 1789, resolved: false,
};

test("区域截取：保存后重新加载，批注与图片路径都还在", async () => {
  const vault = fakeVault();
  const storage = new StorageManager(vault);

  const snapshot = { study: { records: { "book/卷1.pdf": { annotations: [CROP], daily: {}, dailyPages: {}, pagesSeen: [], totalPages: 60, next: "", updatedAt: 1 } } } };
  await storage.saveMetadata(snapshot);

  // 模拟重载：新实例重新读盘
  const reloaded = await new StorageManager(vault).loadMetadata();
  assert.ok(reloaded, "重载后应读到元数据");

  const study = store.defaultStudy();
  store.applyStudy(study, reloaded.study);
  const annotations = study.records["book/卷1.pdf"].annotations;
  assert.equal(annotations.length, 1);
  assert.equal(annotations[0].kind, "crop");
  assert.equal(annotations[0].imagePath, CROP.imagePath, "imagePath 不得在规范化时被丢弃");
  assert.equal(annotations[0].note, "特解＋齐次解");
});

test("区域截取：saveCrop 写入 Vault 并返回相对路径", async () => {
  const vault = fakeVault();
  const storage = new StorageManager(vault);
  const target = await storage.saveCrop("book/卷1.pdf", 48, new Uint8Array([1, 2, 3]).buffer);
  assert.match(target, /^03 知识库\/教材切片\/卷1_p48_crop_[0-9a-f]{32}\.png$/);
  assert.ok(vault.binary.has(target), "切片图片应写入 Vault");
});

test("区域截取：只写图片而不记批注时，重载后查无此切片", async () => {
  // 这正是「复制双链引用」的行为：PNG 落盘，元数据里没有对应批注。
  const vault = fakeVault();
  const storage = new StorageManager(vault);
  await storage.saveMetadata({ study: { records: {} } });
  await storage.saveCrop("book/卷1.pdf", 48, new Uint8Array([1]).buffer);

  const reloaded = await new StorageManager(vault).loadMetadata();
  const study = store.defaultStudy();
  store.applyStudy(study, reloaded.study);
  assert.equal(Object.keys(study.records).length, 0, "图片存在，但批注确实不会凭空出现");
  assert.equal(vault.binary.size, 1, "孤立的切片图片留在了 Vault 里");
});

test("元数据结构损坏时拒绝加载，不覆盖原文件", async () => {
  const vault = fakeVault();
  vault.files.set("03 知识库/教材切片/学习元数据.json", '{"study":{"records":[]}}');
  await assert.rejects(() => new StorageManager(vault).loadMetadata(), /结构无效/);
});

// —— 合并式保存：陈旧的内存状态不得删掉磁盘上已有的批注 ——

const HIGHLIGHT = { id: "hl-1", page: 34, kind: "highlight", text: "仿射子空间", rects: [], resolved: false };

function fakePlugin(vault, study) {
  const storage = new StorageManager(vault);
  const p = {
    study, localStore: storage, writeQueue: Promise.resolve(),
    get removedIds() { return (this._removedIds ||= new Set()); },
  };
  // Exercise the production save method, not a copied implementation.
  const { bundle } = require('../../tools/bundler');
  const vm = require('node:vm');
  const sandbox = { module: { exports: {} }, console,
    require: name => name === 'obsidian' ? { Plugin: class {}, Modal: class {}, Notice: class {} } : require(name) };
  vm.runInNewContext(bundle(require.resolve('../main.js')).code, sandbox);
  p.save = sandbox.module.exports.prototype.save;
  return p;
}

test("合并保存：内存里缺失的批注不会被写没", async () => {
  const vault = fakeVault();
  await new StorageManager(vault).saveMetadata({ study: { records: { "a.pdf": { annotations: [HIGHLIGHT, CROP] } } } });

  // 模拟陈旧状态：内存里只剩高亮，切片不见了
  const p = fakePlugin(vault, { records: { "a.pdf": { annotations: [HIGHLIGHT] } } });
  await p.save();

  const after = JSON.parse(vault.files.get("03 知识库/教材切片/学习元数据.json")).study.records["a.pdf"].annotations;
  assert.equal(after.length, 2, "磁盘上的切片必须被保住");
  assert.ok(after.some(a => a.id === "crop-1"));
});

test("合并保存：显式删除的批注确实会被移除", async () => {
  const vault = fakeVault();
  await new StorageManager(vault).saveMetadata({ study: { records: { "a.pdf": { annotations: [HIGHLIGHT, CROP] } } } });

  const p = fakePlugin(vault, { records: { "a.pdf": { annotations: [HIGHLIGHT] } } });
  p.removedIds.add("crop-1");
  await p.save();

  const after = JSON.parse(vault.files.get("03 知识库/教材切片/学习元数据.json")).study.records["a.pdf"].annotations;
  assert.equal(after.length, 1, "显式删除不该被合并规则挡住");
  assert.equal(after[0].id, "hl-1");
});

test("unindexed JSON preserves additions and deletion across reload and stale saves", async () => {
  const vault = fakeVault();
  vault.getAbstractFileByPath = () => null;
  const p = fakePlugin(vault, {records:{"a.pdf":{annotations:[HIGHLIGHT,CROP]}}});
  await p.save();
  const loaded = await new StorageManager(vault).loadMetadata();
  assert.equal(loaded.study.records["a.pdf"].annotations.length, 2);
  const next = fakePlugin(vault, loaded.study);
  next.removedIds.add(HIGHLIGHT.id);
  next.study.records["a.pdf"].annotations = [CROP];
  await next.save();
  await p.save();
  const final = await new StorageManager(vault).loadMetadata();
  assert.deepEqual(final.study.records["a.pdf"].annotations.map(a=>a.id), [CROP.id]);
  assert.deepEqual(store.normalizeStudy(final.study).removedIds, [HIGHLIGHT.id]);
});
test("unreadable metadata must not be overwritten", async () => {
  const vault = fakeVault(), path = "03 知识库/教材切片/学习元数据.json";
  vault.files.set(path, "broken-json");
  await assert.rejects(fakePlugin(vault, {records:{}}).save());
  assert.equal(vault.files.get(path), "broken-json");
});
