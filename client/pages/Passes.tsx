import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import BVCLayout from "@/components/BVCLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { CreditCard, Plus, RefreshCw, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";

function PassCard({ member }: { member: { id: number; name: string | null; email: string | null } }) {
  const { data: pass, refetch } = trpc.passes.activeForUser.useQuery({ userId: member.id });
  const [assignOpen, setAssignOpen] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [sessions, setSessions] = useState(10);
  const [topUpAmount, setTopUpAmount] = useState(5);
  const [notes, setNotes] = useState("");

  const utils = trpc.useUtils();

  const assign = trpc.passes.assign.useMutation({
    onSuccess: () => {
      refetch();
      utils.dashboard.adminStats.invalidate();
      utils.members.list.invalidate();
      utils.attendance.lastSessionStats.invalidate();
      setAssignOpen(false);
      toast.success(`Pass assigned to ${member.name}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const topUp = trpc.passes.topUp.useMutation({
    onSuccess: () => {
      refetch();
      utils.dashboard.adminStats.invalidate();
      utils.members.list.invalidate();
      utils.attendance.lastSessionStats.invalidate();
      setTopUpOpen(false);
      toast.success(`Pass topped up for ${member.name}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const passPercent = pass ? Math.round((pass.remainingSessions / pass.totalSessions) * 100) : 0;
  const isLow = pass && pass.remainingSessions <= 2;

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="font-semibold" style={{ color: "oklch(0.22 0.07 240)" }}>
              {member.name ?? "Unknown"}
            </p>
            <p className="text-xs mt-0.5" style={{ color: "oklch(0.52 0.03 240)" }}>
              {member.email ?? ""}
            </p>
          </div>
          {pass ? (
            <Badge
              className="text-xs font-semibold"
              style={{
                background: isLow ? "oklch(0.97 0.02 27)" : "oklch(0.94 0.06 185)",
                color: isLow ? "oklch(0.577 0.245 27.325)" : "oklch(0.35 0.10 185)",
              }}
            >
              {isLow && <AlertTriangle className="w-3 h-3 mr-1" />}
              {pass.remainingSessions} remaining
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-xs">No pass</Badge>
          )}
        </div>

        {pass ? (
          <div className="space-y-2 mb-4">
            <div className="w-full h-2 rounded-full" style={{ background: "oklch(0.94 0.01 240)" }}>
              <div
                className="h-2 rounded-full transition-all duration-500"
                style={{
                  width: `${passPercent}%`,
                  background: isLow ? "oklch(0.577 0.245 27.325)" : "oklch(0.78 0.17 75)",
                }}
              />
            </div>
            <p className="text-xs" style={{ color: "oklch(0.52 0.03 240)" }}>
              {pass.remainingSessions} / {pass.totalSessions} sessions · Assigned {format(new Date(pass.assignedAt), "d MMM yyyy")}
            </p>
          </div>
        ) : (
          <p className="text-xs mb-4" style={{ color: "oklch(0.52 0.03 240)" }}>
            No active pass assigned.
          </p>
        )}

        <div className="flex gap-2">
          {/* Assign new pass */}
          <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="flex-1 text-xs gap-1.5"
                style={{ borderColor: "oklch(0.55 0.14 185)", color: "oklch(0.55 0.14 185)" }}
              >
                <Plus className="w-3.5 h-3.5" />
                {pass ? "New Pass" : "Assign Pass"}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Assign Pass — {member.name}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div>
                  <Label>Number of Sessions</Label>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={sessions}
                    onChange={(e) => setSessions(Number(e.target.value))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Notes (optional)</Label>
                  <Input
                    placeholder="e.g. Paid cash"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <Button
                  className="w-full font-semibold"
                  style={{ background: "oklch(0.55 0.14 185)", color: "white" }}
                  disabled={assign.isPending}
                  onClick={() =>
                    assign.mutate({ userId: member.id, totalSessions: sessions, notes: notes || undefined })
                  }
                >
                  {assign.isPending ? "Assigning..." : "Assign Pass"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Top up */}
          {pass && (
            <Dialog open={topUpOpen} onOpenChange={setTopUpOpen}>
              <DialogTrigger asChild>
                <Button
                  size="sm"
                  className="flex-1 text-xs gap-1.5 font-semibold"
                  style={{ background: "oklch(0.78 0.17 75)", color: "oklch(0.18 0.04 240)" }}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Top Up
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Top Up Pass — {member.name}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>
                    Current balance: <strong>{pass.remainingSessions}</strong> sessions
                  </p>
                  <div>
                    <Label>Sessions to Add</Label>
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      value={topUpAmount}
                      onChange={(e) => setTopUpAmount(Number(e.target.value))}
                      className="mt-1"
                    />
                  </div>
                  <Button
                    className="w-full font-semibold"
                    style={{ background: "oklch(0.78 0.17 75)", color: "oklch(0.18 0.04 240)" }}
                    disabled={topUp.isPending}
                    onClick={() => topUp.mutate({ passId: pass.id, userId: member.id, addSessions: topUpAmount })}
                  >
                    {topUp.isPending ? "Topping up..." : `Add ${topUpAmount} Sessions`}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Passes() {
  const { user } = useAuth();
  const { data: members, isLoading } = trpc.members.list.useQuery();

  if (user?.role !== "admin") {
    return (
      <BVCLayout>
        <div className="flex items-center justify-center h-64">
          <p style={{ color: "oklch(0.52 0.03 240)" }}>Admin access required.</p>
        </div>
      </BVCLayout>
    );
  }

  return (
    <BVCLayout>
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold" style={{ color: "oklch(0.22 0.07 240)" }}>
            10-Pass Management
          </h1>
          <p className="text-sm mt-1" style={{ color: "oklch(0.52 0.03 240)" }}>
            Assign and manage session passes for each member. Members are notified when 2 sessions remain.
          </p>
        </div>

        {isLoading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-40 rounded-xl bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : !members || members.length === 0 ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
              <CreditCard className="w-10 h-10" style={{ color: "oklch(0.78 0.17 75)" }} />
              <p className="font-medium" style={{ color: "oklch(0.22 0.07 240)" }}>No members yet</p>
              <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>
                Members will appear here once they sign in.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {members.map((m) => (
              <PassCard key={m.id} member={m as any} />
            ))}
          </div>
        )}
      </div>
    </BVCLayout>
  );
}
