# 数字化审计 — 卫星地图疑点核查系统

## 项目概述
基于卫星影像的远程审计疑点核查工具集，纯静态 HTML/JS，部署在 GitHub Pages。

## 访问地址
- 首页: https://fuzhiran90-ctrl.github.io/satellite-audit-tool/
- 仓库: https://github.com/fuzhiran90-ctrl/satellite-audit-tool

## 核心文件

| 文件 | 作用 |
|------|------|
| `index.html` | 导航首页 |
| `audit_tool.html` | **主工具** — 卫星底图 + 审计模型下拉 + 疑点定位 + 框选核查 + 提示词生成 |
| `model_manager.html` | **管理页** — 模型 CRUD + 疑点清单管理，数据存 localStorage |

## 数据流
- 模型列表: localStorage key `audit_tool_models`
- 疑点数据: localStorage key `audit_tool_findings` (结构 `{ modelId: [finding, ...] }`)
- `model_manager.html` 写入 → `audit_tool.html` 读取

## 部署方式
- GitHub Pages，分支 `master`，根目录 `/`
- 修改后: `git add . && git commit -m "..." && git push`，约 1 分钟后生效
- `node_modules/` 和 `.claude/` 已在 `.gitignore` 中排除

## 技术栈
- 纯前端 HTML/CSS/JS，无框架
- Leaflet 1.9.4 (CDN) — 地图引擎
- 底图: 高德卫星图 (免费) / Esri 卫星图 (免费) / 星图云 (需 Token)
- html2canvas (CDN) — 截图功能
- Leaflet.Draw (CDN) — 框选工具
- 坐标系统: WGS-84 ↔ GCJ-02 ↔ BD-09 互转
