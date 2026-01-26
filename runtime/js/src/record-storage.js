/**
 * Record Storage - Manages game entity Records
 * 
 * Records are the core data structures in RUNS, containing:
 * - Unique ID
 * - Fields (namespaced data values)
 */

export class RecordStorage {
    constructor() {
        this.records = new Map();
        this.nextId = 1;
    }

    /**
     * Create a new Record with the given fields
     * @param {Object} fields - Initial field values
     * @returns {number} The new Record's ID
     */
    create(fields = {}) {
        const id = this.nextId++;
        this.records.set(id, {
            id,
            fields: { ...fields }
        });
        return id;
    }

    /**
     * Get a Record by ID
     * @param {number} id 
     * @returns {Object|null} The Record or null if not found
     */
    get(id) {
        return this.records.get(id) || null;
    }

    /**
     * Update a Record's fields
     * @param {number} id 
     * @param {Object} fieldUpdates 
     */
    update(id, fieldUpdates) {
        const record = this.records.get(id);
        if (record) {
            Object.assign(record.fields, fieldUpdates);
        }
    }

    /**
     * Delete a Record
     * @param {number} id 
     */
    delete(id) {
        this.records.delete(id);
    }

    /**
     * Query Records by predicate
     * @param {Function} predicate - (record) => boolean
     * @returns {Array} Matching Records
     */
    query(predicate) {
        const results = [];
        for (const record of this.records.values()) {
            if (predicate(record)) {
                results.push(record);
            }
        }
        return results;
    }

    /**
     * Query Records by field values
     * @param {Object} criteria - Field name/value pairs to match
     * @returns {Array} Matching Records
     */
    queryByFields(criteria) {
        return this.query(record => {
            for (const [field, value] of Object.entries(criteria)) {
                if (record.fields[field] !== value) {
                    return false;
                }
            }
            return true;
        });
    }

    /**
     * Get all Records
     * @returns {Array} All Records
     */
    all() {
        return Array.from(this.records.values());
    }

    /**
     * Get count of Records
     * @returns {number}
     */
    count() {
        return this.records.size;
    }

    /**
     * Load initial state from YAML-like object
     * @param {Object} state - Initial state with records array
     */
    loadInitialState(state) {
        if (state.records) {
            for (const record of state.records) {
                this.records.set(record.id, {
                    id: record.id,
                    fields: { ...record.fields }
                });
                if (record.id >= this.nextId) {
                    this.nextId = record.id + 1;
                }
            }
        }
    }

    /**
     * Serialize storage to JSON
     * @returns {Object}
     */
    serialize() {
        return {
            records: this.all(),
            nextId: this.nextId
        };
    }
}

export default RecordStorage;
