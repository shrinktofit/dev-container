import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: 'esm',
  platform: 'browser',
  sourcemap: false,
  inputOptions: { experimental: { attachDebugInfo: 'none' } },
  clean: true,
  dts: {
    resolver: 'tsc',
    eager: true,
    sourcemap: false,
  },
  deps: { alwaysBundle: ['@bsgames/dev-container-api'] },
});
