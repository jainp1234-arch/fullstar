-- Schema §14 V11: subjects and class_subjects for classes 1–5.
-- RLS is forced on these tables and only staff may write, so act as staff for this transaction.
SELECT set_config('app.actor', 'staff', true);

INSERT INTO app.subjects (id, code, name, active) VALUES
  (1, 'english',  'English',  true),
  (2, 'hindi',    'Hindi',    true),
  (3, 'maths',    'Maths',    true),
  (4, 'evs',      'EVS',      true),
  (5, 'computer', 'Computer', false);

INSERT INTO app.class_subjects (class_level, subject_id)
SELECT c, s FROM generate_series(1, 5) AS c, generate_series(1, 4) AS s;
