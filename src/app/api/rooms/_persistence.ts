// Keep the Room object facade behind one import without coupling pure HTTP
// parsing and identity validation helpers to Prisma at module-load time.
export {
  ROOM_IDEMPOTENCY_HEADER,
  ensureDefaultRoom,
  getDefaultRoom,
  getRoom,
  issueRoomDelegationGrant,
  listRoomEvents,
  listRoomMessages,
  postRoomMessage,
  revokeRoomDelegationGrant,
} from '@/objects/room';
