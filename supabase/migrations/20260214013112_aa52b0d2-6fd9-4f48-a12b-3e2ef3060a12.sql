-- Add income_source_id column to link extractions to specific income sources
ALTER TABLE public.extracted_income_data
ADD COLUMN income_source_id uuid REFERENCES public.income_sources(id) ON DELETE SET NULL;

-- Add index for efficient lookups
CREATE INDEX idx_extracted_income_source ON public.extracted_income_data(income_source_id);
