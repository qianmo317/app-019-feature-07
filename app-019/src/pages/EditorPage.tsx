// 图纸编辑器：左参数 | 中三视图 | 右切割步骤与提示（蓝图 §6）
import { useMemo, useRef, useState } from 'react'
import type { Drawing, JointKind, Params, Wood, Fit } from '../types'
import { KIND_LABEL } from '../types'
import { computeJoint } from '../lib/calc'
import { buildViews } from '../geometry/views'
import { buildCutList } from '../lib/cutlist'
import { fmt01 } from '../lib/format'
import { getPlan, upsertPlan, downloadJSON, deletePlan } from '../store/plans'
import { navigate } from '../router'
import { ViewSvg, CheckRuler } from '../components/ViewSvg'
import { ParamForm } from '../components/ParamForm'
import { DEFAULT_FIT_TABLE, WOOD_LABEL, loadFitTable, saveFitTable, type FitTable } from '../lib/fit'

export function EditorPage({ id }: { id: string }) {
  const [plan, setPlan] = useState<Drawing | undefined>(() => getPlan(id))
  const [dirty, setDirty] = useState(false)
  const [savedTick, setSavedTick] = useState(0)
  const recalcMs = useRef(0)

  // 参数改动即时重算（验收：<100ms）
  const computed = useMemo(() => {
    if (!plan) return null
    const t0 = performance.now()
    const r = computeJoint(plan.joints[0])
    const views = buildViews(plan.joints[0], r)
    recalcMs.current = performance.now() - t0
    return { result: r, views, cut: buildCutList(plan.joints[0], r.dovetail, r.tenon) }
  }, [plan, savedTick])

  if (!plan) {
    return (
      <div className="page">
        <p className="error">方案不存在或已删除</p>
        <button className="btn" onClick={() => navigate('/')}>回方案列表</button>
      </div>
    )
  }

  const joint = plan.joints[0]

  const updateParams = (p: Params) => {
    setPlan((prev) =>
      prev
        ? { ...prev, joints: [{ ...prev.joints[0], params: p }], updatedAt: Date.now() }
        : prev,
    )
    setDirty(true)
  }
  const updateKind = (k: JointKind) => {
    setPlan((prev) => (prev ? { ...prev, joints: [{ ...prev.joints[0], kind: k }], updatedAt: Date.now() } : prev))
    setDirty(true)
  }

  const save = () => {
    if (!plan) return
    upsertPlan(plan)
    setDirty(false)
    setSavedTick((t) => t + 1)
  }

  return (
    <div className="page editor-page" data-testid="editor-page">
      <div className="page-head">
        <h1>{plan.title}</h1>
        <div className="head-actions">
          <button className="btn btn-secondary" data-testid="export-json" onClick={() => downloadJSON(plan)}>
            导出 JSON
          </button>
          <button className="btn btn-secondary" data-testid="go-print" onClick={() => navigate(`/plan/${plan.id}/print`)}>
            打印视图
          </button>
          <button className="btn btn-primary" data-testid="save-plan" onClick={save}>
            保存
          </button>
        </div>
      </div>

      {dirty && (
        <div className="dirty-bar" role="status" data-testid="dirty-bar">
          参数已改，请重新核对尺寸
          <button className="btn btn-sm btn-primary" onClick={save}>保存</button>
        </div>
      )}

      <div className="editor-grid">
        <aside className="col-params">
          <h2>榫卯类型</h2>
          <select
            data-testid="editor-kind"
            value={joint.kind}
            onChange={(e) => updateKind(e.target.value as JointKind)}
          >
            {(Object.keys(KIND_LABEL) as JointKind[]).map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k]}</option>
            ))}
          </select>
          <h2>参数</h2>
          <ParamForm kind={joint.kind} params={joint.params} onChange={updateParams} />
          <FitTableEditor />
        </aside>

        <main className="col-views">
          {computed && computed.result.warnings.length > 0 && (
            <div className="warnings" role="alert" data-testid="warnings">
              {computed.result.warnings.map((w, i) => (
                <p key={i}>⚠ {w}</p>
              ))}
            </div>
          )}
          <div className="views" data-testid="views">
            {computed?.views.map((vm) => <ViewSvg key={vm.id} vm={vm} />)}
          </div>
          <p className="note" data-testid="recalc-ms">重算耗时 {recalcMs.current.toFixed(1)}ms（要求 &lt;100ms）</p>
          {computed && joint.kind.startsWith('dovetail') && computed.result.dovetail && (
            <ToothTable dt={computed.result.dovetail} />
          )}
        </main>

        <aside className="col-steps">
          <h2>切割步骤</h2>
          {computed && <CutSteps cut={computed.cut} />}
          <button
            className="btn btn-danger btn-sm"
            data-testid="delete-plan"
            onClick={() => {
              deletePlan(plan.id)
              navigate('/')
            }}
          >
            删除方案
          </button>
        </aside>
      </div>
    </div>
  )
}

function ToothTable({ dt }: { dt: NonNullable<ReturnType<typeof computeJoint>['dovetail']> }) {
  return (
    <div className="tooth-table-wrap">
      <h2>齿宽分配表</h2>
      <table className="tooth-table" data-testid="tooth-table">
        <thead>
          <tr>
            <th>齿号</th>
            <th>齿顶宽</th>
            <th>齿根宽</th>
            <th>距左端</th>
          </tr>
        </thead>
        <tbody>
          {dt.teeth.map((t) => (
            <tr key={t.index}>
              <td>{t.index}</td>
              <td>{fmt01(t.topW)}</td>
              <td>{fmt01(t.rootW)}</td>
              <td>{fmt01(t.faceX)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">闭合误差 {dt.closureError.toFixed(3)}mm；半齿边距 {fmt01(dt.margin)}mm（左右对称）</p>
    </div>
  )
}

function CutSteps({ cut }: { cut: ReturnType<typeof buildCutList> }) {
  return (
    <div data-testid="cut-steps">
      <h3>件 A</h3>
      <ol className="steps">
        {cut.boardA.map((s) => (
          <li key={s.no}>
            <strong>{s.action}</strong>
            <span>{s.detail}</span>
          </li>
        ))}
      </ol>
      <h3>件 B</h3>
      <ol className="steps">
        {cut.boardB.map((s) => (
          <li key={s.no}>
            <strong>{s.action}</strong>
            <span>{s.detail}</span>
          </li>
        ))}
      </ol>
      <h3>注意事项</h3>
      <ul className="cautions">
        {cut.cautions.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
    </div>
  )
}

export function FitTableEditor() {
  const [table, setTable] = useState<FitTable>(() => loadFitTable())
  const [saved, setSaved] = useState(false)
  const set = (wood: Wood, fit: Fit, v: number) => {
    setSaved(false)
    setTable((prev) => ({ ...prev, [wood]: { ...prev[wood], [fit]: v } }))
  }
  return (
    <details className="fit-table-editor">
      <summary>配合余量表（经验值，可编辑）</summary>
      <table className="fit-table">
        <thead>
          <tr>
            <th></th>
            <th>紧</th>
            <th>标准</th>
            <th>松</th>
          </tr>
        </thead>
        <tbody>
          {(['hardwood', 'softwood'] as Wood[]).map((w) => (
            <tr key={w}>
              <th>{WOOD_LABEL[w]}</th>
              {(['tight', 'standard', 'loose'] as Fit[]).map((f) => (
                <td key={f}>
                  <input
                    type="number"
                    step={0.1}
                    aria-label={`${w}-${f}`}
                    value={table[w][f]}
                    onChange={(e) => set(w, f, parseFloat(e.target.value) || 0)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="actions">
        <button
          className="btn btn-sm btn-primary"
          data-testid="save-fit-table"
          onClick={() => {
            saveFitTable(table)
            setSaved(true)
          }}
        >
          保存余量表
        </button>
        <button className="btn btn-sm" onClick={() => setTable(DEFAULT_FIT_TABLE)}>恢复默认</button>
        {saved && <span className="ok">已保存</span>}
      </div>
      <p className="note">来源：木工经验值（非标准规范）。榫厚 = 料厚×比例 + 表值。</p>
    </details>
  )
}

export function PrintPage({ id }: { id: string }) {
  const plan = getPlan(id)
  if (!plan) return <div className="page"><p className="error">方案不存在</p></div>
  const joint = plan.joints[0]
  const r = computeJoint(joint)
  const views = buildViews(joint, r)
  return (
    <div className="page print-page" data-testid="print-page">
      <div className="print-toolbar no-print">
        <button className="btn btn-primary" data-testid="do-print" onClick={() => window.print()}>
          打印（1:1）
        </button>
        <button className="btn" onClick={() => navigate(`/plan/${plan.id}`)}>返回编辑</button>
        <span className="note">打印前关闭「适应页面/缩放」，选择 A4、100% 缩放</span>
      </div>
      <h1 className="print-title">{plan.title}</h1>
      <section className="print-section">
        <h2>校验尺</h2>
        {views.map((vm) => (
          <div key={vm.id} className="print-view-block">
            <ViewSvg vm={vm} widthMm={vm.contentW + 48} />
          </div>
        ))}
        <div className="print-view-block">
          <CheckRuler />
        </div>
      </section>
      <section className="print-section">
        <h2>1:1 模板页（剪下贴在木料上描线）</h2>
        <div className="print-view-block">
          {views[0] && <ViewSvg vm={views[0]} widthMm={views[0].contentW + 48} />}
        </div>
      </section>
      <section className="print-section">
        <h2>切割步骤</h2>
        <CutSteps cut={buildCutList(joint, r.dovetail, r.tenon)} />
      </section>
    </div>
  )
}
