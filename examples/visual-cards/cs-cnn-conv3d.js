/**
 * 计算机科学 · CNN 3D 张量与多通道卷积
 * 核心 3D 优势：用 H×W×C 立体体素块展示“一个 3×3 卷积核实际是 3×3×C_in 立体块、
 * 跨所有输入通道乘加求和生成 1 个输出切片，N 个核堆叠出 C_out=N 层输出”。
 */
import * as THREE from 'three';
import { createCardShell } from 'wengu/card';
import { createScene3D } from 'wengu/scene3d';

const STYLES = `
.cnn-ctrl-bar {
  position: absolute;
  top: 12px;
  right: 14px;
  z-index: 6;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.cnn-ctrl-bar[hidden] {
  display: none;
}
.cnn-ctrl-btn {
  appearance: none;
  border: 0;
  cursor: pointer;
  padding: 5px 10px;
  border-radius: 9px;
  font: 700 12px/1.2 var(--wg-font-sans);
  color: var(--wg-color-text);
  background: color-mix(in srgb, var(--wg-color-surface) 94%, transparent);
  box-shadow:
    inset 0 0 0 1.5px var(--wg-color-border),
    0 2px 0 color-mix(in srgb, var(--wg-color-border) 88%, var(--wg-color-text));
  transition: transform 120ms ease, background 120ms ease, color 120ms ease;
}
.cnn-ctrl-btn:hover {
  transform: translateY(-1px);
}
.cnn-ctrl-btn.active {
  background: var(--wg-color-accent);
  color: var(--wg-color-on-accent);
  box-shadow:
    inset 0 0 0 1.5px var(--wg-color-accent),
    0 2px 0 color-mix(in srgb, var(--wg-color-accent) 72%, #000);
}
`;

export function mount(root, ctx) {
  if (!document.getElementById('wg-cs-cnn-css')) {
    const s = document.createElement('style');
    s.id = 'wg-cs-cnn-css';
    s.textContent = STYLES;
    document.head.append(s);
  }

  const shell = createCardShell(root, ctx, {
    height: 540,
    kicker: '计算机科学 · 卷积神经网络（CNN）',
    prompt: '对 5×5×3（RGB）输入使用 4 个 3×3 卷积核（stride=1, padding=0）：单核参数量与输出形状是？',
    subtitle: '拖动旋转查看三维张量深度（C_in = 3）· 按 Space 揭晓跨通道求和与输出切片',
    hint: '拖动旋转 · 滚轮缩放',
  });

  const s3d = createScene3D(shell.stage, ctx, {
    cameraPosition: [1.1, 2.45, 6.7],
    target: [0.35, -0.05, 0],
    minDistance: 3.6,
    maxDistance: 12.0,
  });

  const disposables = [];
  const track = (x) => {
    disposables.push(x);
    return x;
  };

  const light = new THREE.DirectionalLight(0xffffff, 2.0);
  light.position.set(4, 7, 6);
  s3d.scene.add(light);
  s3d.scene.add(new THREE.HemisphereLight(0xeef6ff, 0x3b4858, 0.95));

  // Geometry constants
  const CELL = 0.36;
  const GAP = 0.05;
  const STEP = CELL + GAP;
  const CH_GAP = 0.48; // depth separation along Z

  const IN_X = -1.65;
  const OUT_X = 2.05;

  // Input tensor: 5 x 5 x 3 (R, G, B channels stacked along Z)
  const IN_COLORS = [0xef4444, 0x22c55e, 0x3b82f6];
  const voxelGeo = track(new THREE.BoxGeometry(CELL, CELL, 0.24));
  const inputGroup = new THREE.Group();
  inputGroup.position.x = IN_X;
  s3d.scene.add(inputGroup);

  const inCells = []; // [ch][r][c]
  for (let ch = 0; ch < 3; ch++) {
    const z = (ch - 1) * CH_GAP;
    const baseMat = track(
      new THREE.MeshStandardMaterial({
        color: IN_COLORS[ch],
        transparent: true,
        opacity: 0.28,
        roughness: 0.45,
      }),
    );
    const activeMat = track(
      new THREE.MeshStandardMaterial({
        color: IN_COLORS[ch],
        emissive: IN_COLORS[ch],
        emissiveIntensity: 0.35,
        transparent: true,
        opacity: 0.88,
        roughness: 0.3,
      }),
    );
    const layer = [];
    for (let r = 0; r < 5; r++) {
      const row = [];
      for (let c = 0; c < 5; c++) {
        const mesh = new THREE.Mesh(voxelGeo, baseMat);
        mesh.position.set((c - 2) * STEP, (2 - r) * STEP, z);
        inputGroup.add(mesh);
        row.push({ mesh, baseMat, activeMat });
      }
      layer.push(row);
    }
    inCells.push(layer);
  }

  // 3x3x3 Kernel wireframe cage sliding across the input tensor
  const kernelW = 3 * STEP;
  const kernelD = 2 * CH_GAP + 0.32;
  const kernelBoxGeo = track(new THREE.BoxGeometry(kernelW, kernelW, kernelD));
  const kernelEdges = new THREE.LineSegments(
    track(new THREE.EdgesGeometry(kernelBoxGeo)),
    track(new THREE.LineBasicMaterial({ color: 0xf59e0b })),
  );
  const kernelFill = new THREE.Mesh(
    kernelBoxGeo,
    track(
      new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.08,
        depthWrite: false,
      }),
    ),
  );
  const kernelCage = new THREE.Group();
  kernelCage.add(kernelEdges, kernelFill);
  inputGroup.add(kernelCage);

  // Question-phase placeholder wireframe on the right
  const placeholderBox = new THREE.LineSegments(
    track(new THREE.EdgesGeometry(track(new THREE.BoxGeometry(3 * STEP + 0.16, 3 * STEP + 0.16, 1.45)))),
    track(new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.5 })),
  );
  placeholderBox.position.set(OUT_X, 0, 0);
  s3d.scene.add(placeholderBox);

  const labelPlaceholder = s3d.addLabel('输出张量 ？×？×？', [OUT_X, 1.15, 0], { muted: true });

  // Reveal-phase output tensor: 3 x 3 x 4 (4 output channels = 4 kernels)
  const OUT_COLORS = [0xf59e0b, 0x06b6d4, 0xa855f7, 0xec4899];
  const outGroup = new THREE.Group();
  outGroup.position.x = OUT_X;
  outGroup.visible = false;
  s3d.scene.add(outGroup);

  const outSlices = [];
  for (let k = 0; k < 4; k++) {
    const sliceGroup = new THREE.Group();
    const baseMat = track(
      new THREE.MeshStandardMaterial({
        color: OUT_COLORS[k],
        transparent: true,
        opacity: 0.24,
        roughness: 0.45,
      }),
    );
    const activeMat = track(
      new THREE.MeshStandardMaterial({
        color: OUT_COLORS[k],
        emissive: OUT_COLORS[k],
        emissiveIntensity: 0.45,
        transparent: true,
        opacity: 0.96,
        roughness: 0.25,
      }),
    );
    const grid = [];
    for (let r = 0; r < 3; r++) {
      const row = [];
      for (let c = 0; c < 3; c++) {
        const m = new THREE.Mesh(voxelGeo, baseMat);
        m.position.set((c - 1) * STEP, (1 - r) * STEP, 0);
        sliceGroup.add(m);
        row.push({ mesh: m, baseMat, activeMat });
      }
      grid.push(row);
    }
    sliceGroup.position.z = (k - 1.5) * 0.44;
    outGroup.add(sliceGroup);
    outSlices.push({ group: sliceGroup, grid, color: OUT_COLORS[k] });
  }

  // 3 summation rays from R, G, B kernel faces -> single output voxel in active kernel slice
  const rayGroup = new THREE.Group();
  rayGroup.visible = false;
  s3d.scene.add(rayGroup);
  const rays = IN_COLORS.map((c) => {
    const g = track(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]));
    const l = new THREE.Line(g, track(new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.9 })));
    rayGroup.add(l);
    return { geo: g, line: l };
  });

  // Labels
  s3d.addLabel('输入 5×5×3（R/G/B）', [IN_X, 1.52, 0], { className: 'tone-info' });
  const labelKernel = s3d.addLabel('单核 3×3×3 = 27 权重', [IN_X, -1.52, 0.5], {
    visible: false,
    className: 'highlighted',
  });
  const labelOut = s3d.addLabel('输出 3×3×4（4 个核 → 4 层）', [OUT_X, 1.28, 0], {
    visible: false,
    className: 'tone-good',
  });

  // Kernel selector buttons (reveal phase)
  let activeKernel = 0;
  const ctrlBar = document.createElement('div');
  ctrlBar.className = 'cnn-ctrl-bar';
  ctrlBar.hidden = true;
  const kBtns = [0, 1, 2, 3].map((idx) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cnn-ctrl-btn';
    b.textContent = `卷积核 #${idx + 1} → 通道 ${idx + 1}`;
    b.addEventListener(
      'click',
      () => {
        activeKernel = idx;
        updateHighlight();
        s3d.requestRender();
      },
      { signal: ctx.signal },
    );
    ctrlBar.append(b);
    return b;
  });
  shell.stage.append(ctrlBar);

  // Question choices
  const choices = document.createElement('div');
  choices.className = 'wg-choice-row';
  let userPick = null;
  const CORRECT = '27-3x3x4';
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
          detail: ok ? '正确理解了多通道卷积核与输出通道数' : `选择了：${label}`,
          response: { picked: key, expected: CORRECT },
        });
        ctx.requestReveal();
      },
      { signal: ctx.signal },
    );
    return btn;
  };
  choices.append(
    makeChoice('27-3x3x4', '每核 27 参数 → 输出 3×3×4'),
    makeChoice('9-3x3x3', '每核 9 参数 → 输出 3×3×3'),
    makeChoice('9-3x3x4', '每核 9 参数 → 输出 3×3×4'),
  );
  shell.footer.append(choices);

  // Scanning position (0..2, 0..2)
  let scanRow = 0;
  let scanCol = 0;
  let scanTimer = 0;

  const updateHighlight = () => {
    // Move kernel cage over input[scanRow..scanRow+2][scanCol..scanCol+2]
    const cx = (scanCol - 1) * STEP;
    const cy = (1 - scanRow) * STEP;
    kernelCage.position.set(cx, cy, 0);

    for (let ch = 0; ch < 3; ch++) {
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          const inWin = r >= scanRow && r < scanRow + 3 && c >= scanCol && c < scanCol + 3;
          const cell = inCells[ch][r][c];
          cell.mesh.material = inWin ? cell.activeMat : cell.baseMat;
        }
      }
    }

    for (let k = 0; k < 4; k++) {
      kBtns[k].classList.toggle('active', k === activeKernel);
      const sl = outSlices[k];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const isCur = k === activeKernel && r === scanRow && c === scanCol;
          const cell = sl.grid[r][c];
          cell.mesh.material = isCur ? cell.activeMat : cell.baseMat;
          cell.mesh.scale.setScalar(isCur ? 1.18 : 1.0);
        }
      }
    }

    // Update 3 summation rays from input kernel face -> active output voxel
    const targetZ = (activeKernel - 1.5) * 0.44;
    const targetX = OUT_X + (scanCol - 1) * STEP;
    const targetY = (1 - scanRow) * STEP;
    for (let ch = 0; ch < 3; ch++) {
      const p = rays[ch].geo.attributes.position;
      p.setXYZ(0, IN_X + cx + kernelW * 0.5, cy, (ch - 1) * CH_GAP);
      p.setXYZ(1, targetX - CELL * 0.5, targetY, targetZ);
      p.needsUpdate = true;
    }
  };

  updateHighlight();

  const unsubFrame = s3d.onFrame((dt) => {
    scanTimer += dt;
    if (scanTimer >= 0.95) {
      scanTimer = 0;
      scanCol = (scanCol + 1) % 3;
      if (scanCol === 0) scanRow = (scanRow + 1) % 3;
      updateHighlight();
      s3d.requestRender();
    }
  });

  const syncPhase = (phase) => {
    const revealed = phase === 'reveal';
    choices.hidden = revealed;
    ctrlBar.hidden = !revealed;
    placeholderBox.visible = !revealed;
    labelPlaceholder.setVisible(!revealed);
    outGroup.visible = revealed;
    rayGroup.visible = revealed;
    labelKernel.setVisible(revealed);
    labelOut.setVisible(revealed);

    if (revealed) {
      s3d.focusCamera([0.85, 2.35, 6.8], [0.25, -0.05, 0], 420);
      const ok = userPick === null ? null : userPick === CORRECT;
      shell.showFeedback({
        title: '每核 3×3×3 = 27 权重 · 输出形状 3×3×4（总计 108 权重）',
        body: '一个“3×3 卷积核”深度必须等于输入通道 C_in = 3，把 R/G/B 三个通道的 27 个乘积求和得到单层输出的 1 个像素；使用 4 个独立卷积核就会堆叠出 4 层输出通道。',
        tone: ok === false ? 'danger' : 'success',
      });
    } else {
      userPick = null;
      shell.hideFeedback();
    }
    updateHighlight();
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
