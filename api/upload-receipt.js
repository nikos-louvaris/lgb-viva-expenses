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
      const m = String(imageBase64).match(/^data:(image\/\w+);base64,(.*)$/);
      const b64 = m ? m[2] : String(imageBase64);
      const ctype = m ? m[1] : "image/jpeg";
      const ext = ctype.split("/")[1] || "jpg";
      const bytes = Buffer.from(b64, "base64");
      if (bytes.length > 8 * 1024 * 1024)
        return res.status(413).json({ error: "Πολύ μεγάλη εικόνα (max 8MB)" });
      const up = await sbUploadReceipt(`${w}/${chargeId}.${ext}`, bytes, ctype);
      if (!up.ok) return res.status(500).json({ error: "αποτυχία ανεβάσματος", detail: up.err });
      receiptUrl = up.url;
      patch.has_receipt = true;
      patch.receipt_url = receiptUrl;
    }
    if (project !== undefined) patch.project = project || null;

    const merged = {
      has_receipt: patch.has_receipt ?? cur.has_receipt,
      project: patch.project !== undefined ? patch.project : cur.project,
    };
    patch.status = statusOf(merged);

    const upd = await sbUpdate("charges", `id=eq.${encodeURIComponent(chargeId)}`, patch);
    if (!upd.ok) return res.status(500).json({ error: "αποτυχία αποθήκευσης" });
    return res.status(200).json({ ok: true, receipt_url: receiptUrl, status: patch.status });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};
