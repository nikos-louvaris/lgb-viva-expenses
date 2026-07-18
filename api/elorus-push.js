// ΑΥΤΟΜΑΤΗ ΚΑΤΑΧΩΡΗΣΗ εξόδου στο Elorus (Let's Go Bananas / playground-lads-ike).
// Παίρνει μία ΟΛΟΚΛΗΡΩΜΕΝΗ χρέωση (απόδειξη + project) και δημιουργεί expense στο Elorus.
//   POST { w, t, chargeId }         → push ΜΙΑΣ χρέωσης (owner-authenticated με προσωπικό token)
//   GET/POST ?all=1  (Vercel cron)  → push ΟΛΩΝ των eligible που δεν έχουν σταλεί ακόμα
// Idempotent: αποθηκεύει το elorus_id στο charges.raw → δεν ξανακαταχωρεί.
const { sbSelect, sbUpdate, verifyToken, wallets } = require("./_viva.js");

const BASE = "https://api.elorus.com/v1.1";
const ORG = process.env.ELORUS_ORG_ID || "2802338946946696842";
const TRACKING_ID = "2816025548696847940"; // tracking category «ΕΞΟΔΟΛΟΓΙΑ»
const INTERNAL = new Set(["LGB HOME", "LBG HOME"]);

// Σωστά ελληνικά ονόματα ανά κάρτα (η Viva δίνει λατινικά friendlyName).
const NAMES = {
  "448933314799": "Άγγελος Χρονόπουλος", "324887741089": "Ανδρέας Κολυγλιάτης", "566240519800": "Κώστας Κρυωνάς",
  "282541651501": "Ιωάννα Σκούρα", "657494082292": "Λουκία Μπαλτζή", "910827445981": "Άντα Μπαϊρακτάρη",
  "975269802823": "Αίας Παρασκευόπουλος", "405838582045": "Ζωή Ηγουμενίδη", "389933252655": "Μαριλού Θηβαίου",
  "968554634120": "Μαριλένα Σιταροπούλου", "577335556525": "Αναστασία Κοβάνη", "990263759336": "Δήμητρα Λάκη",
  "243763678466": "Ντόριαν Γκουτζέλας",
};

// --- κατηγορίες εξόδων Elorus (id) ---
const CAT = {
  ADS: "2816023551763547146",              // Ads
  SOFTWARE: "2816023626547987467",         // Applications & Software
  ANALOSIMA: "2802338947475179172",        // Αναλώσιμα & Προμήθειες
  AUTO: "2802338947475179162",             // Αυτοκίνητο & Μίλια
  FOOD: "2802338947475179167",             // Γεύματα & Διασκέδαση
  OFFICE: "2802338947475179168",           // Έξοδα γραφείου
  TRAVEL: "2802338947475179174",           // Ταξιδιωτικά
  LOIPA: "2802338947475179169",            // Λοιπά Έξοδα
};

// raw όνομα καταστήματος → κατηγορία εξόδου (best-effort, default = Λοιπά Έξοδα)
function pickCategory(rawMerchant) {
  const U = String(rawMerchant || "").toUpperCase();
  const has = (re) => re.test(U);
  if (has(/ANTHROPIC|OPENAI|CHATGPT|WISPR|CLAUDE\b|ADOBE|CANVA|FIGMA|NOTION|SLACK|ZOOM|VERCEL|GITHUB|MICROSOFT|MSFT|GOOGLE\s?(WORKSPACE|GSUITE|CLOUD|ONE|STORAGE)|APPLE\.COM|APPLE BILL|ITUNES|DROPBOX|SPOTIFY|LINKEDIN|ELEVENLABS|MIDJOURNEY|HEYGEN|CAPCUT|SEMRUSH|AHREFS|MAILCHIMP|WIX\b|SQUARESPACE|GODADDY|NAMECHEAP|HOSTINGER|SUNO|RUNWAY|PERPLEXITY/)) return CAT.SOFTWARE;
  if (has(/META\b|FACEBK|FACEBOOK|FB\.ME|INSTAGRAM|GOOGLE\s?ADS|GOOGLEADS|TIKTOK|SNAP\b|TWITTER ADS|\bX ADS\b|LINKEDIN ADS|\bADS\b|ADWORDS/)) return CAT.ADS;
  if (has(/ΒΑΣΙΛΟΠΟΥΛ|ABVASSILOPOULOS|^AB[\s_]|SKLAVENIT|ΣΚΛΑΒΕΝΙΤ|MASOUTIS|ΜΑΣΟΥΤΗ|\bLIDL\b|JUMBO|ΓΕΜΙΣΤΑ|MY MARKET|MYMARKET|KRITIKOS|ΚΡΗΤΙΚΟΣ|BAZAAR|PLAISIO|ΠΛΑΙΣΙΟ|\bPUBLIC\b|KOTSOVOLOS|ΚΩΤΣΟΒΟΛΟ|MEDIA MARKT|\bIKEA\b|ΓΕΡΜΑΝΟΣ|SUPER ?MARKET|ΣΟΥΠΕΡ ?ΜΑΡΚΕΤ|ΠΡΑΚΤΙΚΕΡ|PRAKTIKER|LEROY/)) return CAT.ANALOSIMA;
  if (has(/EFOOD|E-FOOD|\bWOLT\b|\bBOX\b|COFFEE|\bCAFE\b|FLOCAFE|ΚΑΦΕ|\bERGON\b|\bKFC\b|K\.F\.C|PIZZA|GOODY|MCDONALD|STARBUCKS|ΕΣΤΙΑΤ|TAVERN|ΤΑΒΕΡΝ|GRILL|SOUVLAK|ΣΟΥΒΛΑ|BAKERY|ΦΟΥΡΝΟΣ|ΑΡΤΟ|ΖΑΧΑΡΟΠΛΑΣΤ|\bBAR\b|BRUNCH|EVEREST|GREGORY|GREGORYS|MIKEL|\bCOOK\b|SNACK|WOKSHOP|ISLAND/)) return CAT.FOOD;
  if (has(/SHELL|\bEKO\b|\bBP\b|\bAVIN\b|\bELIN\b|ΕΛΙΝ|KAYSIMA|ΚΑΥΣΙΜ|PETROL|\bGAS\b|\bFUEL\b|FREE.?NOW|\bUBER\b|\bUBR\b|\bBEAT\b|\bTAXI\b|ΤΑΞΙ|\bOASA\b|ΟΑΣΑ|ATTIKI ODOS|ΑΤΤΙΚΗ ΟΔΟ|DIODIA|ΔΙΟΔΙΑ|OLYMPIA ODOS|ΟΛΥΜΠΙΑ ΟΔΟ|PARKING|ΠΑΡΚΙΝΓΚ|MOOVIT|CAR ?WASH|ΠΛΥΝΤΗΡΙΟ/)) return CAT.AUTO;
  if (has(/AEGEAN|RYANAIR|SKY EXPRESS|\bBOOKING\b|AIRBNB|\bHOTEL\b|ΞΕΝΟΔΟΧ|TRAINOSE|HELLENIC TRAIN|\bFERR|BLUE ?STAR|SUPERFAST|ATTICA GROUP|AIRPORT|ΑΕΡΟΔΡΟΜ|\bTRIP\b|EXPEDIA/)) return CAT.TRAVEL;
  if (has(/PRINT|ΧΑΡΤΙΚ|\bOFFICE\b|ΓΡΑΦΙΚ|COURIER|\bACS\b|\bELTA\b|ΕΛΤΑ|SPEEDEX|BOX ?NOW|ΚΟΥΡΙΕΡ/)) return CAT.OFFICE;
  return CAT.LOIPA;
}

// project (επιλογή υπαλλήλου) → ακριβές tracking option string του Elorus
const TRACK_OPTIONS = ["2ΓΕΜΙΣΤΑ ΠΑΠΑΔΟΠΟΥΛΟΥ", "ALGIDA", "ATTRATIVO", "BWIN", "CAPRICE-SARANTIS", "CLINEA-SARANTIS", "COFEE ISLAND", "CROCS", "INTERSPORT", "JOWAE", "K.F.C.", "KLINEX", "LBG HOME", "NEW HOME", "PHARMASEPT", "PIZZA HUT", "SANITAS", "SARANTIS-BECKMANN", "SARANTIS-DIRTY LAUNDRY", "SEPHORA", "SFN NOSTOS", "SNAPPI", "SNF NIARXOS", "STR8", "Shell", "TEZA-SARANTIS", "THE ELLINIKON", "TSAKIRIS", "VODAFONE", "WOKSHOP", "WOWCHI", "Α Β ΒΑΣΙΛΟΠΟΥΛΟΣ", "ΒΙΤΑΜ", "ΓΕΜΙΣΤΑ", "ΚΩΤΣΟΒΟΛΟΣ-GINGER", "ΜΕΤΑΙΧΜΙΟ"];
function norm(s) {
  return String(s || "").toUpperCase().replace(/[\s._\-]+/g, "")
    .replace(/[ΆΑ]/g, "Α").replace(/[ΈΕ]/g, "Ε").replace(/[ΉΗ]/g, "Η").replace(/[ΊΪΙ]/g, "Ι")
    .replace(/[ΌΟ]/g, "Ο").replace(/[ΎΫΥ]/g, "Υ").replace(/[ΏΩ]/g, "Ω");
}
function pickTrackingOption(project) {
  if (!project) return null;
  const np = norm(project);
  if (np === norm("LGB HOME") || np === norm("LBG HOME")) return "LBG HOME";
  const hit = TRACK_OPTIONS.find((o) => norm(o) === np);
  return hit || null; // αν δεν ταιριάζει, το αφήνει κενό (ο λογιστής το συμπληρώνει)
}

// --- ώρα Αθήνας για την ημερομηνία εξόδου ---
function athOffMin(d) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Athens", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(d).reduce((a, x) => (a[x.type] = x.value, a), {});
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - d.getTime()) / 60000;
}
function isCron(m) { return /Viva Wallet Card/i.test(m || ""); }
function athDate(iso) { try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(new Date(iso)); } catch (e) { return String(iso || "").slice(0, 10); } }
function grDate(iso) { try { return new Intl.DateTimeFormat("el-GR", { timeZone: "Europe/Athens", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso)); } catch (e) { return ""; } }

// καθαρό όνομα καταστήματος για την περιγραφή (ελαφρύ)
function cleanName(raw) {
  let s = String(raw || "").replace(/^(Δέσμευση Αγοράς|Αγορά) με Viva Wallet Card\s*-?\s*/i, "").trim();
  s = s.replace(/^[A-Z0-9]{2,10}\s*\*\s*/i, "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return s || "Αγορά με κάρτα";
}

async function elorus(method, path, body) {
  const key = process.env.ELORUS_API_KEY;
  if (!key) return { status: 0, body: { error: "Λείπει ELORUS_API_KEY" } };
  const r = await fetch(`${BASE}/${path}`, {
    method,
    headers: { Authorization: `Token ${key}`, "X-Elorus-Organization": ORG, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let b; try { b = JSON.parse(txt); } catch (e) { b = txt.slice(0, 400); }
  return { status: r.status, body: b };
}

// Δημιουργεί το expense στο Elorus για μία χρέωση (charge row). Επιστρέφει {ok, id?, skipped?, error?}
async function pushCharge(c, nameByWallet) {
  // ήδη σταλμένο;
  const existing = c.raw && c.raw.elorus_id;
  if (existing) return { ok: true, skipped: "already", id: existing };
  if (!c.has_receipt || !c.project) return { ok: false, skipped: "incomplete" };

  const amt = Math.abs(+c.amount);
  if (!(amt > 0)) return { ok: false, error: "μηδενικό ποσό" };
  const date = athDate(c.occurred_at);
  const catId = pickCategory(c.merchant);
  const opt = pickTrackingOption(c.project);
  const store = cleanName(c.merchant);
  const info = nameByWallet[String(c.wallet_id)] || {};
  const who = info.name || "";
  const card = info.card || "";
  const parts = [store];
  const meta = [who && `${who}`, card && `κάρτα ••${card}`, grDate(c.occurred_at) && grDate(c.occurred_at)].filter(Boolean).join(", ");
  const desc = `${store}${meta ? ` (${meta})` : ""}${c.receipt_url ? ` · Απόδειξη: ${c.receipt_url}` : ""}`;

  const payload = {
    date,
    currency_code: "EUR",
    supplier: null,
    reference: `Viva ••${card} ${c.project}`.slice(0, 60),
    items: [{
      expense_category: catId,
      description: desc.slice(0, 300),
      amount: amt.toFixed(2),
      taxes: [],
      project: null,
      billable: false,
    }],
  };
  if (opt) payload.trackingcategories = [{ trackingcategory: TRACKING_ID, option: opt }];

  const r = await elorus("POST", "expenses/", payload);
  if (r.status !== 201 && r.status !== 200) return { ok: false, error: `Elorus ${r.status}`, detail: r.body };
  const id = r.body && r.body.id;
  // idempotency: κράτα το elorus_id στη χρέωση
  const newRaw = Object.assign({}, c.raw || {}, { elorus_id: id, elorus_at: new Date().toISOString(), elorus_cat: catId, elorus_option: opt || null });
  await sbUpdate("charges", `id=eq.${encodeURIComponent(c.id)}`, { raw: newRaw });
  return { ok: true, id, category: catId, option: opt || null };
}

async function walletInfo() {
  const map = {};
  try {
    const ws = await wallets();
    for (const w of (Array.isArray(ws) ? ws : [])) {
      const fn = w.friendlyName || "";
      const m = fn.match(/^(.*?)\s*(\d{4})$/);
      map[String(w.walletId)] = { name: NAMES[String(w.walletId)] || (m ? m[1] : fn).trim(), card: m ? m[2] : "" };
    }
  } catch (e) {}
  return map;
}

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body || "{}"); } catch (e) { body = {}; } }
    body = body || {};

    // ---- BULK / CRON: push όλων των eligible ----
    if (q.all || body.all) {
      const isCronReq = !!req.headers["x-vercel-cron"] || String(q.secret || "") === String(process.env.ELORUS_PUSH_SECRET || "__none__");
      if (!isCronReq) return res.status(403).json({ error: "Μόνο από cron ή με secret" });
      const nameByWallet = await walletInfo();
      // eligible: έχει απόδειξη + project, δεν είναι εσωτερικό-εξαίρεση, δεν έχει elorus_id
      const rows = await sbSelect("charges", `has_receipt=eq.true&project=not.is.null&order=occurred_at.asc&limit=500`);
      const out = [];
      for (const c of (rows || [])) {
        if (c.raw && c.raw.elorus_id) continue;
        if (!c.project) continue;
        const r = await pushCharge(c, nameByWallet);
        out.push({ id: c.id, ...r });
      }
      const created = out.filter((x) => x.ok && !x.skipped).length;
      return res.status(200).json({ ok: true, scanned: (rows || []).length, created, results: out });
    }

    // ---- SINGLE: owner-authenticated ----
    const w = String(body.w || q.w || "");
    const t = String(body.t || q.t || "");
    const chargeId = body.chargeId || q.chargeId;
    if (!w || !verifyToken(w, t)) return res.status(403).json({ error: "Άκυρο link" });
    if (!chargeId) return res.status(400).json({ error: "λείπει chargeId" });

    const rows = await sbSelect("charges", `id=eq.${encodeURIComponent(chargeId)}&select=*`);
    if (!rows.length) return res.status(404).json({ error: "δεν βρέθηκε η χρέωση" });
    const c = rows[0];
    if (String(c.wallet_id) !== w) return res.status(403).json({ error: "η χρέωση δεν είναι δική σου" });

    const nameByWallet = await walletInfo();
    const r = await pushCharge(c, nameByWallet);
    if (!r.ok && !r.skipped) return res.status(400).json(r);
    return res.status(200).json(r);
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};
