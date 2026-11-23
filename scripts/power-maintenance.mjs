import {MODULE_ID, combatExpiry} from "./data.mjs";
import {combatIncludesScene} from "./turn-triggers.mjs";

const POWERS = "swade-better-powers";
export function linkedPowerTimer(item, region) {
  if (!game.modules.get(POWERS)?.active || !item.actor) return null;
  const message = game.messages.get(region.getFlag(MODULE_ID, "chatMessageId"));
  const cast = message && game.modules.get(POWERS).api?.getCastContext(message);
  const castId = message?.getFlag(POWERS, "maintainedCast") ?? cast?.id;
  if (castId && (!cast || cast.itemUuid === item.uuid)) {
    const timer = item.actor.effects.get(castId);
    if (!timer || timer.origin === item.uuid) return `${item.actor.uuid}.ActiveEffect.${castId}`;
    return null;
  }
  if (cast && cast.itemUuid !== item.uuid) return null;
  const timers = item.actor.effects.filter(effect => effect.origin === item.uuid && effect.getFlag(POWERS, "timedPower") && !effect.disabled);
  return timers.sort((a, b) => (b.start?.time ?? 0) - (a.start?.time ?? 0))[0]?.uuid ?? null;
}

export function hasActivePowerTimer(managed) {
  const timer = managed.powerTimerUuid && foundry.utils.fromUuidSync(managed.powerTimerUuid);
  // The cast timer owns the maintenance decision. Its clock may reach expiry
  // after the region's clock, especially when cast during another actor's turn.
  // Keep the region until the owner maintains or ends this cast.
  return !!timer && !timer.disabled;
}

export function refreshedTemplateTiming(managed, now, combat) {
  const seconds = managed.durationSeconds;
  return {placedAt: now, expiresAt: seconds == null ? null : now + seconds,
    combatExpiration: combatExpiry(managed.resolvedAutomation.expiration, combat)};
}

export function registerPowerMaintenance({isActiveGM, deleteRegion}) {
  const regionsFor = effect => game.scenes.contents.flatMap(scene => scene.regions.filter(region => region.getFlag(MODULE_ID, "managed")?.powerTimerUuid === effect.uuid));
  Hooks.on("updateActiveEffect", (effect, changes) => {
    if (!isActiveGM() || !effect.getFlag(POWERS, "timedPower")) return;
    const changed = foundry.utils.hasProperty(changes, `flags.${POWERS}.maintenance`) || Object.hasOwn(changes, `flags.${POWERS}.maintenance`);
    if (!changed || effect.duration.expired) return;
    const period = Number(effect.getFlag(POWERS, "maintenance") || 0);
    for (const region of regionsFor(effect)) {
      const managed = region.getFlag(MODULE_ID, "managed");
      if (period <= (managed.powerMaintenance ?? 0)) continue;
      const combat = game.combats.find(combat => combat.started && combatIncludesScene(combat, region.parent.id));
      void region.update({[`flags.${MODULE_ID}.managed`]: {...managed, ...refreshedTemplateTiming(managed, game.time.worldTime, combat), powerMaintenance: period}})
        .catch(error => console.error(`${MODULE_ID} | Maintain template`, error));
    }
  });
  Hooks.on("deleteActiveEffect", effect => {
    if (!isActiveGM() || !effect.getFlag(POWERS, "timedPower")) return;
    for (const region of regionsFor(effect)) void deleteRegion(region.uuid).catch(error => console.error(`${MODULE_ID} | Expire maintained template`, error));
  });
}

export async function restorePowerTimerLink(region, item) {
  const managed = region.getFlag(MODULE_ID, "managed");
  if (!managed || managed.powerTimerUuid || !item) return;
  const uuid = linkedPowerTimer(item, region);
  if (!uuid) return;
  const timer = foundry.utils.fromUuidSync(uuid);
  await region.update({[`flags.${MODULE_ID}.managed.powerTimerUuid`]: uuid,
    [`flags.${MODULE_ID}.managed.powerMaintenance`]: Number(timer?.getFlag(POWERS, "maintenance") || 0)});
}
