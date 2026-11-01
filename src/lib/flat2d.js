/**
 * flat2d.js —— 三维场景不可用时的二维示意图（备用视图）
 *
 * 什么时候会走到这里：浏览器没有可用的 WebGL（图形加速被关闭、被企业策略禁用、
 * 显卡驱动异常、远程桌面/虚拟机环境等），three.js 无法创建渲染上下文。
 * 这时不把画面留成一块黑，而是用 Canvas 2D 画一张"俯视黄道面"的示意图：
 * 阳光来自左侧，地球居中，月球按真实黄经差绕地球排列，影锥方向与月相都来自
 * astro.js 的真实计算，所以读数、盈亏、食的判断依然是对的。
 */
import { drawMoonDisk, drawSunDisk } from './draw2d.js';
import { D2R } from './astro.js';

/** 各视角的缩放（数值越大越"近"） */
const ZOOM = { system: 0.92, earthmoon: 1, earth: 2.7, moon: 4.2 };

/** 归一化坐标（以画布短边为 1）：地球在原点，太阳在左 */
const SUN_X = -0.46;
const SUN_R = 0.055;
const EARTH_R = 0.043;
const MOON_R = 0.022;
const MOON_ORBIT = 0.175;

export function drawFlatScene(ctx, w, h, st, opt = {}) {
  const view = opt.view || 'earthmoon';
  const z = ZOOM[view] || 1;
  const base = Math.min(w, h);

  /* ---------- 位置（单位：画布短边） ---------- */
  const phi = (((st.moon.lon - st.sun.lon) * (180 / Math.PI)) % 360 + 360) % 360; // 日月黄经差
  const dm = MOON_ORBIT * (st.moon.dist / 384400);                                // 地月距离（略微随远近变化）
  const moon = { x: -Math.cos(phi * D2R) * dm, y: -Math.sin(phi * D2R) * dm };
  const sun = { x: SUN_X, y: 0 };

  /* ---------- 平移 + 缩放 ---------- */
  let cx = 0, cy = 0;
  if (view === 'system') cx = SUN_X / 2;
  if (view === 'moon') { cx = moon.x; cy = moon.y; }
  const ox = w / 2, oy = h / 2;
  const P = (p) => ({ x: ox + (p.x - cx) * base * z, y: oy + (p.y - cy) * base * z });
  const R = (r) => r * base * z;

  const sunP = P(sun), earthP = P({ x: 0, y: 0 }), moonP = P(moon);
  const sunR = R(SUN_R), earthR = R(EARTH_R), moonR = Math.max(3, R(MOON_R));
  const moonOrbitPx = R(dm);

  ctx.clearRect(0, 0, w, h);

  /* ---------- 背景 ---------- */
  const bg = ctx.createRadialGradient(ox, oy * 0.85, 0, ox, oy, Math.max(w, h) * 0.75);
  bg.addColorStop(0, '#0f1a33');
  bg.addColorStop(0.55, '#0a1122');
  bg.addColorStop(1, '#05080f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  /* ---------- 黄道面网格（对应三维里的极坐标网格） ---------- */
  ctx.save();
  ctx.strokeStyle = 'rgba(90,169,255,0.10)';
  ctx.lineWidth = 1;
  for (const k of [0.42, 0.84, 1.26]) {
    ctx.beginPath();
    ctx.arc(earthP.x, earthP.y, moonOrbitPx * k, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(earthP.x + Math.cos(a) * moonOrbitPx * 0.42, earthP.y + Math.sin(a) * moonOrbitPx * 0.42);
    ctx.lineTo(earthP.x + Math.cos(a) * moonOrbitPx * 1.26, earthP.y + Math.sin(a) * moonOrbitPx * 1.26);
    ctx.stroke();
  }
  ctx.restore();

  /* ---------- 白道（虚线圆） ---------- */
  ctx.save();
  ctx.setLineDash([5, 6]);
  ctx.strokeStyle = 'rgba(255,212,121,0.42)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(earthP.x, earthP.y, moonOrbitPx, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  /* ---------- 平行阳光（从左侧照过来） ---------- */
  const rayLen = Math.max(earthP.x - sunP.x - sunR, base * 0.18);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,217,138,0.22)';
  ctx.lineWidth = 1;
  for (let i = -3; i <= 3; i++) {
    if (i === 0) continue;
    const y = earthP.y + i * earthR * 0.42;
    ctx.beginPath();
    ctx.moveTo(sunP.x + sunR + 6, y);
    ctx.lineTo(sunP.x + sunR + 6 + rayLen * 0.72, y);
    ctx.stroke();
  }
  // 光的方向箭头
  const ax = sunP.x + sunR + 10, ay = earthP.y - earthR * 2.6;
  const aLen = Math.min(rayLen * 0.45, base * 0.14);
  ctx.strokeStyle = 'rgba(255,217,138,0.5)';
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax + aLen, ay);
  ctx.moveTo(ax + aLen - 7, ay - 4);
  ctx.lineTo(ax + aLen, ay);
  ctx.lineTo(ax + aLen - 7, ay + 4);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,217,138,0.62)';
  ctx.font = `500 ${Math.max(10, Math.round(base * 0.021))}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('太阳光', ax, ay - 12);
  ctx.restore();

  /* ---------- 影锥（都朝背向太阳的一侧） ---------- */
  const umbraLen = Math.min(moonOrbitPx * (st.umbraLen / st.moon.dist), moonOrbitPx * 1.5);
  const penLen = Math.min(moonOrbitPx * (372500 / st.moon.dist), moonOrbitPx * 1.25);
  const earthUmbraLen = Math.min(moonOrbitPx * (st.shadow.Lu / st.moon.dist), moonOrbitPx * 1.9);
  const earthPenLen = Math.min(moonOrbitPx * (st.shadow.Lp / st.moon.dist), moonOrbitPx * 1.9);

  cone(ctx, earthP, earthR * 0.98, earthUmbraLen, st.isLunarEclipse ? 0.34 : 0.16, '76,54,104');
  cone(ctx, earthP, earthR * 1.05, earthPenLen, st.isLunarEclipse ? 0.13 : 0.07, '88,68,120');
  cone(ctx, moonP, moonR * 0.95, umbraLen, st.isSolarEclipse ? 0.55 : 0.34, '10,10,18');
  cone(ctx, moonP, moonR * 1.8, penLen, st.isSolarEclipse ? 0.2 : 0.11, '20,20,34');

  /* ---------- 太阳 ---------- */
  drawSunDisk(ctx, sunP.x, sunP.y, sunR, { solar: null, dir: 0 });

  /* ---------- 地球（朝向太阳的一侧更亮） ---------- */
  const eg = ctx.createRadialGradient(
    earthP.x - earthR * 0.55, earthP.y - earthR * 0.45, earthR * 0.12,
    earthP.x, earthP.y, earthR * 1.12,
  );
  eg.addColorStop(0, '#9fd4ff');
  eg.addColorStop(0.42, '#3f7fc4');
  eg.addColorStop(0.78, '#1d3f6b');
  eg.addColorStop(1, '#0a1526');
  ctx.beginPath();
  ctx.arc(earthP.x, earthP.y, earthR, 0, Math.PI * 2);
  ctx.fillStyle = eg;
  ctx.fill();
  // 大气晕
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const halo = ctx.createRadialGradient(earthP.x, earthP.y, earthR * 0.9, earthP.x, earthP.y, earthR * 1.6);
  halo.addColorStop(0, 'rgba(120,180,255,0.24)');
  halo.addColorStop(1, 'rgba(90,150,255,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(earthP.x, earthP.y, earthR * 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  /* ---------- 月球（亮面朝向太阳，直接用真实盈亏画） ---------- */
  const rot = Math.atan2(sunP.y - moonP.y, sunP.x - moonP.x);
  drawMoonDisk(ctx, moonP.x, moonP.y, moonR, {
    elong: st.elong, rot, eclipse: st.lunar, detail: false,
  });

  /* ---------- 天体标签 ---------- */
  pill(ctx, sunP.x, sunP.y - sunR - 18, '太阳', base, 'rgba(255,226,150,0.92)');
  pill(ctx, earthP.x, earthP.y - earthR - 16, '地球', base, 'rgba(190,220,255,0.95)');
  pill(ctx, moonP.x, moonP.y - moonR - 14, '月球', base, 'rgba(230,230,225,0.95)');
}

/** 背向太阳的锥（示意影锥），base > 0 表示朝 +x（太阳在左侧） */
function cone(ctx, from, halfW, len, alpha, rgb) {
  if (!(len > 1)) return;
  ctx.save();
  const g = ctx.createLinearGradient(from.x, from.y, from.x + len, from.y);
  g.addColorStop(0, `rgba(${rgb},${alpha})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y - halfW);
  ctx.lineTo(from.x + len, from.y);
  ctx.lineTo(from.x, from.y + halfW);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** 小圆角标签（和三维场景里的 .lbl 视觉一致） */
function pill(ctx, x, y, text, base, color) {
  const fs = Math.max(10, Math.round(base * 0.022));
  ctx.save();
  ctx.font = `600 ${fs}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + fs * 1.1;
  const h = fs * 1.9;
  roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fillStyle = 'rgba(6,10,20,0.62)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillText(text, x, y + 0.5);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
