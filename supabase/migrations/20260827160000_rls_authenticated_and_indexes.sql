-- Tighten policies that previously used USING (true) without a role
-- so the anon key cannot read/write these tables.

DROP POLICY IF EXISTS "Authenticated users can view extracted data" ON public.extracted_income_data;
CREATE POLICY "Authenticated users can view extracted data"
  ON public.extracted_income_data FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert extracted data" ON public.extracted_income_data;
CREATE POLICY "Authenticated users can insert extracted data"
  ON public.extracted_income_data FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update extracted data" ON public.extracted_income_data;
CREATE POLICY "Authenticated users can update extracted data"
  ON public.extracted_income_data FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can view debts" ON public.applicant_debts;
CREATE POLICY "Authenticated users can view debts"
  ON public.applicant_debts FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert debts" ON public.applicant_debts;
CREATE POLICY "Authenticated users can insert debts"
  ON public.applicant_debts FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update debts" ON public.applicant_debts;
CREATE POLICY "Authenticated users can update debts"
  ON public.applicant_debts FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can delete debts" ON public.applicant_debts;
CREATE POLICY "Admins can delete debts"
  ON public.applicant_debts FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Indexes for list/filter/join paths used by the app
CREATE INDEX IF NOT EXISTS idx_deals_status ON public.deals(status);
CREATE INDEX IF NOT EXISTS idx_deals_created_at ON public.deals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_customer_id ON public.deals(customer_id);
CREATE INDEX IF NOT EXISTS idx_deals_dealer_id ON public.deals(dealer_id);
CREATE INDEX IF NOT EXISTS idx_documents_deal_id ON public.documents(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_notes_deal_id ON public.deal_notes(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_timeline_deal_id ON public.deal_timeline(deal_id);
CREATE INDEX IF NOT EXISTS idx_income_sources_deal_id ON public.income_sources(deal_id);
CREATE INDEX IF NOT EXISTS idx_income_sources_customer_id ON public.income_sources(customer_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_applicant_debts_customer_id ON public.applicant_debts(customer_id);
