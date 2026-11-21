/**
 * 高中生物 · 2D SVG 过程断点卡
 * 主题：神经冲动传导——动作电位变化曲线与离子通道断点
 */
import { createCardShell, createStepController } from 'wengu/card';

const STYLES = `
.bio-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 96px 24px 92px;
  box-sizing: border-box;
}
.bio-svg {
  width: 100%;
  height: 100%;
  max-height: 348px;
  display: block;
}
.bio-choices {
  flex-wrap: nowrap;
  gap: 10px;
}
.bio-choices .wg-choice {
  font-size: 13px;
  padding: 8px 14px;
}
.bio-steps-host {
  position: absolute;
  right: 40px;
  top: 112px;
  z-index: 6;
}
.bio-steps-host[hidden] {
  display: none;
}
`;

const STEPS = [
  {
    key: 'resting',
    label: '断点：阈刺激刚触发时',
    feedbackTitle: '思考断点',
    feedbackBody: '膜外 Na⁺ 远高于膜内；刺激后哪种离子顺浓度梯度打开通道引发去极化？',
  },
  {
    key: 'depolarize',
    label: '去极化：Na⁺ 大量内流（协助扩散）',
    feedbackTitle: '动作电位产生：Na⁺ 通道开放，Na⁺ 大量内流（协助扩散）',
    feedbackBody: '膜电位从 −70 mV 迅速反转升至 +30 mV（外正内负 → 外负内正）。',
  },
  {
    key: 'repolarize',
    label: '复极化：K⁺ 外流恢复静息电位',
    feedbackTitle: '恢复静息：K⁺ 通道开放，K⁺ 大量外流（协助扩散）',
    feedbackBody: 'Na⁺ 通道关闭、K⁺ 顺浓度梯度外流，膜电位回落至 −70 mV（外正内负）。',
  },
];

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}, text) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

export function mount(root, ctx) {
  if (!document.getElementById('wg-bio-ap-css')) {
    const s = document.createElement('style');
    s.id = 'wg-bio-ap-css';
    s.textContent = STYLES;
    document.head.append(s);
  }

  const shell = createCardShell(root, ctx, {
    height: 540,
    kicker: '高中生物 · 神经调节',
    prompt: '过程断点：受有效刺激后曲线骤升至 +30 mV，此时什么离子如何跨膜？',
    subtitle: '上方为膜电位变化曲线 · 下方为细胞膜磷脂双分子层与离子通道',
  });

  const wrap = document.createElement('div');
  wrap.className = 'bio-wrap';
  shell.stage.append(wrap);

  const svg = svgEl('svg', { class: 'bio-svg', viewBox: '0 0 700 356', role: 'img' });
  wrap.append(svg);

  const gPanel = svgEl('g');
  const gGrid = svgEl('g');
  const gCurve = svgEl('g');
  const gMembrane = svgEl('g');
  const gDynamic = svgEl('g');
  svg.append(gPanel, gGrid, gCurve, gMembrane, gDynamic);

  // Soft warm sunken panels (Wengu card-in-card textbook feel)
  gPanel.append(
    svgEl('rect', {
      x: 16,
      y: 6,
      width: 668,
      height: 170,
      rx: 16,
      fill: 'var(--wg-color-background)',
      stroke: 'var(--wg-color-border)',
      'stroke-width': 2,
    }),
    svgEl('rect', {
      x: 16,
      y: 188,
      width: 668,
      height: 160,
      rx: 16,
      fill: 'var(--wg-color-background)',
      stroke: 'var(--wg-color-border)',
      'stroke-width': 2,
    }),
  );

  // Graph axes & reference lines
  gGrid.append(
    svgEl('line', { x1: 86, y1: 24, x2: 86, y2: 148, stroke: 'var(--wg-color-border)', 'stroke-width': 2, 'stroke-linecap': 'round' }),
    svgEl('line', { x1: 86, y1: 148, x2: 656, y2: 148, stroke: 'var(--wg-color-border)', 'stroke-width': 2, 'stroke-linecap': 'round' }),
    svgEl('line', { x1: 86, y1: 42, x2: 656, y2: 42, stroke: 'var(--wg-color-border)', 'stroke-width': 1.2, 'stroke-dasharray': '5 5' }),
    svgEl('line', { x1: 86, y1: 96, x2: 656, y2: 96, stroke: 'var(--wg-color-border)', 'stroke-width': 1.2, 'stroke-dasharray': '3 5' }),
    svgEl('line', { x1: 86, y1: 128, x2: 656, y2: 128, stroke: 'var(--wg-color-border)', 'stroke-width': 1.2, 'stroke-dasharray': '5 5' }),
  );

  const axisLabel = (x, y, text, anchor = 'end') =>
    svgEl(
      'text',
      {
        x,
        y,
        'text-anchor': anchor,
        fill: 'var(--wg-color-text-muted)',
        'font-size': 11.5,
        'font-family': 'var(--wg-font-sans)',
        'font-weight': 700,
      },
      text,
    );

  gGrid.append(
    axisLabel(76, 46, '+30 mV'),
    axisLabel(76, 100, '0 mV'),
    axisLabel(76, 132, '−70 mV'),
    axisLabel(234, 165, '受刺激断点', 'middle'),
    axisLabel(650, 165, '时间 →', 'end'),
  );

  // Resting curve up to stimulus threshold (always visible)
  gCurve.append(
    svgEl('path', {
      d: 'M 94 128 L 210 128 Q 226 128 236 116',
      fill: 'none',
      stroke: '#f26a3d',
      'stroke-width': 4,
      'stroke-linecap': 'round',
    }),
    svgEl('circle', { cx: 236, cy: 116, r: 9, fill: '#f26a3d', opacity: 0.18 }),
    svgEl('circle', { cx: 236, cy: 116, r: 5, fill: '#f26a3d' }),
  );

  // Question-phase mystery dashed curve
  const mysteryCurve = svgEl('g');
  mysteryCurve.append(
    svgEl('path', {
      d: 'M 236 116 C 262 74 282 42 310 42 C 344 42 366 130 406 134 L 584 128',
      fill: 'none',
      stroke: 'var(--wg-color-text-muted)',
      'stroke-width': 2.8,
      'stroke-dasharray': '6 6',
      opacity: 0.55,
    }),
    svgEl('rect', {
      x: 288,
      y: 26,
      width: 44,
      height: 28,
      rx: 9,
      fill: 'var(--wg-color-surface)',
      stroke: '#f26a3d',
      'stroke-width': 2.2,
    }),
    svgEl(
      'text',
      {
        x: 310,
        y: 45,
        'text-anchor': 'middle',
        fill: '#f26a3d',
        'font-size': 16,
        'font-weight': 800,
      },
      '?',
    ),
  );
  gCurve.append(mysteryCurve);

  // Depolarization rising phase
  const risingCurve = svgEl('path', {
    d: 'M 236 116 C 262 76 282 42 310 42',
    fill: 'none',
    stroke: '#f26a3d',
    'stroke-width': 4.5,
    'stroke-linecap': 'round',
  });
  // Repolarization falling phase
  const fallingCurve = svgEl('path', {
    d: 'M 310 42 C 344 42 366 130 406 134 Q 442 136 474 128 L 592 128',
    fill: 'none',
    stroke: '#1fae7a',
    'stroke-width': 4.5,
    'stroke-linecap': 'round',
  });
  const peakBadge = svgEl('g');
  peakBadge.append(
    svgEl('circle', { cx: 310, cy: 42, r: 9, fill: '#f26a3d', opacity: 0.18 }),
    svgEl('circle', { cx: 310, cy: 42, r: 5.5, fill: '#f26a3d' }),
    svgEl('rect', {
      x: 324,
      y: 25,
      width: 126,
      height: 24,
      rx: 8,
      fill: '#f26a3d',
    }),
    svgEl(
      'text',
      {
        x: 387,
        y: 41,
        'text-anchor': 'middle',
        fill: '#ffffff',
        'font-size': 11.5,
        'font-weight': 700,
      },
      '去极化波峰 +30 mV',
    ),
  );
  gCurve.append(risingCurve, fallingCurve, peakBadge);

  // Phospholipid bilayer renderer (authentic hydrophilic heads + hydrophobic tails)
  const drawBilayerSegment = (xStart, xEnd) => {
    const seg = svgEl('g');
    const step = 16;
    const topY = 248;
    const botY = 286;
    // Soft warm backing band
    seg.append(
      svgEl('rect', {
        x: xStart - 4,
        y: topY,
        width: xEnd - xStart + 8,
        height: botY - topY,
        rx: 6,
        fill: '#f1a62a',
        opacity: 0.14,
      }),
    );
    for (let x = xStart + 6; x <= xEnd - 6; x += step) {
      // Hydrophobic tails
      seg.append(
        svgEl('line', { x1: x - 2, y1: topY + 5, x2: x - 2, y2: topY + 17, stroke: '#d99a38', 'stroke-width': 1.4, opacity: 0.65 }),
        svgEl('line', { x1: x + 2, y1: topY + 5, x2: x + 2, y2: topY + 17, stroke: '#d99a38', 'stroke-width': 1.4, opacity: 0.65 }),
        svgEl('line', { x1: x - 2, y1: botY - 5, x2: x - 2, y2: botY - 17, stroke: '#d99a38', 'stroke-width': 1.4, opacity: 0.65 }),
        svgEl('line', { x1: x + 2, y1: botY - 5, x2: x + 2, y2: botY - 17, stroke: '#d99a38', 'stroke-width': 1.4, opacity: 0.65 }),
        // Hydrophilic heads
        svgEl('circle', { cx: x, cy: topY, r: 5.5, fill: '#f1a62a', stroke: '#d38a1b', 'stroke-width': 1.2 }),
        svgEl('circle', { cx: x, cy: botY, r: 5.5, fill: '#f1a62a', stroke: '#d38a1b', 'stroke-width': 1.2 }),
      );
    }
    return seg;
  };

  gMembrane.append(
    svgEl(
      'text',
      { x: 34, y: 214, fill: 'var(--wg-color-text-muted)', 'font-size': 12, 'font-weight': 700 },
      '膜外（细胞外液：高 Na⁺）',
    ),
    svgEl(
      'text',
      { x: 34, y: 334, fill: 'var(--wg-color-text-muted)', 'font-size': 12, 'font-weight': 700 },
      '膜内（细胞质基质：高 K⁺）',
    ),
    drawBilayerSegment(44, 198),
    drawBilayerSegment(290, 412),
    drawBilayerSegment(504, 656),
  );

  // Tactile rounded protein channel helper
  const buildChannel = (cx, color, darkColor, labelText) => {
    const group = svgEl('g');
    const leftWall = svgEl('rect', {
      x: cx - 35,
      y: 238,
      width: 24,
      height: 58,
      rx: 10,
      fill: color,
      stroke: darkColor,
      'stroke-width': 2,
    });
    const rightWall = svgEl('rect', {
      x: cx + 11,
      y: 238,
      width: 24,
      height: 58,
      rx: 10,
      fill: color,
      stroke: darkColor,
      'stroke-width': 2,
    });
    const gate = svgEl('rect', {
      x: cx - 12,
      y: 255,
      width: 24,
      height: 24,
      rx: 7,
      fill: 'var(--wg-color-surface)',
      stroke: color,
      'stroke-width': 2.2,
    });
    const gateQ = svgEl(
      'text',
      { x: cx, y: 271, 'text-anchor': 'middle', fill: color, 'font-size': 11.5, 'font-weight': 800 },
      labelText,
    );
    group.append(leftWall, rightWall, gate, gateQ);
    return { group, leftWall, rightWall, gate, gateQ };
  };

  const naChannel = buildChannel(244, '#f26a3d', '#c74c24', 'Na⁺');
  const kChannel = buildChannel(458, '#1fae7a', '#158259', 'K⁺');
  gMembrane.append(naChannel.group, kChannel.group);

  // Charge badge strips (middle bilayer region x = 304..398)
  const buildChargeRow = (y) => {
    const g = svgEl('g');
    const items = [];
    for (let i = 0; i < 5; i++) {
      const cx = 308 + i * 21;
      const bg = svgEl('circle', { cx, cy: y, r: 8, fill: 'var(--wg-color-surface)', stroke: 'var(--wg-color-border)', 'stroke-width': 1.5 });
      const txt = svgEl('text', { x: cx, y: y + 4, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 800 }, '+');
      g.append(bg, txt);
      items.push({ bg, txt });
    }
    return { g, items };
  };
  const outerCharges = buildChargeRow(226);
  const innerCharges = buildChargeRow(310);

  const channelPromptBox = svgEl('g');
  channelPromptBox.append(
    svgEl('rect', {
      x: 205,
      y: 236,
      width: 78,
      height: 62,
      rx: 13,
      fill: 'var(--wg-color-surface)',
      stroke: '#f26a3d',
      'stroke-width': 2.4,
      'stroke-dasharray': '5 4',
    }),
    svgEl(
      'text',
      { x: 244, y: 274, 'text-anchor': 'middle', fill: '#f26a3d', 'font-size': 20, 'font-weight': 800 },
      '?',
    ),
  );

  // Ion inflow arrow (Na+ down into cell)
  const naFlow = svgEl('g');
  naFlow.append(
    svgEl('line', { x1: 244, y1: 202, x2: 244, y2: 318, stroke: '#f26a3d', 'stroke-width': 4.5, 'stroke-linecap': 'round' }),
    svgEl('polygon', { points: '244,330 234,313 254,313', fill: '#f26a3d' }),
    svgEl('circle', { cx: 244, cy: 214, r: 12, fill: '#f26a3d' }),
    svgEl('text', { x: 244, y: 218, 'text-anchor': 'middle', fill: '#fff', 'font-size': 10, 'font-weight': 800 }, 'Na⁺'),
    svgEl('rect', { x: 276, y: 199, width: 92, height: 22, rx: 7, fill: '#f26a3d' }),
    svgEl('text', { x: 322, y: 214, 'text-anchor': 'middle', fill: '#fff', 'font-size': 11, 'font-weight': 700 }, 'Na⁺ 大量内流'),
  );

  // Ion outflow arrow (K+ out of cell)
  const kFlow = svgEl('g');
  kFlow.append(
    svgEl('line', { x1: 458, y1: 322, x2: 458, y2: 212, stroke: '#1fae7a', 'stroke-width': 4.5, 'stroke-linecap': 'round' }),
    svgEl('polygon', { points: '458,200 448,217 468,217', fill: '#1fae7a' }),
    svgEl('circle', { cx: 458, cy: 306, r: 12, fill: '#1fae7a' }),
    svgEl('text', { x: 458, y: 310, 'text-anchor': 'middle', fill: '#fff', 'font-size': 10, 'font-weight': 800 }, 'K⁺'),
    svgEl('rect', { x: 492, y: 199, width: 96, height: 22, rx: 7, fill: '#1fae7a' }),
    svgEl('text', { x: 540, y: 214, 'text-anchor': 'middle', fill: '#fff', 'font-size': 11, 'font-weight': 700 }, 'K⁺ 外流复极化'),
  );

  gDynamic.append(outerCharges.g, innerCharges.g, channelPromptBox, naFlow, kFlow);

  // Step controller
  const stepsHost = document.createElement('div');
  stepsHost.className = 'bio-steps-host';
  shell.root.append(stepsHost);

  let userPick = null;

  const setOpenState = (ch, open, cx) => {
    ch.leftWall.setAttribute('x', String(open ? cx - 39 : cx - 35));
    ch.rightWall.setAttribute('x', String(open ? cx + 15 : cx + 11));
    ch.gate.style.display = open ? 'none' : 'block';
    ch.gateQ.style.display = open ? 'none' : 'block';
  };

  const paintRow = (row, sign, color) => {
    for (const item of row.items) {
      item.txt.textContent = sign;
      item.txt.setAttribute('fill', color);
      item.bg.setAttribute('stroke', color);
    }
  };

  const renderStep = (step, idx) => {
    const isQ = idx === 0;
    const isDepol = idx === 1;
    const isRepol = idx === 2;

    mysteryCurve.style.display = isQ ? 'block' : 'none';
    channelPromptBox.style.display = isQ ? 'block' : 'none';
    risingCurve.style.display = isDepol || isRepol ? 'block' : 'none';
    peakBadge.style.display = isDepol || isRepol ? 'block' : 'none';
    fallingCurve.style.display = isRepol ? 'block' : 'none';

    setOpenState(naChannel, isDepol, 244);
    setOpenState(kChannel, isRepol, 458);
    naFlow.style.display = isDepol ? 'block' : 'none';
    kFlow.style.display = isRepol ? 'block' : 'none';

    if (isDepol) {
      paintRow(outerCharges, '−', '#3d8bf0');
      paintRow(innerCharges, '+', '#f26a3d');
    } else {
      paintRow(outerCharges, '+', '#f26a3d');
      paintRow(innerCharges, '−', '#3d8bf0');
    }

    if (ctx.phase === 'reveal') {
      const ok = userPick === null ? null : userPick === 'na-in';
      shell.showFeedback({
        title: idx === 1 && ok === false ? '试答提示：动作电位上升支来自 Na⁺ 内流' : step.feedbackTitle,
        body: step.feedbackBody,
        tone: idx === 1 && ok === false ? 'danger' : 'success',
      });
    } else {
      shell.hideFeedback();
    }
  };

  const steps = createStepController(ctx, {
    steps: STEPS,
    questionStep: 0,
    revealStep: 1,
    onChange: renderStep,
  });
  steps.mountControls(stepsHost);

  // Tactile Wengu question trial buttons
  const choices = document.createElement('div');
  choices.className = 'wg-choice-row bio-choices';
  const addChoice = (key, text) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wg-choice';
    btn.textContent = text;
    btn.addEventListener(
      'click',
      () => {
        if (ctx.phase === 'reveal') return;
        userPick = key;
        const ok = key === 'na-in';
        ctx.submitResult({
          outcome: ok ? 'correct' : 'incorrect',
          detail: text,
          response: { picked: key },
        });
        ctx.requestReveal();
      },
      { signal: ctx.signal },
    );
    choices.append(btn);
  };
  addChoice('na-in', 'Na⁺ 内流（协助扩散）');
  addChoice('k-out', 'K⁺ 外流（协助扩散）');
  addChoice('na-out', 'Na⁺ 主动外排');
  shell.root.append(choices);

  const syncPhase = (phase) => {
    const revealed = phase === 'reveal';
    choices.hidden = revealed;
    stepsHost.hidden = !revealed;
    if (!revealed) userPick = null;
    renderStep(STEPS[steps.getIndex()], steps.getIndex());
  };

  syncPhase(ctx.phase);
  const unsubPhase = ctx.onPhaseChange(syncPhase);

  return () => {
    unsubPhase();
  };
}
