// The agent lets the model use tools while it answers: it writes a
// <tool_call> block, we run the tool, hand back the result and let it
// continue. Research mode is a fixed pipeline instead, which small models
// follow far more reliably than open-ended tool use.

import crypto from 'node:crypto';
import path from 'node:path';
import { db } from './db.js';
import { acquire } from './queue.js';
import { features, streamChat, search, generateImage, runPython } from './engines.js';
import { readPage } from './web.js';

const MAX_TOOL_CALLS = 4;
const OPEN = '<tool_call>';
const CLOSE = '</tool_call>';

const TOOLS = [
  {
    name: 'web_search', on: () => features.search, param: 'query',
    description: 'Search the web. Use for recent events, news, prices, people, products, or any fact you are not sure about.',
  },
  {
    name: 'read_page', on: () => features.search, param: 'url',
    description: 'Read the text of a web page, for example one from the search results.',
  },
  {
    name: 'run_python', on: () => features.code, param: 'code',
    description: 'Run Python 3 with numpy, pandas and matplotlib (no internet). Use for exact maths, data analysis and charts. Print results; charts are shown to the user.',
  },
  {
    name: 'create_image', on: () => features.images, param: 'prompt',
    description: 'Create a picture from a detailed English description. Use only when the user asks for an image, drawing or photo.',
  },
  {
    name: 'save_memory', on: () => true, param: 'fact',
    description: 'Save a lasting fact about the user (name, work, preferences) for future chats, or anything they ask you to remember.',
  },
];

// toolPrompt describes the tools in the format Qwen 2.5 was trained on,
// which other instruction-tuned models also follow well.
export function toolPrompt() {
  const schemas = TOOLS.filter((t) => t.on()).map((t) => JSON.stringify({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: { type: 'object', properties: { [t.param]: { type: 'string' } }, required: [t.param] },
    },
  }));

  return [
    '# Tools',
    '',
    'You may call one or more functions to assist with the user query.',
    '',
    'You are provided with function signatures within <tools></tools> XML tags:',
    '<tools>',
    ...schemas,
    '</tools>',
    '',
    'For each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:',
    OPEN,
    '{"name": <function-name>, "arguments": <args-json-object>}',
    CLOSE,
    '',
    'Results come back in <tool_response> tags. Answer directly when no tool is needed. Never invent tool results. Cite web results as [1], [2].',
  ].join('\n');
}

// ToolCallFilter passes reply text through while holding back anything that
// may be the start of a tool call.
class ToolCallFilter {
  buffer = '';
  call = null;

  push(token) {
    this.buffer += token;
    if (this.call === null) {
      const at = this.buffer.indexOf(OPEN);
      if (at < 0) {
        let hold = 0;
        for (let k = Math.min(OPEN.length - 1, this.buffer.length); k > 0; k--) {
          if (this.buffer.endsWith(OPEN.slice(0, k))) {
            hold = k;
            break;
          }
        }
        const out = this.buffer.slice(0, this.buffer.length - hold);
        this.buffer = this.buffer.slice(out.length);
        return out;
      }
      const out = this.buffer.slice(0, at);
      this.call = '';
      this.buffer = this.buffer.slice(at + OPEN.length);
      return out;
    }
    return '';
  }

  // complete reports a finished tool call, if one has been written.
  complete() {
    if (this.call === null) return null;
    const end = this.buffer.indexOf(CLOSE);
    return end < 0 ? null : this.buffer.slice(0, end);
  }

  // finish flushes what's left at the end of the reply. A tool call that was
  // never closed is still tried, since small models often forget the tag.
  finish() {
    if (this.call === null) {
      const out = this.buffer;
      this.buffer = '';
      return { text: out, call: null };
    }
    return { text: '', call: this.buffer };
  }
}

function parseCall(raw) {
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const call = JSON.parse(json);
    const tool = TOOLS.find((t) => t.name === call.name && t.on());
    return tool ? { name: tool.name, args: call.arguments || call.parameters || {} } : null;
  } catch {
    return null;
  }
}

// Turn is one assistant reply in progress: its text, the steps it took,
// sources it found and files it produced.
export class Turn {
  // options: user, model, signal, send(event), imageDir, canMakeImage()
  constructor(options) {
    Object.assign(this, options);
    this.text = '';
    this.steps = [];
    this.sources = [];
    this.files = [];
  }

  step(label, extra = {}) {
    const s = { id: crypto.randomUUID(), label, status: 'running', ...extra };
    this.steps.push(s);
    this.send({ step: s });
    return {
      done: (fields = {}) => {
        Object.assign(s, { status: 'done' }, fields);
        this.send({ step: s });
      },
      fail: (detail) => {
        Object.assign(s, { status: 'error', detail });
        this.send({ step: s });
      },
    };
  }

  addSources(results) {
    return results.map((r) => {
      let n = this.sources.findIndex((s) => s.url === r.url) + 1;
      if (!n) {
        this.sources.push(r);
        n = this.sources.length;
        this.send({ sources: this.sources });
      }
      return { ...r, n };
    });
  }

  emit(text) {
    if (!text) return;
    this.text += text;
    this.send({ token: text });
  }
}

// chat answers with tools available. It takes a model slot from the waiting
// line and gives it back while a slow tool (image generation) runs.
export async function chat(turn, messages) {
  let release = await acquire((n) => turn.send({ queue: n }), turn.signal);
  turn.send({ queue: 0 });

  try {
    for (let calls = 0; ; calls++) {
      const filter = new ToolCallFilter();
      const stop = new AbortController();
      const signal = AbortSignal.any([turn.signal, stop.signal]);
      let raw = null;

      try {
        for await (const token of streamChat(turn.model, messages, signal)) {
          turn.emit(filter.push(token));
          if ((raw = filter.complete()) !== null) {
            stop.abort(); // the model has asked for a tool; no need to wait for more
            break;
          }
        }
      } catch (err) {
        if (!stop.signal.aborted) throw err;
      }

      if (raw === null) {
        const rest = filter.finish();
        turn.emit(rest.text);
        raw = rest.call;
      }
      const call = raw !== null && calls < MAX_TOOL_CALLS ? parseCall(raw) : null;
      if (!call) return;

      const slow = call.name === 'create_image';
      if (slow) release();
      const result = await runTool(turn, call);
      if (slow) {
        release = await acquire((n) => turn.send({ queue: n }), turn.signal);
        turn.send({ queue: 0 });
      }

      messages = [
        ...messages,
        { role: 'assistant', content: `${turn.text}\n${OPEN}\n${JSON.stringify({ name: call.name, arguments: call.args })}\n${CLOSE}` },
        { role: 'user', content: `<tool_response>\n${result}\n</tool_response>` },
      ];
      if (turn.text && !turn.text.endsWith('\n')) turn.emit('\n\n');
    }
  } finally {
    release();
  }
}

async function runTool(turn, { name, args }) {
  const str = (v) => String(v ?? '').trim();

  switch (name) {
    case 'web_search': {
      const query = str(args.query);
      const s = turn.step(`Searching the web for “${query}”`);
      try {
        const found = turn.addSources(await search(query));
        s.done({ detail: found.map((r) => `[${r.n}] ${r.title}`).join('\n') });
        if (!found.length) return 'No results.';
        return found.map((r) => `[${r.n}] ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n');
      } catch (err) {
        s.fail(err.message);
        return `Search failed: ${err.message}`;
      }
    }

    case 'read_page': {
      const url = str(args.url);
      const s = turn.step(`Reading ${hostOf(url)}`);
      try {
        const page = await readPage(url);
        const [src] = turn.addSources([{ title: page.title || hostOf(page.url), url: page.url, snippet: '' }]);
        s.done({ detail: page.title });
        return `[${src.n}] ${page.title}\n${page.text}`;
      } catch (err) {
        s.fail(err.message);
        return `Couldn't read the page: ${err.message}`;
      }
    }

    case 'run_python': {
      const code = str(args.code);
      const s = turn.step('Running Python', { code });
      try {
        const out = await runPython(code);
        for (const data of out.images) {
          turn.files.push({ id: crypto.randomUUID(), kind: 'image', name: 'chart.png', size: 0, data });
        }
        if (out.images.length) turn.send({ files: turn.files });
        const output = [out.stdout, out.stderr].filter(Boolean).join('\n').slice(0, 4000);
        s.done({ output: output || (out.images.length ? 'Chart created' : 'No output') });
        return `${output || '(no output)'}${out.images.length ? `\n(${out.images.length} chart(s) shown to the user)` : ''}`;
      } catch (err) {
        s.fail(err.message);
        return `Couldn't run the code: ${err.message}`;
      }
    }

    case 'create_image': {
      const prompt = str(args.prompt);
      if (!turn.canMakeImage()) return "The user has reached today's image limit. Tell them.";
      const s = turn.step('Creating an image (about a minute)', { detail: prompt });
      try {
        const id = await makeImage(turn, prompt);
        const image = { id, kind: 'image', name: `${prompt.slice(0, 40)}.png`, url: `/api/images/${id}`, size: 0 };
        turn.files.push(image);
        turn.send({ files: turn.files });
        s.done();
        return 'The image was created and is shown to the user. Describe it in one short sentence.';
      } catch (err) {
        s.fail(err.message);
        return `Couldn't create the image: ${err.message}`;
      }
    }

    case 'save_memory': {
      const fact = str(args.fact).slice(0, 500);
      if (fact) {
        const exists = db.prepare('SELECT 1 FROM memories WHERE user_id = ? AND content = ?').get(turn.user.id, fact);
        if (!exists) db.prepare('INSERT INTO memories (user_id, content, created_at) VALUES (?, ?, ?)').run(turn.user.id, fact, Date.now());
        turn.step('Saved to memory', { detail: fact }).done();
      }
      return 'Saved.';
    }
  }
  return 'Unknown tool.';
}

// Image generation is slow on a CPU, so requests take turns.
let imageLine = Promise.resolve();
export function inImageLine(fn) {
  const turn = imageLine.then(fn, fn);
  imageLine = turn.catch(() => {});
  return turn;
}

export async function makeImage(turn, prompt) {
  const id = crypto.randomUUID();
  await inImageLine(async () => {
    if (turn.signal.aborted) throw new Error('cancelled');
    await generateImage(prompt, path.join(turn.imageDir, `${id}.png`));
  });
  db.prepare('INSERT INTO images (id, user_id, prompt, created_at) VALUES (?, ?, ?, ?)').run(id, turn.user.id, prompt, Date.now());
  return id;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'a page';
  }
}

// --- research mode ------------------------------------------------------

const RESEARCH_PAGES = 5;
const PAGE_CHARS = 3500;

// research plans searches, reads the best pages and writes a cited report.
export async function research(turn, question, systemPrompt) {
  let release = await acquire((n) => turn.send({ queue: n }), turn.signal);
  turn.send({ queue: 0 });

  try {
    const plan = turn.step('Planning the research');
    let queries = [];
    try {
      let out = '';
      for await (const t of streamChat(turn.model, [
        { role: 'system', content: 'You plan web research. Reply with a JSON array of 3 to 5 short, different search queries and nothing else.' },
        { role: 'user', content: question },
      ], turn.signal)) out += t;
      queries = JSON.parse(out.match(/\[[\s\S]*\]/)?.[0] || '[]').map(String).filter(Boolean).slice(0, 5);
    } catch {
      // fall back to the question itself
    }
    if (!queries.length) queries = [question];
    plan.done({ detail: queries.join('\n') });

    // searching and reading don't need the model; let others use it meanwhile
    release();
    release = null;

    const seen = new Map();
    for (const q of queries) {
      const s = turn.step(`Searching for “${q}”`);
      try {
        const results = await search(q, 6);
        for (const r of results) if (!seen.has(r.url)) seen.set(r.url, r);
        s.done({ detail: `${results.length} results` });
      } catch (err) {
        s.fail(err.message);
      }
    }

    const notes = [];
    for (const r of [...seen.values()].slice(0, RESEARCH_PAGES * 2)) {
      if (notes.length >= RESEARCH_PAGES || turn.signal.aborted) break;
      const s = turn.step(`Reading ${hostOf(r.url)}`);
      try {
        const page = await readPage(r.url, PAGE_CHARS);
        if (page.text.length < 300) throw new Error('not enough text');
        const [src] = turn.addSources([{ title: page.title || r.title, url: page.url, snippet: r.snippet }]);
        notes.push(`[${src.n}] ${page.title || r.title} (${page.url})\n${page.text}`);
        s.done({ detail: page.title || r.title });
      } catch (err) {
        s.fail(err.message);
      }
    }

    // fall back to search snippets if no page could be read
    if (!notes.length) {
      for (const r of [...seen.values()].slice(0, 8)) {
        const [src] = turn.addSources([r]);
        notes.push(`[${src.n}] ${r.title} (${r.url})\n${r.snippet}`);
      }
    }

    release = await acquire((n) => turn.send({ queue: n }), turn.signal);
    turn.send({ queue: 0 });
    const write = turn.step('Writing the report');

    const messages = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Write a thorough, well-organised research report answering:\n\n${question}\n\n`
          + 'Use Markdown headings, start with a short summary, and cite every fact with the source numbers like [1]. '
          + `Only use these sources:\n\n${notes.join('\n\n---\n\n')}`,
      },
    ];
    for await (const token of streamChat(turn.model, messages, turn.signal)) turn.emit(token);
    write.done();
  } finally {
    release?.();
  }
}
