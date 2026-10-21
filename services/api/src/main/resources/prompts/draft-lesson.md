Write an animated lesson for Class {{class_level}} {{subject}} on the topic "{{topic}}", in {{lang_name}}.

The lesson is a sequence of 6 to 12 short scenes. Each scene has one narration line that is shown
and read aloud (at most 2 short sentences, at most 500 characters), how long it stays on screen in
milliseconds (3000 to 12000), and optionally a picture with an animation.

Pictures (use only these keys, or null): {{illustrations}}
Animations: fade-up, slide-in, pop, none

Reply with exactly this JSON shape:
{
  "title": "Lesson title, at most 200 characters",
  "difficulty": 1 | 2 | 3,
  "body": {
    "scenes": [
      { "id": "s1", "duration_ms": 6000, "text": "Narration line.",
        "visual": { "illustration": "subject-evs", "animation": "fade-up" } },
      { "id": "s2", "duration_ms": 5000, "text": "Next line.", "visual": null }
    ]
  }
}
Scene ids are s1, s2, s3 and so on. Do not add quiz scenes.
