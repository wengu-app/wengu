// Wengu component · apiVersion 1
// Interactive ball-and-stick molecule. The molecule, its description and the review question come from ctx.props,
// so the same component serves any small molecule.
//
// learn  : orbit / zoom, hover or tap an atom to see what it is.
// review : atoms are shown uncoloured and unlabelled; the learner clicks the atom the question asks for.
//          The answer is revealed and reported with ctx.submitResult.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const ELEMENTS = {
  H: { name: '氢', en: 'Hydrogen', z: 1, radius: 0.25, light: '#f2f2ef', dark: '#e9e9e6' },
  C: { name: '碳', en: 'Carbon', z: 6, radius: 0.4, light: '#3a3c42', dark: '#8a8f99' },
  N: { name: '氮', en: 'Nitrogen', z: 7, radius: 0.39, light: '#3d64d8', dark: '#6f8ff0' },
  O: { name: '氧', en: 'Oxygen', z: 8, radius: 0.38, light: '#e0453a', dark: '#f05a4c' },
};
const NEUTRAL = { light: '#b9bcc3', dark: '#6d717a' };
const BOND_RADIUS = 0.085;

const CSS = `
.mv { position: relative; overflow: hidden; border-radius: var(--wg-radius-lg); user-select: none; -webkit-user-select: none;
  background:
    radial-gradient(120% 90% at 50% 40%, color-mix(in srgb, var(--wg-color-accent) 7%, var(--wg-color-surface)) 0%, var(--wg-color-surface) 70%);
  touch-action: none; }
.mv canvas { display: block; outline: none; }
.mv-labels { position: absolute; inset: 0; pointer-events: none; }
.mv-label { font: 600 12px/1 var(--wg-font-sans); color: var(--wg-color-text); padding: 3px 6px; border-radius: 999px;
  background: color-mix(in srgb, var(--wg-color-surface-raised) 82%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--wg-color-border) 80%, transparent);
  transition: opacity var(--wg-motion-base) var(--wg-motion-easing); white-space: nowrap; }
.mv-label.h { font-size: 10px; padding: 2px 5px; color: var(--wg-color-text-muted); }
.mv-label.hidden { opacity: 0 !important; }
.mv-panel { position: absolute; left: var(--wg-space-lg); top: var(--wg-space-lg); max-width: min(340px, calc(100% - 2 * var(--wg-space-lg)));
  pointer-events: none; }
.mv-title { font: 600 var(--wg-font-size-xl)/1.2 var(--wg-font-sans); color: var(--wg-color-text); letter-spacing: -0.01em; }
.mv-title small { font-weight: 500; font-size: var(--wg-font-size-sm); color: var(--wg-color-text-muted); margin-left: var(--wg-space-sm); letter-spacing: 0; }
.mv-formula { font: 500 var(--wg-font-size-md)/1.4 var(--wg-font-sans); color: var(--wg-color-text-muted); margin-top: 2px; }
.mv-info { margin-top: var(--wg-space-md); font-size: var(--wg-font-size-sm); line-height: var(--wg-line-height); color: var(--wg-color-text);
  min-height: 3em; transition: opacity var(--wg-motion-fast) var(--wg-motion-easing); }
.mv-info b { font-weight: 600; }
.mv-legend { position: absolute; left: var(--wg-space-lg); bottom: var(--wg-space-lg); display: flex; gap: var(--wg-space-md);
  font-size: var(--wg-font-size-xs); color: var(--wg-color-text-muted); pointer-events: none; transition: opacity var(--wg-motion-base); }
.mv-legend span { display: inline-flex; align-items: center; gap: 6px; }
.mv-legend i { width: 10px; height: 10px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(0,0,0,.15); }
.mv-hint { position: absolute; right: var(--wg-space-lg); bottom: var(--wg-space-lg); font-size: var(--wg-font-size-xs);
  color: var(--wg-color-text-muted); pointer-events: none; }
.mv-question { position: absolute; left: 50%; top: var(--wg-space-lg); transform: translateX(-50%); text-align: center;
  padding: var(--wg-space-md) var(--wg-space-xl); border-radius: var(--wg-radius-md); pointer-events: none;
  background: color-mix(in srgb, var(--wg-color-surface-raised) 90%, transparent); backdrop-filter: blur(8px);
  box-shadow: 0 0 0 1px var(--wg-color-border), 0 8px 24px rgba(0,0,0,.06); max-width: calc(100% - 2 * var(--wg-space-lg)); }
.mv-question .q { font: 600 var(--wg-font-size-lg)/1.35 var(--wg-font-sans); color: var(--wg-color-text); }
.mv-question .sub { font-size: var(--wg-font-size-xs); color: var(--wg-color-text-muted); margin-top: 4px; }
.mv-feedback { position: absolute; left: 50%; bottom: var(--wg-space-lg); transform: translate(-50%, 12px); opacity: 0;
  display: flex; gap: var(--wg-space-md); align-items: flex-start; max-width: min(460px, calc(100% - 2 * var(--wg-space-lg)));
  padding: var(--wg-space-md) var(--wg-space-lg); border-radius: var(--wg-radius-md); font-size: var(--wg-font-size-sm);
  background: var(--wg-color-surface-raised); color: var(--wg-color-text);
  box-shadow: 0 0 0 1px var(--wg-color-border), 0 12px 32px rgba(0,0,0,.10);
  transition: opacity var(--wg-motion-base) var(--wg-motion-easing), transform var(--wg-motion-base) var(--wg-motion-easing); }
.mv-feedback.show { opacity: 1; transform: translate(-50%, 0); }
.mv-feedback .badge { flex: none; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center;
  color: #fff; font-weight: 700; font-size: 13px; }
.mv-feedback.ok .badge { background: var(--wg-color-success); }
.mv-feedback.bad .badge { background: var(--wg-color-danger); }
`;

export async function mount(root, ctx) {
  const props = ctx.props;
  const atomsIn = Array.isArray(props.atoms) ? props.atoms : [];
  const bondsIn = Array.isArray(props.bonds) ? props.bonds : [];
  if (atomsIn.length === 0) throw new Error('props.atoms is empty');
  const review = ctx.mode === 'review' && props.question && props.question.answer;
  const scheme = () => ctx.theme.scheme;

  // ---------------------------------------------------------------- DOM
  const style = document.createElement('style');
  style.textContent = CSS;
  const el = document.createElement('div');
  el.className = 'mv';
  root.append(style, el);

  const panel = div('mv-panel');
  panel.innerHTML = `<div class="mv-title"></div><div class="mv-formula"></div><div class="mv-info"></div>`;
  panel.querySelector('.mv-title').innerHTML = `${esc(props.name ?? '')}<small>${esc(props.nameEn ?? '')}</small>`;
  panel.querySelector('.mv-formula').textContent = props.formula ?? '';
  const info = panel.querySelector('.mv-info');
  const defaultInfo = esc(props.description ?? '');
  info.innerHTML = defaultInfo;

  const present = [...new Set(atomsIn.map((a) => a.el))].filter((s) => ELEMENTS[s]);
  const legend = div('mv-legend');
  const hint = div('mv-hint');
  hint.textContent = '拖动旋转 · 滚轮缩放 · 点按原子';

  // ---------------------------------------------------------------- three.js setup
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  el.append(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = 'mv-labels';
  el.append(labels.domElement, panel, legend, hint);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTexture;
  scene.environmentIntensity = 0.55;

  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(3, 5, 4);
  const rim = new THREE.DirectionalLight(0xffffff, 0.6);
  rim.position.set(-4, -2, -5);
  scene.add(key, rim, new THREE.HemisphereLight(0xffffff, 0x8890a0, 0.35));

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.enablePan = false;
  controls.rotateSpeed = 0.8;
  controls.autoRotate = !review;
  controls.autoRotateSpeed = 0.9;
  controls.addEventListener('start', () => (controls.autoRotate = false));

  // ---------------------------------------------------------------- molecule
  const center = new THREE.Vector3();
  for (const a of atomsIn) center.add(new THREE.Vector3(a.x, a.y, a.z));
  center.divideScalar(atomsIn.length);

  const molecule = new THREE.Group();
  scene.add(molecule);
  const sphereGeo = new THREE.SphereGeometry(1, 64, 40);
  const bondGeo = new THREE.CylinderGeometry(BOND_RADIUS, BOND_RADIUS, 1, 32, 1, true);
  const haloGeo = new THREE.SphereGeometry(1, 48, 32);
  const disposables = [sphereGeo, bondGeo, haloGeo, envTexture, pmrem];

  const material = (color) => {
    const m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.2 });
    disposables.push(m);
    return m;
  };

  const atomColor = (elSym, revealed) =>
    new THREE.Color(revealed ? ELEMENTS[elSym][scheme()] : NEUTRAL[scheme()]);

  let revealed = !review;
  const atoms = atomsIn.map((a, index) => {
    const def = ELEMENTS[a.el] ?? ELEMENTS.C;
    const mesh = new THREE.Mesh(sphereGeo, material(atomColor(a.el, revealed)));
    mesh.position.set(a.x - center.x, a.y - center.y, a.z - center.z);
    mesh.scale.setScalar(def.radius);
    mesh.userData.index = index;
    molecule.add(mesh);

    const label = document.createElement('div');
    label.className = 'mv-label' + (a.el === 'H' ? ' h' : '') + (revealed ? '' : ' hidden');
    label.textContent = a.el;
    const obj = new CSS2DObject(label);
    obj.position.set(0, 0, 0);
    obj.center.set(0.5, 0.5);
    mesh.add(obj);
    return { ...a, def, mesh, label, bonds: 0, hover: 0, targetHover: 0 };
  });

  const bondMeshes = [];
  for (const b of bondsIn) {
    const [i, j, order = 1] = b;
    const A = atoms[i];
    const B = atoms[j];
    if (!A || !B) continue;
    A.bonds += order;
    B.bonds += order;
    const pa = A.mesh.position;
    const pb = B.mesh.position;
    const dir = new THREE.Vector3().subVectors(pb, pa);
    const len = dir.length();
    const mid = new THREE.Vector3().addVectors(pa, pb).multiplyScalar(0.5);
    // Offset multiple bonds sideways, perpendicular to the bond and roughly facing the camera.
    const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 0, 1));
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize().multiplyScalar(BOND_RADIUS * 2.4);
    for (let k = 0; k < order; k++) {
      const off = side.clone().multiplyScalar(k - (order - 1) / 2);
      for (const [atom, from, to] of [
        [A, pa, mid],
        [B, mid, pb],
      ]) {
        const m = new THREE.Mesh(bondGeo, material(atomColor(atom.el, revealed)));
        m.position.addVectors(from, to).multiplyScalar(0.5).add(off);
        m.scale.set(1, len / 2, 1);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
        m.userData.atom = atom;
        molecule.add(m);
        bondMeshes.push(m);
      }
    }
  }

  // Frame the molecule.
  const bounds = new THREE.Sphere();
  new THREE.Box3().setFromObject(molecule).getBoundingSphere(bounds);
  const fitDistance = (0.86 * bounds.radius) / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.set(0.35, 0.45, 1).normalize().multiplyScalar(fitDistance);
  controls.minDistance = fitDistance * 0.45;
  controls.maxDistance = fitDistance * 2.2;
  controls.update();

  // ---------------------------------------------------------------- halos (review feedback)
  const halos = [];
  const addHalo = (atom, color) => {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.BackSide, depthWrite: false });
    disposables.push(m);
    const h = new THREE.Mesh(haloGeo, m);
    h.position.copy(atom.mesh.position);
    h.scale.setScalar(atom.def.radius * 1.55);
    molecule.add(h);
    halos.push({ mesh: h, t0: performance.now(), colorKey: color });
  };

  // ---------------------------------------------------------------- legend & theme
  const renderLegend = () => {
    legend.innerHTML = present
      .map((s) => `<span><i style="background:${ELEMENTS[s][scheme()]}"></i>${s} ${ELEMENTS[s].name}</span>`)
      .join('');
    legend.style.opacity = revealed ? '1' : '0';
  };
  renderLegend();

  let dirty = true;
  const applyColors = (mix = 1) => {
    for (const a of atoms) {
      const from = new THREE.Color(NEUTRAL[scheme()]);
      const to = new THREE.Color(ELEMENTS[a.el]?.[scheme()] ?? NEUTRAL[scheme()]);
      a.mesh.material.color.copy(revealed ? from.lerp(to, mix) : from);
    }
    for (const m of bondMeshes) m.material.color.copy(m.userData.atom.mesh.material.color);
    for (const h of halos) h.mesh.material.color.set(ctx.theme.tokens.color[h.colorKey]);
    dirty = true;
  };
  ctx.onThemeChange(() => {
    applyColors();
    renderLegend();
  });

  // ---------------------------------------------------------------- sizing
  const resize = () => {
    const w = Math.max(1, el.parentElement.clientWidth);
    const h = Math.round(Math.min(560, Math.max(380, w * 0.6)));
    el.style.height = `${h}px`;
    renderer.setSize(w, h);
    labels.setSize(w, h);
    camera.aspect = w / h;
    // Keep the molecule comfortably framed on narrow screens.
    const wide = w >= 560 && !review;
    camera.setViewOffset(w, h, wide ? -w * 0.1 : 0, wide ? -h * 0.02 : -h * 0.04, w, h);
    camera.updateProjectionMatrix();
    dirty = true;
  };
  const ro = new ResizeObserver(resize);
  ro.observe(root);
  resize();

  // ---------------------------------------------------------------- picking
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pick = (ev) => {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(atoms.map((a) => a.mesh), false)[0];
    return hit ? atoms[hit.object.userData.index] : null;
  };

  let hovered = null;
  let selected = null;
  let answered = false;
  const setHover = (atom) => {
    if (hovered === atom) return;
    if (hovered) hovered.targetHover = 0;
    hovered = atom;
    if (atom) atom.targetHover = 1;
    renderer.domElement.style.cursor = atom && !answered ? 'pointer' : '';
    if (!review) describe(atom ?? selected);
  };

  const describe = (atom) => {
    if (!atom) {
      info.innerHTML = defaultInfo;
      return;
    }
    const neighbours = bondsIn
      .filter((b) => b[0] === atoms.indexOf(atom) || b[1] === atoms.indexOf(atom))
      .map((b) => atoms[b[0] === atoms.indexOf(atom) ? b[1] : b[0]].el)
      .sort()
      .join('、');
    info.innerHTML = `<b>${atom.el} · ${atom.def.name}</b>（${atom.def.en}），原子序数 ${atom.def.z}<br>形成 ${atom.bonds} 个共价键，连接 ${neighbours}`;
  };

  const signal = ctx.signal;
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY, t: e.timeStamp }), { signal });
  renderer.domElement.addEventListener('pointermove', (e) => { if (e.buttons === 0) setHover(pick(e)); }, { signal });
  renderer.domElement.addEventListener('pointerleave', () => setHover(null), { signal });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    // Event timestamps, not processing time: a click must still count if the thread was briefly busy.
    const quick = e.timeStamp - down.t < 600;
    down = null;
    if (moved > 6 || !quick) return;
    const atom = pick(e);
    if (review) answer(atom);
    else {
      selected = atom;
      describe(atom);
    }
  }, { signal });

  // ---------------------------------------------------------------- review flow
  let revealStart = 0;
  let feedback = null;
  if (review) {
    const q = div('mv-question');
    q.innerHTML = `<div class="q">${esc(props.question.prompt)}</div><div class="sub">原子已隐去颜色和符号，依据结构判断</div>`;
    el.append(q);
    hint.textContent = '拖动旋转 · 点按作答';
    panel.style.display = 'none';
  }

  function answer(atom) {
    if (answered || !atom) return;
    answered = true;
    setHover(null);
    const target = props.question.answer.element;
    const correct = atom.el === target;
    revealed = true;
    revealStart = performance.now();
    addHalo(atom, correct ? 'success' : 'danger');
    if (!correct) atoms.filter((a) => a.el === target).forEach((a) => addHalo(a, 'success'));
    for (const a of atoms) a.label.classList.remove('hidden');
    renderLegend();

    const t = ELEMENTS[target];
    feedback = div('mv-feedback ' + (correct ? 'ok' : 'bad'));
    feedback.innerHTML = correct
      ? `<span class="badge">✓</span><div><b>正确。</b>${esc(props.question.explanation ?? `这是${t.name}原子（${target}）。`)}</div>`
      : `<span class="badge">✕</span><div>你选的是<b>${atom.def.name}原子（${atom.el}）</b>。${t.name}原子已用绿色标出。${esc(props.question.explanation ?? '')}</div>`;
    el.append(feedback);
    requestAnimationFrame(() => requestAnimationFrame(() => feedback.classList.add('show')));

    ctx.submitResult({
      outcome: correct ? 'correct' : 'incorrect',
      detail: correct ? `点击了${t.name}原子` : `点击了${atom.def.name}原子（${atom.el}），正确答案是${t.name}原子（${target}）`,
      response: { picked: atom.el, atomIndex: atoms.indexOf(atom) },
    });
  }

  // ---------------------------------------------------------------- render loop (renders only when something changes)
  controls.addEventListener('change', () => (dirty = true));
  let lastFrame = performance.now();
  const occluder = new THREE.Raycaster();
  const atomMeshes = atoms.map((a) => a.mesh);
  const viewPos = new THREE.Vector3();
  const centerView = new THREE.Vector3();

  renderer.setAnimationLoop(() => {
    const tNow = performance.now();
    const dt = Math.min((tNow - lastFrame) / 1000, 0.05);
    lastFrame = tNow;
    if (controls.update(dt)) dirty = true;

    for (const a of atoms) {
      if (Math.abs(a.hover - a.targetHover) > 0.001) {
        a.hover += (a.targetHover - a.hover) * Math.min(1, dt * 14);
        a.mesh.scale.setScalar(a.def.radius * (1 + 0.1 * a.hover));
        a.mesh.material.emissive.set(ctx.theme.tokens.color.accent).multiplyScalar(0.28 * a.hover);
        dirty = true;
      }
    }

    if (revealStart) {
      const k = Math.min(1, (performance.now() - revealStart) / 700);
      applyColors(1 - Math.pow(1 - k, 3));
      if (k >= 1) revealStart = 0;
    }
    for (const h of halos) {
      const age = (performance.now() - h.t0) / 1000;
      h.mesh.material.opacity = Math.min(0.42, age * 1.4) * (0.75 + 0.25 * Math.sin(age * 4));
      h.mesh.material.color.set(ctx.theme.tokens.color[h.colorKey]);
      dirty = true;
    }

    if (!dirty) return;
    dirty = false;

    // Labels: hide those whose atom is hidden behind another atom; fade the ones on the far side.
    camera.updateMatrixWorld();
    molecule.updateMatrixWorld();
    centerView.set(0, 0, 0).applyMatrix4(camera.matrixWorldInverse);
    for (const a of atoms) {
      viewPos.setFromMatrixPosition(a.mesh.matrixWorld);
      occluder.set(camera.position, viewPos.clone().sub(camera.position).normalize());
      const first = occluder.intersectObjects(atomMeshes, false)[0];
      const hidden = first && first.object !== a.mesh;
      viewPos.applyMatrix4(camera.matrixWorldInverse);
      const depth = viewPos.z - centerView.z; // > 0: nearer than the centre
      a.label.style.opacity = hidden ? '0' : String(THREE.MathUtils.clamp(0.8 + depth * 0.5, 0.35, 1));
    }

    renderer.render(scene, camera);
    labels.render(scene, camera);
  });

  // Compile shaders before reporting ready. With KHR_parallel_shader_compile this does not block the thread, so the
  // first frame does not stall.
  await renderer.compileAsync(scene, camera);

  return () => {
    renderer.setAnimationLoop(null);
    ro.disconnect();
    controls.dispose();
    for (const d of disposables) d.dispose();
    renderer.dispose();
  };
}

function div(className) {
  const d = document.createElement('div');
  d.className = className;
  return d;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
