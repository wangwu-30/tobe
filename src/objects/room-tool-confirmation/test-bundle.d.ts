declare module '../../.tmp/room-tool-confirmation-test/room-tool-confirmation.mjs' {
  export * from '@/objects/room-tool-confirmation';
  export { prisma } from '@/lib/db/prisma';
  export {
    ForbiddenError,
    ValidationError,
  } from '@/framework/resilience/app-error';
}
