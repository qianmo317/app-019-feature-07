// 燕尾齿宽分配算法单测（蓝图 §10 验收：随机 200 组闭合 ≤0.1mm + 警告不静默）
import { describe, it, expect } from 'vitest'
import { computeDovetail, suggestTeeth, MIN_ROOT } from '../../src/lib/dovetail'

/** 可复现的伪随机（LCG） */
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('燕尾齿宽分配（蓝图 §8 约束）', () => {
  it('基本几何：Σ(齿顶宽)+Σ(齿根宽)=板宽，边距=半齿根宽', () => {
    const r = computeDovetail({ width: 200, thickness: 18, ratio: 8, kerf: 1.1, wood: 'hardwood' })
    const sumTop = r.teeth.reduce((s, t) => s + t.topW, 0)
    const sumRoot = r.teeth.reduce((s, t) => s + t.rootW, 0)
    expect(sumTop + sumRoot).toBeCloseTo(200, 6)
    // 边距 = 末齿齿根宽一半
    expect(r.margin).toBeCloseTo(r.teeth[r.teeth.length - 1].rootW / 2, 6)
    // 齿顶 = 齿根 + 2×斜移量（0.1mm 网格取整，逐齿误差 ≤0.1mm，闭合不受影响）
    for (const t of r.teeth) {
      expect(Math.abs(t.topW - t.rootW - 2 * r.slopeOffset)).toBeLessThanOrEqual(0.1 + 1e-9)
    }
  })

  it('随机 200 组：严格闭合 ≤0.1mm，低于最小值必须给出警告（不静默）', () => {
    const rand = mulberry32(20260916)
    let belowMinCount = 0
    for (let i = 0; i < 200; i++) {
      const width = Math.round((50 + rand() * 550) * 2) / 2 // 50~600，0.5 步进
      const teeth = 2 + Math.floor(rand() * 11) // 2~12
      const ratios = [6, 7, 8] as const
      const ratio = ratios[Math.floor(rand() * 3)]
      const wood = rand() < 0.5 ? 'softwood' : 'hardwood'
      const thickness = Math.round((12 + rand() * 24) * 2) / 2 // 12~36
      const kerf = [0.8, 1.1, 1.6, 2.2][Math.floor(rand() * 4)]
      const r = computeDovetail({ width, thickness, ratio, teeth, kerf, wood })

      // 1) 闭合 ≤ 0.1mm
      expect(r.closureError).toBeLessThanOrEqual(0.1)
      // 2) 无 NaN/负坐标失控
      for (const t of r.teeth) {
        expect(Number.isFinite(t.topW)).toBe(true)
        expect(Number.isFinite(t.rootW)).toBe(true)
        expect(Number.isFinite(t.faceX)).toBe(true)
      }
      // 3) 首齿从边距开始，末齿 + 边距 = 板宽
      expect(r.teeth[0].faceX).toBeCloseTo(r.margin, 6)
      const last = r.teeth[r.teeth.length - 1]
      expect(last.faceX + last.topW + r.margin).toBeCloseTo(width, 6)
      // 4) 低于最小安全值 / 锯路限制 → 必须有警告
      const minRoot = Math.min(...r.teeth.map((t) => t.rootW))
      const minTop = Math.min(...r.teeth.map((t) => t.topW))
      const mustWarn =
        minRoot < MIN_ROOT[wood] ||
        (minTop < 2 * kerf && minTop >= 0) ||
        (teeth < 3 && width >= 150) ||
        width / teeth < 15
      if (minRoot < MIN_ROOT[wood]) belowMinCount++
      if (mustWarn) {
        expect(r.warnings.length).toBeGreaterThan(0)
      } else {
        expect(r.warnings).toEqual([])
      }
    }
    // 覆盖面自检：随机样本确实触及了“低于最小值”分支
    expect(belowMinCount).toBeGreaterThan(0)
  })

  it('边界：齿根宽刚好等于最小值（软木 6mm）时无警告', () => {
    // 构造：t=18, r=6 → 单边斜移 3mm，齿顶-齿根=6mm；要齿根=6 → 齿顶=12 → 每齿 18mm
    // n=5 → W=90
    const r = computeDovetail({ width: 90, thickness: 18, ratio: 6, teeth: 5, kerf: 1.1, wood: 'softwood' })
    for (const t of r.teeth) {
      expect(t.rootW).toBeCloseTo(6, 6)
      expect(t.topW).toBeCloseTo(12, 6)
    }
    expect(r.warnings).toEqual([])
  })

  it('齿顶宽 < 锯路×2 时给警告（否则切不出来）', () => {
    const r = computeDovetail({ width: 30, thickness: 18, ratio: 6, teeth: 12, kerf: 2.2, wood: 'hardwood' })
    const minTop = Math.min(...r.teeth.map((t) => t.topW))
    if (minTop < 4.4) {
      expect(r.warnings.some((w) => w.includes('锯路'))).toBe(true)
    }
  })

  it('齿数过多导致齿根为负：必须警告而非静默', () => {
    const r = computeDovetail({ width: 60, thickness: 18, ratio: 6, teeth: 12, kerf: 1.1, wood: 'softwood' })
    expect(Math.min(...r.teeth.map((t) => t.rootW))).toBeLessThan(0)
    expect(r.warnings.some((w) => w.includes('无法排布'))).toBe(true)
  })

  it('齿数过少（W≥150 且 n<3）给出强度警告', () => {
    const r = computeDovetail({ width: 300, thickness: 18, ratio: 8, teeth: 2, kerf: 1.1, wood: 'hardwood' })
    expect(r.warnings.some((w) => w.includes('齿数过少'))).toBe(true)
  })

  it('半隐燕尾：齿深 = 0.75×板厚，斜移量按齿深计算', () => {
    const r = computeDovetail({ width: 200, thickness: 18, ratio: 8, kerf: 1.1, wood: 'hardwood', blind: true })
    expect(r.depth).toBeCloseTo(13.5, 6)
    expect(r.slopeOffset).toBeCloseTo(13.5 / 8, 6)
  })

  it('suggestTeeth：保证齿根 ≥ 最小安全值，范围 2~12', () => {
    expect(suggestTeeth(200, 18, 8, 'hardwood')).toBe(7)
    // 窄板：自动降到齿根可行的最少齿数
    const n = suggestTeeth(45, 18, 6, 'softwood')
    expect(n).toBeGreaterThanOrEqual(2)
    const r = computeDovetail({ width: 45, thickness: 18, ratio: 6, teeth: n, kerf: 1.1, wood: 'softwood' })
    expect(Math.min(...r.teeth.map((t) => t.rootW))).toBeGreaterThanOrEqual(MIN_ROOT.softwood - 1e-9)
  })
})
