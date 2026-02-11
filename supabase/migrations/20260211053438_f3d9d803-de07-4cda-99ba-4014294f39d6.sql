
-- Create enum types
CREATE TYPE public.deal_status AS ENUM (
  'new_submission', 'document_review', 'credit_review', 'income_verification',
  'funding_review', 'approved', 'funded', 'declined', 'incomplete'
);

CREATE TYPE public.deal_priority AS ENUM ('low', 'normal', 'high', 'urgent');
CREATE TYPE public.vehicle_condition AS ENUM ('new', 'used', 'certified');
CREATE TYPE public.document_type AS ENUM (
  'credit_application', 'income_verification', 'pay_stub', 'bank_statement',
  'vehicle_invoice', 'trade_in', 'insurance', 'id_verification', 'other'
);
CREATE TYPE public.document_status AS ENUM ('pending', 'verified', 'rejected');
CREATE TYPE public.dealer_status AS ENUM ('active', 'suspended', 'pending');
CREATE TYPE public.credit_bureau AS ENUM ('experian', 'equifax', 'transunion');
CREATE TYPE public.credit_tier AS ENUM ('prime', 'near_prime', 'subprime', 'deep_subprime');
CREATE TYPE public.timeline_event_type AS ENUM (
  'status_change', 'document_upload', 'note_added', 'assignment', 'email_sent'
);
CREATE TYPE public.notification_type AS ENUM ('info', 'success', 'warning', 'error');
CREATE TYPE public.app_role AS ENUM ('dealer', 'credit_analyst', 'income_verifier', 'funding_manager', 'admin');
CREATE TYPE public.department AS ENUM ('credit', 'income', 'funding', 'admin');

-- Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  department public.department,
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User roles table (separate from profiles per security requirements)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);

-- Security definer function for role checks
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Dealers table
CREATE TABLE public.dealers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  street TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  status public.dealer_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Customers table
CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  ssn TEXT,
  date_of_birth DATE,
  street TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  employer TEXT,
  job_title TEXT,
  monthly_income NUMERIC,
  years_employed NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vehicles table
CREATE TABLE public.vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year INTEGER NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  trim TEXT,
  vin TEXT NOT NULL,
  mileage INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  condition public.vehicle_condition NOT NULL DEFAULT 'used',
  msrp NUMERIC,
  invoice_price NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Deals table
CREATE TABLE public.deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_number TEXT NOT NULL UNIQUE,
  status public.deal_status NOT NULL DEFAULT 'new_submission',
  priority public.deal_priority NOT NULL DEFAULT 'normal',
  
  customer_id UUID REFERENCES public.customers(id) NOT NULL,
  vehicle_id UUID REFERENCES public.vehicles(id) NOT NULL,
  dealer_id UUID REFERENCES public.dealers(id) NOT NULL,
  
  -- Trade-in info (optional, embedded)
  trade_in_year INTEGER,
  trade_in_make TEXT,
  trade_in_model TEXT,
  trade_in_vin TEXT,
  trade_in_mileage INTEGER,
  trade_in_payoff NUMERIC,
  trade_in_value NUMERIC,
  
  -- Financing terms
  loan_amount NUMERIC NOT NULL,
  down_payment NUMERIC NOT NULL DEFAULT 0,
  trade_in_credit NUMERIC,
  apr NUMERIC NOT NULL,
  term_months INTEGER NOT NULL,
  monthly_payment NUMERIC NOT NULL,
  total_interest NUMERIC NOT NULL,
  total_cost NUMERIC NOT NULL,
  
  -- Credit info
  credit_score INTEGER,
  credit_bureau public.credit_bureau,
  credit_pulled_at TIMESTAMPTZ,
  credit_tier public.credit_tier,
  
  -- Assignment
  assigned_to UUID REFERENCES auth.users(id),
  assigned_department public.department,
  
  -- Decision
  decision_notes TEXT,
  decision_by UUID REFERENCES auth.users(id),
  decision_at TIMESTAMPTZ,
  
  -- Funding
  funded_at TIMESTAMPTZ,
  funded_amount NUMERIC,
  
  -- Metadata
  flags TEXT[] DEFAULT '{}',
  ltv NUMERIC,
  
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Documents table
CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES public.deals(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  type public.document_type NOT NULL DEFAULT 'other',
  file_url TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  uploaded_by UUID REFERENCES auth.users(id),
  status public.document_status NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Deal notes table
CREATE TABLE public.deal_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES public.deals(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) NOT NULL,
  is_internal BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Deal timeline table
CREATE TABLE public.deal_timeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES public.deals(id) ON DELETE CASCADE NOT NULL,
  type public.timeline_event_type NOT NULL,
  description TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Notifications table
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type public.notification_type NOT NULL DEFAULT 'info',
  read BOOLEAN NOT NULL DEFAULT false,
  deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Apply updated_at triggers
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_dealers_updated_at BEFORE UPDATE ON public.dealers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_deals_updated_at BEFORE UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', NEW.email), NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Deal number sequence
CREATE SEQUENCE public.deal_number_seq START 1;

CREATE OR REPLACE FUNCTION public.generate_deal_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.deal_number IS NULL OR NEW.deal_number = '' THEN
    NEW.deal_number := 'AF-' || TO_CHAR(now(), 'YYYY') || '-' || LPAD(nextval('public.deal_number_seq')::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER set_deal_number BEFORE INSERT ON public.deals FOR EACH ROW EXECUTE FUNCTION public.generate_deal_number();

-- ============ RLS POLICIES ============

-- Profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view all profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "System can insert profiles" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- User roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all roles" ON public.user_roles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Dealers
ALTER TABLE public.dealers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view dealers" ON public.dealers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage dealers" ON public.dealers FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Customers (PII - restricted)
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view customers" ON public.customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert customers" ON public.customers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Admins can manage customers" ON public.customers FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Vehicles
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view vehicles" ON public.vehicles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert vehicles" ON public.vehicles FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Admins can manage vehicles" ON public.vehicles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Deals
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view deals" ON public.deals FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert deals" ON public.deals FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update deals" ON public.deals FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Admins can delete deals" ON public.deals FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Documents
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view documents" ON public.documents FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert documents" ON public.documents FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update documents" ON public.documents FOR UPDATE TO authenticated USING (true);

-- Deal notes
ALTER TABLE public.deal_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view notes" ON public.deal_notes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert notes" ON public.deal_notes FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

-- Deal timeline
ALTER TABLE public.deal_timeline ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view timeline" ON public.deal_timeline FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert timeline" ON public.deal_timeline FOR INSERT TO authenticated WITH CHECK (true);

-- Notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own notifications" ON public.notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can update own notifications" ON public.notifications FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "System can insert notifications" ON public.notifications FOR INSERT TO authenticated WITH CHECK (true);

-- Enable realtime for key tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.deals;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- Document storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', false);

CREATE POLICY "Authenticated users can upload documents" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'documents');
CREATE POLICY "Authenticated users can view documents" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'documents');
