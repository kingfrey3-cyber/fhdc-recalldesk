import crypto from 'crypto';

export type ParsedVisit = {
  source_file_name: string;
  source_sheet_name: string;
  raw_row_number: number;
  raw_data: Record<string, any>;
  patient_name: string;
  patient_name_key: string;
  original_phone: string;
  standard_phone: string;
  visit_date: string | null;
  visit_year: number | null;
  doctor: string;
  company: string;
  visit_status: string;
  visit_hash: string;
};

function cleanText(value: any) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function nameKey(name: string) {
  return cleanText(name).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

export function normaliseKenyanPhone(value: any) {
  const raw = cleanText(value);
  if (!raw) return '';

  let digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return '';

  if (digits.startsWith('254') && digits.length === 12) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 10) return `+254${digits.slice(1)}`;
  if (digits.startsWith('7') && digits.length === 9) return `+254${digits}`;
  if (digits.startsWith('1') && digits.length === 9) return `+254${digits}`;
  if (digits.startsWith('254') && digits.length > 12) return `+${digits.slice(0, 12)}`;

  return '';
}

function normaliseHeader(h: string) {
  return cleanText(h).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function findValue(row: Record<string, any>, candidates: string[]) {
  const map = new Map<string, any>();
  Object.keys(row).forEach((key) => map.set(normaliseHeader(key), row[key]));
  for (const c of candidates) {
    const wanted = normaliseHeader(c);
    if (map.has(wanted)) return map.get(wanted);
  }
  for (const [key, value] of map.entries()) {
    if (candidates.some((c) => key.includes(normaliseHeader(c)))) return value;
  }
  return '';
}

export function parseExcelDate(value: any): string | null {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString().slice(0, 10);

  if (typeof value === 'number') {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(epoch.getTime() + value * 24 * 60 * 60 * 1000);
    if (!isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }

  const text = cleanText(value);
  if (!text) return null;

  const direct = new Date(text);
  if (!isNaN(direct.getTime())) return direct.toISOString().slice(0, 10);

  const m = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (!isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return null;
}

export function visitHash(parts: string[]) {
  return crypto.createHash('sha256').update(parts.map((p) => cleanText(p).toLowerCase()).join('|')).digest('hex');
}

export function extractVisit(row: Record<string, any>, fileName: string, sheetName: string, rowNumber: number): ParsedVisit {
  const patientName = cleanText(findValue(row, [
    'Patient Name', 'Patient', 'Client Name', 'Name', 'Full Name', 'Customer Name'
  ]));

  const originalPhone = cleanText(findValue(row, [
    'Phone Number', 'Mobile Number', 'Mobile', 'Phone', 'Telephone', 'Tel', 'Contact', 'Patient Phone', 'Cell Phone'
  ]));

  const visitDate = parseExcelDate(findValue(row, [
    'Visit Date', 'Date', 'Created Date', 'Registration Date', 'Start Date', 'Appointment Date', 'Visit Start Date'
  ]));

  const doctor = cleanText(findValue(row, ['Doctor', 'Clinician', 'Provider', 'Consultant', 'Dentist']));
  const company = cleanText(findValue(row, ['Company', 'Payer', 'Insurance', 'Scheme', 'Corporate', 'Sponsor']));
  const status = cleanText(findValue(row, ['Status', 'Visit Status', 'Patient Status', 'Queue Status']));
  const standardPhone = normaliseKenyanPhone(originalPhone);
  const pKey = nameKey(patientName);

  const hash = visitHash([
    pKey,
    standardPhone || originalPhone,
    visitDate || '',
    doctor,
    company,
    status,
    JSON.stringify(row)
  ]);

  return {
    source_file_name: fileName,
    source_sheet_name: sheetName,
    raw_row_number: rowNumber,
    raw_data: row,
    patient_name: patientName,
    patient_name_key: pKey,
    original_phone: originalPhone,
    standard_phone: standardPhone,
    visit_date: visitDate,
    visit_year: visitDate ? Number(visitDate.slice(0, 4)) : null,
    doctor,
    company,
    visit_status: status,
    visit_hash: hash
  };
}

export function recallPriority(lastVisitDate?: string | null) {
  if (!lastVisitDate) return 'manual review';
  const years = new Date().getFullYear() - Number(lastVisitDate.slice(0, 4));
  if (years >= 5) return 'very high';
  if (years >= 3) return 'high';
  if (years >= 1) return 'normal';
  return 'recent';
}
