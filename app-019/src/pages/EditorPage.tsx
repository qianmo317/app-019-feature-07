// 图纸编辑器：左（零件 + 榫卯列表 + 当前榫卯参数）| 中三视图 | 右切割步骤（蓝图 §6）
// 一个方案可挂多个榫卯：中间只画当前选中的一个，右侧按榫卯分组列出全部切割步骤。
import { useMemo, useRef, useState } from 'react'
import type { Drawing, Joint, JointKind, Params, Part, Wood, Fit } from '../types'
import { KIND_LABEL } from '../types'
import { computeJoint } from '../lib/calc'
import { buildViews } from '../geometry/views'
import { buildCutList } from '../lib/cutlist'
import { fmt01, fmtDrawing } from '../lib/format'
import {
  getPlan,
  upsertPlan,
  downloadJSON,
  deletePlan,
  updateJointParams,
  updateJointKind,
  updateJointParts,
  addJoint,
  removeJoint,
  addPart,
  updatePart,
  removePart,
  partIsUsed,
} from '../store/plans'
import { navigate } from '../router'
import { ViewSvg, CheckRuler } from '../components/ViewSvg'
import { NumField, ParamForm } from '../components/ParamForm'
import { DEFAULT_FIT_TABLE, WOOD_LABEL, loadFitTable, saveFitTable, type FitTable } from '../lib/fit'

export function EditorPage({ id }: { id: string }) {
  const [plan, setPlan] = useState<Drawing | undefined>(() => getPlan(id))
  const [activeId, setActiveId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [savedTick, setSavedTick] = useState(0)
  const recalcMs = useRef(0)

  const joint: Joint | undefined =
    plan?.joints.find((j) => j.id === activeId) ?? plan?.joints[0]

  // 参数改动即时重算（验收：<100ms）；只重算当前榫卯
  const computed = useMemo(() => {
    if (!plan || !joint) return null
    const t0 = performance.now()
    const r = computeJoint(joint)
    const views = buildViews(joint, r)
    recalcMs.current = performance.now() - t0
    return { result: r, views, cut: buildCutList(joint, r.dovetail, r.tenon) }
  }, [plan, joint, savedTick])

  // 右侧步骤：全部榫卯各算一组（只生成步骤文本，不画 SVG）
  const groups = useMemo(() => {
    if (!plan) return []
    return plan.joints.map((j, i) => {
      const r = computeJoint(j)
      return {
        joint: j,
        index: i,
        partA: plan.parts.find((p) => p.id === j.partAId),
        partB: plan.parts.find((p) => p.id === j.partBId),
        cut: buildCutList(j, r.dovetail, r.tenon),
      }
    })
  }, [plan, savedTick])

  if (!plan) {
    return (
      <div className="page">
        <p className="error">方案不存在或已删除</p>
        <button className="btn" onClick={() => navigate('/')}>回方案列表</button>
      </div>
    )
  }

  const patch = (next: Drawing) => {
    setPlan(next)
    setDirty(true)
  }

  const save = () => {
    if (!plan) return
    upsertPlan(plan)
    setDirty(false)
    setSavedTick((t) => t + 1)
  }

  const jointIndex = joint ? plan.joints.findIndex((j) => j.id === joint.id) : -1
  const partA = joint ? plan.parts.find((p) => p.id === joint.partAId) : undefined
  const partB = joint ? plan.parts.find((p) => p.id === joint.partBId) : undefined

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
          <PartsEditor
            plan={plan}
            onChange={(partId, p2) => patch(updatePart(plan, partId, p2))}
            onAdd={() => patch(addPart(plan))}
            onRemove={(partId) => patch(removePart(plan, partId))}
          />

          <h2>榫卯（{plan.joints.length}）</h2>
          <div className="joint-list" data-testid="joint-list">
            {plan.joints.map((j, i) => {
              const a = plan.parts.find((p) => p.id === j.partAId)
              const b = plan.parts.find((p) => p.id === j.partBId)
              return (
                <div
                  key={j.id}
                  className={`joint-tab ${joint?.id === j.id ? 'active' : ''}`}
                  data-testid={`joint-tab-${i}`}
                >
                  <button
                    type="button"
                    className="joint-tab-main"
                    data-testid={`joint-select-${i}`}
                    onClick={() => setActiveId(j.id)}
                  >
                    <strong>{i + 1}. {KIND_LABEL[j.kind]}</strong>
                    <span>{a?.name ?? '?'} × {b?.name ?? '?'}</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger joint-tab-del"
                    data-testid={`joint-delete-${i}`}
                    disabled={plan.joints.length <= 1}
                    title={plan.joints.length <= 1 ? '至少保留一个榫卯' : '删除该榫卯'}
                    onClick={() => patch(removeJoint(plan, j.id))}
                  >
                    删
                  </button>
                </div>
              )
            })}
          </div>
          <AddJointButton onAdd={(k) => patch(addJoint(plan, k))} />

          {joint && (
            <div className="active-joint" data-testid="active-joint">
              <h2>当前榫卯 {jointIndex + 1}/{plan.joints.length}</h2>
              <select
                data-testid="editor-kind"
                value={joint.kind}
                onChange={(e) => patch(updateJointKind(plan, joint.id, e.target.value as JointKind))}
              >
                {(Object.keys(KIND_LABEL) as JointKind[]).map((k) => (
                  <option key={k} value={k}>{KIND_LABEL[k]}</option>
                ))}
              </select>

              <h2>作用零件</h2>
              <label className="field">
                <span className="field-label">件 A（齿板 / 榫舌板）</span>
                <select
                  data-testid="part-a-select"
                  value={joint.partAId}
                  onChange={(e) => patch(updateJointParts(plan, joint.id, 'A', e.target.value))}
                >
                  {plan.parts.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}（{fmtDrawing(p.thickness)}×{fmtDrawing(p.width)}）</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">件 B（销板 / 榫孔板）</span>
                <select
                  data-testid="part-b-select"
                  value={joint.partBId}
                  onChange={(e) => patch(updateJointParts(plan, joint.id, 'B', e.target.value))}
                >
                  {plan.parts.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}（{fmtDrawing(p.thickness)}×{fmtDrawing(p.width)}）</option>
                  ))}
                </select>
              </label>
              <p className="note">切换零件后按零件长宽厚重算；在下方参数里改板宽/板厚会同步回零件。</p>

              <h2>参数</h2>
              <ParamForm
                kind={joint.kind}
                params={joint.params}
                labelA={`件 A · ${partA?.name ?? ''}`}
                labelB={`件 B · ${partB?.name ?? ''}`}
                onChange={(p: Params) => patch(updateJointParams(plan, joint.id, p))}
              />
              <FitTableEditor />
            </div>
          )}
        </aside>

        <main className="col-views">
          {joint && (
            <div className="current-joint-head" data-testid="current-joint-head">
              当前榫卯 {jointIndex + 1}/{plan.joints.length}：{KIND_LABEL[joint.kind]} ·{' '}
              {partA?.name ?? '?'} × {partB?.name ?? '?'}
            </div>
          )}
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
          {computed && joint && joint.kind.startsWith('dovetail') && computed.result.dovetail && (
            <ToothTable dt={computed.result.dovetail} />
          )}
        </main>

        <aside className="col-steps">
          <h2>切割步骤（按榫卯分组）</h2>
          <div data-testid="cut-steps">
            {groups.map((g) => (
              <section
                key={g.joint.id}
                className={`cut-group ${joint?.id === g.joint.id ? 'active' : ''}`}
                data-testid={`cut-group-${g.index}`}
              >
                <h3>
                  榫卯 {g.index + 1} · {KIND_LABEL[g.joint.kind]}
                  <button
                    type="button"
                    className="btn btn-sm cut-group-jump"
                    data-testid={`cut-jump-${g.index}`}
                    onClick={() => setActiveId(g.joint.id)}
                  >
                    查看图纸
                  </button>
                </h3>
                <p className="note">{g.partA?.name ?? '?'} × {g.partB?.name ?? '?'}</p>
                <CutSteps cut={g.cut} labelA={`件 A · ${g.partA?.name ?? ''}`} labelB={`件 B · ${g.partB?.name ?? ''}`} />
              </section>
            ))}
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

function AddJointButton({ onAdd }: { onAdd: (k: JointKind) => void }) {
  return (
    <details className="add-joint" data-testid="add-joint">
      <summary className="btn btn-sm btn-secondary" data-testid="add-joint-toggle">＋ 增加榫卯</summary>
      <div className="add-joint-list">
        {(Object.keys(KIND_LABEL) as JointKind[]).map((k) => (
          <button
            key={k}
            type="button"
            className="btn btn-sm"
            data-testid={`add-joint-${k}`}
            onClick={() => onAdd(k)}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
    </details>
  )
}

function PartsEditor({
  plan,
  onChange,
  onAdd,
  onRemove,
}: {
  plan: Drawing
  onChange: (partId: string, patch: Partial<Omit<Part, 'id' | 'jointIds'>>) => void
  onAdd: () => void
  onRemove: (partId: string) => void
}) {
  return (
    <div className="parts-editor" data-testid="parts-editor">
      <h2>零件（{plan.parts.length}）</h2>
      {plan.parts.map((part, i) => {
        const used = partIsUsed(plan, part.id)
        return (
          <div key={part.id} className="part-card" data-testid={`part-${i}`}>
            <input
              type="text"
              className="part-name"
              data-testid={`part-name-${i}`}
              value={part.name}
              onChange={(e) => onChange(part.id, { name: e.target.value })}
            />
            <div className="part-fields">
              <NumField label="长" testid={`part-length-${i}`} value={part.length} min={20} max={3000}
                onChange={(v) => onChange(part.id, { length: v })} />
              <NumField label="宽" testid={`part-width-${i}`} value={part.width} min={20} max={900}
                onChange={(v) => onChange(part.id, { width: v })} />
              <NumField label="厚" testid={`part-thickness-${i}`} value={part.thickness} min={3} max={80}
                onChange={(v) => onChange(part.id, { thickness: v })} />
              <NumField label="数量" testid={`part-qty-${i}`} value={part.qty} min={1} max={999} step={1}
                onChange={(v) => onChange(part.id, { qty: Math.max(1, Math.round(v)) })} />
            </div>
            <p className="note">参与 {part.jointIds.length} 个榫卯</p>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              data-testid={`part-delete-${i}`}
              disabled={used}
              title={used ? '该零件被榫卯引用，先解除引用再删' : '删除零件'}
              onClick={() => onRemove(part.id)}
            >
              删除零件
            </button>
          </div>
        )
      })}
      <button type="button" className="btn btn-sm btn-secondary" data-testid="part-add" onClick={onAdd}>
        ＋ 增加零件
      </button>
    </div>
  )
}

function ToothTable({ dt }: { dt: NonNullable<ReturnType<typeof computeJoint>['dovetail']> }) {
  return (
    <div className="tooth-table-wrap">
      <h2>齿宽分配表（齿号）</h2>
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

export function CutSteps({
  cut,
  labelA = '件 A',
  labelB = '件 B',
}: {
  cut: ReturnType<typeof buildCutList>
  labelA?: string
  labelB?: string
}) {
  return (
    <div className="cut-steps">
      <h4>{labelA}</h4>
      <ol className="steps">
        {cut.boardA.map((s) => (
          <li key={s.no}>
            <strong>{s.action}</strong>
            <span>{s.detail}</span>
          </li>
        ))}
      </ol>
      <h4>{labelB}</h4>
      <ol className="steps">
        {cut.boardB.map((s) => (
          <li key={s.no}>
            <strong>{s.action}</strong>
            <span>{s.detail}</span>
          </li>
        ))}
      </ol>
      <h4>注意事项</h4>
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

// —— 打印页：按榫卯逐段出图，每段自带齿号（齿宽表）与切割步骤 ——

export function PrintPage({ id }: { id: string }) {
  const plan = getPlan(id)
  if (!plan) return <div className="page"><p className="error">方案不存在</p></div>
  const sections = plan.joints.map((joint, i) => {
    const r = computeJoint(joint)
    const views = buildViews(joint, r)
    const partA = plan.parts.find((p) => p.id === joint.partAId)
    const partB = plan.parts.find((p) => p.id === joint.partBId)
    return { joint, index: i, result: r, views, partA, partB, cut: buildCutList(joint, r.dovetail, r.tenon) }
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

      {sections.map((s) => (
        <section key={s.joint.id} className="print-section print-joint" data-testid={`print-joint-${s.index}`}>
          <h2>
            榫卯 {s.index + 1}/{plan.joints.length} · {KIND_LABEL[s.joint.kind]}（{s.partA?.name ?? '?'} × {s.partB?.name ?? '?'}）
          </h2>
          <h3>三视图</h3>
          {s.views.map((vm) => (
            <div key={vm.id} className="print-view-block">
              <ViewSvg vm={vm} widthMm={vm.contentW + 48} />
            </div>
          ))}

          <h3>1:1 模板页（剪下贴在木料上描线）</h3>
          <div className="print-view-block">
            {s.views[0] && <ViewSvg vm={s.views[0]} widthMm={s.views[0].contentW + 48} />}
          </div>

          {s.result.dovetail && (
            <>
              <h3>齿号与齿宽分配表</h3>
              <ToothTable dt={s.result.dovetail} />
            </>
          )}

          <h3>切割步骤</h3>
          <CutSteps
            cut={s.cut}
            labelA={`件 A · ${s.partA?.name ?? ''}`}
            labelB={`件 B · ${s.partB?.name ?? ''}`}
          />
        </section>
      ))}
    </div>
  )
}
