// 参数表单：新建与编辑器共用；键盘方向键微调 0.5mm（蓝图 §9）
import type { JointKind, Params, Wood, Fit } from '../types'
import { JOINT_KINDS } from '../types'
import { suggestTeeth } from '../lib/dovetail'

export function NumField({
  label,
  value,
  onChange,
  min,
  max,
  step = 0.5,
  testid,
  hint,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  testid?: string
  hint?: string
}) {
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v))
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        type="number"
        data-testid={testid}
        value={Number.isFinite(value) ? value : ''}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          if (Number.isFinite(v)) onChange(Math.round(clamp(v) * 10) / 10)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const dir = e.key === 'ArrowUp' ? 1 : -1
            const base = Number.isFinite(parseFloat((e.target as HTMLInputElement).value))
              ? parseFloat((e.target as HTMLInputElement).value)
              : 0
            onChange(Math.round(clamp(base + dir * step) * 10) / 10)
          }
        }}
      />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export function ParamForm({
  kind,
  params,
  onChange,
}: {
  kind: JointKind
  params: Params
  onChange: (p: Params) => void
}) {
  const set = (patch: Partial<Params>) => onChange({ ...params, ...patch })
  const setA = (patch: Partial<Params['boardA']>) => set({ boardA: { ...params.boardA, ...patch } })
  const setB = (patch: Partial<Params['boardB']>) => set({ boardB: { ...params.boardB, ...patch } })
  const setDt = (patch: Partial<NonNullable<Params['dovetail']>>) =>
    set({ dovetail: { angleRatio: 8, ...params.dovetail, ...patch } })
  const setTn = (patch: Partial<NonNullable<Params['tenon']>>) =>
    set({ tenon: { thicknessRatio: 1 / 3, lengthRatio: 1, offsetFromFace: 0, ...params.tenon, ...patch } })

  const isDt = kind === 'dovetail' || kind === 'half-blind-dovetail'
  const suggested = isDt
    ? suggestTeeth(
        params.boardA.width,
        params.boardA.thickness,
        params.dovetail?.angleRatio ?? 8,
        params.wood,
        kind === 'half-blind-dovetail',
      )
    : 0

  return (
    <div className="param-form">
      <fieldset>
        <legend>件 A（齿板 / 榫舌板）</legend>
        <NumField
          label="厚度 mm"
          testid="a-thickness"
          value={params.boardA.thickness}
          min={3}
          max={80}
          onChange={(v) => setA({ thickness: v })}
        />
        <NumField
          label="宽度 mm"
          testid="a-width"
          value={params.boardA.width}
          min={20}
          max={900}
          onChange={(v) => setA({ width: v })}
        />
      </fieldset>

      <fieldset>
        <legend>件 B（销板 / 榫孔板）</legend>
        <NumField
          label="厚度 mm"
          testid="b-thickness"
          value={params.boardB.thickness}
          min={3}
          max={80}
          onChange={(v) => setB({ thickness: v })}
        />
        <NumField
          label="宽度 mm"
          testid="b-width"
          value={params.boardB.width}
          min={20}
          max={900}
          onChange={(v) => setB({ width: v })}
        />
      </fieldset>

      <fieldset>
        <legend>材料与配合</legend>
        <label className="field">
          <span className="field-label">木材种类</span>
          <select
            data-testid="wood"
            value={params.wood}
            onChange={(e) => set({ wood: e.target.value as Wood })}
          >
            <option value="hardwood">硬木</option>
            <option value="softwood">软木</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">配合松紧</span>
          <select
            data-testid="fit"
            value={params.fit}
            onChange={(e) => set({ fit: e.target.value as Fit })}
          >
            <option value="tight">紧（过盈，需敲入）</option>
            <option value="standard">标准</option>
            <option value="loose">松（留胶层）</option>
          </select>
        </label>
        <NumField
          label="锯路 kerf mm"
          testid="kerf"
          value={params.kerfMm}
          min={0.5}
          max={4}
          step={0.1}
          hint="常见 1.1 / 1.6 / 2.2"
          onChange={(v) => set({ kerfMm: v })}
        />
      </fieldset>

      {isDt && (
        <fieldset>
          <legend>燕尾参数</legend>
          <label className="field">
            <span className="field-label">角度比（1:r）</span>
            <select
              data-testid="angle"
              value={params.dovetail?.angleRatio ?? 8}
              onChange={(e) => setDt({ angleRatio: Number(e.target.value) as 6 | 7 | 8 })}
            >
              <option value={6}>1:6（硬木常用）</option>
              <option value={7}>1:7（折中）</option>
              <option value={8}>1:8（软木常用）</option>
            </select>
          </label>
          <NumField
            label="齿数（0=自动建议）"
            testid="teeth"
            value={params.dovetail?.teeth ?? 0}
            min={0}
            max={12}
            step={1}
            hint={`建议 ${suggested} 齿`}
            onChange={(v) => setDt({ teeth: v === 0 ? undefined : v })}
          />
        </fieldset>
      )}

      {kind === 'mortise-tenon' && (
        <fieldset>
          <legend>直榫参数</legend>
          <NumField
            label="榫厚/料厚 比"
            testid="tn-ratio"
            value={Math.round((params.tenon?.thicknessRatio ?? 1 / 3) * 100) / 100}
            min={0.2}
            max={0.5}
            step={0.01}
            hint="常用 1/3 ≈ 0.33"
            onChange={(v) => setTn({ thicknessRatio: v })}
          />
          <NumField
            label="榫长/孔板厚 比"
            testid="len-ratio"
            value={params.tenon?.lengthRatio ?? 1}
            min={0.4}
            max={1}
            step={0.05}
            hint="1 = 穿透"
            onChange={(v) => setTn({ lengthRatio: v })}
          />
          <NumField
            label="腹边距 mm（0=居中）"
            testid="tn-offset"
            value={params.tenon?.offsetFromFace ?? 0}
            min={0}
            max={60}
            onChange={(v) => setTn({ offsetFromFace: v })}
          />
        </fieldset>
      )}
    </div>
  )
}

export function KindPicker({ value, onChange }: { value: JointKind | null; onChange: (k: JointKind) => void }) {
  return (
    <div className="kind-picker" data-testid="kind-picker">
      {JOINT_KINDS.map((k) => (
        <button
          key={k.kind}
          type="button"
          data-testid={`kind-${k.kind}`}
          className={`kind-card ${value === k.kind ? 'active' : ''}`}
          onClick={() => onChange(k.kind)}
        >
          <strong>{k.label}</strong>
          <span>{k.desc}</span>
        </button>
      ))}
    </div>
  )
}
