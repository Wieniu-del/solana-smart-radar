import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
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
import MyWallet from "./pages/MyWallet";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
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
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </div>
              </main>
            </div>
          </div>
        </SidebarProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
