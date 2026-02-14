export type DealStatus = 
  | 'new_submission'
  | 'document_review'
  | 'credit_review'
  | 'income_verification'
  | 'funding_review'
  | 'approved'
  | 'funded'
  | 'declined'
  | 'incomplete';

export type DocumentType = 
  | 'credit_application'
  | 'income_verification'
  | 'pay_stub'
  | 'bank_statement'
  | 'vehicle_invoice'
  | 'trade_in'
  | 'insurance'
  | 'id_verification'
  | 'other';

export type UserRole = 'dealer' | 'credit_analyst' | 'income_verifier' | 'funding_manager' | 'admin';

export interface Document {
  id: string;
  dealId: string;
  name: string;
  type: DocumentType;
  fileUrl: string;
  fileSize: number;
  uploadedAt: string;
  uploadedBy: string;
  status: 'pending' | 'verified' | 'rejected';
  notes?: string;
}

export interface DealNote {
  id: string;
  dealId: string;
  content: string;
  createdAt: string;
  createdBy: string;
  isInternal: boolean;
}

export interface TimelineEvent {
  id: string;
  dealId: string;
  type: 'status_change' | 'document_upload' | 'note_added' | 'assignment' | 'email_sent';
  description: string;
  createdAt: string;
  createdBy: string;
  metadata?: Record<string, unknown>;
}

export interface Customer {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  ssn?: string;
  dateOfBirth?: string;
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  employmentInfo?: {
    employer: string;
    jobTitle: string;
    monthlyIncome: number;
    yearsEmployed: number;
  };
}

export interface Vehicle {
  year: number;
  make: string;
  model: string;
  trim?: string;
  vin: string;
  mileage: number;
  color?: string;
  condition: 'new' | 'used' | 'certified';
  msrp?: number;
  invoicePrice: number;
}

export interface TradeIn {
  year: number;
  make: string;
  model: string;
  vin: string;
  mileage: number;
  payoffAmount?: number;
  estimatedValue: number;
}

export interface FinancingTerms {
  loanAmount: number;
  downPayment: number;
  tradeInValue?: number;
  apr: number;
  termMonths: number;
  monthlyPayment: number;
  totalInterest: number;
  totalCost: number;
}

export interface CreditInfo {
  score: number;
  bureau: 'experian' | 'equifax' | 'transunion';
  pulledAt: string;
  tier: 'prime' | 'near_prime' | 'subprime' | 'deep_subprime';
}

export interface Deal {
  id: string;
  dealNumber: string;
  status: DealStatus;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  
  customer: Customer;
  vehicle: Vehicle;
  tradeIn?: TradeIn;
  financingTerms: FinancingTerms;
  creditInfo?: CreditInfo;
  
  dealerId: string;
  dealerName: string;
  dealerContact: string;
  
  assignedTo?: string;
  assignedDepartment?: 'credit' | 'income' | 'funding';
  
  documents: Document[];
  notes: DealNote[];
  timeline: TimelineEvent[];
  
  decisionNotes?: string;
  decisionBy?: string;
  decisionAt?: string;
  
  fundedAt?: string;
  fundedAmount?: number;
  
  createdAt: string;
  updatedAt: string;
  
  flags: string[];
  ltv: number; // Loan-to-value ratio
}

export interface Dealer {
  id: string;
  name: string;
  code: string;
  contactName: string;
  email: string;
  phone: string;
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  activeDeals: number;
  totalDeals: number;
  approvalRate: number;
  status: 'active' | 'suspended' | 'pending';
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  department?: 'credit' | 'income' | 'funding' | 'admin';
  avatar?: string;
  isActive: boolean;
  lastLogin?: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  read: boolean;
  dealId?: string;
  createdAt: string;
}

export const DEAL_STATUS_CONFIG: Record<DealStatus, { label: string; color: string; bgColor: string }> = {
  new_submission: { label: 'New Submission', color: 'text-info', bgColor: 'bg-info/10' },
  document_review: { label: 'Document Review', color: 'text-warning', bgColor: 'bg-warning/10' },
  credit_review: { label: 'Credit Review', color: 'text-warning', bgColor: 'bg-warning/10' },
  income_verification: { label: 'Income Verification', color: 'text-warning', bgColor: 'bg-warning/10' },
  funding_review: { label: 'Funding Review', color: 'text-info', bgColor: 'bg-info/10' },
  approved: { label: 'Approved', color: 'text-success', bgColor: 'bg-success/10' },
  funded: { label: 'Funded', color: 'text-accent', bgColor: 'bg-accent/10' },
  declined: { label: 'Declined', color: 'text-destructive', bgColor: 'bg-destructive/10' },
  incomplete: { label: 'Incomplete', color: 'text-muted-foreground', bgColor: 'bg-muted' },
};

export const DOCUMENT_TYPE_CONFIG: Record<DocumentType, { label: string; icon: string }> = {
  credit_application: { label: 'Credit Application', icon: 'FileText' },
  income_verification: { label: 'Income Verification', icon: 'DollarSign' },
  pay_stub: { label: 'Pay Stub', icon: 'Receipt' },
  bank_statement: { label: 'Bank Statement', icon: 'Building2' },
  vehicle_invoice: { label: 'Vehicle Invoice', icon: 'Car' },
  trade_in: { label: 'Trade-In Documentation', icon: 'ArrowLeftRight' },
  insurance: { label: 'Insurance Proof', icon: 'Shield' },
  id_verification: { label: 'ID Verification', icon: 'CreditCard' },
  other: { label: 'Other', icon: 'File' },
};

// Multi-source income types
export type IncomeSourceType = 'salaried' | 'part_time' | 'self_employed' | 'contractor' | 'seasonal' | 'education';
export type IncomeVerificationStatus = 'unverified' | 'verified' | 'flagged' | 'insufficient_docs';

export interface IncomeSource {
  id: string;
  deal_id: string;
  customer_id: string;
  source_type: IncomeSourceType;
  employer_name: string;
  job_title: string | null;
  stated_monthly_income: number;
  calculated_monthly_income: number | null;
  pay_frequency: string | null;
  contract_months: number | null;
  hours_per_week: number | null;
  hourly_rate: number | null;
  is_primary: boolean;
  verification_status: IncomeVerificationStatus;
  flag_reasons: string[];
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
  updated_at: string;
}
