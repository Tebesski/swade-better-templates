export const MODULE_ID = "swade-better-templates";
export const FLAG_SCOPE = MODULE_ID;
export const EFFECTS_ID = "swade-better-effects";
export const BEHAVIOR_TYPE = `${MODULE_ID}.automation`;
export const PACK_ID = `world.${MODULE_ID}`;
export const SUPPORTED_TYPES = new Set(["gear", "power", "action", "weapon", "consumable", "armor", "shield", "ability", "edge", "hindrance"]);
export const TIME_UNITS = {rounds: 6, seconds: 1, minutes: 60, hours: 3600, days: 86400};
export const SHAPES = [
  {key: "small", preset: "sbt", label: "Small Blast", type: "circle", radius: 1},
  {key: "medium", preset: "mbt", label: "Medium Blast", type: "circle", radius: 2},
  {key: "large", preset: "lbt", label: "Large Blast", type: "circle", radius: 3},
  {key: "scone", preset: "swscone", label: "Small Cone", type: "cone", radius: 4, angle: 37.5},
  {key: "cone", preset: "swcone", label: "Cone", type: "cone", radius: 9, angle: 22.5},
  {key: "stream", preset: "stream", label: "Stream", type: "line", length: 12, width: 1},
  {key: "smallRing", preset: "sbt-small-ring", label: "S Ring", type: "ring", radius: 1, outerWidth: 1},
  {key: "mediumRing", preset: "sbt-medium-ring", label: "M Ring", type: "ring", radius: 2, outerWidth: 1},
  {key: "largeRing", preset: "sbt-large-ring", label: "L Ring", type: "ring", radius: 3, outerWidth: 1}
];
export const shapeTitle = shape => shape.type === "ring" ? shape.label : `${shape.label} Template`;
export const shapeButtonLabel = shape => ({small: "SBT", medium: "MBT", large: "LBT", scone: "S Cone"})[shape.key] ?? shape.label;
export const TRIGGERS = [
  ["onPlace", "On placement"], ["tokenEnter", "Token enters"], ["tokenExit", "Token leaves"],
  ["tokenMoveWithin", "Token moves within"], ["tokenTurnStart", "Turn starts"], ["tokenTurnEnd", "Turn ends"],
  ["tokenRoundStart", "Round starts"], ["tokenRoundEnd", "Round ends"], ["whileWithin", "While inside"]
];
export const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
export const clone = value => structuredClone(value);
export const id = () => globalThis.foundry?.utils?.randomID?.() ?? Math.random().toString(36).slice(2, 14);
export const splitList = value => [...new Set((Array.isArray(value) ? value : String(value ?? "").split(/[,\n]/)).map(v => String(v).trim()).filter(Boolean))];
export const normalizeName = value => String(value ?? "").trim().toLowerCase();
export function movementTypes() {
  return Object.entries(CONFIG.Token.movement.actions).filter(([, action]) =>
    action.terrainAction === undefined && action.deriveTerrainDifficulty == null);
}
export function itemTemplatePath(item, shape) {
  if (item?.system?.templates && shape.type !== "ring") return `system.templates.${shape.key}`;
  if (item?.system?.templates || item?.type === "gear") return `flags.${MODULE_ID}.templates.${shape.key}`;
  return null;
}
export function itemTemplateSelected(item, shape) {
  if (item?.system?.templates && shape.type !== "ring") return Boolean(item.system.templates[shape.key]);
  return Boolean(item?.getFlag?.(MODULE_ID, "templates")?.[shape.key]);
}
export function setPath(object, path, value) {
  const keys = path.split(".");
  if (keys.some(k => ["__proto__", "prototype", "constructor"].includes(k))) throw new Error("Invalid field path.");
  const last = keys.pop(); let cursor = object;
  for (const key of keys) cursor = cursor[key] ??= {};
  cursor[last] = value;
}
export function getPath(object, path) { return path.split(".").reduce((value, key) => value?.[key], object); }
export function defaultAutomation(item = null) {
  return {version: 1, enabled: true, label: "", placementRange: {enabled: false, max: 0},
    shapes: SHAPES.filter(shape => itemTemplateSelected(item, shape)).map(shape => shape.key),
    expiration: {enabled: true, currentTurnEnd: false, removeOnPlacement: false, amount: 5, unit: "rounds"}, attachable: false,
    separateRegions: {enabled: false, audio: false, tiles: false, lights: false, walls: false},
    wallRestriction: {enabled: false, type: "move", priority: 0},
    advanced: {hideFromPlayers: false, enabled: false, gridBased: true, color: "#a728cc", visibility: 0, highlightMode: "shapes", displayMeasurements: true},
    behaviors: [], raises: [], modifiers: []};
}
const field = (key, label, type = "text", value = "", extra = {}) => ({key, label, type, default: value, ...extra});
export const CATALOG = [
  {type: "addEffect", label: "Add Effect", icon: "fa-person-rays", fields: [field("effectUuid", "Effect UUID", "uuid"), field("effects", "Effects", "effects", []), field("duration", "Custom effect duration", "effectDuration", {enabled: false, amount: 5, unit: "rounds"}), field("removeOnExit", "Remove on leaving", "checkbox", true)]},
  {type: "adjustDarkness", label: "Adjust Darkness Level", icon: "fa-moon", passive: true, fields: [field("mode", "Mode", "select", 0, {options: [[0, "Override"], [1, "Brighten"], [2, "Darken"]], numeric: true}), field("modifier", "Darkness level / modifier", "number", 0.5, {min: 0, max: 1, fractional: true})]},
  {type: "attachLight", label: "Attach Light Source", icon: "fa-lightbulb", passive: true, fields: [field("light", "Light source", "light", {config: {dim: 6, bright: 3, color: "#ffffff", alpha: 0.5}})]},
  {type: "attachSound", label: "Attach Sound", icon: "fa-volume-high", passive: true, fields: [field("sound", "Ambient sound", "sound", {path: "", radius: 6, volume: 0.5})]},
  {type: "attachTile", label: "Attach Tile", icon: "fa-image", passive: true, fields: [field("tile", "Tile", "tile", {texture: {src: ""}, alpha: 1})]},
  {type: "attachWalls", label: "Attach Walls", icon: "fa-block-brick", passive: true, fields: [field("wall", "Wall configuration", "wall", {move: 20, sight: 20, light: 20, sound: 20}), field("segments", "Curved edge segments", "number", 32, {min: 8, max: 128})]},
  {type: "rollDamage", label: "Roll Damage", icon: "fa-burst", fields: [field("formula", "Damage formula", "text", "2d6x"), field("ap", "Armor piercing", "number", 0, {min: 0}), field("flags", "Damage flags", "flags"), field("flavor", "Chat label"), field("rollMode", "Roll mode", "rollMode", "publicroll")]},
  {type: "difficultTerrain", label: "Difficult Terrain", icon: "fa-person-hiking", passive: true, fields: [field("multiplier", "Movement cost multiplier", "number", 2, {min: 0, max: 5, fractional: true}), field("actions", "Movement types", "movementTypes", [])]},
  {type: "scrollingText", label: "Display Scrolling Text", icon: "fa-text", fields: [field("text", "Text", "text", "Affected!"), field("color", "Color", "color", "#ffffff"), field("duration", "Duration (ms)", "number", 2000, {min: 100})]},
  {type: "executeMacro", label: "Execute Macro", icon: "fa-code", fields: [field("macroUuid", "Macro UUID", "uuid")]},
  {type: "executeScript", label: "Execute Script", icon: "fa-code", fields: [field("script", "Script", "script", "// Available: token, actor, region, item, event\n")]},
  {type: "move", label: "Move", icon: "fa-arrows-up-down-left-right", fields: [field("mode", "Direction", "select", "away", {options: [["away", "Away from region"], ["toward", "Toward region"], ["direction", "Fixed direction"]]}), field("distance", 'Distance (″)', "number", 1, {min: 0}), field("direction", "Direction (degrees)", "number", 0), field("walls", "Respect walls", "checkbox", true)]},
  {type: "playSound", label: "Play Sound", icon: "fa-music", fields: [field("path", "Sound file", "audio"), field("volume", "Volume", "number", 0.5, {min: 0, max: 1, fractional: true}), field("loop", "Loop until region expires", "checkbox", false)]},
  {type: "removeEffect", label: "Remove Effect", icon: "fa-person-circle-minus", fields: [field("effect", "Effect name, UUID, status or flag", "flags")]},
  {type: "restrict", label: "Restrict", icon: "fa-ban", fields: [field("traits", "Traits", "traits", []), field("linkedAttributes", "Linked attributes", "hidden", []), field("rollFlags", "Restricted roll flags", "flags"), field("label", "Effect label", "text", "Restricted")]},
  {type: "requestRoll", label: "Request Roll", icon: "fa-clipboard-list", fields: [field("request", "Roll request", "rollRequest", {trait: "", tn: 4, flags: "", kind: "", attribute: "", recipients: [], name: ""})]},
  {type: "rollDice", label: "Roll Dice", icon: "fa-dice", fields: [field("formula", "Formula", "text", "1d6x"), field("flavor", "Chat label"), field("flags", "Roll flags", "flags"), field("rollMode", "Roll mode", "rollMode", "publicroll")]},
  {type: "rollTrait", label: "Roll Trait", icon: "fa-dice-d6", fields: [field("trait", "Attribute or skill", "trait", "agility"), field("modifier", "Modifier", "number", 0), field("tn", "Target number", "number", 4, {min: 1}), field("flags", "Roll flags", "flags"), field("prompt", "Show SWADE roll dialog", "checkbox", true), field("rollMode", "Roll mode", "rollMode", "publicroll")]},
  {type: "chatMessage", label: "Send Chat Message", icon: "fa-message", fields: [field("text", "Message", "textarea"), field("rollMode", "Visibility", "rollMode", "publicroll")]}
];
export const CAST_CHANGES = [
  {type: "changeTemplate", label: "Change Template", icon: "fa-shapes", castOnly: true, passive: true, fields: [
    field("replacements", "Template replacements", "shapeReplacements", Object.fromEntries(SHAPES.map(shape => [shape.key, ""]))),
    field("range", "Max placement range (″)", "number", "", {optional: true})
  ]},
  {type: "modifyExpiration", label: "Modify Expiration", icon: "fa-hourglass-half", castOnly: true, passive: true, fields: [
    field("expiration", "Expiration", "select", "", {options: [["", "Keep current expiration"], ["timed", "Use duration"], ["turn", "On current turn end"], ["placement", "Remove on placement"], ["never", "Does not expire"]]}),
    field("duration", "Duration", "number", "", {optional: true}),
    field("unit", "Duration type", "select", "", {options: [["", "Keep current duration type"], ...Object.keys(TIME_UNITS).map(unit => [unit, unit])]})
  ]},
  {type: "adjustDuration", label: "Adjust Duration", icon: "fa-hourglass-half", castOnly: true, passive: true, fields: [
    field("scope", "Apply to", "select", "template", {options: [["template", "Template expiration"], ["power", "Power timer"]]}),
    field("operation", "Operation", "select", "override", {options: [["override", "Override"], ["add", "Add"], ["subtract", "Subtract"]]}),
    field("amount", "Amount", "wholeDuration", 1),
    field("unit", "Duration unit", "select", "", {options: [["", "Current unit"], ...Object.keys(TIME_UNITS).map(unit => [unit, unit])]})
  ]},
  {type: "increaseDieType", label: "Increase Die Type", icon: "fa-dice-d12", castOnly: true, passive: true, fields: [
    field("scope", "Dice to increase", "select", "base", {options: [["base", "Base Die Set"], ["all", "All Dice"]]}),
    field("steps", "Die steps (up to d12)", "number", 1)
  ]},
  {type: "addDamageDice", label: "Add Damage Dice", icon: "fa-dice", castOnly: true, passive: true, fields: [field("formula", "Damage formula to add", "text", "1d6")]}
];
export const CAST_CATALOG = [...CATALOG, ...CAST_CHANGES];
export function defaultBehavior(type) {
  const def = CAST_CATALOG.find(d => d.type === type);
  if (!def) throw new Error(`Unknown behavior: ${type}`);
  const entry = {id: id(), type, enabled: true, collapsed: false, label: "", triggers: [["addEffect", "restrict"].includes(type) ? "whileWithin" : "tokenEnter"], target: "all", requiredFlags: "", excludedFlags: "", system: Object.fromEntries(def.fields.map(f => [f.key, clone(f.default)]))};
  return entry;
}
export const BEHAVIOR_TARGETS = [["all", "All tokens"], ["allies", "Allies"], ["enemies", "Enemies"], ["placer", "Placer"]];
const templateChangeFields = [
  field("shape", "Template shape", "select", "small", {options: SHAPES.map(shape => [shape.key, shape.label])}),
  field("size", "Size (″)", "number", 1),
  field("width", "Stream or ring width (″)", "number", 1),
  field("placementRange.enabled", "Limit placement range", "checkbox", true),
  field("placementRange.max", "Max placement range (″)", "number", 1),
  field("expiration.enabled", "Region expires", "checkbox", true),
  field("expiration.amount", "Duration", "number", 5),
  field("expiration.unit", "Duration type", "select", "rounds", {options: Object.keys(TIME_UNITS).map(unit => [unit, unit])}),
  field("expiration.currentTurnEnd", "On current turn end", "checkbox", true),
  field("expiration.removeOnPlacement", "Remove on placement", "checkbox", true)
];
const variantFieldTypes = new Set(["checkbox", "color", "flags", "number", "rollMode", "select", "text", "textarea", "trait", "uuid"]);
export function variantFields(automation, target) {
  if (target === "template") return templateChangeFields;
  const behavior = automation.behaviors.find(entry => entry.id === target);
  if (!behavior) return [];
  const definition = CATALOG.find(def => def.type === behavior.type);
  const fields = [field("enabled", "Enable behavior", "checkbox", true)];
  if (!definition.passive) fields.push(
    field("target", "Targets", "select", "all", {options: BEHAVIOR_TARGETS}),
    field("requiredFlags", "Required target flags", "flags"),
    field("excludedFlags", "Excluded target flags", "flags")
  );
  return fields.concat(definition.fields.filter(f => variantFieldTypes.has(f.type)).map(f => ({
    ...f, key: `system.${f.key}`, dice: f.key === "formula"
  })));
}
export function variantOperations(field) {
  const operations = [["set", "Set"]];
  if (field.type === "flags" || field.type === "number" || field.dice) operations.push(["add", "Add"]);
  if (field.type === "flags") operations.push(["remove", "Remove"]);
  return operations;
}
function normalizeChanges(automation, raw, seen) {
  if (!Array.isArray(raw)) return [];
  // An old list could have 100 cards, each splitting into up to four changes.
  const limit = 400;
  return raw.slice(0, limit).flatMap(change => {
    const definition = CAST_CATALOG.find(def => def.type === change?.type);
    if (definition) {
      const entry = normalizeBehavior(change, definition);
      if (entry.type === "changeTemplate") {
        const previous = change.system?.replacements ? "" : change.system?.shape;
        for (const shape of SHAPES) {
          const value = previous && automation.shapes.includes(shape.key) ? previous : entry.system.replacements[shape.key];
          entry.system.replacements[shape.key] = SHAPES.some(s => s.key === value && s.key !== shape.key) ? value : "";
        }
      }
      if (entry.type === "addDamageDice") {
        const count = change.system?.legacyCount ?? change.system?.count;
        if (!change.system?.formula?.trim?.() && (typeof count === "string" || Number.isFinite(count))) {
          entry.system.formula = "";
          entry.system.legacyCount = count;
        }
      }
      if (typeof change.replaces === "string" && automation.behaviors.some(b => b.id === change.replaces)) entry.replaces = change.replaces;
      assignBehaviorId(entry, seen);
      return entry.type === "changeTemplate" ? migrateTemplateChange(entry, change.system ?? {}, seen) : [entry];
    }
    const field = variantFields(automation, change?.target).find(field => field.key === change?.field);
    if (!field) return [];
    const {value} = change;
    const valid = field.options ? field.options.some(([key]) => key === value)
      : field.type === "number" ? typeof value === "string" || Number.isFinite(value)
      : typeof value === typeof field.default;
    if (!valid) return [];
    const operation = variantOperations(field).some(([key]) => key === change.operation) ? change.operation : "set";
    return [{target: change.target, field: change.field, operation, value}];
  }).slice(0, limit);
}

function migrateTemplateChange(entry, previous, seen) {
  // Keep dimensions from old cards as editable legacy field changes.
  const dimensions = [];
  if (entry.enabled) for (const key of ["size", "width"]) {
    const value = previous[key];
    if (Number.isFinite(value) || typeof value === "string" && value.trim()) dimensions.push({target: "template", field: key, operation: "set", value});
  }
  if ([previous.expiration, previous.duration, previous.unit].every(value => value === undefined || value === "")) return [entry, ...dimensions];
  const definition = CAST_CHANGES.find(def => def.type === "modifyExpiration");
  const expiration = normalizeBehavior({...entry, type: definition.type, system: previous}, definition);
  if (Object.values(expiration.system).every(value => value === "")) return [entry, ...dimensions];
  const keepTemplate = entry.system.range !== "" || Object.values(entry.system.replacements).some(Boolean);
  if (!keepTemplate) return [...dimensions, expiration];
  expiration.id = `${entry.id.slice(0, 53)}-expiration`;
  expiration.label = "";
  assignBehaviorId(expiration, seen);
  return [entry, ...dimensions, expiration];
}
function mergeDefaults(base, source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return base;
  for (const key of Object.keys(base)) {
    if (!Object.hasOwn(source, key)) continue;
    const value = source[key];
    if (Array.isArray(base[key])) { if (Array.isArray(value)) base[key] = clone(value); }
    else if (base[key] && typeof base[key] === "object") mergeDefaults(base[key], value);
    else if (typeof base[key] === typeof value || typeof base[key] === "number" && typeof value === "string") base[key] = value;
  }
  return base;
}
function normalizeBehavior(source, definition) {
  const entry = mergeDefaults(defaultBehavior(definition.type), source);
  // Media configurations are native Foundry document data, not a fixed subset of fields.
  for (const f of definition.fields) {
    const value = source.system?.[f.key];
    if (["light", "sound", "tile", "wall"].includes(f.type) && value && typeof value === "object") entry.system[f.key] = clone(value);
    if ((f.optional && Number.isFinite(value)) || f.options?.some(([key]) => key === value)) entry.system[f.key] = value;
    else if (f.options && !f.options.some(([key]) => key === entry.system[f.key])) entry.system[f.key] = clone(f.default);
  }
  entry.triggers = entry.triggers.filter(t => TRIGGERS.some(([key]) => key === t));
  entry.target = BEHAVIOR_TARGETS.some(([key]) => key === entry.target) ? entry.target : "all";
  if (entry.type === "restrict") {
    if (typeof source.system?.traits === "string") entry.system.traits = splitList(source.system.traits);
    if (source.system?.restriction === "all") entry.system.traits = ["*"];
    if (source.system?.restriction === "movement") entry.enabled = false;
  }
  return entry;
}
function assignBehaviorId(entry, seen) {
  if (entry.id === "template" || !/^[a-z0-9_-]{1,64}$/i.test(entry.id) || seen.has(entry.id)) entry.id = id();
  seen.add(entry.id);
}
export const defaultCostOption = (key = "base") => ({id: key, label: "", cost: 0, changes: []});
export function variantLists(automation) {
  return [...(automation.raises ?? []), ...(automation.modifiers ?? []).flatMap(modifier => modifier.options ?? [modifier])];
}
export function configuredBehaviors(automation) {
  return [...automation.behaviors, ...variantLists(automation).flatMap(option => (option.changes ?? []).filter(change => change.type))];
}
export function normalizeAutomation(raw, item = null) {
  const result = mergeDefaults(defaultAutomation(item), raw);
  result.shapes = [...new Set(result.shapes.filter(s => SHAPES.some(d => d.key === s)))];
  result.expiration.unit = Object.hasOwn(TIME_UNITS, result.expiration.unit) ? result.expiration.unit : "rounds";
  result.wallRestriction.type = ["move", "sight", "sound", "light", "darkness"].includes(result.wallRestriction.type) ? result.wallRestriction.type : "move";
  const behaviors = Array.isArray(raw?.behaviors) ? raw.behaviors : [];
  const choiceChildren = new Set(behaviors.filter(b => b?.type === "choiceSet" && b.enabled && Array.isArray(b.system?.choices))
    .flatMap(b => b.system.choices.flatMap(choice => Array.isArray(choice?.behaviors) ? choice.behaviors : [])));
  result.behaviors = behaviors.filter(b => CATALOG.some(d => d.type === b?.type)).slice(0, 100).map(b => {
    const entry = normalizeBehavior(b, CATALOG.find(d => d.type === b.type));
    // Former choice-only actions need explicit enabling once the choice is removed.
    if (choiceChildren.has(entry.id)) entry.enabled = false;
    return entry;
  });
  const seen = new Set();
  for (const entry of result.behaviors) assignBehaviorId(entry, seen);
  const levels = new Set();
  result.raises = result.raises.slice(0, 100).flatMap(raise => {
    if (!Number.isSafeInteger(raise?.level) || raise.level < 1 || levels.has(raise.level)) return [];
    levels.add(raise.level);
    return [{id: typeof raise.id === "string" && /^[a-z0-9_-]{1,64}$/i.test(raise.id) ? raise.id : `raise-${raise.level}`,
      level: raise.level, mode: ["extend", "replace"].includes(raise.mode) ? raise.mode : "auto", changes: normalizeChanges(result, raise.changes, seen)}];
  }).sort((a, b) => a.level - b.level);
  const modifierIds = new Set();
  result.modifiers = result.modifiers.slice(0, 100).flatMap(modifier => {
    if (!modifier || typeof modifier !== "object") return [];
    const validId = typeof modifier.id === "string" && /^[a-z0-9_-]{1,64}$/i.test(modifier.id);
    const key = validId && !modifierIds.has(modifier.id) ? modifier.id : id();
    modifierIds.add(key);
    const description = typeof modifier.description === "string" ? modifier.description : "";
    const entry = {id: key, name: typeof modifier.name === "string" ? modifier.name.trim() : "",
      description: globalThis.foundry?.utils?.cleanHTML?.(description) ?? description};
    const ids = new Set();
    const options = (Array.isArray(modifier.options) ? modifier.options : []).filter(option => option && typeof option === "object").slice(0, 100);
    const legacy = options.some(option => Array.isArray(option.changes)) ? [] : modifier.changes;
    entry.options = options.map(option => {
      const optionId = typeof option.id === "string" && /^[a-z0-9_-]{1,64}$/i.test(option.id) && !ids.has(option.id) ? option.id : id();
      ids.add(optionId);
      return {id: optionId, label: typeof option.label === "string" ? option.label : "", cost: Number.isFinite(Number(option.cost)) ? Number(option.cost) : 0,
        changes: normalizeChanges(result, option.changes ?? legacy, seen)};
    });
    if (!entry.options.length) entry.options.push({...defaultCostOption(), changes: normalizeChanges(result, legacy, seen)});
    return [entry];
  });
  return result;
}
export function readAutomation(item) { return normalizeAutomation(item?.getFlag?.(MODULE_ID, "automation"), item); }

// Apply edits made in an open builder without overwriting changes saved in the power sheet.
export function mergeModifierDraft(baseline, draft, saved) {
  return mergeRows(baseline, draft, saved, ["name", "description"], "options");
}
export function mergeRaiseDraft(baseline, draft, saved) {
  return mergeRows(baseline, draft, saved, ["level", "mode", "changes"]);
}

export const isPowerDurationChange = change => change?.type === "adjustDuration" && change.system?.scope === "power";

function mergeScopedChanges(before, draft, saved) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const power = draft.filter(isPowerDurationChange);
  const template = draft.filter(change => !isPowerDurationChange(change));
  const nextPower = same(power, before.filter(isPowerDurationChange)) ? saved.filter(isPowerDurationChange) : power;
  const nextTemplate = same(template, before.filter(change => !isPowerDurationChange(change)))
    ? saved.filter(change => !isPowerDurationChange(change)) : template;
  return same(power, nextPower) && same(template, nextTemplate) ? draft : [...nextTemplate, ...nextPower];
}
function mergeRows(baseline, draft, saved, fields, nested) {
  const before = new Map(baseline.map(entry => [entry.id, entry]));
  const current = new Map(saved.map(entry => [entry.id, entry]));
  const local = new Set(draft.map(entry => entry.id));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  return [...draft.flatMap(entry => {
    const old = before.get(entry.id);
    if (!old) return [entry];
    const latest = current.get(entry.id);
    if (!latest) return equal(entry, old) ? [] : [entry];
    const result = {...latest};
    for (const key of fields) {
      if (!equal(entry[key], old[key])) result[key] = key === "changes"
        ? mergeScopedChanges(old[key] ?? [], entry[key] ?? [], latest[key] ?? []) : entry[key];
    }
    if (nested) result[nested] = mergeRows(old[nested], entry[nested], latest[nested], ["label", "cost", "changes"]);
    return [result];
  }), ...saved.filter(entry => !before.has(entry.id) && !local.has(entry.id))];
}
export function getRingTemplates(item) {
  const selected = item?.getFlag?.(MODULE_ID, "automation")?.shapes;
  return SHAPES.filter(shape => shape.type === "ring" && (
    Array.isArray(selected) ? selected.includes(shape.key) : itemTemplateSelected(item, shape)
  ));
}
export function exportAutomation(automation, name = "Template") { return JSON.stringify({module: MODULE_ID, version: 1, name, automation: normalizeAutomation(automation)}, null, 2); }
export function importAutomation(text) {
  if (text.length > 2_000_000) throw new Error("Template files must be smaller than 2 MB.");
  const parsed = JSON.parse(text);
  if (parsed.module && parsed.module !== MODULE_ID) throw new Error("This file is not a SWADE Better Templates automation.");
  if ((parsed.version ?? 1) > 1) throw new Error("This template needs a newer version of Better Templates.");
  const raw = parsed.automation ?? parsed;
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.behaviors)) throw new Error("Invalid template automation file.");
  return normalizeAutomation(raw);
}
export function durationSeconds(expiration) { return expiration.enabled && !expiration.removeOnPlacement ? expiration.amount * TIME_UNITS[expiration.unit] : null; }
export function trackerEntryVisible(entry, sceneId, isGM) { return !!sceneId && entry?.sceneId === sceneId && (isGM || !entry.hiddenFromPlayers); }
export function combatExpiry(expiration, combat) {
  if (!expiration.enabled || expiration.removeOnPlacement || !combat?.started) return null;
  const rounds = expiration.currentTurnEnd ? 1 : Math.ceil(durationSeconds(expiration) / 6);
  return {combatId: combat.id, combatantId: combat.combatant?.id ?? null, round: combat.round + (expiration.currentTurnEnd ? 0 : rounds), turn: combat.turn, currentTurnEnd: expiration.currentTurnEnd, remainingRounds: rounds, totalRounds: rounds};
}
export function combatHasExpired(schedule, combat) {
  if (!schedule || schedule.combatId !== combat?.id) return false;
  if (combat.round > schedule.round) return true;
  if (combat.round < schedule.round) return false;
  const index = combat.turns?.findIndex(c => c.id === schedule.combatantId);
  const turn = index >= 0 ? index : schedule.turn;
  return schedule.currentTurnEnd ? combat.turn > turn : combat.turn >= turn;
}
