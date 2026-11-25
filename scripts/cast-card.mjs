import {t as sbsI18n} from "./i18n.mjs";
import {MODULE_ID, readCastAutomation, shapeButtonLabel, shapeTitle} from "./data.mjs";
import {castDefaults, chooseCastOptions, hasCastDamageAdjustments, projectCastDamage, projectCastTemplates} from "./variants.mjs";
import {placeTemplate} from "./region-handler.mjs";
import {castDamageModifiers, renderDamageAdjustments} from "./damage-chat.mjs";

const selections = new WeakMap();
export const getChatCastOptions = message => selections.get(message) ?? message.getFlag(MODULE_ID, "castOptions");

export function getChatDamagePlan(item, message, base, powerChanges, castContext) {
  const automation = readCastAutomation(item);
  if (!automation.enabled) return projectCastDamage({...automation, raises: [], modifiers: []}, {}, base, item.actor, powerChanges);
  const choice = getChatCastOptions(message) ?? castDefaults(automation, castContext);
  return projectCastDamage(automation, choice, base, item.actor, powerChanges);
}

export function castTemplateControls(item, message, castContext, card, rollDamage) {
  if (item?.type !== "power" || !message.isContentVisible || !item.testUserPermission(game.user, "LIMITED")) return null;
  const automation = readCastAutomation(item);
  const powers = game.modules.get("swade-better-powers")?.api;
  const damageRaises = powers?.getPowerDamageRaiseLevels?.(message) ?? [];
  const hasTemplates = automation.enabled && automation.shapes.length > 0;
  if (!hasTemplates && !damageRaises.length) return null;
  let selected = getChatCastOptions(message);
  let choice = selected ?? castDefaults(automation, castContext);
  const defaultDamageRaise = damageRaises.findLast(level => level <= (castContext?.raises ?? 0));
  const group = document.createElement("div");
  group.className = "card-buttons sbt-cast-template-controls";
  if (hasTemplates) group.classList.add("template-controls");
  const title = document.createElement("h4");
  title.className = "actions-subheading";
  title.innerHTML = `<i class="fa-solid fa-bullseye" aria-hidden="true"></i> `;
  title.append(game.i18n.localize("SWADE.Templates.Available"));
  const buttons = document.createElement("span");
  buttons.className = "flexrow";
  const settings = document.createElement("button");
  settings.type = "button";
  settings.dataset.sbtCastOptions = "true";
  settings.textContent = sbsI18n("swade-better-templates.UI.Castoptions_da78c6f720");
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
  const powerChanges = () => powers?.getPowerDamageChanges?.(message, selected?.raise) ?? [];
  const templateDamage = hasTemplates && hasCastDamageAdjustments(automation);
  if (card && item.actor?.isOwner && (templateDamage || damageRaises.length || powerChanges().length)) {
    for (const original of card.querySelectorAll(".damage-rolls button[data-action]")) {
      const action = original.dataset.action;
      const baseFormula = item.system.actions?.additional?.[action]?.override || item.system.damage;
      if (!baseFormula?.trim()) continue;
      // Native item cards attach listeners before the chat render hook runs.
      const button = original.cloneNode(true);
      button.dataset.sbtCastDamage = "";
      original.replaceWith(button);
      const resolve = () => projectCastDamage(automation, templateDamage ? choice : {}, baseFormula, item.actor, powerChanges());
      damageButtons.push({button, baseFormula, primary: action === "damage", resolve});
      button.addEventListener("click", withButton(button, async () => {
        if (!item.actor.isOwner || item.actor.items.get(item.id) !== item) return;
        if (!selected && templateDamage && automation.raises.length && !await choose()) return;
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
    for (const {baseShape, shape} of hasTemplates ? projectCastTemplates(automation, choice) : []) {
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
        await placeTemplate(item, baseShape, {castChoices: choice, chatMessageId: message.id});
      }));
      nodes.push(button);
    }
    buttons.replaceChildren(...nodes, settings);
  }
  async function choose() {
    const initialChoices = selected ?? {...choice, raise: Math.max(choice.raise, defaultDamageRaise ?? 0)};
    const next = await chooseCastOptions(automation, automation.label || item.name, null, {castContext, initialChoices, forCard: true, item, damageRaises});
    if (!next) return false;
    choice = selected = next;
    renderButtons();
    renderDamage();
    if (message.isOwner) await message.setFlag(MODULE_ID, "castOptions", selected);
    else selections.set(message, selected);
    group.closest(".message-content")?.dispatchEvent(new Event("sbtCastOptionsChange"));
    return true;
  }
  settings.addEventListener("click", withButton(settings, choose));
  if (hasTemplates) group.append(title);
  group.append(buttons);
  renderButtons();
  renderDamage();
  return group;
}
