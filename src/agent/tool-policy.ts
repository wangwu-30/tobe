import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { TSchema } from '@sinclair/typebox';
import { ForbiddenError } from '@/framework/resilience/app-error';

export type AgentToolSafetyLevel = 'safe' | 'confirm' | 'privileged';
export type AgentToolConfirmationPolicy = 'automatic' | 'required';
export type AgentToolWritePolicy =
  | 'read-only'
  | 'organization-scoped-append'
  | 'workspace-write'
  | 'privileged-write';

export type GovernedAgentTool<TParameters extends TSchema> =
  AgentTool<TParameters> & {
    confirmationPolicy: AgentToolConfirmationPolicy;
    safetyLevel: AgentToolSafetyLevel;
    writePolicy: AgentToolWritePolicy;
    getPendingConfirmation?:
      AgentToolPendingConfirmationSourceV1['getPendingConfirmation'];
  };

export type AgentToolConfirmationRequest = {
  parameters: unknown;
  safetyLevel: AgentToolSafetyLevel;
  toolCallId: string;
  toolName: string;
  writePolicy: AgentToolWritePolicy;
};

export const AGENT_TOOL_CONFIRMATION_DESCRIPTOR_VERSION_V1 = 1 as const;
export const AGENT_TOOL_CONFIRMATION_REQUEST_RECEIPT_VERSION_V1 = 1 as const;

export type AgentToolConfirmationRequestReceiptV1 = {
  schemaVersion: typeof AGENT_TOOL_CONFIRMATION_REQUEST_RECEIPT_VERSION_V1;
  requestId: string;
  expiresAt: string;
};

/**
 * Process-local receipt for a governed call that reached the human-confirmation
 * boundary. It contains no grant or bearer capability and is safe for a runtime
 * adapter to project into its own versioned event contract.
 */
export type AgentToolPendingConfirmationDescriptorV1 = {
  schemaVersion: typeof AGENT_TOOL_CONFIRMATION_DESCRIPTOR_VERSION_V1;
  descriptorType: 'agent-tool.pending-confirmation';
  request: AgentToolConfirmationRequest;
  requestId: string;
  expiresAt: string;
};

export type AgentToolPendingConfirmationSourceV1 = {
  getPendingConfirmation(
    toolCallId: string
  ): AgentToolPendingConfirmationDescriptorV1 | undefined;
};

/**
 * Trusted server-side boundary for consuming a previously issued human
 * confirmation. Implementations must bind grants to the actor, scope, tool,
 * normalized parameters, expiry, and a single-use nonce. The model must never
 * be able to provide this authority or manufacture a confirmation field.
 */
export type AgentToolConfirmationAuthority = {
  consumeConfirmation: (
    request: AgentToolConfirmationRequest
  ) => boolean | Promise<boolean>;
  requestConfirmation?: (
    request: AgentToolConfirmationRequest
  ) =>
    | AgentToolConfirmationRequestReceiptV1
    | Promise<AgentToolConfirmationRequestReceiptV1>;
  /** Optional synchronous process-local projection; it grants no authority. */
  getPendingConfirmation?:
    AgentToolPendingConfirmationSourceV1['getPendingConfirmation'];
  setPendingConfirmation?: (
    descriptor: AgentToolPendingConfirmationDescriptorV1
  ) => void;
};

export class AgentToolConfirmationRequiredError extends ForbiddenError {
  readonly code = 'agent-tool-confirmation-required';
  readonly toolName: string;
  readonly request?: AgentToolConfirmationRequest;
  readonly receipt?: AgentToolConfirmationRequestReceiptV1;

  constructor(
    toolName: string,
    options?: {
      cause?: unknown;
      request?: AgentToolConfirmationRequest;
      receipt?: AgentToolConfirmationRequestReceiptV1;
    }
  ) {
    super(
      `Tool ${toolName} requires explicit human confirmation before it can run.`,
      options?.cause === undefined ? {} : { cause: options.cause }
    );
    this.name = 'AgentToolConfirmationRequiredError';
    this.toolName = toolName;
    this.request = options?.request;
    this.receipt = options?.receipt;
  }
}

/**
 * Materialize a governed tool into an executable Pi tool. Required tools are
 * fail-closed unless a trusted authority consumes a matching prior approval.
 */
export function enforceGovernedAgentTool<TParameters extends TSchema>(
  tool: GovernedAgentTool<TParameters>,
  confirmationAuthority?: AgentToolConfirmationAuthority
): GovernedAgentTool<TParameters> {
  const execute = tool.execute;
  const pendingConfirmations = new Map<
    string,
    AgentToolPendingConfirmationDescriptorV1
  >();

  return {
    ...tool,
    getPendingConfirmation(toolCallId: string) {
      return (
        pendingConfirmations.get(toolCallId) ??
        confirmationAuthority?.getPendingConfirmation?.(toolCallId)
      );
    },
    async execute(toolCallId, params, signal, onUpdate) {
      if (tool.confirmationPolicy === 'automatic') {
        return execute(toolCallId, params, signal, onUpdate);
      }

      // Unknown or corrupted policies must never become executable merely
      // because an authority happens to be present.
      if (tool.confirmationPolicy !== 'required') {
        throw new AgentToolConfirmationRequiredError(tool.name);
      }

      const request: AgentToolConfirmationRequest = {
        parameters: params,
        safetyLevel: tool.safetyLevel,
        toolCallId,
        toolName: tool.name,
        writePolicy: tool.writePolicy,
      };
      let confirmed = false;
      if (confirmationAuthority) {
        try {
          confirmed =
            (await confirmationAuthority.consumeConfirmation(request)) === true;
        } catch (cause) {
          throw new AgentToolConfirmationRequiredError(tool.name, { cause });
        }
      }

      if (!confirmed) {
        const receipt = await confirmationAuthority?.requestConfirmation?.(request);
        if (receipt) {
          const descriptor: AgentToolPendingConfirmationDescriptorV1 = {
            schemaVersion: AGENT_TOOL_CONFIRMATION_DESCRIPTOR_VERSION_V1,
            descriptorType: 'agent-tool.pending-confirmation',
            request,
            requestId: receipt.requestId,
            expiresAt: receipt.expiresAt,
          };
          pendingConfirmations.set(toolCallId, descriptor);
          confirmationAuthority?.setPendingConfirmation?.(descriptor);
        }
        throw new AgentToolConfirmationRequiredError(tool.name, {
          request,
          ...(receipt ? { receipt } : {}),
        });
      }
      pendingConfirmations.delete(toolCallId);

      return execute(toolCallId, params, signal, onUpdate);
    },
  };
}
