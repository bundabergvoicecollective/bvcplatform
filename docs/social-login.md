# Google and Facebook sign-in

Manus offered these and the migration replaced them with email and password, so
members who always tapped "Continue with Google" lost their usual way in. The
code is now in place (`server/oauth.ts`); what remains is creating the apps in
each provider's console, which needs an account only Andy has.

**Nothing changes until the secrets are set.** A provider whose two values are
missing is not shown on the login page and its routes return 404. Email and
password keeps working throughout, and keeps working afterwards — these are
extra doors, not a replacement.

## What members will see

A member taps "Continue with Google", picks the Google account they are already
signed in to on their phone, and lands on their own dashboard with their pass
balance and attendance intact. **Their existing account is matched by email
address** — nothing is created, nothing is overwritten.

If the address does not match any member, they get an account awaiting approval
and the holding screen, exactly as a self-registration does today. A stranger
cannot get in by signing in with Google.

An address belonging to one of the four denied rows is refused before any
session is issued, the same as `/api/auth/forgot` refuses them.

## Google — do this first

Google needs no app review for plain sign-in, so this can be finished in one
sitting.

1. **https://console.cloud.google.com/auth/overview** — pick the same project
   the site deploys to
2. Configure the consent screen if it asks:
   - **User type: External**
   - App name: `Bundaberg Voice Collective`, support email: your own
   - Scopes: **`openid`, `email`, `profile` only.** These are the
     non-sensitive ones. Do not add anything else — Calendar, Contacts, Gmail
     and Drive scopes are what trigger Google's review and, for some, an annual
     security assessment
3. **Publish the app** (Audience → "Publish app"). Left in *Testing* it is
   capped at 100 named test users and sign-in stops working every 7 days. With
   only the three scopes above, publishing should not require verification —
   confirm that on screen rather than taking it from this file, because
   Google's wording here changes
4. **https://console.cloud.google.com/auth/clients** → **Create client**
   - Type: **Web application**
   - Name: `BVC members site`
   - **Authorised redirect URI** — exactly this, one character wrong and sign-in
     fails with a `redirect_uri_mismatch`:

     ```
     https://members.bundabergvoicecollective.com.au/api/auth/google/callback
     ```
5. Copy the **Client ID** and **Client secret** into GitHub as secrets:

   **https://github.com/bundabergvoicecollective/bvcplatform/settings/secrets/actions**

   | Secret name | Value |
   | --- | --- |
   | `GOOGLE_CLIENT_ID` | the client ID (ends `.apps.googleusercontent.com`) |
   | `GOOGLE_CLIENT_SECRET` | the client secret |

6. Push anything to `main`, or re-run the deploy workflow. The button appears
   once the deploy finishes

> **The Secrets tab, not the Variables tab.** That page has both and they look
> identical once saved. The workflow reads `secrets.*`, so a value added under
> Variables is invisible to it. This has already cost a round of debugging here.

## Facebook — expect friction

Meta grants `email` and `public_profile` automatically, but their Login for
Business documentation also says each installation must request at least one
*other* supported permission, and anything needing **Advanced Access** pulls in
App Review plus **Business Verification** — real business documents, typically
1–5 working days when it goes smoothly. Whether a plain choir sign-in falls
inside that requirement cannot be determined from outside the console.

So treat Google as the win and Facebook as optional. If you want to try:

1. **https://developers.facebook.com/apps** → **Create app** → use case
   **Authenticate and request data from users with Facebook Login**
2. Add the **Facebook Login** product → **Settings** → **Valid OAuth Redirect
   URIs**:

   ```
   https://members.bundabergvoicecollective.com.au/api/auth/facebook/callback
   ```
3. Settings → Basic: add a **Privacy Policy URL** (Meta will not let the app go
   Live without one) and switch the app from Development to **Live**
4. Add `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET` as GitHub secrets, same page
   and same tab caveat as above

**Two things to know before offering it.** Facebook exposes no per-address
verification flag, unlike Google — the code treats a returned address as usable
because Meta confirms one before releasing it, which is reasoning rather than
something the code can check. And an account that signs in with a phone number
returns no address at all; those members get a clear message telling them to
use their email and password instead.

## Why linking by email is safe

To take over a member's account this way, somebody must already control a
Google or Facebook account on that member's own email address — and both
providers confirm an address before returning it. Anyone with that much access
could already use "Set up / forgot password" on the sign-in page. So this adds
no route that was not already open.

## Testing it

Use `mclucas.andy@gmail.com`, which is a real member row:

1. Sign out
2. **Continue with Google**, pick that account
3. You should land on the dashboard with that member's passes and history —
   **not** on the awaiting-approval screen, and **not** on an empty dashboard

Landing on the approval screen means the match failed and a new row was
created. Stop and say so: it would mean every member doing the same thing gets
a blank account.

Then confirm the ordinary path still works: sign out, sign in with the email and
password.

## Notes

- **Sign-in only works on `members.bundabergvoicecollective.com.au`.** The
  redirect URI is built from `APP_URL` and nothing else, because the request's
  `Host` header is attacker-controlled — the same reason `APP_URL` exists for
  emailed links. On the `run.app` host the provider buttons do not appear
- Linking performs **no writes at all**. A member's `openId` is left alone in
  particular, because `OWNER_OPEN_ID` matches on it to grant admin
- Each sign-in is logged as `[OAuth] google sign-in linked to existing member
  #N` or `… created pending account #N`, which is the quickest way to tell which
  of the two happened
