#!/usr/bin/env python3
"""
Compute REAL, current numbers for the vault site's Active Positions board.

Runs nightly in CI and writes vault/data/positions.json, which the trading
board fetches at load. The point is that the returns on the site are not a
screenshot of a claim — they are recomputed from market data on a schedule,
so what a visitor reads was true that morning.

Strategy reproduced here (the robo-advisor line):
  - universe: current S&P 500 constituents
  - rank by a blended momentum / low-volatility / trend score
  - equal-weight the top N, rebalanced monthly, long only
  - compare against SPY over the same window

Everything is computed from adjusted closes, so dividends and splits are
already handled. No survivorship correction is attempted — the universe is
today's index membership, which biases the backtest upward; that caveat is
written into the JSON and shown on the site rather than hidden.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from urllib.request import Request, urlopen

import numpy as np
import pandas as pd
import yfinance as yf

OUT = Path(__file__).resolve().parent / "positions.json"

LOOKBACK_YEARS = 3
TOP_N = 25
# The personal allocation shown on The Book. Marked to market by the same job
# that feeds the trading floor, so the page is true the morning it is read
# rather than whenever the numbers were typed.
HOLDINGS = ["XEQT.TO", "CHPS.TO"]
MOMENTUM_DAYS = 126          # ~6 months
VOL_DAYS = 63                # ~3 months
TREND_DAYS = 200             # classic long-term trend filter
BENCHMARK = "SPY"


# Wikipedia rejects pandas' default urllib user-agent with a 403, so the page
# is fetched explicitly. If the fetch or the page layout ever fails, we fall
# back to a static slice of large caps rather than failing the nightly job —
# a slightly smaller universe is much better than a stale site.
FALLBACK_UNIVERSE = [
    "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "GOOG", "BRK-B", "AVGO", "TSLA",
    "LLY", "JPM", "V", "XOM", "UNH", "MA", "COST", "HD", "PG", "JNJ",
    "WMT", "NFLX", "ABBV", "CRM", "BAC", "ORCL", "MRK", "CVX", "KO", "AMD",
    "PEP", "ADBE", "TMO", "LIN", "ACN", "MCD", "CSCO", "ABT", "PM", "IBM",
    "GE", "QCOM", "TXN", "DHR", "VZ", "INTU", "CAT", "NEE", "RTX", "AMGN",
    "PFE", "SPGI", "CMCSA", "UNP", "LOW", "AXP", "HON", "COP", "BKNG", "ISRG",
]


def sp500_universe() -> list[str]:
    """Current S&P 500 tickers, from Wikipedia, normalised for Yahoo."""
    url = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
    try:
        req = Request(url, headers={"User-Agent": "umercheema.xyz vault-site/1.0"})
        with urlopen(req, timeout=30) as resp:
            html = resp.read().decode("utf-8", "replace")
        tables = pd.read_html(StringIO(html))
        syms = tables[0]["Symbol"].astype(str).str.strip()
        out = sorted(syms.str.replace(".", "-", regex=False).tolist())
        if len(out) < 400:
            raise ValueError(f"only parsed {len(out)} symbols")
        return out
    except Exception as exc:                                  # noqa: BLE001
        print(f"  ! index fetch failed ({exc}); using fallback universe", flush=True)
        return FALLBACK_UNIVERSE


def download(tickers: list[str], start: str) -> pd.DataFrame:
    raw = yf.download(
        tickers, start=start, auto_adjust=True, progress=False, threads=True
    )
    close = raw["Close"] if isinstance(raw.columns, pd.MultiIndex) else raw.to_frame()
    # drop names with large gaps; they break the ranking rather than help it
    return close.dropna(axis=1, thresh=int(len(close) * 0.95))


def month_ends(idx: pd.DatetimeIndex) -> list[pd.Timestamp]:
    return list(pd.Series(idx, index=idx).resample("ME").last().dropna())


def score(px: pd.DataFrame, asof: pd.Timestamp) -> pd.Series:
    """Blend of 6m momentum, inverse 3m volatility, and a 200d trend filter."""
    hist = px.loc[:asof]
    if len(hist) < TREND_DAYS + 5:
        return pd.Series(dtype=float)

    mom = hist.iloc[-1] / hist.iloc[-MOMENTUM_DAYS] - 1.0
    rets = hist.pct_change()
    vol = rets.iloc[-VOL_DAYS:].std() * np.sqrt(252)
    above = (hist.iloc[-1] > hist.iloc[-TREND_DAYS:].mean()).astype(float)

    z = lambda s: (s - s.mean()) / (s.std() or 1.0)  # noqa: E731
    blended = 0.55 * z(mom.dropna()) - 0.30 * z(vol.dropna()) + 0.15 * above
    return blended.dropna().sort_values(ascending=False)


def backtest(px: pd.DataFrame) -> tuple[pd.Series, list[str]]:
    """Monthly-rebalanced equal-weight top-N. Returns the equity curve."""
    rebals = month_ends(px.index)
    daily = px.pct_change().fillna(0.0)

    equity, holdings = [], []
    curve, value = [], 1.0
    prev = None

    for i, dt in enumerate(px.index):
        if prev is not None and any(r for r in rebals if prev < r <= dt):
            s = score(px, dt)
            holdings = list(s.head(TOP_N).index) if len(s) else holdings
        if holdings:
            value *= 1.0 + daily.loc[dt, holdings].mean()
        curve.append(value)
        prev = dt

    equity = pd.Series(curve, index=px.index)
    return equity, holdings


def stats(equity: pd.Series) -> dict:
    rets = equity.pct_change().dropna()
    years = max((equity.index[-1] - equity.index[0]).days / 365.25, 1e-9)
    total = equity.iloc[-1] / equity.iloc[0] - 1.0
    cagr = (equity.iloc[-1] / equity.iloc[0]) ** (1 / years) - 1.0
    vol = rets.std() * np.sqrt(252)
    sharpe = (rets.mean() * 252) / vol if vol else 0.0
    dd = float((equity / equity.cummax() - 1.0).min())
    return {
        "total_return": round(float(total) * 100, 2),
        "cagr": round(float(cagr) * 100, 2),
        "sharpe": round(float(sharpe), 2),
        "max_drawdown": round(dd * 100, 2),
        "volatility": round(float(vol) * 100, 2),
    }


def main() -> int:
    start = (pd.Timestamp.today() - pd.DateOffset(years=LOOKBACK_YEARS)).strftime("%Y-%m-%d")

    print("fetching S&P 500 membership…", flush=True)
    universe = sp500_universe()
    print(f"  {len(universe)} tickers", flush=True)

    print("downloading prices…", flush=True)
    px = download(universe, start)
    print(f"  {px.shape[1]} usable series, {px.shape[0]} sessions", flush=True)

    print("running strategy…", flush=True)
    equity, holdings = backtest(px)
    strat = stats(equity)

    bench_px = download([BENCHMARK], start)
    bench_col = bench_px.columns[0]
    bench = bench_px[bench_col].reindex(equity.index).ffill()
    bench_stats = stats(bench / bench.iloc[0])

    # a light sparkline for the board: ~80 evenly spaced points, normalised
    pts = equity.iloc[:: max(1, len(equity) // 80)]
    spark = [round(float(v / equity.iloc[0]), 4) for v in pts]

    # Per-holding series for the wall screens. These used to be synthetic noise
    # baked into a canvas texture; the screens are real DOM now, so they can
    # carry the actual last-quarter price action of the names actually held.
    # 48 points is enough to read as a chart at the size these render.
    screens = []
    for sym in holdings[:8]:
        if sym not in px.columns:
            continue
        s = px[sym].dropna().iloc[-63:]
        if len(s) < 10:
            continue
        step_n = max(1, len(s) // 48)
        pts_s = s.iloc[::step_n]
        lo, hi = float(pts_s.min()), float(pts_s.max())
        rng = (hi - lo) or 1.0
        # Headline number is the DAILY change — last close against the one
        # before it. A ticker crawl means "today" everywhere else in the world,
        # and showing a quarter's move in that format reads as fake even when
        # the number is real: nothing gains 100% in a session.
        prev = float(s.iloc[-2]) if len(s) >= 2 else float(s.iloc[-1])
        last = float(s.iloc[-1])
        screens.append({
            "symbol": sym,
            "pct_day": round((last / prev - 1.0) * 100, 2) if prev else 0.0,
            # kept for the sparkline caption: the trend the chart actually draws
            "pct_window": round((last / float(s.iloc[0]) - 1.0) * 100, 2),
            "last": round(last, 2),
            # normalised 0..1 so the client can plot without knowing the scale
            "spark": [round((float(v) - lo) / rng, 4) for v in pts_s],
        })

    print("pricing personal holdings…", flush=True)
    holdings_payload = {}
    for sym in HOLDINGS:
        try:
            h = download([sym], start)
            col = h[h.columns[0]].dropna()
            ytd = col[col.index >= f"{col.index[-1].year}-01-01"]
            holdings_payload[sym.split(".")[0]] = {
                "ytd": round(float(col.iloc[-1] / ytd.iloc[0] - 1.0) * 100, 2),
                "one_year": round(float(col.iloc[-1] / col.iloc[max(0, len(col) - 253)] - 1.0) * 100, 2),
            }
        except Exception as exc:                              # noqa: BLE001
            # A ticker that fails to price is left out rather than shown as
            # zero; the page renders an em dash for anything missing.
            print(f"  ! {sym} failed ({exc})", flush=True)

    payload = {
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "window": {"start": str(equity.index[0].date()), "end": str(equity.index[-1].date())},
        "universe_size": int(px.shape[1]),
        "top_n": TOP_N,
        "strategy": strat,
        "benchmark": {"symbol": BENCHMARK, **bench_stats},
        "holdings": holdings[:12],
        "personal": holdings_payload,
        "sparkline": spark,
        "screens": screens,
        "caveat": (
            "Backtest over today's S&P 500 membership; not survivorship-adjusted. "
            "Recomputed nightly from adjusted closes. Not investment advice."
        ),
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {OUT}", flush=True)
    print(json.dumps(payload["strategy"], indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
