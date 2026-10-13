export const ENV = {
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  isProduction: process.env.NODE_ENV === "production",
  // Public origin of the deployed site, e.g. https://example.run.app. Used to
  // build emailed invite and password links so they never depend on the
  // request's Host header or on the sender's browser.
  appUrl: process.env.APP_URL ?? "",
  // Where the platform's own notices go — a member's first sign-in, a Square
  // purchase, a live stream purchase. It was hardcoded to
  // admin@bundabergvoicecollective.com.au, which cannot receive anything: the
  // zone carries no MX records at all (docs/dns-before-move.md), so every one
  // of those notices has gone nowhere. A setting rather than a constant, so
  // the next change is a secret and not a deploy.
  ownerEmail: process.env.OWNER_EMAIL ?? "bundabergvoicecollective@gmail.com",
  // openId of the account auto-promoted to admin on first sign-in
  // (format: "email:<address>"). Unset means no auto-promotion.
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  // Social sign-in. A provider with either value unset is not advertised on
  // the login page and its routes 404 — the same degrade-rather-than-fail rule
  // as R2 and Square below. Both also need APP_URL, because the redirect URI
  // has to match the provider console exactly; see server/oauth.ts.
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  facebookAppId: process.env.FACEBOOK_APP_ID ?? "",
  facebookAppSecret: process.env.FACEBOOK_APP_SECRET ?? "",
  // Cloudflare R2
  r2AccountId: process.env.R2_ACCOUNT_ID ?? "",
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
  r2BucketName: process.env.R2_BUCKET_NAME ?? "bvc-storage",
  r2PublicUrl: process.env.R2_PUBLIC_URL ?? "", // e.g. https://pub-xxx.r2.dev
  // Web Push
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? "",
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? "",
  vapidEmail: process.env.VAPID_EMAIL ?? "admin@bundabergvoicecollective.com.au",
  // Email (SMTP via Resend or other provider)
  smtpHost: process.env.SMTP_HOST ?? "smtp.resend.com",
  smtpPort: parseInt(process.env.SMTP_PORT ?? "465"),
  smtpUser: process.env.SMTP_USER ?? "resend",
  smtpPass: process.env.SMTP_PASS ?? "",
  smtpFrom: process.env.SMTP_FROM ?? "BVC <noreply@bundabergvoicecollective.com.au>",
  // Square payments
  squareAccessToken: process.env.SQUARE_ACCESS_TOKEN ?? "",
  squareWebhookSignatureKey: process.env.SQUARE_WEBHOOK_SIGNATURE_KEY ?? "",
  squareWebhookUrl: process.env.SQUARE_WEBHOOK_URL ?? "",
  // Defaults to production: the BVC Square account is live, so an unset
  // variable must not silently route real payments at the sandbox API.
  squareEnvironment: (process.env.SQUARE_ENVIRONMENT ?? "production") as "sandbox" | "production",
};
