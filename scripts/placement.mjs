import {MODULE_ID, SHAPES, readAutomation} from "./data.mjs";
import {numericFormula} from "./formulas.mjs";
import {distanceInInches, tokenCenter} from "./geometry.mjs";
import {chooseCastOptions, hasCastOptions, resolveCastOptions, templateShapeData} from "./variants.mjs";

export function templateAppearance(automation, shapes) {
  return {
    shapes: shapes.map(shape => ({...(shape.toObject?.() ?? shape), gridBased: automation?.advanced.gridBased ?? true})),
    highlightMode: automation?.advanced.enabled ? automation.advanced.highlightMode : "shapes"
  };
}

export function registerPlacementPreview(sourceToken) {
  const prototype = CONFIG.Canvas.layers.regions.layerClass.prototype;
  const createDragPreviewData = prototype._createDragPreviewData;
  prototype._createDragPreviewData = function (event) {
    const data = createDragPreviewData.call(this, event);
    if (this.templateMode) data.highlightMode = "shapes";
    return data;
  };
  const original = prototype.placeRegion;
  prototype.placeRegion = async function (data, {chooseCastShape = false, castContext, castChoices, ...options} = {}) {
    if (!data?.flags?.swade?.preset && !data?.flags?.swade?.origin) return original.call(this, data, options);
    const origin = data.flags.swade.origin;
    const item = origin ? await fromUuid(origin).catch(() => null) : null;
    let automation = item?.getFlag(MODULE_ID, "automation") ? readAutomation(item) : null;
    const preset = SHAPES.find(shape => shape.preset === data.flags.swade.preset);
    if (preset && automation && hasCastOptions(automation)) {
      if (!automation.shapes.includes(preset.key)) {
        ui.notifications.warn("This shape is not enabled in Better Templates.");
        return null;
      }
      if (!game.user.isGM && !game.users.activeGM) {
        ui.notifications.warn("An active GM is required for template automation.");
        return null;
      }
      const scene = canvas.scene;
      const selected = castChoices && !chooseCastShape ? {...castChoices, baseShape: preset.key}
        : await chooseCastOptions(automation, automation.label || item.name, preset.key, {chooseShape: chooseCastShape, castContext});
      if (!selected || !canvas.ready || canvas.scene !== scene) return null;
      const actor = item.actor ?? sourceToken(item, scene)?.actor;
      let cast;
      try { cast = resolveCastOptions(automation, selected, {item, actor}); }
      catch (error) { ui.notifications.warn(error.message); return null; }
      automation = cast.automation;
      const shape = SHAPES.find(shape => shape.key === cast.shapeKey);
      let shapes = data.shapes;
      if (shape !== preset || Object.keys(cast.dimensions).length) {
        try { shapes = [templateShapeData(shape, scene.grid, cast.dimensions, actor, shapes[0]), ...shapes.slice(1)]; }
        catch (error) { ui.notifications.warn(error.message); return null; }
      }
      data = {...data, shapes, flags: {...data.flags, swade: {...data.flags.swade, preset: shape.preset},
        [MODULE_ID]: {...data.flags[MODULE_ID], cast: cast.choices}}};
    }
    const preview = {...data, ...templateAppearance(automation, data.shapes)};
    if (!automation?.enabled || !automation.placementRange.enabled) return original.call(this, preview, options);

    const token = sourceToken(item, canvas.scene);
    if (!token) {
      ui.notifications.warn("Select the placing token to measure this template’s range.");
      return null;
    }
    preview.flags = {...preview.flags, [MODULE_ID]: {...preview.flags[MODULE_ID], placement: {tokenId: token.id}}};
    let max;
    try { max = numericFormula(automation.placementRange.max, item.actor ?? token.actor, {min: 0}); }
    catch (error) { ui.notifications.warn(error.message); return null; }
    const start = tokenCenter(token);
    const distance = point => distanceInInches(start, point, token.parent.grid);
    const rangeColor = range => range > max ? 0xff3030 : 0x30d158;
    const overlay = new PIXI.Container();
    overlay.name = "sbt-placement-range";
    overlay.eventMode = "none";
    const line = overlay.addChild(new PIXI.Graphics());
    const label = overlay.addChild(new PIXI.Text("", {fontFamily: "Signika, sans-serif", fontSize: 18, stroke: 0, strokeThickness: 4}));
    canvas.interface.addChild(overlay);
    try {
      return await original.call(this, {...preview, color: rangeColor(distance(preview.shapes[0]))}, {
        ...options,
        onChange(args) {
          options.onChange?.(args);
          const end = args.shape;
          const range = distance(end);
          const color = rangeColor(range);
          if (Number(args.document.color) !== color) {
            args.document.updateSource({color});
            args.preview.renderFlags.set({refreshState: true});
          }
          line.clear().lineStyle(2, color, 1);
          const dx = end.x - start.x, dy = end.y - start.y;
          const length = Math.hypot(dx, dy);
          for (let step = 0; step < length; step += 16) {
            const stop = Math.min(length, step + 9);
            line.moveTo(start.x + dx * step / length, start.y + dy * step / length);
            line.lineTo(start.x + dx * stop / length, start.y + dy * stop / length);
          }
          label.text = `${range}″ / ${max}″`;
          label.style.fill = color;
          label.position.set((start.x + end.x) / 2 + 8, (start.y + end.y) / 2 - 18);
        },
        preConfirm(args) {
          if (distance(args.shape) > max) {
            ui.notifications.warn(`Place within ${max}″ of the placing token.`);
            return false;
          }
          return options.preConfirm?.(args);
        },
        preCommit(documents) {
          documents[0].updateSource({color: preview.color});
          return options.preCommit?.(documents);
        }
      });
    } finally { if (!overlay.destroyed) overlay.destroy({children: true}); }
  };
}
