// Engines are separate programs the site talks to: HFee (or any
// OpenAI-compatible server) for chat, and optional engines for vision,
// web search, speech, images and running code. Each feature is on only
// when its settings are present.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const env = process.env;

export const features = {
  vision: Boolean(env.VISION_BASE_URL && env.VISION_MODEL),
  search: Boolean(env.SEARXNG_URL),
  voiceIn: Boolean(env.WHISPER_URL),
  voiceOut: Boolean(env.PIPER_BIN && env.PIPER_VOICE),
  images: Boolean(env.SD_BIN && env.SD_MODEL),
  code: Boolean(env.SANDBOX_PYTHON) && onPath('bwrap') && onPath('prlimit'),
};

function onPath(cmd) {
  return (env.PATH || '').split(path.delimiter).some((dir) => existsSync(path.join(dir, cmd)));
}

// --- chat ---------------------------------------------------------------

// listModels returns the chat models the main endpoint offers.
export async function listModels() {
  try {
    const res = await fetch(`${env.AI_BASE_URL}/models`, { headers: authHeaders(env.AI_API_KEY) });
    const { data = [] } = await res.json();
    return data.map((m) => m.id);
  } catch {
    return [env.AI_MODEL];
  }
}

export const VISION_MODEL = 'vision';

function endpointFor(model) {
  if (model === VISION_MODEL) {
    return { url: env.VISION_BASE_URL, key: env.VISION_API_KEY, model: env.VISION_MODEL };
  }
  return { url: env.AI_BASE_URL, key: env.AI_API_KEY, model };
}

function authHeaders(key) {
  return key ? { Authorization: `Bearer ${key}` } : {};
}

// streamChat yields reply tokens from an OpenAI-compatible endpoint.
export async function* streamChat(model, messages, signal) {
  const ep = endpointFor(model);
  const res = await fetch(`${ep.url}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(ep.key) },
    signal,
    body: JSON.stringify({ model: ep.model, stream: true, messages }),
  });

  if (!res.ok) {
    const detail = await res.text();
    const err = new Error(`model returned ${res.status}: ${detail}`);
    if (/context (window|size|length)/i.test(detail)) {
      err.userMessage = 'This conversation is too long for the model. Start a new chat or attach smaller files.';
    }
    throw err;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const token = JSON.parse(data).choices?.[0]?.delta?.content;
        if (token) yield token;
      } catch {
        // ignore keep-alive or partial lines
      }
    }
  }
}

// --- web search (SearXNG) -----------------------------------------------

export async function search(query, limit = 5) {
  const url = new URL('/search', env.SEARXNG_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`search returned ${res.status}`);
  const { results = [] } = await res.json();

  return results
    .filter((r) => r.url && r.title)
    .slice(0, limit)
    .map((r) => ({ title: r.title, url: r.url, snippet: (r.content || '').slice(0, 500) }));
}

// --- speech (whisper.cpp server, Piper) ---------------------------------

// transcribe turns recorded audio (any format ffmpeg reads) into text.
export async function transcribe(audio) {
  const wav = await run('ffmpeg', ['-loglevel', 'error', '-i', 'pipe:0', '-ar', '16000', '-ac', '1', '-f', 'wav', 'pipe:1'], audio);

  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
  form.append('response_format', 'json');

  const res = await fetch(new URL('/inference', env.WHISPER_URL), { method: 'POST', body: form });
  if (!res.ok) throw new Error(`speech recognition returned ${res.status}`);
  const { text = '' } = await res.json();
  return text.trim();
}

// speak returns WAV audio of text read aloud.
export async function speak(text) {
  return withTempDir(async (dir) => {
    const out = path.join(dir, 'speech.wav');
    await run(env.PIPER_BIN, ['--model', env.PIPER_VOICE, '--output_file', out], Buffer.from(text));
    return fs.readFile(out);
  });
}

// --- image generation (stable-diffusion.cpp) ----------------------------

export async function generateImage(prompt, outFile) {
  const size = String(Number(env.SD_SIZE) || 512);
  const args = [
    '-m', env.SD_MODEL,
    '-p', prompt,
    '-o', outFile,
    '-W', size,
    '-H', size,
    '--steps', String(Number(env.SD_STEPS) || 4),
    '--cfg-scale', String(Number(env.SD_CFG) || 1),
    '--sampling-method', env.SD_SAMPLER || 'euler',
    '--scheduler', env.SD_SCHEDULER || 'sgm_uniform',
    '-s', String(crypto.randomInt(2 ** 31)),
    '-t', String(os.availableParallelism()),
    '--vae-tiling', // decode in tiles to keep memory down
  ];
  if (env.SD_TYPE) args.push('--type', env.SD_TYPE); // e.g. q8_0 to halve memory on small servers
  await run(env.SD_BIN, args, null, 10 * 60_000);
}

// --- code sandbox (bubblewrap) ------------------------------------------

const PYTHON_PRELUDE = `
import os as _os
try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as _plt
    def _save_figures(*args, **kwargs):
        for i, n in enumerate(_plt.get_fignums()):
            _plt.figure(n).savefig(f"/work/figure_{n}.png", dpi=110, bbox_inches="tight")
        _plt.close("all")
    _plt.show = _save_figures
    import atexit
    atexit.register(_save_figures)
except ImportError:
    pass
`;

// runPython runs code with no network, a private /tmp, a 30 s CPU limit and
// 1 GB of memory. Figures drawn with matplotlib come back as PNG data URLs.
export async function runPython(code) {
  return withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, 'main.py'), PYTHON_PRELUDE + '\n' + code);
    await fs.chmod(dir, 0o777);

    const binds = [];
    for (const p of ['/usr', '/lib', '/lib64', '/bin', '/etc/alternatives', path.dirname(path.dirname(env.SANDBOX_PYTHON))]) {
      try {
        await fs.access(p);
        binds.push('--ro-bind', p, p);
      } catch {
        // not present on this system
      }
    }

    const args = [
      '--as=1073741824', '--cpu=30', '--',
      'bwrap', ...binds,
      '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
      '--bind', dir, '/work', '--chdir', '/work',
      '--unshare-all', '--die-with-parent', '--new-session',
      '--setenv', 'HOME', '/work', '--setenv', 'MPLCONFIGDIR', '/tmp',
      env.SANDBOX_PYTHON, '-I', 'main.py',
    ];

    const { stdout, stderr, code: exit } = await run('prlimit', args, null, 40_000, { allowFailure: true });

    const images = [];
    for (const name of (await fs.readdir(dir)).filter((f) => f.endsWith('.png')).sort()) {
      images.push(`data:image/png;base64,${(await fs.readFile(path.join(dir, name))).toString('base64')}`);
    }
    return { stdout: clip(stdout.toString()), stderr: clip(stderr.toString()), exitCode: exit, images };
  });
}

const clip = (s) => (s.length > 20_000 ? s.slice(0, 20_000) + '\n… output trimmed' : s);

// --- helpers ------------------------------------------------------------

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hfee-'));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// run executes a program, feeding input to stdin. It resolves with stdout,
// or with { stdout, stderr, code } when allowFailure is set.
function run(cmd, args, input, timeout = 60_000, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeout);

    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(out);
      const stderr = Buffer.concat(err);
      if (allowFailure) {
        return resolve({ stdout, stderr: killed ? Buffer.concat([stderr, Buffer.from('\nStopped: time limit reached')]) : stderr, code });
      }
      if (code !== 0) return reject(new Error(`${path.basename(cmd)} failed: ${stderr.toString().slice(-500)}`));
      resolve(stdout);
    });

    child.stdin.on('error', () => {}); // the program may exit before reading everything
    child.stdin.end(input ?? undefined);
  });
}
