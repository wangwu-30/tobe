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
    commonjsOptions: {
      ignoreDynamicRequires: true,
    },
    emptyOutDir: false,
    rollupOptions: {
      external: [...external],
      output: {
        entryFileNames: 'backend.js',
      },
    },
    sourcemap: true,
    target: 'node20',
  },
  define: {
    'process.env.NEXT_RUNTIME': JSON.stringify('nodejs'),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
