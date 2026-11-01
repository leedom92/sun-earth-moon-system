/**
 * scene3d.js —— three.js 三维场景（日—地—月）
 *
 * 说明：为了能在一屏里同时看清太阳、地球和月球，场景对"距离"做了压缩：
 *   - 地球与月球的大小、以及两者的距离比例，尽量接近真实；
 *   - 太阳到地球的距离被大幅压缩（真实约为地月距离的 389 倍），太阳半径也放大。
 * 因此"影锥"的长度、月相与食的判定全部由 astro.js 的真实物理量换算，
 * 不依赖三维场景里的几何比例。界面上会明确标注这一点。
 *
 * 光照用的是放在太阳位置的点光源：
 *   - 平行光只能投出"柱状"阴影，月食时月球会整体骤黑；
 *   - 点光源从 105 个场景单位外的太阳发出，光线有 3° 左右的发散角，
 *     地球本影会自然收敛成锥形，月球进入本影的过程、日食时投在地表的月影
 *     都能被真实阴影贴图算出来，不需要额外伪造。
 */
import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import {
  makeEarthTexture, makeMoonTexture, makeSunTexture, makeCoronaTexture, makeStarTexture,
  loadTextures,
} from './textures.js';
import {
  createEarthMaterial, createCloudMaterial, createAtmosphereMaterial,
  createSunMaterial, createSunHaloMaterial, createCoronaLayers, createMoonMaterial,
} from './materials.js';
import { R_EARTH, R_MOON, D2R } from './astro.js';

/* ===== 场景比例常量 ===== */
const SUN_DIST = 105;                     // 日地距离（场景单位，已压缩）
const EARTH_R = 1.6;
const MOON_R = EARTH_R * (R_MOON / R_EARTH);
const MOON_DIST0 = 15;                    // 地月平均距离（场景单位）
const SUN_R = 6.0;
const MEAN_MOON_KM = 384400;

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const ecl = (lon, lat, r = 1) => V3(r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), -r * Math.cos(lat) * Math.sin(lon));
/** 黄道面上的圆环（用于轨道线） */
function circleGeom(r, n) {
  const g = new THREE.BufferGeometry();
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    arr[i * 3] = Math.cos(t) * r;
    arr[i * 3 + 1] = 0;
    arr[i * 3 + 2] = -Math.sin(t) * r;
  }
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  return g;
}

/**
 * 探测当前环境有没有可用的 WebGL。
 * 用一张临时画布试，避免把真正要用的画布"污染"掉
 *（一旦某个画布 getContext 失败，后续对它的同类型请求都会继续返回 null）。
 */
export function isWebGLAvailable() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch (e) {
    return false;
  }
}

/** 创建渲染器；驱动差异较大时逐级降级，实在不行就抛出 WEBGL_UNAVAILABLE */
function makeRenderer(canvas) {
  if (!isWebGLAvailable()) {
    const err = new Error('WEBGL_UNAVAILABLE');
    err.code = 'WEBGL_UNAVAILABLE';
    throw err;
  }
  const attempts = [
    { canvas, antialias: true, preserveDrawingBuffer: true },
    { canvas, antialias: false, preserveDrawingBuffer: true },
    { canvas, antialias: false, preserveDrawingBuffer: false, powerPreference: 'low-power' },
  ];
  let lastErr = null;
  for (const attr of attempts) {
    try {
      return new THREE.WebGLRenderer(attr);
    } catch (e) {
      lastErr = e;
    }
  }
  const err = new Error('WEBGL_UNAVAILABLE');
  err.code = 'WEBGL_UNAVAILABLE';
  err.cause = lastErr;
  throw err;
}

export function createScene3D(canvas, opts = {}) {
  /* ---------- 渲染器 ---------- */
  const renderer = makeRenderer(canvas);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));

  // 显卡驱动异常 / 显存不足时上下文会丢失：交给上层切换到二维备用视图
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    if (opts.onContextLost) opts.onContextLost();
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // 真实感的关键一步：高光不再直接截断成死白，太阳附近有过渡
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 4000);
  camera.position.set(30, 40, 90);

  // 注意：OrbitControls 在下面（拖动拾取之后）才创建，
  // 这样"抓住天体拖动"时可以先把它禁用，避免视角跟着转。
  let controls;

  /* ---------- 灯光 ---------- */
  // 点光源放在太阳中心：distance=0 表示不按距离衰减（场景距离是压缩过的，
  // 真按平方反比衰减，地球会暗到看不见），decay 同理。
  const sunLight = new THREE.PointLight(0xfff4e0, 3.4, 0, 0);
  sunLight.castShadow = true;
  // 立方体阴影：1024 在这个尺度下每个纹素约 0.2 场景单位，晨昏线附近的自阴影
  // 会按纹素大小露出扇形锯齿，所以提到 2048，并给足 normalBias 压掉自阴影 acne。
  sunLight.shadow.mapSize.set(2048, 2048);
  const shCam = sunLight.shadow.camera;
  shCam.near = 1; shCam.far = 400;
  shCam.updateProjectionMatrix();
  sunLight.shadow.bias = -0.0006;
  sunLight.shadow.normalBias = 0.1;
  sunLight.shadow.radius = 2;
  scene.add(sunLight);
  // 银河/星光级别的微弱环境光，只为了让夜面不至于纯黑一片
  scene.add(new THREE.AmbientLight(0x5f7bb0, 0.085));

  /* ---------- 星空 ---------- */
  const starTex = new THREE.CanvasTexture(makeStarTexture());
  starTex.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 64, 32),
    new THREE.MeshBasicMaterial({ map: starTex, side: THREE.BackSide, toneMapped: false })
  );
  scene.add(sky);

  /* ---------- 太阳 ---------- */
  const sunTex = new THREE.CanvasTexture(makeSunTexture(512, 256));
  sunTex.colorSpace = THREE.SRGBColorSpace;
  sunTex.wrapS = THREE.RepeatWrapping;
  const sunMat = createSunMaterial(sunTex);
  const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(SUN_R, 64, 48), sunMat);
  // 色球层的临边辉光：紧贴日面的一圈亮环
  const sunHalo = new THREE.Mesh(
    new THREE.SphereGeometry(SUN_R * 1.045, 64, 48),
    createSunHaloMaterial({ color: 0xffb457, power: 1.5, intensity: 2.2 })
  );
  sunMesh.add(sunHalo);
  const corona = createCoronaLayers({
    inner: new THREE.CanvasTexture(makeCoronaTexture(256, 2.9)),
    mid: new THREE.CanvasTexture(makeCoronaTexture(320, 2.2)),
    outer: new THREE.CanvasTexture(makeCoronaTexture(384, 1.55)),
  });
  corona.layers.forEach((s, i) => {
    s.material.map.colorSpace = THREE.SRGBColorSpace;
    s.scale.setScalar(SUN_R * [2.9, 5.2, 9.0][i]);
  });
  sunMesh.add(corona.group);
  scene.add(sunMesh);

  /* ---------- 地球 ---------- */
  const earthOrbit = new THREE.Group();          // 位置：绕日公转
  const earthTilt = new THREE.Group();           // 自转轴倾角 23.44°
  const earthSpin = new THREE.Group();           // 自转
  const { material: earthMat, uniforms: earthUniforms } = createEarthMaterial();
  const earthMesh = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R, 96, 64), earthMat);
  earthMesh.castShadow = true; earthMesh.receiveShadow = true;

  // 云层：紧贴地表的一层半透明壳，比地表转得略快（真实大气环流就是这样）
  const cloudMat = createCloudMaterial();
  const cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R * 1.012, 64, 48), cloudMat);
  cloudMesh.castShadow = false; cloudMesh.receiveShadow = false;

  // 大气：内层薄薄的边缘蓝，外层更大范围的外逸辉光
  const atmoInnerMat = createAtmosphereMaterial({
    color: 0x5ea8ff, power: 3.6, intensity: 1.35, nightKeep: 0.05,
  });
  const atmoInner = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R * 1.016, 64, 48), atmoInnerMat);
  const atmoOuterMat = createAtmosphereMaterial({
    color: 0x3b74ff, power: 2.1, intensity: 0.5, nightKeep: 0.12, backside: true,
  });
  const atmoOuter = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R * 1.11, 48, 32), atmoOuterMat);

  earthSpin.add(earthMesh, cloudMesh);
  earthTilt.add(earthSpin, atmoInner, atmoOuter);
  earthOrbit.add(earthTilt);
  scene.add(earthOrbit);
  // 地轴方向：黄经 90°、黄纬 66.56°
  const pole = ecl(90 * D2R, 66.56 * D2R);
  earthTilt.quaternion.setFromUnitVectors(V3(0, 1, 0), pole);

  /* ---------- 月球 ---------- */
  const moonMat = createMoonMaterial();
  const moonPivot = new THREE.Group();   // 位置 + 潮汐锁定朝向
  const moonSpin = new THREE.Group();    // 自转 + 天平动
  const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(MOON_R, 64, 48), moonMat);
  moonMesh.castShadow = true; moonMesh.receiveShadow = true;
  moonSpin.add(moonMesh);
  moonPivot.add(moonSpin);
  scene.add(moonPivot);

  /* ---------- 贴图（异步）---------- */
  // 先用占位纹理渲染，真实影像到位后直接替换；加载失败则退回程序化贴图
  const anisotropy = renderer.capabilities.getMaxAnisotropy();
  loadTextures({ anisotropy }).then((t) => {
    if (t) {
      earthMat.map = t.earthDay;
      earthMat.normalMap = t.earthNormal;
      earthMat.roughnessMap = t.earthRough;
      earthMat.needsUpdate = true;
      earthUniforms.uNightMap.value = t.earthLights;
      cloudMat.map = t.earthClouds;
      cloudMat.needsUpdate = true;
      moonMat.map = t.moonMap;
      moonMat.bumpMap = t.moonMap;
      moonMat.needsUpdate = true;
    } else {
      fallbackTextures();
    }
  }).catch(() => fallbackTextures());

  function fallbackTextures() {
    const day = new THREE.CanvasTexture(makeEarthTexture(1024, 512));
    day.colorSpace = THREE.SRGBColorSpace;
    day.anisotropy = anisotropy;
    earthMat.map = day;
    earthMat.normalMap = null;
    earthMat.roughnessMap = null;
    earthMat.needsUpdate = true;

    const moon = new THREE.CanvasTexture(makeMoonTexture(1024, 512));
    moon.colorSpace = THREE.SRGBColorSpace;
    moon.anisotropy = anisotropy;
    moonMat.map = moon;
    moonMat.bumpMap = moon;
    moonMat.needsUpdate = true;
  }

  /* ---------- 轨道线 ---------- */
  const orbitMat = new THREE.LineBasicMaterial({ color: 0x5fa8ff, transparent: true, opacity: 0.35 });
  const earthOrbitLine = new THREE.LineLoop(circleGeom(SUN_DIST, 256), orbitMat);
  scene.add(earthOrbitLine);
  const N = 180;
  const moonOrbitGeom = new THREE.BufferGeometry();
  moonOrbitGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  const moonOrbitLine = new THREE.LineLoop(moonOrbitGeom,
    new THREE.LineBasicMaterial({ color: 0xffd479, transparent: true, opacity: 0.4 }));
  scene.add(moonOrbitLine);

  // 黄道面网格
  const grid = new THREE.PolarGridHelper(SUN_DIST * 1.25, 12, 6, 96, 0x2a3f66, 0x1e2f4d);
  grid.material.transparent = true; grid.material.opacity = 0.28;
  scene.add(grid);

  /* ---------- 影锥 ---------- */
  // 真实阴影已经由点光源投出来了，这里保留锥体作为"本影/半影边界"的教学示意，
  // 透明度压低，不再和真实阴影抢视觉。
  function unitCone(rTopRatio) {
    // 侧面段数要够密：贴着锥面看时，段数不足会露出多边形的扇形棱边
    const g = new THREE.CylinderGeometry(rTopRatio, 1, 1, 160, 1, true);
    g.translate(0, 0.5, 0);
    return g;
  }
  const coneUmbraGeom = unitCone(0.0001);   // 收缩到一点
  const conePenGeom = unitCone(1.74);       // 发散（地球半影，截断处约为底面 1.74 倍）
  const conePenMoonGeom = unitCone(2.19);   // 月球半影
  function makeCone(geom, color, opacity) {
    const m = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
    }));
    scene.add(m); return m;
  }
  const moonUmbra = makeCone(coneUmbraGeom, 0x0a0a12, 0.34);
  const moonPen = makeCone(conePenMoonGeom, 0x1a1a28, 0.09);
  const earthUmbra = makeCone(coneUmbraGeom, 0x3a2a55, 0.12);
  const earthPen = makeCone(conePenGeom, 0x40305e, 0.05);

  /* ---------- 太阳光线示意 ---------- */
  const rayMat = new THREE.LineBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.18 });
  const rays = new THREE.LineSegments(new THREE.BufferGeometry(), rayMat);
  rays.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 2 * 3), 3));
  scene.add(rays);

  /* ---------- 拾取用的隐形球（方便拖动）---------- */
  const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const earthHit = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R * 3.2, 12, 8), hitMat);
  const moonHit = new THREE.Mesh(new THREE.SphereGeometry(MOON_R * 4.5, 12, 8), hitMat);
  earthOrbit.add(earthHit); scene.add(moonHit);

  /* ---------- 状态 ---------- */
  const state = {
    sunDir: V3(1, 0, 0), earthPos: V3(0, 0, 0), moonPos: V3(0, 0, 0),
    moonDistScene: MOON_DIST0,
    showOrbits: true, showCones: true, showRays: true, showGrid: true,
    spin: 0,
  };
  const tmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), q: new THREE.Quaternion() };
  const YAXIS = V3(0, 1, 0);
  const sunDirView = new THREE.Vector3(1, 0, 0);
  let cloudDrift = 0;

  function update(st) {
    // 1) 位置
    const sunDir = ecl(st.sun.lon, 0);
    const earthPos = sunDir.clone().multiplyScalar(-SUN_DIST);
    const moonDistScene = MOON_DIST0 * (st.moon.dist / MEAN_MOON_KM);
    const moonDir = ecl(st.moon.lon, st.moon.lat);
    const moonPos = earthPos.clone().add(moonDir.clone().multiplyScalar(moonDistScene));

    state.sunDir.copy(sunDir); state.earthPos.copy(earthPos);
    state.moonPos.copy(moonPos); state.moonDistScene = moonDistScene;

    earthOrbit.position.copy(earthPos);
    moonPivot.position.copy(moonPos);
    moonHit.position.copy(moonPos);

    // 潮汐锁定：正面朝向地球。真实月球的自转是匀速的，公转不匀速，
    // 所以"始终同一面朝向地球"只是平均效果，这里按真实天平动量补一点摆动。
    moonPivot.lookAt(earthPos);
    const libLon = -6.29 * Math.sin(st.moon.mp || 0);   // 经度天平动（中心差）
    const libLat = -6.69 * Math.sin(st.moon.F || 0);    // 纬度天平动（自转轴与轨道法向的夹角）
    // SphereGeometry 的 u=0.5（也就是贴图中央的正面）本来落在 +X，
    // 绕 Y 转 90° 才能对准 lookAt 之后的 +Z（朝向地球）
    moonSpin.rotation.set(libLat * D2R, Math.PI / 2 + libLon * D2R, 0);

    // 地球自转（用格林尼治恒星时）
    earthSpin.rotation.y = (st.gmst || 0) * D2R;

    // 月全食时，地球大气把红光折射进影子 → 三维场景里也给它一点暗红自发光
    const mat = moonMat;
    if (st.lunar && st.lunar.type === 'total') {
      mat.emissive.setHex(0x5a1608);
      mat.emissiveIntensity = 0.95;
    } else if (st.lunar && st.lunar.type === 'partial') {
      mat.emissive.setHex(0x2a0b06);
      mat.emissiveIntensity = 0.5;
    } else {
      mat.emissive.setHex(0x000000);
      mat.emissiveIntensity = 0;
    }

    // 2) 光照：点光源就放在太阳中心，不需要逐帧移动；
    //    只需要把太阳方向换算到视图空间，交给地球昼夜与大气着色器
    camera.updateMatrixWorld();
    sunDirView.copy(sunDir).transformDirection(camera.matrixWorldInverse);
    earthUniforms.uSunDirView.value.copy(sunDirView);
    atmoInnerMat.uniforms.uSunDirView.value.copy(sunDirView);
    atmoOuterMat.uniforms.uSunDirView.value.copy(sunDirView);

    // 3) 月球轨道环（含 5.1° 倾角与交点进动）
    updateMoonOrbit(st, earthPos, moonDistScene);

    // 4) 影锥
    updateCones(st, earthPos, moonPos, moonDistScene);

    // 5) 太阳光线示意线
    updateRays(earthPos, moonDistScene);

    earthOrbitLine.visible = state.showOrbits;
    moonOrbitLine.visible = state.showOrbits;
    grid.visible = state.showGrid;
    rays.visible = state.showRays;
    [moonUmbra, moonPen, earthUmbra, earthPen].forEach((c) => { c.renderOrder = 2; });
  }

  function updateMoonOrbit(st, earthPos, moonDistScene) {
    const nodeLon = st.moon.node;                        // 升交点黄经
    const u = ecl(nodeLon, 0);                           // 交点方向
    const eclN = V3(0, 1, 0);
    const normal = u.clone().cross(eclN).normalize();    // 交点处垂直于黄道面的向量
    const nrm = new THREE.Vector3().crossVectors(u, normal).normalize(); // 白道法向
    // 白道面内的一组正交基
    const bx = u.clone();
    const by = new THREE.Vector3().crossVectors(nrm, bx).normalize();
    const pos = moonOrbitGeom.attributes.position;
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      tmp.a.copy(bx).multiplyScalar(Math.cos(t) * moonDistScene)
        .add(tmp.b.copy(by).multiplyScalar(Math.sin(t) * moonDistScene));
      pos.setXYZ(i, earthPos.x + tmp.a.x, earthPos.y + tmp.a.y, earthPos.z + tmp.a.z);
    }
    pos.needsUpdate = true;
    moonOrbitGeom.computeBoundingSphere();
  }

  function updateCones(st, earthPos, moonPos, moonDistScene) {
    const antiSun = state.sunDir.clone().multiplyScalar(-1);
    const q = tmp.q.setFromUnitVectors(YAXIS, antiSun);

    // 月球本影：锥长 L = R月·d日/(R日-R月)，够到地面才是日全食
    const LuKm = st.umbraLen;                                   // km
    const LuScene = moonDistScene * (LuKm / st.moon.dist);
    setCone(moonUmbra, q, moonPos, MOON_R, Math.min(LuScene, moonDistScene * 1.35));
    // 月球半影
    const LpMoonScene = moonDistScene * (372500 / st.moon.dist);
    setCone(moonPen, q, moonPos, MOON_R, Math.min(LpMoonScene, moonDistScene * 1.15));

    // 地球本影 / 半影（真实长度约为地月距离的 3.6 倍，图中截断显示）
    const sh = st.shadow;
    const LuEScene = moonDistScene * (sh.Lu / st.moon.dist);
    const LpEScene = moonDistScene * (sh.Lp / st.moon.dist);
    setCone(earthUmbra, q, earthPos, EARTH_R, Math.min(LuEScene, moonDistScene * 2.6));
    setCone(earthPen, q, earthPos, EARTH_R, Math.min(LpEScene, moonDistScene * 2.6));

    // 相机贴到天体附近时不要画锥体：那时视线基本贴着锥面走，
    // 锥体侧面会变成一道横贯画面的硬边，反而破坏真实感。
    const camToEarth = camera.position.distanceTo(earthPos);
    const camToMoon = camera.position.distanceTo(moonPos);
    const moonConesOn = state.showCones && camToMoon > MOON_R * 4.0;
    const earthConesOn = state.showCones && camToEarth > EARTH_R * 3.4;

    const emph = st.isSolarEclipse || st.isLunarEclipse;
    [moonUmbra, moonPen].forEach((c) => { c.visible = moonConesOn; c.material.opacity = emph ? 0.5 : 0.3; });
    [earthUmbra, earthPen].forEach((c) => { c.visible = earthConesOn; c.material.opacity = emph ? 0.24 : 0.12; });
  }

  function setCone(mesh, q, pos, r, len) {
    mesh.quaternion.copy(q);
    mesh.position.copy(pos);
    mesh.scale.set(r, Math.max(0.001, len), r);
  }

  /** 平行阳光示意：一组环绕地月系统的平行光线 */
  function updateRays(earthPos, moonDistScene) {
    const pos = rays.geometry.attributes.position;
    const anti = state.sunDir.clone().multiplyScalar(-1);
    const side = new THREE.Vector3().crossVectors(anti, V3(0, 1, 0));
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const up = new THREE.Vector3().crossVectors(side, anti).normalize();
    const rad = moonDistScene * 0.42;
    const half = moonDistScene * 1.05;
    let k = 0;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const off = side.clone().multiplyScalar(Math.cos(a) * rad)
        .add(up.clone().multiplyScalar(Math.sin(a) * rad));
      const p0 = earthPos.clone().add(off).add(state.sunDir.clone().multiplyScalar(half));
      const p1 = earthPos.clone().add(off).add(anti.clone().multiplyScalar(half));
      pos.setXYZ(k++, p0.x, p0.y, p0.z);
      pos.setXYZ(k++, p1.x, p1.y, p1.z);
    }
    pos.needsUpdate = true;
    rays.geometry.computeBoundingSphere();
  }

  /* ---------- 视角 ---------- */
  /** 地月系统的中心：取两者中点，这样"地月系统"视图里两颗星都能进画面 */
  const earthMoonMid = () => state.earthPos.clone().add(state.moonPos).multiplyScalar(0.5);
  const views = {
    system: { dist: 270, target: () => V3(0, 0, 0), follow: 'sun', side: true },
    earthmoon: { dist: 28, target: earthMoonMid, follow: 'earth', side: true },
    moon: { dist: 1.5, target: () => state.moonPos.clone(), follow: 'moon' },
    earth: { dist: 4.2, target: () => state.earthPos.clone(), follow: 'earth', side: true },
  };
  let currentView = 'earthmoon';
  let anim = null;
  /** 尽量从"侧上方"观察，这样日月地的相对位置和月球盈亏都能看清 */
  function sideDir() {
    const side = new THREE.Vector3().crossVectors(state.sunDir, YAXIS);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    return side.multiplyScalar(0.86).add(V3(0, 0.5, 0)).normalize();
  }
  function setView(name, animate = true) {
    if (!views[name]) return;
    currentView = name;
    const v = views[name];
    const t = v.target();
    const dir = v.side ? sideDir() : camera.position.clone().sub(controls.target).normalize();
    if (dir.lengthSq() < 1e-6) dir.set(1, 0.6, 1).normalize();
    const np = t.clone().add(dir.multiplyScalar(v.dist));
    if (animate) {
      anim = { from: camera.position.clone(), to: np, fromT: controls.target.clone(), toT: t, t: 0 };
    } else {
      camera.position.copy(np); controls.target.copy(t);
    }
  }

  /* ---------- 拖动天体改变时间 ---------- */
  const raycaster = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  let drag = null;
  function pointerNDC(ev) {
    const r = canvas.getBoundingClientRect();
    ptr.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    ptr.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
  }
  function onDown(ev) {
    pointerNDC(ev);
    raycaster.setFromCamera(ptr, camera);
    const hitM = raycaster.intersectObject(moonHit, false)[0];
    const hitE = raycaster.intersectObject(earthHit, false)[0];
    if (hitM) drag = { body: 'moon' };
    else if (hitE) drag = { body: 'earth' };
    else return;
    controls.enabled = false;
    canvas.style.cursor = 'grabbing';
    canvas.setPointerCapture?.(ev.pointerId);
  }
  function onMove(ev) {
    if (!drag) {
      pointerNDC(ev);
      raycaster.setFromCamera(ptr, camera);
      const over = raycaster.intersectObjects([moonHit, earthHit], false).length > 0;
      canvas.style.cursor = over ? 'grab' : '';
      return;
    }
    pointerNDC(ev);
    raycaster.setFromCamera(ptr, camera);
    const center = drag.body === 'moon' ? state.earthPos : V3(0, 0, 0);
    // 用与视线垂直、过中心且尽量贴近黄道面的平面求交
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(V3(0, 1, 0), center);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, hit)) return;
    const angle = Math.atan2(-(hit.z - center.z), hit.x - center.x); // 黄经
    if (drag.lastAngle === undefined) { drag.lastAngle = angle; return; }
    let d = angle - drag.lastAngle;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    drag.lastAngle = angle;
    const dDeg = d / D2R;
    // 地球公转 0.9856°/天；月球黄经 13.176°/天
    const dt = drag.body === 'moon' ? dDeg / 13.176 : dDeg / 0.9856474;
    if (opts.onDragTime) opts.onDragTime(dt, drag.body);
  }
  function onUp() {
    if (!drag) return;
    drag = null; controls.enabled = true; canvas.style.cursor = '';
  }
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointerleave', onUp);

  /* ---------- 轨道控制器（在拖动拾取之后创建）---------- */
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.55;
  controls.maxDistance = 800;
  controls.enablePan = false;

  /* ---------- 渲染 ---------- */
  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  function render(dt = 0.016) {
    if (anim) {
      anim.t = Math.min(1, anim.t + dt * 2.2);
      const e = 1 - Math.pow(1 - anim.t, 3);
      camera.position.lerpVectors(anim.from, anim.to, e);
      controls.target.lerpVectors(anim.fromT, anim.toT, e);
      if (anim.t >= 1) anim = null;
    }
    // 视角跟随（避免地球跑出画面）
    if (!anim && views[currentView].follow !== 'sun') {
      const t = views[currentView].target();
      const delta = t.clone().sub(controls.target).multiplyScalar(0.25);
      controls.target.add(delta);
      camera.position.add(delta);
    }
    // 太阳表面米粒组织的流动
    sunMat.uniforms.uTime.value += dt;
    // 云层相对地表缓慢漂移
    cloudDrift += dt * 0.006;
    cloudMesh.rotation.y = cloudDrift;
    // 日冕各层转速不同，叠出一点闪烁感
    for (const s of corona.layers) {
      s.material.rotation += dt * s.userData.rotSpeed;
    }
    controls.update();
    renderer.render(scene, camera);
  }
  /** 把天体位置投影到屏幕像素坐标，供 HTML 标签使用 */
  function project(name) {
    const p = name === 'sun' ? sunMesh.position : name === 'earth' ? state.earthPos : state.moonPos;
    const v = p.clone().project(camera);
    const r = canvas.getBoundingClientRect();
    return {
      x: (v.x * 0.5 + 0.5) * r.width,
      y: (-v.y * 0.5 + 0.5) * r.height,
      visible: v.z < 1,
    };
  }
  function setOption(k, v) { if (k in state) state[k] = v; }

  return { update, render, resize, setView, setOption, project, camera, controls, renderer,
    getView: () => currentView,
    setAutoRotate: (b) => { controls.autoRotate = b; controls.autoRotateSpeed = 0.35; } };
}
