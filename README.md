# SCOUT v0.9 — Beta Infrastructure

SCOUT is a professional discovery platform for independent talent.

## What's new in v0.9
- Email verification flow with expiring, single-use verification tokens.
- Forgot-password + password-reset flow with expiring, single-use reset tokens.
- Password reset invalidates all active sessions for that account.
- Existing v0.8 accounts are migrated as already verified because the previous release had no email-verification system.
- Session tokens are stored hashed server-side.
- Auth endpoints have stricter rate limits.
- Password validation is 8–128 characters.
- Uploads enforce MIME/type and configurable size limits.
- Security headers include CSP, frame protection, referrer policy and cross-origin protections.
- Environment-driven deployment settings.
- Development mail outbox for testing verification/reset links without pretending email is being sent.
- Health endpoint reports API version and active database.

## Run locally
Requires Node 22.5+.

```bash
npm install
cp .env.example .env
npm start
```

Then open `http://localhost:3000`.

### Development mail
By default `MAIL_MODE=log`. Verification/reset links are printed in the server terminal and are also available at:

`GET /api/dev/mail`

That endpoint is disabled when `NODE_ENV=production`.

For real email delivery, connect `deliverMail()` in `server.js` to your chosen transactional email provider/SMTP service. v0.9 deliberately does not claim that development mail logs are production email delivery.

## Production checklist
1. Set `NODE_ENV=production`.
2. Set a strong `APP_URL` such as your HTTPS domain.
3. Set `DATABASE_URL` to PostgreSQL.
4. Set `UPLOAD_DIR` to persistent storage or replace the local upload adapter with object storage.
5. Configure a real transactional email provider inside `deliverMail()`.
6. Put the app behind HTTPS and a reverse proxy/load balancer.
7. Set appropriate `MAIL_MODE` for the real mail integration.
8. Review rate limits for your expected traffic.
9. Run the included regression/security tests before opening the beta.

## API additions
- `POST /api/auth/verify-email`
- `POST /api/auth/resend-verification`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `GET /api/dev/mail` (development only)

## Important
v0.9 is beta infrastructure, not a claim of full production security certification. Real email delivery and durable cloud object storage still need to be configured for deployment.

## v0.9 storage

`storage.js` provides the image-storage boundary. Local filesystem storage is used by default; no cloud bucket is claimed as configured.
