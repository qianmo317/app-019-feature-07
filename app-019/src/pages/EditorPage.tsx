// 图纸编辑器：左榫卯列表/参数/零件 | 中当前榫卯三视图 | 右按榫卯分组的切割步骤（蓝图 §6）
import { useMemo, useRef, useState } from 'react'
import type { Drawing, JointKind, Part, Wood, Fit } from '../types'
import { KIND_LABEL, JOINT_KINDS } from '../types'
import { computeJoint } from '../lib/calc'
import { buildViews } from '../geometry/views'
import { buildCutList } from '../lib/cutlist'
import { fmt01 } from '../lib/format'
import {
  getPlan,
  upsertPlan,
  downloadJSON,
  deletePlan,
  renamePlan,
  updatePart,
  addPart,
  removePart,
  partInUse,
  addJoint,
  removeJoint,
  setJointKind,
  updateJointParams,
  setJointPart,
} from '../store/plans'
import { navigate } from '../router'
import { ViewSvg, CheckRuler } from '../components/ViewSvg'
import { ParamForm } from '../components/ParamForm'
import { DEFAULT_FIT_TABLE, WOOD_LABEL, loadFitTable, saveFitTable, type FitTable } from '../lib/fit'

interface ComputedJoint {
  jointId: string
  result: ReturnType<typeof computeJoint>
  views: ReturnType<typeof buildViews>
  cut: ReturnType<typeof buildCutList>
}

export function EditorPage({ id }: { id: string }) {
  const [plan, setPlan] = useState<Drawing | undefined>(() => getPlan(id))
  const [currentJointId, setCurrentJointId] = useState<string | null>(() => getPlan(id)?.joints[0]?.id ?? null)
  const [dirty, setDirty] = useState(false)
  const [savedTick, setSavedTick] = useState(0)
  const [addKind, setAddKind] = useState<JointKind>('dovetail')
  const recalcMs = useRef(0)

  // 全部榫卯统一重算（验收：<100ms）；中间视图与右侧步骤共用同一份结果
  const computedAll = useMemo<ComputedJoint[]>(() => {
    if (!plan) return []
    const t0 = performance.now()
    const out = plan.joints.map((j) => {
      const result = computeJoint(j)
      return {
        jointId: j.id,
        result,
        views: buildViews(j, result),
        cut: buildCutList(j, result.dovetail, result.tenon),
      }
    })
    recalcMs.current = performance.now() - t0
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, savedTick])

  if (!plan) {
    return (
      <div className="page">
        <p className="error">方案不存在或已删除</p>
        <button className="btn" onClick={() => navigate('/')}>回方案列表</button>
      </div>
    )
  }

  const current =
    computedAll.find((c) => c.jointId === currentJointId) ?? computedAll[0] ?? null
  const joint = current ? plan.joints.find((j) => j.id === current.jointId)! : null
  const partName = (pid: string | null) => plan.parts.find((p) => p.id === pid)?.name ?? null

  const change = (next: Drawing) => {
    setPlan(next)
    setDirty(true)
  }
  const onAddJoint = () => {
    const { plan: next, jointId } = addJoint(plan, addKind)
    change(next)
    setCurrentJointId(jointId)
  }
  const onRemoveJoint = (jid: string) => {
    change(removeJoint(plan, jid))
    if (currentJointId === jid) setCurrentJointId(null)
  }

  const save = () => {
    upsertPlan(plan)
    setDirty(false)
    setSavedTick((t) => t + 1)
  }

  return (
    <div className="page editor-page" data-testid="editor-page">
      <div className="page-head">
        <input
          className="title-input"
          data-testid="plan-title"
          value={plan.title}
          onChange={(e) => change(renamePlan(plan, e.target.value))}
        />
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
          <h2>本方案榫卯（{plan.joints.length}）</h2>
          <ul className="joint-list" data-testid="joint-list">
            {plan.joints.map((j, i) => (
              <li key={j.id} className={`joint-item ${j.id === joint?.id ? 'active' : ''}`}>
                <button
                  type="button"
                  className="joint-tab"
                  data-testid={`joint-tab-${j.id}`}
                  onClick={() => setCurrentJointId(j.id)}
                >
                  <strong>榫卯 {i + 1} · {KIND_LABEL[j.kind]}</strong>
                  <span className="joint-parts">
                    {partName(j.partAId) ?? '未指定'} ⨯ {partName(j.partBId) ?? '未指定'}
                  </span>
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm joint-del"
                  data-testid={`joint-delete-${j.id}`}
                  onClick={() => onRemoveJoint(j.id)}
                >
                  删
                </button>
              </li>
            ))}
            {plan.joints.length === 0 && <li className="empty">还没有榫卯，先在下面添加一个</li>}
          </ul>
          <div className="add-joint">
            <select
              data-testid="add-joint-kind"
              value={addKind}
              onChange={(e) => setAddKind(e.target.value as JointKind)}
            >
              {JOINT_KINDS.map((k) => (
                <option key={k.kind} value={k.kind}>{k.label}</option>
              ))}
            </select>
            <button type="button" className="btn btn-primary btn-sm" data-testid="add-joint" onClick={onAddJoint}>
              添加榫卯
            </button>
          </div>

          {joint ? (
            <>
              <h2>榫卯类型</h2>
              <select
                data-testid="editor-kind"
                value={joint.kind}
                onChange={(e) => change(setJointKind(plan, joint.id, e.target.value as JointKind))}
              >
                {(Object.keys(KIND_LABEL) as JointKind[]).map((k) => (
                  <option key={k} value={k}>{KIND_LABEL[k]}</option>
                ))}
              </select>
              <h2>参数</h2>
              <ParamForm
                kind={joint.kind}
                params={joint.params}
                parts={plan.parts}
                partAId={joint.partAId}
                partBId={joint.partBId}
                onSelectPart={(side, pid) => change(setJointPart(plan, joint.id, side, pid))}
                onChange={(p) => change(updateJointParams(plan, joint.id, p))}
              />
            </>
          ) : (
            <p className="empty" data-testid="no-joint">方案中没有榫卯，请先添加</p>
          )}

          <PartsEditor plan={plan} onChange={change} />
          <FitTableEditor />
        </aside>

        <main className="col-views">
          {joint && current ? (
            <>
              <h2 className="current-joint-head" data-testid="current-joint-head">
                {KIND_LABEL[joint.kind]}
                <span className="current-joint-parts">
                  {partName(joint.partAId) ?? '件 A'} ⨯ {partName(joint.partBId) ?? '件 B'}
                </span>
              </h2>
              {current.result.warnings.length > 0 && (
                <div className="warnings" role="alert" data-testid="warnings">
                  {current.result.warnings.map((w, i) => (
                    <p key={i}>⚠ {w}</p>
                  ))}
                </div>
              )}
              <div className="views" data-testid="views">
                {current.views.map((vm) => <ViewSvg key={vm.id} vm={vm} />)}
              </div>
              <p className="note" data-testid="recalc-ms">重算耗时 {recalcMs.current.toFixed(1)}ms（要求 &lt;100ms）</p>
              {joint.kind.startsWith('dovetail') && current.result.dovetail && (
                <ToothTable dt={current.result.dovetail} />
              )}
            </>
          ) : (
            <p className="empty">中间三视图：在左侧选择或添加一个榫卯后显示</p>
          )}
        </main>

        <aside className="col-steps">
          <h2>切割步骤（按榫卯分组）</h2>
          <div data-testid="cut-steps">
            {computedAll.map((c, i) => {
              const j = plan.joints.find((x) => x.id === c.jointId)!
              return (
                <section
                  key={c.jointId}
                  className={`cut-group ${c.jointId === joint?.id ? 'active' : ''}`}
                  data-testid={`cut-group-${c.jointId}`}
                >
                  <button type="button" className="cut-group-head" onClick={() => setCurrentJointId(c.jointId)}>
                    榫卯 {i + 1} · {KIND_LABEL[j.kind]}（{partName(j.partAId) ?? '件 A'} ⨯ {partName(j.partBId) ?? '件 B'}）
                  </button>
                  <CutSteps cut={c.cut} labelA={partName(j.partAId) ?? undefined} labelB={partName(j.partBId) ?? undefined} />
                </section>
              )
            })}
            {computedAll.length === 0 && <p className="empty">暂无切割步骤</p>}
          </div>
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

function PartsEditor({ plan, onChange }: { plan: Drawing; onChange: (d: Drawing) => void }) {
  const set = (p: Part, patch: Parameters<typeof updatePart>[2]) => onChange(updatePart(plan, p.id, patch))
  return (
    <div className="parts-editor" data-testid="parts-editor">
      <h2>零件清单</h2>
      <table className="parts-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>长</th>
            <th>宽</th>
            <th>厚</th>
            <th>数量</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {plan.parts.map((p) => {
            const used = partInUse(plan, p.id)
            return (
              <tr key={p.id} data-testid={`part-row-${p.id}`}>
                <td>
                  <input
                    type="text"
                    className="part-name-input"
                    data-testid={`part-name-${p.id}`}
                    value={p.name}
                    onChange={(e) => set(p, { name: e.target.value })}
                  />
                </td>
                <td>
                  <MiniNum value={p.lengthMm} testid={`part-length-${p.id}`} min={20} max={3000} step={1}
                    onChange={(v) => set(p, { lengthMm: v })} />
                </td>
                <td>
                  <MiniNum value={p.widthMm} testid={`part-width-${p.id}`} min={20} max={900}
                    onChange={(v) => set(p, { widthMm: v })} />
                </td>
                <td>
                  <MiniNum value={p.thicknessMm} testid={`part-thickness-${p.id}`} min={3} max={80}
                    onChange={(v) => set(p, { thicknessMm: v })} />
                </td>
                <td>
                  <MiniNum value={p.qty} testid={`part-qty-${p.id}`} min={1} max={999} step={1}
                    onChange={(v) => set(p, { qty: Math.round(v) })} />
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    data-testid={`part-delete-${p.id}`}
                    disabled={used}
                    title={used ? '该零件被榫卯引用，先在榫卯中改挂其他零件' : '删除零件'}
                    onClick={() => onChange(removePart(plan, p.id))}
                  >
                    删
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="note">单位 mm；宽/厚为接合端截面尺寸，与所挂榫卯双向同步。被榫卯引用的零件不可删除。</p>
      <button type="button" className="btn btn-sm" data-testid="add-part" onClick={() => onChange(addPart(plan))}>
        添加零件
      </button>
    </div>
  )
}

function MiniNum({
  value,
  onChange,
  min,
  max,
  step = 0.5,
  testid,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  testid?: string
}) {
  return (
    <input
      type="number"
      className="mini-num"
      data-testid={testid}
      value={value}
      step={step}
      min={min}
      max={max}
      onChange={(e) => {
        const raw = parseFloat(e.target.value)
        if (!Number.isFinite(raw)) return
        const v = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, raw))
        onChange(step >= 1 ? Math.round(v) : Math.round(v * 10) / 10)
      }}
    />
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

function CutSteps({
  cut,
  labelA,
  labelB,
}: {
  cut: ReturnType<typeof buildCutList>
  labelA?: string
  labelB?: string
}) {
  return (
    <div className="cut-steps-body" data-testid="cut-steps-body">
      <h3>{labelA ? `${labelA}（件 A）` : '件 A'}</h3>
      <ol className="steps">
        {cut.boardA.map((s) => (
          <li key={s.no}>
            <strong>{s.action}</strong>
            <span>{s.detail}</span>
          </li>
        ))}
      </ol>
      <h3>{labelB ? `${labelB}（件 B）` : '件 B'}</h3>
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

  const sections = plan.joints.map((joint) => {
    const result = computeJoint(joint)
    return {
      joint,
      result,
      views: buildViews(joint, result),
    }
  })

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
        <div className="print-view-block">
          <CheckRuler />
        </div>
      </section>

      {sections.map((s, i) => {
        const j = s.joint
        const r = s.result
        const nameA = plan.parts.find((p) => p.id === j.partAId)?.name ?? '件 A'
        const nameB = plan.parts.find((p) => p.id === j.partBId)?.name ?? '件 B'
        return (
          <section key={j.id} className="print-section print-joint" data-testid={`print-joint-${j.id}`}>
            <h2>
              榫卯 {i + 1} · {KIND_LABEL[j.kind]}（{nameA} ⨯ {nameB}）
            </h2>
            {s.views.map((vm) => (
              <div key={vm.id} className="print-view-block">
                <ViewSvg vm={vm} widthMm={vm.contentW + 48} />
              </div>
            ))}
            {j.kind.startsWith('dovetail') && r.dovetail && (
              <PrintToothTable dt={r.dovetail} />
            )}
            <h3>切割步骤</h3>
            <CutSteps cut={buildCutList(j, r.dovetail, r.tenon)} labelA={nameA} labelB={nameB} />
          </section>
        )
      })}

      {sections[0]?.views[0] && (
        <section className="print-section print-template" data-testid="print-template">
          <h2>1:1 模板页（剪下贴在木料上描线）</h2>
          <div className="print-view-block">
            <ViewSvg vm={sections[0].views[0]} widthMm={sections[0].views[0].contentW + 48} />
          </div>
        </section>
      )}
    </div>
  )
}

function PrintToothTable({ dt }: { dt: NonNullable<ReturnType<typeof computeJoint>['dovetail']> }) {
  return (
    <table className="tooth-table print-tooth-table" data-testid="print-tooth-table">
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
  )
}
