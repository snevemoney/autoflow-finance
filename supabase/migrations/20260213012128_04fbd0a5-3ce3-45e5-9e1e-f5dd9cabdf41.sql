
-- Add calculated_monthly_income to deals
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS calculated_monthly_income numeric DEFAULT NULL;

-- Add employer verification fields to customers
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS employer_verified boolean DEFAULT false;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS employer_verification_data jsonb DEFAULT NULL;
