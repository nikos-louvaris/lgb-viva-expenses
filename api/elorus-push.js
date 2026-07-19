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

// αφαίρεση ελληνικών τόνων + κεφαλαία (για σταθερό matching)
function deaccentUp(s) {
  return String(s || "").toUpperCase()
    .replace(/[ΆΑ]/g, "Α").replace(/[ΈΕ]/g, "Ε").replace(/[ΉΗ]/g, "Η").replace(/[ΊΪΐΙ]/g, "Ι")
    .replace(/[ΌΟ]/g, "Ο").replace(/[ΎΫΰΥ]/g, "Υ").replace(/[ΏΩ]/g, "Ω");
}
// όνομα καταστήματος → κατηγορία εξόδου (best-effort, default = Λοιπά Έξοδα)
// Ελέγχει ΚΑΙ το raw ΚΑΙ το καθαρισμένο όνομα, χωρίς τόνους/prefix Viva.
function pickCategory(rawMerchant) {
  const U = deaccentUp(cleanName(rawMerchant) + " || " + rawMerchant);
  const has = (re) => re.test(U);
  if (has(/ANTHROPIC|OPENAI|CHATGPT|WISPR|CLAUDE\b|ADOBE|CANVA|FIGMA|NOTION|SLACK|ZOOM|VERCEL|GITHUB|MICROSOFT|MSFT|GOOGLE\s?(WORKSPACE|GSUITE|CLOUD|ONE|STORAGE)|APPLE\.COM|APPLE BILL|ITUNES|DROPBOX|SPOTIFY|LINKEDIN|ELEVENLABS|MIDJOURNEY|HEYGEN|CAPCUT|SEMRUSH|AHREFS|MAILCHIMP|WIX\b|SQUARESPACE|GODADDY|NAMECHEAP|HOSTINGER|SUNO|RUNWAY|PERPLEXITY/)) return CAT.SOFTWARE;
  if (has(/META\b|FACEBK|FACEBOOK|FB\.ME|INSTAGRAM|GOOGLE\s?ADS|GOOGLEADS|TIKTOK|SNAP\b|TWITTER ADS|\bX ADS\b|LINKEDIN ADS|\bADS\b|ADWORDS/)) return CAT.ADS;
  if (has(/ΒΑΣΙΛΟΠΟΥΛ|ABVASSILOPOULOS|\bAB[\s_]|SKLAVENIT|ΣΚΛΑΒΕΝΙΤ|MASOUTIS|ΜΑΣΟΥΤΗ|\bLIDL\b|JUMBO|ΓΕΜΙΣΤΑ|MY MARKET|MYMARKET|KRITIKOS|ΚΡΗΤΙΚΟΣ|BAZAAR|PLAISIO|ΠΛΑΙΣΙΟ|\bPUBLIC\b|KOTSOVOLOS|ΚΩΤΣΟΒΟΛΟ|MEDIA MARKT|\bIKEA\b|ΓΕΡΜΑΝΟΣ|SUPER ?MARKET|ΣΟΥΠΕΡ ?ΜΑΡΚΕΤ|ΠΡΑΚΤΙΚΕΡ|PRAKTIKER|LEROY/)) return CAT.ANALOSIMA;
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
function fixDsTime(iso) { try { const w = new Date(iso); return new Date(w.getTime() - athOffMin(w) * 60000).toISOString(); } catch (e) { return iso; } }

// ΙΔΙΟ dedup με το dashboard/my.js — ΚΡΙΣΙΜΟ ώστε διπλές φυσικές εγγραφές (cron/settlement)
// της ίδιας αγοράς να ΜΗΝ δημιουργούν διπλά έξοδα στο Elorus.
function dedupCharges(rows) {
  const norm = (id) => String(id || "").replace(/^AUTH-/, "");
  const isDup = (m) => /Viva Wallet Card/i.test(m || "");
  rows = (rows || []).map((c) => isDup(c.merchant) ? { ...c, occurred_at: fixDsTime(c.occurred_at) } : { ...c });
  const byId = new Map();
  for (const c of rows) {
    const k = norm(c.viva_tx_id); const ex = byId.get(k);
    if (!ex) { byId.set(k, { ...c }); continue; }
    const m = { ...ex };
    if (isDup(m.merchant) && !isDup(c.merchant)) m.merchant = c.merchant;
    if (String(c.occurred_at || "") < String(m.occurred_at || "")) m.occurred_at = c.occurred_at;
    if (c.has_receipt) { m.has_receipt = true; m.receipt_url = c.receipt_url || m.receipt_url; }
    if (c.project) m.project = c.project;
    if (c.raw && c.raw.elorus_id) m.raw = c.raw; // κράτα το raw που έχει ήδη elorus_id
    if (String(c.status) !== "PENDING_CLEAR") m.status = c.status;
    byId.set(k, m);
  }
  const list = [...byId.values()];
  const reals = list.filter((c) => !isDup(c.merchant));
  const dups = list.filter((c) => isDup(c.merchant)).sort((a, b) => String(a.occurred_at || "").localeCompare(String(b.occurred_at || "")));
  const pool = {}; for (const r of reals) { const k = Math.abs(+r.amount).toFixed(2); (pool[k] = pool[k] || []).push(r); }
  const used = new Set(); const kept = [];
  for (const s of dups) {
    const k = Math.abs(+s.amount).toFixed(2);
    const cand = (pool[k] || []).filter((r) => !used.has(r) && String(r.occurred_at || "") <= String(s.occurred_at || "")).sort((a, b) => String(b.occurred_at || "").localeCompare(String(a.occurred_at || "")));
    if (cand[0]) { used.add(cand[0]); if (s.has_receipt && !cand[0].has_receipt) { cand[0].has_receipt = true; cand[0].receipt_url = s.receipt_url; } if (s.project && !cand[0].project) cand[0].project = s.project; } else kept.push(s);
  }
  const km = new Map();
  for (const s of kept) { const k = Math.abs(+s.amount).toFixed(2); if (!km.has(k)) km.set(k, s); }
  return [...reals, ...km.values()];
}
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

// --- ΠΡΟΜΗΘΕΥΤΕΣ ---
// Τα τιμολόγια (invoices) πρέπει να περνάνε ΜΕ προμηθευτή, όχι «καρφωτά».
// Κατηγορίες που τυπικά εκδίδουν ΤΙΜΟΛΟΓΙΟ (όχι απλή απόδειξη λιανικής):
const INVOICE_CATS = new Set([CAT.SOFTWARE, CAT.ADS, CAT.OFFICE]);
// λέξεις που αφαιρούνται πριν το matching (νομικές μορφές κ.λπ.)
const LEGALS = /\b(PBC|INC|LLC|LTD|LIMITED|CORP|CO|GMBH|BV|OU|OÜ|SA|AE|ΑΕ|ΕΕ|ΟΕ|ΙΚΕ|IKE|ΜΟΝ|ΜΟΝΟΠΡΟΣΩΠΗ|ΑΝΩΝΥΜΗ|ΕΤΑΙΡΕΙΑ|ΕΤΑΙΡΙΑ|SOFTWARE|SYSTEMS|IRELAND|HELLAS|GREECE)\b/g;
function normName(s) {
  return deaccentUp(String(s || ""))
    .replace(/\|\|/g, " ").replace(/[^A-ZΑ-Ω0-9 ]+/g, " ")
    .replace(LEGALS, " ").replace(/\s+/g, " ").trim();
}
let _contactsCache = null;
async function allContacts() {
  if (_contactsCache) return _contactsCache;
  const out = [];
  for (let page = 1; page <= 4; page++) {
    const r = await elorus("GET", `contacts/?page_size=300&page=${page}`);
    const res = (r.body && r.body.results) || [];
    out.push(...res);
    if (!r.body || !r.body.next) break;
  }
  _contactsCache = out;
  return out;
}
// Βρίσκει προμηθευτή που ταιριάζει με το όνομα καταστήματος. Επιστρέφει {id,name} ή null.
async function findSupplier(merchantRaw) {
  // ΚΑΙ το raw ΚΑΙ το καθαρισμένο: το cleanName κόβει prefix πριν το «*» (π.χ. ANTHROPIC*CLAUDE)
  const m = normName(String(merchantRaw || "") + " " + cleanName(merchantRaw));
  if (!m) return null;
  const tokens = m.split(" ").filter((x) => x.length >= 4);
  if (!tokens.length) return null;
  const list = await allContacts();
  let best = null;
  for (const c of list) {
    const nm = normName(c.company || c.display_name || `${c.first_name || ""} ${c.last_name || ""}`);
    if (!nm) continue;
    // δυνατό ταίριασμα: κοινό «σημαντικό» token (π.χ. ANTHROPIC) ή πλήρης περιοχή ονόματος
    const hit = tokens.some((t) => nm.split(" ").includes(t)) || (m.length >= 5 && nm.includes(m));
    if (!hit) continue;
    const score = (c.is_supplier ? 2 : 0) + (nm === m ? 3 : 0);
    if (!best || score > best.score) best = { id: c.id, name: c.company || c.display_name, score, is_supplier: !!c.is_supplier };
  }
  return best;
}

// --- ΦΥΛΑΚΑΣ ΔΙΠΛΟΕΓΓΡΑΦΩΝ ---
// Κάθε έξοδο που φτιάχνουμε φέρει custom_id = VIVA-<chargeId>. Πριν από ΚΑΘΕ καταχώρηση
// ρωτάμε το ΙΔΙΟ το Elorus (όχι μόνο τη βάση μας) αν υπάρχει ήδη.
function vivaTag(chargeId) { return `VIVA-${chargeId}`; }
async function findExistingExpense(chargeId, dateStr, amt) {
  const tag = vivaTag(chargeId);
  // 1) ακριβές ταίριασμα με custom_id (ο δικός μας «δακτυλικός αποτυπωτής»)
  for (const qs of [`custom_id=${encodeURIComponent(tag)}`, `search=${encodeURIComponent(tag)}`]) {
    const r = await elorus("GET", `expenses/?${qs}&page_size=20`);
    const res = (r.body && r.body.results) || [];
    const hit = res.find((x) => String(x.custom_id || "") === tag);
    if (hit) return { kind: "same-charge", expense: hit };
  }
  // 2) ίδια ημερομηνία + ίδιο ποσό → πιθανό διπλό (π.χ. χειροκίνητη καταχώρηση).
  // Σαρώνουμε με σειρά ημερομηνίας (τα φίλτρα date_from/date_to δεν είναι αξιόπιστα).
  const same = [];
  for (let page = 1; page <= 4; page++) {
    const r2 = await elorus("GET", `expenses/?page_size=200&page=${page}&ordering=-date`);
    const res2 = (r2.body && r2.body.results) || [];
    if (!res2.length) break;
    for (const x of res2) {
      if (x.date === dateStr && Math.abs(parseFloat(x.total) - amt) < 0.005) same.push(x);
    }
    // τα αποτελέσματα είναι φθίνουσα ημερομηνία → αν περάσαμε τη ζητούμενη, σταμάτα
    const last = res2[res2.length - 1];
    if (last && String(last.date) < String(dateStr)) break;
    if (!r2.body || !r2.body.next) break;
  }
  if (same.length) {
    const mine = same.find((x) => String(x.custom_id || "") === tag);
    if (mine) return { kind: "same-charge", expense: mine };
    return { kind: "possible-duplicate", expense: same[0], count: same.length };
  }
  return null;
}

// Ορίζει προμηθευτή σε ΥΠΑΡΧΟΝ έξοδο. Το Elorus δεν δέχεται PATCH → GET + PUT ολόκληρου.
async function setExpenseSupplier(expenseId, supplierId) {
  const cur = await elorus("GET", `expenses/${expenseId}/`);
  if (cur.status !== 200) return { ok: false, error: `GET ${cur.status}` };
  const b = cur.body || {};
  const putBody = {
    date: b.date,
    currency_code: b.currency_code,
    exchange_rate: b.exchange_rate,
    reference: b.reference || "",
    custom_id: b.custom_id || "",
    branch: b.branch || null,
    supplier: supplierId,
    items: (b.items || []).map((it) => ({
      expense_category: it.expense_category,
      description: it.description,
      amount: it.amount,
      taxes: it.taxes || [],
      project: it.project || null,
      billable: !!it.billable,
    })),
    trackingcategories: (b.trackingcategories || []).map((t) => ({ trackingcategory: t.trackingcategory, option: t.option })),
  };
  const pr = await elorus("PUT", `expenses/${expenseId}/`, putBody);
  if (pr.status >= 200 && pr.status < 300) return { ok: true };
  return { ok: false, error: `PUT ${pr.status}`, detail: pr.body };
}

// Βάζει το αρχείο στο ΠΕΔΙΟ «Απόδειξη» του εξόδου, ώστε να ΦΑΙΝΕΤΑΙ η εικόνα δεξιά
// όταν ανοίγει το έξοδο στο Elorus (όχι απλώς συνδετήρας/link).
// ΠΡΟΣΩΡΙΝΑ ΑΝΕΝΕΡΓΟ: το documented path .../receipt/ επιστρέφει 404. Θα ενεργοποιηθεί
// μόλις εντοπιστεί το πραγματικό endpoint (καταγραφή του αιτήματος που κάνει το UI του Elorus).
const RECEIPT_PANEL_ENABLED = false;
async function setExpenseReceipt(expenseId, receiptUrl) {
  try {
    if (!RECEIPT_PANEL_ENABLED) return { ok: false, why: "disabled" };
    if (!receiptUrl) return { ok: false, why: "no-url" };
    const key = process.env.ELORUS_API_KEY;
    const rf = await fetch(receiptUrl);
    if (!rf.ok) return { ok: false, why: `fetch ${rf.status}` };
    const ct = (rf.headers.get("content-type") || "image/jpeg").split(";")[0];
    const buf = Buffer.from(await rf.arrayBuffer());
    const ext = (ct.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "") || "jpg";
    const attempts = [];
    const P = `expenses/${expenseId}/receipt/`;
    const combos = [
      // raw body (το αρχείο σκέτο) — πιθανότερο για endpoint «receipt»
      { v: "v1.2", p: P, m: "PUT", raw: true },
      { v: "v1.2", p: P, m: "POST", raw: true },
      { v: "v1.2", p: `expenses/${expenseId}/receipt`, m: "PUT", raw: true },
      // multipart παραλλαγές
      { v: "v1.2", p: P, m: "POST", f: "file" },
      { v: "v1.2", p: P, m: "PUT", f: "file" },
      { v: "v1.1", p: P, m: "POST", f: "file" },
    ];
    for (const cb of combos) {
      const label = `${cb.m} ${cb.v}/${cb.p}${cb.raw ? " [raw]" : ` [${cb.f}]`}`;
      try {
        const headers = { Authorization: `Token ${key}`, "X-Elorus-Organization": ORG };
        let body;
        if (cb.raw) { body = buf; headers["Content-Type"] = ct; headers["Content-Disposition"] = `attachment; filename="apodeixi.${ext}"`; }
        else { const form = new FormData(); form.append(cb.f, new Blob([buf], { type: ct }), `apodeixi.${ext}`); body = form; }
        const r = await fetch(`https://api.elorus.com/${cb.v}/${cb.p}`, { method: cb.m, headers, body });
        const txt = await r.text(); let b; try { b = JSON.parse(txt); } catch (e) { b = String(txt).slice(0, 120); }
        if (r.status >= 200 && r.status < 300) return { ok: true, via: label, body: b };
        attempts.push({ via: label, status: r.status, detail: b });
      } catch (e) {
        attempts.push({ via: label, err: String(e.message || e) });
      }
    }
    return { ok: false, attempts };
  } catch (e) { return { ok: false, why: String(e.message || e) }; }
}

// Επισυνάπτει το αρχείο απόδειξης στο έξοδο (Elorus API v1.2, multipart/form-data).
async function attachReceipt(expenseId, receiptUrl, title) {
  try {
    if (!receiptUrl) return { ok: false, why: "no-url" };
    const key = process.env.ELORUS_API_KEY;
    const rf = await fetch(receiptUrl);
    if (!rf.ok) return { ok: false, why: `fetch ${rf.status}` };
    const ct = (rf.headers.get("content-type") || "image/jpeg").split(";")[0];
    const buf = Buffer.from(await rf.arrayBuffer());
    const ext = (ct.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "") || "jpg";
    const form = new FormData();
    form.append("title", String(title || "Απόδειξη").slice(0, 120));
    form.append("file", new Blob([buf], { type: ct }), `apodeixi.${ext}`);
    const r = await fetch(`https://api.elorus.com/v1.2/expenses/${expenseId}/attachments/`, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "X-Elorus-Organization": ORG }, // ΟΧΙ Content-Type — το βάζει το FormData με boundary
      body: form,
    });
    const txt = await r.text(); let b; try { b = JSON.parse(txt); } catch (e) { b = txt.slice(0, 200); }
    if (r.status !== 201 && r.status !== 200) return { ok: false, status: r.status, detail: b };
    return { ok: true, id: b && b.id };
  } catch (e) { return { ok: false, why: String(e.message || e) }; }
}

// Δημιουργεί το expense στο Elorus για μία χρέωση (charge row). Επιστρέφει {ok, id?, skipped?, error?}
async function pushCharge(c, nameByWallet, opts) {
  opts = opts || {};
  const raw0 = c.raw || {};
  let existing = opts.force ? null : raw0.elorus_id;

  // ΑΥΤΟ-ΕΠΙΔΙΟΡΘΩΣΗ ΟΡΦΑΝΩΝ: αν ο Κώστας διέγραψε το έξοδο, ο δεσμός είναι νεκρός.
  // Ψάχνουμε αν υπάρχει άλλο ίδιο έξοδο (αντίγραφο που κρατήθηκε) → ξανασυνδέουμε.
  // Αν δεν υπάρχει κανένα → καθαρίζουμε και ξαναδημιουργούμε (με τον φύλακα ενεργό).
  if (existing) {
    const chk = await elorus("GET", `expenses/${existing}/`);
    if (chk.status === 404) {
      const amt0 = Math.abs(+c.amount);
      const d0 = athDate(c.occurred_at);
      const alt = await findExistingExpense(c.id, d0, amt0);
      if (alt && alt.expense && String(alt.expense.id) !== String(existing)) {
        await sbUpdate("charges", `id=eq.${encodeURIComponent(c.id)}`, { raw: Object.assign({}, raw0, { elorus_id: alt.expense.id, elorus_attachment: null, elorus_supplier: null }) });
        return { ok: true, skipped: "relinked", id: alt.expense.id, detail: "Ο παλιός δεσμός ήταν σε διαγραμμένο έξοδο — συνδέθηκε με το υπάρχον" };
      }
      existing = null; // δεν βρέθηκε τίποτα → ξαναδημιούργησε
      delete raw0.elorus_id; delete raw0.elorus_attachment; delete raw0.elorus_supplier;
    }
  }

  // Υπάρχει ήδη έξοδο: αν λείπει ΜΟΝΟ το συνημμένο/προμηθευτής, συμπλήρωσέ το (χωρίς νέο έξοδο).
  if (existing) {
    const fixes = {}; let att = null, supFix = null, rec = null;
    // 1) λείπει συνημμένο → βάλ' το
    if (!raw0.elorus_attachment && c.receipt_url) {
      att = await attachReceipt(existing, c.receipt_url, `Απόδειξη ${cleanName(c.merchant)}`);
      if (att.ok) { fixes.elorus_attachment = att.id; fixes.elorus_att_at = new Date().toISOString(); }
    }
    // 1β) λείπει από το πεδίο «Απόδειξη» (δεξιά προβολή) → βάλ' το
    if (!raw0.elorus_receipt && c.receipt_url) {
      rec = await setExpenseReceipt(existing, c.receipt_url);
      if (rec.ok) fixes.elorus_receipt = true;
    }
    // 2) λείπει προμηθευτής → βρες τον και ΔΙΟΡΘΩΣΕ το υπάρχον έξοδο (όχι νέο/διπλό)
    if (!raw0.elorus_supplier) {
      const found = opts.supplierId ? { id: String(opts.supplierId), name: "(χειροκίνητο)" } : await findSupplier(c.merchant);
      if (found) {
        const pr = await setExpenseSupplier(existing, found.id);
        if (pr.ok) { fixes.elorus_supplier = found.id; supFix = found; }
        else supFix = Object.assign({ tried: found }, pr);
      } else { fixes.elorus_supplier = "none"; }
    }
    if (Object.keys(fixes).length) await sbUpdate("charges", `id=eq.${encodeURIComponent(c.id)}`, { raw: Object.assign({}, raw0, fixes) });
    if (!att && !supFix && !rec) return { ok: true, skipped: "already", id: existing };
    return { ok: true, skipped: "updated", id: existing, attachment: att, receipt: rec, supplier: supFix };
  }
  if (!c.has_receipt || !c.project) return { ok: false, skipped: "incomplete" };

  const amt = Math.abs(+c.amount);
  if (!(amt > 0)) return { ok: false, error: "μηδενικό ποσό" };
  // ΚΑΝΟΝΑΣ: αν υπάρχει ημερομηνία ΤΙΜΟΛΟΓΙΟΥ (από OCR ή override), αυτή υπερισχύει
  // της ημερομηνίας χρέωσης της κάρτας.
  const invDate = opts.date || (raw0.invoice && raw0.invoice.date) || null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(invDate || "")) ? String(invDate) : athDate(c.occurred_at);
  const invNo = opts.reference || (raw0.invoice && raw0.invoice.number) || null;

  // ΦΥΛΑΚΑΣ: υπάρχει ήδη στο Elorus; (ποτέ διπλή καταχώρηση)
  if (!opts.allowDup) {
    const dup = await findExistingExpense(c.id, date, amt);
    if (dup && dup.kind === "same-charge") {
      // Υπάρχει ήδη δικό μας — κράτα τη σύνδεση, μη φτιάξεις νέο
      await sbUpdate("charges", `id=eq.${encodeURIComponent(c.id)}`, { raw: Object.assign({}, raw0, { elorus_id: dup.expense.id }) });
      return { ok: true, skipped: "exists-in-elorus", id: dup.expense.id };
    }
    if (dup && dup.kind === "possible-duplicate") {
      return { ok: false, skipped: "possible-duplicate", detail: `Υπάρχει ήδη έξοδο ${amt.toFixed(2)}€ στις ${date} (id ${dup.expense.id}) — δεν καταχωρήθηκε για αποφυγή διπλού` };
    }
  }
  const catId = pickCategory(c.merchant);
  const opt = pickTrackingOption(c.project);
  const store = cleanName(c.merchant);
  const info = nameByWallet[String(c.wallet_id)] || {};
  const who = info.name || "";
  const card = info.card || "";
  const parts = [store];
  const meta = [who && `${who}`, card && `κάρτα ••${card}`, grDate(c.occurred_at) && grDate(c.occurred_at)].filter(Boolean).join(", ");
  const desc = `${store}${meta ? ` (${meta})` : ""}${c.receipt_url ? ` · Απόδειξη: ${c.receipt_url}` : ""}`;

  // ΤΙΜΟΛΟΓΙΟ vs ΑΠΛΗ ΑΠΟΔΕΙΞΗ:
  // Ελέγχουμε ΠΡΩΤΑ τους προμηθευτές. Αν το κατάστημα ταιριάζει σε υπάρχοντα προμηθευτή
  // (ή είναι κατηγορία που εκδίδει τιμολόγιο), περνάει ΜΕ προμηθευτή — όχι «καρφωτό».
  let sup = null, supWarn = null;
  if (opts.supplierId) {
    sup = { id: String(opts.supplierId), name: "(χειροκίνητο)" };
  } else {
    const found = await findSupplier(c.merchant);
    if (found) sup = found;
    else if (INVOICE_CATS.has(catId)) supWarn = "ΤΙΜΟΛΟΓΙΟ ΧΩΡΙΣ ΠΡΟΜΗΘΕΥΤΗ — χρειάζεται άνοιγμα προμηθευτή";
  }
  const isInvoice = !!sup || INVOICE_CATS.has(catId);

  const payload = {
    date,
    currency_code: "EUR",
    custom_id: vivaTag(c.id), // μοναδικό «αποτύπωμα» → φύλακας διπλοεγγραφών
    supplier: sup ? sup.id : null,
    reference: String(invNo || `Viva ••${card} ${c.project}`).slice(0, 60),
    items: [{
      expense_category: catId,
      description: String(opts.descr || desc).slice(0, 300),
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
  // Επισύναψε την απόδειξη ως αρχείο μέσα στο έξοδο (best-effort).
  const att = c.receipt_url ? await attachReceipt(id, c.receipt_url, `Απόδειξη ${store}`) : { ok: false, why: "no-receipt" };
  // ΚΑΙ στο πεδίο «Απόδειξη» → να φαίνεται η εικόνα δεξιά στο άνοιγμα του εξόδου
  const rec = c.receipt_url ? await setExpenseReceipt(id, c.receipt_url) : { ok: false, why: "no-receipt" };
  // idempotency: κράτα elorus_id + attachment στη χρέωση
  const newRaw = Object.assign({}, raw0, { elorus_id: id, elorus_at: new Date().toISOString(), elorus_cat: catId, elorus_option: opt || null, elorus_attachment: att.ok ? att.id : null, elorus_receipt: !!rec.ok, elorus_supplier: sup ? sup.id : null, elorus_type: isInvoice ? "invoice" : "receipt" });
  await sbUpdate("charges", `id=eq.${encodeURIComponent(c.id)}`, { raw: newRaw });
  return { ok: true, id, category: catId, option: opt || null, attachment: att, receipt: rec, type: isInvoice ? "ΤΙΜΟΛΟΓΙΟ" : "ΑΠΟΔΕΙΞΗ", supplier: sup, warn: supWarn };
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

    // ---- ΔΕΥΤΕΡΟΣ AGENT (read-only): ?audit=1 ----
    // Ανεξάρτητος έλεγχος των καταχωρήσεων ΜΕΣΑ στο Elorus. Δεν γράφει/σβήνει τίποτα.
    if (q.audit) {
      const aw2 = String(body.w || q.w || ""), at2 = String(body.t || q.t || "");
      const cronOk = !!req.headers["x-vercel-cron"] || /vercel-cron/i.test(String(req.headers["user-agent"] || ""));
      if (!cronOk && !(aw2 && verifyToken(aw2, at2))) return res.status(403).json({ error: "Μη εξουσιοδοτημένο" });

      const byTag = new Map(), expById = new Map();
      for (let page = 1; page <= 3; page++) {
        const r = await elorus("GET", `expenses/?page_size=200&page=${page}&ordering=-date`);
        const rows = (r.body && r.body.results) || [];
        for (const e of rows) {
          expById.set(String(e.id), e);
          const cid = String(e.custom_id || "");
          if (/^VIVA-/.test(cid)) { if (!byTag.has(cid)) byTag.set(cid, []); byTag.get(cid).push(e); }
        }
        if (!r.body || !r.body.next) break;
      }

      const issues = [];
      // (1) ΔΙΠΛΕΣ: ίδιο αποτύπωμα σε >1 έξοδα
      for (const [tag, list] of byTag) {
        if (list.length > 1) issues.push({ type: "ΔΙΠΛΗ_ΚΑΤΑΧΩΡΗΣΗ", tag, detail: `Η ίδια χρέωση (${tag}) έχει ${list.length} έξοδα`, expenses: list.map((e) => ({ id: e.id, date: e.date, total: e.total })) });
      }
      // (2) ΠΙΘΑΝΑ ΔΙΠΛΑ: ίδια ημ/νία + ίδιο ποσό όπου εμπλέκεται δική μας καταχώρηση
      const seen = new Map();
      for (const e of expById.values()) {
        const k = `${e.date}|${parseFloat(e.total).toFixed(2)}`;
        if (!seen.has(k)) seen.set(k, []); seen.get(k).push(e);
      }
      for (const [k, list] of seen) {
        if (list.length < 2) continue;
        const ours = list.filter((e) => /^VIVA-/.test(String(e.custom_id || "")));
        if (!ours.length) continue;
        const tags = new Set(ours.map((e) => e.custom_id));
        if (tags.size <= 1) {
          const [d, a] = k.split("|");
          issues.push({ type: "ΠΙΘΑΝΟ_ΔΙΠΛΟ", detail: `${list.length} έξοδα ${a}€ στις ${d}`, expenses: list.map((e) => ({ id: e.id, custom_id: e.custom_id || "(χειροκίνητο)", total: e.total })) });
        }
      }
      // (3) Οι χρεώσεις μας: ορφανά / δεν πέρασαν / χωρίς συνημμένο
      const EXCL = new Set(["901067108914"]);
      const wsA = await wallets();
      const mem = (Array.isArray(wsA) ? wsA : []).filter((x) => x.hasIssuedCard && !x.isPrimary && x.friendlyName && x.friendlyName !== "ακυρο" && !EXCL.has(String(x.walletId))).map((x) => String(x.walletId));
      let completed = 0, pushed = 0;
      for (const wid of mem) {
        const raw = await sbSelect("charges", `wallet_id=eq.${wid}&order=occurred_at.desc&limit=1000`);
        for (const c of dedupCharges(raw || [])) {
          if (!c.has_receipt || !c.project) continue;
          completed++;
          const eid = c.raw && c.raw.elorus_id;
          if (!eid) { issues.push({ type: "ΔΕΝ_ΠΕΡΑΣΕ", charge: c.id, detail: `${Math.abs(+c.amount).toFixed(2)}€ ${cleanName(c.merchant)} — δεν έχει περάσει στο Elorus` }); continue; }
          pushed++;
          if (!expById.has(String(eid))) issues.push({ type: "ΟΡΦΑΝΟ", charge: c.id, expense: eid, detail: "Δείχνει σε έξοδο που δεν υπάρχει πια (διαγράφηκε)" });
          if (!(c.raw && c.raw.elorus_attachment)) issues.push({ type: "ΧΩΡΙΣ_ΣΥΝΗΜΜΕΝΟ", charge: c.id, expense: eid, detail: "Έξοδο χωρίς συνημμένη απόδειξη" });
        }
      }
      return res.status(200).json({ ok: true, generatedAt: new Date().toISOString(), elorusScanned: expById.size, ourEntries: byTag.size, completedCharges: completed, pushedCharges: pushed, totalIssues: issues.length, issues });
    }

    // ---- ΕΛΕΓΧΟΣ ΠΡΟΜΗΘΕΥΤΗ (read-only): ?supplier=Anthropic ----
    if (q.supplier) {
      const sw = String(body.w || q.w || ""), st = String(body.t || q.t || "");
      if (!sw || !verifyToken(sw, st)) return res.status(403).json({ error: "Μη εξουσιοδοτημένο" });
      const found = await findSupplier(String(q.supplier));
      const list = await allContacts();
      const nm = normName(String(q.supplier));
      const near = list.filter((c) => normName(c.company || c.display_name || "").includes(nm.split(" ")[0] || "___"))
        .slice(0, 10).map((c) => ({ id: c.id, name: c.company || c.display_name, is_supplier: !!c.is_supplier, vat: c.vat_number || "" }));
      return res.status(200).json({ query: q.supplier, match: found, near, totalContacts: list.length });
    }

    // ---- BULK: push όλων των eligible ----
    // Auth: Vercel cron header Ή έγκυρο member token (w,t) — το χρησιμοποιεί το κουμπί & το daily task.
    if (q.all || body.all) {
      const aw = String(body.w || q.w || ""), at = String(body.t || q.t || "");
      const ua = String(req.headers["user-agent"] || "");
      const isVercelCron = !!req.headers["x-vercel-cron"] || /vercel-cron/i.test(ua);
      const authed = isVercelCron || (aw && verifyToken(aw, at)) || String(q.secret || "") === String(process.env.ELORUS_PUSH_SECRET || "__none__");
      if (!authed) return res.status(403).json({ error: "Μη εξουσιοδοτημένο" });
      const nameByWallet = await walletInfo();
      // Πάρε τα μέλη (κάρτες), κάνε dedup ΑΝΑ κάρτα, μετά push μόνο τους representatives.
      const EXCLUDED = new Set(["901067108914"]);
      const ws = await wallets();
      const members = (Array.isArray(ws) ? ws : []).filter((x) => x.hasIssuedCard && !x.isPrimary && x.friendlyName && x.friendlyName !== "ακυρο" && !EXCLUDED.has(String(x.walletId))).map((x) => String(x.walletId));
      const out = []; let scanned = 0;
      for (const wid of members) {
        const raw = await sbSelect("charges", `wallet_id=eq.${wid}&order=occurred_at.desc&limit=1000`);
        const ded = dedupCharges(raw || []);
        for (const c of ded) {
          if (!c.has_receipt || !c.project) continue;
          scanned++;
          // ΔΕΝ παρακάμπτουμε: το pushCharge επαληθεύει ότι το έξοδο υπάρχει ΟΝΤΩΣ στο Elorus
          // (πιάνει ορφανά αν διαγράφηκε) και είναι idempotent — δεν δημιουργεί ποτέ διπλό.
          const r = await pushCharge(c, nameByWallet);
          out.push({ id: c.id, ...r });
        }
      }
      const created = out.filter((x) => x.ok && !x.skipped).length;
      const attached = out.filter((x) => x.skipped === "attach-only").length;
      return res.status(200).json({ ok: true, scanned, created, attached, results: out });
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
    const r = await pushCharge(c, nameByWallet, {
      force: !!(body.force || q.force),
      allowDup: !!(body.allowDup || q.allowDup),
      supplierId: body.supplierId || q.supplierId,
      reference: body.reference || q.reference,
      descr: body.descr || q.descr,
      date: body.date || q.date,
    });
    if (!r.ok && !r.skipped) return res.status(400).json(r);
    return res.status(200).json(r);
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};
