// Κοινός Viva client για τα serverless functions.
// Env vars (ορίζονται στο Vercel): VIVA_CLIENT_ID, VIVA_CLIENT_SECRET,
// VIVA_MERCHANT_ID, VIVA_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
let cache = { token: null, exp: 0 };

async function vivaToken() {
  if (cache.token && Date.now() < cache.exp - 60_000) return cache.token;
  const basic = Buffer.from(
    `${process.env.VIVA_CLIENT_ID}:${process.env.VIVA_CLIENT_SECRET}`
  ).toString("base64");
  const r = await fetch("https://accounts.vivapayments.com/connect/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`viva token: ${r.status}`);
  const j = await r.json();
  cache = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cache.token;
}

async function wallets() {
  const t = await vivaToken();
  const r = await fetch("https://api.vivapayments.com/merchants/v1/wallets", {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!r.ok) throw new Error(`viva wallets: ${r.status}`);
  return r.json();
}

// Κλειδί επαλήθευσης webhook (η Viva κάνει GET στο URL και περιμένει {Key})
async function webhookKey() {
  const basic = Buffer.from(
    `${process.env.VIVA_MERCHANT_ID}:${process.env.VIVA_API_KEY}`
  ).toString("base64");
  const r = await fetch("https://www.vivapayments.com/api/messages/config/token", {
    headers: { Authorization: `Basic ${basic}` },
  });
  if (!r.ok) throw new Error(`viva webhook key: ${r.status}`);
  return r.json(); // {Key: "..."}
}

// --- Supabase (προαιρετικό μέχρι να στηθεί) ---
function sb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

async function sbInsert(table, row) {
  const c = sb();
  if (!c) return { skipped: true };
  const r = await fetch(`${c.url}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: c.key,
      Authorization: `Bearer ${c.key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates",
    },
    body: JSON.stringify(row),
  });
  return { ok: r.ok, status: r.status };
}

async function sbSelect(table, query = "") {
  const c = sb();
  if (!c) return [];
  const r = await fetch(`${c.url}/rest/v1/${table}?${query}`, {
    headers: { apikey: c.key, Authorization: `Bearer ${c.key}` },
  });
  if (!r.ok) return [];
  return r.json();
}

// Ενημέρωση γραμμής (π.χ. ορισμός project από τον CFO). filter π.χ. "id=eq.42"
async function sbUpdate(table, filter, patch) {
  const c = sb();
  if (!c) return { skipped: true };
  const r = await fetch(`${c.url}/rest/v1/${table}?${filter}`, {
    method: "PATCH",
    headers: {
      apikey: c.key,
      Authorization: `Bearer ${c.key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(patch),
  });
  const body = r.ok ? await r.json() : null;
  return { ok: r.ok, status: r.status, row: body && body[0] };
}

module.exports = { vivaToken, wallets, webhookKey, sbInsert, sbSelect, sbUpdate };
