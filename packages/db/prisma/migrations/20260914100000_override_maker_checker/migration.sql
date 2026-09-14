-- Manual review overrides get their own maker-checker pair (proposedBy != approvedBy),
-- and an OVERRIDE pipeline stage so the action itself lands in the hash-chained audit log.
ALTER TYPE "PipelineStage" ADD VALUE 'OVERRIDE';
ALTER TABLE "Decision" ADD COLUMN "overrideProposedById" TEXT;
