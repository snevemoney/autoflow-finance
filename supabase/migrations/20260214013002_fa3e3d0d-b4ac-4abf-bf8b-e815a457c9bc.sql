-- Add new income source types
ALTER TYPE public.income_source_type ADD VALUE IF NOT EXISTS 'unemployed';
ALTER TYPE public.income_source_type ADD VALUE IF NOT EXISTS 'pension';
ALTER TYPE public.income_source_type ADD VALUE IF NOT EXISTS 'government_assistance';