
-- Add new columns to income_sources table
ALTER TABLE public.income_sources
  ADD COLUMN calc_method text NOT NULL DEFAULT 'mi',
  ADD COLUMN tip_percentage integer,
  ADD COLUMN ytd_gross numeric,
  ADD COLUMN ytd_months integer,
  ADD COLUMN manual_override_amount numeric,
  ADD COLUMN manual_override_reason text,
  ADD COLUMN missed_days_flag boolean NOT NULL DEFAULT false,
  ADD COLUMN additional_docs_requested text[] NOT NULL DEFAULT '{}';

-- Add needs_review to income_verification_status enum
ALTER TYPE public.income_verification_status ADD VALUE IF NOT EXISTS 'needs_review';
