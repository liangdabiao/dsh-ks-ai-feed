# dsh-ks-ai-feed · 快手爆款日报

DeepSeek Harness（dsh）插件：**多关键词批量扫描快手 AI 创作内容，六步智能聚类生成深色快手橙 HTML 日报 + AI 情报洞察**。15 点日期规则、7 关键词一次批量请求（减少 85%+ API 调用）、起量信号/核心达人/调查方向，侧栏看板。

移植自 [redfox-data/redfox-community](https://github.com/redfox-data/redfox-community) 的 `skills/ks-ai-feed`（Python 全量重写为 Node 原生，**零 Python 依赖**；上游 report_template.html 深色模板原样复用）。
<img width="2462" height="1344" alt="image" src="https://github.com/user-attachments/assets/7f5ae64d-8851-427e-9586-d643415336f8" />

## 安装

```bash
dsh plugin --profile web add https://github.com/liangdabiao/dsh-ks-ai-feed
```

## 功能

- 🔥 **爆款发现**：`keywords` 数组一次传入所有关键词（默认 AI,人工智能,大模型,GPT,Agent,AI绘画,AI教程），pageSize 200、photoId 去重、最多 10 页
- 🧠 **六步智能聚类**：分类完全由当天内容的 type/topic 标签决定——泛标签过滤（#AI/#人工智能 等）→ 首标签分组 → 大组 >max(20%,25) 按第二标签二次拆分 → 小组(<3)标签匹配并入 → 过大组(>max(30%,40))用标题高频关键词拆（最多 3 轮）→ 保底 5 分类；组内按播放量降序 TOP5
  - ⚠️ 含一处上游 bug 修复：保底拆分撞已有组名时合并而非覆盖（上游 set 直接覆盖会丢条目）
- 📈 **AI 情报洞察**：热度TOP话题（占比+头部作品）/ 新兴起量信号（占比<10% 但均互动>1000）/ 核心达人 TOP5 / 推荐调查方向（场景+引擎组合+搜索关键词）/ 跨平台对比建议
- 🌙 **深色快手橙日报**：上游 HTML 模板原样复用（#FF6B35 主题、封面图 `referrerpolicy="no-referrer"` 防盗链、互动数据、视频直链、奖牌 TOP3）
- 📅 **15 点日期规则**：每日 15 点更新前一天数据（≥15 点查昨天，<15 点查前天；date 支持 `YYYY-MM-DD` 或范围 `YYYY-MM-DD~YYYY-MM-DD`）
- 🔔 **订阅推送**：通过 dsh 定时任务实现每日 15:00 自动生成

## 工作流

```
ks_ai(action="fetch", keywords="AI,AI教程")  ← 同步秒回（含去重+聚类+情报+入库）
  → 固定输出格式：分类概览表 + 情报洞察报告（4 模块，强制规范）
  → ks_ai(action="html")                      ← 深色快手橙 HTML 日报
  → 用户要订阅 → dsh 定时任务（schedule_create，每日 15 点，先确认频率）
```

## 面板（侧栏「快手爆款日报」）

- **概览**：关键词组/条数/日期查询表单 + 日报历史卡片（卡片上直接有「📄 打开日报」入口）；「去对话深度调查」开新对话
- **报告**：报告库页，按日报列出所有已生成的深色 HTML 日报，「打开日报」在面板内覆盖层查看
- **日报页**：统计条（视频/分类/总点赞/头号作者）+ 分类卡片流（编号/分类名/条数 + 封面图+互动+直链，奖牌 TOP3）+ AI 情报洞察（热度TOP/起量信号/核心达人/调查方向/跨平台对比）+ 打开/生成 HTML 日报
- **设置**：API Key、默认关键词组、代理、接口地址

> ⚠️ 桌面端 dsh 的 WebContentsView 会 deny `window.open`/`target=_blank`（只有 https 链接交给系统浏览器），
> 所以日报**不能**用新窗口打开：面板改为同源 fetch 日报 HTML → `iframe.srcdoc` 在覆盖层里渲染，
> 并给 srcdoc 注入一段脚本，把日报里的作品链接 `postMessage` 回面板，统一经宿主 `POST /api/open` 用系统浏览器打开。
> 报告是否存在由 `meta.has_report`（宿主）给出，宿主未重启时面板用 `HEAD /api/reports/<rid>/report` 探测兜底。
> `/api/open` 是宿主路由：改完要**重启一次 dsh** 才生效（`lab/` 静态文件改完刷新面板即可）。

## 配置

**RedFox API Key**（必需，`ak_` 开头）：[红狐 hub](https://www.redfox.hk/settings/api-keys?source=github) 获取。优先级：插件配置 `apiKey` > 面板「设置」页 > 环境变量 `REDFOX_API_KEY`。

> ✅ 2026-11-13 实测：该接口**免费积分可用**，2 秒返回 143 条真实作品（「AI,AI教程」批量聚类出 6 个分类，识别出 #AI动画/#AI大模型 两个起量信号）。

## 开发

```bash
npm i
npm run build      # client.js → dist/client.js
npm test           # 13 个单测（六步聚类/泛标签过滤/15 点规则/情报洞察/模板填充/工具全链路）
npm run smoke      # 离线冒烟：本地假 RedFox 服务器全链路（工具 + 面板 API）
npm run live       # 真实 API 冒烟：node scripts/live.mjs <keywords逗号分隔> ak_xxx
npm run dev        # 面板独立预览：DSH_HOME=<目录> node scripts/devserver.mjs 5185
```

数据落在 `$DSH_HOME/ks-ai-feed/`：`settings.json` + `reports/<rid>/`（raw/meta/briefing/report.html；同关键词组+日期覆盖），原子写。上游深色模板在 `assets/report_template.html`。

## 结构

```
src/host.js            ks_ai 工具（fetch/clusters/insights/html/history）+ 装配
src/systemPrompt.js    工作流硬规则注入（固定输出格式/不预设分类/数值不编造）
lib/redfox.js          POST queryKsAiMsgs/batch（3108 退避、3106/3107 Key 错误翻译）+ 15 点日期规则
lib/cluster.js         六步智能聚类（逐行对齐上游 cluster_articles + 保底拆分覆盖 bug 修复）
lib/normalize.js       条目归一化 + photoId 去重（无 ID 不按标题合并）
lib/insights.js        情报洞察（热度TOP/起量信号/核心达人/调查方向/跨平台对比，6 场景引擎组合）
lib/report.js          上游模板占位符填充 + 分区卡片（奖牌 TOP3）+ 情报板块渲染 + 兜底模板
lib/store.js           reports/<rid> 持久化 + 设置
lib/api.js             /ks-ai-feed 面板路由
client.js / lab/       浏览器半边（侧栏入口 + iframe 面板，明暗跟随 dsh 主题）
assets/report_template.html   上游深色快手橙模板（原样复用）
skills/ks-ai-feed/     方法论技能（输出要求 dsh 适配版）
```

## License

MIT（本插件代码）。方法论、模板与 API 用例参考 redfox-data/redfox-community skills/ks-ai-feed（上游未附许可证文件，仅作技术参考）；RedFox API 使用受其服务条款约束。
