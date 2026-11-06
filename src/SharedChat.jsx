import { useEffect, useState } from 'react';
import { request } from './api';
import Message from './Message';
import { HFMark } from './icons';

// SharedChat is the public, read-only view of a shared chat.
export default function SharedChat({ shareId }) {
  const [chat, setChat] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    request(`/share/${shareId}`).then(setChat).catch((err) => setError(err.message));
  }, [shareId]);

  return (
    <div className="shell">
      <header className="topbar">
        <a className="lockup" href="/">
          <HFMark />
          <span className="product">HFee</span>
          <span className="badge">AI</span>
        </a>
        <span className="crumb">{chat?.title ?? 'Shared chat'}</span>
        <div className="account">
          <a className="primary small" href="/">Try HFee</a>
        </div>
      </header>
      <main className="main">
        <section className="messages">
          {error && <div className="notice">{error}</div>}
          {chat?.messages.map((m, i) => <Message key={i} message={m} />)}
        </section>
      </main>
    </div>
  );
}
