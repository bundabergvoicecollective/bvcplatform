import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { ShieldOff } from "lucide-react";
import { toast } from "sonner";

/**
 * "Why has the admin menu gone?"
 *
 * An admin viewing as a member sees an app with most of its controls missing,
 * and nothing on screen would otherwise say why. Half an hour later that is a
 * bug report about the site being broken.
 *
 * So: a bar across the top of every page, for as long as the rights are down,
 * carrying the reason and the way back. Not dismissible — unlike the
 * notifications prompt, this one describes a state the person is currently in
 * and can end with one tap, and hiding it would strand them in an app that
 * looks broken.
 */
export default function AdminViewingAsMember({
  user,
}: {
  user?: { realRole?: string; adminMode?: boolean } | null;
}) {
  const utils = trpc.useUtils();
  const setMode = trpc.auth.setAdminMode.useMutation({
    onSuccess: async () => {
      await utils.invalidate();
      toast.success("Admin rights are back on.");
    },
    onError: (e) => toast.error(e.message),
  });

  // Only for someone who really is an admin and has their rights down.
  if (user?.realRole !== "admin" || user?.adminMode !== false) return null;

  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 border-b"
      style={{ background: "oklch(0.96 0.05 75)", borderColor: "oklch(0.88 0.07 75)" }}
    >
      <ShieldOff className="w-4 h-4 shrink-0" style={{ color: "oklch(0.45 0.12 60)" }} />
      <p className="text-sm min-w-0 flex-1" style={{ color: "oklch(0.35 0.07 60)" }}>
        <strong>Viewing as a member.</strong> Your admin rights are off, so the
        admin pages and buttons are hidden.
      </p>
      <Button
        size="sm"
        className="shrink-0 font-semibold"
        disabled={setMode.isPending}
        onClick={() => setMode.mutate({ on: true })}
        style={{ background: "oklch(0.55 0.14 185)", color: "white" }}
      >
        {setMode.isPending ? "Turning on…" : "Turn back on"}
      </Button>
    </div>
  );
}
