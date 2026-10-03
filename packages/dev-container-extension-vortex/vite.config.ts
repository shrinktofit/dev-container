import { defineConfig } from 'vite';
export default defineConfig({
  resolve: { conditions: ['development'] },
  build: {
    outDir: 'lib',
    sourcemap: true,
    lib: { entry: { 'main/index': 'src/main/index.ts' }, formats: ['es'] },
    rollupOptions: { external: [/^node:/, '@bsgames/dev-container-api'], output: { entryFileNames: '[name].js' } },
  },
});
