/**
 * 计算机科学 · 图形学透视投影（视锥体 Frustum → NDC 标准立方体）
 * 核心 3D 优势：把梯形透视视锥体、两个等大立方体和等距深度切片实时变形压进 [-1,1]³ NDC 立方体，
 * 亲眼看到“近大远小”的几何本质与 1/z 非线性深度挤压（远处 Z-fighting 根源）。
 */
import * as THREE from 'three';
import { createCardShell } from 'wengu/card';
import { createScene3D } from 'wengu/scene3d';

const STYLES = `
.mvp-ctrl-bar {
  position: absolute;
  top: 12px;
  right: 14px;
  z-index: 6;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mvp-ctrl-bar[hidden] {
  display: none;
}
.mvp-ctrl-btn {
  appearance: none;
  border: 0;
  cursor: pointer;
  padding: 6px 11px;
  border-radius: 10px;
  font: 700 12px/1.2 var(--wg-font-sans);
  color: var(--wg-color-text);
  background: color-mix(in srgb, var(--wg-color-surface) 94%, transparent);
  box-shadow:
    inset 0 0 0 1.5px var(--wg-color-border),
    0 2px 0 color-mix(in srgb, var(--wg-color-border) 88%, var(--wg-color-text));
  transition: transform 120ms ease, background 120ms ease, color 120ms ease;
}
.mvp-ctrl-btn:hover {
  transform: translateY(-1px);
}
.mvp-ctrl-btn.active {
  background: var(--wg-color-accent);
  color: var(--wg-color-on-accent);
  box-shadow:
    inset 0 0 0 1.5px var(--wg-color-accent),
    0 2px 0 color-mix(in srgb, var(--wg-color-accent) 72%, #000);
}
`;

const NEAR = 1.2;
const FAR = 5.2;
const TAN_HALF_FOV = 0.36;
const NDC_SCALE = 1.35;

/**
 * Maps a point in View Space (depth d in [NEAR, FAR], vertical y, lateral z)
 * smoothly to NDC [-1, 1]^3 (scaled by NDC_SCALE for display) at interpolation t in [0, 1].
 */
function projectPoint(d, y, z, t) {
  const vx = d - (NEAR + FAR) * 0.5;
  const vy = y;
  const vz = z;

  const half = d * TAN_HALF_FOV;
  const ndcX = (FAR + NEAR) / (FAR - NEAR) - (2 * FAR * NEAR) / ((FAR - NEAR) * d);
  const ndcY = y / half;
  const ndcZ = z / half;

  const tx = ndcX * NDC_SCALE;
  const ty = ndcY * NDC_SCALE;
  const tz = ndcZ * NDC_SCALE;

  return [
    vx + (tx - vx) * t,
    vy + (ty - vy) * t,
    vz + (tz - vz) * t,
  ];
}

export function mount(root, ctx) {
  if (!document.getElementById('wg-cs-mvp-css')) {
    const s = document.createElement('style');
    s.id = 'wg-cs-mvp-css';
    s.textContent = STYLES;
    document.head.append(s);
  }

  const shell = createCardShell(root, ctx, {
    height: 540,
    kicker: '计算机科学 · 图形学透视投影（MVP → NDC）',
    prompt: '视锥体内有两个等大立方体和等距深度切片，经透视投影映射到 NDC 立方体后会发生什么？',
    subtitle: '拖动旋转确认 View Space 中两方块完全等大 · 按 Space 观看实时空间压缩变形',
    hint: '拖动旋转 · 滚轮缩放',
  });

  const s3d = createScene3D(shell.stage, ctx, {
    cameraPosition: [0.35, 2.25, 6.2],
    target: [0.1, 0, 0],
    minDistance: 3.4,
    maxDistance: 12.0,
  });

  const disposables = [];
  const track = (x) => {
    disposables.push(x);
    return x;
  };

  const light = new THREE.DirectionalLight(0xffffff, 2.1);
  light.position.set(4, 7, 5);
  s3d.scene.add(light);
  s3d.scene.add(new THREE.HemisphereLight(0xeef6ff, 0x3b4858, 0.95));

  // Camera eye indicator (fades in NDC mode)
  const eyeGroup = new THREE.Group();
  const eyeX = -(NEAR + FAR) * 0.5;
  const eyeSphere = new THREE.Mesh(
    track(new THREE.SphereGeometry(0.11, 16, 14)),
    track(new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.4 })),
  );
  eyeSphere.position.set(eyeX, 0, 0);
  eyeGroup.add(eyeSphere);
  s3d.scene.add(eyeGroup);

  // Build morphable line collections: 6 depth slice rectangles + 4 frustum corner edges
  const SLICE_COUNT = 6;
  const sliceDepths = [];
  for (let i = 0; i < SLICE_COUNT; i++) {
    sliceDepths.push(NEAR + ((FAR - NEAR) * i) / (SLICE_COUNT - 1));
  }

  const sliceLines = sliceDepths.map((d, idx) => {
    const isEnd = idx === 0 || idx === SLICE_COUNT - 1;
    const color = idx === 0 ? 0x3d8bf0 : idx === SLICE_COUNT - 1 ? 0xef4444 : 0x94a3b8;
    const pts = Array.from({ length: 5 }, () => new THREE.Vector3());
    const geo = track(new THREE.BufferGeometry().setFromPoints(pts));
    const line = new THREE.Line(
      geo,
      track(new THREE.LineBasicMaterial({ color, transparent: !isEnd, opacity: isEnd ? 0.95 : 0.45 })),
    );
    s3d.scene.add(line);
    return { d, geo };
  });

  const cornerSigns = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const cornerEdges = cornerSigns.map(([sy, sz]) => {
    const pts = [new THREE.Vector3(), new THREE.Vector3()];
    const geo = track(new THREE.BufferGeometry().setFromPoints(pts));
    const line = new THREE.Line(
      geo,
      track(new THREE.LineBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.72 })),
    );
    s3d.scene.add(line);
    return { sy, sz, geo };
  });

  // Two world-space IDENTICAL cubes (size = 0.50): near orange, far cyan
  const makeMorphCube = (centerD, centerY, centerZ, color) => {
    const geo = track(new THREE.BoxGeometry(0.5, 0.5, 0.5, 4, 4, 4));
    const pos = geo.attributes.position;
    const base = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      base[i * 3] = centerD + pos.getX(i);
      base[i * 3 + 1] = centerY + pos.getY(i);
      base[i * 3 + 2] = centerZ + pos.getZ(i);
    }
    const mesh = new THREE.Mesh(
      geo,
      track(new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.08 })),
    );
    s3d.scene.add(mesh);
    return { geo, base, mesh, centerD, centerY, centerZ };
  };

  const nearCube = makeMorphCube(1.85, 0.14, 0.12, 0xf26a3d);
  const farCube = makeMorphCube(4.35, -0.18, -0.16, 0x06b6d4);

  // Labels
  const labelNear = s3d.addLabel('Near 平面 (z = -1)', projectPoint(NEAR, NEAR * TAN_HALF_FOV + 0.3, 0, 0), {
    className: 'tone-info',
  });
  const labelFar = s3d.addLabel('Far 平面 (z = +1)', projectPoint(FAR, FAR * TAN_HALF_FOV + 0.25, 0, 0), {
    className: 'highlighted',
  });
  const labelNearCube = s3d.addLabel('近处方块（同尺寸）', projectPoint(1.85, 0.56, 0.12, 0));
  const labelFarCube = s3d.addLabel('远处方块（同尺寸）', projectPoint(4.35, -0.68, -0.16, 0));

  const applyMorph = (t) => {
    eyeGroup.visible = t < 0.7;

    for (const s of sliceLines) {
      const half = s.d * TAN_HALF_FOV;
      const p = s.geo.attributes.position;
      const corners = [
        [-half, -half],
        [half, -half],
        [half, half],
        [-half, half],
        [-half, -half],
      ];
      for (let i = 0; i < 5; i++) {
        const [x, y, z] = projectPoint(s.d, corners[i][0], corners[i][1], t);
        p.setXYZ(i, x, y, z);
      }
      p.needsUpdate = true;
    }

    for (const e of cornerEdges) {
      const p = e.geo.attributes.position;
      const h0 = NEAR * TAN_HALF_FOV;
      const h1 = FAR * TAN_HALF_FOV;
      const [x0, y0, z0] = projectPoint(NEAR, e.sy * h0, e.sz * h0, t);
      const [x1, y1, z1] = projectPoint(FAR, e.sy * h1, e.sz * h1, t);
      p.setXYZ(0, x0, y0, z0);
      p.setXYZ(1, x1, y1, z1);
      p.needsUpdate = true;
    }

    for (const cube of [nearCube, farCube]) {
      const pos = cube.geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const [x, y, z] = projectPoint(
          cube.base[i * 3],
          cube.base[i * 3 + 1],
          cube.base[i * 3 + 2],
          t,
        );
        pos.setXYZ(i, x, y, z);
      }
      pos.needsUpdate = true;
      cube.geo.computeVertexNormals();
    }

    const pNear = projectPoint(NEAR, NEAR * TAN_HALF_FOV, 0, t);
    const pFar = projectPoint(FAR, FAR * TAN_HALF_FOV, 0, t);
    labelNear.setPosition([pNear[0], pNear[1] + 0.32, 0]);
    labelFar.setPosition([pFar[0], pFar[1] + 0.32, 0]);

    const pNC = projectPoint(nearCube.centerD, nearCube.centerY + 0.35, nearCube.centerZ, t);
    const pFC = projectPoint(farCube.centerD, farCube.centerY - 0.38, farCube.centerZ, t);
    labelNearCube.setPosition([pNC[0], pNC[1] + 0.28, pNC[2]]);
    labelFarCube.setPosition([pFC[0], pFC[1] - 0.25, pFC[2]]);
    labelNearCube.setText(t > 0.5 ? '近处方块（NDC 变大）' : '近处方块（同尺寸）');
    labelFarCube.setText(t > 0.5 ? '远处方块（被压扁挤向 Far）' : '远处方块（同尺寸）');
  };

  let morphT = 0;
  let targetT = 0;
  applyMorph(0);

  // Reveal-only morph toggle controls
  const ctrlBar = document.createElement('div');
  ctrlBar.className = 'mvp-ctrl-bar';
  ctrlBar.hidden = true;
  const makeCtrl = (label, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mvp-ctrl-btn';
    b.textContent = label;
    b.addEventListener('click', onClick, { signal: ctx.signal });
    return b;
  };
  const btnNdc = makeCtrl('NDC 立方体 (t = 1)', () => {
    targetT = 1;
    setActive(btnNdc);
  });
  const btnView = makeCtrl('View 视锥体 (t = 0)', () => {
    targetT = 0;
    setActive(btnView);
  });
  const setActive = (a) => {
    for (const b of [btnNdc, btnView]) b.classList.toggle('active', b === a);
  };
  ctrlBar.append(btnNdc, btnView);
  shell.stage.append(ctrlBar);

  // Question choices
  const choices = document.createElement('div');
  choices.className = 'wg-choice-row';
  let userPick = null;
  const CORRECT = 'near-big-far-squashed';
  const makeChoice = (key, label) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wg-choice';
    btn.textContent = label;
    btn.addEventListener(
      'click',
      () => {
        if (ctx.phase === 'reveal') return;
        userPick = key;
        const ok = key === CORRECT;
        ctx.submitResult({
          outcome: ok ? 'correct' : 'incorrect',
          detail: ok ? '正确理解了透视除法与非线性深度压缩' : `选择了：${label}`,
          response: { picked: key, expected: CORRECT },
        });
        ctx.requestReveal();
      },
      { signal: ctx.signal },
    );
    return btn;
  };
  choices.append(
    makeChoice('near-big-far-squashed', '近大远小，且深度切片向 Far 端挤压'),
    makeChoice('uniform', '近大远小，但深度切片仍均匀分布'),
    makeChoice('same-size', '两方块保持等大，深度向 Near 端挤压'),
  );
  shell.footer.append(choices);

  const unsubFrame = s3d.onFrame((dt) => {
    if (Math.abs(targetT - morphT) > 0.001) {
      const step = Math.min(1, dt * 3.2);
      morphT += (targetT - morphT) * step;
      if (Math.abs(targetT - morphT) <= 0.002) morphT = targetT;
      applyMorph(morphT);
      s3d.requestRender();
    }
  });

  const syncPhase = (phase) => {
    const revealed = phase === 'reveal';
    choices.hidden = revealed;
    ctrlBar.hidden = !revealed;

    if (revealed) {
      targetT = 1;
      setActive(btnNdc);
      s3d.focusCamera([0.2, 2.05, 5.8], [0, 0, 0], 500);
      const ok = userPick === null ? null : userPick === CORRECT;
      shell.showFeedback({
        title: '近大远小 + 非线性 1/z 深度挤压（远处易 Z-fighting）',
        body: '透视除法（除以深度 z）把大远平面压成标准 [-1,1]²，使远处物体缩小、近处放大；同时深度映射含 1/z 项，原本等距的切片全部挤向 z=+1 远平面，这就是远处 Z-buffer 精度极低的原因。',
        tone: ok === false ? 'danger' : 'success',
      });
    } else {
      userPick = null;
      targetT = 0;
      morphT = 0;
      applyMorph(0);
      shell.hideFeedback();
    }
    s3d.requestRender();
  };

  syncPhase(ctx.phase);
  const unsubPhase = ctx.onPhaseChange(syncPhase);

  return () => {
    unsubFrame();
    unsubPhase();
    for (const d of disposables) d.dispose();
  };
}
