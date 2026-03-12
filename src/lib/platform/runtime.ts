import { getConfiguredOAuthProviders } from '@/lib/ai/auth-store';
import { getPlatformPaths, isDesktopRuntime } from '@/lib/platform/paths';

export async function getPlatformStatus(params: {
  appVersion?: string;
  channel?: string;
  deviceId: string;
  organizationId: string;
  userId: string;
}) {
  return {
    appVersion:
      params.appVersion || process.env.DAO_APP_VERSION?.trim() || process.env.npm_package_version || '0.1.0',
    channel:
      params.channel || process.env.DAO_CHANNEL?.trim() || (isDesktopRuntime() ? 'beta' : 'web'),
    diagnosticsEnabled: isDesktopRuntime(),
    deviceId: params.deviceId,
    isDesktop: isDesktopRuntime(),
    mode: isDesktopRuntime() ? 'desktop' : 'web',
    oauthProviders: await getConfiguredOAuthProviders(),
    organizationId: params.organizationId,
    paths: getPlatformPaths(),
    userId: params.userId,
  } as const;
}
