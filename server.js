// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static(path.join(__dirname)));

// --- Multiplayer Game State ---
const GRID_SIZE = 10;
const WIN_COUNT = 30;

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

let lobby = {
    started: false,
    numPlayers: 2,
    timer: 3,
    hostId: null
};

let connectedPlayers = [];
let playerClasses = {};
let playerNumbers = {};
let nextPlayerNum = 1;
let gameState = {
    grid: Array(GRID_SIZE * GRID_SIZE).fill(null), // null = unclaimed, otherwise player id
    playerSquares: {}, // { socketId: count }
    claimed: Array(GRID_SIZE * GRID_SIZE).fill(null),
    defended: Array(GRID_SIZE * GRID_SIZE).fill(false),
    roundActive: false,
    timer: 3,
    interval: null, // DO NOT EMIT THIS
    playerChoices: {}, // { socketId: index }
    moveLog: [],
    winner: '',
    currentTurn: null, // socketId or computer class
    currentTurnName: '',
    turnOrder: [], // array of socketIds
    turnIndex: 0,
    phase: 'lobby', // 'lobby', 'choose_start', 'main'
    startingTurnIndex: 0, // for starting square selection
};

function resetGameState() {
    let newPlayerSquares = {};
    for (const id of connectedPlayers) {
        newPlayerSquares[id] = 0;
    }
    // Assign player classes (player1, player2, ...) using stable playerNumbers
    playerClasses = {};
    for (const [socketId, playerNum] of Object.entries(playerNumbers)) {
        playerClasses[socketId] = `player${playerNum}`;
    }
    console.log('[DEBUG][SERVER] playerClasses mapping:', playerClasses);
    gameState = {
        grid: Array(GRID_SIZE * GRID_SIZE).fill(null), // null = unclaimed, otherwise player id
        playerSquares: newPlayerSquares, // { socketId: count }
        claimed: Array(GRID_SIZE * GRID_SIZE).fill(null),
        defended: Array(GRID_SIZE * GRID_SIZE).fill(false),
        roundActive: false,
        timer: 3,
        interval: null, // DO NOT EMIT THIS
        playerChoices: {}, // { socketId: index }
        moveLog: [],
        winner: '',
        currentTurn: null, // socketId or computer class
        currentTurnName: '',
        turnOrder: [], // array of socketIds
        turnIndex: 0,
        phase: 'lobby', // 'lobby', 'choose_start', 'main'
        startingTurnIndex: 0, // for starting square selection
        playerColors: {} // will be set after turnOrder is set
    };
}

function getSerializableGameState() {
    // Exclude interval and any other non-serializable fields
    const { interval, ...safeState } = gameState;
    return {
        ...safeState,
        playerClasses
    };
}


// --- Game Logic Helpers ---
function getAdjacentIndices(idx) {
    // For use on the server as well as client
    const adj = [];
    const row = Math.floor(idx / GRID_SIZE);
    const col = idx % GRID_SIZE;
    if (row > 0) adj.push(idx - GRID_SIZE);
    if (row < GRID_SIZE - 1) adj.push(idx + GRID_SIZE);
    if (col > 0) adj.push(idx - 1);
    if (col < GRID_SIZE - 1) adj.push(idx + 1);
    return adj;
}

function canPlayerPick(idx, playerId) {
    // Allow defending your own squares
    if (gameState.claimed[idx] === playerId) return true;
    // Only allow attacking/takeover if adjacent to your own square
    const playerSquares = Object.entries(gameState.claimed).filter(([i, owner]) => owner === playerId).map(([i]) => parseInt(i));
    if (playerSquares.length === 0) return !gameState.claimed[idx]; // first move
    // Must be adjacent to a player square
    return gameState.claimed[idx] && gameState.claimed[idx] !== playerId && playerSquares.some(i => getAdjacentIndices(i).includes(idx))
        || (!gameState.claimed[idx] && playerSquares.some(i => getAdjacentIndices(i).includes(idx)));
}

function randomUnclaimedSquare() {
    let options = [];
    for (let i = 0; i < gameState.claimed.length; i++) {
        if (!gameState.claimed[i]) options.push(i);
    }
    if (options.length === 0) return null;
    return options[Math.floor(Math.random() * options.length)];
}

function randomUnclaimedOrTakeoverSquare(forClass, idx) {
    if (!gameState.computerActive[idx]) return null;
    let options = [];
    let hasOwned = gameState.claimed.some(owner => owner === forClass);
    if (!hasOwned) return null;
    for (let i = 0; i < gameState.claimed.length; i++) {
        // Defend own squares
        if (gameState.claimed[i] === forClass) {
            options.push(i);
        } else if (
            // Attack/takeover only if adjacent to own square
            gameState.claimed[i] && gameState.claimed[i] !== forClass && gameState.claimed.some((owner, j) => owner === forClass && getAdjacentIndices(j).includes(i))
        ) {
            options.push(i);
        } else if (
            // Claim unclaimed if adjacent to own square
            !gameState.claimed[i] && gameState.claimed.some((owner, j) => owner === forClass && getAdjacentIndices(j).includes(i))
        ) {
            options.push(i);
        }
    }
    if (options.length === 0) return null;
    return options[Math.floor(Math.random() * options.length)];
}

// --- Round Logic ---
function startRound() {
    if (gameState.claimed.filter(x => x).length >= GRID_SIZE * GRID_SIZE) return;
    gameState.playerChoice = null;
    gameState.computerChoices = Array(COMPUTER_PLAYERS.length).fill(null);
    gameState.defended = gameState.defended.map(() => false);
    gameState.roundActive = true;
    gameState.timer = 3;
    io.emit('game-state', getSerializableGameState());
    if (gameState.interval) clearInterval(gameState.interval);
    gameState.interval = setInterval(() => {
        gameState.timer--;
        io.emit('game-state', getSerializableGameState());
        if (gameState.timer <= 0) {
            clearInterval(gameState.interval);
            gameState.roundActive = false;
            computerPick();
            revealChoices();
            setTimeout(startRound, 2000); // short delay
        }
    }, 1000);
}

function computerPick() {
    gameState.computerChoices = COMPUTER_PLAYERS.map((c, idx) => {
        let pick = randomUnclaimedOrTakeoverSquare(c.class, idx);
        // If it's a takeover, pick an origin for bounce logic
        let origin = null;
        if (pick !== null && gameState.claimed[pick] && gameState.claimed[pick] !== c.class) {
            for (let j = 0; j < gameState.claimed.length; j++) {
                if (gameState.claimed[j] === c.class && getAdjacentIndices(j).includes(pick)) {
                    origin = j;
                    break;
                }
            }
        }
        gameState.moveOrigins[idx + 1] = origin; // idx+1: player is 0, computers 1..N
        return pick;
    });
}

function revealChoices() {
    let allChoices = [gameState.playerChoice, ...gameState.computerChoices];
    let counts = {};
    gameState.moveLog = [];
    // --- BOUNCE LOGIC ---
    let bounced = new Set();
    for (let i = 0; i < allChoices.length; i++) {
        let myTarget = allChoices[i];
        let myOrigin = gameState.moveOrigins[i];
        if (myTarget === null || myOrigin === null) continue;
        // See if anyone else is attacking my origin from my target
        for (let j = 0; j < allChoices.length; j++) {
            if (i === j) continue;
            if (allChoices[j] === myOrigin && gameState.moveOrigins[j] === myTarget) {
                bounced.add(i);
                bounced.add(j);
            }
        }
    }
    // Apply moves
    for (let i = 0; i < allChoices.length; i++) {
        let choice = allChoices[i];
        if (choice === null) continue;
        if (i === 0) {
            // Player
            if (!bounced.has(i) && (!gameState.claimed[choice] || gameState.claimed[choice] !== 'player')) {
                gameState.claimed[choice] = 'player';
                gameState.playerSquares[gameState.lastPlayerId] = (gameState.playerSquares[gameState.lastPlayerId] || 0) + 1;
            } else if (bounced.has(i)) {
                // bounced
            }
        } else {
            // Computer
            let compClass = COMPUTER_PLAYERS[i - 1].class;
            if (!bounced.has(i) && (!gameState.claimed[choice] || gameState.claimed[choice] !== compClass)) {
                gameState.claimed[choice] = compClass;
                gameState.computerSquares[i - 1] = (gameState.computerSquares[i - 1] || 0) + 1;
            } else if (bounced.has(i)) {
                // bounced
            }
        }
    }
    io.emit('game-state', getSerializableGameState());
}

// --- Socket.io connection handler ---
io.on('connection', (socket) => {

    if (!connectedPlayers.includes(socket.id)) connectedPlayers.push(socket.id);
    gameState.playerSquares[socket.id] = 0;
    // Assign a unique, stable player number
    if (!playerNumbers[socket.id]) {
        playerNumbers[socket.id] = Object.keys(playerNumbers).length;
    }
    // Assign player colors based on turn order: host=red, next=blue, then green, yellow, etc.
    if (!gameState.playerColors) gameState.playerColors = {};
    const colorList = ['#e74c3c', '#2980b9', '#27ae60', '#f1c40f', '#8e44ad', '#e67e22', '#1abc9c', '#34495e'];
    if (gameState.turnOrder && gameState.turnOrder.length > 0) {
        gameState.turnOrder.forEach((pid, i) => {
            gameState.playerColors[pid] = colorList[i % colorList.length];
        });
    }

    console.log('[DEBUG][SERVER] New connection:', socket.id);
    console.log('[DEBUG][SERVER] Current turnOrder:', gameState.turnOrder);
    console.log('[DEBUG][SERVER] Current currentTurn:', gameState.currentTurn);
    console.log('A user connected:', socket.id);

    // Set host if first player
    if (!lobby.hostId) lobby.hostId = socket.id;

    // Add player to state
    gameState.playerSquares[socket.id] = 0;

    // Send current state to the new client
    socket.emit('game-state', getSerializableGameState());
    emitPlayers();

    // Lobby: listen for 'start-game' from host
    socket.on('start-game', ({ numPlayers, timer }) => {
        lobby.started = false;
        lobby.numPlayers = numPlayers;
        lobby.timer = timer;
        console.log('[DEBUG][SERVER] Attempting to start game. playerSquares:', Object.keys(gameState.playerSquares));
        console.log('[DEBUG][SERVER] lobby:', lobby);
        // Wait for enough players to join
        if (Object.keys(gameState.playerSquares).length >= numPlayers) {
            if (Object.keys(gameState.playerSquares).length === 0) {
                console.log('[ERROR][SERVER] No human players connected! Aborting start.');
                return;
            }
            startGameFromLobby();
        } else {
            console.log('[DEBUG][SERVER] Not enough players to start game. Needed:', numPlayers, 'Present:', Object.keys(gameState.playerSquares).length);
        }
    });


    // Listen for claim-square events (main phase only)
    socket.on('claim-square', ({ index }) => {
        if (gameState.phase !== 'main') return;
        if (!gameState.roundActive) return;
        if (gameState.playerChoices[socket.id] !== undefined) return; // already picked
        // Defend your own square
        if (gameState.claimed[index] === socket.id) {
            gameState.defended[index] = true;
            gameState.playerChoices[socket.id] = index;
            gameState.moveLog.push({
                idx: index,
                color: gameState.playerColors[socket.id] || '#000',
                moveType: 'defend'
            });
            return;
        }
        // Take over another player's square if adjacent to your own
        if (gameState.claimed[index] && gameState.claimed[index] !== socket.id) {
            const isAdjacent = gameState.claimed.some((o, j) => o === socket.id && getAdjacentIndices(j).includes(index));
            if (isAdjacent) {
                gameState.playerChoices[socket.id] = index;
                gameState.moveLog.push({
                    idx: index,
                    color: gameState.playerColors[socket.id] || '#000',
                    moveType: 'takeover'
                });
            }
            return;
        }
        // Claim unclaimed square if adjacent to your own (or first move)
        if (gameState.claimed[index] === null) {
            const ownsAny = Object.values(gameState.claimed).includes(socket.id);
            const isAdjacent = gameState.claimed.some((o, j) => o === socket.id && getAdjacentIndices(j).includes(index));
            if (!ownsAny || isAdjacent) {
                gameState.playerChoices[socket.id] = index;
                gameState.moveLog.push({
                    idx: index,
                    color: gameState.playerColors[socket.id] || '#000',
                    moveType: 'claim'
                });
            }
            return;
        }
        // Otherwise, invalid move
        return;
        // Log move
        gameState.moveLog.push({
            name: getTurnName(socket.id),
            idx: index,
            color: socket.id === gameState.currentTurn ? '#e74c3c' : '#aaa',
            moveType: 'claim',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        });
        advanceTurn();
        io.emit('game-state', getSerializableGameState());
        // If all players have picked, end round early
        if (Object.keys(gameState.playerChoices).length >= lobby.numPlayers) {
            endRound();
        }
    });

    // Listen for pick-start-square (choose_start phase only)
    socket.on('pick-start-square', ({ index }) => {
        if (gameState.phase !== 'choose_start') return;
        if (gameState.currentTurn !== socket.id) return;
        if (gameState.claimed[index] !== null) return;
        gameState.claimed[index] = socket.id;
        advanceStartingTurn();
    });

    // Listen for reset event
    socket.on('reset-game', () => {
        resetGameState();
        io.emit('game-state', getSerializableGameState());
        lobby.started = false;
        lobby.hostId = socket.id;
        lobby.numPlayers = 2;
        lobby.timer = 3;
        emitPlayers();
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        delete gameState.playerSquares[socket.id];
        connectedPlayers = connectedPlayers.filter(id => id !== socket.id);
        delete playerNumbers[socket.id];
        emitPlayers();
        io.emit('game-state', getSerializableGameState());
        // If host leaves, pick a new host
        if (socket.id === lobby.hostId) {
            const ids = connectedPlayers;
            lobby.hostId = ids.length > 0 ? ids[0] : null;
        }
    });
});

function startGameFromLobby() {
    console.log('[DEBUG][SERVER] playerSquares at game start:', Object.keys(gameState.playerSquares));
    // Defensive: if no human players, abort
    if (Object.keys(gameState.playerSquares).length === 0) {
        console.log('[ERROR][SERVER] No human players in playerSquares! Aborting game start.');
        return;
    }
    lobby.started = true;
    resetGameState();
    gameState.timer = lobby.timer;
    // Establish turn order: ONLY human players
    gameState.turnOrder = connectedPlayers.slice();
    gameState.turnIndex = 0;
    gameState.currentTurn = gameState.turnOrder[0];
    gameState.currentTurnName = getTurnName(gameState.currentTurn);
    gameState.phase = 'choose_start';
    gameState.startingTurnIndex = 0;
    // Assign player colors based on turn order: host=red, next=blue, etc.
    const colorList = ['#e74c3c', '#2980b9', '#27ae60', '#f1c40f', '#8e44ad', '#e67e22', '#1abc9c', '#34495e'];
    gameState.playerColors = {};
    gameState.turnOrder.forEach((pid, i) => {
        gameState.playerColors[pid] = colorList[i % colorList.length];
    });
    console.log('[DEBUG] Game started. Turn order:', gameState.turnOrder);
    console.log('[DEBUG] First turn:', gameState.currentTurn, gameState.currentTurnName);
    io.emit('game-started', { numPlayers: lobby.numPlayers, timer: lobby.timer });
    console.log('[DEBUG][SERVER] Starting game. Turn order:', gameState.turnOrder);
    console.log('[DEBUG][SERVER] First turn:', gameState.currentTurn, gameState.currentTurnName);
    io.emit('game-state', getSerializableGameState());
    // No CPU auto-pick logic needed

}

function maybeAutoPickStart() {
    // If current turn is a computer, pick a random unclaimed square for it
    if (gameState.phase !== 'choose_start') return;
    const turn = gameState.turnOrder[gameState.startingTurnIndex];
    const isCPU = COMPUTER_PLAYERS.some(c => c.class === turn);
    if (isCPU) {
        const cpuIdx = COMPUTER_PLAYERS.findIndex(c => c.class === turn);
        const pick = randomUnclaimedSquare();
        if (pick !== null) {
            gameState.claimed[pick] = turn;
            // Optionally track computerSquares
        }
        advanceStartingTurn();
    }
}

function advanceStartingTurn() {
    gameState.startingTurnIndex++;
    if (gameState.startingTurnIndex >= gameState.turnOrder.length) {
        // All have picked, start main phase
        gameState.phase = 'main';
        gameState.startingTurnIndex = 0;
        setTimeout(() => startRound(), 500);
    } else {
        gameState.currentTurn = gameState.turnOrder[gameState.startingTurnIndex];
        gameState.currentTurnName = getTurnName(gameState.currentTurn);
        io.emit('game-state', getSerializableGameState());
        maybeAutoPickStart();
    }
}

function getTurnName(turnId) {
    if (Object.keys(gameState.playerSquares).includes(turnId)) return 'Player';
    const comp = COMPUTER_PLAYERS.find(c => c.class === turnId);
    return comp ? comp.name : 'Unknown';
}

function advanceTurn() {
    gameState.turnIndex = (gameState.turnIndex + 1) % gameState.turnOrder.length;
    gameState.currentTurn = gameState.turnOrder[gameState.turnIndex];
    gameState.currentTurnName = getTurnName(gameState.currentTurn);
}

function emitPlayers() {
    const playerIds = Object.keys(gameState.playerSquares);
    io.emit('players', {
        players: playerIds,
        numPlayers: lobby.numPlayers,
        hostId: lobby.hostId
    });
}

function resetGameState() {
    gameState.grid = Array(GRID_SIZE * GRID_SIZE).fill(null);
    gameState.claimed = Array(GRID_SIZE * GRID_SIZE).fill(null);
    gameState.playerSquares = {};
    gameState.defended = Array(GRID_SIZE * GRID_SIZE).fill(false);
    gameState.roundActive = false;
    gameState.timer = lobby.timer || 3;
    gameState.playerChoices = {};
    gameState.moveLog = [];
    gameState.winner = '';
}

function startRound() {
    if (!lobby.started) {
        console.log('[DEBUG] Attempted to start round, but lobby.started is false');
        return;
    }
    if (gameState.claimed.filter(x => x).length >= GRID_SIZE * GRID_SIZE) return;
    gameState.playerChoices = {};
    gameState.defended = gameState.defended.map(() => false);
    gameState.roundActive = true;
    gameState.timer = lobby.timer;
    // Reset turn to first player
    gameState.turnIndex = 0;
    gameState.currentTurn = gameState.turnOrder[0];
    gameState.currentTurnName = getTurnName(gameState.currentTurn);
    console.log('[DEBUG] New round started. currentTurn:', gameState.currentTurn, 'currentTurnName:', gameState.currentTurnName);
    io.emit('game-state', getSerializableGameState());
    if (gameState.interval) clearInterval(gameState.interval);
    gameState.interval = setInterval(() => {
        gameState.timer--;
        io.emit('game-state', getSerializableGameState());
        if (gameState.timer <= 0) {
            clearInterval(gameState.interval);
            gameState.roundActive = false;
            endRound();
        }
    }, 1000);
}

function endRound() {
    if (gameState.interval) clearInterval(gameState.interval);
    gameState.roundActive = false;
    // Apply moves: all player choices
    for (const [pid, idx] of Object.entries(gameState.playerChoices)) {
        // Takeover: if owned by another player
        if (gameState.claimed[idx] && gameState.claimed[idx] !== pid) {
            const prevOwner = gameState.claimed[idx];
            gameState.claimed[idx] = pid;
            // Decrement previous owner's square count
            if (gameState.playerSquares[prevOwner] > 0) gameState.playerSquares[prevOwner]--;
            gameState.playerSquares[pid] = (gameState.playerSquares[pid] || 0) + 1;
            continue;
        }
        // Claim: if unclaimed
        if (gameState.claimed[idx] === null) {
            gameState.claimed[idx] = pid;
            gameState.playerSquares[pid] = (gameState.playerSquares[pid] || 0) + 1;
        }
        // Defend: already handled in main logic by marking defended
    }
    // Log 'no placement' for players who did not act
    for (const pid of Object.keys(gameState.playerSquares)) {
        if (!(pid in gameState.playerChoices)) {
            gameState.moveLog.push({
                idx: null,
                color: gameState.playerColors[pid] || '#888',
                moveType: 'no placement'
            });
        }
    }
    // Check for winner
    let winnerId = null;
    for (const [pid, count] of Object.entries(gameState.playerSquares)) {
        if (count >= WIN_COUNT) {
            winnerId = pid;
            break;
        }
    }
    if (winnerId) {
        gameState.winner = getTurnName(winnerId);
        io.emit('game-state', getSerializableGameState());
        return;
    }
    io.emit('game-state', getSerializableGameState());
    setTimeout(() => startRound(), 1500);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
