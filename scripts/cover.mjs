import {MODULE_ID, BEHAVIOR_TYPE} from "./data.mjs";
import {flagsMatch} from "./integrations.mjs";

export const COVER_LEVELS = Object.freeze({light: {label: "Light", penalty: -2}, medium: {label: "Medium", penalty: -4},
  heavy: {label: "Heavy", penalty: -6}, "near-total": {label: "Near Total", penalty: -8}});

// Compare region identities, not actor identities or cover levels. Overlaps use
// the strongest applicable cover rather than stacking several cover penalties.
export function coverAgainst(attackerZones, targetZones) {
  const shared = new Set(attackerZones.map(zone => zone.regionUuid));
  let best = null;
  let penalty = 0;
  for (const zone of targetZones) {
    const value = COVER_LEVELS[zone.level]?.penalty;
    if (value < penalty && !shared.has(zone.regionUuid)) {
      best = zone;
      penalty = value;
    }
  }
  return best;
}

const resolving = new Set();
export function tokenCoverZones(token) {
  token = token?.document ?? token;
  if (!token?.actor || resolving.has(token.uuid)) return [];
  resolving.add(token.uuid);
  try {
    const zones = [];
    for (const region of token.regions ?? []) {
      const behavior = region.behaviors.find(entry => entry.type === BEHAVIOR_TYPE && entry.active);
      if (!behavior?.system.automation?.enabled) continue;
      const placer = behavior.system.placerTokenUuid ? foundry.utils.fromUuidSync(behavior.system.placerTokenUuid) : null;
      for (const entry of behavior.system.automation.behaviors) {
        if (!entry.enabled || entry.type !== "addCover" || !COVER_LEVELS[entry.system.level]) continue;
        if (entry.target === "placer" && placer?.uuid !== token.uuid) continue;
        const ally = (placer?.disposition ?? 1) === token.disposition;
        if (entry.target === "allies" && !ally || entry.target === "enemies" && ally) continue;
        if (!flagsMatch(token, entry.requiredFlags, entry.excludedFlags, placer)) continue;
        zones.push({regionUuid: region.uuid, level: entry.system.level});
      }
    }
    return zones;
  } finally { resolving.delete(token.uuid); }
}

function sourceToken(actor, supplied) {
  return supplied?.document ?? supplied ?? actor?.token ?? actor?.getActiveTokens?.(false, true)?.find(token => token.object?.controlled)
    ?? actor?.getActiveTokens?.(false, true)?.[0];
}
function contextCover(context, target) {
  const attacker = context.tokenUuid ? foundry.utils.fromUuidSync(context.tokenUuid) : null;
  target = target?.document ?? target;
  if (!attacker || !target || attacker.parent?.id !== target.parent?.id) return null;
  return coverAgainst(tokenCoverZones(attacker), tokenCoverZones(target));
}
function isAttack(context) {
  const flags = context.roll ?? [];
  return context.rollType === "trait" && !flags.some(flag => ["support", "test", "opposed"].includes(flag))
    && flags.some(flag => ["attack", "weapon", "power", "shooting", "fighting", "throwing"].includes(flag));
}

export function registerCoverHooks() {
  Hooks.on("swadeBetterEffectsDocumentFlags", (doc, supplied, flags) => {
    const token = doc?.documentName === "Token" ? doc : doc?.documentName === "Actor" ? sourceToken(doc, supplied) : null;
    if (!token || resolving.has(token.uuid)) return;
    flags.push(...tokenCoverZones(token).map(zone => `${zone.level}-cover`));
  });
  Hooks.on("swadeBetterEffectsRollContext", context => {
    if (!isAttack(context)) return;
    for (const uuid of context.targetUuids ?? []) {
      const cover = contextCover(context, foundry.utils.fromUuidSync(uuid));
      if (!cover) continue;
      const flag = `${cover.level}-cover-penalty`;
      if (!context.attacker.includes(flag)) context.attacker.push(flag);
      if (!context.roll.includes(flag)) context.roll.push(flag);
    }
  });
  Hooks.on("swadeBetterEffectsTraitAdjustment", (context, token, result) => {
    if (!isAttack(context)) return;
    const cover = contextCover(context, token);
    if (!cover) return;
    const {label, penalty} = COVER_LEVELS[cover.level];
    result.applied.push({label: `${label} Cover`, value: penalty, flags: [`${cover.level}-cover-penalty`]});
    result.value += penalty;
  });
  // The same native modifier is available when Better Effects is disabled.
  Hooks.on("swadePreRollSkill", (actor, skill, _roll, modifiers, options = {}) => {
    if (game.modules.get("swade-better-effects")?.active) return;
    const item = options.item;
    const context = {rollType: "trait", roll: [skill.system?.swid ?? skill.name?.toLowerCase(), item?.type],
      tokenUuid: sourceToken(actor)?.uuid};
    if (!isAttack(context)) return;
    const cover = contextCover(context, game.user.targets.first()?.document);
    if (cover) modifiers.push({label: `${COVER_LEVELS[cover.level].label} Cover`, value: COVER_LEVELS[cover.level].penalty});
  });
  CONFIG.queries[`${MODULE_ID}.placementTargets`] = ({sceneId, tokenIds}, {user}) => {
    if (!user?.isGM || canvas.scene?.id !== sceneId) return;
    canvas.tokens.setTargets(tokenIds.filter(id => canvas.scene.tokens.has(id)));
  };
}

export function placementTokens(region) {
  // Region membership is updated asynchronously after creation. Test geometry
  // directly so an instant template does not capture an empty membership cache.
  return region.parent.tokens.filter(token => token.testInsideRegion(region));
}

export async function selectPlacementTokens(region, user, tokenIds = placementTokens(region).map(token => token.id)) {
  if (user.id === game.user.id) {
    if (canvas.scene?.id === region.parent.id) canvas.tokens.setTargets(tokenIds);
  } else if (user.active) await user.query(`${MODULE_ID}.placementTargets`, {sceneId: region.parent.id, tokenIds});
}
