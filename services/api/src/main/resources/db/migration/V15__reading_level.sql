-- Plan 8.3 (decided 22 Oct 2026): a child's reading level, the growing tree on K12. Starts at 1;
-- two scored tests in a row at the level with accuracy of 90% or more move it up one, to 3 at most.
ALTER TABLE app.children
  ADD COLUMN reading_level smallint NOT NULL DEFAULT 1 CHECK (reading_level BETWEEN 1 AND 3);
