// 方案库：导出/导入往返一致（蓝图 §10）+ 筛选 + 性能（重算 <100ms）
import { describe, it, expect, beforeEach } from 'vitest'
import {
  makePlan,
  exportJSON,
  importJSON,
  filterPlans,
  loadPlans,
  upsertPlan,
  deletePlan,
  addJoint,
  removeJoint,
  addPart,
  updatePart,
  removePart,
  partIsUsed,
  updateJointParams,
  updateJointKind,
  updateJointParts,
  reindexJointIds,
  planKinds,
  planThicknesses,
  migratePlan,
  newPart,
  makeJoint,
  defaultParams,
} from '../../src/store/plans'
import { computeJoint } from '../../src/lib/calc'
import { buildViews } from '../../src/geometry/views'
import { round01, round05, fmtDrawing, fmt01 } from '../../src/lib/format'
import { loadFitTable, saveFitTable, DEFAULT_FIT_TABLE } from '../../src/lib/fit'
import type { Drawing, Joint, JointKind } from '../../src/types'

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
        id: `j${i}`,
        kind: kinds[i % kinds.length],
        params: {
          boardA: { thickness: 12 + (i % 20), width },
          boardB: { thickness: 12 + (i % 20), width },
          wood: i % 2 ? 'hardwood' : 'softwood',
          fit: 'standard',
          dovetail: { angleRatio: ([6, 7, 8] as const)[i % 3], teeth: 2 + (i % 11) },
          kerfMm: 1.1,
        },
        partAId: 'a',
        partBId: 'b',
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

describe('一个方案挂多个榫卯（面板拼板 + 框架直榫 + 抽屉燕尾）', () => {
  const base = (): Drawing =>
    makePlan('panel-glue', {
      boardA: { thickness: 12, width: 150 },
      boardB: { thickness: 12, width: 150 },
      wood: 'softwood',
      fit: 'standard',
      kerfMm: 1.1,
    })

  it('addJoint 后方案含两个榫卯，各带 id 与零件引用', () => {
    const p = addJoint(base(), 'mortise-tenon')
    expect(p.joints).toHaveLength(2)
    for (const j of p.joints) {
      expect(j.id).toBeTruthy()
      expect(p.parts.find((x) => x.id === j.partAId)).toBeTruthy()
      expect(p.parts.find((x) => x.id === j.partBId)).toBeTruthy()
      expect(j.partAId).not.toBe(j.partBId)
    }
    // 两榫卯复用同一对零件
    expect(p.joints[1].partAId).toBe(p.joints[0].partAId)
  })

  it('planKinds 认出全部榫卯类型；新增零件后第三种榫卯可选独立零件', () => {
    let p = addJoint(base(), 'mortise-tenon')
    expect(planKinds(p)).toEqual(['panel-glue', 'mortise-tenon'])
    p = addPart(p)
    expect(p.parts).toHaveLength(3)
    const drawerA = p.parts[2]
    p = updatePart(p, drawerA.id, { name: '抽屉侧板', thickness: 10, width: 120 })
    p = addJoint(p, 'dovetail')
    const dt = p.joints[2]
    p = updateJointParts(p, dt.id, 'A', drawerA.id)
    expect(planKinds(p)).toEqual(['panel-glue', 'mortise-tenon', 'dovetail'])
    // 燕尾的 A 是 10mm 抽屉板：boardA 与零件尺寸一致
    expect(p.joints[2].params.boardA.thickness).toBe(10)
    expect(p.joints[2].params.boardA.width).toBe(120)
    // A、B 自动保持不同
    expect(p.joints[2].partAId).not.toBe(p.joints[2].partBId)
  })

  it('filterPlans：组合方案在任一类型/板厚筛选下都能命中', () => {
    let p = addJoint(base(), 'mortise-tenon') // 直榫 A/B 12mm（复用零件）
    p = addPart(p)
    p = updatePart(p, p.parts[2].id, { thickness: 20, width: 180 })
    p = addPart(p)
    p = updatePart(p, p.parts[3].id, { thickness: 20, width: 180 })
    p = addJoint(p, 'dovetail')
    p = updateJointParts(p, p.joints[2].id, 'A', p.parts[2].id)
    p = updateJointParts(p, p.joints[2].id, 'B', p.parts[3].id)
    // 板厚集合 = 12 / 20
    expect(planThicknesses(p)).toEqual([12, 20])
    expect(filterPlans([p], 'panel-glue', 'all')).toHaveLength(1)
    expect(filterPlans([p], 'dovetail', 'all')).toHaveLength(1)
    expect(filterPlans([p], 'mortise-tenon', 12)).toHaveLength(1)
    expect(filterPlans([p], 'dovetail', 20)).toHaveLength(1)
    expect(filterPlans([p], 'dovetail', 12)).toHaveLength(0) // 燕尾板厚不是 12
    expect(filterPlans([p], 'lap', 'all')).toHaveLength(0)
  })

  it('零件改宽/厚 → 所有引用它的榫卯参数同步；改榫卯参数也同步回零件', () => {
    let p = addJoint(base(), 'mortise-tenon')
    const [partA] = p.parts
    p = updatePart(p, partA.id, { width: 300, thickness: 15 })
    for (const j of p.joints) {
      expect(j.params.boardA.width).toBe(300)
      expect(j.params.boardA.thickness).toBe(15)
    }
    // 反向：改榫卯 0 的 boardA → 零件跟着变，榫卯 1 也跟着变
    p = updateJointParams(p, p.joints[0].id, { ...p.joints[0].params, boardA: { thickness: 16, width: 220 } })
    expect(p.parts.find((x) => x.id === partA.id)?.thickness).toBe(16)
    expect(p.joints[1].params.boardA.width).toBe(220)
  })

  it('updateJointKind 保留板尺寸并切换类型特有参数', () => {
    let p = base()
    p = updateJointKind(p, p.joints[0].id, 'mortise-tenon')
    expect(p.joints[0].kind).toBe('mortise-tenon')
    expect(p.joints[0].params.boardA).toEqual({ thickness: 12, width: 150 })
    expect(p.joints[0].params.tenon).toBeTruthy()
    expect(p.joints[0].params.dovetail).toBeFalsy()
  })

  it('零件引用关系：被引用的零件不能删；解除后可删；方案至少保留一个榫卯', () => {
    let p = base()
    const [partA, partB] = p.parts
    expect(partIsUsed(p, partA.id)).toBe(true)
    expect(removePart(p, partA.id)).toBe(p) // 拒绝删除
    p = removeJoint(p, p.joints[0].id)
    expect(p.joints).toHaveLength(1) // 只有一个榫卯时拒绝删除
    p = addPart(p)
    const extra = p.parts[2]
    expect(partIsUsed(p, extra.id)).toBe(false)
    p = removePart(p, extra.id)
    expect(p.parts).toHaveLength(2)
    void partB
  })

  it('reindexJointIds：part.jointIds 始终与 joints 引用一致', () => {
    let p = addJoint(base(), 'dovetail')
    expect(p.parts[0].jointIds).toHaveLength(2)
    p = removeJoint(p, p.joints[1].id)
    expect(p.parts[0].jointIds).toEqual([p.joints[0].id])
  })

  it('零件可改名、填长宽厚与数量', () => {
    let p = base()
    p = updatePart(p, p.parts[0].id, { name: '桌面板', length: 800, width: 220, thickness: 18, qty: 2 })
    const a = p.parts[0]
    expect(a).toMatchObject({ name: '桌面板', length: 800, width: 220, thickness: 18, qty: 2 })
  })

  it('makeJoint：A/B 同尺寸也是两个独立零件', () => {
    const a = newPart('A', 18, 100, 400)
    const b = newPart('B', 18, 100, 400)
    const j = makeJoint('dovetail', a, b, defaultParams('dovetail'))
    expect(j.partAId).not.toBe(j.partBId)
    expect(j.params.boardA.thickness).toBe(18)
  })
})

describe('旧格式迁移：Joint 无 id/partAId，Part 用 w/h 且 jointIds 为空', () => {
  it('旧方案自动迁移：合成零件、反填引用与 jointIds', () => {
    const legacy = {
      id: 'old1',
      title: '老方案',
      parts: [
        { id: 'pa', name: '件 A（齿板/榫舌板）', w: 240, h: 18, qty: 1, jointIds: [] },
        { id: 'pb', name: '件 B（销板/榫孔板）', w: 240, h: 15, qty: 1, jointIds: [] },
      ],
      joints: [
        {
          kind: 'dovetail' as JointKind,
          params: {
            boardA: { thickness: 18, width: 240 },
            boardB: { thickness: 15, width: 240 },
            wood: 'hardwood' as const,
            fit: 'standard' as const,
            dovetail: { angleRatio: 8 as const, teeth: 6 },
            kerfMm: 1.1,
          },
          notes: [],
        },
      ],
      scale: '1:1' as const,
      updatedAt: 1,
    }
    const m = migratePlan(legacy as unknown as Drawing)
    expect(m.joints).toHaveLength(1)
    const j = m.joints[0]
    expect(j.id).toBeTruthy()
    expect(j.partAId).toBeTruthy()
    expect(j.partBId).toBeTruthy()
    expect(j.partAId).not.toBe(j.partBId)
    const a = m.parts.find((x) => x.id === j.partAId)!
    const b = m.parts.find((x) => x.id === j.partBId)!
    expect(a).toMatchObject({ width: 240, thickness: 18, length: 240 })
    expect(b).toMatchObject({ width: 240, thickness: 15, length: 240 })
    expect(a.jointIds).toEqual([j.id])
    expect(b.jointIds).toEqual([j.id])
    // 迁移后仍可正常出图
    const r = computeJoint(j)
    expect(buildViews(j, r)).toHaveLength(3)
    // 迁移幂等
    expect(JSON.stringify(migratePlan(m))).toBe(JSON.stringify(m))
  })

  it('旧方案 A/B 同厚同宽时仍迁移为两个零件', () => {
    const legacy = {
      id: 'old2',
      title: '同尺寸',
      parts: [],
      joints: [
        {
          kind: 'lap' as JointKind,
          params: {
            boardA: { thickness: 18, width: 200 },
            boardB: { thickness: 18, width: 200 },
            wood: 'hardwood' as const,
            fit: 'standard' as const,
            kerfMm: 1.1,
          },
          notes: [],
        },
      ],
      scale: '1:1' as const,
      updatedAt: 1,
    }
    const m = migratePlan(legacy as unknown as Drawing)
    expect(m.parts).toHaveLength(2)
    expect(m.joints[0].partAId).not.toBe(m.joints[0].partBId)
  })

  it('loadPlans 读取旧 localStorage 数据时透明迁移', () => {
    const legacy = [
      {
        id: 'old3',
        title: '库里老方案',
        parts: [{ id: 'x1', name: 'A', w: 200, h: 18, qty: 1, jointIds: [] }],
        joints: [
          {
            kind: 'dovetail' as JointKind,
            params: {
              boardA: { thickness: 18, width: 200 },
              boardB: { thickness: 18, width: 200 },
              wood: 'hardwood' as const,
              fit: 'standard' as const,
              dovetail: { angleRatio: 8 as const },
              kerfMm: 1.1,
            },
            notes: [],
          },
        ],
        scale: '1:1' as const,
        updatedAt: 1,
      },
    ]
    localStorage.setItem('wjb.plans.v1', JSON.stringify(legacy))
    const loaded = loadPlans()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].joints[0].partAId).toBeTruthy()
    expect(loaded[0].parts.every((p) => p.jointIds.length > 0)).toBe(true)
  })
})

describe('多榫卯方案导出/导入往返', () => {
  it('三榫卯方案 JSON 往返一致', () => {
    let p = makePlan('panel-glue', {
      boardA: { thickness: 12, width: 150 },
      boardB: { thickness: 12, width: 150 },
      wood: 'softwood',
      fit: 'standard',
      kerfMm: 1.1,
    })
    p = addJoint(p, 'mortise-tenon')
    p = addJoint(p, 'dovetail')
    const restored = importJSON(exportJSON(p))
    expect(restored.joints).toHaveLength(3)
    expect(JSON.stringify(restored)).toBe(JSON.stringify(reindexJointIds(p)))
  })
})
