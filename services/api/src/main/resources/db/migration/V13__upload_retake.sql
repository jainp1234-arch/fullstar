-- Plan 5.3: a retake (P8) is a one-photo upload for one unclear page. The page it replaces is kept on
-- the upload, so book-process can swap just that page; deleting the page drops the retake.
ALTER TABLE app.uploads
  ADD COLUMN retake_page_id uuid REFERENCES app.pages(id) ON DELETE CASCADE,
  ADD CONSTRAINT upload_retake_one_photo CHECK (retake_page_id IS NULL OR (source = 'photos' AND file_count = 1));

-- Photos are pages in the order the parent picked them; files of one upload share created_at,
-- so the order is kept explicitly (0-based). Older rows have none and sort last by id.
ALTER TABLE app.upload_files ADD COLUMN position smallint CHECK (position >= 0);
