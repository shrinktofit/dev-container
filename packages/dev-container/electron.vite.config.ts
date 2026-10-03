import { defineConfig } from 'electron-vite';
import vue from '@vitejs/plugin-vue';
import { builtinModules } from 'node:module';
import { resolve } from 'node:path';

const globalExternals: Array<string | RegExp> = [
  'electron',
  /^node:/,
  ...builtinModules,
];

const workspaceRoot = resolve(import.meta.dirname, '../..');
const sourceConditions = [
  'development',
  'node',
];

export default defineConfig({
  main: {
    envDir: workspaceRoot,
    resolve: {
      conditions: sourceConditions,
    },
    build: {
      outDir: 'lib/main',
      sourcemap: true,
      rollupOptions: {
        external: globalExternals,
      },
    },
  },

  preload: {
    envDir: workspaceRoot,
    resolve: {
      conditions: sourceConditions,
    },
    build: {
      outDir: 'lib/preload',
      sourcemap: true,
      rollupOptions: {
        external: globalExternals,
        input: { index: 'src/preload/index.ts', guest: 'src/preload/guest.ts' },
      },
    },
  },

  renderer: {
    envDir: workspaceRoot,
    resolve: {
      conditions: ['development'],
    },
    build: {
      outDir: 'lib/renderer',
      sourcemap: true,
      rollupOptions: {
        input: 'src/renderer/index.html',
      },
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
  },
});
