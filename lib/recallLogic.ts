import crypto from "crypto";

export type ParsedVisit = {
  visit_hash: string;
  source_file_name: string;
  source_sheet_name: string;
  raw_row_number: number;
  patient_name: string;
  patient_name_key: string;
  original_phone: string;
  standard_phone: string;
  visit_date: string | null;
  visit_year: number | null;
  doctor: string;
  company: string;
  visit_status: string;
};

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function isoDate(year: number, month: number, day: number): string | null {
  if (!year || !month || !day) return null;
  if (year < 1900 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1) return null;
  // Excel serial date origin. 25569 = 1970-01-01.
  const millis = Math.round((serial - 25569) * 86400 * 1000);
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return null;
  return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function cleanText(value: any): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const parsed = parseVisitDate(value);
    return parsed || "";
  }

  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export const cleanString = cleanText;

function normalizeHeader(value: any): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/[#*]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

function findValue(row: Record<string, any>, possibleHeaders: string[]): any {
  const wanted = possibleHeaders.map(normalizeHeader);

  for (const header of possibleHeaders) {
    if (Object.prototype.hasOwnProperty.call(row, header)) return row[header];
  }

  for (const [key, value] of Object.entries(row)) {
    const normalized = normalizeHeader(key);
    if (wanted.includes(normalized)) return value;
  }

  // Fallback for headers exported with trailing spaces or slightly longer labels.
  for (const [key, value] of Object.entries(row)) {
    const normalized = normalizeHeader(key);
    if (wanted.some((candidate) => normalized === candidate || normalized.includes(candidate))) {
      return value;
    }
  }

  return "";
}

export function parseVisitDate(value: any): string | null {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return isoDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  if (typeof value === "number") {
    return excelSerialToIso(value);
  }

  let text = cleanText(value);
  if (!text) return null;

  // Remove time when an Excel/CSV export carries a date and time in one field.
  text = text
    .replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1")
    .replace(/[,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Already ISO-like: 2025-01-02 or 2025/01/02
  let match = text.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (match) {
    return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  // Kenyan clinic exports such as: 2 Jan 2025, 2nd Jan 2025, 02 Jul 2025
  match = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{2,4})/);
  if (match) {
    const day = Number(match[1]);
    const month = MONTHS[match[2].toLowerCase()];
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    return isoDate(year, month, day);
  }

  // Month-first strings: Jan 2 2025
  match = text.match(/^([A-Za-z]+)\s+(\d{1,2})\s+(\d{2,4})/);
  if (match) {
    const month = MONTHS[match[1].toLowerCase()];
    const day = Number(match[2]);
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    return isoDate(year, month, day);
  }

  // Numeric dates. In Kenya, prefer D/M/Y when ambiguous.
  match = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (match) {
    let first = Number(match[1]);
    let second = Number(match[2]);
    let year = Number(match[3]);
    if (year < 100) year += 2000;

    let day = first;
    let month = second;

    // If first number cannot be a day but can be a month, treat as M/D/Y.
    if (first <= 12 && second > 12) {
      month = first;
      day = second;
    }

    return isoDate(year, month, day);
  }

  const fallback = new Date(text);
  if (!Number.isNaN(fallback.getTime())) {
    return isoDate(fallback.getFullYear(), fallback.getMonth() + 1, fallback.getDate());
  }

  return null;
}

export function laterOrEqual(candidate?: string | null, current?: string | null): boolean {
  if (!candidate) return false;
  if (!current) return true;
  return String(candidate) >= String(current);
}

export function patientNameKey(name: string): string {
  return cleanText(name)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePhone(value: any): string {
  const original = cleanText(value);
  if (!original) return "";

  let digits = original.replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("00254")) digits = digits.slice(2);
  if (digits.startsWith("254") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `+254${digits.slice(1)}`;
  if ((digits.startsWith("7") || digits.startsWith("1")) && digits.length === 9) return `+254${digits}`;

  // Keep rare but plausible Kenyan entries that have extra spaces/symbols cleaned.
  if (digits.length > 9 && digits.endsWith(digits.slice(-9))) {
    const lastNine = digits.slice(-9);
    if (lastNine.startsWith("7") || lastNine.startsWith("1")) return `+254${lastNine}`;
  }

  return "";
}

function hashVisit(parts: any[]): string {
  return crypto
    .createHash("sha1")
    .update(parts.map((p) => cleanText(p)).join("|"))
    .digest("hex");
}

export function extractVisit(
  row: Record<string, any>,
  sourceFileName: string,
  sourceSheetName: string,
  rawRowNumber: number
): ParsedVisit {
  const patientName = cleanText(
    findValue(row, [
      "Patient",
      "Patient Name",
      "Client",
      "Client Name",
      "Name",
      "Full Name",
      "Customer",
      "Customer Name",
    ])
  );

  const originalPhone = cleanText(
    findValue(row, [
      "Phone",
      "Phone Number",
      "Mobile",
      "Mobile Number",
      "Telephone",
      "Tel",
      "Contact",
      "Contact Number",
      "Patient Phone",
    ])
  );

  const standardPhone = normalizePhone(originalPhone);

  const rawVisitDate = findValue(row, [
    "Visit Date",
    "Date",
    "Created Date",
    "Registration Date",
    "Start Date",
    "Appointment Date",
    "Visit Start Date",
    "VisitDate",
  ]);
  const visitDate = parseVisitDate(rawVisitDate);
  const visitYear = visitDate ? Number(visitDate.slice(0, 4)) : null;

  const doctor = cleanText(
    findValue(row, [
      "Doctor",
      "Clinician",
      "Provider",
      "Consultant",
      "Dentist",
      "Seen By",
      "Served By",
      "Doctor Name",
    ])
  );

  const company = cleanText(
    findValue(row, [
      "Company",
      "Category",
      "Payer",
      "Payer Name",
      "Insurance",
      "Scheme",
      "Payment Category",
    ])
  );

  const visitStatus = cleanText(
    findValue(row, [
      "Status",
      "Visit Status",
      "Session Status",
      "Appointment Status",
    ])
  );

  const pKey = patientNameKey(patientName);

  return {
    visit_hash: hashVisit([
      sourceFileName,
      sourceSheetName,
      rawRowNumber,
      standardPhone,
      pKey,
      visitDate || cleanText(rawVisitDate),
      doctor,
    ]),
    source_file_name: sourceFileName,
    source_sheet_name: sourceSheetName,
    raw_row_number: rawRowNumber,
    patient_name: patientName,
    patient_name_key: pKey,
    original_phone: originalPhone,
    standard_phone: standardPhone,
    visit_date: visitDate,
    visit_year: visitYear,
    doctor,
    company,
    visit_status: visitStatus,
  };
}

export function recallPriority(lastVisitDate?: string | null) {
  if (!lastVisitDate) return "manual review";

  const parsed = parseVisitDate(lastVisitDate);
  if (!parsed) return "manual review";

  const today = new Date();
  const visit = new Date(`${parsed}T00:00:00Z`);
  const months =
    (today.getUTCFullYear() - visit.getUTCFullYear()) * 12 +
    (today.getUTCMonth() - visit.getUTCMonth());

  if (months >= 36) return "highest";
  if (months >= 24) return "high";
  if (months >= 12) return "medium";
  if (months >= 6) return "normal";
  return "recent";
}
