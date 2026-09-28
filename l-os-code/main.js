"use strict";

const { Plugin, FileView, Notice } = require("obsidian");
const { el } = require("../shared/dom");
const core = require("./core/matlab");

/**
 * L-OS 代码查看：在库里直接读课程文件夹里的 .m 脚本。
 *
 * Obsidian 不认 .m，点链接会甩给系统默认程序（没装 MATLAB 的机器上就是「选择打开方式」）。
 * 这里把扩展名登记到一个只读视图：等宽、行号、MATLAB 着色、长行在代码缩进处折行。
 * 只读是故意的——这些是老师发的原件，改动应当在 MATLAB 里做，库里改了会在下次同步时被覆盖。
 *
 * 它不知道工作台：课程主页里「关联代码」那一节的链接是工作台写的普通 wikilink，
 * 本插件停用时链接照样在，只是回到 Obsidian 的默认行为。
 */

const VIEW = "l-os-code";
const EXTENSIONS = ["m"];
const DEFAULTS = { wrap: true };

class CodeView extends FileView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.text = "";
    this.addAction("copy", "复制全部代码", () => this.copy());
    this.addAction("external-link", "用系统默认程序打开", () => this.openExternal());
    this.wrapAction = this.addAction("wrap-text", "", () => this.plugin.toggleWrap());
    this.syncWrap();
  }
  getViewType() { return VIEW; }
  getIcon() { return "file-code"; }
  getDisplayText() { return this.file ? this.file.name : "代码"; }
  canAcceptExtension(extension) { return EXTENSIONS.includes(extension); }

  async onLoadFile(file) { await this.render(file); }
  async onUnloadFile() { this.text = ""; this.contentEl.empty(); }

  async render(file = this.file) {
    if (!file) return;
    const { text, encoding } = core.decode(await this.app.vault.readBinary(file));
    if (file !== this.file) return; // 读盘期间换了文件
    this.text = text;
    const lines = core.highlight(text);
    const scroll = this.contentEl.scrollTop;
    this.contentEl.empty();
    this.contentEl.addClass("cc-view");
    const code = el(this.contentEl, "div", "cc-code");
    code.setAttr("data-encoding", encoding);
    code.style.setProperty("--cc-digits", String(String(lines.length).length));
    lines.forEach((line, index) => {
      const row = el(code, "div", line.section ? "cc-line is-section" : "cc-line");
      row.dataset.n = String(index + 1);
      if (line.indent) row.style.setProperty("--cc-indent", `${Math.min(line.indent, 40)}ch`);
      const src = el(row, "span", "cc-src");
      for (const token of line.tokens) {
        if (token.t === "text") src.appendText(token.v);
        else el(src, "span", `cc-${token.t}`, token.v);
      }
    });
    this.contentEl.scrollTop = scroll;
  }

  syncWrap() {
    const wrap = this.plugin.settings.wrap;
    this.contentEl.toggleClass("is-nowrap", !wrap);
    this.wrapAction?.setAttr("aria-label", wrap ? "长行不折行（横向滚动）" : "长行折行");
    this.wrapAction?.toggleClass("is-active", !wrap);
  }

  async copy() {
    await navigator.clipboard.writeText(this.text);
    new Notice(`已复制 ${this.file?.name || "代码"}`);
  }

  openExternal() {
    if (!this.file) return;
    // openWithDefaultApp 不在公开 API 里，缺了就说一声，不静默。
    if (typeof this.app.openWithDefaultApp !== "function") return new Notice("这个 Obsidian 版本不支持用系统程序打开");
    this.app.openWithDefaultApp(this.file.path);
  }
}

module.exports = class LOSCode extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    this.registerView(VIEW, leaf => new CodeView(leaf, this));
    try {
      this.registerExtensions(EXTENSIONS, VIEW);
    } catch (error) {
      // 另一个插件先登记了 .m：不抢，告诉用户是谁的问题。
      console.warn("l-os-code: .m 已被其他插件登记", error);
      new Notice("代码查看：.m 已被其他插件接管，本插件不生效");
    }
    // 在库外（MATLAB 里）改了脚本，打开着的视图跟着重画。
    this.registerEvent(this.app.vault.on("modify", file => {
      for (const view of this.views()) if (view.file === file) view.render(file).catch(console.error);
    }));
    this.addCommand({ id: "toggle-wrap", name: "代码：长行折行（开 / 关）", callback: () => this.toggleWrap() });
  }

  views() {
    return this.app.workspace.getLeavesOfType(VIEW).map(leaf => leaf.view).filter(view => view instanceof CodeView);
  }

  async toggleWrap() {
    this.settings.wrap = !this.settings.wrap;
    await this.saveData(this.settings);
    for (const view of this.views()) view.syncWrap();
  }
};
