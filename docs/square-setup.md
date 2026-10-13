# Linking Square so payments work

The code is all here — payment links, the webhook that grants the pass, order
status lookup, and the live payment feed on the dashboard's income widget. None
of it has ever run, because the account has never been connected. What follows
is the connecting.

**Until all four secrets are set, nothing changes.** Square calls fail at call
time rather than at boot (see `_core/env.ts`), so the shop and online pass
purchase simply do not work, and cash and manual pass recording carry on as
they are.

## Three bugs were fixed before writing this

Worth knowing, because each would have cost money quietly rather than failing
loudly, and two of them look identical from the outside — "Square says nobody
has paid".

1. **The webhook listened for an event Square does not send.** It matched
   `payment.completed`, which is not a Square event type. Square sends
   `payment.created` and `payment.updated`, and a finished payment arrives as
   `payment.updated` with status `COMPLETED`. Every purchase would have been
   received, logged and ignored: the member pays, no pass arrives, the order
   sits `pending` forever.
2. **The order lookup called a method that does not exist.** `orders.retrieve`
   is not on the v44 SDK's client; the method is `orders.get({ orderId })`. It
   was reached through a cast, so the typechecker passed it and it threw at
   runtime inside a `catch` that returns null — making the admin "sync pending
   orders" report every order as skipped.
3. **A missing signature key meant no signature checking.** The handler grants
   live stream access, marks shop orders paid and tops up passes, and it ran
   all of that for any unauthenticated POST when the key was unset. It now
   refuses with 503.

## What you need from Square

Four values. All from **https://developer.squareup.com/apps** signed in as the
BVC Square account.

1. Open your application (create one if there is none — name it anything;
   members never see it)
2. Switch the toggle to **Production**, not Sandbox. The code defaults to
   production deliberately, so a half-configured app must not point at sandbox
3. **Credentials** → copy the **Production Access Token**
4. **Locations** → copy the **Location ID** for Bundaberg

Then the webhook:

5. **Webhooks → Subscriptions → Add subscription**
   - **Notification URL**, exactly:

     ```
     https://members.bundabergvoicecollective.com.au/api/square/webhook
     ```

   - **Events**: `payment.created` and `payment.updated`. Those two and no
     others — `payment.updated` is the one that actually matters, and the
     handler ignores any payment whose status is not `COMPLETED`
6. Copy the subscription's **Signature Key**

## The secrets

**https://github.com/bundabergvoicecollective/bvcplatform/settings/secrets/actions**

| Secret | Value |
| --- | --- |
| `SQUARE_ACCESS_TOKEN` | the production access token |
| `SQUARE_LOCATION_ID` | the Bundaberg location id |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | the subscription's signature key |
| `SQUARE_WEBHOOK_URL` | `https://members.bundabergvoicecollective.com.au/api/square/webhook` |

`SQUARE_ENVIRONMENT` is left unset: it defaults to production.

**Set `SQUARE_WEBHOOK_URL` even though it looks redundant.** Square signs each
notification over the URL it was configured with, and the fallback has to
reconstruct that from `APP_URL`. Setting it explicitly removes the guesswork,
and a mismatch shows up only as every webhook failing to verify.

> **The Secrets tab, not the Variables tab.** That page has both and they look
> identical once saved. The workflow reads `secrets.*`, so a value under
> Variables is invisible to it. This has already cost a round of debugging here.

Then push to `main` or re-run the deploy. Check the deploy log's
`Runtime vars set:` line lists the four names — if one is missing, it was
pasted into the wrong tab.

## Testing it without risking a real sale

Square has no way to fake a production payment, so the honest test is a small
real one — buy a single session as yourself, then refund it in the Square
dashboard.

Watch for, in order:

1. The checkout link opens and takes the payment
2. Cloud Run logs show `[Square Webhook] Received event: payment.updated`
3. Then **not** `Invalid signature`. If you see that, `SQUARE_WEBHOOK_URL` does
   not match the subscription exactly
4. Your pass balance goes up by the sessions you bought
5. The order moves from `pending` to `paid` in Admin → Payments

If the payment succeeds but no pass appears, the webhook is the place to look,
not the payment. **Admin → Payments → sync pending orders** is the recovery
path: it asks Square directly about each pending order and activates the ones
Square says are paid. That is the button that never worked before today.

## The 27 pending orders

Worth doing once this is live. $3,090 sits `pending`, of which $700 is one
member's six $140 orders inside eight minutes — a double-clicked checkout, not
six purchases. Run the sync first: it will resolve any that Square knows were
actually paid. What is left after that is a real question of who owes what, and
the five duplicates want voiding rather than chasing.
