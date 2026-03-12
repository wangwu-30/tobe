const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PRODUCT_NAME = '成形';

async function finalizePackagedApps(params) {
  const appPaths = await findPackagedApps(params.outputPaths || [], params.productName || PRODUCT_NAME);
  if (appPaths.length === 0) {
    throw new Error('Could not find any packaged .app bundles to finalize.');
  }

  const identity = resolveSigningIdentity();
  for (const appPath of appPaths) {
    await signPackagedApp(appPath, identity);
    await verifyPackagedApp(appPath);
  }

  return appPaths;
}

async function findPackagedApps(outputPaths, productName = PRODUCT_NAME) {
  const appPaths = [];
  for (const outputPath of outputPaths) {
    const resolvedPath = path.resolve(outputPath);
    const stats = await fs.stat(resolvedPath).catch(() => null);
    if (!stats) {
      continue;
    }

    if (stats.isDirectory() && resolvedPath.endsWith('.app')) {
      appPaths.push(resolvedPath);
      continue;
    }

    if (!stats.isDirectory()) {
      continue;
    }

    const explicitProductBundle = path.join(resolvedPath, `${productName}.app`);
    const explicitStats = await fs.stat(explicitProductBundle).catch(() => null);
    if (explicitStats?.isDirectory()) {
      appPaths.push(explicitProductBundle);
      continue;
    }

    const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.endsWith('.app')) {
        appPaths.push(path.join(resolvedPath, entry.name));
      }
    }
  }

  return [...new Set(appPaths)];
}

async function signPackagedApp(appPath, identity) {
  const args = ['--force', '--deep', '--sign', identity];
  if (identity !== '-' && process.env.APPLE_SIGN_HARDENED_RUNTIME === '1') {
    args.push('--options', 'runtime');
  }
  args.push(appPath);
  await runCommand('codesign', args);
}

async function verifyPackagedApp(appPath) {
  await runCommand('codesign', ['--verify', '--deep', '--strict', '--verbose=4', appPath]);
}

function resolveSigningIdentity() {
  const configuredIdentity = process.env.APPLE_SIGN_IDENTITY?.trim();
  if (configuredIdentity) {
    return configuredIdentity;
  }

  return '-';
}

async function runCommand(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(' ')} failed with exit code ${code ?? 'unknown'}.\n${output.trim()}`
        )
      );
    });
  });
}

if (require.main === module) {
  finalizePackagedApps({
    outputPaths: process.argv.slice(2),
  })
    .then((appPaths) => {
      process.stdout.write(
        `[desktop package] finalized ${appPaths.length} app bundle(s): ${appPaths.join(', ')}\n`
      );
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  finalizePackagedApps,
  findPackagedApps,
};
