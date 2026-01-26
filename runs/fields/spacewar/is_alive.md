# spacewar:is_alive

**Type**: Boolean  
**Namespace**: `spacewar:` (Game-specific)

## Description

Indicates whether ship is active or destroyed. Used for collision response and respawn logic.

## Schema

```yaml
spacewar:is_alive:
  type: bool
  initial_value: true
```

## Usage

```yaml
# Active ship
is_alive: true

# Destroyed ship
is_alive: false
```

## Notes

- Set to false on collision with star, torpedo, or other ship
- Processors skip dead ships: `query: entity_type == ship and is_alive`
- Respawn behavior depends on game mode (instant vs. game over)
