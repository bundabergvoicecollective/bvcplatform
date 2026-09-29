import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import Attendance from "./pages/Attendance";
import Passes from "./pages/Passes";
import Library from "./pages/Library";
import Announcements from "./pages/Announcements";
import Members from "./pages/Members";
import Payments from "./pages/Payments";
import Messages from "./pages/Messages";
import AdminPanel from "./pages/AdminPanel";
import Groups from "./pages/Groups";
import Events from "./pages/Events";
import LiveStreams from "./pages/LiveStreams";
import Profile from "./pages/Profile";
import Documents from "./pages/Documents";
import Calendar from "./pages/Calendar";
import InvitePage from "./pages/InvitePage";
import AttendanceHistory from "./pages/AttendanceHistory";
import Shop from "./pages/Shop";
import RehearsalRecordings from "./pages/RehearsalRecordings";
import Gallery from "./pages/Gallery";
import MetaBrowserBanner from "./components/MetaBrowserBanner";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/attendance" component={Attendance} />
      <Route path="/passes" component={Passes} />
      <Route path="/library" component={Library} />
      <Route path="/announcements" component={Announcements} />
      <Route path="/members" component={Members} />
      <Route path="/payments" component={Payments} />
      <Route path="/messages" component={Messages} />
      <Route path="/groups" component={Groups} />
      <Route path="/events" component={Events} />
      <Route path="/live-streams" component={LiveStreams} />
      <Route path="/profile" component={Profile} />
      <Route path="/documents" component={Documents} />
      <Route path="/calendar" component={Calendar} />
      <Route path="/invite/:token" component={InvitePage} />
      <Route path="/attendance-history" component={AttendanceHistory} />
      <Route path="/shop" component={Shop} />
      <Route path="/shop/success" component={Shop} />
      <Route path="/rehearsal-recordings" component={RehearsalRecordings} />
      <Route path="/gallery" component={Gallery} />
      <Route path="/admin" component={AdminPanel} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <MetaBrowserBanner />
          <Toaster position="top-center" />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
