// Έξτρα (custom) projects — νέοι πελάτες που ανοίγουν. Αποθηκεύονται σε config γραμμή του
// πίνακα charges (viva_tx_id = "__config_projects__") ώστε να μη χρειάζεται νέος πίνακας.
// Εμφανίζονται ΑΜΕΣΩΣ στα dropdowns (κεντρικό dashboard + προσωπικές σελίδες), χωρίς redeploy.
//   GET                      → { projects: [...] }
//   POST { action, name }    → action: "add" | "remove"
const { sbSelect, sbInsert, sbUpdate } = require("./_viva.js");
const KEY = "__config_projects__";

async function readList() {
  const rows = await sbSelect("charges", `viva_tx_id=eq.${KEY}&select=raw`);
  if (rows.length && rows[0].raw && Array.isArray(rows[0].raw.projects)) return rows[0].raw.projects;
  return [];
}
async function writeList(projects) {
  const raw = { projects };
  const upd = await sbUpdate("charges", `viva_tx_id=eq.${KEY}`, { raw, status: "CONFIG" });
  if (upd.ok && upd.row) return;
  await sbInsert("charges", { viva_tx_id: KEY, wallet_id: 0, amount: 0, merchant: "(config-projects)", occurred_at: new Date().toISOString(), status: "CONFIG", raw });
  await sbUpdate("charges", `viva_tx_id=eq.${KEY}`, { raw, status: "CONFIG" });
}
const clean = (s) => String(s || "").trim().replace(/\s+/g, " ").toUpperCase();

module.exports = async (req, res) => {
  try {
    if (req.method === "GET") return res.status(200).json({ projects: await readList() });
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") body = JSON.parse(body || "{}");
      const name = clean(body.name);
      if (!name) return res.status(400).json({ error: "λείπει το όνομα" });
      let list = await readList();
      if (body.action === "remove") list = list.filter((x) => clean(x) !== name);
      else if (!list.some((x) => clean(x) === name)) list.push(name);
      await writeList(list);
      return res.status(200).json({ ok: true, projects: list });
    }
    return res.status(405).json({ error: "GET/POST only" });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};
