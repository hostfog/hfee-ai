import { useEffect, useState } from 'react';
import { request } from './api';
import { TrashIcon } from './icons';

const TABS = ['Overview', 'Users', 'Plans', 'Site'];

export default function Admin() {
  const [tab, setTab] = useState('Overview');
  return (
    <main className="page">
      <div className="page-head">
        <h1>Admin</h1>
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
      </div>
      {tab === 'Overview' && <Overview />}
      {tab === 'Users' && <Users />}
      {tab === 'Plans' && <Plans />}
      {tab === 'Site' && <Site />}
    </main>
  );
}

function Overview() {
  const [data, setData] = useState(null);
  useEffect(() => {
    request('/admin/overview').then(setData);
  }, []);
  if (!data) return null;

  const peak = Math.max(1, ...data.daily.map((d) => d.messages));
  return (
    <>
      <div className="stats">
        <Stat label="Users" value={data.users} />
        <Stat label="Active today" value={data.activeToday} />
        <Stat label="Messages today" value={data.messagesToday} />
        <Stat label="Images today" value={data.imagesToday} />
      </div>
      <div className="card-panel">
        <h3>Messages, last 7 days</h3>
        <div className="bars">
          {data.daily.map((d) => (
            <div key={d.day} className="bar" title={`${d.day}: ${d.messages}`}>
              <span style={{ height: `${(d.messages / peak) * 100}%` }} />
              <small>{d.day.slice(5)}</small>
            </div>
          ))}
          {data.daily.length === 0 && <p className="muted">No messages yet.</p>}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Users() {
  const [users, setUsers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  const load = () => request(`/admin/users?q=${encodeURIComponent(q)}`).then(({ users }) => setUsers(users));
  useEffect(() => {
    request('/admin/plans').then(({ plans }) => setPlans(plans));
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [q]);

  async function update(id, body) {
    setError('');
    try {
      await request(`/admin/users/${id}`, { method: 'PATCH', body });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(u) {
    if (!confirm(`Delete ${u.email} and all their chats?`)) return;
    try {
      await request(`/admin/users/${u.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card-panel">
      <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" />
      {error && <div className="notice">{error}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Plan</th>
              <th>Role</th>
              <th>Messages</th>
              <th>Joined</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.disabled ? 'disabled' : ''}>
                <td>
                  <strong>{u.name}</strong>
                  <div className="muted">{u.email}</div>
                </td>
                <td>
                  <select value={u.planId ?? ''} onChange={(e) => update(u.id, { planId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">Default</option>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select value={u.role} onChange={(e) => update(u.id, { role: e.target.value })}>
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td>{u.messages}</td>
                <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                <td className="actions">
                  <button className="ghost" onClick={() => update(u.id, { disabled: !u.disabled })}>
                    {u.disabled ? 'Enable' : 'Disable'}
                  </button>
                  <button className="ghost danger" onClick={() => remove(u)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const EMPTY_PLAN = { name: '', dailyMessages: 100, dailyImages: 5, price: '' };

function Plans() {
  const [plans, setPlans] = useState([]);
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState('');

  const load = () => request('/admin/plans').then(({ plans }) => setPlans(plans));
  useEffect(() => {
    load();
  }, []);

  async function save(e) {
    e.preventDefault();
    setError('');
    try {
      await request(edit.id ? `/admin/plans/${edit.id}` : '/admin/plans', { method: edit.id ? 'PUT' : 'POST', body: edit });
      setEdit(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(p) {
    if (!confirm(`Delete the ${p.name} plan? Its users move to the default plan.`)) return;
    try {
      await request(`/admin/plans/${p.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const field = (key) => ({ value: edit[key], onChange: (e) => setEdit({ ...edit, [key]: e.target.value }) });

  return (
    <div className="card-panel">
      <p className="muted">Plans set daily limits. The first plan is the default for new users. Assign plans in Users.</p>
      {error && <div className="notice">{error}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Plan</th>
              <th>Messages / day</th>
              <th>Images / day</th>
              <th>Price</th>
              <th>Users</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {plans.map((p, i) => (
              <tr key={p.id}>
                <td>
                  <strong>{p.name}</strong> {i === 0 && <span className="badge">Default</span>}
                </td>
                <td>{p.dailyMessages}</td>
                <td>{p.dailyImages}</td>
                <td>{p.price || '—'}</td>
                <td>{p.users}</td>
                <td className="actions">
                  <button className="ghost" onClick={() => setEdit(p)}>Edit</button>
                  {i > 0 && <button className="ghost danger" onClick={() => remove(p)}>Delete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit ? (
        <form className="plan-form" onSubmit={save}>
          <label>Name<input required {...field('name')} /></label>
          <label>Messages / day<input type="number" min="0" required {...field('dailyMessages')} /></label>
          <label>Images / day<input type="number" min="0" required {...field('dailyImages')} /></label>
          <label>Price<input placeholder="e.g. £5 / month" {...field('price')} /></label>
          <div className="row">
            <button className="primary small">Save</button>
            <button type="button" className="ghost" onClick={() => setEdit(null)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="primary small" onClick={() => setEdit(EMPTY_PLAN)}>Add plan</button>
      )}
    </div>
  );
}

function Site() {
  const [s, setS] = useState(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    request('/admin/settings').then(setS);
  }, []);
  if (!s) return null;

  const enabled = s.enabledModels ?? s.models;

  async function save() {
    await request('/admin/settings', {
      method: 'PUT',
      body: { signup: s.signup, defaultModel: s.defaultModel, enabledModels: enabled, systemPrompt: s.systemPrompt },
    });
    setStatus('Saved');
  }

  function toggleModel(m) {
    const next = enabled.includes(m) ? enabled.filter((x) => x !== m) : [...enabled, m];
    setS({ ...s, enabledModels: next });
    setStatus('');
  }

  return (
    <div className="card-panel site-settings">
      <label className="check">
        <input type="checkbox" checked={s.signup} onChange={(e) => setS({ ...s, signup: e.target.checked })} />
        Allow new sign-ups
      </label>

      <Models models={s.models} onChange={(models) => setS({ ...s, models })} />

      <div className="field">
        Models users can pick
        {s.models.map((m) => (
          <label key={m} className="check">
            <input type="checkbox" checked={enabled.includes(m)} onChange={() => toggleModel(m)} />
            {m}
          </label>
        ))}
      </div>

      <label className="field">
        Default model
        <select value={s.defaultModel} onChange={(e) => setS({ ...s, defaultModel: e.target.value })}>
          {enabled.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </label>

      <label className="field">
        System prompt
        <textarea rows={4} value={s.systemPrompt} onChange={(e) => setS({ ...s, systemPrompt: e.target.value })} />
      </label>

      <div className="row">
        <button className="primary small" onClick={save}>Save</button>
        {status && <span className="hint">{status}</span>}
      </div>
    </div>
  );
}

// Models downloads and removes models on the model server, with live progress.
export function Models({ models, onChange, suggest = '' }) {
  const [name, setName] = useState(suggest);
  const [progress, setProgress] = useState(null); // { status, percent }
  const [error, setError] = useState('');

  async function pull(e) {
    e.preventDefault();
    if (!name.trim() || progress) return;
    setError('');
    setProgress({ status: 'Starting…', percent: 0 });
    try {
      const res = await fetch('/api/admin/models/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: name.trim() }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Download failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines.filter(Boolean)) {
          const p = JSON.parse(line);
          if (p.error) throw new Error(p.error);
          setProgress({ status: p.status, percent: p.total ? Math.round((p.completed / p.total) * 100) : null });
        }
      }
      const { models: list } = await request('/admin/settings');
      onChange(list);
      setName('');
    } catch (err) {
      setError(err.message);
    } finally {
      setProgress(null);
    }
  }

  async function remove(m) {
    if (!confirm(`Delete ${m} from the server?`)) return;
    try {
      await request(`/admin/models/${encodeURIComponent(m)}`, { method: 'DELETE' });
      onChange(models.filter((x) => x !== m));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="field">
      {models.length > 0 && (
        <>
          Installed models
          <ul className="memories">
            {models.map((m) => (
              <li key={m}>
                <span>{m}</span>
                <button onClick={() => remove(m)} aria-label={`Delete ${m}`}>
                  <TrashIcon size={14} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <form className="row" onSubmit={pull}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. qwen2.5:7b or hf.co/user/repo:Q4_K_M" />
        <button className="primary small" disabled={Boolean(progress)}>Download</button>
      </form>
      {progress && (
        <div className="progress">
          <span style={{ width: `${progress.percent ?? 0}%` }} />
          <small>{progress.status}{progress.percent != null ? ` · ${progress.percent}%` : ''}</small>
        </div>
      )}
      {error && <div className="notice">{error}</div>}
    </div>
  );
}
