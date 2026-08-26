import path from 'node:path';
import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

const external = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);

export default defineConfig({
  build: {
    copyPublicDir: false,
    emptyOutDir: true,
    modulePreload: false,
    outDir: '.vite/execution-daemon',
    ssr: path.resolve(__dirname, 'apps/execution-daemon/src/index.ts'),
    rollupOptions: {
      external: [...external],
      output: {
        entryFileNames: 'index.mjs',
        format: 'es',
      },
    },
    sourcemap: true,
    target: 'node22',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
