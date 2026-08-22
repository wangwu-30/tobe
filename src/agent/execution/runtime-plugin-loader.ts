import nodePath from 'node:path';
import { pathToFileURL } from 'node:url';

import { RUNTIME_CONTRACT_VERSION_V1 } from './contracts';
import type { ExecutionRuntimeDriverV1 } from './driver';
import {
  EXECUTION_RUNTIME_PLUGIN_CONTRACT_VERSION_V1,
  type ExecutionRuntimePluginFactoryContextV1,
  type ExecutionRuntimePluginFactoryV1,
} from './runtime-plugin-contract';

export type ExecutionRuntimePluginLoadErrorCodeV1 =
  | 'invalid-plugin-load-request'
  | 'unsupported-plugin-contract-version'
  | 'plugin-module-load-failed'
  | 'plugin-factory-export-missing'
  | 'plugin-factory-export-invalid'
  | 'plugin-factory-failed'
  | 'invalid-plugin-driver-contract'
  | 'plugin-runtime-id-mismatch';

export class ExecutionRuntimePluginLoadErrorV1 extends Error {
  readonly code: ExecutionRuntimePluginLoadErrorCodeV1;

  constructor(code: ExecutionRuntimePluginLoadErrorCodeV1, message: string) {
    super(message);
    this.name = 'ExecutionRuntimePluginLoadErrorV1';
    this.code = code;
  }
}

export type LoadExecutionRuntimePluginInputV1 = {
  contractVersion: typeof EXECUTION_RUNTIME_PLUGIN_CONTRACT_VERSION_V1;
  modulePath: string;
  exportName: string;
  runtimeId: string;
  environment: Readonly<Record<string, string>>;
};

export type LoadExecutionRuntimePluginDependenciesV1 = {
  importModule?: (moduleUrl: string) => Promise<unknown>;
};

/**
 * Loads trusted deployment code from an absolute local module path. The path
 * never comes from a job or client request. `pathToFileURL` is required for
 * spaces, `#`, `%`, Windows drive letters, and other path syntax that is not
 * valid when interpolated into a URL by hand.
 */
export async function loadExecutionRuntimePluginV1(
  input: LoadExecutionRuntimePluginInputV1,
  dependencies: LoadExecutionRuntimePluginDependenciesV1 = {}
): Promise<ExecutionRuntimeDriverV1> {
  assertLoadInput(input);

  let moduleNamespace: unknown;
  try {
    const moduleUrl = pathToFileURL(input.modulePath).href;
    moduleNamespace = await (
      dependencies.importModule ?? importExternalRuntimeModule
    )(moduleUrl);
  } catch {
    throw new ExecutionRuntimePluginLoadErrorV1(
      'plugin-module-load-failed',
      'The configured execution runtime plugin module could not be loaded.'
    );
  }

  if (!isObject(moduleNamespace)) {
    throw new ExecutionRuntimePluginLoadErrorV1(
      'invalid-plugin-driver-contract',
      'The execution runtime plugin module namespace is invalid.'
    );
  }
  if (!Object.prototype.hasOwnProperty.call(moduleNamespace, input.exportName)) {
    throw new ExecutionRuntimePluginLoadErrorV1(
      'plugin-factory-export-missing',
      'The configured execution runtime plugin factory export does not exist.'
    );
  }

  const factory = moduleNamespace[input.exportName];
  if (typeof factory !== 'function') {
    throw new ExecutionRuntimePluginLoadErrorV1(
      'plugin-factory-export-invalid',
      'The configured execution runtime plugin export must be a factory function.'
    );
  }

  const context: ExecutionRuntimePluginFactoryContextV1 = Object.freeze({
    contractVersion: EXECUTION_RUNTIME_PLUGIN_CONTRACT_VERSION_V1,
    runtimeId: input.runtimeId,
    environment: Object.freeze({ ...input.environment }),
  });
  let candidate: unknown;
  try {
    candidate = await (factory as ExecutionRuntimePluginFactoryV1)(context);
  } catch {
    throw new ExecutionRuntimePluginLoadErrorV1(
      'plugin-factory-failed',
      'The execution runtime plugin factory failed during startup.'
    );
  }

  const driver = assertDriverShape(candidate);
  let descriptor: Awaited<ReturnType<ExecutionRuntimeDriverV1['describe']>>;
  try {
    descriptor = await driver.describe();
  } catch {
    throw new ExecutionRuntimePluginLoadErrorV1(
      'invalid-plugin-driver-contract',
      'The execution runtime plugin could not provide a valid V1 descriptor.'
    );
  }
  assertDescriptorShape(descriptor, driver);
  if (descriptor.runtimeId !== input.runtimeId) {
    throw new ExecutionRuntimePluginLoadErrorV1(
      'plugin-runtime-id-mismatch',
      'The execution runtime plugin descriptor does not match its configured runtimeId.'
    );
  }

  return driver;
}

async function importExternalRuntimeModule(moduleUrl: string): Promise<unknown> {
  // Keep this deployment-selected URL opaque to Vite/Rollup. Bundling it
  // would turn a production extension point into a build-time dependency.
  return import(/* @vite-ignore */ moduleUrl);
}

function assertLoadInput(input: LoadExecutionRuntimePluginInputV1): void {
  if (input.contractVersion !== EXECUTION_RUNTIME_PLUGIN_CONTRACT_VERSION_V1) {
    throw new ExecutionRuntimePluginLoadErrorV1(
      'unsupported-plugin-contract-version',
      'The execution runtime plugin must use contractVersion 1.'
    );
  }
  if (!isTrimmedText(input.runtimeId)) {
    invalidLoadRequest('The execution runtime plugin runtimeId is invalid.');
  }
  if (!isTrimmedText(input.modulePath) || !nodePath.isAbsolute(input.modulePath)) {
    invalidLoadRequest(
      'The execution runtime plugin modulePath must be an absolute path.'
    );
  }
  if (!isFactoryExportName(input.exportName)) {
    invalidLoadRequest(
      'The execution runtime plugin exportName must be default or a JavaScript identifier.'
    );
  }
  if (!isStringRecord(input.environment)) {
    invalidLoadRequest(
      'The execution runtime plugin environment must contain string values only.'
    );
  }
}

function assertDriverShape(value: unknown): ExecutionRuntimeDriverV1 {
  if (!isObject(value)) {
    invalidDriverContract();
  }
  for (const method of [
    'describe',
    'start',
    'interrupt',
    'reconcile',
    'archive',
  ] as const) {
    if (typeof value[method] !== 'function') {
      invalidDriverContract();
    }
  }
  if (value.resume !== undefined && typeof value.resume !== 'function') {
    invalidDriverContract();
  }
  return value as unknown as ExecutionRuntimeDriverV1;
}

function assertDescriptorShape(
  value: unknown,
  driver: ExecutionRuntimeDriverV1
): asserts value is Awaited<ReturnType<ExecutionRuntimeDriverV1['describe']>> {
  if (
    !isObject(value) ||
    value.schemaVersion !== RUNTIME_CONTRACT_VERSION_V1 ||
    !isTrimmedText(value.runtimeId) ||
    !isTrimmedText(value.displayName) ||
    !isTrimmedText(value.runtimeVersion) ||
    (value.selectionPriority !== undefined &&
      (typeof value.selectionPriority !== 'number' ||
        !Number.isFinite(value.selectionPriority)))
  ) {
    invalidDriverContract();
  }

  const capabilities = value.capabilities;
  if (
    !isObject(capabilities) ||
    capabilities.schemaVersion !== RUNTIME_CONTRACT_VERSION_V1 ||
    !isStringArray(capabilities.kinds) ||
    !capabilities.kinds.every((kind) =>
      ['coding', 'research', 'browser', 'document', 'workflow'].includes(kind)
    ) ||
    typeof capabilities.nativeResume !== 'boolean' ||
    typeof capabilities.checkpoint !== 'boolean' ||
    !['none', 'text', 'typed-events'].includes(
      stringValue(capabilities.streaming)
    ) ||
    !['none', 'process-kill', 'graceful'].includes(
      stringValue(capabilities.interrupt)
    ) ||
    !['none', 'directory', 'git-worktree'].includes(
      stringValue(capabilities.workspace)
    ) ||
    !['host', 'container', 'vm', 'remote'].includes(
      stringValue(capabilities.sandbox)
    ) ||
    typeof capabilities.structuredArtifacts !== 'boolean' ||
    typeof capabilities.waitingForHuman !== 'boolean' ||
    !isStringArray(capabilities.supportedModels) ||
    (capabilities.features !== undefined &&
      !isStringArray(capabilities.features)) ||
    (capabilities.nativeResume === true &&
      typeof driver.resume !== 'function') ||
    (capabilities.waitingForHuman === true &&
      capabilities.nativeResume !== true)
  ) {
    invalidDriverContract();
  }
}

function invalidLoadRequest(message: string): never {
  throw new ExecutionRuntimePluginLoadErrorV1(
    'invalid-plugin-load-request',
    message
  );
}

function invalidDriverContract(): never {
  throw new ExecutionRuntimePluginLoadErrorV1(
    'invalid-plugin-driver-contract',
    'The execution runtime plugin did not return an ExecutionRuntimeDriverV1.'
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTrimmedText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.trim() === value &&
    !value.includes('\0')
  );
}

function isFactoryExportName(value: unknown): value is string {
  return (
    isTrimmedText(value) &&
    value !== 'then' &&
    /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isObject(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
