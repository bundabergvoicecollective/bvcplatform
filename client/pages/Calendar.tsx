import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import BVCLayout from "@/components/BVCLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Video,
  Cake,
  Music2,
  Star,
} from "lucide-react";
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, isSameDay, isSameMonth, addMonths, subMonths, isToday } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type CalEvent = {
  id: string;
  type: "rehearsal" | "stream" | "birthday" | "performance";
  title: string;
  date: string;
  notes?: string;
  location?: string;
  category?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_CONFIG = {
  rehearsal: {
    label: "Rehearsal",
    color: "oklch(0.55 0.14 185)",       // teal
    bg: "oklch(0.94 0.06 185)",
    icon: Music2,
  },
  stream: {
    label: "Live Stream",
    color: "oklch(0.65 0.17 55)",        // amber
    bg: "oklch(0.97 0.06 75)",
    icon: Video,
  },
  birthday: {
    label: "Birthday",
    color: "oklch(0.60 0.18 350)",       // pink
    bg: "oklch(0.96 0.04 350)",
    icon: Cake,
  },
  performance: {
    label: "Performance",
    color: "oklch(0.55 0.20 290)",       // violet/purple
    bg: "oklch(0.95 0.05 290)",
    icon: Star,
  },
};

function eventDate(e: CalEvent) {
  return new Date(e.date);
}

// ─── Day Cell ─────────────────────────────────────────────────────────────────

function DayCell({
  day,
  currentMonth,
  events,
  selected,
  onSelect,
}: {
  day: Date;
  currentMonth: Date;
  events: CalEvent[];
  selected: boolean;
  onSelect: () => void;
}) {
  const inMonth = isSameMonth(day, currentMonth);
  const today = isToday(day);

  return (
    <button
      onClick={onSelect}
      className={`relative min-h-[72px] p-1.5 text-left rounded-lg border transition-all ${
        selected
          ? "border-teal-500 bg-teal-50 shadow-sm"
          : today
          ? "border-teal-300 bg-teal-50/40"
          : "border-transparent hover:border-gray-200 hover:bg-gray-50"
      } ${!inMonth ? "opacity-35" : ""}`}
    >
      <span
        className={`text-xs font-semibold leading-none ${
          today
            ? "w-5 h-5 rounded-full flex items-center justify-center text-white"
            : ""
        }`}
        style={today ? { background: "oklch(0.55 0.14 185)" } : { color: inMonth ? "oklch(0.22 0.07 240)" : "oklch(0.65 0.02 240)" }}
      >
        {format(day, "d")}
      </span>

      {/* Event dots — show up to 3 then +N */}
      <div className="mt-1 flex flex-col gap-0.5">
        {events.slice(0, 3).map((ev) => {
          const cfg = TYPE_CONFIG[ev.type];
          return (
            <span
              key={ev.id}
              className="block truncate text-[10px] leading-tight px-1 rounded font-medium"
              style={{ background: cfg.bg, color: cfg.color }}
            >
              {ev.title}
            </span>
          );
        })}
        {events.length > 3 && (
          <span className="text-[10px] text-muted-foreground pl-1">+{events.length - 3} more</span>
        )}
      </div>
    </button>
  );
}

// ─── Sidebar Event List ────────────────────────────────────────────────────────

function EventList({ events, selectedDay }: { events: CalEvent[]; selectedDay: Date | null }) {
  const filtered = selectedDay
    ? events.filter((e) => isSameDay(eventDate(e), selectedDay))
    : [];

  if (!selectedDay) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm gap-2">
        <CalendarDays className="w-8 h-8 opacity-30" />
        <span>Click a day to see events</span>
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-sm gap-2">
        <CalendarDays className="w-6 h-6 opacity-30" />
        <span>No events on {format(selectedDay, "d MMMM yyyy")}</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
        {format(selectedDay, "EEEE, d MMMM yyyy")}
      </p>
      {filtered.map((ev) => {
        const cfg = TYPE_CONFIG[ev.type];
        const Icon = cfg.icon;
        return (
          <div
            key={ev.id}
            className="flex items-start gap-3 p-3 rounded-lg border"
            style={{ borderColor: cfg.color + "40", background: cfg.bg }}
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5"
              style={{ background: cfg.color + "20" }}
            >
              <Icon className="w-3.5 h-3.5" style={{ color: cfg.color }} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight" style={{ color: "oklch(0.22 0.07 240)" }}>
                {ev.title}
              </p>
              <p className="text-xs mt-0.5" style={{ color: cfg.color }}>
                {cfg.label} · {format(eventDate(ev), "h:mm a")}
              </p>
              {ev.location && (
                <p className="text-xs mt-0.5 text-muted-foreground">📍 {ev.location}</p>
              )}
              {ev.notes && (
                <p className="text-xs mt-1 text-muted-foreground line-clamp-2">{ev.notes}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Upcoming Events List ─────────────────────────────────────────────────────

function UpcomingList({ events }: { events: CalEvent[] }) {
  const now = new Date();
  const upcoming = events
    .filter((e) => eventDate(e) >= now)
    .sort((a, b) => eventDate(a).getTime() - eventDate(b).getTime())
    .slice(0, 10);

  if (upcoming.length === 0) {
    return <p className="text-sm text-muted-foreground">No upcoming events.</p>;
  }

  return (
    <div className="space-y-2">
      {upcoming.map((ev) => {
        const cfg = TYPE_CONFIG[ev.type];
        const Icon = cfg.icon;
        return (
          <div key={ev.id} className="flex items-center gap-3 py-2 border-b last:border-0">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: cfg.bg }}
            >
              <Icon className="w-4 h-4" style={{ color: cfg.color }} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate" style={{ color: "oklch(0.22 0.07 240)" }}>{ev.title}</p>
              <p className="text-xs text-muted-foreground">{format(eventDate(ev), "EEE d MMM yyyy")}</p>
            </div>
            <Badge
              className="text-xs shrink-0"
              style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}40` }}
            >
              {cfg.label}
            </Badge>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Calendar() {
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const { data: events = [], isLoading } = trpc.calendar.events.useQuery();

  // Build the 6-week grid for the current month
  const calendarDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 }); // Mon start
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
    const days: Date[] = [];
    let d = start;
    while (d <= end) {
      days.push(d);
      d = addDays(d, 1);
    }
    return days;
  }, [currentMonth]);

  // Index events by day key "YYYY-MM-DD"
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const ev of events) {
      const key = format(eventDate(ev), "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    }
    return map;
  }, [events]);

  const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <BVCLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-display font-bold" style={{ color: "oklch(0.22 0.07 240)" }}>
            Calendar
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            All rehearsals, live streams, performances, and upcoming events in one view.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ── Monthly Calendar ── */}
          <div className="lg:col-span-2">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-display" style={{ color: "oklch(0.22 0.07 240)" }}>
                    {format(currentMonth, "MMMM yyyy")}
                  </CardTitle>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs px-3"
                      onClick={() => { setCurrentMonth(startOfMonth(new Date())); setSelectedDay(new Date()); }}
                    >
                      Today
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* Legend */}
                <div className="flex flex-wrap gap-3 mt-2">
                  {(Object.entries(TYPE_CONFIG) as [keyof typeof TYPE_CONFIG, typeof TYPE_CONFIG[keyof typeof TYPE_CONFIG]][]).map(([key, cfg]) => {
                    const Icon = cfg.icon;
                    return (
                      <span key={key} className="flex items-center gap-1.5 text-xs" style={{ color: cfg.color }}>
                        <Icon className="w-3 h-3" />
                        {cfg.label}
                      </span>
                    );
                  })}
                </div>
              </CardHeader>

              <CardContent>
                {isLoading ? (
                  <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                    Loading calendar…
                  </div>
                ) : (
                  <>
                    {/* Day-of-week headers */}
                    <div className="grid grid-cols-7 mb-1">
                      {DAYS_OF_WEEK.map((d) => (
                        <div key={d} className="text-center text-xs font-semibold text-muted-foreground py-1">
                          {d}
                        </div>
                      ))}
                    </div>

                    {/* Day cells */}
                    <div className="grid grid-cols-7 gap-0.5">
                      {calendarDays.map((day) => {
                        const key = format(day, "yyyy-MM-dd");
                        const dayEvents = eventsByDay.get(key) ?? [];
                        return (
                          <DayCell
                            key={key}
                            day={day}
                            currentMonth={currentMonth}
                            events={dayEvents}
                            selected={selectedDay ? isSameDay(day, selectedDay) : false}
                            onSelect={() => setSelectedDay(isSameDay(day, selectedDay ?? new Date(0)) ? null : day)}
                          />
                        );
                      })}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── Sidebar ── */}
          <div className="space-y-4">
            {/* Selected day events */}
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold" style={{ color: "oklch(0.22 0.07 240)" }}>
                  {selectedDay ? format(selectedDay, "d MMMM") : "Day Details"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <EventList events={events} selectedDay={selectedDay} />
              </CardContent>
            </Card>

            {/* Upcoming events */}
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold" style={{ color: "oklch(0.22 0.07 240)" }}>
                  Upcoming
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : (
                  <UpcomingList events={events} />
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </BVCLayout>
  );
}
