// Reading web pages for the model, without letting it reach the server's
// own network: every connection is checked at connect time, so redirects
// and DNS tricks can't point it at localhost or private addresses.

import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT = 12_000;

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3],
]) {
  blocked.addSubnet(addr, prefix, 'ipv4');
}
for (const [addr, prefix] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) {
  blocked.addSubnet(addr, prefix, 'ipv6');
}

function isPublic(address, family) {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return !blocked.check(mapped[1], 'ipv4');
  return !blocked.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

// safeLookup resolves like dns.lookup but refuses non-public addresses.
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const ok = addresses.filter((a) => isPublic(a.address, a.family));
    if (ok.length === 0) return callback(new Error(`${hostname} is not a public address`));
    if (options.all) return callback(null, ok);
    callback(null, ok[0].address, ok[0].family);
  });
}

function get(url) {
  // IP addresses in the URL skip DNS lookup, so check them here
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const family = net.isIP(host);
  if (family && !isPublic(host, family)) {
    return Promise.reject(new Error(`${host} is not a public address`));
  }

  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url, {
      lookup: safeLookup,
      timeout: TIMEOUT,
      headers: { 'User-Agent': 'HFeeBot/1.0 (+reading a page for a user)', Accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' },
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          res.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('close', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('the page took too long to load')));
    req.on('error', reject);
  });
}

// readPage fetches a public web page and returns its title and readable text.
export async function readPage(address, maxChars = 6000) {
  let url = new URL(address);
  for (let i = 0; ; i++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('only http and https pages can be read');
    const res = await get(url);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      if (i >= MAX_REDIRECTS) throw new Error('too many redirects');
      url = new URL(res.headers.location, url);
      continue;
    }
    if (res.status >= 400) throw new Error(`the page returned ${res.status}`);

    const type = String(res.headers['content-type'] || '');
    const raw = res.body.toString('utf8');
    const page = type.includes('html') ? htmlToText(raw) : { title: '', text: raw };
    return { url: url.href, title: page.title, text: page.text.slice(0, maxChars) };
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

function decode(s) {
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// htmlToText keeps the main content of a page as plain text.
export function htmlToText(html) {
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim());

  let body = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|iframe|template|head)[\s\S]*?<\/\1>/gi, '');
  const main = body.match(/<(article|main)[^>]*>([\s\S]*?)<\/\1>/i);
  if (main && main[2].length > 500) body = main[2];
  body = body.replace(/<(nav|footer|header|aside|form)[\s\S]*?<\/\1>/gi, '');

  const text = decode(
    body
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)[^>]*>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n\n')
    .trim();

  return { title, text };
}
