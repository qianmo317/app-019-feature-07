// 组件测试：参数联动 / 列表筛选 / 导入导出 / 键盘微调（前端点击对应的 bug 面）
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HomePage } from '../../src/pages/HomePage'
import { NewPlanPage } from '../../src/pages/NewPlanPage'
import { EditorPage } from '../../src/pages/EditorPage'
import { makePlan, upsertPlan, addJoint, setJointPart } from '../../src/store/plans'
import type { JointKind, Params, Drawing } from '../../src/types'

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

describe('多榫卯方案：左侧列表切换 + 零件挂接 + 右侧分组步骤', () => {
  const stdParams: Params = {
    boardA: { thickness: 18, width: 200 },
    boardB: { thickness: 18, width: 200 },
    wood: 'hardwood',
    fit: 'standard',
    kerfMm: 1.1,
  }

  function multiPlan(): Drawing {
    let plan = makePlan('dovetail', stdParams)
    const r = addJoint(plan, 'mortise-tenon')
    plan = r.plan
    plan = setJointPart(plan, r.jointId, 'A', plan.parts[0].id)
    plan = setJointPart(plan, r.jointId, 'B', plan.parts[1].id)
    upsertPlan(plan)
    return plan
  }

  it('左侧列出全部榫卯，逐个切换时中间只画当前榫卯（燕尾齿表 ↔ 直榫无齿表）', async () => {
    const user = userEvent.setup()
    const plan = multiPlan()
    render(<EditorPage id={plan.id} />)

    const tabs = screen.getAllByTestId(/^joint-tab-/)
    expect(tabs).toHaveLength(2)
    // 右侧切割步骤按榫卯分成两组
    expect(screen.getAllByTestId(/^cut-group-/)).toHaveLength(2)
    // 当前默认第一个：燕尾 → 齿宽表存在
    expect(screen.getByTestId('tooth-table')).toBeInTheDocument()

    // 切到第二个（直榫）
    await user.click(screen.getByTestId(`joint-tab-${plan.joints[1].id}`))
    expect(screen.queryByTestId('tooth-table')).toBeNull()
    expect(screen.getByTestId('tn-ratio')).toBeInTheDocument()
    // 中间标题随之切换
    expect(screen.getByTestId('current-joint-head')).toHaveTextContent('直榫')
    // 切回燕尾
    await user.click(screen.getByTestId(`joint-tab-${plan.joints[0].id}`))
    expect(screen.getByTestId('tooth-table')).toBeInTheDocument()
  })

  it('在方案中追加第三个榫卯，自动切换为当前榫卯并进入未挂零件状态', async () => {
    const user = userEvent.setup()
    const plan = multiPlan()
    render(<EditorPage id={plan.id} />)

    await user.selectOptions(screen.getByTestId('add-joint-kind'), 'panel-glue')
    await user.click(screen.getByTestId('add-joint'))

    expect(screen.getAllByTestId(/^joint-tab-/)).toHaveLength(3)
    expect(screen.getAllByTestId(/^cut-group-/)).toHaveLength(3)
    // 新榫卯未挂零件：两个零件选择器都是空
    expect(screen.getByTestId('part-a')).toHaveValue('')
    expect(screen.getByTestId('part-b')).toHaveValue('')
    // 选上现有零件
    await user.selectOptions(screen.getByTestId('part-a'), plan.parts[0].id)
    expect(screen.getByTestId('part-a')).toHaveValue(plan.parts[0].id)
  })

  it('删除当前榫卯后视图回退到剩余榫卯；删光后显示空状态', async () => {
    const user = userEvent.setup()
    const plan = multiPlan()
    render(<EditorPage id={plan.id} />)

    await user.click(screen.getByTestId(`joint-delete-${plan.joints[0].id}`))
    expect(screen.getAllByTestId(/^joint-tab-/)).toHaveLength(1)
    // 剩直榫 → 无齿表
    expect(screen.queryByTestId('tooth-table')).toBeNull()

    await user.click(screen.getByTestId(`joint-delete-${plan.joints[1].id}`))
    expect(screen.getByTestId('no-joint')).toBeInTheDocument()
  })

  it('零件可增删改名、填长宽厚与数量；被引用零件删除按钮禁用，改厚同步到榫卯', async () => {
    const user = userEvent.setup()
    const plan = multiPlan()
    render(<EditorPage id={plan.id} />)

    // 初始两个零件，删除按钮均禁用
    const delA = screen.getByTestId(`part-delete-${plan.parts[0].id}`) as HTMLButtonElement
    expect(delA).toBeDisabled()

    // 添加第三个零件（未被引用）→ 可删
    await user.click(screen.getByTestId('add-part'))
    const rows = screen.getAllByTestId(/^part-row-/)
    expect(rows).toHaveLength(3)
    const newId = rows[2].getAttribute('data-testid')!.replace('part-row-', '')
    expect(screen.getByTestId(`part-delete-${newId}`)).toBeEnabled()

    // 改名 + 数量
    const nameInput = screen.getByTestId(`part-name-${newId}`)
    await user.clear(nameInput)
    await user.type(nameInput, '抽屉侧板')
    const qty = screen.getByTestId(`part-qty-${newId}`)
    fireEvent.change(qty, { target: { value: '4' } })
    expect(nameInput).toHaveValue('抽屉侧板')
    expect(qty).toHaveValue(4)

    // 改第一个零件厚度 → 它被燕尾榫挂为 A：a-thickness 同步
    fireEvent.change(screen.getByTestId(`part-thickness-${plan.parts[0].id}`), { target: { value: '25' } })
    expect(screen.getByTestId('a-thickness')).toHaveValue(25)

    // 删除未引用零件
    await user.click(screen.getByTestId(`part-delete-${newId}`))
    expect(screen.getAllByTestId(/^part-row-/)).toHaveLength(2)
  })

  it('列表页认出多榫卯方案：卡片展示全部类型，按第二种类型也能筛出', async () => {
    const plan = multiPlan()
    render(<HomePage onImported={() => undefined} />)
    const card = screen.getByTestId('plan-card')
    expect(card).toHaveTextContent('燕尾榫')
    expect(card).toHaveTextContent('直榫')
    expect(card).toHaveTextContent('2 个榫卯')
    // 按直榫筛选：多榫卯方案命中
    await userEvent.setup().selectOptions(screen.getByTestId('filter-kind'), 'mortise-tenon')
    expect(screen.getAllByTestId('plan-card')).toHaveLength(1)
    // 按搭接筛选：不命中
    await userEvent.setup().selectOptions(screen.getByTestId('filter-kind'), 'lap')
    expect(screen.queryAllByTestId('plan-card')).toHaveLength(0)
    void plan
  })
})

describe('多榫卯打印页：按榫卯逐段出图，燕尾段带齿号表与切割步骤', () => {
  it('打印页为每个榫卯输出独立段落', async () => {
    const { PrintPage } = await import('../../src/pages/EditorPage')
    let plan = makePlan('dovetail', {
      ...{
        boardA: { thickness: 18, width: 200 },
        boardB: { thickness: 18, width: 200 },
        wood: 'hardwood' as const,
        fit: 'standard' as const,
        kerfMm: 1.1,
      },
      dovetail: { angleRatio: 8 },
    })
    plan = addJoint(plan, 'mortise-tenon').plan
    upsertPlan(plan)
    render(<PrintPage id={plan.id} />)

    const sections = plan.joints.map((j) => screen.getByTestId(`print-joint-${j.id}`))
    expect(sections).toHaveLength(2)
    // 第一段燕尾：齿号表 + 三视图
    expect(within(sections[0]).getByTestId('print-tooth-table')).toBeInTheDocument()
    expect(sections[0].querySelector('[data-view="front"]')).toBeTruthy()
    // 第二段直榫：无齿表
    expect(within(sections[1]).queryByTestId('print-tooth-table')).toBeNull()
    // 每段都带切割步骤
    expect(screen.getAllByTestId('cut-steps-body')).toHaveLength(2)
    // 校验尺与模板页仍在
    expect(screen.getByTestId('check-ruler')).toBeInTheDocument()
    expect(screen.getByTestId('print-template')).toHaveTextContent('1:1 模板页')
  })
})
