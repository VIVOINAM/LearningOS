# codex-recall · 1.0.0

首次提供整篇笔记间隔复习、揭示答案、评分调度、重命名迁移与独立持久化。

本插件可独立验证与部署：

```powershell
node tools/verify.js --plugin codex-recall
node tools/deploy.js --plugin codex-recall
```

从上级开发目录运行。发布仅包含 main.js、manifest.json 和可选 styles.css，保留用户 data.json。公开 API 与事件见上级 docs/插件拆分说明.md；本插件更新只修改本目录的 manifest 版本和 CHANGELOG，不要求其他插件同步升版本。
