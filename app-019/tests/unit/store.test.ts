// 方案库：导出/导入往返一致（蓝图 §10）+ 筛选 + 性能（重算 <100ms）
import { describe, it, expect, beforeEach } from 'vitest'
import {
  makePlan, exportJSON, importJSON, filterPlans, loadPlans, upsertPlan, deletePlan,
  normalizePlan, addJoint, removeJoint, updateJointParams, setJointPart, setJointKind,
  addPart, updatePart, removePart, partInUse, planKinds, planThicknesses, rebuildPartJointIds,
} from '../../src/store/plans'
import { computeJoint } from '../../src/lib/calc'
import { buildViews } from '../../src/geometry/views'
import { round01, round05, fmtDrawing, fmt01 } from '../../src/lib/format'
import { loadFitTable, saveFitTable, DEFAULT_FIT_TABLE } from '../../src/lib/fit'
import type { Joint, JointKind, Drawing, Part } from '../../src/types'

beforeEach(() => {
  localStorage.clear()
})

describe('格式化：内部 0.1mm，图纸标注 0.5mm 步进（蓝图 §8）', () => {
  it('round01 / fmt01', () => {
    expect(round01(6.66666)).toBeCloseTo(6.7, 6)
    expect(fmt01(10.25)).toBe('10.3')
  })
  it('round05 / fmtDrawing 符合木工习惯', () => {
    expect(round05(57.2)).toBe(57)
    expect(round05(57.3)).toBe(57.5)
    expect(fmtDrawing(57.0)).toBe('57')
    expect(fmtDrawing(57.5)).toBe('57.5')
  })
})

describe('方案库导出/导入', () => {
  it('导出 JSON 再导入，参数与图纸完全一致', () => {
    const plan = makePlan('dovetail', {
      boardA: { thickness: 18, width: 240 },
      boardB: { thickness: 15, width: 240 },
      wood: 'softwood',
      fit: 'tight',
      dovetail: { angleRatio: 6, teeth: 8 },
      kerfMm: 1.6,
    })
    const restored = importJSON(exportJSON(plan))
    expect(JSON.stringify(restored)).toBe(JSON.stringify(plan))
    expect(restored.joints[0].params.boardA.width).toBe(240)
    expect(restored.joints[0].params.dovetail?.teeth).toBe(8)
  })

  it('导入校验拒绝缺字段/坏 JSON', () => {
    expect(() => importJSON('{}')).toThrow()
    expect(() => importJSON('not json')).toThrow()
    expect(() =>
      importJSON(JSON.stringify({ id: 'x', title: 't', joints: [{ kind: 'dovetail' }] })),
    ).toThrow(/params/)
  })

  it('按「榫卯类型 + 木料厚度」筛选', () => {
    const p1 = makePlan('dovetail', {
      boardA: { thickness: 18, width: 200 },
      boardB: { thickness: 18, width: 200 },
      wood: 'hardwood',
      fit: 'standard',
      kerfMm: 1.1,
    })
    const p2 = makePlan('mortise-tenon', {
      boardA: { thickness: 20, width: 200 },
      boardB: { thickness: 20, width: 200 },
      wood: 'hardwood',
      fit: 'standard',
      kerfMm: 1.1,
    })
    upsertPlan(p1)
    upsertPlan(p2)
    expect(loadPlans()).toHaveLength(2)
    expect(filterPlans(loadPlans(), 'dovetail', 'all')).toHaveLength(1)
    expect(filterPlans(loadPlans(), 'all', 20)).toHaveLength(1)
    expect(filterPlans(loadPlans(), 'dovetail', 20)).toHaveLength(0)
    deletePlan(p1.id)
    expect(loadPlans()).toHaveLength(1)
  })
})

describe('配合余量表（可编辑经验值，蓝图 §8）', () => {
  it('编辑后持久化并可恢复默认', () => {
    expect(loadFitTable()).toEqual(DEFAULT_FIT_TABLE)
    const t = JSON.parse(JSON.stringify(DEFAULT_FIT_TABLE))
    t.hardwood.tight = 0.25
    saveFitTable(t)
    expect(loadFitTable().hardwood.tight).toBe(0.25)
    saveFitTable(DEFAULT_FIT_TABLE)
    expect(loadFitTable()).toEqual(DEFAULT_FIT_TABLE)
  })
  it('损坏数据回退默认表', () => {
    localStorage.setItem('wjb.fittable.v1', '{bad json')
    expect(loadFitTable()).toEqual(DEFAULT_FIT_TABLE)
  })
})

describe('性能验收：参数改动到图纸重算 < 100ms（蓝图 §10）', () => {
  it('200 组随机配置单次计算+出图均 < 100ms', () => {
    const kinds: JointKind[] = ['dovetail', 'half-blind-dovetail', 'mortise-tenon', 'dowel', 'lap', 'panel-glue']
    let maxMs = 0
    for (let i = 0; i < 200; i++) {
      const width = 50 + ((i * 37) % 551)
      const joint: Joint = {
        id: 'j-perf',
        kind: kinds[i % kinds.length],
        params: {
          boardA: { thickness: 12 + (i % 20), width },
          boardB: { thickness: 12 + (i % 20), width },
          wood: i % 2 ? 'hardwood' : 'softwood',
          fit: 'standard',
          dovetail: { angleRatio: ([6, 7, 8] as const)[i % 3], teeth: 2 + (i % 11) },
          kerfMm: 1.1,
        },
        partAId: null,
        partBId: null,
        notes: [],
      }
      const t0 = performance.now()
      const r = computeJoint(joint)
      buildViews(joint, r)
      const ms = performance.now() - t0
      maxMs = Math.max(maxMs, ms)
      expect(ms).toBeLessThan(100)
    }
    // 报告最大耗时便于观察
    console.log(`[perf] max recalc = ${maxMs.toFixed(2)}ms`)
  })
})

describe('多榫卯：一个方案挂多个榫卯并各自挂零件', () => {
  const baseParams = () => ({
    boardA: { thickness: 18, width: 200 },
    boardB: { thickness: 18, width: 200 },
    wood: 'hardwood' as const,
    fit: 'standard' as const,
    kerfMm: 1.1,
  })

  it('makePlan 建立 2 个零件 + 1 个榫卯，jointIds 反推索引正确', () => {
    const plan = makePlan('dovetail', baseParams())
    expect(plan.parts).toHaveLength(2)
    expect(plan.joints).toHaveLength(1)
    const j = plan.joints[0]
    expect(j.partAId).toBe(plan.parts[0].id)
    expect(j.partBId).toBe(plan.parts[1].id)
    expect(plan.parts[0].jointIds).toEqual([j.id])
    expect(plan.parts[1].jointIds).toEqual([j.id])
  })

  it('追加榫卯：类型与零件关联正确，planKinds/planThicknesses 认出全部榫卯', () => {
    let plan = makePlan('dovetail', {
      ...baseParams(),
      boardA: { thickness: 18, width: 200 },
      boardB: { thickness: 18, width: 200 },
    })
    const r1 = addJoint(plan, 'mortise-tenon')
    plan = r1.plan
    expect(plan.joints).toHaveLength(2)
    expect(plan.joints[1].partAId).toBeNull()
    expect(planKinds(plan)).toEqual(['dovetail', 'mortise-tenon'])
    expect(planThicknesses(plan)).toEqual([18])

    // 新榫卯挂上现有两个零件 → jointIds 反推更新
    plan = setJointPart(plan, r1.jointId, 'A', plan.parts[0].id)
    plan = setJointPart(plan, r1.jointId, 'B', plan.parts[1].id)
    expect(plan.joints[1].partAId).toBe(plan.parts[0].id)
    expect(plan.parts[0].jointIds).toEqual([plan.joints[0].id, r1.jointId])
    expect(plan.parts[1].jointIds).toEqual([plan.joints[0].id, r1.jointId])
  })

  it('面板拼板 + 框架直榫 + 抽屉燕尾组合可建并被类型筛选命中', () => {
    let plan = makePlan('panel-glue', baseParams())
    plan = addJoint(plan, 'mortise-tenon').plan
    plan = addJoint(plan, 'dovetail').plan
    expect(planKinds(plan).sort()).toEqual(['dovetail', 'mortise-tenon', 'panel-glue'])
    // 方案列表按任一榫卯类型命中
    expect(filterPlans([plan], 'dovetail', 'all')).toHaveLength(1)
    expect(filterPlans([plan], 'panel-glue', 'all')).toHaveLength(1)
    expect(filterPlans([plan], 'lap', 'all')).toHaveLength(0)
  })

  it('截面尺寸双向同步：改零件厚度 → 所挂榫卯 params 同步；改 params → 零件与共用零件同步', () => {
    let plan = makePlan('mortise-tenon', {
      ...baseParams(),
      boardA: { thickness: 20, width: 120 },
      boardB: { thickness: 20, width: 120 },
    })
    const partA = plan.parts[0]
    const partB = plan.parts[1]
    // 第二个榫卯共用同一个 A 零件
    const added = addJoint(plan, 'dowel')
    plan = setJointPart(added.plan, added.jointId, 'A', partA.id)
    plan = setJointPart(plan, added.jointId, 'B', partB.id)

    // 改零件厚度 20 → 25，宽度 120 → 160
    plan = updatePart(plan, partA.id, { thicknessMm: 25, widthMm: 160 })
    for (const j of plan.joints) {
      expect(j.params.boardA.thickness).toBe(25)
      expect(j.params.boardA.width).toBe(160)
    }

    // 改榫卯 params（A 侧）→ 零件及共用该零件的另一榫卯同步
    const j0 = plan.joints[0]
    plan = updateJointParams(plan, j0.id, {
      ...j0.params,
      boardA: { thickness: 22, width: 150 },
    })
    const updatedPart = plan.parts.find((p) => p.id === partA.id)!
    expect(updatedPart.thicknessMm).toBe(22)
    expect(updatedPart.widthMm).toBe(150)
    expect(plan.joints[1].params.boardA.thickness).toBe(22)
    expect(plan.joints[1].params.boardA.width).toBe(150)
  })

  it('被榫卯引用的零件不可删除；解除引用后可删', () => {
    let plan = makePlan('dovetail', baseParams())
    const partA = plan.parts[0]
    expect(partInUse(plan, partA.id)).toBe(true)
    const before = plan.parts.length
    expect(removePart(plan, partA.id).parts).toHaveLength(before) // 拒绝删除
    // 解除两个榫卯引用
    plan = setJointPart(plan, plan.joints[0].id, 'A', null)
    plan = setJointPart(plan, plan.joints[0].id, 'B', null)
    expect(partInUse(plan, partA.id)).toBe(false)
    expect(removePart(plan, partA.id).parts).toHaveLength(before - 1)
  })

  it('零件可增删改名、改长宽厚与数量', () => {
    let plan = makePlan('dovetail', baseParams())
    plan = addPart(plan)
    expect(plan.parts).toHaveLength(3)
    const np = plan.parts[2]
    plan = updatePart(plan, np.id, { name: '抽屉侧板', lengthMm: 480, widthMm: 150, thicknessMm: 12, qty: 2 })
    const got = plan.parts.find((p) => p.id === np.id)!
    expect(got).toMatchObject({ name: '抽屉侧板', lengthMm: 480, widthMm: 150, thicknessMm: 12, qty: 2 })
  })

  it('删除榫卯后 jointIds 索引重建', () => {
    let plan = makePlan('dovetail', baseParams())
    const firstId = plan.joints[0].id
    const added = addJoint(plan, 'lap')
    plan = setJointPart(added.plan, added.jointId, 'A', plan.parts[0].id)
    plan = setJointPart(plan, added.jointId, 'B', plan.parts[1].id)
    expect(plan.parts[0].jointIds).toContain(added.jointId)
    plan = removeJoint(plan, firstId)
    expect(plan.joints.map((j) => j.id)).toEqual([added.jointId])
    expect(plan.parts[0].jointIds).toEqual([added.jointId])
  })

  it('切换榫卯类型保留截面尺寸', () => {
    let plan = makePlan('dovetail', {
      ...baseParams(),
      boardA: { thickness: 19, width: 230 },
      boardB: { thickness: 17, width: 210 },
    })
    plan = setJointKind(plan, plan.joints[0].id, 'mortise-tenon')
    expect(plan.joints[0].kind).toBe('mortise-tenon')
    expect(plan.joints[0].params.boardA).toEqual({ thickness: 19, width: 230 })
    expect(plan.joints[0].params.boardB).toEqual({ thickness: 17, width: 210 })
    expect(plan.joints[0].params.tenon).toBeDefined()
    expect(plan.joints[0].params.dovetail).toBeUndefined()
  })
})

describe('多榫卯：旧数据迁移与导入规范化', () => {
  const oldParams = () => ({
    boardA: { thickness: 18, width: 240 },
    boardB: { thickness: 18, width: 240 },
    wood: 'hardwood' as const,
    fit: 'standard' as const,
    kerfMm: 1.1,
  })

  it('旧版方案（Joint 无 id/partAId、Part 为 w/h、jointIds 空）迁移为多榫卯结构', () => {
    const legacy = {
      id: 'old1',
      title: '旧方案',
      parts: [
        { id: 'pa', name: '件 A', w: 240, h: 18, qty: 1, jointIds: [] },
        { id: 'pb', name: '件 B', w: 220, h: 15, qty: 2, jointIds: [] },
      ],
      joints: [{ kind: 'dovetail', params: oldParams(), notes: [] }],
      scale: '1:1',
      updatedAt: 123,
    }
    const plan = normalizePlan(legacy)
    expect(plan.parts[0]).toMatchObject({ id: 'pa', lengthMm: 240, widthMm: 240, thicknessMm: 18, qty: 1 })
    expect(plan.parts[1]).toMatchObject({ lengthMm: 220, thicknessMm: 15, qty: 2 })
    expect(plan.joints[0].partAId).toBe('pa')
    expect(plan.joints[0].partBId).toBe('pb')
    expect(plan.joints[0].id).toEqual(expect.any(String))
    expect(plan.parts[0].jointIds).toEqual([plan.joints[0].id])
  })

  it('旧版方案存入 localStorage 后 loadPlans 可直接读出并被筛选认出', () => {
    localStorage.setItem(
      'wjb.plans.v1',
      JSON.stringify([
        {
          id: 'old2',
          title: '旧箱',
          parts: [
            { id: 'a', name: 'A', w: 200, h: 20, qty: 1, jointIds: [] },
            { id: 'b', name: 'B', w: 200, h: 20, qty: 1, jointIds: [] },
          ],
          joints: [{ kind: 'mortise-tenon', params: { ...oldParams(), boardA: { thickness: 20, width: 200 }, boardB: { thickness: 20, width: 200 } }, notes: [] }],
          scale: '1:1',
          updatedAt: 1,
        },
      ]),
    )
    const plans = loadPlans()
    expect(plans).toHaveLength(1)
    expect(filterPlans(plans, 'mortise-tenon', 20)).toHaveLength(1)
    expect(plans[0].parts[0].jointIds).toHaveLength(1)
  })

  it('多榫卯方案导出→导入往返 JSON.stringify 全等，且规范化幂等', () => {
    let plan = makePlan('dovetail', {
      ...oldParams(),
      boardA: { thickness: 18, width: 240 },
      boardB: { thickness: 15, width: 240 },
      wood: 'softwood',
      fit: 'tight',
      dovetail: { angleRatio: 6, teeth: 8 },
      kerfMm: 1.6,
    })
    plan = addJoint(plan, 'mortise-tenon').plan
    const restored = importJSON(exportJSON(plan))
    expect(JSON.stringify(restored)).toBe(JSON.stringify(plan))
    expect(normalizePlan(normalizePlan(plan))).toEqual(plan)
  })

  it('导入拒绝悬空 partAId / 缺 boardB / 坏齿数比', () => {
    const good = makePlan('dovetail', oldParams())
    const dangling = JSON.parse(JSON.stringify(good)) as Drawing
    dangling.joints[0].partAId = 'not-exist'
    expect(() => importJSON(JSON.stringify(dangling))).not.toThrow() // 悬空引用被置空而非崩溃
    expect(importJSON(JSON.stringify(dangling)).joints[0].partAId).toBeNull()

    const noB = JSON.parse(JSON.stringify(good)) as Partial<Drawing>
    delete (noB.joints![0].params as { boardB?: unknown }).boardB
    expect(() => importJSON(JSON.stringify(noB))).toThrow(/boardB/)

    const badRatio = JSON.parse(JSON.stringify(good)) as Drawing
    badRatio.joints[0].params.dovetail = { angleRatio: 5 as unknown as 6, teeth: 3 }
    expect(() => importJSON(JSON.stringify(badRatio))).toThrow(/angleRatio/)
  })
})

describe('rebuildPartJointIds 工具函数', () => {
  it('按 partAId/partBId 反推并去重', () => {
    const p1: Part = { id: 'p1', name: '1', lengthMm: 100, widthMm: 50, thicknessMm: 10, qty: 1, jointIds: [] }
    const p2: Part = { id: 'p2', name: '2', lengthMm: 100, widthMm: 50, thicknessMm: 10, qty: 1, jointIds: [] }
    const joints: Joint[] = [
      { id: 'j1', kind: 'dovetail', params: makePlanParams(), partAId: 'p1', partBId: 'p2', notes: [] },
      { id: 'j2', kind: 'lap', params: makePlanParams(), partAId: 'p1', partBId: 'p1', notes: [] },
    ]
    const parts = rebuildPartJointIds([p1, p2], joints)
    expect(parts.find((p) => p.id === 'p1')!.jointIds).toEqual(['j1', 'j2'])
    expect(parts.find((p) => p.id === 'p2')!.jointIds).toEqual(['j1'])
  })
})

function makePlanParams() {
  return {
    boardA: { thickness: 18, width: 200 },
    boardB: { thickness: 18, width: 200 },
    wood: 'hardwood' as const,
    fit: 'standard' as const,
    kerfMm: 1.1,
  }
}
