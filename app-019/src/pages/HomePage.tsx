// 方案列表：按「榫卯类型 + 木料厚度」筛选（识别方案内全部榫卯），支持导入
import { useMemo, useState } from 'react'
import type { Drawing, JointKind } from '../types'
import { JOINT_KINDS, KIND_LABEL } from '../types'
import { deletePlan, filterPlans, importJSON, loadPlans, planKinds, planThicknesses, upsertPlan } from '../store/plans'
import { navigate } from '../router'
import { fmtDrawing } from '../lib/format'

function planSummary(p: Drawing): string {
  const kinds = planKinds(p).map((k) => KIND_LABEL[k])
  const dims = p.joints.map(
    (j) => `${fmtDrawing(j.params.boardA.thickness)}×${fmtDrawing(j.params.boardA.width)}`,
  )
  return `${kinds.join(' / ')} · ${dims.join(' / ')}mm · ${p.joints.length} 个榫卯`
}

export function HomePage({ onImported }: { onImported: (p: Drawing) => void }) {
  const [version, setVersion] = useState(0)
  const [kind, setKind] = useState<JointKind | 'all'>('all')
  const [thickness, setThickness] = useState<number | 'all'>('all')
  const [error, setError] = useState('')

  const all = useMemo(() => {
    void version
    return loadPlans()
  }, [version])

  const plans = useMemo(() => filterPlans(all, kind, thickness), [all, kind, thickness])

  const allThicknesses = useMemo(
    () => [...new Set(all.flatMap((p) => planThicknesses(p)))].sort((a, b) => a - b),
    [all],
  )

  const onFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const plan = importJSON(String(reader.result ?? ''))
        upsertPlan({ ...plan, id: plan.id })
        onImported(plan)
        setVersion((v) => v + 1)
      } catch (e) {
        setError(e instanceof Error ? e.message : '导入失败')
      }
    }
    reader.onerror = () => setError('导入失败')
    reader.readAsText(file)
  }

  return (
    <div className="page" data-testid="home-page">
      <div className="page-head">
        <h1>方案列表</h1>
        <div className="head-actions">
          <label className="btn btn-secondary import-btn">
            导入 JSON
            <input
              type="file"
              accept="application/json,.json"
              data-testid="import-input"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onFile(f)
                e.target.value = ''
              }}
            />
          </label>
          <button className="btn btn-primary" data-testid="new-plan" onClick={() => navigate('/new')}>
            新建方案
          </button>
        </div>
      </div>

      <div className="filters">
        <label>
          类型
          <select data-testid="filter-kind" value={kind} onChange={(e) => setKind(e.target.value as JointKind | 'all')}>
            <option value="all">全部</option>
            {JOINT_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          板厚
          <select
            data-testid="filter-thickness"
            value={thickness === 'all' ? 'all' : String(thickness)}
            onChange={(e) => setThickness(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          >
            <option value="all">全部</option>
            {allThicknesses.map((t) => (
              <option key={t} value={t}>
                {fmtDrawing(t)}mm
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      <ul className="plan-list">
        {plans.map((p) => (
          <li key={p.id} className="plan-card" data-testid="plan-card">
            <button className="plan-open" onClick={() => navigate(`/plan/${p.id}`)}>
              <strong>{p.title}</strong>
              <span className="plan-meta" data-testid={`plan-meta-${p.id}`}>
                {planSummary(p)}
              </span>
            </button>
            <button
              className="btn btn-danger btn-sm"
              data-testid={`delete-${p.id}`}
              onClick={() => {
                deletePlan(p.id)
                setVersion((v) => v + 1)
              }}
            >
              删除
            </button>
          </li>
        ))}
        {plans.length === 0 && <li className="empty">暂无方案，点「新建方案」开始</li>}
      </ul>
    </div>
  )
}
