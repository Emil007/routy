/** Abbreviate street-type tokens only (DE + EN) — not arbitrary trailing letters. */
export function abbreviateStreetTypes(full: string): string {
  if (!full) return full;

  // Lowercase for German compounds (Hauptstr., Kirchw.); English word rules keep title case.
  const suffixRules: [RegExp, string][] = [
    [/Stra(?:ß|ss)e$/i, "str."],
    [/Gasse$/i, "g."],
    [/Platz$/i, "pl."],
    [/Allee$/i, "al."],
    [/Weg$/i, "w."],
  ];

  const wordRules: [RegExp, string][] = [
    [/\bBoulevard\b/gi, "Blvd."],
    [/\bAvenue\b/gi, "Ave."],
    [/\bStreet\b/gi, "St."],
    [/\bRoad\b/gi, "Rd."],
    [/\bDrive\b/gi, "Dr."],
    [/\bLane\b/gi, "Ln."],
    [/\bCourt\b/gi, "Ct."],
    [/\bCircle\b/gi, "Cir."],
    [/\bTerrace\b/gi, "Ter."],
    [/\bPlace\b/gi, "Pl."],
    [/\bPath\b/gi, "P."],
    [/\bWay\b/gi, "W."],
  ];

  let out = full;
  for (const [pattern, replacement] of suffixRules) {
    out = out.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of wordRules) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
