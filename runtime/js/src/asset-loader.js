/**
 * AEMS Asset Loader
 * 
 * Loads manifestation data from AEMS JSON files.
 * This keeps the runtime platform-agnostic by reading visual/audio
 * data from the AEMS layer rather than hardcoding it.
 * 
 * The manifestations define HOW entities look/sound, separate from
 * the RUNS logic that defines how they BEHAVE.
 */

/**
 * Load all manifestations for a given style
 * @param {string} style - Manifestation style folder (e.g., 'classic-1962', 'ascii')
 * @returns {Promise<Object>} Loaded manifestation data
 */
export async function loadManifestations(style = 'classic-1962') {
    // Path from project root (where server should run)
    const basePath = `/aems/manifestations/${style}`;

    try {
        const [wedgeShip, needleShip, star, starField] = await Promise.all([
            fetchManifest(`${basePath}/wedge-ship.json`),
            fetchManifest(`${basePath}/needle-ship.json`),
            fetchManifest(`${basePath}/star.json`),
            fetchManifest(`${basePath}/star-field.json`),
        ]);

        console.log(`[AEMS] Loaded ${style} manifestations`);

        return {
            wedgeShip: wedgeShip.content,
            needleShip: needleShip.content,
            star: star.content,
            starField: starField.content,
            style: style,
        };
    } catch (error) {
        console.error(`[AEMS] Failed to load manifestations:`, error);
        throw error;
    }
}

/**
 * Fetch a single manifest file
 */
async function fetchManifest(path) {
    const response = await fetch(path);
    if (!response.ok) {
        throw new Error(`Failed to load manifest: ${path}`);
    }
    return response.json();
}

/**
 * Create a fallback manifestation set if loading fails
 * This allows the game to run even without AEMS files
 */
export function createFallbackManifestations() {
    console.warn('[AEMS] Using fallback manifestations');

    return {
        wedgeShip: {
            outline: [
                { x: 1.0, y: 0 },
                { x: -0.5, y: 0.5 },
                { x: -0.3, y: 0 },
                { x: -0.5, y: -0.5 },
            ],
            mirrored: false,
            player_tint: '#00ffff',
        },
        needleShip: {
            outline: [
                { x: 1.2, y: 0 },
                { x: -0.6, y: 0.25 },
                { x: -0.4, y: 0 },
                { x: -0.6, y: -0.25 },
            ],
            mirrored: false,
            player_tint: '#ff00ff',
        },
        star: {
            rays: 8,
            inner_radius: 0.01,
            outer_radius_base: 0.025,
            outer_radius_variance: 0.01,
            animation: { frequency: 0.3, per_ray_offset: 1.7 },
        },
        starField: {
            stars: [],
        },
        style: 'fallback',
    };
}

export default { loadManifestations, createFallbackManifestations };
