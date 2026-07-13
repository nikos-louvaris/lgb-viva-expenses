// Τροφοδοτεί την προσωπική σελίδα κάθε υπαλλήλου (me.html).
//  GET ?w=<walletId>&t=<token>  → επιστρέφει το όνομα + τις χρεώσεις ΜΟΝΟ αυτού του ατόμου (τρέχων μήνας)
//  GET ?links=1                 → (για CFO) όλα τα προσωπικά links για διανομή
const { wallets, sbSelect, personToken, verifyToken } = require("./_viva.js");

// Σωστά ελληνικά ονόματα ανά κάρτα (ώστε ο καθένας να αναγνωρίζει το όνομά του)
const NAMES = {
  "448933314799": "Άγγελος Χρονόπουλος",
  "324887741089": "Ανδρέας Κολυγλιάτης",
  "566240519800": "Κώστας Κρυωνάς",
  "282541651501": "Ιωάννα Σκούρα",
  "657494082292": "Λουκία Μπαλτζή",
  "910827445981": "Άντα Μπαϊρακτάρη",
  "975269802823": "Αίας Παρασκευόπουλος",
  "405838582045": "Ζωή Ηγουμενίδη",
  "389933252655": "Μαριλού Θηβαίου",
  "968554634120": "Μαριλένα Σιταροπούλου",
  "577335556525": "Αναστασία Κοβάνη",
  "990263759336": "Δήμητρα Λάκη",
  "243763678466": "Ντόριαν Γκουτζέλας",
};
const niceName = (walletId, friendly) => {
  if (NAMES[String(walletId)]) return NAMES[String(walletId)];
  const m = String(friendly || "").match(/^(.*?)\s*\d{4}$/);
  return (m ? m[1] : friendly || "").trim();
};

function baseUrl(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}`;
}

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    const ws = await wallets();
    const EXCLUDED = new Set(["901067108914"]); // Λυμπέρης Μελκί — εξαιρέθηκε
    const members = (Array.isArray(ws) ? ws : []).filter(
      (w) => w.hasIssuedCard && !w.isPrimary && w.friendlyName && w.friendlyName !== "ακυρο" && !EXCLUDED.has(String(w.walletId))
    );

    // Λίστα προσωπικών links για τον CFO
    if (q.links) {
      const base = baseUrl(req);
      const list = members.map((w) => {
        const m = w.friendlyName.match(/^(.*?)\s*(\d{4})$/);
        return {
          name: niceName(w.walletId, w.friendlyName),
          card: m ? m[2] : "----",
          link: `${base}/me.html?w=${w.walletId}&t=${personToken(w.walletId)}`,
        };
      });
      return res.status(200).json({ people: list });
    }

    // Προσωπική πρόσβαση
    const w = String(q.w || "");
    if (!w || !verifyToken(w, String(q.t || "")))
      return res.status(403).json({ error: "Άκυρο ή λανθασμένο link" });

    const wallet = members.find((x) => String(x.walletId) === w);
    if (!wallet) return res.status(404).json({ error: "Δεν βρέθηκε η κάρτα" });
    const m = wallet.friendlyName.match(/^(.*?)\s*(\d{4})$/);
    const name = niceName(w, wallet.friendlyName);
    const card = m ? m[2] : "----";

    const ym = new Date().toISOString().slice(0, 7); // τρέχων μήνας (προεπιλογή)
    const rows = await sbSelect("charges", `wallet_id=eq.${w}&order=occurred_at.desc&limit=1000`);
    // Επιστρέφουμε ΟΛΟΥΣ τους μήνες — η σελίδα κάνει πλοήγηση μπρος-πίσω και φιλτράρει.
    const charges = (rows || []).map((c) => ({
      id: c.id,
      amount: Math.abs(+c.amount),
      merchant: c.merchant || "—",
      occurred_at: c.occurred_at,
      has_receipt: !!c.has_receipt,
      receipt_url: c.receipt_url || null,
      project: c.project || null,
      pending: c.status === "PENDING_CLEAR",
    }));

    return res.status(200).json({ name, card, month: ym, charges });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};
