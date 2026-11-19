import fs from 'node:fs';
import module from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const srcRoot = path.join(repoRoot, 'src');

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs'];

function resolveCandidateFile(basePath) {
  if (fs.existsSync(basePath) && fs.statSync(basePath).isFile()) {
    return basePath;
  }
  for (const ext of RESOLVE_EXTENSIONS) {
    const withExt = `${basePath}${ext}`;
    if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) {
      return withExt;
    }
  }
  if (fs.existsSync(basePath) && fs.statSync(basePath).isDirectory()) {
    for (const ext of RESOLVE_EXTENSIONS) {
      const indexFile = path.join(basePath, `index${ext}`);
      if (fs.existsSync(indexFile) && fs.statSync(indexFile).isFile()) {
        return indexFile;
      }
    }
  }
  return null;
}

function resolveTypeScriptSpecifier(specifier, parentURL) {
  if (specifier.startsWith('@/')) {
    const target = resolveCandidateFile(path.join(srcRoot, specifier.slice(2)));
    if (target) return pathToFileURL(target).href;
  }
  if (
    parentURL &&
    parentURL.startsWith('file:') &&
    (specifier.startsWith('./') || specifier.startsWith('../'))
  ) {
    const parentDir = path.dirname(fileURLToPath(parentURL));
    const target = resolveCandidateFile(path.resolve(parentDir, specifier));
    if (target) return pathToFileURL(target).href;
  }
  return null;
}

if (typeof module.registerHooks === 'function') {
  module.registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'server-only') {
        return {
          shortCircuit: true,
          url: 'data:text/javascript,export default {};',
        };
      }
      if (specifier === 'next/server') {
        return nextResolve('next/server.js', context);
      }
      const mapped = resolveTypeScriptSpecifier(specifier, context.parentURL);
      if (mapped) {
        return {
          shortCircuit: true,
          url: mapped,
        };
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (
        url.startsWith('file:') &&
        (url.endsWith('.ts') || url.endsWith('.tsx') || url.endsWith('.mts'))
      ) {
        const filePath = fileURLToPath(url);
        const source = fs.readFileSync(filePath, 'utf8');
        const transpiled = ts.transpileModule(source, {
          compilerOptions: {
            esModuleInterop: true,
            inlineSourceMap: true,
            jsx: ts.JsxEmit.ReactJSX,
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
          fileName: filePath,
        });
        return {
          format: 'module',
          shortCircuit: true,
          source: transpiled.outputText,
        };
      }
      return nextLoad(url, context);
    },
  });
}
