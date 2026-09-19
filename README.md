# Learning OS

Learning OS 是一套本地优先的 Obsidian 学习系统。六个插件共享同一套数据契约与设计语言，把捕获、任务安排、专注、PDF 学习和间隔复习串成一个闭环。

学习资料、任务、进度、复习记录全部留在 Vault 内，不经过任何服务器。唯一出网的是 `codex-widgets` 的天气挂件：默认关闭，填了经纬度才会向 open-meteo.com 发请求，且只带那一对坐标。同一个插件还会读 Windows 桌面聚焦的图片缓存当工作台背景——那是本地只读，不出网。两者都能单独关掉。

项目版本以 [`version.json`](version.json) 为准，完整变化见 [`CHANGELOG.md`](CHANGELOG.md)。

## 插件

| 插件 | 功能 |
| --- | --- |
| `codex-capture` | Markdown 任务索引、快速捕获、今日安排与安全写回 |
| `codex-focus` | 专注计时、自动结算与历史记录 |
| `codex-study` | PDF 区域引用、批注、截图与学习卡片 |
| `codex-recall` | 笔记和学习卡片的间隔复习 |
| `codex-widgets` | 工作台左栏挂件：时间、每日一言、倒计日、天气 |
| `codex-workbench` | 汇总行动、课程、知识与回顾的学习控制台 |

## 特点

- 所有数据留在 Obsidian Vault 内。除可选的天气挂件外不调用任何网络 API。
- 插件可以独立使用，也可以通过公开接口互相协作。
- 源码不依赖打包框架；仓库内工具负责校验、构建和部署。
- 六个插件锁步使用同一版本号。

## 安装

需要 Obsidian 1.5.0 或更高版本，以及 Node.js 18 或更高版本。

```powershell
git clone <本仓库地址> "<你的 Vault>/08 插件开发"
cd "<你的 Vault>/08 插件开发"
node tools/verify.js
node tools/deploy.js
```

重启 Obsidian，然后在“设置 → 第三方插件”中启用六个 `Codex` 插件。部署脚本只更新插件程序文件，会保留已有的 `data.json`。

如果不想把源码放进 Vault，可先运行：

```powershell
node tools/build.js --stage
```

然后把 `dist/plugins/` 下的六个插件目录复制到 Vault 的 `.obsidian/plugins/`。

## 开发

```powershell
node tools/test.js                         # 单元测试
node tools/verify.js                       # 完整校验与 smoke test
node tools/verify.js --plugin codex-recall # 只验证一个插件
node tools/build.js --stage                # 构建到 dist/plugins
```

视觉验证使用 Playwright + Edge，可通过 `PLAYWRIGHT_PATH` 指定模块路径；输出位于仓库外的 `workbench-checks/`。

## 文档

| 文档 | 内容 |
| --- | --- |
| [使用说明](docs/使用说明.md) | 日常工作流、命令和数据位置 |
| [架构与边界](docs/架构与边界.md) | 插件职责、公开接口和数据契约 |
| [设计系统](docs/设计系统.md) | 颜色、字阶与组件规范 |
| [发布流程](docs/发布流程.md) | 版本、校验和发布规则 |

## 许可证

本仓库目前未附带开源许可证。代码公开可见不等于自动授予复制、修改或再分发权。
