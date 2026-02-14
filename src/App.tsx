import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/layout/AppLayout";
import Dashboard from "@/pages/Dashboard";
import Pipeline from "@/pages/Pipeline";
import DealsList from "@/pages/DealsList";
import DealDetail from "@/pages/DealDetail";
import CreditQueue from "@/pages/CreditQueue";
import IncomeQueue from "@/pages/IncomeQueue";
import FundingQueue from "@/pages/FundingQueue";
import Dealers from "@/pages/Dealers";
import Users from "@/pages/Users";
import Reports from "@/pages/Reports";
import Settings from "@/pages/Settings";
import Auth from "@/pages/Auth";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/pipeline" element={<Pipeline />} />
                <Route path="/deals" element={<DealsList />} />
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
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
