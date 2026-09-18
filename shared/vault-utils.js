"use strict";

/**
 * CODEX 3.0 · Vault 文件工具。
 *
 * 所有插件构建时内嵌这一份实现，避免目录竞态处理被复制到多个插件。
 */

async function ensureFile(app, path, text = "") {
  let file = app.vault.getAbstractFileByPath(path);
  if (file) return file;

  const parts = path.split("/");
  parts.pop();
  let folder = "";
  for (const part of parts) {
    folder = folder ? `${folder}/${part}` : part;
    if (app.vault.getAbstractFileByPath(folder)) continue;
    try {
      await app.vault.createFolder(folder);
    } catch (error) {
      const exists = /already exists|已存在/i.test(String(error?.message || error));
      if (!exists && !app.vault.getAbstractFileByPath(folder)) throw error;
    }
  }

  file = app.vault.getAbstractFileByPath(path);
  if (file) return file;
  try {
    return await app.vault.create(path, text);
  } catch (error) {
    const exists = /already exists|已存在/i.test(String(error?.message || error));
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = app.vault.getAbstractFileByPath(path);
      if (current) return current;
      if (!exists) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw error;
  }
}

async function appendBlock(app, path, content, fallbackTitle = "") {
  const file = await ensureFile(app, path, fallbackTitle);
  await app.vault.process(file, (current) => {
    const base = current.endsWith("\n") ? current : `${current}\n`;
    return `${base}\n${content}\n`;
  });
  return file;
}

module.exports = { ensureFile, appendBlock };