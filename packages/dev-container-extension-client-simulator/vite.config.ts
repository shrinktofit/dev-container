import { builtinModules } from 'node:module';
import vue from '@vitejs/plugin-vue';
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
        /^@bsgames\//,
        /^node:/,
        ...builtinModules,
        '@bsgames/dev-container-api',
        '@bsgames/dev-container-api/layout-commands',
        'vue',
      ],
      output: {
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'chunks/[name]-[hash].js',
        entryFileNames: '[name].js',
      },
    },
    sourcemap: true,
  },
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag === 'webview',
        },
      },
    }),
  ],
  resolve: {
    conditions: [
      'development',
      'node',
    ],
  },
});
