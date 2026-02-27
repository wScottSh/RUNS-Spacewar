/**
 * Spacewar! Authentic Renderer
 * 
 * RIGOROUS translation mapping Q18 coordinates to display
 * 
 * Type 30 CRT Display:
 *   - 1024x1024 points
 *   - Origin at center
 *   - Circular visible area
 */

import { TWO_PI } from './pdp1-math.js?v=2';
import { OBJ_SHIP, OBJ_TORPEDO, OBJ_EXPLOSION } from './pdp1-objects.js?v=2';

// Display constants
const DISPLAY_SIZE = 512;  // Actual canvas size
const HALF_SIZE = DISPLAY_SIZE / 2;

// Q18 to display scaling
// Original PDP-1: 1024x1024 display, position range ±262144 (2^18/2)
// Ships at 200000₈ = 65536 should appear at ~180px from center (visually)
// This keeps diagonal positions (65536, 65536) -> 180*√2 ≈ 255 pixels, within 256 visible
// Scale: 180 / 65536 ≈ 0.00275
const SCALE = 180 / 65536;  // Ships visible within mask

/**
 * Convert Q18 coordinate to canvas pixel
 * 
 * Source uses signed 18-bit integers centered at 0
 * Display Y is inverted (canvas Y increases down, but math Y increases up)
 */
function q18ToPixelX(q18Value) {
    // Handle signed 18-bit
    let val = q18Value;
    if (val > 0o377777) val = val - 0o1000000;  // 2's complement
    return HALF_SIZE + (val * SCALE);
}

function q18ToPixelY(q18Value) {
    let val = q18Value;
    if (val > 0o377777) val = val - 0o1000000;
    // Invert Y for canvas
    return HALF_SIZE - (val * SCALE);
}

/**
 * Spacewar! Renderer
 */
export class SpacewarRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        // Set canvas size
        canvas.width = DISPLAY_SIZE;
        canvas.height = DISPLAY_SIZE;

        // Authentic colors
        this.bgColor = '#000000';
        this.fgColor = '#00ff00';  // Phosphor green
    }

    /**
     * Clear screen
     */
    clear() {
        this.ctx.fillStyle = this.bgColor;
        this.ctx.fillRect(0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
    }

    /**
     * Draw circular screen mask
     */
    drawMask() {
        this.ctx.save();
        this.ctx.globalCompositeOperation = 'destination-in';
        this.ctx.beginPath();
        this.ctx.arc(HALF_SIZE, HALF_SIZE, HALF_SIZE - 5, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.restore();
    }

    /**
     * Render complete frame
     */
    render(state) {
        this.clear();

        // Draw star at origin
        this.drawStar({ mx: 0, my: 0 });

        // Draw objects
        for (const obj of state.objects) {
            if (obj.type === OBJ_SHIP) {
                this.drawShip(obj);
            } else if (obj.type === OBJ_TORPEDO) {
                this.drawTorpedo(obj);
            } else if (obj.type === OBJ_EXPLOSION) {
                this.drawExplosion(obj);
            }
        }

        // Apply circular mask
        this.drawMask();

        // Debug: show positions
        // this.drawDebug(state);
    }

    /**
     * Draw central star
     */
    drawStar(star) {
        const cx = q18ToPixelX(0);
        const cy = q18ToPixelY(0);

        this.ctx.fillStyle = this.fgColor;

        // Scatter points (LFSR-based in original)
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const r = 2 + Math.random() * 3;
            const px = cx + Math.cos(angle) * r;
            const py = cy + Math.sin(angle) * r;
            this.ctx.fillRect(px - 1, py - 1, 2, 2);
        }

        // Center
        this.ctx.fillRect(cx - 2, cy - 2, 4, 4);
    }

    /**
     * Draw ship outline
     */
    drawShip(ship) {
        const cx = q18ToPixelX(ship.mx);
        const cy = q18ToPixelY(ship.my);

        // DEBUG: Draw a big bright circle so we can see where ship is
        this.ctx.fillStyle = '#ffff00';  // Yellow
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, 10, 0, Math.PI * 2);
        this.ctx.fill();

        // Convert Q18 angle to radians
        // Q18 angle: 0 to 311040₈ (102944) = 0 to 2π
        const angleRad = (ship.mth / TWO_PI) * Math.PI * 2;

        // Invert angle for canvas (Y is flipped)
        const drawAngle = -angleRad;

        this.ctx.strokeStyle = this.fgColor;
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();

        // mot = 1 for wedge (ship 1), 2 for needle (ship 2)
        if (ship.mot === 1) {
            this.drawWedge(cx, cy, drawAngle, 15);
        } else {
            this.drawNeedle(cx, cy, drawAngle, 15);
        }

        this.ctx.stroke();
    }

    /**
     * Draw wedge ship outline
     * ot1: 111131 111111 111111 111163 311111 146111 111114 700000
     */
    drawWedge(cx, cy, angle, scale) {
        const points = [
            { x: 1.0, y: 0.0 },   // Nose
            { x: 0.4, y: 0.3 },   // Upper hull
            { x: -0.3, y: 0.5 },  // Wing tip
            { x: -0.5, y: 0.2 },  // Rear corner
            { x: -0.4, y: 0.0 },  // Tail
        ];
        this.drawOutline(cx, cy, angle, scale, points, true);
    }

    /**
     * Draw needle ship outline
     * ot2: 013113 113111 116313 131111 161151 111633 365114 700000
     */
    drawNeedle(cx, cy, angle, scale) {
        const points = [
            { x: 1.4, y: 0.0 },   // Long nose
            { x: 0.6, y: 0.15 },  // Taper
            { x: 0.0, y: 0.2 },   // Mid body
            { x: -0.4, y: 0.25 }, // Rear section
            { x: -0.6, y: 0.15 }, // Wing
            { x: -0.5, y: 0.0 },  // Tail
        ];
        this.drawOutline(cx, cy, angle, scale, points, true);
    }

    /**
     * Draw outline with rotation
     */
    drawOutline(cx, cy, angle, scale, points, mirror) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        const transform = (p) => ({
            x: cx + (p.x * cos - p.y * sin) * scale,
            y: cy + (p.x * sin + p.y * cos) * scale
        });

        // Upper half
        this.ctx.moveTo(transform(points[0]).x, transform(points[0]).y);
        for (let i = 1; i < points.length; i++) {
            const t = transform(points[i]);
            this.ctx.lineTo(t.x, t.y);
        }

        // Lower half (mirrored)
        if (mirror) {
            for (let i = points.length - 2; i >= 0; i--) {
                const p = { x: points[i].x, y: -points[i].y };
                const t = transform(p);
                this.ctx.lineTo(t.x, t.y);
            }
            this.ctx.closePath();
        }
    }

    /**
     * Draw torpedo
     */
    drawTorpedo(torpedo) {
        const x = q18ToPixelX(torpedo.mx);
        const y = q18ToPixelY(torpedo.my);

        this.ctx.fillStyle = this.fgColor;
        this.ctx.fillRect(x - 2, y - 2, 4, 4);
    }

    /**
     * Draw explosion
     */
    drawExplosion(obj) {
        const cx = q18ToPixelX(obj.mx);
        const cy = q18ToPixelY(obj.my);

        const phase = Math.max(0, 60 - obj.ma) / 60;
        const radius = 10 + phase * 40;

        this.ctx.strokeStyle = this.fgColor;
        this.ctx.lineWidth = 1;

        for (let i = 0; i < 16; i++) {
            const angle = (i / 16) * Math.PI * 2;
            const r = radius * (0.5 + Math.random() * 0.5);

            this.ctx.beginPath();
            this.ctx.moveTo(cx, cy);
            this.ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
            this.ctx.stroke();
        }
    }

    /**
     * Debug: show coordinates
     */
    drawDebug(state) {
        this.ctx.fillStyle = '#ffff00';
        this.ctx.font = '10px monospace';

        let y = 20;
        for (const obj of state.objects) {
            if (obj.type === OBJ_SHIP) {
                const posStr = `Ship ${obj.mot}: (${obj.mx}, ${obj.my}) θ=${obj.mth}`;
                this.ctx.fillText(posStr, 10, y);
                y += 12;
            }
        }
    }
}

export default SpacewarRenderer;
