/**
 * 高中化学 · 3D 易混对比卡
 * 主题：CH₄ / NH₃ / H₂O 空间构型、孤电子对排斥与键角大小规律
 */
import * as THREE from 'three';
import { createCardShell, pickVariant } from 'wengu/card';
import { createScene3D } from 'wengu/scene3d';

const STYLES = `
.chem-compare {
  position: absolute;
  left: 50%;
  bottom: 36px;
  transform: translateX(-50%);
  z-index: 4;
  width: min(660px, calc(100% - 32px));
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  pointer-events: none;
}
.chem-compare[hidden] {
  display: none;
}
.chem-col {
  border-radius: 14px;
  padding: 9px 12px;
  background: var(--wg-color-surface);
  box-shadow:
    inset 0 0 0 2px var(--wg-color-border),
    0 3px 0 var(--wg-color-border);
  font: 600 12px/1.38 var(--wg-font-sans);
  color: var(--wg-color-text-muted);
}
.chem-col.is-active {
  background: color-mix(in srgb, var(--wg-color-accent) 9%, var(--wg-color-surface));
  box-shadow:
    inset 0 0 0 2px var(--wg-color-accent),
    0 3px 0 color-mix(in srgb, var(--wg-color-accent) 75%, #000);
  color: var(--wg-color-text);
}
.chem-col strong {
  display: block;
  font-size: 13.5px;
  font-weight: 700;
  color: var(--wg-color-text);
  margin-bottom: 2px;
}
.chem-col em {
  font-style: normal;
  font-weight: 700;
  color: var(--wg-color-accent);
}
.chem-verdict {
  grid-column: 1 / -1;
  text-align: center;
  font: 700 12.5px/1.4 var(--wg-font-sans);
  padding: 7px 14px;
  border-radius: 12px;
  background: var(--wg-color-background);
  box-shadow: inset 0 0 0 2px var(--wg-color-border);
  color: var(--wg-color-text);
}
.chem-verdict[data-tone="success"] {
  background: color-mix(in srgb, var(--wg-color-success) 10%, var(--wg-color-surface));
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--wg-color-success) 45%, transparent);
  color: var(--wg-color-success);
}
.chem-verdict[data-tone="danger"] {
  background: color-mix(in srgb, var(--wg-color-danger) 10%, var(--wg-color-surface));
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--wg-color-danger) 45%, transparent);
  color: var(--wg-color-danger);
}
`;

function createMoleculeSpec(key) {
  if (key === 'CH4') {
    const k = Math.sqrt(8) / 3;
    const r = Math.sqrt(2 / 3);
    const s = Math.sqrt(2) / 3;
    return {
      key: 'CH4',
      formula: 'CH₄',
      shape: '正四面体',
      angleText: '109°28′',
      loneCount: 0,
      centerAtom: { el: 'C', color: '#3b3934', radius: 0.36 },
      hydrogens: [
        [0, 1, 0],
        [0, -1 / 3, k],
        [r, -1 / 3, -s],
        [-r, -1 / 3, -s],
      ],
      lonePairs: [],
    };
  }
  if (key === 'NH3') {
    const cos107 = Math.cos(THREE.MathUtils.degToRad(107));
    const sinTheta = Math.sqrt((1 - cos107) / 1.5);
    const cosTheta = -Math.sqrt(1 - sinTheta * sinTheta);
    return {
      key: 'NH3',
      formula: 'NH₃',
      shape: '三角锥形',
      angleText: '107°',
      loneCount: 1,
      centerAtom: { el: 'N', color: '#3d8bf0', radius: 0.36 },
      hydrogens: [
        [sinTheta, cosTheta, 0],
        [sinTheta * Math.cos((2 * Math.PI) / 3), cosTheta, sinTheta * Math.sin((2 * Math.PI) / 3)],
        [sinTheta * Math.cos((4 * Math.PI) / 3), cosTheta, sinTheta * Math.sin((4 * Math.PI) / 3)],
      ],
      lonePairs: [[0, 1, 0]],
    };
  }
  const half = THREE.MathUtils.degToRad(104.5 / 2);
  const lpHalf = THREE.MathUtils.degToRad(54.7);
  return {
    key: 'H2O',
    formula: 'H₂O',
    shape: 'V 形（角形）',
    angleText: '104.5°',
    loneCount: 2,
    centerAtom: { el: 'O', color: '#ec4d5e', radius: 0.35 },
    hydrogens: [
      [Math.sin(half), -Math.cos(half), 0],
      [-Math.sin(half), -Math.cos(half), 0],
    ],
    lonePairs: [
      [0, Math.cos(lpHalf), Math.sin(lpHalf)],
      [0, Math.cos(lpHalf), -Math.sin(lpHalf)],
    ],
  };
}

export function mount(root, ctx) {
  if (!document.getElementById('wg-chem-vsepr-css')) {
    const s = document.createElement('style');
    s.id = 'wg-chem-vsepr-css';
    s.textContent = STYLES;
    document.head.append(s);
  }

  const key = pickVariant(
    ['NH3', 'H2O', 'CH4'],
    typeof ctx.props.variant === 'string' || typeof ctx.props.variant === 'number' ? ctx.props.variant : undefined,
  );
  const spec = createMoleculeSpec(key);

  const shell = createCardShell(root, ctx, {
    height: 540,
    kicker: '高中化学 · 物质结构',
    prompt: '观察该 sp³ 杂化分子的三维立体构型：它的构型与键角分别是多少？',
    subtitle: '孤电子对已隐去 · 拖动观察化学键张角 · 点击选项或按 Space 揭晓',
    hint: '拖动旋转 · 滚轮缩放',
  });

  const s3d = createScene3D(shell.stage, ctx, {
    height: 540,
    cameraPosition: [0.65, 1.0, 4.4],
    target: [0, -0.1, 0],
    minDistance: 2.6,
    maxDistance: 7.0,
  });

  const disposables = [];
  const track = (x) => {
    disposables.push(x);
    return x;
  };

  const BOND_LEN = 1.42;
  const molGroup = new THREE.Group();
  s3d.scene.add(molGroup);

  // Center atom (ceramic gloss)
  const centerGeo = track(new THREE.SphereGeometry(spec.centerAtom.radius, 36, 24));
  const centerMat = track(
    new THREE.MeshPhysicalMaterial({
      color: spec.centerAtom.color,
      roughness: 0.25,
      clearcoat: 0.45,
    }),
  );
  molGroup.add(new THREE.Mesh(centerGeo, centerMat));

  // Hydrogen atoms & warm-silver bonds
  const hGeo = track(new THREE.SphereGeometry(0.23, 28, 20));
  const hMat = track(
    new THREE.MeshPhysicalMaterial({
      color: ctx.theme.scheme === 'dark' ? '#e8e5dc' : '#f7f5ef',
      roughness: 0.28,
      clearcoat: 0.35,
    }),
  );
  const bondGeo = track(new THREE.CylinderGeometry(0.072, 0.072, 1, 20));
  const bondMat = track(
    new THREE.MeshStandardMaterial({
      color: ctx.theme.scheme === 'dark' ? '#8c8880' : '#c6c0b4',
      roughness: 0.38,
    }),
  );

  const hDirs = spec.hydrogens.map((arr) => new THREE.Vector3(...arr).normalize());
  for (const dir of hDirs) {
    const hMesh = new THREE.Mesh(hGeo, hMat);
    hMesh.position.copy(dir).multiplyScalar(BOND_LEN);
    molGroup.add(hMesh);

    const bond = new THREE.Mesh(bondGeo, bondMat);
    bond.position.copy(dir).multiplyScalar(BOND_LEN / 2);
    bond.scale.set(1, BOND_LEN, 1);
    bond.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    molGroup.add(bond);
  }

  // Angle wedge sector + arc between first two H-bonds (shown on reveal)
  const u1 = hDirs[0].clone().normalize();
  const u2 = hDirs[1].clone().normalize();
  const wedgeRadius = 0.9;
  const wedgePts = [new THREE.Vector3(0, 0, 0)];
  const arcPts = [];
  const segs = 28;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const v = new THREE.Vector3().lerpVectors(u1, u2, t).normalize().multiplyScalar(wedgeRadius);
    wedgePts.push(v);
    arcPts.push(v.clone().multiplyScalar(1.03));
  }
  const indices = [];
  for (let i = 1; i <= segs; i++) indices.push(0, i, i + 1);
  const wedgeGeo = track(new THREE.BufferGeometry().setFromPoints(wedgePts));
  wedgeGeo.setIndex(indices);
  const wedgeMat = track(
    new THREE.MeshBasicMaterial({
      color: '#f26a3d',
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  molGroup.add(new THREE.Mesh(wedgeGeo, wedgeMat));

  const arcCurve = new THREE.CatmullRomCurve3(arcPts);
  const arcGeo = track(new THREE.TubeGeometry(arcCurve, 28, 0.016, 8, false));
  const arcMat = track(new THREE.MeshBasicMaterial({ color: '#f26a3d', transparent: true, opacity: 0 }));
  molGroup.add(new THREE.Mesh(arcGeo, arcMat));

  // Lone pair translucent amber electron lobes + clear electron pair dots
  const lpGeo = track(new THREE.SphereGeometry(0.44, 28, 20));
  const lpMat = track(
    new THREE.MeshPhysicalMaterial({
      color: '#f1a62a',
      emissive: '#f1a62a',
      emissiveIntensity: 0.25,
      transparent: true,
      opacity: 0,
      roughness: 0.25,
      depthWrite: false,
    }),
  );
  const dotGeo = track(new THREE.SphereGeometry(0.075, 16, 12));
  const dotMat = track(new THREE.MeshStandardMaterial({ color: '#f26a3d', roughness: 0.25, transparent: true, opacity: 0 }));

  const lpDirs = spec.lonePairs.map((arr) => new THREE.Vector3(...arr).normalize());
  for (const lpDir of lpDirs) {
    const lobeGroup = new THREE.Group();
    lobeGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), lpDir);

    const lobe = new THREE.Mesh(lpGeo, lpMat);
    lobe.position.y = 0.82;
    lobe.scale.set(0.68, 1.12, 0.68);
    lobeGroup.add(lobe);

    for (const xOff of [-0.13, 0.13]) {
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.set(xOff, 0.92, 0);
      lobeGroup.add(dot);
    }
    molGroup.add(lobeGroup);
  }

  // 3D annotations (hidden in question phase)
  const midAngleDir = new THREE.Vector3().addVectors(u1, u2).normalize();
  const labelCenter = s3d.addLabel(`${spec.formula}（${spec.shape}）`, [0.68, 0.28, 0.2], { visible: false });
  const labelAngle = s3d.addLabel(`键角 ${spec.angleText}`, midAngleDir.clone().multiplyScalar(0.98).toArray(), {
    visible: false,
  });
  const labelLp =
    lpDirs.length > 0
      ? s3d.addLabel(`孤电子对 ×${spec.loneCount}（强排斥）`, [0.85, 0.94, 0.15], {
          visible: false,
          muted: true,
        })
      : null;

  // Tactile Wengu trial choice buttons (question phase)
  const choices = document.createElement('div');
  choices.className = 'wg-choice-row';
  let userPick = null;

  const choose = (pickedKey, text) => {
    if (ctx.phase === 'reveal') return;
    userPick = pickedKey;
    const ok = pickedKey === spec.key;
    ctx.submitResult({
      outcome: ok ? 'correct' : 'incorrect',
      detail: text,
      response: { picked: pickedKey, expected: spec.key },
    });
    ctx.requestReveal();
  };

  for (const [k, label] of [
    ['CH4', '正四面体 · 109°28′'],
    ['NH3', '三角锥形 · 107°'],
    ['H2O', 'V 形 · 104.5°'],
  ]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wg-choice';
    btn.textContent = label;
    btn.addEventListener('click', () => choose(k, label), { signal: ctx.signal });
    choices.append(btn);
  }
  shell.root.append(choices);

  // Side-by-side Wengu tactile comparison strip (reveal phase)
  const compare = document.createElement('div');
  compare.className = 'chem-compare';
  compare.hidden = true;
  const verdict = document.createElement('div');
  verdict.className = 'chem-verdict';
  compare.append(verdict);

  const COMPARE_DATA = [
    ['CH4', 'CH₄ 甲烷', '正四面体 · 109°28′', '孤电子对 0 对'],
    ['NH3', 'NH₃ 氨气', '三角锥形 · 107°', '孤电子对 1 对'],
    ['H2O', 'H₂O 水', 'V 形 · 104.5°', '孤电子对 2 对'],
  ];
  for (const [k, title, angle, lp] of COMPARE_DATA) {
    const col = document.createElement('div');
    col.className = `chem-col${k === spec.key ? ' is-active' : ''}`;
    col.innerHTML = `<strong>${title}</strong><div><em>${angle}</em></div><div>${lp}</div>`;
    compare.append(col);
  }
  shell.root.append(compare);

  const unsubTheme = ctx.onThemeChange((t) => {
    hMat.color.set(t.scheme === 'dark' ? '#e8e5dc' : '#f7f5ef');
    bondMat.color.set(t.scheme === 'dark' ? '#8c8880' : '#c6c0b4');
    s3d.requestRender();
  });

  const syncPhase = (phase) => {
    const revealed = phase === 'reveal';
    choices.hidden = revealed;
    compare.hidden = !revealed;

    wedgeMat.opacity = revealed ? 0.24 : 0;
    arcMat.opacity = revealed ? 0.95 : 0;
    lpMat.opacity = revealed ? 0.32 : 0;
    dotMat.opacity = revealed ? 0.95 : 0;

    labelCenter.setVisible(revealed);
    labelCenter.setHighlighted(revealed);
    labelAngle.setVisible(revealed);
    labelLp?.setVisible(revealed);

    if (revealed) {
      s3d.focusCamera([0.92, 0.92, 5.35], [0, -0.22, 0], 240);
      const ok = userPick === null ? null : userPick === spec.key;
      verdict.dataset.tone = ok === false ? 'danger' : 'success';
      verdict.textContent =
        ok === false
          ? `判断有误 · 正确答案：${spec.formula} ${spec.shape}（${spec.angleText}，孤电子对 ${spec.loneCount} 对压缩键角）`
          : `规律：孤电子对越多，对成键电子对斥力越强，键角越小（CH₄ 109°28′ > NH₃ 107° > H₂O 104.5°）`;
    } else {
      userPick = null;
    }
    s3d.requestRender();
  };

  syncPhase(ctx.phase);
  const unsubPhase = ctx.onPhaseChange(syncPhase);

  return () => {
    unsubPhase();
    unsubTheme();
    for (const d of disposables) d.dispose();
  };
}
