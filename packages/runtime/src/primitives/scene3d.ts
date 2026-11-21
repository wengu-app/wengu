/**
 * Lightweight interactive 3D memory-card builder primitive (`wengu/scene3d`).
 *
 * Wraps Three.js WebGLRenderer, PerspectiveCamera, OrbitControls, RoomEnvironment lighting,
 * CSS2DRenderer spatial annotations, smooth cancellable camera transitions, and drag-safe raycast picking.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { ComponentContext } from '../component-api.ts';
import type { Theme } from '../tokens.ts';

const SCENE_STYLE_ID = 'wg-scene3d-primitive-style';

const SCENE_CSS = `
.wg-scene3d {
  position: relative;
  width: 100%;
  overflow: hidden;
  touch-action: none;
}
.wg-scene3d canvas {
  display: block;
  outline: none;
}
.wg-scene3d-labels {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}
.wg-scene3d-label {
  font: 700 12px/1.2 var(--wg-font-sans);
  color: var(--wg-color-text);
  padding: 4px 10px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--wg-color-surface) 95%, transparent);
  box-shadow:
    inset 0 0 0 2px color-mix(in srgb, var(--wg-color-border) 92%, var(--wg-color-text)),
    0 2px 0 color-mix(in srgb, var(--wg-color-border) 88%, var(--wg-color-text));
  white-space: nowrap;
  pointer-events: none;
  transition: opacity var(--wg-motion-base) var(--wg-motion-easing),
    transform var(--wg-motion-fast) var(--wg-motion-easing),
    background var(--wg-motion-fast) var(--wg-motion-easing),
    color var(--wg-motion-fast) var(--wg-motion-easing);
}
.wg-scene3d-label.muted {
  color: var(--wg-color-text-muted);
  font-weight: 600;
  background: color-mix(in srgb, var(--wg-color-background) 92%, var(--wg-color-surface));
  box-shadow:
    inset 0 0 0 1.5px var(--wg-color-border),
    0 2px 0 var(--wg-color-border);
}
.wg-scene3d-label.highlighted {
  background: var(--wg-color-accent);
  color: var(--wg-color-on-accent);
  box-shadow:
    inset 0 0 0 2px var(--wg-color-accent),
    0 2px 0 color-mix(in srgb, var(--wg-color-accent) 72%, #000);
}
.wg-scene3d-label.tone-good {
  background: var(--wg-color-success);
  color: #ffffff;
  box-shadow:
    inset 0 0 0 2px var(--wg-color-success),
    0 2px 0 color-mix(in srgb, var(--wg-color-success) 72%, #000);
}
.wg-scene3d-label.tone-info {
  background: #3d8bf0;
  color: #ffffff;
  box-shadow:
    inset 0 0 0 2px #3d8bf0,
    0 2px 0 #2b66b5;
}
.wg-scene3d-label.hidden {
  opacity: 0 !important;
}
`;

function ensureSceneStyle(): void {
  if (document.getElementById(SCENE_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = SCENE_STYLE_ID;
  style.textContent = SCENE_CSS;
  document.head.append(style);
}

export interface Scene3DOptions {
  /** Explicit canvas height in px. When omitted, fills container height (min 360px). */
  height?: number;
  fov?: number;
  cameraPosition?: [number, number, number];
  target?: [number, number, number];
  minDistance?: number;
  maxDistance?: number;
  autoRotate?: boolean;
  backgroundAlpha?: boolean;
}

export interface LabelOptions {
  className?: string;
  visible?: boolean;
  muted?: boolean;
}

export interface Scene3DLabel {
  readonly object: CSS2DObject;
  readonly element: HTMLDivElement;
  setVisible(visible: boolean): void;
  setText(text: string): void;
  setHighlighted(highlighted: boolean): void;
  setPosition(position: [number, number, number]): void;
  remove(): void;
}

export interface PickingHandlers {
  onHover?: (hit: THREE.Intersection | null) => void;
  onClick?: (hit: THREE.Intersection | null) => void;
}

export interface Scene3DHandle {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly labels: CSS2DRenderer;
  focusCamera(
    position: [number, number, number],
    target?: [number, number, number],
    durationMs?: number,
  ): void;
  addLabel(text: string, position: [number, number, number], opts?: LabelOptions): Scene3DLabel;
  enablePicking(getTargets: () => THREE.Object3D[], handlers: PickingHandlers): () => void;
  onFrame(fn: (dt: number, elapsed: number) => void): () => void;
  requestRender(): void;
  dispose(): void;
}

interface CameraAnimation {
  startMs: number;
  durationMs: number;
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
}

/** Creates an opinionated Three.js + CSS2DRenderer stage wired to Wengu's theme and lifecycle. */
export function createScene3D(
  container: HTMLElement,
  ctx: ComponentContext,
  options: Scene3DOptions = {},
): Scene3DHandle {
  ensureSceneStyle();

  const wrapper = document.createElement('div');
  wrapper.className = 'wg-scene3d';
  if (options.height !== undefined) {
    wrapper.style.height = `${options.height}px`;
  } else {
    wrapper.style.height = '100%';
    wrapper.style.minHeight = '360px';
  }
  container.append(wrapper);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: options.backgroundAlpha ?? true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  wrapper.append(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = 'wg-scene3d-labels';
  wrapper.append(labels.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTexture;

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.45);
  keyLight.position.set(3.5, 5.5, 4.5);
  const rimLight = new THREE.DirectionalLight(0xffffff, 0.55);
  rimLight.position.set(-4, -2, -5);
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x7c8596, 0.45);
  scene.add(keyLight, rimLight, hemiLight);

  const camera = new THREE.PerspectiveCamera(options.fov ?? 42, 1, 0.1, 200);
  const initialPos = options.cameraPosition ?? [0, 2.1, 5.2];
  const initialTarget = options.target ?? [0, 0, 0];
  camera.position.set(...initialPos);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.enablePan = false;
  controls.rotateSpeed = 0.85;
  controls.target.set(...initialTarget);
  if (options.minDistance !== undefined) controls.minDistance = options.minDistance;
  if (options.maxDistance !== undefined) controls.maxDistance = options.maxDistance;
  controls.autoRotate = Boolean(options.autoRotate);
  controls.update();

  let dirty = true;
  const requestRender = () => {
    dirty = true;
  };

  const applyThemeLighting = (theme: Theme) => {
    const dark = theme.scheme === 'dark';
    scene.environmentIntensity = dark ? 0.5 : 0.65;
    keyLight.intensity = dark ? 1.3 : 1.5;
    hemiLight.intensity = dark ? 0.4 : 0.5;
    renderer.toneMappingExposure = dark ? 1.0 : 1.05;
    dirty = true;
  };
  applyThemeLighting(ctx.theme);
  const unsubTheme = ctx.onThemeChange(applyThemeLighting);

  const resize = () => {
    const w = Math.max(1, wrapper.clientWidth || container.clientWidth || 720);
    const h = Math.max(1, options.height ?? (wrapper.clientHeight || container.clientHeight || 420));
    renderer.setSize(w, h);
    labels.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(wrapper);

  let cameraAnim: CameraAnimation | null = null;
  controls.addEventListener('start', () => {
    controls.autoRotate = false;
    cameraAnim = null;
  });
  controls.addEventListener('change', () => {
    dirty = true;
  });

  const focusCamera = (
    position: [number, number, number],
    target?: [number, number, number],
    durationMs = 500,
  ) => {
    const toPos = new THREE.Vector3(...position);
    const toTarget = target ? new THREE.Vector3(...target) : controls.target.clone();
    if (durationMs <= 0) {
      cameraAnim = null;
      camera.position.copy(toPos);
      controls.target.copy(toTarget);
      controls.update();
      dirty = true;
      return;
    }
    cameraAnim = {
      startMs: performance.now(),
      durationMs,
      fromPos: camera.position.clone(),
      toPos,
      fromTarget: controls.target.clone(),
      toTarget,
    };
    dirty = true;
  };

  const addLabel = (
    text: string,
    position: [number, number, number],
    opts: LabelOptions = {},
  ): Scene3DLabel => {
    const el = document.createElement('div');
    el.className = 'wg-scene3d-label';
    if (opts.className) el.classList.add(...opts.className.split(/\s+/).filter(Boolean));
    if (opts.muted) el.classList.add('muted');
    if (opts.visible === false) el.classList.add('hidden');
    el.textContent = text;

    const obj = new CSS2DObject(el);
    obj.position.set(...position);
    obj.center.set(0.5, 0.5);
    scene.add(obj);
    dirty = true;

    return {
      object: obj,
      element: el,
      setVisible(visible: boolean) {
        el.classList.toggle('hidden', !visible);
        dirty = true;
      },
      setText(nextText: string) {
        el.textContent = nextText;
        dirty = true;
      },
      setHighlighted(highlighted: boolean) {
        el.classList.toggle('highlighted', highlighted);
        dirty = true;
      },
      setPosition(pos: [number, number, number]) {
        obj.position.set(...pos);
        dirty = true;
      },
      remove() {
        obj.removeFromParent();
        el.remove();
        dirty = true;
      },
    };
  };

  const pickingCleanups = new Set<() => void>();
  const enablePicking = (getTargets: () => THREE.Object3D[], handlers: PickingHandlers) => {
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const abort = new AbortController();
    let downState: { x: number; y: number; maxMoved: number } | null = null;
    let lastHover: THREE.Object3D | null = null;

    const hitAt = (ev: PointerEvent): THREE.Intersection | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(getTargets(), false);
      return hits[0] ?? null;
    };

    const sig = abort.signal;
    renderer.domElement.addEventListener(
      'pointerdown',
      (ev) => {
        downState = { x: ev.clientX, y: ev.clientY, maxMoved: 0 };
      },
      { signal: sig },
    );

    renderer.domElement.addEventListener(
      'pointermove',
      (ev) => {
        if (downState) {
          downState.maxMoved = Math.max(
            downState.maxMoved,
            Math.hypot(ev.clientX - downState.x, ev.clientY - downState.y),
          );
          return;
        }
        const hit = hitAt(ev);
        renderer.domElement.style.cursor = hit ? 'pointer' : '';
        const obj = hit?.object ?? null;
        if (obj !== lastHover) {
          lastHover = obj;
          handlers.onHover?.(hit);
        }
      },
      { signal: sig },
    );

    renderer.domElement.addEventListener(
      'pointerleave',
      () => {
        renderer.domElement.style.cursor = '';
        if (lastHover !== null) {
          lastHover = null;
          handlers.onHover?.(null);
        }
      },
      { signal: sig },
    );

    renderer.domElement.addEventListener(
      'pointerup',
      (ev) => {
        if (!downState) return;
        const moved = Math.max(
          downState.maxMoved,
          Math.hypot(ev.clientX - downState.x, ev.clientY - downState.y),
        );
        downState = null;
        if (moved >= 6) return;
        handlers.onClick?.(hitAt(ev));
      },
      { signal: sig },
    );

    renderer.domElement.addEventListener(
      'pointercancel',
      () => {
        downState = null;
      },
      { signal: sig },
    );

    const stop = () => {
      abort.abort();
      pickingCleanups.delete(stop);
      renderer.domElement.style.cursor = '';
    };
    pickingCleanups.add(stop);
    return stop;
  };

  const frameListeners = new Set<(dt: number, elapsed: number) => void>();
  const onFrame = (fn: (dt: number, elapsed: number) => void) => {
    frameListeners.add(fn);
    return () => {
      frameListeners.delete(fn);
    };
  };

  const startMs = performance.now();
  let lastFrameMs = startMs;

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min((now - lastFrameMs) / 1000, 0.05);
    const elapsed = (now - startMs) / 1000;
    lastFrameMs = now;

    if (cameraAnim) {
      const k = Math.min(1, (now - cameraAnim.startMs) / cameraAnim.durationMs);
      const ease = 1 - Math.pow(1 - k, 3);
      camera.position.lerpVectors(cameraAnim.fromPos, cameraAnim.toPos, ease);
      controls.target.lerpVectors(cameraAnim.fromTarget, cameraAnim.toTarget, ease);
      if (k >= 1) cameraAnim = null;
      dirty = true;
    }

    if (controls.update(dt)) dirty = true;

    if (frameListeners.size > 0) {
      for (const fn of [...frameListeners]) fn(dt, elapsed);
      dirty = true;
    }

    if (!dirty) return;
    dirty = false;
    renderer.render(scene, camera);
    labels.render(scene, camera);
  });

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    renderer.setAnimationLoop(null);
    unsubTheme();
    ro.disconnect();
    for (const stop of [...pickingCleanups]) stop();
    frameListeners.clear();
    controls.dispose();
    envTexture.dispose();
    pmrem.dispose();
    renderer.dispose();
    wrapper.remove();
  };
  ctx.signal.addEventListener('abort', dispose, { once: true });

  return {
    scene,
    camera,
    renderer,
    controls,
    labels,
    focusCamera,
    addLabel,
    enablePicking,
    onFrame,
    requestRender,
    dispose,
  };
}
