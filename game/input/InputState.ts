/**
 * Shared mutable input state. Desktop handlers (Phaser) and mobile controls
 * (React) both write here; the match scene samples it at the fixed input
 * rate to build authoritative-bound input frames.
 */
export interface InputState {
  /** -1 left, 1 right, 0 none (mobile joystick or keyboard) */
  mx: number;
  jump: boolean;
  jet: boolean;
  fire: boolean;
  /** aim direction (unit-ish vector; desktop recomputed from mouse each frame) */
  aimX: number;
  aimY: number;
  /** desktop mouse aim takes precedence when true */
  desktop: boolean;
  /** pending one-shot actions (consumed one per input frame) */
  queueGrenade: number;
  queueMelee: number;
  queueReload: number;
  /** UI gates */
  chatOpen: boolean;
  scoreboard: boolean;
}

export const inputState: InputState = {
  mx: 0,
  jump: false,
  jet: false,
  fire: false,
  aimX: 1,
  aimY: 0,
  desktop: true,
  queueGrenade: 0,
  queueMelee: 0,
  queueReload: 0,
  chatOpen: false,
  scoreboard: false,
};

export function resetInputState(): void {
  inputState.mx = 0;
  inputState.jump = false;
  inputState.jet = false;
  inputState.fire = false;
  inputState.aimX = 1;
  inputState.aimY = 0;
  inputState.queueGrenade = 0;
  inputState.queueMelee = 0;
  inputState.queueReload = 0;
  inputState.chatOpen = false;
  inputState.scoreboard = false;
}
