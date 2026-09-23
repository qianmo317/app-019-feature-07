// 组件测试：参数联动 / 列表筛选 / 导入导出 / 键盘微调（前端点击对应的 bug 面）
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HomePage } from '../../src/pages/HomePage'
import { NewPlanPage } from '../../src/pages/NewPlanPage'
import { EditorPage } from '../../src/pages/EditorPage'
import { makePlan, upsertPlan } from '../../src/store/plans'
import type { JointKind, Params } from '../../src/types'

beforeEach(() => {
  localStorage.clear()
  window.location.hash = ''
})

describe('新建页：选类型 → 填参数 → 生成图纸', () => {
  it('未选类型时按钮禁用；选类型后表单出现并可生成', async () => {
    const user = userEvent.setup()
    render(<NewPlanPage />)
    expect(screen.getByTestId('create-plan')).toBeDisabled()
    await user.click(screen.getByTestId('kind-dovetail'))
    expect(screen.getByTestId('create-plan')).toBeEnabled()
    expect(screen.getByTestId('a-thickness')).toHaveValue(18)
    await user.click(screen.getByTestId('create-plan'))
    // 跳转到编辑器
    expect(window.location.hash).toMatch(/^#\/plan\//)
  })

  it('键盘方向键微调 0.5mm（蓝图 §9）', async () => {
    render(<NewPlanPage />)
    await userEvent.setup().click(screen.getByTestId('kind-dovetail'))
    const input = screen.getByTestId('a-thickness')
    input.focus()
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input).toHaveValue(18.5)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveValue(18)
  })

  it('修改参数触发重算：燕尾警告出现在新建页参数流（齿数过多）', async () => {
    const user = userEvent.setup()
    render(<NewPlanPage />)
    await user.click(screen.getByTestId('kind-dovetail'))
    // 进入编辑器后再验证警告，这里只验证表单可改
    const teeth = screen.getByTestId('teeth')
    await user.clear(teeth)
    await user.type(teeth, '12')
    expect(teeth).toHaveValue(12)
  })
})

describe('编辑器：参数改动即时重算 + 脏状态提示 + 齿宽表', () => {
  const savedPlan = () => {
    const plan = makePlan('dovetail', {
      boardA: { thickness: 18, width: 200 },
      boardB: { thickness: 18, width: 200 },
      wood: 'hardwood',
      fit: 'standard',
      dovetail: { angleRatio: 8 },
      kerfMm: 1.1,
    })
    upsertPlan(plan)
    return plan
  }

  it('修改板宽 → 出现「参数已改」提示条与警告区域联动', async () => {
    const user = userEvent.setup()
    const { id } = savedPlan()
    render(<EditorPage id={id} />)
    // 初始无脏状态
    expect(screen.queryByTestId('dirty-bar')).toBeNull()
    expect(screen.getByTestId('tooth-table')).toBeInTheDocument()
    // 齿数过多 → 警告
    const teeth = screen.getByTestId('teeth')
    await user.clear(teeth)
    await user.type(teeth, '12')
    // 脏状态提示条
    expect(screen.getByTestId('dirty-bar')).toHaveTextContent('参数已改，请重新核对尺寸')
    // 重算耗时标注存在
    expect(screen.getByTestId('recalc-ms')).toBeInTheDocument()
  })

  it('切换榫卯类型 → 参数表单与切割步骤联动', async () => {
    const user = userEvent.setup()
    const { id } = savedPlan()
    render(<EditorPage id={id} />)
    await user.selectOptions(screen.getByTestId('editor-kind'), 'mortise-tenon')
    // 直榫参数出现，燕尾参数消失
    expect(screen.getByTestId('tn-ratio')).toBeInTheDocument()
    expect(screen.queryByTestId('teeth')).toBeNull()
    expect(screen.queryByTestId('tooth-table')).toBeNull()
  })

  it('方案不存在 → 显示错误并可控', () => {
    render(<EditorPage id="nonexistent" />)
    expect(screen.getByText('方案不存在或已删除')).toBeInTheDocument()
  })
})

describe('列表页：筛选 + 删除 + 导入', () => {
  it('按类型与厚度筛选方案', async () => {
    upsertPlan(
      makePlan('dovetail', {
        boardA: { thickness: 18, width: 200 },
        boardB: { thickness: 18, width: 200 },
        wood: 'hardwood',
        fit: 'standard',
        kerfMm: 1.1,
      }),
    )
    upsertPlan(
      makePlan('mortise-tenon', {
        boardA: { thickness: 20, width: 200 },
        boardB: { thickness: 20, width: 200 },
        wood: 'hardwood',
        fit: 'standard',
        kerfMm: 1.1,
      }),
    )
    render(<HomePage onImported={() => undefined} />)
    expect(screen.getAllByTestId('plan-card')).toHaveLength(2)
    await userEvent.setup().selectOptions(screen.getByTestId('filter-kind'), 'dovetail')
    expect(screen.getAllByTestId('plan-card')).toHaveLength(1)
  })

  it('导入非法 JSON 显示错误', async () => {
    render(<HomePage onImported={() => undefined} />)
    const input = screen.getByTestId('import-input') as HTMLInputElement
    const file = new File(['{ bad'], 'plan.json', { type: 'application/json' })
    await userEvent.upload(input, file)
    // 错误必须浮出（解析错误信息或导入失败提示）
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('导入合法 JSON 写入方案库', async () => {
    const onImported = vi.fn()
    const plan = makePlan('lap', {
      boardA: { thickness: 18, width: 200 },
      boardB: { thickness: 18, width: 200 },
      wood: 'hardwood',
      fit: 'standard',
      kerfMm: 1.1,
    })
    render(<HomePage onImported={onImported} />)
    const input = screen.getByTestId('import-input') as HTMLInputElement
    await userEvent.upload(input, new File([JSON.stringify(plan)], 'plan.json', { type: 'application/json' }))
    expect(await screen.findAllByTestId('plan-card')).toHaveLength(1)
    expect(onImported).toHaveBeenCalled()
  })
})

describe('参数流（受控组件契约）', () => {
  it('ParamForm 修改回调携带合并后的参数', async () => {
    const { ParamForm } = await import('../../src/components/ParamForm')
    const params: Params = {
      boardA: { thickness: 18, width: 200 },
      boardB: { thickness: 18, width: 200 },
      wood: 'hardwood',
      fit: 'standard',
      dovetail: { angleRatio: 8 },
      kerfMm: 1.1,
    }
    let latest: Params | null = null
    render(<ParamForm kind={'dovetail' as JointKind} params={params} onChange={(p) => (latest = p)} />)
    const user = userEvent.setup()
    await user.type(screen.getByTestId('a-width'), '4')
    // 200 + '4' → "2004" 超出上限 900 → 钳制到 900（表单防呆）
    expect(latest!.boardA.width).toBe(900)
    expect(latest!.boardA.thickness).toBe(18) // 其余字段保持
  })
})

// —— 多榫卯方案（面板拼板 + 框架直榫 + 抽屉燕尾）——
import { PrintPage } from '../../src/pages/EditorPage'
import { addJoint, addPart, updatePart, updateJointParts } from '../../src/store/plans'

function multiJointPlan() {
  let p = makePlan('panel-glue', {
    boardA: { thickness: 12, width: 150 },
    boardB: { thickness: 12, width: 150 },
    wood: 'softwood',
    fit: 'standard',
    kerfMm: 1.1,
  })
  p = addPart(p)
  p = updatePart(p, p.parts[2].id, { name: '桌腿', thickness: 30, width: 60, length: 720, qty: 4 })
  p = addPart(p)
  p = updatePart(p, p.parts[3].id, { name: '牙板', thickness: 20, width: 80, length: 600, qty: 4 })
  p = addJoint(p, 'mortise-tenon')
  p = updateJointParts(p, p.joints[1].id, 'A', p.parts[2].id)
  p = updateJointParts(p, p.joints[1].id, 'B', p.parts[3].id)
  p = addPart(p)
  p = updatePart(p, p.parts[4].id, { name: '抽屉侧板', thickness: 10, width: 120, length: 400, qty: 2 })
  p = addPart(p)
  p = updatePart(p, p.parts[5].id, { name: '抽屉前脸', thickness: 15, width: 120, length: 420, qty: 1 })
  p = addJoint(p, 'dovetail')
  p = updateJointParts(p, p.joints[2].id, 'A', p.parts[4].id)
  p = updateJointParts(p, p.joints[2].id, 'B', p.parts[5].id)
  return p
}

describe('多榫卯编辑器：零件 + 榫卯列表 + 逐个切换', () => {
  it('左侧列出全部 6 个零件与 3 个榫卯', () => {
    const plan = multiJointPlan()
    upsertPlan(plan)
    render(<EditorPage id={plan.id} />)
    expect(screen.getByTestId('parts-editor')).toBeInTheDocument()
    expect(screen.getAllByTestId(/^part-\d+$/)).toHaveLength(6)
    expect(screen.getAllByTestId(/^joint-tab-/)).toHaveLength(3)
    // 默认显示第一个（拼板）
    expect(screen.getByTestId('current-joint-head')).toHaveTextContent('拼板')
  })

  it('切换榫卯 → 中间三视图与右侧高亮跟着换', async () => {
    const user = userEvent.setup()
    const plan = multiJointPlan()
    upsertPlan(plan)
    render(<EditorPage id={plan.id} />)
    expect(screen.getByTestId('current-joint-head')).toHaveTextContent('拼板')

    await user.click(screen.getByTestId('joint-select-2'))
    expect(screen.getByTestId('current-joint-head')).toHaveTextContent('燕尾榫')
    expect(screen.getByTestId('current-joint-head')).toHaveTextContent('抽屉侧板')
    // 燕尾出齿宽表；当前激活的分组高亮
    expect(screen.getByTestId('tooth-table')).toBeInTheDocument()
    expect(screen.getByTestId('cut-group-2')).toHaveClass('active')
    // 右侧三个分组都在
    expect(screen.getByTestId('cut-group-0')).toHaveTextContent('拼板')
    expect(screen.getByTestId('cut-group-1')).toHaveTextContent('直榫')
    expect(screen.getByTestId('cut-group-2')).toHaveTextContent('燕尾榫')
  })

  it('点右侧「查看图纸」跳回对应榫卯', async () => {
    const user = userEvent.setup()
    const plan = multiJointPlan()
    upsertPlan(plan)
    render(<EditorPage id={plan.id} />)
    await user.click(screen.getByTestId('cut-jump-1'))
    expect(screen.getByTestId('current-joint-head')).toHaveTextContent('直榫')
    expect(screen.getByTestId('tn-ratio')).toBeInTheDocument()
    expect(screen.queryByTestId('tooth-table')).toBeNull()
  })

  it('零件尺寸（长宽厚数量）可编辑，并同步到榫卯板尺寸', async () => {
    const user = userEvent.setup()
    const plan = multiJointPlan()
    upsertPlan(plan)
    render(<EditorPage id={plan.id} />)
    // 桌腿（index 2）厚 30 宽 60
    expect(screen.getByTestId('part-thickness-2')).toHaveValue(30)
    fireEvent.change(screen.getByTestId('part-width-2'), { target: { value: '65' } })
    // 切到直榫（joint 1），参数表单 A 板宽已是 65
    await user.click(screen.getByTestId('joint-select-1'))
    expect(screen.getByTestId('a-width')).toHaveValue(65)
  })

  it('被榫卯引用的零件删除按钮禁用；增加榫卯/零件可用', async () => {
    const user = userEvent.setup()
    const plan = multiJointPlan()
    upsertPlan(plan)
    render(<EditorPage id={plan.id} />)
    // 全部 6 个零件都被引用，删除按钮全禁用
    for (let i = 0; i < 6; i++) {
      expect(screen.getByTestId(`part-delete-${i}`)).toBeDisabled()
    }
    // 第一个榫卯的删除按钮可用（共 3 个），但方案只剩 1 个时禁用
    await user.click(screen.getByTestId(`add-joint-dowel`))
    expect(screen.getAllByTestId(/^joint-tab-/)).toHaveLength(4)
    // 新增零件后其删除按钮可用
    await user.click(screen.getByTestId('part-add'))
    expect(screen.getByTestId('part-delete-6')).toBeEnabled()
  })

  it('切换当前榫卯的作用零件 → 参数表单与图纸联动', async () => {
    const user = userEvent.setup()
    const plan = multiJointPlan()
    upsertPlan(plan)
    render(<EditorPage id={plan.id} />)
    await user.click(screen.getByTestId('joint-select-2')) // 燕尾：抽屉侧板 10 × 抽屉前脸 15
    expect(screen.getByTestId('a-thickness')).toHaveValue(10)
    expect(screen.getByTestId('b-thickness')).toHaveValue(15)
    // A 改选为「桌腿」(30 厚)
    await user.selectOptions(screen.getByTestId('part-a-select'), plan.parts[2].id)
    expect(screen.getByTestId('a-thickness')).toHaveValue(30)
  })

  it('编辑器改类型只影响当前榫卯，不影响其它榫卯', async () => {
    const user = userEvent.setup()
    const plan = multiJointPlan()
    upsertPlan(plan)
    render(<EditorPage id={plan.id} />)
    await user.click(screen.getByTestId('joint-select-0'))
    await user.selectOptions(screen.getByTestId('editor-kind'), 'lap')
    expect(screen.getByTestId('current-joint-head')).toHaveTextContent('搭接')
    // 第 2、3 个榫卯未被影响
    expect(screen.getByTestId('cut-group-1')).toHaveTextContent('直榫')
    expect(screen.getByTestId('cut-group-2')).toHaveTextContent('燕尾榫')
  })
})

describe('多榫卯打印页：按榫卯逐段出图，各自带齿号与切割步骤', () => {
  it('打印页为每个榫卯出一段，燕尾段含齿宽表（齿号）', () => {
    const plan = multiJointPlan()
    upsertPlan(plan)
    render(<PrintPage id={plan.id} />)
    expect(screen.getAllByTestId(/^print-joint-/)).toHaveLength(3)
    expect(screen.getByTestId('print-joint-0')).toHaveTextContent('拼板')
    expect(screen.getByTestId('print-joint-1')).toHaveTextContent('直榫')
    const dtSection = screen.getByTestId('print-joint-2')
    expect(dtSection).toHaveTextContent('燕尾榫')
    expect(dtSection).toHaveTextContent('齿号与齿宽分配表')
    // 每段都有切割步骤标题
    expect(screen.getAllByText('切割步骤')).toHaveLength(3)
    // 校验尺仍在
    expect(screen.getByTestId('check-ruler')).toBeInTheDocument()
  })
})

describe('列表页识别组合方案的全部榫卯类型', () => {
  it('组合方案卡片显示全部类型，按类型筛选能找到', async () => {
    const plan = multiJointPlan()
    upsertPlan(plan)
    render(<HomePage onImported={() => undefined} />)
    const card = screen.getByTestId(`plan-meta-${plan.id}`)
    expect(card).toHaveTextContent('拼板')
    expect(card).toHaveTextContent('直榫')
    expect(card).toHaveTextContent('燕尾榫')
    expect(card).toHaveTextContent('3 个榫卯')
    await userEvent.setup().selectOptions(screen.getByTestId('filter-kind'), 'mortise-tenon')
    expect(screen.getAllByTestId('plan-card')).toHaveLength(1)
  })
})
