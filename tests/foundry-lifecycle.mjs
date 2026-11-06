// Additional live checks for range, attachment, restrictions and scene deletion.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE, args: ["--enable-unsafe-swiftshader"]});
const prefix = `SBT lifecycle ${Date.now()}`;
let gm, player;
async function join(name) {
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  page.setDefaultTimeout(10000);
  await page.goto(process.env.FOUNDRY_QA_URL ?? "http://localhost:30001");
  await page.locator('select[name="userId"]').selectOption({label: name});
  await page.getByRole("button", {name: "Join Game Session", exact: true}).click();
  await page.waitForFunction(() => globalThis.game?.ready, null, {timeout: 20000});
  assert.equal(await page.evaluate(() => game.world.id), "templates-qa");
  await page.addStyleTag({content: "#notifications {pointer-events:none !important}"});
  return page;
}
try {
  gm = await join("Gamemaster");
  await gm.evaluate(async prefix => {
    const api = game.modules.get("swade-better-templates").api;
    globalThis.life = {api, prefix, errors: [], oldScrolling: game.settings.get("core", "scrollingStatusText")};
    await game.settings.set("core", "scrollingStatusText", false);
    life.scene = await Scene.create({name: prefix, width: 1600, height: 1200, padding: 0, grid: {size: 100, distance: 1}, ownership: {default: 2}});
    await life.scene.activate();
    await canvas.initializing;
    await life.scene.view();
    life.actor = await Actor.create({name: prefix, type: "npc"});
    [life.token] = await life.scene.createEmbeddedDocuments("Token", [{name: prefix, actorId: life.actor.id, actorLink: true, x: 400, y: 400}]);
    life.makeItem = async (name, automation) => (await life.actor.createEmbeddedDocuments("Item", [{name, type: "power", flags: {"swade-better-templates": {automation}}}]))[0];
    life.place = async (item, scene = life.scene, x = 450, radius = 120) => scene.createEmbeddedDocuments("Region", [{name: item.name, shapes: [{type: "circle", x, y: 450, radius}], levels: [scene.levels.contents[0].id], flags: {swade: {origin: item.uuid, preset: "sbt"}}}]);
  }, prefix);
  await gm.waitForFunction(() => canvas.ready && canvas.scene.id === life.scene.id && canvas.tokens.placeables.length === 1);
  assert.equal(await gm.evaluate(async () => {
    await life.actor.update({"system.attributes.spirit.die.sides": 12, "system.attributes.spirit.die.modifier": 1});
    const a = life.api.defaultAutomation(); a.shapes = ["small"]; a.expiration.enabled = false; a.placementRange = {enabled: true, max: "@spirit/12"};
    life.rangeItem = await life.makeItem(`${life.prefix} Range`, a);
    const outside = await life.place(life.rangeItem, life.scene, 1100);
    [life.inRange] = await life.place(life.rangeItem, life.scene, 660);
    return outside.length;
  }), 0);
  await gm.waitForFunction(() => life.inRange?.getFlag("swade-better-templates", "managed")?.initialized);
  assert.deepEqual(await gm.evaluate(() => [life.inRange.shapes[0].gridBased, life.inRange.highlightMode, life.inRange.behaviors.size]), [true, "shapes", 0]);
  console.log("PASS placement range rejects distant templates and permits valid placement");

  await gm.evaluate(() => canvas.pan({x: 650, y: 500, scale: 0.8}));
  await gm.mouse.move(700, 500);
  await gm.evaluate(() => { life.preview = game.swade.util.createRegionFromPreset("sbt", life.rangeItem); });
  await gm.waitForFunction(() => canvas.regions._placementContext);
  const pointer = (x, y) => gm.evaluate(([x, y]) => canvas.clientCoordinatesFromCanvas({x, y}), [x, y]);
  const far = await pointer(750, 450);
  await gm.mouse.move(far.x, far.y);
  const waitForPreviewTint = tint => gm.waitForFunction(tint => {
    const preview = canvas.regions._placementContext?.preview;
    return canvas.regions._highlights.children.some(mesh => mesh.region === preview && mesh._tintColor.toNumber() === tint);
  }, tint);
  await waitForPreviewTint(0xff3030);
  await gm.mouse.click(far.x, far.y);
  assert.equal(await gm.evaluate(() => !!canvas.regions._placementContext), true);
  const near = await pointer(660, 450);
  await gm.keyboard.down("Shift");
  await gm.mouse.move(near.x, near.y);
  await gm.waitForFunction(() => {
    const label = canvas.interface.getChildByName("sbt-placement-range")?.children[1].text ?? "";
    return label === "2″ / 2″";
  });
  await waitForPreviewTint(0x30d158);
  await gm.mouse.click(near.x, near.y);
  await gm.keyboard.up("Shift");
  await gm.waitForFunction(() => !canvas.regions._placementContext);
  assert.equal(await gm.evaluate(async () => (await life.preview).color.toString()), await gm.evaluate(() => game.user.color.toString()));
  assert.equal(await gm.evaluate(() => !!canvas.interface.getChildByName("sbt-placement-range")), false);
  console.log("PASS placement preview switches from red to green, blocks distant confirmation, and restores the placed color");

  await gm.evaluate(() => { life.plain = game.swade.util.createRegionFromPreset("sbt"); });
  await gm.waitForFunction(() => canvas.regions._placementContext);
  await gm.mouse.move(near.x, near.y);
  await gm.mouse.click(near.x, near.y);
  assert.deepEqual(await gm.evaluate(async () => {
    const plain = await life.plain;
    return [plain.shapes[0].gridBased, plain.highlightMode];
  }), [true, "shapes"]);
  console.log("PASS unconfigured SWADE presets default to grid alignment and True Shapes");
  assert.equal(await gm.evaluate(() => {
    const wasTemplateMode = canvas.regions.templateMode;
    canvas.regions.templateMode = true;
    try { return canvas.regions._createDragPreviewData({}).highlightMode; }
    finally { canvas.regions.templateMode = wasTemplateMode; }
  }), "shapes");

  await gm.evaluate(async () => {
    const a = life.api.defaultAutomation();
    a.shapes = ["smallRing", "mediumRing", "largeRing"];
    life.ringItem = await life.makeItem(`${life.prefix} Rings`, a);
  });
  for (const [index, key] of ["smallRing", "mediumRing", "largeRing"].entries()) {
    await gm.evaluate(key => { life.ring = life.api.placeTemplate(life.ringItem, key); }, key);
    await gm.waitForFunction(() => canvas.regions._placementContext);
    const ringPoint = await pointer(850, 650);
    await gm.mouse.move(ringPoint.x, ringPoint.y);
    await gm.mouse.click(ringPoint.x, ringPoint.y);
    assert.deepEqual(await gm.evaluate(async () => {
      const region = await life.ring;
      const [shape] = region.shapes;
      const centerCovered = region.polygonTree.testPoint({x: shape.x, y: shape.y});
      const bandCovered = region.polygonTree.testPoint({x: shape.x + shape.radius + shape.outerWidth * 0.4, y: shape.y});
      await life.api.deleteManagedRegion(region.uuid);
      return [shape.type, shape.radius, shape.outerWidth, shape.gridBased, region.highlightMode, centerCovered, bandCovered];
    }), ["ring", (index + 1) * 100, 100, true, "shapes", false, true]);
  }
  console.log("PASS all three native ring presets place with hollow centers and True Shapes");
  const cardIds = await gm.evaluate(async () => {
    life.cardActor = await Actor.create({name: `${life.prefix} Ring Caster`, type: "character"});
    const automation = life.api.defaultAutomation();
    automation.shapes = ["smallRing"];
    [life.cardPower] = await life.cardActor.createEmbeddedDocuments("Item", [{
      name: `${life.prefix} Ring Power`, type: "power", flags: {"swade-better-templates": {automation, templates: {smallRing: true}}}
    }]);
    await life.cardActor.sheet.render({force: true});
    return {sheet: life.cardActor.sheet.id, item: life.cardPower.id};
  });
  const ringSheet = gm.locator(`[id="${cardIds.sheet}"]`);
  await ringSheet.locator('a[data-tab="powers"]').click();
  const sheetRing = ringSheet.locator(`:is(.chat-card, .sbs-power-card)[data-item-id="${cardIds.item}"] .sbt-ring-buttons button`);
  assert.equal(await sheetRing.textContent(), "S Ring");
  const chatId = await gm.evaluate(async () => {
    await life.cardActor.sheet.close();
    life.ringCard = await life.cardPower.show();
    return life.ringCard.id;
  });
  const powerCard = gm.locator(`.chat-log [data-message-id="${chatId}"]:not(#chat-notifications .chat-message)`);
  assert.equal(await powerCard.locator(".sbt-ring-buttons button").textContent(), "S Ring");
  assert.equal(await powerCard.getByRole("button", {name: "Better Templates", exact: true}).count(), 0);
  console.log("PASS power cards offer the named ring without the extra Better Templates button");
  if (await gm.evaluate(() => game.modules.get("swade-hud")?.active)) {
    await gm.evaluate(async () => {
      [life.hudToken] = await life.scene.createEmbeddedDocuments("Token", [{
        name: life.cardActor.name, actorId: life.cardActor.id, actorLink: true, x: 700, y: 500
      }]);
    });
    await gm.waitForFunction(() => life.hudToken.object?.mesh);
    await gm.evaluate(() => {
      life.hud = game.modules.get("swade-hud").api;
      life.hudToken.object.control({releaseOthers: true});
      life.hud.render();
    });
    await gm.locator('#swade-hud-persistent [data-action="sidebar"][data-sidebar="spells"]').click();
    const hudRing = gm.locator('#swade-hud-sidebar [data-action="place-template"][data-preset="sbt-small-ring"]');
    assert.equal(await hudRing.textContent(), "S Ring");
    await hudRing.click();
    await gm.waitForFunction(() => canvas.regions._placementContext?.preview.document.getFlag("swade", "origin") === life.cardPower.uuid);
    await gm.keyboard.press("Escape");
    await gm.evaluate(() => life.hud.showDescription(life.cardPower, {actions: true}));
    const shortcutRing = gm.locator('.swade-hud-shortcut-popup [data-preset="sbt-small-ring"]');
    assert.equal(await shortcutRing.textContent(), "S Ring");
    await shortcutRing.click();
    await gm.waitForFunction(() => canvas.regions._placementContext?.preview.document.shapes[0].type === "ring");
    await gm.keyboard.press("Escape");
    await gm.evaluate(async () => {
      life.hud.closeDescription();
      life.hud.closeSidebar();
      await life.hudToken.delete();
    });
    console.log("PASS SWADE HUD power list and shortcut both open native ring placement");
  }
  await gm.evaluate(async () => {
    const a = life.api.defaultAutomation(); a.shapes = ["small"]; a.expiration.enabled = false; a.advanced.gridBased = false;
    a.behaviors = [life.api.defaultBehavior("difficultTerrain")];
    a.behaviors[0].system.actions = ["walk"];
    life.terrainItem = await life.makeItem(`${life.prefix} Terrain`, a);
    [life.terrain] = await life.place(life.terrainItem, life.scene, 450, 300);
  });
  await gm.waitForFunction(() => life.terrain?.getFlag("swade-better-templates", "managed")?.initialized);
  assert.deepEqual(await gm.evaluate(async () => {
    await life.api.applyRegionAutomation(life.terrain, life.terrainItem);
    const [behavior] = life.terrain.behaviors;
    const path = life.token.object.createTerrainMovementPath([{x: 400, y: 400, action: "walk"}, {x: 500, y: 400, action: "walk"}]);
    return [life.terrain.shapes[0].gridBased, life.terrain.behaviors.size, behavior.type, behavior.system.difficulties.walk, behavior.system.difficulties.fly, life.token.object.measureMovementPath(path).cost];
  }), [false, 1, "modifyMovementCost", 2, 1, 2]);
  console.log("PASS native movement cost is doubled for walking, with grid alignment disabled");
  const lightRegions = await gm.evaluate(async () => {
    const uuids = [];
    life.ringLightScene = await Scene.create({
      name: `${life.prefix} Square Ring`, width: 1600, height: 1200, padding: 0,
      grid: {type: CONST.GRID_TYPES.SQUARE, size: 100, distance: 1}
    });
    const ring = {type: "ring", x: 650, y: 550, radius: 300, innerWidth: 0, outerWidth: 100};
    const cases = [
      ["sbt", "small", false, {type: "circle", x: 450, y: 700, radius: 150}],
      ["swcone", "cone", false, {type: "cone", x: 550, y: 700, radius: 900, angle: 22.5, curvature: "semicircle"}],
      ["sbt-large-ring", "largeRing", true, ring],
      ["sbt-large-ring", "largeRing", false, ring]
    ];
    for (const [preset, key, gridBased, shape] of cases) {
      const scene = gridBased ? life.ringLightScene : life.scene;
      const a = life.api.defaultAutomation();
      a.shapes = [key];
      a.expiration.enabled = false;
      a.advanced.gridBased = gridBased;
      a.behaviors = [life.api.defaultBehavior("attachLight")];
      const item = await life.makeItem(`${life.prefix} ${preset}`, a);
      const [region] = await scene.createEmbeddedDocuments("Region", [{
        name: item.name, shapes: [shape], levels: [scene.levels.contents[0].id], flags: {swade: {origin: item.uuid, preset}}
      }]);
      uuids.push(region.uuid);
    }
    return uuids;
  });
  await gm.waitForFunction(uuids => uuids.every(uuid => foundry.utils.fromUuidSync(uuid)?.getFlag("swade-better-templates", "managed")?.initialized), lightRegions);
  assert.deepEqual(await gm.evaluate(async uuids => {
    const results = [];
    for (const uuid of uuids) {
      const region = foundry.utils.fromUuidSync(uuid);
      const lights = region.parent.lights.filter(light => light.getFlag("swade-better-templates", "primaryRegionUuid") === region.uuid);
      const [shape] = region.shapes;
      const scale = canvas.grid.size / canvas.grid.distance;
      const contained = lights.length >= (shape.type === "circle" ? 1 : 2) && lights.every(light => {
        const radius = light.config.dim * scale * 0.98;
        return Array.from({length: 24}, (_, i) => i * Math.PI / 12).every(angle => region.polygonTree.testPoint({
          x: light.x + Math.cos(angle) * radius, y: light.y + Math.sin(angle) * radius
        }));
      });
      let covered = true;
      if (shape.type === "ring") {
        const grid = shape.gridBased ? shape.grid : shape.gridlessGrid;
        const midline = grid.getCircle({x: shape.x, y: shape.y}, (shape.radius + shape.outerWidth / 2) / scale);
        const band = midline.flatMap((point, index) => {
          const next = midline[(index + 1) % midline.length];
          const steps = Math.ceil(Math.hypot(next.x - point.x, next.y - point.y) / 10);
          return Array.from({length: steps}, (_, i) => ({
            x: point.x + (next.x - point.x) * i / steps, y: point.y + (next.y - point.y) * i / steps
          }));
        });
        covered = band.every(point => lights.some(light => Math.hypot(point.x - light.x, point.y - light.y) <= light.config.dim * scale + 0.01));
      }
      results.push({contained, covered});
      await life.api.deleteManagedRegion(region.uuid);
    }
    return results;
  }, lightRegions), Array.from({length: 4}, () => ({contained: true, covered: true})));
  console.log("PASS fitted lights stay within circle, cone and ring footprints and cover the full ring band");
  for (const [mode, x] of [["away", 350], ["toward", 450]]) {
    await gm.evaluate(async ([mode, x]) => {
      const a = life.api.defaultAutomation();
      a.shapes = ["small"];
      a.expiration.enabled = false;
      const move = life.api.defaultBehavior("move");
      move.triggers = ["onPlace"];
      Object.assign(move.system, {mode, distance: "@spirit/12-1"});
      a.behaviors = [move];
      const item = await life.makeItem(`${life.prefix} Move ${mode}`, a);
      [life[mode]] = await life.place(item, life.scene, x, 300);
    }, [mode, x]);
    await gm.waitForFunction(mode => life[mode]?.getFlag("swade-better-templates", "managed")?.initialized, mode);
    const expected = mode === "away" ? 500 : 400;
    const position = await gm.evaluate(() => life.token._source.x);
    assert.equal(position, expected, `Expected ${mode} to move to x=${expected}`);
  }
  console.log("PASS Move pushes away from and pulls toward the footprint center");
  await gm.evaluate(async () => {
    [life.secondToken] = await life.scene.createEmbeddedDocuments("Token", [{name: `${life.prefix} Second`, actorId: life.actor.id, actorLink: false, x: 400, y: 600}]);
    const a = life.api.defaultAutomation();
    a.shapes = ["small"];
    a.expiration.enabled = false;
    const damage = life.api.defaultBehavior("rollDamage");
    damage.system.formula = "@spirit/2";
    a.behaviors = [damage];
    const item = await life.makeItem(`${life.prefix} Group entry`, a);
    [life.groupEntry] = await life.place(item, life.scene, 1050, 180);
  });
  await gm.waitForFunction(() => life.groupEntry?.getFlag("swade-better-templates", "managed")?.initialized);
  await gm.evaluate(async () => {
    await life.scene.updateEmbeddedDocuments("Token", [
      {_id: life.token.id, x: 1000, y: 400}, {_id: life.secondToken.id, x: 1100, y: 400}
    ], {animate: false});
    await Promise.all([life.token.movement.finished, life.secondToken.movement.finished]);
  });
  await gm.waitForFunction(() => game.messages.some(message => message.getFlag("swade-better-templates", "regionUuid") === life.groupEntry.uuid));
  assert.deepEqual(await gm.evaluate(() => game.messages
    .filter(message => message.getFlag("swade-better-templates", "regionUuid") === life.groupEntry.uuid)
    .map(message => [message.rolls[0].total, message.getFlag("swade", "targets").length])), [[7, 2]]);
  await gm.evaluate(async () => {
    await life.secondToken.delete();
    await life.token.update({x: 400, y: 400}, {animate: false});
  });
  console.log("PASS simultaneous native entry by two actors rolls one damage card for both targets");
  assert.deepEqual(await gm.evaluate(async () => {
    const {codeTrusted} = await import("/modules/swade-better-templates/scripts/library.mjs");
    const macro = await Macro.create({name: life.prefix, type: "script", command: "return 1;"});
    try {
      const entry = life.api.defaultBehavior("executeMacro"); entry.system.macroUuid = macro.uuid;
      await life.api.trustAutomation({behaviors: [entry]});
      const before = await codeTrusted(entry); await macro.update({command: "return 2;"});
      return [before, await codeTrusted(entry)];
    } finally { await macro.delete(); }
  }), [true, false]);
  console.log("PASS editing a previously approved macro requires fresh GM approval");

  await gm.evaluate(async () => {
    const a = life.api.defaultAutomation(); a.shapes = ["small"]; a.expiration.enabled = false; a.attachable = true; a.behaviors = [life.api.defaultBehavior("attachLight")];
    const item = await life.makeItem(`${life.prefix} Attached`, a); [life.attached] = await life.place(item);
  });
  await gm.locator('.dialog select[name="tokenId"]').selectOption({label: prefix});
  await gm.getByRole("button", {name: "Attach", exact: true}).click();
  await gm.waitForFunction(() => life.attached.getFlag("swade-better-templates", "managed")?.attachedTokenId);
  await gm.evaluate(() => life.token.update({x: 500, y: 500}, {animate: false}));
  await gm.waitForFunction(() => life.attached.shapes[0].x === 550 && life.scene.lights.some(light => Math.abs(light.x - 550) <= 50));
  console.log("PASS token attachment moves both region and attached light");

  await gm.evaluate(async () => {
    const a = life.api.defaultAutomation();
    a.shapes = ["small", "medium"];
    a.expiration.enabled = false;
    const damage = life.api.defaultBehavior("rollDamage");
    damage.triggers = ["onPlace"];
    Object.assign(damage.system, {formula: "2d6 * 0 + 4", flags: "cold", flavor: `${life.prefix} Cast Damage`});
    const notice = life.api.defaultBehavior("chatMessage");
    notice.triggers = ["onPlace"];
    notice.system.text = `${life.prefix} Raised only`;
    a.behaviors = [damage];
    const behavior = (type, system) => {
      const entry = life.api.defaultBehavior(type);
      Object.assign(entry.system, system);
      return entry;
    };
    a.raises = [
      {level: 1, changes: [behavior("rollDamage", {formula: "9d6"})]},
      {level: 2, changes: [behavior("changeTemplate"), behavior("addDamageDice", {formula: "1d4"}), notice]}
    ];
    const quickDamage = behavior("rollDamage", {formula: "2d6 * 0 + 10", flags: "cold, fire"});
    Object.assign(quickDamage, {target: "placer", replaces: damage.id, triggers: ["onPlace"]});
    a.modifiers = [
      {id: "fiery", name: "Fiery", options: [{id: "base", label: "Base", cost: 0, changes: []}]},
      {id: "quick", name: "Quick", options: [{id: "base", cost: 1, changes: [quickDamage]}]}
    ];
    life.castPower = await life.makeItem(`${life.prefix} Cast Power`, a);
    life.api.openBuilder(life.castPower);
  });
  const castBuilder = gm.locator(".sbt-builder");
  const removeOnPlacement = castBuilder.locator('[data-path="expiration.removeOnPlacement"]');
  await removeOnPlacement.check();
  await castBuilder.getByLabel("On current turn end", {exact: true}).waitFor({state: "detached"});
  assert.equal(await castBuilder.getByLabel("Duration", {exact: true}).count(), 0);
  await removeOnPlacement.uncheck();
  await castBuilder.getByLabel("Duration", {exact: true}).waitFor();
  await castBuilder.locator('[data-accordion="raises"] > .sbt-accordion-header').click();
  const raisedTwo = castBuilder.locator('[data-variant-list="raises"] [data-variant-index="1"]');
  await raisedTwo.locator(':scope > [data-action="accordion"]').click();
  await raisedTwo.locator('[data-behavior-path="raises.1.changes.0"] [data-action="collapseBehavior"]').click();
  const smallReplacement = raisedTwo.getByLabel("Small Blast Template replacement");
  const mediumReplacement = raisedTwo.getByLabel("Medium Blast Template replacement");
  assert.equal(await raisedTwo.locator('[data-path$=".system.size"], [data-path$=".system.width"], [data-path$=".system.expiration"]').count(), 0);
  assert.equal(await smallReplacement.inputValue(), "");
  assert.equal(await mediumReplacement.inputValue(), "");
  assert.equal(await mediumReplacement.locator("option").first().textContent(), "No changes");
  assert.equal(await raisedTwo.getByLabel("Large Blast Template replacement").count(), 0);
  await smallReplacement.selectOption("mediumRing");
  await raisedTwo.getByLabel("Behavior type").selectOption("increaseDieType");
  await raisedTwo.getByRole("button", {name: "Add change", exact: true}).click();
  await raisedTwo.getByRole("checkbox", {name: "Enable Increase Die Type"}).waitFor();
  await castBuilder.locator('[data-accordion="modifiers"] > .sbt-accordion-header').click();
  const fiery = castBuilder.locator('[data-variant-list="modifiers"] [data-variant-index="0"]');
  await fiery.locator(':scope > [data-action="accordion"]').click();
  await fiery.getByRole("button", {name: "Add change", exact: true}).click();
  const extra = fiery.locator('[data-cost-index="1"]');
  await extra.getByLabel("Option name").fill("Extra die");
  await extra.getByLabel("Power Point cost").fill("2");
  await extra.getByLabel("Behavior type").selectOption("addDamageDice");
  await extra.getByRole("button", {name: "Add behavior", exact: true}).click();
  await extra.getByLabel("Damage formula to add").fill("1d6+1d6x");
  const quick = castBuilder.locator('[data-add-behavior-path="modifiers.1.options.0.changes"]');
  await castBuilder.locator('[data-accordion="modifiers.1"] > [data-action="accordion"]').click();
  await quick.getByLabel("Behavior type").selectOption("modifyExpiration");
  await quick.getByRole("button", {name: "Add behavior", exact: true}).click();
  await castBuilder.locator('[data-path="modifiers.1.options.0.changes.1.system.expiration"]').selectOption("placement");
  await castBuilder.getByRole("button", {name: "Save", exact: true}).click();
  await gm.waitForFunction(() => {
    const {raises, modifiers} = life.api.readAutomation(life.castPower);
    return raises[1].changes.at(-1).type === "increaseDieType" && raises[1].changes[0].system.replacements.small === "mediumRing"
      && modifiers[0].options[1]?.changes[0]?.system.formula === "1d6+1d6x"
      && modifiers[1].options[0].changes[1]?.system.expiration === "placement";
  });
  assert.deepEqual(await gm.evaluate(() => life.castPower.getFlag("swade-better-powers", "powerModifiers")[0].options.map(option => [option.label, option.cost])), [["Base", 0], ["Extra die", 2]]);
  await gm.evaluate(() => [...foundry.applications.instances.values()].find(app => app.item === life.castPower)?.close({force: true}));
  await gm.evaluate(() => { life.combinedPicker = life.api.placeTemplate(life.castPower); });
  await gm.locator('.sbt-cast-options [name="baseShape"]').waitFor();
  await gm.locator(".dialog").filter({has: gm.locator(".sbt-cast-options")}).getByRole("button", {name: "Cancel", exact: true}).click();
  assert.equal(await gm.evaluate(() => life.combinedPicker), null);
  console.log("PASS builder saves full raised behaviors and separate priced modifier options, synced to Better Powers");

  const playerName = `${prefix} Player`;
  await gm.evaluate(async name => {
    life.player = await User.create({name, role: 1, character: life.actor.id});
    await life.actor.update({[`ownership.${life.player.id}`]: 3});
    life.oldPermissions = game.settings.get("core", "permissions");
    await game.settings.set("core", "permissions", {...life.oldPermissions, REGION_CREATE: [1, 2, 3, 4]});
    [life.skill] = await life.actor.createEmbeddedDocuments("Item", [{name: `${life.prefix} Fighting`, type: "skill", system: {attribute: "agility"}}]);
    await game.togglePause(false, {broadcast: true});
    const a = life.api.defaultAutomation(); a.shapes = ["small"]; a.expiration.enabled = false; a.behaviors = [life.api.defaultBehavior("restrict")];
    Object.assign(a.behaviors[0].system, {traits: ["agility"], linkedAttributes: ["agility"], rollFlags: "cold"});
    const item = await life.makeItem(`${life.prefix} Restricted`, a);
    await item.update({"system.description": "<p>Source power text</p>"});
    [life.restricted] = await life.place(item, life.scene, 550, 250);
  }, playerName);
  await gm.waitForFunction(() => life.actor.effects.some(e => e.getFlag("swade-better-templates", "restriction") === "traits"));
  const restrictionDescription = await gm.evaluate(() => life.actor.effects.find(e => e.getFlag("swade-better-templates", "restriction") === "traits").description);
  assert.match(restrictionDescription, /Agility \(including all linked skills\)/);
  assert.match(restrictionDescription, /Restricted roll flags<\/strong> cold/);
  assert.doesNotMatch(restrictionDescription, /Source power text/);
  assert.equal(await gm.evaluate(async () => {
    const effect = life.actor.effects.find(e => e.getFlag("swade-better-templates", "restriction") === "traits");
    const description = effect.description;
    await effect.update({description: ""});
    const {initializeInsideTokens} = await import("/modules/swade-better-templates/scripts/runtime.mjs");
    await initializeInsideTokens(life.restricted);
    return effect.description === description;
  }), true);
  player = await join(playerName);
  await player.waitForFunction(() => canvas.ready);
  assert.deepEqual(await player.evaluate(async prefix => {
    const actor = game.user.character;
    const skill = actor.items.getName(`${prefix} Fighting`);
    const options = {suppressChat: true};
    const token = canvas.scene.tokens.getName(prefix);
    const rolls = [Boolean(await actor.rollSkill(skill.id, options)), Boolean(await actor.rollAttribute("spirit", {...options, effectFlags: ["cold"]})), Boolean(await actor.rollAttribute("spirit", options))];
    await token.move([{x: 600, y: 500}], {animate: false});
    return [...rolls, token._source.x];
  }, prefix), [false, false, true, 600]);
  await gm.evaluate(() => life.api.deleteManagedRegion(life.restricted.uuid));
  await player.waitForFunction(() => !game.user.character.effects.some(e => e.getFlag("swade-better-templates", "restriction")));
  assert.equal(await player.evaluate(async prefix => {
    const actor = game.user.character;
    return Boolean(await actor.rollSkill(actor.items.getName(`${prefix} Fighting`).id, {suppressChat: true}));
  }, prefix), true);
  console.log("PASS linked skill and flag restrictions end when their region is deleted");

  const castId = await gm.evaluate(() => life.castPower.id);
  await player.evaluate(() => canvas.pan({x: 650, y: 500, scale: 0.8}));
  await player.mouse.move(700, 500);
  const startCast = () => player.evaluate(castId => {
    const item = game.user.character.items.get(castId);
    globalThis.castPreview = game.swade.util.createRegionFromPreset("sbt", item);
  }, castId);
  const castDialog = player.locator(".dialog").filter({has: player.locator(".sbt-cast-options")});
  const placeChoice = () => castDialog.getByRole("button", {name: "Place template", exact: true}).click();
  const placeAt = async (x, y) => {
    const point = await player.evaluate(([x, y]) => canvas.clientCoordinatesFromCanvas({x, y}), [x, y]);
    await player.mouse.move(point.x, point.y);
    await player.mouse.click(point.x, point.y);
  };
  await startCast();
  assert.equal(await castDialog.getByLabel("Normal", {exact: true}).isChecked(), true);
  await placeChoice();
  await player.waitForFunction(() => canvas.regions._placementContext);
  await placeAt(650, 550);
  await gm.waitForFunction(() => life.scene.regions.some(region => region.getFlag("swade", "origin") === life.castPower.uuid
    && region.getFlag("swade-better-templates", "managed")?.initialized));
  assert.deepEqual(await gm.evaluate(async () => {
    const region = life.scene.regions.find(region => region.getFlag("swade", "origin") === life.castPower.uuid);
    const damage = game.messages.find(message => message.getFlag("swade-better-templates", "regionUuid") === region.uuid && message.rolls.length);
    const result = [region.shapes[0].type, region.shapes[0].radius, damage.rolls[0].total, damage.rolls[0].formula.includes("2d6")];
    await life.api.deleteManagedRegion(region.uuid);
    return result;
  }), ["circle", 100, 4, true]);
  await gm.evaluate(async () => {
    [life.castBystander] = await life.scene.createEmbeddedDocuments("Token", [{name: "Bystander", actorId: life.cardActor.id,
      actorLink: true, x: 600, y: 600}]);
  });
  const chatCastId = await player.evaluate(async castId => {
    ui.sidebar.changeTab("chat", "primary"); ui.sidebar.expand();
    return (await game.user.character.items.get(castId).show()).id;
  }, castId);
  const chatCast = player.locator(`#chat .chat-message[data-message-id="${chatCastId}"] .sbt-cast-template-controls`);
  await chatCast.getByRole("button", {name: "SBT", exact: true}).click();
  await castDialog.getByLabel("Raised 2", {exact: true}).check();
  await castDialog.getByLabel("Fiery", {exact: true}).check();
  await castDialog.getByLabel("Fiery option", {exact: true}).selectOption({label: "Extra die (2 PP)"});
  await castDialog.getByLabel("Quick", {exact: true}).check();
  await castDialog.getByRole("button", {name: "Apply", exact: true}).click();
  await chatCast.getByRole("button", {name: "M Ring", exact: true}).waitFor();
  await chatCast.getByRole("button", {name: "MBT", exact: true}).waitFor();
  assert.equal(await chatCast.getByRole("button", {name: "SBT", exact: true}).count(), 0);
  await chatCast.getByRole("button", {name: "M Ring", exact: true}).click();
  await player.waitForFunction(() => canvas.regions._placementContext?.preview.document.shapes[0].type === "ring");
  assert.deepEqual(await player.evaluate(() => {
    const {radius, outerWidth} = canvas.regions._placementContext.preview.document.shapes[0];
    return [radius, outerWidth];
  }), [200, 100]);
  await placeAt(450, 450);
  await gm.waitForFunction(() => game.messages.some(message => message.content.includes(`${life.prefix} Raised only`)));
  const placedId = await gm.evaluate(() => game.messages.findLast(message => message.content.includes(`${life.prefix} Raised only`)).getFlag("swade-better-templates", "regionUuid").split(".").at(-1));
  assert.ok(placedId);
  await gm.waitForFunction(id => !life.scene.regions.has(id) && game.messages.some(message => message.content.includes(`${life.prefix} Raised only`)), placedId);
  assert.deepEqual(await gm.evaluate(id => {
    const damage = game.messages.find(message => message.getFlag("swade-better-templates", "regionUuid")?.endsWith(id) && message.rolls.length);
    const flags = damage.getFlag("swade-better-effects", "context").roll;
    const {formula, total} = damage.rolls[0];
    return [total >= 13, damage.getFlag("swade", "targets").map(target => target.uuid), ["cold", "fire"].every(flag => flags.includes(flag)),
      ["2d8", "1d6", "1d6x", "1d4"].every(term => formula.includes(term))];
  }, placedId), [true, [await gm.evaluate(() => life.token.uuid)], true, true]);
  console.log("PASS player casts Normal and places the mapped ring from the Raised 2 card, rolling the mixed dice formula once");

  await gm.evaluate(async () => {
    const a = life.api.defaultAutomation();
    a.shapes = ["small"];
    a.expiration.enabled = false;
    const effect = life.api.defaultBehavior("addEffect");
    Object.assign(effect.system, {
      effects: [{name: `${life.prefix} Timed Effect`, type: "base", system: {changes: []}}],
      duration: {enabled: true, amount: 3, unit: "seconds"},
      removeOnExit: false
    });
    a.behaviors = [effect];
    const item = await life.makeItem(`${life.prefix} Timed`, a);
    [life.timed] = await life.place(item, life.scene, 650, 220);
  });
  await gm.waitForFunction(() => life.actor.effects.some(e => e.active && e.getFlag("swade-better-templates", "regionUuid") === life.timed?.uuid));
  assert.equal(await gm.evaluate(async () => {
    await life.api.deleteManagedRegion(life.timed.uuid);
    return life.actor.effects.some(e => e.active && e.getFlag("swade-better-templates", "regionUuid") === life.timed.uuid);
  }), true);
  await gm.evaluate(() => game.time.advance(4));
  await gm.waitForFunction(() => !life.actor.effects.some(e => e.active && e.getFlag("swade-better-templates", "regionUuid") === life.timed.uuid));
  console.log("PASS custom effect duration can outlast a region and expires on its own");

  await gm.evaluate(async () => {
    life.otherScene = await Scene.create({name: `${life.prefix} Offscene`, width: 1600, height: 1200, padding: 0, grid: {size: 100, distance: 1}});
    await life.otherScene.createEmbeddedDocuments("Token", [{name: life.prefix, actorId: life.actor.id, actorLink: true, x: 400, y: 400}]);
    const a = life.api.defaultAutomation(); a.shapes = ["small"]; a.expiration.enabled = false;
    const effect = life.api.defaultBehavior("addEffect"); effect.system.effects = [{name: `${life.prefix} Offscene Effect`, type: "base", system: {changes: []}}]; a.behaviors = [effect];
    const item = await life.makeItem(`${life.prefix} Offscene`, a); [life.offsceneRegion] = await life.place(item, life.otherScene);
  });
  await gm.waitForFunction(() => life.actor.effects.some(e => e.getFlag("swade-better-templates", "regionUuid") === life.offsceneRegion?.uuid));
  await gm.evaluate(() => life.otherScene.delete());
  await gm.waitForFunction(() => !life.actor.effects.some(e => e.getFlag("swade-better-templates", "regionUuid") === life.offsceneRegion.uuid));
  console.log("PASS offscene automation applies and scene deletion removes its managed effects");
  console.log("All lifecycle integration checks passed.");
} finally {
  await player?.close().catch(() => {});
  if (gm) await gm.evaluate(async () => {
    if (game.world.id !== "templates-qa" || !globalThis.life) return;
    for (const scene of [life.scene, life.otherScene, life.ringLightScene].filter(s => s && game.scenes.has(s.id))) {
      for (const region of [...scene.regions]) await life.api.deleteManagedRegion(region.uuid);
      await scene.delete();
    }
    await life.actor?.delete(); await life.player?.delete();
    await life.ringCard?.delete(); await life.cardActor?.delete();
    if (life.oldPermissions) await game.settings.set("core", "permissions", life.oldPermissions);
    await game.settings.set("core", "scrollingStatusText", life.oldScrolling);
  }).catch(console.error);
  await browser.close();
}
