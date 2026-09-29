import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CreditCard, CheckCircle, Clock, XCircle, ShoppingCart, Receipt, RefreshCw, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import BVCLayout from "@/components/BVCLayout";
import { getDisplayName } from "@shared/const";

const GOLD = "oklch(0.78 0.17 75)";
const TEAL = "oklch(0.55 0.14 185)";
const NAVY = "oklch(0.22 0.07 240)";

function statusBadge(status: string) {
  switch (status) {
    case "paid":
      return <Badge className="bg-green-100 text-green-800 border-0">Paid</Badge>;
    case "pending":
      return <Badge className="bg-yellow-100 text-yellow-800 border-0">Pending</Badge>;
    case "failed":
      return <Badge className="bg-red-100 text-red-800 border-0">Failed</Badge>;
    case "cancelled":
      return <Badge className="bg-gray-100 text-gray-700 border-0">Cancelled</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default function Payments() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [activatingId, setActivatingId] = useState<number | null>(null);

  const utils = trpc.useUtils();

  const { data: products } = trpc.payments.products.useQuery();
  const { data: myOrders, refetch: refetchOrders } = trpc.payments.myOrders.useQuery();
  const { data: allOrders, refetch: refetchAllOrders } = trpc.payments.allOrders.useQuery(undefined, {
    enabled: user?.role === "admin",
  });

  const createCheckout = trpc.payments.createCheckout.useMutation({
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        toast.info("Redirecting to secure checkout…");
        window.open(data.checkoutUrl, "_blank");
      }
      setCheckingOut(null);
    },
    onError: (err) => {
      toast.error(err.message ?? "Failed to start checkout");
      setCheckingOut(null);
    },
  });

  const syncMut = trpc.payments.syncPendingOrders.useMutation({
    onSuccess: (result) => {
      if (result.activated > 0) {
        toast.success(`Synced ${result.activated} order${result.activated !== 1 ? "s" : ""} — passes have been activated.`);
      } else {
        toast.info(`No new paid orders found (${result.total} pending checked).`);
      }
      refetchAllOrders();
      utils.payments.allOrders.invalidate();
    },
    onError: (err) => toast.error(err.message ?? "Sync failed"),
  });

  const activateMut = trpc.payments.manualActivateOrder.useMutation({
    onSuccess: (result) => {
      toast.success(result.wasTopUp ? `Pass topped up — new balance: ${result.newBalance} sessions.` : `Pass activated — ${result.newBalance} sessions credited.`);
      setActivatingId(null);
      refetchAllOrders();
      utils.payments.allOrders.invalidate();
    },
    onError: (err) => {
      toast.error(err.message ?? "Activation failed");
      setActivatingId(null);
    },
  });

  // Handle Square redirect back
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "1") {
      toast.success("Payment successful! Your pass will be activated shortly.");
      refetchOrders();
      navigate("/payments", { replace: true });
    } else if (params.get("cancelled") === "1") {
      toast.info("Checkout cancelled.");
      navigate("/payments", { replace: true });
    }
  }, []);

  const handleBuy = (key: string) => {
    setCheckingOut(key);
    createCheckout.mutate({ passProductKey: key as "10-pass" | "5-pass" | "single" | "test", origin: window.location.origin });
  };

  const orders = user?.role === "admin" ? allOrders : myOrders;
  const pendingCount = (allOrders ?? []).filter((o: any) => o.status === "pending").length;

  return (
    <BVCLayout>
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-display font-bold" style={{ color: NAVY }}>
              Pass Payments
            </h1>
            <p className="text-sm mt-1" style={{ color: "oklch(0.52 0.03 240)" }}>
              Purchase a rehearsal pass securely via Square. Sessions are <strong>added to your existing balance</strong> — for example, buying a 10-pass when you have 5 remaining gives you 15 sessions.
            </p>
          </div>

          {/* Admin sync button */}
          {user?.role === "admin" && (
            <div className="flex flex-col items-end gap-1">
              <Button
                variant="outline"
                size="sm"
                className="gap-2 font-medium"
                style={{ borderColor: TEAL, color: TEAL }}
                onClick={() => syncMut.mutate()}
                disabled={syncMut.isPending}
              >
                <RefreshCw className={`w-4 h-4 ${syncMut.isPending ? "animate-spin" : ""}`} />
                {syncMut.isPending ? "Syncing…" : "Sync Pending Orders"}
              </Button>
              {pendingCount > 0 && (
                <p className="text-xs" style={{ color: "oklch(0.55 0.12 60)" }}>
                  {pendingCount} pending order{pendingCount !== 1 ? "s" : ""} — click Sync to check Square for completed payments
                </p>
              )}
            </div>
          )}
        </div>

        {/* Products */}
        {user?.role !== "admin" && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {(products ?? []).filter((p) => !p.key.endsWith("-comp")).map((p) => (
              <Card key={p.key} className="border-0 shadow-sm overflow-hidden">
                <div className="h-1.5" style={{ background: GOLD }} />
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg font-bold" style={{ color: NAVY }}>
                    {p.name}
                  </CardTitle>
                  <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>
                    {p.description}
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="flex items-end justify-between mb-4">
                    <div>
                      <span className="text-3xl font-bold" style={{ color: NAVY }}>
                        ${(p.amountCents / 100).toFixed(2)}
                      </span>
                      <span className="text-sm ml-1 uppercase" style={{ color: "oklch(0.52 0.03 240)" }}>
                        {p.currency}
                      </span>
                    </div>
                    <span className="text-sm font-medium" style={{ color: TEAL }}>
                      {p.sessionCount} sessions
                    </span>
                  </div>
                  <Button
                    className="w-full font-semibold transition-transform active:scale-95"
                    style={{ background: TEAL, color: "white" }}
                    onClick={() => handleBuy(p.key)}
                    disabled={checkingOut === p.key}
                  >
                    <ShoppingCart className="w-4 h-4 mr-2" />
                    {checkingOut === p.key ? "Opening checkout…" : "Buy Now"}
                  </Button>
                  <p className="text-xs text-center mt-2" style={{ color: "oklch(0.65 0.02 240)" }}>
                    Sessions top up your existing balance.
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Order history */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2" style={{ color: NAVY }}>
              <Receipt className="w-4 h-4" style={{ color: TEAL }} />
              {user?.role === "admin" ? "All Orders" : "My Order History"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!orders || orders.length === 0 ? (
              <div className="text-center py-10" style={{ color: "oklch(0.65 0.02 240)" }}>
                <CreditCard className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No orders yet.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b" style={{ borderColor: "oklch(0.92 0.01 240)" }}>
                      {user?.role === "admin" && (
                        <th className="text-left py-2 px-3 font-semibold" style={{ color: NAVY }}>Member</th>
                      )}
                      <th className="text-left py-2 px-3 font-semibold" style={{ color: NAVY }}>Pass</th>
                      <th className="text-left py-2 px-3 font-semibold" style={{ color: NAVY }}>Amount</th>
                      <th className="text-left py-2 px-3 font-semibold" style={{ color: NAVY }}>Status</th>
                      <th className="text-left py-2 px-3 font-semibold" style={{ color: NAVY }}>Date</th>
                      {user?.role === "admin" && (
                        <th className="text-left py-2 px-3 font-semibold" style={{ color: NAVY }}>Action</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o: any) => (
                      <tr key={o.id} className="border-b last:border-0" style={{ borderColor: "oklch(0.95 0.005 240)" }}>
                        {user?.role === "admin" && (
                          <td className="py-2.5 px-3" style={{ color: NAVY }}>
                            <div className="font-medium">{getDisplayName({ name: o.userName, firstName: o.userFirstName, lastName: o.userLastName, email: o.userEmail }, "—")}</div>
                            <div className="text-xs" style={{ color: "oklch(0.55 0.03 240)" }}>{o.userEmail}</div>
                          </td>
                        )}
                        <td className="py-2.5 px-3 font-medium capitalize" style={{ color: NAVY }}>
                          {o.passType?.replace(/-/g, " ")} ({o.sessionCount} sessions)
                        </td>
                        <td className="py-2.5 px-3" style={{ color: NAVY }}>
                          ${(o.amountCents / 100).toFixed(2)} {o.currency?.toUpperCase()}
                        </td>
                        <td className="py-2.5 px-3">{statusBadge(o.status)}</td>
                        <td className="py-2.5 px-3" style={{ color: "oklch(0.52 0.03 240)" }}>
                          {new Date(o.createdAt).toLocaleDateString("en-AU")}
                        </td>
                        {user?.role === "admin" && (
                          <td className="py-2.5 px-3">
                            {o.status === "pending" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1.5 h-7 text-xs font-medium"
                                style={{ borderColor: TEAL, color: TEAL }}
                                disabled={activatingId === o.id || activateMut.isPending}
                                onClick={() => {
                                  setActivatingId(o.id);
                                  activateMut.mutate({ orderId: o.id });
                                }}
                              >
                                <Play className="w-3 h-3" />
                                {activatingId === o.id ? "Activating…" : "Activate"}
                              </Button>
                            ) : (
                              <span className="text-xs" style={{ color: "oklch(0.65 0.02 240)" }}>—</span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </BVCLayout>
  );
}
