-- DecisionEvent is the hash-chained pipeline trace: never UPDATE or DELETE a row. This
-- rule enforces that at the database level, not just by convention in application code --
-- see docs/design-doc.md and MODEL_CARD-adjacent notes on the audit log.

CREATE RULE decision_event_no_update AS
    ON UPDATE TO "DecisionEvent"
    DO INSTEAD NOTHING;

CREATE RULE decision_event_no_delete AS
    ON DELETE TO "DecisionEvent"
    DO INSTEAD NOTHING;
