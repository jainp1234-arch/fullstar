Write a reading passage for Class {{class_level}} {{subject}} on the topic "{{topic}}", in
{{lang_name}}, for a child to read aloud. Length: about {{words}} words. Level 1 is easy, 2 medium,
3 hard; choose the level that fits Class {{class_level}}.

Reply with exactly this JSON shape:
{
  "title": "Passage title, at most 200 characters",
  "difficulty": 1 | 2 | 3,
  "body": { "text": "The passage text.", "word_count": 0, "level": 1 }
}
word_count is the number of words in text (we recount it).
