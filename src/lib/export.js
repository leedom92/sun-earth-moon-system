/**
 * export.js —— 把"当前月亮和太阳在地球上的形态"导出为图片
 * 生成一张完整的观测记录卡：月相、日面（含日食）、天空位置、关键数据、知识说明。
 */
import { drawMoonDisk, drawSunDisk, drawSkyChart, brightLimbRot } from './draw2d.js';
import { R2D, AU } from './astro.js';

export function buildPoster(st, opt = {}) {
  const W = 900, H = 1280;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  /* 背景 */
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0b1024');
  bg.addColorStop(0.45, '#111a35');
  bg.addColorStop(1, '#070b18');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  drawStars(ctx, W, H);

  /* 标题 */
  ctx.textAlign = 'center';
  ctx.fillStyle = '#eaf2ff';
  ctx.font = '700 40px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('太阳 · 地球 · 月球  观测记录', W / 2, 74);
  ctx.font = '400 20px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#9fb4d8';
  const d = opt.dateText || '';
  ctx.fillText(`${d}　${st.lunarCal.fullText}　${st.jieqi}`, W / 2, 110);

  /* 左：月相 */
  panel(ctx, 40, 146, 390, 360, '月亮的样子（从地球看）');
  label(ctx, 235, 214, st.phase.name, 27, '#ffe9a8');
  drawMoonDisk(ctx, 235, 350, 112, {
    elong: st.elong, rot: brightLimbRot(st.elong, opt.lat ?? 30), eclipse: st.lunar, detail: true,
  });
  label(ctx, 235, 492,
    `照亮 ${(st.illum * 100).toFixed(1)}%　月龄 ${st.moonAge.toFixed(1)} 天`, 18, '#a9c0e6');

  /* 右：日面 */
  panel(ctx, 470, 146, 390, 360, '太阳的样子（从地球看）');
  const sunState = st.solar.type ? st.solar.label : '完整的光盘（无日食）';
  label(ctx, 665, 214, sunState, 26, '#ffd98a');
  drawSunDisk(ctx, 665, 350, 96, { solar: st.solar, dir: opt.sunDir || 0 });
  label(ctx, 665, 492,
    st.solar.type ? `食分约 ${st.solar.mag.toFixed(2)}　中心距 ${st.solar.sep.toFixed(2)}°` : '日面没有被月球遮挡', 18, '#a9c0e6');

  /* 天空位置 */
  panel(ctx, 40, 530, 390, 370, '此刻天空中的位置');
  drawSkyChart(ctx, 235, 688, 112, {
    sunHz: st.sunHz, moonHz: st.moonHz, stars: opt.stars || [],
    horizonFn: opt.horizonFn, elong: st.elong, solar: st.solar, eclipse: st.lunar,
  });
  const vis = (h) => (h.alt > 0 ? `高度 ${h.alt.toFixed(0)}°　方位 ${azName(h.az)}（${h.az.toFixed(0)}°）` : '在地平线以下');
  label(ctx, 235, 838, `月亮：${vis(st.moonHz)}`, 16, '#cfe0ff');
  label(ctx, 235, 862, `太阳：${vis(st.sunHz)}`, 16, '#cfe0ff');
  label(ctx, 235, 884, `观测地纬度 ${(opt.lat ?? 30).toFixed(1)}°　东经 120.6°`, 15, '#8fa6cc');

  /* 数据 */
  panel(ctx, 470, 530, 390, 370, '关键数据');
  const rows = [
    ['日月角距（朔望角）', `${st.elong.toFixed(2)}°`],
    ['月面被照亮', `${(st.illum * 100).toFixed(1)}%`],
    ['地月距离', `${Math.round(st.moon.dist).toLocaleString()} km`],
    ['日地距离', `${(st.sun.dist / AU).toFixed(5)} AU`],
    ['月球视直径', `${(st.moonAngRadius * 2).toFixed(3)}°`],
    ['太阳视直径', `${(st.sunAngRadius * 2).toFixed(3)}°`],
    ['月球黄纬（偏离黄道）', `${(st.moon.lat * R2D).toFixed(2)}°`],
    ['月影锥长度', `${Math.round(st.umbraLen).toLocaleString()} km`],
  ];
  let y = 600;
  ctx.textAlign = 'left';
  for (const [k, v] of rows) {
    ctx.fillStyle = '#93a9cf'; ctx.font = '400 18px system-ui, sans-serif';
    ctx.fillText(k, 500, y);
    ctx.fillStyle = '#e6f0ff'; ctx.font = '600 18px system-ui, sans-serif';
    ctx.textAlign = 'right'; ctx.fillText(v, 830, y); ctx.textAlign = 'left';
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(500, y + 10); ctx.lineTo(830, y + 10); ctx.stroke();
    y += 34;
  }

  /* 知识卡 */
  panel(ctx, 40, 930, 820, 290, '小知识');
  ctx.fillStyle = '#d8e6ff';
  ctx.font = '400 19px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
  wrapText(ctx, opt.tip || '', 70, 1005, 760, 31);
  ctx.fillStyle = '#7d90b4';
  ctx.font = '400 15px system-ui, sans-serif';
  ctx.fillText('数据按真实天文规律计算（太阳/月球位置级数、朔望时刻、影锥几何）；三维场景中天体大小与日地距离做了示意性缩放。', 70, 1185, 760);

  return c;
}

function panel(ctx, x, y, w, h, title) {
  ctx.save();
  roundRect(ctx, x, y, w, h, 18);
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.fillStyle = '#8fb0e0';
  ctx.font = '600 18px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(title, x + 22, y + 30);
  ctx.restore();
}
function label(ctx, x, y, text, size, color) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.font = `600 ${size}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.fillText(text, x, y);
  ctx.restore();
}
function wrapText(ctx, text, x, y, maxW, lh) {
  const chars = [...text];
  let line = '';
  for (const ch of chars) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y); y += lh; line = ch;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y);
  return y;
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
function drawStars(ctx, W, H) {
  for (let i = 0; i < 160; i++) {
    const x = Math.random() * W, y = Math.random() * H;
    const r = Math.random() * 1.3;
    ctx.fillStyle = `rgba(255,255,255,${0.15 + Math.random() * 0.4})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
}
export function azName(az) {
  const names = ['正北', '东北', '正东', '东南', '正南', '西南', '正西', '西北'];
  return names[Math.round(((az % 360) + 360) % 360 / 45) % 8];
}

/** 触发下载 */
export function downloadCanvas(canvas, filename) {
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}
