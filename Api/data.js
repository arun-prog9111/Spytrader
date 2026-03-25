const FINNHUB_TOKEN = "d724lghr01qjeeeftbegd724lghr01qjeeeftbf0";

async function fetchJSON(url, timeout = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    clearTimeout(timer);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function getFinnhubQuote(symbol) {
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_TOKEN}`;
  return fetchJSON(url);
}

async function getYahooCandles(symbol, interval = "5m", range = "1d") {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`;
  const data = await fetchJSON(url);
  const result = data?.chart?.result?.[0];
  if (!result || !result.timestamp) return null;
  const q = result.indicators?.quote?.[0];
  return {
    t: result.timestamp,
    o: q?.open || [],
    h: q?.high || [],
    l: q?.low || [],
    c: q?.close || [],
    v: q?.volume || [],
    meta: {
      regularMarketPrice: result.meta?.regularMarketPrice,
      previousClose: result.meta?.chartPreviousClose || result.meta?.previousClose,
      regularMarketDayHigh: result.meta?.regularMarketDayHigh,
      regularMarketDayLow: result.meta?.regularMarketDayLow,
      regularMarketVolume: result.meta?.regularMarketVolume,
    }
  };
}

async function getEconCalendar() {
  const url = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
  const data = await fetchJSON(url);
  if (!Array.isArray(data)) return [];
  const today = new Date().toISOString().slice(0, 10);
  return data.filter(e => e.country === "USD" && e.date && e.date.startsWith(today));
}

async function getEarnings() {
  const today = new Date().toISOString().slice(0, 10);
  const url = `https://finnhub.io/api/v1/calendar/earnings?from=${today}&to=${today}&token=${FINNHUB_TOKEN}`;
  try {
    const data = await fetchJSON(url);
    return data?.earningsCalendar || [];
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=10");

  const errors = [];
  const result = {
    spy: null, qqq: null, iwm: null, vix: null,
    candles: null, econ: [], earnings: [],
    timestamp: new Date().toISOString()
  };

  const quoteSymbols = [
    { sym: "SPY", key: "spy" },
    { sym: "QQQ", key: "qqq" },
    { sym: "IWM", key: "iwm" },
  ];
  const quoteResults = await Promise.allSettled(
    quoteSymbols.map(s => getFinnhubQuote(s.sym))
  );
  quoteResults.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value?.c > 0) {
      result[quoteSymbols[i].key] = r.value;
    } else {
      errors.push(`${quoteSymbols[i].sym} quote`);
    }
  });

  let gotVix = false;
  for (const sym of ["^VIX", "VIX", "VIXY"]) {
    if (gotVix) break;
    try {
      const q = await getFinnhubQuote(sym);
      if (q?.c > 0) {
        result.vix = { level: q.c, pc: q.pc, source: sym, isProxy: sym === "VIXY" };
        gotVix = true;
      }
    } catch {}
  }
  if (!gotVix) {
    try {
      const yVix = await getYahooCandles("^VIX", "1d", "1d");
      if (yVix?.c?.length > 0) {
        const lastC = yVix.c[yVix.c.length - 1];
        if (lastC > 0) {
          result.vix = { level: lastC, pc: yVix.meta?.previousClose || 0, source: "Yahoo ^VIX", isProxy: false };
          gotVix = true;
        }
      }
    } catch {}
  }
  if (!gotVix) errors.push("VIX");

  try {
    const candles = await getYahooCandles("SPY", "5m", "1d");
    if (candles && candles.c.length > 0) {
      result.candles = candles;
    } else {
      errors.push("Candles (empty)");
    }
  } catch (e) {
    errors.push("Candles");
  }

  try {
    result.econ = await getEconCalendar();
  } catch (e) {
    errors.push("Econ");
  }

  try {
    result.earnings = await getEarnings();
  } catch (e) {
    errors.push("Earnings");
  }

  result.errors = errors;
  return res.status(200).json(result);
}
