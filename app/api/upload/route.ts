import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { requireUser } from '@/lib/auth';
import { extractVisit, recallPriority } from '@/lib/recallLogic';
import { updateStore, newId, nowIso } from '@/lib/localDb';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function pickLast<T>(items: T[], fn: (x: T) => string | null | undefined) {
  const found = [...items].reverse().find((x) => fn(x));
  return found ? fn(found) || '' : '';
}

function rebuildPatientMaster(store: any, batchId: string) {
  const visits = store.unique_visits.filter((v: any) => v.standard_phone);
  const byPhone = new Map<string, any[]>();
  for (const v of visits) {
    if (!byPhone.has(v.standard_phone)) byPhone.set(v.standard_phone, []);
    byPhone.get(v.standard_phone)!.push(v);
  }

  const nameToPhones = new Map<string, Set<string>>();
  for (const v of visits) {
    if (!v.patient_name_key || !v.standard_phone) continue;
    if (!nameToPhones.has(v.patient_name_key)) nameToPhones.set(v.patient_name_key, new Set());
    nameToPhones.get(v.patient_name_key)!.add(v.standard_phone);
  }

  const existingByPhone = new Map(store.patient_master.map((p: any) => [p.standard_phone, p]));
  const patientRows: any[] = [];
  const flags: any[] = [];

  for (const [phone, list] of byPhone.entries()) {
    const sorted = [...list].sort((a, b) => String(a.visit_date || '').localeCompare(String(b.visit_date || '')));
    const names = Array.from(new Set(sorted.map((v) => v.patient_name).filter(Boolean)));
    const nameKeys = Array.from(new Set(sorted.map((v) => v.patient_name_key).filter(Boolean)));
    const originalPhones = Array.from(new Set(sorted.map((v) => v.original_phone).filter(Boolean)));
    const years = Array.from(new Set(sorted.map((v) => v.visit_year).filter(Boolean))).sort((a: any, b: any) => a - b);
    const dates = sorted.map((v) => v.visit_date).filter(Boolean);
    const firstVisit = dates[0] || null;
    const lastVisit = dates[dates.length - 1] || null;
    const samePhoneManyNames = names.length > 1;
    const sameNameManyPhones = nameKeys.some((k) => (nameToPhones.get(k)?.size || 0) > 1);
    const existing: any = existingByPhone.get(phone) || {};

    const patient = {
      id: existing.id || newId('patient_'),
      standard_phone: phone,
      display_name: names[0] || 'Unknown patient',
      patient_name_key: nameKeys[0] || '',
      all_names: names,
      original_phones: originalPhones,
      first_visit_date: firstVisit,
      last_visit_date: lastVisit,
      visit_count: sorted.length,
      years_visited: years,
      last_doctor: pickLast(sorted, (x: any) => x.doctor),
      last_company: pickLast(sorted, (x: any) => x.company),
      duplicate_risk_level: samePhoneManyNames || sameNameManyPhones ? 'review' : 'low',
      duplicate_risk_notes: [
        samePhoneManyNames ? 'Same phone linked to multiple patient names' : '',
        sameNameManyPhones ? 'Same or similar patient name appears with multiple phone numbers' : ''
      ].filter(Boolean).join('; '),
      recall_priority: recallPriority(lastVisit),
      assignment_status: existing.assignment_status || 'unassigned',
      assigned_to: existing.assigned_to || null,
      do_not_call: existing.do_not_call || false,
      updated_at: nowIso()
    };
    patientRows.push(patient);

    if (patient.duplicate_risk_level === 'review') {
      flags.push({
        id: newId('flag_'),
        batch_id: batchId,
        patient_id: patient.id,
        staff_id: null,
        flag_type: 'potential_duplicate_patient',
        severity: 'medium',
        status: 'open',
        description: `${patient.display_name || 'Patient'} ${patient.standard_phone}: ${patient.duplicate_risk_notes}`,
        created_at: nowIso()
      });
    }
  }

  store.patient_master = patientRows;
  store.data_quality_flags = store.data_quality_flags.filter((f: any) => f.batch_id !== batchId);
  store.data_quality_flags.push(...flags);
  return patientRows.length;
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(['admin','manager']);
    const form = await req.formData();
    const files = form.getAll('files') as File[];
    if (!files.length) return NextResponse.json({ error: 'Upload at least one Excel file' }, { status: 400 });

    const batchId = newId('batch_');
    const batch: any = {
      id: batchId,
      filename_summary: files.map((f) => f.name).join(', '),
      uploaded_by: user.id,
      raw_row_count: 0,
      unique_visit_count: 0,
      clean_patient_count: 0,
      duplicate_row_count: 0,
      notes: '',
      created_at: nowIso()
    };

    const rawRows: any[] = [];
    const uniqueRows: any[] = [];
    let invalidPhoneCount = 0;

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });
        rows.forEach((row, idx) => {
          const parsed = extractVisit(row, file.name, sheetName, idx + 2);
          rawRows.push({
            id: newId('raw_'),
            batch_id: batch.id,
            source_file_name: file.name,
            source_sheet_name: sheetName,
            raw_row_number: idx + 2,
            data: row,
            created_at: nowIso()
          });
          if (!parsed.standard_phone) invalidPhoneCount += 1;
          if (parsed.standard_phone) {
            uniqueRows.push({
              id: newId('visit_'),
              visit_hash: parsed.visit_hash,
              batch_id: batch.id,
              source_file_name: parsed.source_file_name,
              source_sheet_name: parsed.source_sheet_name,
              raw_row_number: parsed.raw_row_number,
              patient_name: parsed.patient_name,
              patient_name_key: parsed.patient_name_key,
              original_phone: parsed.original_phone,
              standard_phone: parsed.standard_phone,
              visit_date: parsed.visit_date,
              visit_year: parsed.visit_year,
              doctor: parsed.doctor,
              company: parsed.company,
              visit_status: parsed.visit_status,
              raw_data: parsed.raw_data,
              created_at: nowIso()
            });
          }
        });
      }
    }

    const result = await updateStore(store => {
      store.upload_batches.push(batch);
      store.raw_visits.push(...rawRows);

      const existingHashes = new Set(store.unique_visits.map((v: any) => v.visit_hash));
      let addedUnique = 0;
      for (const row of uniqueRows) {
        if (!existingHashes.has(row.visit_hash)) {
          store.unique_visits.push(row);
          existingHashes.add(row.visit_hash);
          addedUnique += 1;
        }
      }

      if (invalidPhoneCount > 0) {
        store.data_quality_flags.push({
          id: newId('flag_'),
          batch_id: batch.id,
          patient_id: null,
          staff_id: null,
          flag_type: 'invalid_or_missing_phone',
          severity: 'high',
          status: 'open',
          description: `${invalidPhoneCount} uploaded visit rows had invalid or missing phone numbers and were excluded from the clean calling list.`,
          created_at: nowIso()
        });
      }

      const cleanPatientCount = rebuildPatientMaster(store, batch.id);
      batch.raw_row_count = rawRows.length;
      batch.unique_visit_count = addedUnique;
      batch.clean_patient_count = cleanPatientCount;
      batch.duplicate_row_count = Math.max(0, rawRows.length - addedUnique);
      batch.notes = `Invalid or missing phones: ${invalidPhoneCount}. Patient master rebuilt from all unique visits.`;

      return { rawRows: rawRows.length, uniqueRows: addedUnique, cleanPatientCount };
    });

    await writeAudit(user.id, 'UPLOAD_VISIT_EXPORTS', 'upload_batch', batch.id, {
      files: files.map((f) => f.name), rawRows: rawRows.length, uniqueRows: result.uniqueRows, cleanPatientCount: result.cleanPatientCount
    });

    return NextResponse.json({
      batchId: batch.id,
      rawRows: rawRows.length,
      uniqueRows: result.uniqueRows,
      cleanPatients: result.cleanPatientCount,
      invalidPhoneCount
    });
  } catch (error: any) {
    const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : 500;
    return NextResponse.json({ error: error.message || 'Upload failed' }, { status });
  }
}
