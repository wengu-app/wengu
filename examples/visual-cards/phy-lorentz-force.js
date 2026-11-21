/**
 * 高中物理 · 3D 动态变体卡
 * 主题：左手定则——洛伦兹力三维方向判断（正 / 负电荷动态变体）
 */
import * as THREE from 'three';
import { createCardShell, pickVariant } from 'wengu/card';
import { createScene3D } from 'wengu/scene3d';

const STYLES = `
.phy-badge {
  position: absolute;
  left: 18px;
  top: 96px;
  z-index: 3;
}
`;

const SCENARIOS = [
  {
    key: 'neg-in',
    charge: -1,
    qLabel: '负电荷 (−q)',
    v: [1, 0, 0],
    vText: 'v 水平向右',
    b: [0, 0, -1],
    bText: 'B 垂直向里',
    cam: [0.35, 0.72, 5.1],
    focusCam: [0.65, 0.45, 4.75],
  },
  {
    key: 'pos-out',
    charge: 1,
    qLabel: '正电荷 (+q)',
    v: [1, 0, 0],
    vText: 'v 水平向右',
    b: [0, 0, 1],
    bText: 'B 垂直向外',
    cam: [0.35, 0.78, 5.1],
    focusCam: [0.6, 0.52, 4.75],
  },
  {
    key: 'pos-in',
    charge: 1,
    qLabel: '正电荷 (+q)',
    v: [1, 0, 0],
    vText: 'v 水平向右',
    b: [0, 0, -1],
    bText: 'B 垂直向里',
    cam: [0.35, 0.72, 5.1],
    focusCam: [0.65, 0.62, 4.75],
  },
  {
    key: 'neg-up',
    charge: -1,
    qLabel: '负电荷 (−q)',
    v: [1, 0, 0],
    vText: 'v 水平向右',
    b: [0, 1, 0],
    bText: 'B 竖直向上',
    cam: [1.5, 1.5, 4.55],
    focusCam: [1.35, 1.4, 4.4],
  },
];

function dirName(v) {
  if (Math.abs(v.y) > 0.7) return v.y > 0 ? '竖直向上 (↑)' : '竖直向下 (↓)';
  if (Math.abs(v.z) > 0.7) return v.z > 0 ? '垂直向外 (⊙)' : '垂直向里 (⊗)';
  return v.x > 0 ? '水平向右 (→)' : '水平向左 (←)';
}

function buildArrow(dirVec, length, color, opacity = 1, radius = 0.044) {
  const group = new THREE.Group();
  const shaftLen = Math.max(0.2, length - 0.26);
  const shaftGeo = new THREE.CylinderGeometry(radius, radius, shaftLen, 18);
  const headGeo = new THREE.ConeGeometry(radius * 2.45, 0.26, 22);
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.3,
    metalness: 0.05,
    transparent: opacity < 1,
    opacity,
  });
  const shaft = new THREE.Mesh(shaftGeo, mat);
  shaft.position.y = shaftLen / 2;
  const head = new THREE.Mesh(headGeo, mat);
  head.position.y = shaftLen + 0.13;
  group.add(shaft, head);

  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirVec.clone().normalize());
  group.quaternion.copy(quat);
  return { group, shaft, head, mat, geos: [shaftGeo, headGeo] };
}

export function mount(root, ctx) {
  if (!document.getElementById('wg-phy-lorentz-css')) {
    const s = document.createElement('style');
    s.id = 'wg-phy-lorentz-css';
    s.textContent = STYLES;
    document.head.append(s);
  }

  const wanted = typeof ctx.props.variant === 'string' ? SCENARIOS.find((s) => s.key === ctx.props.variant) : undefined;
  const scenario =
    wanted ??
    pickVariant(
      SCENARIOS,
      typeof ctx.props.variant === 'string' || typeof ctx.props.variant === 'number' ? ctx.props.variant : undefined,
    );

  const isPos = scenario.charge > 0;
  const vDir = new THREE.Vector3(...scenario.v).normalize();
  const bDir = new THREE.Vector3(...scenario.b).normalize();
  const fDir = new THREE.Vector3().crossVectors(vDir, bDir).multiplyScalar(scenario.charge).normalize();
  const wrongDir = fDir.clone().negate();

  const correctName = dirName(fDir);
  const wrongName = dirName(wrongDir);

  const shell = createCardShell(root, ctx, {
    height: 540,
    kicker: '高中物理 · 磁场',
    prompt: `${scenario.qLabel}：${scenario.vText}，${scenario.bText}，所受洛伦兹力朝哪？`,
    subtitle: '拖动观察三维磁场与矢量朝向 · 点击候选箭头或按 Space 核对',
    hint: '拖动旋转 · 点击箭头试答',
  });

  const s3d = createScene3D(shell.stage, ctx, {
    height: 540,
    cameraPosition: scenario.cam,
    target: [0.3, -0.04, 0],
    minDistance: 3.0,
    maxDistance: 8.0,
  });

  const disposables = [];
  const track = (x) => {
    disposables.push(x);
    return x;
  };

  // Crisp Wengu-blue translucent magnetic-field reference plane with neat border
  const planeGeo = track(new THREE.PlaneGeometry(3.8, 2.7));
  const planeMat = track(
    new THREE.MeshBasicMaterial({
      color: '#3d8bf0',
      transparent: true,
      opacity: 0.055,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  const plane = new THREE.Mesh(planeGeo, planeMat);
  plane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), bDir);
  s3d.scene.add(plane);

  const edgeGeo = track(new THREE.EdgesGeometry(planeGeo));
  const edgeMat = track(new THREE.LineBasicMaterial({ color: '#3d8bf0', transparent: true, opacity: 0.26 }));
  const planeBorder = new THREE.LineSegments(edgeGeo, edgeMat);
  planeBorder.quaternion.copy(plane.quaternion);
  s3d.scene.add(planeBorder);

  // Uniform B field grid (3 x 2 clean Wengu blue arrows)
  const bBasis1 = new THREE.Vector3().copy(vDir);
  const bBasis2 = new THREE.Vector3().crossVectors(bDir, bBasis1).normalize();
  const bColor = '#3d8bf0';
  for (const i of [-1.28, 0, 1.28]) {
    for (const j of [-0.92, 0.92]) {
      const arrow = buildArrow(bDir, 1.9, bColor, 0.56, 0.024);
      disposables.push(arrow.mat, ...arrow.geos);
      const pos = new THREE.Vector3()
        .addScaledVector(bBasis1, i)
        .addScaledVector(bBasis2, j)
        .addScaledVector(bDir, -0.95);
      arrow.group.position.copy(pos);
      s3d.scene.add(arrow.group);
    }
  }
  const bLabelPos = new THREE.Vector3()
    .addScaledVector(bBasis1, -1.35)
    .addScaledVector(bBasis2, 1.05)
    .addScaledVector(bDir, 0.72);
  s3d.addLabel(`磁场 B（${scenario.bText.replace(/^B\s*/, '')}）`, bLabelPos.toArray(), { muted: true });

  // Central charged particle (glossy ceramic Wengu colour)
  const qGeo = track(new THREE.SphereGeometry(0.25, 36, 24));
  const qMat = track(
    new THREE.MeshPhysicalMaterial({
      color: isPos ? '#f26a3d' : '#3d8bf0',
      roughness: 0.25,
      clearcoat: 0.45,
    }),
  );
  const particle = new THREE.Mesh(qGeo, qMat);
  s3d.scene.add(particle);
  const qLabel = s3d.addLabel(isPos ? '+q 正电荷' : '−q 负电荷', [0, 0.4, 0], {
    className: isPos ? 'highlighted' : 'tone-info',
  });

  // Velocity vector (Wengu good green)
  const vArrow = buildArrow(vDir, 1.48, '#1fae7a', 1, 0.046);
  disposables.push(vArrow.mat, ...vArrow.geos);
  s3d.scene.add(vArrow.group);
  s3d.addLabel(`v（${scenario.vText.replace(/^v\s*/, '')}）`, vDir.clone().multiplyScalar(1.66).toArray(), {
    className: 'tone-good',
  });

  // Two opposing candidate force arrows (clickable in 3D!)
  const candCorrect = buildArrow(fDir, 1.38, '#a6a095', 0.78, 0.048);
  const candWrong = buildArrow(wrongDir, 1.38, '#a6a095', 0.78, 0.048);
  disposables.push(candCorrect.mat, ...candCorrect.geos, candWrong.mat, ...candWrong.geos);
  candCorrect.head.userData.choice = 'correct';
  candCorrect.shaft.userData.choice = 'correct';
  candWrong.head.userData.choice = 'wrong';
  candWrong.shaft.userData.choice = 'wrong';
  s3d.scene.add(candCorrect.group, candWrong.group);

  // Smooth thick cyclotron deflection arc (TubeGeometry, visible on reveal)
  const R_ARC = 1.55;
  const arcPts = [];
  for (let i = 0; i <= 32; i++) {
    const theta = (i / 32) * (Math.PI * 0.42);
    const pt = new THREE.Vector3()
      .addScaledVector(vDir, R_ARC * Math.sin(theta))
      .addScaledVector(fDir, R_ARC * (1 - Math.cos(theta)));
    arcPts.push(pt);
  }
  const arcCurve = new THREE.CatmullRomCurve3(arcPts);
  const arcGeo = track(new THREE.TubeGeometry(arcCurve, 32, 0.018, 10, false));
  const arcMat = track(new THREE.MeshBasicMaterial({ color: '#ec4d5e', transparent: true, opacity: 0 }));
  const arcLine = new THREE.Mesh(arcGeo, arcMat);
  s3d.scene.add(arcLine);

  const tracerGeo = track(new THREE.SphereGeometry(0.09, 20, 16));
  const tracerMat = track(new THREE.MeshStandardMaterial({ color: '#f26a3d', roughness: 0.3, transparent: true, opacity: 0 }));
  const tracer = new THREE.Mesh(tracerGeo, tracerMat);
  s3d.scene.add(tracer);

  const labelF = s3d.addLabel(`洛伦兹力 F · ${correctName}`, fDir.clone().multiplyScalar(1.62).toArray(), {
    visible: false,
  });
  const labelRule = s3d.addLabel(
    isPos ? '正电荷：四指指向 v 方向' : '负电荷：四指指向 v 反方向！',
    fDir.clone().multiplyScalar(0.84).addScaledVector(vDir, -0.95).toArray(),
    { visible: false, muted: true },
  );

  // Tactile Wengu bottom quick buttons
  const choices = document.createElement('div');
  choices.className = 'wg-choice-row';
  let userPick = null;

  const choose = (choiceKey, text) => {
    if (ctx.phase === 'reveal') return;
    userPick = choiceKey;
    const ok = choiceKey === 'correct';
    ctx.submitResult({
      outcome: ok ? 'correct' : 'incorrect',
      detail: text,
      response: { scenario: scenario.key, picked: choiceKey },
    });
    ctx.requestReveal();
  };

  s3d.enablePicking(() => [candCorrect.head, candCorrect.shaft, candWrong.head, candWrong.shaft], {
    onClick: (hit) => {
      if (!hit || ctx.phase === 'reveal') return;
      const choice = hit.object.userData.choice;
      if (choice === 'correct') choose('correct', correctName);
      else if (choice === 'wrong') choose('wrong', wrongName);
    },
  });

  const btnEntries =
    scenario.charge < 0
      ? [
          ['wrong', `受力 ${wrongName}`],
          ['correct', `受力 ${correctName}`],
        ]
      : [
          ['correct', `受力 ${correctName}`],
          ['wrong', `受力 ${wrongName}`],
        ];
  for (const [key, text] of btnEntries) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wg-choice';
    btn.textContent = text;
    btn.addEventListener('click', () => choose(key, text), { signal: ctx.signal });
    choices.append(btn);
  }
  shell.root.append(choices);

  const badge = document.createElement('div');
  badge.className = 'wg-pill-legend phy-badge';
  badge.innerHTML =
    '<span><i style="background:#1fae7a"></i>速度 v</span>' +
    '<span><i style="background:#3d8bf0"></i>磁场 B</span>' +
    '<span><i style="background:#a6a095"></i>候选 F</span>';
  shell.root.append(badge);

  s3d.onFrame((_, elapsed) => {
    if (ctx.phase !== 'reveal') return;
    const t = (elapsed * 0.55) % 1;
    const theta = t * Math.PI * 0.42;
    tracer.position
      .set(0, 0, 0)
      .addScaledVector(vDir, R_ARC * Math.sin(theta))
      .addScaledVector(fDir, R_ARC * (1 - Math.cos(theta)));
  });

  const syncPhase = (phase) => {
    const revealed = phase === 'reveal';
    choices.hidden = revealed;
    candCorrect.mat.color.set(revealed ? '#ec4d5e' : '#a6a095');
    candCorrect.mat.opacity = revealed ? 1 : 0.74;
    candWrong.mat.opacity = revealed ? 0.14 : 0.74;
    arcLine.visible = revealed;
    tracer.visible = revealed;
    arcMat.opacity = revealed ? 0.9 : 0;
    tracerMat.opacity = revealed ? 1 : 0;

    labelF.setVisible(revealed);
    labelF.setHighlighted(revealed);
    labelRule.setVisible(revealed);
    qLabel.setVisible(true);

    if (revealed) {
      s3d.focusCamera(scenario.focusCam, [0.35, fDir.y * 0.25, 0], 240);
      const ok = userPick === null ? null : userPick === 'correct';
      shell.showFeedback({
        title:
          ok === false
            ? `方向有误 · 正确方向为 ${correctName}`
            : `洛伦兹力 F 方向：${correctName}`,
        body: isPos
          ? '左手定则：B 穿入手心，四指指向正电荷运动方向 v，拇指指向即 F。'
          : '易错提醒：粒子带负电 (−q) 时，四指必须指向 v 的反方向，粒子沿红色圆弧向下/向内偏转！',
        tone: ok === false ? 'danger' : 'success',
      });
    } else {
      userPick = null;
      shell.hideFeedback();
    }
    s3d.requestRender();
  };

  syncPhase(ctx.phase);
  const unsubPhase = ctx.onPhaseChange(syncPhase);

  return () => {
    unsubPhase();
    for (const d of disposables) d.dispose();
  };
}
