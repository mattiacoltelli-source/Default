export function round3(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.round(value * 1000) / 1000;
}

/** xg90/xa90/npxg90 = valore/minuti*90, arrotondato a 3 decimali. null se minuti<=0 o valore assente. */
export function per90(value, minutes) {
  if (value === null || value === undefined || minutes === null || minutes === undefined || minutes <= 0) {
    return null;
  }
  return round3((value / minutes) * 90);
}
