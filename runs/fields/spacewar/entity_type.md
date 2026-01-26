# spacewar:entity_type

**Type**: Enum  
**Namespace**: `spacewar:` (Game-specific)

## Description

Identifies the type of game object for query filtering and behavior dispatch.

## Schema

```yaml
spacewar:entity_type:
  type: enum
  values:
    - ship
    - torpedo
    - star
    - debris
```

## Usage

```yaml
# Ship entity
entity_type: ship

# Torpedo entity
entity_type: torpedo

# Central star
entity_type: star
```

## Notes

- Used in Network queries: `query: entity_type == ship`
- Enables type-specific Processor application
- `debris` reserved for future explosion effects
