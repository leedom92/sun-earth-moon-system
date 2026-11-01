<script setup>
import { ref, onMounted, watch } from 'vue';
import { drawMoonDisk, drawSunDisk, brightLimbRot, onMoonMapReady } from '../lib/draw2d.js';
import { st, readout, sunDirAngle, lat } from '../composables/useSolarSystem.js';

const cvMoon = ref(null);
const cvSun = ref(null);
let moonCtx = null;
let sunCtx = null;

function drawMoon(s) {
  if (!cvMoon.value) return;
  if (!moonCtx) moonCtx = cvMoon.value.getContext('2d');
  const W = cvMoon.value.width;
  moonCtx.clearRect(0, 0, W, W);
  drawMoonDisk(moonCtx, W / 2, W / 2, W * 0.42, {
    elong: s.elong, rot: brightLimbRot(s.elong, lat.value), eclipse: s.lunar, detail: true,
  });
}

function drawSun(s) {
  if (!cvSun.value) return;
  if (!sunCtx) sunCtx = cvSun.value.getContext('2d');
  const S = cvSun.value.width;
  sunCtx.clearRect(0, 0, S, S);
  drawSunDisk(sunCtx, S / 2, S / 2, S * 0.28, { solar: s.solar, dir: sunDirAngle(s) });
}

function draw(s) {
  drawMoon(s);
  drawSun(s);
}

onMounted(() => {
  draw(st.value);
  // 月面贴图是异步加载的，到位后补画一次，否则卡片会停在简化画法上
  onMoonMapReady(() => draw(st.value));
});
watch(st, (s) => { if (s) draw(s); });
</script>

<template>
  <aside id="right" class="panel-col">
    <section class="card phase-card">
      <h2>月相（阴晴圆缺）</h2>
      <canvas id="moonCv" ref="cvMoon" width="440" height="440"></canvas>
      <div class="phaseName" id="phaseName">{{ readout.phaseName }}</div>
      <div class="illumBar"><i id="illumFill" :style="{ width: readout.illumPct }"></i></div>
      <div class="kv"><span>照亮比例</span><b id="illumText">{{ readout.illumText }}</b></div>
      <div class="kv"><span>月龄</span><b id="ageText">{{ readout.ageText }}</b></div>
    </section>

    <section class="card sun-card">
      <h2>日面形态</h2>
      <canvas id="sunCv" ref="cvSun" width="360" height="360"></canvas>
      <div class="sunState" id="sunState" :class="{ 'ecl-alert': readout.sunAlert }">{{ readout.sunStateText }}</div>
      <div class="kv"><span>日月中心距</span><b id="sepText">{{ readout.sepText }}</b></div>
    </section>

    <section class="card">
      <h2>农历 · 节气</h2>
      <div class="lunarBig" id="lunarText">{{ readout.lunarText }}</div>
      <div class="kv"><span>公历</span><b id="solarText">{{ readout.solarText }}</b></div>
      <div class="kv"><span>节气</span><b id="jieqiText">{{ readout.jieqiText }}</b></div>
      <div class="kv"><span>距下次朔</span><b id="nextNewText">{{ readout.nextNewText }}</b></div>
    </section>

    <section class="card">
      <h2>数据</h2>
      <div class="kv"><span>地月距离</span><b id="dMoon">{{ readout.dMoon }}</b></div>
      <div class="kv"><span>日地距离</span><b id="dSun">{{ readout.dSun }}</b></div>
      <div class="kv"><span>月球视直径</span><b id="angMoon">{{ readout.angMoon }}</b></div>
      <div class="kv"><span>太阳视直径</span><b id="angSun">{{ readout.angSun }}</b></div>
      <div class="kv"><span>月球黄纬</span><b id="latMoon">{{ readout.latMoon }}</b></div>
      <div class="kv"><span>月影锥长度</span><b id="umbText">{{ readout.umbText }}</b></div>
    </section>

    <section class="card know-card">
      <h2>小知识</h2>
      <p id="tipText">{{ readout.tipText }}</p>
    </section>
  </aside>
</template>
