/**
 * materials.js —— 天体材质与着色器
 *
 * 真实感的来源主要在这里：
 *   · 地球：昼面贴图 + 法线起伏 + 海洋高光（粗糙度图）+ 夜面城市灯光，
 *           昼夜过渡由片元里的太阳方向实时计算，不是一张烘焙好的贴图；
 *   · 大气：两层菲涅耳壳，内层做边缘蓝晕，外层做外逸辉光，只在地球受光侧亮起；
 *   · 太阳：可编程光球层，米粒组织随时间缓慢流动，临边昏暗按视角余弦衰减；
 *   · 月球：真实月面反照率 + 反照率当高度图做凹凸，环形山的阴影感靠这个出来。
 *
 * 所有材质都允许"先建后填"：贴图是异步加载的，先用 1×1 占位纹理顶上，
 * 保证 shader 的 define 从第一次编译就固定下来（否则热替换会导致重编译闪烁）。
 */
import * as THREE from 'three';

/* ---------- 占位纹理 ---------- */

function solidTexture(r, g, b, a = 255, srgb = true) {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1, THREE.RGBAFormat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/* ---------- 通用 ---------- */

/**
 * 自定义着色器不会自动做输出色彩空间转换（three 的内置材质才有那一段），
 * 而渲染目标的输出空间是 sRGB，所以这里手动补一次线性→sRGB。
 * 少了这一步，颜色会被二次压暗，太阳会从"刺眼的白黄"变成"暗橙色的球"。
 */
const OUTPUT_SRGB = 'gl_FragColor.rgb = pow(max(gl_FragColor.rgb, 0.0), vec3(1.0 / 2.2));';

/* ---------- 地球 ---------- */

/**
 * 地球表面材质。
 * 夜面灯光通过 onBeforeCompile 注入到 emissive 项：
 * 用视图空间法线与太阳方向的点积判断昼夜，边界做 0.16 的柔化过渡，
 * 这样晨昏线附近的城市灯光是渐次亮起的，不会出现硬边。
 */
export function createEarthMaterial() {
  const uniforms = {
    uNightMap: { value: solidTexture(0, 0, 0) },
    uSunDirView: { value: new THREE.Vector3(1, 0, 0) },
    uNightIntensity: { value: 1.15 },
    uTerminator: { value: 0.16 },
  };

  const material = new THREE.MeshStandardMaterial({
    map: solidTexture(10, 40, 90),
    normalMap: solidTexture(128, 128, 255, 255, false),
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughnessMap: solidTexture(235, 235, 235, 255, false),
    roughness: 1.0,
    metalness: 0.0,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNightMap = uniforms.uNightMap;
    shader.uniforms.uSunDirView = uniforms.uSunDirView;
    shader.uniforms.uNightIntensity = uniforms.uNightIntensity;
    shader.uniforms.uTerminator = uniforms.uTerminator;

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform sampler2D uNightMap;
         uniform vec3 uSunDirView;
         uniform float uNightIntensity;
         uniform float uTerminator;`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         {
           float sunDot = dot(normalize(normal), normalize(uSunDirView));
           float night = smoothstep(uTerminator, -uTerminator, sunDot);
           // 城市灯光只取亮点，避免整片陆地发灰
           vec3 city = texture2D(uNightMap, vMapUv).rgb;
           city = pow(city, vec3(1.6)) * 2.6;
           totalEmissiveRadiance += city * night * uNightIntensity;
         }`
      );
  };
  // 注入版本与非注入版本要分开缓存，否则切回来会拿到错的 program
  material.customProgramCacheKey = () => 'earth-day-night';

  return { material, uniforms };
}

/** 云层：半透明、比地表转得稍快一点，边缘柔和 */
export function createCloudMaterial() {
  const material = new THREE.MeshStandardMaterial({
    map: null,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    roughness: 1.0,
    metalness: 0.0,
    alphaTest: 0.004,
  });
  material.color.setHex(0xffffff);
  return material;
}

/**
 * 大气壳。fresnel 越大边缘越亮；sun 项让大气只在地球受光侧发亮，
 * 夜面保留极弱的一层，避免边缘被硬生生切断。
 */
export function createAtmosphereMaterial({
  color = 0x6fb4ff, power = 3.2, intensity = 1.5, nightKeep = 0.06, backside = false,
} = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uPower: { value: power },
      uIntensity: { value: intensity },
      uNightKeep: { value: nightKeep },
      uSunDirView: { value: new THREE.Vector3(1, 0, 0) },
    },
    vertexShader: `
      varying vec3 vNormalV;
      varying vec3 vPosV;
      void main() {
        vNormalV = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vPosV = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uPower;
      uniform float uIntensity;
      uniform float uNightKeep;
      uniform vec3 uSunDirView;
      varying vec3 vNormalV;
      varying vec3 vPosV;
      void main() {
        vec3 n = normalize(vNormalV);
        vec3 v = normalize(-vPosV);
        float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), uPower);
        float sun = clamp(dot(n, normalize(uSunDirView)), 0.0, 1.0);
        // 受光侧更亮：瑞利散射在日照方向最强
        float lit = uNightKeep + pow(sun, 0.55) * (1.0 - uNightKeep);
        vec3 col = uColor * fres * lit * uIntensity;
        float alpha = fres * lit * uIntensity;
        gl_FragColor = vec4(col, alpha);
        ${OUTPUT_SRGB}
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: backside ? THREE.BackSide : THREE.FrontSide,
    toneMapped: false,
  });
}

/* ---------- 太阳 ---------- */

/**
 * 光球层：贴图按时间缓慢平移（米粒组织流动），临边按视角余弦做衰减。
 * 真实太阳边缘比中心暗约 60%，指数取 0.55 对应的正是可见光波段的近似曲线。
 */
export function createSunMaterial(map) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: map || null },
      uTime: { value: 0 },
      uLimbDark: { value: 0.68 },
      uBrightness: { value: 1.30 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vPosV;
      void main() {
        vUv = uv;
        vNormalV = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vPosV = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform sampler2D uTex;
      uniform float uTime;
      uniform float uLimbDark;
      uniform float uBrightness;
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vPosV;
      void main() {
        // 米粒组织缓慢流动：纵向几乎不动，横向极慢
        vec2 uv = vUv + vec2(uTime * 0.0035, uTime * 0.0009);
        vec3 base = texture2D(uTex, uv).rgb;

        // 注意是 -vPosV：vPosV 是片元在视图空间的坐标，指向相机的是它的反方向。
        // 写成 +vPosV 会让 mu 恒为 0，整个日面被均匀压暗成橙色。
        float mu = clamp(dot(normalize(vNormalV), normalize(-vPosV)), 0.0, 1.0);
        float limb = 1.0 - uLimbDark * (1.0 - pow(mu, 0.55));

        // 中心偏白热、边缘偏橙红
        vec3 hot = vec3(1.0, 0.97, 0.90);
        vec3 cool = vec3(1.0, 0.58, 0.20);
        vec3 tint = mix(cool, hot, pow(mu, 0.42));

        gl_FragColor = vec4(base * tint * limb * uBrightness, 1.0);
        ${OUTPUT_SRGB}
      }
    `,
    toneMapped: false,
  });
}

/**
 * 色球层 / 临边辉光：贴着日面的一层菲涅耳亮环。
 * 日冕贴图只负责"远处那团雾"，真正刺眼的是紧贴日面边缘的这一圈，
 * 所以单独用一层壳来做，边缘亮、中心被日面挡住。
 */
export function createSunHaloMaterial({ color = 0xffb457, power = 1.7, intensity = 2.6 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uPower: { value: power },
      uIntensity: { value: intensity },
    },
    vertexShader: `
      varying vec3 vNormalV;
      varying vec3 vPosV;
      void main() {
        vNormalV = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vPosV = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uPower;
      uniform float uIntensity;
      varying vec3 vNormalV;
      varying vec3 vPosV;
      void main() {
        vec3 n = normalize(vNormalV);
        vec3 v = normalize(-vPosV);
        float rim = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), uPower);
        gl_FragColor = vec4(uColor * rim * uIntensity, rim);
        ${OUTPUT_SRGB}
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
    toneMapped: false,
  });
}

/**
 * 日冕：叠三层精灵，内层白热、中层橙、外层暗红，衰减指数各不相同，
 * 叠起来接近日冕"内冕—外冕"的真实亮度分布。
 */
export function createCoronaLayers(textures) {
  const group = new THREE.Group();
  const layers = [];
  const conf = [
    { tex: textures.inner, scale: 2.35, opacity: 1.0, rot: 0.02 },
    { tex: textures.mid, scale: 4.10, opacity: 0.55, rot: -0.012 },
    { tex: textures.outer, scale: 7.20, opacity: 0.22, rot: 0.006 },
  ];
  for (const c of conf) {
    const mat = new THREE.SpriteMaterial({
      map: c.tex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      opacity: c.opacity,
      toneMapped: false,
    });
    const s = new THREE.Sprite(mat);
    s.scale.setScalar(c.scale);
    s.userData.rotSpeed = c.rot;
    group.add(s);
    layers.push(s);
  }
  return { group, layers };
}

/* ---------- 月球 ---------- */

/**
 * 月球：真实反照率 + 反照率当凹凸图。
 * 月面没有大气，反照率高的地方多半是环形山壁和辐射纹（地形也高），
 * 所以拿反照率当高度图在视觉上是成立的，比纯平贴图多出明显的立体感。
 */
export function createMoonMaterial() {
  const material = new THREE.MeshStandardMaterial({
    map: null,
    bumpMap: null,
    bumpScale: 0.012,
    // 月面反照率只有 0.12 左右，纯白会显得像雪球，压到 0.85 更接近真实观感
    color: 0xd9d5cf,
    roughness: 0.97,
    metalness: 0.0,
  });
  return material;
}
