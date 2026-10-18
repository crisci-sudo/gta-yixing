import * as THREE from 'three';

/** Warm late-afternoon light, cheap gradient sky, distance haze. */
export function setupEnvironment(scene, renderer) {
  scene.fog = new THREE.Fog(0xb9c6d8, 190, 620);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(2600, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(0x2b6cb0) },
        mid: { value: new THREE.Color(0x9fc6e8) },
        bottom: { value: new THREE.Color(0xe8d3ad) },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        varying vec3 vP; uniform vec3 top, mid, bottom;
        void main(){
          float h = clamp(vP.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 c = h < 0.52 ? mix(bottom, mid, smoothstep(0.20, 0.52, h)) : mix(mid, top, smoothstep(0.52, 0.95, h));
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
  );
  sky.frustumCulled = false;
  scene.add(sky);

  const sun = new THREE.DirectionalLight(0xfff0d8, 2.1);
  sun.position.set(-160, 210, 120);
  const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x4a4640, 1.15);
  const bounce = new THREE.DirectionalLight(0x8fa8c8, 0.35);
  bounce.position.set(90, 60, -140);
  scene.add(sun, hemi, bounce);

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  return { sun, hemi, sky };
}

/** Distant hills so the plain doesn't run to nothing. */
export function addSkylineRing(scene, radius, count = 46) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshLambertMaterial({ color: 0x515a68 });
  const m = new THREE.InstancedMesh(geo, mat, count);
  const o = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + 0.13;
    const r = radius + (i % 5) * 90;
    const h = 22 + ((i * 61) % 70);
    o.position.set(Math.sin(a) * r, h / 2 - 1, Math.cos(a) * r);
    o.scale.set(34 + (i % 3) * 22, h, 30 + (i % 4) * 18);
    o.rotation.y = a;
    o.updateMatrix();
    m.setMatrixAt(i, o.matrix);
  }
  m.instanceMatrix.needsUpdate = true;
  scene.add(m);
  return m;
}
