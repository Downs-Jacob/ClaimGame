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
        roundActive = false;
        clearInterval(interval);
    } else {
        for (let i = 0; i < computerSquares.length; i++) {
            if (computerSquares[i] >= WIN_COUNT) {
                let color = COMPUTER_PLAYERS[i].name;
                winnerElem.textContent = `${color} wins!`;
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
    // Show only the most recent moves for this round
    for (let i = 0; i < moveLog.length; i++) {
        const entry = moveLog[i];
        const div = document.createElement("span");
        div.className = "move-entry";
        div.textContent = `${entry.name}: ${coordStr(entry.idx)}`;
        div.style.color = entry.color;
        moveLogElem.appendChild(div);
    }
}

function logMove(name, idx, color) {
    // Instead of accumulating, just show the latest round's moves
    if (!logMove.roundMoves) logMove.roundMoves = [];
    logMove.roundMoves.push({ name, idx, color });
    // At the end of revealChoices, render only this round's moves
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
    createGrid();
    resetGame();
    attachStartHandler();
};
