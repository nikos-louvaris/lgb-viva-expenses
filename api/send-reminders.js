// Μηχανή αποστολής email υπενθυμίσεων.
//   ?action=seed-emails  (POST {map:{walletId:{name,firstName,card,emails:[]}}})  → αποθηκεύει τα email στη βάση (ιδιωτικά)
//   ?action=test&to=EMAIL                                                          → στέλνει ΕΝΑ δείγμα (πάντα, για δοκιμή Resend)
//   ?action=run&type=INSTANT|EOD|WEEKLY|MONTH_END                                  → κανονικό τρέξιμο
//        ΑΣΦΑΛΕΙΑ: αν EMAILS_LIVE !== "true" → ΤΙΠΟΤΑ δεν φεύγει σε υπάλληλο· ανακατευθύνεται στον CFO (REVIEW_EMAIL) με [TEST → …].
//        Μόνο όταν οριστεί ρητά EMAILS_LIVE=true αρχίζουν να φεύγουν στους πραγματικούς παραλήπτες.
const { sbSelect, sbInsert, sbUpdate, personToken, verifyToken } = require("./_viva.js");

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

// Καλωσόρισμα / ενημέρωση (onboarding) — μίνι brief + προσωπικό link
function welcomeEmail(firstName, walletId, card) {
  const link = `${BASE}/me.html?w=${walletId}&t=${personToken(walletId)}`;
  const subject = `👋 Καλωσήρθες στο Σύστημα Εξόδων — το προσωπικό σου link`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:580px;margin:auto;color:#1a1a2e">
    <h2 style="font-size:19px;margin:0 0 6px">Καλησπέρα ${firstName}! 🍌</h2>
    <p style="font-size:14px;line-height:1.5">Από εδώ και πέρα, τα έξοδα με την <b>εταιρική σου κάρτα Viva</b> (•••• ${card}) τα διαχειριζόμαστε όλα από μία πλατφόρμα. Αυτό είναι το <b>δικό σου προσωπικό link</b> — ανοίγει κατευθείαν στο όνομά σου.</p>
    <div style="background:#f6f7fb;border:1px solid #e6e8f0;border-radius:12px;padding:14px 16px;margin:14px 0">
      <b style="font-size:14px">Τι κάνεις κάθε φορά που χρεώνεσαι με την κάρτα:</b>
      <ol style="margin:8px 0 0;padding-left:18px;font-size:13.5px;line-height:1.6">
        <li>Μπες στο προσωπικό σου link (πιο κάτω).</li>
        <li>Βρες τη χρέωση — φαίνεται αυτόματα.</li>
        <li>Ανέβασε <b>φωτογραφία της απόδειξης</b> 📷 και διάλεξε το <b>project</b>. Τέλος.</li>
      </ol>
    </div>
    <div style="background:#fffbea;border:1px solid #f6d55c;border-radius:10px;padding:11px 13px;margin:12px 0;font-size:13px;color:#5f4b00">
      📸 Η φωτογραφία να είναι <b>καθαρή &amp; ολόκληρη</b>, ίσια, να διαβάζεται <b>το ποσό</b>. Όχι θολή/κομμένη. Αν είναι ξεθωριασμένη, γράψε πάνω της με στυλό το ποσό.
    </div>
    <p style="text-align:center;margin:18px 0"><a href="${link}" style="background:#4f46e5;color:#fff;padding:14px 26px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:15px">Άνοιξε τη σελίδα σου ➜</a></p>
    <p style="font-size:12.5px;color:#555;line-height:1.5">📱 Ανοίγει από <b>κινητό &amp; υπολογιστή</b>. Στο κινητό, κράτησέ το στην αρχική οθόνη για να το έχεις πρόχειρο. Το link είναι προσωπικό — μη το μοιράζεσαι.</p>
    <p style="font-size:12.5px;color:#555;line-height:1.5">Ό,τι μείνει χωρίς απόδειξη στο τέλος του μήνα, συμψηφίζεται με την αμοιβή σου από τα βίντεο (επιστρέφεται αν την ανεβάσεις αργότερα). <b>Ξεκινάμε από 1η Αυγούστου.</b></p>
    <p style="font-size:11px;color:#999">Σύστημα Εξόδων — Let's Go Bananas. Για απορίες, απάντησε σε αυτό το email.</p></div>`;
  const text = `Καλησπέρα ${firstName}! Από εδώ και πέρα τα έξοδα της εταιρικής σου κάρτας (••••${card}) τα διαχειριζόμαστε από μία πλατφόρμα.\n\nΤο προσωπικό σου link: ${link}\n\nΚάθε φορά που χρεώνεσαι: μπες, βρες τη χρέωση, ανέβασε φωτ. απόδειξης + διάλεξε project. Καθαρή & ολόκληρη φωτο, να φαίνεται το ποσό. Ανοίγει από κινητό & υπολογιστή. Ξεκινάμε 1η Αυγούστου.`;
  return { subject, html, text };
}

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body || "{}"); } catch (e) { body = {}; } }
    body = body || {};
    const action = String(q.action || (body && body.action) || "").toLowerCase();
    const LIVE = process.env.EMAILS_LIVE === "true";

    // ── ΑΣΦΑΛΕΙΑ ──
    // Χωρίς αυτό, οποιοσδήποτε γνώριζε το URL μπορούσε να στείλει email σε 13 υπαλλήλους.
    // Επιτρέπεται μόνο: Vercel cron, ή έγκυρο προσωπικό token, ή EMAILS_SECRET.
    const isCron = !!req.headers["x-vercel-cron"] || /vercel-cron/i.test(String(req.headers["user-agent"] || ""));
    const aw = String(body.w || q.w || ""), at = String(body.t || q.t || "");
    const hasSecret = process.env.EMAILS_SECRET && String(q.secret || body.secret || "") === String(process.env.EMAILS_SECRET);
    if (!isCron && !hasSecret && !(aw && verifyToken(aw, at))) {
      return res.status(403).json({ error: "Μη εξουσιοδοτημένο" });
    }

    // ── ΔΙΑΓΝΩΣΤΙΚΟ (δεν στέλνει τίποτα) ──
    // Λέει αν είναι όλα έτοιμα για να ξεκινήσουν τα email.
    if (action === "status") {
      const emails = await readEmails();
      const people = Object.keys(emails);
      const withAddr = people.filter((w) => (emails[w].emails || []).length);
      const mask = (e) => String(e).replace(/^(.).*(@.*)$/, "$1•••$2");
      return res.status(200).json({
        ok: true,
        έτοιμο_για_αποστολή: !!(process.env.RESEND_API_KEY && withAddr.length),
        RESEND_API_KEY: !!process.env.RESEND_API_KEY,
        MAIL_FROM: FROM,
        EMAILS_LIVE: LIVE,
        άτομα_στη_βάση: people.length,
        άτομα_με_email: withAddr.length,
        λίστα: people.map((w) => ({
          wallet: w,
          όνομα: emails[w].name || emails[w].firstName || "",
          κάρτα: emails[w].card || "",
          emails: (emails[w].emails || []).map(mask),
        })),
      });
    }

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

    // Δείγμα welcome σε ΕΝΑ email (για προεπισκόπηση)
    if (action === "welcome") {
      const to = q.to || REVIEW;
      const w = String(q.w || "566240519800");
      const emails = await readEmails();
      const info = emails[w] || { firstName: "Κώστα", name: "Κώστας Κρυωνάς", card: "1288" };
      const e = welcomeEmail(info.firstName || info.name, w, info.card || "");
      const r = await resend(to, "[ΔΕΙΓΜΑ] " + e.subject, e.html, e.text, q.from);
      return res.status(200).json({ ok: r.ok, to, resend: r });
    }

    // Αποστολή welcome σε ΟΛΟΥΣ (13 εταιρικά email) — ΤΟ ΤΡΕΧΟΥΜΕ ΣΤΟ MEETING
    if (action === "welcome-all") {
      const emails = await readEmails();
      const results = [];
      for (const w of Object.keys(emails)) {
        const info = emails[w];
        const e = welcomeEmail(info.firstName || info.name, w, info.card || "");
        for (const to of (info.emails || [])) {
          // Ίδια δικλείδα με τις υπενθυμίσεις: χωρίς EMAILS_LIVE=true πάει στον CFO για έλεγχο.
          let subject = e.subject, actualTo = to;
          if (!LIVE) { subject = "[TEST → " + to + "] " + e.subject; actualTo = REVIEW; }
          const r = await resend(actualTo, subject, e.html, e.text);
          results.push({ person: info.name, to: actualTo, live: LIVE, ok: r.ok, err: r.error });
        }
      }
      return res.status(200).json({ ok: true, live: LIVE, people: Object.keys(emails).length, sent: results.length, results });
    }

    if (action === "run") {
      let type = String(q.type || "INSTANT").toUpperCase();
      // type=auto → αποφασίζει μόνο του βάσει ημερομηνίας (τοπική ώρα Ελλάδας)
      if (type === "AUTO") {
        const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Athens" }));
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        if (now.getDate() === lastDay) type = "MONTH_END";   // ΤΕΛΕΥΤΑΙΑ μέρα του μήνα (όποια μέρα κι αν είναι, ακόμα & Κυριακή)
        else if (now.getDay() === 5) type = "WEEKLY";         // Παρασκευή
        else type = "EOD";                                    // καθημερινό συγκεντρωτικό
      }
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
