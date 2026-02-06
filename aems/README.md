# AEMS Entities and Manifestations for Spacewar!

This directory contains the AEMS (Asset-Entity-Manifestation-State) layer for Spacewar!, defining game objects as universal, durable Nostr events.

## Structure

```
aems/
├── entities/           # Kind 30050 - Immutable archetypes
│   ├── wedge-ship.json
│   ├── needle-ship.json
│   ├── torpedo.json
│   └── star.json
├── manifestations/     # Kind 30051 - Visual/audio interpretations
│   ├── classic-1962/
│   │   ├── wedge-ship.json
│   │   ├── needle-ship.json
│   │   ├── torpedo.json
│   │   └── star.json
│   └── ascii/
│       ├── wedge-ship.json
│       ├── needle-ship.json
│       ├── torpedo.json
│       └── star.json
└── README.md
```

## Entity Naming Convention

Following AEMS conventions, we use the `std:` prefix for community-ratified universal entities:

- `std:spacewar-wedge-ship`
- `std:spacewar-needle-ship`
- `std:spacewar-torpedo`
- `std:spacewar-star`

## Manifestation Styles

### classic-1962
Original PDP-1 vector graphics style with coordinate-based outlines.

### ascii
Text-based fallback using Unicode symbols (▲, ●, etc.).

## Publishing to Nostr

These JSON files are templates. To publish as signed Nostr events:

1. Set your Nostr private key in `.env`
2. Run the signing script: `node scripts/sign-aems-events.js`
3. Events will be published to configured relays

## References

- **AEMS Standard**: https://github.com/decentralized-game-standard/aems-standard
- **AEMS Conventions**: https://github.com/decentralized-game-standard/aems-conventions
- **French-52 Deck Reference**: https://github.com/wScottSh/aems-french-52-deck
