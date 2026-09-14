import { UnprocessableEntityException } from '@nestjs/common';
import { KycService } from './kyc.service';
import { ApplicantPayload } from '../../common/domain.types';

function applicant(overrides: Partial<ApplicantPayload> = {}): ApplicantPayload {
  return {
    fullName: 'Test Applicant',
    pan: 'ABCDE1234F',
    dob: '1995-06-15',
    mobile: '9876543210',
    employmentType: 'SALARIED',
    employmentTenureMonths: 24,
    monthlyIncome: 50000,
    obligations: 5000,
    numDependents: 0,
    ...overrides,
  };
}

describe('KycService', () => {
  let service: KycService;

  beforeEach(() => {
    service = new KycService();
  });

  it('derives age from DOB rather than trusting any client-supplied value', () => {
    const result = service.run(applicant({ dob: '2000-01-01' }), new Date('2026-01-01'));
    expect(result.age).toBe(26);
  });

  it('rejects a malformed PAN', () => {
    expect(() => service.run(applicant({ pan: 'not-a-pan' }))).toThrow(UnprocessableEntityException);
  });

  it('rejects a malformed mobile number', () => {
    expect(() => service.run(applicant({ mobile: '12345' }))).toThrow(UnprocessableEntityException);
  });

  it('rejects a date of birth in the future', () => {
    expect(() => service.run(applicant({ dob: '2099-01-01' }))).toThrow(UnprocessableEntityException);
  });

  it('accepts a well-formed applicant', () => {
    expect(() => service.run(applicant())).not.toThrow();
  });
});
