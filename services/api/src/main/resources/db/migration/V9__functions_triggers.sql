-- Schema §6 Functions and triggers
-- Generated verbatim from docs/05-backend-schema.html; do not edit by hand (Schema §1 rule 1).

CREATE FUNCTION app.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
-- Apply to: families, children, staff_users, topics, catalog_books, catalog_chapters, content_items,
-- family_books, family_chapters, uploads, pages, activity_attempts, reading_tests, worksheets, support_tickets
-- e.g. CREATE TRIGGER families_updated BEFORE UPDATE ON app.families FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE FUNCTION app.enforce_max_children() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM app.families WHERE id = NEW.family_id FOR UPDATE;
  IF (SELECT count(*) FROM app.children WHERE family_id = NEW.family_id) >= 2 THEN
    RAISE EXCEPTION 'MAX_CHILDREN' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER children_max BEFORE INSERT ON app.children FOR EACH ROW EXECUTE FUNCTION app.enforce_max_children();

CREATE FUNCTION app.check_child_book() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app.children c JOIN app.family_books b ON b.id = NEW.family_book_id
     WHERE c.id = NEW.child_id AND c.family_id = b.family_id AND b.family_id = NEW.family_id
       AND b.subject_id = NEW.subject_id AND b.class_level = c.class_level) THEN
    RAISE EXCEPTION 'BOOK_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER child_books_check BEFORE INSERT OR UPDATE ON app.child_books FOR EACH ROW EXECUTE FUNCTION app.check_child_book();

CREATE FUNCTION app.track_mistakes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT NEW.is_correct THEN
    INSERT INTO app.mistakes (child_id, question_item_id, family_id, topic_id, last_wrong_at)
    VALUES (NEW.child_id, NEW.question_item_id, NEW.family_id, NEW.topic_id, NEW.answered_at)
    ON CONFLICT (child_id, question_item_id) DO UPDATE
      SET wrong_count = app.mistakes.wrong_count + 1, correct_streak = 0,
          last_wrong_at = EXCLUDED.last_wrong_at, resolved_at = NULL;
  ELSE
    UPDATE app.mistakes
       SET correct_streak = correct_streak + 1,
           resolved_at = CASE WHEN correct_streak + 1 >= 2 THEN NEW.answered_at ELSE NULL END
     WHERE child_id = NEW.child_id AND question_item_id = NEW.question_item_id AND resolved_at IS NULL;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER answers_mistakes AFTER INSERT ON app.answer_events FOR EACH ROW EXECUTE FUNCTION app.track_mistakes();

CREATE FUNCTION app.add_stars() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE app.children
     SET stars_total = stars_total + NEW.stars - CASE WHEN TG_OP = 'UPDATE' THEN OLD.stars ELSE 0 END
   WHERE id = NEW.child_id;
  RETURN NULL;
END $$;
CREATE TRIGGER attempts_stars AFTER INSERT OR UPDATE OF stars ON app.activity_attempts
  FOR EACH ROW EXECUTE FUNCTION app.add_stars();

CREATE FUNCTION app.limit_reading_tests() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM app.reading_tests WHERE child_id = NEW.child_id AND test_date = NEW.test_date) >= 2 THEN
    RAISE EXCEPTION 'READING_LIMIT' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reading_tests_limit BEFORE INSERT ON app.reading_tests FOR EACH ROW EXECUTE FUNCTION app.limit_reading_tests();

CREATE FUNCTION app.next_version_no() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM app.content_items WHERE id = NEW.item_id FOR UPDATE;
  NEW.version_no := COALESCE((SELECT max(version_no) FROM app.content_versions WHERE item_id = NEW.item_id), 0) + 1;
  RETURN NEW;
END $$;
CREATE TRIGGER versions_number BEFORE INSERT ON app.content_versions FOR EACH ROW EXECUTE FUNCTION app.next_version_no();

CREATE FUNCTION app.versions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'VERSION_IMMUTABLE' USING ERRCODE = 'P0001'; END $$;
CREATE TRIGGER versions_no_update BEFORE UPDATE ON app.content_versions FOR EACH ROW EXECUTE FUNCTION app.versions_immutable();

CREATE FUNCTION app.version_check_passed(p_version uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM (SELECT * FROM app.content_checks WHERE version_id = p_version
                    ORDER BY started_at DESC LIMIT 1) c
     WHERE c.status = 'passed'
       AND NOT EXISTS (SELECT 1 FROM app.content_check_flags f
                        WHERE f.check_id = c.id AND f.resolution = 'open'));
$$;

CREATE FUNCTION app.guard_publish() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.published_version_id IS NOT NULL
     AND NEW.published_version_id IS DISTINCT FROM OLD.published_version_id
     AND NOT app.version_check_passed(NEW.published_version_id) THEN
    RAISE EXCEPTION 'CHECK_NOT_PASSED' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER content_publish_guard BEFORE UPDATE OF published_version_id ON app.content_items
  FOR EACH ROW EXECUTE FUNCTION app.guard_publish();

CREATE FUNCTION app.roll_up_book_status() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text[];
BEGIN
  SELECT array_agg(DISTINCT status) INTO s FROM app.family_chapters WHERE family_book_id = NEW.family_book_id;
  UPDATE app.family_books SET status = CASE
      WHEN 'needs_attention' = ANY(s)                         THEN 'needs_attention'
      WHEN 'processing' = ANY(s) OR 'suggested' = ANY(s)      THEN 'getting_ready'
      WHEN 'lessons_being_prepared' = ANY(s)                  THEN 'lessons_being_prepared'
      WHEN 'readalong_ready' = ANY(s)                         THEN 'readalong_ready'
      ELSE 'lessons_ready' END
   WHERE id = NEW.family_book_id;
  RETURN NULL;
END $$;
CREATE TRIGGER chapters_rollup AFTER INSERT OR UPDATE OF status ON app.family_chapters
  FOR EACH ROW EXECUTE FUNCTION app.roll_up_book_status();

CREATE FUNCTION app.on_catalog_chapter_ready() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'ready' AND OLD.status IS DISTINCT FROM 'ready' THEN
    NEW.ready_at := now();
    UPDATE app.family_chapters SET status = 'lessons_ready'
     WHERE catalog_chapter_id = NEW.id AND status IN ('readalong_ready','lessons_being_prepared');
    UPDATE app.prep_tasks SET status = 'done', completed_at = now()
     WHERE catalog_chapter_id = NEW.id AND status IN ('open','in_progress');
    INSERT INTO app.messages (family_id, kind, title, body, link)
    SELECT fc.family_id, 'lessons_ready', 'Lessons ready',
           'Lessons for ' || s.name || ' Ch ' || fc.number || ' are ready. We recommend a quick preview.',
           jsonb_build_object('screen','P8a','family_chapter_id', fc.id)
      FROM app.family_chapters fc
      JOIN app.family_books fb ON fb.id = fc.family_book_id
      JOIN app.subjects s ON s.id = fb.subject_id
     WHERE fc.catalog_chapter_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER catalog_chapter_ready BEFORE UPDATE OF status ON app.catalog_chapters
  FOR EACH ROW EXECUTE FUNCTION app.on_catalog_chapter_ready();

CREATE FUNCTION app.move_child_to_next_class(p_child uuid) RETURNS smallint LANGUAGE plpgsql AS $$
DECLARE v_class smallint;
BEGIN
  SELECT class_level INTO v_class FROM app.children WHERE id = p_child FOR UPDATE;
  IF v_class IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_class >= 5 THEN RAISE EXCEPTION 'MAX_CLASS' USING ERRCODE = 'P0001'; END IF;
  DELETE FROM app.activity_attempts WHERE child_id = p_child;   -- cascades answers, reading tests
  DELETE FROM app.mistakes          WHERE child_id = p_child;
  DELETE FROM app.usage_minutes     WHERE child_id = p_child;
  DELETE FROM app.worksheets        WHERE child_id = p_child;
  DELETE FROM app.child_books       WHERE child_id = p_child;
  UPDATE app.children SET class_level = v_class + 1, stars_total = 0 WHERE id = p_child;
  RETURN v_class + 1;
END $$;

CREATE FUNCTION app.child_week_summary(p_child uuid, p_week_start date)
RETURNS TABLE (minutes integer, active_days integer, chapters_done integer, worksheets_done integer, areas jsonb)
LANGUAGE sql STABLE AS $$
  WITH w AS (SELECT (p_week_start::timestamp AT TIME ZONE 'Asia/Kolkata') AS f,
                    ((p_week_start + 7)::timestamp AT TIME ZONE 'Asia/Kolkata') AS t)
  SELECT
    (SELECT count(*)::int FROM app.usage_minutes u, w WHERE u.child_id = p_child AND u.minute_at >= w.f AND u.minute_at < w.t),
    (SELECT count(DISTINCT (u.minute_at AT TIME ZONE 'Asia/Kolkata')::date)::int FROM app.usage_minutes u, w
      WHERE u.child_id = p_child AND u.minute_at >= w.f AND u.minute_at < w.t),
    (SELECT count(DISTINCT a.family_chapter_id)::int FROM app.activity_attempts a, w
      WHERE a.child_id = p_child AND a.kind = 'lesson' AND a.completed_at >= w.f AND a.completed_at < w.t),
    (SELECT count(*)::int FROM app.worksheets ws, w WHERE ws.child_id = p_child AND ws.created_at >= w.f AND ws.created_at < w.t),
    (SELECT COALESCE(jsonb_agg(x ORDER BY x.score DESC), '[]') FROM (
        SELECT t.id AS topic_id, t.name, s.code AS subject,
               COALESCE(m.open_mistakes,0) * 1 + COALESCE(ws.ticks,0) * 2 AS score
          FROM app.topics t JOIN app.subjects s ON s.id = t.subject_id
          LEFT JOIN (SELECT topic_id, count(*) AS open_mistakes FROM app.mistakes
                      WHERE child_id = p_child AND resolved_at IS NULL GROUP BY topic_id) m ON m.topic_id = t.id
          LEFT JOIN (SELECT topic_id, count(*) AS ticks FROM app.worksheet_weak_spots
                      WHERE child_id = p_child AND marked_at > now() - interval '30 days' GROUP BY topic_id) ws ON ws.topic_id = t.id
         WHERE COALESCE(m.open_mistakes,0) + COALESCE(ws.ticks,0) > 0
         ORDER BY score DESC LIMIT 3) x);
$$;

CREATE FUNCTION app.complete_family_deletion(p_family uuid, p_staff uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE m date := date_trunc('month', now())::date;
BEGIN
  INSERT INTO app.anonymous_totals (metric, period_month, value)
  SELECT v.metric, m, v.n FROM (VALUES
    ('lessons_watched', (SELECT count(*) FROM app.activity_attempts WHERE family_id = p_family AND kind = 'lesson' AND completed_at IS NOT NULL)),
    ('worksheets_made', (SELECT count(*) FROM app.worksheets WHERE family_id = p_family)),
    ('reading_tests',   (SELECT count(*) FROM app.reading_tests WHERE family_id = p_family))) AS v(metric, n)
  ON CONFLICT (metric, period_month) DO UPDATE SET value = app.anonymous_totals.value + EXCLUDED.value;
  UPDATE app.deletion_requests SET status = 'done', completed_by = p_staff, completed_at = now()
   WHERE family_id = p_family AND status <> 'done';
  INSERT INTO app.audit_log (actor_type, actor_id, action, entity_type, entity_id)
  VALUES ('staff', p_staff::text, 'deletion.complete', 'family', p_family::text);
  DELETE FROM app.families WHERE id = p_family;                   -- cascades everything family-owned
END $$;

-- Daily 02:00 IST (Spring @Scheduled, role app_system). Returns R2 keys the API then deletes.
CREATE FUNCTION app.run_retention() RETURNS TABLE (object_key text) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH rec AS (
         SELECT id, recording_key FROM app.reading_tests
          WHERE recording_key IS NOT NULL AND recording_expires_at < now() FOR UPDATE),
       rec_clear AS (
         UPDATE app.reading_tests r SET recording_key = NULL
           FROM rec WHERE r.id = rec.id RETURNING rec.recording_key AS k),
       pdf AS (
         SELECT id, pdf_key FROM app.worksheets
          WHERE pdf_key IS NOT NULL AND pdf_expires_at < now() FOR UPDATE),
       pdf_clear AS (
         UPDATE app.worksheets w SET pdf_key = NULL, pdf_expires_at = NULL
           FROM pdf WHERE w.id = pdf.id RETURNING pdf.pdf_key AS k)
  SELECT k FROM rec_clear UNION ALL SELECT k FROM pdf_clear;

  DELETE FROM app.messages       WHERE expires_at   < now();
  DELETE FROM app.audit_log      WHERE created_at   < now() - interval '1 year';
  DELETE FROM app.usage_events   WHERE occurred_at  < now() - interval '1 year';
  DELETE FROM app.usage_minutes  WHERE minute_at    < now() - interval '400 days';
  DELETE FROM app.processed_jobs WHERE processed_at < now() - interval '14 days';
END $$;

-- set_updated_at applied to every table listed above (Schema §6)
CREATE TRIGGER families_updated BEFORE UPDATE ON app.families FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER children_updated BEFORE UPDATE ON app.children FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER staff_users_updated BEFORE UPDATE ON app.staff_users FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER topics_updated BEFORE UPDATE ON app.topics FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER catalog_books_updated BEFORE UPDATE ON app.catalog_books FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER catalog_chapters_updated BEFORE UPDATE ON app.catalog_chapters FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER content_items_updated BEFORE UPDATE ON app.content_items FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER family_books_updated BEFORE UPDATE ON app.family_books FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER family_chapters_updated BEFORE UPDATE ON app.family_chapters FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER uploads_updated BEFORE UPDATE ON app.uploads FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER pages_updated BEFORE UPDATE ON app.pages FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER activity_attempts_updated BEFORE UPDATE ON app.activity_attempts FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER reading_tests_updated BEFORE UPDATE ON app.reading_tests FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER worksheets_updated BEFORE UPDATE ON app.worksheets FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER support_tickets_updated BEFORE UPDATE ON app.support_tickets FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
