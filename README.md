# 🗡️ AirBlade

**AirBlade** is a local-multiplayer fruit-slicing game inspired by Fruit Ninja. Your laptop/TV shows the game screen, and you swing your smartphone like a sword to slice fruits flying across the display.

No app install needed — it runs entirely in the browser, connected over your local WiFi network.

---

## What Is It?

- **Display** (laptop/TV browser): Shows the game canvas — flying fruits, bombs, score, lives, and QR code to join.
- **Controller** (your phone): Uses the phone's motion sensors (accelerometer + gyroscope) to detect swings. Tilt to aim, swing to slice.

---

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) v16 or newer
- Both devices on the **same WiFi network**

### Install & Run

```bash
cd /path/to/mobile-ninja/server
npm install
npm start
```

The server starts on **port 3000**.

---

## Usage

### 1. Open the Display

On your **laptop or TV**, open a browser and navigate to:

```
http://localhost:3000/display
```

You'll see the AirBlade title screen with a large **room code** and a **QR code**.

### 2. Join with Your Phone

On your **phone** (same WiFi), either:

- **Scan the QR code** shown on the display screen, or
- Open a browser and go to `http://[your-computer-ip]:3000/controller`  
  Then enter the 4-character room code shown on the display.

> **Finding your IP:** On Linux/Mac run `ip addr` or `ifconfig`. On Windows run `ipconfig`. Look for your WiFi adapter's IPv4 address (e.g., `192.168.1.42`).

### 3. Play!

Once connected, a **3-2-1 countdown** starts.

- **Tilt** your phone to move the blade left/right/up/down.
- **Swing** your phone quickly to slice fruits.
- **Avoid** bombs — slicing one costs a life and resets your combo.
- **Miss** a fruit (let it fall off screen) — lose a life.
- You start with **3 lives**. Game over at 0.

---

## Controls

| Action | How |
|--------|-----|
| Move blade | Tilt phone (gamma/beta angles) |
| Slice | Swing phone quickly (acceleration > threshold) |
| Aim up | Tilt phone backward |
| Aim down | Tilt phone forward |
| Aim left/right | Roll phone left/right |

The phone **vibrates** on a successful slice (fruit = short buzz, bomb = double buzz).

---

## Scoring

| Event | Points |
|-------|--------|
| Slice a fruit | 10 × combo multiplier |
| Every 5 consecutive slices | +1× multiplier |
| Miss a fruit | Reset combo, lose a life |
| Slice a bomb | Reset combo, lose a life |

---

## Game Features

- 🍉 7 hand-drawn fruit types (watermelon, orange, lemon, strawberry, grape, kiwi, peach)
- 💣 Bombs with animated fuse sparks
- ✨ Glowing blade trail with gradient effects
- 💥 Particle burst on each slice
- 📳 Haptic feedback on the controller phone
- 📈 Difficulty ramps up every 30 seconds
- 🔢 Combo system with multipliers
- 🔄 Play again without disconnecting

---

## Browser Requirements

| Device | Browser |
|--------|---------|
| Display (laptop/TV) | Any modern browser — Chrome, Firefox, Edge, Safari |
| Controller (iPhone) | **Safari on iOS 13+** (required for DeviceMotion permission API) |
| Controller (Android) | **Chrome on Android** (motion access granted automatically) |

> ⚠️ **iOS Note:** When joining on iPhone, Safari will show a prompt asking for motion sensor permission. Tap "Enable Motion Controls" to grant it. This prompt only appears once per session.

> ⚠️ **HTTPS Note:** Some browsers require HTTPS for DeviceMotion. If motion isn't working on Android Chrome, try accessing the site via the IP address (not `localhost`) and check that the URL starts with `http://` — Chrome on Android allows it on local network addresses.

---

## Architecture

```
Browser (Display)  ←──────────────────────┐
     │ socket.io                          │
     │ create_room → room_created         │
     │                                    │
     │         Server (Node.js)           │
     │         port 3000                  │
     │                                    │
Browser (Controller) ──────────────────────┘
     │ join_room { code }
     │ motion_data { x, y, swingMagnitude, isSlicing }
     └──────────────────────────────────────→ Display
              slice_confirmed ←─────────────── Display
```

---

## Project Structure

```
mobile-ninja/
├── server/
│   ├── index.js          # Express + Socket.io server
│   └── package.json
├── public/
│   ├── display/
│   │   ├── index.html    # Game display page
│   │   ├── game.js       # Full game engine (canvas)
│   │   └── style.css     # Display styles
│   └── controller/
│       ├── index.html    # Phone controller page
│       ├── controller.js # Sensor reading & socket emit
│       └── style.css     # Controller styles
└── README.md
```

---

## License

MIT — do whatever you want with it. Have fun! 🎮
