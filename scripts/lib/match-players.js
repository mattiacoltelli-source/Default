/**
 * Normalizzazione e matching nomi Understat <-> Transfermarkt, sempre
 * ristretto alla stessa squadra canonica (mai un match globale per nome,
 * per evitare falsi positivi tra giocatori omonimi di squadre diverse).
 */

export function normalizeName(name) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.\-']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(s) {
  const grams = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  return grams;
}

/** Dice coefficient su bigrammi di caratteri: 1 = identici, 0 = nessuna sovrapposizione. */
export function diceCoefficient(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let intersection = 0;
  for (const [g, count] of ga) {
    if (gb.has(g)) intersection += Math.min(count, gb.get(g));
  }
  const total = [...ga.values()].reduce((s, v) => s + v, 0) + [...gb.values()].reduce((s, v) => s + v, 0);
  return total === 0 ? 0 : (2 * intersection) / total;
}

function lastToken(normalized) {
  const parts = normalized.split(" ").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

const FUZZY_THRESHOLD = 0.85;

/**
 * Fa il matching tra i giocatori Understat e Transfermarkt di UNA squadra.
 * @param {{understat_id: string, name: string}[]} understatPlayers
 * @param {{transfermarkt_id: string, name: string}[]} transfermarktPlayers
 * @returns {{matches: Array, unmatchedTransfermarkt: Array, unmatchedUnderstat: Array}}
 */
export function matchTeamPlayers(understatPlayers, transfermarktPlayers) {
  const uPool = understatPlayers.map((p) => ({ ...p, _norm: normalizeName(p.name) }));
  const tPool = transfermarktPlayers.map((p) => ({ ...p, _norm: normalizeName(p.name) }));

  const matches = [];
  const usedU = new Set();
  const usedT = new Set();

  // 1) match esatto
  for (const t of tPool) {
    if (usedT.has(t.transfermarkt_id)) continue;
    const u = uPool.find((u) => !usedU.has(u.understat_id) && u._norm === t._norm);
    if (u) {
      matches.push({ transfermarkt_id: t.transfermarkt_id, understat_id: u.understat_id, confidence: "high", score: 1 });
      usedU.add(u.understat_id);
      usedT.add(t.transfermarkt_id);
    }
  }

  // 2) fuzzy match (bigram dice, soglia 0.85), greedy sul punteggio migliore
  const candidates = [];
  for (const t of tPool) {
    if (usedT.has(t.transfermarkt_id)) continue;
    for (const u of uPool) {
      if (usedU.has(u.understat_id)) continue;
      const score = diceCoefficient(t._norm, u._norm);
      if (score >= FUZZY_THRESHOLD) candidates.push({ t, u, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  for (const { t, u, score } of candidates) {
    if (usedT.has(t.transfermarkt_id) || usedU.has(u.understat_id)) continue;
    matches.push({ transfermarkt_id: t.transfermarkt_id, understat_id: u.understat_id, confidence: "medium", score });
    usedU.add(u.understat_id);
    usedT.add(t.transfermarkt_id);
  }

  // 3) fallback solo-cognome, solo se univoco su entrambi i lati residui
  const remainingT = tPool.filter((t) => !usedT.has(t.transfermarkt_id));
  const remainingU = uPool.filter((u) => !usedU.has(u.understat_id));
  for (const t of remainingT) {
    const tSurname = lastToken(t._norm);
    const uCandidates = remainingU.filter((u) => !usedU.has(u.understat_id) && lastToken(u._norm) === tSurname && tSurname.length >= 3);
    if (uCandidates.length === 1) {
      const u = uCandidates[0];
      matches.push({ transfermarkt_id: t.transfermarkt_id, understat_id: u.understat_id, confidence: "low", score: null });
      usedU.add(u.understat_id);
      usedT.add(t.transfermarkt_id);
    }
  }

  const unmatchedTransfermarkt = tPool.filter((t) => !usedT.has(t.transfermarkt_id)).map((t) => ({ transfermarkt_id: t.transfermarkt_id, name: t.name }));
  const unmatchedUnderstat = uPool.filter((u) => !usedU.has(u.understat_id)).map((u) => ({ understat_id: u.understat_id, name: u.name }));

  return { matches, unmatchedTransfermarkt, unmatchedUnderstat };
}
