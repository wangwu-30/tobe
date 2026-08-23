import { builtinModules } from 'node:module';
import path from 'node:path';
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
    outDir: '.vite/room-session-host',
    ssr: true,
    rollupOptions: {
      external: [...external],
      input: {
        index: path.resolve(__dirname, 'apps/room-session-host/src/index.ts'),
        'process-test-host': path.resolve(
          __dirname,
          'apps/room-session-host/src/process-test-host.ts'
        ),
      },
      treeshake: {
        moduleSideEffects: false,
      },
      output: {
        entryFileNames: '[name].mjs',
        format: 'es',
      },
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
