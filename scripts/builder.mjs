import {MODULE_ID, CATALOG, CAST_CATALOG, CAST_CHANGES, SHAPES, shapeTitle, TRIGGERS, TIME_UNITS, BEHAVIOR_TARGETS, clone, configuredBehaviors, defaultBehavior, defaultCostOption, escapeHTML as E, getPath, itemTemplatePath, movementTypes, setPath, readAutomation, normalizeAutomation, mergeModifierDraft, mergeRaiseDraft, exportAutomation, importAutomation, id, variantFields, variantOperations, variantLists} from "./data.mjs";
import {editAegis, editSceneObject, effectPreview, effectsAPI, flagCatalog, pickEffect, pickTrait, pickRestrictedTrait, traitCatalog} from "./integrations.mjs";
import {expandTraitFormula, formulaResult, numericFormula} from "./formulas.mjs";
import {saveToCompendium, chooseCompendiumTemplate, trustAutomation} from "./library.mjs";
import {sourceToken} from "./region-handler.mjs";

const Base = foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2);
const opened = new Map();
const options = (entries, selected) => entries.map(([key, label]) => `<option value="${E(key)}" ${String(key) === String(selected) ? "selected" : ""}>${E(label)}</option>`).join("");
const input = (path, value, type = "text", attrs = "") => `<input type="${type}" data-path="${E(path)}" ${type === "checkbox" ? value ? "checked" : "" : `value="${E(value)}"`} ${attrs}>`;
const check = (path, value, label, attrs = "") => `<label class="sbt-checkbox-label">${input(path, value, "checkbox", attrs)}<span>${label}</span></label>`;
const formulaInput = (path, value, attrs) => `${input(path, value, "text", `data-formula-preview ${attrs}`)}<output class="sbt-formula-result" hidden></output>`;
const numberInput = (path, value, attrs = "") => formulaInput(path, value, `data-formula title="Number or formula such as @spirit/2" ${attrs}`);
const units = Object.keys(TIME_UNITS).map(unit => [unit, unit.charAt(0).toUpperCase() + unit.slice(1)]);
const row = (label, content) => `<div class="sbt-row"><span class="sbt-row-label">${label}</span>${content}</div>`;
const accordion = (key, title, content, open, attrs = "") => `<div class="sbt-section sbt-accordion ${open ? "" : "sbt-accordion-collapsed"}" data-accordion="${key}" ${attrs}><a class="sbt-accordion-header" data-action="accordion" aria-expanded="${open}"><i class="fa-solid fa-chevron-down sbt-accordion-chevron"></i><span class="sbt-accordion-title">${title}</span></a><div class="sbt-accordion-body">${content}</div></div>`;
const action = (name, icon, title, attrs = "") => `<a data-action="${name}" title="${E(title)}" aria-label="${E(title)}" ${attrs}><i class="fa-solid ${icon}"></i></a>`;

export function openBuilder(item, {modifierId} = {}) {
  if (!item?.isOwner) return ui.notifications.warn("You need ownership to configure this automation.");
  const existing = opened.get(item.uuid);
  if (existing) {
    if (existing.rendered) existing.capture();
    existing.accordions.clear();
    existing.openBehaviors.clear();
  }
  const app = existing ?? new BetterTemplatesBuilder(item);
  if (modifierId) {
    const index = app.draft.modifiers.findIndex(row => row.id === modifierId);
    app.accordions.add("modifiers");
    if (index >= 0) app.accordions.add(`modifiers.${index}`);
  }
  opened.set(item.uuid, app);
  app.render({force: true});
  if (existing) app.bringToFront();
  return app;
}
export function renderLibraryBehaviors(host, modifier, optionId, onSave) {
  const option = modifier.options.find(row => row.id === optionId);
  if (!option) return;
  new LibraryTemplateBehaviors(host, {...modifier, options: [option]}, onSave).render();
}

export function syncBuilderShapes(item) {
  const app = opened.get(item.uuid);
  if (!app?.rendered) return;
  const shapes = readAutomation(item).shapes;
  if (shapes.length === app.draft.shapes.length && shapes.every(shape => app.draft.shapes.includes(shape))) return;
  app.capture();
  app.draft.shapes = shapes;
  void app.render();
}
export function syncBuilderModifiers(item) {
  const app = opened.get(item.uuid);
  if (!app?.rendered || app.dirty) return;
  app.draft = readAutomation(item);
  app.savedModifiers = clone(app.draft.modifiers);
  app.savedRaises = clone(app.draft.raises);
  void app.render();
}
Hooks.on("controlToken", () => {
  for (const app of opened.values()) if (app.rendered && !app.item.actor) app.refreshFormulaPreviews();
});
export class BetterTemplatesBuilder extends Base {
  constructor(item) { super(); this.item = item; this.draft = readAutomation(item); this.savedModifiers = clone(this.draft.modifiers); this.savedRaises = clone(this.draft.raises); this.accordions = new Set(); this.openBehaviors = new Set(); this.traits = []; this.dirty = false; }
  static DEFAULT_OPTIONS = {tag: "form", classes: ["sbt-builder"], position: {width: 680, height: 780}, window: {title: "Better Templates", icon: "fa-solid fa-wand-magic-sparkles", resizable: true},
    form: {closeOnSubmit: false, handler: async function () { await this.save(); }},
    actions: Object.fromEntries(["save", "saveClose", "place", "export", "import", "saveCompendium", "importCompendium", "saveModifierToLibrary", "accordion", "addBehavior", "collapseBehavior", "deleteBehavior", "duplicateBehavior", "moveUp", "moveDown", "pickEffect", "pickTrait", "pickRestriction", "removeRestriction", "configureRequest", "aegis", "deleteEffect", "editEffect", "file", "configure", "addVariant", "deleteVariant", "deleteLegacyChange", "addModifierOption", "deleteCostOption"].map(name => [name, async function (event, target) {
      try { await this.handleAction(name, event, target); } catch (error) { console.error(`${MODULE_ID} | Builder`, error); ui.notifications.error(error.message); }
    }]))};
  static PARTS = {body: {template: `modules/${MODULE_ID}/templates/builder.hbs`, scrollable: [""]}};
  get title() { return `Better Templates: ${this.item.name}${this.dirty ? " *" : ""}`; }
  get setting() { return game.modules.get("swade-better-setting")?.api; }
  get isLibraryEditor() { return false; }
  get formulaActor() { return this.item.actor ?? (canvas.ready ? sourceToken(this.item, canvas.scene)?.actor : null); }
  async _prepareContext() {
    return {content: this.renderContent()};
  }
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.traits = await traitCatalog();
    if (this.rendered) this.updateDatalists();
  }
  _onRender(context, options) {
    super._onRender(context, options);
    this.bindEditor(this.element.querySelector(".sbt-tab"));
  }
  bindEditor(body) {
    body.addEventListener("change", event => {
      if (!event.target.matches("[data-path], [data-shape], [data-trigger], [data-movement]")) return;
      try {
        this.capture(); this.dirty = true;
        if (event.target.hasAttribute("data-variant-name")) {
          const card = event.target.closest("[data-variant-index]");
          const [list, index] = card.dataset.accordion.split(".");
          const title = card.querySelector(".sbt-accordion-title");
          const handle = title.querySelector("[data-sbt-modifier-drag]");
          title.textContent = this.variantTitle(list, this.draft[list][index], Number(index));
          if (handle) title.prepend(handle, " ");
        }
        if (event.target.matches("[data-effect-reference]")) this.refreshEffectPreview(event.target);
        if (event.target.hasAttribute("data-variant-control")) {
          const change = getPath(this.draft, event.target.closest("[data-legacy-path]").dataset.legacyPath);
          const fields = variantFields(this.draft, change.target);
          if (event.target.dataset.variantControl === "target") change.field = "";
          change.operation = "set";
          change.value = fields.find(field => field.key === change.field)?.default ?? "";
          this.render();
        } else if (event.target.matches('[data-shape], [data-path="expiration.enabled"], [data-path="expiration.currentTurnEnd"], [data-path="expiration.removeOnPlacement"], [data-path="advanced.enabled"], [data-path="separateRegions.enabled"], [data-path="wallRestriction.enabled"], [data-path="placementRange.enabled"], [data-path$=".duration.enabled"], [data-path^="raises."][data-path$=".mode"]')) this.render();
        else if (this.isLibraryEditor) this.persistChanges();
      } catch (error) { ui.notifications.error(error.message); }
    });
    body.addEventListener("input", event => {
      if (event.target.closest?.("[data-path]")) this.dirty = true;
      if (event.target.matches('[data-kind="flags"]')) this.updateDatalists(event.target);
      if (event.target.matches("[data-formula-preview]")) this.refreshFormulaPreview(event.target, this.formulaActor);
    });
    const canImportModifiers = !this.isLibraryEditor && this.item.type === "power";
    body.addEventListener("dragstart", event => {
      const handle = event.target.closest("[data-sbt-modifier-drag]");
      if (handle) this.setting.writeModifierDrag(event, "power", handle.dataset.sbtModifierDrag, this.item.uuid);
    });
    body.addEventListener("dragover", event => {
      if (canImportModifiers && this.setting.hasModifierDrag(event)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      } else if (event.target.closest('[data-kind="uuid"], [data-kind="trait"], [data-kind="flags"]')) event.preventDefault();
    });
    body.addEventListener("drop", async event => {
      if (canImportModifiers && this.setting.hasModifierDrag(event)) {
        event.preventDefault();
        const drop = this.setting.readModifierDrag(event);
        if (drop?.source !== "library" || !drop.id) return;
        try {
          if (this.dirty) await this.save();
          await this.setting.applyLibraryModifier(this.item, drop.id);
        } catch (error) { ui.notifications.error(error.message); }
        return;
      }
      const target = event.target.closest('[data-kind="uuid"], [data-kind="trait"], [data-kind="flags"]');
      if (!target) return;
      event.preventDefault();
      try {
        const data = JSON.parse(event.dataTransfer.getData("text/plain"));
        if (!data.uuid) return;
        const doc = await fromUuid(data.uuid);
        target.value = target.dataset.kind === "trait" ? doc.name : target.dataset.kind === "flags" ? effectsAPI()?.getFlags(doc)?.join(", ") ?? doc.name : data.uuid;
        this.capture(); this.dirty = true;
        if (target.matches("[data-effect-reference]")) this.refreshEffectPreview(target);
        if (this.isLibraryEditor) this.persistChanges();
      } catch (error) { ui.notifications.warn(`Could not insert dropped document: ${error.message}`); }
    });
    this.updateDatalists();
    this.refreshFormulaPreviews();
    for (const el of body.querySelectorAll("[data-effect-reference]")) this.refreshEffectPreview(el);
  }
  refreshFormulaPreviews() {
    const actor = this.formulaActor;
    for (const input of this.element.querySelectorAll("[data-formula-preview]")) this.refreshFormulaPreview(input, actor);
  }
  refreshFormulaPreview(input, actor) {
    const output = input.nextElementSibling;
    output.value = formulaResult(input.value, actor, {roundDown: !input.hasAttribute("data-fractional")});
    output.hidden = !output.value;
  }
  async refreshEffectPreview(input) {
    const reference = input.value;
    const preview = input.parentElement.querySelector(".sbt-effect-preview");
    const effect = await effectPreview(reference);
    if (!input.isConnected || input.value !== reference) return;
    preview.hidden = !effect?.img && !effect?.icon;
    if (!preview.hidden) {
      preview.src = effect.img ?? effect.icon;
      preview.alt = game.i18n.localize(effect.name ?? effect.label ?? "");
      preview.title = preview.alt;
    }
  }
  updateDatalists(active = null) {
    const flags = this.element.querySelector(`#${this.id}-flags`);
    if (flags) {
      const parts = (active?.value ?? "").split(","); parts.pop(); const prefix = parts.map(v => v.trim()).filter(Boolean).join(", ");
      flags.innerHTML = flagCatalog().map(flag => `<option value="${E(prefix ? `${prefix}, ${flag}` : flag)}"></option>`).join("");
    }
    const traits = this.element.querySelector(`#${this.id}-traits`);
    if (traits) traits.innerHTML = this.traits.map(trait => `<option value="${E(trait.value)}">${E(trait.name)}</option>`).join("");
  }
  capture() {
    for (const el of this.element.querySelectorAll("[data-path]")) {
      let value = el.type === "checkbox" ? el.checked : el.hasAttribute("data-duration-amount") ? el.valueAsNumber
        : el.dataset.numeric !== undefined || el.type === "number" ? Number(el.value) : el.value;
      if (el.dataset.formula !== undefined && value.trim() && Number.isFinite(Number(value))) value = Number(value);
      if (el.dataset.json !== undefined) { try { value = JSON.parse(value); } catch { throw new Error("Enter valid JSON in the configuration field."); } }
      setPath(this.draft, el.dataset.path, value);
    }
    this.draft.shapes = [...this.element.querySelectorAll("[data-shape]:checked")].map(el => el.dataset.shape);
    for (const row of this.element.querySelectorAll("[data-behavior-path]")) {
      const entry = getPath(this.draft, row.dataset.behaviorPath);
      if (row.querySelector("[data-trigger]")) entry.triggers = [...row.querySelectorAll("[data-trigger]:checked")].map(el => el.value);
      if (entry.type === "difficultTerrain") entry.system.actions = [...row.querySelectorAll("[data-movement]:checked")].map(el => el.value);
    }
  }
  renderContent() {
    const a = this.draft;
    const expDisabled = !a.expiration.enabled || a.expiration.currentTurnEnd;
    const disabled = value => value ? "disabled" : "";
    const modifiers = this.renderVariants("modifiers", "Modifiers");
    const footer = `<footer class="sbt-builder-footer"><button type="button" data-action="place"><i class="fa-solid fa-location-crosshairs"></i> Place template</button><button type="button" data-action="save"><i class="fa-solid fa-floppy-disk"></i> Save</button><button type="button" data-action="saveClose"><i class="fa-solid fa-check"></i> Save & Close</button></footer>
      <datalist id="${this.id}-flags"></datalist><datalist id="${this.id}-traits"></datalist>`;
    return `<section class="sbt-section">
      <div class="sbt-row sbt-row-actions"><a data-action="export"><i class="fa-solid fa-file-export"></i> Export</a><a data-action="import"><i class="fa-solid fa-file-import"></i> Import</a></div>
      <div class="sbt-row sbt-row-actions"><a data-action="saveCompendium"><i class="fa-solid fa-bookmark"></i> Save to Templates Compendium</a><a data-action="importCompendium"><i class="fa-solid fa-book-open"></i> Import from Templates Compendium</a></div>
      <div class="sbt-row sbt-row-toggle">${check("enabled", a.enabled, "Enable automation")}</div>
      ${row("Label", input("label", a.label, "text", `placeholder="${E(this.item.name)}"`))}
      <div class="sbt-row">${check("placementRange.enabled", a.placementRange.enabled, 'Max placement range (″)')}${numberInput("placementRange.max", a.placementRange.max, disabled(!a.placementRange.enabled))}</div>
      <div class="sbt-row sbt-shape-row"><span class="sbt-row-label">Shape</span><div class="sbt-shape-options">${SHAPES.map(shape => `<label class="sbt-checkbox-label"><input type="checkbox" data-shape="${shape.key}" ${a.shapes.includes(shape.key) ? "checked" : ""}><span>${shape.label}</span></label>`).join("")}</div></div>
    </section>
    <fieldset class="sbt-section"><legend>Expiration</legend><div class="sbt-row sbt-expiration-head">${a.expiration.removeOnPlacement ? "" : check("expiration.enabled", a.expiration.enabled, "Region expires") + check("expiration.currentTurnEnd", a.expiration.currentTurnEnd, "On current turn end", disabled(!a.expiration.enabled))}${check("expiration.removeOnPlacement", a.expiration.removeOnPlacement, "Remove on placement")}</div>${a.expiration.removeOnPlacement ? "" : `<div class="sbt-row sbt-expiration ${expDisabled ? "sbt-disabled" : ""}">${numberInput("expiration.amount", a.expiration.amount, `aria-label="Duration" ${disabled(expDisabled)}`)}<select data-path="expiration.unit" aria-label="Duration type" ${disabled(expDisabled)}>${options(units, a.expiration.unit)}</select></div>`}</fieldset>
    ${this.renderAdvanced()}
    <fieldset class="sbt-section sbt-behaviors-section"><legend class="sbt-behaviors-legend">Region Behaviors</legend>${this.renderBehaviorList("behaviors")}</fieldset>
    ${this.renderVariants("raises", "Raised")}
    ${modifiers}${footer}`;
  }
  renderAdvanced() {
    const a = this.draft;
    const sub = (key, title, body) => accordion(key, title, body, this.accordions.has(key));
    return sub("advanced", "Advanced", `<div class="sbt-row">${check("attachable", a.attachable, "Attachable")}</div><p class="sbt-hint">Choose a token to attach the region to after placement. The region and attached media follow its movement.</p><div class="sbt-row">${check("advanced.hideFromPlayers", a.advanced.hideFromPlayers, "Hide from players by default")}</div>
      ${sub("separate", "Separate regions", `<div class="sbt-row">${check("separateRegions.enabled", a.separateRegions.enabled, "Separate regions")}</div><p class="sbt-hint">Keep attached media on independent regions. They share the primary region’s expiration and cleanup.</p><div class="sbt-separate-options">${["audio", "tiles", "lights", "walls"].map(key => check(`separateRegions.${key}`, a.separateRegions[key], `Attached ${key}`, a.separateRegions.enabled ? "" : "disabled")).join("")}</div>`)}
      ${sub("walls", "Wall restriction", `<div class="sbt-row">${check("wallRestriction.enabled", a.wallRestriction.enabled, "Restrict region by walls")}</div>${row("Restriction", `<select data-path="wallRestriction.type">${options(["move", "sight", "light", "sound", "darkness"].map(key => [key, key.charAt(0).toUpperCase() + key.slice(1)]), a.wallRestriction.type)}</select>`)}${row("Priority", numberInput("wallRestriction.priority", a.wallRestriction.priority))}`)}
      ${sub("appearance", "Region’s appearance", `<div class="sbt-row">${check("advanced.enabled", a.advanced.enabled, "Override region appearance")}</div><div class="sbt-row">${check("advanced.gridBased", a.advanced.gridBased, "Grid-Based")}</div>${a.advanced.enabled ? row("Color", input("advanced.color", a.advanced.color, "color")) + row("Visibility", `<select data-path="advanced.visibility" data-numeric>${options([[0, "Region layer"], [4, "Region layer when unlocked"], [1, "GM only"], [3, "Observers"], [2, "Always visible"]], a.advanced.visibility)}</select>`) + row("Highlight", `<select data-path="advanced.highlightMode">${options([["shapes", "True shapes"], ["coverage", "Covered grid spaces"]], a.advanced.highlightMode)}</select>`) + check("advanced.displayMeasurements", a.advanced.displayMeasurements, "Display measurements") : ""}`)}`);
  }
  behaviorTargets() {
    return this.draft.behaviors.map((behavior, index) => [behavior.id, `${index + 1}. ${behavior.label || CATALOG.find(def => def.type === behavior.type).label}`]);
  }
  renderBehaviorList(path, {addLabel = "Add behavior", cast = false, canReplace = cast} = {}) {
    const regularOptions = options(CATALOG.map(def => [def.type, def.label]), "addEffect");
    const choices = cast ? `<optgroup label="Cast adjustments">${options(CAST_CHANGES.map(def => [def.type, def.label]))}</optgroup><optgroup label="Region behaviors">${regularOptions}</optgroup>` : regularOptions;
    const select = this.isLibraryEditor ? "" : `<select class="sbt-behavior-picker" data-role="behavior-type" aria-label="Behavior type">${choices}</select>`;
    return `<div class="sbt-add-row" data-add-behavior-path="${path}">${select}${cast ? `<button type="button" data-action="addBehavior"><i class="fa-solid fa-plus"></i> ${addLabel}</button>` : action("addBehavior", "fa-plus", addLabel)}</div>
      <ul class="sbt-behavior-list">${getPath(this.draft, path).map((entry, index) => entry.type ? this.renderBehavior(entry, path, index, canReplace) : this.renderLegacyChange(entry, `${path}.${index}`)).join("")}</ul>`;
  }
  renderBehavior(entry, listPath, index, canReplace) {
    const def = CAST_CATALOG.find(d => d.type === entry.type), path = `${listPath}.${index}`;
    const open = this.openBehaviors.has(entry.id);
    return `<li class="sbt-behavior ${open ? "" : "sbt-collapsed"}" data-index="${index}" data-behavior-path="${path}"><header class="sbt-behavior-header"><input type="checkbox" aria-label="Enable ${E(def.label)}" data-path="${path}.enabled" ${entry.enabled ? "checked" : ""}><i class="sbt-behavior-icon fa-solid ${def.icon}"></i><a class="sbt-behavior-name" data-action="collapseBehavior" aria-expanded="${open}">${E(entry.label || def.label)}</a>${action("moveUp", "fa-chevron-up", "Move up")}${action("moveDown", "fa-chevron-down", "Move down")}${action("duplicateBehavior", "fa-copy", "Duplicate behavior")}${action("deleteBehavior", "fa-trash", "Remove behavior")}</header>
    <div class="sbt-behavior-fields"><div class="sbt-behavior-fields-body">
      ${row("Label", input(`${path}.label`, entry.label, "text", `placeholder="${E(def.label)}"`))}
      ${canReplace && !def.castOnly && this.draft.behaviors.length ? row("Replace behavior", `<select data-path="${path}.replaces" aria-label="Replace behavior" title="Replace the selected normal behavior if present in this cast">${options([["", "Add as a new behavior"], ...this.behaviorTargets()], entry.replaces ?? "")}</select>`) : ""}
      ${def.passive ? "" : `<div class="sbt-field"><label>Triggers</label><div class="sbt-trigger-options">${TRIGGERS.filter(([key]) => key !== "whileWithin" || ["addEffect", "restrict"].includes(entry.type)).map(([key, label]) => `<label class="sbt-checkbox-label"><input type="checkbox" data-trigger="${index}" value="${key}" ${entry.triggers.includes(key) ? "checked" : ""}><span>${label}</span></label>`).join("")}</div></div>${row("Targets", `<select data-path="${path}.target">${options(BEHAVIOR_TARGETS, entry.target)}</select>`)}${this.renderField({key: "requiredFlags", label: "Required target flags", type: "flags"}, entry.requiredFlags, path)}${this.renderField({key: "excludedFlags", label: "Excluded target flags", type: "flags"}, entry.excludedFlags, path)}`}
      ${def.fields.map(f => this.renderField(f, entry.system[f.key], `${path}.system`, entry)).join("")}
      </div></div></li>`;
  }
  variantTitle(list, variant, index) {
    return list === "raises" ? `Raised ${variant.level}` : variant.name || `Modifier ${index + 1}`;
  }
  renderVariants(list, title) {
    const raised = list === "raises";
    const content = `<div data-variant-list="${list}">
      <p class="sbt-hint">${raised ? "Each raise is independent. Automatic keeps normal behaviors for additions and adjustments, and replaces them for a new roll, move, macro, or script." : "Players can combine modifiers and choose one priced option per modifier."}</p>
      ${this.draft[list].map((variant, index) => {
        const path = `${list}.${index}`;
        const fields = `
          <div class="sbt-row">
            ${raised ? row("Raise level", input(`${path}.level`, variant.level, "number", 'min="1" step="1" aria-label="Raise level" data-variant-name'))
            : input(`${path}.name`, variant.name, "text", `aria-label="Modifier name" placeholder="Modifier name" data-variant-name`)}
            ${!raised && game.user.isGM && this.setting?.saveModifierToLibrary ? action("saveModifierToLibrary", "fa-book", "Add to Modifiers Compendium") : ""}
            ${action("deleteVariant", "fa-trash", raised ? "Remove raise" : "Remove modifier")}
          </div>
          ${raised ? row("Normal behaviors", `<select data-path="${path}.mode" aria-label="Normal behaviors">${options([["auto", "Automatic"], ["extend", "Keep normal behaviors"], ["replace", "Replace normal behaviors"]], variant.mode)}</select>`) + this.renderBehaviorList(`${path}.changes`, {addLabel: "Add change", cast: true, canReplace: variant.mode !== "replace"}) : this.renderModifierDetails(variant, path)}`;
        const drag = !raised && this.item.type === "power" && game.user.isGM
          ? `<span draggable="true" class="sbt-modifier-drag" data-sbt-modifier-drag="${E(variant.id)}" title="Drag to Modifiers Compendium"><i class="fa-solid fa-grip-vertical" inert></i></span> ` : "";
        return accordion(path, drag + E(this.variantTitle(list, variant, index)), fields, this.accordions.has(path), `data-variant-index="${index}"`);
      }).join("")}
      <button type="button" data-action="addVariant"><i class="fa-solid fa-plus"></i> ${raised ? "Add raise" : "Add modifier"}</button>
    </div>`;
    return accordion(list, title, content, this.accordions.has(list));
  }
  renderModifierDetails(variant, path) {
    return `<div class="sbt-modifier-details">
      <prose-mirror class="sbt-modifier-description" name="${path}.description" data-path="${path}.description" value="${E(variant.description)}" editable="true" toggled aria-label="Modifier description">${variant.description}</prose-mirror>
      ${variant.options.map((option, index) => {
        const prefix = `${path}.options.${index}`;
        return `<fieldset class="sbt-modifier-option" data-cost-index="${index}"><legend>${index === 0 ? "Default change" : `Change ${index + 1}`}</legend>
          <div class="sbt-row sbt-cost-option">
            ${input(`${prefix}.label`, option.label, "text", `aria-label="Option name" placeholder="Option name"`)}
            <label class="sbt-option-cost">Cost ${input(`${prefix}.cost`, option.cost, "number", `step="any" aria-label="Power Point cost"`)} PP</label>
            ${variant.options.length > 1 ? action("deleteCostOption", "fa-trash", "Remove change option") : ""}
          </div>
          ${this.renderBehaviorList(`${prefix}.changes`, {cast: true})}
        </fieldset>`;
      }).join("")}
      <button type="button" data-action="addModifierOption"><i class="fa-solid fa-plus"></i> Add change</button>
    </div>`;
  }
  renderLegacyChange(change, path) {
    const targets = [["template", "Template"], ...this.behaviorTargets()];
    const fields = variantFields(this.draft, change.target);
    const field = fields.find(field => field.key === change.field);
    const operations = field ? variantOperations(field) : [];
    return `<li class="sbt-variant-change" data-legacy-path="${path}">
      <div class="sbt-row">
        <select data-path="${path}.target" data-variant-control="target" aria-label="Change target">${options(targets, change.target)}</select>
        <select data-path="${path}.field" data-variant-control="field" aria-label="Change field">${options([["", "Choose a field"], ...fields.map(field => [field.key, field.label])], change.field)}</select>
        ${action("deleteLegacyChange", "fa-trash", "Remove change")}
      </div>
      ${field ? `<div class="sbt-variant-value">
        ${operations.length > 1 ? `<select data-path="${path}.operation" aria-label="Change operation">${options(operations, change.operation)}</select>` : ""}
        ${this.renderField({...field, key: "value", label: field.type === "checkbox" ? field.label : "Value"}, change.value, path)}
      </div>` : ""}
    </li>`;
  }
  renderField(field, value, prefix, entry = null) {
    const path = `${prefix}.${field.key}`, f = field;
    let content;
    if (f.type === "checkbox") return `<div class="sbt-row">${check(path, value, E(f.label))}</div>`;
    if (["select", "rollMode"].includes(f.type)) content = `<select data-path="${path}" ${f.numeric ? "data-numeric" : ""}>${options(f.options ?? [["publicroll", "Public"], ["gmroll", "GM roll"], ["blindroll", "Blind GM roll"], ["selfroll", "Self"]], value)}</select>`;
    else if (f.type === "wholeDuration") content = input(path, value, "number", 'min="0" step="1" required data-duration-amount aria-label="Duration amount"');
    else if (["textarea", "script"].includes(f.type)) content = `<textarea data-path="${path}" rows="${f.type === "script" ? 7 : 3}" ${f.type === "script" && !game.user.isGM ? "disabled" : ""} spellcheck="${f.type !== "script"}">${E(value)}</textarea>${f.type === "script" ? '<p class="sbt-field-hint">GM-authored JavaScript. Available variables are token, actor, region, item, and event.</p>' : ""}`;
    else if (f.type === "effects") content = `<div class="sbt-row"><button type="button" data-action="aegis"><i class="fa-solid fa-shield-quartered"></i> Construct with A.E.G.I.S.</button></div><ul class="sbt-effect-list">${value.map((effect, index) => `<li data-effect-index="${index}"><img src="${E(effect.img || "icons/svg/aura.svg")}" alt=""><span>${E(effect.name)}</span>${action("editEffect", "fa-pen", "Edit with A.E.G.I.S.")}${action("deleteEffect", "fa-trash", "Remove effect")}</li>`).join("")}</ul>`;
    else if (f.type === "shapeReplacements") content = SHAPES.filter(shape => this.isLibraryEditor || this.draft.shapes.includes(shape.key)).map(shape => {
      const title = shapeTitle(shape);
      return row(E(title), `<select data-path="${path}.${shape.key}" aria-label="${E(title)} replacement">${options([["", "No changes"], ...SHAPES.filter(other => other !== shape).map(other => [other.key, shapeTitle(other)])], value[shape.key])}</select>`);
    }).join("") || '<p class="sbt-field-hint">Select at least one shape under Shape.</p>';
    else if (["light", "sound", "tile", "wall"].includes(f.type)) {
      const src = value.texture?.src ?? value.path ?? "";
      content = `<div class="sbt-row"><button type="button" data-action="configure" data-kind="${f.type}" data-field="${f.key}"><i class="fa-solid fa-sliders"></i> Configure ${f.type}</button><span class="sbt-media-summary">${E(src || "Native Foundry settings")}</span></div>`;
    } else if (f.type === "movementTypes") {
      const index = prefix.split(".")[1];
      content = `<div class="sbt-trigger-options">${movementTypes().map(([key, config]) => `<label class="sbt-checkbox-label"><input type="checkbox" data-movement="${index}" value="${E(key)}" ${value.includes(key) ? "checked" : ""}><span>${E(game.i18n.localize(config.label))}</span></label>`).join("")}</div><p class="sbt-field-hint">Leave all unchecked to affect every movement type.</p>`;
    } else if (f.type === "effectDuration") {
      const disabled = value.enabled ? "" : "disabled";
      content = `<div class="sbt-row">${check(`${path}.enabled`, value.enabled, "Override duration")}</div>
        <div class="sbt-row sbt-expiration">${numberInput(`${path}.amount`, value.amount, `aria-label="Effect duration" ${disabled}`)}
        <select data-path="${path}.unit" aria-label="Effect duration unit" ${disabled}>${options(units, value.unit)}</select></div>`;
    } else if (f.type === "hidden") return "";
    else if (f.type === "traits") {
      content = `<div class="sbt-field-input"><button type="button" data-action="pickRestriction"><i class="fa-solid fa-list"></i> Choose trait</button></div>
        <ul class="sbt-effect-list">${value.map((trait, index) => `<li><span>${E(trait === "*" ? "All traits" : trait)}${entry.system.linkedAttributes.includes(trait) ? " · All linked Skills" : ""}</span>${action("removeRestriction", "fa-trash", "Remove trait", `data-trait-index="${index}"`)}</li>`).join("")}</ul>`;
    } else if (f.type === "rollRequest") {
      content = `<div class="sbt-field-input"><button type="button" data-action="configureRequest"><i class="fa-solid fa-clipboard-list"></i> Configure Request</button>
        <span>${value.trait ? E(`${value.name || value.trait} · TN ${value.tn}`) : "No request configured"}</span></div>`;
    } else {
      const kind = ["uuid", "trait", "flags"].includes(f.type) ? f.type : "";
      const attrs = `${kind ? `data-kind="${kind}"` : ""} ${kind === "flags" ? `list="${this.id}-flags"` : kind === "trait" ? `list="${this.id}-traits"` : ""}`;
      const effectReference = entry && ["addEffect", "removeEffect"].includes(entry.type) && ["effectUuid", "effect"].includes(f.key);
      const editor = f.type === "number" ? numberInput(path, value, `${attrs} ${f.fractional ? "data-fractional" : ""} ${f.optional ? 'data-formula-optional placeholder="Keep current value"' : ""}`)
        : f.key === "formula" || f.dice ? formulaInput(path, value, entry?.type === "addDamageDice" ? `${attrs} aria-label="Damage formula to add" placeholder="${entry.system.legacyCount === undefined ? 'e.g. 1d6+1d6x' : 'Keep previous dice count'}"` : attrs)
        : input(path, value, f.type === "color" ? "color" : "text", `${attrs} ${effectReference ? "data-effect-reference" : ""}`);
      content = `<div class="sbt-field-input">${effectReference ? '<img class="sbt-effect-preview" alt="" hidden>' : ""}${editor}${f.type === "audio" ? action("file", "fa-folder-open", "Browse sound", `data-field="${f.key}"`) : ""}${kind === "trait" && entry ? action("pickTrait", "fa-list", "Browse attributes and skills", `data-field="${f.key}"`) : ""}${entry && ["addEffect", "removeEffect"].includes(entry.type) && ["effectUuid", "effect"].includes(f.key) ? `<button type="button" data-action="pickEffect" title="Browse SWADE and Better Effects"><i class="fa-solid fa-list"></i> Browse effects</button>` : ""}</div>`;
    }
    return `<div class="sbt-field"><label>${E(f.label)}</label>${content}</div>`;
  }
  async handleAction(name, _event, target) {
    this.capture();
    const path = target.closest("[data-behavior-path], [data-legacy-path]")?.dataset;
    const location = (path?.behaviorPath ?? path?.legacyPath)?.split(".");
    const index = Number(location?.pop());
    const behaviors = location ? getPath(this.draft, location.join(".")) : null;
    const entry = behaviors?.[index];
    const confirmDelete = (label, type = "behavior") => foundry.applications.api.DialogV2.confirm({
      classes: ["sbt-library-dialog"],
      window: {title: `Delete ${type}`}, content: `<p>Delete <strong>${E(label)}</strong> from this template?</p>`, rejectClose: false
    });
    if (name === "accordion") {
      const card = target.closest("[data-accordion]");
      const key = card.dataset.accordion;
      const open = !this.accordions.delete(key);
      if (open) this.accordions.add(key);
      card.classList.toggle("sbt-accordion-collapsed", !open);
      target.setAttribute("aria-expanded", String(open));
      return;
    }
    if (name === "save" || name === "saveClose") { await this.save(); if (name === "saveClose") await this.close(); return; }
    if (name === "saveModifierToLibrary") {
      const index = Number(target.closest("[data-variant-index]").dataset.variantIndex);
      const modifierId = this.draft.modifiers[index].id;
      if (this.dirty) await this.save();
      await this.setting.saveModifierToLibrary(this.item, modifierId);
      return;
    }
    if (name === "place") { await this.save(); return game.modules.get(MODULE_ID).api.placeTemplate(this.item); }
    if (["addVariant", "deleteVariant", "addModifierOption", "deleteCostOption"].includes(name)) {
      const list = target.closest("[data-variant-list]").dataset.variantList;
      const entries = this.draft[list];
      const variantIndex = Number(target.closest("[data-variant-index]")?.dataset.variantIndex);
      const variant = entries[variantIndex];
      if (name === "addVariant") {
        this.accordions.add(`${list}.${entries.length}`);
        entries.push(list === "raises"
          ? {id: id(), level: Math.max(0, ...entries.map(entry => entry.level)) + 1, mode: "auto", changes: []}
          : {id: id(), name: `Modifier ${entries.length + 1}`, description: "", options: [defaultCostOption()]});
      }
      if (name === "deleteVariant") {
        if (!await confirmDelete(list === "raises" ? `Raised ${variant.level}` : variant.name || "Modifier", list === "raises" ? "raise" : "modifier")) return;
        entries.splice(variantIndex, 1);
        for (let index = variantIndex; index <= entries.length; index++) {
          this.accordions.delete(`${list}.${index}`);
          if (this.accordions.has(`${list}.${index + 1}`)) this.accordions.add(`${list}.${index}`);
        }
      }
      if (name === "addModifierOption") variant.options.push(defaultCostOption(id()));
      if (name === "deleteCostOption") {
        const optionIndex = Number(target.closest("[data-cost-index]").dataset.costIndex);
        if (variant.options.length <= 1 || !await confirmDelete(variant.options[optionIndex].label || `Change ${optionIndex + 1}`, "change option")) return;
        variant.options.splice(optionIndex, 1);
      }
      this.dirty = true;
      return this.render();
    }
    if (name === "export") { foundry.utils.saveDataToFile(exportAutomation(this.draft, this.item.name), "application/json", `${this.item.name.replace(/[^a-z0-9-]/gi, "-")}.json`); return; }
    if (name === "import") {
      const text = await foundry.applications.api.DialogV2.prompt({classes: ["sbt-library-dialog"], window: {title: "Import template automation"}, content: '<div class="sbt-import"><input type="file" name="file" accept=".json,application/json"><p>Or paste exported JSON:</p><textarea name="json" rows="8"></textarea></div>', ok: {label: "Import", callback: async (_e, button) => { const file = button.form.querySelector('[name="file"]').files[0]; return file ? file.text() : button.form.querySelector('[name="json"]').value; }}, rejectClose: false});
      if (text) this.draft = importAutomation(text); else return;
    } else if (name === "saveCompendium") { await this.save(); await saveToCompendium(this.item); return; }
    else if (name === "importCompendium") { const item = await chooseCompendiumTemplate(); if (!item) return; this.draft = readAutomation(item); }
    else if (name === "addBehavior") {
      const row = target.closest("[data-add-behavior-path]");
      const type = this.isLibraryEditor ? await foundry.applications.api.DialogV2.prompt({
        classes: ["sbt-library-dialog"], window: {title: "Add template behavior"}, rejectClose: false,
        content: `<label>Behavior <select name="behavior"><optgroup label="Cast adjustments">${options(CAST_CHANGES.map(def => [def.type, def.label]))}</optgroup><optgroup label="Region behaviors">${options(CATALOG.map(def => [def.type, def.label]))}</optgroup></select></label>`,
        ok: {label: "Add", callback: (_event, button) => button.form.elements.behavior.value}
      }) : row.querySelector('[data-role="behavior-type"]').value;
      if (!type || (this.isLibraryEditor && !this.element.isConnected)) return;
      const behavior = defaultBehavior(type);
      if (this.isLibraryEditor && type === "executeMacro") behavior.enabled = false;
      getPath(this.draft, row.dataset.addBehaviorPath).push(behavior);
      this.openBehaviors.add(behavior.id);
    }
    else if (name === "collapseBehavior") {
      if (!this.openBehaviors.delete(entry.id)) this.openBehaviors.add(entry.id);
    }
    else if (name === "deleteBehavior" || name === "deleteLegacyChange") {
      const label = entry.type ? entry.label || CAST_CATALOG.find(def => def.type === entry.type).label : "This change";
      if (!await confirmDelete(label)) return;
      behaviors.splice(index, 1);
      if (behaviors === this.draft.behaviors) for (const variant of variantLists(this.draft)) {
        variant.changes = variant.changes.filter(change => change.target !== entry.id);
        for (const change of variant.changes) if (change.replaces === entry.id) delete change.replaces;
      }
    }
    else if (name === "duplicateBehavior") behaviors.splice(index + 1, 0, {...clone(entry), id: id()});
    else if (name === "moveUp" || name === "moveDown") { const to = index + (name === "moveUp" ? -1 : 1); if (to >= 0 && to < behaviors.length) [behaviors[index], behaviors[to]] = [behaviors[to], behaviors[index]]; }
    else if (name === "pickEffect") { const effect = await pickEffect(); if (!effect) return; entry.system[entry.type === "addEffect" ? "effectUuid" : "effect"] = effect.value; }
    else if (name === "pickTrait") {
      const trait = await pickTrait();
      if (!trait) return;
      entry.system[target.dataset.field] = trait.value;
    } else if (name === "pickRestriction") {
      return pickRestrictedTrait((value, trait) => {
        entry.system.traits = [...new Set([...entry.system.traits, value])];
        entry.system.linkedAttributes = entry.system.linkedAttributes.filter(key => key !== value);
        if (trait.linkedSkills) entry.system.linkedAttributes.push(value);
        this.dirty = true;
        this.render();
      }, entry.system.linkedAttributes);
    } else if (name === "removeRestriction") {
      const [trait] = entry.system.traits.splice(Number(target.dataset.traitIndex), 1);
      entry.system.linkedAttributes = entry.system.linkedAttributes.filter(key => key !== trait);
    } else if (name === "configureRequest") {
      const api = effectsAPI();
      if (!api?.configureRollRequest) throw new Error("Enable the updated SWADE Better Effects module to configure a roll request.");
      return api.configureRollRequest(entry.system.request, request => {
        numericFormula(request.tn, null, {validate: true});
        entry.system.request = request;
        this.dirty = true;
        this.render();
      }, {previewTargetNumber: value => formulaResult(value, this.formulaActor)});
    }
    else if (name === "aegis" || name === "editEffect") {
      const effectIndex = Number(target.closest("[data-effect-index]")?.dataset.effectIndex);
      const result = await editAegis(name === "editEffect" ? [entry.system.effects[effectIndex]] : [], entry.label || this.item.name);
      if (!result) return;
      if (name === "editEffect") entry.system.effects.splice(effectIndex, 1, ...result); else entry.system.effects.push(...result);
    } else if (name === "deleteEffect") entry.system.effects.splice(Number(target.closest("[data-effect-index]").dataset.effectIndex), 1);
    else if (name === "file") { new CONFIG.ux.FilePicker({type: "audio", current: entry.system[target.dataset.field], callback: path => { entry.system[target.dataset.field] = path; this.dirty = true; this.render(); }}).render({force: true}); return; }
    else if (name === "configure") { const result = await editSceneObject(target.dataset.kind, entry.system[target.dataset.field]); if (!result) return; entry.system[target.dataset.field] = result; }
    this.dirty = true; this.render();
  }
  async save() {
    for (const editor of this.element.querySelectorAll("prose-mirror.active[data-path]")) editor.save();
    this.capture();
    if (!this.item.isOwner) throw new Error("You no longer have permission to edit this item.");
    const levels = this.draft.raises.map(raise => raise.level);
    if (levels.some(level => !Number.isSafeInteger(level) || level < 1) || new Set(levels).size !== levels.length) {
      throw new Error("Each raise needs a different positive whole number.");
    }
    if (variantLists(this.draft).some(entry => entry.changes.some(change => !change.type && !change.field))) {
      throw new Error("Choose a field for each raise or modifier change.");
    }
    const old = readAutomation(this.item);
    const modifiers = this.item.type === "power" ? mergeModifierDraft(this.savedModifiers, this.draft.modifiers, old.modifiers) : this.draft.modifiers;
    const raises = this.item.type === "power" ? mergeRaiseDraft(this.savedRaises, this.draft.raises, old.raises) : this.draft.raises;
    const draft = normalizeAutomation({...this.draft, modifiers, raises}, this.item);
    if (draft.enabled && !draft.shapes.length) throw new Error("Choose at least one template shape.");
    const executables = automation => configuredBehaviors(automation).filter(b => ["executeScript", "executeMacro"].includes(b.type));
    if (!game.user.isGM && JSON.stringify(executables(draft)) !== JSON.stringify(executables(old))) throw new Error("A GM must configure scripts and macros.");
    this.validateBehaviorFields(draft);
    const update = {[`flags.${MODULE_ID}.automation`]: draft};
    for (const shape of SHAPES) {
      const path = itemTemplatePath(this.item, shape);
      if (path) update[path] = draft.shapes.includes(shape.key);
    }
    await this.item.update(update);
    this.draft = readAutomation(this.item);
    this.savedModifiers = clone(this.draft.modifiers);
    this.savedRaises = clone(this.draft.raises);
    await trustAutomation(this.draft);
    this.dirty = false;
    ui.notifications.info("Template automation saved.");
    this.render();
  }
  validateBehaviorFields(draft) {
    for (const field of this.element.querySelectorAll("[data-formula]:enabled")) {
      if (field.hasAttribute("data-formula-optional") && !field.value.trim()) continue;
      numericFormula(field.value, null, {validate: true});
    }
    for (const b of configuredBehaviors(draft)) {
      if (!b.enabled) continue;
      if (b.type === "adjustDuration" && (!Number.isSafeInteger(b.system.amount) || b.system.amount < 0)) {
        throw new Error("Adjust Duration requires a nonnegative whole amount.");
      }
      if (["rollDice", "rollDamage", "addDamageDice"].includes(b.type)) {
        const formula = b.system.formula.trim();
        if (b.type === "addDamageDice" && !formula && b.system.legacyCount !== undefined) continue;
        if (!formula || !Roll.validate(expandTraitFormula(formula, null, {validate: true, roll: true}))) throw new Error(`Invalid dice formula in ${b.label || CAST_CATALOG.find(def => def.type === b.type).label}.`);
      }
    }
    for (const variant of variantLists(draft)) for (const change of variant.changes.filter(change => !change.type)) {
      const field = variantFields(draft, change.target).find(field => field.key === change.field);
      if (field?.dice && !Roll.validate(expandTraitFormula(change.value, null, {validate: true, roll: true}))) {
        throw new Error(`Invalid dice formula in ${variant.level ? `Raised ${variant.level}` : variant.label || "the default change"}.`);
      }
    }
  }
  async close(options = {}) {
    if (this.dirty && !options.force) {
      const result = await foundry.applications.api.DialogV2.wait({classes: ["sbt-library-dialog"], window: {title: "Unsaved template automation"}, content: "<p>Save your changes before closing?</p>", buttons: [{action: "save", label: "Save", default: true}, {action: "discard", label: "Discard"}], rejectClose: false});
      if (!result) return this;
      if (result === "save") { try { await this.save(); } catch (error) { ui.notifications.error(error.message); return this; } }
    }
    opened.delete(this.item.uuid);
    return super.close(options);
  }
}


class LibraryTemplateBehaviors extends BetterTemplatesBuilder {
  constructor(host, modifier, onSave) {
    const draft = {enabled: false, modifiers: [modifier]};
    super({name: modifier.name, type: "power", getFlag: () => draft});
    this.host = host;
    this.onSave = onSave;
    this.pending = Promise.resolve();
    this.lastChanges = JSON.stringify(this.draft.modifiers[0].options[0].changes);
    host.classList.add("sbt-inline-behaviors");
    host.addEventListener("click", event => {
      const target = event.target.closest("[data-action]");
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      void this.handleAction(target.dataset.action, event, target).catch(error => ui.notifications.error(error.message));
    });

  }

  get isLibraryEditor() { return true; }
  get element() { return this.host; }

  render() {
    if (!this.host.isConnected) return;
    this.host.innerHTML = `<div>${this.renderBehaviorList("modifiers.0.options.0.changes", {cast: true, addLabel: "Add Template Modifier"})}</div>
      <datalist id="${this.id}-flags"></datalist><datalist id="${this.id}-traits"></datalist>`;
    this.bindEditor(this.host.firstElementChild);
    if (!this.traitRequest && this.host.querySelector('[data-kind="trait"]')) {
      this.traitRequest = traitCatalog().then(traits => {
        if (!this.host.isConnected) return;
        this.traits = traits;
        this.updateDatalists();
      }).catch(error => ui.notifications.error(error.message));
    }
    if (this.dirty) this.persistChanges();
  }

  persistChanges() {
    this.dirty = false;
    try {
      const draft = normalizeAutomation(this.draft, this.item);
      this.validateBehaviorFields(draft);
      const changes = draft.modifiers[0].options[0].changes;
      const serialized = JSON.stringify(changes);
      if (serialized === this.lastChanges) return;
      this.lastChanges = serialized;
      const next = this.pending.then(async () => {
        await trustAutomation(draft);
        await this.onSave(changes);
      });
      this.pending = next.catch(error => {
        if (this.lastChanges === serialized) this.lastChanges = undefined;
        ui.notifications.error(error.message);
      });
    } catch (error) { ui.notifications.error(error.message); }
  }
}
