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
