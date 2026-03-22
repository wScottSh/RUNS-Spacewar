#!/usr/bin/env node
// Parse Peter Samson's star catalog from spacewar3.1_complete.txt
// Stars are in DECIMAL (line 1377: `decimal` directive).
// Each star is defined by the `mark X, Y` macro.
// Convention: x = 8192 - X_argument. y = Y_argument.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'source', 'spacewar3.1_complete.txt'),
    'utf-8'
);

const lines = source.split(/\r?\n/);
const stars = [];
let currentTier = 0;

// Tier boundaries: detect from labels in the source
// 1j (L1385) through 1q (L1393) = tier 1
// 2j (L1395) through 2q (L1403) = tier 2
// 3j (L1405) through 3q (L1486) = tier 3
// 4j (L1490) through 4q (L1866) = tier 4

for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const rawLine = lines[i];
    const line = rawLine.replace(/\t/g, ' ').trim();

    // Detect tier transitions by labels
    if (/^1j[,\s]/.test(line)) currentTier = 1;
    else if (/^2j[,\s]/.test(line)) currentTier = 2;
    else if (/^3j[,\s]/.test(line)) currentTier = 3;
    else if (/^4j[,\s]/.test(line)) currentTier = 4;

    // Parse mark macro invocations — handle 'mark X, Y' with flexible whitespace
    // Also handle label prefixes like '1q, mark ...' or '4q, mark ...'
    const markMatch = line.match(/mark\s+(-?\d+)\s*,\s*(-?\d+)/i);
    if (markMatch && currentTier > 0) {
        const xArg = parseInt(markMatch[1], 10);
        const yArg = parseInt(markMatch[2], 10);

        // Extract designation from /comment on the same line
        let designation = '';
        const commentMatch = rawLine.match(/\/(.+)/);
        if (commentMatch) {
            designation = commentMatch[1].trim();
        }

        stars.push({
            x: 8192 - xArg,
            y: yArg,
            brightness: currentTier,
            designation: designation,
            source_line: lineNum
        });
    }
}

// Count by tier
const tierCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
for (const s of stars) {
    tierCounts[s.brightness]++;
}

console.log(`Total stars parsed: ${stars.length}`);
console.log('Tier counts:', tierCounts);
console.log('Expected: 478 total (9+10+82+377)');

if (stars.length !== 478) {
    console.log('WARNING: count mismatch! Checking for missing lines...');
    // Scan for any mark lines we might have missed
    for (let i = 0; i < lines.length; i++) {
        const lineNum = i + 1;
        if (lineNum >= 1385 && lineNum <= 1866) {
            const line = lines[i].replace(/\t/g, ' ').trim();
            if (line.match(/mark/i) && !stars.find(s => s.source_line === lineNum)) {
                console.log(`  MISSED at L${lineNum}: ${line}`);
            }
        }
    }
}

// Output
const output = {
    _comment: "Peter Samson's Expensive Planetarium — star catalog for Spacewar! 3.1",
    _source: "spacewar3.1_complete.txt L1385-1866 (decimal number base)",
    _attribution: "stars by prs for s/w 2b — Peter R. Samson, 3/13/62",
    _coordinate_convention: "x = 8192 - X_argument. y = Y_argument (raw, before x256 display scaling).",
    total: stars.length,
    tier_counts: tierCounts,
    stars: stars.map(s => ({
        x: s.x,
        y: s.y,
        brightness: s.brightness,
        designation: s.designation
    }))
};

const outPath = path.join(__dirname, 'star_catalog.json');
fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
console.log(`Written to: ${outPath}`);
