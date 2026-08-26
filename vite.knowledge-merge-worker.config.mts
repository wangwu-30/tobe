import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));
const external = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);

export default defineConfig({
  build: {
    copyPublicDir: false,
    emptyOutDir: true,
    outDir: path.join(root, '.vite/knowledge-merge-worker'),
    modulePreload: false,
    ssr: path.join(root, 'apps/knowledge-merge-worker/src/index.ts'),
    rollupOptions: {
      external: [...external, /^@prisma\//, /^@libsql\//],
      treeshake: {
        moduleSideEffects: false,
      },
      output: {
        entryFileNames: 'index.mjs',
        format: 'es',
      },
    },
    sourcemap: true,
    target: 'node22',
  },
  resolve: {
    alias: { '@': path.join(root, 'src') },
  },
});
