import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { request } from './api';
import { CheckIcon, CopyIcon, DownloadIcon, EyeIcon, PlayIcon } from './icons';

const PREVIEWABLE = ['html', 'svg', 'xml'];
const EXTENSIONS = { python: 'py', javascript: 'js', typescript: 'ts', html: 'html', css: 'css', json: 'json', go: 'go', bash: 'sh', shell: 'sh', sql: 'sql', svg: 'svg', markdown: 'md', yaml: 'yml' };

// Markdown renders a reply. Code blocks get copy and download buttons, plus
// Run (Python) and Preview (HTML/SVG) when those features are on.
export default function Markdown({ text, features = {}, onPreview }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code({ className, children, node }) {
            const source = plainText(node);
            const inline = !className && !source.includes('\n');
            if (inline) return <code className="inline">{children}</code>;
            const lang = (className || '').match(/language-(\w+)/)?.[1] || 'text';
            return (
              <CodeBlock lang={lang} source={source} features={features} onPreview={onPreview}>
                {children}
              </CodeBlock>
            );
          },
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function plainText(node) {
  if (!node) return '';
  if (node.type === 'text') return node.value;
  return (node.children || []).map(plainText).join('');
}

function CodeBlock({ lang, source, features, onPreview, children }) {
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);

  const canRun = features.code && (lang === 'python' || lang === 'py');
  const canPreview = onPreview && PREVIEWABLE.includes(lang);

  async function copy() {
    await navigator.clipboard.writeText(source);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function download() {
    const blob = new Blob([source], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `code.${EXTENSIONS[lang] || 'txt'}`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function run() {
    setRunning(true);
    try {
      setResult(await request('/run', { method: 'POST', body: { code: source } }));
    } catch (err) {
      setResult({ stderr: err.message, images: [] });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="code-block">
      <div className="code-head">
        <span>{lang}</span>
        <div className="code-actions">
          {canPreview && (
            <button onClick={() => onPreview({ lang, source })}>
              <EyeIcon size={14} /> Preview
            </button>
          )}
          {canRun && (
            <button onClick={run} disabled={running}>
              <PlayIcon size={14} /> {running ? 'Running…' : 'Run'}
            </button>
          )}
          <button onClick={download} aria-label="Download">
            <DownloadIcon size={14} />
          </button>
          <button onClick={copy} aria-label="Copy">
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          </button>
        </div>
      </div>
      <pre>
        <code className={`hljs language-${lang}`}>{children}</code>
      </pre>
      {result && (
        <div className="run-output">
          {result.stdout && <pre>{result.stdout}</pre>}
          {result.stderr && <pre className="stderr">{result.stderr}</pre>}
          {result.images?.map((src, i) => (
            <img key={i} src={src} alt={`Figure ${i + 1}`} />
          ))}
          {!result.stdout && !result.stderr && !result.images?.length && <span className="muted">No output</span>}
        </div>
      )}
    </div>
  );
}
