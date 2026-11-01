<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { drawSkyChart } from '../lib/draw2d.js';
import { drawFlatScene } from '../lib/flat2d.js';
import * as A from '../lib/astro.js';
import {
  initScene, st, lat, LON, hint, labelPos, stars, sunDirAngle, readout,
  glOk, glReason, currentView, flatCanvas,
} from '../composables/useSolarSystem.js';

const cvGl = ref(null);
const cvSky = ref(null);
const cvFlat = ref(null);
let skyCtx = null;
let flatCtx = null;

/** 左下角的天空穹顶：天顶在圆心，地平线在圆周 */
function drawSky(s) {
  if (!cvSky.value || !s) return;
  if (!skyCtx) skyCtx = cvSky.value.getContext('2d');
  const K = cvSky.value.width;
  skyCtx.clearRect(0, 0, K, K);
  try {
    drawSkyChart(skyCtx, K / 2, K / 2, K / 2 - 8, {
      sunHz: s.sunHz,
      moonHz: s.moonHz,
      stars,
      horizonFn: (ra, dec) => A.horizontal(ra, dec, s.jd, lat.value, LON),
      elong: s.elong,
      solar: s.solar,
      eclipse: s.lunar,
      sunDir: sunDirAngle(s),
    });
  } catch (e) {
    console.warn('[sky] 天空图绘制失败：', e);
  }
}

/** 三维不可用时的二维示意图（俯视黄道面） */
function drawFlat() {
  const cv = cvFlat.value;
  if (!cv) return;
  const w = cv.clientWidth || 1;
  const h = cv.clientHeight || 1;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = Math.round(w * dpr);
  const ch = Math.round(h * dpr);
  if (cv.width !== cw || cv.height !== ch) {
    cv.width = cw; cv.height = ch;
    flatCtx = null;
  }
  if (!flatCtx) flatCtx = cv.getContext('2d');
  flatCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  try {
    drawFlatScene(flatCtx, w, h, st.value, { view: currentView.value });
  } catch (e) {
    console.warn('[flat] 二维示意图绘制失败：', e);
  }
}

const noWebgl = computed(() => glReason.value.includes('没有可用的 WebGL'));

function labelStyle(name) {
  const p = labelPos[name];
  return { left: `${p.left}px`, top: `${p.top}px`, opacity: p.opacity };
}

function onResize() {
  if (!glOk.value) drawFlat();
}

function reload() { location.reload(); }

onMounted(async () => {
  // 天空图与三维渲染彼此独立：三维初始化失败不能连带把天空图也弄没
  drawSky(st.value);
  initScene(cvGl.value);
  await nextTick();
  if (!glOk.value) {
    flatCanvas.value = cvFlat.value;
    drawFlat();
  }
  window.addEventListener('resize', onResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
});

watch(st, (s) => {
  if (s) drawSky(s);
  if (!glOk.value) drawFlat();
});

watch([currentView, glOk], () => {
  if (!glOk.value) {
    flatCanvas.value = cvFlat.value;
    drawFlat();
  }
}, { flush: 'post' });
</script>

<template>
  <section id="stage">
    <canvas id="gl" ref="cvGl" v-show="glOk"></canvas>
    <canvas v-if="!glOk" id="flat" ref="cvFlat"></canvas>
    <div class="labels" v-show="glOk">
      <div class="lbl" id="lblSun" :style="labelStyle('sun')">太阳</div>
      <div class="lbl" id="lblEarth" :style="labelStyle('earth')">地球</div>
      <div class="lbl" id="lblMoon" :style="labelStyle('moon')">月球</div>
    </div>
    <div v-if="!glOk" id="glNotice">
      <div class="glIco">!</div>
      <div class="glTxt">
        <b>三维场景无法显示</b>：{{ glReason }}。已自动切换为二维示意图，日地月的位置、月相与日月食仍按真实天文量计算。
        <em v-if="noWebgl">开启办法：浏览器「设置 → 系统 → 使用图形加速功能（如可用）」打开后重启浏览器；远程桌面或虚拟机环境可能无法开启。</em>
      </div>
      <button type="button" class="glBtn" @click="reload">重新检测</button>
    </div>
    <div id="skyPanel">
      <canvas id="sky" ref="cvSky" width="440" height="440"></canvas>
      <div class="skyCap">此刻的天空（从地球看）</div>
      <div class="skyInfo" id="skyInfo" v-html="readout.skyInfo"></div>
    </div>
    <div id="scaleNote">天体做了适度放大（否则屏幕上只是一个小点），日地距离也大幅压缩；所有读数、月相与日月食仍按真实物理量计算。</div>
    <div id="dragHint" v-show="glOk" :class="{ hide: hint.hidden }">{{ hint.text }}</div>
  </section>
</template>
