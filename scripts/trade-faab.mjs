// FAAB amounts for trades. ESPN doesn't record the dollars when a side gets FAAB instead of
// players, so Bryar tells us and they go in "tradeFaab" in data/league.json:
//   { "player": "Tre Tucker", "from": "The House Cats", "amount": 3 }
// meaning the trade that sent that player away from that team paid it $3 of FAAB.
// Marks each matching trade (and pending trade) with `faab`, the dollar amount.
export function addFaab(tradesData, league) {
  const notes = (league && league.tradeFaab) || [];
  if (!notes.length || !tradesData) return tradesData;
  for (const t of [...(tradesData.trades || []), ...(tradesData.pending || [])]) {
    const moved = (t.received || []).flatMap((r) => (r.players || []).map((p) => ({ name: String(p.player || "").replace(/ \([A-Z/]+\)$/, ""), from: p.from })));
    const note = notes.find((n) => moved.some((m) => m.name === n.player && (!n.from || m.from === n.from)));
    if (note && Number(note.amount) > 0) t.faab = Number(note.amount);
  }
  return tradesData;
}

// "$3 FAAB", or just "FAAB" when the amount isn't known
export const faabLabel = (t) => (t && t.faab ? `$${t.faab} FAAB` : "FAAB");
