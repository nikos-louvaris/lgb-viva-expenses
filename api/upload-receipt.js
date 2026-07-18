// Ο υπάλληλος ανεβάζει φωτ. απόδειξης (+ προαιρετικά project) για μία χρέωσή του.
// POST { w, t, chargeId, imageBase64, project }
//   w,t     = προσωπικό token (επαληθεύεται)
//   image   = data URL ή σκέτο base64 (JPEG/PNG)
//   project = προαιρετικό
const { sbSelect, sbUpdate, sbUploadReceipt, verifyToken } = require("./_viva.js");

const INTERNAL = "LGB HOME";
function statusOf({ has_receipt, project }) {
  if (project === INTERNAL) return "INTERNAL";
  if (has_receipt && project) return "COMPLETE";
  if (!has_receipt && !project) return "MISSING_ALL";
  if (!has_receipt) return "NO_RECEIPT";
  return "NO_PROJECT";
}

// Καθαρίζει όνομα μαγαζιού για σύγκριση (λατινικά, χωρίς κωδικούς/prefix Viva).
function normMerchant(s) {
  return String(s || "")
    .replace(/^(Δέσμευση Αγοράς|Αγορά) με Viva Wallet Card\s*-?\s*/i, "")
    .toLowerCase().replace(/[^a-zα-ω0-9]+/gi, " ").trim();
}
// «Δεύτερο μάτι» στην απόδειξη: το AI διαβάζει ΠΟΣΟ + ΚΑΤΑΣΤΗΜΑ και τα συγκρίνει με τη χρέωση.
// Fail-open: αν λείπει κλειδί ή αποτύχει, verdict=null (δεν μπλοκάρει το ανέβασμα).
async function validateReceipt(dataUrl, chargeAmount, chargeMerchant) {
  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return null;
    if (!/^data:image\//i.test(String(dataUrl))) return { verdict: "SKIP", note: "PDF/αρχείο — χωρίς αυτόματο έλεγχο" };
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini", temperature: 0, max_tokens: 120,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Διάβασε αυτή την απόδειξη. Επίστρεψε ΜΟΝΟ JSON: {\"amount\": <τελικό σύνολο ως αριθμός ή null>, \"merchant\": \"<όνομα καταστήματος ή κενό>\"}. Χωρίς άλλο κείμενο." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        }],
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    let txt = ((j.choices?.[0]?.message?.content) || "").replace(/```json|```/g, "").trim();
    const mm = txt.match(/\{[\s\S]*\}/); if (mm) txt = mm[0];
    const got = JSON.parse(txt);
    const seenAmt = got.amount == null ? null : Number(String(got.amount).replace(",", "."));
    const seenMer = String(got.merchant || "");
    if (seenAmt == null) return { verdict: "UNREADABLE", seenAmount: null, seenMerchant: seenMer, at: new Date().toISOString() };
    const ca = Math.abs(+chargeAmount);
    const amtBad = Math.abs(seenAmt - ca) > Math.max(0.05, ca * 0.02);
    // μαγαζί: κοινή λέξη ≥3 χαρακτ. → ταιριάζει (χαλαρό)
    const a = new Set(normMerchant(chargeMerchant).split(" ").filter((x) => x.length >= 3));
    const b = normMerchant(seenMer).split(" ").filter((x) => x.length >= 3);
    const merShare = b.some((x) => a.has(x));
    const merBad = seenMer && a.size > 0 && !merShare;
    const verdict = amtBad && merBad ? "BOTH" : amtBad ? "AMOUNT" : merBad ? "MERCHANT" : "OK";
    return { verdict, seenAmount: seenAmt, seenMerchant: seenMer, chargeAmount: ca, at: new Date().toISOString() };
  } catch (e) { return null; }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body || "{}");
    const { w, t, chargeId, imageBase64, project } = body || {};
    if (!w || !verifyToken(String(w), String(t || "")))
      return res.status(403).json({ error: "Άκυρο link" });
    if (!chargeId) return res.status(400).json({ error: "λείπει το chargeId" });

    // Η χρέωση πρέπει να ανήκει σε ΑΥΤΗ την κάρτα
    const rows = await sbSelect("charges", `id=eq.${encodeURIComponent(chargeId)}&select=*`);
    if (!rows.length) return res.status(404).json({ error: "δεν βρέθηκε η χρέωση" });
    const cur = rows[0];
    if (String(cur.wallet_id) !== String(w))
      return res.status(403).json({ error: "η χρέωση δεν είναι δική σου" });

    const patch = {};
    let receiptUrl = cur.receipt_url || null;

    if (imageBase64) {
      // Δέχεται εικόνα (φωτο απόδειξης) Ή αρχείο (π.χ. PDF τιμολογίου από email)
      const m = String(imageBase64).match(/^data:([\w.+/-]+);base64,(.*)$/);
      const b64 = m ? m[2] : String(imageBase64);
      const ctype = m ? m[1] : "image/jpeg";
      const ext = (ctype.split("/")[1] || "bin").replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
      const bytes = Buffer.from(b64, "base64");
      if (bytes.length > 8 * 1024 * 1024)
        return res.status(413).json({ error: "Πολύ μεγάλο αρχείο (max 8MB)" });
      const up = await sbUploadReceipt(`${w}/${chargeId}.${ext}`, bytes, ctype);
      if (!up.ok) return res.status(500).json({ error: "αποτυχία ανεβάσματος", detail: up.err });
      receiptUrl = up.url;
      patch.has_receipt = true;
      patch.receipt_url = receiptUrl;
      // «Δεύτερο μάτι»: έλεγχος ότι η απόδειξη ταιριάζει με τη χρέωση (ποσό + κατάστημα)
      const chk = await validateReceipt(imageBase64, cur.amount, cur.merchant);
      patch.raw = Object.assign({}, cur.raw || {}, { receipt_check: chk });
    }
    if (project !== undefined) patch.project = project || null;

    const merged = {
      has_receipt: patch.has_receipt ?? cur.has_receipt,
      project: patch.project !== undefined ? patch.project : cur.project,
    };
    patch.status = statusOf(merged);

    const upd = await sbUpdate("charges", `id=eq.${encodeURIComponent(chargeId)}`, patch);
    if (!upd.ok) return res.status(500).json({ error: "αποτυχία αποθήκευσης" });
    return res.status(200).json({ ok: true, receipt_url: receiptUrl, status: patch.status, receipt_check: patch.raw ? patch.raw.receipt_check : null });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};
