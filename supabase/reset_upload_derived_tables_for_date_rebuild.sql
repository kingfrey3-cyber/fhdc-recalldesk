-- FHDC RecallDesk upload-derived data reset
-- Run this AFTER applying the date/doctor parser patch and BEFORE re-uploading visit exports.
-- This preserves users, payment assumptions and app configuration.
-- It clears upload-derived recall data so the patient list can be rebuilt with correct last visit dates and doctors.

create table if not exists public.clean_patients_backup_before_date_rebuild as
select *, now() as backup_created_at
from public.clean_patients;

create table if not exists public.call_attempts_backup_before_date_rebuild as
select *, now() as backup_created_at
from public.call_attempts;

create table if not exists public.bookings_backup_before_date_rebuild as
select *, now() as backup_created_at
from public.bookings;

create table if not exists public.data_quality_flags_backup_before_date_rebuild as
select *, now() as backup_created_at
from public.data_quality_flags;

create table if not exists public.upload_batches_backup_before_date_rebuild as
select *, now() as backup_created_at
from public.upload_batches;

create table if not exists public.visit_hashes_backup_before_date_rebuild as
select *, now() as backup_created_at
from public.visit_hashes;

truncate table public.call_attempts cascade;
truncate table public.bookings cascade;
truncate table public.data_quality_flags cascade;
truncate table public.clean_patients cascade;
truncate table public.visit_hashes cascade;
truncate table public.upload_batches cascade;
