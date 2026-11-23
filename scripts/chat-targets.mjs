const pending = new Map();

export function mergePlacementTargets(existing, tokens) {
  const targets = new Map((existing ?? []).map(target => [target.uuid, target]));
  for (const token of tokens) targets.set(token.uuid, {...targets.get(token.uuid), uuid: token.uuid, name: token.name});
  return [...targets.values()];
}

export async function addPlacementTargetsToMessage(messageId, tokens, user) {
  const message = game.messages.get(messageId);
  if (!message || !message.testUserPermission(user, "OWNER")) return;
  const previous = pending.get(messageId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const targets = mergePlacementTargets(message.getFlag("swade", "targets"), tokens);
    const update = {"flags.swade.targets": targets};
    const context = message.getFlag("swade-better-effects", "context");
    if (context) update["flags.swade-better-effects.context.targetUuids"] = [...new Set([...(context.targetUuids ?? []), ...targets.map(target => target.uuid)])];
    await message.update(update);
  });
  pending.set(messageId, next);
  try { await next; } finally { if (pending.get(messageId) === next) pending.delete(messageId); }
}
