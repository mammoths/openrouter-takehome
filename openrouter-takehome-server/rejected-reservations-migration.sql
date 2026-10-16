-- Dedicated take-home DB only. Execute all statements in one D1 batch transaction.
-- This restores local estimate capacity, not provider credits or an asserted refund.
ALTER TABLE takehome_jobs ADD COLUMN submission_status TEXT NOT NULL DEFAULT 'planned';
ALTER TABLE takehome_jobs ADD COLUMN error_status INTEGER;
ALTER TABLE takehome_jobs ADD COLUMN error_details_json TEXT NOT NULL DEFAULT '{}';
CREATE TABLE takehome_reservation_releases (
  job_id TEXT PRIMARY KEY REFERENCES takehome_jobs(id),
  comparison_id TEXT NOT NULL REFERENCES takehome_comparisons(id),
  released_microusd INTEGER NOT NULL,
  batch_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
UPDATE takehome_jobs SET submission_status='accepted' WHERE upstream_job_id IS NOT NULL;
UPDATE takehome_jobs SET submission_status='unknown'
  WHERE upstream_job_id IS NULL AND status IN ('unknown','submitting','failed');
-- Only historical definite HTTP client rejections, with no accepted job or cost.
UPDATE takehome_jobs SET
  submission_status='rejected',
  error_status=CAST(substr(error,instr(error,'HTTP ')+5,3) AS INTEGER)
  WHERE upstream_job_id IS NULL AND actual_cost IS NULL AND status='failed'
  AND error = 'Submission rejected (HTTP ' || substr(error,instr(error,'HTTP ')+5,3) || '). No automatic retry.'
  AND CAST(substr(error,instr(error,'HTTP ')+5,3) AS INTEGER) BETWEEN 400 AND 499
  AND CAST(substr(error,instr(error,'HTTP ')+5,3) AS INTEGER) NOT IN (408,499);
UPDATE takehome_comparisons SET status='rejected',active=0
  WHERE (SELECT COUNT(*) FROM takehome_jobs j WHERE j.comparison_id=takehome_comparisons.id)=2
  AND NOT EXISTS(SELECT 1 FROM takehome_jobs j WHERE j.comparison_id=takehome_comparisons.id AND j.submission_status!='rejected');
INSERT OR IGNORE INTO takehome_reservation_releases(job_id,comparison_id,released_microusd,batch_id,created_at)
  SELECT j.id,j.comparison_id,j.estimated_microusd,'historical-rejection-migration',j.updated_at
  FROM takehome_jobs j JOIN takehome_reservations r ON r.comparison_id=j.comparison_id
  WHERE j.submission_status='rejected' AND j.upstream_job_id IS NULL AND j.actual_cost IS NULL;
UPDATE takehome_budget SET reserved_microusd=MAX(0,reserved_microusd-
  COALESCE((SELECT SUM(released_microusd) FROM takehome_reservation_releases WHERE batch_id='historical-rejection-migration'),0)) WHERE id=1;
INSERT INTO takehome_cache(key,value,updated_at)
  SELECT 'payment-block',json_object('reason','payment','errorStatus',402,'message','Previous submissions were rejected with HTTP 402. Check OpenRouter account funding and API key limits before explicitly retrying.','requiresPaymentAcknowledgement',json('true')),MAX(updated_at)
  FROM takehome_jobs WHERE error_status=402 HAVING COUNT(*)>0
  ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
