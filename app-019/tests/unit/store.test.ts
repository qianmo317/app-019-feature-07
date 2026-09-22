// 方案库：导出/导入往返一致（蓝图 §10）+ 筛选 + 性能（重算 <100ms）
import { describe, it, expect, beforeEach } from 'vitest'
import { makePlan, exportJSON, importJSON, filterPlans, loadPlans, upsertPlan, deletePlan } from '../../src/store/plans'
import { computeJoint } from '../../src/lib/calc'
import { buildViews } from '../../src/geometry/views'
import { round01, round05, fmtDrawing, fmt01 } from '../../src/lib/format'
import { loadFitTable, saveFitTable, DEFAULT_FIT_TABLE } from '../../src/lib/fit'
import type { Joint, JointKind } from '../../src/types'

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
        kind: kinds[i % kinds.length],
        params: {
          boardA: { thickness: 12 + (i % 20), width },
          boardB: { thickness: 12 + (i % 20), width },
          wood: i % 2 ? 'hardwood' : 'softwood',
          fit: 'standard',
          dovetail: { angleRatio: ([6, 7, 8] as const)[i % 3], teeth: 2 + (i % 11) },
          kerfMm: 1.1,
        },
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
