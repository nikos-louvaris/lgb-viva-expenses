// Viva webhook endpoint — Account Transaction Created (EventTypeId 2054)
// GET  → επαλήθευση από Viva (επιστρέφουμε το Key)
// POST → νέα κίνηση· κρατάμε μόνο αγορές με κάρτα (SubTypeId 100/104)
const { webhookKey, sbInsert } = require("./_viva.js");

const CARD_PURCHASE = new Set([100, 104]);

module.exports = async (req, res) => {
  try {
    if (req.method === "GET") {
      const k = await webhookKey();
      return res.status(200).json(k);
    }
    if (req.method !== "POST") return res.status(405).end();

    const body = req.body || {};
    const e = body.EventData;
    if (!e || body.EventTypeId !== 2054 || !CARD_PURCHASE.has(e.SubTypeId)) {
      return res.status(200).json({ ignored: true });
    }
    const charge = {
      viva_tx_id: e.WalletTransactionId,
      wallet_id: e.WalletId,
      amount: Math.abs(e.Amount),
      merchant: e.Description || "",
      card_number: e.CardNumber || null,
      occurred_at: e.Created,
      has_receipt: false,
      comment: "",
      project: null,
      status: "MISSING_ALL",
      raw: e,
    };
    const r = await sbInsert("charges", charge);
    console.log("charge stored", charge.viva_tx_id, r);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("webhook error", err);
    // 200 για να μην κάνει retry-spam η Viva σε δικό μας bug· το log μένει
    return res.status(200).json({ error: String(err.message || err) });
  }
};
