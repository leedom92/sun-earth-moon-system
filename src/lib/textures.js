/**
 * textures.js —— 天体贴图（真实影像优先，程序化兜底）
 *
 * 真实影像来自 NASA 公开数据（Blue Marble 地表、城市夜灯、云层、LRO 月面），
 * 随包内置成 src/assets 下的静态资源，运行时不联网。
 * 程序化生成的那几个函数保留下来做兜底：图片加载失败时仍然有东西可看，
 * 也方便在没有资源的场景（比如单文件离线版）复用。
 */
import * as THREE from 'three';

import earthDayUrl from '../assets/earth_day.jpg';
import earthNormalUrl from '../assets/earth_normal.jpg';
import earthSpecularUrl from '../assets/earth_specular.jpg';
import earthCloudsUrl from '../assets/earth_clouds.png';
import earthLightsUrl from '../assets/earth_lights.png';
import moonMapUrl from '../assets/moon_map.jpg';

export const TEXTURE_URLS = {
  earthDay: earthDayUrl,
  earthNormal: earthNormalUrl,
  earthSpecular: earthSpecularUrl,
  earthClouds: earthCloudsUrl,
  earthLights: earthLightsUrl,
  moonMap: moonMapUrl,
};

/** 带种子的伪随机 */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 二维值噪声（可循环，保证贴图左右无缝） */
function makeNoise(seed) {
  const rnd = mulberry32(seed);
  const SIZE = 64;
  const grid = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const at = (x, y) => grid[((y % SIZE) + SIZE) % SIZE * SIZE + ((x % SIZE) + SIZE) % SIZE];
  const smooth = (t) => t * t * (3 - 2 * t);
  return (u, v) => { // u,v ∈ [0,1)
    const x = u * SIZE, y = v * SIZE;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = smooth(x - x0), fy = smooth(y - y0);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
  };
}
function fbm(noise, u, v, oct = 5) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    s += amp * noise(u * f, v * f);
    f *= 2; amp *= 0.5;
  }
  return s;
}

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/* ============================================================
 * 纹理加载
 * ============================================================ */

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`贴图加载失败：${url}`));
    img.src = url;
  });
}

function texFromImage(img, { srgb = true, anisotropy = 1 } = {}) {
  const t = new THREE.Texture(img);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/**
 * 把"高光图"（海洋亮、陆地暗）反转成粗糙度图：海洋光滑出反光，陆地粗糙。
 * 直接相减没法在材质里做，这里用离屏画布转一遍。
 */
function roughnessFromSpecular(img) {
  const w = Math.min(img.width, 1024);
  const h = Math.round((img.height / img.width) * w);
  const c = canvasOf(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    // 高光越强 → 越光滑（roughness 越小）
    const spec = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    const rough = 255 - spec;
    px[i] = px[i + 1] = px[i + 2] = rough;
  }
  ctx.putImageData(data, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/**
 * 云层贴图的原图非常"稀"：alpha 均值只有 26/255，七成像素低于 30，
 * 直接用只能看到几缕几乎透明的白丝。这里按 gamma 曲线抬一下透明度，
 * 让云带真正读得出来，同时保留原有的疏密结构（不会变成一张均匀的雾壳）。
 */
function boostCloudAlpha(img, { gamma = 0.58, gain = 1.45 } = {}) {
  const c = canvasOf(img.width, img.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3] / 255;
    if (a <= 0) continue;
    const boost = Math.min(1, Math.pow(a, gamma) * gain);
    px[i + 3] = Math.round(boost * 255);
    // 云顶统一成偏冷的白，避免原图的纯白显得发灰
    px[i] = 255;
    px[i + 1] = 252;
    px[i + 2] = 250;
  }
  ctx.putImageData(data, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/**
 * 异步加载整套贴图。失败时 resolve(null)，由调用方退回程序化版本。
 * 返回里的每个字段都可能为空，取用前要判空。
 */
export async function loadTextures({ anisotropy = 1 } = {}) {
  try {
    const [day, normal, spec, clouds, lights, moon] = await Promise.all([
      loadImage(TEXTURE_URLS.earthDay),
      loadImage(TEXTURE_URLS.earthNormal),
      loadImage(TEXTURE_URLS.earthSpecular),
      loadImage(TEXTURE_URLS.earthClouds),
      loadImage(TEXTURE_URLS.earthLights),
      loadImage(TEXTURE_URLS.moonMap),
    ]);
    return {
      earthDay: texFromImage(day, { anisotropy }),
      earthNormal: texFromImage(normal, { srgb: false, anisotropy }),
      earthRough: roughnessFromSpecular(spec),
      earthClouds: boostCloudAlpha(clouds),
      earthLights: texFromImage(lights, { anisotropy }),
      moonMap: texFromImage(moon, { anisotropy }),
    };
  } catch (e) {
    console.warn('[textures] 真实影像不可用，退回程序化贴图：', e);
    return null;
  }
}

/* ============================================================
 * 程序化兜底
 * ============================================================ */

/** 地球：蓝色海洋 + 绿色/黄褐色陆地 + 两极冰盖 */
export function makeEarthTexture(w = 1024, h = 512) {
  const c = canvasOf(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const noise = makeNoise(20261022);
  const noise2 = makeNoise(7788);
  for (let y = 0; y < h; y++) {
    const lat = 90 - (y / h) * 180;
    const absLat = Math.abs(lat);
    for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      let n = fbm(noise, u, v, 6);
      // 纬度加权：高纬度更容易成陆，赤道附近海洋多一些
      n += 0.12 * Math.sin((lat * Math.PI) / 180) * Math.sin((lat * Math.PI) / 180) * (lat > 0 ? 1 : -1);
      const land = n > 0.52;
      let r, g, b;
      if (land) {
        const dry = fbm(noise2, u, v, 3);
        // 副热带沙漠带 / 高纬苔原
        const desert = absLat > 15 && absLat < 35 && dry > 0.45;
        const tundra = absLat > 58;
        if (tundra) { r = 150; g = 155; b = 140; }
        else if (desert) { r = 196; g = 168; b = 108; }
        else { r = 62 + dry * 60; g = 110 + dry * 50; b = 56 + dry * 30; }
        // 极地冰盖
        if (absLat > 72 + (dry - 0.5) * 12) { r = 240; g = 245; b = 250; }
        else if (absLat > 66) { const t = (absLat - 66) / 8; r += (240 - r) * t; g += (245 - g) * t; b += (250 - b) * t; }
      } else {
        const deep = fbm(noise2, u, v, 3);
        r = 12 + deep * 18; g = 48 + deep * 40; b = 96 + deep * 60;
      }
      const i = (y * w + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // 淡淡的云带
  const cn = makeNoise(4242);
  ctx.globalAlpha = 0.16;
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    const rr = 6 + Math.random() * 26;
    if (cn(x / w, y / h) > 0.55) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  return c;
}

/** 月球：灰色底 + 月海 + 环形山 */
export function makeMoonTexture(w = 1024, h = 512) {
  const c = canvasOf(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const noise = makeNoise(3344);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      let g = 128 + (fbm(noise, u, v, 5) - 0.5) * 58;
      const i = (y * w + x) * 4;
      img.data[i] = g; img.data[i + 1] = g * 0.98; img.data[i + 2] = g * 0.94; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // 月海（暗斑）
  const rnd = mulberry32(99);
  for (let i = 0; i < 22; i++) {
    const x = rnd() * w, y = h * 0.2 + rnd() * h * 0.6;
    const rr = 40 + rnd() * 130;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
    g.addColorStop(0, 'rgba(70,70,76,0.55)');
    g.addColorStop(1, 'rgba(70,70,76,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(x, y, rr, rr * (0.6 + rnd() * 0.5), rnd() * 3, 0, Math.PI * 2); ctx.fill();
  }
  // 环形山
  for (let i = 0; i < 320; i++) {
    const x = rnd() * w, y = rnd() * h;
    const rr = 2 + rnd() * rnd() * 22;
    ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(90,90,96,${0.18 + rnd() * 0.25})`; ctx.fill();
    ctx.beginPath(); ctx.arc(x - rr * 0.18, y - rr * 0.18, rr * 0.82, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(215,215,220,${0.18 + rnd() * 0.3})`;
    ctx.lineWidth = Math.max(0.6, rr * 0.12); ctx.stroke();
  }
  return c;
}

/**
 * 太阳光球层：米粒组织 + 黑子 + 临边方向的细微色差。
 * 比原来的纯噪声多了三层：细米粒、中尺度对流、黑子群。
 */
export function makeSunTexture(w = 1024, h = 512) {
  const c = canvasOf(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const fine = makeNoise(5150);     // 米粒
  const mid = makeNoise(8801);      // 中尺度对流
  const big = makeNoise(3120);      // 大尺度不均匀
  const rnd = mulberry32(2026);

  // 黑子：先算出几个圆形区域，中心最暗、外围半影稍亮
  const spots = [];
  for (let i = 0; i < 6; i++) {
    spots.push({
      u: rnd(), v: 0.18 + rnd() * 0.64,
      r: 0.008 + rnd() * 0.02, a: 0.45 + rnd() * 0.4,
    });
  }

  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const g1 = fbm(fine, u, v, 4);
      const g2 = fbm(mid, u * 0.5, v * 0.5, 3);
      const g3 = fbm(big, u * 0.25, v * 0.25, 2);
      // 米粒：亮点 + 暗缝
      let n = 0.42 * g1 + 0.36 * g2 + 0.22 * g3;
      n = Math.pow(n, 0.85);

      // 黑子
      let spot = 0;
      for (const s of spots) {
        let dx = u - s.u;
        if (dx > 0.5) dx -= 1; else if (dx < -0.5) dx += 1;
        const dy = (v - s.v) * 0.5;                 // 纬度方向压缩，保持形状
        const d = Math.hypot(dx, dy) / s.r;
        if (d < 1.6) spot = Math.max(spot, s.a * Math.max(0, 1 - d * d * 0.55));
      }

      const base = 0.82 + n * 0.35;
      const shade = Math.max(0.16, base - spot);
      const i = (y * w + x) * 4;
      // 色温：米粒亮处偏白黄，暗缝偏橙
      img.data[i] = Math.min(255, 255 * shade);
      img.data[i + 1] = Math.min(255, 255 * shade * (0.78 + n * 0.18));
      img.data[i + 2] = Math.min(255, 255 * shade * (0.42 + n * 0.34));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** 径向渐变光晕贴图（用于太阳光晕 / 星点） */
export function makeGlowTexture(size = 256, inner = 'rgba(255,240,180,1)', outer = 'rgba(255,160,40,0)') {
  const c = canvasOf(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.28, 'rgba(255,215,120,0.55)');
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

/**
 * 日冕贴图：比普通光晕多几段色阶，做出"内层亮白金 → 中层橙 → 外层暗红"的层次。
 * power 控制衰减曲线，越大多能量越集中在中心。
 */
export function makeCoronaTexture(size = 512, power = 2.4) {
  const c = canvasOf(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - half) / half;
      const dy = (y - half) / half;
      const r = Math.min(1, Math.hypot(dx, dy));
      const fall = Math.pow(1 - r, power);
      const i = (y * size + x) * 4;
      // 内层偏白，中层橙，外层略偏红
      const t = Math.pow(1 - r, 0.7);
      img.data[i] = 255;
      img.data[i + 1] = Math.round(150 + 100 * t);
      img.data[i + 2] = Math.round(60 + 150 * Math.pow(t, 1.6));
      img.data[i + 3] = Math.round(255 * fall);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** 星空背景贴图（球面全景，避免极点聚集） */
export function makeStarTexture(w = 2048, h = 1024) {
  const c = canvasOf(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#04060c';
  ctx.fillRect(0, 0, w, h);

  // 银河：低频云气在 1/4 分辨率上算完再放大，避免在这里卡住启动
  const sw = 512, sh = 256;
  const small = canvasOf(sw, sh);
  const sctx = small.getContext('2d');
  const simg = sctx.createImageData(sw, sh);
  const cloud = makeNoise(777);
  for (let y = 0; y < sh; y++) {
    const v = y / sh;
    for (let x = 0; x < sw; x++) {
      const u = x / sw;
      // 一条略微起伏的银河带
      const band = Math.exp(-Math.pow((v - 0.5 - 0.12 * Math.sin(u * Math.PI * 2)) / 0.13, 2));
      const n = fbm(cloud, u * 4, v * 4, 5) * band;
      const i = (y * sw + x) * 4;
      simg.data[i] = 4 + n * 26;
      simg.data[i + 1] = 6 + n * 28;
      simg.data[i + 2] = 12 + n * 36;
      simg.data[i + 3] = 255;
    }
  }
  sctx.putImageData(simg, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, w, h);

  const rnd = mulberry32(13579);
  // 暗星为主，少量亮星；亮度按幂律分布，接近真实星等分布。
  // 注意：这张贴图贴在半径 900 的天球上，屏幕上是放大的，
  // 所以半径必须按"贴图像素"给得很小，否则一颗星会糊成一大团光斑。
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * w;
    const y = Math.acos(2 * rnd() - 1) / Math.PI * h;   // 球面均匀分布
    const bright = Math.pow(rnd(), 3.4);                 // 大部分很暗
    const r = 0.16 + bright * 0.85;
    const a = 0.16 + bright * 0.84;
    const tint = rnd();
    ctx.fillStyle = tint > 0.86
      ? `rgba(186,208,255,${a})`
      : tint < 0.14 ? `rgba(255,222,190,${a})` : `rgba(255,255,255,${a})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    // 亮星带一点点光晕（半径同样要克制）
    if (bright > 0.72) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.8);
      g.addColorStop(0, `rgba(255,255,255,${a * 0.3})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r * 2.8, 0, Math.PI * 2); ctx.fill();
    }
  }
  return c;
}
