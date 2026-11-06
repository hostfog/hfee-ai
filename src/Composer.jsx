import { useRef } from 'react';
import Attachment from './Attachment';
import { ACCEPT } from './files';
import { useRecorder } from './useRecorder';
import { BookIcon, GlobeIcon, ImageIcon, MicIcon, PaperclipIcon, SendIcon, StopIcon } from './icons';

export default function Composer({
  value, onChange, files, onAddFiles, onRemoveFile, onSend, onStop, onError,
  loading, reading, features, search, onSearch, research, onResearch, mode, onMode,
}) {
  const inputRef = useRef(null);
  const imageMode = mode === 'image';
  const canSend = (imageMode ? value.trim() : value.trim() || files.length > 0) && !reading;

  const recorder = useRecorder(
    (text) => onChange(value ? `${value} ${text}` : text),
    onError,
  );

  function submit() {
    if (canSend && !loading) onSend();
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function handlePaste(e) {
    const pasted = [...e.clipboardData.files];
    if (pasted.length && !imageMode) {
      e.preventDefault();
      onAddFiles(pasted);
    }
  }

  return (
    <form
      className={`composer ${imageMode ? 'image-mode' : ''}`}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {files.length > 0 && !imageMode && (
        <div className="composer-files">
          {files.map((f) => (
            <Attachment key={f.id} file={f} onRemove={() => onRemoveFile(f.id)} />
          ))}
        </div>
      )}

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={imageMode ? 'Describe the image you want…' : research ? 'What should HFee research?' : 'Message HFee...'}
        rows={1}
        autoFocus
      />

      <div className="composer-bar">
        {!imageMode && (
          <button type="button" className="icon-btn" onClick={() => inputRef.current.click()} aria-label="Attach files" title="Attach files">
            <PaperclipIcon />
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            onAddFiles([...e.target.files]);
            e.target.value = '';
          }}
        />

        {features.search && !imageMode && (
          <>
            <button type="button" className={`chip ${search ? 'on' : ''}`} onClick={() => onSearch(!search)} aria-pressed={search} title="Always search the web for this message">
              <GlobeIcon size={15} /> Search
            </button>
            <button type="button" className={`chip ${research ? 'on' : ''}`} onClick={() => onResearch(!research)} aria-pressed={research} title="Search many sources and write a cited report">
              <BookIcon size={15} /> Research
            </button>
          </>
        )}
        {features.images && (
          <button type="button" className={`chip ${imageMode ? 'on' : ''}`} onClick={() => onMode(imageMode ? 'chat' : 'image')} aria-pressed={imageMode}>
            <ImageIcon size={15} /> Create image
          </button>
        )}
        {reading && <span className="hint">Reading files…</span>}

        <div className="composer-end">
          {features.voiceIn && (
            <button
              type="button"
              className={`icon-btn ${recorder.state === 'recording' ? 'recording' : ''}`}
              onClick={recorder.state === 'recording' ? recorder.stop : recorder.start}
              disabled={recorder.state === 'working'}
              aria-label={recorder.state === 'recording' ? 'Stop recording' : 'Speak'}
              title={recorder.state === 'recording' ? 'Stop recording' : 'Speak'}
            >
              {recorder.state === 'working' ? <span className="spinner" /> : <MicIcon />}
            </button>
          )}
          {loading ? (
            <button type="button" className="send" onClick={onStop} aria-label="Stop">
              <StopIcon />
            </button>
          ) : (
            <button type="submit" className="send" disabled={!canSend} aria-label="Send">
              <SendIcon />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
