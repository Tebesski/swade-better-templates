import {MODULE_ID, readAutomation, shapeButtonLabel, shapeTitle} from "./data.mjs";
import {castDefaults, chooseCastOptions, hasCastOptions, hasCastDamageAdjustments, projectCastDamage, projectCastTemplates} from "./variants.mjs";
import {placeTemplate} from "./region-handler.mjs";
import {castDamageModifiers, renderDamageAdjustments} from "./damage-chat.mjs";

const selections = new WeakMap();

export function castTemplateControls(item, message, castContext, card, rollDamage) {
  if (item?.type !== "power" || !message.isContentVisible || !item.testUserPermission(game.user, "LIMITED")) return null;
  const automation = readAutomation(item);
  if (!hasCastOptions(automation) || !automation.shapes.length) return null;
  let selected = selections.get(message) ?? message.getFlag(MODULE_ID, "castOptions");
  let choice = selected ?? castDefaults(automation, castContext);
  const group = document.createElement("div");
  group.className = "card-buttons template-controls sbt-cast-template-controls";
  const title = document.createElement("h4");
  title.className = "actions-subheading";
  title.innerHTML = '<i class="fa-solid fa-bullseye" aria-hidden="true"></i> ';
  title.append(game.i18n.localize("SWADE.Templates.Available"));
  const buttons = document.createElement("span");
  buttons.className = "flexrow";
  const settings = document.createElement("button");
  settings.type = "button";
  settings.textContent = "Cast options";
  let busy = false;
  const withButton = (button, action) => async event => {
    event.preventDefault();
    event.stopPropagation();
    if (busy || !message.isContentVisible) return;
    busy = true;
    button.disabled = true;
    try { await action(); }
    catch (error) { ui.notifications.error(error.message); }
    finally { busy = false; button.disabled = false; }
  };
  const damageButtons = [];
  const powerChanges = game.modules.get("swade-better-powers")?.api?.getPowerDamageChanges?.(message) ?? [];
  if (card && item.actor?.isOwner && hasCastDamageAdjustments(automation)) {
    for (const original of card.querySelectorAll(".damage-rolls button[data-action]")) {
      const action = original.dataset.action;
      const baseFormula = item.system.actions?.additional?.[action]?.override || item.system.damage;
      if (!baseFormula?.trim()) continue;
      // Native item cards attach listeners before the chat render hook runs.
      const button = original.cloneNode(true);
      button.dataset.sbtCastDamage = "";
      original.replaceWith(button);
      const resolve = () => projectCastDamage(automation, choice, baseFormula, item.actor, powerChanges);
      damageButtons.push({button, baseFormula, primary: action === "damage", resolve});
      button.addEventListener("click", withButton(button, async () => {
        if (!item.actor.isOwner || item.actor.items.get(item.id) !== item) return;
        if (!selected && automation.raises.length && !await choose()) return;
        const modifiers = castDamageModifiers(item, resolve());
        if (rollDamage) await rollDamage(action, modifiers);
        else await game.swade.itemChatCardHelper.handleAction(item, item.actor, action, {additionalMods: modifiers});
      }));
    }
  }

  function renderDamage() {
    if (!damageButtons.length) return;
    const primary = damageButtons.find(entry => entry.primary) ?? damageButtons[0];
    let rows = [];
    for (const entry of damageButtons) {
      let damage;
      try { damage = entry.resolve(); }
      catch { damage = {formula: entry.baseFormula, adjustments: []}; }
      if (entry.primary) entry.button.textContent = damage.formula;
      entry.button.title = damage.formula;
      if (entry === primary) rows = damage.adjustments;
    }
    renderDamageAdjustments(card, rows, {preview: true});
  }

  function renderButtons() {
    const seen = new Set();
    const nodes = [];
    for (const {baseShape, shape} of projectCastTemplates(automation, choice)) {
      if (seen.has(shape.key)) continue;
      seen.add(shape.key);
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.template = shape.preset;
      button.textContent = shapeButtonLabel(shape);
      button.title = shapeTitle(shape);
      button.addEventListener("click", withButton(button, async () => {
        if (!selected && automation.raises.length) {
          if (!await choose()) return;
          const result = projectCastTemplates(automation, choice).find(template => template.baseShape === baseShape);
          if (result?.shape.key !== shape.key) return;
        }
        await placeTemplate(item, baseShape, {castChoices: choice});
      }));
      nodes.push(button);
    }
    buttons.replaceChildren(...nodes, settings);
  }
  async function choose() {
    const next = await chooseCastOptions(automation, automation.label || item.name, null, {castContext, initialChoices: choice, forCard: true});
    if (!next) return false;
    choice = selected = next;
    renderButtons();
    renderDamage();
    if (message.isOwner) await message.setFlag(MODULE_ID, "castOptions", selected);
    else selections.set(message, selected);
    return true;
  }
  settings.addEventListener("click", withButton(settings, choose));
  group.append(title, buttons);
  renderButtons();
  renderDamage();
  return group;
}
