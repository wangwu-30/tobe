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
      'src/objects/room-tool-confirmation/test-entry.ts'
    ),
    rollupOptions: {
      external: [
        ...builtinModules,
        ...builtinModules.map((moduleName) => `node:${moduleName}`),
      ],
      output: {
        entryFileNames: 'room-tool-confirmation.mjs',
        format: 'es',
      },
    },
    outDir: '.tmp/room-tool-confirmation-test',
    sourcemap: true,
    target: 'node22',
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
});
