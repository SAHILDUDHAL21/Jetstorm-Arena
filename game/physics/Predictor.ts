/**
 * Client-side prediction: applies local inputs immediately using the exact
 * shared simulation code, then rewinds & replays against authoritative
 * corrections (input-sequenced snapshots). Rendering uses a decaying error
 * offset so corrections are smooth instead of teleports.
 */
import { freshMoveState, stepPlayer, type MoveState } from '../../shared/physics';
import type { Rect } from '../../shared/maps';
import { INPUT_FIRE, INPUT_GRENADE, INPUT_JET, INPUT_JUMP, INPUT_MELEE, INPUT_RELOAD } from '../../shared/types';
import type { InputFrame, PlayerSnap } from '../../shared/types';

export interface LocalVisualState {
  jetting: boolean;
  fireHeld: boolean;
  fireEdge: boolean;
  grenadeEdge: boolean;
  meleeEdge: boolean;
  reloadEdge: boolean;
  jumped: boolean;
  landed: boolean;
}

export class Predictor {
  state: MoveState;
  pending: InputFrame[] = [];
  errX = 0;
  errY = 0;
  seq = 0;
  lastVisual: LocalVisualState = {
    jetting: false, fireHeld: false, fireEdge: false, grenadeEdge: false,
    meleeEdge: false, reloadEdge: false, jumped: false, landed: false,
  };
  private solids: Rect[];
  private lastFlags = 0;

  constructor(x: number, y: number, solids: Rect[]) {
    this.solids = solids;
    this.state = freshMoveState(x, y);
  }

  /** Apply one locally-generated input frame (called at 60 Hz). */
  step(frame: InputFrame, now: number): LocalVisualState {
    this.pending.push(frame);
    if (this.pending.length > 180) this.pending.shift();
    const v = this.apply(frame, now);
    this.lastVisual = v;
    return v;
  }

  private apply(frame: InputFrame, now: number): LocalVisualState {
    const prevJump = (this.lastFlags & INPUT_JUMP) !== 0;
    this.lastFlags = frame.fl;
    const res = stepPlayer(
      this.state,
      { mx: frame.mx, jump: (frame.fl & INPUT_JUMP) !== 0, jet: (frame.fl & INPUT_JET) !== 0 },
      this.solids,
      now,
      1 / 60,
    );
    return {
      jetting: (frame.fl & INPUT_JET) !== 0 && this.state.fuel > 0,
      fireHeld: (frame.fl & INPUT_FIRE) !== 0,
      fireEdge: (frame.fl & INPUT_FIRE) !== 0 && (this.lastFlags & INPUT_FIRE) === 0 ? false : (frame.fl & INPUT_FIRE) !== 0 && !prevJump && false,
      grenadeEdge: (frame.fl & INPUT_GRENADE) !== 0,
      meleeEdge: (frame.fl & INPUT_MELEE) !== 0,
      reloadEdge: (frame.fl & INPUT_RELOAD) !== 0,
      jumped: res.jumped,
      landed: res.landed,
    };
  }

  /** Rewind to authoritative state and replay unconfirmed inputs. */
  correct(snap: PlayerSnap, now: number): void {
    this.pending = this.pending.filter((f) => f.seq > snap.si);
    const prevX = this.state.body.x;
    const prevY = this.state.body.y;
    this.state = freshMoveState(snap.x, snap.y);
    this.state.body.vx = snap.vx;
    this.state.body.vy = snap.vy;
    this.state.fuel = snap.f;
    for (const f of this.pending) {
      this.apply(f, now);
    }
    const dx = prevX - this.state.body.x;
    const dy = prevY - this.state.body.y;
    if (dx * dx + dy * dy > 80 * 80) {
      this.errX = 0;
      this.errY = 0;
    } else {
      this.errX = dx;
      this.errY = dy;
    }
  }

  /** Decay the render error offset. */
  update(dt: number): void {
    const k = Math.exp(-dt * 14);
    this.errX *= k;
    this.errY *= k;
  }

  get displayX(): number {
    return this.state.body.x + this.errX;
  }

  get displayY(): number {
    return this.state.body.y + this.errY;
  }
}

/** Frame flags helper shared by input builders. */
export function flagsFor(input: {
  jump: boolean; jet: boolean; fire: boolean;
  grenade: boolean; melee: boolean; reload: boolean;
}): number {
  let fl = 0;
  if (input.jump) fl |= INPUT_JUMP;
  if (input.jet) fl |= INPUT_JET;
  if (input.fire) fl |= INPUT_FIRE;
  if (input.grenade) fl |= INPUT_GRENADE;
  if (input.melee) fl |= INPUT_MELEE;
  if (input.reload) fl |= INPUT_RELOAD;
  return fl;
}
