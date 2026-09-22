// 直榫计算：10 组手工核算用例（蓝图 §10 验收）
import { describe, it, expect } from 'vitest'
import { computeTenon, type TenonInput } from '../../src/lib/tenon'

const base: TenonInput = {
  boardAThickness: 20,
  boardAWidth: 120,
  boardBThickness: 18,
  thicknessRatio: 1 / 3,
  lengthRatio: 1,
  offsetFromFace: null,
  kerf: 1.1,
  wood: 'hardwood',
  fit: 'standard',
  fitDeltaMm: 0,
}

describe('直榫手工核算（蓝图 §10：20mm 板默认比例 → 榫厚 6.7mm）', () => {
  const cases: { name: string; input: typeof base; expect: Partial<Record<string, number>> }[] = [
    {
      name: '① 20mm 硬木标准 → 榫厚 6.7',
      input: { ...base, boardAThickness: 20 },
      expect: { tenonThickness: 6.7, nominalThickness: 6.7 },
    },
    {
      name: '② 20mm 硬木紧配 (+0.2 过盈) → 6.9',
      input: { ...base, boardAThickness: 20, fit: 'tight', fitDeltaMm: 0.2 },
      expect: { tenonThickness: 6.9 },
    },
    {
      name: '③ 20mm 硬木松配 (−0.3 留胶) → 6.4',
      input: { ...base, boardAThickness: 20, fit: 'loose', fitDeltaMm: -0.3 },
      expect: { tenonThickness: 6.4 },
    },
    {
      name: '④ 18mm 软木标准 → 6.0',
      input: { ...base, boardAThickness: 18, wood: 'softwood' },
      expect: { tenonThickness: 6.0 },
    },
    {
      name: '⑤ 18mm 硬木紧配 → 6.2',
      input: { ...base, boardAThickness: 18, fit: 'tight', fitDeltaMm: 0.2 },
      expect: { tenonThickness: 6.2 },
    },
    {
      name: '⑥ 30mm 硬木标准 → 10.0',
      input: { ...base, boardAThickness: 30 },
      expect: { tenonThickness: 10.0 },
    },
    {
      name: '⑦ 25mm 比例 0.32 → 8.0',
      input: { ...base, boardAThickness: 25, thicknessRatio: 0.32 },
      expect: { tenonThickness: 8.0 },
    },
    {
      name: '⑧ 榫宽经验值 min(3×榫厚, 料宽−12)；肩宽 = (料宽−榫宽)/2',
      input: { ...base, boardAThickness: 20, boardAWidth: 120 },
      expect: { tenonWidth: 20.1, shoulder: 50 },
    },
    {
      name: '⑨ 窄板：榫宽受肩宽 ≥6mm 约束',
      input: { ...base, boardAThickness: 20, boardAWidth: 30 },
      expect: { tenonWidth: 18, shoulder: 6 },
    },
    {
      name: '⑩ 穿透榫眼深 = 孔板厚 + 1；盲榫 = 榫长',
      input: { ...base, boardAThickness: 20, boardBThickness: 18 },
      expect: { tenonLength: 18, mortiseDepth: 19 },
    },
  ]

  for (const c of cases) {
    it(c.name, () => {
      const r = computeTenon(c.input)
      for (const [k, v] of Object.entries(c.expect)) {
        expect(r[k as keyof typeof r]).toBeCloseTo(v as number, 6)
      }
    })
  }

  it('盲榫（lengthRatio 0.6）：眼深 = 榫长', () => {
    const r = computeTenon({ ...base, boardAThickness: 20, boardBThickness: 18, lengthRatio: 0.6 })
    expect(r.tenonLength).toBeCloseTo(10.8, 6)
    expect(r.mortiseDepth).toBeCloseTo(10.8, 6)
  })

  it('腹边距缺省居中：tA=21, 榫厚 7 → 7.0', () => {
    const r = computeTenon({ ...base, boardAThickness: 21 })
    expect(r.offsetFromFace).toBeCloseTo(7.0, 6)
  })

  it('榫厚过细警告（<4mm）与紧配提示', () => {
    const r1 = computeTenon({ ...base, boardAThickness: 10 })
    expect(r1.warnings.some((w) => w.includes('过细'))).toBe(true)
    const r2 = computeTenon({ ...base, boardAThickness: 20, fitDeltaMm: 0.2, fit: 'tight' })
    expect(r2.warnings.some((w) => w.includes('紧配合'))).toBe(true)
  })
})
