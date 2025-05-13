// --- Multiplayer Setup ---
const socket = io();
let mySocketId = null;
let serverGameState = null;

socket.on('connect', () => {
    mySocketId = socket.id;
    console.log('Connected to server as', mySocketId);
    window.setTimeout(() => {
        console.log('[DEBUG] mySocketId', mySocketId);
    }, 1000);
});

socket.on('player-joined', (data) => {
    console.log('Player joined:', data.id);
});

socket.on('player-left', (data) => {
    console.log('Player left:', data.id);
});

// --- Lobby/Game UI Switching ---
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const startGameBtn = document.getElementById('start-game-btn');
// Add lobby player list and status
let lobbyPlayersElem = document.getElementById('lobby-players');
if (!lobbyPlayersElem) {
    lobbyPlayersElem = document.createElement('div');
    lobbyPlayersElem.id = 'lobby-players';
    lobbyPlayersElem.style.margin = '12px 0';
    lobbyScreen.appendChild(lobbyPlayersElem);
}
let lobbyStatusElem = document.getElementById('lobby-status');
if (!lobbyStatusElem) {
    lobbyStatusElem = document.createElement('div');
    lobbyStatusElem.id = 'lobby-status';
    lobbyStatusElem.style.margin = '8px 0 0 0';
    lobbyScreen.appendChild(lobbyStatusElem);
}

let lobbyPlayers = [];
let lobbyNumPlayers = 2;
let lobbyHostId = null;

// Show lobby by default
lobbyScreen.style.display = '';
gameScreen.style.display = 'none';

startGameBtn.onclick = function() {
    const numPlayers = parseInt(document.getElementById('num-players-select').value, 10);
    const timer = parseInt(document.getElementById('timer-select').value, 10);
    socket.emit('start-game', { numPlayers, timer });
};

// Listen for live player list from server
socket.on('players', ({ players, numPlayers, hostId }) => {
    lobbyPlayers = players;
    lobbyNumPlayers = numPlayers;
    lobbyHostId = hostId;
    let html = '<b>Players in Lobby:</b><ul style="margin:0 0 0 18px;padding:0;">';
    for (const id of players) {
        html += `<li>${id === mySocketId ? 'You' : id}${id === hostId ? ' <span style=\'color:#2980b9\'>(Host)</span>' : ''}</li>`;
    }
    html += '</ul>';
    lobbyPlayersElem.innerHTML = html;
    // Status message
    const needed = numPlayers - players.length;
    if (needed > 0) {
        lobbyStatusElem.textContent = `Waiting for ${needed} more player${needed === 1 ? '' : 's'} to join...`;
        startGameBtn.disabled = true;
    } else {
        if (hostId === mySocketId) {
            lobbyStatusElem.textContent = 'All players joined! You may start the game.';
            startGameBtn.disabled = false;
        } else {
            lobbyStatusElem.textContent = 'All players joined! Waiting for host to start the game...';
            startGameBtn.disabled = true;
        }
    }
});

// Server tells us when to start the game
socket.on('game-started', (settings) => {
    lobbyScreen.style.display = 'none';
    gameScreen.style.display = '';
});

// Receive authoritative game state from server
socket.on('game-state', (state) => {
    serverGameState = state;
    console.log('[DEBUG] Received game-state:', state);
    console.log('[DEBUG] mySocketId:', mySocketId, 'currentTurn:', state.currentTurn, 'turnOrder:', state.turnOrder);
    renderGridFromServer(state);
    renderScores(state);
});

// --- Claim Square Handler ---
function handleSquareClick(index) {
    if (!serverGameState) return;
    // --- Starting Location Phase ---
    if (serverGameState.phase === 'choose_start') {
        // Only allow picking if it's your starting turn and square is unclaimed
        if (serverGameState.currentTurn !== mySocketId) return;
        if (serverGameState.claimed[index]) return;
        socket.emit('pick-start-square', { index });
        return;
    }
    // --- Main Phase ---
    if (serverGameState.phase === 'main') {
        // Allow simultaneous claiming: any player can pick if roundActive and not yet picked
        if (!serverGameState.roundActive || serverGameState.playerChoices[mySocketId] !== undefined) return;
        // Only allow picking unclaimed squares
        if (serverGameState.claimed[index]) return;
        socket.emit('claim-square', { index });
        return;
    }
    // Ignore clicks in other phases
}

// --- Render Grid From Server State ---
function renderGridFromServer(state) {
    // Phase feedback message
    let phaseMsg = document.getElementById('phase-msg');
    if (!phaseMsg) {
        phaseMsg = document.createElement('div');
        phaseMsg.id = 'phase-msg';
        phaseMsg.style.margin = '12px 0';
        phaseMsg.style.fontSize = '1.15em';
        phaseMsg.style.fontWeight = 'bold';
        phaseMsg.style.color = '#2d3436';
        phaseMsg.style.minHeight = '24px';
        gameScreen.insertBefore(phaseMsg, gameScreen.firstChild);
    }
    if (state.phase === 'choose_start') {
        if (state.currentTurn === mySocketId) {
            phaseMsg.textContent = 'Pick your starting square!';
        } else {
            phaseMsg.textContent = `Waiting for ${state.currentTurnName} to pick a starting square...`;
        }
    } else if (state.phase === 'main') {
        phaseMsg.textContent = '';
    } else if (state.phase === 'lobby') {
        phaseMsg.textContent = '';
    }

    // Render all squares from server state
    for (let i = 0; i < state.claimed.length; i++) {
        const cell = document.getElementById('cell-' + i);
        if (!cell) continue;
        const owner = state.claimed[i];
        cell.className = 'square';
        // Animate if just claimed
        if (window.moveLog && window.moveLog.length && window.moveLog[window.moveLog.length-1].idx === i) {
            cell.classList.add('just-claimed');
            setTimeout(() => cell.classList.remove('just-claimed'), 700);
        }
        // Color by owner (use playerClasses mapping for human players)
        if (owner) {
            // Fallback: assign a unique color to each unique owner if mapping is missing or buggy
            if (!window.fallbackMap) window.fallbackMap = {};
            if (!window.fallbackColors) window.fallbackColors = ['player1', 'player2', 'player3', 'player4'];
            if (!window.fallbackIdx) window.fallbackIdx = 0;
            let className = (state.playerClasses && state.playerClasses[owner]) ?
                state.playerClasses[owner] :
                (window.fallbackMap[owner] || (window.fallbackMap[owner] = window.fallbackColors[window.fallbackIdx++ % window.fallbackColors.length]));
            cell.classList.add(className);
            cell.classList.add('claimed');
        }
        // Defended
        if (state.defended && state.defended[i]) cell.classList.add('defended');
        // --- Highlight pickable squares for starting phase ---
        if (state.phase === 'choose_start' && state.currentTurn === mySocketId && !owner) {
            cell.classList.add('pickable');
        }
        // Allow picking unclaimed squares adjacent to your own, or defending your own square
        if (state.phase === 'main' && state.roundActive && state.playerChoices[mySocketId] === undefined) {
            // Unclaimed and adjacent to your own
            if (!owner && state.claimed.some((o, j) => o === mySocketId && getAdjacentIndices(j).includes(i))) {
                cell.classList.add('pickable');
            }
            // Defend your own
            if (owner === mySocketId) {
                cell.classList.add('pickable');
            }
        }
    }
    // Show winner if present
    if (state.winner && winnerElem) winnerElem.textContent = state.winner;
    else if (winnerElem) winnerElem.textContent = '';
    // Show round status
    if (state.phase === 'main' && state.roundActive && timerElem) timerElem.textContent = `Timer: ${state.timer}`;
    else if (timerElem) timerElem.textContent = '';
    // Show 'Your Turn!' message if it's the player's turn (main phase only)
    const turnMsg = document.getElementById('your-turn-msg');
    if (turnMsg) {
        if (state.phase === 'main' && state.roundActive && state.playerChoices && state.playerChoices[mySocketId] === undefined && state.currentTurn === mySocketId) {
            turnMsg.textContent = 'Your Turn!';
        } else {
            turnMsg.textContent = '';
        }
    }
}

// --- Render Scores (basic) ---
function renderScores(state) {
    // Assumes there is an element with id 'scoreboard'
    const scoreboard = document.getElementById('scoreboard');
    if (!scoreboard) return;
    let html = '<b>Scores:</b><br>';
    for (const [id, count] of Object.entries(state.playerSquares)) {
        html += `${id === mySocketId ? 'You' : id}: ${count}<br>`;
    }
    scoreboard.innerHTML = html;
}

// --- Setup Grid DOM (no local state) ---
function setupGridDOM() {
    const gridElem = document.getElementById('grid');
    gridElem.innerHTML = '';
    for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
        const cell = document.createElement('div');
        cell.className = 'square';
        cell.id = 'cell-' + i;
        cell.addEventListener('click', () => handleSquareClick(i));
        gridElem.appendChild(cell);
    }
}

// --- Game Logic ---
const GRID_SIZE = 10;
const WIN_COUNT = 30;
let TIMER_SECONDS = 3; // Default 3 seconds per round
const COMPUTER_PLAYERS = [
    { name: "Blue", class: "computer1", color: "#3498db" },
    { name: "Green", class: "computer2", color: "#27ae60" },
    { name: "Yellow", class: "computer3", color: "#f1c40f" },
    { name: "Purple", class: "computer4", color: "#9b59b6" },
    { name: "Orange", class: "computer5", color: "#e67e22" },
    { name: "Pink", class: "computer6", color: "#e84393" },
    { name: "Cyan", class: "computer7", color: "#00b8d4" },
    { name: "Brown", class: "computer8", color: "#8d5524" }
];

let grid = [];
let playerSquares = 0;
let computerSquares = Array(COMPUTER_PLAYERS.length).fill(0);
let computerActive = Array(COMPUTER_PLAYERS.length).fill(true);
let timer = TIMER_SECONDS;
let interval = null;
let playerChoice = null;
let computerChoices = Array(COMPUTER_PLAYERS.length).fill(null);
let claimed = Array(GRID_SIZE * GRID_SIZE).fill(null);
let defended = Array(GRID_SIZE * GRID_SIZE).fill(false);
let roundActive = false;
let moveLog = [];
let moveOrigins = [];
let selectingStart = false; // true during starting square selection phase


const gridElem = document.getElementById("grid");
const timerElem = document.getElementById("timer");
const playerScoreElem = document.getElementById("player-score");
const winnerElem = document.getElementById("winner");
const moveLogElem = document.getElementById("move-log");

// Dynamically get computer score elements
const computerScoreElems = COMPUTER_PLAYERS.map((_, i) => document.getElementById(`computer${i+1}-score`));

function createGrid() {
    gridElem.innerHTML = "";
    for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
        const div = document.createElement("div");
        div.className = "square";
        div.dataset.idx = i;
        div.addEventListener("click", () => handlePlayerClick(i));
        gridElem.appendChild(div);
    }
}

function getAdjacentIndices(idx) {
    const adj = [];
    const row = Math.floor(idx / GRID_SIZE);
    const col = idx % GRID_SIZE;
    if (row > 0) adj.push(idx - GRID_SIZE);
    if (row < GRID_SIZE - 1) adj.push(idx + GRID_SIZE);
    if (col > 0) adj.push(idx - 1);
    if (col < GRID_SIZE - 1) adj.push(idx + 1);
    return adj;
}

function canPlayerPick(idx) {
    // Allow defending your own squares
    if (claimed[idx] === "player") return true;
    // Only allow attacking/taking over if adjacent to your own square
    if (playerSquares === 0) return !claimed[idx]; // first move
    // Must be adjacent to a player square
    return claimed[idx] && claimed[idx] !== "player" && claimed.some((owner, i) => owner === "player" && getAdjacentIndices(i).includes(idx))
        || (!claimed[idx] && claimed.some((owner, i) => owner === "player" && getAdjacentIndices(i).includes(idx)));
}

function handlePlayerClick(idx) {
    // --- Starting square selection phase ---
    if (selectingStart) {
        if (claimed[idx]) return; // must be unclaimed
        claimed[idx] = "player";
        playerSquares = 1;
        logMove.roundMoves = [];
        logMove("Player (start)", idx, "#e74c3c");
        updateGridPreview();
        renderMoveLog();
        // Now let CPUs pick
        for (let i = 0; i < COMPUTER_PLAYERS.length; i++) {
            let cpuIdx = randomUnclaimedSquare();
            if (cpuIdx !== null) {
                claimed[cpuIdx] = COMPUTER_PLAYERS[i].class;
                computerSquares[i] = 1;
                logMove(COMPUTER_PLAYERS[i].name + " (start)", cpuIdx, COMPUTER_PLAYERS[i].color);
            }
        }
        updateGridPreview();
        renderMoveLog();
        selectingStart = false;
        winnerElem.textContent = "Click Start Game to begin!";
        updateScores();
        // Show Start Game controls
        const startControls = document.getElementById("start-controls");
        if (startControls) startControls.style.display = "block";
        // (Re)attach Start Game handler
        attachStartHandler();
        return;
    }
    // --- Normal game phase ---
    if (!roundActive || playerChoice !== null) return;
    if (!canPlayerPick(idx)) return;
    // Track origin for bounce logic
    let origin = null;
    if (claimed[idx] && claimed[idx] !== "player") {
        // Find one of your adjacent squares to this target
        for (let i = 0; i < claimed.length; i++) {
            if (claimed[i] === "player" && getAdjacentIndices(i).includes(idx)) {
                origin = i;
                break;
            }
        }
    }
    playerChoice = idx;
    moveOrigins[0] = origin; // 0 is always player
    updateGridPreview();
}

function getInitialPositions() {
    // Fair, well-spaced (not all edge, not all center, not all corners)
    // Player in top-left, computers at corners and near-centers
    return [
        0,   // Player (top-left)
        9,   // Blue (top-right)
        90,  // Green (bottom-left)
        99,  // Yellow (bottom-right)
        22,  // Purple (row 2, col 2)
        77,  // Orange (row 7, col 7)
        27,  // Pink (row 2, col 7)
        72,  // Cyan (row 7, col 2)
        44   // Brown (center)
    ];
}

function randomUnclaimedOrTakeoverSquare(forClass, idx) {
    if (!computerActive[idx]) return null;
    let options = [];
    let hasOwned = claimed.some(owner => owner === forClass);
    if (!hasOwned) return null;
    for (let i = 0; i < claimed.length; i++) {
        // Defend own squares
        if (claimed[i] === forClass) {
            options.push(i);
        } else if (
            // Attack/takeover only if adjacent to own square
            claimed[i] && claimed[i] !== forClass && claimed.some((owner, j) => owner === forClass && getAdjacentIndices(j).includes(i))
        ) {
            options.push(i);
        } else if (
            // Claim unclaimed if adjacent to own square
            !claimed[i] && claimed.some((owner, j) => owner === forClass && getAdjacentIndices(j).includes(i))
        ) {
            options.push(i);
        }
    }
    if (options.length === 0) return null;
    return options[Math.floor(Math.random() * options.length)];
}

function randomUnclaimedSquare() {
    let options = [];
    for (let i = 0; i < claimed.length; i++) {
        if (!claimed[i]) options.push(i);
    }
    if (options.length === 0) return null;
    return options[Math.floor(Math.random() * options.length)];
}


function computerPick() {
    computerChoices = COMPUTER_PLAYERS.map((c, idx) => {
        let pick = randomUnclaimedOrTakeoverSquare(c.class, idx);
        // If it's a takeover, pick an origin for bounce logic
        let origin = null;
        if (pick !== null && claimed[pick] && claimed[pick] !== c.class) {
            for (let j = 0; j < claimed.length; j++) {
                if (claimed[j] === c.class && getAdjacentIndices(j).includes(pick)) {
                    origin = j;
                    break;
                }
            }
        }
        moveOrigins[idx + 1] = origin; // idx+1: player is 0, computers 1..N
        return pick;
    });
}

function revealChoices() {
    let allChoices = [playerChoice, ...computerChoices];
    let counts = {};
    logMove.roundMoves = [];
    // --- BOUNCE LOGIC ---
    let bounced = new Set();
    for (let i = 0; i < allChoices.length; i++) {
        let myTarget = allChoices[i];
        let myOrigin = moveOrigins[i];
        if (myTarget === null || myOrigin === null) continue;
        // See if anyone else is attacking my origin from my target
        for (let j = 0; j < allChoices.length; j++) {
            if (i === j) continue;
            if (allChoices[j] === myOrigin && moveOrigins[j] === myTarget) {
                // Bounce!
                bounced.add(i);
                bounced.add(j);
            }
        }
    }
    // --- END BOUNCE LOGIC ---
    allChoices.forEach(idx => {
        if (idx !== null) counts[idx] = (counts[idx] || 0) + 1;
    });
    // Player defend
    if (!bounced.has(0) && playerChoice !== null && claimed[playerChoice] === "player") {
        defended[playerChoice] = true;
        logMove("Player (defend)", playerChoice, "#e74c3c");
    } else if (!bounced.has(0) && playerChoice !== null && claimed[playerChoice] && claimed[playerChoice] !== "player" && counts[playerChoice] === 1 && !defended[playerChoice]) {
        computerSquares[COMPUTER_PLAYERS.findIndex(c => c.class === claimed[playerChoice])]--;
        claimed[playerChoice] = "player";
        playerSquares++;
        defended[playerChoice] = false;
        logMove("Player (takeover)", playerChoice, "#e74c3c");
    } else if (!bounced.has(0) && playerChoice !== null && !claimed[playerChoice] && counts[playerChoice] === 1) {
        claimed[playerChoice] = "player";
        playerSquares++;
        defended[playerChoice] = false;
        logMove("Player", playerChoice, "#e74c3c");
    } else if (bounced.has(0)) {
        logMove("Player (bounce)", playerChoice, "#f1c40f");
    }
    // Computer defend/takeover/claim
    computerChoices.forEach((choice, i) => {
        if (!computerActive[i] || choice === null) return;
        let k = i + 1;
        if (!bounced.has(k) && claimed[choice] === COMPUTER_PLAYERS[i].class) {
            defended[choice] = true;
            logMove(`${COMPUTER_PLAYERS[i].name} (defend)`, choice, COMPUTER_PLAYERS[i].color);
        } else if (!bounced.has(k) && claimed[choice] && claimed[choice] !== COMPUTER_PLAYERS[i].class && counts[choice] === 1 && !defended[choice]) {
            if (claimed[choice] === "player") playerSquares--;
            else {
                const prevIdx = COMPUTER_PLAYERS.findIndex(c => c.class === claimed[choice]);
                if (prevIdx !== -1) computerSquares[prevIdx]--;
            }
            claimed[choice] = COMPUTER_PLAYERS[i].class;
            computerSquares[i]++;
            defended[choice] = false;
            logMove(`${COMPUTER_PLAYERS[i].name} (takeover)`, choice, COMPUTER_PLAYERS[i].color);
        } else if (!bounced.has(k) && !claimed[choice] && counts[choice] === 1) {
            claimed[choice] = COMPUTER_PLAYERS[i].class;
            computerSquares[i]++;
            defended[choice] = false;
            logMove(COMPUTER_PLAYERS[i].name, choice, COMPUTER_PLAYERS[i].color);
        } else if (bounced.has(k)) {
            logMove(`${COMPUTER_PLAYERS[i].name} (bounce)`, choice, "#f1c40f");
        }
    });
    // Remove computer player if they have no squares
    for (let i = 0; i < COMPUTER_PLAYERS.length; i++) {
        if (computerSquares[i] <= 0) {
            computerActive[i] = false;
            computerSquares[i] = 0;
        }
    }
    moveLog = logMove.roundMoves.slice();
    renderMoveLog();
    updateScores();
    updateGridPreview();
    checkWinner();
}

function attachStartHandler() {
    const startBtn = document.getElementById("start-btn");
    if (startBtn) {
        // Remove any existing click handlers
        startBtn.replaceWith(startBtn.cloneNode(true));
        const newBtn = document.getElementById("start-btn");
        if (!newBtn) return;
        newBtn.onclick = () => {
            console.log('[DEBUG] Start Game button clicked');
            // Get timer value from input
            const input = document.getElementById("turn-timer-input");
            let val = parseInt(input && input.value);
            if (!val || val < 1) val = 3;
            if (val > 30) val = 30;
            TIMER_SECONDS = val;
            timer = val;
            // Hide controls
            const startControls = document.getElementById("start-controls");
            if (startControls) startControls.style.display = "none";
            winnerElem.textContent = "";
            startRound();
        };
        console.log('[DEBUG] Start Game handler attached');
    }
}

function resetGame() {
    playerSquares = 0;
    computerSquares = Array(COMPUTER_PLAYERS.length).fill(0);
    computerActive = Array(COMPUTER_PLAYERS.length).fill(true);
    claimed = Array(GRID_SIZE * GRID_SIZE).fill(null);
    defended = Array(GRID_SIZE * GRID_SIZE).fill(false);
    moveLog = [];
    logMove.roundMoves = [];
    renderMoveLog();
    winnerElem.textContent = "Pick your starting square!";
    updateScores();
    createGrid();
    selectingStart = true;
    // Hide Start Game controls if visible
    const startControls = document.getElementById("start-controls");
    if (startControls) startControls.style.display = "none";
    // Always reset computerSquares to 0
    for (let i = 0; i < computerSquares.length; i++) computerSquares[i] = 0;
    // (Re)attach Start Game handler
    attachStartHandler();
    // Wait for player to pick, then CPUs will pick and game will start
}


function updateScores() {
    playerScoreElem.textContent = `Your Squares: ${playerSquares}`;
    for (let i = 0; i < COMPUTER_PLAYERS.length; i++) {
        if (computerScoreElems[i]) {
            computerScoreElems[i].textContent = `${COMPUTER_PLAYERS[i].name}: ${computerSquares[i]}`;
        }
    }
}

function checkWinner() {
    if (playerSquares >= WIN_COUNT) {
        winnerElem.textContent = "You win!";
        winnerElem.classList.add('winner-flash');
        setTimeout(() => winnerElem.classList.remove('winner-flash'), 1200);
        roundActive = false;
        clearInterval(interval);
    } else {
        for (let i = 0; i < computerSquares.length; i++) {
            if (computerSquares[i] >= WIN_COUNT) {
                let color = COMPUTER_PLAYERS[i].name;
                winnerElem.textContent = `${color} wins!`;
                winnerElem.classList.add('winner-flash');
                setTimeout(() => winnerElem.classList.remove('winner-flash'), 1200);
                roundActive = false;
                clearInterval(interval);
                break;
            }
        }
    }
}

function startRound() {
    if (claimed.filter(x => x).length >= GRID_SIZE * GRID_SIZE) return;
    playerChoice = null;
    computerChoices = Array(COMPUTER_PLAYERS.length).fill(null);
    defended = defended.map(() => false); // reset all defenses
    roundActive = true;
    timer = TIMER_SECONDS;
    timerElem.textContent = `Timer: ${timer}`;
    updateGridPreview();
    interval = setInterval(() => {
        timer--;
        timerElem.textContent = `Timer: ${timer}`;
        if (timer <= 0) {
            clearInterval(interval);
            roundActive = false;
            computerPick();
            revealChoices();
            setTimeout(startRound, 200); // shorter delay for fast testing
        }
    }, 1000);
}

function coordStr(idx) {
    const x = idx % GRID_SIZE;
    const y = Math.floor(idx / GRID_SIZE);
    return `(${x},${y})`;
}

function renderMoveLog() {
    moveLogElem.innerHTML = "";
    // Show all moves (optionally limit to last N)
    for (let i = 0; i < moveLog.length; i++) {
        const entry = moveLog[i];
        const div = document.createElement("span");
        div.className = "move-entry animate-move";
        const time = entry.time ? ` [${entry.time}]` : '';
        let moveType = entry.moveType ? ` (${entry.moveType})` : '';
        div.textContent = `${entry.name}${moveType}: ${coordStr(entry.idx)}${time}`;
        div.style.color = entry.color;
        moveLogElem.appendChild(div);
        setTimeout(() => div.classList.remove('animate-move'), 900);
    }
}

function logMove(name, idx, color, moveType) {
    if (!window.moveLog) window.moveLog = [];
    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    window.moveLog.push({ name, idx, color, moveType, time });
    renderMoveLog();
}

function updateGridPreview() {
    for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
        const sq = gridElem.children[i];
        sq.className = "square";
        if (claimed[i]) {
            sq.classList.add(claimed[i]);
            sq.classList.add("claimed");
            if (defended[i]) sq.classList.add("defended");
        }
        // Only highlight the currently selected takeover target
        if (playerChoice === i && claimed[i] && claimed[i] !== "player") {
            sq.classList.add("takeover-target");
        } else if (playerChoice === i && !claimed[i]) {
            sq.classList.add("player");
        } else if (playerChoice === i && claimed[i] === "player") {
            sq.classList.add("defended");
        } else if (selectingStart && !claimed[i]) {
            sq.classList.add("pickable");
        } else if (roundActive && canPlayerPick(i) && !claimed[i]) {
            sq.classList.add("pickable");
        }
    }
}

window.onload = () => {
    setupGridDOM(); // Only create the grid cells and listeners
};
