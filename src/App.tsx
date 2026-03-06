import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import TopBar from "@/components/TopBar";
import Index from "./pages/Index";
import Analyze from "./pages/Analyze";
import Ranking from "./pages/Ranking";
import Activity24h from "./pages/Activity24h";
import Alerts from "./pages/Alerts";
import Compare from "./pages/Compare";
import SettingsPage from "./pages/SettingsPage";
import NotFound from "./pages/NotFound";
import AutoTrading from "./pages/AutoTrading";
import ManualTrading from "./pages/ManualTrading";
import NewsScanner from "./pages/NewsScanner";
import Journal from "./pages/Journal";
import MyWallet from "./pages/MyWallet";
import Login from "./pages/Login";
import { initHeliusApiKey } from "@/services/helius";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient();

function ProtectedLayout() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (user) initHeliusApiKey();
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <TopBar />
          <main className="flex-1 p-6 overflow-auto">
            <div className="max-w-6xl mx-auto">
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/wallet" element={<MyWallet />} />
                <Route path="/analyze" element={<Analyze />} />
                <Route path="/ranking" element={<Ranking />} />
                <Route path="/activity" element={<Activity24h />} />
                <Route path="/alerts" element={<Alerts />} />
                <Route path="/compare" element={<Compare />} />
                <Route path="/trading" element={<AutoTrading />} />
                <Route path="/manual-trading" element={<ManualTrading />} />
                <Route path="/news" element={<NewsScanner />} />
                <Route path="/journal" element={<Journal />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/*" element={<ProtectedLayout />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
