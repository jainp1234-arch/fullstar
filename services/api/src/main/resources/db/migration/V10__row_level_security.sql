-- Schema §7 Row-level security, every table in schema app.
-- RLS is enabled and forced on all tables; app_system bypasses it (BYPASSRLS).
-- Session values per request transaction (set by the API):
--   app.actor = 'parent' | 'staff', app.family_id (parents), app.staff_role (staff).

CREATE FUNCTION app.current_family() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.family_id', true), '')::uuid $$;
CREATE FUNCTION app.is_staff() RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT current_setting('app.actor', true) = 'staff' $$;
CREATE FUNCTION app.is_super_admin() RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT current_setting('app.staff_role', true) = 'super_admin' $$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'app' LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- 1. Family-only tables (staff have NO access)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['children','child_books','lesson_previews','activity_attempts','answer_events',
                           'mistakes','usage_minutes','reading_tests','worksheets','worksheet_weak_spots'] LOOP
    EXECUTE format('CREATE POLICY family_only ON app.%I
                      USING (family_id = app.current_family()) WITH CHECK (family_id = app.current_family())', t);
  END LOOP;
END $$;
CREATE POLICY family_only ON app.worksheet_questions
  USING (EXISTS (SELECT 1 FROM app.worksheets w WHERE w.id = worksheet_id AND w.family_id = app.current_family()))
  WITH CHECK (EXISTS (SELECT 1 FROM app.worksheets w WHERE w.id = worksheet_id AND w.family_id = app.current_family()));

-- 2. Family + staff read (staff prepare content and answer reports)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['family_books','family_chapters','uploads','upload_files','pages',
                           'problem_reports','support_tickets'] LOOP
    EXECUTE format('CREATE POLICY family_rw ON app.%I
                      USING (family_id = app.current_family()) WITH CHECK (family_id = app.current_family())', t);
    EXECUTE format('CREATE POLICY staff_read ON app.%I FOR SELECT USING (app.is_staff())', t);
  END LOOP;
  -- family_books added so roll_up_book_status works when staff change chapter status (Schema §7 note)
  FOREACH t IN ARRAY ARRAY['family_books','family_chapters','problem_reports','support_tickets'] LOOP
    EXECUTE format('CREATE POLICY staff_update ON app.%I FOR UPDATE USING (app.is_staff()) WITH CHECK (app.is_staff())', t);
  END LOOP;
END $$;
-- support_messages: parents may only write parent-authored messages; staff insert staff replies
CREATE POLICY family_rw ON app.support_messages
  USING (family_id = app.current_family())
  WITH CHECK (family_id = app.current_family() AND author = 'parent');
CREATE POLICY staff_read ON app.support_messages FOR SELECT USING (app.is_staff());
CREATE POLICY staff_insert ON app.support_messages FOR INSERT WITH CHECK (app.is_staff() AND author = 'staff');

-- 3. families: a parent sees only their own row; staff see none
CREATE POLICY own_family ON app.families USING (id = app.current_family()) WITH CHECK (id = app.current_family());

-- 4. messages: parents read/update their own; staff may INSERT (support replies, lessons ready)
CREATE POLICY family_messages ON app.messages USING (family_id = app.current_family());
CREATE POLICY staff_insert_messages ON app.messages FOR INSERT WITH CHECK (app.is_staff());

-- 5. Content: parents read only published content they are entitled to
CREATE POLICY kid_read_content ON app.content_items FOR SELECT USING (
  app.is_staff() OR (status = 'published' AND (
    scope = 'library' OR EXISTS (SELECT 1 FROM app.family_chapters fc
                                  WHERE fc.catalog_chapter_id = content_items.catalog_chapter_id
                                    AND fc.family_id = app.current_family()))));
CREATE POLICY staff_write_content ON app.content_items FOR ALL USING (app.is_staff()) WITH CHECK (app.is_staff());

-- content_versions: parents read only the published version of an item they can read
CREATE POLICY read_published_version ON app.content_versions FOR SELECT USING (
  app.is_staff() OR EXISTS (SELECT 1 FROM app.content_items ci WHERE ci.published_version_id = content_versions.id));
CREATE POLICY staff_write_versions ON app.content_versions FOR ALL USING (app.is_staff()) WITH CHECK (app.is_staff());

-- Reference and catalog: readable by everyone; writable by staff
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['subjects','class_subjects','topics','catalog_books','catalog_chapters'] LOOP
    EXECUTE format('CREATE POLICY read_all ON app.%I FOR SELECT USING (true)', t);
    EXECUTE format('CREATE POLICY staff_write ON app.%I FOR ALL USING (app.is_staff()) WITH CHECK (app.is_staff())', t);
  END LOOP;
  -- Staff only
  FOREACH t IN ARRAY ARRAY['content_checks','content_check_flags','prep_tasks'] LOOP
    EXECUTE format('CREATE POLICY staff_only ON app.%I FOR ALL USING (app.is_staff()) WITH CHECK (app.is_staff())', t);
  END LOOP;
END $$;

-- 6. Super admin tables (with the additions noted in Schema §7)
CREATE POLICY staff_read ON app.staff_users FOR SELECT USING (app.is_staff());
CREATE POLICY super_admin ON app.staff_users FOR ALL USING (app.is_super_admin()) WITH CHECK (app.is_super_admin());

CREATE POLICY super_admin ON app.deletion_requests FOR ALL USING (app.is_super_admin()) WITH CHECK (app.is_super_admin());
CREATE POLICY parent_request ON app.deletion_requests FOR INSERT WITH CHECK (family_id = app.current_family());

CREATE POLICY actor_insert ON app.audit_log FOR INSERT WITH CHECK (app.is_staff() OR app.current_family() IS NOT NULL);
CREATE POLICY super_admin_read ON app.audit_log FOR SELECT USING (app.is_super_admin());

-- 7. Operations
CREATE POLICY api_read ON app.processed_jobs FOR SELECT USING (true);
CREATE POLICY api_insert ON app.processed_jobs FOR INSERT WITH CHECK (true);

CREATE POLICY api_insert ON app.usage_events FOR INSERT WITH CHECK (true);
CREATE POLICY super_admin_read ON app.usage_events FOR SELECT USING (app.is_super_admin());

CREATE POLICY super_admin_read ON app.anonymous_totals FOR SELECT USING (app.is_super_admin());
