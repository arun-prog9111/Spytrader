var FINNHUB_TOKEN = "d724lghr01qjeeeftbegd724lghr01qjeeeftbf0";

async function fetchJSON(url, timeout) {
  timeout = timeout || 8000;
  var ctrl = new AbortController();
  var timer = setTimeout(function() { ctrl.abort(); }, timeout);
  try {
    var r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0" } });
    clearTimeout(timer);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } catch (e) { clearTimeout(timer); throw e; }
}

async function getFinnhubQuote(symbol) {
  return fetchJSON("https://finnhub.io/api/v1/quote?symbol=" + encodeURIComponent(symbol) + "&token=" + FINNHUB_TOKEN);
}

async function getYahooCandles() {
  var url = "https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=5m&range=1d";
  var data = await fetchJSON(url);
  var result = data && data.chart && data.chart.result && data.chart.result[0];
  if (!result || !result.timestamp) return null;
  var q = result.indicators && result.indicators.quote && result.indicators.quote[0];
  return {
    t: result.timestamp,
    o: (q && q.open) || [],
    h: (q && q.high) || [],
    l: (q && q.low) || [],
    c: (q && q.close) || [],
    v: (q && q.volume) || []
  };
}

async function getEconCalendar() {
  var data = await fetchJSON("https://nfs.faireconomy.media/ff_calendar_thisweek.json");
  if (!Array.isArray(data)) return [];
  var today = new Date().toISOString().slice(0, 10);
  return data.filter(function(e) { return e.country === "USD" && e.date && e.date.startsWith(today); });
}

async function getEarnings() {
  var today = new Date().toISOString().slice(0, 10);
  try {
    var data = await fetchJSON("https://finnhub.io/api/v1/calendar/earnings?from=" + today + "&to=" + today + "&token=" + FINNHUB_TOKEN);
    return (data && data.earningsCalendar) || [];
  } catch (e) { return []; }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=10");

  var errors = [];
  var result = { spy: null, qqq: null, iwm: null, vix: null, candles: null, econ: [], earnings: [], timestamp: new Date().toISOString() };

  var quoteSymbols = [{ sym: "SPY", key: "spy" }, { sym: "QQQ", key: "qqq" }, { sym: "IWM", key: "iwm" }];
  var quoteResults = await Promise.allSettled(quoteSymbols.map(function(s) { return getFinnhubQuote(s.sym); }));
  quoteResults.forEach(function(r, i) {
    if (r.status === "fulfilled" && r.value && r.value.c > 0) { result[quoteSymbols[i].key] = r.value; }
    else { errors.push(quoteSymbols[i].sym); }
  });

  var gotVix = false;
  var vixSyms = ["^VIX", "VIX", "VIXY"];
  for (var i = 0; i < vixSyms.length; i++) {
    if (gotVix) break;
    try {
      var q = await getFinnhubQuote(vixSyms[i]);
      if (q && q.c > 0) { result.vix = { level: q.c, pc: q.pc, source: vixSyms[i], isProxy: vixSyms[i] === "VIXY" }; gotVix = true; }
    } catch (e) {}
  }
  if (!gotVix) {
    try {
      var yVix = await fetchJSON("https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=1d");
      var vr = yVix && yVix.chart && yVix.chart.result && yVix.chart.result[0];
      var vc = vr && vr.indicators && vr.indicators.quote && vr.indicators.quote[0] && vr.indicators.quote[0].close;
      if (vc && vc.length > 0 && vc[vc.length - 1] > 0) {
        result.vix = { level: vc[vc.length - 1], pc: (vr.meta && vr.meta.chartPreviousClose) || 0, source: "Yahoo VIX", isProxy: false };
        gotVix = true;
      }
    } catch (e) {}
  }
  if (!gotVix) errors.push("VIX");

  try {
    var candles = await getYahooCandles();
    if (candles && candles.c && candles.c.length > 0) { result.candles = candles; }
    else { errors.push("Candles"); }
  } catch (e) { errors.push("Candles"); }

  try { result.econ = await getEconCalendar(); } catch (e) { errors.push("Econ"); }
  try { result.earnings = await getEarnings(); } catch (e) { errors.push("Earnings"); }

  result.errors = errors;
  return res.status(200).json(result);
};