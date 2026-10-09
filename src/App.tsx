import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout, DealerLayout } from "@/components/layout/AppLayout";
import Dashboard from "@/pages/Dashboard";
import Pipeline from "@/pages/Pipeline";
import DealsList from "@/pages/DealsList";
import DealDetail from "@/pages/DealDetail";
import NewDeal from "@/pages/NewDeal";
import CreditQueue from "@/pages/CreditQueue";
import IncomeQueue from "@/pages/IncomeQueue";
import FundingQueue from "@/pages/FundingQueue";
import Dealers from "@/pages/Dealers";
import Users from "@/pages/Users";
import Reports from "@/pages/Reports";
import Settings from "@/pages/Settings";
import Auth from "@/pages/Auth";
import PendingAccess from "@/pages/PendingAccess";
import PortalHome from "@/pages/portal/PortalHome";
import PortalSubmit from "@/pages/portal/PortalSubmit";
import PortalDeal from "@/pages/portal/PortalDeal";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true } },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<Auth />} />

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
                <Route path="/dealers" element={<Dealers />} />
                <Route path="/users" element={<Users />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/settings" element={<Settings />} />
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
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
