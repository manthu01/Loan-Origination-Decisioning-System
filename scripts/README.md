# scripts

## seed.js

Populates the running stack with realistic decided applications so the console (queue,
case detail, dashboard) and the policy simulator have real content — "a demo with three
rows looks like a toy."

```bash
docker compose up -d
node scripts/seed.js 500        # count defaults to 500 if omitted
```

Goes through the real `POST /applications` pipeline (dedupe, KYC, the bureau mock, a
real scoring call, real rule evaluation) rather than writing rows directly — that's what
makes the resulting audit chain and decisions legitimate to replay against. Creates and
activates a `PL` policy first if none is active yet. Only submits `PL` applications;
`BL`/`AUTO` have no seeded policy, so requests for those products would 404 (the rules
engine supports multiple products, this script just doesn't author policies for them).

Environment variables: `ORCHESTRATOR_URL` (default `http://localhost:3001`),
`SEED_CONCURRENCY` (default `20`), `SEED_DEBUG=1` to print individual failure reasons.
