// 方案库：localStorage 持久化 + 导出/导入 JSON
// 一个方案（Drawing）可挂多个榫卯（Joint），每个榫卯指定作用的两个零件（Part）。
// 零件尺寸（width/thickness）是唯一事实源：榫卯 params.boardA/boardB 与其同步。
import type { Board, Drawing, Joint, JointKind, Params, Part } from '../types'
import { KIND_LABEL } from '../types'

const KEY = 'wjb.plans.v1'

export function loadPlans(): Drawing[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Drawing[]).map(migratePlan) : []
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
  if (i >= 0) plans[i] = reindexJointIds(plan)
  else plans.unshift(reindexJointIds(plan))
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
  return [...new Set(plan.joints.map((j) => j.kind))]
}

/** 方案涉及的全部板厚（A/B 板都算，去重升序） */
export function planThicknesses(plan: Drawing): number[] {
  const ts = plan.joints.flatMap((j) => [j.params.boardA.thickness, j.params.boardB.thickness])
  return [...new Set(ts)].filter((t) => Number.isFinite(t) && t > 0).sort((a, b) => a - b)
}

/** 按「榫卯类型 + 木料厚度」筛选：存在同一个榫卯同时命中类型与板厚即入选 */
export function filterPlans(plans: Drawing[], kind: JointKind | 'all', thickness: number | 'all'): Drawing[] {
  return plans.filter((p) =>
    p.joints.some((j) => {
      if (kind !== 'all' && j.kind !== kind) return false
      if (thickness !== 'all') {
        const ts = [j.params.boardA.thickness, j.params.boardB.thickness]
        if (!ts.includes(thickness)) return false
      }
      return true
    }),
  )
}

export function exportJSON(plan: Drawing): string {
  return JSON.stringify(plan, null, 2)
}

/** 导入校验：结构合法返回 Drawing（自动迁移旧格式），否则抛错 */
export function importJSON(text: string): Drawing {
  const obj = JSON.parse(text) as Partial<Drawing>
  if (!obj || typeof obj !== 'object') throw new Error('无效的 JSON')
  if (!obj.id || !obj.title || !Array.isArray(obj.joints) || obj.joints.length === 0) {
    throw new Error('缺少必要字段（id/title/joints）')
  }
  for (const [i, j] of obj.joints.entries()) {
    if (!j.kind || !j.params) throw new Error(`joints[${i}] 缺少 kind/params`)
    const p = j.params as Partial<Params>
    if (!p.boardA?.thickness || !p.boardA?.width) throw new Error(`joints[${i}].params.boardA 尺寸缺失`)
  }
  return migratePlan(obj as Drawing)
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

let seq = 0
export function newId(prefix = 'p'): string {
  seq++
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}`
}

export function defaultParams(kind: JointKind): Params {
  return {
    boardA: { thickness: 18, width: 200 },
    boardB: { thickness: 18, width: 200 },
    wood: 'hardwood',
    fit: 'standard',
    ...(kind === 'dovetail' || kind === 'half-blind-dovetail' ? { dovetail: { angleRatio: 8 as const } } : {}),
    ...(kind === 'mortise-tenon'
      ? { tenon: { thicknessRatio: 1 / 3, lengthRatio: 1, offsetFromFace: 0 } }
      : {}),
    kerfMm: 1.1,
  }
}

/** 由两个零件的尺寸生成榫卯参数（保留传入的其余参数） */
function paramsFromParts(partA: Part, partB: Part, base?: Params): Params {
  const boardA: Board = { thickness: partA.thickness, width: partA.width }
  const boardB: Board = { thickness: partB.thickness, width: partB.width }
  return base ? { ...base, boardA, boardB } : { ...defaultParams('mortise-tenon'), boardA, boardB }
}

/** 新建榫卯（自动带 id，并从零件尺寸同步 boardA/boardB） */
export function makeJoint(kind: JointKind, partA: Part, partB: Part, base?: Params): Joint {
  return {
    id: newId('j'),
    kind,
    params: paramsFromParts(partA, partB, base),
    partAId: partA.id,
    partBId: partB.id,
    notes: [],
  }
}

/** 由 joints 的 partAId/partBId 反算每个零件的 jointIds（唯一事实关系） */
export function reindexJointIds(plan: Drawing): Drawing {
  const jointIds = new Map<string, string[]>()
  for (const part of plan.parts) jointIds.set(part.id, [])
  for (const j of plan.joints) {
    if (jointIds.has(j.partAId)) jointIds.get(j.partAId)!.push(j.id)
    if (j.partBId !== j.partAId && jointIds.has(j.partBId)) jointIds.get(j.partBId)!.push(j.id)
  }
  return {
    ...plan,
    parts: plan.parts.map((part) => ({ ...part, jointIds: jointIds.get(part.id) ?? [] })),
  }
}

// —— 方案编辑助手：所有改动均经 reindexJointIds，并保证零件尺寸 ↔ 榫卯参数同步 ——

function boardFor(part: Part): Board {
  return { thickness: part.thickness, width: part.width }
}

/** 改榫卯参数：A/B 板尺寸同步回所作用的两个零件；共享同一零件的其他榫卯随之重算 */
export function updateJointParams(plan: Drawing, jointId: string, params: Params): Drawing {
  const target = plan.joints.find((j) => j.id === jointId)
  const parts = plan.parts.map((part) => {
    if (!target) return part
    if (part.id === target.partAId) return { ...part, thickness: params.boardA.thickness, width: params.boardA.width }
    if (part.id === target.partBId) return { ...part, thickness: params.boardB.thickness, width: params.boardB.width }
    return part
  })
  // 其余榫卯按（可能已变的）零件尺寸重派生 boardA/boardB
  const partById = new Map(parts.map((p) => [p.id, p]))
  return reindexJointIds({
    ...plan,
    updatedAt: Date.now(),
    parts,
    joints: plan.joints.map((j) => {
      if (j.id === jointId) return { ...j, params }
      const a = partById.get(j.partAId)
      const b = partById.get(j.partBId)
      return {
        ...j,
        params: {
          ...j.params,
          boardA: a ? boardFor(a) : j.params.boardA,
          boardB: b ? boardFor(b) : j.params.boardB,
        },
      }
    }),
  })
}

export function updateJointKind(plan: Drawing, jointId: string, kind: JointKind): Drawing {
  return reindexJointIds({
    ...plan,
    updatedAt: Date.now(),
    joints: plan.joints.map((j) => {
      if (j.id !== jointId) return j
      // 保留板尺寸与木材/配合/锯路，只补齐新类型特有的默认参数
      const params: Params = {
        ...j.params,
        ...(kind === 'dovetail' || kind === 'half-blind-dovetail'
          ? { dovetail: j.params.dovetail ?? { angleRatio: 8 } }
          : {}),
        ...(kind === 'mortise-tenon'
          ? { tenon: j.params.tenon ?? { thicknessRatio: 1 / 3, lengthRatio: 1, offsetFromFace: 0 } }
          : {}),
      }
      return { ...j, kind, params }
    }),
  })
}

export function updateJointParts(plan: Drawing, jointId: string, side: 'A' | 'B', partId: string): Drawing {
  const plan2: Drawing = {
    ...plan,
    updatedAt: Date.now(),
    joints: plan.joints.map((j) => {
      if (j.id !== jointId) return j
      let { partAId, partBId } = j
      // 同一榫卯的两个零件不允许相同：选重了自动交换到另一侧
      if (side === 'A') {
        if (partId === j.partBId) partBId = j.partAId
        partAId = partId
      } else {
        if (partId === j.partAId) partAId = j.partBId
        partBId = partId
      }
      return { ...j, partAId, partBId }
    }),
  }
  // 零件重指后，以零件尺寸为准刷新 boardA/boardB
  return syncBoards(plan2, jointId)
}

function syncBoards(plan: Drawing, jointId: string): Drawing {
  const j = plan.joints.find((x) => x.id === jointId)
  if (!j) return plan
  const a = plan.parts.find((p) => p.id === j.partAId)
  const b = plan.parts.find((p) => p.id === j.partBId)
  if (!a || !b) return reindexJointIds(plan)
  return reindexJointIds({
    ...plan,
    joints: plan.joints.map((x) =>
      x.id === jointId ? { ...x, params: { ...x.params, boardA: boardFor(a), boardB: boardFor(b) } } : x,
    ),
  })
}

export function addJoint(plan: Drawing, kind: JointKind): Drawing {
  let parts = plan.parts
  // 不足两个零件时自动补齐
  if (parts.length === 0) {
    parts = [newPart('零件 1', 18, 200, 400), newPart('零件 2', 18, 200, 400)]
  } else if (parts.length === 1) {
    parts = [...parts, newPart(`零件 ${parts.length + 1}`, 18, 200, 400)]
  }
  const joint = makeJoint(kind, parts[0], parts[1], defaultParams(kind))
  return reindexJointIds({ ...plan, parts, joints: [...plan.joints, joint], updatedAt: Date.now() })
}

export function removeJoint(plan: Drawing, jointId: string): Drawing {
  if (plan.joints.length <= 1) return plan // 方案至少保留一个榫卯
  return reindexJointIds({
    ...plan,
    joints: plan.joints.filter((j) => j.id !== jointId),
    updatedAt: Date.now(),
  })
}

export function newPart(name: string, thickness: number, width: number, length: number, qty = 1): Part {
  return { id: newId(), name, length, width, thickness, qty, jointIds: [] }
}

export function addPart(plan: Drawing): Drawing {
  const part = newPart(`零件 ${plan.parts.length + 1}`, 18, 100, 400)
  return reindexJointIds({ ...plan, parts: [...plan.parts, part], updatedAt: Date.now() })
}

/** 改零件：宽/厚变化同步到所有引用它的榫卯参数 */
export function updatePart(plan: Drawing, partId: string, patch: Partial<Omit<Part, 'id' | 'jointIds'>>): Drawing {
  const next: Drawing = {
    ...plan,
    updatedAt: Date.now(),
    parts: plan.parts.map((p) => (p.id === partId ? { ...p, ...patch } : p)),
  }
  const part = next.parts.find((p) => p.id === partId)
  if (!part) return reindexJointIds(next)
  return reindexJointIds({
    ...next,
    joints: next.joints.map((j) => {
      if (j.partAId === partId) return { ...j, params: { ...j.params, boardA: boardFor(part) } }
      if (j.partBId === partId) return { ...j, params: { ...j.params, boardB: boardFor(part) } }
      return j
    }),
  })
}

export function partIsUsed(plan: Drawing, partId: string): boolean {
  return plan.joints.some((j) => j.partAId === partId || j.partBId === partId)
}

export function removePart(plan: Drawing, partId: string): Drawing {
  if (partIsUsed(plan, partId)) return plan // 被榫卯引用的零件不能删
  return reindexJointIds({
    ...plan,
    parts: plan.parts.filter((p) => p.id !== partId),
    updatedAt: Date.now(),
  })
}

export function makePlan(kind: JointKind, params: Params, notes: string[] = []): Drawing {
  const partA = newPart('件 A（齿板/榫舌板）', params.boardA.thickness, params.boardA.width, 400)
  const partB = newPart('件 B（销板/榫孔板）', params.boardB.thickness, params.boardB.width, 400)
  const joint = makeJoint(kind, partA, partB, params)
  joint.notes = notes
  return reindexJointIds({
    id: newId(),
    title: `${KIND_LABEL[kind]} · ${params.boardA.thickness}/${params.boardB.thickness}mm`,
    parts: [partA, partB],
    joints: [joint],
    scale: '1:1',
    updatedAt: Date.now(),
  })
}

// —— 旧格式迁移（v1 早期：Joint 无 id/partAId/partBId，Part 用 w/h 且 jointIds 为空） ——

interface LegacyPart {
  id?: string
  name?: string
  w?: number
  h?: number
  length?: number
  width?: number
  thickness?: number
  qty?: number
  jointIds?: string[]
}

function isLegacyPlan(raw: Drawing): boolean {
  if (raw.joints.some((j) => !j.id || !j.partAId || !j.partBId)) return true
  const anyPart = raw.parts?.[0] as LegacyPart | undefined
  return !!anyPart && (anyPart.thickness === undefined || anyPart.length === undefined)
}

function normalizePart(p: LegacyPart, index: number): Part {
  const width = p.width ?? p.w ?? 0
  const thickness = p.thickness ?? p.h ?? 0
  return {
    id: p.id ?? newId(),
    name: p.name ?? `零件 ${index + 1}`,
    length: p.length ?? width,
    width,
    thickness,
    qty: p.qty ?? 1,
    jointIds: [],
  }
}

/** 旧方案：每件榫卯的 A/B 各合成一个零件（跨榫卯按 厚×宽 去重复用） */
function migrateLegacy(raw: Drawing): Drawing {
  const parts: Part[] = []
  const findOrCreate = (b: Board | undefined, name: string, excludeId?: string): string => {
    if (!b) return ''
    const hit = parts.find((p) => p.thickness === b.thickness && p.width === b.width && p.id !== excludeId)
    if (hit) return hit.id
    const part = newPart(name, b.thickness, b.width, b.width)
    parts.push(part)
    return part.id
  }
  const joints: Joint[] = raw.joints.map((j, ji) => {
    const suffix = raw.joints.length > 1 ? `（榫卯 ${ji + 1}）` : ''
    const partAId = findOrCreate(j.params.boardA, `件 A${suffix}（齿板/榫舌板）`)
    // A、B 即使尺寸相同也必须是两个不同零件
    const partBId = findOrCreate(j.params.boardB, `件 B${suffix}（销板/榫孔板）`, partAId)
    return {
      id: newId('j'),
      kind: j.kind,
      params: j.params,
      partAId,
      partBId,
      notes: j.notes ?? [],
    }
  })
  return reindexJointIds({
    id: raw.id,
    title: raw.title,
    scale: raw.scale ?? '1:1',
    updatedAt: raw.updatedAt ?? Date.now(),
    parts,
    joints,
  })
}

export function migratePlan(raw: Drawing): Drawing {
  if (!raw || !Array.isArray(raw.joints) || raw.joints.length === 0) return raw
  if (!isLegacyPlan(raw)) return reindexJointIds(raw)
  // 新结构零件缺失/不完整时，也走合成逻辑
  const hasUsableParts =
    Array.isArray(raw.parts) &&
    raw.parts.length > 0 &&
    (raw.parts as LegacyPart[]).every((p) => p.thickness !== undefined && p.length !== undefined)
  if (!hasUsableParts) return migrateLegacy(raw)
  const normalized: Drawing = {
    ...raw,
    parts: raw.parts.map((p, i) => normalizePart(p as LegacyPart, i)),
    joints: raw.joints.map((j) => ({
      id: j.id ?? newId('j'),
      kind: j.kind,
      params: j.params,
      partAId: j.partAId ?? '',
      partBId: j.partBId ?? '',
      notes: j.notes ?? [],
    })),
  }
  return reindexJointIds(normalized)
}
