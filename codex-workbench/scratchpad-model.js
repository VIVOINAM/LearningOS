"use strict";

/** 把一条闪念插进今日日记的「随手记录」，不碰其余段落。 */
function insertQuickNote(content, markdown, time = new Date()) {
  const text = String(content || "");
  const note = String(markdown || "").trim();
  if (!note) return text;
  const stamp = time.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const block = `### 闪念 ${stamp}\n\n${note}`;
  const heading = /^## 随手记录\s*$/m;
  const match = heading.exec(text);
  if (!match) return `${text.trimEnd()}\n\n## 随手记录\n\n${block}\n`;
  const bodyStart = match.index + match[0].length;
  const rest = text.slice(bodyStart);
  const next = /\n##\s+/.exec(rest);
  const bodyEnd = next ? bodyStart + next.index : text.length;
  const before = text.slice(0, bodyEnd).trimEnd();
  const after = text.slice(bodyEnd).trimStart();
  return `${before}\n\n${block}\n\n${after}`.trimEnd() + "\n";
}

module.exports = { insertQuickNote };
