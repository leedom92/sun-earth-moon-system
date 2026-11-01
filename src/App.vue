<script setup>
import TopBar from './components/TopBar.vue';
import LeftConsole from './components/LeftConsole.vue';
import SceneStage from './components/SceneStage.vue';
import RightReadouts from './components/RightReadouts.vue';
import HelpModal from './components/HelpModal.vue';
</script>

<template>
  <TopBar />
  <main>
    <LeftConsole />
    <SceneStage />
    <RightReadouts />
  </main>
  <HelpModal />
</template>
