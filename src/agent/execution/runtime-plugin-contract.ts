import type { ExecutionRuntimeDriverV1 } from './driver';

/**
 * Version of the trusted, process-local runtime plugin factory boundary.
 *
 * This is deliberately separate from the runtime event contract version: a
 * future factory context can evolve without changing persisted runtime events.
 */
export const EXECUTION_RUNTIME_PLUGIN_CONTRACT_VERSION_V1 = 1 as const;

export type ExecutionRuntimePluginContractVersionV1 =
  typeof EXECUTION_RUNTIME_PLUGIN_CONTRACT_VERSION_V1;

/**
 * Deployment-owned input supplied to an external runtime factory. No job,
 * attempt, request, or other client-controlled value is exposed here.
 */
export type ExecutionRuntimePluginFactoryContextV1 = Readonly<{
  contractVersion: ExecutionRuntimePluginContractVersionV1;
  runtimeId: string;
  /** Values resolved once from names in the trusted daemon env allowlist. */
  environment: Readonly<Record<string, string>>;
}>;

export type ExecutionRuntimePluginFactoryV1 = (
  context: ExecutionRuntimePluginFactoryContextV1
) => ExecutionRuntimeDriverV1 | Promise<ExecutionRuntimeDriverV1>;
