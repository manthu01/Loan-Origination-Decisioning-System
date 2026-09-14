import { deriveAge } from './date';

describe('deriveAge', () => {
  it('has not had a birthday yet this year', () => {
    expect(deriveAge(new Date('1995-06-15'), new Date('2026-06-14'))).toBe(30);
  });

  it('birthday is today', () => {
    expect(deriveAge(new Date('1995-06-15'), new Date('2026-06-15'))).toBe(31);
  });

  it('already had a birthday this year', () => {
    expect(deriveAge(new Date('1995-06-15'), new Date('2026-12-01'))).toBe(31);
  });
});
