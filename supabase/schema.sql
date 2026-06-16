create extension if not exists pgcrypto;

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  role text not null default 'recall_staff' check (role in ('admin','manager','recall_staff','verifier','finance','viewer')),
  is_active boolean not null default true,
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payment_assumptions (
  key text primary key,
  label text not null,
  value text not null,
  value_type text not null default 'number',
  sort_order int not null default 100,
  updated_at timestamptz not null default now()
);

insert into payment_assumptions (key, label, value, value_type, sort_order) values
('base_pay','Guaranteed base pay','20000','number',10),
('daily_call_target','Daily unique patient target','150','number',20),
('booking_bonus_per_verified_booking','Booking bonus per verified booking','20','number',30),
('attendance_bonus_per_attended_patient','Attendance bonus per attended patient','50','number',40),
('data_quality_bonus','Data quality bonus','2000','number',50),
('team_target_bonus','Team target bonus','5000','number',60),
('monthly_incentive_cap','Monthly incentive cap','20000','number',70),
('minimum_conversion_target','Minimum booking conversion target','0.10','number',80),
('conversion_bonus_8_percent','Conversion bonus at 8 percent','2000','number',90),
('conversion_bonus_10_percent','Conversion bonus at 10 percent','4000','number',100),
('conversion_bonus_12_5_percent','Conversion bonus at 12.5 percent','6000','number',110),
('show_up_multiplier_40_percent','Show up multiplier at 40 percent','0.5','number',120),
('show_up_multiplier_50_percent','Show up multiplier at 50 percent','0.75','number',130),
('show_up_multiplier_60_percent','Show up multiplier at 60 percent','1','number',140)
on conflict (key) do nothing;

create table if not exists upload_batches (
  id uuid primary key default gen_random_uuid(),
  filename_summary text,
  uploaded_by uuid references app_users(id),
  raw_row_count int not null default 0,
  unique_visit_count int not null default 0,
  clean_patient_count int not null default 0,
  duplicate_row_count int not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists raw_visits (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references upload_batches(id) on delete cascade,
  source_file_name text not null,
  source_sheet_name text not null,
  raw_row_number int,
  imported_at timestamptz not null default now(),
  data jsonb not null
);

create table if not exists unique_visits (
  id uuid primary key default gen_random_uuid(),
  visit_hash text not null unique,
  batch_id uuid references upload_batches(id) on delete set null,
  source_file_name text,
  source_sheet_name text,
  raw_row_number int,
  patient_name text,
  patient_name_key text,
  original_phone text,
  standard_phone text,
  visit_date date,
  visit_year int,
  doctor text,
  company text,
  visit_status text,
  raw_data jsonb,
  created_at timestamptz not null default now()
);

create table if not exists patient_master (
  id uuid primary key default gen_random_uuid(),
  standard_phone text not null unique,
  display_name text,
  patient_name_key text,
  all_names text[],
  original_phones text[],
  first_visit_date date,
  last_visit_date date,
  visit_count int not null default 0,
  years_visited int[],
  last_doctor text,
  last_company text,
  duplicate_risk_level text not null default 'low',
  duplicate_risk_notes text,
  recall_priority text not null default 'normal',
  assigned_to uuid references app_users(id),
  assignment_status text not null default 'unassigned',
  do_not_call boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists call_attempts (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patient_master(id) on delete cascade,
  staff_id uuid not null references app_users(id),
  attempt_no int not null default 1,
  attempt_at timestamptz not null default now(),
  outcome text not null,
  reached boolean not null default false,
  booking_made boolean not null default false,
  appointment_date date,
  patient_feedback text,
  notes text,
  next_action text,
  next_action_date date,
  created_at timestamptz not null default now()
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patient_master(id) on delete cascade,
  staff_id uuid not null references app_users(id),
  call_attempt_id uuid references call_attempts(id) on delete set null,
  appointment_date date not null,
  booking_status text not null default 'self_reported' check (booking_status in ('self_reported','verified','cancelled','invalid')),
  attendance_status text not null default 'pending' check (attendance_status in ('pending','attended','missed','rescheduled','not_matured')),
  verification_method text,
  verified_by uuid references app_users(id),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists data_quality_flags (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patient_master(id) on delete cascade,
  staff_id uuid references app_users(id) on delete set null,
  batch_id uuid references upload_batches(id) on delete set null,
  flag_type text not null,
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  description text not null,
  status text not null default 'open' check (status in ('open','reviewed','resolved','dismissed')),
  resolved_by uuid references app_users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists payment_periods (
  id uuid primary key default gen_random_uuid(),
  period_name text not null,
  start_date date not null,
  end_date date not null,
  work_days int not null,
  team_target_achieved boolean not null default false,
  status text not null default 'draft' check (status in ('draft','calculated','approved','closed')),
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists staff_payment_calculations (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references payment_periods(id) on delete cascade,
  staff_id uuid not null references app_users(id),
  stats jsonb not null,
  base_pay numeric not null default 0,
  gross_incentive numeric not null default 0,
  incentive_after_cap numeric not null default 0,
  total_pay numeric not null default 0,
  payment_flags text[],
  approval_status text not null default 'pending' check (approval_status in ('pending','review_required','approved','rejected')),
  created_at timestamptz not null default now(),
  unique(period_id, staff_id)
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app_users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_raw_visits_batch on raw_visits(batch_id);
create index if not exists idx_unique_visits_phone on unique_visits(standard_phone);
create index if not exists idx_unique_visits_date on unique_visits(visit_date);
create index if not exists idx_patient_master_assigned_to on patient_master(assigned_to);
create index if not exists idx_patient_master_last_visit on patient_master(last_visit_date);
create index if not exists idx_call_attempts_staff_date on call_attempts(staff_id, attempt_at);
create index if not exists idx_call_attempts_patient on call_attempts(patient_id);
create index if not exists idx_bookings_staff_date on bookings(staff_id, appointment_date);
create index if not exists idx_flags_staff_status on data_quality_flags(staff_id, status);
