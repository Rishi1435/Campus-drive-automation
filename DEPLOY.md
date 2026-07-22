# Campus Drive Automation — Setup & Deployment

Reads **placement-only** WhatsApp group messages, extracts drive details with an
LLM, de-duplicates them, and appends each new drive to a **live Google Sheet**
you can open from anywhere.

```
WhatsApp (whitelisted groups only) ─► LLM parser ─► dedup ─► Google Sheet (your Gmail)
```

> Outlook mail reading is **disabled**: the college Microsoft tenant blocks
> student app consent. The Microsoft code is kept in the repo but unused; if IT
> ever grants admin consent it can be re-enabled. See the end of this file.

---

## 1. Create the Google Sheet + Apps Script web app (free, ~3 min, no Cloud Console)

No GCP project, no service account, no JSON keys. You paste one script into your
sheet and deploy it as a web app; the bot posts new drives to that URL.

1. Create a blank sheet at <https://sheets.new> (name it e.g. "Campus Drives").
2. In the sheet: **Extensions → Apps Script**.
3. Delete the sample code, then paste the **entire** contents of
   [tools/AppsScript.gs](tools/AppsScript.gs). Click **Save** (💾).
   - The `TOKEN` in that file already matches `GAS_TOKEN` in your `.env` — leave both as-is.
4. Click **Deploy → New deployment**. Click the gear ⚙ → **Web app**. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone
   Click **Deploy**, then **Authorize access** and allow (pick your Gmail; if you
   see "Google hasn't verified this app", click **Advanced → Go to … (unsafe)** —
   it's your own script).
5. Copy the **Web app URL** it shows (ends in `/exec`).
6. Put that URL in `.env` as `GAS_WEBAPP_URL`.

That's it — the sheet's first row of headers is created automatically on the first
drive, and duplicates are filtered inside the script.

---

## 2. Configure locally

```bash
cp .env.example .env        # if you don't already have .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # -> APP_SECRET_KEY
```

Fill `.env`: `NVIDIA_API_KEY`, `APP_SECRET_KEY`, `GAS_WEBAPP_URL`,
`WA_ALLOWED_CHATS` (group names or IDs), and `MONGODB_URI` if deploying to cloud.
(`GAS_TOKEN` is already filled in and matches the script.)

Get your placement group IDs/names (optional — you can also just use the names):
```bash
npm run list-groups     # scan the QR once, copy the group names/IDs you want
```

---

## 3. First run

```bash
npm start
```

You'll see:
1. `Google Sheet webhook reachable.` (confirms the script URL works)
2. A **WhatsApp QR** — scan it in WhatsApp → *Linked Devices*.
3. `WhatsApp client ready.`

Post a message with a placement keyword (e.g. "campus drive") in one of your
whitelisted groups — a new row should appear in the Google Sheet within seconds.

---

## 4. Deploy free, no credit card (Render + MongoDB Atlas)

Free cloud hosts wipe their disk on restart, so the WhatsApp session is stored in
**MongoDB Atlas** (free, no card). Setting `MONGODB_URI` enables this automatically.

### 4a. MongoDB Atlas (no card)
1. Sign up at <https://www.mongodb.com/cloud/atlas/register>, create a **free M0** cluster.
2. **Database Access →** add a user (username + password).
3. **Network Access →** add `0.0.0.0/0` (Render's IPs vary).
4. **Connect → Drivers →** copy the connection string → `MONGODB_URI`
   (insert a db name like `campusdrive` before the `?`).

### 4b. Seed the WhatsApp session once
Run locally with the same `MONGODB_URI` in `.env`, scan the QR, and wait for
`WhatsApp session backed up to MongoDB.`, then Ctrl-C. The session now lives in Atlas.

### 4c. Deploy on Render (free, no card)
1. Push this repo to GitHub (secrets are git-ignored, safe to push).
2. <https://render.com> → **New → Web Service** → connect the repo → runtime
   **Docker**, instance type **Free**.
3. **Environment →** add `NVIDIA_API_KEY`, `APP_SECRET_KEY`, `WA_ALLOWED_CHATS`,
   `GAS_WEBAPP_URL`, `GAS_TOKEN`, and `MONGODB_URI`.
4. Deploy. Logs should show `MongoDB connected`, `Google Sheets ready.`,
   `WhatsApp client ready.` (no QR needed, thanks to 4b).
5. **Keep it awake:** free Render services sleep after ~15 min idle. Add a free
   <https://uptimerobot.com> monitor pinging your Render URL every 5 minutes.

> **Koyeb** works the same way (also no card) and its free instance doesn't sleep.
> RAM is ~512 MB on both — tight for Chromium; if it crash-loops, use a device below.

### Alternative: your own always-on device (most stable)
Leave `MONGODB_URI` blank and run on a Raspberry Pi or any always-on PC:
```bash
docker compose up -d
docker compose logs -f
```

> Avoid Vercel — it's serverless and cannot run a WhatsApp client.

---

## 5. Security notes

- **Secrets** (`.env`, `.secrets/`, `.wwebjs_auth/`) are git-ignored — never commit them.
- The Apps Script web app is guarded by a **shared secret** (`GAS_TOKEN` =
  `TOKEN` in the script), so random people who find the URL can't post to your
  sheet. If the token ever leaks, change it in both `AppsScript.gs` (redeploy) and
  `.env`. The script only ever writes to its own sheet.
- **Personal chats are never processed** — only whitelisted group names/IDs are
  read, so private messages are never downloaded or sent to the LLM.
- The container runs as a **non-root user**.
- **MongoDB (cloud mode):** the WhatsApp session stored there is a live login to
  your account — treat `MONGODB_URI` as a secret, use a strong DB password, and
  restrict network access to what Render needs.
- If a device is ever lost, revoke it in WhatsApp → *Linked Devices*.

---

## Re-enabling Outlook mail later (only if college IT grants consent)

The Microsoft integration (`graphAuth.js`, `outlook.js`, `excelOnline.js`) is
intact but not wired into `index.js`. If an admin ever consents to the app in the
`aec.edu.in` tenant, uncomment the `MS_*` vars in `.env` and re-add the mail
polling to `index.js`. Until then it stays off.
