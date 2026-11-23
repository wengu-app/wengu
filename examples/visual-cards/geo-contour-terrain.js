/**
 * 高中地理 · 2D 等高线 ↔ 3D 山体隆起与通视判断
 * 核心 3D 优势：提问态为纯 2D 等高线俯视图；揭晓态地形实时隆起成 3D 山体并射出 A→B 激光视线，
 * 直观打通“上疏下密=凸坡挡视线 / 上密下疏=凹坡可通视”的空间对应。
 */
import * as THREE from 'three';
import { createCardShell, pickVariant } from 'wengu/card';
import { createScene3D } from 'wengu/scene3d';

const STYLES = `
.geo-ctrl-bar {
  position: absolute;
  top: 12px;
  right: 14px;
  z-index: 6;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.geo-ctrl-bar[hidden] {
  display: none;
}
.geo-ctrl-btn {
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
.geo-ctrl-btn:hover {
  transform: translateY(-1px);
}
.geo-ctrl-btn.active {
  background: var(--wg-color-accent);
  color: var(--wg-color-on-accent);
  box-shadow:
    inset 0 0 0 1.5px var(--wg-color-accent),
    0 2px 0 color-mix(in srgb, var(--wg-color-accent) 72%, #000);
}
.geo-legend {
  position: absolute;
  top: 12px;
  left: 14px;
  z-index: 4;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 12px;
}
`;

const SIZE = 4.4;
const SEG = 88;
const PEAK_X = -1.15;
const PEAK_Z = 0.0;
const MAX_R = 2.95;
const H_MIN = 0.08;
const H_MAX = 1.62;

const AX = -1.05;
const AZ = 0.0;
const BX = 1.48;
const BZ = 0.0;

function elevationAt(x, z, isConvex) {
  const dx = x - PEAK_X;
  const dz = (z - PEAK_Z) * 1.08;
  const u = Math.min(1, Math.hypot(dx, dz) / MAX_R);
  const profile = isConvex
    ? 1 - Math.pow(u, 2.35)
    : Math.pow(1 - u, 2.35);
  return H_MIN + (H_MAX - H_MIN) * profile;
}

function createContourTexture(isConvex, dark) {
  const res = 512;
  const canvas = document.createElement('canvas');
  canvas.width = res;
  canvas.height = res;
  const g = canvas.getContext('2d');
  const img = g.createImageData(res, res);
  const data = img.data;

  // Hypsometric color ramp (valley green -> foothill -> warm ochre -> highland cream)
  const stops = dark
    ? [
        [0.0, [34, 72, 58]],
        [0.32, [52, 108, 76]],
        [0.62, [132, 146, 84]],
        [0.85, [178, 134, 88]],
        [1.0, [212, 190, 166]],
      ]
    : [
        [0.0, [134, 198, 152]],
        [0.3, [174, 218, 148]],
        [0.6, [232, 222, 146]],
        [0.84, [224, 174, 122]],
        [1.0, [244, 232, 218]],
      ];

  const sampleColor = (t) => {
    const c = Math.max(0, Math.min(1, t));
    for (let i = 0; i < stops.length - 1; i++) {
      const [t0, c0] = stops[i];
      const [t1, c1] = stops[i + 1];
      if (c <= t1) {
        const k = (c - t0) / (t1 - t0 || 1);
        return [
          c0[0] + (c1[0] - c0[0]) * k,
          c0[1] + (c1[1] - c0[1]) * k,
          c0[2] + (c1[2] - c0[2]) * k,
        ];
      }
    }
    return stops[stops.length - 1][1];
  };

  const step = 0.155;
  const field = new Float32Array(res * res);
  for (let py = 0; py < res; py++) {
    const z = (py / (res - 1) - 0.5) * SIZE;
    for (let px = 0; px < res; px++) {
      const x = (px / (res - 1) - 0.5) * SIZE;
      field[py * res + px] = elevationAt(x, z, isConvex);
    }
  }

  for (let py = 0; py < res; py++) {
    for (let px = 0; px < res; px++) {
      const idx = py * res + px;
      const h = field[idx];
      const t = (h - H_MIN) / (H_MAX - H_MIN);
      let [r, gr, b] = sampleColor(t);

      // Crisp screen-space-independent contour lines using neighbor elevation level crossing
      const level = Math.floor(h / step);
      const levelR = px + 1 < res ? Math.floor(field[idx + 1] / step) : level;
      const levelD = py + 1 < res ? Math.floor(field[idx + res] / step) : level;
      const isLine = level !== levelR || level !== levelD;
      const isMajor = isLine && (Math.max(level, levelR, levelD) % 2 === 0);

      if (isLine) {
        const blend = isMajor ? 0.68 : 0.42;
        const lr = dark ? 245 : 58;
        const lg = dark ? 236 : 44;
        const lb = dark ? 218 : 30;
        r = r * (1 - blend) + lr * blend;
        gr = gr * (1 - blend) + lg * blend;
        b = b * (1 - blend) + lb * blend;
      }

      const o = idx * 4;
      data[o] = r;
      data[o + 1] = gr;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  // Draw dashed sightline projection on the map between A and B
  const toPx = (v) => ((v / SIZE) + 0.5) * res;
  g.save();
  g.strokeStyle = dark ? 'rgba(255,255,255,0.65)' : 'rgba(34,42,56,0.55)';
  g.lineWidth = 2.5;
  g.setLineDash([7, 6]);
  g.beginPath();
  g.moveTo(toPx(AX), toPx(AZ));
  g.lineTo(toPx(BX), toPx(BZ));
  g.stroke();
  g.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function mount(root, ctx) {
  if (!document.getElementById('wg-geo-contour-css')) {
    const s = document.createElement('style');
    s.id = 'wg-geo-contour-css';
    s.textContent = STYLES;
    document.head.append(s);
  }

  const variantKey = pickVariant(
    ['convex', 'concave'],
    typeof ctx.props.variant === 'string' || typeof ctx.props.variant === 'number' ? ctx.props.variant : undefined,
  );
  const isConvex = variantKey === 'convex';

  const shell = createCardShell(root, ctx, {
    height: 540,
    kicker: '高中地理 · 等高线地形与通视',
    prompt: '观察 2D 等高线疏密分布：站在山坡 A 点能否直接看到山脚 B 点？',
    subtitle: '揭晓后平面将实时隆起成 3D 山体并射出视线 · 可自由旋转',
    hint: '拖动旋转 · 滚轮缩放',
  });

  // Start in near top-down 2D map view so the user reads the contour lines first
  const CAM_2D = [0.05, 6.9, 1.05];
  const CAM_3D = [0.65, 2.95, 6.45];
  const CAM_SIDE = [0.25, 1.65, 6.55];

  const s3d = createScene3D(shell.stage, ctx, {
    cameraPosition: CAM_2D,
    target: [0.1, 0.35, 0],
    minDistance: 3.4,
    maxDistance: 10.5,
  });

  const disposables = [];
  const track = (x) => {
    disposables.push(x);
    return x;
  };

  // Lighting tuned for crisp terrain relief shading
  const sun = new THREE.DirectionalLight(0xfff7ea, 2.2);
  sun.position.set(4.5, 7.5, 4.0);
  s3d.scene.add(sun);
  s3d.scene.add(new THREE.HemisphereLight(0xdcecff, 0x3b4858, 0.95));

  // Terrain mesh (morphed smoothly between lift=0 flat 2D map and lift=1 full 3D mountain)
  const geo = track(new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG));
  geo.rotateX(-Math.PI / 2);
  const posAttr = geo.attributes.position;
  const baseHeights = new Float32Array(posAttr.count);
  for (let i = 0; i < posAttr.count; i++) {
    baseHeights[i] = elevationAt(posAttr.getX(i), posAttr.getZ(i), isConvex);
    posAttr.setY(i, 0);
  }
  geo.computeVertexNormals();

  const terrainMat = track(
    new THREE.MeshStandardMaterial({
      map: track(createContourTexture(isConvex, ctx.theme.scheme === 'dark')),
      roughness: 0.78,
      metalness: 0.02,
      side: THREE.DoubleSide,
    }),
  );
  const terrainMesh = new THREE.Mesh(geo, terrainMat);
  s3d.scene.add(terrainMesh);

  // Dark slate base pedestal so the 3D block looks solid like a physical topographic model
  const baseBox = new THREE.Mesh(
    track(new THREE.BoxGeometry(SIZE, 0.14, SIZE)),
    track(new THREE.MeshStandardMaterial({ color: 0x2e3744, roughness: 0.9 })),
  );
  baseBox.position.y = -0.075;
  s3d.scene.add(baseBox);

  // Subtle side skirt along the front edge (z = +SIZE/2) and back edge for block solidity
  const hA = elevationAt(AX, AZ, isConvex);
  const hB = elevationAt(BX, BZ, isConvex);

  // Point A (observer) & Point B (target) pins
  const makePin = (color) => {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.024, 0.024, 0.28, 12)),
      track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })),
    );
    pole.position.y = 0.14;
    const head = new THREE.Mesh(
      track(new THREE.SphereGeometry(0.085, 20, 16)),
      track(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, roughness: 0.3 })),
    );
    head.position.y = 0.28;
    g.add(pole, head);
    return g;
  };

  const pinA = makePin(0x3d8bf0);
  const pinB = makePin(0xf26a3d);
  s3d.scene.add(pinA, pinB);

  const labelA = s3d.addLabel('A 观察点（高处）', [AX, 0.45, AZ], { className: 'tone-info' });
  const labelB = s3d.addLabel('B 目标点（低处）', [BX, 0.45, BZ]);

  // Compute exact ray-terrain intersection along A->B at full lift=1
  const EYE_OFFSET = 0.16;
  const SAMPLES = 120;
  let blockT = -1;
  for (let i = 3; i < SAMPLES - 2; i++) {
    const t = i / SAMPLES;
    const x = AX + (BX - AX) * t;
    const z = AZ + (BZ - AZ) * t;
    const rayY = (hA + EYE_OFFSET) * (1 - t) + (hB + EYE_OFFSET) * t;
    const groundY = elevationAt(x, z, isConvex);
    if (groundY >= rayY - 0.01) {
      blockT = t;
      break;
    }
  }

  // Sightline meshes (visible only after reveal)
  const sightGroup = new THREE.Group();
  sightGroup.visible = false;
  s3d.scene.add(sightGroup);

  const makeBeam = (p0, p1, color, radius, opacity = 1) => {
    const dir = new THREE.Vector3().subVectors(p1, p0);
    const len = dir.length();
    const m = new THREE.Mesh(
      track(new THREE.CylinderGeometry(radius, radius, len, 12)),
      track(
        new THREE.MeshBasicMaterial({
          color,
          transparent: opacity < 1,
          opacity,
        }),
      ),
    );
    m.position.copy(p0).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return m;
  };

  const pA3 = new THREE.Vector3(AX, hA + EYE_OFFSET, AZ);
  const pB3 = new THREE.Vector3(BX, hB + EYE_OFFSET, BZ);
  let hitPos = new THREE.Vector3();

  if (isConvex && blockT > 0) {
    hitPos.lerpVectors(pA3, pB3, blockT);
    sightGroup.add(makeBeam(pA3, hitPos, 0xe84a43, 0.032, 0.96));
    sightGroup.add(makeBeam(hitPos, pB3, 0xe84a43, 0.018, 0.28));
    const impact = new THREE.Mesh(
      track(new THREE.SphereGeometry(0.11, 20, 16)),
      track(new THREE.MeshBasicMaterial({ color: 0xff4d42 })),
    );
    impact.position.copy(hitPos);
    sightGroup.add(impact);
  } else {
    sightGroup.add(makeBeam(pA3, pB3, 0x2eb872, 0.032, 0.96));
  }

  const labelSight = s3d.addLabel(
    isConvex ? '凸坡隆起 · 视线被挡' : '凹坡低洼 · 视线畅通',
    isConvex
      ? [hitPos.x + 0.36, hitPos.y + 0.36, hitPos.z + 0.25]
      : [(AX + BX) * 0.5, (hA + hB) * 0.5 + 0.45, 0],
    { visible: false, className: isConvex ? 'highlighted' : 'tone-good' },
  );

  // Legend (inside stage, top-left, cleanly separated from header)
  const legend = document.createElement('div');
  legend.className = 'wg-pill-legend geo-legend';
  legend.innerHTML =
    '<span><i style="background:#f4e8da"></i>高海拔（山顶）</span>' +
    '<span><i style="background:#e8de92"></i>中坡等高线</span>' +
    '<span><i style="background:#86c698"></i>低海拔（山脚）</span>';
  shell.stage.append(legend);

  // Reveal-only camera / lift controls
  const ctrlBar = document.createElement('div');
  ctrlBar.className = 'geo-ctrl-bar';
  ctrlBar.hidden = true;
  const makeCtrl = (label, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'geo-ctrl-btn';
    b.textContent = label;
    b.addEventListener('click', onClick, { signal: ctx.signal });
    return b;
  };
  let targetLift = 0;
  let currentLift = 0;

  const btn3d = makeCtrl('3D 斜视', () => {
    targetLift = 1;
    s3d.focusCamera(CAM_3D, [0.15, 0.52, 0], 420);
    setActiveCtrl(btn3d);
  });
  const btnSide = makeCtrl('侧视剖面', () => {
    targetLift = 1;
    s3d.focusCamera(CAM_SIDE, [0.2, 0.6, 0], 420);
    setActiveCtrl(btnSide);
  });
  const btn2d = makeCtrl('展平 2D', () => {
    targetLift = 0;
    s3d.focusCamera(CAM_2D, [0.05, 0.25, 0], 420);
    setActiveCtrl(btn2d);
  });
  const setActiveCtrl = (active) => {
    for (const b of [btn3d, btnSide, btn2d]) b.classList.toggle('active', b === active);
  };
  ctrlBar.append(btn3d, btnSide, btn2d);
  shell.stage.append(ctrlBar);

  // Question choices (in dedicated footer, never overlapping 3D stage)
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
    makeChoice('convex', '不可通视（上疏下密 · 凸坡）'),
    makeChoice('concave', '可以通视（上密下疏 · 凹坡）'),
  );
  shell.footer.append(choices);

  const applyLift = (lift) => {
    for (let i = 0; i < posAttr.count; i++) {
      posAttr.setY(i, baseHeights[i] * lift);
    }
    posAttr.needsUpdate = true;
    geo.computeVertexNormals();

    pinA.position.set(AX, hA * lift, AZ);
    pinB.position.set(BX, hB * lift, BZ);
    labelA.setPosition([AX - 0.16, hA * lift + 0.58, AZ]);
    labelB.setPosition([BX + 0.14, hB * lift + 0.48, BZ]);

    sightGroup.visible = ctx.phase === 'reveal' && lift > 0.72;
    labelSight.setVisible(ctx.phase === 'reveal' && lift > 0.72);
  };

  applyLift(0);

  const unsubFrame = s3d.onFrame((dt) => {
    if (Math.abs(targetLift - currentLift) > 0.001) {
      const step = Math.min(1, dt * 3.8);
      currentLift += (targetLift - currentLift) * step;
      if (Math.abs(targetLift - currentLift) <= 0.002) currentLift = targetLift;
      applyLift(currentLift);
      s3d.requestRender();
    }
  });

  const unsubTheme = ctx.onThemeChange((theme) => {
    terrainMat.map = track(createContourTexture(isConvex, theme.scheme === 'dark'));
    terrainMat.needsUpdate = true;
    s3d.requestRender();
  });

  const syncPhase = (phase) => {
    const revealed = phase === 'reveal';
    choices.hidden = revealed;
    ctrlBar.hidden = !revealed;

    if (revealed) {
      targetLift = 1;
      setActiveCtrl(btn3d);
      s3d.focusCamera(CAM_3D, [0.15, 0.55, 0], 620);
      const ok = userPick === null ? null : userPick === variantKey;
      shell.showFeedback({
        title: isConvex ? '不可通视 · 上疏下密为凸坡' : '可以通视 · 上密下疏为凹坡',
        body: isConvex
          ? '高处等高线稀疏（坡缓）、低处密集（坡陡），山坡向外鼓出形成凸坡，直接遮挡 A→B 视线。'
          : '高处等高线密集（坡陡）、低处稀疏（坡缓），山坡向内凹陷形成凹坡，A→B 视线悬空直达。',
        tone: ok === false ? 'danger' : 'success',
      });
    } else {
      userPick = null;
      targetLift = 0;
      currentLift = 0;
      applyLift(0);
      shell.hideFeedback();
    }
    s3d.requestRender();
  };

  syncPhase(ctx.phase);
  const unsubPhase = ctx.onPhaseChange(syncPhase);

  return () => {
    unsubFrame();
    unsubTheme();
    unsubPhase();
    for (const d of disposables) d.dispose();
  };
}
