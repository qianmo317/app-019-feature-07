// 配合余量经验值表（可编辑，来源：木工经验值，非标准规范）
import type { Fit, Wood } from '../types'

/**
 * 榫厚修正表（mm）：
 * 紧配合 → 正过盈（装的时候要敲，胶合面压力大）
 * 标准配合 → 不增减（榫厚 = 料厚/3）
 * 松配合 → 负偏差（留胶层，适合吸水膨胀大的软木）
 */
export type FitTable = Record<Wood, Record<Fit, number>>

export const DEFAULT_FIT_TABLE: FitTable = {
  hardwood: { tight: 0.2, standard: 0, loose: -0.3 },
  softwood: { tight: 0.3, standard: 0, loose: -0.4 },
}

export const FIT_LABEL: Record<Fit, string> = {
  tight: '紧',
  standard: '标准',
  loose: '松',
}

export const WOOD_LABEL: Record<Wood, string> = {
  softwood: '软木',
  hardwood: '硬木',
}

const STORAGE_KEY = 'wjb.fittable.v1'

export function loadFitTable(): FitTable {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_FIT_TABLE
    const parsed = JSON.parse(raw) as Partial<FitTable>
    // 校验结构完整，缺省回退默认值
    return {
      hardwood: { ...DEFAULT_FIT_TABLE.hardwood, ...(parsed.hardwood ?? {}) },
      softwood: { ...DEFAULT_FIT_TABLE.softwood, ...(parsed.softwood ?? {}) },
    }
  } catch {
    return DEFAULT_FIT_TABLE
  }
}

export function saveFitTable(t: FitTable): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(t))
}

export function fitDelta(table: FitTable, wood: Wood, fit: Fit): number {
  return table[wood][fit]
}
