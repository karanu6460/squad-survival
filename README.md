# NOVA STRIKE

A mobile-first tactical team-deathmatch prototype. For offline practice, open `index.html` in a browser. For online play, use the included Node server; when hosted over HTTPS (or localhost), the game is installable as a full-screen PWA.

## Play online: real 5v5 rooms

1. Install Node.js 18 or later.
2. In this folder, run `npm start`.
3. Open `http://localhost:8787`.
4. Select **Find Online Match** and enter a callsign.

The included server has no external package dependency. It balances players between Alpha and Omega, starts a round when 10 players have joined, and authoritatively simulates input, bullets, collision, health, respawns, score, and the 40-kill win condition.

To play with people on the same Wi-Fi, share `http://YOUR-COMPUTER-LAN-IP:8787`. To play with friends over the public internet, deploy this exact Node app to a host that supports persistent WebSocket connections and share its HTTPS URL.

## Android app install

After opening the deployed HTTPS game link in Chrome on Android, tap **Install on Android** in the main menu, then choose **Download & Play**. Chrome installs NOVA STRIKE as a full-screen Progressive Web App and places it on the home screen. If Chrome has not shown the install prompt yet, use Chrome's three-dot menu and select **Install app**.

## Controls

- Touch: left stick to move; drag anywhere on the right half to aim; use **FIRE** to shoot and **DASH** to evade.
- Desktop: `WASD` / arrow keys to move, mouse to aim and click to fire, `Space` to dash.

## Performance and visuals

- Adaptive internal resolution starts in HDR-style quality, then only scales down when sustained frame time needs protection.
- The HUD shows measured FPS (up to 120 where the device and display can deliver it), rather than a fixed claim.
- Bot line-of-sight checks, HUD updates, and particles are budgeted to keep touch response smooth on midrange hardware.
- The arena uses code-rendered roads, concrete structures, cargo obstacles, tactical human silhouettes, and lightweight combat effects—no heavy texture pack is required.
- Procedural shot, hit, dash, elimination, and squad-link effects use a compressed audio bus so they stay punchy without clipping.
