import { useRef, useState } from 'react';
import Attachment from './Attachment';
import Markdown from './Markdown';
import Steps from './Steps';
import { CheckIcon, CopyIcon, HFMark, SpeakerIcon, StopIcon } from './icons';

export default function Message({ message: m, features = {}, onPreview }) {
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const audio = useRef(null);
  const waiting = m.role === 'assistant' && m.streaming && !m.content && !m.files?.length;

  async function copy() {
    await navigator.clipboard.writeText(m.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function readAloud() {
    if (speaking) {
      audio.current?.pause();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    try {
      const res = await fetch('/api/voice/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: m.content }),
      });
      if (!res.ok) throw new Error();
      audio.current = new Audio(URL.createObjectURL(await res.blob()));
      audio.current.onended = () => setSpeaking(false);
      await audio.current.play();
    } catch {
      setSpeaking(false);
    }
  }

  return (
    <div className={`message ${m.role} ${m.error ? 'error' : ''}`}>
      {m.role === 'assistant' && <HFMark size={26} />}
      <div className="content">
        {m.steps?.length > 0 && <Steps steps={m.steps} />}

        {m.files?.length > 0 && (
          <div className="message-files">
            {m.files.map((f) => (
              <Attachment key={f.id} file={f} />
            ))}
          </div>
        )}

        {m.content &&
          (m.role === 'assistant' && !m.error ? (
            <Markdown text={m.content} features={features} onPreview={onPreview} />
          ) : (
            <div className="bubble">{m.content}</div>
          ))}

        {m.sources?.length > 0 && (
          <ol className="sources">
            {m.sources.map((s, i) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer noopener" title={s.url}>
                  <span className="num">{i + 1}</span>
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        )}

        {waiting &&
          (m.queue > 0 ? (
            <div className="status">
              Waiting in line: you're <strong>#{m.queue}</strong>. HFee is busy with other people.
            </div>
          ) : (
            !m.steps?.some((s) => s.status === 'running') && <span className="typing"><i /><i /><i /></span>
          ))}

        {m.role === 'assistant' && m.content && !m.error && !m.streaming && (
          <div className="message-actions">
            <button onClick={copy} aria-label="Copy reply" title="Copy">
              {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
            </button>
            {features.voiceOut && (
              <button onClick={readAloud} aria-label={speaking ? 'Stop reading' : 'Read aloud'} title={speaking ? 'Stop' : 'Read aloud'}>
                {speaking ? <StopIcon size={15} /> : <SpeakerIcon size={15} />}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
