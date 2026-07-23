# fuelbook — fuel mileage calculator & fill-up log

**Honest tank-to-tank km/L and true all-in cost per km for one vehicle — no account, no cloud, no ads. Your log lives in your browser.**

Live app: **https://sreenivas-sadhu-prabhakara.github.io/fuelbook/**

People argue endlessly about real vs claimed mileage. fuelbook settles it with the only
method that actually works for manual logging — **full-to-full**: fill the tank until the
pump cuts off, note the odometer, and next full fill divide the kilometres travelled by
the litres it took to refill. fuelbook automates that over your whole log, folds partial
top-ups into the right tank, and refuses to invent a number when the method can't produce
one.

## Features

- **Fill-up log** — date, odometer, litres, total amount (price/litre auto-derived),
  FULL/PARTIAL toggle, notes; edit and delete; validation rejects odometer readings that
  go backwards and non-positive litres/amounts.
- **Full-to-full engine** — a mileage segment runs between consecutive FULL fills;
  partials in between are folded in and the segment is labelled *includes partial*.
  Entries before your first FULL or after your last FULL are excluded from km/L, with the
  reason shown on screen.
- **True cost per km** — fuel-only *and* all-in (service, insurance, tyres, other)
  figures computed over the same first-FULL-to-last-FULL window, so both cover exactly
  the same kilometres. Expenses dated outside the window are flagged
  *waiting for next full fill*.
- **Dashboard** — lifetime km/L, best and worst tank, fuel cost/km, all-in cost/km,
  this-month fuel spend, total km logged; every card states its window.
- **Trend chart** — one point per tank with a trailing-3-tank average; if the latest tank
  is >10% below that average, you get a neutral prompt (*check tyre pressure, service
  due, or fuel quality*) — never a diagnosis.
- **Sample log** — "See it with a sample log" loads clearly-invented demo entries under a
  persistent SAMPLE banner so the payoff is visible before your own second full fill.
- **Units & currency** — km+L (km/L and L/100km) or mi+gal (mpg); free-text currency
  symbol (₹ default); Indian or plain digit grouping. Labels and arithmetic only — stored
  entries are never converted.
- **Export** — RFC-4180 CSV of fills and expenses (your backup and handoff) and a
  printable one-page summary (print to PDF from the browser).

## Quickstart

Use it online at the link above, or run it locally:

```sh
git clone https://github.com/Sreenivas-Sadhu-Prabhakara/fuelbook.git
cd fuelbook
python3 -m http.server 8080   # or any static server; file:// also works
```

Then open `http://localhost:8080/`. To run the self-tests (Node 20+):

```sh
node --test
```

The tests re-derive the full-to-full engine against a hand-computed fixture log to the
paisa, plus a 400-round property test proving segments conserve km, millilitres, and
paise against the lifetime window.

## Privacy — enforced, not promised

- No account, no cloud, no analytics, no ads.
- The page ships a strict Content-Security-Policy with `connect-src 'none'` — the
  **browser itself blocks any network send**. There is nothing to opt out of.
- Your log lives only in this browser's `localStorage`. Clearing site data erases it;
  CSV export is your backup.

## Honest limits

- **Manual entry only** — no receipt OCR, no OBD/Bluetooth, no GPS trip tracking.
- km/L exists only **between two FULL fills**; a log of partials shows spend totals but
  the app honestly refuses to show mileage ("need two full fills to compute").
- "Full" varies with each pump's auto-cutoff, so single-tank figures wobble a few
  percent — trust the lifetime line over any one tank.
- All-in cost/km covers only the first-FULL-to-last-FULL window; expenses outside it are
  flagged and join the figure after the next full fill.
- The trend note is a prompt, never a mechanical diagnosis.
- One vehicle per browser profile; no fuel-price feeds; no claimed-mileage database (the
  optional claimed-figure reference line is typed by you and labelled as such).

## Disclaimer

fuelbook is an informational calculator over numbers you enter yourself. It is not
financial, mechanical, or professional advice; figures are only as accurate as your
entries and the full-to-full method's stated limits. The software is provided **"as
is"**, without warranty of any kind — see [LICENSE](LICENSE). Verify anything that
matters with a professional.

## License

MIT © 2026 Sreenivas Sadhu Prabhakara
