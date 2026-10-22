// Plan 9.5: Claude for the journey tests (no key, no internet). Answers POST /v1/messages like the
// Anthropic Messages API, with content picked from the prompt (services/api prompts/*.md):
//   "Write an animated lesson ..."        a 6-scene lesson on the topic
//   "Write N practice questions ..."      N multiple-choice questions
//   "Write a reading passage ..."         a short passage
//   "You check learning content ..."      flags (see FLAGS below)
// A chapter draft (the prompt has <chapter>) gets one wrong answer and one misspelling on purpose, so
// the admin journey sees the content check flag them (App Flow §8 "Admin prepares an uploaded book").
// Run: node tools/journeys/claude-stand-in.mjs [port]   (default 8090)
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 8090);
const WRONG = 'Two and three make four.';
const MISSPELT = 'Read teh chapter with us.';
const FLAGS = [
  {
    when: WRONG,
    flag: {
      severity: 'critical',
      category: 'wrong_answer',
      location: 'solution.explanation',
      reason: 'Two and three make five, not four.',
    },
  },
  {
    when: MISSPELT,
    flag: {
      severity: 'warning',
      category: 'language',
      location: 'body.scenes[0].text',
      reason: '"teh" should be "the".',
    },
  },
];

function quoted(user, after) {
  const match = new RegExp(`${after}\\s*"([^"]+)"`).exec(user);
  return match?.[1] ?? 'this topic';
}

function lesson(user) {
  const topic = quoted(user, 'on the topic');
  const hindi = /in Hindi/.test(user);
  const chapter = user.includes('<chapter>');
  const lines = hindi
    ? [
        // A chapter lesson starts with the misspelt line in either language (the warning)
        chapter ? MISSPELT : 'आज हम कुछ नया सीखेंगे।',
        'ध्यान से देखो।',
        'यह बहुत आसान है।',
        'चलो साथ में पढ़ें।',
        'अब तुम बताओ।',
        'बहुत अच्छे!',
      ]
    : [
        chapter ? MISSPELT : `Today we learn about ${topic}.`,
        'Look closely at the picture.',
        'It is easier than it looks.',
        'Let us read it together.',
        'Now you try.',
        'Well done!',
      ];
  return {
    title: hindi ? `${topic}: पाठ` : `${topic}: a short lesson`,
    body: {
      scenes: lines.map((text, i) => ({
        id: `s${i + 1}`,
        duration_ms: 4000,
        text,
        visual: null,
      })),
    },
  };
}

function questions(user) {
  const count = Number(/Write (\d+) practice questions/.exec(user)?.[1] ?? 10);
  const topic = quoted(user, 'on the topic');
  const chapter = user.includes('<chapter>');
  return {
    questions: Array.from({ length: count }, (_, i) => {
      const wrong = chapter && i === 0;
      return {
        title: `${topic} ${i + 1}`,
        question_type: 'mcq',
        difficulty: (i % 3) + 1,
        body: {
          prompt: wrong
            ? 'What do two and three make?'
            : `${topic}: which answer is right? (${i + 1})`,
          image_key: null,
          options: [
            { id: 'a', text: wrong ? 'Four' : 'This one' },
            { id: 'b', text: wrong ? 'Five' : 'Not this one' },
          ],
        },
        solution: {
          correct: ['a'],
          explanation: wrong ? WRONG : 'The first answer fits the topic.',
        },
      };
    }),
  };
}

function passage(user) {
  const topic = quoted(user, 'on the topic');
  const text = `Asha reads about ${topic}. She likes it a lot. She tells her brother what she read.`;
  return {
    title: `${topic}: a story`,
    body: { text, word_count: text.split(/\s+/).length, level: 1 },
  };
}

function check(user) {
  return { flags: FLAGS.filter((f) => user.includes(f.when)).map((f) => f.flag) };
}

function reply(system, user) {
  if (/check learning content/i.test(system)) {
    return check(user);
  }
  if (user.startsWith('Write an animated lesson')) {
    return lesson(user);
  }
  if (/Write \d+ practice questions/.test(user)) {
    return questions(user);
  }
  if (user.startsWith('Write a reading passage')) {
    return passage(user);
  }
  return null;
}

function textOf(content) {
  return typeof content === 'string'
    ? content
    : (content ?? [])
        .map((block) => (typeof block === 'string' ? block : (block.text ?? '')))
        .join('');
}

createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200).end('ok');
    return;
  }
  if (request.method !== 'POST' || !request.url?.startsWith('/v1/messages')) {
    response.writeHead(404).end();
    return;
  }
  let raw = '';
  request.on('data', (chunk) => (raw += chunk));
  request.on('end', () => {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      response.writeHead(400).end();
      return;
    }
    const system = textOf(body.system);
    const user = (body.messages ?? []).map((m) => textOf(m.content)).join('\n');
    const answer = reply(system, user);
    const text = answer ? JSON.stringify(answer) : 'Sorry, I cannot help with that.';
    console.log(
      `stand-in reply ${answer ? 'json' : 'refusal'} for ${user.slice(0, 60).replace(/\s+/g, ' ')}`,
    );
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        id: `msg_stand_in_${Date.now()}`,
        type: 'message',
        role: 'assistant',
        model: body.model ?? 'stand-in',
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: Math.ceil((system.length + user.length) / 4),
          output_tokens: Math.ceil(text.length / 4),
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      }),
    );
  });
}).listen(port, '0.0.0.0', () => console.log(`Claude stand-in on :${port}`));
