// 直榫（榫头/榫眼）计算：榫厚通常为料厚 1/3，配合余量查表，输出含锯路补偿
import type { Fit, Wood } from '../types'
import { round01 } from './format'

export interface TenonInput {
  boardAThickness: number // 榫舌板厚 tA
  boardAWidth: number     // 榫舌板宽 wA
  boardBThickness: number // 榫孔板厚 tB（决定榫长）
  thicknessRatio: number  // 榫厚/料厚，默认 1/3
  lengthRatio: number     // 榫长/榫孔板厚，默认 1（穿透）
  offsetFromFace: number | null // 榫肩到腹板面距离；null = 居中
  kerf: number
  wood: Wood
  fit: Fit
  fitDeltaMm: number // 配合修正（查表）
}

export interface TenonResult {
  tenonThickness: number // 榫厚（含配合修正）
  nominalThickness: number // 名义榫厚 = tA × ratio
  tenonWidth: number     // 榫宽
  tenonLength: number    // 榫长
  shoulder: number       // 肩宽（两侧均分）
  mortiseDepth: number   // 榫眼深
  offsetFromFace: number
  mortiseSawOffset: number // 榫眼锯切线补偿（kerf/2，锯片在废料侧）
  warnings: string[]
}

export function computeTenon(input: TenonInput): TenonResult {
  const {
    boardAThickness: tA,
    boardAWidth: wA,
    boardBThickness: tB,
    thicknessRatio,
    lengthRatio,
    kerf,
    fitDeltaMm,
  } = input
  const warnings: string[] = []

  const nominalThickness = round01(tA * thicknessRatio)
  const tenonThickness = round01(tA * thicknessRatio + fitDeltaMm)

  // 榫宽：经验值 ≈ 3×榫厚，且两侧至少留 6mm 肩
  const maxTenonW = wA - 2 * 6
  const tenonWidth = round01(Math.min(3 * tenonThickness, maxTenonW))
  const shoulder = round01((wA - tenonWidth) / 2)

  const tenonLength = round01(tB * lengthRatio)
  const mortiseDepth = lengthRatio >= 1 ? round01(tB + 1) : tenonLength // 穿透榫眼加深 1mm 防顶底
  const offsetFromFace =
    input.offsetFromFace ?? round01((tA - tenonThickness) / 2)

  if (tenonThickness < 4) {
    warnings.push(`榫厚仅 ${tenonThickness}mm，过细易断榫；建议榫厚不低于 4mm`)
  }
  if (shoulder < 5) {
    warnings.push(`肩宽仅 ${shoulder}mm，低于 5mm 抗弯不足；建议加宽木料或减小榫宽`)
  }
  if (tB < tenonLength && lengthRatio < 1) {
    warnings.push('榫长超过榫孔板厚，请检查参数')
  }
  if (fitDeltaMm > 0) {
    warnings.push('紧配合：榫厚已加过盈量，装配需木锤敲入，必要时局部削薄')
  }

  return {
    tenonThickness,
    nominalThickness,
    tenonWidth,
    tenonLength,
    shoulder,
    mortiseDepth,
    offsetFromFace,
    // 榫眼用锯/凿加工时锯路使孔变大：锯切线内收 kerf/2 保住名义尺寸
    mortiseSawOffset: round01(kerf / 2),
    warnings,
  }
}
