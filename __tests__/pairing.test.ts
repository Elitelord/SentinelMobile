import { parsePairingInput } from '../src/auth/pairing';

describe('parsePairingInput', () => {
  it('accepts a bare 6-digit code', () => {
    expect(parsePairingInput('123456')).toBe('123456');
  });

  it('trims whitespace', () => {
    expect(parsePairingInput('  654321  ')).toBe('654321');
  });

  it('accepts a sentinel:// deep link', () => {
    expect(parsePairingInput('sentinel://pair/123456')).toBe('123456');
  });

  it('is case-insensitive on the scheme', () => {
    expect(parsePairingInput('SENTINEL://pair/000001')).toBe('000001');
  });

  it('rejects a 5-digit code', () => {
    expect(parsePairingInput('12345')).toBeNull();
  });

  it('rejects a 7-digit code', () => {
    expect(parsePairingInput('1234567')).toBeNull();
  });

  it('rejects non-numeric input', () => {
    expect(parsePairingInput('abc123')).toBeNull();
  });

  it('rejects a wrong-scheme link', () => {
    expect(parsePairingInput('https://pair/123456')).toBeNull();
  });

  it('rejects a deep link with non-6-digit code', () => {
    expect(parsePairingInput('sentinel://pair/12345')).toBeNull();
    expect(parsePairingInput('sentinel://pair/abcdef')).toBeNull();
  });
});
