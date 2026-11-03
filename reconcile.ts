/**
 * Catch the payments the webhook missed.
 *
 * A pass is normally granted the moment Square posts `payment.updated` with
 * status COMPLETED to /api/square/webhook. That is a single point of failure:
 * if Square cannot reach us for ten minutes — a deploy, a cold start that
 * times out, a Cloudflare hiccup — the member has paid, holds no pass, and
 * nothing happens until somebody notices and presses Sync.
 *
 * This is the safety net. It asks Square which pending orders were actually
 * paid and activates those. It is the same code the Sync button runs, on
 * purpose: two implementations of "decide whether to grant a pass" would
 * drift, and the one that drifted would be the one nobody tested.
 *
 * WHAT IT WILL NOT DO. It never grants a pass on our own records alone.
 * Square has to say the order is paid. An order Square will not answer for is
 * reported as unreachable, never assumed either way — because the failure
 * this project keeps repeating is a step that reports success while doing
 * nothing, and "Square refused" and "not paid yet" look identical if you only
 * count what you activated.
 */
import {
  assignPass,
  createNotification,
  getActivePassForUser,
  getAllMembers,
  getAllPassOrders,
  logActivity,
  markPassOrderReceiptSent,
  topUpPass,
  updatePassOrderStatus,
} from "./db";
import { getSquareOrderState } from "./square";
import { sendOnlinePassReceipt, shouldIssueOnlinePassReceipt } from "./passReceipt";
import { getDisplayName } from "@shared/const";

export type ReconcileOutcome = {
  /** Pending orders considered. */
  total: number;
  activated: number;
  /** Square answered, and the order is genuinely not paid. */
  notPaid: number;
  /** Square would not answer. Not evidence of anything. */
  unreachable: number;
  /** No Square reference, so there is nothing to look up. */
  noReference: number;
  /** One line per order activated, for the log and the admin toast. */
  notes: string[];
  /** Set when Square refused everything — the run proved nothing. */
  squareUnavailable: boolean;
  applied: boolean;
};

/**
 * Grant the pass for an order Square has confirmed paid.
 *
 * Idempotent through the caller: only ever handed an order that is still
 * pending, and the status is flipped before the notifications go out, so a
 * second run cannot grant twice even if the email is slow.
 */
async function activatePaidOrder(
  order: Awaited<ReturnType<typeof getAllPassOrders>>[number],
  source: string,
): Promise<string> {
  const existingPass = await getActivePassForUser(order.userId);
  const wasTopUp = !!existingPass;
  const finalPass = existingPass
    ? await topUpPass(existingPass.id, order.sessionCount)
    : await assignPass({
        userId: order.userId,
        totalSessions: order.sessionCount,
        assignedBy: 0,
        notes: `Purchased via Square — ${order.passType} (${source})`,
      });

  const reference = order.stripeSessionId ?? order.paymentSessionId;
  if (reference) await updatePassOrderStatus(reference, "paid", { passId: finalPass?.id });

  const newBalance = finalPass?.remainingSessions ?? order.sessionCount;
  const oldBalance = existingPass?.remainingSessions ?? 0;

  await createNotification({
    userId: order.userId,
    type: "general",
    title: wasTopUp ? "Pass Topped Up" : "Pass Activated",
    message: wasTopUp
      ? `Your pass has been topped up by ${order.sessionCount} sessions. You now have ${newBalance} sessions remaining.`
      : `Your ${order.passType} (${order.sessionCount} sessions) has been activated. Enjoy your rehearsals!`,
  }).catch((err) => console.warn("[Reconcile] notification failed:", err));

  await logActivity({
    userId: order.userId,
    actorId: null,
    action: "pass_online_purchase",
    detail: wasTopUp
      ? `${source}: Square order #${order.id} paid — +${order.sessionCount} sessions (${order.passType}). Balance: ${oldBalance} → ${newBalance}.`
      : `${source}: Square order #${order.id} paid — ${order.passType} (${order.sessionCount} sessions) activated. Balance: 0 → ${newBalance}.`,
    balanceBefore: wasTopUp ? oldBalance : 0,
    balanceAfter: newBalance,
  }).catch(() => {});

  const members = await getAllMembers();
  const member = members.find((m) => m.id === order.userId);
  const paidOrder = { ...order, status: "paid" as const };
  if (member?.email && shouldIssueOnlinePassReceipt(paidOrder)) {
    const sent = await sendOnlinePassReceipt({
      to: member.email,
      memberName: getDisplayName(member),
      passType: order.passType,
      sessionCount: order.sessionCount,
      amountCents: order.amountCents,
      currency: order.currency,
      paymentReference: order.paymentSessionId ?? order.stripeSessionId ?? `BVC-${order.id}`,
      purchasedAt: new Date(),
    }).catch((err) => {
      console.warn("[Reconcile] receipt failed:", err);
      return false;
    });
    if (sent) await markPassOrderReceiptSent(order.id);
  }

  return `#${order.id} ${order.passType} → ${member ? getDisplayName(member) : `member ${order.userId}`}` +
    ` (${wasTopUp ? `${oldBalance} → ${newBalance}` : `${newBalance} sessions`})`;
}

export async function reconcilePendingOrders(
  opts: { apply?: boolean; source?: string } = {},
): Promise<ReconcileOutcome> {
  const apply = opts.apply ?? true;
  const source = opts.source ?? "Reconcile";

  const pending = (await getAllPassOrders()).filter((o) => o.status === "pending");
  const out: ReconcileOutcome = {
    total: pending.length,
    activated: 0,
    notPaid: 0,
    unreachable: 0,
    noReference: 0,
    notes: [],
    squareUnavailable: false,
    applied: apply,
  };

  for (const order of pending) {
    const reference = order.stripeSessionId ?? order.paymentSessionId;
    if (!reference) {
      out.noReference++;
      continue;
    }

    let state: Awaited<ReturnType<typeof getSquareOrderState>>;
    try {
      state = await getSquareOrderState(reference);
    } catch (err) {
      out.unreachable++;
      // Square refusing the very first lookup means it will refuse them all,
      // and grinding through the rest would only turn one clear error into
      // dozens of identical ones. Stop and say so.
      if (out.unreachable === 1 && out.activated === 0) {
        out.squareUnavailable = true;
        console.error(`[${source}] Square would not answer — abandoning the run:`, err);
        break;
      }
      continue;
    }

    if (!state?.paid) {
      out.notPaid++;
      continue;
    }

    if (!apply) {
      out.activated++;
      out.notes.push(`#${order.id} ${order.passType} for member ${order.userId} — would activate`);
      continue;
    }

    try {
      out.notes.push(await activatePaidOrder(order, source));
      out.activated++;
    } catch (err) {
      out.unreachable++;
      console.error(`[${source}] Failed to activate order ${order.id}:`, err);
    }
  }

  return out;
}
