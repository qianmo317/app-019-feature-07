// 三视图几何引擎：同一套几何数据生成正视图/俯视图/侧视图，保证一致性（蓝图 §8）
// 坐标系：局部坐标 mm，y 向下；渲染时整体加 padding
import type { Joint, JointKind } from '../types'
import type { DovetailResult } from '../lib/dovetail'
import type { TenonResult } from '../lib/tenon'
import type { LapResult, DowelResult, PanelResult } from '../lib/joints'
import { fmtDrawing } from '../lib/format'

export type ViewId = 'front' | 'top' | 'side'

export interface VLine {
  x1: number
  y1: number
  x2: number
  y2: number
  cls: 'cut' | 'thin' | 'saw' | 'hidden'
}
export interface VDim {
  orient: 'h' | 'v'
  from: number
  to: number
  at: number
  label: string
}
export interface VText {
  x: number
  y: number
  text: string
  anchor?: 'start' | 'middle' | 'end'
  cls?: 'note' | 'angle'
}
export interface VMark {
  x: number
  y: number
  text: string
}
export interface ViewModel {
  id: ViewId
  title: string
  contentW: number
  contentH: number
  lines: VLine[]
  dims: VDim[]
  texts: VText[]
  marks: VMark[]
}

const LJ = 36 // 大面视图沿板长方向的截取长度 mm

function base(id: ViewId, title: string, w: number, h: number): ViewModel {
  return { id, title, contentW: w, contentH: h, lines: [], dims: [], texts: [], marks: [] }
}
function rect(v: ViewModel, x: number, y: number, w: number, h: number, cls: VLine['cls'] = 'cut') {
  v.lines.push(
    { x1: x, y1: y, x2: x + w, y2: y, cls },
    { x1: x + w, y1: y, x2: x + w, y2: y + h, cls },
    { x1: x, y1: y + h, x2: x + w, y2: y + h, cls },
    { x1: x, y1: y, x2: x, y2: y + h, cls },
  )
}
function hdim(v: ViewModel, from: number, to: number, at: number, label: string) {
  v.dims.push({ orient: 'h', from, to, at, label })
}
function vdim(v: ViewModel, from: number, to: number, at: number, label: string) {
  v.dims.push({ orient: 'v', from, to, at, label })
}
function sawLines(v: ViewModel, x: number, y1: number, y2: number) {
  v.lines.push({ x1: x, y1, x2: x, y2, cls: 'saw' })
}

// —— 燕尾榫（穿透 / 半隐） ——
function dovetailViews(kind: JointKind, p: Joint['params'], dt: DovetailResult): ViewModel[] {
  const blind = kind === 'half-blind-dovetail'
  const W = p.boardA.width
  const t = p.boardA.thickness
  const Wb = p.boardB.width
  const tB = p.boardB.thickness
  const ratio = p.dovetail?.angleRatio ?? 8
  const kerf = p.kerfMm

  // 正视图：齿板端面（W × t），齿顶在展示面
  const front = base('front', blind ? '正视图 · 齿板端面（半隐）' : '正视图 · 齿板端面', W, t)
  rect(front, 0, 0, W, t)
  for (const th of dt.teeth) {
    if (blind) {
      // 半隐：齿从背面开槽，深 depth，不穿透展示面；虚线表示隐形轮廓
      const socketTop = t - dt.depth
      front.lines.push(
        { x1: th.backX, y1: t, x2: th.faceX, y2: socketTop, cls: 'hidden' },
        { x1: th.backX + th.rootW, y1: t, x2: th.faceX + th.topW, y2: socketTop, cls: 'hidden' },
        { x1: th.faceX, y1: socketTop, x2: th.faceX + th.topW, y2: socketTop, cls: 'hidden' },
      )
    } else {
      front.lines.push(
        { x1: th.faceX, y1: 0, x2: th.backX, y2: t, cls: 'cut' },
        { x1: th.faceX + th.topW, y1: 0, x2: th.backX + th.rootW, y2: t, cls: 'cut' },
        { x1: th.backX, y1: t, x2: th.backX + th.rootW, y2: t, cls: 'cut' },
      )
    }
    // 锯切线（理论线两侧 kerf/2 让入废料侧）
    sawLines(front, th.faceX - kerf / 2, 0, t)
    sawLines(front, th.faceX + th.topW + kerf / 2, 0, t)
    front.marks.push({ x: th.faceX + th.topW / 2, y: t / 2, text: String(th.index) })
  }
  hdim(front, 0, W, t + 12, `板宽 ${fmtDrawing(W)}`)
  vdim(front, 0, t, -12, `厚 ${fmtDrawing(t)}`)
  if (dt.teeth[0]) {
    hdim(front, dt.teeth[0].faceX, dt.teeth[0].faceX + dt.teeth[0].topW, -10, `齿顶 ${fmtDrawing(dt.teeth[0].topW)}`)
  }
  const slopeMid = dt.teeth[0]
  if (slopeMid) {
    front.texts.push({
      x: slopeMid.faceX - kerf / 2 - 3,
      y: t / 2,
      text: `斜度 1:${ratio}`,
      anchor: 'end',
      cls: 'angle',
    })
  }
  front.texts.push({ x: 0, y: t + 24, text: '细线=理论线　虚线=锯切线（含 kerf 补偿）', anchor: 'start', cls: 'note' })

  // 俯视图：齿板大面划线（W × LJ）
  const top = base('top', '俯视图 · 齿板大面划线', W, LJ)
  rect(top, 0, 0, W, LJ)
  for (const th of dt.teeth) {
    top.lines.push(
      { x1: th.faceX, y1: 0, x2: th.faceX, y2: LJ, cls: 'thin' },
      { x1: th.faceX + th.topW, y1: 0, x2: th.faceX + th.topW, y2: LJ, cls: 'thin' },
    )
    sawLines(top, th.faceX - kerf / 2, 0, LJ)
    sawLines(top, th.faceX + th.topW + kerf / 2, 0, LJ)
    top.marks.push({ x: th.faceX + th.topW / 2, y: LJ - 6, text: String(th.index) })
  }
  hdim(top, 0, W, LJ + 12, `板宽 ${fmtDrawing(W)}`)
  hdim(top, 0, dt.margin, -10, `边距 ${fmtDrawing(dt.margin)}`)
  if (dt.teeth.length >= 2) {
    hdim(top, dt.teeth[0].faceX, dt.teeth[1].faceX, -20, `齿距 ${fmtDrawing(dt.pitch)}`)
  }
  top.texts.push({ x: 0, y: LJ + 24, text: '↑ 拼接端；按虚线（锯切线）下锯', anchor: 'start', cls: 'note' })

  // 侧视图：销板端面（W_B × t_B），燕尾互补齿
  const side = base('side', '侧视图 · 销板端面', Wb, tB)
  rect(side, 0, 0, Wb, tB)
  const slope = tB / ratio
  for (const pin of dt.pins) {
    const y1 = 0 // 与齿板背面贴合面
    const y2 = tB
    const w1 = pin.backW // 贴合面处销宽
    const w2 = Math.max(0.5, pin.backW - 2 * slope) // 远端收窄
    const x1 = pin.backX
    const x2 = pin.backX + (w1 - w2) / 2
    side.lines.push(
      { x1: x1, y1: y1, x2: x2, y2: y2, cls: 'cut' },
      { x1: x1 + w1, y1: y1, x2: x2 + w2, y2: y2, cls: 'cut' },
      { x1: x2, y1: y2, x2: x2 + w2, y2: y2, cls: 'cut' },
    )
    if (!pin.half) side.marks.push({ x: x1 + w1 / 2, y: tB / 2, text: `销${pin.index}` })
  }
  hdim(side, 0, Wb, tB + 12, `板宽 ${fmtDrawing(Wb)}`)
  vdim(side, 0, tB, -12, `厚 ${fmtDrawing(tB)}`)
  side.texts.push({ x: 0, y: tB + 24, text: blind ? `配齿板：齿深 ${fmtDrawing(dt.depth)}mm（半隐）` : '配齿板：穿透', anchor: 'start', cls: 'note' })

  return [front, top, side]
}

// —— 直榫 ——
function tenonViews(p: Joint['params'], tn: TenonResult): ViewModel[] {
  const Wb = p.boardB.width
  const tB = p.boardB.thickness
  const Wa = p.boardA.width
  const ta = p.boardA.thickness
  const { tenonThickness: tt, tenonWidth: tw, tenonLength: tl, shoulder, offsetFromFace: off } = tn

  // 正视图：榫孔板端面（榫眼）
  const front = base('front', '正视图 · 榫孔板端面（榫眼）', Wb, tB)
  rect(front, 0, 0, Wb, tB)
  const mx = (Wb - tw) / 2
  const my = off
  rect(front, mx, my, tw, Math.min(tl, tB - my), 'cut')
  hdim(front, 0, Wb, tB + 12, `板宽 ${fmtDrawing(Wb)}`)
  vdim(front, 0, tB, -12, `厚 ${fmtDrawing(tB)}`)
  hdim(front, mx, mx + tw, my - 8, `眼宽 ${fmtDrawing(tw)}`)
  vdim(front, my, my + Math.min(tl, tB - my), Wb + 12, `眼深 ${fmtDrawing(Math.min(tl, tB))}`)
  hdim(front, 0, mx, tB + 24, `边距 ${fmtDrawing(mx)}`)
  front.texts.push({ x: 0, y: tB + 36, text: `榫厚 ${fmtDrawing(tt)}（含配合），锯切线内收 ${fmtDrawing(tn.mortiseSawOffset)} 补偿 kerf`, anchor: 'start', cls: 'note' })

  // 俯视图：榫舌板俯视（板宽 × 厚+榫长）
  const th = ta + tl + 6
  const top = base('top', '俯视图 · 榫舌板（含榫头伸出）', Wa, th)
  rect(top, 0, 0, Wa, ta)
  rect(top, shoulder, ta, tw, tl)
  top.lines.push({ x1: 0, y1: ta, x2: shoulder, y2: ta, cls: 'cut' })
  top.lines.push({ x1: shoulder + tw, y1: ta, x2: Wa, y2: ta, cls: 'cut' })
  hdim(top, 0, Wa, th + 10, `板宽 ${fmtDrawing(Wa)}`)
  hdim(top, 0, shoulder, -8, `肩 ${fmtDrawing(shoulder)}`)
  hdim(top, shoulder, shoulder + tw, -16, `榫宽 ${fmtDrawing(tw)}`)
  hdim(top, shoulder + tw, Wa, -8, `肩 ${fmtDrawing(shoulder)}`)
  vdim(top, ta, ta + tl, Wa + 12, `榫长 ${fmtDrawing(tl)}`)
  top.texts.push({ x: 0, y: th + 22, text: '榫肩四面过线，肩面留线刨修', anchor: 'start', cls: 'note' })

  // 侧视图：榫舌板侧视（厚 × 榫长区段）
  const side = base('side', '侧视图 · 榫头断面位置', ta, tl + 12)
  rect(side, 0, 0, ta, 12)
  rect(side, off, 12, tt, tl)
  vdim(side, 0, ta, -12, `厚 ${fmtDrawing(ta)}`)
  hdim(side, 0, off, 4, `腹边距 ${fmtDrawing(off)}`)
  hdim(side, off, off + tt, 4, `榫厚 ${fmtDrawing(tt)}`)
  hdim(side, off + tt, ta, 4, `边距 ${fmtDrawing(ta - off - tt)}`)
  vdim(side, 12, 12 + tl, ta + 12, `榫长 ${fmtDrawing(tl)}`)
  side.texts.push({ x: 0, y: tl + 24, text: '榫头对角倒棱 1mm 便于入孔', anchor: 'start', cls: 'note' })

  return [front, top, side]
}

// —— 搭接 ——
function lapViews(p: Joint['params'], lap: LapResult): ViewModel[] {
  const W = p.boardA.width
  const t = p.boardA.thickness
  const front = base('front', '正视图 · 半搭端面', W, t)
  rect(front, 0, 0, W, t)
  rect(front, 0, t - lap.depthEach, lap.lapLength, lap.depthEach, 'thin')
  front.lines.push({ x1: lap.lapLength, y1: t - lap.depthEach, x2: lap.lapLength, y2: t, cls: 'cut' })
  hdim(front, 0, W, t + 12, `板宽 ${fmtDrawing(W)}`)
  vdim(front, t - lap.depthEach, t, -12, `切深 ${fmtDrawing(lap.depthEach)}`)
  hdim(front, 0, lap.lapLength, -10, `搭接长 ${fmtDrawing(lap.lapLength)}`)
  front.texts.push({ x: 0, y: t + 24, text: '两板切深之和 = 料厚 ± 配合让刀', anchor: 'start', cls: 'note' })

  const top = base('top', '俯视图 · 搭接区划线', W, LJ)
  rect(top, 0, 0, W, LJ)
  top.lines.push({ x1: lap.lapLength, y1: 0, x2: lap.lapLength, y2: LJ, cls: 'cut' })
  hdim(top, 0, W, LJ + 12, `板宽 ${fmtDrawing(W)}`)
  hdim(top, 0, lap.lapLength, -10, `搭接长 ${fmtDrawing(lap.lapLength)}`)

  const side = base('side', '侧视图 · 切深', t, LJ)
  rect(side, 0, 0, t, LJ)
  side.lines.push({ x1: 0, y1: lap.depthEach, x2: t, y2: lap.depthEach, cls: 'cut' })
  vdim(side, 0, lap.depthEach, -12, `切深 ${fmtDrawing(lap.depthEach)}`)
  vdim(side, lap.depthEach, t, t + 12, `剩余 ${fmtDrawing(t - lap.depthEach)}`)
  side.texts.push({ x: 0, y: LJ + 12, text: '槽底与基准面平行', anchor: 'start', cls: 'note' })
  return [front, top, side]
}

// —— 圆木榫定位孔 ——
function dowelViews(p: Joint['params'], dw: DowelResult): ViewModel[] {
  const W = p.boardA.width
  const t = p.boardA.thickness
  const front = base('front', '正视图 · 端面孔位', W, t)
  rect(front, 0, 0, W, t)
  dw.positions.forEach((x, i) => {
    front.lines.push({ x1: x, y1: t / 2 - dw.dowelDia / 2, x2: x, y2: t / 2 + dw.dowelDia / 2, cls: 'thin' })
    front.marks.push({ x, y: t / 2, text: String(i + 1) })
  })
  hdim(front, 0, W, t + 12, `板宽 ${fmtDrawing(W)}`)
  if (dw.positions[0] !== undefined) hdim(front, 0, dw.positions[0], -10, `端距 ${fmtDrawing(dw.positions[0])}`)
  front.texts.push({ x: 0, y: t + 24, text: `木榫 Ø${dw.dowelDia} × ${dw.dowelLength}，孔深 ${fmtDrawing(dw.holeDepth)}（含 1mm 排胶）`, anchor: 'start', cls: 'note' })

  const top = base('top', '俯视图 · 孔位划线', W, LJ)
  rect(top, 0, 0, W, LJ)
  for (const x of dw.positions) top.lines.push({ x1: x, y1: 0, x2: x, y2: LJ, cls: 'thin' })
  hdim(top, 0, W, LJ + 12, `板宽 ${fmtDrawing(W)}`)
  if (dw.positions.length >= 2) {
    hdim(top, dw.positions[0], dw.positions[1], -10, `孔距 ${fmtDrawing(dw.positions[1] - dw.positions[0])}`)
  }

  const side = base('side', '侧视图 · 孔深', t, LJ)
  rect(side, 0, 0, t, LJ)
  side.lines.push({ x1: 0, y1: LJ - dw.holeDepth, x2: t, y2: LJ - dw.holeDepth, cls: 'hidden' })
  vdim(side, LJ - dw.holeDepth, LJ, -12, `孔深 ${fmtDrawing(dw.holeDepth)}`)
  side.texts.push({ x: 0, y: LJ + 12, text: '孔深打够并加深 1mm', anchor: 'start', cls: 'note' })
  return [front, top, side]
}

// —— 拼板 ——
function panelViews(p: Joint['params'], pn: PanelResult): ViewModel[] {
  const W = p.boardA.width
  const t = p.boardA.thickness
  const front = base('front', '正视图 · 拼缝端面（饼干榫槽）', W, t)
  rect(front, 0, 0, W, t)
  pn.positions.forEach((x, i) => {
    front.lines.push(
      { x1: x - 12, y1: t / 2 - 2, x2: x + 12, y2: t / 2 - 2, cls: 'thin' },
      { x1: x - 12, y1: t / 2 + 2, x2: x + 12, y2: t / 2 + 2, cls: 'thin' },
    )
    front.marks.push({ x, y: t / 2, text: String(i + 1) })
  })
  hdim(front, 0, W, t + 12, `板宽 ${fmtDrawing(W)}`)
  if (pn.positions[0] !== undefined) hdim(front, 0, pn.positions[0], -10, `端距 ${fmtDrawing(pn.positions[0])}`)
  front.texts.push({ x: 0, y: t + 24, text: `#${pn.biscuitSize} 饼干榫，槽深 ${fmtDrawing(pn.slotDepth)}；备选槽榫 ${pn.grooveWidth}×${fmtDrawing(pn.grooveDepth)}`, anchor: 'start', cls: 'note' })

  const top = base('top', '俯视图 · 榫位划线', W, LJ)
  rect(top, 0, 0, W, LJ)
  for (const x of pn.positions) top.lines.push({ x1: x, y1: 0, x2: x, y2: LJ, cls: 'thin' })
  hdim(top, 0, W, LJ + 12, `板宽 ${fmtDrawing(W)}`)

  const side = base('side', '侧视图 · 槽深', t, LJ)
  rect(side, 0, 0, t, LJ)
  side.lines.push({ x1: 0, y1: LJ - pn.slotDepth, x2: t, y2: LJ - pn.slotDepth, cls: 'hidden' })
  vdim(side, LJ - pn.slotDepth, LJ, -12, `槽深 ${fmtDrawing(pn.slotDepth)}`)
  return [front, top, side]
}

export function buildViews(joint: Joint, r: {
  dovetail?: DovetailResult
  tenon?: TenonResult
  lap?: LapResult
  dowel?: DowelResult
  panel?: PanelResult
}): ViewModel[] {
  switch (joint.kind) {
    case 'dovetail':
    case 'half-blind-dovetail':
      return r.dovetail ? dovetailViews(joint.kind, joint.params, r.dovetail) : []
    case 'mortise-tenon':
      return r.tenon ? tenonViews(joint.params, r.tenon) : []
    case 'lap':
      return r.lap ? lapViews(joint.params, r.lap) : []
    case 'dowel':
      return r.dowel ? dowelViews(joint.params, r.dowel) : []
    case 'panel-glue':
      return r.panel ? panelViews(joint.params, r.panel) : []
  }
}
