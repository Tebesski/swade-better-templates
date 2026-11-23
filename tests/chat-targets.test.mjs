import test from "node:test";
import assert from "node:assert/strict";
import {addPlacementTargetsToMessage, mergePlacementTargets} from "../scripts/chat-targets.mjs";

test("placement adds card targets without duplicates or losing existing targets", () => {
  const original = [{uuid: "old", name: "Old", result: "hit"}];
  assert.deepEqual(mergePlacementTargets(original, [{uuid: "old", name: "Updated"}, {uuid: "new", name: "New"}]),
    [{uuid: "old", name: "Updated", result: "hit"}, {uuid: "new", name: "New"}]);
  assert.equal(original[0].name, "Old");
});

test("placement persists targets and effect context only on an authorized source card", async () => {
  const previous = globalThis.game;
  let allowed = true;
  const updates = [];
  const message = {testUserPermission: () => allowed, getFlag: (scope) => scope === "swade" ? [{uuid: "existing", name: "Existing"}] : {targetUuids: ["existing"]},
    update: async data => updates.push(data)};
  globalThis.game = {messages: new Map([["card", message]])};
  try {
    await addPlacementTargetsToMessage("card", [{uuid: "placed", name: "Placed"}], {});
    assert.deepEqual(updates[0]["flags.swade.targets"].map(target => target.uuid), ["existing", "placed"]);
    assert.deepEqual(updates[0]["flags.swade-better-effects.context.targetUuids"], ["existing", "placed"]);
    allowed = false;
    await addPlacementTargetsToMessage("card", [{uuid: "other"}], {});
    assert.equal(updates.length, 1);
  } finally { globalThis.game = previous; }
});
