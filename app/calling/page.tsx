"use client";

import { useEffect, useMemo, useState } from 'react';
import { parseJsonResponse } from '@/lib/apiClient';

const outcomes = ['Booked appointment','Interested but not booked','Call back later','No answer','Switched off','Wrong number','Number not in service','Patient declined','Already visited recently','Not reachable after final attempt','Data correction needed','Do not call'];
const blankCall = { outcome: '', appointmentDate: '', patientFeedback: '', notes: '', nextAction: '', nextActionDate: '' };

function roleLabel(role?: string) {
  return String(role || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function toCallForm(call: any) {
  return {
    outcome: call?.outcome || '',
    appointmentDate: call?.appointment_date || '',
    patientFeedback: call?.patient_feedback || '',
    notes: call?.notes || '',
    nextAction: call?.next_action || '',
    nextActionDate: call?.next_action_date || ''
  };
}

export default function CallingPage() {
  const [me, setMe] = useState<any>(null);
  const [patients, setPatients] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [staffFilter, setStaffFilter] = useState('');
  const [selected, setSelected] = useState<any>(null);
  const [patientCalls, setPatientCalls] = useState<any[]>([]);
  const [editingCall, setEditingCall] = useState<any>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [assign, setAssign] = useState({ staffId: '', count: 100 });
  const [call, setCall] = useState(blankCall);

  const canManage = useMemo(() => ['admin','manager'].includes(me?.role), [me]);

  async function load(searchOverride?: string) {
    const activeSearch = searchOverride ?? search;
    setError('');
    try {
      const meData = await fetch('/api/me').then(parseJsonResponse);
      const currentUser = meData.user;
      setMe(currentUser);
      if (!currentUser) throw new Error('You are not logged in. Please log in again.');

      const params = new URLSearchParams();
      params.set('search', activeSearch);
      if (status) params.set('status', status);
      if (['admin','manager'].includes(currentUser.role) && staffFilter) params.set('staffId', staffFilter);

      const [p, u] = await Promise.all([
        fetch(`/api/patients?${params.toString()}`).then(parseJsonResponse),
        fetch('/api/users').then(parseJsonResponse)
      ]);
      setPatients(p.patients || []);
      setUsers(u.users || []);
    } catch (error: any) {
      setError(error.message || 'Failed to load calling list');
    }
  }

  useEffect(() => { load(''); }, []);

  function clearSearch() {
    setSearch('');
    load('');
  }

  async function assignBatch(e: React.FormEvent) {
    e.preventDefault(); setMessage(''); setError('');
    try {
      const res = await fetch('/api/patients/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(assign) });
      const data = await parseJsonResponse(res);
      setMessage(`${data.assigned} patients assigned.`); load();
    } catch (error: any) {
      setError(error.message || 'Assignment failed');
    }
  }

  async function unassignPendingForStaff() {
    setMessage(''); setError('');
    if (!assign.staffId) { setError('Select a staff member first.'); return; }
    if (!confirm('Unassign all pending, unworked patients assigned to this staff member? Worked records remain protected.')) return;
    try {
      const res = await fetch('/api/patients/unassign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staffId: assign.staffId }) });
      const data = await parseJsonResponse(res);
      setMessage(`${data.unassigned} patients unassigned. ${data.skippedWorked ? `${data.skippedWorked} worked records were protected and skipped.` : ''}`);
      load();
    } catch (error: any) {
      setError(error.message || 'Unassignment failed');
    }
  }

  async function unassignPatient(patient: any) {
    setMessage(''); setError('');
    if (!confirm(`Unassign ${patient.display_name}? This is allowed only if no call has been logged for this patient.`)) return;
    try {
      const res = await fetch('/api/patients/unassign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ patientIds: [patient.id] }) });
      const data = await parseJsonResponse(res);
      if (data.unassigned) setMessage('Patient unassigned.');
      else setMessage(`No patient was unassigned. ${data.skippedWorked ? 'This patient already has call or booking history and is protected.' : ''}`);
      load();
    } catch (error: any) {
      setError(error.message || 'Unassignment failed');
    }
  }

  async function openPatient(patient: any) {
    setSelected(patient);
    setEditingCall(null);
    setCall(blankCall);
    setError('');
    try {
      const data = await fetch(`/api/calls?patientId=${encodeURIComponent(patient.id)}`).then(parseJsonResponse);
      setPatientCalls(data.calls || []);
    } catch (error: any) {
      setPatientCalls([]);
      setError(error.message || 'Failed to load call history');
    }
  }

  async function refreshPatientCalls(patientId = selected?.id) {
    if (!patientId) return;
    const data = await fetch(`/api/calls?patientId=${encodeURIComponent(patientId)}`).then(parseJsonResponse);
    setPatientCalls(data.calls || []);
  }

  async function saveCall(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setMessage(''); setError('');
    try {
      const url = editingCall ? `/api/calls/${editingCall.id}` : '/api/calls';
      const method = editingCall ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...call, patientId: selected.id }) });
      await parseJsonResponse(res);
      setMessage(editingCall ? 'Call log updated.' : 'Call saved.');
      setCall(blankCall);
      setEditingCall(null);
      await refreshPatientCalls(selected.id);
      load();
    } catch (error: any) {
      setError(error.message || 'Failed to save call');
    }
  }

  async function unlogCall(callRow: any) {
    setMessage(''); setError('');
    if (!confirm('Unlog this call? This should only be used to correct an error or remove test/training entries.')) return;
    try {
      const res = await fetch(`/api/calls/${callRow.id}`, { method: 'DELETE' });
      await parseJsonResponse(res);
      setMessage('Call log removed and patient status recalculated.');
      setEditingCall(null);
      setCall(blankCall);
      await refreshPatientCalls(selected?.id);
      load();
    } catch (error: any) {
      setError(error.message || 'Failed to unlog call');
    }
  }

  function startEdit(callRow: any) {
    setEditingCall(callRow);
    setCall(toCallForm(callRow));
  }

  return (
    <>
      <div className="hero">
        <h1 style={{ marginTop: 0, color: 'var(--fhdc-blue-dark)' }}>Calling List and Task Allocation</h1>
        <p className="note">Staff accounts only see patients assigned to their own login. Admin and Manager accounts can allocate, unassign, inspect call history and correct test or mistaken call logs.</p>
        {me && <p className="note"><strong>Signed in as:</strong> {me.name} ({roleLabel(me.role)})</p>}
      </div>

      <div className="grid" style={{ marginTop: 18 }}>
        {canManage && <div className="card third">
          <h3>Assign Oldest Unassigned Patients</h3>
          <form onSubmit={assignBatch} className="form-grid">
            <div className="form-field full"><label>Recall staff</label><select value={assign.staffId} onChange={e => setAssign({ ...assign, staffId: e.target.value })}><option value="">Select staff</option>{users.filter(u => ['recall_staff','manager'].includes(u.role)).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
            <div className="form-field full"><label>Number of patients</label><input type="number" min="1" value={assign.count} onChange={e => setAssign({ ...assign, count: Number(e.target.value) })} /></div>
            <div className="form-field full"><button>Assign Batch</button></div>
            <div className="form-field full"><button type="button" className="ghost" onClick={unassignPendingForStaff}>Unassign Pending for Staff</button></div>
            <p className="note full" style={{ marginTop: 0 }}>Unassignment protects patients who already have call, booking or follow-up history.</p>
          </form>
        </div>}

        <div className="card" style={{ gridColumn: canManage ? 'span 8' : 'span 12' }}>
          <h3>{canManage ? 'Search Calling List' : 'My Assigned Calling List'}</h3>
          <div className="form-grid">
            <div className="form-field"><label>Search name or phone</label><input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') load(); }} /></div>
            {canManage && <div className="form-field"><label>Filter by staff</label><select value={staffFilter} onChange={e => setStaffFilter(e.target.value)}><option value="">All staff / all patients</option>{users.filter(u => ['recall_staff','manager'].includes(u.role)).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>}
            <div className="form-field"><label>Status</label><select value={status} onChange={e => setStatus(e.target.value)}><option value="">All visible statuses</option>{canManage && <option value="unassigned">Unassigned</option>}<option value="assigned">Assigned / pending</option><option value="called">Called</option><option value="follow_up">Follow up</option><option value="booked">Booked</option><option value="do_not_call">Do not call</option></select></div>
            <div className="form-field" style={{ alignSelf: 'end' }}><button onClick={() => load()}>Search</button></div>
            <div className="form-field" style={{ alignSelf: 'end' }}><button type="button" className="ghost" onClick={clearSearch}>Clear Search</button></div>
          </div>
          {message && <div className="alert success">{message}</div>}
          {error && <div className="alert error">{error}</div>}
        </div>

        <div className="card full">
          <div className="table-wrap">
            <table><thead><tr><th>Patient</th><th>Phone</th><th>Last Visit</th><th>Visits</th><th>Priority</th><th>Assigned To</th><th>Status</th><th>Calls</th><th>Action</th></tr></thead><tbody>
              {patients.length === 0 && <tr><td colSpan={9}>{canManage ? 'No patients loaded yet. Upload visit exports first or adjust the search.' : 'No patients assigned to this login yet. Ask admin to assign patients to this user account.'}</td></tr>}
              {patients.map(p => <tr key={p.id}>
                <td>{p.display_name}<br />{p.duplicate_risk_level === 'review' && <span className="badge orange">duplicate review</span>}</td>
                <td>{p.standard_phone}</td><td>{p.last_visit_date}</td><td>{p.visit_count}</td><td>{p.recall_priority}</td><td>{p.assigned_user?.name || '-'}</td><td>{p.assignment_status}</td><td>{p.call_count || 0}</td><td>
                  <button onClick={() => openPatient(p)}>{p.call_count ? 'View / Log' : 'Log Call'}</button>
                  {canManage && p.assigned_to && p.assignment_status === 'assigned' && <button type="button" className="ghost" style={{ marginLeft: 8 }} onClick={() => unassignPatient(p)}>Unassign</button>}
                </td>
              </tr>)}
            </tbody></table>
          </div>
        </div>
      </div>

      {selected && <div className="card" style={{ position: 'fixed', right: 24, top: 92, width: 520, maxWidth: 'calc(100vw - 48px)', maxHeight: 'calc(100vh - 120px)', overflow: 'auto', zIndex: 20, boxShadow: '0 20px 60px rgba(0,0,0,.2)' }}>
        <h3 style={{ marginBottom: 4 }}>{editingCall ? 'Edit Call Log' : 'Log Call'}: {selected.display_name}</h3>
        <p className="note">{selected.standard_phone} · Assigned to {selected.assigned_user?.name || 'unassigned'} · Status: {selected.assignment_status}</p>

        <form onSubmit={saveCall} className="form-grid">
          <div className="form-field full"><label>Outcome</label><select required value={call.outcome} onChange={e => setCall({ ...call, outcome: e.target.value })}><option value="">Select outcome</option>{outcomes.map(o => <option key={o}>{o}</option>)}</select></div>
          <div className="form-field full"><label>Appointment date, if booked</label><input type="date" value={call.appointmentDate} onChange={e => setCall({ ...call, appointmentDate: e.target.value })} /></div>
          <div className="form-field full"><label>Patient feedback</label><textarea value={call.patientFeedback} onChange={e => setCall({ ...call, patientFeedback: e.target.value })} /></div>
          <div className="form-field"><label>Next action</label><input value={call.nextAction} onChange={e => setCall({ ...call, nextAction: e.target.value })} /></div>
          <div className="form-field"><label>Next action date</label><input type="date" value={call.nextActionDate} onChange={e => setCall({ ...call, nextActionDate: e.target.value })} /></div>
          <div className="form-field full"><label>Notes</label><textarea value={call.notes} onChange={e => setCall({ ...call, notes: e.target.value })} /></div>
          <div className="form-field"><button>{editingCall ? 'Save Changes' : 'Save Call'}</button></div>
          <div className="form-field"><button type="button" className="ghost" onClick={() => { setEditingCall(null); setCall(blankCall); }}>Clear Form</button></div>
          <div className="form-field full"><button type="button" className="ghost" onClick={() => { setSelected(null); setEditingCall(null); setPatientCalls([]); setCall(blankCall); }}>Close</button></div>
        </form>

        <h3 style={{ marginTop: 18 }}>Call History</h3>
        <div className="table-wrap">
          <table><thead><tr><th>Date</th><th>Outcome</th><th>Staff</th><th>Booking</th><th>Action</th></tr></thead><tbody>
            {patientCalls.length === 0 && <tr><td colSpan={5}>No calls logged for this patient yet.</td></tr>}
            {patientCalls.map(c => <tr key={c.id}>
              <td>{String(c.attempt_at || c.created_at || '').slice(0, 19).replace('T',' ')}</td>
              <td>{c.outcome}<br />{c.next_action && <span className="note">Next: {c.next_action}</span>}</td>
              <td>{c.staff?.name || '-'}</td>
              <td>{c.booking_made ? `Yes · ${c.appointment_date || ''}` : 'No'}</td>
              <td><button type="button" className="ghost" onClick={() => startEdit(c)}>Edit</button><button type="button" className="ghost" style={{ marginLeft: 8 }} onClick={() => unlogCall(c)}>Unlog</button></td>
            </tr>)}
          </tbody></table>
        </div>
      </div>}
    </>
  );
}
