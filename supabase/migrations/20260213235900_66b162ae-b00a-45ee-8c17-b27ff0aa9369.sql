
-- Create extracted_income_data table for OCR results
CREATE TABLE public.extracted_income_data (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  gross_pay NUMERIC,
  net_pay NUMERIC,
  pay_frequency TEXT CHECK (pay_frequency IN ('weekly', 'biweekly', 'semimonthly', 'monthly')),
  pay_date DATE,
  employer_name_on_doc TEXT,
  ytd_gross NUMERIC,
  raw_extracted_text TEXT,
  confidence TEXT NOT NULL DEFAULT 'medium' CHECK (confidence IN ('high', 'medium', 'low')),
  extracted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Unique constraint: one extraction per document
ALTER TABLE public.extracted_income_data ADD CONSTRAINT unique_document_extraction UNIQUE (document_id);

-- Enable RLS
ALTER TABLE public.extracted_income_data ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Authenticated users can view extracted data"
  ON public.extracted_income_data FOR SELECT USING (true);

CREATE POLICY "Authenticated users can insert extracted data"
  ON public.extracted_income_data FOR INSERT WITH CHECK (true);

CREATE POLICY "Authenticated users can update extracted data"
  ON public.extracted_income_data FOR UPDATE USING (true);

-- Index for fast lookups by deal
CREATE INDEX idx_extracted_income_data_deal_id ON public.extracted_income_data(deal_id);
CREATE INDEX idx_extracted_income_data_document_id ON public.extracted_income_data(document_id);
