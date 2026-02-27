/**
 * Spacewar! - Authentic PDP-1 Port Entry Point
 * 
 * Uses the authentic engine translated line-by-line from spacewar_2b_25mar62.txt
 */

import SpacewarEngine from './pdp1-engine.js?v=4';
import SpacewarRenderer from './pdp1-renderer.js?v=4';

// Tick rate: original was ~60Hz (tied to display refresh)
const TICK_RATE = 60;
const TICK_INTERVAL = 1000 / TICK_RATE;

let engine;
let renderer;
let lastTick = 0;
let running = false;

/**
 * Initialize game
 */
function init() {
    const canvas = document.getElementById('game-canvas');
    if (!canvas) {
        console.error('Canvas not found');
        return;
    }

    // Create engine and renderer
    engine = new SpacewarEngine();
    renderer = new SpacewarRenderer(canvas);

    // Initialize game state
    engine.initialize();

    // Set up input
    setupInput();

    console.log('Spacewar! initialized (authentic PDP-1 port)');
}

/**
 * Set up keyboard input
 * 
 * Player 1 (Wedge): W/A/S/D + Space
 * Player 2 (Needle): Arrow keys + Enter
 */
function setupInput() {
    const keyState = {
        // Player 1
        KeyA: false,      // CCW
        KeyD: false,      // CW
        KeyW: false,      // Thrust
        KeyS: false,      // Fire
        KeyQ: false,      // Hyperspace

        // Player 2
        ArrowLeft: false,  // CCW
        ArrowRight: false, // CW
        ArrowUp: false,    // Thrust
        ArrowDown: false,  // Fire
        Enter: false       // Hyperspace
    };

    document.addEventListener('keydown', (e) => {
        if (keyState.hasOwnProperty(e.code)) {
            keyState[e.code] = true;
            e.preventDefault();
        }
    });

    document.addEventListener('keyup', (e) => {
        if (keyState.hasOwnProperty(e.code)) {
            keyState[e.code] = false;
            e.preventDefault();
        }
    });

    // Update controls each frame
    window.updateControls = () => {
        // Player 1: Bit 0=CCW, 1=CW, 2=Thrust, 3=Fire, 4=Hyperspace
        let p1 = 0;
        if (keyState.KeyA) p1 |= 1;
        if (keyState.KeyD) p1 |= 2;
        if (keyState.KeyW) p1 |= 4;
        if (keyState.KeyS) p1 |= 8;
        if (keyState.KeyQ) p1 |= 16;
        engine.setControl(0, p1);

        // Player 2
        let p2 = 0;
        if (keyState.ArrowLeft) p2 |= 1;
        if (keyState.ArrowRight) p2 |= 2;
        if (keyState.ArrowUp) p2 |= 4;
        if (keyState.ArrowDown) p2 |= 8;
        if (keyState.Enter) p2 |= 16;
        engine.setControl(1, p2);
    };
}

/**
 * Game loop
 */
function gameLoop(timestamp) {
    if (!running) return;

    // Fixed timestep logic
    if (timestamp - lastTick >= TICK_INTERVAL) {
        // Update controls
        window.updateControls();

        // Tick game
        engine.tick();

        // Render
        renderer.render(engine.getState());

        lastTick = timestamp;
    }

    requestAnimationFrame(gameLoop);
}

/**
 * Start game
 */
function start() {
    running = true;
    lastTick = performance.now();
    requestAnimationFrame(gameLoop);
    console.log('Spacewar! running');
}

/**
 * Main entry point
 */
function main() {
    console.log('Spacewar! - Authentic PDP-1 Port');
    console.log('Translated from spacewar_2b_25mar62.txt');

    init();
    start();
}

// Run when DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    main();
}

export { engine, renderer };
