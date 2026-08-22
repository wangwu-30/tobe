import path from 'node:path';
import { Prisma, PrismaClient } from '@/generated/prisma/client';
import { ensurePlatformDirectories, getPlatformPaths } from '@/lib/platform/paths';
import { SafePrismaLibSqlAdapterV1 } from '@/lib/db/prisma-libsql-adapter';

const globalForPrisma = globalThis as unknown as {
  prismaClients: Map<string, PrismaClient> | undefined;
  prismaProxy: PrismaClient | undefined;
};

function createPrismaClient(databaseUrl: string) {
  ensurePlatformDirectories();
  const adapter = new SafePrismaLibSqlAdapterV1({
    url: databaseUrl,
  });
  const options: Prisma.PrismaClientOptions = {
    adapter,
    transactionOptions: { maxWait: 5_000, timeout: 10_000 },
  };
  return new PrismaClient(options);
}

export function resolveDatabaseUrl() {
  const platformPaths = getPlatformPaths();
  const databaseUrl =
    process.env.DATABASE_URL?.trim() || `file:${platformPaths.dbFilePath}`;

  if (!databaseUrl.startsWith('file:')) {
    return databaseUrl;
  }

  const sqlitePath = databaseUrl.slice('file:'.length);
  if (!sqlitePath || sqlitePath === ':memory:' || path.isAbsolute(sqlitePath)) {
    return databaseUrl;
  }

  return `file:${path.resolve(platformPaths.appDataRoot, sqlitePath)}`;
}

function getPrismaClientCache() {
  if (!globalForPrisma.prismaClients) {
    globalForPrisma.prismaClients = new Map();
  }

  return globalForPrisma.prismaClients;
}

export function getPrismaClient() {
  const databaseUrl = resolveDatabaseUrl();
  const clientCache = getPrismaClientCache();
  const existingClient = clientCache.get(databaseUrl);
  if (existingClient) {
    return existingClient;
  }

  const client = createPrismaClient(databaseUrl);
  clientCache.set(databaseUrl, client);
  return client;
}

export function getPrismaRuntimeInfo() {
  const platformPaths = getPlatformPaths();
  return {
    appDataRoot: platformPaths.appDataRoot,
    databaseUrl: resolveDatabaseUrl(),
  };
}

export const prisma =
  globalForPrisma.prismaProxy ??
  new Proxy({} as PrismaClient, {
    get(_target, property) {
      const client = getPrismaClient() as unknown as Record<PropertyKey, unknown>;
      const value = Reflect.get(client, property, client);
      return typeof value === 'function' ? value.bind(client) : value;
    },
    getPrototypeOf() {
      return Object.getPrototypeOf(getPrismaClient());
    },
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prismaProxy = prisma;
}
