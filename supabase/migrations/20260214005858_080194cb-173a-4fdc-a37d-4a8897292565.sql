
-- Create income source type enum
CREATE TYPE public.income_source_type AS ENUM ('salaried', 'part_time', 'self_employed', 'contractor', 'seasonal', 'education');

-- Create income verification status enum
CREATE TYPE public.income_verification_status AS ENUM ('unverified', 'verified', 'flagged', 'insufficient_docs');

-- Create income_sources table
CREATE TABLE public.income_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  source_type public.income_source_type NOT NULL,
  employer_name text NOT NULL,
  job_title text,
  stated_monthly_income numeric NOT NULL DEFAULT 0,
  calculated_monthly_income numeric,
  pay_frequency text, -- weekly, biweekly, semimonthly, monthly, annual, contract
  contract_months integer, -- For education workers
  hours_per_week numeric, -- For part-time/hourly
  hourly_rate numeric, -- For part-time/hourly
  is_primary boolean NOT NULL DEFAULT false,
  verification_status public.income_verification_status NOT NULL DEFAULT 'unverified',
  flag_reasons text[] DEFAULT '{}'::text[],
  verified_at timestamptz,
  verified_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.income_sources ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Authenticated users can view income sources"
  ON public.income_sources FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert income sources"
  ON public.income_sources FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update income sources"
  ON public.income_sources FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Admins can delete income sources"
  ON public.income_sources FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Auto-update updated_at
CREATE TRIGGER update_income_sources_updated_at
  BEFORE UPDATE ON public.income_sources
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
