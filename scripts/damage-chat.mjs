import {MODULE_ID} from "./data.mjs";
import {expandTraitFormula} from "./formulas.mjs";

const pending = new WeakMap();
const ADJUSTMENTS = "damageAdjustments";
const MARKER = "sbtDamageAdjustments";
const EXPLICIT_BONUS = "sbtExplicitBonusDice";

export function castDamageModifiers(item, damage) {
  const modifiers = [];
  if (damage.adjustments.length) pending.set(modifiers, {itemUuid: item.uuid, ...damage});
  return modifiers;
}

export function applyCastDamageOptions(item, options) {
  const damage = pending.get(options.additionalMods);
  if (!damage || damage.itemUuid !== item.uuid) return options;
  const expand = formula => expandTraitFormula(formula, item.actor, {roll: true, preserveUnknown: true});
  const formula = [expand(damage.base), ...damage.bonuses.map(bonus => `(${expand(bonus)})`)].join(" + ");
  return {...options, dmgOverride: formula, [MARKER]: damage};
}

export function registerDamageChat() {
  Hooks.once("setup", () => {
    const prototype = CONFIG.Dice.DamageRoll?.prototype;
    if (!prototype) return;
    const enableAcing = prototype._enableAcing;
    prototype._enableAcing = function (roll) {
      const bonuses = roll.terms.filter(term => term.options?.[EXPLICIT_BONUS]);
      if (!bonuses.length) return enableAcing.call(this, roll);
      // Keep SWADE's normal acing controls for the native base damage.
      const nestedRolls = bonuses.map(term => term.roll);
      for (const term of bonuses) term.roll = undefined;
      try { return enableAcing.call(this, roll); }
      finally { bonuses.forEach((term, index) => term.roll = nestedRolls[index]); }
    };
  });
  // SWADE rebuilds the confirmed roll with the original terms from the dialog.
  Hooks.on("swadeRollDamage", (_actor, _item, roll, _modifiers, options) => {
    const damage = options?.[MARKER];
    if (!damage?.adjustments.length || !roll.terms[0]) return;
    if (damage.bonuses.length) {
      // The first native roll already enabled acing. Restore the authored bonus terms.
      const authored = new Roll(options.dmgOverride, roll.data).terms;
      for (let offset = 1; offset < damage.bonuses.length * 2; offset += 2) {
        const bonus = authored.at(-offset);
        if (!(bonus instanceof foundry.dice.terms.ParentheticalTerm)) continue;
        (bonus.options ??= {})[EXPLICIT_BONUS] = true;
        roll.terms[roll.terms.length - offset] = bonus;
      }
      roll.resetFormula();
    }
    (roll.terms[0].options ??= {})[MARKER] = damage.adjustments;
  });
  Hooks.on("preCreateChatMessage", (message, _data, _options, userId) => {
    if (userId !== game.user.id || message.getFlag(MODULE_ID, ADJUSTMENTS)) return;
    const rows = message.rolls.find(roll => roll.terms[0]?.options?.[MARKER])?.terms[0].options[MARKER];
    if (rows?.length) message.updateSource({[`flags.${MODULE_ID}.${ADJUSTMENTS}`]: rows});
  });
  Hooks.on("renderChatMessageHTML", (message, html) => {
    if (message.isContentVisible) renderDamageAdjustments(html, message.getFlag(MODULE_ID, ADJUSTMENTS) ?? []);
  });
}

export function renderDamageAdjustments(root, rows, {preview = false} = {}) {
  const cssClass = preview ? "sbt-damage-preview" : "sbt-damage-adjustment";
  root.querySelectorAll(`.${cssClass}`).forEach(row => row.remove());
  let list = root.querySelector("details.modifiers .modifier-list");
  if (!rows.length) {
    if (list?.children.length === 0) list.closest("details.sbt-damage-modifiers")?.remove();
    return;
  }
  if (!list) {
    const details = document.createElement("details");
    details.className = "modifiers sbt-damage-modifiers";
    const summary = document.createElement("summary");
    summary.textContent = game.i18n.localize("SWADE.Modifiers");
    const content = document.createElement("span");
    content.className = "content";
    list = document.createElement("ul");
    list.className = "modifier-list";
    content.append(list);
    details.append(summary, content);
    (root.querySelector(".swade-roll-message") ?? root.querySelector(".message-content") ?? root).prepend(details);
  }
  for (const {source, label, before, after} of rows) {
    const row = document.createElement("li");
    row.className = cssClass;
    row.textContent = `${source}: ${label} (${before} → ${after})`;
    list.append(row);
  }
}
