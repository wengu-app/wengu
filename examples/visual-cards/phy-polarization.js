/**
 * 物理 · 3D 偏振光与三片偏振片悖论（马吕斯定律）
 * 核心 3D 优势：横波振动面存在于垂直光轴的 3D 空间中；从 3D 斜视一键切换到“沿光轴正视”，
 * 0° → 45° → 90° 三次矢量投影的角度与振幅衰减一目了然。
 */
import * as THREE from 'three';
import { createCardShell, pickVariant } from 'wengu/card';
import { createScene3D } from 'wengu/scene3d';

const STYLES = `
.phy-ctrl-bar {
  position: absolute;
  top: 12px;
  right: 14px;
  z-index: 6;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.phy-ctrl-bar[hidden] {
  display: none;
}
.phy-ctrl-btn {
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
.phy-ctrl-btn:hover {
  transform: translateY(-1px);
}
.phy-ctrl-btn.active {
  background: var(--wg-color-accent);
  color: var(--wg-color-on-accent);
  box-shadow:
    inset 0 0 0 1.5px var(--wg-color-accent),
    0 2px 0 color-mix(in srgb, var(--wg-color-accent) 72%, #000);
}
`;

/** Builds a circular polarizer disc at x with slit lines aligned to `angleRad` (0 = vertical Y, PI/2 = horizontal Z). */
function createPolarizer(angleRad, accentColor, track) {
  const group = new THREE.Group();

  // Outer ring frame
  const ring = new THREE.Mesh(
    track(new THREE.TorusGeometry(1.06, 0.055, 16, 48)),
    track(new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.45, roughness: 0.35 })),
  );
  ring.rotation.y = Math.PI / 2;
  group.add(ring);

  // Translucent glass disc
  const disc = new THREE.Mesh(
    track(new THREE.CylinderGeometry(1.02, 1.02, 0.03, 40)),
    track(
      new THREE.MeshPhysicalMaterial({
        color: accentColor,
        transparent: true,
        opacity: 0.18,
        roughness: 0.15,
        metalness: 0.05,
        depthWrite: false,
      }),
    ),
  );
  disc.rotation.z = Math.PI / 2;
  group.add(disc);

  // Slit bars parallel to transmission axis
  const slitGroup = new THREE.Group();
  const slitMat = track(
    new THREE.MeshBasicMaterial({
      color: accentColor,
      transparent: true,
      opacity: 0.55,
    }),
  );
  for (let i = -4; i <= 4; i++) {
    const offset = i * 0.2;
    const halfLen = Math.sqrt(Math.max(0, 0.98 * 0.98 - offset * offset));
    if (halfLen < 0.15) continue;
    const bar = new THREE.Mesh(track(new THREE.BoxGeometry(0.036, halfLen * 2, 0.018)), slitMat);
    bar.position.z = offset;
    slitGroup.add(bar);
  }
  // Rotate around X axis so angle=0 is vertical (+Y), angle=PI/2 is horizontal (+Z)
  slitGroup.rotation.x = angleRad;
  group.add(slitGroup);

  return group;
}

/** Dynamic 3D linearly polarized transverse wave segment along X in [x0, x1]. */
function createWaveSegment(x0, x1, angleRad, amp, color, count, track) {
  const group = new THREE.Group();
  const dy = Math.cos(angleRad);
  const dz = Math.sin(angleRad);

  // Envelope curve
  const curvePts = [];
  const curveSamples = 56;
  for (let i = 0; i <= curveSamples; i++) {
    const x = x0 + ((x1 - x0) * i) / curveSamples;
    curvePts.push(new THREE.Vector3(x, 0, 0));
  }
  const curveGeo = track(new THREE.BufferGeometry().setFromPoints(curvePts));
  const curveLine = new THREE.Line(
    curveGeo,
    track(new THREE.LineBasicMaterial({ color, linewidth: 2 })),
  );
  group.add(curveLine);

  // Fence of 3D vector arrows perpendicular to X
  const arrowMat = track(new THREE.MeshBasicMaterial({ color }));
  const shaftGeo = track(new THREE.CylinderGeometry(0.016, 0.016, 1, 8));
  const tipGeo = track(new THREE.ConeGeometry(0.042, 0.11, 10));
  const arrows = [];
  for (let i = 0; i < count; i++) {
    const x = x0 + ((x1 - x0) * (i + 0.5)) / count;
    const shaft = new THREE.Mesh(shaftGeo, arrowMat);
    const tip = new THREE.Mesh(tipGeo, arrowMat);
    const holder = new THREE.Group();
    holder.position.x = x;
    holder.rotation.x = angleRad;
    holder.add(shaft, tip);
    group.add(holder);
    arrows.push({ x, shaft, tip, holder });
  }

  // Subtle translucent plane guide showing polarization plane orientation
  const planeMesh = new THREE.Mesh(
    track(new THREE.PlaneGeometry(x1 - x0, amp * 2.15)),
    track(
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.09,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    ),
  );
  planeMesh.position.x = (x0 + x1) * 0.5;
  planeMesh.rotation.x = angleRad;
  group.add(planeMesh);

  const k = 3.2;
  const update = (phase) => {
    const pos = curveGeo.attributes.position;
    for (let i = 0; i <= curveSamples; i++) {
      const x = x0 + ((x1 - x0) * i) / curveSamples;
      const v = Math.sin(k * x - phase) * amp;
      pos.setXYZ(i, x, v * dy, v * dz);
    }
    pos.needsUpdate = true;

    for (const a of arrows) {
      const v = Math.sin(k * a.x - phase) * amp;
      const absV = Math.abs(v);
      const visible = absV > 0.04;
      a.shaft.visible = visible;
      a.tip.visible = visible;
      if (!visible) continue;
      const sign = v >= 0 ? 1 : -1;
      const shaftLen = Math.max(0.01, absV - 0.09);
      a.shaft.scale.set(1, shaftLen, 1);
      a.shaft.position.y = sign * shaftLen * 0.5;
      a.tip.position.y = sign * (shaftLen + 0.045);
      a.tip.rotation.z = sign >= 0 ? 0 : Math.PI;
    }
  };

  update(0);
  return { group, update };
}

/** Unpolarized light segment before the first polarizer: rotating multi-plane vectors. */
function createUnpolarizedSegment(x0, x1, track) {
  const group = new THREE.Group();
  const colors = [0x3d8bf0, 0xf26a3d, 0x2eb872, 0xa855f7];
  const count = 14;
  const shaftGeo = track(new THREE.CylinderGeometry(0.014, 0.014, 1, 8));
  const items = [];
  for (let i = 0; i < count; i++) {
    const x = x0 + ((x1 - x0) * (i + 0.5)) / count;
    const angle = (i * 1.15) % Math.PI;
    const mat = track(new THREE.MeshBasicMaterial({ color: colors[i % colors.length], transparent: true, opacity: 0.72 }));
    const bar = new THREE.Mesh(shaftGeo, mat);
    bar.position.x = x;
    bar.rotation.x = angle;
    group.add(bar);
    items.push({ x, bar, offset: i * 0.65 });
  }
  const update = (phase) => {
    for (const it of items) {
      const len = 0.35 + 0.65 * Math.abs(Math.sin(2.9 * it.x - phase + it.offset));
      it.bar.scale.set(1, len * 1.5, 1);
    }
  };
  update(0);
  return { group, update };
}

export function mount(root, ctx) {
  if (!document.getElementById('wg-phy-pol-css')) {
    const s = document.createElement('style');
    s.id = 'wg-phy-pol-css';
    s.textContent = STYLES;
    document.head.append(s);
  }

  const rawVariant = ctx.props.variant;
  const variantKey =
    rawVariant === 'three' || rawVariant === 'two'
      ? rawVariant
      : pickVariant(['three', 'two'], typeof rawVariant === 'string' || typeof rawVariant === 'number' ? rawVariant : undefined);
  const hasMiddle = variantKey === 'three';

  const shell = createCardShell(root, ctx, {
    height: 540,
    kicker: '高中物理 · 光的偏振与马吕斯定律',
    prompt: hasMiddle
      ? '0° 与 90° 偏振片正交，若在中间插入 45° 偏振片，最终光屏上能透出光吗？'
      : '自然光依次穿过 0° 竖直与 90° 水平两片正交偏振片，最终光屏上有光吗？',
    subtitle: '揭晓后可切换到“沿光轴正视”直观查看三维振动矢量投影',
    hint: '拖动旋转 · 滚轮缩放',
  });

  const CAM_OBLIQUE = [0.45, 2.05, 5.75];
  const CAM_AXIAL = [6.3, 0.14, 0.02];

  const s3d = createScene3D(shell.stage, ctx, {
    cameraPosition: CAM_OBLIQUE,
    target: [0.25, 0, 0],
    minDistance: 3.0,
    maxDistance: 11.0,
  });

  const disposables = [];
  const track = (x) => {
    disposables.push(x);
    return x;
  };

  const light = new THREE.DirectionalLight(0xffffff, 2.0);
  light.position.set(3, 6, 5);
  s3d.scene.add(light);
  s3d.scene.add(new THREE.HemisphereLight(0xeef6ff, 0x3b4858, 0.9));

  // Central optical propagation axis
  const axisMesh = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.015, 0.015, 7.6, 10)),
    track(new THREE.MeshBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.45 })),
  );
  axisMesh.rotation.z = Math.PI / 2;
  axisMesh.position.x = 0.0;
  s3d.scene.add(axisMesh);

  // Polarizer positions along X
  const X1 = -1.7;
  const X2 = 0.15;
  const X3 = 2.0;
  const X_SCREEN = 3.55;

  const p1 = createPolarizer(0, 0x3d8bf0, track);
  p1.position.x = X1;
  s3d.scene.add(p1);

  let p2 = null;
  if (hasMiddle) {
    p2 = createPolarizer(Math.PI / 4, 0xf26a3d, track);
    p2.position.x = X2;
    s3d.scene.add(p2);
  }

  const p3 = createPolarizer(Math.PI / 2, 0x2eb872, track);
  p3.position.x = X3;
  s3d.scene.add(p3);

  // Detection screen at far right
  const screenMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.65,
      emissive: 0x000000,
      emissiveIntensity: 0,
    }),
  );
  const screen = new THREE.Mesh(track(new THREE.BoxGeometry(0.08, 2.2, 2.2)), screenMat);
  screen.position.x = X_SCREEN;
  s3d.scene.add(screen);

  const spotMat = track(
    new THREE.MeshBasicMaterial({
      color: 0x34d399,
      transparent: true,
      opacity: 0,
    }),
  );
  const spot = new THREE.Mesh(track(new THREE.CircleGeometry(0.42, 32)), spotMat);
  spot.rotation.y = -Math.PI / 2;
  spot.position.x = X_SCREEN - 0.048;
  s3d.scene.add(spot);

  // Wave segments
  const seg0 = createUnpolarizedSegment(-3.55, X1 - 0.08, track);
  s3d.scene.add(seg0.group);

  const seg1End = hasMiddle ? X2 - 0.08 : X3 - 0.08;
  const seg1 = createWaveSegment(X1 + 0.08, seg1End, 0, 0.88, 0x3d8bf0, hasMiddle ? 12 : 22, track);
  s3d.scene.add(seg1.group);

  // Reveal-only segments
  const revealWaveGroup = new THREE.Group();
  revealWaveGroup.visible = false;
  s3d.scene.add(revealWaveGroup);

  let seg2 = null;
  let seg3 = null;
  if (hasMiddle) {
    seg2 = createWaveSegment(X2 + 0.08, X3 - 0.08, Math.PI / 4, 0.88 * Math.SQRT1_2, 0xf26a3d, 12, track);
    seg3 = createWaveSegment(X3 + 0.08, X_SCREEN - 0.1, Math.PI / 2, 0.88 * 0.5, 0x2eb872, 10, track);
    revealWaveGroup.add(seg2.group, seg3.group);
  }

  // Labels
  s3d.addLabel('P₁ 竖直 0°', [X1, 1.32, 0], { className: 'tone-info' });
  if (hasMiddle) {
    s3d.addLabel('P₂ 斜向 45°', [X2, 1.32, 0], { className: 'highlighted' });
  }
  s3d.addLabel('P₃ 水平 90°', [X3, 1.32, 0], { className: 'tone-good' });

  const labelOut = s3d.addLabel(
    hasMiddle ? '透射光强 I = I₀ / 8（有光！）' : '完全消光 I = 0',
    [X_SCREEN, 1.32, 0],
    { visible: false, className: hasMiddle ? 'tone-good' : 'highlighted' },
  );

  // Camera view shortcut buttons (reveal phase)
  const ctrlBar = document.createElement('div');
  ctrlBar.className = 'phy-ctrl-bar';
  ctrlBar.hidden = true;
  const makeCtrl = (label, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'phy-ctrl-btn';
    b.textContent = label;
    b.addEventListener('click', onClick, { signal: ctx.signal });
    return b;
  };
  const btnOblique = makeCtrl('3D 斜视', () => {
    s3d.focusCamera(CAM_OBLIQUE, [0.25, 0, 0], 450);
    setActive(btnOblique);
  });
  const btnAxial = makeCtrl('沿光轴正视（看投影）', () => {
    s3d.focusCamera(CAM_AXIAL, [0.2, 0, 0], 520);
    setActive(btnAxial);
  });
  const setActive = (a) => {
    for (const b of [btnOblique, btnAxial]) b.classList.toggle('active', b === a);
  };
  ctrlBar.append(btnOblique, btnAxial);
  shell.stage.append(ctrlBar);

  // Question choices
  const choices = document.createElement('div');
  choices.className = 'wg-choice-row';
  let userPick = null;
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
        const ok = key === variantKey;
        ctx.submitResult({
          outcome: ok ? 'correct' : 'incorrect',
          detail: ok ? `正确判断：${label}` : `选择了：${label}`,
          response: { picked: key, expected: variantKey },
        });
        ctx.requestReveal();
      },
      { signal: ctx.signal },
    );
    return btn;
  };
  choices.append(
    makeChoice('three', hasMiddle ? '有光透出（45° 旋转了振动投影）' : '仍有部分光透出'),
    makeChoice('two', '完全消光（光强 = 0）'),
  );
  shell.footer.append(choices);

  let wavePhase = 0;
  const unsubFrame = s3d.onFrame((dt) => {
    wavePhase += dt * 3.4;
    seg0.update(wavePhase);
    seg1.update(wavePhase);
    if (revealWaveGroup.visible) {
      seg2?.update(wavePhase);
      seg3?.update(wavePhase);
    }
    s3d.requestRender();
  });

  const syncPhase = (phase) => {
    const revealed = phase === 'reveal';
    choices.hidden = revealed;
    ctrlBar.hidden = !revealed;
    revealWaveGroup.visible = revealed;
    labelOut.setVisible(revealed);

    if (revealed && hasMiddle) {
      spotMat.opacity = 0.85;
      screenMat.emissive.setHex(0x134e3a);
      screenMat.emissiveIntensity = 0.65;
    } else {
      spotMat.opacity = 0;
      screenMat.emissive.setHex(0x000000);
      screenMat.emissiveIntensity = 0;
    }

    if (revealed) {
      setActive(btnOblique);
      const ok = userPick === null ? null : userPick === variantKey;
      shell.showFeedback({
        title: hasMiddle ? '有光透出 · 偏振片不是简单“遮挡”，而是矢量投影' : '完全消光 · cos 90° = 0',
        body: hasMiddle
          ? '0° 竖直光在 45° 方向有 cos45° 分量，经 P₂ 变成 45° 偏振光；再投射到 90° 水平方向仍有 cos45° 分量，最终光强为 I₀/8（相对 P₁ 后为 1/4）。点右上角“沿光轴正视”看三维夹角！'
          : '0° 竖直振动在 90° 水平方向的分量为 cos90° = 0，被 P₃ 完全吸收，屏幕全黑。',
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
    unsubFrame();
    unsubPhase();
    for (const d of disposables) d.dispose();
  };
}
