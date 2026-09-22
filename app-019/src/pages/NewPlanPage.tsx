// 新建方案：选榫卯类型 → 填参数 → 生成默认方案进入编辑器
import { useState } from 'react'
import type { JointKind, Params } from '../types'
import { makePlan, upsertPlan } from '../store/plans'
import { navigate } from '../router'
import { KindPicker, ParamForm } from '../components/ParamForm'

const DEFAULT_PARAMS: Params = {
  boardA: { thickness: 18, width: 200 },
  boardB: { thickness: 18, width: 200 },
  wood: 'hardwood',
  fit: 'standard',
  dovetail: { angleRatio: 8 },
  kerfMm: 1.1,
}

export function NewPlanPage() {
  const [kind, setKind] = useState<JointKind | null>(null)
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS)

  const create = () => {
    if (!kind) return
    const plan = makePlan(kind, params)
    upsertPlan(plan)
    navigate(`/plan/${plan.id}`)
  }

  return (
    <div className="page" data-testid="new-page">
      <h1>新建方案</h1>
      <h2>1. 选择榫卯类型</h2>
      <KindPicker value={kind} onChange={setKind} />
      <h2>2. 填写参数</h2>
      {kind ? (
        <ParamForm kind={kind} params={params} onChange={setParams} />
      ) : (
        <p className="empty">先选择上面的榫卯类型</p>
      )}
      <div className="actions">
        <button className="btn btn-primary" data-testid="create-plan" disabled={!kind} onClick={create}>
          生成图纸
        </button>
      </div>
    </div>
  )
}
