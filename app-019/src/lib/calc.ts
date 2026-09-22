// 计算门面：Joint → 统一结果（供三视图、切割步骤、警告共用同一套几何数据）
import type { Joint } from '../types'
import { computeDovetail, type DovetailResult } from './dovetail'
import { computeTenon, type TenonResult } from './tenon'
import { computeLap, computeDowel, computePanel, type LapResult, type DowelResult, type PanelResult } from './joints'
import { loadFitTable } from './fit'

export type JointResult = {
  dovetail?: DovetailResult
  tenon?: TenonResult
  lap?: LapResult
  dowel?: DowelResult
  panel?: PanelResult
  warnings: string[]
}

export function computeJoint(joint: Joint): JointResult {
  const { kind, params } = joint
  const table = loadFitTable()
  const result: JointResult = { warnings: [] }

  switch (kind) {
    case 'dovetail':
    case 'half-blind-dovetail': {
      const dt = computeDovetail({
        width: params.boardA.width,
        thickness: params.boardA.thickness,
        ratio: params.dovetail?.angleRatio ?? 8,
        teeth: params.dovetail?.teeth,
        kerf: params.kerfMm,
        wood: params.wood,
        blind: kind === 'half-blind-dovetail',
      })
      result.dovetail = dt
      result.warnings = dt.warnings
      break
    }
    case 'mortise-tenon': {
      const tn = computeTenon({
        boardAThickness: params.boardA.thickness,
        boardAWidth: params.boardA.width,
        boardBThickness: params.boardB.thickness,
        thicknessRatio: params.tenon?.thicknessRatio ?? 1 / 3,
        lengthRatio: params.tenon?.lengthRatio ?? 1,
        offsetFromFace: params.tenon?.offsetFromFace ?? null,
        kerf: params.kerfMm,
        wood: params.wood,
        fit: params.fit,
        fitDeltaMm: table[params.wood][params.fit],
      })
      result.tenon = tn
      result.warnings = tn.warnings
      break
    }
    case 'lap': {
      const lap = computeLap(
        { thickness: params.boardA.thickness, width: params.boardA.width, kerf: params.kerfMm },
        params.fit,
      )
      result.lap = lap
      result.warnings = lap.warnings
      break
    }
    case 'dowel': {
      const dowel = computeDowel({
        width: params.boardA.width,
        thickness: params.boardA.thickness,
        kerf: params.kerfMm,
      })
      result.dowel = dowel
      result.warnings = dowel.warnings
      break
    }
    case 'panel-glue': {
      const panel = computePanel({
        width: params.boardA.width,
        thickness: params.boardA.thickness,
        kerf: params.kerfMm,
      })
      result.panel = panel
      result.warnings = panel.warnings
      break
    }
  }
  return result
}
