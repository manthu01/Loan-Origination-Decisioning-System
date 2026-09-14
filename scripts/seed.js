#!/usr/bin/env node
/**
 * Seeds the orchestrator with realistic decided applications so the console (queue,
 * case detail, dashboard) and the policy simulator have real content to work against --
 * per the build plan: "A demo with three rows looks like a toy."
 *
 * Ensures an ACTIVE policy exists for PL, then submits N synthetic applications
 * concurrently (bounded pool) through the real POST /applications pipeline -- dedupe,
 * KYC, the bureau mock, real scoring calls, real rule evaluation. This is deliberately
 * NOT a direct-to-database bulk insert: going through the real pipeline is what makes
 * the resulting hash chain, decisions, and events legitimate for the console/simulator
 * to replay against.
 *
 * Usage:
 *   ORCHESTRATOR_URL=http://localhost:3001 node scripts/seed.js [count]
 */

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? 'http://localhost:3001';
const COUNT = Number(process.argv[2] ?? 500);
const CONCURRENCY = Number(process.env.SEED_CONCURRENCY ?? 20);

const POLICY_VERSION = `seed-${Date.now()}`;
const DEFAULT_RULES = [
  { id: 'AGE_MIN', priority: 10, expr: 'applicant.age >= 21', onFail: 'DECLINE', reason: 'R101' },
  { id: 'AGE_MAX_AT_MATURITY', priority: 11, expr: 'applicant.age + (application.tenureMonths / 12) <= 60', onFail: 'DECLINE', reason: 'R102' },
  { id: 'MIN_INCOME', priority: 20, expr: 'applicant.monthlyIncome >= 25000', onFail: 'DECLINE', reason: 'R110' },
  { id: 'FOIR_CAP', priority: 30, expr: '(applicant.obligations + application.estimatedEmi) / applicant.monthlyIncome <= 0.55', onFail: 'REFER', reason: 'R204' },
  { id: 'BUREAU_UNAVAILABLE', priority: 35, expr: 'bureau.available == 1', onFail: 'REFER', reason: 'R500' },
  { id: 'THIN_FILE', priority: 40, expr: 'bureau.tradelines >= 1', onFail: 'REFER', reason: 'R310' },
  { id: 'RECENT_DELINQ', priority: 41, expr: 'bureau.dpd30PlusLast12M == 0', onFail: 'DECLINE', reason: 'R320' },
  { id: 'ENQUIRY_VELOCITY', priority: 42, expr: 'bureau.enquiriesLast3M <= 6', onFail: 'REFER', reason: 'R330' },
  // Calibrated to this scorecard's actual achievable range (~500-589), not the 620 in the
  // build plan's example -- see apps/orchestrator/README.md's calibration note.
  { id: 'SCORE_FLOOR', priority: 50, expr: 'score.value >= 555', onFail: 'DECLINE', reason: 'R400' },
];

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}
function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}
function pad(n, width) {
  return String(n).padStart(width, '0');
}

let panCounter = 0;
function randomPan() {
  panCounter += 1;
  const letters = () => String.fromCharCode(65 + randInt(0, 25));
  return `${letters()}${letters()}${letters()}${letters()}${letters()}${pad(panCounter % 10000, 4)}${letters()}`;
}

function randomApplication() {
  const age = randInt(21, 58);
  const dobYear = new Date().getFullYear() - age;
  const employmentType = pick(['SALARIED', 'SALARIED', 'SALARIED', 'SELF_EMPLOYED', 'GOVERNMENT']);
  const monthlyIncome = randInt(25, 200) * 1000;
  const obligations = Math.round(monthlyIncome * (Math.random() * 0.35));
  // PL only -- ensureActivePolicy() sets up a policy for PL; BL/AUTO would 404. Multi-
  // product policies are a real gap (see docs/build-plan.md), not something this seed
  // script papers over.
  const product = 'PL';
  const tenureMonths = pick([12, 24, 36, 48, 60]);
  const requestedAmount = Math.round((monthlyIncome * randInt(6, 24)) / 10000) * 10000;
  const estimatedEmi = Math.round(requestedAmount / tenureMonths);

  return {
    applicant: {
      fullName: `Seed Applicant ${panCounter}`,
      pan: randomPan(),
      dob: `${dobYear}-${pad(randInt(1, 12), 2)}-${pad(randInt(1, 28), 2)}`,
      mobile: `9${pad(randInt(0, 999999999), 9)}`,
      employmentType,
      employmentTenureMonths: randInt(0, 200),
      monthlyIncome,
      obligations,
      numDependents: randInt(0, 4),
    },
    application: { product, requestedAmount, tenureMonths, estimatedEmi },
  };
}

async function ensureActivePolicy() {
  const res = await fetch(`${ORCHESTRATOR_URL}/policy/active?product=PL`);
  if (res.ok) {
    console.log('an ACTIVE PL policy already exists, reusing it');
    return;
  }
  console.log('no ACTIVE PL policy found, creating and activating one for the seed run');
  await fetch(`${ORCHESTRATOR_URL}/policy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: POLICY_VERSION, product: 'PL', createdBy: 'seed-script', rules: DEFAULT_RULES }),
  });
  await fetch(`${ORCHESTRATOR_URL}/policy/${POLICY_VERSION}/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approvedBy: 'seed-script-approver' }),
  });
}

async function submitOne() {
  const body = randomApplication();
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, status: res.status, message: json.message };
    return { ok: true, outcome: json.decision?.outcome };
  } catch (err) {
    return { ok: false, status: 0, message: err.message };
  }
}

async function runPool(count, concurrency) {
  let completed = 0;
  const results = { APPROVE: 0, REFER: 0, DECLINE: 0, failed: 0 };
  const startedAt = Date.now();

  async function worker() {
    while (completed < count) {
      completed += 1;
      const result = await submitOne();
      if (result.ok) results[result.outcome] = (results[result.outcome] ?? 0) + 1;
      else {
        results.failed += 1;
        if (process.env.SEED_DEBUG) console.error(`\nFAILED ${result.status}: ${result.message}`);
      }
      if (completed % 50 === 0 || completed === count) {
        process.stdout.write(`\r${completed}/${count} submitted...`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  const elapsedS = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\ndone in ${elapsedS}s -- ${JSON.stringify(results)}`);
}

async function main() {
  console.log(`seeding ${COUNT} applications against ${ORCHESTRATOR_URL} (concurrency ${CONCURRENCY})`);
  await ensureActivePolicy();
  await runPool(COUNT, CONCURRENCY);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
