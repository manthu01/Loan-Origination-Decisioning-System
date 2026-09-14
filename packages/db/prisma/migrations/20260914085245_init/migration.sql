-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'DECIDED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "DecisionOutcome" AS ENUM ('APPROVE', 'REFER', 'DECLINE');

-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "PipelineStage" AS ENUM ('DEDUPE', 'KYC', 'BUREAU', 'RULES', 'SCORE', 'LIMIT', 'PRICE', 'PERSIST');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ANALYST', 'CREDIT_OPS', 'POLICY_MAKER', 'POLICY_CHECKER', 'ADMIN');

-- CreateTable
CREATE TABLE "Applicant" (
    "id" TEXT NOT NULL,
    "panHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "dob" TIMESTAMP(3) NOT NULL,
    "mobile" TEXT NOT NULL,
    "email" TEXT,
    "employmentType" TEXT NOT NULL,
    "monthlyIncome" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Applicant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "requestedAmount" DECIMAL(65,30) NOT NULL,
    "tenureMonths" INTEGER NOT NULL,
    "income" DECIMAL(65,30) NOT NULL,
    "obligations" DECIMAL(65,30) NOT NULL,
    "employmentType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'RECEIVED',
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "outcome" "DecisionOutcome" NOT NULL,
    "score" INTEGER NOT NULL,
    "probabilityOfDefault" DECIMAL(65,30) NOT NULL,
    "riskGrade" TEXT NOT NULL,
    "approvedAmount" DECIMAL(65,30),
    "interestRate" DECIMAL(65,30),
    "reasonCodes" TEXT[],
    "policyVersionId" TEXT NOT NULL,
    "modelVersionId" TEXT NOT NULL,
    "challengerScore" INTEGER,
    "challengerModelId" TEXT,
    "latencyMs" INTEGER NOT NULL,
    "overriddenById" TEXT,
    "overrideJustification" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionEvent" (
    "id" BIGSERIAL NOT NULL,
    "applicationId" TEXT NOT NULL,
    "stage" "PipelineStage" NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyVersion" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "status" "PolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "activatedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelVersion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "artifactUri" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "isChampion" BOOLEAN NOT NULL DEFAULT false,
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReasonCode" (
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,

    CONSTRAINT "ReasonCode_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Applicant_panHash_idx" ON "Applicant"("panHash");

-- CreateIndex
CREATE UNIQUE INDEX "Application_idempotencyKey_key" ON "Application"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Application_applicantId_idx" ON "Application"("applicantId");

-- CreateIndex
CREATE INDEX "Application_status_idx" ON "Application"("status");

-- CreateIndex
CREATE INDEX "Decision_applicationId_idx" ON "Decision"("applicationId");

-- CreateIndex
CREATE INDEX "Decision_policyVersionId_idx" ON "Decision"("policyVersionId");

-- CreateIndex
CREATE INDEX "Decision_modelVersionId_idx" ON "Decision"("modelVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionEvent_hash_key" ON "DecisionEvent"("hash");

-- CreateIndex
CREATE INDEX "DecisionEvent_applicationId_idx" ON "DecisionEvent"("applicationId");

-- CreateIndex
CREATE INDEX "DecisionEvent_createdAt_idx" ON "DecisionEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyVersion_version_key" ON "PolicyVersion"("version");

-- CreateIndex
CREATE INDEX "PolicyVersion_status_idx" ON "PolicyVersion"("status");

-- CreateIndex
CREATE INDEX "PolicyVersion_product_idx" ON "PolicyVersion"("product");

-- CreateIndex
CREATE UNIQUE INDEX "ModelVersion_name_key" ON "ModelVersion"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "Applicant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "PolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionEvent" ADD CONSTRAINT "DecisionEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
