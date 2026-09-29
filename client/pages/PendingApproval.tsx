import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";

interface Props {
  status: "pending" | "denied";
}

export default function PendingApproval({ status }: Props) {
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => {
      window.location.href = getLoginUrl();
    },
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0e1a2b] px-4">
      <div className="max-w-md w-full text-center">
        {/* Logo / Brand */}
        <div className="mb-8">
          <p className="text-[#c9922a] font-bold text-2xl tracking-wide">
            Bundaberg Voice Collective
          </p>
        </div>

        {/* Status Card */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 shadow-xl">
          {status === "pending" ? (
            <>
              <div className="w-16 h-16 rounded-full bg-amber-500/20 flex items-center justify-center mx-auto mb-6">
                <svg
                  className="w-8 h-8 text-amber-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h1 className="text-white text-2xl font-bold mb-3">
                Awaiting Approval
              </h1>
              <p className="text-white/60 text-sm leading-relaxed mb-6">
                Your account has been created and is currently awaiting approval
                from an administrator. You will be notified once your access has
                been approved.
              </p>
              <p className="text-white/40 text-xs">
                If you believe this is taking too long, please contact the choir
                administrator directly.
              </p>
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-6">
                <svg
                  className="w-8 h-8 text-red-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                  />
                </svg>
              </div>
              <h1 className="text-white text-2xl font-bold mb-3">
                Access Denied
              </h1>
              <p className="text-white/60 text-sm leading-relaxed mb-6">
                Your account access has been denied by an administrator. If you
                believe this is a mistake, please contact the choir administrator
                directly.
              </p>
            </>
          )}

          <Button
            variant="outline"
            size="sm"
            className="text-white/50 border-white/20 hover:text-white hover:border-white/40 bg-transparent"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
