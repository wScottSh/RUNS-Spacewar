/**
 * Spacewar! Canvas Renderer
 * 
 * Renders game state using classic-1962 vector graphics style
 */

import { fromFixed, toFixed } from './fixed-math.js';

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.width = canvas.width;
        this.height = canvas.height;

        // Convert screen coordinates from fixed-point
        this.screenWidth = 1024;
        this.screenHeight = 768;
        this.scaleX = this.width / this.screenWidth;
        this.scaleY = this.height / this.screenHeight;
    }

    /**
     * Clear the screen with black background
     */
    clear() {
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.width, this.height);
    }

    /**
     * Convert fixed-point game coordinates to canvas coordinates
     */
    toScreen(pos) {
        return {
            x: fromFixed(pos.x) * this.scaleX,
            y: fromFixed(pos.y) * this.scaleY
        };
    }

    /**
     * Draw the game state
     */
    render(state) {
        this.clear();

        for (const record of state.records) {
            const entityType = record.fields['spacewar:entity_type'];

            switch (entityType) {
                case 'star':
                    this.drawStar(record);
                    break;
                case 'ship':
                    this.drawShip(record);
                    break;
                case 'torpedo':
                    this.drawTorpedo(record);
                    break;
            }
        }

        // Draw HUD
        this.drawHUD(state);
    }

    /**
     * Draw central star with radiating lines
     */
    drawStar(record) {
        const pos = this.toScreen(record.fields['runs:position_2d']);
        const rays = 8;
        const innerRadius = 8 * this.scaleX;
        const outerRadius = 16 * this.scaleX;

        this.ctx.strokeStyle = '#fff';
        this.ctx.lineWidth = 2;

        // Flicker effect
        const flicker = Math.random() > 0.1;
        if (!flicker) return;

        for (let i = 0; i < rays; i++) {
            const angle = (i / rays) * Math.PI * 2;
            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);

            this.ctx.beginPath();
            this.ctx.moveTo(pos.x + cosA * innerRadius, pos.y + sinA * innerRadius);
            this.ctx.lineTo(pos.x + cosA * outerRadius, pos.y + sinA * outerRadius);
            this.ctx.stroke();
        }

        // Center dot
        this.ctx.fillStyle = '#fff';
        this.ctx.beginPath();
        this.ctx.arc(pos.x, pos.y, 4 * this.scaleX, 0, Math.PI * 2);
        this.ctx.fill();
    }

    /**
     * Draw ship (wedge or needle based on player_id)
     */
    drawShip(record) {
        if (!record.fields['spacewar:is_alive']) return;

        const pos = this.toScreen(record.fields['runs:position_2d']);
        const angle = fromFixed(record.fields['runs:angle']);
        const playerId = record.fields['spacewar:player_id'];

        this.ctx.save();
        this.ctx.translate(pos.x, pos.y);
        this.ctx.rotate(angle);

        const scale = 12 * this.scaleX;

        if (playerId === 0) {
            // Wedge ship (Player 1) - cyan
            this.ctx.strokeStyle = '#0ff';
            this.drawWedge(scale);
        } else {
            // Needle ship (Player 2) - magenta
            this.ctx.strokeStyle = '#f0f';
            this.drawNeedle(scale);
        }

        this.ctx.restore();
    }

    /**
     * Draw wedge ship outline
     */
    drawWedge(scale) {
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(scale * 1.0, 0);          // Nose
        this.ctx.lineTo(scale * -0.5, scale * 0.8);  // Left wing
        this.ctx.lineTo(scale * -0.3, 0);            // Center back
        this.ctx.lineTo(scale * -0.5, scale * -0.8); // Right wing
        this.ctx.closePath();
        this.ctx.stroke();
    }

    /**
     * Draw needle ship outline
     */
    drawNeedle(scale) {
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(scale * 1.2, 0);          // Nose
        this.ctx.lineTo(scale * -0.6, scale * 0.3);  // Top rear
        this.ctx.lineTo(scale * -0.4, 0);            // Center
        this.ctx.lineTo(scale * -0.6, scale * -0.3); // Bottom rear
        this.ctx.closePath();
        this.ctx.stroke();
    }

    /**
     * Draw torpedo as simple dot
     */
    drawTorpedo(record) {
        const pos = this.toScreen(record.fields['runs:position_2d']);
        const radius = 3 * this.scaleX;

        this.ctx.fillStyle = '#fff';
        this.ctx.beginPath();
        this.ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        this.ctx.fill();
    }

    /**
     * Draw HUD (fuel, torpedoes, hyperspace charges)
     */
    drawHUD(state) {
        const ships = state.records.filter(r => r.fields['spacewar:entity_type'] === 'ship');

        this.ctx.font = '14px monospace';
        this.ctx.textAlign = 'left';

        for (const ship of ships) {
            const playerId = ship.fields['spacewar:player_id'];
            const x = playerId === 0 ? 10 : this.width - 150;
            const y = 20;

            const color = playerId === 0 ? '#0ff' : '#f0f';
            this.ctx.fillStyle = color;

            const fuel = ship.fields['spacewar:fuel'];
            const torpedoes = ship.fields['spacewar:torpedo_count'];
            const hyperspace = ship.fields['spacewar:hyperspace_charges'];
            const alive = ship.fields['spacewar:is_alive'];

            if (!alive) {
                this.ctx.fillText(`P${playerId + 1}: DESTROYED`, x, y);
            } else {
                this.ctx.fillText(`P${playerId + 1}`, x, y);
                this.ctx.fillText(`Fuel: ${fuel}`, x, y + 16);
                this.ctx.fillText(`Torpedoes: ${torpedoes}`, x, y + 32);
                this.ctx.fillText(`Hyperspace: ${hyperspace}`, x, y + 48);
            }
        }

        // Tick counter
        this.ctx.fillStyle = '#666';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(`Tick: ${state.tickCount}`, this.width / 2, this.height - 10);
    }
}

export default Renderer;
