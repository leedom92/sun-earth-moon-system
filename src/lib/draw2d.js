/**
 * draw2d.js —— Canvas 2D 绘制层
 * 负责：月相盘（阴晴圆缺 / 月食）、日面盘（日食）、天空穹顶视图。
 * 这些图形都由真实物理量（日月角距、视半径、影锥角半径）换算而来。
 */
import { D2R, norm360 } from './astro.js';
import moonMapUrl from '../assets/moon_map.jpg';

/* ============ 月相 ============ */
/**
 * 月相盘上"亮面朝向"的屏幕角度。
 *
 * 观察者看到的月面亮边总是朝着太阳，但由于我们抬头看天时东西方向是反的
 * （面南时东在左、西在右），亮边落在左边还是右边取决于月亮在盈还是在亏：
 *   - 北半球：盈月（朔→望）亮右，亏月（望→朔）亮左；
 *   - 南半球：正好相反。
 * elong 为日月黄经差 0~360°（0=朔，180=望），大于 180° 即为亏。
 */
export function brightLimbRot(elongDeg, latDeg = 30) {
  const waxing = norm360(elongDeg) < 180;
  const litRight = latDeg >= 0 ? waxing : !waxing;
  return litRight ? 0 : Math.PI;
}

/**
 * 画出月面。亮面始终朝向太阳（rot 为"从月亮指向太阳"的屏幕角度）。
 * opt.elong    日月角距（度，0=朔 180=望）
 * opt.rot      亮面朝向（弧度，屏幕坐标）
 * opt.eclipse  月食信息（来自 astro.lunarEclipse）
 * opt.detail   是否画环形山细节
 *
 * 大尺寸（月相卡片）直接用真实月面贴图做球面着色，和三维场景里的月球是同一份纹理、
 * 同一套光照模型；小尺寸（天空图上的月球标记）仍走原来的简化画法，避免糊成一团。
 */
export function drawMoonDisk(ctx, cx, cy, R, opt = {}) {
  const elong = opt.elong ?? 0;
  const rot = opt.rot ?? 0;
  const southern = !!opt.southern;
  const cel = lunarEclipseInfo(opt.eclipse);
  const wantReal = opt.detail !== false && R >= 26;
  if (wantReal) ensureMoonMap();
  const useReal = wantReal && !!moonMap;

  ctx.save();
  ctx.translate(cx, cy);
  if (southern) ctx.scale(-1, 1); // 南半球视角：左右镜像

  // 暗面（地照）：整圆盘，很暗
  const dark = ctx.createRadialGradient(-R * 0.25, -R * 0.25, R * 0.1, 0, 0, R);
  dark.addColorStop(0, '#20242e');
  dark.addColorStop(1, '#0e1118');
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fillStyle = dark; ctx.fill();

  if (useReal) {
    // 真实月面：不旋转画布，把"亮面朝向"折进太阳方向里算，
    // 这样月面纹理始终是正立的（真月亮不会因为盈亏把环形山倒过来）
    drawMoonSphere(ctx, R, elong, rot, southern);
  } else {
    ctx.save();
    ctx.rotate(rot);
    // 简化画法：半圆 + 半椭圆裁出亮面
    const cosE = Math.cos(elong * D2R);
    ctx.beginPath();
    ctx.arc(0, 0, R, -Math.PI / 2, Math.PI / 2, false);
    if (cosE >= 0) {
      ctx.ellipse(0, 0, Math.max(0.0001, R * cosE), R, 0, Math.PI / 2, -Math.PI / 2, true);
    } else {
      ctx.ellipse(0, 0, Math.max(0.0001, R * -cosE), R, 0, Math.PI / 2, -Math.PI / 2, false);
    }
    ctx.closePath();
    ctx.save();
    ctx.clip();
    // 亮面质感
    const lit = ctx.createRadialGradient(-R * 0.3, -R * 0.3, R * 0.1, 0, 0, R * 1.15);
    lit.addColorStop(0, '#fffdf3');
    lit.addColorStop(0.55, '#efe9d8');
    lit.addColorStop(1, '#c9c2ad');
    ctx.fillStyle = lit;
    ctx.fillRect(-R, -R, R * 2, R * 2);
    if (opt.detail !== false) drawCraters(ctx, R);
    ctx.restore();

    // 边缘明暗过渡（球面感）
    const rim = ctx.createRadialGradient(0, 0, R * 0.72, 0, 0, R);
    rim.addColorStop(0, 'rgba(0,0,0,0)');
    rim.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fillStyle = rim; ctx.fill();
    ctx.restore();
  }

  // 月食：把地球的本影/半影盖上去（影子的偏移方向跟着太阳走）
  if (cel) {
    ctx.save();
    ctx.rotate(rot);
    drawLunarEclipse(ctx, R, cel);
    ctx.restore();
  }

  ctx.restore();
  // 外圈微光
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
}

/* ============ 真实月面（球面着色） ============ */

let moonMap = null;          // { w, h, data }
let moonMapState = 0;        // 0 未开始 / 1 加载中 / 2 就绪 / 3 失败
const moonDiscCache = new Map();
const moonMapWaiters = [];

/** 贴图到位后回调一次（组件挂载得比图片加载早，需要它来触发重绘） */
export function onMoonMapReady(cb) {
  if (moonMapState === 2) { cb(); return; }
  if (moonMapState === 3) return;
  moonMapWaiters.push(cb);
}

/** 懒加载月面贴图（和三维场景用的是同一张 src/assets/moon_map.jpg） */
function ensureMoonMap() {
  if (moonMapState) return;
  moonMapState = 1;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    moonMap = { w: img.width, h: img.height, data: g.getImageData(0, 0, img.width, img.height).data };
    moonMapState = 2;
    moonDiscCache.clear();
    moonMapWaiters.splice(0).forEach((f) => { try { f(); } catch (e) { /* 忽略重绘异常 */ } });
  };
  img.onerror = () => { moonMapState = 3; };
  img.src = moonMapUrl;
}

/** 双线性采样等距圆柱贴图 */
function sampleMoon(u, v) {
  const { w, h, data } = moonMap;
  const x = u * w - 0.5;
  const y = v * h - 0.5;
  const x0f = Math.floor(x);
  const y0f = Math.floor(y);
  const fx = x - x0f;
  const fy = y - y0f;
  const xa = ((x0f % w) + w) % w;
  const xb = (xa + 1) % w;
  const ya = Math.max(0, Math.min(h - 1, y0f));
  const yb = Math.max(0, Math.min(h - 1, y0f + 1));
  const i00 = (ya * w + xa) * 4;
  const i10 = (ya * w + xb) * 4;
  const i01 = (yb * w + xa) * 4;
  const i11 = (yb * w + xb) * 4;
  for (let k = 0; k < 3; k++) {
    const a = data[i00 + k] + (data[i10 + k] - data[i00 + k]) * fx;
    const b = data[i01 + k] + (data[i11 + k] - data[i01 + k]) * fx;
    sampleMoon.out[k] = a + (b - a) * fy;
  }
  return sampleMoon.out;
}
sampleMoon.out = [0, 0, 0];

/**
 * 预计算球面：屏幕圆盘内每个像素对应月面的哪个点、法线是什么。
 * 只算一次（按直径缓存），之后每帧只做光照。
 */
function buildMoonDisc(size) {
  const R = size / 2;
  const total = size * size;
  const nxyz = new Float32Array(total * 3);  // 每个像素的球面法线（屏幕坐标系：x 右、y 下、z 朝观察者）
  const rgb = new Uint8ClampedArray(total * 3);
  const mask = new Uint8Array(total);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const nx = (x + 0.5 - R) / R;
      const ny = (y + 0.5 - R) / R;          // 屏幕 y 向下
      const r2 = nx * nx + ny * ny;
      if (r2 > 1) continue;
      mask[i] = 1;
      const nz = Math.sqrt(Math.max(0, 1 - r2));
      nxyz[i * 3] = nx;
      nxyz[i * 3 + 1] = ny;
      nxyz[i * 3 + 2] = nz;

      // 正交视角下的球面坐标：正面（贴图中心）朝向观察者
      const lat = Math.asin(-ny);            // 屏幕上方为北
      const lon = Math.atan2(nx, nz);
      const u = 0.5 + lon / (2 * Math.PI);
      const v = 0.5 - lat / Math.PI;
      const c = sampleMoon(u, v);
      rgb[i * 3] = c[0]; rgb[i * 3 + 1] = c[1]; rgb[i * 3 + 2] = c[2];
    }
  }
  return { size, nxyz, rgb, mask, canvas: null, imgData: null, lastKey: '' };
}

/**
 * 球面着色：
 *   · 太阳方向由黄经差与"亮面朝向角 rot"共同决定 —— rot 只说亮边在屏幕的哪一侧，
 *     盈亏程度由 |sin E| 决定，两者不能重复计算（之前就是这里把亏月的影子翻错了面）；
 *   · 用 Lommel-Seeliger 权重 μ₀/(μ₀+μ) 代替纯朗伯 —— 月球是强后向散射体，
 *     满月时整个圆盘亮度几乎均匀，不会像塑料球那样中间亮四周暗。
 */
function drawMoonSphere(ctx, R, elongDeg, rot = 0) {
  const size = Math.max(8, Math.round(R * 2));
  let d = moonDiscCache.get(size);
  if (!d) {
    d = buildMoonDisc(size);
    moonDiscCache.set(size, d);
    if (moonDiscCache.size > 4) {
      const oldest = moonDiscCache.keys().next().value;
      if (oldest !== size) moonDiscCache.delete(oldest);
    }
  }

  const key = `${elongDeg.toFixed(1)}|${rot.toFixed(2)}`;
  if (d.lastKey !== key) {
    d.lastKey = key;
    if (!d.canvas) {
      d.canvas = document.createElement('canvas');
      d.canvas.width = size; d.canvas.height = size;
    }
    if (!d.imgData) d.imgData = d.canvas.getContext('2d').createImageData(size, size);
    const out = d.imgData.data;

    const E = elongDeg * D2R;
    const mag = Math.abs(Math.sin(E));   // 亮面横向张开程度（0=朔望附近，1=上下弦）
    const Lx = mag * Math.cos(rot);      // 太阳在屏幕上的方向
    const Ly = mag * Math.sin(rot);
    const Lz = -Math.cos(E);             // 朝向观察者的分量：满月 +1，新月 -1
    const EDGE = 0.015;                  // 明暗界线的抗锯齿宽度

    for (let i = 0, p = 0; i < d.mask.length; i++, p += 4) {
      if (!d.mask[i]) { out[p + 3] = 0; continue; }
      const nx = d.nxyz[i * 3];
      const ny = d.nxyz[i * 3 + 1];
      const nz = d.nxyz[i * 3 + 2];
      const ndl = nx * Lx + ny * Ly + nz * Lz;
      let a = (ndl + EDGE) / (EDGE * 2);
      a = a < 0 ? 0 : a > 1 ? 1 : a;
      const mu0 = ndl > 0 ? ndl : 0;
      const shade = (2 * mu0) / (mu0 + nz + 0.0001);
      const k = shade * a;
      out[p] = d.rgb[i * 3] * k;
      out[p + 1] = d.rgb[i * 3 + 1] * k;
      out[p + 2] = d.rgb[i * 3 + 2] * k;
      out[p + 3] = 255 * a;
    }
    d.canvas.getContext('2d').putImageData(d.imgData, 0, 0);
  }

  ctx.drawImage(d.canvas, -R, -R);
}


function drawCraters(ctx, R) {
  const pts = [[-0.42, -0.18, 0.17], [-0.1, 0.32, 0.13], [0.3, -0.3, 0.1],
  [0.45, 0.28, 0.15], [-0.3, 0.55, 0.08], [0.05, -0.5, 0.09], [0.22, 0.62, 0.07],
  [-0.62, 0.3, 0.09], [0.6, -0.05, 0.08], [-0.2, -0.62, 0.07]];
  for (const [x, y, r] of pts) {
    const px = x * R, py = y * R, pr = r * R;
    const g = ctx.createRadialGradient(px, py, 0, px, py, pr);
    g.addColorStop(0, 'rgba(150,146,132,0.35)');
    g.addColorStop(0.75, 'rgba(170,166,150,0.15)');
    g.addColorStop(1, 'rgba(255,255,255,0.12)');
    ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fillStyle = g; ctx.fill();
  }
  // 月海
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#8d8878';
  [[-0.35, -0.1, 0.42, 0.3], [0.28, 0.1, 0.36, 0.28], [0.1, -0.42, 0.3, 0.2]].forEach(([x, y, rx, ry]) => {
    ctx.beginPath(); ctx.ellipse(x * R, y * R, rx * R, ry * R, 0.4, 0, Math.PI * 2); ctx.fill();
  });
  ctx.globalAlpha = 1;
}

function lunarEclipseInfo(e) {
  if (!e || !e.type) return null;
  return e;
}

/** 月食：地影（半影 + 本影）覆盖在月面上；全食时呈暗红色（血月） */
function drawLunarEclipse(ctx, R, e) {
  const pxPerDeg = R / (e.rm || 0.26);          // 用月球视半径标定比例
  const sh = e.shadow;
  const sigma = e.sigma;
  // 影锥中心相对月心的偏移：沿"背向太阳"方向（本图 +x 为太阳方向，故取 -x）
  const off = sigma * pxPerDeg;
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.clip();
  // 半影
  if (sh && sh.penAng) {
    const rp = sh.penAng * pxPerDeg;
    const gp = ctx.createRadialGradient(-off, 0, 0, -off, 0, rp);
    gp.addColorStop(0, 'rgba(20,10,25,0.55)');
    gp.addColorStop(0.7, 'rgba(20,10,25,0.28)');
    gp.addColorStop(1, 'rgba(20,10,25,0)');
    ctx.fillStyle = gp;
    ctx.beginPath(); ctx.arc(-off, 0, rp, 0, Math.PI * 2); ctx.fill();
  }
  // 本影
  if (sh && sh.umbraAng) {
    const ru = sh.umbraAng * pxPerDeg;
    const gu = ctx.createRadialGradient(-off, 0, ru * 0.55, -off, 0, ru);
    gu.addColorStop(0, 'rgba(90,25,20,0.92)');
    gu.addColorStop(0.72, 'rgba(75,20,18,0.8)');
    gu.addColorStop(1, 'rgba(60,16,16,0.15)');
    ctx.fillStyle = gu;
    ctx.beginPath(); ctx.arc(-off, 0, ru, 0, Math.PI * 2); ctx.fill();
  }
  // 全食：整盘泛红（地球大气折射的红光），用正片叠底保留月面细节
  if (e.type === 'total') {
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.92;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
    g.addColorStop(0, 'rgb(255,168,130)');
    g.addColorStop(0.6, 'rgb(226,120,96)');
    g.addColorStop(1, 'rgb(168,58,44)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/* ============ 日面（含日食）============ */
/**
 * opt.solar     astro.solarEclipse 的结果
 * opt.dir       月球相对太阳的方向（弧度，屏幕坐标）
 */
export function drawSunDisk(ctx, cx, cy, R, opt = {}) {
  const s = opt.solar;
  const dir = opt.dir ?? 0;
  ctx.save();
  // 光晕 / 日冕
  const glowR = R * (s && s.type ? 2.0 : 1.55);
  const glow = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, glowR);
  glow.addColorStop(0, 'rgba(255,225,140,0.85)');
  glow.addColorStop(0.35, 'rgba(255,190,70,0.30)');
  glow.addColorStop(1, 'rgba(255,160,40,0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(cx, cy, glowR, 0, Math.PI * 2); ctx.fill();

  // 日面
  const body = ctx.createRadialGradient(cx - R * 0.2, cy - R * 0.2, R * 0.1, cx, cy, R);
  body.addColorStop(0, '#fffdf0');
  body.addColorStop(0.6, '#ffe08a');
  body.addColorStop(1, '#ffb43c');
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = body; ctx.fill();

  if (s && s.type) {
    const pxPerDeg = R / (s.rs || 0.267);
    // 中心食（全食/环食）时，站在食带中心看到的是"同心"遮挡；偏食则按实际角距错开
    const central = s.type === 'total' || s.type === 'annular';
    const off = central ? 0 : s.sep * pxPerDeg;
    const mr = R * (s.rm / s.rs);
    // 月球黑影
    ctx.beginPath();
    ctx.arc(cx + Math.cos(dir) * off, cy + Math.sin(dir) * off, mr, 0, Math.PI * 2);
    ctx.fillStyle = '#0b0c10'; ctx.fill();
    // 全食：日冕
    if (s.type === 'total' && s.sep <= s.rm - s.rs) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const cor = ctx.createRadialGradient(cx, cy, R * 0.95, cx, cy, R * 2.1);
      cor.addColorStop(0, 'rgba(255,255,255,0.55)');
      cor.addColorStop(0.35, 'rgba(220,230,255,0.20)');
      cor.addColorStop(1, 'rgba(200,220,255,0)');
      ctx.fillStyle = cor;
      ctx.beginPath(); ctx.arc(cx, cy, R * 2.1, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
}

/* ============ 天空穹顶视图 ============ */
/**
 * 以观测者为中心的全天图：天顶在圆心，地平线在圆周，北在上、东在左。
 * opt.sunHz / opt.moonHz  {alt, az}
 * opt.stars  [{ra, dec, mag}]
 * opt.elong / opt.eclipse / opt.solar
 */
export function drawSkyChart(ctx, cx, cy, R, opt = {}) {
  const { sunHz, moonHz, stars = [], jd, lat, lonEast } = opt;
  ctx.save();
  ctx.translate(cx, cy);
  // 天空底色（夜/昼过渡）
  const sunAlt = sunHz ? sunHz.alt : -90;
  const dayness = Math.max(0, Math.min(1, (sunAlt + 12) / 18));
  const bg = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
  const top = mixColor([6, 10, 26], [70, 130, 200], dayness);
  const edge = mixColor([14, 20, 44], [150, 190, 230], dayness);
  bg.addColorStop(0, `rgb(${top.join(',')})`);
  bg.addColorStop(1, `rgb(${edge.join(',')})`);
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fillStyle = bg; ctx.fill();
  ctx.save();
  ctx.clip();

  // 星
  if (dayness < 0.98 && opt.horizonFn) {
    for (const st of stars) {
      const hz = opt.horizonFn(st.ra, st.dec);
      if (hz.alt < 0) continue;
      const p = altAzToXY(hz.alt, hz.az, R);
      const a = (1 - dayness) * st.mag;
      ctx.fillStyle = `rgba(${st.c},${a.toFixed(2)})`;
      const rr = st.r * (1 - dayness * 0.4);
      ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, Math.PI * 2); ctx.fill();
    }
  }

  // 高度圈与方位网格
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  for (const al of [30, 60]) {
    ctx.beginPath(); ctx.arc(0, 0, R * (1 - al / 90), 0, Math.PI * 2); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(-R, 0); ctx.lineTo(R, 0); ctx.moveTo(0, -R); ctx.lineTo(0, R); ctx.stroke();

  ctx.restore();

  // 地平圈
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.stroke();

  // 方位标注
  ctx.fillStyle = 'rgba(220,232,255,0.75)';
  ctx.font = `600 ${Math.round(R * 0.11)}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const dirs = [['北', 0], ['东', 90], ['南', 180], ['西', 270]];
  for (const [t, az] of dirs) {
    const p = altAzToXY(-4, az, R);
    ctx.fillText(t, p.x, p.y);
  }

  // 太阳
  if (sunHz && sunHz.alt > -2) {
    const p = altAzToXY(Math.max(sunHz.alt, 0), sunHz.az, R);
    const sr = Math.max(5, R * 0.055);
    drawSunDisk(ctx, p.x, p.y, sr, { solar: opt.solar && opt.solar.type ? opt.solar : null, dir: opt.sunDir || 0 });
  }
  // 月亮
  if (moonHz && moonHz.alt > -2) {
    const p = altAzToXY(Math.max(moonHz.alt, 0), moonHz.az, R);
    const mr = Math.max(7, R * 0.075);
    // 亮面朝向太阳（屏幕坐标）
    let rot = 0;
    if (sunHz) {
      const sp = altAzToXY(Math.max(sunHz.alt, 0), sunHz.az, R);
      rot = Math.atan2(sp.y - p.y, sp.x - p.x);
    }
    drawMoonDisk(ctx, p.x, p.y, mr, { elong: opt.elong, rot, eclipse: opt.eclipse, detail: false });
  }
  ctx.restore();
}

/** 地平坐标 → 全天图坐标（天顶在中心；北在上、东在左） */
export function altAzToXY(alt, az, R) {
  const r = R * (1 - Math.max(-5, Math.min(90, alt)) / 90);
  const a = az * D2R;
  return { x: -r * Math.sin(a), y: -r * Math.cos(a) };
}

function mixColor(a, b, t) {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
}

/** 生成一批固定的恒星（赤道坐标），用于天空图 */
export function makeStars(n = 260, seed = 20260101) {
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const out = [];
  for (let i = 0; i < n; i++) {
    const ra = rnd() * Math.PI * 2;
    const dec = Math.asin(2 * rnd() - 1);
    const bright = rnd();
    out.push({
      ra, dec,
      mag: 0.25 + (1 - bright) * 0.75,
      r: bright > 0.93 ? 1.8 : bright > 0.7 ? 1.2 : 0.8,
      c: bright > 0.9 ? '190,210,255' : bright < 0.15 ? '255,225,200' : '255,255,255',
    });
  }
  return out;
}
