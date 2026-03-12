const fs = require('node:fs/promises');
const path = require('node:path');

async function stageDesktopNativeRuntime(params = {}) {
  const projectRoot = params.projectRoot || process.cwd();
  const sourcePackagePath = path.join(
    projectRoot,
    'node_modules',
    '@libsql',
    'darwin-arm64'
  );
  const runtimeRoot = path.join(projectRoot, '.desktop-runtime', 'node_modules');
  const destinationPackagePath = path.join(runtimeRoot, '@libsql', 'darwin-arm64');

  await fs.rm(runtimeRoot, { force: true, recursive: true });
  await fs.mkdir(path.dirname(destinationPackagePath), { recursive: true });
  await fs.cp(sourcePackagePath, destinationPackagePath, {
    force: true,
    recursive: true,
  });
}

module.exports = {
  stageDesktopNativeRuntime,
};
