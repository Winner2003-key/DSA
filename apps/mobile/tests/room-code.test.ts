/**
 * Room codes as players type, paste, scan and share them (brief S6): the field
 * adds `DSA-`, accepts lower case and a missing dash, and a join link resolves to
 * its code whatever app or web address it points to.
 */
import { formatRoomCodeInput, isCompleteRoomCode, parseRoomCode, roomJoinPath, roomJoinUrl } from '@/rooms/room-code';

describe('parseRoomCode', () => {
  it.each([
    ['DSA-1234', 'DSA-1234'],
    ['dsa-1234', 'DSA-1234'],
    ['dsa1234', 'DSA-1234'],
    ['DSA 1234', 'DSA-1234'],
    ['  1234 ', 'DSA-1234'],
    ['0042', 'DSA-0042'],
    ['dsa://rejoindre/DSA-1234', 'DSA-1234'],
    ['dsa://rejoindre/dsa1234', 'DSA-1234'],
    ['https://dsa.vercel.app/rejoindre/DSA-1234', 'DSA-1234'],
    ['https://dsa.vercel.app/rejoindre/DSA-1234?utm=x#top', 'DSA-1234'],
    ['http://localhost:8081/rejoindre/DSA%2D1234', 'DSA-1234'],
    ['exp://192.168.1.20:8081/--/rejoindre/DSA-9876', 'DSA-9876'],
  ])('%s → %s', (raw, expected) => {
    expect(parseRoomCode(raw)).toBe(expected);
  });

  it.each([
    [''],
    ['   '],
    ['DSA-123'],
    ['DSA-12345'],
    ['12a4'],
    ['ABC-1234'],
    ['DSA--1234'],
    ['https://example.com/partie/DSA-1234'],
    ['exp://192.168.1.20:8081'],
    ['dsa://rejoindre/'],
  ])('rejects %j', (raw) => {
    expect(parseRoomCode(raw)).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(parseRoomCode(null)).toBeNull();
    expect(parseRoomCode(undefined)).toBeNull();
  });
});

describe('formatRoomCodeInput (the code field while typing)', () => {
  it('adds the DSA- prefix from the first digit and keeps four digits', () => {
    expect(formatRoomCodeInput('')).toBe('');
    expect(formatRoomCodeInput('1')).toBe('DSA-1');
    expect(formatRoomCodeInput('12')).toBe('DSA-12');
    expect(formatRoomCodeInput('DSA-123')).toBe('DSA-123');
    expect(formatRoomCodeInput('DSA-1234')).toBe('DSA-1234');
    expect(formatRoomCodeInput('DSA-12345')).toBe('DSA-1234');
  });

  it('accepts lower case, no dash, and letters typed by habit', () => {
    expect(formatRoomCodeInput('d')).toBe('');
    expect(formatRoomCodeInput('dsa')).toBe('');
    expect(formatRoomCodeInput('dsa-')).toBe('');
    expect(formatRoomCodeInput('dsa1')).toBe('DSA-1');
    expect(formatRoomCodeInput('dsa12')).toBe('DSA-12');
    expect(formatRoomCodeInput('Dsa 12 34')).toBe('DSA-1234');
  });

  it('lets the player delete back to an empty field', () => {
    expect(formatRoomCodeInput('DSA-')).toBe('');
    expect(formatRoomCodeInput('DSA')).toBe('');
  });

  it('recognises a pasted link, ignoring the digits of its address', () => {
    expect(formatRoomCodeInput('exp://192.168.1.20:8081/--/rejoindre/DSA-4821')).toBe('DSA-4821');
    expect(formatRoomCodeInput('Rejoins ma partie https://dsa.vercel.app/rejoindre/DSA-4821')).toBe('DSA-4821');
  });

  it('knows when the code is complete', () => {
    expect(isCompleteRoomCode(formatRoomCodeInput('dsa123'))).toBe(false);
    expect(isCompleteRoomCode(formatRoomCodeInput('dsa1234'))).toBe(true);
  });
});

describe('join links', () => {
  const createURL = (path: string) => `dsa://${path.replace(/^\//, '')}`;

  it('is the /rejoindre/<code> route', () => {
    expect(roomJoinPath('DSA-1234')).toBe('/rejoindre/DSA-1234');
  });

  it('prefers the public web address, so any phone camera can open it', () => {
    expect(roomJoinUrl('DSA-1234', { webUrl: 'https://dsa.vercel.app/', createURL })).toBe(
      'https://dsa.vercel.app/rejoindre/DSA-1234',
    );
  });

  it("otherwise uses the app's own link", () => {
    expect(roomJoinUrl('DSA-1234', { webUrl: null, createURL })).toBe('dsa://rejoindre/DSA-1234');
    expect(roomJoinUrl('DSA-1234', { webUrl: '  ', createURL })).toBe('dsa://rejoindre/DSA-1234');
  });

  it('round-trips: a generated link parses back to its code', () => {
    for (const env of [{ webUrl: 'https://dsa.vercel.app', createURL }, { webUrl: null, createURL }]) {
      expect(parseRoomCode(roomJoinUrl('DSA-0917', env))).toBe('DSA-0917');
    }
    expect(parseRoomCode(roomJoinUrl('DSA-0917', { createURL: (p) => `exp://10.0.0.2:8081/--${p}` }))).toBe('DSA-0917');
  });
});
