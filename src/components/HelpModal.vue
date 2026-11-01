<script setup>
import { helpOpen, closeHelp } from '../composables/useSolarSystem.js';

/** 点遮罩关闭（与原逻辑一致：只有点在 #helpModal 本体上才关） */
function onBackdrop(e) {
  if (e.target.id === 'helpModal') closeHelp();
}
</script>

<template>
  <div id="helpModal" class="modal" :class="{ hide: !helpOpen }" @click="onBackdrop">
    <div class="modalBox">
      <h2>关于这个应用</h2>
      <p>这是一个给小学生、初中生用的天文科普工具：把太阳、地球、月球的真实运动规律算出来，再用三维场景和示意图展示。</p>
      <h3>算的是什么</h3>
      <ul>
        <li>太阳、月球的黄经黄纬：用天文年历的低精度级数（月球黄经误差约 0.3°）。</li>
        <li>月相：由日月地心角距决定，照亮比例 = (1 − cos 角距) / 2。</li>
        <li>农历：由真实的"朔"时刻 + 二十四节气中气推算（含闰月），不是查表。</li>
        <li>日月食：用月球视半径、太阳视半径、地影锥与本影锥长度判定。</li>
        <li>天空位置：由赤经赤纬 + 格林尼治恒星时 + 观测地纬度算出高度角与方位角。</li>
      </ul>
      <h3>场景里做了什么简化</h3>
      <p>天体大小接近真实比例（地球与月球的大小比、距离比基本正确），但日地距离被压缩了——真实情况下太阳到地球约等于 389 倍的地月距离，无法同屏显示。所有读数、月相和食的判定都不受这个简化的影响。</p>
      <button id="btnCloseHelp" class="primary" @click="closeHelp">知道了</button>
    </div>
  </div>
</template>
