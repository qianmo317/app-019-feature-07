// 数据模型（见蓝图 §7）
export type JointKind =
  | 'dovetail'
  | 'half-blind-dovetail'
  | 'mortise-tenon'
  | 'dowel'
  | 'lap'
  | 'panel-glue'

export type Wood = 'softwood' | 'hardwood'
export type Fit = 'tight' | 'standard' | 'loose'

export interface Board {
  thickness: number // 厚度 mm
  width: number     // 宽度 mm
}

export interface DovetailParams {
  angleRatio: 6 | 7 | 8 // 1:r
  teeth?: number        // 齿数，缺省自动建议
}

export interface TenonParams {
  thicknessRatio: number // 榫厚/料厚，默认 1/3
  lengthRatio: number    // 榫长/榫孔板厚，默认 1（穿透）
  offsetFromFace: number // 榫肩到腹板面距离 mm，缺省居中
}

export interface Params {
  boardA: Board // 齿板/榫舌板（A）
  boardB: Board // 销板/榫孔板（B）
  wood: Wood
  fit: Fit
  dovetail?: DovetailParams
  tenon?: TenonParams
  kerfMm: number // 锯路宽度 mm
}

export interface Joint {
  kind: JointKind
  params: Params
  notes: string[]
}

export interface Part {
  id: string
  name: string
  w: number
  h: number
  qty: number
  jointIds: string[]
}

export type Scale = '1:1' | '1:2' | '1:5'

export interface Drawing {
  id: string
  title: string
  parts: Part[]
  joints: Joint[]
  scale: Scale
  updatedAt: number
}

export const JOINT_KINDS: { kind: JointKind; label: string; desc: string }[] = [
  { kind: 'dovetail', label: '燕尾榫（穿透式）', desc: '抽屉/箱体四角，强度最高，全穿透' },
  { kind: 'half-blind-dovetail', label: '半隐燕尾榫', desc: '正面看不见端头，常用于抽屉前脸' },
  { kind: 'mortise-tenon', label: '直榫（榫头榫眼）', desc: '桌椅框架，榫厚约为料厚 1/3' },
  { kind: 'dowel', label: '圆木榫/饼干榫（定位孔）', desc: '快速定位拼接，打孔加木榫销' },
  { kind: 'lap', label: '企口/搭接（Lap）', desc: '十字格角半搭，厚度对半分' },
  { kind: 'panel-glue', label: '拼板（木钉/槽）', desc: '窄板拼宽面板，定位防错缝' },
]

export const KIND_LABEL: Record<JointKind, string> = Object.fromEntries(
  JOINT_KINDS.map((k) => [k.kind, k.label]),
) as Record<JointKind, string>
