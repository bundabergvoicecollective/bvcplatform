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
  Banknote,
} from "lucide-react";
import { getDisplayName } from "@shared/const";
import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { updateAppBadge } from "@/lib/appBadge";
import NotificationPrompt from "./NotificationPrompt";
import AdminViewingAsMember from "./AdminViewingAsMember";
import { getLoginUrl } from "@/const";
import PendingApproval from "@/pages/PendingApproval";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["user", "admin"] },
  { href: "/notifications", label: "Notifications", icon: Bell, roles: ["user", "admin"] },
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
  { href: "/financials", label: "Financials", icon: Banknote, roles: ["admin"] },
  { href: "/profile", label: "My Profile", icon: UserCircle, roles: ["user", "admin"] },
  { href: "/admin", label: "Admin Panel", icon: Settings, roles: ["admin"] },
];

// Sidebar colour tokens — pure black left panel
const SIDEBAR_BG = "oklch(0.17 0.045 245)";
/* A rail with a top-to-bottom fall and a wash of teal at the foot: the
   difference between a dark panel and a surface with a light source. */
const SIDEBAR_GRADIENT =
  "linear-gradient(180deg, oklch(0.20 0.05 245) 0%, oklch(0.155 0.042 245) 55%, oklch(0.14 0.04 248) 100%)";
const SIDEBAR_BORDER = "oklch(0.26 0.04 245)";
const SIDEBAR_TEXT_MUTED = "oklch(0.62 0.02 245)";
const SIDEBAR_TEXT = "oklch(0.84 0.015 245)";
const SIDEBAR_HOVER_BG = "oklch(0.24 0.05 245)";
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

  // The home-screen icon carries the same number as the bell, so the icon and
  // the app never disagree. The query above already refetches every 30s, so
  // the badge follows it without a timer of its own, and clears itself the
  // moment the count reaches zero — including on sign-out, where `enabled`
  // goes false, `unread` empties and this runs with 0.
  useEffect(() => {
    updateAppBadge(user ? unreadCount : 0);
  }, [user, unreadCount]);

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
    <div className="flex flex-col h-full" style={{ background: SIDEBAR_BG, backgroundImage: SIDEBAR_GRADIENT }}>
      {/* Logo */}
      <div
        className="flex items-center gap-3 px-5 py-5 border-b"
        style={{ borderColor: SIDEBAR_BORDER }}
      >
        <img
          src="/bvc-logo.webp"
          alt="BVC"
          className="h-10 w-auto drop-shadow-[0_2px_8px_oklch(0.78_0.17_75_/_0.35)]"
        />
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
            label === "Notifications" ? unreadCount :
            label === "Announcements" ? unreadAnnouncementCount :
            label === "Chat" ? unreadMsgCount : 0;

          return (
            <Link
              key={href}
              href={href}
              onClick={() => setSidebarOpen(false)}
              className={cn(
                "relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium group",
                "[transition:background-color_var(--dur-fast)_var(--ease-bvc),color_var(--dur-fast)_var(--ease-bvc),transform_var(--dur-fast)_var(--ease-bvc)]",
                "active:scale-[0.98]",
                active
                  ? "font-semibold [box-shadow:0_4px_14px_-4px_oklch(0.78_0.17_75_/_0.55)]"
                  : "hover:bg-[oklch(0.24_0.05_245)]",
              )}
              style={
                active
                  ? {
                      backgroundImage:
                        "linear-gradient(135deg, oklch(0.84 0.16 80) 0%, oklch(0.76 0.17 72) 100%)",
                      color: "oklch(0.18 0.05 245)",
                    }
                  : { color: SIDEBAR_TEXT }
              }
            >
              {/* The marker on the rail itself. Colour alone carries the
                  current page otherwise, and gold on navy is not a
                  difference everybody can see. */}
              {active && (
                <span
                  className="absolute -left-3 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r-full"
                  style={{ background: GOLD }}
                />
              )}
              <Icon
                className={cn(
                  "w-4 h-4 shrink-0 [transition:transform_var(--dur)_var(--ease-bvc)]",
                  !active && "group-hover:scale-110",
                )}
              />
              <span className="flex-1">{label}</span>
              {badgeCount > 0 && (
                <span
                  className="text-xs font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center"
                  style={{ background: TEAL, color: "white" }}
                >
                  {badgeCount > 99 ? "99+" : badgeCount}
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
              {getDisplayName(user, "?").charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium truncate" style={{ color: "#f3f4f6" }}>
              {getDisplayName(user, "Member")}
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
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside
        className="hidden md:flex flex-col w-60 shrink-0 fixed inset-y-0 left-0 z-30"
        style={{ background: SIDEBAR_BG, backgroundImage: SIDEBAR_GRADIENT }}
      >
        <SidebarContent />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div
            className="fixed inset-0 bg-[oklch(0.14_0.04_245_/_0.6)] supports-[backdrop-filter:blur(0px)]:backdrop-blur-sm animate-fade-in"
            onClick={() => setSidebarOpen(false)}
          />
          <aside
            className="relative z-50 w-64 flex flex-col animate-slide-in-left [box-shadow:var(--shadow-overlay)]"
            style={{ background: SIDEBAR_BG, backgroundImage: SIDEBAR_GRADIENT }}
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
          className="md:hidden flex items-center justify-between px-4 py-3 sticky top-0 z-20 glass border-b"
          style={{ borderColor: "oklch(0.30 0.04 245 / 0.6)" }}
        >
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            className="p-1.5 -ml-1.5 rounded-xl active:scale-90 [transition:transform_var(--dur-fast)_var(--ease-bvc),background-color_var(--dur-fast)_var(--ease-bvc)] active:bg-white/10"
            style={{ color: GOLD }}
          >
            <Menu className="w-6 h-6" />
          </button>
          <img src="/bvc-logo.webp" alt="BVC" className="h-8 w-auto" />
          {/* To /notifications, not /announcements. The number counts every
              kind of unread — new music, documents, performances — and the
              announcements page can only clear announcements, so tapping the
              bell used to leave most of the count exactly where it was. */}
          <Link
            href="/notifications"
            className="relative p-1.5 -mr-1.5 rounded-xl active:scale-90 [transition:transform_var(--dur-fast)_var(--ease-bvc),background-color_var(--dur-fast)_var(--ease-bvc)] active:bg-white/10"
            aria-label={unreadCount > 0 ? `${unreadCount} unread` : "Notifications"}
            style={{ color: GOLD }}
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span
                // min-width rather than a fixed 16px square: at two digits a
                // fixed square clipped the number, and a member with twelve
                // unread saw "1".
                className="absolute top-0 right-0 min-w-[18px] h-[18px] px-1 text-[11px] leading-none rounded-full flex items-center justify-center font-bold animate-badge-pop [box-shadow:0_0_0_2px_oklch(0.17_0.045_245)]"
                style={{ background: TEAL, color: "white" }}
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Link>
        </header>

        {/* min-w-0 because a flex item defaults to min-width:auto, so one wide
            child — a long address that cannot wrap, a table, a chart that
            mismeasured — stretches the whole page and shifts every heading off
            the left of the screen. overflow-x-clip rather than hidden: clip
            does not make this a scroll container, so overflow-y stays visible
            and the page keeps scrolling normally. Measured at 390px: a page
            that was 525px wide becomes 390px. */}
        {/* Above the page, not inside it, so it is on every screen rather
            than only the one nobody could reach. Renders nothing once they
            have turned notifications on, or dismissed it this week. */}
        {/* An admin who has put their rights down needs telling why half the
            app has vanished, and needs the way back without hunting. */}
        <AdminViewingAsMember user={user} />
        <NotificationPrompt />

        {/* Keyed on the route so the animation re-runs on every navigation:
            moving between pages becomes a movement rather than a swap. */}
        <main
          key={location}
          className={
            noPadding
              ? "flex-1 flex flex-col overflow-hidden"
              : "flex-1 p-4 sm:p-6 min-w-0 overflow-x-clip page-enter"
          }
        >
          {children}
        </main>
      </div>
    </div>
  );
}
