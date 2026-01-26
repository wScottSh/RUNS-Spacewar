# spacewar:player_id

**Type**: Scalar  
**Namespace**: `spacewar:` (Game-specific)

## Description

Player identifier for two-player game. Used for input routing and collision filtering.

## Schema

```yaml
spacewar:player_id:
  type: u8
  values: [0, 1]
```

## Usage

```yaml
# Player 1
player_id: 0

# Player 2
player_id: 1
```

## Notes

- Player 0 controls wedge ship
- Player 1 controls needle ship
- Used to prevent self-torpedo hits: `filter: torpedo.owner != ship.player_id`
