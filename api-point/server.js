"use strict";

const http = require("node:http");

const PORT = Number(process.env.PORT || 3000);
const DEFAULT_QUESTION_ID = "q-ledger-agent-server";
const BODY_LIMIT = 64 * 1024;
const MONTHS = new Map([
  ["january", 1], ["jan", 1], ["february", 2], ["feb", 2],
  ["march", 3], ["mar", 3], ["april", 4], ["apr", 4],
  ["may", 5], ["june", 6], ["jun", 6], ["july", 7], ["jul", 7],
  ["august", 8], ["aug", 8], ["september", 9], ["sep", 9],
  ["october", 10], ["oct", 10], ["november", 11], ["nov", 11],
  ["december", 12], ["dec", 12],
]);
const REGIONS = ["North", "South", "East", "West", "Central"];
const CURRENCIES = ["USD", "EUR", "INR"];

function normalizeText(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function latestOrders(rows) {
  const byId = new Map();
  for (const row of rows) {
    if (!row || typeof row.id !== "string" || !Number.isFinite(Number(row.amount))) {
      throw new Error("The ledger export contains an invalid order.");
    }
    const previous = byId.get(row.id);
    if (!previous || Date.parse(row.updated_at) >= Date.parse(previous.updated_at)) {
      byId.set(row.id, row);
    }
  }
  return [...byId.values()];
}

function businessDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const fields = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function dateFilter(question) {
  const normalized = normalizeText(question);
  const dateMatch = normalized.match(/\b(20\d{2})\s+(\d{1,2})\s+(\d{1,2})\b/);
  if (dateMatch) {
    const date = `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`;
    return (orderDate) => orderDate === date;
  }

  const yearMatch = normalized.match(/\b(20\d{2})\b/);
  const monthMatch = [...MONTHS.entries()].find(([name]) => new RegExp(`\\b${name}\\b`).test(normalized));
  const quarterMatch = normalized.match(/\b(?:q([1-4])|(?:first|1st|second|2nd|third|3rd|fourth|4th)\s+quarter)\b/);

  if (monthMatch) {
    const month = monthMatch[1];
    return (orderDate) => {
      const [year, orderMonth] = orderDate.split("-").map(Number);
      return orderMonth === month && (!yearMatch || year === Number(yearMatch[1]));
    };
  }

  if (quarterMatch) {
    const quarterNames = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4 };
    const quarter = Number(quarterMatch[1] || quarterNames[quarterMatch[0].split(" ")[0]]);
    return (orderDate) => {
      const [year, month] = orderDate.split("-").map(Number);
      return Math.ceil(month / 3) === quarter && (!yearMatch || year === Number(yearMatch[1]));
    };
  }

  if (yearMatch) {
    const year = Number(yearMatch[1]);
    return (orderDate) => Number(orderDate.slice(0, 4)) === year;
  }
  return () => true;
}

function findNamedValue(question, values) {
  const normalizedQuestion = ` ${normalizeText(question)} `;
  const sorted = [...new Set(values)].sort((a, b) => b.length - a.length);
  for (const value of sorted) {
    const normalized = normalizeText(value);
    if (normalizedQuestion.includes(` ${normalized} `) ||
        normalizedQuestion.includes(` ${normalized}s `)) {
      return value;
    }
  }
  return null;
}

function filtersFor(question, orders) {
  const normalized = normalizeText(question);
  const region = findNamedValue(question, REGIONS);
  const product = findNamedValue(question, orders.map((order) => order.product));
  const customer = question.match(/\bC\d{4}\b/i)?.[0]?.toUpperCase() || null;
  const rangeDate = dateFilter(question);
  const requestedStatus = /\b(refund(?:ed|s)?|returned)\b/.test(normalized)
    ? "refunded"
    : /\b(void|voided|cancelled|canceled)\b/.test(normalized)
      ? "void"
      : /\b(paid)\b/.test(normalized)
        ? "paid"
        : null;

  return orders.filter((order) => {
    const orderDate = businessDate(order.created_at);
    return (!region || normalizeText(order.region) === normalizeText(region)) &&
      (!product || normalizeText(order.product) === normalizeText(product)) &&
      (!customer || order.customer.toUpperCase() === customer) &&
      (!requestedStatus || order.status === requestedStatus) &&
      rangeDate(orderDate);
  });
}

function targetCurrency(question) {
  const match = question.match(/\b(?:in|to|into)\s+(USD|EUR|INR)\b/i);
  return match ? match[1].toUpperCase() : "USD";
}

function isCountQuestion(question) {
  return /\b(how many|count|number of|quantity of|units?|items?)\b/i.test(question);
}

function amountMetric(question) {
  const normalized = normalizeText(question);
  if (/\b(refund|refunded|refunds|returned)\b/.test(normalized)) return "refund";
  if (/\b(revenue|sales|spent|spend|turnover|value|amount|money|worth)\b/.test(normalized)) return "revenue";
  return null;
}

function groupDimension(question) {
  const normalized = normalizeText(question);
  if (/\b(customer|customers|client|clients|who)\b/.test(normalized)) return "customer";
  if (/\b(product|products|item|items)\b/.test(normalized)) return "product";
  if (/\b(region|regions)\b/.test(normalized)) return "region";
  return null;
}

function orderValue(order, metric, rates, currency) {
  if (metric === "units") return Number(order.qty);
  if (metric === "orders") return 1;
  const usd = Number(order.amount) * Number(rates[order.currency]);
  return usd / Number(rates[currency]);
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function answerQuestion(question, orders, rates) {
  const filtered = filtersFor(question, orders);
  const normalized = normalizeText(question);
  const count = isCountQuestion(question);
  const metricName = amountMetric(question);
  const isCustomerCount = count && /\b(customer|customers|client|clients)\b/.test(normalized) &&
    !/\borders?\b/.test(normalized) && !/\b(units?|items?)\b/.test(normalized);
  const isUnitCount = count && /\b(units?|items?|quantity)\b/.test(normalized);
  const rankedOrderCount = !metricName &&
    /\b(top|highest|largest|most|best|least|lowest|smallest)\b/i.test(question) &&
    /\borders?\b/i.test(question);
  const metric = isUnitCount ? "units" : (count || rankedOrderCount ? "orders" : metricName || "revenue");
  const rows = metric === "refund"
    ? filtered.filter((order) => order.status === "refunded")
    : metric === "revenue"
      ? filtered.filter((order) => order.status === "paid")
      : filtered;

  if (isCustomerCount) return new Set(rows.map((order) => order.customer)).size;

  const dimension = groupDimension(question);
  const ranked = /\b(top|highest|largest|most|best|least|lowest|smallest)\b/i.test(question);
  if (dimension && /\b(each|every|by|per)\b/i.test(question) && !ranked) {
    const groups = new Map();
    for (const order of rows) {
      const key = order[dimension];
      groups.set(key, (groups.get(key) || 0) + orderValue(order, metric, rates, targetCurrency(question)));
    }
    return Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, metric === "orders" || metric === "units" ? value : roundMoney(value)]));
  }

  if (dimension && ranked) {
    const groups = new Map();
    const rankingMetric = /\b(units?|items?|quantity|sold|selling|popular)\b/i.test(question) && !metricName
      ? "units"
      : /\borders?\b/i.test(question) && !metricName
        ? "orders"
        : metric;
    for (const order of rows) {
      const key = order[dimension];
      groups.set(key, (groups.get(key) || 0) + orderValue(order, rankingMetric, rates, targetCurrency(question)));
    }
    const sorted = [...groups.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return sorted[0]?.[0] ?? null;
  }

  if (/\baverage|avg|mean\b/i.test(question)) {
    if (!rows.length) return 0;
    const total = rows.reduce((sum, order) => sum + orderValue(order, metric, rates, targetCurrency(question)), 0);
    return roundMoney(total / rows.length);
  }

  if (metric === "orders") return rows.length;
  const sum = rows.reduce((total, order) => total + orderValue(order, metric, rates, targetCurrency(question)), 0);
  return metric === "units" ? sum : roundMoney(sum);
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Ledger request failed with HTTP ${response.status}.`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Ledger export failed with HTTP ${response.status}.`);
  return response.text();
}

async function loadLedger() {
  const sourceUrl = process.env.QUESTION_DATA_URL;
  if (!sourceUrl) throw new Error("Set QUESTION_DATA_URL to the supplied questionData URL.");
  const root = await fetchJson(sourceUrl);
  if (!root.links?.export || !root.links?.rates) {
    throw new Error("The questionData root response is missing export or rates links.");
  }
  const [exportText, rateData] = await Promise.all([
    fetchText(root.links.export),
    fetchJson(root.links.rates),
  ]);
  const rows = exportText.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const rates = rateData.usd_per_unit;
  if (!rows.length || !rates || !CURRENCIES.every((currency) => Number.isFinite(Number(rates[currency])))) {
    throw new Error("The ledger export or exchange-rate table is incomplete.");
  }
  const orders = latestOrders(rows);
  console.log(`Loaded ${orders.length} current orders from ${rows.length} ledger rows.`);
  return { orders, rates };
}

async function readRequestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw Object.assign(new Error("Request body is too large."), { statusCode: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), { statusCode: 400 });
  }
}

function createServer(ledger) {
  return http.createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (request.method !== "POST" || !["/", "/api", "/answer"].includes(request.url)) {
      response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "POST JSON to / with a question field." }));
      return;
    }
    try {
      const body = await readRequestBody(request);
      if (!body || typeof body.question !== "string" || !body.question.trim()) {
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "question must be a non-empty string." }));
        return;
      }
      const answer = answerQuestion(body.question, ledger.orders, ledger.rates);
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ answer }));
    } catch (error) {
      response.writeHead(error.statusCode || 500, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: error.message || "Unable to answer the question." }));
    }
  });
}

if (require.main === module) {
  loadLedger()
    .then((ledger) => {
      const server = createServer(ledger);
      server.listen(PORT, "0.0.0.0", () => {
        console.log(`Acme ledger question API listening on port ${PORT}.`);
      });
      server.on("error", (error) => {
        console.error("HTTP server error:", error);
        process.exitCode = 1;
      });
    })
    .catch((error) => {
      console.error("Unable to initialize the ledger service:", error.message);
      process.exitCode = 1;
    });
}

module.exports = { answerQuestion, businessDate, latestOrders };
