# codex-capture · 4.6.0

任务稳定 ID 与版本化内联字段；原子冲突检测；原位项目元数据更新。

详见 [V4.6 实施与验收](../docs/V4.6 实施与验收.md)。


任务删除/恢复与 CRLF 修复；独立笔记创建、完成、待办、回收站删除；串行 Frontmatter 更新。

详见 [V4.5 迭代与验收](../docs/V4.5 迭代与验收.md)。

新增任务增量缓存、过滤排序、今日安排、安全原文写回；补齐独立捕获样式。

本插件可独立验证与部署：

```powershell
node tools/verify.js --plugin codex-capture
node tools/deploy.js --plugin codex-capture
```

从上级开发目录运行。发布仅包含 main.js、manifest.json 和可选 styles.css，保留用户 data.json。公开 API 与事件见上级 docs/插件拆分说明.md；本插件更新只修改本目录的 manifest 版本和 CHANGELOG，不要求其他插件同步升版本。
