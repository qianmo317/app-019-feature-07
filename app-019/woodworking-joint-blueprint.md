# 木工榫卯参数化图纸生成 · Woodworking Joint Blueprint

> 类型：前端 Web 应用（纯前端）｜难度：★★★｜技术栈：**React 18 + TypeScript + Vite**（手写 CSS；无 UI 库、无外网 CDN，见 README「功能特性」）

## 1. 一句话简介
输入两块板的厚度与宽度、木料种类和配合松紧，算出燕尾榫等六种榫卯的加工尺寸，输出带尺寸标注的三视图 SVG、1:1 打印模板和逐齿切割清单。

## 2. 真实场景与痛点
- 燕尾齿宽分配是带约束的手算题：齿数、齿顶宽、齿根宽、半齿边距加起来必须**严格等于板宽**，差 0.5mm 装上去就是一条缝；每齿单独取整还会累积误差。
- 锯片有锯路（kerf），图纸画的是理论线，实际下锯要往废料侧让半个锯路；不标出来就只能现场凭手感留线。
- 硬木/软木、紧配/松配的榫厚余量是师傅脑子里的经验值，换个人、换一批料就对不上。
- 现成图纸多是 PDF 或图片，板宽板厚一变就得重画，也不方便标齿号与下锯顺序。
- 打印出来必须能直接描线：缩放没校准的图，描完就是错的。

## 3. 目标用户
- 独立木工与家具作坊（抽屉、箱体、桌椅框架）。
- 木工教学与培训（课堂演示齿宽分配与三视图对应关系）。
- 业余爱好者（用市售板材做第一个燕尾榫，需要能照着画的 1:1 模板）。

## 4. 核心功能（MVP）
1. **六种榫卯计算**（`src/types.ts:65` 的 `JOINT_KINDS`，编辑器可随时切换并即时重算）：
   燕尾榫（穿透式）、半隐燕尾榫、直榫（榫头榫眼）、圆木榫/饼干榫（定位孔）、企口/搭接（Lap）、拼板（木钉/槽）。
2. **燕尾齿宽分配**：0.1mm 网格 + 累积取整差分，Σ齿顶宽 + Σ齿根宽 与板宽严格闭合（误差 ≤ 0.1mm）；边距 = 半齿根宽（左右对称）；齿数可自动建议或手动指定（0 = 自动，上限 12）。
3. **三视图出图**：正视图 / 俯视图 / 侧视图由同一套几何函数生成，共用 `ViewModel` 数据模型，宽度一致；自动尺寸标注 + 齿序编号圆标（`src/geometry/views.ts`）。
4. **锯路补偿**：图纸同时标注理论线与锯切线（锯切线 = 理论线向废料侧偏移 kerf/2），切割步骤按「先锯废料侧」排序。
5. **配合余量表**：硬木/软木 × 紧/标准/松 六格经验值，可编辑并持久化，数据损坏时回退默认表。
6. **方案库**：localStorage 保存方案（参数 + 图纸快照），按「榫卯类型 + 板厚」筛选，支持 JSON 导出/导入，往返结构完全一致。
7. **打印 1:1**：A4 打印视图内置 100mm 校验尺与齿形模板页，可用直尺实测验证缩放。
8. **木工知识卡**：7 张（标线、锯路、余量、胶合、拼板防翘曲、打印技巧）。

## 5. 进阶功能
- **类型切换联动**：编辑器内切换六种类型时，参数表单、三视图、齿宽表（仅燕尾）与切割步骤同步换掉（`src/pages/EditorPage.tsx:50`）。
- **直榫三参数**：榫厚/料厚比（0.2~0.5，默认 1/3）、榫长/孔板厚比（0.4~1，< 1 即盲榫）、腹边距。
- **半隐燕尾**：齿深 = 0.75 × 板厚，正视图用 `hidden` 虚线画出不穿透展示面的槽底。
- **内建性能读数**：编辑器把「参数改动 → 计算 + 出图」的耗时直接显示在页面上（`data-testid="recalc-ms"`），验收线 100ms。
- **两类扩展尚未接 UI**（数据模型已就位，见 §11「已知实现边界」）：按 1:2 / 1:5 缩放出图、单方案挂多个榫卯。

## 6. 页面结构
```
#/                  方案列表（筛选 + 导入 + 删除）
#/new               新建：选榫卯类型 → 填参数 → 生成图纸
#/plan/:id          编辑器（左：类型与参数  中：三视图 + 齿宽表  右：切割步骤）
#/plan/:id/print    打印视图（校验尺 + 1:1 模板页 + 切割步骤）
#/library           榫卯知识卡
```
手写 hash 路由（`src/router.ts:11` 的 `parseHash`，无第三方路由库）；顶栏三个入口：方案 / 新建 / 知识卡，路由不匹配一律回首页。

## 7. 数据模型
```ts
type JointKind = 'dovetail'|'half-blind-dovetail'|'mortise-tenon'|'dowel'|'lap'|'panel-glue'
type Wood = 'softwood'|'hardwood';  type Fit = 'tight'|'standard'|'loose'
interface Board  { thickness: number; width: number }                    // mm
interface Params { boardA: Board; boardB: Board; wood: Wood; fit: Fit;   // A = 齿板/榫舌板，B = 销板/榫孔板
                   dovetail?: { angleRatio: 6|7|8; teeth?: number };
                   tenon?: { thicknessRatio: number; lengthRatio: number; offsetFromFace: number };
                   kerfMm: number }
interface Joint  { kind: JointKind; params: Params; notes: string[] }
interface Part   { id: string; name: string; w: number; h: number; qty: number; jointIds: string[] }
type Scale = '1:1'|'1:2'|'1:5'
interface Drawing { id: string; title: string; parts: Part[]; joints: Joint[]; scale: Scale; updatedAt: number }
type FitTable = Record<Wood, Record<Fit, number>>                        // 榫厚修正量 mm
interface ViewModel { id: 'front'|'top'|'side'; title: string; contentW: number; contentH: number
                      lines: VLine[]; dims: VDim[]; texts: VText[]; marks: VMark[] }
```
线型分类 `VLine.cls`：`cut`（轮廓 0.5）/ `thin`（细线 0.25）/ `saw`（锯切线，虚线）/ `hidden`（隐形轮廓，灰虚线）。
持久化键（`localStorage`）：`wjb.plans.v1`（方案列表）、`wjb.fittable.v1`（配合余量表）。

## 8. 关键算法（或关键实现点）
- **累积取整差分（燕尾齿宽分配，`src/lib/dovetail.ts:81-104`）**：先整体换算到 0.1mm 网格，再逐齿取相邻差分，保证总和严格闭合。
  ```text
  totalUnits = round(板宽 / 0.1);  per = totalUnits / 齿数
  pair[i]    = round(per × (i+1)) − round(per × i)      # Σpair === totalUnits
  d          = round(2 × 斜移量 / 0.1);  斜移量 = 齿深 / 角度比 r
  topUnits[i] = round((pair[i] + d) / 2);  rootUnits[i] = pair[i] − topUnits[i]
  边距 = 末齿齿根宽 / 2；齿间槽宽 = 该齿齿根宽
  ```
  逐齿偏差 ≤ 1 格（0.1mm），闭合误差 `closureError` 每轮实测（编辑器页脚显示到小数点后 3 位）。
- **齿数建议（`dovetail.ts:56`）**：目标齿距约 28mm，`clamp(round(板宽/28), 2, 12)`，然后在不超过 2 齿的前提下递减，直到齿根宽 ≥ 最小安全值。
- **不静默放行**：齿根 < `MIN_ROOT`（软木 6mm / 硬木 4mm，`dovetail.ts:12`）、齿顶 < 2×kerf（锯片切不出来）、板宽 ≥ 150 而齿数 < 3、齿距 < 15mm、齿数为负值或超出 2~12，都写入 `warnings` 并在编辑器 `role="alert"` 区域展示。
- **直榫经验公式（`src/lib/tenon.ts:42-53`）**：
  ```text
  名义榫厚 = round01(tA × thicknessRatio)；榫厚 = round01(名义 + 配合余量表值)
  榫宽     = min(3 × 榫厚, tA 板宽 − 12)；肩宽 = (板宽 − 榫宽) / 2
  榫长     = round01(tB × lengthRatio)
  榫眼深   = lengthRatio ≥ 1 ? round01(tB + 1) : 榫长     # 穿透孔眼底加深 1mm 防顶底
  腹边距   = 显式入参 ?? round01((tA − 榫厚) / 2)
  榫眼锯切线内收 = round01(kerf / 2)                       # 锯/凿让刀，保住名义尺寸
  ```
- **配合余量表（`src/lib/fit.ts:12`）**：`hardwood { tight: 0.2, standard: 0, loose: -0.3 }`、`softwood { tight: 0.3, standard: 0, loose: -0.4 }`；`loadFitTable` 逐格合并默认值，`JSON.parse` 抛错即整体回退，读到的是非缺省格也不会整表丢掉。
- **三视图一致性（`src/geometry/views.ts:302`）**：`buildViews` 按类型分派到 5 个几何函数，每类返回 3 个 `ViewModel`；正视图 `contentW` 恒等于俯视图 `contentW`（单测逐类型断言）；大面截取长度常量 `LJ = 36mm`。
- **锯路补偿的实现范围**：燕尾正/俯视图每齿两侧各画一条 `saw` 线（数量 = 2 × 齿数，单测断言），搭接/圆榫/拼板视图不画锯切线（见 §11）。
- **切割清单（`src/lib/cutlist.ts`）**：`buildCutList` 输出 `{ boardA, boardB, cautions }`，A 件按类型给 3~7 步、B 件给 1~5 步，步骤号有序；注意事项恒定包含锯路规则与「先在废料上试锯」。
- **数值格式化（`src/lib/format.ts`）**：内部统一 0.1mm（`round01`），图纸与列表标注用 0.5mm 步进（`round05` / `fmtDrawing`，整数不带 `.0`），计算表格用 `fmt01` 保留一位小数。
- **重算性能**：参数改动即 `useMemo` 重算「计算 + 出图」（`EditorPage.tsx:22-29`）；200 组随机配置的单次耗时本机实测最大 **0.57ms**（`vitest run` 控制台输出）。

## 9. 交互与视觉要点
- 白底黑线图纸风：轮廓 `#1a1a1a`、尺寸线与标注 `#7aa7c9`、警示文字 `#b3591f`；线宽 0.25 / 0.35 / 0.5 分级，黑白打印可辨（`src/styles.css:92-103`）。
- 尺寸标注自动带端部短刻度线（`ViewSvg.tsx:16` `dimEl`），竖排尺寸文字按位置旋转 ±90°；齿号用白底圆标压在齿中心。
- 编辑器三栏 `300px | 1fr | 300px`，窄于 1100px 折成单列；参数改动后出现「参数已改，请重新核对尺寸」提示条，保存后消失。
- 键盘流：数字输入框内 `↑` / `↓` 按 0.5mm（kerf 按 0.1mm）步进微调，输入即钳制到 `min/max`（如板宽 20~900、板厚 3~80），不产生越界中间态。
- 打印：`@media print` 隐藏 `.no-print`（顶栏与打印工具栏），打印页宽度限制 210mm（A4），每个打印区块 `break-inside: avoid`；页面上直接写清「关闭适应页面/缩放，100% 打印」。

## 10. 验收标准
- **齿宽分配**：200 组随机参数（可复现种子 `mulberry32(20260916)`，板宽 50~600、齿数 2~12、角度比 6/7/8、kerf 0.8~2.2）闭合误差 ≤ 0.1mm；低于最小安全值等违规情形必须出警告，正常情形警告必须为空。
- **直榫**：10 组手工核算用例，20mm 硬木标准配合 → 榫厚 6.7mm；紧配 +0.2、松配 −0.3；穿透榫眼深 = 孔板厚 + 1。
- **三视图**：六种类型逐一断言 `front.contentW === top.contentW`，每类 3 个视图，几何坐标不越界；燕尾锯切线数 = 2 × 齿数，齿序编号覆盖每个齿。
- **导出/导入**：`importJSON(exportJSON(plan))` 与原文 `JSON.stringify` 全等；缺字段或坏 JSON 必须抛错；E2E 覆盖「导出 → 删除 → 导入 → viewBox 与参数一致」。
- **性能**：参数改动到图纸重算 < 100ms（README 记录 0.51ms，本机重跑 0.57ms）。
- **测试总量**：vitest 5 个文件 53 例 = 单元 43（dovetail 8 / tenon 13 / views 14 / store 8）+ 组件 10；Playwright E2E 7 例。
- **打印**：页面含 100mm 校验尺，实测 0→100 段误差 ≤ 1mm；打印调用与模板页可被 E2E 断言。
- **容器**：`docker compose up -d --build` 后 `curl http://localhost:8099/healthz` 返回 `ok`，容器 healthy（详见 §12）。

## 11. 边界（刻意不做）
不做 3D 建模与效果图、不做电商下单与报价、不做 CNC 刀路与 G 代码、不做木材库存与用量统计、不做账号与云端同步——只做**榫卯尺寸计算 + 加工图纸 + 1:1 打印**。

### 已知实现边界
以下为 README 表述与代码不一致、或 README 声称而代码未实现之处，逐条核对后列出：
1. **开发端口写错**：README「快速开始」写 `npm run dev # 开发服务器（默认 5173）`，实际 `vite.config.ts:6-7` 把 dev 与 preview 都固定在 **5199**，两个脚本不能同时启动。
2. **锯路补偿只覆盖两种类型**：`computeLap` / `computeDowel` / `computePanel` 内部以 `void input.kerf`（`src/lib/joints.ts:24,58,92`）显式丢弃 kerf，对应的三视图也没有 `saw` 线；README 笼统写「图纸同时标注理论线与锯切线」，实际只有燕尾与直榫如此。
3. **「腹边距 0=居中」与实际不符**：`ParamForm.tsx:215` 标签写「0=居中」，但 `setTn` 的默认值把 `offsetFromFace` 写成 `0`（`ParamForm.tsx:71`），`calc.ts:45` 用 `?? null` 判断、`tenon.ts:52` 只在 `null` 时居中——一旦改动任一「直榫参数」字段，腹边距就变成 0（榫头贴腹板面）而非居中。
4. **榫眼 +1mm 的解释与代码/知识卡不同**：README 写「穿透深度 = 榫孔板厚 + 1（露出部分便于修平）」，代码注释与知识卡都写的是眼底留量防（胶）顶底；且加 1mm 的是 `mortiseDepth`，`tenonLength` 不加（`tenon.ts:50-51`）。
5. **`Scale` 与多榫卯只有模型没有界面**：`Drawing.scale` 恒为 `'1:1'`（`store/plans.ts:95`），`Part.jointIds` 恒为空数组（`plans.ts:91-92`）；编辑器只渲染 `joints[0]`（`EditorPage.tsx:40`），方案筛选同样只看 `joints[0]`（`plans.ts:42`），打印视图按实际尺寸出（`EditorPage.tsx:276`），因此 1:2 / 1:5 出图与单方案多榫卯均未实现。
6. **图内注释文字与线型不完全对得上**：`views.ts:120` 的提示写「细线=理论线　虚线=锯切线」，而正视图的理论轮廓用的是 `cut`（0.5 实线），`thin`（0.25）只用在俯视图大面划线上。
7. **导入校验偏松**：`importJSON` 只校验 `id/title/joints/joints[0].kind/params.boardA`（`plans.ts:58-64`），缺 `boardB`、`wood`、`fit`、`kerfMm` 的 JSON 会被接受，随后计算可能得到 `NaN` 尺寸而不是报错。
8. **`Joint.notes` 未被使用**：`makePlan` 的第 3 个参数默认空数组，两个调用点都不传，编辑器也不渲染。

## 12. 容器化与构建（Docker）

交付以容器内运行结果为准。

- **Dockerfile（两阶段，`Dockerfile:2-14`）**：`node:20-alpine` 中 `npm ci --no-audit --no-fund` → `npm run build`（等价 `tsc --noEmit && vite build`）；运行阶段 `nginx:1.27-alpine`，只拷 `dist/` 与 `nginx.conf`，`EXPOSE 80`。
- **docker-compose.yml**：服务名 `app-019`，端口 **`8099:80`**，`restart: unless-stopped`，健康检查 `wget -qO- http://127.0.0.1/healthz`，`interval 30s / timeout 3s / retries 3`。
- **nginx.conf**：`/healthz` 直接 `return 200 'ok'`（`text/plain`，不写访问日志）；`/assets/` 带哈希资源 `max-age=31536000, immutable`；其余走 SPA 回退 `try_files $uri $uri/ /index.html` 且 `no-cache`；gzip 等级 5、最小 1024 字节，类型含 `text/css application/javascript application/json image/svg+xml`。
- **无后端、无外网依赖**：计算、出图、导出全在浏览器内完成，断网可用；中文字体走系统字体栈，不引 CDN。

```bash
cd app-019
docker compose up -d --build
curl http://localhost:8099/healthz          # 期望输出 ok
docker compose ps                           # 期望 healthy
E2E_BASE_URL=http://localhost:8099 npx playwright test
docker compose down
```

- **验收**：浏览器打开 `http://localhost:8099`，完成「新建 → 出三视图 → 改参数看警告 → 保存 → 导出 JSON → 打印 1:1 并核对 100mm 校验尺」；镜像解包体积 < 60MB（README 记录实测约 40.6MB，未在本机复测）。
- **本地脚本端口**：`npm run dev` / `npm run preview` 均为 5199（`vite.config.ts:6-7`），Playwright 默认 `baseURL` 指向 `http://localhost:5199`，容器验证时用 `E2E_BASE_URL` 覆盖（`playwright.config.ts:9-20`）。

### 忽略文件（.dockerignore / .gitignore）

- **`.dockerignore`**（19 行）：`node_modules`、`dist`、`.git`、`.gitignore`、`.env`、`.env.*`、`*.log`、`coverage`、`.vscode`、`.idea`、`Dockerfile`、`docker-compose.yml`、`README.md`、`test-results`、`playwright-report`、`e2e`、`tests`、`design-src`、`*.sketch`。
  - 构建上下文因此不含测试与构建产物；**`nginx.conf` 未被忽略**，运行阶段才能 `COPY` 到 `/etc/nginx/conf.d/default.conf`；`package-lock.json` 与 `src/data/knowledge.json` 保留（构建需要）。
  - `tests` 被排除后，`npm run build` 中 `tsc --noEmit` 的 `include` 只命中实际存在的 `src`，不会报缺文件。
- **`.gitignore`**（14 行）：`node_modules/`、`dist/`、`.env*`、`*.log`、`coverage/`、`.DS_Store`、`.vscode/`、`.idea/`、`design-src/`、`exports/`、`*.pdf`、`test-results/`、`playwright-report/`、`.playwright-browsers/`。
- **自检**：`git status` 不出现 `.env`、构建产物与 Playwright 报告；仓库根不含用户导出的 JSON 与 PDF。
