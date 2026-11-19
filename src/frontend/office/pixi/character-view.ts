import { Container, Graphics, Rectangle, Text } from "pixi.js";
import { computePose, createPose, type Pose } from "../sim/poses";
import type { CharacterRuntime, CharacterState, PrototypeCharacter } from "../sim/types";
import { BIAS, zIndexFor } from "./depth";
import { iso } from "./geometry";
import { PALETTE, UI_FONT, shade } from "./palette";

/**
 * One prototype character, drawn procedurally from simple vector parts
 * (no image assets). Parts are built ONCE; animation only changes
 * transforms, which keeps per-frame cost tiny on low-end GPUs.
 *
 * Drawn facing south-east; mirrored on x for south-west. North-facing
 * directions swap to the back-view head/torso details.
 */
type BadgeKind = "working" | "collab" | "approval" | "completed" | "failed";

const BADGE_FOR_STATE: Partial<Record<CharacterState, BadgeKind>> = {
  working: "working",
  collaborating: "collab",
  "waiting-approval": "approval",
  completed: "completed",
  failed: "failed",
};

export class CharacterView {
  readonly root: Container;
  private readonly body = new Container();
  private readonly legFront = new Graphics();
  private readonly legBack = new Graphics();
  private readonly armFront = new Graphics();
  private readonly armBack = new Graphics();
  private readonly torso = new Container();
  private readonly torsoFront = new Graphics();
  private readonly head = new Container();
  private readonly headFront = new Graphics();
  private readonly headBack = new Graphics();
  private readonly ring = new Graphics();
  private readonly badgeRoot = new Container();
  private readonly badges = new Map<BadgeKind, Container>();
  private readonly talkDots: Graphics[] = [];
  private readonly pose: Pose = createPose();
  private readonly phase: number;
  private readonly scale: number;
  private selected = false;
  private hovered = false;

  readonly character: PrototypeCharacter;

  constructor(character: PrototypeCharacter, onTap: (id: string) => void) {
    this.character = character;
    const a = character.appearance;
    this.scale = a.heightScale;
    this.phase = (character.id.length * 1.37) % 3;

    this.root = new Container({ label: `character-${character.id}` });
    this.root.eventMode = "static";
    this.root.cursor = "pointer";
    this.root.hitArea = new Rectangle(-14, -78, 28, 84);
    this.root.on("pointertap", () => onTap(character.id));
    this.root.on("pointerover", () => {
      this.hovered = true;
      this.refreshRing();
    });
    this.root.on("pointerout", () => {
      this.hovered = false;
      this.refreshRing();
    });

    const shadow = new Graphics().ellipse(0, 0, 12, 5.5).fill({ color: 0x0b1220, alpha: 0.22 });
    this.ring.ellipse(0, 0, 16, 7.5).fill({ color: PALETTE.accent, alpha: 0.18 }).stroke({ width: 2, color: PALETTE.accent });
    this.ring.visible = false;
    this.root.addChild(this.ring, shadow);

    this.buildLegs(a);
    this.buildArms(character);
    this.buildTorso(a);
    this.buildHead(a);

    // Back limbs, torso, head, front limbs - in that order.
    this.body.addChild(this.legBack, this.legFront, this.armBack, this.torso, this.head, this.armFront);
    this.body.scale.set(this.scale);
    this.root.addChild(this.body);

    this.buildBadges();
    this.badgeRoot.position.set(0, -84 * this.scale);
    this.root.addChild(this.badgeRoot);
    this.root.addChild(this.buildNameplate(character));
  }

  private buildLegs(a: PrototypeCharacter["appearance"]) {
    for (const [leg, tone] of [
      [this.legFront, 1],
      [this.legBack, 0.8],
    ] as const) {
      leg.roundRect(-2.6, 0, 5.2, 16, 2).fill(shade(a.trousers, tone));
      leg.roundRect(-2.6, 14.5, 7, 3, 1.5).fill(a.shoes);
      leg.position.set(leg === this.legFront ? 2.2 : -2.6, -17);
    }
  }

  private buildArms(character: PrototypeCharacter) {
    const a = character.appearance;
    for (const [arm, tone] of [
      [this.armFront, 1],
      [this.armBack, 0.78],
    ] as const) {
      arm.roundRect(-2.4, -1, 4.8, 15, 2.2).fill(shade(a.jacket, tone));
      arm.circle(0, 15.5, 2.4).fill(shade(a.skin, tone === 1 ? 1 : 0.9));
      arm.position.set(arm === this.armFront ? 7.5 : -7.5, -36);
    }
    if (a.accessory === "tablet") {
      // Tablet held in the front hand.
      this.armFront.roundRect(-1, 13, 9, 7, 1.2).fill(0x1f2937);
      this.armFront.roundRect(0, 14, 7, 5, 0.8).fill(0x5eead4);
    }
  }

  private buildTorso(a: PrototypeCharacter["appearance"]) {
    const base = new Graphics();
    const coatLength = a.accessory === "glasses" ? 4 : 0; // lab-coat style
    base.roundRect(-9, -39, 18, 24 + coatLength, 5).fill(a.jacket);
    base.roundRect(3.5, -38, 5.5, 22 + coatLength, 4).fill({ color: shade(a.jacket, 0.82), alpha: 0.9 });
    base.rect(-1.8, -42, 3.6, 4).fill(shade(a.skin, 0.9)); // neck

    // Front-only details (hidden in back view).
    this.torsoFront.poly([-3.4, -39, 4.2, -39, 0.6, -30]).fill(a.shirt);
    if (a.accessory === "tie") {
      this.torsoFront.poly([-0.6, -38, 1.8, -38, 2.4, -27, 0.6, -24.5, -1.2, -27]).fill(a.accent);
      this.torsoFront.circle(-5, -33, 0.9).fill(0xe5e7eb); // lapel pin
    } else if (a.accessory === "glasses") {
      this.torsoFront.rect(-0.2, -30, 1, 13).fill({ color: shade(a.jacket, 0.8) }); // coat seam
      this.torsoFront.roundRect(-7, -27, 4, 3, 0.8).fill({ color: shade(a.jacket, 0.88) }); // pocket
    } else {
      this.torsoFront.rect(-9, -24, 18, 2).fill({ color: shade(a.jacket, 0.75) }); // belted blazer
    }
    this.torso.addChild(base, this.torsoFront);
  }

  private buildHead(a: PrototypeCharacter["appearance"]) {
    const cx = 0.6;
    const cy = -48;
    const R = 7.6;
    // Front view.
    const f = this.headFront;
    if (a.hairStyle === "long") f.roundRect(-8.6, cy - 7, 15, 19, 6).fill(shade(a.hair, 0.85));
    f.circle(cx, cy, R).fill(a.skin);
    f.circle(cx + 3.4, cy + 2.5, 2.6).fill({ color: shade(a.skin, 1.06), alpha: 0.5 }); // cheek light
    f.circle(cx + 1.6, cy + 0.2, 0.95).fill(0x1f2937);
    f.circle(cx + 4.8, cy + 0.2, 0.95).fill(0x1f2937);
    f.roundRect(cx + 2.2, cy + 4, 2.6, 0.8, 0.4).fill({ color: shade(a.skin, 0.7), alpha: 0.8 });
    if (a.accessory === "glasses") {
      f.circle(cx + 1.6, cy + 0.2, 2.1).stroke({ width: 0.8, color: 0x312e81 });
      f.circle(cx + 4.9, cy + 0.2, 2.1).stroke({ width: 0.8, color: 0x312e81 });
    }
    this.drawHairTop(f, a, cx, cy, R, true);

    // Back view.
    const b = this.headBack;
    if (a.hairStyle === "long") b.roundRect(-8, cy - 6, 16, 20, 6).fill(shade(a.hair, 0.9));
    b.circle(cx, cy, R).fill(a.hair);
    b.circle(cx - 2, cy - 2, 4).fill({ color: shade(a.hair, 1.15), alpha: 0.4 });
    this.drawHairTop(b, a, cx, cy, R, false);
    this.headBack.visible = false;
    this.head.addChild(this.headFront, this.headBack);
  }

  private drawHairTop(g: Graphics, a: PrototypeCharacter["appearance"], cx: number, cy: number, R: number, front: boolean) {
    // Cap of hair over the top/back of the head.
    g.ellipse(cx - 0.8, cy - 3.8, R + 0.4, R * 0.62).fill(a.hair);
    if (front) g.rect(cx - R - 0.2, cy - 4, 4, 6).fill(a.hair); // sideburn/back of head
    if (a.hairStyle === "bun") g.circle(cx - 5.4, cy - 6.6, 3.8).fill(shade(a.hair, 1.1));
    if (a.hairStyle === "short") g.ellipse(cx + 1, cy - 6.8, 4.5, 1.6).fill({ color: shade(a.hair, 1.18), alpha: 0.7 });
  }

  private buildBadges() {
    const disc = (color: number) => new Graphics().circle(0, 0, 7.5).fill(color).stroke({ width: 1.5, color: 0xffffff });

    const working = new Container();
    working.addChild(
      disc(PALETTE.state.working),
      new Graphics().roundRect(-3.5, -2.5, 7, 5, 1).stroke({ width: 1.2, color: 0xffffff }).rect(-1.5, 3.2, 3, 0.9).fill(0xffffff),
    );

    const approval = new Container();
    approval.addChild(
      disc(PALETTE.state.approval),
      new Graphics()
        .poly([-3, -3.8, 3, -3.8, 0, 0])
        .fill(0xffffff)
        .poly([-3, 3.8, 3, 3.8, 0, 0])
        .fill(0xffffff),
    );

    const completed = new Container();
    completed.addChild(
      disc(PALETTE.state.completed),
      new Graphics().moveTo(-3.4, 0.2).lineTo(-0.8, 2.8).lineTo(3.6, -2.6).stroke({ width: 1.8, color: 0xffffff, cap: "round", join: "round" }),
    );

    const failed = new Container();
    failed.addChild(
      disc(PALETTE.state.failed),
      new Graphics().roundRect(-0.9, -4.2, 1.8, 5.4, 0.9).fill(0xffffff).circle(0, 3.2, 1.05).fill(0xffffff),
    );

    const collab = new Container();
    const bubble = new Graphics()
      .roundRect(-10, -7, 20, 13, 6)
      .fill(0xffffff)
      .stroke({ width: 1, color: 0xcbd5e1 })
      .poly([-3, 5.5, 2, 5.5, -4, 10])
      .fill(0xffffff);
    collab.addChild(bubble);
    for (let i = 0; i < 3; i++) {
      const dot = new Graphics().circle(-5 + i * 5, -0.5, 1.6).fill(0x475569);
      this.talkDots.push(dot);
      collab.addChild(dot);
    }

    for (const [kind, c] of [
      ["working", working],
      ["approval", approval],
      ["completed", completed],
      ["failed", failed],
      ["collab", collab],
    ] as const) {
      c.visible = false;
      this.badges.set(kind, c);
      this.badgeRoot.addChild(c);
    }

  }

  private buildNameplate(character: PrototypeCharacter): Container {
    const plate = new Container();
    const name = new Text({
      text: character.codename,
      style: { fontFamily: UI_FONT, fontSize: 8, fontWeight: "700", fill: 0xffffff, letterSpacing: 0.8 },
      resolution: 4,
    });
    const sim = new Text({
      text: "SIM",
      style: { fontFamily: UI_FONT, fontSize: 6.5, fontWeight: "800", fill: 0x111827, letterSpacing: 0.6 },
      resolution: 4,
    });
    const pad = 4;
    const simW = sim.width + 5;
    const w = name.width + pad * 2 + simW + 2;
    const h = 12;
    const bg = new Graphics().roundRect(-w / 2, -h / 2, w, h, 6).fill({ color: 0x0f172a, alpha: 0.86 });
    const chip = new Graphics().roundRect(w / 2 - simW - 2, -h / 2 + 2, simW, h - 4, 4).fill(PALETTE.sim);
    name.anchor.set(0, 0.5);
    name.position.set(-w / 2 + pad, 0);
    sim.anchor.set(0.5, 0.5);
    sim.position.set(w / 2 - 2 - simW / 2, 0.2);
    plate.addChild(bg, chip, name, sim);
    plate.position.set(0, -66 * this.scale);
    plate.eventMode = "none";
    return plate;
  }

  setSelected(selected: boolean) {
    this.selected = selected;
    this.refreshRing();
  }

  private refreshRing() {
    this.ring.visible = this.selected || this.hovered;
    this.ring.alpha = this.selected ? 1 : 0.55;
  }

  /** Per-frame update. `t` is a continuous clock in seconds. */
  update(rt: CharacterRuntime, t: number, motion: number) {
    const [x, y] = iso(rt.col + 0.5, rt.row + 0.5);
    this.root.position.set(x, y);
    this.root.zIndex = zIndexFor(rt.depth, BIAS.character);

    const back = rt.facing === "ne" || rt.facing === "nw";
    const mirror = rt.facing === "sw" || rt.facing === "nw" ? -1 : 1;
    this.body.scale.x = this.scale * mirror;
    this.headFront.visible = !back;
    this.headBack.visible = back;
    this.torsoFront.visible = !back;

    const p = computePose(this.pose, rt.state, rt.posture, t, rt.stateElapsedMs / 1000, this.phase, motion);
    this.body.y = p.bodyY;
    this.torso.scale.y = p.torsoScaleY;
    this.head.position.y = p.headY;
    this.head.rotation = p.headTilt;
    // Positive pose angles swing limbs forward (+x); Pixi rotates clockwise.
    this.armFront.rotation = -p.armFront;
    this.armBack.rotation = -p.armBack;
    this.legFront.rotation = -p.legFront;
    this.legBack.rotation = -p.legBack;

    const badge = BADGE_FOR_STATE[rt.state];
    for (const [kind, c] of this.badges) c.visible = kind === badge;
    this.badgeRoot.y = (-84 + p.bodyY) * this.scale;
    this.badgeRoot.scale.set(1 + p.badgePulse * 0.14);
    if (badge === "collab") {
      this.talkDots.forEach((d, i) => {
        d.alpha = Math.floor(p.talkPhase) === i ? 1 : 0.35;
      });
    }
  }

  destroy() {
    this.root.destroy({ children: true });
  }
}
