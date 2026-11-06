const MAX_FILES = 10;
const MAX_SIZE = 20 * 1024 * 1024;
const MAX_TEXT = 100_000; // characters kept per file
const MAX_IMAGE_SIDE = 1568;

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export const ACCEPT = [
  ...IMAGE_TYPES,
  'application/pdf',
  'text/*',
  '.md,.json,.csv,.tsv,.xml,.yaml,.yml,.toml,.ini,.env,.log,.sql',
  '.js,.jsx,.ts,.tsx,.go,.py,.php,.rb,.java,.kt,.c,.h,.cpp,.cs,.rs,.swift,.sh,.ps1,.html,.css,.scss,.vue,.svelte',
].join(',');

export const LIMITS = { MAX_FILES, MAX_SIZE };

// readFile turns a File into an attachment the chat can send:
// { id, name, size, kind: 'image' | 'text', data?, text?, truncated? }
export async function readFile(file) {
  if (file.size > MAX_SIZE) {
    throw new Error(`${file.name} is larger than 20 MB`);
  }

  const base = { id: crypto.randomUUID(), name: file.name, size: file.size };

  if (IMAGE_TYPES.includes(file.type)) {
    return { ...base, kind: 'image', data: await shrinkImage(file) };
  }

  let text;
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    text = await readPdf(file);
  } else {
    text = await file.text();
    if (text.includes('\u0000')) {
      throw new Error(`${file.name} isn't a text, PDF or image file`);
    }
  }

  const truncated = text.length > MAX_TEXT;
  return { ...base, kind: 'text', text: truncated ? text.slice(0, MAX_TEXT) : text, truncated };
}

async function readPdf(file) {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(' '));
  }

  const text = pages.join('\n\n').trim();
  if (!text) throw new Error(`${file.name} has no readable text (scanned PDF?)`);
  return text;
}

// shrinkImage scales large images down so requests stay small. GIFs are kept as-is.
async function shrinkImage(file) {
  const original = await toDataURL(file);
  if (file.type === 'image/gif') return original;

  const img = await loadImage(original);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.width, img.height));
  if (scale === 1 && file.size < 1024 * 1024) return original;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9);
}

function toDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Couldn't read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Unsupported image'));
    img.src = src;
  });
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function fileExtension(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toUpperCase().slice(0, 4) : 'FILE';
}
