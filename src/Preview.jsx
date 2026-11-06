import { useState } from 'react';
import { CloseIcon, DownloadIcon } from './icons';

// Preview shows HTML or SVG from a reply in a sandboxed frame. Scripts run,
// but the page can't reach the site, its cookies or the parent window.
export default function Preview({ item, onClose }) {
  const [tab, setTab] = useState('preview');
  const doc = item.lang === 'svg' || item.lang === 'xml'
    ? `<!doctype html><body style="margin:0;display:grid;place-items:center;min-height:100vh">${item.source}</body>`
    : item.source;

  function download() {
    const ext = item.lang === 'html' ? 'html' : 'svg';
    const blob = new Blob([item.source], { type: ext === 'html' ? 'text/html' : 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `hfee-preview.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <aside className="preview">
      <div className="preview-head">
        <div className="tabs">
          <button className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}>Preview</button>
          <button className={tab === 'code' ? 'active' : ''} onClick={() => setTab('code')}>Code</button>
        </div>
        <button className="icon-btn" onClick={download} aria-label="Download">
          <DownloadIcon />
        </button>
        <button className="icon-btn" onClick={onClose} aria-label="Close preview">
          <CloseIcon />
        </button>
      </div>
      {tab === 'preview' ? (
        <iframe title="Preview" sandbox="allow-scripts allow-modals allow-forms" srcDoc={doc} />
      ) : (
        <pre className="preview-code">{item.source}</pre>
      )}
    </aside>
  );
}
