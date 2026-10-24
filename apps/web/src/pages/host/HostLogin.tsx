import { useState, type CSSProperties, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bezel } from '../../components/Bezel';
import { Button } from '../../components/Button';
import { api, setToken } from '../../lib/api';

export function HostLogin() {
  const nav = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const res = await api<{ token: string }>('/api/auth/host/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
        auth: false,
      });
      setToken('host', res.token);
      nav('/host');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  }

  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <Bezel style={{ width: 'min(420px, 100%)' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', marginTop: 0 }}>Host</h1>
        <form onSubmit={onSubmit} style={{ display: 'grid', gap: 16 }}>
          <label style={{ display: 'grid', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
              autoFocus
            />
          </label>
          {error ? <p style={{ color: 'var(--coral)', margin: 0 }}>{error}</p> : null}
          <Button type="submit" withArrow>
            Enter console
          </Button>
        </form>
      </Bezel>
    </main>
  );
}

const inputStyle: CSSProperties = {
  padding: '0.85rem 1rem',
  borderRadius: 12,
  border: '1px solid var(--hairline)',
  background: 'var(--bg-0)',
};
