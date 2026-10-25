# Secret Rotation Checklist (names only)

Secrets read by this app:
- MONGODB_URI: set in environment / .env. Rotate by updating DB user password and connection string; restart app; existing sessions unaffected, data remains.
- JWT_SECRET: set in environment. Rotate by generating new >=32 char secret and updating env; restart app; all existing tokens invalidated, users must log in again.
- NALO_API_KEY: set in environment. Rotate in Nalo dashboard and env; restart app; in-flight SMS requests may fail.
- HUBTEL_CLIENT_ID / HUBTEL_CLIENT_SECRET: set in environment. Rotate in Hubtel portal and env; restart app; airtime/data payments fail until updated.
- HUBTEL_MERCHANT_ACCOUNT_NUMBER / HUBTEL_PREPAID_DEPOSIT_ID: set in environment. Update if account changes.
- BREVO_API_KEY / SENDGRID_API_KEY / RESEND_API_KEY: set in environment. Rotate in provider dashboard and env; restart app; email delivery fails until updated.
- Cloudinary credentials (if used): set in environment. Rotate in Cloudinary console and env; restart app; media uploads fail until updated.
- Webhook secrets (Hubtel callbacks): set via APP_URL/callback config. Rotate callback URLs/secrets with provider; update APP_URL; restart app.

Order: rotate database first, then JWT, then provider keys, then webhook secrets. Test login and a send after each. Keep old secret until new verified, then revoke.
