import { Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { AdminRoute, FullPageSpinner, ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout, DealerLayout } from "@/components/layout/AppLayout";
import { useRouteTitle } from "@/components/layout/route-meta";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/queryClient";
import { lazyPage } from "@/lib/lazyPage";

// every page is its own chunk, loaded when first visited
const Dashboard = lazyPage(() => import("@/pages/Dashboard"));
const Pipeline = lazyPage(() => import("@/pages/Pipeline"));
const DealsList = lazyPage(() => import("@/pages/DealsList"));
const DealDetail = lazyPage(() => import("@/pages/DealDetail"));
const NewDeal = lazyPage(() => import("@/pages/NewDeal"));
const CreditQueue = lazyPage(() => import("@/pages/CreditQueue"));
const IncomeQueue = lazyPage(() => import("@/pages/IncomeQueue"));
const FundingQueue = lazyPage(() => import("@/pages/FundingQueue"));
const Dealers = lazyPage(() => import("@/pages/Dealers"));
const Users = lazyPage(() => import("@/pages/Users"));
const Reports = lazyPage(() => import("@/pages/Reports"));
const Settings = lazyPage(() => import("@/pages/Settings"));
const Auth = lazyPage(() => import("@/pages/Auth"));
const ForgotPassword = lazyPage(() => import("@/pages/ForgotPassword"));
const ResetPassword = lazyPage(() => import("@/pages/ResetPassword"));
const AcceptInvite = lazyPage(() => import("@/pages/AcceptInvite"));
const PendingAccess = lazyPage(() => import("@/pages/PendingAccess"));
const PortalHome = lazyPage(() => import("@/pages/portal/PortalHome"));
const PortalSubmit = lazyPage(() => import("@/pages/portal/PortalSubmit"));
const PortalDeal = lazyPage(() => import("@/pages/portal/PortalDeal"));
const NotFound = lazyPage(() => import("@/pages/NotFound"));

function RouteTitle() {
  useRouteTitle();
  return null;
}

export function AppRoutes() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        {/* public: sign-in and the links from emails */}
        <Route path="/auth" element={<Auth />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/accept-invite" element={<AcceptInvite />} />

        <Route element={<ProtectedRoute mode="any" />}>
          <Route path="/pending" element={<PendingAccess />} />
        </Route>

        {/* lender staff: credit, income, funding, admin */}
        <Route element={<ProtectedRoute mode="staff" />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/pipeline" element={<Pipeline />} />
            <Route path="/deals" element={<DealsList />} />
            <Route path="/deals/new" element={<NewDeal />} />
            <Route path="/deals/:id" element={<DealDetail />} />
            <Route path="/credit" element={<CreditQueue />} />
            <Route path="/income" element={<IncomeQueue />} />
            <Route path="/funding" element={<FundingQueue />} />
            <Route path="/reports" element={<Reports />} />
            {/* administrators only */}
            <Route element={<AdminRoute />}>
              <Route path="/dealers" element={<Dealers />} />
              <Route path="/users" element={<Users />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
          </Route>
        </Route>

        {/* dealer portal */}
        <Route element={<ProtectedRoute mode="dealer" />}>
          <Route element={<DealerLayout />}>
            <Route path="/portal" element={<PortalHome />} />
            <Route path="/portal/new" element={<PortalSubmit />} />
            <Route path="/portal/deals/:id" element={<PortalDeal />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

const App = () => (
  <ErrorBoundary variant="page">
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <RouteTitle />
            <AppRoutes />
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
