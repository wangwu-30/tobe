import type {
  RoomSessionRuntimeDescriptorV1,
  RoomSessionRuntimePortV1,
} from './contracts';

export type RoomSessionRuntimeRegistryErrorCodeV1 =
  | 'invalid-runtime-id'
  | 'duplicate-runtime-id';

/** A registration error denotes invalid process configuration. */
export class RoomSessionRuntimeRegistryErrorV1 extends Error {
  readonly code: RoomSessionRuntimeRegistryErrorCodeV1;
  readonly runtimeId: string;

  constructor(
    code: RoomSessionRuntimeRegistryErrorCodeV1,
    runtimeId: string,
    message: string
  ) {
    super(message);
    this.name = 'RoomSessionRuntimeRegistryErrorV1';
    this.code = code;
    this.runtimeId = runtimeId;
  }
}

type RegisteredRoomSessionRuntimeV1 = {
  descriptor: RoomSessionRuntimeDescriptorV1;
  runtime: RoomSessionRuntimePortV1;
};

/**
 * Process-local Room runtime registry. Descriptor lookup is cached at
 * registration, while runtime lookup remains synchronous for the Session Host.
 */
export class RoomSessionRuntimeRegistryV1 {
  private readonly registrations = new Map<
    string,
    RegisteredRoomSessionRuntimeV1
  >();

  async register(
    runtime: RoomSessionRuntimePortV1
  ): Promise<RoomSessionRuntimePortV1> {
    const descriptor = await runtime.describe();
    const runtimeId = descriptor.runtimeId;

    if (!isValidRuntimeId(runtimeId)) {
      throw new RoomSessionRuntimeRegistryErrorV1(
        'invalid-runtime-id',
        runtimeId,
        'Room runtime ids must be non-empty and may not contain leading or trailing whitespace.'
      );
    }

    if (this.registrations.has(runtimeId)) {
      throw new RoomSessionRuntimeRegistryErrorV1(
        'duplicate-runtime-id',
        runtimeId,
        `Room runtime id "${runtimeId}" is already registered.`
      );
    }

    this.registrations.set(runtimeId, { descriptor, runtime });
    return runtime;
  }

  lookup(runtimeId: string): RoomSessionRuntimePortV1 | undefined {
    return this.registrations.get(runtimeId)?.runtime;
  }

  descriptor(runtimeId: string): RoomSessionRuntimeDescriptorV1 | undefined {
    return this.registrations.get(runtimeId)?.descriptor;
  }

  list(): readonly RoomSessionRuntimePortV1[] {
    return Array.from(this.registrations.values(), ({ runtime }) => runtime);
  }

  runtimeIds(): readonly string[] {
    return Array.from(this.registrations.keys());
  }
}

function isValidRuntimeId(runtimeId: string): boolean {
  return runtimeId.length > 0 && runtimeId.trim() === runtimeId;
}
