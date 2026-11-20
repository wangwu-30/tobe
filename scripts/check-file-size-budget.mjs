import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const defaultBudgetPath = path.join(repoRoot, 'scripts', 'file-size-budget.json');

export const fileSizeBudgetRoots = ['apps', 'scripts', 'src'];

const ignoredDirectories = new Set([
  '.next',
  '.vite',
  'dist',
  'generated',
  'node_modules',
]);

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

const testFilePattern = /\.(test|spec)\.[^.]+$/u;
const apiRoutePattern = /^src\/app\/api\/(?:.+\/)?route\.[^.]+$/u;

export function countSourceLines(source) {
  if (source.length === 0) {
    return 0;
  }
  const normalized = source.replace(/\r\n/gu, '\n');
  return normalized.endsWith('\n')
    ? normalized.split('\n').length - 1
    : normalized.split('\n').length;
}

export function defaultCeilingForFile(relativeFile, config) {
  return apiRoutePattern.test(relativeFile)
    ? config.apiRouteMaxLines
    : config.defaultMaxLines;
}

export function validateBudgetConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('file-size-budget.json must be a JSON object');
  }
  for (const key of ['defaultMaxLines', 'apiRouteMaxLines', 'ratchetSlackLines']) {
    const value = config[key];
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`file-size-budget.json: "${key}" must be a positive integer`);
    }
  }
  if (
    !config.exemptDataFiles ||
    typeof config.exemptDataFiles !== 'object' ||
    Array.isArray(config.exemptDataFiles)
  ) {
    throw new Error('file-size-budget.json: "exemptDataFiles" must be an object');
  }
  if (
    !config.legacyAllowlist ||
    typeof config.legacyAllowlist !== 'object' ||
    Array.isArray(config.legacyAllowlist)
  ) {
    throw new Error('file-size-budget.json: "legacyAllowlist" must be an object');
  }

  const exemptPaths = new Set();
  for (const [file, reason] of Object.entries(config.exemptDataFiles)) {
    if (typeof reason !== 'string' || reason.trim().length === 0) {
      throw new Error(
        `file-size-budget.json: exemptDataFiles["${file}"] must declare a non-empty reason`
      );
    }
    exemptPaths.add(file);
  }

  for (const [file, maxLines] of Object.entries(config.legacyAllowlist)) {
    if (exemptPaths.has(file)) {
      throw new Error(
        `file-size-budget.json: "${file}" cannot appear in both exemptDataFiles and legacyAllowlist`
      );
    }
    const ceiling = defaultCeilingForFile(file, config);
    if (!Number.isInteger(maxLines) || maxLines <= ceiling) {
      throw new Error(
        `file-size-budget.json: legacyAllowlist["${file}"] (${maxLines}) must be an integer greater than default ceiling (${ceiling})`
      );
    }
  }
}

export function evaluateFileSizeBudget(lineCountsByFile, config) {
  validateBudgetConfig(config);
  const violations = [];
  const scannedFiles = new Set(Object.keys(lineCountsByFile));

  for (const exemptFile of Object.keys(config.exemptDataFiles).sort(compareText)) {
    if (!scannedFiles.has(exemptFile)) {
      violations.push({
        file: exemptFile,
        lines: 0,
        limit: 0,
        message: 'stale exemptDataFiles entry does not match any scanned production file',
        rule: 'stale-exempt-entry',
      });
    }
  }

  for (const [allowlistedFile, allowedMax] of Object.entries(
    config.legacyAllowlist
  ).sort(([left], [right]) => compareText(left, right))) {
    if (!scannedFiles.has(allowlistedFile)) {
      violations.push({
        file: allowlistedFile,
        lines: 0,
        limit: allowedMax,
        message: 'stale legacyAllowlist entry does not match any scanned production file; remove it',
        rule: 'stale-allowlist-entry',
      });
      continue;
    }

    const actual = lineCountsByFile[allowlistedFile];
    const ceiling = defaultCeilingForFile(allowlistedFile, config);
    if (actual > allowedMax) {
      violations.push({
        file: allowlistedFile,
        lines: actual,
        limit: allowedMax,
        message: `legacy file grew from pinned ratchet ${allowedMax} to ${actual} lines; decompose instead of growing`,
        rule: 'exceeds-legacy-budget',
      });
    } else if (actual <= ceiling) {
      violations.push({
        file: allowlistedFile,
        lines: actual,
        limit: ceiling,
        message: `file is now ${actual} lines (<= ${ceiling}); remove it from scripts/file-size-budget.json`,
        rule: 'allowlist-entry-under-ceiling',
      });
    } else if (actual <= allowedMax - config.ratchetSlackLines) {
      violations.push({
        file: allowlistedFile,
        lines: actual,
        limit: allowedMax,
        message: `file shrank from ${allowedMax} to ${actual} lines; tighten legacyAllowlist["${allowlistedFile}"] to ${actual}`,
        rule: 'allowlist-ratchet-needs-tightening',
      });
    }
  }

  for (const file of [...scannedFiles].sort(compareText)) {
    if (
      Object.prototype.hasOwnProperty.call(config.exemptDataFiles, file) ||
      Object.prototype.hasOwnProperty.call(config.legacyAllowlist, file)
    ) {
      continue;
    }

    const actual = lineCountsByFile[file];
    const ceiling = defaultCeilingForFile(file, config);
    if (actual > ceiling) {
      const rule = apiRoutePattern.test(file)
        ? 'exceeds-api-route-budget'
        : 'exceeds-default-budget';
      violations.push({
        file,
        lines: actual,
        limit: ceiling,
        message: `file has ${actual} lines (budget <= ${ceiling}); split cohesive helpers/sub-modules instead of adding a monolith`,
        rule,
      });
    }
  }

  return violations.sort((left, right) =>
    compareText(`${left.file}:${left.rule}`, `${right.file}:${right.rule}`)
  );
}

export async function collectProductionFileLineCounts(
  root = repoRoot,
  roots = fileSizeBudgetRoots
) {
  const files = [];
  for (const relativeRoot of roots) {
    await collectSourceFiles(path.join(root, relativeRoot), files);
  }

  const lineCountsByFile = {};
  for (const absoluteFile of files.sort(compareText)) {
    const relativeFile = toPosixPath(path.relative(root, absoluteFile));
    const source = await fs.readFile(absoluteFile, 'utf8');
    lineCountsByFile[relativeFile] = countSourceLines(source);
  }
  return lineCountsByFile;
}

export function formatFileSizeBudgetViolations(violations) {
  return [
    '[verify:iteration:file-size-budget] production file-size ratchet failed.',
    'Keep production files modular and monotonically shrink scripts/file-size-budget.json:',
    ...violations.map(
      ({ file, lines, limit, message, rule }) =>
        `  - ${file} (${lines}/${limit} lines) [${rule}] ${message}`
    ),
  ].join('\n');
}

export async function checkFileSizeBudget(options = {}) {
  const root = options.root || repoRoot;
  const budgetPath = options.budgetPath || defaultBudgetPath;
  const config =
    options.config || JSON.parse(await fs.readFile(budgetPath, 'utf8'));
  const lineCounts =
    options.lineCounts ||
    (await collectProductionFileLineCounts(root, options.roots || fileSizeBudgetRoots));
  const violations = evaluateFileSizeBudget(lineCounts, config);

  if (violations.length > 0) {
    throw new Error(formatFileSizeBudgetViolations(violations));
  }

  const fileCount = Object.keys(lineCounts).length;
  const legacyCount = Object.keys(config.legacyAllowlist).length;
  process.stdout.write(
    `[verify:iteration:file-size-budget] pass: ${fileCount} files checked (default <= ${config.defaultMaxLines}, api route <= ${config.apiRouteMaxLines}, legacy ratchet entries: ${legacyCount})\n`
  );
  return { fileCount, legacyCount, violations };
}

async function collectSourceFiles(directory, output) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) {
        continue;
      }
      await collectSourceFiles(path.join(directory, entry.name), output);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const extension = path.extname(entry.name);
    if (!sourceExtensions.has(extension)) {
      continue;
    }
    if (testFilePattern.test(entry.name)) {
      continue;
    }
    output.push(path.join(directory, entry.name));
  }
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function compareText(left, right) {
  return left.localeCompare(right, 'en');
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  checkFileSizeBudget().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
