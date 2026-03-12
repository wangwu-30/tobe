const path = require('node:path');
const { MakerDMG } = require('@electron-forge/maker-dmg');
const { MakerZIP } = require('@electron-forge/maker-zip');
const { VitePlugin } = require('@electron-forge/plugin-vite');
const {
  stageDesktopNativeRuntime,
} = require('./apps/desktop/scripts/stage-desktop-native-runtime.cjs');
const {
  finalizePackagedApps,
} = require('./apps/desktop/scripts/finalize-packaged-app.cjs');

module.exports = {
  hooks: {
    generateAssets: async () => {
      await stageDesktopNativeRuntime({ projectRoot: __dirname });
    },
    postPackage: async (_forgeConfig, packageResult) => {
      await finalizePackagedApps({
        outputPaths: packageResult.outputPaths,
        productName: '成形',
      });
    },
  },
  packagerConfig: {
    appBundleId: 'com.chengxing.desktop',
    appCategoryType: 'public.app-category.productivity',
    asar: true,
    executableName: '成形',
    ignore: (file) => {
      if (!file) {
        return false;
      }
      return !file.startsWith('/.vite');
    },
    extraResource: [
      path.resolve(__dirname, '.desktop-runtime/node_modules'),
      path.resolve(__dirname, '.vite/build'),
      path.resolve(__dirname, 'prisma'),
      path.resolve(__dirname, 'scripts'),
    ],
    name: '成形',
    osxNotarize:
      process.env.APPLE_API_KEY ||
      process.env.APPLE_API_KEY_ID ||
      process.env.APPLE_ID
        ? {
            appleApiIssuer: process.env.APPLE_API_ISSUER,
            appleApiKey: process.env.APPLE_API_KEY,
            appleApiKeyId: process.env.APPLE_API_KEY_ID,
            appleId: process.env.APPLE_ID,
            appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
            teamId: process.env.APPLE_TEAM_ID,
          }
        : undefined,
    osxSign: process.env.APPLE_SIGN_IDENTITY
      ? {
          identity: process.env.APPLE_SIGN_IDENTITY,
        }
      : undefined,
  },
  plugins: [
    new VitePlugin({
      build: [
        {
          config: 'vite.main.config.mts',
          entry: 'apps/desktop/src/main.ts',
          target: 'main',
        },
        {
          config: 'vite.preload.config.mts',
          entry: 'apps/desktop/src/preload.ts',
          target: 'preload',
        },
        {
          config: 'vite.backend.config.mts',
          entry: 'apps/desktop/src/backend/index.ts',
          target: 'main',
        },
      ],
      renderer: [
        {
          config: 'vite.renderer.config.mts',
          name: 'main_window',
        },
      ],
    }),
  ],
  makers: [
    new MakerZIP({}, ['darwin']),
    ...(process.env.DAO_ENABLE_DMG === '1'
      ? [
          new MakerDMG({
            format: 'ULFO',
          }),
        ]
      : []),
  ],
};
