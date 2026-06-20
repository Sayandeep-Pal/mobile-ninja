# Build prompt: AirBlade — phone-controlled fruit slicing game

Copy everything below into Claude Code (or any AI coding assistant) to build the project. It's written as a complete spec, not a vague idea — follow it section by section.

---

## Project summary

Build a 2-screen web game called **AirBlade**:

- **Display client**: a browser page (meant for a laptop/TV/monitor) that renders a Fruit-Ninja-style game — fruit flies up under gravity, you slice it with a blade trail, bombs end your combo, score and lives are tracked.
- **Controller client**: a browser page opened on a phone. It reads the phone's motion sensors as the player physically swings the phone like a katana, and streams that motion to the display in real time.
- **Relay server**: a small Node.js server that serves both pages and relays motion data between a given phone and display over WebSocket, using a short room code so multiple people could run sessions on the same server without crossing wires.

No app install. No login. Open the display URL on a computer, open the same URL on a phone, enter the room code shown on the display (or scan a QR code), and start swinging.

---

## Tech stack (use exactly this unless there's a strong reason not to)

- **Server**: Node.js + Express (serves static files) + Socket.io (WebSocket relay with auto-reconnect)
- **Display game renderer**: HTML5 Canvas + vanilla JS (no game framework needed for v1 — keep dependencies light)
- **Controller page**: plain HTML/JS, no framework, optimized for fast load on mobile data/WiFi
- **QR code generation**: `qrcode` npm package, generate server-side or client-side as a data URL
- **Styling**: plain CSS, mobile-first for the controller page

---

## Repo structure

```
airblade/
├── server/
│   ├── index.js              # Express + Socket.io server, room management
│   └── package.json
├── public/
│   ├── display/
│   │   ├── index.html        # Game display page
│   │   ├── game.js           # Canvas game loop, physics, rendering, slice detection
│   │   └── style.css
│   └── controller/
│       ├── index.html        # Phone controller page
│       ├── controller.js     # Sensor reading, smoothing, socket send
│       └── style.css
└── README.md
```

---

## 1. Server (`server/index.js`)

Responsibilities:
- Serve `/display` and `/controller` static folders.
- On display page load, generate a random 4-character room code (e.g. `K7X2`, uppercase letters/digits, avoid ambiguous chars like 0/O, 1/I).
- Generate a QR code (as a data URL) encoding the full controller URL with the room code pre-filled as a query param, e.g. `https://yourapp.com/controller?room=K7X2`.
- Socket.io namespacing/rooms:
  - When the display connects, it emits `create_room`. Server generates the code, joins that socket to a Socket.io room named after the code, and replies with `room_created` containing the code + QR data URL.
  - When a controller connects with a room code (typed manually or from the QR param), it emits `join_room` with the code. Server validates the room exists, joins the controller socket to that room, and emits `player_joined` to the display.
  - All subsequent motion data from the controller is relayed via `socket.to(roomCode).emit('motion_data', payload)` — only to sockets in that room, not broadcast globally.
- Handle disconnects gracefully: if the controller disconnects mid-game, notify the display (`controller_disconnected`) so it can pause and show "reconnecting..." instead of silently freezing.
- Clean up empty rooms after both sockets leave.

---

## 2. Controller page (`public/controller/`)

### UI requirements
- Big, simple, thumb-friendly. This is used one-handed while swinging a phone around, so no fine tapping required mid-game.
- **Screen 1 — Connect**: input field for room code (auto-uppercase, 4 chars) OR auto-fill from `?room=` URL param if opened via QR scan. "Connect" button.
- **Screen 2 — Permission**: iOS requires a user gesture to request motion sensor access. Show a clear "Tap to enable motion controls" button that calls `DeviceMotionEvent.requestPermission()` (only present this screen on iOS 13+; auto-skip on Android/other browsers where no permission prompt is needed).
- **Screen 3 — Ready**: full-screen color or simple animation confirming "Connected — start swinging!" with a visible connection status indicator (don't let the player wonder if it's working).

### Sensor handling
- Listen to `devicemotion` for `acceleration` (or `accelerationIncludingGravity` if `acceleration` is null on some devices) and `rotationRate`.
- Listen to `deviceorientation` for `alpha/beta/gamma`.
- Apply a simple low-pass filter to smooth jitter before sending — don't forward raw noisy values. Example approach: `smoothed = smoothed * 0.8 + raw * 0.2` per axis, per sample.
- Sample/send rate: throttle outgoing socket messages to ~30 times per second even if the sensor fires faster — don't flood the socket on every raw event.
- Compute a "swing magnitude" from acceleration vector length; this is what the display will use to decide if a slice is happening, so make sure it's a clean, comparable number across devices (normalize/clamp it).
- On every socket send, emit a single compact payload (see protocol below) — don't send multiple separate messages per frame.
- Call `navigator.vibrate(40)` (short buzz) whenever a slice event is acknowledged back from the display — this is the haptic feedback that sells the "real katana" feeling. The display tells the controller when a slice landed via a `slice_confirmed` event back through the server.

---

## 3. Display page (`public/display/`)

### Connection flow
- On load, connect to server, emit `create_room`, receive room code + QR code, show both prominently ("Open this on your phone, or scan to connect") until a controller joins.
- Once `player_joined` fires, transition to a "Get ready" countdown (3-2-1) then start the game loop.

### Game loop (Canvas)
- **Fruits**: spawn at random x positions near the bottom, launched upward with randomized velocity and a slight horizontal drift, affected by gravity, despawn off-screen (counts as a miss if not sliced and it falls back down past the bottom).
- **Spawn rate**: starts slow, increases gradually with score/time for difficulty ramp. Occasionally spawn 2-3 fruits close together for combo opportunities.
- **Bombs**: same physics as fruit but visually distinct (different color/icon), slicing one ends the combo streak and costs a life; should spawn less frequently than fruit.
- **Cursor/blade position**: map incoming controller `beta`/`gamma` (tilt) values to a 2D position on the canvas (clamp to screen bounds), and keep a short trailing history of recent positions (last ~150ms) to draw the blade trail.
- **Slice detection**: when the controller's swing magnitude crosses a threshold (a "slice event" fires from the controller), check line-segment-vs-circle collision between the current blade trail segment and every active fruit/bomb's hitbox. On hit: remove the fruit, spawn a particle/juice splatter effect, increment score and combo counter, and emit `slice_confirmed` back to the controller's room for haptic feedback. On a bomb hit: trigger lose-life feedback (screen flash/shake) and reset combo.
- **Lives**: start with 3. Lose one when fruit is missed (falls off screen unsliced) or a bomb is sliced. Game over at 0 lives — show final score, combo record, and a "Play again" button that re-pairs the same room or generates a new one.
- **Combo system**: consecutive slices without a miss/bomb increase a multiplier (e.g. every 5 in a row = +1x), shown as an escalating on-screen counter.
- **Visual feedback**: screen shake on bomb hit, particle burst on fruit slice, blade trail rendered with a fading gradient (newest segment brightest), score/combo/lives always visible in a HUD overlay.

### Resilience
- If `controller_disconnected` fires mid-game, pause the game loop and show a clear "Phone disconnected — waiting to reconnect..." overlay rather than letting fruit pile up unfairly.

---

## 4. Data protocol (Socket.io events)

Keep payloads small and consistent. Suggested shapes:

**Controller → Server → Display**, event `motion_data`:
```json
{
  "x": 0.42,
  "y": -0.18,
  "swingMagnitude": 0.73,
  "isSlicing": true,
  "timestamp": 1718900000123
}
```
`x`/`y` are normalized -1 to 1 (mapped from tilt), `swingMagnitude` is normalized 0-1, `isSlicing` is a boolean the controller sets when magnitude crosses its internal threshold (keeps the heavy-lifting threshold logic on the controller, display just reacts).

**Display → Server → Controller**, event `slice_confirmed`:
```json
{ "type": "fruit", "combo": 7 }
```
or `{ "type": "bomb" }` — controller uses `type` to choose vibration pattern (short buzz for fruit, longer/double buzz for bomb).

**Room lifecycle events**: `create_room`, `room_created` (`{ code, qrDataUrl }`), `join_room` (`{ code }`), `player_joined`, `controller_disconnected`, `game_over` (`{ score, maxCombo }`).

---

## 5. Build order (do it in this sequence, don't jump ahead)

1. Server with room creation + QR generation, no game logic yet — verify a phone can join a room created by a desktop tab.
2. Controller page that just displays raw sensor numbers on screen (no sending yet) — verify permission flow works on an actual iPhone, not just a desktop browser emulator.
3. Wire controller → server → display: get a dot moving smoothly on the display canvas as you tilt the phone. No fruit yet.
4. Add one falling/launching fruit with gravity, no slicing — just visuals.
5. Add blade trail rendering from the position history.
6. Add line-circle slice detection against the single fruit.
7. Add scoring, multiple fruit spawns, lives, miss detection.
8. Add bombs, combo multiplier, particle effects, screen shake.
9. Add `slice_confirmed` round-trip for phone vibration feedback.
10. Add game-over screen, play-again flow, difficulty ramp over time.
11. Polish: sound effects, juicier particles, calibration step ("hold phone flat and tap to center" before game starts).

---

## 6. Known tricky parts to test explicitly (don't skip these)

- Test the iOS permission prompt on a real iPhone in Safari — it silently fails differently than you'd expect if you forget the user-gesture requirement.
- Test on the actual WiFi network you'll play on, not just localhost — latency and reconnect behavior matter a lot here.
- Test what happens when the phone screen locks/sleeps mid-game (consider a wake-lock request, or at least handle reconnection cleanly).
- Tune the slice threshold with real swings, not guessed numbers — too sensitive and idle hand tremor triggers slices, too strict and real swings get missed.

---

## Deliverable

A working local project (`npm install && npm start` runs the server, which serves both `/display` and `/controller`) that I can test by opening the display on my laptop and the controller on my phone over the same WiFi network.