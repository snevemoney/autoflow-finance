import { Deal, Dealer, User, Notification, DealStatus } from '@/types/deal';

export const mockDealers: Dealer[] = [
  {
    id: 'dealer-1',
    name: 'Premier Auto Group',
    code: 'PAG001',
    contactName: 'Michael Torres',
    email: 'mtorres@premierauto.com',
    phone: '(555) 123-4567',
    address: { street: '1200 Main St', city: 'Dallas', state: 'TX', zip: '75201' },
    activeDeals: 12,
    totalDeals: 245,
    approvalRate: 78,
    status: 'active',
    createdAt: '2023-01-15T10:00:00Z',
  },
  {
    id: 'dealer-2',
    name: 'Sunset Motors',
    code: 'SUN002',
    contactName: 'Sarah Johnson',
    email: 'sjohnson@sunsetmotors.com',
    phone: '(555) 234-5678',
    address: { street: '4500 Sunset Blvd', city: 'Houston', state: 'TX', zip: '77001' },
    activeDeals: 8,
    totalDeals: 189,
    approvalRate: 82,
    status: 'active',
    createdAt: '2023-02-20T10:00:00Z',
  },
  {
    id: 'dealer-3',
    name: 'Valley Auto Sales',
    code: 'VAS003',
    contactName: 'Robert Chen',
    email: 'rchen@valleyauto.com',
    phone: '(555) 345-6789',
    address: { street: '789 Valley Dr', city: 'Austin', state: 'TX', zip: '78701' },
    activeDeals: 5,
    totalDeals: 134,
    approvalRate: 75,
    status: 'active',
    createdAt: '2023-03-10T10:00:00Z',
  },
];

export const mockUsers: User[] = [
  {
    id: 'user-1',
    email: 'admin@autofinance.com',
    name: 'Alex Morgan',
    role: 'admin',
    department: 'admin',
    isActive: true,
    lastLogin: new Date().toISOString(),
    createdAt: '2023-01-01T10:00:00Z',
  },
  {
    id: 'user-2',
    email: 'jennifer.lee@autofinance.com',
    name: 'Jennifer Lee',
    role: 'credit_analyst',
    department: 'credit',
    isActive: true,
    lastLogin: new Date().toISOString(),
    createdAt: '2023-01-15T10:00:00Z',
  },
  {
    id: 'user-3',
    email: 'marcus.chen@autofinance.com',
    name: 'Marcus Chen',
    role: 'income_verifier',
    department: 'income',
    isActive: true,
    lastLogin: new Date().toISOString(),
    createdAt: '2023-02-01T10:00:00Z',
  },
  {
    id: 'user-4',
    email: 'sarah.wilson@autofinance.com',
    name: 'Sarah Wilson',
    role: 'funding_manager',
    department: 'funding',
    isActive: true,
    lastLogin: new Date().toISOString(),
    createdAt: '2023-02-15T10:00:00Z',
  },
];

const generateDeal = (id: number, status: DealStatus): Deal => {
  const customers = [
    { firstName: 'John', lastName: 'Smith', email: 'john.smith@email.com' },
    { firstName: 'Emily', lastName: 'Davis', email: 'emily.davis@email.com' },
    { firstName: 'Michael', lastName: 'Johnson', email: 'michael.j@email.com' },
    { firstName: 'Sarah', lastName: 'Williams', email: 'sarah.w@email.com' },
    { firstName: 'David', lastName: 'Brown', email: 'david.brown@email.com' },
    { firstName: 'Jessica', lastName: 'Martinez', email: 'jessica.m@email.com' },
    { firstName: 'Chris', lastName: 'Garcia', email: 'chris.garcia@email.com' },
    { firstName: 'Amanda', lastName: 'Anderson', email: 'amanda.a@email.com' },
  ];

  const vehicles = [
    { year: 2024, make: 'Toyota', model: 'Camry', trim: 'XSE' },
    { year: 2024, make: 'Honda', model: 'Accord', trim: 'Sport' },
    { year: 2023, make: 'Ford', model: 'F-150', trim: 'XLT' },
    { year: 2024, make: 'Chevrolet', model: 'Silverado', trim: 'LT' },
    { year: 2023, make: 'BMW', model: '3 Series', trim: '330i' },
    { year: 2024, make: 'Mercedes-Benz', model: 'C-Class', trim: 'C300' },
    { year: 2023, make: 'Hyundai', model: 'Tucson', trim: 'SEL' },
    { year: 2024, make: 'Kia', model: 'Telluride', trim: 'EX' },
  ];

  const customer = customers[id % customers.length];
  const vehicle = vehicles[id % vehicles.length];
  const dealer = mockDealers[id % mockDealers.length];
  
  const loanAmount = Math.floor(Math.random() * 40000) + 15000;
  const downPayment = Math.floor(loanAmount * (Math.random() * 0.2 + 0.1));
  const apr = Math.random() * 8 + 4;
  const termMonths = [36, 48, 60, 72][Math.floor(Math.random() * 4)];
  const monthlyPayment = (loanAmount - downPayment) * (apr / 100 / 12) / (1 - Math.pow(1 + apr / 100 / 12, -termMonths));
  
  const creditScore = Math.floor(Math.random() * 250) + 550;
  let tier: 'prime' | 'near_prime' | 'subprime' | 'deep_subprime' = 'subprime';
  if (creditScore >= 720) tier = 'prime';
  else if (creditScore >= 660) tier = 'near_prime';
  else if (creditScore >= 600) tier = 'subprime';
  else tier = 'deep_subprime';

  const daysAgo = Math.floor(Math.random() * 14);
  const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();

  return {
    id: `deal-${id}`,
    dealNumber: `AF-2024-${String(id).padStart(5, '0')}`,
    status,
    priority: ['low', 'normal', 'high', 'urgent'][Math.floor(Math.random() * 4)] as Deal['priority'],
    
    customer: {
      id: `customer-${id}`,
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      phone: `(555) ${String(Math.floor(Math.random() * 900) + 100)}-${String(Math.floor(Math.random() * 9000) + 1000)}`,
      address: {
        street: `${Math.floor(Math.random() * 9000) + 1000} Oak St`,
        city: ['Dallas', 'Houston', 'Austin', 'San Antonio'][Math.floor(Math.random() * 4)],
        state: 'TX',
        zip: String(75000 + Math.floor(Math.random() * 5000)),
      },
      employmentInfo: {
        employer: ['Tech Corp', 'Healthcare Inc', 'Finance LLC', 'Retail Co'][Math.floor(Math.random() * 4)],
        jobTitle: ['Manager', 'Engineer', 'Analyst', 'Specialist'][Math.floor(Math.random() * 4)],
        monthlyIncome: Math.floor(Math.random() * 6000) + 3000,
        yearsEmployed: Math.floor(Math.random() * 10) + 1,
      },
    },
    
    vehicle: {
      ...vehicle,
      vin: `1HGBH41JXMN${String(Math.floor(Math.random() * 1000000)).padStart(6, '0')}`,
      mileage: vehicle.year === 2024 ? Math.floor(Math.random() * 500) : Math.floor(Math.random() * 30000) + 5000,
      color: ['White', 'Black', 'Silver', 'Blue', 'Red'][Math.floor(Math.random() * 5)],
      condition: vehicle.year === 2024 ? 'new' : Math.random() > 0.5 ? 'certified' : 'used',
      invoicePrice: loanAmount + downPayment,
      msrp: (loanAmount + downPayment) * 1.05,
    },
    
    financingTerms: {
      loanAmount,
      downPayment,
      apr: Math.round(apr * 100) / 100,
      termMonths,
      monthlyPayment: Math.round(monthlyPayment * 100) / 100,
      totalInterest: Math.round((monthlyPayment * termMonths - (loanAmount - downPayment)) * 100) / 100,
      totalCost: Math.round(monthlyPayment * termMonths * 100) / 100,
    },
    
    creditInfo: {
      score: creditScore,
      bureau: ['experian', 'equifax', 'transunion'][Math.floor(Math.random() * 3)] as 'experian' | 'equifax' | 'transunion',
      pulledAt: createdAt,
      tier,
    },
    
    dealerId: dealer.id,
    dealerName: dealer.name,
    dealerContact: dealer.contactName,
    
    assignedTo: status !== 'new_submission' ? mockUsers[Math.floor(Math.random() * 3) + 1].id : undefined,
    assignedDepartment: status === 'credit_review' ? 'credit' : status === 'income_verification' ? 'income' : status === 'funding_review' ? 'funding' : undefined,
    
    documents: [
      {
        id: `doc-${id}-1`,
        dealId: `deal-${id}`,
        name: 'Credit Application.pdf',
        type: 'credit_application',
        fileUrl: '/documents/credit-app.pdf',
        fileSize: 245000,
        uploadedAt: createdAt,
        uploadedBy: dealer.contactName,
        status: 'verified',
      },
      {
        id: `doc-${id}-2`,
        dealId: `deal-${id}`,
        name: 'Pay Stub - Recent.pdf',
        type: 'pay_stub',
        fileUrl: '/documents/paystub.pdf',
        fileSize: 125000,
        uploadedAt: createdAt,
        uploadedBy: dealer.contactName,
        status: status === 'income_verification' ? 'pending' : 'verified',
      },
    ],
    
    notes: [
      {
        id: `note-${id}-1`,
        dealId: `deal-${id}`,
        content: 'Deal submitted via dealer portal. All initial documents attached.',
        createdAt,
        createdBy: dealer.contactName,
        isInternal: false,
      },
    ],
    
    timeline: [
      {
        id: `event-${id}-1`,
        dealId: `deal-${id}`,
        type: 'status_change',
        description: 'Deal submitted',
        createdAt,
        createdBy: dealer.contactName,
      },
    ],
    
    createdAt,
    updatedAt: new Date().toISOString(),
    
    flags: creditScore < 620 ? ['Low Credit Score'] : [],
    ltv: Math.round(((loanAmount - downPayment) / (loanAmount + downPayment)) * 100),
  };
};

// Seeded deal matching database records (3 income sources + unmatched extraction)
const seededDeal: Deal = {
  id: 'a1b2c3d4-0004-4000-8000-000000000004',
  dealNumber: 'AF-2026-00001',
  status: 'income_verification',
  priority: 'normal',
  customer: {
    id: 'a1b2c3d4-0002-4000-8000-000000000002',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane.doe@example.com',
    phone: '(555) 867-5309',
    address: { street: '123 Main St', city: 'Dallas', state: 'TX', zip: '75201' },
    employmentInfo: {
      employer: 'Acme Corp',
      jobTitle: 'Senior Analyst',
      monthlyIncome: 5500,
      yearsEmployed: 3,
    },
  },
  vehicle: {
    year: 2024,
    make: 'Toyota',
    model: 'Camry',
    trim: 'SE',
    vin: '1HGCG5655WA041389',
    mileage: 12000,
    color: 'Silver',
    condition: 'used',
    invoicePrice: 28500,
    msrp: 30000,
  },
  financingTerms: {
    loanAmount: 25000,
    downPayment: 3000,
    apr: 6.9,
    termMonths: 72,
    monthlyPayment: 436.31,
    totalInterest: 6414.32,
    totalCost: 31414.32,
  },
  creditInfo: {
    score: 680,
    bureau: 'experian',
    pulledAt: '2026-02-10T10:00:00Z',
    tier: 'near_prime',
  },
  dealerId: 'a1b2c3d4-0001-4000-8000-000000000001',
  dealerName: 'Metro Auto Group',
  dealerContact: 'John Metro',
  assignedTo: 'user-3',
  assignedDepartment: 'income',
  documents: [
    {
      id: 'a1b2c3d4-0020-4000-8000-000000000001',
      dealId: 'a1b2c3d4-0004-4000-8000-000000000004',
      name: 'Pay Stub - Jan 2026',
      type: 'pay_stub',
      fileUrl: 'documents/test/jane_doe_paystub.png',
      fileSize: 245000,
      uploadedAt: '2026-02-10T10:00:00Z',
      uploadedBy: 'John Metro',
      status: 'pending',
    },
  ],
  notes: [
    {
      id: 'note-seed-1',
      dealId: 'a1b2c3d4-0004-4000-8000-000000000004',
      content: 'Seeded test deal with 3 income sources for calculator testing.',
      createdAt: '2026-02-10T10:00:00Z',
      createdBy: 'System',
      isInternal: true,
    },
  ],
  timeline: [
    {
      id: 'event-seed-1',
      dealId: 'a1b2c3d4-0004-4000-8000-000000000004',
      type: 'status_change',
      description: 'Deal submitted',
      createdAt: '2026-02-10T10:00:00Z',
      createdBy: 'John Metro',
    },
  ],
  createdAt: '2026-02-10T10:00:00Z',
  updatedAt: '2026-02-10T10:00:00Z',
  flags: [],
  ltv: 77,
};

export const mockDeals: Deal[] = [
  // Seeded deal with real DB income sources
  seededDeal,
  // New submissions
  ...Array.from({ length: 4 }, (_, i) => generateDeal(i + 1, 'new_submission')),
  // Document review
  ...Array.from({ length: 3 }, (_, i) => generateDeal(i + 5, 'document_review')),
  // Credit review
  ...Array.from({ length: 5 }, (_, i) => generateDeal(i + 8, 'credit_review')),
  // Income verification
  ...Array.from({ length: 4 }, (_, i) => generateDeal(i + 13, 'income_verification')),
  // Funding review
  ...Array.from({ length: 3 }, (_, i) => generateDeal(i + 17, 'funding_review')),
  // Approved
  ...Array.from({ length: 6 }, (_, i) => generateDeal(i + 20, 'approved')),
  // Funded
  ...Array.from({ length: 8 }, (_, i) => generateDeal(i + 26, 'funded')),
  // Declined
  ...Array.from({ length: 2 }, (_, i) => generateDeal(i + 34, 'declined')),
];

export const mockNotifications: Notification[] = [
  {
    id: 'notif-1',
    userId: 'user-1',
    title: 'New Deal Submitted',
    message: 'Premier Auto Group submitted deal AF-2024-00001',
    type: 'info',
    read: false,
    dealId: 'deal-1',
    createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  },
  {
    id: 'notif-2',
    userId: 'user-1',
    title: 'Deal Approved',
    message: 'Deal AF-2024-00020 has been approved for funding',
    type: 'success',
    read: false,
    dealId: 'deal-20',
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'notif-3',
    userId: 'user-1',
    title: 'Documents Required',
    message: 'Deal AF-2024-00005 is missing income verification documents',
    type: 'warning',
    read: true,
    dealId: 'deal-5',
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'notif-4',
    userId: 'user-1',
    title: 'Deal Declined',
    message: 'Deal AF-2024-00034 has been declined due to credit issues',
    type: 'error',
    read: true,
    dealId: 'deal-34',
    createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
  },
];

export const getDealsByStatus = (status: DealStatus): Deal[] => {
  return mockDeals.filter(deal => deal.status === status);
};

export const getDealById = (id: string): Deal | undefined => {
  return mockDeals.find(deal => deal.id === id);
};

export const getDealsByDepartment = (department: 'credit' | 'income' | 'funding'): Deal[] => {
  const statusMap = {
    credit: 'credit_review',
    income: 'income_verification',
    funding: 'funding_review',
  };
  return mockDeals.filter(deal => deal.status === statusMap[department]);
};
