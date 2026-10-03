import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({
  plugins: [vue()],
  resolve: { conditions: ['development'] },
  build: {
    outDir: 'lib',
    sourcemap: true,
    lib: {
      entry: { 'main/index': 'src/main/index.ts', 'renderer/index': 'src/renderer/index.ts' },
      formats: ['es'],
    },
    rollupOptions: {
      external: [
        'vue',
        '@bsgames/dev-container-api',
        '@bsgames/dev-container-api/layout-commands',
        '@bsgames/dev-container-api/client-controls',
        '@bsgames/dev-container-api/sdk-protocol',
      ],
      output: { entryFileNames: '[name].js' },
    },
  },
});
