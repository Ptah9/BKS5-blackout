/**
 * Пост-обработка в стиле PS1: сцена рисуется в буфер низкого разрешения,
 * затем одним проходом получает квантование цвета, дизеринг 4×4 и зерно.
 *
 * Почему буфер, а не полноэкранный эффект на высоком разрешении: пиксельность
 * нужна бесплатно, а шейдер должен считать в тех же 640 точках, что и картинка,
 * иначе зерно превращается в мелкую пыль.
 */

import * as THREE from 'three';

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // плоскость 2×2 уже в координатах экрана
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uLevels;
  varying vec2 vUv;

  float bayer2(vec2 a) {
    a = floor(a);
    return fract(a.x / 2.0 + a.y * a.y * 0.75);
  }
  float bayer4(vec2 a) {
    return bayer2(0.5 * a) * 0.25 + bayer2(a);
  }
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  void main() {
    vec3 color = texture2D(tDiffuse, vUv).rgb;
    vec2 px = floor(vUv * uResolution);

    // квантование с дизерингом: чем больше уровней, тем мельче нужен узор.
    // при 30 уровнях шахматка закрывала целые области на плавных градиентах
    float dither = (bayer4(px) - 0.5) * 0.35;
    color = floor(color * uLevels + dither + 0.5) / uLevels;

    // плёночное зерно: 10 «кадров» в секунду и очень тихо — иначе это дрожание,
    // а не зерно, и оно перебивает дизеринг
    float grain = hash(px + floor(uTime * 10.0) * 17.0) - 0.5;
    color += grain * 0.012;

    // виньетка: держит взгляд в центре и прячет углы тёмной сцены
    vec2 q = vUv - 0.5;
    color *= 1.0 - dot(q, q) * 0.55;

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`;

export class PostFX {
  private readonly target: THREE.WebGLRenderTarget;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;

  /** Сколько уровней яркости на канал. 56 ≈ 5,8 бита: бандинга нет, шахматки тоже. */
  constructor(width: number, height: number, levels = 56) {
    this.target = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uResolution: { value: new THREE.Vector2(width, height) },
        uTime: { value: 0 },
        uLevels: { value: levels },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  setSize(width: number, height: number): void {
    this.target.setSize(width, height);
    (this.material.uniforms.uResolution.value as THREE.Vector2).set(width, height);
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, time: number): void {
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, camera);

    renderer.setRenderTarget(null);
    this.material.uniforms.tDiffuse.value = this.target.texture;
    this.material.uniforms.uTime.value = time;
    renderer.render(this.quadScene, this.quadCamera);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
