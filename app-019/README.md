# app-019 · 木工榫卯参数化图纸生成

输入板材尺寸与木料/配合偏好，自动计算六种常见榫卯的加工尺寸，输出带尺寸标注的三视图 SVG、1:1 打印模板与逐齿切割清单。纯前端应用（React 18 + TypeScript + Vite），无后端、无 UI 库、无外网 CDN 依赖。

设计蓝图见 [woodworking-joint-blueprint.md](./woodworking-joint-blueprint.md)。

## 功能特性

| 模块 | 说明 |
| --- | --- |
| 六种榫卯计算 | 燕尾榫（穿透式）、半隐燕尾榫、直榫（榫头榫眼）、圆木榫/饼干榫、企口/搭接（Lap）、拼板（木钉/槽） |
| 燕尾齿宽分配 | 0.1mm 网格 + 累积取整差分，Σ齿顶宽 + Σ齿根宽 与板宽**严格闭合**（误差 ≤ 0.1mm） |
| 三视图出图 | 正视图 / 俯视图 / 侧视图共享同一套几何函数生成，保证宽度一致；自动尺寸标注、齿序编号 |
| 锯路补偿 | 图纸同时标注理论线与锯切线（向废料侧偏移 kerf/2），切割步骤按"先锯废料侧"排序 |
| 配合余量表 | 硬木/软木 × 紧/标准/松 六格经验值，可编辑并持久化 |
| 方案库 | localStorage 保存方案，按类型/板厚筛选，支持 JSON 导出/导入（往返完全一致） |
| 打印 1:1 | A4 打印视图内置 100mm 校验尺，打印后实测可验证缩放；齿形模板页可直接描线 |
| 木工知识卡 | 7 张知识卡（标线、锯路、余量、胶合等） |

## 快速开始

```bash
cd app-019
npm ci

npm run dev        # 开发服务器（默认 5173）
npm run build      # tsc --noEmit 类型检查 + vite 生产构建
npm run preview    # 预览生产构建（端口 5199）

npm test           # 单元 + 组件测试（vitest）
npm run test:watch # watch 模式
npm run e2e        # Playwright 端到端测试（需先安装 chromium：npx playwright install chromium）
```

### Docker 部署

```bash
cd app-019
docker compose up -d --build
# 应用: http://localhost:8099  健康检查: http://localhost:8099/healthz
```

- 多阶段构建：`node:20-alpine` 构建 → `nginx:1.27-alpine` 运行，仅拷 `dist/` 与 `nginx.conf`
- 镜像实际体积：传输约 21MB / 解包约 40.6MB（满足蓝图 < 60MB 验收；部分 Docker UI 统计口径偏大）
- compose 服务名 `app-019`，端口 `8099:80`，`restart: unless-stopped`，内置 HEALTHCHECK
- nginx 配置：SPA 回退、`/assets/` immutable 缓存、`index.html` no-cache、gzip 含 `image/svg+xml`

对容器跑 E2E：

```bash
E2E_BASE_URL=http://localhost:8099 npx playwright test
```

## 项目结构

```
app-019/
├── src/
│   ├── types.ts               # 数据模型（JointKind / Params / Joint / Part / Drawing）
│   ├── lib/
│   │   ├── dovetail.ts        # 燕尾齿宽分配算法（核心）
│   │   ├── tenon.ts           # 直榫计算（榫厚 = 料厚 × 比例 + 配合余量）
│   │   ├── joints.ts          # 搭接 / 圆榫 / 拼板
│   │   ├── calc.ts            # computeJoint 门面（按类型分发）
│   │   ├── cutlist.ts         # 逐齿切割清单 + 注意事项（锯路/锯切线）
│   │   ├── fit.ts             # 配合余量表（默认值 + localStorage 持久化）
│   │   └── format.ts          # 0.1 / 0.5 步进格式化
│   ├── geometry/views.ts      # 三视图几何（front / top / side 统一数据模型）
│   ├── components/            # ViewSvg（SVG 渲染 + 校验尺）、ParamForm
│   ├── pages/                 # Home / New / Editor / Print / Library
│   ├── store/plans.ts         # 方案库：localStorage CRUD + JSON 导入导出
│   ├── router.ts              # 手写 hash 路由
│   └── data/knowledge.json    # 木工知识卡
├── tests/                     # vitest 单元 + RTL 组件测试
├── e2e/                       # Playwright 端到端测试
├── Dockerfile / docker-compose.yml / nginx.conf
└── vite.config.ts / playwright.config.ts
```

## 核心算法

### 燕尾齿宽分配（严格闭合）

直接对每齿独立取整会产生累积误差，本实现用**累积取整差分**保证闭合：

```text
totalUnits = round(板宽 / 0.1)          # 全部换算到 0.1mm 网格
per        = totalUnits / 齿数
pair[i]    = round(per × (i+1)) − round(per × i)   # 相邻差分，Σpair === totalUnits
齿顶/齿根按斜移量 d = round(2×斜移 / 0.1) 在 pair 内二次分配
```

- 边齿布局：槽宽 = 齿根宽，边距 = 半齿根宽
- 半隐燕尾：齿深 = 0.75 × 板厚；齿顶宽在槽底（最深面）
- 齿根宽低于最小值（软木 6mm / 硬木 4mm）时输出**警告**而非静默放行

### 直榫经验公式

```text
榫厚   = round01(榫孔板厚 × thicknessRatio + 配合余量)   # 默认比例 1/3：20mm 板 → 6.7mm
榫宽   = min(3 × 榫厚, 板宽 − 12)
榫肩   = (板宽 − 榫宽) / 2
穿透深度 = 榫孔板厚 + 1（露出部分便于修平）
```

## 数据与持久化

| Key | 内容 |
| --- | --- |
| `wjb.plans.v1` | 方案列表（参数 + 计算结果快照），导入导出即此结构 |
| `wjb.fittable.v1` | 可编辑配合余量表（损坏时自动回退默认值） |

路由（hash）：`#/` 方案列表 · `#/new` 新建 · `#/plan/:id` 编辑器 · `#/plan/:id/print` 打印视图 · `#/library` 知识卡

## 测试体系

| 层级 | 数量 | 覆盖点 |
| --- | --- | --- |
| 单元（vitest） | 43 | 随机 200 组燕尾闭合 ≤ 0.1mm（mulberry32 固定种子）、直榫 10 组手工核算、三视图一致性、边界警告、锯切线数量、导出导入往返全等、性能 |
| 组件（RTL） | 10 | 新建流程、键盘 ±0.5 微调、脏参数提示条、类型切换联动、列表筛选、非法导入错误提示、表单钳制 |
| E2E（Playwright） | 7 | 全流程（新建→出图→保存→列表）、警告场景、键盘微调、导出→删除→导入 viewBox 一致、打印校验尺、五类型出图、知识卡 |

性能验收：随机 200 组"参数计算 + 出图"单次最大 **0.51ms**（验收线 100ms）。

## 验收标准对照（蓝图 §10 / §12）

- [x] 齿宽分配 200 组随机闭合 ≤ 0.1mm，低于最小值给警告
- [x] 直榫 20mm 板默认比例 → 榫厚 6.7mm（10 组手工核算）
- [x] 三视图一致性（正视图宽度 = 俯视图宽度，断言）
- [x] 打印 1:1 带 100mm 校验尺与模板页
- [x] JSON 导出再导入参数与图纸完全一致（`JSON.stringify` 全等断言）
- [x] 参数重算 < 100ms（实测 max 0.51ms）
- [x] Docker 多阶段构建，服务 `app-019`，端口 8099，healthz，gzip 含 SVG，镜像 < 60MB（实测解包 40.6MB）

## 边界（刻意不做）

不做 3D 建模与效果图、不做电商下单、不做 CNC 刀路、不做木材库存——只做**榫卯尺寸计算 + 加工图纸**。
