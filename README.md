# NYXARIS AUTH

A self-hosted licensing/authentication panel built with Node.js, Express and SQLite.

## Requirements
- Node.js 18 or newer
- A hosting plan that supports persistent Node.js processes and SQLite/native modules
- HTTPS domain for production use

## Install
1. Upload the project folder to your Node.js hosting.
2. In the project directory, run `npm install`.
3. Copy `.env.example` to `.env`.
4. Set `JWT_SECRET` to a long random secret (32+ characters), and set a strong `ADMIN_PASSWORD` (12+ characters).
5. Set `BASE_URL` to your HTTPS domain. `DB_PATH` should point to persistent storage.
6. Start with `npm start`.
7. Open `https://your-domain/` and sign in with the admin credentials from `.env`.

Do not upload `.env` publicly or commit it to source control. Back up the SQLite database file regularly. If your host deletes files on redeploy, place `DB_PATH` on its persistent disk.

## Dashboard
- Create projects.
- Generate up to 50 keys at once; duration `0` means lifetime.
- Keys are displayed only once. Copy and store them securely.
- View users and keys.
- Revoke/restore users, revoke keys, and reset a user's bound identity.

## API

All admin routes require `Authorization: Bearer <admin-jwt>`.

### Admin
- `POST /api/admin/login` `{ "username": "...", "password": "..." }`
- `GET /api/admin/overview`
- `GET /api/admin/projects`
- `POST /api/admin/projects` `{ "name": "Project", "description": "..." }`
- `GET /api/admin/users`
- `GET /api/admin/keys`
- `POST /api/admin/keys` `{ "projectId": "nyxaris-main", "count": 5, "days": 30 }`
- `POST /api/admin/users/:id/revoke`
- `POST /api/admin/users/:id/unrevoke`
- `POST /api/admin/users/:id/reset-hwid`
- `POST /api/admin/keys/:id/revoke`

### Public licensing
Redeem a one-time key:
`POST /api/auth/redeem`
```json
{
  "key": "NYX-ABCD1234-ABCD1234-ABCD1234",
  "username": "customer123",
  "projectId": "nyxaris-main",
  "hwid": "your-stable-client-or-experience-identity"
}
```

Validate an active license:
`POST /api/auth/validate`
```json
{
  "key": "NYX-ABCD1234-ABCD1234-ABCD1234",
  "projectId": "nyxaris-main",
  "hwid": "same-identity-used-at-redemption"
}
```

The server stores only a SHA-256 hash of each license key and HWID identity. The plaintext key is returned only at creation time.

## Roblox integration
See `roblox/NYXARIS_Auth.server.lua`. This is a server-side Roblox example using `HttpService`. Put it in `ServerScriptService`, enable HTTP requests, replace the domain and license key, and keep the key out of client-visible objects. The example binds a license to a Roblox experience ID, not a physical device.

Roblox clients should not be trusted to enforce licensing. A LocalScript can be modified by a client; keep protected logic and checks on the server. Do not put secrets in ReplicatedStorage or client scripts.

## Important production notes
- Use HTTPS only.
- Use a unique, random `JWT_SECRET`; rotate it if exposed.
- Use a strong admin password and restrict hosting/file-manager access.
- Add backups and monitoring.
- The starter panel has a single environment-configured admin account. Add proper multi-admin roles and audit logs before opening admin access to a team.
- The sample is a foundation, not a guarantee against tampering. A client-side key or response can be copied; sensitive decisions must be made by your own server.
- Check your host's Node.js version and whether it supports installing `better-sqlite3`. If native modules are blocked, use a managed PostgreSQL database or a hosting plan with build support.
