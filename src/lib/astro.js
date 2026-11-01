/**
 * astro.js —— 天文计算核心（纯计算，不依赖 DOM）
 *
 * 全部采用真实天文算法（低精度级数，来自 Astronomical Almanac / Meeus）：
 *   - 太阳：黄经误差 < 0.01°
 *   - 月球：黄经误差约 0.3°、黄纬误差约 0.2°（足够准确判断月相与日月食）
 *   - 农历：由真实"朔"时刻 + 二十四中气推算（不使用硬编码查表）
 *
 * 角度单位：模块内部统一用「弧度」，对外接口（月相角、角距等）用「度」。
 */

/* ============ 基础常量 ============ */
export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;
export const J2000 = 2451545.0;          // 历元 J2000.0
export const OBLIQ = 23.4392911 * D2R;   // 黄赤交角

export const AU = 149597870.7;  // 1 天文单位 (km)
export const R_EARTH = 6371.0;  // 地球平均半径 (km)
export const R_MOON = 1737.4;   // 月球半径 (km)
export const R_SUN = 696000.0;  // 太阳半径 (km)
export const SYNODIC = 29.530588; // 朔望月 (天)

const TAU = Math.PI * 2;

/* ============ 工具函数 ============ */
export const norm360 = (d) => ((d % 360) + 360) % 360;
export const norm2pi = (r) => ((r % TAU) + TAU) % TAU;
/** 把角度差归一到 (-180, 180] */
export function diff180(a, b) {
  let d = norm360(a - b);
  if (d > 180) d -= 360;
  return d;
}

/* ============ 儒略日 ↔ 日期 ============ */
export function dateToJD(date) {
  return date.getTime() / 86400000 + 2440587.5;
}
export function jdToDate(jd) {
  return new Date((jd - 2440587.5) * 86400000);
}
/**
 * 北京时间（UTC+8）的年/月/日/时 → 世界时儒略日
 * UI 上的所有输入都按北京时间处理。
 */
export function beijingToJD(y, mo, d, h = 0, mi = 0) {
  return dateToJD(new Date(Date.UTC(y, mo - 1, d, h - 8, mi, 0)));
}
/** 儒略日 → 北京时间的 Date 对象（用 UTC 字段承载北京时间数值） */
export function jdToBeijingParts(jd) {
  const dt = new Date((jd - 2440587.5) * 86400000 + 8 * 3600 * 1000);
  return {
    y: dt.getUTCFullYear(),
    mo: dt.getUTCMonth() + 1,
    d: getUTCDate(dt),
    h: dt.getUTCHours(),
    mi: dt.getUTCMinutes(),
  };
}
function getUTCDate(dt) { return dt.getUTCDate(); }

/* ============ 太阳 ============ */
export function sunPosition(jd) {
  const n = jd - J2000;
  const L = (280.460 + 0.9856474 * n) * D2R;   // 平黄经
  const g = (357.528 + 0.9856003 * n) * D2R;   // 平近点角
  const lon = norm2pi(L + (1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R);
  const dist = (1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g)) * AU;
  return { lon, lat: 0, dist };
}

/* ============ 月球 ============ */
export function moonPosition(jd) {
  const T = (jd - J2000) / 36525;
  const T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  const Lp = (218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841 - T4 / 65194000) * D2R; // 平黄经
  const D = (297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000) * D2R;  // 平距角
  const M = (357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000) * D2R;                    // 太阳平近点角
  const Mp = (134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699 - T4 / 14712000) * D2R;     // 月球平近点角
  const F = (93.2720950 + 483202.0175233 * T - 0.0036539 * T2 - T3 / 3526000 + T4 / 863310000) * D2R;    // 升交点角距

  const s = Math.sin, c = Math.cos;
  // 黄经摄动主项（单位：度）
  const dLon =
    6.289 * s(Mp) - 1.274 * s(Mp - 2 * D) + 0.658 * s(2 * D) + 0.214 * s(2 * Mp)
    - 0.186 * s(M) - 0.114 * s(2 * F) + 0.059 * s(2 * Mp - 2 * D) + 0.057 * s(Mp - 2 * D + M)
    - 0.053 * s(Mp + 2 * D) + 0.046 * s(2 * D - M) + 0.041 * s(Mp - M) - 0.035 * s(D)
    - 0.031 * s(Mp + M) - 0.015 * s(2 * F - 2 * D) + 0.011 * s(Mp - 4 * D);
  // 黄纬（单位：度）
  const dLat =
    5.128 * s(F) + 0.281 * s(Mp + F) - 0.278 * s(Mp - F) - 0.173 * s(F - 2 * D)
    + 0.055 * s(2 * Mp + F) - 0.046 * s(Mp + F - 2 * D) + 0.033 * s(F + 2 * D)
    - 0.025 * s(2 * Mp - F) + 0.017 * s(2 * Mp + F - 2 * D);
  // 地平视差（单位：度）
  const par = 0.9508 + 0.0518 * c(Mp) + 0.0095 * c(Mp - 2 * D) + 0.0078 * c(2 * D) + 0.0028 * c(2 * Mp);

  return {
    lon: norm2pi(Lp + dLon * D2R),
    lat: dLat * D2R,
    dist: 6378.137 / Math.sin(par * D2R), // km
    node: norm2pi(Lp - F),                // 升交点黄经（近似）
    mp: Mp,                               // 月球平近点角（天平动经度项要用）
    F,                                    // 升交点角距（天平动纬度项要用）
    lp: Lp,                               // 平黄经
  };
}

/* ============ 黄道坐标 → 直角坐标（Y 轴 = 黄北极）============ */
export function eclipticToVec(lon, lat, r = 1) {
  const cb = Math.cos(lat), sb = Math.sin(lat);
  return { x: r * cb * Math.cos(lon), y: r * sb, z: -r * cb * Math.sin(lon) };
}

/* ============ 月相 ============ */
/** 日月地心角距（日月黄经差），0 = 朔，180 = 望 */
export function elongation(jd) {
  return norm360(moonPosition(jd).lon * R2D - sunPosition(jd).lon * R2D);
}
/** 被照亮的比例 0~1 */
export function illuminatedFraction(elongDeg) {
  return (1 - Math.cos(elongDeg * D2R)) / 2;
}
/** 月龄（距上次朔的天数） */
export function moonAge(elongDeg) {
  return (elongDeg / 360) * SYNODIC;
}

const PHASE_NAMES = [
  { deg: 0, name: '新月（朔）', short: '新月' },
  { deg: 45, name: '蛾眉月（盈）', short: '蛾眉月' },
  { deg: 90, name: '上弦月', short: '上弦月' },
  { deg: 135, name: '盈凸月', short: '盈凸月' },
  { deg: 180, name: '满月（望）', short: '满月' },
  { deg: 225, name: '亏凸月', short: '亏凸月' },
  { deg: 270, name: '下弦月', short: '下弦月' },
  { deg: 315, name: '残月（亏）', short: '残月' },
];
export function phaseName(elongDeg) {
  const e = norm360(elongDeg);
  let best = PHASE_NAMES[0], bd = 999;
  for (const p of PHASE_NAMES) {
    const d = Math.abs(diff180(e, p.deg));
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

/* ============ 角直径与影锥 ============ */
/** 天体角半径（度） */
export const angRadius = (radiusKm, distKm) => Math.asin(radiusKm / distKm) * R2D;

/** 地球在月球距离处的本影 / 半影半径（km）与角半径（度） */
export function earthShadow(moonDistKm, sunDistKm) {
  const Lu = (R_EARTH * sunDistKm) / (R_SUN - R_EARTH); // 本影锥全长
  const Lp = (R_EARTH * sunDistKm) / (R_SUN + R_EARTH); // 半影锥特征长度
  const umbraKm = R_EARTH * (1 - moonDistKm / Lu);
  const penKm = R_EARTH * (1 + moonDistKm / Lp);
  return {
    umbraKm, penKm, Lu, Lp,
    umbraAng: Math.atan(umbraKm / moonDistKm) * R2D,
    penAng: Math.atan(penKm / moonDistKm) * R2D,
  };
}
/** 月球本影锥长度（km）：大于地月距离 → 影子能落到地面（日全食） */
export function moonUmbraLength(sunDistKm) {
  return (R_MOON * sunDistKm) / (R_SUN - R_MOON);
}

/* ============ 日月食判定 ============ */
/**
 * 日食：月球走到日地之间。
 * 判定用「地心视位置」，sep 为日月中心视角距。
 */
export function solarEclipse(jd) {
  const s = sunPosition(jd), m = moonPosition(jd);
  const sv = eclipticToVec(s.lon, 0), mv = eclipticToVec(m.lon, m.lat);
  const sep = Math.acos(Math.max(-1, Math.min(1, sv.x * mv.x + sv.y * mv.y + sv.z * mv.z))) * R2D;
  const rs = angRadius(R_SUN, s.dist);   // 太阳视半径
  const rm = angRadius(R_MOON, m.dist);  // 月球视半径
  const L = moonUmbraLength(s.dist);     // 月影锥长度
  // 月影轴到地心的距离（km）：小于地球半径 → 影子落在地面上（中心食）
  const axisDist = (sep * D2R) * m.dist;
  const reachGround = L > m.dist - R_EARTH; // 本影能否够到地面（全食/环食的分界）
  let type = null, label = '无日食', mag = 0;
  if (sep > 1.45) {
    type = null; // 超出日食限：地球任何地方都看不到
  } else if (axisDist < R_EARTH) {
    type = reachGround ? 'total' : 'annular';
    label = type === 'total' ? '日全食' : '日环食';
    mag = rm / rs;
  } else {
    type = 'partial';
    label = '日偏食';
    mag = Math.max(0, (rs + rm + 0.95 - sep) / (2 * rs)); // 含月球视差的最大食分
  }
  return {
    sep, rs, rm, type, label, mag: Math.max(0, mag),
    axisDist, reachGround,
    umbraReachEarth: reachGround, umbraLen: L, moonDist: m.dist,
  };
}

/**
 * 月食：地球走到日月之间。
 * σ = 月球中心到「地影轴」（反日点）的角距。
 */
export function lunarEclipse(jd) {
  const s = sunPosition(jd), m = moonPosition(jd);
  const mv = eclipticToVec(m.lon, m.lat);
  const anti = { x: -Math.cos(s.lon), y: 0, z: Math.sin(s.lon) }; // 反日点方向
  const cosSig = mv.x * anti.x + mv.y * anti.y + mv.z * anti.z;
  const sigma = Math.acos(Math.max(-1, Math.min(1, cosSig))) * R2D;
  const sh = earthShadow(m.dist, s.dist);
  const rm = angRadius(R_MOON, m.dist);
  let type = null, label = '无月食', mag = 0;
  if (sigma <= sh.umbraAng - rm) {
    type = 'total'; label = '月全食'; mag = (sh.umbraAng + rm - sigma) / (2 * rm);
  } else if (sigma <= sh.umbraAng + rm) {
    type = 'partial'; label = '月偏食'; mag = (sh.umbraAng + rm - sigma) / (2 * rm);
  } else if (sigma <= sh.penAng + rm) {
    type = 'penumbral'; label = '半影月食'; mag = (sh.penAng + rm - sigma) / (2 * rm);
  }
  return { sigma, rm, shadow: sh, type, label, mag: Math.max(0, mag) };
}

/* ============ 朔 / 望 时刻求解 ============ */
/** 平距角（不取模，随时间单调增加，单位度） */
function meanElongUnwrapped(jd) {
  const T = (jd - J2000) / 36525;
  return 297.8501921 + 445267.1114034 * T - 0.0018819 * T * T;
}
/** 真日月角距，归一到 (-180, 180] */
function trueElongationDeg(jd) {
  return diff180(moonPosition(jd).lon * R2D, sunPosition(jd).lon * R2D);
}
/** 真角距相对平角距的摄动修正（|g| < 10°） */
function elongCorrection(jd) {
  return diff180(trueElongationDeg(jd), norm360(meanElongUnwrapped(jd)));
}
/**
 * 求 jd0 之后（dir=1）/ 之前（dir=-1）最近的真朔(target=0) / 真望(target=180) 时刻
 * 用"展开后的平距角 + 摄动修正"定位圈数，再用牛顿迭代收敛，避免跳到相邻的朔望。
 */
export function solvePhase(jd0, target, dir = 1) {
  const rate = 12.1907492;                 // 距角平均变化率 (度/天)
  const A = meanElongUnwrapped(jd0) + elongCorrection(jd0);
  let m = dir > 0 ? Math.ceil((A - target) / 360) : Math.floor((A - target) / 360);
  for (let k = 0; k < 3; k++) {
    const V = target + 360 * m;
    let t = jd0 + (V - A) / rate;
    for (let i = 0; i < 6; i++) {
      t -= (meanElongUnwrapped(t) + elongCorrection(t) - V) / rate;
    }
    if (dir > 0 ? t > jd0 : t < jd0) return t;
    m += dir;
  }
  return jd0;
}
export const nextNewMoon = (jd0) => solvePhase(jd0, 0, 1);
export const prevNewMoon = (jd0) => solvePhase(jd0, 0, -1);
export const nextFullMoon = (jd0) => solvePhase(jd0, 180, 1);
export const prevFullMoon = (jd0) => solvePhase(jd0, 180, -1);

/**
 * 寻找下一次符合条件的日月食
 * kind: 'solar' | 'lunar'；sub: 'total' | 'annular' | 'partial' | 'penumbral' | 'any'
 */
export function findEclipse(jd0, kind, sub = 'any') {
  let t = jd0;
  for (let i = 0; i < 60; i++) {
    const nt = kind === 'solar' ? nextNewMoon(t + 0.5) : nextFullMoon(t + 0.5);
    if (!(nt > t)) break;
    t = nt;
    const e = kind === 'solar' ? solarEclipse(t) : lunarEclipse(t);
    if (!e.type) continue;
    if (sub !== 'any' && e.type !== sub) continue;
    // 对日食，再在 ±6 小时里找食甚（sep 最小）
    let bt = t, best = kind === 'solar' ? e.sep : e.sigma, be = e;
    for (let m = -360; m <= 360; m += 10) {
      const tt = t + m / 1440;
      const ee = kind === 'solar' ? solarEclipse(tt) : lunarEclipse(tt);
      const key = kind === 'solar' ? ee.sep : ee.sigma;
      if (key < best) { best = key; bt = tt; be = ee; }
    }
    return { jd: bt, info: be, kind };
  }
  return null;
}

/* ============ 二十四节气 ============ */
const JIEQI = ['春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至', '小暑', '大暑',
  '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪',
  '冬至', '小寒', '大寒', '立春', '雨水', '惊蛰'];
/** 当前所处的节气（太阳黄经每 15° 一节气） */
export function jieqi(jd) {
  const lon = norm360(sunPosition(jd).lon * R2D);
  const idx = Math.floor(norm360(lon + 7.5) / 15) % 24;
  return JIEQI[idx];
}
/** 太阳黄经等于 target(度) 的时刻：先用平均速率给初值，再用局部导数牛顿迭代 */
export function solarLonTime(jd0, target, dir = 1) {
  const rate = 0.9856474; // 太阳黄经平均日变化 (度/天)
  const lon0 = norm360(sunPosition(jd0).lon * R2D);
  let d = norm360(target - lon0);
  if (d < 1e-9) d = dir > 0 ? 360 : 0;
  let t = jd0 + (d / rate) * (dir > 0 ? 1 : -1);
  const lonAt = (x) => norm360(sunPosition(x).lon * R2D);
  for (let i = 0; i < 24; i++) {
    const lon = lonAt(t);
    const e = diff180(lon, target); // 正 = 已超过目标
    if (Math.abs(e) < 1e-7) break;
    const h = 0.5;
    const dl = diff180(lonAt(t + h), lon) / h; // 局部速率
    if (Math.abs(dl) < 1e-6) break;
    t += Math.max(-40, Math.min(40, -e / dl));
  }
  if (dir > 0 && t < jd0) { // 初值落在了目标之前，向后推一圈
    t = solarLonTime(jd0 + 365.24, target, dir);
  }
  return t;
}
/** 返回 jd 之前最近的一次冬至时刻 */
function winterSolstice(jd) {
  let t = solarLonTime(jd - 370, 270, 1);
  for (let i = 0; i < 5; i++) {
    const n = solarLonTime(t + 180, 270, 1);
    if (!(n > t) || n > jd) break;
    t = n;
  }
  return t;
}

/* ============ 农历（夏历）推算 ============ */
const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const MONTH_NAME = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
const GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const SX = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];

/**
 * 北京日期序号：整数，同一北京日为同一序号。
 * 北京日 = UTC 日 + 8 小时，而儒略日整数对应 UTC 12:00，故偏移为 0.5 + 8/24。
 */
const BJ_SHIFT = 0.5 + 8 / 24;
const bjDay = (jd) => Math.floor(jd + BJ_SHIFT);
const dayStartJD = (dayIdx) => dayIdx - BJ_SHIFT; // 该北京日 00:00 对应的世界时儒略日

/** 某农历月区间内是否含「中气」（太阳黄经跨过 30° 的整数倍） */
function hasZhongqi(startJD, endJD) {
  const a = norm360(sunPosition(startJD).lon * R2D);
  const b = norm360(sunPosition(endJD).lon * R2D);
  const ka = Math.floor(a / 30), kb = Math.floor(b / 30);
  return ka !== kb || b < a;
}

const lunarCache = new Map();
/**
 * 计算农历：返回 { year, month, day, isLeap, monthText, dayText, ganzhi, shengxiao }
 * 规则：含冬至的月为十一月；无中气的月设为上一个月的闰月。
 */
export function lunarDate(jd) {
  const key = Math.round(jd * 1000);
  if (lunarCache.size > 4000) lunarCache.clear(); // 播放时间轴时避免缓存无限增长
  if (lunarCache.has(key)) return lunarCache.get(key);

  const target = bjDay(jd);
  // 覆盖目标日期所在农历年：取它之前最近一次冬至，到下一次冬至之间的所有朔
  const w1 = winterSolstice(jd);
  let w2 = solarLonTime(w1 + 300, 270);
  if (w2 <= w1) w2 = w1 + 365;

  // 收集该区间内的所有朔（含前后各一个以便定位）
  const moons = [];
  let t = solvePhase(w1 - 40, 0, 1);
  let guard = 0;
  while (t < w2 + 40 && guard++ < 40) {
    moons.push(t);
    const nt = nextNewMoon(t + 0.5);
    if (nt <= t) break;
    t = nt;
  }

  // 找到含冬至的朔 → 该月为十一月
  let nov = -1;
  for (let i = 0; i < moons.length; i++) {
    if (bjDay(moons[i]) <= bjDay(w1) && bjDay(w1) < bjDay(moons[i] + SYNODIC)) { nov = i; break; }
  }
  if (nov < 0) nov = 0;

  // 生成月序列：从十一月（冬月）开始，遇到"无中气"的月即为闰月
  const months = []; // { start, end, num, isLeap }
  let num = 11;
  for (let i = nov; i < moons.length - 1; i++) {
    const start = bjDay(moons[i]);
    const end = bjDay(moons[i + 1]);
    let leap = false;
    if (i > nov) {
      if (hasZhongqi(dayStartJD(start), dayStartJD(end))) {
        num = num >= 12 ? 1 : num + 1;
      } else {
        leap = true;
      }
    }
    months.push({ start, end, num, isLeap: leap });
  }
  // 找到包含目标日的月
  let hit = months.find((m) => target >= m.start && target < m.end) ||
    months[Math.min(months.length - 1, Math.max(0, Math.round((target - months[0].start) / SYNODIC)))];
  // 农历年：以"正月"所在公历年为准
  const zheng = months.find((m) => m.num === 1 && !m.isLeap);
  let year = jdToBeijingParts(jd).y;
  if (zheng) {
    const zy = jdToBeijingParts(dayStartJD(zheng.start) + 0.5).y;
    year = target >= zheng.start ? zy : zy - 1;
  }
  const day = target - hit.start + 1;
  const dayText = lunarDayText(day);
  const gz = GAN[((year - 4) % 10 + 10) % 10] + ZHI[((year - 4) % 12 + 12) % 12];

  const res = {
    year, month: hit.num, day, isLeap: hit.isLeap,
    monthText: (hit.isLeap ? '闰' : '') + MONTH_NAME[hit.num - 1] + '月',
    dayText, ganzhi: gz, shengxiao: SX[((year - 4) % 12 + 12) % 12],
    fullText: `${gz}${SX[((year - 4) % 12 + 12) % 12]}年 ` +
      `${(hit.isLeap ? '闰' : '') + MONTH_NAME[hit.num - 1]}月${dayText}`,
  };
  lunarCache.set(key, res);
  return res;
}

export function lunarDayText(d) {
  if (d === 10) return '初十';
  if (d === 20) return '二十';
  if (d === 30) return '三十';
  const pre = d <= 10 ? '初' : d <= 19 ? '十' : d <= 29 ? '廿' : '三';
  const n = d % 10;
  return pre + CN_NUM[n === 0 ? 10 : n];
}

/* ============ 地平坐标（用于天空视图）============ */
export function eclipticToEquatorial(lon, lat) {
  const e = OBLIQ;
  const ra = Math.atan2(
    Math.cos(lat) * Math.sin(lon) * Math.cos(e) - Math.sin(lat) * Math.sin(e),
    Math.cos(lat) * Math.cos(lon)
  );
  const dec = Math.asin(Math.sin(lat) * Math.cos(e) + Math.cos(lat) * Math.sin(e) * Math.sin(lon));
  return { ra: norm2pi(ra), dec };
}
export function gmst(jd) {
  const d = jd - J2000;
  return norm360(280.46061837 + 360.98564736629 * d);
}
/** 赤道坐标 → 地平坐标（方位角自北向东） */
export function horizontal(ra, dec, jd, latDeg, lonEastDeg) {
  const H = (gmst(jd) + lonEastDeg - ra * R2D) * D2R;
  const phi = latDeg * D2R;
  const sinAlt = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const az = Math.atan2(
    -Math.cos(dec) * Math.sin(H),
    Math.sin(dec) * Math.cos(phi) - Math.cos(dec) * Math.sin(phi) * Math.cos(H)
  );
  return { alt: alt * R2D, az: norm360(az * R2D) };
}

/* ============ 一次性取全部状态 ============ */
export function computeAll(jd, latDeg = 30, lonEastDeg = 120.6) {
  const s = sunPosition(jd), m = moonPosition(jd);
  const elong = norm360(m.lon * R2D - s.lon * R2D);
  const illum = illuminatedFraction(elong);
  const rs = angRadius(R_SUN, s.dist), rm = angRadius(R_MOON, m.dist);
  const ageDays = jd - prevNewMoon(jd); // 距上一个朔的真实天数
  const solar = solarEclipse(jd);
  const lunar = lunarEclipse(jd);
  const shadow = earthShadow(m.dist, s.dist);
  const umbraLen = moonUmbraLength(s.dist);

  // 天空位置
  const seq = eclipticToEquatorial(s.lon, 0);
  const meq = eclipticToEquatorial(m.lon, m.lat);
  const sunHz = horizontal(seq.ra, seq.dec, jd, latDeg, lonEastDeg);
  const moonHz = horizontal(meq.ra, meq.dec, jd, latDeg, lonEastDeg);

  return {
    jd, sun: s, moon: m, elong, illum,
    moonAge: ageDays,
    moonAgeByPhase: moonAge(elong),
    phase: phaseName(elong),
    sunAngRadius: rs, moonAngRadius: rm,
    solar, lunar, shadow, umbraLen,
    lunarCal: lunarDate(jd),
    jieqi: jieqi(jd),
    sunHz, moonHz,
    isSolarEclipse: !!solar.type,
    isLunarEclipse: !!lunar.type,
  };
}
