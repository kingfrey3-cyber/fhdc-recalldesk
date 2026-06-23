"use client";

import { useEffect, useMemo, useState } from 'react';
import { parseJsonResponse } from '@/lib/apiClient';
import PasswordField from '@/app/ui/PasswordField';

function roleLabel(role?: string) {
  return String(role || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const blankCreate = { name: '', email: '', role: 'recall_staff', password: 'ChangeMe123!' };

export default function SettingsPage() {
  const [me, setMe] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [form, setForm] = useState(blankCreate);
  const [cleanup, setCleanup] = useState({ staffId: '', confirmText: '' });
  const [editUser, setEditUser] = useState<any>(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', role: 'recall_staff', is_active: true });
  const [resetUser, setResetUser] = useState<any>(null);
  const [resetPassword, setResetPassword] = useState('ChangeMe123!');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const canAdmin = useMemo(() => me?.role === 'admin', [me]);
  const canManage = useMemo(() => ['admin','manager'].includes(me?.role), [me]);

  async function load() {
    setError('');
    setLoading(true);
    try {
      const [meData, usersData] = await Promise.all([
        fetch('/api/me', { cache: 'no-store' }).then(parseJsonResponse),
        fetch('/api/users', { cache: 'no-store' }).then(parseJsonResponse)
      ]);
      setMe(meData.user);
      setUsers(usersData.users || []);
    } catch (error: any) {
      setError(error.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function createUser(e: React.FormEvent) {
    e.preventDefault(); setMessage(''); setError('');
    try {
      const res = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      await parseJsonResponse(res);
      setMessage('User created. Give the staff member the temporary password and ask them to change it under Account after first login.');
      setForm(blankCreate);
      load();
    } catch (error: any) {
      setError(error.message || 'Failed to create user');
    }
  }

  function openEdit(user: any) {
    setMessage(''); setError(''); setResetUser(null);
    setEditUser(user);
    setEditForm({ name: user.name || '', email: user.email || '', role: user.role || 'recall_staff', is_active: Boolean(user.is_active) });
    setTimeout(() => document.getElementById('edit-user-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault(); setMessage(''); setError('');
    if (!editUser) return;
    try {
      const res = await fetch(`/api/users/${editUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm)
      });
      const data = await parseJsonResponse(res);
      setMessage(`Updated ${data.user.name}. If the email changed, they should log in using the corrected email address.`);
      setEditUser(null);
      load();
    } catch (error: any) {
      setError(error.message || 'Failed to update user');
    }
  }

  function openReset(user: any) {
    setMessage(''); setError(''); setEditUser(null);
    setResetUser(user);
    setResetPassword('ChangeMe123!');
    setTimeout(() => document.getElementById('reset-password-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  async function resetStaffPassword(e: React.FormEvent) {
    e.preventDefault(); setMessage(''); setError('');
    if (!resetUser) return;
    if (resetPassword.length < 8) { setError('Temporary password must be at least 8 characters.'); return; }
    if (!confirm(`Reset password for ${resetUser.name}? They will need to use the new temporary password to log in.`)) return;
    try {
      const res = await fetch(`/api/users/${resetUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: resetPassword })
      });
      await parseJsonResponse(res);
      setMessage(`Password reset for ${resetUser.name}. Give them the temporary password and ask them to change it under Account.`);
      setResetUser(null);
      setResetPassword('ChangeMe123!');
      load();
    } catch (error: any) {
      setError(error.message || 'Failed to reset password');
    }
  }

  async function clearStaffCalls(e: React.FormEvent) {
    e.preventDefault(); setMessage(''); setError('');
    if (!cleanup.staffId) { setError('Select the staff member first.'); return; }
    if (cleanup.confirmText.toUpperCase() !== 'CLEAR') { setError('Type CLEAR to confirm.'); return; }
    const staff = users.find(u => u.id === cleanup.staffId);
    if (!confirm(`Clear all logged calls and self-reported bookings for ${staff?.name || 'this staff member'}? Assignments will remain, and affected patients will become callable again.`)) return;
    try {
      const res = await fetch('/api/calls/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cleanup) });
      const data = await parseJsonResponse(res);
      setMessage(`Cleared ${data.removedCalls} call logs, ${data.removedBookings} bookings and reset ${data.affectedPatients} affected patient records for ${data.staff?.name}.`);
      setCleanup({ staffId: '', confirmText: '' });
      load();
    } catch (error: any) {
      setError(error.message || 'Failed to clear staff call logs');
    }
  }

  return (
    <>
      <div className="hero">
        <h1 style={{ marginTop: 0, color: 'var(--fhdc-blue-dark)' }}>Settings and Users</h1>
        <p className="note">Create, edit and manage user logins so assignments, call logs, verifications, assumptions and payment calculations remain traceable.</p>
        {me && <p className="note"><strong>Signed in as:</strong> {me.name} ({roleLabel(me.role)})</p>}
      </div>

      {error && <div className="alert error" style={{ marginTop: 18 }}>{error}</div>}
      {message && <div className="alert success" style={{ marginTop: 18 }}>{message}</div>}

      {loading && <div className="card" style={{ marginTop: 18 }}><p className="note">Loading user settings...</p></div>}

      {!loading && !me && <div className="card" style={{ marginTop: 18 }}><h3>Not logged in</h3><p className="note">Please log in again before managing users.</p></div>}

      {me && !canManage && <div className="card" style={{ marginTop: 18 }}><h3>Limited access</h3><p className="note">This page is for Admin and Manager accounts. Recall Staff should use the Calling List and Account pages only.</p></div>}

      {me && canManage && <div className="grid" style={{ marginTop: 18 }}>
        {canAdmin && <div className="card half">
          <h3>Create User</h3>
          <form onSubmit={createUser} className="form-grid">
            <div className="form-field"><label>Name</label><input value={form.name} onChange={e => setForm({...form, name:e.target.value})} required /></div>
            <div className="form-field"><label>Email</label><input value={form.email} onChange={e => setForm({...form, email:e.target.value})} type="email" required /></div>
            <div className="form-field"><label>Role</label><select value={form.role} onChange={e => setForm({...form, role:e.target.value})}><option value="admin">Admin</option><option value="manager">Manager</option><option value="recall_staff">Recall Staff</option><option value="verifier">Verifier</option><option value="finance">Finance</option><option value="viewer">Viewer</option></select></div>
            <div className="form-field"><label>Temporary password</label><PasswordField value={form.password} onChange={value => setForm({...form, password:value})} minLength={8} autoComplete="new-password" /></div>
            <div className="form-field full"><button>Create User</button></div>
          </form>
        </div>}

        <div className="card full users-card">
          <h3>Current Users</h3>
          {users.length === 0 && <p className="note">No users loaded yet.</p>}
          <div className="user-card-list">
            {users.map(u => (
              <div key={u.id} className="user-row-card">
                <div className="user-main">
                  <strong>{u.name}</strong>
                  <span>{u.email}</span>
                </div>
                <div className="user-badges">
                  <span className="badge">{roleLabel(u.role)}</span>
                  {u.is_active ? <span className="badge green">Active</span> : <span className="badge red">Inactive</span>}
                </div>
                {canAdmin && <div className="user-actions">
                  <button type="button" className="secondary small" onClick={() => openEdit(u)}>Edit</button>
                  <button type="button" className="ghost small" onClick={() => openReset(u)}>Reset Password</button>
                </div>}
              </div>
            ))}
          </div>
        </div>

        {canAdmin && editUser && <div id="edit-user-panel" className="card full">
          <h3>Edit User: {editUser.name}</h3>
          <form onSubmit={saveEdit} className="form-grid">
            <div className="form-field"><label>Name</label><input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} required /></div>
            <div className="form-field"><label>Email</label><input type="email" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} required /></div>
            <div className="form-field"><label>Role</label><select value={editForm.role} onChange={e => setEditForm({ ...editForm, role: e.target.value })}><option value="admin">Admin</option><option value="manager">Manager</option><option value="recall_staff">Recall Staff</option><option value="verifier">Verifier</option><option value="finance">Finance</option><option value="viewer">Viewer</option></select></div>
            <div className="form-field"><label>Active</label><select value={String(editForm.is_active)} onChange={e => setEditForm({ ...editForm, is_active: e.target.value === 'true' })}><option value="true">Active</option><option value="false">Deactivated</option></select></div>
            <div className="form-field full button-row"><button type="submit">Save Changes</button><button type="button" className="secondary" onClick={() => setEditUser(null)}>Cancel</button></div>
          </form>
        </div>}

        {canAdmin && resetUser && <div id="reset-password-panel" className="card full">
          <h3>Reset Password: {resetUser.name}</h3>
          <p className="note">This does not require the staff member's old password. Give them the temporary password and ask them to change it under Account after login.</p>
          <form onSubmit={resetStaffPassword} className="form-grid">
            <div className="form-field"><label>New temporary password</label><PasswordField value={resetPassword} onChange={setResetPassword} minLength={8} required autoComplete="new-password" /></div>
            <div className="form-field button-row" style={{ alignSelf: 'end' }}><button type="submit">Reset Password</button><button type="button" className="secondary" onClick={() => setResetUser(null)}>Cancel</button></div>
          </form>
        </div>}

        <div className="card full">
          <h3>Training / Testing Cleanup</h3>
          <p className="note">Use this when test calls were logged during training. It clears calls and self-reported bookings for the selected staff member, preserves assignments, and resets affected patients so they can be called properly later.</p>
          <form onSubmit={clearStaffCalls} className="form-grid">
            <div className="form-field"><label>Staff member</label><select value={cleanup.staffId} onChange={e => setCleanup({ ...cleanup, staffId: e.target.value })}><option value="">Select staff</option>{users.filter(u => ['recall_staff','manager','admin'].includes(u.role)).map(u => <option key={u.id} value={u.id}>{u.name} — {roleLabel(u.role)}</option>)}</select></div>
            <div className="form-field"><label>Type CLEAR to confirm</label><input value={cleanup.confirmText} onChange={e => setCleanup({ ...cleanup, confirmText: e.target.value })} placeholder="CLEAR" /></div>
            <div className="form-field" style={{ alignSelf: 'end' }}><button className="danger" type="submit">Clear Staff Call Logs</button></div>
          </form>
        </div>
      </div>}
    </>
  );
}
