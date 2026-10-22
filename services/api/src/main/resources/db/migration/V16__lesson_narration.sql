-- Plan 8.2 (decided 22 Oct 2026): a published lesson is narrated by voice-maker into one MP3
-- (narration_audio_key) with each scene's part of it (narration_timings, [{id, start_ms, end_ms}]).
-- The narration arrives after the version is saved, so those two columns are the only ones a
-- saved version may still change; everything else stays immutable (VERSION_IMMUTABLE).
ALTER TABLE app.content_versions ADD COLUMN narration_timings jsonb
  CHECK (narration_timings IS NULL OR jsonb_typeof(narration_timings) = 'array');

CREATE OR REPLACE FUNCTION app.versions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'narration_audio_key' - 'narration_timings')
     = (to_jsonb(OLD) - 'narration_audio_key' - 'narration_timings') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'VERSION_IMMUTABLE' USING ERRCODE = 'P0001';
END $$;
