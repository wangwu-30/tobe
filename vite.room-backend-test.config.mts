import { builtinModules } from 'node:module';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    emptyOutDir: true,
    modulePreload: false,
    outDir: '.tmp/room-backend-test',
    ssr: path.resolve(__dirname, 'src/objects/room/room-test-entry.ts'),
    rollupOptions: {
      external: [
        ...builtinModules,
        ...builtinModules.map((moduleName) => `node:${moduleName}`),
      ],
      output: {
        entryFileNames: 'room-backend.mjs',
        format: 'es',
      },
    },
    sourcemap: true,
    target: 'node20',
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
});
