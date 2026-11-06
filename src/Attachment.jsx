import { CloseIcon } from './icons';
import { fileExtension, formatSize } from './files';

// Attachment shows one file, either in the composer (with onRemove) or in a sent message.
export default function Attachment({ file, onRemove }) {
  const src = file.data || file.url;
  if (file.kind === 'image' && src) {
    return (
      <div className="attachment image" title={file.name}>
        <img src={src} alt={file.name} />
        {onRemove && <RemoveButton name={file.name} onClick={onRemove} />}
      </div>
    );
  }

  return (
    <div className="attachment file" title={file.name}>
      <span className="ext">{file.kind === 'image' ? 'IMG' : fileExtension(file.name)}</span>
      <span className="meta">
        <span className="name">{file.name}</span>
        <span className="size">
          {formatSize(file.size)}
          {file.truncated && ' · trimmed'}
        </span>
      </span>
      {onRemove && <RemoveButton name={file.name} onClick={onRemove} />}
    </div>
  );
}

function RemoveButton({ name, onClick }) {
  return (
    <button type="button" className="remove" onClick={onClick} aria-label={`Remove ${name}`}>
      <CloseIcon size={12} />
    </button>
  );
}
