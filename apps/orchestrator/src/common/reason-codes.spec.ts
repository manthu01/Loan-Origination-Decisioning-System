import { mergeReasonCodes } from './reason-codes';

describe('mergeReasonCodes', () => {
  it('includes only rule reason codes for an APPROVE', () => {
    expect(mergeReasonCodes('APPROVE', ['R101'], [{ code: 'R230' }])).toEqual(['R101']);
  });

  it('merges rule and scorecard reason codes for a REFER', () => {
    expect(mergeReasonCodes('REFER', ['R204'], [{ code: 'R230' }])).toEqual(['R204', 'R230']);
  });

  it('merges rule and scorecard reason codes for a DECLINE', () => {
    expect(mergeReasonCodes('DECLINE', ['R400'], [{ code: 'R220' }, { code: 'R230' }])).toEqual(['R400', 'R220', 'R230']);
  });

  it('de-duplicates codes appearing in both sources', () => {
    expect(mergeReasonCodes('DECLINE', ['R400'], [{ code: 'R400' }])).toEqual(['R400']);
  });
});
