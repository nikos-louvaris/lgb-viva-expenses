// Μηχανή αποστολής email υπενθυμίσεων.
//   ?action=seed-emails  (POST {map:{walletId:{name,firstName,card,emails:[]}}})  → αποθηκεύει τα email στη βάση (ιδιωτικά)
//   ?action=test&to=EMAIL                                                          → στέλνει ΕΝΑ δείγμα (πάντα, για δοκιμή Resend)
//   ?action=run&type=INSTANT|EOD|WEEKLY|MONTH_END                                  → κανονικό τρέξιμο
//        ΑΣΦΑΛΕΙΑ: αν EMAILS_LIVE !== "true" → ΤΙΠΟΤΑ δεν φεύγει σε υπάλληλο· ανακατευθύνεται στον CFO (REVIEW_EMAIL) με [TEST → …].
//        Μόνο όταν οριστεί ρητά EMAILS_LIVE=true αρχίζουν να φεύγουν στους πραγματικούς παραλήπτες.
const { sbSelect, sbInsert, sbUpdate, personToken } = require("./_viva.js");

const BASE = "https://lgb-viva-expenses.vercel.app";
const REVIEW = process.env.REVIEW_EMAIL || "cs@viralpassion.gr";
const FROM = process.env.MAIL_FROM || "Σύστημα Εξόδων <expenses@aiwonderlab.eu>";
const EKEY = "__config_emails__";
const fmt = (n) => Number(n).toLocaleString("el-GR", { minimumFractionDigits: 2 }) + "€";

async function readEmails() {
  const r = await sbSelect("charges", `viva_tx_id=eq.${EKEY}&select=raw`);
  return (r.length && r[0].raw && r[0].raw.map) ? r[0].raw.map : {};
}
async function writeEmails(map) {
  const raw = { map };
  const u = await sbUpdate("charges", `viva_tx_id=eq.${EKEY}`, { raw, status: "CONFIG" });
  if (u.ok && u.row) return;
  await sbInsert("charges", { viva_tx_id: EKEY, wallet_id: 0, amount: 0, merchant: "(config-emails)", occurred_at: new Date().toISOString(), status: "CONFIG", raw }, "viva_tx_id");
  await sbUpdate("charges", `viva_tx_id=eq.${EKEY}`, { raw, status: "CONFIG" });
}
async function resend(to, subject, html, text, fromOverride) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "λείπει RESEND_API_KEY" };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: fromOverride || FROM, to: [to], reply_to: REVIEW, subject, html, text }),
  });
  const b = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, id: b.id, error: b.message || (b.name ? b.name : undefined) };
}

function compose(firstName, walletId, card, miss, type) {
  const link = `${BASE}/me.html?w=${walletId}&t=${personToken(walletId)}`;
  const total = miss.reduce((s, c) => s + Math.abs(+c.amount), 0);
  const rows = miss.map((c) => {
    const d = new Date(c.occurred_at);
    const dd = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const w = !c.has_receipt && !c.project ? "λείπουν όλα" : !c.has_receipt ? "χωρίς απόδειξη" : "χωρίς project";
    return `<tr><td style="padding:6px 10px">${dd}</td><td style="padding:6px 10px"><b>${c.merchant || ""}</b></td><td style="padding:6px 10px;text-align:right">${fmt(Math.abs(+c.amount))}</td><td style="padding:6px 10px;color:#c0392b">${w}</td></tr>`;
  }).join("");
  const subject = type === "MONTH_END"
    ? `🔴 Ο μήνας κλείνει — εκκρεμότητες ${fmt(total)}`
    : `⏰ ${firstName}, λείπουν ${miss.length} αποδείξεις/project (${fmt(total)})`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1a1a2e">
    <h2 style="font-size:17px">${firstName}, έχεις ${miss.length} χρεώσεις που θέλουν τακτοποίηση:</h2>
    <table style="border-collapse:collapse;width:100%;background:#f8f9fb;border-radius:8px">${rows}</table>
    <div style="background:#fffbea;border:1px solid #f6d55c;border-radius:8px;padding:10px 12px;margin:12px 0;font:13px Arial;color:#5f4b00">📸 Η φωτογραφία να είναι καθαρή: ολόκληρη η απόδειξη, ίσια, να διαβάζεται το ποσό. Όχι θολή, όχι κομμένη. Αν είναι ξεθωριασμένη, γράψε πάνω της με στυλό το ποσό.</div>
    <p><a href="${link}" style="background:#4f46e5;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Άνοιξε τη σελίδα σου ➜</a></p>
    <p style="color:#555;font-size:13px">Μπες, ανέβασε φωτ. απόδειξης + διάλεξε project. Ό,τι μείνει χωρίς απόδειξη στο τέλος του μήνα, συμψηφίζεται με την αμοιβή σου από τα βίντεο (επιστρέφεται αν προσκομιστεί μετά).</p>
    <p style="font-size:11px;color:#999">Αυτόματο μήνυμα — Σύστημα Εξόδων, Let's Go Bananas.</p></div>`;
  const text = `${firstName}, λείπουν ${miss.length} πράγματα (σύνολο ${fmt(total)}).\nΆνοιξε τη σελίδα σου: ${link}\nΑνέβασε φωτ. απόδειξης + διάλεξε project.`;
  return { subject, html, text };
}

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body || "{}"); } catch (e) { body = {}; } }
    const action = String(q.action || (body && body.action) || "").toLowerCase();
    const LIVE = process.env.EMAILS_LIVE === "true";

    if (action === "seed-emails") {
      const map = (body && body.map) || {};
      await writeEmails(map);
      return res.status(200).json({ ok: true, seeded: Object.keys(map).length });
    }

    if (action === "test") {
      const to = q.to || (body && body.to) || REVIEW;
      const s = compose("Κώστα", "566240519800", "1288", [
        { occurred_at: new Date().toISOString(), merchant: "Wolt", amount: -18.4, has_receipt: false, project: null },
        { occurred_at: new Date().toISOString(), merchant: "efood", amount: -24.9, has_receipt: true, project: null },
      ], "INSTANT");
      const r = await resend(to, "[ΔΕΙΓΜΑ] " + s.subject, s.html, s.text, q.from);
      return res.status(200).json({ ok: r.ok, to, from: q.from || FROM, resend: r });
    }

    if (action === "run") {
      const type = String(q.type || "INSTANT").toUpperCase();
      const emails = await readEmails();
      const ym = new Date().toISOString().slice(0, 7);
      const rows = await sbSelect("charges", `select=*&order=occurred_at.desc&limit=1000`);
      const byW = {};
      (rows || []).forEach((c) => {
        if (String(c.occurred_at || "").slice(0, 7) !== ym) return;
        const w = String(c.wallet_id); if (!emails[w]) return;
        const done = (c.has_receipt && c.project) || c.status === "APPROVED_LOSS" || c.status === "INTERNAL";
        if (done) return;
        (byW[w] = byW[w] || []).push(c);
      });
      const results = [];
      for (const w of Object.keys(byW)) {
        const info = emails[w];
        const c = compose(info.firstName || info.name || "", w, info.card || "", byW[w], type);
        for (const to of (info.emails || [])) {
          let subject = c.subject, actualTo = to;
          if (!LIVE) { subject = "[TEST → " + to + "] " + subject; actualTo = REVIEW; }
          const r = await resend(actualTo, subject, c.html, c.text);
          results.push({ person: info.name, to: actualTo, live: LIVE, ok: r.ok, err: r.error });
        }
      }
      return res.status(200).json({ ok: true, live: LIVE, type, people: Object.keys(byW).length, sent: results.length, results });
    }

    return res.status(400).json({ error: "άγνωστο action (seed-emails | test | run)" });
  } catch (err) {
    return res.status(200).json({ ok: false, error: String(err.message || err) });
  }
};
