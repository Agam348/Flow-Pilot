# FlowPilot

FlowPilot is a static browser prototype for small-business cash-flow planning and financing comparison. It demonstrates how an owner can review a 13-week cash forecast, test a receipts scenario, compare illustrative financing assumptions, and export a local evidence record.

All included business data and financing terms are fictional. FlowPilot is a decision-support demo, not a lender, loan offer, credit decision, or financial advice.

## Features

- 13-week cash-flow forecast with an owner-set reserve alert
- Receipts stress testing with the assumptions shown
- Comparison of sample financing options by coverage, estimated payment, and modeled cost
- Local CSV import for forecast rows
- JSON evidence export and a timestamped activity log
- Responsive pages for overview, forecast, financing options, and evidence

The prototype runs in the browser and has no backend or bank connection. CSV data is processed in the current browser session and is not uploaded by the app.

## Run locally

No dependency installation or build step is required. From the repository root, run:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>.

## Deploy on Vercel

Import this GitHub repository as a new Vercel project and use these settings:

- Framework Preset: **Other**
- Root Directory: repository root
- Build Command: leave blank
- Output Directory: `.`

Deploy the project. Vercel will host the static files and provide a `vercel.app` URL.

## App pages

- `index.html` — overview and FlowPilot prompt panel
- `cash-forecast.html` — forecast and receipts stress test
- `financing-options.html` — illustrative financing comparison
- `evidence-pack.html` — CSV import, activity log, and evidence export

## Forecast CSV format

CSV files should include these columns:

```csv
week,receipts,suppliers,payroll,rent,other
2026-10-19,112200,75000,30000,12000,8000
```

The optional `starting` column can specify the opening cash for a row. Use non-negative numeric values. The app validates the file before using its rows.

## Source files

- `app.js` — page behavior and supported task routing
- `engine.js` — deterministic forecast and financing calculations
- `styles.css` — responsive interface styles
- `data/` — fictional case data and a CSV template

The displayed rates, fees, eligibility thresholds, and business figures are demonstration assumptions. Verify any real financial terms directly with providers before making decisions.
