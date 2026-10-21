Write {{count}} practice questions for Class {{class_level}} {{subject}} on the topic "{{topic}}", in
{{lang_name}}. Mix the four question types and the three difficulty levels (1 easy, 2 medium,
3 hard). Every question has a short explanation that a child understands.

Reply with exactly this JSON shape:
{
  "questions": [
    { "title": "Short name for the question bank list", "question_type": "mcq", "difficulty": 1,
      "body": { "prompt": "Which word is a noun?", "image_key": null,
                "options": [{"id":"a","text":"run"},{"id":"b","text":"bird"},{"id":"c","text":"blue"}] },
      "solution": { "correct": ["b"], "explanation": "A bird is a thing, so it is a noun." } },
    { "title": "...", "question_type": "true_false", "difficulty": 1,
      "body": { "prompt": "Fish live in water." },
      "solution": { "correct": true, "explanation": "..." } },
    { "title": "...", "question_type": "fill_blank", "difficulty": 2,
      "body": { "prompt": "The cat ___ on the mat.", "choices": ["sat", "sit", "sits"] },
      "solution": { "correct": "sat", "explanation": "..." } },
    { "title": "...", "question_type": "match", "difficulty": 3,
      "body": { "prompt": "Match the animal to its home.",
                "left": [{"id":"l1","text":"Bird"},{"id":"l2","text":"Bee"}],
                "right": [{"id":"r1","text":"Hive"},{"id":"r2","text":"Nest"}] },
      "solution": { "pairs": [["l1","r2"],["l2","r1"]], "explanation": "..." } }
  ]
}
Limits: prompt at most 300 characters; mcq has 2 to 4 options with ids a to d and exactly one
correct id; fill_blank marks the blank with ___ and has 2 to 4 different choices, one of them
correct; match has 2 to 5 pairs with ids l1.. and r1.., one pair per left item; explanation at most
500 characters; title at most 200 characters.
