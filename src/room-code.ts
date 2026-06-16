export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_PATTERN = /^\d{4}$/;

export function isRoomCode(code: string): boolean {
  return ROOM_CODE_PATTERN.test(code);
}

export function generateRoomCode(): string {
  const min = 10 ** (ROOM_CODE_LENGTH - 1);
  const range = 9 * min;
  return Math.floor(min + Math.random() * range).toString();
}
