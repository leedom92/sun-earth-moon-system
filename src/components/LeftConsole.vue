<script setup>
import {
  dateValue, hourValue, hourText, latValue, latText,
  playing, speed, togglePlay, jump, jumpEclipse,
  options, setOption, autoRotate, setAutoRotate,
} from '../composables/useSolarSystem.js';

const jumps = [
  { key: 'prevNew', label: '上一个朔' },
  { key: 'nextNew', label: '下一个朔' },
  { key: 'quarter1', label: '上弦月' },
  { key: 'full', label: '满月' },
  { key: 'quarter3', label: '下弦月' },
  { key: 'today', label: '回到今天' },
];

const eclipses = [
  { key: 'solar-any', label: '下一次日食' },
  { key: 'solar-total', label: '日全食' },
  { key: 'solar-annular', label: '日环食' },
  { key: 'lunar-any', label: '下一次月食' },
  { key: 'lunar-total', label: '月全食' },
  { key: 'lunar-partial', label: '月偏食' },
];

const checks = [
  { id: 'ckOrbit', key: 'showOrbits', label: '轨道线' },
  { id: 'ckCone', key: 'showCones', label: '影子锥' },
  { id: 'ckRay', key: 'showRays', label: '太阳光线' },
  { id: 'ckGrid', key: 'showGrid', label: '黄道面' },
];

/** 与原实现一致：日期用 change 事件（不是每次 input） */
function onDateChange(e) {
  dateValue.value = e.target.value;
}
</script>

<template>
  <aside id="left" class="panel-col">
    <section class="card">
      <h2>时间</h2>
      <div class="row">
        <label>日期</label>
        <input type="date" id="dateInput" :value="dateValue" @change="onDateChange" />
      </div>
      <div class="row">
        <label>时刻</label>
        <input type="range" id="hourRange" min="0" max="1439" step="5" v-model.number="hourValue" />
        <span id="hourText" class="mono">{{ hourText }}</span>
      </div>
      <div class="row playRow">
        <button id="btnPlay" class="play" :class="{ on: playing }" @click="togglePlay">{{ playing ? '暂停' : '播放' }}</button>
        <select id="speedSel" v-model.number="speed">
          <option :value="0.04167">1 小时 / 秒</option>
          <option :value="0.25">6 小时 / 秒</option>
          <option :value="1">1 天 / 秒</option>
          <option :value="5">5 天 / 秒</option>
          <option :value="15">半个月 / 秒</option>
        </select>
      </div>
      <div class="quickBtns">
        <button v-for="j in jumps" :key="j.key" :data-jump="j.key" @click="jump(j.key)">{{ j.label }}</button>
      </div>
    </section>

    <section class="card">
      <h2>跳到日月食</h2>
      <div class="quickBtns ecl">
        <button v-for="e in eclipses" :key="e.key" :data-ecl="e.key" @click="jumpEclipse(e.key)">{{ e.label }}</button>
      </div>
      <p class="hint">每次朔、望时月球常常从影子的上方或下方掠过，所以要跳到正好对齐的那一刻才看得到食。</p>
    </section>

    <section class="card">
      <h2>观测地与显示</h2>
      <div class="row">
        <label>纬度</label>
        <input type="range" id="latRange" min="-60" max="70" step="1" v-model.number="latValue" />
        <span id="latText" class="mono">{{ latText }}</span>
      </div>
      <div class="checks">
        <label v-for="c in checks" :key="c.id">
          <input
            type="checkbox"
            :id="c.id"
            :checked="options[c.key]"
            @change="setOption(c.key, $event.target.checked)"
          /> {{ c.label }}
        </label>
        <label>
          <input
            type="checkbox"
            id="ckSpin"
            :checked="autoRotate"
            @change="setAutoRotate($event.target.checked)"
          /> 自动旋转
        </label>
      </div>
    </section>

    <section class="card tip-card">
      <h2>怎么玩</h2>
      <ul>
        <li>在三维场景里<strong>直接拖动地球或月球</strong>，就能改变时间。</li>
        <li>拖动场景空白处旋转视角，滚轮缩放。</li>
        <li>左下角的圆是<strong>此刻从地球看到的天空</strong>：天顶在圆心，地平线在圆周。</li>
        <li>把时刻调到白天/夜晚，看太阳和月亮怎么东升西落。</li>
      </ul>
    </section>
  </aside>
</template>
