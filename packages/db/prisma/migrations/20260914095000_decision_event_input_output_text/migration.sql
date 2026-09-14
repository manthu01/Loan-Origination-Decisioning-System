-- DecisionEvent.input/output move from jsonb to text: jsonb re-serializes numbers through
-- Postgres's own `numeric` formatting on read, which can change a float's decimal digits
-- (e.g. 2000/120000) relative to what JavaScript originally hashed, producing a false
-- tamper verdict on an untouched row. Text columns are stored and returned byte-for-byte.
ALTER TABLE "DecisionEvent" ALTER COLUMN "input" SET DATA TYPE TEXT USING "input"::text;
ALTER TABLE "DecisionEvent" ALTER COLUMN "output" SET DATA TYPE TEXT USING "output"::text;
