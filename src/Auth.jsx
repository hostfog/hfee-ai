import { useEffect, useState } from 'react';
import { request } from './api';
import { HFMark } from './icons';

export default function Auth({ onSignedIn }) {
  const [mode, setMode] = useState('login');
  const [signup, setSignup] = useState(true);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    request('/auth/config').then((c) => setSignup(c.signup)).catch(() => {});
  }, []);

  const creating = mode === 'signup';
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { user } = await request(`/auth/${mode}`, { method: 'POST', body: form });
      onSignedIn(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <div className="lockup">
          <HFMark size={32} />
          <span className="product">HFee</span>
          <span className="badge">AI</span>
        </div>

        <div>
          <h1>{creating ? 'Create your account' : 'Welcome back'}</h1>
          <p className="muted">{creating ? 'Start chatting with HFee in a few seconds.' : 'Sign in to continue to your chats.'}</p>
        </div>

        {creating && (
          <label>
            Name
            <input value={form.name} onChange={set('name')} autoComplete="name" required autoFocus />
          </label>
        )}
        <label>
          Email
          <input type="email" value={form.email} onChange={set('email')} autoComplete="email" required autoFocus={!creating} />
        </label>
        <label>
          Password
          <input
            type="password"
            value={form.password}
            onChange={set('password')}
            autoComplete={creating ? 'new-password' : 'current-password'}
            minLength={creating ? 8 : undefined}
            required
          />
        </label>

        {error && <div className="notice" role="alert">{error}</div>}

        <button className="primary" disabled={busy}>
          {busy ? 'Please wait…' : creating ? 'Create account' : 'Sign in'}
        </button>

        {signup && (
          <p className="switch">
            {creating ? 'Already have an account?' : 'New to HFee?'}{' '}
            <button
              type="button"
              className="link"
              onClick={() => {
                setMode(creating ? 'login' : 'signup');
                setError('');
              }}
            >
              {creating ? 'Sign in' : 'Create an account'}
            </button>
          </p>
        )}
      </form>
    </div>
  );
}
