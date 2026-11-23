export function behaviorEventMatches(entry, name) {
  if (name === "sbtPlacerTurnStart") return entry.turnStartSource === "placer" && entry.triggers.includes("tokenTurnStart");
  if (name === "tokenTurnStart" && entry.turnStartSource === "placer") return false;
  if (name === "sbtPlacerTurnEnd") return entry.turnEndSource === "placer" && entry.triggers.includes("tokenTurnEnd");
  if (name === "tokenTurnEnd" && entry.turnEndSource === "placer") return false;
  return entry.triggers.includes(name);
}

export function combatantScene(combat, combatant) {
  // An encounter may be unbound, even though each combatant has a scene token.
  return combatant?.token?.parent ?? combat?.scene ?? null;
}

export function combatIncludesScene(combat, sceneId) {
  if (combat.scene) return combat.scene.id === sceneId;
  return combat.combatants.some(combatant => combatant.sceneId === sceneId || combatant.token?.parent?.id === sceneId);
}
