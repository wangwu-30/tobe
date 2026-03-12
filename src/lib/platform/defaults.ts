export const LOCAL_ORGANIZATION_ID =
  process.env.DAO_ORGANIZATION_ID?.trim() || 'local-org';
export const LOCAL_ORGANIZATION_SLUG = 'local';
export const LOCAL_USER_ID = process.env.DAO_USER_ID?.trim() || 'local-user';
export const LOCAL_DEVICE_ID =
  process.env.DAO_DEVICE_ID?.trim() || 'local-device';
export const LOCAL_SUBSCRIPTION_ID = 'local-subscription';

export const DAO_DEVICE_HEADER = 'x-dao-device-id';
export const DAO_USER_HEADER = 'x-dao-user-id';
export const DAO_ORGANIZATION_HEADER = 'x-dao-organization-id';

export const LOCAL_PLATFORM_DEFAULTS = {
  deviceId: LOCAL_DEVICE_ID,
  organizationId: LOCAL_ORGANIZATION_ID,
  userId: LOCAL_USER_ID,
} as const;
