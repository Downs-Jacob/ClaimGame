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
    // Update move log from server
    if (Array.isArray(state.moveLog)) {
        window.moveLog = state.moveLog;
        renderMoveLog();
    }
});

// --- Multiplayer-safe canPlayerPick ---
function canPlayerPickMultiplayer(idx) {
    const claimed = serverGameState.claimed;
    const myId = mySocketId;
    const mySquares = serverGameState.playerSquares[myId] || 0;
    // Allow defending your own squares
    if (claimed[idx] === myId) return true;
    // Only allow attacking/taking over if adjacent to your own square
    if (mySquares === 0) return !claimed[idx]; // first move
    // Must be adjacent to a player square
    return (
        (claimed[idx] && claimed[idx] !== myId && claimed.some((owner, i) => owner === myId && getAdjacentIndices(i).includes(idx))) ||
        (!claimed[idx] && claimed.some((owner, i) => owner === myId && getAdjacentIndices(i).includes(idx)))
    );
}

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
        if (!serverGameState.roundActive || serverGameState.playerChoices[mySocketId] !== undefined) return;
        // Only allow picking if valid by new canPlayerPickMultiplayer
        if (!canPlayerPickMultiplayer(index)) return;
        let origin = null;
        // If attacking an enemy square, find one of your adjacent squares as origin
        if (serverGameState.claimed[index] && serverGameState.claimed[index] !== mySocketId) {
            for (let i = 0; i < serverGameState.claimed.length; i++) {
                if (serverGameState.claimed[i] === mySocketId && getAdjacentIndices(i).includes(index)) {
                    origin = i;
                    break;
                }
            }
        }
        // Send only index, as the server expects { index }
        socket.emit('claim-square', { index });
        return;
    }
    // Ignore clicks in other phases
}


// --- Render Grid From Server State ---
function renderGridFromServer(state) {
    // Determine if we should animate new claims only once when new moves arrive
    let shouldAnimate = false;
    const currentMoveLogLen = Array.isArray(state.moveLog) ? state.moveLog.length : 0;
    if (window._lastMoveLogLen === undefined || currentMoveLogLen !== window._lastMoveLogLen) {
        shouldAnimate = true;
    }
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
        // Animate if just claimed, only once per new move log update
        if (shouldAnimate && window.moveLog && window.moveLog.length && window.moveLog[window.moveLog.length-1].idx === i) {
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
        // Mark home base visually
        if (state.homeBases && owner && state.homeBases[owner] === i) {
            cell.classList.add('home-base');
        }
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
    // Remember last moveLog length to avoid re-animating on timer ticks
    window._lastMoveLogLen = currentMoveLogLen;
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

// --- Minimal client constants and DOM refs ---
const GRID_SIZE = 10;
const gridElem = document.getElementById("grid");
const timerElem = document.getElementById("timer");
const winnerElem = document.getElementById("winner");
const moveLogElem = document.getElementById("move-log");

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

function coordStr(idx) {
    const x = idx % GRID_SIZE;
    const y = Math.floor(idx / GRID_SIZE);
    return `(${x},${y})`;
}

function renderMoveLog() {
    const logElem = document.getElementById('move-log');
    if (!logElem) return;
    logElem.innerHTML = '';
    if (!window.moveLog || !Array.isArray(window.moveLog)) return;
    const MAX_ITEMS = 30;
    // Keep only the latest MAX_ITEMS and show newest first
    const latest = window.moveLog.slice(-MAX_ITEMS).reverse();
    for (const entry of latest) {
        let moveText = '';
        if (entry.moveType === 'defend') {
            moveText = `defended (${coordStr(entry.idx)})`;
        } else if (entry.moveType === 'claim') {
            moveText = `claimed (${coordStr(entry.idx)})`;
        } else if (entry.moveType === 'takeover') {
            moveText = `took over (${coordStr(entry.idx)})`;
        } else if (entry.moveType === 'bounce') {
            moveText = `BOUNCE ${coordStr(entry.idx)}`;
        } else if (entry.moveType === 'no placement') {
            moveText = `(no placement)`;
        } else if (entry.moveType === 'eliminated') {
            moveText = `(eliminated)`;
        }
        const div = document.createElement('div');
        div.textContent = moveText;
        div.style.fontSize = '13px';
        div.style.color = entry.color || '#000';
        logElem.appendChild(div);
    }
}

window.onload = () => {
    setupGridDOM(); // Only create the grid cells and listeners
};
