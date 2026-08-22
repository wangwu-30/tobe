import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { controlPlaneTestGroups } from './control-plane-test-inventory.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const playwrightCli = path.join(repoRoot, 'node_modules', 'playwright', 'cli.js');
const artifactsRoot = path.join(repoRoot, '.tmp', 'control-plane-tests');

export const controlPlaneInventoryRoots = [
  'apps',
  'src',
  'tests/control-plane',
];

export const testPolicyRoots = ['apps', 'scripts', 'src', 'tests'];

const forbiddenTestModifiers = new Set(['fixme', 'only', 'skip', 'todo']);
const testApiNames = new Set(['describe', 'it', 'test']);
const sourceExtensions = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
]);

export const controlPlaneConfigs = controlPlaneTestGroups.map(
  ({ config, id }) => ({ id, path: config })
);

export const controlPlaneBuilds = [
  { id: 'execution-daemon', command: ['npm', 'run', 'execution:daemon:build'] },
  { id: 'room-session-host', command: ['npm', 'run', 'room:host:build'] },
  {
    id: 'knowledge-merge-worker',
    command: ['npm', 'run', 'knowledge:merge-worker:build'],
  },
];

export const scriptTests = [
  'scripts/bootstrap-local-db.test.mjs',
  'scripts/browser-preflight.test.mjs',
  'scripts/test-ai-inspector.test.mjs',
  'scripts/test-control-plane.test.mjs',
  'scripts/verify-iteration.test.mjs',
];

export async function discoverSourceTests(root = repoRoot) {
  const testFiles = [];
  for (const relativeRoot of controlPlaneInventoryRoots) {
    await collectTestFiles(path.join(root, relativeRoot), testFiles);
  }
  return testFiles.map((file) => path.resolve(file)).sort(compareText);
}

export function compareTestInventory(actualFiles, configuredByFile) {
  const actual = new Set(actualFiles.map((file) => path.resolve(file)));
  const missing = [];
  const duplicated = [];
  const unexpected = [];

  for (const file of actual) {
    const configs = configuredByFile.get(file) || [];
    if (configs.length === 0) missing.push(file);
    if (configs.length > 1) duplicated.push({ file, configs: [...configs] });
  }
  for (const [file, configs] of configuredByFile) {
    if (!actual.has(file)) unexpected.push({ file, configs: [...configs] });
  }

  missing.sort(compareText);
  duplicated.sort((left, right) => compareText(left.file, right.file));
  unexpected.sort((left, right) => compareText(left.file, right.file));
  return { duplicated, missing, unexpected };
}

export async function checkControlPlaneInventory() {
  const actualFiles = await discoverSourceTests();
  const configuredByFile = configuredTestsFromManifest();
  const mismatch = compareTestInventory(actualFiles, configuredByFile);
  if (
    mismatch.missing.length > 0 ||
    mismatch.duplicated.length > 0 ||
    mismatch.unexpected.length > 0
  ) {
    throw new Error(formatInventoryMismatch(mismatch));
  }

  const policyViolations = await discoverForbiddenTestModifiers();
  if (policyViolations.length > 0) {
    throw new Error(formatTestPolicyViolations(policyViolations));
  }

  process.stdout.write(
    `[test:control-plane] inventory: ${actualFiles.length} test files, each matched exactly once\n`
  );
  return actualFiles;
}

export async function discoverForbiddenTestModifiers(root = repoRoot) {
  const sourceFiles = [];
  for (const relativeRoot of testPolicyRoots) {
    await collectSourceFiles(path.join(root, relativeRoot), sourceFiles);
  }

  const violations = [];
  for (const file of sourceFiles.sort(compareText)) {
    const source = await fs.readFile(file, 'utf8');
    violations.push(...findForbiddenTestModifiers(source, file));
  }
  return violations.sort((left, right) =>
    compareText(
      `${left.file}:${String(left.line).padStart(8, '0')}:${String(left.column).padStart(8, '0')}`,
      `${right.file}:${String(right.line).padStart(8, '0')}:${String(right.column).padStart(8, '0')}`
    )
  );
}

export function findForbiddenTestModifiers(source, file = 'source.ts') {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForFile(file)
  );
  const violations = [];

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const callPath = propertyAccessPath(node.expression);
      const modifier = forbiddenModifierInPath(callPath);
      if (modifier) addViolation(node.expression, callPath.join('.'));

      if (
        callPath.length === 1 &&
        testApiNames.has(callPath[0]) &&
        node.arguments.length > 1 &&
        ts.isObjectLiteralExpression(node.arguments[1])
      ) {
        for (const property of node.arguments[1].properties) {
          const name = propertyNameText(property.name);
          if (name && forbiddenTestModifiers.has(name)) {
            addViolation(property, `${callPath[0]} option ${name}`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  function addViolation(node, expression) {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    violations.push({
      column: position.character + 1,
      expression,
      file: path.resolve(file),
      line: position.line + 1,
    });
  }

  visit(sourceFile);
  return violations;
}

async function main() {
  const args = process.argv.slice(2);
  const inventoryOnly = args.length === 1 && args[0] === '--inventory-only';
  if (args.length > 0 && !inventoryOnly) {
    throw new Error(
      `Unknown arguments: ${args.join(' ')}. Expected no arguments or --inventory-only.`
    );
  }

  if (inventoryOnly) {
    await checkControlPlaneInventory();
    return;
  }
  await runControlPlaneGate();
}

export async function runControlPlaneGate(options = {}) {
  const inventory = options.checkInventory || checkControlPlaneInventory;
  const cleanArtifacts =
    options.cleanArtifacts ||
    (() => fs.rm(artifactsRoot, { force: true, recursive: true }));
  const run = options.runStep || runStep;

  await inventory();
  await cleanArtifacts();
  await run('script-contracts', [process.execPath, '--test', ...scriptTests]);
  for (const build of controlPlaneBuilds) {
    await run(`build:${build.id}`, build.command);
  }
  for (const config of controlPlaneConfigs) {
    await run(`tests:${config.id}`, [
      process.execPath,
      playwrightCli,
      'test',
      `--config=${config.path}`,
    ]);
  }
}

export function configuredTestsFromManifest(
  groups = controlPlaneTestGroups,
  root = repoRoot
) {
  const configuredByFile = new Map();
  for (const group of groups) {
    if (group.testMatch.length === 0) {
      throw new Error(`Control-plane config matched no tests: ${group.config}`);
    }
    const testDirectory = path.resolve(root, group.testDir);
    for (const match of group.testMatch) {
      if (hasGlobSyntax(match) || !match.endsWith('.test.ts')) {
        throw new Error(
          `Control-plane inventory entries must be exact *.test.ts paths: ${match}`
        );
      }
      const file = path.resolve(testDirectory, match);
      if (!isWithinDirectory(testDirectory, file)) {
        throw new Error(
          `Control-plane inventory entry escapes its testDir: ${group.id}: ${match}`
        );
      }
      const configs = configuredByFile.get(file) || [];
      configs.push(group.id);
      configuredByFile.set(file, configs);
    }
  }
  return configuredByFile;
}

function isWithinDirectory(directory, file) {
  const relative = path.relative(directory, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

function hasGlobSyntax(value) {
  return /[*?{}[\]]/u.test(value);
}

async function collectTestFiles(directory, target) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compareText(left.name, right.name));
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') await collectTestFiles(entryPath, target);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.test.ts')) target.push(entryPath);
  }
}

async function collectSourceFiles(directory, target) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compareText(left.name, right.name));
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name !== 'generated' &&
        entry.name !== 'node_modules' &&
        !entry.name.startsWith('.')
      ) {
        await collectSourceFiles(entryPath, target);
      }
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      target.push(entryPath);
    }
  }
}

function forbiddenModifierInPath(callPath) {
  if (callPath.length < 2 || !testApiNames.has(callPath[0])) return undefined;
  return callPath.find(
    (part, index) => index > 0 && forbiddenTestModifiers.has(part)
  );
}

function propertyAccessPath(node) {
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isPropertyAccessExpression(node)) {
    const parent = propertyAccessPath(node.expression);
    return parent.length > 0 ? [...parent, node.name.text] : [];
  }
  if (ts.isElementAccessExpression(node)) {
    const parent = propertyAccessPath(node.expression);
    const property = propertyNameText(node.argumentExpression);
    return parent.length > 0 && property ? [...parent, property] : [];
  }
  return [];
}

function propertyNameText(node) {
  if (!node) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
  return undefined;
}

function scriptKindForFile(file) {
  const extension = path.extname(file);
  if (extension === '.js' || extension === '.cjs' || extension === '.mjs') {
    return ts.ScriptKind.JS;
  }
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  return ts.ScriptKind.TS;
}

function formatInventoryMismatch({ duplicated, missing, unexpected }) {
  const lines = [
    '[test:control-plane] deterministic test inventory failed.',
    'Every apps/**, src/**, and tests/control-plane/** *.test.ts file must match exactly one dedicated config.',
  ];
  appendFiles(lines, 'Unmatched test files', missing);
  appendFiles(
    lines,
    'Test files matched by multiple configs',
    duplicated.map(({ file, configs }) => `${file} (${configs.join(', ')})`)
  );
  appendFiles(
    lines,
    'Configured files outside the discovered inventory',
    unexpected.map(({ file, configs }) => `${file} (${configs.join(', ')})`)
  );
  return lines.map((line) => relativizeLine(line)).join('\n');
}

function formatTestPolicyViolations(violations) {
  return [
    '[test:control-plane] forbidden test modifiers found.',
    'Release tests must not use skip, todo, only, or fixme:',
    ...violations.map(
      ({ column, expression, file, line }) =>
        `  - ${file}:${line}:${column} (${expression})`
    ),
  ]
    .map((line) => relativizeLine(line))
    .join('\n');
}

function appendFiles(lines, label, files) {
  if (files.length === 0) return;
  lines.push(`${label}:`);
  for (const file of files) lines.push(`  - ${file}`);
}

function relativizeLine(line) {
  return line.replaceAll(`${repoRoot}${path.sep}`, '');
}

function runStep(label, command) {
  process.stdout.write(`\n[test:control-plane] ${label}\n`);
  return runCommand(command, 'inherit');
}

function runCommand(command, stdio) {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: repoRoot,
      env: process.env,
      stdio,
    });
    let stdout = '';
    let stderr = '';
    if (stdio === 'pipe') {
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
    }
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve({ stderr, stdout });
        return;
      }
      reject(
        new Error(
          `Command failed with exit code ${code ?? 'unknown'}: ${command.join(' ')}${
            stderr ? `\n${stderr}` : ''
          }`
        )
      );
    });
  });
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(errorMessage(error));
    process.exit(1);
  });
}
