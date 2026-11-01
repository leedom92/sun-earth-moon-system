/**
 * useSolarSystem —— 原 main.js 的状态与主循环
 *
 * 重构原则：计算、三维更新、二维重绘的调用顺序和参数与原来逐行一致，
 * 唯一的差别是把"直接写 DOM"换成响应式数据，由组件去渲染。
 * 所有天文量仍然来自 lib/astro.js 的真实计算，没有做任何简化或近似。
 */
import { ref, shallowRef, reactive, computed } from 'vue';
import * as A from '../lib/astro.js';
import { buildPoster, downloadCanvas, azName } from '../lib/export.js';
import { tipFor } from '../lib/tips.js';
import { createScene3D } from '../lib/scene3d.js';
import { makeStars } from '../lib/draw2d.js';

const LON = 120.6;               // 观测地经度（绍兴）
const LAT_DEFAULT = 30.0;        // 观测地纬度
const pad = (n) => String(n).padStart(2, '0');

export { LON, azName };
export const stars = makeStars(300);

/* ========== 初始时间（支持网址参数直接定位）==========
   ?date=2027-08-02&time=18:11&lat=30&view=moon  */
const params = new URLSearchParams(location.search);
const now = new Date();
const bjNow = A.jdToBeijingParts(A.dateToJD(now));
let initJD = A.beijingToJD(bjNow.y, bjNow.mo, bjNow.d, bjNow.h, bjNow.mi);

if (params.get('date')) {
  const [y, m, d] = params.get('date').split('-').map(Number);
  const [hh, mm] = (params.get('time') || '12:00').split(':').map(Number);
  if (y) initJD = A.beijingToJD(y, m, d, hh || 0, mm || 0);
}

let initLat = LAT_DEFAULT;
if (params.get('lat')) initLat = Math.max(-60, Math.min(70, +params.get('lat')));

export const startView = params.get('view') || 'earthmoon';

/* ========== 时间状态 ========== */
export const jd = ref(initJD);
export const lat = ref(initLat);
export const playing = ref(false);
export const speed = ref(0.25);        // 天 / 秒

/** 首帧之前就要有一份结果，组件挂载时才有东西可画 */
const first = A.computeAll(initJD, initLat, LON);
first.gmst = A.gmst(initJD);

export const frame = shallowRef(first);   // 每帧最新结果，给三维场景用
export const st = shallowRef(first);      // 节流后的结果，给读数与二维图用

let dirty = true;
export function markDirty() { dirty = true; }

/* ========== 时间换算与跳转 ========== */
export function clampJD(v) {
  return Math.min(A.beijingToJD(2200, 1, 1), Math.max(A.beijingToJD(1900, 1, 1), v));
}

export function setJD(v) {
  jd.value = clampJD(v);
  dirty = true;
}

export function setPlaying(v) { playing.value = v; }
export function togglePlay() { playing.value = !playing.value; }

export const bj = computed(() => A.jdToBeijingParts(jd.value));

/** 日期输入框：只改日期，时刻沿用当前值 */
export const dateValue = computed({
  get() {
    const b = bj.value;
    return `${b.y}-${pad(b.mo)}-${pad(b.d)}`;
  },
  set(v) {
    const [y, m, d] = String(v).split('-').map(Number);
    if (!y) return;
    const b = bj.value;
    setJD(A.beijingToJD(y, m, d, b.h, b.mi));
    setPlaying(false);
  },
});

/** 时刻滑杆：一天内的分钟数 */
export const hourValue = computed({
  get() {
    const b = bj.value;
    return b.h * 60 + b.mi;
  },
  set(v) {
    const b = bj.value;
    const hm = +v;
    setJD(A.beijingToJD(b.y, b.mo, b.d, Math.floor(hm / 60), hm % 60));
  },
});

export const hourText = computed(() => {
  const b = bj.value;
  return `${pad(b.h)}:${pad(b.mi)}`;
});

export const latValue = computed({
  get: () => lat.value,
  set(v) {
    lat.value = +v;
    markDirty();
  },
});

export const latText = computed(() => (lat.value >= 0 ? `${lat.value}°N` : `${-lat.value}°S`));

export function jump(kind) {
  if (kind === 'today') setJD(A.dateToJD(new Date()));
  else if (kind === 'prevNew') setJD(A.prevNewMoon(jd.value - 0.2));
  else if (kind === 'nextNew') setJD(A.nextNewMoon(jd.value + 0.2));
  else if (kind === 'full') setJD(A.nextFullMoon(jd.value + 0.2));
  else if (kind === 'quarter1') setJD(A.solvePhase(jd.value + 0.2, 90, 1));
  else if (kind === 'quarter3') setJD(A.solvePhase(jd.value + 0.2, 270, 1));
  setPlaying(false);
}

export function jumpEclipse(code) {
  const [kind, sub] = code.split('-');
  const r = A.findEclipse(jd.value + 0.2, kind, sub);
  if (r) {
    setJD(r.jd);
    setPlaying(false);
    flash(`已跳到 ${A.jdToBeijingParts(r.jd).y} 年 ${r.info.label}`);
  } else {
    flash('未来十年内没找到这个类型的食');
  }
}

/* ========== 提示气泡 ========== */
export const hint = reactive({ text: '提示：可以直接拖动地球或月球', hidden: false });
let flashTimer = null;

export function flash(msg) {
  hint.text = msg;
  hint.hidden = false;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { hint.hidden = true; }, 2600);
}

/* ========== 太阳上月球偏移方向（示意图用）========== */
export function sunDirAngle(s) {
  const dLon = A.diff180(s.moon.lon * A.R2D, s.sun.lon * A.R2D);
  const dLat = s.moon.lat * A.R2D;
  return Math.atan2(-dLat, -dLon);
}

/* ========== 读数（节流后统一算一次，字段与原 updateText 一一对应）========== */
export const readout = computed(() => {
  const s = st.value;
  const b = A.jdToBeijingParts(s.jd);

  const moonUp = s.moonHz.alt > 0;
  const sunUp = s.sunHz.alt > 0;
  const vis = (h) => (h.alt > 0 ? `高度 ${h.alt.toFixed(0)}° · ${azName(h.az)}` : '在地平线下');

  return {
    phaseName: s.phase.name,
    illumPct: `${(s.illum * 100).toFixed(1)}%`,
    illumText: `${(s.illum * 100).toFixed(1)} %`,
    ageText: `${s.moonAge.toFixed(2)} 天`,
    lunarText: s.lunarCal.fullText,
    solarText: `${b.y}-${pad(b.mo)}-${pad(b.d)} ${pad(b.h)}:${pad(b.mi)}`,
    jieqiText: s.jieqi,
    nextNewText: `${(A.nextNewMoon(s.jd + 0.01) - s.jd).toFixed(2)} 天`,
    sunStateText: s.solar.type
      ? `${s.solar.label}（食分约 ${s.solar.mag.toFixed(2)}）`
      : '完整的日面（无日食）',
    sunAlert: !!s.solar.type,
    sepText: `${s.solar.sep.toFixed(3)}°`,
    dMoon: `${Math.round(s.moon.dist).toLocaleString()} km`,
    dSun: `${(s.sun.dist / A.AU).toFixed(5)} AU`,
    angMoon: `${(s.moonAngRadius * 2).toFixed(3)}°`,
    angSun: `${(s.sunAngRadius * 2).toFixed(3)}°`,
    latMoon: `${(s.moon.lat * A.R2D).toFixed(2)}°`,
    umbText: `${Math.round(s.umbraLen).toLocaleString()} km`,
    tipText: tipFor(s),
    skyInfo: `月亮：${moonUp ? vis(s.moonHz) : '在地平线下'}<br>太阳：${sunUp ? vis(s.sunHz) : '在地平线下'}`,
  };
});

/* ========== 三维场景 ========== */
export const scene = shallowRef(null);
export const glCanvas = shallowRef(null);
/** 二维备用视图的画布（WebGL 不可用时由 SceneStage 挂上） */
export const flatCanvas = shallowRef(null);
/** 三维场景是否可用；false 时界面切到二维示意图 */
export const glOk = ref(true);
/** 不可用的原因，用于提示文案 */
export const glReason = ref('');
export const currentView = ref(startView);
export const options = reactive({ showOrbits: true, showCones: true, showRays: true, showGrid: true });
export const autoRotate = ref(false);

/** 天体标签位置，每帧由 project() 更新（原来直接写 style） */
export const labelPos = reactive({
  sun: { left: 0, top: 0, opacity: 0 },
  earth: { left: 0, top: 0, opacity: 0 },
  moon: { left: 0, top: 0, opacity: 0 },
});

export function setView(v) {
  currentView.value = v;
  scene.value?.setView(v);
}

export function setOption(key, val) {
  options[key] = val;
  scene.value?.setOption(key, val);
}

export function setAutoRotate(val) {
  autoRotate.value = val;
  scene.value?.setAutoRotate(val);
}

export function resize() {
  scene.value?.resize();
  dirty = true;
}

let rafId = 0;
let last = 0;
let last2d = 0;
let resizeBound = false;

function projectLabels(sc) {
  for (const name of ['sun', 'earth', 'moon']) {
    const p = sc.project(name);
    const t = labelPos[name];
    if (!p.visible) { t.opacity = 0; continue; }
    t.opacity = 1;
    t.left = p.x;
    t.top = p.y - 26;
  }
}

function loop(t) {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  if (playing.value) setJD(jd.value + speed.value * dt);

  const s = A.computeAll(jd.value, lat.value, LON);
  s.gmst = A.gmst(jd.value);
  frame.value = s;

  const sc = scene.value;
  if (sc) sc.update(s);

  if (dirty && t - last2d > 55) {
    last2d = t;
    dirty = false;
    st.value = s;
  }

  if (sc) {
    sc.render(dt);
    projectLabels(sc);
  }
  rafId = requestAnimationFrame(loop);
}

/** 由 SceneStage 挂载时调用：建场景 → 首帧数据 → 设定视角 → 起循环 */
export function initScene(canvas) {
  glCanvas.value = canvas;

  let sc = null;
  try {
    sc = createScene3D(canvas, {
      onDragTime: (dt) => {
        setJD(jd.value + dt);
        setPlaying(false);
        hint.hidden = true;
      },
      onContextLost: () => {
        scene.value = null;
        glOk.value = false;
        glReason.value = '图形上下文丢失（显卡驱动异常或显存不足）';
      },
    });
  } catch (err) {
    // 没有 WebGL 时不要连带把其他功能一起拖死：读数和二维图照常工作
    sc = null;
    glOk.value = false;
    glReason.value = err && err.code === 'WEBGL_UNAVAILABLE'
      ? '浏览器当前没有可用的 WebGL'
      : `三维渲染初始化失败：${(err && err.message) || err}`;
  }

  if (sc) {
    glOk.value = true;
    glReason.value = '';
    scene.value = sc;
    /* 顺序与原启动流程一致：resize → update(st0) → setView */
    sc.resize();
    sc.update(st.value);
    sc.setView(startView, false);
  }

  dirty = true;

  if (!resizeBound) {
    window.addEventListener('resize', resize);
    resizeBound = true;
  }
  last = performance.now();
  if (!rafId) rafId = requestAnimationFrame(loop);
  if (sc) setTimeout(() => { hint.hidden = true; }, 6000);

  return sc;
}

/* ========== 保存图片 ========== */
export function savePoster() {
  const s = A.computeAll(jd.value, lat.value, LON);
  const b = A.jdToBeijingParts(jd.value);
  const poster = buildPoster(s, {
    dateText: `${b.y} 年 ${b.mo} 月 ${b.d} 日 ${pad(b.h)}:${pad(b.mi)}（北京时间）`,
    stars,
    lat: lat.value,
    tip: tipFor(s),
    horizonFn: (ra, dec) => A.horizontal(ra, dec, jd.value, lat.value, LON),
    sunDir: sunDirAngle(s),
  });
  downloadCanvas(poster, `日月观测卡_${b.y}${pad(b.mo)}${pad(b.d)}_${pad(b.h)}${pad(b.mi)}.png`);
  flash('观测卡已保存');
}

export function saveShot() {
  const b = A.jdToBeijingParts(jd.value);
  const name = `三维场景_${b.y}${pad(b.mo)}${pad(b.d)}_${pad(b.h)}${pad(b.mi)}.png`;
  // WebGL 不可用时保存的是二维示意图，文件名也跟着改，避免名不副实
  if (!glOk.value) {
    if (!flatCanvas.value) return;
    downloadCanvas(flatCanvas.value, name.replace('三维场景', '二维示意图'));
    flash('已保存二维示意图');
    return;
  }
  if (!glCanvas.value) return;
  downloadCanvas(glCanvas.value, name);
  flash('画面已保存');
}

/* ========== 说明弹窗 ========== */
export const helpOpen = ref(false);
export function openHelp() { helpOpen.value = true; }
export function closeHelp() { helpOpen.value = false; }
