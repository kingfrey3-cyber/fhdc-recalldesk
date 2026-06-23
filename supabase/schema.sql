-- FHDC RecallDesk Relational Supabase v2 schema
-- Run this in Supabase SQL Editor before switching STORAGE_DRIVER to supabase_tables.
-- It keeps the old recalldesk_app_store table as a backup and migrates its JSON data into proper tables.

create extension if not exists pgcrypto;

create table if not exists public.recalldesk_app_store (
  id text primary key check (id = 'main'),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_users (
  id text primary key,
  name text not null,
  email text not null unique,
  role text not null check (role in ('admin','manager','recall_staff','verifier','finance','viewer')),
  is_active boolean not null default true,
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  password_reset_at timestamptz,
  password_changed_at timestamptz
);

create table if not exists public.upload_batches (
  id text primary key,
  filename_summary text,
  uploaded_by text,
  raw_row_count integer not null default 0,
  unique_visit_count integer not null default 0,
  clean_patient_count integer not null default 0,
  duplicate_row_count integer not null default 0,
  invalid_phone_count integer not null default 0,
  notes text,
  storage_mode text,
  created_at timestamptz not null default now()
);

create table if not exists public.visit_hashes (
  visit_hash text primary key,
  batch_id text,
  standard_phone text,
  visit_date date,
  created_at timestamptz not null default now()
);

create table if not exists public.clean_patients (
  id text primary key,
  standard_phone text not null unique,
  display_name text,
  patient_name_key text,
  patient_name_keys jsonb not null default '[]'::jsonb,
  all_names jsonb not null default '[]'::jsonb,
  original_phones jsonb not null default '[]'::jsonb,
  original_phones_text text,
  first_visit_date date,
  last_visit_date date,
  visit_count integer not null default 0,
  years_visited jsonb not null default '[]'::jsonb,
  last_doctor text,
  last_company text,
  duplicate_risk_level text default 'low',
  duplicate_risk_notes text,
  recall_priority text,
  assignment_status text not null default 'unassigned',
  assigned_to text references public.app_users(id) on delete set null,
  do_not_call boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.call_attempts (
  id text primary key,
  patient_id text not null references public.clean_patients(id) on delete cascade,
  staff_id text references public.app_users(id) on delete set null,
  attempt_no integer not null default 1,
  outcome text,
  reached boolean not null default false,
  booking_made boolean not null default false,
  appointment_date date,
  patient_feedback text,
  notes text,
  next_action text,
  next_action_date date,
  attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_by text
);

create table if not exists public.bookings (
  id text primary key,
  patient_id text not null references public.clean_patients(id) on delete cascade,
  staff_id text references public.app_users(id) on delete set null,
  call_attempt_id text references public.call_attempts(id) on delete cascade,
  appointment_date date,
  booking_status text not null default 'self_reported',
  attendance_status text not null default 'not_matured',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.data_quality_flags (
  id text primary key,
  batch_id text,
  patient_id text references public.clean_patients(id) on delete cascade,
  staff_id text references public.app_users(id) on delete set null,
  call_attempt_id text references public.call_attempts(id) on delete set null,
  flag_type text,
  severity text default 'medium',
  status text default 'open',
  description text,
  closure_note text,
  closed_at timestamptz,
  closed_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.payment_assumptions (
  id text primary key,
  key text not null unique,
  label text not null,
  value text not null,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_periods (
  id text primary key,
  period_name text not null,
  start_date date not null,
  end_date date not null,
  work_days integer not null default 0,
  team_target_achieved boolean not null default false,
  status text default 'calculated',
  created_by text references public.app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_payment_calculations (
  id text primary key,
  period_id text references public.payment_periods(id) on delete cascade,
  staff_id text references public.app_users(id) on delete set null,
  stats jsonb not null default '{}'::jsonb,
  base_pay numeric not null default 0,
  gross_incentive numeric not null default 0,
  incentive_after_cap numeric not null default 0,
  total_pay numeric not null default 0,
  payment_flags jsonb not null default '[]'::jsonb,
  approval_status text default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id text primary key,
  actor_id text,
  action text,
  entity_type text,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_clean_patients_assigned_to on public.clean_patients(assigned_to);
create index if not exists idx_clean_patients_assignment_status on public.clean_patients(assignment_status);
create index if not exists idx_clean_patients_last_visit on public.clean_patients(last_visit_date);
create index if not exists idx_clean_patients_display_name on public.clean_patients(display_name);
create index if not exists idx_call_attempts_patient on public.call_attempts(patient_id);
create index if not exists idx_call_attempts_staff on public.call_attempts(staff_id);
create index if not exists idx_bookings_staff on public.bookings(staff_id);
create index if not exists idx_flags_status on public.data_quality_flags(status);

alter table public.app_users enable row level security;
alter table public.upload_batches enable row level security;
alter table public.visit_hashes enable row level security;
alter table public.clean_patients enable row level security;
alter table public.call_attempts enable row level security;
alter table public.bookings enable row level security;
alter table public.data_quality_flags enable row level security;
alter table public.payment_assumptions enable row level security;
alter table public.payment_periods enable row level security;
alter table public.staff_payment_calculations enable row level security;
alter table public.audit_logs enable row level security;

-- Server uses Supabase secret/service role key. No public RLS policies are required.

-- Default payment assumptions
insert into public.payment_assumptions (id, key, label, value, sort_order, updated_at) values
('assumption_base_pay','base_pay','Guaranteed Base Pay','20000',1,now()),
('assumption_daily_call_target','daily_call_target','Daily Unique Patient Target','150',2,now()),
('assumption_monthly_incentive_cap','monthly_incentive_cap','Monthly Incentive Cap','20000',3,now()),
('assumption_booking_bonus','booking_bonus_per_verified_booking','Booking Bonus per Verified Booking','20',4,now()),
('assumption_attendance_bonus','attendance_bonus_per_attended_patient','Attendance Bonus per Attended Patient','50',5,now()),
('assumption_data_quality_bonus','data_quality_bonus','Data Quality Bonus','2000',6,now()),
('assumption_team_target_bonus','team_target_bonus','Team Target Bonus','5000',7,now()),
('assumption_min_conversion','minimum_conversion_target','Minimum Booking Conversion Target','0.10',8,now()),
('assumption_conversion_5','conversion_bonus_5_percent','Conversion Bonus at 5%','1000',9,now()),
('assumption_conversion_8','conversion_bonus_8_percent','Conversion Bonus at 8%','2000',10,now()),
('assumption_conversion_10','conversion_bonus_10_percent','Conversion Bonus at 10%','4000',11,now()),
('assumption_conversion_125','conversion_bonus_12_5_percent','Conversion Bonus at 12.5%','6000',12,now()),
('assumption_show_40','show_up_multiplier_40_percent','Show Up Multiplier at 40%','0.5',13,now()),
('assumption_show_50','show_up_multiplier_50_percent','Show Up Multiplier at 50%','0.75',14,now()),
('assumption_show_60','show_up_multiplier_60_percent','Show Up Multiplier at 60%','1',15,now())
on conflict (key) do update set label = excluded.label, sort_order = excluded.sort_order;

-- One-time migration from old bridge JSON store to relational tables.
do $$
declare store jsonb;
begin
  select data into store from public.recalldesk_app_store where id = 'main';
  if store is null then
    return;
  end if;

  insert into public.app_users (id,name,email,role,is_active,password_hash,created_at,updated_at,password_reset_at,password_changed_at)
  select id, coalesce(name,email), lower(email), role, coalesce(is_active,true), password_hash,
         coalesce(nullif(created_at,'')::timestamptz, now()), nullif(updated_at,'')::timestamptz, nullif(password_reset_at,'')::timestamptz, nullif(password_changed_at,'')::timestamptz
  from jsonb_to_recordset(coalesce(store->'app_users','[]'::jsonb)) as x(id text,name text,email text,role text,is_active boolean,password_hash text,created_at text,updated_at text,password_reset_at text,password_changed_at text)
  where id is not null and email is not null and password_hash is not null
  on conflict (id) do update set name=excluded.name,email=excluded.email,role=excluded.role,is_active=excluded.is_active,password_hash=excluded.password_hash,updated_at=excluded.updated_at;

  insert into public.upload_batches (id,filename_summary,uploaded_by,raw_row_count,unique_visit_count,clean_patient_count,duplicate_row_count,invalid_phone_count,notes,storage_mode,created_at)
  select id, filename_summary, uploaded_by, coalesce(raw_row_count,0), coalesce(unique_visit_count,0), coalesce(clean_patient_count,0), coalesce(duplicate_row_count,0), coalesce(invalid_phone_count,0), notes, storage_mode, coalesce(nullif(created_at,'')::timestamptz, now())
  from jsonb_to_recordset(coalesce(store->'upload_batches','[]'::jsonb)) as x(id text,filename_summary text,uploaded_by text,raw_row_count int,unique_visit_count int,clean_patient_count int,duplicate_row_count int,invalid_phone_count int,notes text,storage_mode text,created_at text)
  where id is not null
  on conflict (id) do nothing;

  insert into public.visit_hashes (visit_hash, created_at)
  select value::text, now()
  from jsonb_array_elements_text(coalesce(store->'visit_hashes','[]'::jsonb))
  on conflict (visit_hash) do nothing;

  insert into public.clean_patients (id,standard_phone,display_name,patient_name_key,patient_name_keys,all_names,original_phones,original_phones_text,first_visit_date,last_visit_date,visit_count,years_visited,last_doctor,last_company,duplicate_risk_level,duplicate_risk_notes,recall_priority,assignment_status,assigned_to,do_not_call,created_at,updated_at)
  select id, standard_phone, display_name, patient_name_key, coalesce(patient_name_keys,'[]'::jsonb), coalesce(all_names,'[]'::jsonb), coalesce(original_phones,'[]'::jsonb),
         array_to_string(array(select jsonb_array_elements_text(coalesce(original_phones,'[]'::jsonb))), ' '),
         nullif(first_visit_date,'')::date, nullif(last_visit_date,'')::date, coalesce(visit_count,0), coalesce(years_visited,'[]'::jsonb), last_doctor, last_company,
         coalesce(duplicate_risk_level,'low'), duplicate_risk_notes, recall_priority, coalesce(assignment_status,'unassigned'), case when assigned_to in (select id from public.app_users) then assigned_to else null end, coalesce(do_not_call,false), now(), coalesce(nullif(updated_at,'')::timestamptz, now())
  from jsonb_to_recordset(coalesce(store->'patient_master','[]'::jsonb)) as x(id text,standard_phone text,display_name text,patient_name_key text,patient_name_keys jsonb,all_names jsonb,original_phones jsonb,first_visit_date text,last_visit_date text,visit_count int,years_visited jsonb,last_doctor text,last_company text,duplicate_risk_level text,duplicate_risk_notes text,recall_priority text,assignment_status text,assigned_to text,do_not_call boolean,updated_at text)
  where id is not null and standard_phone is not null
  on conflict (standard_phone) do update set display_name=excluded.display_name, patient_name_keys=excluded.patient_name_keys, all_names=excluded.all_names, original_phones=excluded.original_phones, original_phones_text=excluded.original_phones_text, first_visit_date=excluded.first_visit_date, last_visit_date=excluded.last_visit_date, visit_count=excluded.visit_count, years_visited=excluded.years_visited, last_doctor=excluded.last_doctor, last_company=excluded.last_company, duplicate_risk_level=excluded.duplicate_risk_level, duplicate_risk_notes=excluded.duplicate_risk_notes, recall_priority=excluded.recall_priority, assignment_status=excluded.assignment_status, assigned_to=excluded.assigned_to, do_not_call=excluded.do_not_call, updated_at=excluded.updated_at;

  insert into public.call_attempts (id,patient_id,staff_id,attempt_no,outcome,reached,booking_made,appointment_date,patient_feedback,notes,next_action,next_action_date,attempt_at,created_at,updated_at,edited_by)
  select id, patient_id, case when staff_id in (select id from public.app_users) then staff_id else null end, coalesce(attempt_no,1), outcome, coalesce(reached,false), coalesce(booking_made,false), nullif(appointment_date,'')::date, patient_feedback, notes, next_action, nullif(next_action_date,'')::date, coalesce(nullif(attempt_at,'')::timestamptz, now()), coalesce(nullif(created_at,'')::timestamptz, now()), coalesce(nullif(updated_at,'')::timestamptz, now()), edited_by
  from jsonb_to_recordset(coalesce(store->'call_attempts','[]'::jsonb)) as x(id text,patient_id text,staff_id text,attempt_no int,outcome text,reached boolean,booking_made boolean,appointment_date text,patient_feedback text,notes text,next_action text,next_action_date text,attempt_at text,created_at text,updated_at text,edited_by text)
  where id is not null and patient_id in (select id from public.clean_patients)
  on conflict (id) do nothing;

  insert into public.bookings (id,patient_id,staff_id,call_attempt_id,appointment_date,booking_status,attendance_status,created_at,updated_at)
  select id, patient_id, case when staff_id in (select id from public.app_users) then staff_id else null end, case when call_attempt_id in (select id from public.call_attempts) then call_attempt_id else null end, nullif(appointment_date,'')::date, coalesce(booking_status,'self_reported'), coalesce(attendance_status,'not_matured'), coalesce(nullif(created_at,'')::timestamptz, now()), coalesce(nullif(updated_at,'')::timestamptz, now())
  from jsonb_to_recordset(coalesce(store->'bookings','[]'::jsonb)) as x(id text,patient_id text,staff_id text,call_attempt_id text,appointment_date text,booking_status text,attendance_status text,created_at text,updated_at text)
  where id is not null and patient_id in (select id from public.clean_patients)
  on conflict (id) do nothing;

  insert into public.data_quality_flags (id,batch_id,patient_id,staff_id,call_attempt_id,flag_type,severity,status,description,closure_note,closed_at,closed_by,created_at)
  select id, batch_id, case when patient_id in (select id from public.clean_patients) then patient_id else null end, case when staff_id in (select id from public.app_users) then staff_id else null end, case when call_attempt_id in (select id from public.call_attempts) then call_attempt_id else null end, flag_type, coalesce(severity,'medium'), coalesce(status,'open'), description, closure_note, nullif(closed_at,'')::timestamptz, closed_by, coalesce(nullif(created_at,'')::timestamptz, now())
  from jsonb_to_recordset(coalesce(store->'data_quality_flags','[]'::jsonb)) as x(id text,batch_id text,patient_id text,staff_id text,call_attempt_id text,flag_type text,severity text,status text,description text,closure_note text,closed_at text,closed_by text,created_at text)
  where id is not null
  on conflict (id) do nothing;

  insert into public.audit_logs (id,actor_id,action,entity_type,entity_id,details,created_at)
  select id, actor_id, action, entity_type, entity_id, coalesce(details,'{}'::jsonb), coalesce(nullif(created_at,'')::timestamptz, now())
  from jsonb_to_recordset(coalesce(store->'audit_logs','[]'::jsonb)) as x(id text,actor_id text,action text,entity_type text,entity_id text,details jsonb,created_at text)
  where id is not null
  on conflict (id) do nothing;
end $$;
