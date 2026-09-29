import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  Bell,
  Calendar,
  CalendarDays,
  CreditCard,
  FileText,
  Images,
  LayoutDashboard,
  LogOut,
  Menu,
  Megaphone,
  MessageCircle,
  Music2,
  Headphones,
  Settings,
  ShoppingBag,
  UserCircle,
  Users,
  Users2,
  Video,
  X,
} from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { getLoginUrl } from "@/const";
import PendingApproval from "@/pages/PendingApproval";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["user", "admin"] },
  { href: "/announcements", label: "Announcements", icon: Megaphone, roles: ["user", "admin"] },
  { href: "/attendance", label: "Attendance", icon: Calendar, roles: ["admin"] },
  { href: "/live-streams", label: "Live Rehearsals", icon: Video, roles: ["user", "admin"] },
  { href: "/calendar", label: "Calendar", icon: CalendarDays, roles: ["user", "admin"] },
  { href: "/events", label: "Performances", icon: CalendarDays, roles: ["user", "admin"] },
  { href: "/gallery", label: "Gallery", icon: Images, roles: ["user", "admin"] },
  { href: "/messages", label: "Chat", icon: MessageCircle, roles: ["user", "admin"] },
  { href: "/groups", label: "Groups", icon: Users2, roles: ["user", "admin"] },
  { href: "/members", label: "Members", icon: Users, roles: ["user", "admin"] },
  { href: "/library", label: "Music Library", icon: Music2, roles: ["user", "admin"] },
  { href: "/rehearsal-recordings", label: "Rehearsal Recordings", icon: Headphones, roles: ["user", "admin"] },
  { href: "/documents", label: "Forms & Documents", icon: FileText, roles: ["user", "admin"] },
  { href: "/shop", label: "Shop", icon: ShoppingBag, roles: ["user", "admin"] },
  { href: "/payments", label: "Payments", icon: CreditCard, roles: ["user", "admin"] },
  { href: "/profile", label: "My Profile", icon: UserCircle, roles: ["user", "admin"] },
  { href: "/admin", label: "Admin Panel", icon: Settings, roles: ["admin"] },
];

// Sidebar colour tokens — pure black left panel
const SIDEBAR_BG = "#0a0a0a";
const SIDEBAR_BORDER = "#1f1f1f";
const SIDEBAR_TEXT_MUTED = "#6b7280";
const SIDEBAR_TEXT = "#d1d5db";
const SIDEBAR_HOVER_BG = "#1a1a1a";
const GOLD = "oklch(0.78 0.17 75)";
const TEAL = "oklch(0.55 0.14 185)";

export default function BVCLayout({ children, noPadding }: { children: React.ReactNode; noPadding?: boolean }) {
  const { user, loading, logout } = useAuth();
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { data: unread } = trpc.notifications.unread.useQuery(undefined, {
    enabled: !!user,
    refetchInterval: 30000,
  });
  const { data: unreadSummary } = trpc.notifications.unreadSummary.useQuery(undefined, {
    enabled: !!user,
    refetchInterval: 30000,
  });

  const unreadCount = unread?.length ?? 0;
  const unreadMsgCount = unreadSummary?.unreadMessages ?? 0;
  const unreadAnnouncementCount = unreadSummary?.unreadAnnouncements ?? 0;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: SIDEBAR_BG }}>
        <div
          className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin"
          style={{ borderColor: GOLD, borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  if (!user) {
    window.location.href = getLoginUrl();
    return null;
  }

  // Block pending/denied users — show a holding screen instead of the app
  const userStatus = (user as any).status as string | undefined;
  if (userStatus === "pending") {
    return <PendingApproval status="pending" />;
  }
  if (userStatus === "denied") {
    return <PendingApproval status="denied" />;
  }

  // Redirect new members to complete their profile on first login
  // Skip if already on /profile to avoid a redirect loop
  const needsProfileSetup = !user.firstName && location !== "/profile";
  if (needsProfileSetup) {
    window.location.replace("/profile?setup=1");
    return null;
  }

  const role = user.role as "user" | "admin";
  const visibleNav = NAV_ITEMS.filter((n) => n.roles.includes(role));

  const SidebarContent = () => (
    <div className="flex flex-col h-full" style={{ background: SIDEBAR_BG }}>
      {/* Logo */}
      <div
        className="flex items-center gap-3 px-5 py-5 border-b"
        style={{ borderColor: SIDEBAR_BORDER }}
      >
        <img src="/bvc-logo.webp" alt="BVC" className="h-10 w-auto" />
        <span
          className="font-display font-bold text-sm leading-tight"
          style={{ color: GOLD }}
        >
          Bundaberg<br />Voice Collective
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {visibleNav.map(({ href, label, icon: Icon }) => {
          const active = location === href || (href !== "/" && location.startsWith(href));
          const badgeCount =
            label === "Announcements" ? unreadAnnouncementCount :
            label === "Chat" ? unreadMsgCount : 0;

          return (
            <Link
              key={href}
              href={href}
              onClick={() => setSidebarOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group"
              )}
              style={
                active
                  ? { background: GOLD, color: "#0a0a0a" }
                  : { color: SIDEBAR_TEXT }
              }
              onMouseEnter={(e) => {
                if (!active) (e.currentTarget as HTMLElement).style.background = SIDEBAR_HOVER_BG;
              }}
              onMouseLeave={(e) => {
                if (!active) (e.currentTarget as HTMLElement).style.background = "transparent";
              }}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="flex-1">{label}</span>
              {badgeCount > 0 && (
                <span
                  className="text-xs font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center"
                  style={{ background: TEAL, color: "white" }}
                >
                  {badgeCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* User footer */}
      <div className="px-4 py-4 border-t" style={{ borderColor: SIDEBAR_BORDER }}>
        <div className="flex items-center gap-3 mb-3">
          {(user as any).avatarUrl ? (
            <img
              src={(user as any).avatarUrl}
              alt={user.name ?? "Avatar"}
              className="w-8 h-8 rounded-full object-cover shrink-0"
              style={{ border: `1.5px solid ${TEAL}` }}
            />
          ) : (
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
              style={{ background: TEAL, color: "white" }}
            >
              {user.name?.charAt(0)?.toUpperCase() ?? "?"}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium truncate" style={{ color: "#f3f4f6" }}>
              {user.name ?? "Member"}
            </p>
            <p className="text-xs capitalize" style={{ color: SIDEBAR_TEXT_MUTED }}>
              {role === "admin" ? "Administrator" : "Member"}
            </p>
          </div>
        </div>
        <button
          onClick={() => logout()}
          className="flex items-center gap-2 text-xs w-full px-2 py-1.5 rounded-md transition-colors"
          style={{ color: SIDEBAR_TEXT_MUTED }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = SIDEBAR_HOVER_BG; (e.currentTarget as HTMLElement).style.color = "#f3f4f6"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = SIDEBAR_TEXT_MUTED; }}
        >
          <LogOut className="w-3.5 h-3.5" />
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen" style={{ background: "oklch(0.97 0.005 240)" }}>
      {/* Desktop sidebar */}
      <aside
        className="hidden md:flex flex-col w-60 shrink-0 fixed inset-y-0 left-0 z-30"
        style={{ background: SIDEBAR_BG }}
      >
        <SidebarContent />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => setSidebarOpen(false)}
          />
          <aside
            className="relative z-50 w-64 flex flex-col"
            style={{ background: SIDEBAR_BG }}
          >
            <button
              className="absolute top-4 right-4"
              style={{ color: SIDEBAR_TEXT }}
              onClick={() => setSidebarOpen(false)}
            >
              <X className="w-5 h-5" />
            </button>
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 md:ml-60 flex flex-col min-h-screen">
        {/* Mobile topbar */}
        <header
          className="md:hidden flex items-center justify-between px-4 py-3 sticky top-0 z-20"
          style={{ background: SIDEBAR_BG }}
        >
          <button onClick={() => setSidebarOpen(true)} style={{ color: GOLD }}>
            <Menu className="w-6 h-6" />
          </button>
          <img src="/bvc-logo.webp" alt="BVC" className="h-8 w-auto" />
          <Link href="/announcements" className="relative" style={{ color: GOLD }}>
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span
                className="absolute -top-1 -right-1 w-4 h-4 text-xs rounded-full flex items-center justify-center font-bold"
                style={{ background: TEAL, color: "white" }}
              >
                {unreadCount}
              </span>
            )}
          </Link>
        </header>

        <main className={noPadding ? "flex-1 flex flex-col overflow-hidden" : "flex-1 p-6"}>
          {children}
        </main>
      </div>
    </div>
  );
}
