const fs = require('node:fs/promises');
const path = require('node:path');

const RUNTIME_PACKAGES = [
  ['@libsql', 'darwin-arm64'],
];

async function stageDesktopNativeRuntime(params = {}) {
  const projectRoot = params.projectRoot || process.cwd();
  const runtimeRoot = path.join(projectRoot, '.desktop-runtime', 'node_modules');

  await fs.rm(runtimeRoot, { force: true, recursive: true });

  for (const packageSegments of RUNTIME_PACKAGES) {
    const sourcePackagePath = path.join(projectRoot, 'node_modules', ...packageSegments);
    const destinationPackagePath = path.join(runtimeRoot, ...packageSegments);
    await fs.mkdir(path.dirname(destinationPackagePath), { recursive: true });
    await fs.cp(sourcePackagePath, destinationPackagePath, {
      force: true,
      recursive: true,
    });
  }
}

module.exports = {
  stageDesktopNativeRuntime,
};
