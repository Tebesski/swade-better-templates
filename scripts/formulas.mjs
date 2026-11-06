export function traitKey(name) {
  return String(name ?? "").normalize("NFKC").trim().toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
}

const reference = /@([\p{L}\p{N}_]+(?:[-.][\p{L}\p{N}_]+)*)/gu;

export function expandTraitFormula(formula, actor, {validate = false, roll = false, preserveUnknown = false} = {}) {
  const traits = new Map();
  for (const [key, attribute] of Object.entries(actor?.system?.attributes ?? {})) traits.set(key, attribute.die);
  for (const skill of actor?.items ?? []) {
    if (skill.type !== "skill") continue;
    for (const key of [traitKey(skill.name), traitKey(skill.system.swid)]) {
      if (key && !traits.has(key)) traits.set(key, skill.system.die);
    }
  }
  let modifier = 0;
  const expression = String(formula).replace(reference, (match, key) => {
    if (roll && key.includes(".")) return match;
    if (validate) return "4";
    let die = traits.get(key.toLowerCase());
    let subtraction = "";
    // A trailing -number is subtraction when the full slug isn't a trait name.
    if (!die) {
      const suffix = key.match(/^(.+?)(-\d+(?:-\d+)*)$/);
      if (suffix) {
        die = traits.get(suffix[1].toLowerCase());
        subtraction = suffix[2];
      }
    }
    if (!Number.isFinite(Number(die?.sides))) {
      if (preserveUnknown) return match;
      throw new Error(`Unknown trait ${match} on ${actor?.name ?? "the placing actor"}.`);
    }
    modifier += Number(die.modifier) || 0;
    return String(die.sides) + subtraction;
  });
  return modifier ? `(${expression}) ${modifier < 0 ? "-" : "+"} ${Math.abs(modifier)}` : expression;
}

export function numericFormula(value, actor, {min = -Infinity, max = Infinity, validate = false, roundDown = true} = {}) {
  const expression = expandTraitFormula(value, actor, {validate}).trim().replaceAll("^", "**");
  if (!expression || !/^[\d\s.+*/%()-]+$/.test(expression) || /\/[/\*]/.test(expression)) throw new Error(`Invalid number formula: ${value}`);
  const number = Number(expression);
  const result = Number.isFinite(number) ? number : Roll.safeEval(expression);
  if (!Number.isFinite(result)) throw new Error(`Invalid number formula: ${value}`);
  return Math.min(max, Math.max(min, roundDown ? Math.floor(result) : result));
}

export function formulaResult(value, actor, {roundDown = true} = {}) {
  const number = Number(value);
  if (!String(value).trim() || Number.isFinite(number) && (!roundDown || Number.isInteger(number))) return "";
  try { return `= ${Number(numericFormula(value, actor, {roundDown}).toPrecision(12))}`; }
  catch { return ""; }
}
