import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: {
        'index': 'src/index.ts',
        'layout-commands': 'src/layout-commands.ts',
        'game-config': 'src/game-config.ts',
        'client-controls': 'src/client-controls.ts',
        'sdk-protocol': 'src/sdk-protocol.ts',
        'sdk-runtime': 'src/sdk-runtime.ts',
      },
      formats: ['es'],
    },
    outDir: 'lib',
    rollupOptions: {
      external: ['vue'],
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
    sourcemap: true,
  },
});
