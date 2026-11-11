import {applyDamageAdjustment, damagePlan, damageState} from "../../swade-better-setting/scripts/damage-dice.mjs";
import {CAST_CHANGES, SHAPES, TIME_UNITS, clone, defaultBehavior, escapeHTML as E, getPath, isPowerDurationChange, normalizeName, setPath, splitList, variantFields} from "./data.mjs";
import {numericFormula} from "./formulas.mjs";

export function hasCastOptions(automation) {
  return automation.enabled && (automation.raises.length > 0 || automation.modifiers.some(hasModifierChanges));
}

const hasModifierChanges = modifier => modifier.options.some(option => option.changes.length);
const castOnly = new Set(CAST_CHANGES.map(change => change.type));
const primaryActions = new Set(["rollDamage", "rollDice", "rollTrait", "requestRoll", "executeMacro", "executeScript", "move"]);

function castSelection(automation, choices = {}) {
  const baseShape = automation.shapes.includes(choices.baseShape) ? choices.baseShape : null;
  const raised = automation.raises.find(entry => entry.level === choices.raise);
  const requested = Array.isArray(choices.modifiers) ? choices.modifiers : [];
  const modifiers = automation.modifiers.flatMap(modifier => {
    if (!requested.includes(modifier.id) || !hasModifierChanges(modifier)) return [];
    const requestedOption = Object.hasOwn(choices.modifierOptions ?? {}, modifier.id) ? choices.modifierOptions[modifier.id] : null;
    const option = requestedOption == null ? modifier.options[0] : modifier.options.find(entry => entry.id === requestedOption);
    return option ? [{modifier, option}] : [];
  });
  return {raised, modifiers, choices: {baseShape, raise: raised?.level ?? 0, modifiers: modifiers.map(({modifier}) => modifier.id),
    modifierOptions: Object.fromEntries(modifiers.map(({modifier, option}) => [modifier.id, option.id]))}};
}

function orderedChanges({raised, modifiers}) {
  const groups = modifiers.map(({modifier, option}) => ({
    source: [modifier.name || "Modifier", option.label].filter(Boolean).join(" · "), changes: option.changes
  }));
  if (raised) groups.push({source: `Raised ${raised.level}`, changes: raised.changes});
  return groups.flatMap(({source, changes}) => changes.map(change => ({source, change})));
}

const replacementFor = (change, baseShape) => change.type === "changeTemplate" && change.enabled
  ? change.system.replacements?.[baseShape] : !change.type && change.target === "template" && change.field === "shape" ? change.value : "";

export function hasTemplateReplacements(automation) {
  const changes = [...automation.raises, ...automation.modifiers.flatMap(modifier => modifier.options)].flatMap(option => option.changes);
  return hasCastOptions(automation) && automation.shapes.some(base => changes.some(change => replacementFor(change, base)));
}

export function projectCastTemplates(automation, selection) {
  const changes = orderedChanges(castSelection(automation, selection));
  return SHAPES.filter(shape => automation.shapes.includes(shape.key)).map(({key: baseShape}) => {
    const key = changes.reduce((key, {change}) => replacementFor(change, baseShape) || key, baseShape);
    return {baseShape, shape: SHAPES.find(shape => shape.key === key)};
  });
}

export function resolveCastOptions(automation, selection = {}, {item, actor = item?.actor} = {}) {
  const {raised, modifiers, choices} = castSelection(automation, selection);
  const {baseShape} = choices;
  const resolved = clone(automation);
  resolved.raises = [];
  resolved.modifiers = [];
  const replace = raised && (raised.mode === "replace" || raised.mode !== "extend" && raised.changes.some(change => change.enabled && !change.replaces && primaryActions.has(change.type)));
  if (replace) resolved.behaviors = [];
  let shapeKey = baseShape;
  const dimensions = {};
  const damageStates = new Map();
  function apply(change, source) {
    shapeKey = replacementFor(change, baseShape) || shapeKey;
    if (change.type) {
      if (!change.enabled) return;
      if (change.type === "changeTemplate") {
        const {range} = change.system;
        if (range !== "") Object.assign(resolved.placementRange, {enabled: true, max: range});
      } else if (change.type === "modifyExpiration") {
        const {duration, unit, expiration} = change.system;
        if (duration !== "") resolved.expiration.amount = duration;
        if (unit) resolved.expiration.unit = unit;
        if (expiration) Object.assign(resolved.expiration, {enabled: expiration !== "never", currentTurnEnd: expiration === "turn", removeOnPlacement: expiration === "placement"});
      } else if (change.type === "adjustDuration" && !isPowerDurationChange(change)) {
        const {operation, amount} = change.system;
        if (!Number.isSafeInteger(amount) || amount < 0) return;
        const expiration = resolved.expiration;
        const unit = change.system.unit || expiration.unit;
        if (operation === "override") {
          Object.assign(expiration, {amount, unit, enabled: true, currentTurnEnd: false, removeOnPlacement: amount === 0});
        } else if (expiration.enabled && !expiration.currentTurnEnd && (!expiration.removeOnPlacement || expiration.amount === 0)) {
          const seconds = Math.max(0, numericFormula(expiration.amount, actor, {min: 0}) * TIME_UNITS[expiration.unit]
            + (operation === "subtract" ? -amount : amount) * TIME_UNITS[unit]);
          const value = seconds / TIME_UNITS[expiration.unit];
          expiration.amount = Number.isInteger(value) ? value : seconds;
          if (!Number.isInteger(value)) expiration.unit = "seconds";
          expiration.removeOnPlacement = seconds === 0;
        }
      } else if (change.type === "addDamageDice" || change.type === "increaseDieType") {
        if (!isDamageAdjustment(change)) return;
        let damage = resolved.behaviors.filter(entry => entry.enabled && entry.type === "rollDamage");
        if (!damage.length) {
          const normal = automation.behaviors.filter(entry => entry.enabled && entry.type === "rollDamage");
          damage = normal.map(clone);
          if (!damage.length && item?.system?.damage?.trim?.()) {
            const base = defaultBehavior("rollDamage");
            damage = [{...base, id: "cast-damage", triggers: ["onPlace"], system: {...base.system, formula: item.system.damage, ap: item.system.ap ?? 0}}];
          }
          resolved.behaviors.push(...damage);
        }
        for (const entry of damage) {
          if (!damageStates.has(entry)) damageStates.set(entry, damageState(entry.system.formula));
          const state = damageStates.get(entry);
          applyDamageAdjustment(state, change, source, (value, max) => numericFormula(value, actor, {min: 0, max}));
          entry.system.formula = damagePlan(state).formula;
          if (state.adjustments.length) entry.damageAdjustments = state.adjustments;
        }
      }
      return;
    }
    const field = variantFields(automation, change.target).find(field => field.key === change.field);
    if (!field) return;
    if (change.target !== "template") {
      const behavior = resolved.behaviors.find(behavior => behavior.id === change.target);
      if (behavior) {
        const current = getPath(behavior, field.key);
        const value = changedValue(current, change, field);
        setPath(behavior, field.key, value);
        if (behavior.type === "rollDamage" && field.dice && value !== current) {
          const state = damageState(value);
          const earlier = change.operation === "set" ? [] : (behavior.damageAdjustments ?? []);
          state.adjustments.push(...earlier, {source, label: "Modify Damage", before: current, after: value});
          behavior.damageAdjustments = state.adjustments;
          damageStates.set(behavior, state);
        }
      }
    } else if (field.key === "size" || field.key === "width") {
      const shape = SHAPES.find(shape => shape.key === shapeKey);
      const baseline = field.key === "size" ? shape?.radius ?? shape?.length : shape?.width ?? shape?.outerWidth;
      dimensions[field.key] = changedValue(dimensions[field.key] ?? baseline ?? 1, change, field);
    } else if (field.key !== "shape") {
      setPath(resolved, field.key, changedValue(getPath(resolved, field.key), change, field));
    }
  }
  // Assemble the chosen behaviors before applying dice changes, even when a dice change is listed first.
  function addBehaviors(changes, replacingList = false) {
    for (const change of changes) {
      if (!change.type || castOnly.has(change.type)) continue;
      if (!change.replaces || replacingList) resolved.behaviors.push(clone(change));
      else if (change.enabled) {
        const index = resolved.behaviors.findIndex(entry => entry.id === change.replaces);
        if (index !== -1) resolved.behaviors[index] = {...clone(change), id: change.replaces};
      }
    }
  }
  addBehaviors(raised?.changes ?? [], replace);
  for (const {option} of modifiers) addBehaviors(option.changes);
  for (const {change, source} of orderedChanges({raised, modifiers})) apply(change, source);
  return {automation: resolved, shapeKey, dimensions, choices};
}

export function hasCastDamageAdjustments(automation) {
  return [...automation.raises, ...automation.modifiers.flatMap(modifier => modifier.options)]
    .some(option => option.changes.some(isDamageAdjustment));
}

export function projectCastDamage(automation, selection, formula, actor, powerChanges = []) {
  return projectDamageChanges([...orderedChanges(castSelection(automation, selection)), ...powerChanges], formula, actor);
}

export function projectDamageChanges(changes, formula, actor) {
  const state = damageState(formula);
  for (const {change, source} of changes) {
    if (isDamageAdjustment(change)) applyDamageAdjustment(state, change, source, (value, max) => numericFormula(value, actor, {min: 0, max}));
  }
  return damagePlan(state);
}

function isDamageAdjustment(change) {
  if (!change.enabled) return false;
  return change.type === "increaseDieType" || change.type === "addDamageDice"
    && (change.system.formula.trim() || change.system.legacyCount !== undefined);
}

function changedValue(current, {operation, value}, field) {
  if (operation === "set") return value;
  if (field.type === "flags") {
    const flags = splitList(value);
    if (operation === "remove") {
      const excluded = new Set(flags.map(flag => flag.toLowerCase()));
      return splitList(current).filter(flag => !excluded.has(flag.toLowerCase())).join(", ");
    }
    return splitList([...splitList(current), ...flags]).join(", ");
  }
  return `(${current}) + (${value})`;
}

export function castDefaults(automation, castContext) {
  const selectedModifiers = new Set(Array.isArray(castContext?.modifiers) ? castContext.modifiers.map(normalizeName).filter(Boolean) : []);
  const selected = automation.modifiers.filter(modifier => selectedModifiers.has(normalizeName(modifier.id)) || selectedModifiers.has(normalizeName(modifier.name)));
  const raise = automation.raises.findLast(entry => entry.level <= (castContext?.raises ?? 0)
    && (entry.mode === "replace" || entry.changes.some(change => !isPowerDurationChange(change))))?.level ?? 0;
  return castSelection(automation, {raise, modifiers: selected.map(modifier => modifier.id), modifierOptions: Object.fromEntries(selected.map(modifier => {
    const optionId = Object.hasOwn(castContext?.modifierOptions ?? {}, modifier.id) ? castContext.modifierOptions[modifier.id]
      : modifier.options.find(option => selectedModifiers.has(normalizeName(option.id)) || selectedModifiers.has(normalizeName(`${option.id}-max`)))?.id;
    return [modifier.id, modifier.options.find(option => option.id === optionId)?.id ?? modifier.options[0].id];
  }))}).choices;
}

export async function chooseCastOptions(automation, title, baseShape, {chooseShape = false, castContext, initialChoices, forCard = false} = {}) {
  const levels = automation.raises.map(raise => raise.level);
  const modifiers = automation.modifiers.filter(hasModifierChanges);
  const earned = level => level > 0 && level <= (castContext?.raises ?? 0);
  const initial = initialChoices ? castSelection(automation, initialChoices).choices : castDefaults(automation, castContext);
  const shapeOptions = chooseShape ? `<div class="form-group"><label for="sbt-cast-shape">Base shape</label><div class="form-fields">
    <select id="sbt-cast-shape" name="baseShape">${SHAPES.filter(shape => automation.shapes.includes(shape.key)).map(shape =>
      `<option value="${shape.key}" ${shape.key === baseShape ? "selected" : ""}>${E(shape.label)}</option>`).join("")}</select>
    </div></div>` : "";
  const raiseOptions = levels.length ? `<fieldset><legend>Raise</legend>${[0, ...levels].map(level =>
    `<label class="sbt-checkbox-label${earned(level) ? " sbt-earned-raise" : ""}"><input type="radio" name="raise" value="${level}" ${level === initial.raise ? "checked" : ""}>
    <span>${level === 0 ? "Normal" : `Raised ${level}`}</span>${earned(level) ? '<i class="fa-solid fa-bullseye" title="Earned by this casting" aria-label="Earned by this casting"></i>' : ""}</label>`).join("")}</fieldset>` : "";
  const modifierOptions = modifiers.length ? `<fieldset><legend>Modifiers</legend>${modifiers.map((modifier, index) => {
    const label = modifier.name || `Modifier ${index + 1}`;
    const requestedOption = initial.modifierOptions[modifier.id];
    const optionLabel = (option, i) => `${option.label || (i === 0 ? "Default" : `Option ${i + 1}`)} (${option.cost} PP)`;
    return `<div class="sbt-cast-modifier"><label class="sbt-checkbox-label"><input type="checkbox" name="modifier" value="${E(modifier.id)}" ${initial.modifiers.includes(modifier.id) ? "checked" : ""}>
    <span>${E(label)}</span></label>${modifier.options.length > 1 ? `<select name="option.${E(modifier.id)}" aria-label="${E(label)} option">
      ${modifier.options.map((option, i) => `<option value="${E(option.id)}" ${option.id === requestedOption ? "selected" : ""}>${E(optionLabel(option, i))}</option>`).join("")}</select>`
      : `<span>${E(optionLabel(modifier.options[0], 0))}</span>`}</div>`;
  }).join("")}</fieldset>` : "";
  const selected = await foundry.applications.api.DialogV2.wait({
    classes: ["sbt-library-dialog"],
    window: {title: forCard ? `Cast options: ${title}` : `Place ${title}`},
    content: `<div class="standard-form sbt-cast-options">${shapeOptions}${raiseOptions}${modifierOptions}</div>`,
    buttons: [
      {action: "place", label: forCard ? "Apply" : "Place template", default: true, callback: (_event, button) => {
        const data = new FormData(button.form);
        const modifiers = data.getAll("modifier");
        return {baseShape: data.get("baseShape") ?? baseShape, raise: Number(data.get("raise")), modifiers,
          modifierOptions: Object.fromEntries(modifiers.map(id => [id, data.get(`option.${id}`)]).filter(([, option]) => option !== null))};
      }},
      {action: "cancel", label: "Cancel"}
    ],
    rejectClose: false
  });
  return selected && typeof selected === "object" ? selected : null;
}

export function templateShapeData(shape, grid, dimensions = {}, actor = null, origin = {x: 0, y: 0}) {
  const scale = grid.size / grid.distance;
  const size = numericFormula(dimensions.size ?? shape.radius ?? shape.length, actor, {min: 1}) * scale;
  const {x, y} = origin;
  const data = {type: shape.type, x, y};
  if (shape.type === "line" || shape.type === "ring") {
    const width = numericFormula(dimensions.width ?? shape.width ?? shape.outerWidth, actor, {min: 1}) * scale;
    if (shape.type === "line") return {...data, length: size, width, rotation: origin.rotation ?? 0};
    return {...data, radius: size, innerWidth: 0, outerWidth: width};
  }
  if (shape.type === "cone") return {...data, radius: size, angle: shape.angle, curvature: "semicircle", rotation: origin.rotation ?? 0};
  return {...data, radius: size};
}
