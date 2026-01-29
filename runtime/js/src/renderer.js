/**
 * Spacewar! Canvas Renderer
 * 
 * Renders game state using LOADED AEMS manifestations
 * Visual data (ship outlines, star field, sun animation) comes from AEMS layer
 * 
 * COORDINATE SYSTEM: Receives normalized (0.0 to 1.0) coordinates
 * Converts to pixel coordinates at render time for resolution independence
 */

export class Renderer {
    constructor(canvas, manifestations) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.manifestations = manifestations;
        this.updateDimensions();

        // Listen for resize events
        this.resizeObserver = new ResizeObserver(() => this.updateDimensions());
        this.resizeObserver.observe(canvas);
    }

    /**
     * Update dimensions (called on resize)
     */
    updateDimensions() {
        // Use the canvas's native width/height attributes (set in HTML)
        // Do NOT use getBoundingClientRect which returns DPI-scaled CSS pixels
        this.width = this.canvas.width;
        this.height = this.canvas.height;
        this.baseScale = Math.min(this.width, this.height);
    }

    /**
     * Clear the screen with black background
     */
    clear() {
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.width, this.height);
    }

    /**
     * Convert normalized game coordinates (0-1) to canvas pixel coordinates
     */
    toScreen(pos) {
        return {
            x: pos.x * this.width,
            y: pos.y * this.height
        };
    }

    /**
     * Scale a normalized distance to pixels
     */
    scaleToPixels(normalizedSize) {
        return normalizedSize * this.baseScale;
    }

    /**
     * Draw the game state
     */
    render(state) {
        this.clear();

        // Draw background star field first (behind everything)
        this.drawStarField(state.tickCount);

        for (const record of state.records) {
            const entityType = record.fields['spacewar:entity_type'];

            switch (entityType) {
                case 'star':
                    this.drawStar(record, state.tickCount);
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
     * Draw background star field from AEMS manifestation
     */
    drawStarField(tickCount) {
        const starField = this.manifestations.starField;
        if (!starField || !starField.stars) return;

        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';

        for (const star of starField.stars) {
            const pos = this.toScreen({ x: star.x, y: star.y });
            const brightness = star.brightness || 0.5;

            // Slight twinkle effect
            const twinkle = Math.sin(tickCount * 0.02 + star.x * 100) * 0.2 + 0.8;
            const alpha = brightness * twinkle * 0.6;

            this.ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
            this.ctx.beginPath();
            this.ctx.arc(pos.x, pos.y, 1.5, 0, Math.PI * 2);
            this.ctx.fill();
        }
    }

    /**
     * Draw central star with animated radiating lines from AEMS
     */
    drawStar(record, tickCount) {
        const pos = this.toScreen(record.fields['runs:position_2d']);
        const manifest = this.manifestations.star;

        const rays = manifest.rays || 16;
        const innerRadius = this.scaleToPixels(manifest.inner_radius || 0.008);
        const outerBase = this.scaleToPixels(manifest.outer_radius_base || 0.025);
        const outerVariance = this.scaleToPixels(manifest.outer_radius_variance || 0.015);

        const anim = manifest.animation || {};
        const freq = anim.frequency || 0.3;
        const rayOffset = anim.per_ray_offset || 1.7;

        this.ctx.strokeStyle = '#fff';
        this.ctx.lineWidth = 2;

        // Draw animated rays
        for (let i = 0; i < rays; i++) {
            const angle = (i / rays) * Math.PI * 2;
            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);

            // Animated outer radius
            const variance = Math.sin(tickCount * freq + i * rayOffset) * 0.5 + 0.5;
            const outerRadius = outerBase + outerVariance * variance;

            this.ctx.beginPath();
            this.ctx.moveTo(pos.x + cosA * innerRadius, pos.y + sinA * innerRadius);
            this.ctx.lineTo(pos.x + cosA * outerRadius, pos.y + sinA * outerRadius);
            this.ctx.stroke();
        }

        // Center dot
        const centerRadius = this.scaleToPixels(manifest.center_dot_radius || 0.006);
        this.ctx.fillStyle = '#fff';
        this.ctx.beginPath();
        this.ctx.arc(pos.x, pos.y, centerRadius, 0, Math.PI * 2);
        this.ctx.fill();

        // Optional glow
        if (manifest.glow) {
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
            this.ctx.beginPath();
            this.ctx.arc(pos.x, pos.y, outerBase * 1.5, 0, Math.PI * 2);
            this.ctx.fill();
        }
    }

    /**
     * Draw ship from AEMS manifestation outline
     */
    drawShip(record) {
        if (!record.fields['spacewar:is_alive']) return;

        const pos = this.toScreen(record.fields['runs:position_2d']);
        const angle = record.fields['runs:angle'];
        const playerId = record.fields['spacewar:player_id'];

        // Get correct manifestation based on player
        const manifest = playerId === 0
            ? this.manifestations.wedgeShip
            : this.manifestations.needleShip;

        this.ctx.save();
        this.ctx.translate(pos.x, pos.y);
        this.ctx.rotate(angle);

        const scale = this.scaleToPixels(0.025);

        // Use player tint color
        this.ctx.strokeStyle = manifest.player_tint || (playerId === 0 ? '#0ff' : '#f0f');
        this.ctx.lineWidth = manifest.line_width || 2;

        // Draw outline from AEMS data
        this.drawOutlineFromManifest(manifest.outline, scale, manifest.mirrored);

        this.ctx.restore();
    }

    /**
     * Draw an outline from AEMS manifest data
     */
    drawOutlineFromManifest(outline, scale, mirrored = false) {
        if (!outline || outline.length < 2) return;

        // Draw top half
        this.ctx.beginPath();
        this.ctx.moveTo(outline[0].x * scale, outline[0].y * scale);

        for (let i = 1; i < outline.length; i++) {
            this.ctx.lineTo(outline[i].x * scale, outline[i].y * scale);
        }

        if (mirrored) {
            // Mirror back along Y axis
            for (let i = outline.length - 1; i >= 0; i--) {
                this.ctx.lineTo(outline[i].x * scale, -outline[i].y * scale);
            }
        }

        this.ctx.closePath();
        this.ctx.stroke();
    }

    /**
     * Draw torpedo as simple dot
     */
    drawTorpedo(record) {
        const pos = this.toScreen(record.fields['runs:position_2d']);
        const radius = this.scaleToPixels(0.005);

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

    /**
     * Cleanup
     */
    destroy() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
    }
}

export default Renderer;
