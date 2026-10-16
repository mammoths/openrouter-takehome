-- Dedicated take-home database ONLY. Run all statements in one D1 batch/migration
-- transaction. The old CHECK(cap_microusd = 6000000) requires a table rebuild.
-- No settings, comparisons, jobs, reservations, or encryption data are changed.
ALTER TABLE takehome_budget RENAME TO takehome_budget_before_20;
CREATE TABLE takehome_budget (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cap_microusd INTEGER NOT NULL DEFAULT 20000000 CHECK (cap_microusd = 20000000),
  reserved_microusd INTEGER NOT NULL DEFAULT 0
);
INSERT INTO takehome_budget(id, cap_microusd, reserved_microusd)
  SELECT id, 20000000, reserved_microusd FROM takehome_budget_before_20;
DROP TABLE takehome_budget_before_20;
