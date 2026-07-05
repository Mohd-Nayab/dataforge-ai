import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import AppLayout from "@/components/layout/AppLayout";
import AICChat from "@/pages/AIChat";
import Admin from "@/pages/Admin";
import Analytics from "@/pages/Analytics";
import Profile from "@/pages/Profile";
import CleaningStudio from "@/pages/CleaningStudio";
import Dashboard from "@/pages/Dashboard";
import Datasets from "@/pages/Datasets";
import Forecast from "@/pages/Forecast";
import Login from "@/pages/Login";
import MLStudio from "@/pages/MLStudio";
import Preview from "@/pages/Preview";
import Profiling from "@/pages/Profiling";
import Register from "@/pages/Register";
import Report from "@/pages/Report";
import SQLWorkspace from "@/pages/SQLWorkspace";
import Upload from "@/pages/Upload";
import { useAuth } from "@/store/auth";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { token, initialized } = useAuth();
  const location = useLocation();
  if (!initialized) return null;
  if (!token) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

export default function App() {
  const { bootstrap, initialized } = useAuth();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (!initialized) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="upload" element={<Upload />} />
        <Route path="datasets" element={<Datasets />} />
        <Route path="preview" element={<Preview />} />
        <Route path="profiling" element={<Profiling />} />
        <Route path="cleaning" element={<CleaningStudio />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="sql" element={<SQLWorkspace />} />
        <Route path="ml" element={<MLStudio />} />
        <Route path="report" element={<Report />} />
        <Route path="forecast" element={<Forecast />} />
        <Route path="admin" element={<Admin />} />
        <Route path="profile" element={<Profile />} />
        <Route path="chat" element={<AICChat />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
