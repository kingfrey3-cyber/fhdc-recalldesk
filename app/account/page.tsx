'use client';

import { useEffect, useState } from 'react';
import { parseJsonResponse } from '@/lib/apiClient';
import PasswordField from '@/app/ui/PasswordField';

function roleLabel(role?: string) {
  return String(role || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function AccountPage() {
  const [me, setMe] = useState<any>(null);
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadMe() {
    setError('');
    try {
      const data = await fetch('/api/me').then(parseJsonResponse);
      setMe(data.user);
    } catch (error: any) {
      setError(error.message || 'Please log in again');
    }
  }

  useEffect(() => { loadMe(); }, []);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMessage(''); setError('');
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      await parseJsonResponse(res);
      setMessage('Password changed successfully. Use the new password the next time you log in.');
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (error: any) {
      setError(error.message || 'Failed to change password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="hero">
        <h1 style={{ marginTop: 0, color: 'var(--fhdc-blue-dark)' }}>My Account</h1>
        <p className="note">Manage your own RecallDesk password. Admins can edit users and reset staff passwords from Settings.</p>
        {me && <p className="note"><strong>Signed in as:</strong> {me.name} — {me.email} ({roleLabel(me.role)})</p>}
      </div>

      {error && <div className="alert error" style={{ marginTop: 18 }}>{error}</div>}
      {message && <div className="alert success" style={{ marginTop: 18 }}>{message}</div>}

      <div className="grid" style={{ marginTop: 18 }}>
        <div className="card half">
          <h3>Change Password</h3>
          <form onSubmit={changePassword} className="form-grid">
            <div className="form-field full"><label>Current password</label><PasswordField value={form.currentPassword} onChange={value => setForm({ ...form, currentPassword: value })} required autoComplete="current-password" /></div>
            <div className="form-field full"><label>New password</label><PasswordField value={form.newPassword} onChange={value => setForm({ ...form, newPassword: value })} required minLength={8} autoComplete="new-password" /></div>
            <div className="form-field full"><label>Confirm new password</label><PasswordField value={form.confirmPassword} onChange={value => setForm({ ...form, confirmPassword: value })} required minLength={8} autoComplete="new-password" /></div>
            <div className="form-field full"><button disabled={busy}>{busy ? 'Changing...' : 'Change Password'}</button></div>
          </form>
        </div>
        <div className="card half">
          <h3>Password Guidance</h3>
          <p className="note">Use at least 8 characters. Temporary passwords should be changed by the staff member after first login.</p>
          <p className="note">If a staff member forgets their password, an Admin can reset it from Settings without needing to know the old password.</p>
        </div>
      </div>
    </>
  );
}
