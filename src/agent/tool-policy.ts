import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { TSchema } from 'typebox';
import { ForbiddenError } from '@/framework/resilience/app-error';

export const AGENT_TOOL_SAFETY_LEVELS = [
  'safe',
  'confirm',
  'privileged',
] as const;
export type AgentToolSafetyLevel = (typeof AGENT_TOOL_SAFETY_LEVELS)[number];

export const AGENT_TOOL_CONFIRMATION_POLICIES = [
  'automatic',
  'required',
] as const;
export type AgentToolConfirmationPolicy =
  (typeof AGENT_TOOL_CONFIRMATION_POLICIES)[number];

export const AGENT_TOOL_WRITE_POLICIES = [
  'read-only',
  'organization-scoped-append',
  'workspace-write',
  'privileged-write',
] as const;
export type AgentToolWritePolicy = (typeof AGENT_TOOL_WRITE_POLICIES)[number];

export type AgentToolAuditOutcome =
  | 'executed'
  | 'confirmation_required'
  | 'failed';

export type AgentToolAuditEvent = {
  confirmationPolicy: AgentToolConfirmationPolicy;
  errorMessage?: string;
  outcome: AgentToolAuditOutcome;
  safetyLevel: AgentToolSafetyLevel;
  toolCallId: string;
  toolName: string;
  writePolicy: AgentToolWritePolicy;
};

export type AgentToolGovernanceOptions = {
  onAudit?: (event: AgentToolAuditEvent) => void;
};

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

function isValidSafetyLevel(value: unknown): value is AgentToolSafetyLevel {
  return (
    typeof value === 'string' &&
    (AGENT_TOOL_SAFETY_LEVELS as readonly string[]).includes(value)
  );
}

function isValidConfirmationPolicy(
  value: unknown
): value is AgentToolConfirmationPolicy {
  return (
    typeof value === 'string' &&
    (AGENT_TOOL_CONFIRMATION_POLICIES as readonly string[]).includes(value)
  );
}

function isValidWritePolicy(value: unknown): value is AgentToolWritePolicy {
  return (
    typeof value === 'string' &&
    (AGENT_TOOL_WRITE_POLICIES as readonly string[]).includes(value)
  );
}

export function isGovernedAgentTool(
  tool: unknown
): tool is GovernedAgentTool<TSchema> {
  if (!tool || typeof tool !== 'object') {
    return false;
  }

  const candidate = tool as Record<string, unknown>;
  return (
    typeof candidate.name === 'string' &&
    candidate.name.length > 0 &&
    typeof candidate.execute === 'function' &&
    typeof candidate.getPendingConfirmation === 'function' &&
    isValidSafetyLevel(candidate.safetyLevel) &&
    isValidConfirmationPolicy(candidate.confirmationPolicy) &&
    isValidWritePolicy(candidate.writePolicy)
  );
}

function emitAudit(
  onAudit: AgentToolGovernanceOptions['onAudit'],
  event: AgentToolAuditEvent
) {
  if (!onAudit) {
    return;
  }
  try {
    onAudit(event);
  } catch {
    // Audit observers must never suppress tool errors or bypass policy gates.
  }
}

/**
 * Materialize a governed tool into an executable Pi tool. Required tools and
 * any confirm/privileged tools are fail-closed unless a trusted authority
 * consumes a matching prior approval.
 */
export function enforceGovernedAgentTool<TParameters extends TSchema>(
  tool: GovernedAgentTool<TParameters>,
  confirmationAuthority?: AgentToolConfirmationAuthority,
  options?: AgentToolGovernanceOptions
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
      const validMetadata =
        isValidSafetyLevel(tool.safetyLevel) &&
        isValidConfirmationPolicy(tool.confirmationPolicy) &&
        isValidWritePolicy(tool.writePolicy);

      if (!validMetadata) {
        throw new AgentToolConfirmationRequiredError(tool.name);
      }

      // Confirm and privileged tools can never be downgraded to automatic
      // execution, even if a caller misconfigures confirmationPolicy.
      if (
        (tool.safetyLevel === 'confirm' || tool.safetyLevel === 'privileged') &&
        tool.confirmationPolicy !== 'required'
      ) {
        emitAudit(options?.onAudit, {
          confirmationPolicy: tool.confirmationPolicy,
          outcome: 'confirmation_required',
          safetyLevel: tool.safetyLevel,
          toolCallId,
          toolName: tool.name,
          writePolicy: tool.writePolicy,
        });
        throw new AgentToolConfirmationRequiredError(tool.name);
      }

      if (tool.confirmationPolicy === 'automatic') {
        try {
          const result = await execute(toolCallId, params, signal, onUpdate);
          emitAudit(options?.onAudit, {
            confirmationPolicy: tool.confirmationPolicy,
            outcome: 'executed',
            safetyLevel: tool.safetyLevel,
            toolCallId,
            toolName: tool.name,
            writePolicy: tool.writePolicy,
          });
          return result;
        } catch (error) {
          emitAudit(options?.onAudit, {
            confirmationPolicy: tool.confirmationPolicy,
            errorMessage: error instanceof Error ? error.message : String(error),
            outcome: 'failed',
            safetyLevel: tool.safetyLevel,
            toolCallId,
            toolName: tool.name,
            writePolicy: tool.writePolicy,
          });
          throw error;
        }
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
          emitAudit(options?.onAudit, {
            confirmationPolicy: tool.confirmationPolicy,
            errorMessage: cause instanceof Error ? cause.message : String(cause),
            outcome: 'confirmation_required',
            safetyLevel: tool.safetyLevel,
            toolCallId,
            toolName: tool.name,
            writePolicy: tool.writePolicy,
          });
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
        emitAudit(options?.onAudit, {
          confirmationPolicy: tool.confirmationPolicy,
          outcome: 'confirmation_required',
          safetyLevel: tool.safetyLevel,
          toolCallId,
          toolName: tool.name,
          writePolicy: tool.writePolicy,
        });
        throw new AgentToolConfirmationRequiredError(tool.name, {
          request,
          ...(receipt ? { receipt } : {}),
        });
      }
      pendingConfirmations.delete(toolCallId);

      try {
        const result = await execute(toolCallId, params, signal, onUpdate);
        emitAudit(options?.onAudit, {
          confirmationPolicy: tool.confirmationPolicy,
          outcome: 'executed',
          safetyLevel: tool.safetyLevel,
          toolCallId,
          toolName: tool.name,
          writePolicy: tool.writePolicy,
        });
        return result;
      } catch (error) {
        emitAudit(options?.onAudit, {
          confirmationPolicy: tool.confirmationPolicy,
          errorMessage: error instanceof Error ? error.message : String(error),
          outcome: 'failed',
          safetyLevel: tool.safetyLevel,
          toolCallId,
          toolName: tool.name,
          writePolicy: tool.writePolicy,
        });
        throw error;
      }
    },
  };
}
