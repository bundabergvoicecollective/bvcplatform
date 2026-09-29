import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import { useEffect } from "react";
import { useLocation } from "wouter";
import { Music, Users, Calendar, Bell, MessageCircle } from "lucide-react";

export default function Home() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!loading && user) {
      navigate("/dashboard");
    }
  }, [user, loading, navigate]);

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "#0a0a0a", minHeight: "100vh" }}
    >
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-5">
        <img
          src="/bvc-logo.webp"
          alt="Bundaberg Voice Collective"
          className="h-14 w-auto"
        />
        <Button
          onClick={() => (window.location.href = getLoginUrl())}
          className="font-semibold px-6 transition-transform active:scale-95"
          style={{ background: "oklch(0.78 0.17 75)", color: "#0a0a0a" }}
        >
          Sign In
        </Button>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center text-center px-6 py-20">
        <img
          src="/bvc-logo.webp"
          alt="BVC Logo"
          className="h-40 w-auto mb-8 drop-shadow-2xl"
        />
        <h1
          className="font-display text-5xl md:text-6xl font-bold mb-4"
          style={{ color: "oklch(0.78 0.17 75)" }}
        >
          Bundaberg Voice Collective
        </h1>
        <p className="text-lg md:text-xl max-w-xl mb-10" style={{ color: "#9ca3af" }}>
          Your choir's home for attendance, music, and community — all in one place.
        </p>
        <Button
          size="lg"
          onClick={() => (window.location.href = getLoginUrl())}
          className="text-lg px-10 py-6 font-semibold shadow-xl transition-transform active:scale-95"
          style={{ background: "oklch(0.55 0.14 185)", color: "white" }}
        >
          Get Started
        </Button>
      </main>

      {/* Feature highlights */}
      <section className="grid grid-cols-2 md:grid-cols-5 gap-4 px-8 pb-16 max-w-5xl mx-auto w-full">
        {[
          { icon: Calendar, label: "Attendance Tracking" },
          { icon: Users, label: "10-Pass Management" },
          { icon: Music, label: "Music Library" },
          { icon: Bell, label: "Announcements" },
          { icon: MessageCircle, label: "Members Messaging" },
        ].map(({ icon: Icon, label }) => (
          <div
            key={label}
            className="flex flex-col items-center gap-3 rounded-xl p-5 transition-colors"
            style={{ background: "#1a1a1a", border: "1px solid #2a2a2a" }}
          >
            <Icon className="w-7 h-7" style={{ color: "oklch(0.78 0.17 75)" }} />
            <span className="text-sm font-medium text-center" style={{ color: "#d1d5db" }}>
              {label}
            </span>
          </div>
        ))}
      </section>

      <footer className="text-center pb-8 text-sm" style={{ color: "#4b5563" }}>
        © {new Date().getFullYear()} Bundaberg Voice Collective
      </footer>
    </div>
  );
}
