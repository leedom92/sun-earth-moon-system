<script setup>
import { currentView, setView, savePoster, saveShot, openHelp } from '../composables/useSolarSystem.js';

const views = [
  { key: 'system', label: '太阳系全景' },
  { key: 'earthmoon', label: '地月系统' },
  { key: 'moon', label: '月球特写' },
  { key: 'earth', label: '地球特写' },
];
</script>

<template>
  <header id="topbar">
    <div class="brand">
      <span class="logo"></span>
      <div>
        <h1>太阳 · 地球 · 月球</h1>
        <p>按真实天文规律运行的三维交互课堂</p>
      </div>
    </div>
    <nav class="viewBtns">
      <button
        v-for="v in views"
        :key="v.key"
        :data-view="v.key"
        :class="{ on: currentView === v.key }"
        @click="setView(v.key)"
      >{{ v.label }}</button>
    </nav>
    <div class="actions">
      <button id="btnPoster" class="primary" @click="savePoster">保存观测卡</button>
      <button id="btnShot" @click="saveShot">保存当前画面</button>
      <button id="btnHelp" @click="openHelp">说明</button>
    </div>
  </header>
</template>
