import { builtinModules } from 'node:module';
import path from 'node:path';

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    emptyOutDir: true,
    modulePreload: false,
    ssr: path.resolve(
      __dirname,
      'src/lib/workspace/staged-changes-test-entry.ts'
    ),
    rollupOptions: {
      external: [
        ...builtinModules,
        ...builtinModules.map((moduleName) => `node:${moduleName}`),
      ],
      output: {
        entryFileNames: 'staged-changes.mjs',
        format: 'es',
      },
    },
    outDir: '.tmp/staged-changes-test',
    sourcemap: true,
    target: 'node20',
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
});
