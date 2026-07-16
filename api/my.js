// Τροφοδοτεί την προσωπική σελίδα κάθε υπαλλήλου (me.html).
//  GET ?w=<walletId>&t=<token>  → επιστρέφει το όνομα + τις χρεώσεις ΜΟΝΟ αυτού του ατόμου (τρέχων μήνας)
//  GET ?links=1                 → (για CFO) όλα τα προσωπικά links για διανομή
const { wallets, sbSelect, personToken, verifyToken } = require("./_viva.js");

// Έναρξη καταγραφής — δείχνουμε ΜΟΝΟ χρεώσεις από αυτή τη μέρα κι έπειτα.
// (Οι παλιές του Ιουλίου δεν θα τακτοποιηθούν — καθαρή εικόνα από σήμερα.)
const START_DATE = "2026-07-16";

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

// Καθαρίζει τα ονόματα καταστημάτων ώστε να είναι αναγνωρίσιμα (π.χ. "AB_MIMIKOPOULEIO_215" → "ΑΒ Βασιλόπουλος",
// "UBR* PENDING.UBER.COM" → "Uber"). Εφαρμόζεται ΜΟΝΟ στην εμφάνιση — ο εσωτερικός έλεγχος γίνεται στο πρωτότυπο.
const BRANDS = [
  [/FREE.?NOW|HOLD\.FREE-NOW/, "FREE NOW"],
  [/UBER|\bUBR\b/, "Uber"],
  [/EFOOD/, "efood"],
  [/WOLT/, "Wolt"],
  [/ABVASSILOPOULOS|^AB[\s_]|ΒΑΣΙΛΟΠΟΥΛ/, "ΑΒ Βασιλόπουλος"],
  [/SHELL/, "Shell"],
  [/\bEKO\b/, "ΕΚΟ"],
  [/\bBP\b/, "BP"],
  [/KAYSIMA ATTIKHS/, "Καύσιμα Αττικής"],
  [/\bOASA\b/, "ΟΑΣΑ"],
  [/SKROUTZ/, "Skroutz"],
  [/ANTHROPIC/, "Anthropic (Claude)"],
  [/OPENAI|CHATGPT/, "OpenAI (ChatGPT)"],
  [/^ZARA/, "ZARA"],
  [/JUMBO/, "Jumbo"],
  [/^H\s?M\s|H&M|^HM\b/, "H&M"],
  [/FLOCAFE/, "Flocafé"],
  [/\bERGON\b/, "Ergon"],
  [/ATTIKI ODOS/, "Αττική Οδός"],
  [/OLYMPIA (ODOS|DIODIA|PACHI)/, "Ολυμπία Οδός"],
  [/ELLESTIA MALL/, "Ellestia Mall"],
  [/JOWAE/, "Jowaé"],
];
function cleanMerchant(raw) {
  let s = String(raw || "").trim();
  if (!s) return "—";
  s = s.replace(/^Δέσμευση Αγοράς με Viva Wallet Card\s*-?\s*/i, "")
       .replace(/^Αγορά με Viva Wallet Card\s*-?\s*/i, "");
  const U = s.toUpperCase();
  for (const [re, name] of BRANDS) { if (re.test(U)) return name; }
  s = s.replace(/^[A-Z0-9]{2,10}\s*\*\s*/i, "");          // κόβει "SQ* ", "IZ* " κ.λπ.
  s = s.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/\s+(E\.?E\.?|A\.?E\.?|I\.?K\.?E\.?|S\.?A\.?|MONOPR\.?|LTD)\.?$/i, "").trim();
  if (s.length < 2) return "Αγορά με κάρτα";
  s = s.replace(/\b[A-Z][A-Z0-9&.\-]{2,}\b/g, (w) => w.charAt(0) + w.slice(1).toLowerCase());
  return s;
}

// Καθαρισμός διπλοεγγραφών: η ίδια συναλλαγή μπορεί να έχει δέσμευση (webhook + sync) + εκκαθάριση.
//  1) Ένωσε δεσμεύσεις της ΙΔΙΑΣ συναλλαγής (κανονικό id vs "AUTH-"+id) → μία εγγραφή.
//  2) Αν μια αγορά εκκαθαρίστηκε, κράτα την οριστική και ρίξε την αντίστοιχη δέσμευση (ίδιο ποσό).
function dedupCharges(rows) {
  const norm = (id) => String(id || "").replace(/^AUTH-/, "");
  const isDesm = (m) => /^Δέσμευση/.test(m || "");
  // 1) Ένωσε γραμμές της ΙΔΙΑΣ συναλλαγής (δέσμευση από webhook + από sync). Κράτα πραγματικό μαγαζί & ΝΩΡΙΤΕΡΗ ώρα (=στιγμή αγοράς).
  const byId = new Map();
  for (const c of rows) {
    const k = norm(c.viva_tx_id);
    const ex = byId.get(k);
    if (!ex) { byId.set(k, { ...c }); continue; }
    const m = { ...ex };
    if (isDesm(m.merchant) && !isDesm(c.merchant)) m.merchant = c.merchant;         // πραγματικό όνομα μαγαζιού
    if (String(c.occurred_at || "") < String(m.occurred_at || "")) m.occurred_at = c.occurred_at; // νωρίτερη = χτύπημα
    if (c.has_receipt) { m.has_receipt = true; m.receipt_url = c.receipt_url || m.receipt_url; }
    if (c.project) m.project = c.project;
    if (ex.status !== "PENDING_CLEAR" || c.status !== "PENDING_CLEAR")
      m.status = ex.status === "PENDING_CLEAR" ? c.status : ex.status;
    byId.set(k, m);
  }
  const list = [...byId.values()];
  // 2) Ταίριασε ΔΕΣΜΕΥΣΗ (χτύπημα) με ΕΚΚΑΘΑΡΙΣΗ (ίδιο ποσό). Κράτα τη ΔΕΣΜΕΥΣΗ (σωστή ώρα+μαγαζί), σημείωσέ την εκκαθαρισμένη, ρίξε την εκκαθάριση.
  const auths = list.filter((c) => c.status === "PENDING_CLEAR");
  const settls = list.filter((c) => c.status !== "PENDING_CLEAR");
  const pool = {};
  for (const a of auths) { const k = Math.abs(+a.amount).toFixed(2); (pool[k] = pool[k] || []).push(a); }
  const keptSettls = [];
  for (const s of settls) {
    const k = Math.abs(+s.amount).toFixed(2);
    if (pool[k] && pool[k].length) {
      const a = pool[k].shift();
      a._cleared = true;                                     // η αγορά εκκαθαρίστηκε — αλλά κρατάμε την ώρα του χτυπήματος
      if (s.has_receipt) { a.has_receipt = true; a.receipt_url = s.receipt_url || a.receipt_url; }
      if (s.project) a.project = s.project;
    } else {
      keptSettls.push(s);                                    // χωρίς δέσμευση → κράτα την εκκαθάριση
    }
  }
  const out = [];
  for (const a of auths) {
    if (a._cleared) a.status = (a.has_receipt && a.project) ? "COMPLETE" : "MISSING_ALL"; // εκκαθαρισμένη, όχι ⏳
    out.push(a);
  }
  for (const s of keptSettls) out.push(s);
  return out;
}

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
    const rowsRaw = await sbSelect("charges", `wallet_id=eq.${w}&order=occurred_at.desc&limit=1000`);
    const rows = dedupCharges(rowsRaw || [])
      .filter((c) => String(c.occurred_at || "") >= START_DATE); // μόνο από σήμερα κι έπειτα
    // Επιστρέφουμε ΟΛΟΥΣ τους μήνες — η σελίδα κάνει πλοήγηση μπρος-πίσω και φιλτράρει.
    const charges = (rows || []).map((c) => ({
      id: c.id,
      amount: Math.abs(+c.amount),
      merchant: cleanMerchant(c.merchant),
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
