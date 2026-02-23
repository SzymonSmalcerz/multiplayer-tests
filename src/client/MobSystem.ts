import Phaser from "phaser";
import { MOB_REGISTRY, MobDef } from "../shared/mobs";
import { MobPlacement } from "./types";

// ─── Internal per-instance state ─────────────────────────────────────────────

type Action = "goLeft" | "goRight" | "goUp" | "goDown" | "specialAction";

interface MobInstance {
  sprite:        Phaser.GameObjects.Sprite;
  type:          string;
  leftBorder:    number;
  rightBorder:   number;
  upperBorder:   number;
  bottomBorder:  number;
  speed:         number;
  changeTime:    number;
  specialTime:   number;
  chanceOfSpecial: number;
  currentAction: Action;
  timer:         ReturnType<typeof setTimeout> | null;
}

// ─── MobSystem ────────────────────────────────────────────────────────────────

export class MobSystem {
  private mobs:  MobInstance[] = [];
  private scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** Spawn one mob per placement entry received from the server. */
  createMobs(placements: MobPlacement[]): void {
    for (const placement of placements) {
      const def = MOB_REGISTRY[placement.type];
      if (!def) continue; // unknown mob type — skip silently
      this.spawnOne(placement, def);
    }
  }

  /** Called every GameScene.update(). Advances every mob by one frame. */
  update(): void {
    for (const mob of this.mobs) {
      this.stepMob(mob);
    }
  }

  /** Destroy all sprites and cancel all timers. Call on scene shutdown. */
  destroy(): void {
    for (const mob of this.mobs) {
      if (mob.timer !== null) clearTimeout(mob.timer);
      mob.sprite.destroy();
    }
    this.mobs = [];
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private spawnOne(p: MobPlacement, def: MobDef): void {
    const x = p.x + Math.random() * p.width;
    const y = p.y + Math.random() * p.height;

    const sprite = this.scene.add
      .sprite(x, y, p.type)
      .setOrigin(0.5, 1); // bottom-centre so depth sorting by y is correct

    const mob: MobInstance = {
      sprite,
      type:    p.type,
      leftBorder:   p.x,
      rightBorder:  p.x + p.width,
      upperBorder:  p.y,
      bottomBorder: p.y + p.height,
      speed:          p.speed                      ?? def.defaultSpeed,
      changeTime:     p.changeTime                 ?? def.defaultChangeTime,
      specialTime:    p.specialTime                ?? def.defaultSpecialTime,
      chanceOfSpecial: p.chanceOfDoingSpecialAction ?? def.defaultChanceOfSpecialAction,
      currentAction:  "goDown",
      timer:          null,
    };

    this.ensureAnimations(p, def);
    sprite.anims.play(`${p.type}-goDown`, true);
    this.scheduleChange(mob);
    this.mobs.push(mob);
  }

  /** Register Phaser animations for this mob type (skips if already created). */
  private ensureAnimations(p: MobPlacement, def: MobDef): void {
    const mgr  = this.scene.anims;
    const rate = p.howManyAnimationsPerSec ?? def.defaultFrameRate;

    const dirs: Action[] = ["goLeft", "goRight", "goUp", "goDown", "specialAction"];
    for (const dir of dirs) {
      const key = `${p.type}-${dir}`;
      if (mgr.exists(key)) continue; // already registered for this mob type

      const frames =
        dir === "specialAction" && p.specialActionArray
          ? p.specialActionArray
          : def.frames[dir];

      mgr.create({
        key,
        frames:    mgr.generateFrameNumbers(p.type, { frames }),
        frameRate: rate,
        repeat:    -1,
      });
    }
  }

  /** Move the mob one step and play the matching animation. */
  private stepMob(mob: MobInstance): void {
    const s = mob.sprite;

    switch (mob.currentAction) {
      case "goLeft":
        if (s.x <= mob.leftBorder) { mob.currentAction = "specialAction"; break; }
        s.x -= mob.speed;
        s.anims.play(`${mob.type}-goLeft`, true);
        break;

      case "goRight":
        if (s.x >= mob.rightBorder) { mob.currentAction = "specialAction"; break; }
        s.x += mob.speed;
        s.anims.play(`${mob.type}-goRight`, true);
        break;

      case "goUp":
        if (s.y <= mob.upperBorder) { mob.currentAction = "specialAction"; break; }
        s.y -= mob.speed;
        s.anims.play(`${mob.type}-goUp`, true);
        break;

      case "goDown":
        if (s.y >= mob.bottomBorder) { mob.currentAction = "specialAction"; break; }
        s.y += mob.speed;
        s.anims.play(`${mob.type}-goDown`, true);
        break;

      case "specialAction":
        s.anims.play(`${mob.type}-specialAction`, true);
        break;
    }

    // Depth: bottom edge of sprite, same convention as static objects
    s.setDepth(s.y);
  }

  /** Schedule the next action change for a mob. */
  private scheduleChange(mob: MobInstance): void {
    const delay = this.randomDelay(mob.changeTime);
    mob.timer = setTimeout(() => {
      mob.timer = null;

      if (Math.random() < mob.chanceOfSpecial) {
        mob.currentAction = "specialAction";
        // Hold the special action for specialTime, then pick a new random action
        const holdDelay = mob.specialTime > 0
          ? mob.specialTime * (2 / 3) + Math.random() * mob.specialTime * (1 / 3)
          : this.randomDelay(mob.changeTime);
        mob.timer = setTimeout(() => {
          mob.timer = null;
          this.pickRandomAction(mob);
          this.scheduleChange(mob);
        }, holdDelay);
      } else {
        this.pickRandomAction(mob);
        this.scheduleChange(mob);
      }
    }, delay);
  }

  private pickRandomAction(mob: MobInstance): void {
    const actions: Action[] = ["goLeft", "goRight", "goUp", "goDown", "specialAction"];
    mob.currentAction = actions[Math.floor(Math.random() * actions.length)];
  }

  /** Random delay in the range [2/3 × changeTime, changeTime]. */
  private randomDelay(changeTime: number): number {
    return changeTime * (2 / 3) + Math.random() * changeTime * (1 / 3);
  }
}
