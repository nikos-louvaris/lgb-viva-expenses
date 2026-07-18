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
      ? cats.body.results.map((c) => ({ id: c.id, name: c.name || c.title || c.label || c.description }))
      : cats;
    out._catSample = (cats.body && cats.body.results && cats.body.results[0]) || null;
    const projs = await eg("projects/?page_size=100");
    out.projects = (projs.body && projs.body.results)
      ? projs.body.results.map((p) => ({ id: p.id, title: p.title || p.name }))
      : projs;
    const tr = await eg("trackingcategories/?page_size=100");
    out.trackingcategories = (tr.body && tr.body.results)
      ? tr.body.results.map((t) => ({ id: t.id, name: t.name || t.title, options: (t.options || []).map((o) => ({ id: o.id, name: o.name || o.title || o.value })) }))
      : tr;
    out._trSample = (tr.body && tr.body.results && tr.body.results[0]) || null;
    // Δείγμα υπάρχοντος εξόδου (τα 2 χειροκίνητα) → μαθαίνουμε ΑΚΡΙΒΩΣ το schema για το POST.
    const exps = await eg("expenses/?page_size=3&ordering=-date");
    out._expenseCount = (exps.body && exps.body.count) || 0;
    const first = (exps.body && exps.body.results && exps.body.results[0]) || null;
    out._expenseSample = first || exps;
    // ΠΛΗΡΕΣ detail του εξόδου (γραμμές/κατηγορία/tracking/attachments) — αυτό είναι το POST schema.
    if (first && first.id) {
      const det = await eg(`expenses/${first.id}/`);
      out._expenseDetail = det.body || det;
    }
    // Tracking category detail με IDs των options (χρειάζονται για POST).
    const trd = await eg("trackingcategories/2816025548696847940/");
    out._trackingDetail = trd.body || trd;
    // Βρες ΠΡΑΓΜΑΤΙΚΟ έξοδο που ΕΧΕΙ tracking → μαθαίνουμε ακριβώς το format του trackingcategories στο POST.
    const list = await eg("expenses/?page_size=40&ordering=-date");
    const results = (list.body && list.body.results) || [];
    out._withTracking = null;
    out._withItemTracking = null;
    for (const e of results) {
      const det = await eg(`expenses/${e.id}/`);
      const b = det.body || {};
      if (b.trackingcategories && b.trackingcategories.length && !out._withTracking) out._withTracking = { id: b.id, date: b.date, trackingcategories: b.trackingcategories };
      const it = (b.items || []).find((x) => x.trackingcategories && x.trackingcategories.length);
      if (it && !out._withItemTracking) out._withItemTracking = { id: b.id, item: it };
      if (out._withTracking && out._withItemTracking) break;
    }
    // ΑΝΑΚΑΛΥΨΗ ATTACHMENTS: το χειροκίνητο έξοδο Wispr (3585215857300603942) έχει συνημμένη απόδειξη.
    const man = await eg("expenses/3585215857300603942/");
    out._manualExpense = man.body || man;
    out._attachmentsList = (await eg("attachments/?page_size=5")).body;
    out._attByExpense = (await eg("attachments/?expense=3585215857300603942")).body;
    return res.status(200).json(out);
  } catch (err) {
    return res.status(200).json({ error: String(err.message || err) });
  }
};
