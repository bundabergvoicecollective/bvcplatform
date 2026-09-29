import { SquareClient, SquareEnvironment, WebhooksHelper } from "square";
import type { Currency } from "square";
import { ENV } from "./_core/env";

const accessToken = process.env.SQUARE_ACCESS_TOKEN ?? "";

// The BVC Square account is live, so SQUARE_ENVIRONMENT defaults to
// production (see _core/env.ts). Set it to "sandbox" to test against
// sandbox credentials without touching real payments.
export const squareClient = new SquareClient({
  token: accessToken,
  environment:
    ENV.squareEnvironment === "sandbox"
      ? SquareEnvironment.Sandbox
      : SquareEnvironment.Production,
});

export const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID ?? "";

/** Amounts are in cents (AUD). Square uses the smallest currency unit. */
export async function createSquarePaymentLink(opts: {
  name: string;
  amountCents: number;
  currency?: string;
  redirectUrl: string;
  referenceId: string;
  note?: string;
}): Promise<{ url: string; orderId: string; paymentLinkId: string }> {
  const { name, amountCents, currency = "AUD", redirectUrl, referenceId, note } = opts;

  const idempotencyKey = `${referenceId}-${Date.now()}`;

  const response = await squareClient.checkout.paymentLinks.create({
    idempotencyKey,
    quickPay: {
      name,
      priceMoney: {
        amount: BigInt(amountCents),
        currency: currency as Currency,
      },
      locationId: SQUARE_LOCATION_ID,
    },
    checkoutOptions: {
      redirectUrl,
      askForShippingAddress: false,
    },
    paymentNote: note,
  });

  // HttpResponsePromise<T> resolves to T directly (the response body)
  const link = (response as { paymentLink?: { url?: string; orderId?: string; id?: string } }).paymentLink;
  if (!link?.url || !link.orderId) {
    throw new Error("Square did not return a valid payment link");
  }

  return {
    url: link.url,
    orderId: link.orderId,
    paymentLinkId: link.id ?? "",
  };
}

/** Look up a Square order by its orderId and return whether it has been paid */
export async function getSquareOrderStatus(orderId: string): Promise<{ paid: boolean; paymentId?: string; amountCents?: number } | null> {
  try {
    // squareClient.orders.retrieve returns the order object
    const response = await (squareClient.orders as unknown as { retrieve: (id: string) => Promise<unknown> }).retrieve(orderId);
    const order = (response as { order?: Record<string, unknown> }).order;
    if (!order) return null;
    const state = order.state as string | undefined;
    const tenders = (order.tenders ?? []) as Array<Record<string, unknown>>;
    const paid = state === "COMPLETED" || tenders.length > 0;
    const paymentId = tenders[0]?.paymentId as string | undefined;
    const totalMoney = order.totalMoney as { amount?: bigint | number } | undefined;
    const amountCents = totalMoney?.amount ? Number(totalMoney.amount) : undefined;
    return { paid, paymentId, amountCents };
  } catch (err) {
    console.warn(`[Square] Could not retrieve order ${orderId}:`, err);
    return null;
  }
}

/** Verify a Square webhook notification signature */
export async function verifySquareWebhook(
  body: string,
  signature: string,
  signatureKey: string,
  notificationUrl: string
): Promise<boolean> {
  try {
    return await WebhooksHelper.verifySignature({
      requestBody: body,
      signatureHeader: signature,
      signatureKey,
      notificationUrl,
    });
  } catch {
    return false;
  }
}

export interface SquarePaymentSummary {
  id: string;
  createdAt: string;
  status: string;
  amountCents: number;
  currency: string;
  buyerEmail: string | null;
  note: string | null;
  sourceType: string | null;
}

/**
 * Fetch all COMPLETED Square payments for a given calendar date (AEST/AEDT).
 * beginTime / endTime are ISO-8601 strings in the +10:00 offset so Square
 * filters by the correct local date.
 */
export async function getSquarePaymentsForDate(
  dateStr: string // "YYYY-MM-DD"
): Promise<SquarePaymentSummary[]> {
  const beginTime = `${dateStr}T00:00:00+10:00`;
  const endTime   = `${dateStr}T23:59:59+10:00`;

  const page = await squareClient.payments.list({
    limit: 100,
    sortField: "CREATED_AT",
    sortOrder: "DESC",
    beginTime,
    endTime,
  });

  const items = page.data ?? [];

  return items
    .filter((p) => p.status === "COMPLETED")
    .map((p) => ({
      id: p.id ?? "",
      createdAt: p.createdAt ?? "",
      status: p.status ?? "",
      amountCents: p.amountMoney?.amount ? Number(p.amountMoney.amount) : 0,
      currency: p.amountMoney?.currency ?? "AUD",
      buyerEmail: p.buyerEmailAddress ?? null,
      note: p.note ?? null,
      sourceType: p.sourceType ?? null,
    }));
}
