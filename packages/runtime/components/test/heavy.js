// Test component: a deliberately heavy scene.
// props.kind: 'gpu' — 40k instanced shaded spheres + a full-screen ray-marching shader each frame;
//             'cpu' — a light scene, but burns props.cpuMsPerFrame ms of JavaScript every frame.
import * as THREE from 'three';

export function mount(root, ctx) {
  const kind = ctx.props.kind ?? 'gpu';
  const w = 800;
  const h = 500;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(2);
  renderer.setSize(w, h);
  root.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 200);
  camera.position.set(0, 0, 40);
  scene.add(new THREE.DirectionalLight(0xffffff, 2), new THREE.AmbientLight(0xffffff, 0.3));

  if (kind === 'gpu') {
    const n = 40_000;
    const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.25, 32, 24), new THREE.MeshPhysicalMaterial({ color: 0x88aaff, clearcoat: 1 }), n);
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      m.makeTranslation((Math.random() - 0.5) * 60, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40);
      mesh.setMatrixAt(i, m);
    }
    scene.add(mesh);
    // Full-screen quad with an expensive fragment shader, drawn behind the spheres.
    const quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: { t: { value: 0 } },
        depthWrite: false,
        depthTest: false,
        vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.999, 1.0); }',
        fragmentShader: `uniform float t;
          void main(){
            vec2 p = gl_FragCoord.xy / 400.0; float a = 0.0;
            for (int i = 0; i < 400; i++) { p = abs(p) / dot(p, p) - vec2(0.9 + 0.01 * sin(t), 0.6); a += length(p) * 0.002; }
            gl_FragColor = vec4(vec3(a), 1.0);
          }`,
      }),
    );
    quad.frustumCulled = false;
    quad.renderOrder = -1;
    scene.add(quad);
    renderer.setAnimationLoop((time) => {
      quad.material.uniforms.t.value = time / 1000;
      mesh.rotation.y = time / 4000;
      renderer.render(scene, camera);
    });
  } else {
    const cube = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshStandardMaterial({ color: 0xff8844 }));
    scene.add(cube);
    const burn = ctx.props.cpuMsPerFrame ?? 40;
    renderer.setAnimationLoop((time) => {
      const end = performance.now() + burn;
      while (performance.now() < end) {}
      cube.rotation.set(time / 1000, time / 1300, 0);
      renderer.render(scene, camera);
    });
  }
  return () => {
    renderer.setAnimationLoop(null);
    renderer.dispose();
  };
}
