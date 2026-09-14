import { ConflictException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../common/prisma.service';
import { ApplicantPayload } from '../../common/domain.types';

export interface DedupeResult {
  applicantId: string;
  panHash: string;
  isNewApplicant: boolean;
}

/** An "open" application is one still in flight -- not yet DECIDED or WITHDRAWN. A
 * retried/duplicate submission for the same person while one is already open must not
 * spawn a second loan, so this is a hard reject, not a soft warning. */
const OPEN_STATUSES = ['RECEIVED', 'PROCESSING'] as const;

@Injectable()
export class DedupeService {
  constructor(private readonly prisma: PrismaService) {}

  static hashIdentity(applicant: Pick<ApplicantPayload, 'pan' | 'dob' | 'mobile'>): string {
    return createHash('sha256').update(`${applicant.pan}|${applicant.dob}|${applicant.mobile}`).digest('hex');
  }

  async run(applicant: ApplicantPayload): Promise<DedupeResult> {
    const panHash = DedupeService.hashIdentity(applicant);

    const existing = await this.prisma.applicant.findFirst({
      where: { panHash },
      include: { applications: { where: { status: { in: [...OPEN_STATUSES] } }, take: 1 } },
    });

    if (existing && existing.applications.length > 0) {
      throw new ConflictException(
        `an open application already exists for this applicant (application ${existing.applications[0].id})`,
      );
    }

    if (existing) {
      return { applicantId: existing.id, panHash, isNewApplicant: false };
    }

    const created = await this.prisma.applicant.create({
      data: {
        panHash,
        fullName: applicant.fullName,
        dob: new Date(applicant.dob),
        mobile: applicant.mobile,
        email: applicant.email,
        employmentType: applicant.employmentType,
        monthlyIncome: applicant.monthlyIncome,
      },
    });
    return { applicantId: created.id, panHash, isNewApplicant: true };
  }
}
