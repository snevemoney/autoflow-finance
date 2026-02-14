
-- Add vehicle_for_work and benefit_cap_applied to income_sources
ALTER TABLE public.income_sources
  ADD COLUMN IF NOT EXISTS vehicle_for_work boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS benefit_cap_applied boolean NOT NULL DEFAULT false;

-- Add residency_status and work_authorization_expiry to deals
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS residency_status text DEFAULT null,
  ADD COLUMN IF NOT EXISTS work_authorization_expiry date DEFAULT null;
