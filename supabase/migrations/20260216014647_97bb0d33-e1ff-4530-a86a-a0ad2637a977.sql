
-- Create debt_type enum
CREATE TYPE public.debt_type AS ENUM (
  'garnishment', 'child_support', 'auto_loan', 'student_loan', 'credit_card', 'mortgage', 'medical', 'other'
);

-- Create applicant_debts table
CREATE TABLE public.applicant_debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  debt_type public.debt_type NOT NULL,
  creditor_name text NOT NULL,
  monthly_payment numeric NOT NULL,
  total_balance numeric,
  months_remaining integer,
  is_court_ordered boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

-- Enable RLS
ALTER TABLE public.applicant_debts ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Authenticated users can view debts"
  ON public.applicant_debts FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can insert debts"
  ON public.applicant_debts FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update debts"
  ON public.applicant_debts FOR UPDATE
  USING (true);

CREATE POLICY "Admins can delete debts"
  ON public.applicant_debts FOR DELETE
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Index for deal lookups
CREATE INDEX idx_applicant_debts_deal_id ON public.applicant_debts(deal_id);
