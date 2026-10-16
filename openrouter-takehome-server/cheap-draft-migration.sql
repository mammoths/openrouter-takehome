-- Dedicated take-home database ONLY. Run once, all statements in one D1 batch.
-- Existing runs keep their compare mode and original 720p requested specs.
ALTER TABLE takehome_comparisons ADD COLUMN mode TEXT NOT NULL DEFAULT 'compare' CHECK (mode IN ('compare','draft'));
ALTER TABLE takehome_comparisons ADD COLUMN second_request_id TEXT;
CREATE UNIQUE INDEX takehome_second_request_unique ON takehome_comparisons(second_request_id) WHERE second_request_id IS NOT NULL;
ALTER TABLE takehome_jobs ADD COLUMN resolution TEXT NOT NULL DEFAULT '720p';
ALTER TABLE takehome_jobs ADD COLUMN duration INTEGER NOT NULL DEFAULT 4;
ALTER TABLE takehome_jobs ADD COLUMN aspect_ratio TEXT NOT NULL DEFAULT '9:16';
