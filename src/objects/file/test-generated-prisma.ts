export class PrismaClientKnownRequestError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = 'PrismaClientKnownRequestError';
  }
}

export const Prisma = {
  PrismaClientKnownRequestError,
};

// The production command only needs the transaction-client shape from this
// namespace; Playwright aliases the generated client to this lightweight shim.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Prisma {
  export type TransactionClient = typeof import('@/lib/db/prisma').prisma;
}
