# 田野考古发掘数字化管理系统

面向考古发掘现场探方管理、地层记录、遗迹测绘、遗物登记、浮选采样与测年送检全流程的田野考古数字化管理平台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 探方管理 | `trench` | 探方 | 探方编号、所属发掘区、探方尺寸 |
| 地层记录 | `stratum` | 地层 | 地层编号、所属探方、层位序号 |
| 遗迹单位 | `feature` | 遗迹 | 遗迹编号、所属探方、遗迹类型 |
| 出土遗物 | `artifact` | 出土遗物 | 器物编号、出土探方、出土层位 |
| 浮选采样 | `flotation` | 浮选样本 | 样本编号、采样单位、采样层位 |
| 测年送检 | `dating` | 测年送检单 | 送检编号、样品类型、采样单位 |
| 影像记录 | `photography` | 影像档案 | 影像编号、拍摄对象、拍摄类型 |
| 实测绘图 | `drawing` | 实测图纸 | 图纸编号、绘图对象、绘图类型 |
| 发掘日记 | `diary` | 发掘日记 | 日记编号、日期、当日气候 |
| 考古调查 | `survey` | 调查记录 | 调查编号、调查区域、调查方法 |
| 人骨鉴定 | `human_bone` | 人骨标本 | 标本编号、出土单位、鉴定部位 |
| 动物骨骼 | `animal_bone` | 动物骨骼标本 | 标本编号、出土单位、种属判定 |
| 陶器整理 | `pottery` | 陶器标本 | 标本编号、出土单位、器形类别 |
| 现场保护 | `conservation` | 保护处理记录 | 处理编号、保护对象、病害类型 |
| 三维坐标 | `coordinate` | 测点记录 | 测点编号、所属单位、坐标系 |
| 库房管理 | `storage` | 库房架位 | 架位编号、库房名称、存放器物类别 |
| 耗材管理 | `material` | 发掘耗材 | 耗材编号、耗材名称、规格型号 |
| 工地接待 | `visit` | 来访记录 | 来访编号、来访单位、来访人数 |

## 考古调查资料对账包

考古调查页支持按「调查编号、调查区域、调查方法」筛选后导出**资料对账包**（JSON），包内含
调查记录及关联地表发现、关联遗迹快照；现场离线补充「断面观察」「初步断代」后再导入平台对账。

- 导入时只有「断面观察」「初步断代」会用包内非空值写回平台；旧记录缺「调查方法」按空白兼容，
  平台该字段为空白时用包内值补齐。
- 冲突策略（实现者决策）：包内调查记录与平台遗迹编号不一致时**以平台记录为准**，平台数据不被
  包覆盖，差异写入遗迹单位页的「待核验清单」，由人工确认核验。
- 每个包有唯一包编号，同一包编号重复导入只生效一次；整包先校验、再经 `saveMany` 一次落盘，
  任何一份记录写入失败整个包退回，不留半份结果。
- 对账包逻辑在 `frontend/src/api/survey-reconciliation.ts`，跨模块（调查记录 + 待核验清单 +
  导入日志）的一次落盘用 `frontend/src/data/local-store.ts` 的 `saveMany`。

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `field-archaeology-digital:entries` 这一项，或调用 `resetModule(模块)`。
