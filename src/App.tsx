import { HashRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { ToastProvider } from "./components/Toaster";
import { HomePage } from "./pages/HomePage";
import { MeetingPage } from "./pages/MeetingPage";
import { SettingsPage } from "./pages/SettingsPage";

// Hash routing keeps deep links working on any static host, GitHub Pages included.
export function App() {
  return (
    <HashRouter>
      <ToastProvider>
        <AppShell>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/rapat/:id" element={<MeetingPage />} />
            <Route path="/pengaturan" element={<SettingsPage />} />
            <Route path="*" element={<HomePage />} />
          </Routes>
        </AppShell>
      </ToastProvider>
    </HashRouter>
  );
}
