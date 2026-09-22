// 方案库：localStorage 持久化 + 导出/导入 JSON
import type { Drawing, JointKind, Joint, Params } from '../types'
import { KIND_LABEL } from '../types'

const KEY = 'wjb.plans.v1'

export function loadPlans(): Drawing[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Drawing[]) : []
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

/** 按「榫卯类型 + 木料厚度」筛选 */
export function filterPlans(plans: Drawing[], kind: JointKind | 'all', thickness: number | 'all'): Drawing[] {
  return plans.filter((p) => {
    const j = p.joints[0]
    if (!j) return false
    if (kind !== 'all' && j.kind !== kind) return false
    if (thickness !== 'all' && p.joints[0].params.boardA.thickness !== thickness) return false
    return true
  })
}

export function exportJSON(plan: Drawing): string {
  return JSON.stringify(plan, null, 2)
}

/** 导入校验：结构合法返回 Drawing，否则抛错 */
export function importJSON(text: string): Drawing {
  const obj = JSON.parse(text) as Partial<Drawing>
  if (!obj || typeof obj !== 'object') throw new Error('无效的 JSON')
  if (!obj.id || !obj.title || !Array.isArray(obj.joints) || obj.joints.length === 0) {
    throw new Error('缺少必要字段（id/title/joints）')
  }
  const j = obj.joints[0] as Joint
  if (!j.kind || !j.params) throw new Error('joints[0] 缺少 kind/params')
  const p = j.params as Params
  if (!p.boardA?.thickness || !p.boardA?.width) throw new Error('params.boardA 尺寸缺失')
  return obj as Drawing
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
export function newId(): string {
  seq++
  return `p${Date.now().toString(36)}${seq.toString(36)}`
}

export function makePlan(kind: JointKind, params: Params, notes: string[] = []): Drawing {
  const tA = params.boardA.thickness
  const tB = params.boardB.thickness
  return {
    id: newId(),
    title: `${KIND_LABEL[kind]} · ${tA}/${tB}mm`,
    parts: [
      { id: newId(), name: '件 A（齿板/榫舌板）', w: params.boardA.width, h: tA, qty: 1, jointIds: [] },
      { id: newId(), name: '件 B（销板/榫孔板）', w: params.boardB.width, h: tB, qty: 1, jointIds: [] },
    ],
    joints: [{ kind, params, notes }],
    scale: '1:1',
    updatedAt: Date.now(),
  }
}
