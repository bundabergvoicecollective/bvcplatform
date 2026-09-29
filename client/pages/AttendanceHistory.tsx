import { trpc } from "@/lib/trpc";
import BVCLayout from "@/components/BVCLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, ChevronLeft } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";

export default function AttendanceHistory() {
  const { data: history, isLoading } = trpc.attendance.myHistory.useQuery();

  return (
    <BVCLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <Link href="/dashboard">
            <span
              className="inline-flex items-center gap-1 text-sm font-medium mb-3 cursor-pointer transition-opacity hover:opacity-70"
              style={{ color: "oklch(0.55 0.14 185)" }}
            >
              <ChevronLeft className="w-4 h-4" />
              Back to Dashboard
            </span>
          </Link>
          <h1 className="font-display text-2xl font-bold" style={{ color: "oklch(0.22 0.07 240)" }}>
            Attendance History
          </h1>
          <p className="text-sm mt-1" style={{ color: "oklch(0.52 0.03 240)" }}>
            A record of every rehearsal session you have attended.
          </p>
        </div>

        {/* Summary badge */}
        {!isLoading && history && history.length > 0 && (
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4" style={{ color: "oklch(0.55 0.14 185)" }} />
            <span className="text-sm font-medium" style={{ color: "oklch(0.35 0.04 240)" }}>
              {history.length} session{history.length === 1 ? "" : "s"} attended in total
            </span>
          </div>
        )}

        {/* Content */}
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : !history || history.length === 0 ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
              <Calendar className="w-10 h-10" style={{ color: "oklch(0.78 0.17 75)" }} />
              <p className="font-medium" style={{ color: "oklch(0.22 0.07 240)" }}>No attendance records yet</p>
              <p className="text-sm text-center max-w-xs" style={{ color: "oklch(0.52 0.03 240)" }}>
                Your attendance will appear here once the admin marks you as present for a rehearsal session.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-0 shadow-sm overflow-hidden">
            <div className="divide-y" style={{ borderColor: "oklch(0.92 0.02 240)" }}>
              {history.map((record) => (
                <div
                  key={record.id}
                  className="flex items-center justify-between gap-4 px-5 py-4"
                >
                  {/* Left: date + title */}
                  <div className="flex items-center gap-4 min-w-0">
                    {/* Date block */}
                    <div
                      className="flex flex-col items-center justify-center w-12 h-12 rounded-xl shrink-0 text-center"
                      style={{ background: "oklch(0.94 0.04 185)" }}
                    >
                      <span className="text-xs font-semibold leading-none" style={{ color: "oklch(0.35 0.10 185)" }}>
                        {record.sessionDate
                          ? format(new Date(record.sessionDate), "MMM").toUpperCase()
                          : "—"}
                      </span>
                      <span className="text-lg font-extrabold leading-tight" style={{ color: "oklch(0.22 0.07 240)" }}>
                        {record.sessionDate
                          ? format(new Date(record.sessionDate), "d")
                          : "—"}
                      </span>
                    </div>

                    {/* Title + full date */}
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate" style={{ color: "oklch(0.22 0.07 240)" }}>
                        {record.sessionTitle ?? "Rehearsal"}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "oklch(0.52 0.03 240)" }}>
                        {record.sessionDate
                          ? format(new Date(record.sessionDate), "EEEE, d MMMM yyyy")
                          : "Date unknown"}
                      </p>
                    </div>
                  </div>

                  {/* Right: session type badge */}
                  <div className="shrink-0">
                    {record.sessionType === "pass" ? (
                      <Badge
                        className="text-xs font-semibold"
                        style={{ background: "oklch(0.94 0.04 185)", color: "oklch(0.35 0.10 185)" }}
                      >
                        Pass used
                      </Badge>
                    ) : (
                      <Badge
                        className="text-xs font-semibold"
                        style={{ background: "oklch(0.97 0.04 75)", color: "oklch(0.45 0.10 75)" }}
                      >
                        Single session
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </BVCLayout>
  );
}
