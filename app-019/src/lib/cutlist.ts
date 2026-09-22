// 切割清单：按榫卯类型生成锯切步骤顺序与注意事项（先锯哪条线）
import type { Joint } from '../types'
import type { DovetailResult } from './dovetail'
import type { TenonResult } from './tenon'
import { fmtDrawing } from './format'

export interface CutStep {
  no: number
  action: string
  detail: string
}

export interface CutList {
  boardA: CutStep[]
  boardB: CutStep[]
  cautions: string[]
}

export function buildCutList(joint: Joint, dt?: DovetailResult, tn?: TenonResult): CutList {
  const kerf = joint.params.kerfMm
  const { kind } = joint
  const cautions: string[] = [
    `锯路宽度 ${kerf}mm：图纸同时标注理论线（细线）与锯切线（粗线），按锯切线下锯，锯片外侧贴理论线`,
    '先在废料上试锯校准深度与角度，再上工件',
  ]

  if (kind === 'dovetail' || kind === 'half-blind-dovetail') {
    const steps: CutStep[] = dt
      ? [
          { no: 1, action: '画基准', detail: '选好大面/基准边，用划线器画出齿深线（展示面与背面）' },
          { no: 2, action: '画齿顶线', detail: '按齿宽表在展示面画出各齿左右两条线（齿号见图纸）' },
          { no: 3, action: '画齿根线', detail: '背面按齿根坐标画线，用 1:' + (joint.params.dovetail?.angleRatio ?? 8) + ' 斜度规连成斜线' },
          {
            no: 4,
            action: '锯齿侧线',
            detail: `先锯废料一侧：锯切线 = 理论线外偏 kerf/2（${fmtDrawing(kerf / 2)}mm），锯片贴线不留量`,
          },
          { no: 5, action: '锯半齿边距线', detail: '最后锯两端半齿竖线，防止端头劈裂' },
          { no: 6, action: '去除废料', detail: kind === 'half-blind-dovetail' ? '线锯/钢丝锯沿深度线去料，底部留 0.5mm 凿修' : '钢丝锯或凿子剔去齿间废料，中部再凿平至深度线' },
          { no: 7, action: '修配', detail: '试插：紧→细刨齿根斜面，松→检查锯路是否跑线' },
        ]
      : []
    return { boardA: steps, boardB: pinBoardSteps(), cautions }
  }

  if (kind === 'mortise-tenon' && tn) {
    return {
      boardA: [
        { no: 1, action: '画基准', detail: '以大面/基准边划出榫肩位置线（四面过线）' },
        { no: 2, action: '画榫头线', detail: `榫厚 ${fmtDrawing(tn.tenonThickness)}mm、榫宽 ${fmtDrawing(tn.tenonWidth)}mm，腹板面偏移 ${fmtDrawing(tn.offsetFromFace)}mm` },
        { no: 3, action: '锯榫侧', detail: '先锯两侧面，锯片贴废料侧；再锯榫肩，肩面留线刨修' },
        { no: 4, action: '试配', detail: '榫头对角倒棱 1mm 便于入孔' },
      ],
      boardB: [
        { no: 1, action: '画榫眼线', detail: `眼宽 = 榫厚 ${fmtDrawing(tn.tenonThickness)}mm，深 ${fmtDrawing(tn.mortiseDepth)}mm` },
        { no: 2, action: '凿/钻榫眼', detail: `两端留线，中间镂空；锯切线内收 ${fmtDrawing(tn.mortiseSawOffset)}mm 补偿锯路` },
        { no: 3, action: '清底', detail: '眼底铲平，四角方正' },
      ],
      cautions,
    }
  }

  if (kind === 'lap') {
    return {
      boardA: [
        { no: 1, action: '画线', detail: '半搭深度线 = 料厚/2（含配合让刀，见参数）' },
        { no: 2, action: '锯肩', detail: '先锯深度肩线，深度尺校准' },
        { no: 3, action: '剔槽', detail: '锯多条松料后凿平槽底，深度误差 ≤0.2mm' },
      ],
      boardB: [
        { no: 1, action: '重复对板', detail: '另一块板同样半搭，两板切深之和 = 料厚 ± 配合让刀' },
      ],
      cautions: [...cautions, '半搭槽底必须与基准面平行，否则装后有缝'],
    }
  }

  if (kind === 'dowel') {
    return {
      boardA: [
        { no: 1, action: '画孔位', detail: '按图纸孔位线（含端部边距）过线' },
        { no: 2, action: '打孔', detail: '孔深打够并加深 1mm 排胶；用限位环控制深度' },
        { no: 3, action: '装定位销', detail: '孔内插定位销对位，试拼' },
      ],
      boardB: [{ no: 1, action: '对位打孔', detail: '两板夹紧对齐后透过已有孔打另一板，保证同心' }],
      cautions: [...cautions, '木榫要蘸胶满涂孔壁，敲入后擦净余胶'],
    }
  }

  // panel-glue
  return {
    boardA: [
      { no: 1, action: '刨平拼缝', detail: '拼缝刨平直，接缝对光不透' },
      { no: 2, action: '画饼干榫位', detail: '按图纸位置线，端部边距见参数' },
      { no: 3, action: '切槽', detail: '饼干榫机切槽，深度按参数，槽内除尘' },
    ],
    boardB: [{ no: 1, action: '同法切槽', detail: '两板槽位必须对齐，建议夹具定位后划线' }],
    cautions: [...cautions, '拼板交替翻转纹理（ yearly growth 反向）减少翘曲'],
  }
}

function pinBoardSteps(): CutStep[] {
  return [
    { no: 1, action: '过线', detail: '把齿板端面抵住销板端部，用划线针把齿形过到销板端面与两面' },
    { no: 2, action: '画销板深度线', detail: '划线器画销板全厚度深度线' },
    { no: 3, action: '锯销侧线', detail: '先锯废料侧，锯片贴线；半齿处留线修配' },
    { no: 4, action: '剔废料', detail: '凿子自中线向两侧剔，保护销侧线' },
    { no: 5, action: '试装', detail: '先干装：过紧修销侧，过松检查锯路后重划线' },
  ]
}
