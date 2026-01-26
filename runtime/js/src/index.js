/**
 * Spacewar! Main Entry Point
 * 
 * Sets up game loop, input handling, and rendering
 */

import GameEngine from './game-engine.js';
import Renderer from './renderer.js';

// Get canvas and create renderer
const canvas = document.getElementById('game-canvas');
if (!canvas) {
    console.error('Canvas element not found');
    throw new Error('Canvas element with id "game-canvas" required');
}

const renderer = new Renderer(canvas);
const engine = new GameEngine({
    gameMode: 'instant_respawn',
    randomSeed: Date.now()
});

// Initialize game
engine.initialize();

// Input handling
const keyState = {
    // Player 1: WASD + Space + Shift
    KeyW: false, KeyA: false, KeyS: false, KeyD: false, Space: false, ShiftLeft: false,
    // Player 2: Arrows + Enter + RCtrl
    ArrowUp: false, ArrowLeft: false, ArrowDown: false, ArrowRight: false, Enter: false, ControlRight: false
};

document.addEventListener('keydown', (e) => {
    if (e.code in keyState) {
        keyState[e.code] = true;
        e.preventDefault();
    }
});

document.addEventListener('keyup', (e) => {
    if (e.code in keyState) {
        keyState[e.code] = false;
        e.preventDefault();
    }
});

/**
 * Map key states to player controls
 */
function updateControls() {
    // Player 1
    engine.setPlayerControl(0, {
        rotateCcw: keyState.KeyA,
        rotateCw: keyState.KeyD,
        thrust: keyState.KeyW,
        fire: keyState.Space,
        hyperspace: keyState.ShiftLeft
    });

    // Player 2
    engine.setPlayerControl(1, {
        rotateCcw: keyState.ArrowLeft,
        rotateCw: keyState.ArrowRight,
        thrust: keyState.ArrowUp,
        fire: keyState.Enter,
        hyperspace: keyState.ControlRight
    });
}

// Game loop
const TARGET_FPS = 60;
const TICK_INTERVAL = 1000 / TARGET_FPS;
let lastTick = performance.now();

function gameLoop(timestamp) {
    const elapsed = timestamp - lastTick;

    if (elapsed >= TICK_INTERVAL) {
        // Update controls from key state
        updateControls();

        // Run game tick
        engine.tick();

        // Render
        const state = engine.getState();
        renderer.render(state);

        lastTick = timestamp - (elapsed % TICK_INTERVAL);
    }

    requestAnimationFrame(gameLoop);
}

// Start game loop
console.log('Spacewar! RUNS Runtime starting...');
console.log('Player 1: WASD to move, Space to fire, Shift for hyperspace');
console.log('Player 2: Arrows to move, Enter to fire, Right Ctrl for hyperspace');
requestAnimationFrame(gameLoop);
