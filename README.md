# Digital Internal Audit Tool

Internal auditors record observations here and export the draft report as a PDF in
the format MRF already issues — the same layout as `Admin audit.pdf`.

**Setup:** see [SETUP.md](SETUP.md)
**Try it now:** open `index.html` in Chrome or Edge. With no backend configured it
runs in **local mode** (audits saved in that browser only), so you can fill in an
observation and export a PDF without deploying anything.

## What it does

One screen per job:

| Screen | Purpose |
|---|---|
| Audits | every audit, searchable by report number / depot code / location / region, each with a Draft or Final badge |
| Audit workspace | the observations in one audit — reorder, add, delete, preview, export, and see what is running late |
| Observation editor | all report fields, laid out in the same order they print |
| Report preview | the finished report at true A4 width, then **Export PDF** |

An audit is identified by a typed **Report Number** plus its **Depot Details**
— Depot Code, Location and Region. All four are free text and all four are
required, because together they build the report footer: `2026-001` + `9340` +
`Rajkot` + `West 2` prints as `Draft Report - 2026-001_9340_Rajkot_West 2`.
Switching the audit's status to Final changes the footer to `Final Report - …`.
A segment left blank is dropped rather than leaving a stray underscore.

The report number leads because a depot is audited more than once — the depot
segments alone cannot say which report a page belongs to. Numbers are typed,
not generated, so the tool warns when one is already in use but does not block
it: re-issuing a revised report under the same number is legitimate.

## Target dates and urgency

Each observation row in the audit workspace carries a chip showing the
**earliest target date** committed across its implementation rows, and how long
is left:

| Chip | Meaning |
|---|---|
| red | past its target date — `11 days overdue` |
| orange | due within 7 days, or today |
| yellow | due within 30 days |
| green | more than 30 days out |
| green ✔ Completed | every implementation row is marked Done |
| grey | an implementation row exists but no target date was set |

An observation with several responsible people shows the **soonest** date, since
that is the one that decides whether the observation is late; the chip notes
`(+1 more)` when others follow. An observation with no implementation rows at
all shows nothing — the action plan has not been agreed yet, so there is
nothing to be late for.

Each implementation row carries an **Open / Done** toggle in its header. A row
marked Done is dimmed in the editor and drops out of the urgency calculation,
so a commitment met last month stops nagging; the chip then reflects the
soonest *remaining* open row and notes how many are `· 2 done`. When every row
is Done the observation shows **✔ Completed** instead of a date. Closing a row
does not lock it — the fields stay editable, and the toggle flips back.

The status is tracking state, not part of the report: it is **not printed**.
The PDF is the draft report issued to management, and the sample format has no
status column. Say so if you would rather it appeared there.

A roll-up beside the **Observations** heading counts what needs attention:
`1 overdue · 2 due within 7 days · 1 with no target date`.

Days are counted from local midnight to local midnight, so the number does not
drift with the time of day, and a malformed date in the sheet is ignored rather
than rendered as urgent.

## The observation fields

The editor mirrors the printed page top to bottom, so what you fill in is where it
lands:

- **Heading & risk** — title, Repeat Yes/No, Value in INR (printed in lakhs), Risk Rating
  **C**ritical / **H**igh / **M**edium / **L**ow, System Improvement Yes/No
- **Background** — rich text
- **Observation(s)** — rich text, usually a numbered finding list plus data tables
- **Root Cause(s)** — text, plus ticks for People / Process / Technology
- **Business Impact(s)** — text, plus ticks for Operational / Financial / Compliance / Reputational
- **Recommendation(s)** — text, plus ticks for People / Process / Technology
- **Management Response(s)** — rich text
- **Implementation** — one or more rows of Responsible Persons / Designation /
  Action Plan / Target Date, each marked **Open** or **Done**
- **Upload File** — the filenames of your supporting evidence

Every rich-text box supports **bold, italic, underline, bullet lists, numbered
lists, indent levels and data tables**. `+ Table` asks for the size, then a
contextual bar lets you add or remove rows and columns and toggle the header row.
Pasting from Excel or Word keeps the table and the bold, and drops the styling
noise.

Bands with nothing in them are skipped when printing, so a half-finished
observation never prints a stranded gold header.

Values print in **lakhs** — `120000` becomes `Value: INR 1.20 Lakhs`, and a
zero prints as a plain `INR 0`. Target dates print as `March 31, 2024`.

Note that a value well under a lakh loses resolution in that format: ₹5,830
prints as `0.06 Lakhs`. If your observations routinely carry small rupee
amounts, the formatter can switch to grouped digits below a threshold and
lakhs above it.

## Exporting the PDF

**Export PDF** opens the browser's print dialog. Choose **Save as PDF**, and:

- **Headers and footers: off** — otherwise Chrome adds its own date and URL
- **Margins: Default** — the page margins are set by the stylesheet
- **Background graphics** — either way; the stylesheet forces the gold bands
  and the red risk box to print with `print-color-adjust: exact`

Use **Chrome or Edge**. The repeating page footer relies on Blink's handling of a
repeated table footer; Firefox and Safari will produce a usable PDF but the footer
placement is not guaranteed.

## How faithful is the output?

The print stylesheet is built from measurements taken out of `Admin audit.pdf`
(itself a wkhtmltopdf export), and the result was checked by printing through
headless Chrome and comparing coordinates against the original:

| Element | Original | This tool |
|---|---|---|
| Page | A4, 595 × 842 pt | 595 × 842 pt |
| Observation title | x 36.9, y 32.4, 17.3 pt bold | x 36.9, y 32.3, 17.3 pt bold |
| Gold rule | x 34.5, y 72.7 | x 34.5, y 72.8 |
| Header band | x 34.5, y 79.3, h 32.3 | x 34.5, y 79.5, h 32.2 |
| Risk boxes C/H/M/L | x 483.2 / 503.5 / 523.8 / 545.9 | x 483.8 / 503.9 / 524.0 / 545.2 |
| Left column | x 36.3, w 400.3 | x 36.0, w 400.5 |
| Right column (matrices) | x 440.2, w 119.5 | x 440.2, w 119.2 |
| Implementation table | 3 cols, 77.7 / 360.3 / 77.1 | 4 cols, 84.8 / 70.5 / 285.0 / 77.2 |
| Body paragraph indent | x 37.5 | x 37.5 |
| List text indent | x 61.4 | x 61.4 |
| Footer | x 28.7, y 814.5, 13.5 pt | x 34.5, y 797.0, 13.5 pt |

Three deliberate changes from the source:

- the header band reads **Value: INR n** (the source said "Value at Risk")
- the footer's third segment is the depot's **Region**, not the audit area the
  original carried there — footers read `58_Nalagarh_North`, not
  `58_Nalagarh_Administration Control`
- the Implementation table has **four** columns rather than three: Designation
  was added, and Owner(s) / Timeline became Responsible Persons / Target Date.
  The four widths still total the source table's 517.4pt.

Everything lands within about a point, except the footer, which sits ~17 pt higher
and 6 pt further right. That was a deliberate trade: the only footer offset Blink
repeats on *every* page is one that stays inside the content box, and any offset
that reached the original's exact line either overlapped the last lines of body
text or silently vanished from page one.

Two other intentional differences from the source: the section labels are spelled
correctly here (the original reads "Management Respnses(s)" and "Implemetation"),
and rows of a tick matrix are a uniform height rather than taller only where a
tick appears.

## Known gap: charts and images

Page 1 of `Admin audit.pdf` carries a bar chart of telephone expenses. This tool
takes **rich text and tables, not images**, so a chart like that cannot be
reproduced — the underlying numbers would go in as a data table instead. Adding
image support (paste or upload into any section) is a contained change if you want
it.

## How it fits together

`index.html` is public, so it holds no data and no credentials:

```
browser --(team password)--> Cloudflare Worker --(bridge token)--> Apps Script --> Google Sheet
```

The Worker checks the password, issues a signed 8-hour token, and is the only
thing that knows how to reach the sheet. The sheet itself is never link-shared.
Until you set `CFG.API` in `index.html`, none of that is used and the app keeps
everything in the browser.

```
index.html            the whole app — no build step, no framework
worker/worker.js      Cloudflare Worker: password -> token, then proxy to Apps Script
worker/wrangler.toml  Worker config (secrets are set via `wrangler secret put`)
apps-script/Code.gs   reads and writes the Google Sheet
```

`Admin audit.pdf` — the report this layout was measured against — is **not in
this repo**. It is a real Nalagarh audit containing employee names, vendors and
findings, so it is git-ignored and kept on local disks. The fidelity table above
records everything about the format that the code depends on.

`.gitignore` blocks `*.pdf` outright: this repo is public and the tool's whole
purpose is producing audit PDFs, so an exported report must never be committed
by accident.

## The sheet

Three tabs, created automatically on first use:

- **Audits** — one row per audit. `report_no` is the **last** column, not the second: rows are addressed positionally, so inserting it among the existing columns would have shifted every stored audit one place
- **Observations** — one row per observation; the rich-text sections are stored as
  HTML in single cells, tick selections as pipe-separated lists, implementation
  rows as JSON
- **Config** — created by the script but no longer used. Every field in the app
  is typed free text, so there are no picklists left to store. The tab is
  harmless; leave it or delete it.

Because section bodies are HTML that round-trips through the sheet, everything is
sanitised on the way in: only the tags the report uses survive, and all
attributes are stripped except table `colspan`/`rowspan`.
