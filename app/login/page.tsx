'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { parseJsonResponse } from '@/lib/apiClient';
import PasswordField from '@/app/ui/PasswordField';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      await parseJsonResponse(res);
      router.push('/dashboard');
    } catch (error: any) {
      setError(error.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hero" style={{ maxWidth: 520, margin: '50px auto' }}>
      <img src="/fhdc-logo.png" alt="Family Health Dental Clinic" style={{ width: 360, maxWidth: '100%', marginBottom: 18 }} />
      <h1 style={{ color: 'var(--fhdc-blue-dark)', marginTop: 0 }}>FHDC RecallDesk</h1>
      <p className="note">Sign in to manage patient recalls, call tracking and recall staff payments.</p>
      <form onSubmit={submit} className="form-grid">
        <div className="form-field full"><label>Email</label><input value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="username" required /></div>
        <div className="form-field full"><label>Password</label><PasswordField value={password} onChange={setPassword} required autoComplete="current-password" /></div>
        {error && <div className="form-field full error">{error}</div>}
        <div className="form-field full"><button disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button></div>
      </form>
      <p className="footer-note">First time? Go to /setup to create the first admin.</p>
    </div>
  );
}
