import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');

export const webInterfaceRoots = [
  'src/app',
  'src/canvas',
  'src/components',
  'src/surfaces',
];

const sourceExtensions = new Set(['.jsx', '.tsx']);
const iconButtonSizes = new Set(['icon', 'icon-lg', 'icon-sm', 'icon-xs']);
/**
 * Deliberately narrow static boundary: this scanner only reports anti-patterns
 * that are decidable from one JSX element or a literal class string. Runtime
 * naming, component composition, actual overflow, and contrast remain covered
 * by axe/browser tests and manual Web Interface Guidelines review.
 */
export function findWebInterfaceViolations(source, file = 'source.tsx') {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForFile(file)
  );
  const parseError = sourceFile.parseDiagnostics.find(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  if (parseError) {
    const position = sourceFile.getLineAndCharacterOfPosition(
      parseError.start || 0
    );
    throw new Error(
      `${file}:${position.line + 1}:${position.character + 1} could not be parsed: ${ts.flattenDiagnosticMessageText(parseError.messageText, ' ')}`
    );
  }
  const violations = [];
  const iconComponentNames = findLucideIconImports(sourceFile);

  function add(node, rule, message) {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    violations.push({
      column: position.character + 1,
      file: path.resolve(file),
      line: position.line + 1,
      message,
      rule,
    });
  }

  function visit(node) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      inspectJsxElement(node, add, iconComponentNames);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations.sort(compareViolation);
}

export async function discoverWebInterfaceViolations(root = repoRoot) {
  const files = [];
  for (const relativeRoot of webInterfaceRoots) {
    await collectSourceFiles(path.join(root, relativeRoot), files);
  }

  const violations = [];
  for (const file of files.sort(compareText)) {
    const source = await fs.readFile(file, 'utf8');
    violations.push(...findWebInterfaceViolations(source, file));
  }
  return violations.sort(compareViolation);
}

export function formatWebInterfaceViolations(violations, root = repoRoot) {
  return [
    '[verify:iteration:web-interface] static anti-pattern scan failed.',
    'Fix these high-confidence Web Interface Guidelines violations:',
    ...violations.map(
      ({ column, file, line, message, rule }) =>
        `  - ${relativePath(file, root)}:${line}:${column} [${rule}] ${message}`
    ),
  ].join('\n');
}

export async function checkWebInterfaceGuidelines(options = {}) {
  const root = options.root || repoRoot;
  const discover = options.discoverViolations || discoverWebInterfaceViolations;
  const violations = await discover(root);
  if (violations.length > 0) {
    throw new Error(formatWebInterfaceViolations(violations, root));
  }
  process.stdout.write(
    `[verify:iteration:web-interface] pass: ${webInterfaceRoots.join(', ')}\n`
  );
  return violations;
}

function inspectJsxElement(node, add, iconComponentNames) {
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  const tag = opening.tagName.getText();
  const attributes = opening.attributes.properties;
  const className = literalAttribute(attributes, 'className');

  if (className) {
    const tokens = className.split(/\s+/u);
    if (ts.isJsxElement(node) && tokens.some(isLowContrastMutedToken)) {
      add(
        opening,
        'muted-text-opacity',
        'do not reduce text-muted-foreground with another opacity modifier'
      );
    }
    if (tokens.includes('transition-all')) {
      add(
        opening,
        'transition-all',
        'list the animated properties instead of using transition-all'
      );
    }
    if (
      tokens.includes('outline-none') &&
      !tokens.some(hasVisibleFocusReplacement)
    ) {
      add(
        opening,
        'focus-visible',
        'outline-none requires a visible focus-visible replacement'
      );
    }
  }

  if (
    (tag === 'Button' || tag === 'button') &&
    !hasJsxSpreadAttribute(attributes)
  ) {
    const size = literalAttribute(attributes, 'size');
    if (
      (iconButtonSizes.has(size) ||
        hasOnlyImportedIconChildren(node, iconComponentNames)) &&
      !hasAccessibleName(attributes, ts.isJsxElement(node) ? node.children : [])
    ) {
      add(
        opening,
        'icon-button-name',
        'icon-only Button needs aria-label, aria-labelledby, title, or sr-only text'
      );
    }
  }

  if (tag === 'ScrollArea' && !hasViewportKeyboardAccess(attributes)) {
    add(
      opening,
      'scroll-region-focus',
      'ScrollArea needs viewportProps with tabIndex and an accessible name'
    );
  }

  if (tag === 'meta' && literalAttribute(attributes, 'name') === 'viewport') {
    const content = literalAttribute(attributes, 'content') || '';
    if (/\buser-scalable\s*=\s*no\b|\bmaximum-scale\s*=\s*1(?:\.0+)?\b/iu.test(content)) {
      add(opening, 'viewport-zoom', 'viewport metadata must not disable zoom');
    }
  }
}

function findLucideIconImports(sourceFile) {
  const names = new Set();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'lucide-react'
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) names.add(element.name.text);
  }
  return names;
}

function hasOnlyImportedIconChildren(node, iconComponentNames) {
  if (!ts.isJsxElement(node) || iconComponentNames.size === 0) return false;
  const children = node.children.filter(
    (child) => !ts.isJsxText(child) || child.text.trim().length > 0
  );
  return (
    children.length > 0 &&
    children.every((child) => isImportedIconChild(child, iconComponentNames))
  );
}

function isImportedIconChild(child, iconComponentNames) {
  if (ts.isJsxSelfClosingElement(child)) {
    return (
      ts.isIdentifier(child.tagName) && iconComponentNames.has(child.tagName.text)
    );
  }
  if (!ts.isJsxElement(child)) return false;
  const className = literalAttribute(
    child.openingElement.attributes.properties,
    'className'
  );
  if (className?.split(/\s+/u).includes('sr-only')) return false;
  const children = child.children.filter(
    (nested) => !ts.isJsxText(nested) || nested.text.trim().length > 0
  );
  return (
    children.length > 0 &&
    children.every((nested) => isImportedIconChild(nested, iconComponentNames))
  );
}

function hasAccessibleName(attributes, children) {
  if (hasAccessibleNameAttributes(attributes)) return true;
  return children.some((child) =>
    ts.isJsxElement(child) &&
    literalAttribute(child.openingElement.attributes.properties, 'className')
      ?.split(/\s+/u)
      .includes('sr-only')
  );
}

function hasAccessibleNameAttributes(attributes) {
  return (
    hasAttribute(attributes, 'aria-label') ||
    hasAttribute(attributes, 'aria-labelledby') ||
    hasAttribute(attributes, 'title')
  );
}

function hasViewportKeyboardAccess(attributes) {
  const viewport = jsxAttribute(attributes, 'viewportProps');
  if (!viewport?.initializer || !ts.isJsxExpression(viewport.initializer)) {
    return false;
  }
  const expression = viewport.initializer.expression;
  if (!expression || !ts.isObjectLiteralExpression(expression)) return false;
  const names = new Set(
    expression.properties.map((property) => propertyNameText(property.name))
  );
  return (
    names.has('tabIndex') &&
    (names.has('aria-label') || names.has('aria-labelledby'))
  );
}

function isLowContrastMutedToken(token) {
  return (
    !token.includes('placeholder:') &&
    /^(?:[a-z-]+:)*text-muted-foreground\/(?:[0-8]?\d)$/u.test(token)
  );
}

function hasVisibleFocusReplacement(token) {
  return /^(?:[a-z-]+:)*focus-visible:(?:ring|outline|border)-/u.test(token);
}

function literalAttribute(attributes, name) {
  const attribute = jsxAttribute(attributes, name);
  if (!attribute?.initializer) return undefined;
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  if (
    ts.isJsxExpression(attribute.initializer) &&
    attribute.initializer.expression &&
    (ts.isStringLiteral(attribute.initializer.expression) ||
      ts.isNoSubstitutionTemplateLiteral(attribute.initializer.expression))
  ) {
    return attribute.initializer.expression.text;
  }
  return undefined;
}

function hasAttribute(attributes, name) {
  return Boolean(jsxAttribute(attributes, name));
}

function hasJsxSpreadAttribute(attributes) {
  return attributes.some((attribute) => ts.isJsxSpreadAttribute(attribute));
}

function jsxAttribute(attributes, name) {
  return attributes.find(
    (attribute) =>
      ts.isJsxAttribute(attribute) &&
      jsxAttributeName(attribute.name) === name
  );
}

function jsxAttributeName(name) {
  return ts.isIdentifier(name) ? name.text : name.getText();
}

function propertyNameText(name) {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return undefined;
}

async function collectSourceFiles(directory, target) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compareText(left.name, right.name));
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'generated' && !entry.name.startsWith('.')) {
        await collectSourceFiles(entryPath, target);
      }
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      target.push(entryPath);
    }
  }
}

function scriptKindForFile(file) {
  return path.extname(file) === '.jsx' ? ts.ScriptKind.JSX : ts.ScriptKind.TSX;
}

function compareViolation(left, right) {
  return compareText(
    `${left.file}:${String(left.line).padStart(8, '0')}:${String(left.column).padStart(8, '0')}:${left.rule}`,
    `${right.file}:${String(right.line).padStart(8, '0')}:${String(right.column).padStart(8, '0')}:${right.rule}`
  );
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function relativePath(file, root) {
  return path.relative(root, file).split(path.sep).join('/');
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  checkWebInterfaceGuidelines().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
