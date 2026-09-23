// 方案库：localStorage 持久化 + 导出/导入 JSON
// 一个方案可挂多个榫卯：每个榫卯通过 partAId/partBId 指向它作用的两个零件，
// Part.jointIds 为反推索引；旧版数据（无 id 关联）在读取/导入时迁移规范化。
import type { Drawing, JointKind, Joint, Params, Part, Wood, Fit } from '../types'
import { KIND_LABEL } from '../types'

const KEY = 'wjb.plans.v1'

let seq = 0
export function newId(prefix: string = 'p'): string {
  seq++
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}`
}

/** 新榫卯的默认参数（新建方案/在方案中追加榫卯共用） */
export function makeParams(kind: JointKind): Params {
  const params: Params = {
    boardA: { thickness: 18, width: 200 },
    boardB: { thickness: 18, width: 200 },
    wood: 'hardwood',
    fit: 'standard',
    kerfMm: 1.1,
  }
  if (kind === 'dovetail' || kind === 'half-blind-dovetail') params.dovetail = { angleRatio: 8 }
  if (kind === 'mortise-tenon') params.tenon = { thicknessRatio: 1 / 3, lengthRatio: 1, offsetFromFace: 0 }
  return params
}

export function makeJoint(kind: JointKind, partAId: string | null = null, partBId: string | null = null, params?: Params, notes: string[] = []): Joint {
  return { id: newId('j'), kind, params: params ?? makeParams(kind), partAId, partBId, notes }
}

function makePart(name: string, thickness: number, width: number): Part {
  return {
    id: newId('part'),
    name,
    lengthMm: 400,
    widthMm: width,
    thicknessMm: thickness,
    qty: 1,
    jointIds: [],
  }
}

/** 由 joints 的 partAId/partBId 反推每个零件的 jointIds（去重） */
export function rebuildPartJointIds(parts: Part[], joints: Joint[]): Part[] {
  const idsByPart = new Map<string, string[]>()
  for (const j of joints) {
    for (const pid of [j.partAId, j.partBId]) {
      if (!pid) continue
      const arr = idsByPart.get(pid)
      if (arr) {
        if (!arr.includes(j.id)) arr.push(j.id)
      } else {
        idsByPart.set(pid, [j.id])
      }
    }
  }
  return parts.map((pt) => ({ ...pt, jointIds: idsByPart.get(pt.id) ?? [] }))
}

export function makePlan(kind: JointKind, params: Params, notes: string[] = []): Drawing {
  const tA = params.boardA.thickness
  const tB = params.boardB.thickness
  const partA = makePart('件 A（齿板/榫舌板）', tA, params.boardA.width)
  const partB = makePart('件 B（销板/榫孔板）', tB, params.boardB.width)
  const joint = makeJoint(kind, partA.id, partB.id, params, notes)
  return {
    id: newId(),
    title: `${KIND_LABEL[kind]} · ${tA}/${tB}mm`,
    parts: rebuildPartJointIds([partA, partB], [joint]),
    joints: [joint],
    scale: '1:1',
    updatedAt: Date.now(),
  }
}

// —— 迁移与导入校验 ——

const WOODS: Wood[] = ['softwood', 'hardwood']
const FITS: Fit[] = ['tight', 'standard', 'loose']
const KINDS = Object.keys(KIND_LABEL) as JointKind[]

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

function assertBoard(v: unknown, name: string): { thickness: number; width: number } {
  const b = v as { thickness?: unknown; width?: unknown } | null
  if (!b || !isNum(b.thickness) || !isNum(b.width)) throw new Error(`params.${name} 尺寸缺失`)
  return { thickness: b.thickness, width: b.width }
}

/**
 * 规范化任意来源的方案数据：
 *  - 旧版（Joint 无 id/partAId、Part 为 w/h、jointIds 恒空）自动迁移；
 *  - 校验失败抛 Error；对同一数据幂等（导入 → 导出往返 JSON.stringify 全等）。
 */
export function normalizePlan(raw: unknown): Drawing {
  const obj = raw as Partial<Drawing> | null
  if (!obj || typeof obj !== 'object') throw new Error('无效的 JSON')
  if (!obj.id || typeof obj.id !== 'string') throw new Error('缺少必要字段（id/title/joints）')
  if (!obj.title || typeof obj.title !== 'string') throw new Error('缺少必要字段（id/title/joints）')
  if (!Array.isArray(obj.joints) || obj.joints.length === 0) throw new Error('缺少必要字段（id/title/joints）')

  // 零件迁移：旧版字段 w/h（w=板宽、h=板厚）→ lengthMm/widthMm/thicknessMm
  const rawParts: Part[] = Array.isArray(obj.parts)
    ? obj.parts.map((p, i) => {
        const rp = p as Partial<Part> & { w?: number; h?: number }
        return {
          id: typeof rp.id === 'string' && rp.id ? rp.id : newId('part'),
          name: typeof rp.name === 'string' && rp.name ? rp.name : `零件 ${i + 1}`,
          lengthMm: isNum(rp.lengthMm) ? rp.lengthMm : isNum(rp.w) ? rp.w : 400,
          widthMm: isNum(rp.widthMm) ? rp.widthMm : isNum(rp.w) ? rp.w : 200,
          thicknessMm: isNum(rp.thicknessMm) ? rp.thicknessMm : isNum(rp.h) ? rp.h : 18,
          qty: typeof rp.qty === 'number' && Number.isFinite(rp.qty) && rp.qty >= 1 ? Math.floor(rp.qty) : 1,
          jointIds: [],
        }
      })
    : []
  const partIds = new Set(rawParts.map((p) => p.id))

  const usedJointIds = new Set<string>()
  const joints: Joint[] = obj.joints.map((rawJoint, ji) => {
    const rj = rawJoint as Partial<Joint>
    if (!rj || typeof rj !== 'object' || typeof rj.kind !== 'string' || !KINDS.includes(rj.kind)) {
      throw new Error(`joints[${ji}] 缺少 kind`)
    }
    const rp = rj.params as Params | undefined
    if (!rp || typeof rp !== 'object') throw new Error(`joints[${ji}] 缺少 kind/params`)
    // 保留 params 原键顺序（直接展开原对象），逐字段校验
    const boardA = assertBoard(rp.boardA, 'boardA')
    const boardB = assertBoard(rp.boardB, 'boardB')
    if (!WOODS.includes(rp.wood as Wood)) throw new Error(`joints[${ji}] wood 非法`)
    if (!FITS.includes(rp.fit as Fit)) throw new Error(`joints[${ji}] fit 非法`)
    if (!isNum(rp.kerfMm)) throw new Error(`joints[${ji}] kerfMm 缺失`)
    const params: Params = { ...rp, boardA, boardB }
    if (params.dovetail && ![6, 7, 8].includes(params.dovetail.angleRatio)) {
      throw new Error(`joints[${ji}] dovetail.angleRatio 非法`)
    }
    if (params.tenon) {
      const t = params.tenon
      if (![t.thicknessRatio, t.lengthRatio, t.offsetFromFace].every((v) => typeof v === 'number' && Number.isFinite(v))) {
        throw new Error(`joints[${ji}] tenon 参数非法`)
      }
    }

    let jid = typeof rj.id === 'string' && rj.id && !usedJointIds.has(rj.id) ? rj.id : newId('j')
    usedJointIds.add(jid)

    const refOk = (v: unknown): v is string => typeof v === 'string' && v !== '' && partIds.has(v)
    let partAId: string | null = refOk(rj.partAId) ? rj.partAId : null
    let partBId: string | null = refOk(rj.partBId) ? rj.partBId : null
    // 旧版方案：榫卯没有 partAId/partBId 字段，首个榫卯自动挂到前两个零件
    const legacyJoint = rj.partAId === undefined && rj.partBId === undefined
    if (legacyJoint && ji === 0 && rawParts.length >= 2) {
      partAId = rawParts[0].id
      partBId = rawParts[1].id
    }

    return {
      id: jid,
      kind: rj.kind,
      params,
      partAId,
      partBId,
      notes: Array.isArray(rj.notes) ? rj.notes.filter((n): n is string => typeof n === 'string') : [],
    }
  })

  const parts = rebuildPartJointIds(rawParts, joints)
  return {
    id: obj.id,
    title: obj.title,
    parts,
    joints,
    scale: obj.scale === '1:2' || obj.scale === '1:5' ? obj.scale : '1:1',
    updatedAt: typeof obj.updatedAt === 'number' ? obj.updatedAt : Date.now(),
  }
}

// —— localStorage ——

export function loadPlans(): Drawing[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr.map((p) => normalizePlan(p)) as Drawing[]) : []
  } catch {
    return []
  }
}

export function savePlans(plans: Drawing[]): void {
  localStorage.setItem(KEY, JSON.stringify(plans))
}

export function upsertPlan(plan: Drawing): Drawing[] {
  const plans = loadPlans()
  const i = plans.findIndex((p) => p.id === plan.id)
  if (i >= 0) plans[i] = plan
  else plans.unshift(plan)
  savePlans(plans)
  return plans
}

export function deletePlan(id: string): Drawing[] {
  const plans = loadPlans().filter((p) => p.id !== id)
  savePlans(plans)
  return plans
}

export function getPlan(id: string): Drawing | undefined {
  return loadPlans().find((p) => p.id === id)
}

/** 方案用到的全部榫卯类型（去重，保持出现顺序） */
export function planKinds(plan: Drawing): JointKind[] {
  const seen = new Set<JointKind>()
  const out: JointKind[] = []
  for (const j of plan.joints) {
    if (!seen.has(j.kind)) {
      seen.add(j.kind)
      out.push(j.kind)
    }
  }
  return out
}

/** 方案涉及的全部 A 板厚度 */
export function planThicknesses(plan: Drawing): number[] {
  return [...new Set(plan.joints.map((j) => j.params.boardA.thickness).filter((t) => Number.isFinite(t)))]
}

/** 按「榫卯类型 + 木料厚度」筛选：方案任一榫卯命中即保留 */
export function filterPlans(plans: Drawing[], kind: JointKind | 'all', thickness: number | 'all'): Drawing[] {
  return plans.filter((p) => {
    if (p.joints.length === 0) return false
    if (kind !== 'all' && !p.joints.some((j) => j.kind === kind)) return false
    if (thickness !== 'all' && !planThicknesses(p).includes(thickness)) return false
    return true
  })
}

export function exportJSON(plan: Drawing): string {
  return JSON.stringify(plan, null, 2)
}

/** 导入校验：结构合法返回规范化后的 Drawing，否则抛错 */
export function importJSON(text: string): Drawing {
  return normalizePlan(JSON.parse(text) as unknown)
}

export function downloadJSON(plan: Drawing): void {
  const blob = new Blob([exportJSON(plan)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${plan.title || 'plan'}.json`
  a.click()
  URL.revokeObjectURL(url)
}

// —— 编辑器纯函数式变更（均返回新 Drawing，不触碰 localStorage） ——

function mutate(plan: Drawing, fn: (draft: { parts: Part[]; joints: Joint[] }) => void): Drawing {
  const parts = plan.parts.map((p) => ({ ...p }))
  const joints = plan.joints.map((j) => ({ ...j, params: { ...j.params, boardA: { ...j.params.boardA }, boardB: { ...j.params.boardB } } }))
  fn({ parts, joints })
  return { ...plan, parts: rebuildPartJointIds(parts, joints), joints, updatedAt: Date.now() }
}

export function renamePlan(plan: Drawing, title: string): Drawing {
  return { ...plan, title, updatedAt: Date.now() }
}

/** 零件截面宽/厚改动：同步到以该零件为 A/B 的所有榫卯参数 */
export function updatePart(plan: Drawing, partId: string, patch: Partial<Pick<Part, 'name' | 'lengthMm' | 'widthMm' | 'thicknessMm' | 'qty'>>): Drawing {
  return mutate(plan, ({ parts, joints }) => {
    const p = parts.find((x) => x.id === partId)
    if (!p) return
    Object.assign(p, patch)
    for (const j of joints) {
      if (j.partAId === partId) {
        if (patch.thicknessMm !== undefined) j.params.boardA.thickness = patch.thicknessMm
        if (patch.widthMm !== undefined) j.params.boardA.width = patch.widthMm
      }
      if (j.partBId === partId) {
        if (patch.thicknessMm !== undefined) j.params.boardB.thickness = patch.thicknessMm
        if (patch.widthMm !== undefined) j.params.boardB.width = patch.widthMm
      }
    }
  })
}

export function addPart(plan: Drawing): Drawing {
  return mutate(plan, ({ parts }) => {
    parts.push(makePart(`零件 ${parts.length + 1}`, 18, 120))
  })
}

/** 删除零件：被榫卯引用的零件不允许删（先在榫卯里改挂其他零件） */
export function removePart(plan: Drawing, partId: string): Drawing {
  const used = plan.joints.some((j) => j.partAId === partId || j.partBId === partId)
  if (used) return plan
  return mutate(plan, ({ parts }) => {
    const i = parts.findIndex((p) => p.id === partId)
    if (i >= 0) parts.splice(i, 1)
  })
}

export function partInUse(plan: Drawing, partId: string): boolean {
  return plan.joints.some((j) => j.partAId === partId || j.partBId === partId)
}

/** 在方案中追加一个榫卯（默认不挂零件，参数取类型默认值） */
export function addJoint(plan: Drawing, kind: JointKind): { plan: Drawing; jointId: string } {
  const joint = makeJoint(kind)
  const next = mutate(plan, ({ joints }) => {
    joints.push(joint)
  })
  return { plan: next, jointId: joint.id }
}

export function removeJoint(plan: Drawing, jointId: string): Drawing {
  return mutate(plan, ({ joints }) => {
    const i = joints.findIndex((j) => j.id === jointId)
    if (i >= 0) joints.splice(i, 1)
  })
}

export function setJointKind(plan: Drawing, jointId: string, kind: JointKind): Drawing {
  return mutate(plan, ({ joints }) => {
    const j = joints.find((x) => x.id === jointId)
    if (j) {
      j.kind = kind
      // 保留共用参数（两块板截面 / 木料 / 配合 / 锯路），只按新类型重建专属参数
      const base = makeParams(kind)
      j.params = {
        boardA: j.params.boardA,
        boardB: j.params.boardB,
        wood: j.params.wood,
        fit: j.params.fit,
        kerfMm: j.params.kerfMm,
        ...(base.dovetail ? { dovetail: { ...base.dovetail } } : {}),
        ...(base.tenon ? { tenon: { ...base.tenon } } : {}),
      }
    }
  })
}

/**
 * 榫卯参数改动：若该榫卯已挂零件，A/B 截面尺寸反写到对应零件，
 * 并继续同步到共用该零件的其他榫卯（零件是截面尺寸的唯一事实源）。
 */
export function updateJointParams(plan: Drawing, jointId: string, params: Params): Drawing {
  return mutate(plan, ({ parts, joints }) => {
    const j = joints.find((x) => x.id === jointId)
    if (!j) return
    j.params = params
    const syncPart = (pid: string | null, side: 'A' | 'B') => {
      if (!pid) return
      const p = parts.find((x) => x.id === pid)
      if (!p) return
      const b = side === 'A' ? params.boardA : params.boardB
      // 同一零件被本榫卯两侧复用：以 A 侧为准，B 侧参数对齐 A
      const reused = j.partAId === pid && j.partBId === pid
      const eff = reused ? params.boardA : b
      if (side === 'B' && reused) {
        j.params.boardB = { ...params.boardA }
      }
      p.thicknessMm = eff.thickness
      p.widthMm = eff.width
      for (const other of joints) {
        if (other.id === j.id) continue
        const ob = other.partAId === pid ? other.params.boardA : other.partBId === pid ? other.params.boardB : null
        if (ob) {
          ob.thickness = eff.thickness
          ob.width = eff.width
        }
      }
    }
    syncPart(j.partAId, 'A')
    syncPart(j.partBId, 'B')
  })
}

/** 给榫卯的 A/B 侧选择零件：载入该零件当前截面尺寸 */
export function setJointPart(plan: Drawing, jointId: string, side: 'A' | 'B', partId: string | null): Drawing {
  return mutate(plan, ({ parts, joints }) => {
    const j = joints.find((x) => x.id === jointId)
    if (!j) return
    if (side === 'A') j.partAId = partId
    else j.partBId = partId
    if (partId) {
      const p = parts.find((x) => x.id === partId)
      if (p) {
        const board = side === 'A' ? j.params.boardA : j.params.boardB
        board.thickness = p.thicknessMm
        board.width = p.widthMm
      }
    }
  })
}
