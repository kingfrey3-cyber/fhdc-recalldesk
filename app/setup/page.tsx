'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { parseJsonResponse } from '@/lib/apiClient';
import PasswordField from '@/app/ui/PasswordField';

export default function SetupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '', setupKey: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function update(key: string, value: string) { setForm(prev => ({ ...prev, [key]: value })); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      const res = await fetch('/api/setup/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      await parseJsonResponse(res);
      setMessage('Admin created. Redirecting to login...');
      setTimeout(() => router.push('/login'), 1200);
    } catch (error: any) {
      setError(error.message || 'Setup failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hero" style={{ maxWidth: 620, margin: '40px auto' }}>
      <img src="/fhdc-logo.png" alt="Family Health Dental Clinic" style={{ width: 360, maxWidth: '100%', marginBottom: 18 }} />
      <h1 style={{ color: 'var(--fhdc-blue-dark)', marginTop: 0 }}>Create First Admin</h1>
      <p className="note">This page works only before any system users exist. Default setup key: fhdc-admin-setup-2026. You may change it later in .env.local if needed.</p>
      <form onSubmit={submit} className="form-grid">
        <div className="form-field full"><label>Name</label><input value={form.name} onChange={e => update('name', e.target.value)} required /></div>
        <div className="form-field full"><label>Email</label><input value={form.email} onChange={e => update('email', e.target.value)} type="email" autoComplete="username" required /></div>
        <div className="form-field full"><label>Password</label><PasswordField value={form.password} onChange={value => update('password', value)} required minLength={8} autoComplete="new-password" /></div>
        <div className="form-field full"><label>Admin Setup Key</label><input value={form.setupKey} onChange={e => update('setupKey', e.target.value)} required /></div>
        {error && <div className="form-field full error">{error}</div>}
        {message && <div className="form-field full success">{message}</div>}
        <div className="form-field full"><button disabled={busy}>{busy ? 'Creating...' : 'Create Admin'}</button></div>
      </form>
    </div>
  );
}
