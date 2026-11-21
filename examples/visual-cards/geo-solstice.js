/**
 * 高中地理 · 3D 空间立体遮挡卡
 * 主题：地球公转与二分二至日（太阳直射点与极昼 / 极夜判断）
 */
import * as THREE from 'three';
import { createCardShell, pickVariant } from 'wengu/card';
import { createScene3D } from 'wengu/scene3d';

const STYLES = `
.geo-legend {
  position: absolute;
  top: 96px;
  z-index: 3;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 12px;
}
`;

function createEarthTexture(dark) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const g = canvas.getContext('2d');

  // Warm Wengu cobalt ocean gradient
  const grad = g.createLinearGradient(0, 0, 0, 256);
  if (dark) {
    grad.addColorStop(0, '#5a7ea6');
    grad.addColorStop(0.16, '#23599c');
    grad.addColorStop(0.84, '#23599c');
    grad.addColorStop(1, '#5a7ea6');
  } else {
    grad.addColorStop(0, '#d8ebfc');
    grad.addColorStop(0.15, '#3d8bf0');
    grad.addColorStop(0.85, '#3d8bf0');
    grad.addColorStop(1, '#d8ebfc');
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 256);

  // Soft sage-green schematic continents
  g.fillStyle = dark ? '#3e8c67' : '#58b47c';
  const blobs = [
    [95, 86, 46, 30, 0.2],
    [130, 152, 24, 38, -0.2],
    [258, 76, 52, 28, -0.1],
    [252, 134, 34, 42, 0.1],
    [352, 82, 68, 32, 0.08],
    [392, 168, 30, 20, -0.2],
  ];
  for (const [cx, cy, rx, ry, rot] of blobs) {
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
    g.fill();
  }

  // Subtle longitude/latitude grid
  g.strokeStyle = dark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.28)';
  g.lineWidth = 1;
  for (let x = 32; x < 512; x += 32) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 256);
    g.stroke();
  }
  for (let y = 32; y < 256; y += 32) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(512, y);
    g.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function mount(root, ctx) {
  if (!document.getElementById('wg-geo-solstice-css')) {
    const s = document.createElement('style');
    s.id = 'wg-geo-solstice-css';
    s.textContent = STYLES;
    document.head.append(s);
  }

  const variantKey = pickVariant(
    ['summer', 'winter'],
    typeof ctx.props.variant === 'string' || typeof ctx.props.variant === 'number' ? ctx.props.variant : undefined,
  );
  const isSummer = variantKey === 'summer';
  const sunSign = isSummer ? 1 : -1;

  const shell = createCardShell(root, ctx, {
    height: 540,
    kicker: '高中地理 · 地球运动',
    prompt: '观察地轴倾斜方向与极圈明暗：此刻处于哪个节气？',
    subtitle: '拖动旋转地球与太阳光线 · 点击按钮或按 Space 原地揭晓',
    hint: '拖动旋转 · 滚轮缩放',
  });

  const s3d = createScene3D(shell.stage, ctx, {
    height: 540,
    cameraPosition: [sunSign * 0.45, 1.25, 5.65],
    target: [sunSign * 0.42, -0.02, 0],
    minDistance: 3.4,
    maxDistance: 8.5,
  });

  const disposables = [];
  const track = (item) => {
    disposables.push(item);
    return item;
  };

  const R = 1.22;
  const TILT = THREE.MathUtils.degToRad(23.5);
  const TROPIC_LAT = THREE.MathUtils.degToRad(23.5);
  const POLAR_LAT = THREE.MathUtils.degToRad(66.5);

  // Earth system: tilt North pole toward +X
  const earthRoot = new THREE.Group();
  s3d.scene.add(earthRoot);

  const tiltGroup = new THREE.Group();
  tiltGroup.rotation.z = -TILT;
  earthRoot.add(tiltGroup);

  const earthTex = track(createEarthTexture(ctx.theme.scheme === 'dark'));
  const earthGeo = track(new THREE.SphereGeometry(R, 48, 32));
  const earthMat = track(
    new THREE.MeshStandardMaterial({
      map: earthTex,
      roughness: 0.62,
      metalness: 0.04,
    }),
  );
  const earthMesh = new THREE.Mesh(earthGeo, earthMat);
  earthMesh.rotation.y = Math.PI * 0.35;
  tiltGroup.add(earthMesh);

  // Soft translucent atmosphere halo
  const atmoGeo = track(new THREE.SphereGeometry(R * 1.055, 36, 24));
  const atmoMat = track(
    new THREE.MeshBasicMaterial({
      color: '#6bb0ff',
      transparent: true,
      opacity: 0.11,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  earthRoot.add(new THREE.Mesh(atmoGeo, atmoMat));

  // Axis rod & North pole marker
  const axisGeo = track(new THREE.CylinderGeometry(0.024, 0.024, R * 2.7, 16));
  const axisMat = track(new THREE.MeshStandardMaterial({ color: '#7b766c', metalness: 0.35, roughness: 0.4 }));
  tiltGroup.add(new THREE.Mesh(axisGeo, axisMat));

  const poleGeo = track(new THREE.ConeGeometry(0.072, 0.19, 20));
  const poleMat = track(new THREE.MeshStandardMaterial({ color: '#f26a3d', roughness: 0.32 }));
  const northPole = new THREE.Mesh(poleGeo, poleMat);
  northPole.position.y = R * 1.4;
  tiltGroup.add(northPole);

  const addLatRing = (latRad, color, tubeRadius = 0.015) => {
    const r = R * Math.cos(latRad) * 1.008;
    const y = R * Math.sin(latRad);
    const geo = track(new THREE.TorusGeometry(r, tubeRadius, 12, 72));
    const mat = track(new THREE.MeshBasicMaterial({ color }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = y;
    tiltGroup.add(mesh);
    return mesh;
  };

  addLatRing(0, '#f1a62a', 0.018); // Equator
  addLatRing(TROPIC_LAT, '#f26a3d', 0.016); // Tropic of Cancer
  addLatRing(-TROPIC_LAT, '#f26a3d', 0.016); // Tropic of Capricorn
  addLatRing(POLAR_LAT, '#2bc4c4', 0.016); // Arctic Circle
  addLatRing(-POLAR_LAT, '#2bc4c4', 0.016); // Antarctic Circle

  // Physically aligned night hemisphere + terminator line
  const nightGeo = track(new THREE.SphereGeometry(R * 1.014, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2));
  const nightMat = track(
    new THREE.MeshBasicMaterial({
      color: '#1b2740',
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
    }),
  );
  const nightDome = new THREE.Mesh(nightGeo, nightMat);
  nightDome.rotation.z = sunSign * (Math.PI / 2);
  earthRoot.add(nightDome);

  const termGeo = track(new THREE.TorusGeometry(R * 1.02, 0.015, 10, 72));
  const termMat = track(new THREE.MeshBasicMaterial({ color: '#f6c453', transparent: true, opacity: 0.85 }));
  const terminator = new THREE.Mesh(termGeo, termMat);
  terminator.rotation.y = Math.PI / 2;
  earthRoot.add(terminator);

  // Warm Wengu-styled Sun with layered soft halos
  const sunGroup = new THREE.Group();
  sunGroup.position.set(sunSign * 3.0, 0, 0);
  s3d.scene.add(sunGroup);

  const sunGeo = track(new THREE.SphereGeometry(0.36, 32, 24));
  const sunMat = track(
    new THREE.MeshStandardMaterial({
      color: '#f7a531',
      emissive: '#f26a3d',
      emissiveIntensity: 0.55,
      roughness: 0.35,
    }),
  );
  sunGroup.add(new THREE.Mesh(sunGeo, sunMat));

  const halo1Geo = track(new THREE.SphereGeometry(0.46, 28, 20));
  const halo1Mat = track(
    new THREE.MeshBasicMaterial({ color: '#f7b94a', transparent: true, opacity: 0.22, depthWrite: false }),
  );
  sunGroup.add(new THREE.Mesh(halo1Geo, halo1Mat));

  const halo2Geo = track(new THREE.SphereGeometry(0.58, 28, 20));
  const halo2Mat = track(
    new THREE.MeshBasicMaterial({ color: '#f26a3d', transparent: true, opacity: 0.09, depthWrite: false }),
  );
  sunGroup.add(new THREE.Mesh(halo2Geo, halo2Mat));

  const sunPointLight = new THREE.DirectionalLight('#fff4d8', 2.0);
  sunPointLight.position.set(sunSign * 6, 0.4, 0.6);
  s3d.scene.add(sunPointLight);

  // Parallel sun rays with small directional arrowheads
  const raysGroup = new THREE.Group();
  s3d.scene.add(raysGroup);
  const rayMat = track(new THREE.MeshBasicMaterial({ color: '#f1a62a', transparent: true, opacity: 0.78 }));
  const rayGeo = track(new THREE.CylinderGeometry(0.015, 0.015, 1.04, 10));
  rayGeo.rotateZ(Math.PI / 2);
  const rayHeadGeo = track(new THREE.ConeGeometry(0.044, 0.13, 14));
  rayHeadGeo.rotateZ(sunSign * (Math.PI / 2));

  for (const yOff of [-0.62, 0, 0.62]) {
    const ray = new THREE.Mesh(rayGeo, rayMat);
    ray.position.set(sunSign * 2.02, yOff, 0);
    raysGroup.add(ray);

    const head = new THREE.Mesh(rayHeadGeo, rayMat);
    head.position.set(sunSign * 1.48, yOff, 0);
    raysGroup.add(head);
  }

  // Highlighted subsolar ray + surface spot (visible on reveal)
  const directMat = track(new THREE.MeshBasicMaterial({ color: '#f26a3d', transparent: true, opacity: 0 }));
  const directGeo = track(new THREE.CylinderGeometry(0.03, 0.03, 1.48, 12));
  directGeo.rotateZ(Math.PI / 2);
  const directBeam = new THREE.Mesh(directGeo, directMat);
  directBeam.position.set(sunSign * 1.94, 0, 0);
  s3d.scene.add(directBeam);

  const hitSpotGeo = track(new THREE.SphereGeometry(0.085, 20, 16));
  const hitSpotMat = track(new THREE.MeshBasicMaterial({ color: '#f26a3d', transparent: true, opacity: 0 }));
  const hitSpot = new THREE.Mesh(hitSpotGeo, hitSpotMat);
  hitSpot.position.set(sunSign * R * 1.025, 0, 0);
  s3d.scene.add(hitSpot);

  s3d.onFrame((dt) => {
    earthMesh.rotation.y += dt * 0.15;
  });

  // 3D labels
  s3d.addLabel('☀ 太阳平行光线', [sunSign * 2.1, 0.84, 0], { muted: true });
  const northLabelPos = [Math.sin(TILT) * R * 1.54, Math.cos(TILT) * R * 1.54, 0];
  const nMarker = s3d.addLabel('北极 (N)', northLabelPos, { muted: true });

  const directText = isSummer ? '直射北回归线 23°26′N' : '直射南回归线 23°26′S';
  const arcticText = isSummer ? '北极圈极昼（全天有太阳）' : '北极圈极夜（全天黑夜）';
  const antarcticText = isSummer ? '南极圈极夜' : '南极圈极昼';

  const labelDirect = s3d.addLabel(directText, [sunSign * (R + 0.56), -0.24, 0.2], { visible: false });
  const labelArctic = s3d.addLabel(arcticText, [0.32, 1.15, 0.35], { visible: false });
  const labelAntarctic = s3d.addLabel(antarcticText, [-0.35, -1.18, 0.25], { visible: false, muted: true });

  // Legend pill positioned on the side opposite to the Sun
  const legend = document.createElement('div');
  legend.className = 'wg-pill-legend geo-legend';
  legend.style[isSummer ? 'left' : 'right'] = '18px';
  legend.innerHTML =
    '<span><i style="background:#2bc4c4"></i>极圈 66°34′</span>' +
    '<span><i style="background:#f26a3d"></i>回归线 23°26′</span>' +
    '<span><i style="background:#f1a62a"></i>赤道 0°</span>';
  shell.root.append(legend);

  // Tactile Wengu choice buttons (question phase only)
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
          detail: ok ? `正确判断为${label}` : `选了${label}`,
          response: { picked: key, expected: variantKey },
        });
        ctx.requestReveal();
      },
      { signal: ctx.signal },
    );
    return btn;
  };
  choices.append(
    makeChoice('summer', '夏至日 · 直射北回归线'),
    makeChoice('winter', '冬至日 · 直射南回归线'),
  );
  shell.root.append(choices);

  const unsubTheme = ctx.onThemeChange((theme) => {
    const nextTex = track(createEarthTexture(theme.scheme === 'dark'));
    earthMat.map = nextTex;
    earthMat.needsUpdate = true;
    s3d.requestRender();
  });

  const syncPhase = (phase) => {
    const revealed = phase === 'reveal';
    choices.hidden = revealed;
    directBeam.visible = revealed;
    hitSpot.visible = revealed;
    directMat.opacity = revealed ? 0.96 : 0;
    hitSpotMat.opacity = revealed ? 1 : 0;
    labelDirect.setVisible(revealed);
    labelDirect.setHighlighted(revealed);
    labelArctic.setVisible(revealed);
    labelAntarctic.setVisible(revealed);
    nMarker.setVisible(!revealed);

    if (revealed) {
      s3d.focusCamera([sunSign * 0.78, 1.2, 5.35], [sunSign * 0.42, -0.1, 0], 260);
      const ok = userPick === null ? null : userPick === variantKey;
      shell.showFeedback({
        title:
          ok === false
            ? `判断有误 · 正确答案：${isSummer ? '夏至日（6月22日前后）' : '冬至日（12月22日前后）'}`
            : `${isSummer ? '夏至日（6月22日前后）' : '冬至日（12月22日前后）'}`,
        body: isSummer
          ? '太阳直射北回归线（23°26′N）；北极圈及其以北全天白昼（极昼），南极圈极夜。'
          : '太阳直射南回归线（23°26′S）；北极圈及其以北全天黑夜（极夜），南极圈极昼。',
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
    unsubTheme();
    unsubPhase();
    for (const d of disposables) d.dispose();
  };
}
