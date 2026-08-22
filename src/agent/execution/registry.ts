import type { RuntimeDescriptorV1 } from './contracts';
import type { ExecutionRuntimeDriverV1 } from './driver';

export type ExecutionRuntimeDriverRegistryErrorCodeV1 =
  | 'invalid-runtime-id'
  | 'duplicate-runtime-id'
  | 'waiting-for-human-requires-native-resume'
  | 'waiting-for-human-requires-resume-implementation';

/**
 * A registration error is a control-plane configuration problem, not a
 * runtime attempt failure.
 */
export class ExecutionRuntimeDriverRegistryErrorV1 extends Error {
  readonly code: ExecutionRuntimeDriverRegistryErrorCodeV1;
  readonly runtimeId: string;

  constructor(
    code: ExecutionRuntimeDriverRegistryErrorCodeV1,
    runtimeId: string,
    message: string
  ) {
    super(message);
    this.name = 'ExecutionRuntimeDriverRegistryErrorV1';
    this.code = code;
    this.runtimeId = runtimeId;
  }
}

type RegisteredExecutionRuntimeDriverV1 = {
  descriptor: RuntimeDescriptorV1;
  driver: ExecutionRuntimeDriverV1;
};

/**
 * Process-local registry for execution-runtime adapters.
 *
 * A driver's id is learned from its versioned descriptor once, during
 * registration. Lookups are synchronous after that point and preserve the
 * original registration order. Runtime health and capacity deliberately do
 * not live here; the control plane must obtain those separately and must not
 * infer health from a successful registration.
 */
export class ExecutionRuntimeDriverRegistryV1 {
  private readonly registrations = new Map<
    string,
    RegisteredExecutionRuntimeDriverV1
  >();

  async register(
    driver: ExecutionRuntimeDriverV1
  ): Promise<ExecutionRuntimeDriverV1> {
    const descriptor = await driver.describe();
    const runtimeId = descriptor.runtimeId;

    if (!isValidRuntimeId(runtimeId)) {
      throw new ExecutionRuntimeDriverRegistryErrorV1(
        'invalid-runtime-id',
        runtimeId,
        'Execution runtime ids must be non-empty and may not contain leading or trailing whitespace.'
      );
    }

    if (this.registrations.has(runtimeId)) {
      throw new ExecutionRuntimeDriverRegistryErrorV1(
        'duplicate-runtime-id',
        runtimeId,
        `Execution runtime id "${runtimeId}" is already registered.`
      );
    }

    if (
      descriptor.capabilities.waitingForHuman &&
      !descriptor.capabilities.nativeResume
    ) {
      throw new ExecutionRuntimeDriverRegistryErrorV1(
        'waiting-for-human-requires-native-resume',
        runtimeId,
        `Execution runtime "${runtimeId}" may advertise waitingForHuman only when nativeResume is true.`
      );
    }

    if (
      descriptor.capabilities.waitingForHuman &&
      typeof driver.resume !== 'function'
    ) {
      throw new ExecutionRuntimeDriverRegistryErrorV1(
        'waiting-for-human-requires-resume-implementation',
        runtimeId,
        `Execution runtime "${runtimeId}" advertises waitingForHuman but its driver does not implement resume().`
      );
    }

    this.registrations.set(runtimeId, { descriptor, driver });
    return driver;
  }

  lookup(runtimeId: string): ExecutionRuntimeDriverV1 | undefined {
    return this.registrations.get(runtimeId)?.driver;
  }

  list(): readonly ExecutionRuntimeDriverV1[] {
    return Array.from(
      this.registrations.values(),
      ({ driver }) => driver
    );
  }
}

function isValidRuntimeId(runtimeId: string): boolean {
  return runtimeId.length > 0 && runtimeId.trim() === runtimeId;
}
