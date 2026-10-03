import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: {
        'main/index': 'src/main/index.ts',
        'renderer/index': 'src/renderer/index.ts',
      },
      formats: ['es'],
    },
    outDir: 'lib',
    rollupOptions: {
      external: [
        '@bsgames/dev-container-api',
        'vue',
      ],
      output: {
        chunkFileNames: 'chunks/[name]-[hash].js',
        entryFileNames: '[name].js',
      },
    },
    sourcemap: true,
  },
  resolve: {
    conditions: [
      'development',
      'node',
    ],
  },
});
