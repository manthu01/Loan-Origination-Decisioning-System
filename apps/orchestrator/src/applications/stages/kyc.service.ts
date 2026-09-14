import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ApplicantPayload } from '../../common/domain.types';

const PAN_FORMAT = /^[A-Z]{5}[0-9]{4}[A-Z]$/; // Indian PAN: AAAAA9999A
const MOBILE_FORMAT = /^[6-9]\d{9}$/; // 10 digits, starts 6-9

export interface KycResult {
  age: number;
  panFormatValid: boolean;
  mobileFormatValid: boolean;
}

@Injectable()
export class KycService {
  /** Format-validates PAN/mobile and derives age from DOB server-side -- age is never
   * trusted from client input, since it feeds directly into policy rules and the
   * scorecard. Throws on hard KYC failure; format validity also comes back in the result
   * for stage logging even when this doesn't throw. */
  run(applicant: ApplicantPayload, asOf: Date = new Date()): KycResult {
    const panFormatValid = PAN_FORMAT.test(applicant.pan);
    const mobileFormatValid = MOBILE_FORMAT.test(applicant.mobile);

    if (!panFormatValid) {
      throw new UnprocessableEntityException(`invalid PAN format: ${applicant.pan}`);
    }
    if (!mobileFormatValid) {
      throw new UnprocessableEntityException(`invalid mobile number format: ${applicant.mobile}`);
    }

    const dob = new Date(applicant.dob);
    if (Number.isNaN(dob.getTime()) || dob > asOf) {
      throw new UnprocessableEntityException(`invalid date of birth: ${applicant.dob}`);
    }

    return { age: deriveAge(dob, asOf), panFormatValid, mobileFormatValid };
  }
}

export function deriveAge(dob: Date, asOf: Date): number {
  let age = asOf.getFullYear() - dob.getFullYear();
  const hasHadBirthdayThisYear =
    asOf.getMonth() > dob.getMonth() || (asOf.getMonth() === dob.getMonth() && asOf.getDate() >= dob.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}
