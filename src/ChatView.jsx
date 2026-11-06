import { useEffect, useRef, useState } from 'react';
import { request, sendMessage } from './api';
import { readFile, LIMITS } from './files';
import { navigate } from './router';
import Composer from './Composer';
import Message from './Message';
import Preview from './Preview';
import { HFMark, ShareIcon, UploadIcon } from './icons';
import { Models } from './Admin';

const SUGGESTIONS = [
  { title: 'Explain a concept', prompt: 'Explain how Raft consensus works' },
  { title: 'Write code', prompt: 'Write a Go HTTP server with graceful shutdown' },
  { title: 'Build a page', prompt: 'Make a simple landing page for a coffee shop in one HTML file' },
  { title: 'Brainstorm', prompt: 'Give me 5 name ideas for a hosting company' },
];

export default function ChatView({ chatId, project, user, config, onChatsChanged, onSignOut }) {
  const [messages, setMessages] = useState([]);
  const [chat, setChat] = useState(null);
  const [model, setModel] = useState(config.defaultModel);
  const [input, setInput] = useState('');
  const [files, setFiles] = useState([]);
  const [reading, setReading] = useState(0);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState(false);
  const [researchMode, setResearch] = useState(false);
  const [mode, setMode] = useState('chat');
  const [preview, setPreview] = useState(null);
  const [dragging, setDragging] = useState(false);
  const abortRef = useRef(null);
  const bottomRef = useRef(null);
  const dragDepth = useRef(0);
  const ownId = useRef(null); // a chat this view just created; no need to reload it

  useEffect(() => {
    if (chatId && chatId === ownId.current) return;
    ownId.current = null;
    abortRef.current?.abort();
    setPreview(null);
    if (!chatId) {
      setChat(null);
      setMessages([]);
      return;
    }
    request(`/chats/${chatId}`)
      .then((c) => {
        setChat(c);
        setMessages(c.messages);
        if (c.model && config.models.includes(c.model)) setModel(c.model);
      })
      .catch((err) => setNotice(err.message));
  }, [chatId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  async function addFiles(list) {
    const room = LIMITS.MAX_FILES - files.length;
    if (list.length > room) setNotice(`You can attach up to ${LIMITS.MAX_FILES} files`);

    const accepted = list.slice(0, Math.max(room, 0));
    setReading((n) => n + accepted.length);
    await Promise.all(
      accepted.map(async (file) => {
        try {
          const att = await readFile(file);
          if (att.kind === 'image' && !config.features.vision) {
            setNotice(`${file.name}: this server can't read images yet`);
          }
          setFiles((prev) => [...prev, att]);
        } catch (err) {
          setNotice(err.message);
        } finally {
          setReading((n) => n - 1);
        }
      }),
    );
  }

  async function send(text = input) {
    const content = text.trim();
    if ((!content && files.length === 0) || loading) return;

    const sentFiles = mode === 'image' ? [] : files;
    setMessages((prev) => [
      ...prev,
      { role: 'user', content, ...(sentFiles.length && { files: sentFiles }) },
      { role: 'assistant', content: '', streaming: true },
    ]);
    setInput('');
    setFiles([]);
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;
    const updateReply = (fn) => setMessages((prev) => [...prev.slice(0, -1), fn(prev[prev.length - 1])]);

    try {
      await sendMessage(
        { chatId: chat?.id, projectId: project?.id, content, files: sentFiles, model, search, research: researchMode, mode },
        (event) => {
          if (event.chat && !chat) {
            ownId.current = event.chat.id;
            setChat(event.chat);
            onChatsChanged();
            // inside a project the chat continues on the project page
            if (!project) navigate(`/c/${event.chat.id}`);
          }
          if (event.queue !== undefined) updateReply((m) => ({ ...m, queue: event.queue }));
          if (event.step) updateReply((m) => ({ ...m, steps: upsert(m.steps, event.step) }));
          if (event.sources) updateReply((m) => ({ ...m, sources: event.sources }));
          if (event.files) updateReply((m) => ({ ...m, files: event.files }));
          if (event.token) updateReply((m) => ({ ...m, content: m.content + event.token }));
          if (event.error) updateReply((m) => ({ ...m, content: m.content || event.error, error: !m.content }));
        },
        controller.signal,
      );
    } catch (err) {
      if (err.status === 401) return onSignOut();
      if (err.name !== 'AbortError') {
        updateReply((m) => ({ ...m, content: m.content || err.message, error: true }));
      }
    } finally {
      updateReply((m) => ({ ...m, streaming: false }));
      setLoading(false);
      abortRef.current = null;
    }
  }

  async function share() {
    try {
      const { shareId } = await request(`/chats/${chat.id}/share`, { method: 'POST' });
      const link = `${window.location.origin}/share/${shareId}`;
      await navigator.clipboard.writeText(link);
      setNotice('Share link copied. Anyone with the link can read this chat.');
    } catch (err) {
      setNotice(err.message);
    }
  }

  const dropHandlers = {
    onDragEnter(e) {
      if (!e.dataTransfer.types.includes('Files')) return;
      dragDepth.current++;
      setDragging(true);
    },
    onDragOver(e) {
      if (e.dataTransfer.types.includes('Files')) e.preventDefault();
    },
    onDragLeave() {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    },
    onDrop(e) {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      addFiles([...e.dataTransfer.files]);
    },
  };

  return (
    <div className="chat-layout">
      <main className="main" {...dropHandlers}>
        <div className="chat-bar">
          {config.models.length > 1 ? (
            <select className="model-picker" value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model">
              {config.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            config.models.length === 1 && <span className="model-name">{model}</span>
          )}
          {project && <span className="badge">Project: {project.name}</span>}
          {chat && (
            <button className="ghost" onClick={share}>
              <ShareIcon size={15} /> Share
            </button>
          )}
        </div>

        <section className="messages">
          {config.models.length === 0 ? (
            <div className="empty">
              <div className="heading">
                <HFMark size={44} />
                <div>
                  <h1>Download a model to start</h1>
                  <p>
                    {user.role === 'admin'
                      ? 'qwen2.5:3b is a good first choice: about 2 GB and quick on most computers.'
                      : 'No models are installed yet. Ask the site admin to add one.'}
                  </p>
                </div>
              </div>
              {user.role === 'admin' && <Models models={[]} suggest="qwen2.5:3b" onChange={() => window.location.reload()} />}
            </div>
          ) : messages.length === 0 ? (
            <div className="empty">
              <div className="heading">
                <HFMark size={44} />
                <div>
                  <h1>{project ? project.name : `How can I help, ${user.name.split(' ')[0]}?`}</h1>
                  <p>{project ? 'New chat in this project. Its files and instructions are included.' : 'Ask anything, or attach files, PDFs and images to talk about them.'}</p>
                </div>
              </div>
              <div className="suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s.prompt} className="card" onClick={() => send(s.prompt)}>
                    <strong>{s.title}</strong>
                    <span>{s.prompt}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => <Message key={i} message={m} features={config.features} onPreview={setPreview} />)
          )}
          <div ref={bottomRef} />
        </section>

        <div className="composer-wrap">
          {notice && (
            <div className="notice" role="alert">
              {notice}
            </div>
          )}
          <Composer
            value={input}
            onChange={setInput}
            files={files}
            onAddFiles={addFiles}
            onRemoveFile={(id) => setFiles((prev) => prev.filter((f) => f.id !== id))}
            onSend={() => send()}
            onStop={() => abortRef.current?.abort()}
            onError={setNotice}
            loading={loading}
            reading={reading > 0}
            features={config.features}
            search={search}
            onSearch={setSearch}
            research={researchMode}
            onResearch={setResearch}
            mode={mode}
            onMode={setMode}
          />
          <p className="footnote">HFee can make mistakes. Check important info.</p>
        </div>

        {dragging && (
          <div className="drop-overlay">
            <UploadIcon size={28} />
            <strong>Drop files here</strong>
            <span>Text, code, PDF and images up to 20 MB</span>
          </div>
        )}
      </main>

      {preview && <Preview item={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function upsert(list = [], item) {
  const i = list.findIndex((x) => x.id === item.id);
  return i < 0 ? [...list, item] : list.map((x, j) => (j === i ? item : x));
}
