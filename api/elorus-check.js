// Διαγνωστικό (read-only) Elorus: επιβεβαιώνει οργανισμό + φέρνει κατηγορίες εξόδων, projects, tracking.
// Χρησιμοποιεί ELORUS_API_KEY από το Vercel env (δεν το βλέπει κανείς). Org id: ELORUS_ORG_ID ή default.
const BASE = "https://api.elorus.com/v1.1";
const ORG = process.env.ELORUS_ORG_ID || "2802338946946696842";

async function eg(path) {
  const key = process.env.ELORUS_API_KEY;
  if (!key) return { error: "Λείπει ELORUS_API_KEY στο Vercel" };
  const r = await fetch(`${BASE}/${path}`, {
    headers: { Authorization: `Token ${key}`, "X-Elorus-Organization": ORG, "Content-Type": "application/json" },
  });
  const txt = await r.text();
  let body; try { body = JSON.parse(txt); } catch (e) { body = txt.slice(0, 300); }
  return { status: r.status, body };
}

module.exports = async (req, res) => {
  try {
    const k = process.env.ELORUS_API_KEY || "";
    const out = { org: ORG, keyPresent: !!k, keyLen: k.length };
    const cats = await eg("expensecategories/?page_size=100");
    out.expensecategories = (cats.body && cats.body.results)
      ? cats.body.results.map((c) => ({ id: c.id, name: c.name }))
      : cats;
    const projs = await eg("projects/?page_size=100");
    out.projects = (projs.body && projs.body.results)
      ? projs.body.results.map((p) => ({ id: p.id, title: p.title || p.name }))
      : projs;
    const tr = await eg("trackingcategories/?page_size=100");
    out.trackingcategories = (tr.body && tr.body.results)
      ? tr.body.results.map((t) => ({ id: t.id, name: t.name, options: (t.options || []).map((o) => ({ id: o.id, name: o.name })) }))
      : tr;
    return res.status(200).json(out);
  } catch (err) {
    return res.status(200).json({ error: String(err.message || err) });
  }
};
