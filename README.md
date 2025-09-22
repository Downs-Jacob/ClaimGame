# Claim Game

Welcome to Claim Game — a fast, turn-based territory game built with Node.js, Express, and Socket.IO.

## Quick Start (Local)
1. Install Node.js 18+.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```
   The server listens on port 3000 (or the next available if 3000 is busy). You’ll see:
   `Server listening on port <PORT>`
4. Open the game in your browser:
   - http://localhost:3000
5. To simulate multiple players locally, open the URL in multiple tabs or browsers.

## Play With Friends Online (Temporary Tunnel)
The easiest way to playtest with friends is with a tunnel such as ngrok.

1. Start the server locally (see Quick Start above) and note the port (e.g., 3000).
2. Install ngrok: https://ngrok.com
3. Run a tunnel to your local port:
   ```bash
   ngrok http 3000
   ```
   If the app started on 3001 (because 3000 was in use), run `ngrok http 3001`.
4. Share the https URL shown by ngrok with your friends. They can join your game using that URL.

Notes:
- Because the client and Socket.IO are served by the same server, no additional CORS config is needed for ngrok.
- If you restart and the port changes, restart ngrok with the new port.

## Optional: Cloud Deployment (Stable URL)
You can deploy to a host that supports WebSockets, such as Render or Railway.

- Render (recommended for simplicity)
  - Push this repo to GitHub.
  - Create a new Render Web Service from the repo.
  - Build Command: `npm install`
  - Start Command: `node server.js`
  - Render sets the PORT env var automatically; the app already respects it.
  - Share the generated URL with friends.

## Game Rules

### Overview
- 10x10 grid. Players claim squares to grow territory.
- The game runs in rounds with a countdown timer. Each player chooses one action per round.

### Phases
1. Lobby
   - Players join. The host selects number of players and round timer, then starts the game.
2. Starting Picks (`choose_start`)
   - Turn-based: each player chooses an unclaimed starting square.
   - This starting square becomes the player’s Home Base.
3. Main Rounds (`main`)
   - Each round has a timer. During the timer, each player secretly selects one square.
   - When the timer ends, all moves resolve simultaneously.

### Actions (one per round)
- Claim: Take an unclaimed square that is adjacent (up/down/left/right) to one of your squares. Your very first claim may be anywhere if you have no squares yet.
- Takeover: Capture an adjacent enemy square (must be next to one of your squares). If multiple players target the same square, see Bounce below.
- Defend: Select one of your own squares to reinforce it for that round.

### Resolution
- Simultaneous resolution at end of timer.
- Bounce: If 2+ players target the same square in a round, that square is not changed — nobody gets it.
- Home Base:
  - Your initial square is your Home Base.
  - If your Home Base is captured, you are eliminated immediately in that round.
  - Mutual base captures in the same round eliminate all affected players.
  - Eliminated players’ choices for that round are ignored, and all their squares are cleared.

### Win / Draw
- A player wins immediately if:
  - They are the last remaining player, or
  - They reach the target territory count (WIN_COUNT = 30 by default).
- Draw:
  - If all players are eliminated in the same round (e.g., mutual base captures) and no one remains, the game ends in a draw.

## Controls / UI
- Click a square to select your action (valid squares are highlighted during your turn window):
  - Unclaimed adjacent squares: Claim.
  - Your own square: Defend.
  - Enemy adjacent squares: Takeover.
- Home bases are marked with an “H” badge and a subtle inset border.
- Move Log shows the most recent actions at the top and caps at 30 entries.

## Project Structure
- `server.js` — Express + Socket.IO server; authoritative game logic and state.
- `index.html` — Main HTML page.
- `game.js` — Client logic (renders server state, sends actions, updates move log).
- `style.css` — Styles and animations.
- `package.json` — Dependencies and scripts.

## Troubleshooting
- Port already in use (EADDRINUSE):
  - The server auto-retries on the next port (3001-3009). Watch the console for the final port.
  - If using ngrok, tunnel the printed port.
- Can’t connect from friends:
  - Ensure ngrok is running and you’re sharing the https URL.
  - Check that your local server is still running.
- Game feels out of sync:
  - Hard refresh the browser (Cmd/Ctrl+Shift+R) to reload JS/CSS.

## License
MIT
