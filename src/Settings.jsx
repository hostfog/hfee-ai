import { useEffect, useState } from 'react';
import { request } from './api';
import { CloseIcon, TrashIcon } from './icons';

// Settings holds what HFee knows about the user: custom instructions and memories.
export default function Settings({ onClose }) {
  const [instructions, setInstructions] = useState('');
  const [memories, setMemories] = useState([]);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    request('/account/settings').then((s) => {
      setInstructions(s.instructions);
      setMemories(s.memories);
    });
  }, []);

  async function saveInstructions() {
    await request('/account/instructions', { method: 'PUT', body: { instructions } });
    setStatus('Saved');
  }

  async function addMemory(e) {
    e.preventDefault();
    if (!draft.trim()) return;
    const m = await request('/account/memories', { method: 'POST', body: { content: draft } });
    setMemories((list) => [...list, m]);
    setDraft('');
  }

  async function removeMemory(id) {
    await request(`/account/memories/${id}`, { method: 'DELETE' });
    setMemories((list) => list.filter((m) => m.id !== id));
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <div className="modal-head">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <label className="field">
          How should HFee respond?
          <textarea
            value={instructions}
            onChange={(e) => {
              setInstructions(e.target.value);
              setStatus('');
            }}
            placeholder="e.g. Use British English. Keep answers short. I'm a full-stack developer."
            rows={4}
          />
          <div className="row">
            <button className="primary small" onClick={saveInstructions}>Save</button>
            {status && <span className="hint">{status}</span>}
          </div>
        </label>

        <div className="field">
          Memory
          <span className="hint">HFee uses these in every chat. Say “remember that …” in a chat to add one.</span>
          <ul className="memories">
            {memories.map((m) => (
              <li key={m.id}>
                <span>{m.content}</span>
                <button onClick={() => removeMemory(m.id)} aria-label="Forget this">
                  <TrashIcon size={14} />
                </button>
              </li>
            ))}
            {memories.length === 0 && <li className="muted">Nothing saved yet.</li>}
          </ul>
          <form className="row" onSubmit={addMemory}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add something to remember" />
            <button className="primary small">Add</button>
          </form>
        </div>
      </div>
    </div>
  );
}
