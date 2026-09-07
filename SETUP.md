# Setup

Two ways to run this. Start with local mode to see the output, then wire the
backend when you want the team to share audits.

---

## Local mode (nothing to deploy)

Open `index.html` in Chrome or Edge. Type any password on the sign-in screen —
the first one you enter becomes the local password for that browser. Audits are
saved in that browser's storage only.

This is enough to record an audit and export a matching PDF. Nothing is shared,
and clearing browser data clears the audits, so treat it as a drafting tool
rather than the system of record.

---

## Shared mode (Worker + Google Sheet)

Same arrangement as the Agreement Dashboard:

```
browser --(team password)--> Cloudflare Worker --(bridge token)--> Apps Script --> Google Sheet
```

You need three secrets. Generate the two random ones first and keep them handy:

```bash
openssl rand -hex 32
```

Run it twice — one value becomes `TOKEN_SECRET`, the other `BRIDGE_TOKEN`.

### 1. Create the sheet

Create a Google Sheet named e.g. **MRF Internal Audit — Observations**. Leave it
empty; the tabs (`Audits`, `Observations`, `Config`) are created on first write.
Do **not** link-share it — only the Apps Script needs access.

### 2. Deploy the Apps Script

From the sheet: **Extensions → Apps Script**.

1. Replace the contents of `Code.gs` with `apps-script/Code.gs` from this repo.
2. **Project Settings → Script properties → Add script property**
   - Property: `BRIDGE_TOKEN`
   - Value: the second random string from above
3. **Deploy → New deployment → Web app**
   - Description: `audit tool bridge`
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Authorise it when prompted, then copy the **Web app URL** — it ends in `/exec`.

"Anyone" is safe here because the script rejects every request that does not
carry the exact `BRIDGE_TOKEN`, and only the Worker ever holds that token.

> Re-deploy after any edit to `Code.gs`: **Deploy → Manage deployments → edit →
> Version: New version**. Editing the code alone does not update the live URL.

### 3. Deploy the Worker

```bash
cd worker
wrangler deploy
```

Then set the four secrets:

```bash
wrangler secret put TEAM_PASSWORD
wrangler secret put TOKEN_SECRET
wrangler secret put BRIDGE_TOKEN
wrangler secret put SHEET_ENDPOINT
```

- `TEAM_PASSWORD` — what the audit team types to sign in
- `TOKEN_SECRET` — the first random string (rotating it signs everyone out)
- `BRIDGE_TOKEN` — the second random string, identical to the script property
- `SHEET_ENDPOINT` — the Apps Script `/exec` URL from step 2

Edit `ALLOWED_ORIGINS` in `wrangler.toml` to the origin the app is served from,
then `wrangler deploy` again. A request from an origin not on that list is
refused.

### 4. Point the app at the Worker

In `index.html`, near the top of the `<script>` block:

```js
const CFG = {
  API: 'https://mrf-audit-tool.jofran81.workers.dev',   // <-- your Worker URL
```

Leave it as `''` to stay in local mode.

### 5. Publish

Commit and push to the repo backing GitHub Pages, then confirm the published
origin matches `ALLOWED_ORIGINS`.

---

## Checking it works

```bash
curl -X POST https://<your-worker>.workers.dev/api \
  -H 'Content-Type: application/json' \
  -d '{"action":"login","password":"<TEAM_PASSWORD>"}'
```

A correct password returns `{"token":"...","exp":...}`. A wrong one returns
`401 {"error":"Wrong password."}`.

To confirm the sheet leg, reuse that token:

```bash
curl -X POST https://<your-worker>.workers.dev/api \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{"action":"listAudits"}'
```

`{"audits":[]}` on a fresh sheet means the whole chain is up.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Sheet bridge returned a non-JSON response` | Apps Script returned its HTML error page — re-deploy as a **New version**, and check `BRIDGE_TOKEN` matches on both sides |
| `Origin not allowed` | the serving origin is missing from `ALLOWED_ORIGINS` in `wrangler.toml` |
| `Session expired` right after signing in | `TOKEN_SECRET` changed between deploys, or the Worker has no `TOKEN_SECRET` set |
| `Could not reach the Sheet bridge` | `SHEET_ENDPOINT` is wrong, or the deployment was deleted |
| Chrome's own date/URL printed on each page | **Headers and footers** is on in the print dialog |
| Report footer appears only once | printed from Firefox or Safari — use Chrome or Edge |

## Housekeeping

- The Implementation owner picklist lives in the sheet's **Config** tab and is
  editable in-app under **Settings**. Depot Code, Location and Region are all
  typed on the audit form, so none of them has a list.
- Observation bodies are HTML in a single cell. Editing them by hand in the sheet
  works but is easy to break — prefer the app.
- Google caps a cell at 50,000 characters, which is far more than an observation
  needs, but very large pasted tables are the thing that would hit it.
