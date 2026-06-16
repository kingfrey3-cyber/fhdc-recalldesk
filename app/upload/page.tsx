'use client';

import { useState } from 'react';
import { parseJsonResponse } from '@/lib/apiClient';

export default function UploadPage() {
  const [files, setFiles] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [startedAt, setStartedAt] = useState<number | null>(null);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!files?.length) return setError('Choose one or more Excel files');
    setBusy(true); setError(''); setResult(null); const start = Date.now(); setStartedAt(start);
    const form = new FormData();
    Array.from(files).forEach(file => form.append('files', file));
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const data = await parseJsonResponse(res);
      setResult({ ...data, secondsTaken: Math.round((Date.now() - start) / 1000) });
    } catch (error: any) {
      setError(error.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="hero">
        <h1 style={{ marginTop: 0, color: 'var(--fhdc-blue-dark)' }}>Upload Patient Visit Exports</h1>
        <p className="note">Upload raw Excel exports as they come from the clinic system. The tool standardises phone numbers, removes repeated visit duplicates and rebuilds the clean calling list.</p>
        <p className="note"><strong>Production note:</strong> Supabase upload uses an operational clean-recall mode. Raw rows are counted, but the full raw Excel row data is not stored inside Supabase to keep uploads fast and reliable. Keep the original export files separately for audit traceability.</p>
        <p className="note"><strong>Recommended:</strong> upload one year or a few files at a time. Avoid uploading the entire 2015–2026 history in one batch until the first few Supabase uploads have completed cleanly.</p>
      </div>
      <div className="card" style={{ marginTop: 18 }}>
        <form onSubmit={upload} className="form-grid">
          <div className="form-field full">
            <label>Excel visit export files</label>
            <input type="file" accept=".xls,.xlsx,.csv" multiple onChange={e => setFiles(e.target.files)} />
          </div>
          {error && <div className="form-field full error">{error}</div>}
          <div className="form-field full"><button disabled={busy}>{busy ? 'Processing and saving clean recall base...' : 'Upload and Process'}</button></div>
          {busy && <div className="form-field full note">Keep this tab open. RecallDesk is reading the Excel rows, standardising phone numbers, removing duplicate visits and saving the operational recall base to Supabase.</div>}
        </form>
        {result && <div className="alert success">
          Upload processed. Raw rows read: {Number(result.rawRows || 0).toLocaleString()}, new unique visits: {Number(result.uniqueRows || 0).toLocaleString()}, clean patients: {Number(result.cleanPatients || 0).toLocaleString()}, invalid or missing phones: {Number(result.invalidPhoneCount || 0).toLocaleString()}{result.secondsTaken ? `, time taken: ${result.secondsTaken}s` : ''}.
        </div>}
      </div>
    </>
  );
}
