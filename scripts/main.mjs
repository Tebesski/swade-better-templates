import {MODULE_ID, SUPPORTED_TYPES, SHAPES, shapeButtonLabel, itemTemplatePath, itemTemplateSelected, readAutomation, readCastAutomation, defaultAutomation, defaultBehavior, getRingTemplates} from "./data.mjs";
import {renderLibraryBehaviors, openBuilder, syncBuilderShapes, syncBuilderModifiers} from "./builder.mjs";
import {TemplatesLibrary, trustAutomation} from "./library.mjs";
import {effectCatalog, traitCatalog, flagCatalog, pickEffect} from "./integrations.mjs";
import {buildBehaviorData, registerBehaviorModel, registerRuntimeHooks, dispatchRegionEvent, isActiveGM, initializeInsideTokens, cleanupRemovedNotes} from "./runtime.mjs";
import {applyRegionAutomation, deleteManagedRegion, placeTemplate, registerRegionHooks, sweepExpiration} from "./region-handler.mjs";
import {restoreTrackedRegions, registerTrackerCleanup} from "./tracker.mjs";
import {registerTileMasks} from "./tile-mask.mjs";
import {castTemplateControls} from "./cast-card.mjs";
import {projectDamageChanges} from "./variants.mjs";
import {castDamageModifiers, renderDamageAdjustments} from "./damage-chat.mjs";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "trustedCode", {scope: "world", config: false, type: Array, default: []});
  game.settings.registerMenu(MODULE_ID, "templates", {name: "Templates Compendium", label: "Open Better Templates", hint: "Browse and place reusable SWADE template automations.", icon: "fa-solid fa-book-open", type: TemplatesLibrary, restricted: false});
  registerBehaviorModel(); registerRuntimeHooks(); registerRegionHooks(); registerTrackerCleanup(); registerTileMasks();
  game.modules.get(MODULE_ID).api = Object.freeze({openBuilder, renderLibraryBehaviors, openTemplates: () => new TemplatesLibrary().render({force: true}),
    readAutomation, readCastAutomation, defaultAutomation, defaultBehavior, buildBehaviorData, placeTemplate, getRingTemplates, castTemplateControls, applyRegionAutomation,
    deleteManagedRegion, dispatchRegionEvent, sweepExpiration, effectCatalog, traitCatalog, flagCatalog, pickEffect, trustAutomation,
    projectDamageChanges, castDamageModifiers, renderDamageAdjustments});
});

function injectBuilder(app, html) {
  const item = app.document ?? app.item;
  if (item?.documentName !== "Item" || !SUPPORTED_TYPES.has(item.type) || !item.isOwner) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".sbt-open-builder")) return;
  let templates = root.querySelector(".templates");
  const nativeOptions = !!templates;
  // Gear sheets in SWADE 6 omit Possible Templates.
  if (!templates && item.type === "gear") {
    const anchor = root.querySelector('section[data-tab="properties"]');
    if (anchor) {
      templates = document.createElement("div"); templates.className = "templates";
      templates.innerHTML = `<hr><h4>${game.i18n.localize("SWADE.Templates.Possible")}</h4><div class="column-grid three-columns"></div>`;
      anchor.append(templates);
    }
  }
  if (!templates) return;
  const grid = templates.querySelector(".column-grid");
  for (const shape of SHAPES) {
    if (nativeOptions && shape.type !== "ring") continue;
    const path = itemTemplatePath(item, shape);
    if (!grid || !path) continue;
    const option = document.createElement("div");
    option.className = "form-group";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = path;
    checkbox.id = `${app.id}-${shape.key}`;
    checkbox.checked = itemTemplateSelected(item, shape);
    const label = document.createElement("label");
    label.htmlFor = checkbox.id;
    label.textContent = shape.label;
    option.append(checkbox, label);
    grid.append(option);
  }
  const button = document.createElement("button"); button.type = "button"; button.className = "sbt-open-builder";
  button.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Better Templates';
  button.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); openBuilder(item); });
  templates.append(button);
}
Hooks.on("renderApplicationV2", injectBuilder);
Hooks.on("renderItemSheet", injectBuilder);
Hooks.on("preUpdateItem", (item, changes) => {
  const fields = SHAPES.map(shape => [shape, itemTemplatePath(item, shape)]).filter(([, path]) => path);
  if (!fields.length) return;
  const delta = foundry.utils.expandObject(changes);
  const automationPath = `flags.${MODULE_ID}.automation.shapes`;
  const shapes = foundry.utils.getProperty(delta, automationPath);
  if (Array.isArray(shapes)) {
    for (const [shape, path] of fields) {
      if (foundry.utils.getProperty(delta, path) === undefined) foundry.utils.setProperty(changes, path, shapes.includes(shape.key));
    }
    return;
  }
  if (!item.getFlag(MODULE_ID, "automation") || !fields.some(([, path]) => foundry.utils.getProperty(delta, path) !== undefined)) return;
  const selected = fields.filter(([shape, path]) => foundry.utils.getProperty(delta, path) ?? itemTemplateSelected(item, shape)).map(([shape]) => shape.key);
  foundry.utils.setProperty(changes, automationPath, selected);
});
Hooks.on("updateItem", (item, changes) => {
  const delta = foundry.utils.expandObject(changes);
  const shapeChanged = SHAPES.some(shape => {
    const path = itemTemplatePath(item, shape);
    return path && foundry.utils.getProperty(delta, path) !== undefined;
  });
  if (shapeChanged || foundry.utils.getProperty(delta, `flags.${MODULE_ID}.automation.shapes`)) syncBuilderShapes(item);
  if (["modifiers", "raises"].some(field => Array.isArray(foundry.utils.getProperty(delta, `flags.${MODULE_ID}.automation.${field}`)))) syncBuilderModifiers(item);
});
function addRingButtons(card, item) {
  if (!card || !item?.testUserPermission(game.user, "LIMITED") || card.querySelector(".sbt-ring-buttons")) return;
  const rings = getRingTemplates(item);
  if (!rings.length) return;
  let controls = card.querySelector(".template-controls, .card-buttons.templates, .sbs-power-actions");
  if (!controls) {
    controls = document.createElement("div");
    controls.className = "card-buttons template-controls";
    const heading = document.createElement("h4");
    heading.className = "actions-subheading";
    heading.textContent = game.i18n.localize("SWADE.Templates.Available");
    controls.append(heading);
    card.append(controls);
  }
  const buttons = document.createElement("span");
  buttons.className = "sbt-ring-buttons flexrow";
  for (const ring of rings) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = ring.label;
    button.addEventListener("click", event => {
      event.stopPropagation();
      placeTemplate(item, ring.key).catch(error => ui.notifications.error(error.message));
    });
    buttons.append(button);
  }
  controls.append(buttons);
}
Hooks.on("renderApplicationV2", (app, html) => {
  const actor = app.document ?? app.actor;
  if (actor?.documentName !== "Actor" || !(html instanceof HTMLElement)) return;
  for (const card of html.querySelectorAll(".swade.item-card[data-item-id], .sbs-power-card[data-item-id]")) {
    addRingButtons(card, actor.items.get(card.dataset.itemId));
  }
});
Hooks.on("renderChatMessageHTML", (message, html) => {
  const card = html.querySelector(".swade.item-card[data-item-uuid]");
  const cast = game.modules.get("swade-better-powers")?.api?.getCastContext?.(message);
  const hudCard = game.modules.get("swade-hud")?.active && message.flags?.["swade-hud"]?.powerCast;
  if (cast && !hudCard && !card && (game.user.isGM || message.isAuthor)) {
    const power = foundry.utils.fromUuidSync(cast.itemUuid);
    if (power?.actor?.isOwner) {
      const controls = castTemplateControls(power, message, cast);
      if (controls) html.querySelector(".message-content")?.append(controls);
    }
  }
  const itemUuid = message.getFlag("swade", "item") ?? message.getFlag("swade", "itemUuid") ?? html.querySelector("[data-item-uuid]")?.dataset.itemUuid;
  if (!itemUuid) return;
  const item = foundry.utils.fromUuidSync(itemUuid);
  if (game.user.isGM || message.isAuthor || item?.actor?.isOwner) {
    const controls = card && !hudCard ? castTemplateControls(item, message, cast, card) : null;
    const previous = card?.querySelector(".template-controls");
    if (controls && previous) previous.replaceWith(controls);
    else if (controls) card.append(controls);
    else {
      for (const button of previous?.querySelectorAll("button[data-template]") ?? []) {
        const shape = SHAPES.find(entry => entry.preset === button.dataset.template);
        if (shape) button.textContent = shapeButtonLabel(shape);
      }
      addRingButtons(card, item);
    }
  }
  if (item?.type === "power" || !item?.getFlag(MODULE_ID, "automation") || !readAutomation(item).enabled || html.querySelector(".sbt-chat-place")) return;
  const button = document.createElement("button"); button.className = "sbt-chat-place"; button.type = "button"; button.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> Better Templates';
  button.addEventListener("click", () => placeTemplate(item).catch(error => ui.notifications.error(error.message)));
  html.querySelector(".message-content")?.append(button);
});
Hooks.once("ready", async () => {
  if (game.system.id !== "swade") return;
  restoreTrackedRegions();
  if (isActiveGM()) {
    // Recover templates placed before a GM connected, and clean interrupted configuration sessions.
    for (const scene of game.scenes) {
      for (const region of scene.regions) {
        try {
          const managed = region.getFlag(MODULE_ID, "managed");
          if (managed?.resolvedAutomation?.expiration?.removeOnPlacement) { await deleteManagedRegion(region.uuid); continue; }
          if (managed) { await cleanupRemovedNotes(region); await initializeInsideTokens(region); continue; }
          const origin = region.getFlag("swade", "origin");
          if (!origin) continue;
          const item = await fromUuid(origin);
          if (item) await applyRegionAutomation(region, item, region.getFlag(MODULE_ID, "placement")?.userId ?? game.user.id);
        } catch (error) { console.error(`${MODULE_ID} | Restore`, error); }
      }
    }
    const scratch = game.items.filter(item => item.getFlag(MODULE_ID, "scratch"));
    if (scratch.length) await Item.deleteDocuments(scratch.map(i => i.id));
    for (const scene of game.scenes) for (const name of ["AmbientLight", "AmbientSound", "Tile", "Wall"]) {
      const ids = scene.getEmbeddedCollection(name).filter(doc => doc.getFlag(MODULE_ID, "scratch")).map(d => d.id);
      if (ids.length) await scene.deleteEmbeddedDocuments(name, ids);
    }
    await sweepExpiration();
  }
});
