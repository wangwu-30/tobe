import path from 'node:path';
import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

const external = new Set([
  'electron',
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);

export default defineConfig({
  build: {
    emptyOutDir: false,
    rollupOptions: {
      external: [...external],
    },
    sourcemap: true,
    target: 'node20',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
