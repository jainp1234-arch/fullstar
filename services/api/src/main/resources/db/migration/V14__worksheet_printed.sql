-- Plan 7.2 (decided 22 Oct 2026): "Shuffle again" works only before a worksheet's first print. The
-- first time the parent opens its PDF (P12) or the child starts it on screen (K6) is recorded here.
ALTER TABLE app.worksheets ADD COLUMN printed_at timestamptz;
