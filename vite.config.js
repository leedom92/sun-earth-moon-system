import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

/**
 * three.js 使用仓库内 vendor 的 ESM 版本（不装 npm 包），
 * 所以要把裸模块名 three 指到本地文件；OrbitControls.js 里的 import ... from 'three'
 * 也靠这条别名解析。
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      three: fileURLToPath(new URL('./src/vendor/three.module.js', import.meta.url)),
    },
  },
  // 之前静态托管时是相对路径引用，这里保持一致，构建产物可以放在任意子目录
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
});
