# Jetstorm Arena

A free, original **2D jetpack arena shooter for up to 4 players**, playable in the
browser. Create a room, share the 4-character code, and frag your friends — with a
**server-authoritative** realtime simulation, jetpack movement, six weapons,
grenades, melee, pickups, and three hand-built arenas.

> 100% original: procedural art (no image assets), synthesized audio (no audio
> files), original map layouts, original name and branding. Nothing here is
> copied from any existing game.

---

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [Controls](#controls)
- [Gameplay rules](#gameplay-rules)
- [Multiplayer architecture](#multiplayer-architecture)
- [Project structure](#project-structure)
- [Testing](#testing)
- [Deployment](#deployment)
- [Protocol notes for contributors](#protocol-notes-for-contributors)
- [Troubleshooting](#troubleshooting)
- [License note](#license-note)

---

## Features

**Matchmaking & rooms**

- Create a room (optional map choice) → 4-character code, e.g. `K7QP`
- Join by code, or Quick play (auto-join first non-full room, else create one)
- Lobby with ready flags, chat, host start; synchronized 3-2-1-GO countdown
- 4 players max per room; a running match admits late joiners while a slot is free
- Disconnect grace period (30 s) with **token-based reconnect** — hard reload or
  network blip reclaims your slot, score, and position state
- **Host migration**: if the host leaves, the next player hosts (lobby or mid-match)
- Empty rooms are garbage-collected after 90 s idle

**Gameplay**

- 3200×1800 world, three original maps: Foundry Yard, Skyline Docks, Cavern Cross
- Jetpack with fuel/drain/regen, coyote-time jump, jump buffering, jump-lock
- 6 weapons: pistol (semi), SMG, rifle, shotgun, sniper, rocket launcher
- Ammunition (mag + reserve), reload with cancel-on-switch, per-weapon fire rates
- Grenades (2 s fuse, 150 px splash), melee swipe with knockback
- Pickups: health, ammo, weapon crates (10/12/15 s respawn)
- 100 HP, 3 s respawn at the spawn point farthest from living enemies
- Free-for-all to **10 kills** or **5 minutes**; results screen + rematch
- Minimap, full HUD (health, fuel, ammo/reload, grenade count, weapon kit),
  TAB scoreboard, kill feed, damage flash, screen shake, particle effects
- Fully synthesized WebAudio sound + procedural canvas art — zero binary assets
- Mobile twin-stick controls (left stick moves/climbs, right stick aims +
  auto-fires, action buttons ≥ 44 px targets)

**Server authority & robustness**

- The server alone decides damage, kills, health, ammo, fire rate, hits,
  respawns, pickups, and match state. Clients predict movement locally and
  reconcile against snapshots.
- All inbound messages validated (names, codes, chat length, input frames,
  weapon ids) and rate-limited per connection (separate input/control/chat
  buckets; repeated abuse closes the socket)

---

## Quick start

Requirements: Node.js 20+ (Node 24 tested). No other services needed.

```bash
npm install
npm run dev          # next dev + authoritative WebSocket game server on /ws
```

Open http://localhost:3000 — the app auto-detects the WebSocket transport on
localhost. Other players on your LAN can join via `http://<your-ip>:3000`.

Useful scripts:

| Command             | What it does                                          |
| ------------------- | ----------------------------------------------------- |
| `npm run dev`       | Dev server + game WS server (single process, port 3000) |
| `npm run dev:web`   | Next dev only (e.g. for pure UI work)                 |
| `npm run build`     | Production Next.js build                              |
| `npm run start`     | Build + run the production server (Next + WS on /ws)  |
| `npm run test:mp`   | Multiplayer end-to-end test suite (see [Testing](#testing)) |
| `npm run typecheck` | TypeScript check across the whole repo                |
| `npm run lint`      | ESLint                                                |

Environment: copy `.env.example` to `.env.local`. Nothing is required for local
play; the optional variables enable multi-instance deployment (see
[Deployment](#deployment)).

---

## Controls

### Desktop

| Action            | Input                              |
| ----------------- | ---------------------------------- |
| Move              | `A` / `D` or `←` / `→`             |
| Jump              | `W` / `↑`                          |
| Jetpack (thrust)  | hold `SPACE`                       |
| Aim               | mouse                              |
| Fire              | hold left mouse button             |
| Reload            | `R`                                |
| Grenade           | `G`                                |
| Melee swipe       | `F` or `V`                         |
| Cycle weapon      | `Q`                                |
| Select weapon     | `1`–`6`                            |
| Scoreboard        | hold `TAB`                         |
| Chat              | `ENTER`                            |

### Mobile

- **Left stick** — move; push up to climb (jetpack), dedicated **JUMP** button
- **Right stick** — aim and auto-fire
- **Action buttons** — grenade / melee / reload
- HUD buttons for scoreboard and chat

---

## Gameplay rules

- Free-for-all, first to **10 kills** wins; otherwise the highest score at the
  **5-minute** mark wins.
- Every player starts with the pistol (12 + 60 rounds) and 2 grenades.
- Weapon crates grant a permanent kit slot (up to 6 weapons); re-touching a
  crate you own refills its ammo.
- Death drops nothing: you respawn in 3 s at a fresh spawn point with the
  pistol again.
- Grenades bounce with physics, arm for 2 s, and splash up to 90 damage with
  line-of-sight checks. Rockets explode on any impact (direct hit 45 + splash).
- Semi-auto weapons (pistol) need a fresh trigger press per shot; full-auto
  weapons respect their own fire rate.

---

## Multiplayer architecture

One authoritative simulation, two interchangeable transports:

```
                      ┌──────────────────────────────┐
                      │  shared/  (pure data + math) │
                      │  constants · types · weapons │
                      │  maps · physics (deterministic)│
                      └──────────────┬───────────────┘
                 identical functions │
        ┌────────────────────────────┴────────────────────────────┐
        │ server/                        │  game/ + React UI      │
        │  rooms/Room + RoomManager      │  Phaser MatchScene     │
        │  game/MatchSim (30 Hz)         │  client prediction     │
        │  validation + rate limiting    │  NetClient + Transport │
        └───────────┬───────────────────┴──────────┬─────────────┘
                    │ WebSocket /ws                │ WebSocket or SSE
        ┌───────────┴──────────┐        ┌────────────┴────────────┐
        │ server/ws-server.ts  │        │ app/api/rt/{stream,msg} │
        │ (self-hosted Node)   │        │ (serverless-friendly)   │
        └──────────────────────┘        └─────────────────────────┘
```

- **`server/game/sim.ts` — MatchSim**: the 30 Hz authoritative tick. Tick order:
  inputs → movement/gravity → bullets → grenades → damage → deaths → respawns →
  pickups → scores → match end → broadcast. Idles players (no input frames) are
  not stepped, so a frozen client stays frozen rather than gliding.
- **`server/rooms/`** — Room (membership, lobby, chat, host, GC) and
  RoomManager (routing, lifecycle, quickplay). Both transports share them.
- **Transports**
  - `server/ws-server.ts` — custom Node server: Next.js + a real WebSocket at
    `/ws`. Used by `npm run dev` and `npm run start`. `GET /healthz` reports
    `{"ok":true,"rooms":N}`.
  - `app/api/rt/stream` + `app/api/rt/msg` — SSE downlink + POST uplink for
    platforms without persistent sockets (Vercel). Optional Upstash Redis keeps
    rooms consistent across serverless instances (room blobs, ownership leases,
    cross-instance messages, adoption when the owning instance dies).
  - The browser picks automatically: WebSocket on localhost / explicit
    `NEXT_PUBLIC_WS_URL`, otherwise SSE.
- **Client** — `game/net/NetClient.ts` is a singleton (`lib/client/net.ts`) that
  survives route changes (menu → lobby → game keep one connection). Reconnect
  after a hard reload uses `{ t: 'hello', name, token }` to reclaim the slot.

### Determinism

The movement code in `shared/physics.ts` uses only `+ - * /` and clamps (no
transcendental math), so the authoritative server and the client-side predictor
produce bit-identical trajectories.

---

## Project structure

```
app/                     Next.js routes
  page.tsx               main menu (create/join/quick, map picker)
  lobby/page.tsx         lobby (players, chat, host controls)
  game/page.tsx          match screen
  api/rt/stream          SSE downlink (Vercel transport)
  api/rt/msg             POST uplink (Vercel transport)
components/              React UI (menus, lobby, HUD, overlays, mobile controls)
game/                    Phaser game layer
  scenes/                Boot, Preload, Menu, Match
  entities/ systems/     in-match rendering, particles, audio
  net/                   NetClient + WsTransport / HttpTransport
  input/                 shared input state (desktop + mobile write to it)
lib/client/              singleton net client, settings, profile storage
server/                  authoritative side (transport-agnostic)
  rooms/                 Room, RoomManager
  game/sim.ts            MatchSim (30 Hz authoritative simulation)
  validation/            every inbound message validated here
  networking/            ws transport, SSE hub, rate limiting
  store/                 MemoryStore / Upstash Redis store
  ws-server.ts           self-hosted entry point (Next + /ws)
shared/                  constants, types, weapons, maps, physics
scripts/test-e2e.ts      multiplayer end-to-end suite (npm run test:mp)
```

---

## Testing

`npm run test:mp` compiles the server bundle and drives **real WebSocket bot
clients** through the full lifecycle, covering the spec's scenarios 1–11:

1. create room (4-char code, host, map choice honored)
2. join ×3 + fifth join rejected (`room_full`)
3. ready flags + chat delivery
4. host start → synchronized countdown → playing; movement input applied
5. joining a running match: free slot admits, full room rejects
6. shooting produces shot events, bullets, damage
7. kill → kill credit → victim death → respawn within the window
8. disconnect grace + token reconnect mid-match reclaims the slot
9. host leaves → host migration notice → new host can start
10. full match to 10 kills → results → rematch resets scores
11. protocol validation (malformed JSON, bad names/codes, not-host) + rate
    limiting (burst flood → `rate_limited`, abusive floods get disconnected)

The suite takes ~2–3 minutes (scenario 10 plays a full match with a combat bot
that navigates the map, hunts, and finishes 10 kills).

---

## Deployment

### Self-hosted (WebSocket transport — lowest latency, recommended)

```bash
npm run build
npm run start          # PORT=3000 by default
```

Run behind your own TLS termination (e.g. nginx/caddy) and proxy **`/ws`** to
this process with upgrade support. Everything else is ordinary HTTP.

### Vercel (SSE transport, zero config)

```bash
vercel deploy
```

`vercel.json` disables buffering for `/api/rt/*` so SSE chunks flush immediately.
Works out of the box for small groups of players.

Serverless functions have a hard execution ceiling (`maxDuration = 300` on the
Hobby plan), so the SSE stream **rotates itself every ~4.5 minutes**: it closes
cleanly before the platform could kill it, the browser reconnects within a
second (EventSource `retry` hint), and the player reclaims their slot with the
session token — a running match continues without a visible disconnect. The
same recovery covers any network blip that drops the stream.

**Scaling beyond one instance:** without a shared store, rooms live in the
memory of whichever serverless instance created them. To make rooms work across
instances (and survive instance churn), add the optional Upstash Redis
variables from `.env.example`:

```
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

With them, room state is mirrored to Redis, one instance holds the simulation
lease, and if it disappears another instance adopts the room from the last
stored blob. To force a transport in the browser, set `NEXT_PUBLIC_TRANSPORT`
(`ws` or `http`) and optionally `NEXT_PUBLIC_WS_URL`.

---

## Protocol notes for contributors

- **Semi-auto fire edges**: input frames carry a fire *bit*; the server fires
  only when the bit transitions off→on (plus the weapon's fire-rate gate). A
  held bit is one trigger pull. Bots/UI must pulse the bit per frame.
- **Late join semantics**: joining a running match succeeds while any of the 4
  slots is free — the joiner spawns immediately ("joined the match" notice).
  When the room is full, `room_full` is returned regardless of phase.
- **Reconnect**: `hello` with your issued token (min 8 chars) reclaims your
  member slot within the 30 s disconnect grace. Members in the lobby are
  dropped immediately instead.
- **Names**: 1–16 visible characters after control-char stripping.
- **Room codes**: 4 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`.
- **Map choice**: `create` accepts an optional `mapId`; unknown values fall
  back to a random map.
- **Input frames**: max 8 per message; `mx ∈ {-1,0,1}`; aim is angle-only
  (send a normalized vector, |ax|,|ay| ≤ 1000); `fl` is a 6-bit mask.

---

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| Stuck on "Connecting…" in the menu | The WS server isn't reachable — run `npm run dev` (not `dev:web`) for local play, or set `NEXT_PUBLIC_TRANSPORT=http` to use the SSE transport. |
| `room_not_found` when joining | Room codes expire when rooms empty out — create a new room. |
| Rejoin after refresh puts me in the lobby | You were outside the 30 s reconnect window or the match had already ended. Start/join again. |
| Two tabs behave oddly | Each tab is its own session (own token). One session per tab is intended. |
| No audio until you play | Browsers require a user gesture; audio unlocks on first click/touch. |
| `test:mp` timing out | The suite needs ~2–3 min wall clock; give it a generous timeout. |
| SSE stream stalls behind a proxy | Ensure the proxy doesn't buffer responses (`X-Accel-Buffering: no` is already sent; nginx needs `proxy_buffering off`). |
| Game freezes after ~5 min on Vercel | Streams rotate at the platform's `maxDuration`; reconnect + token reclaim should be seamless. If it freezes, the reconnect likely landed on a different serverless instance — add the Upstash Redis variables so rooms work across instances. |

---

## License note

Original work — all art is generated procedurally at runtime, all audio is
synthesized with WebAudio, and all layouts, names, and code are original.
No third-party or copyrighted assets are used or distributed.
