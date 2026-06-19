# n8n Workflow JSON Format

n8n stores workflows as JSON. There is no official JSON schema — the structure is dynamic and nodes build parameters on load.

## Top-Level Structure

```json
{
  "name": "Workflow Name",
  "nodes": [],
  "connections": {},
  "active": false,
  "settings": {
    "executionOrder": "v1"
  },
  "versionId": "uuid-string",
  "id": "workflow-id",
  "tags": [],
  "pinData": {},
  "meta": {
    "templateCredsSetupCompleted": true,
    "instanceId": "instance-uuid"
  }
}
```

## Node Object

```json
{
  "id": "unique-node-uuid",
  "name": "Human-Readable Display Name",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4,
  "position": [250, 300],
  "parameters": {
    "url": "https://api.example.com/endpoint",
    "method": "POST",
    "sendBody": true,
    "bodyParameters": {
      "parameters": [
        {
          "name": "email",
          "value": "={{ $json.email }}"
        }
      ]
    }
  },
  "credentials": {
    "httpBasicAuth": {
      "id": "credential-id",
      "name": "My API Credential"
    }
  },
  "disabled": false,
  "webhookId": "optional-for-webhook-nodes"
}
```

### Key Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique node identifier (UUID) |
| `name` | string | Display name (must be unique within workflow) |
| `type` | string | Node type identifier (e.g., `n8n-nodes-base.httpRequest`) |
| `typeVersion` | number | Version of the node type |
| `position` | [x, y] | Canvas position in pixels |
| `parameters` | object | Node-specific configuration |
| `credentials` | object | Credential references (by ID, not value) |
| `disabled` | boolean | Whether node is skipped during execution |

## Connections Object

Connections map output ports of source nodes to input ports of target nodes.

```json
{
  "Source Node Name": {
    "main": [
      [
        {
          "node": "Target Node Name",
          "type": "main",
          "index": 0
        }
      ]
    ]
  }
}
```

### Connection Structure
- **Key:** Source node's display name
- **`main`:** Array of output ports (index 0 = first output, index 1 = second output for If/Switch nodes)
- Each port contains array of connections to target nodes
- **`index`:** Which input port on the target node (usually 0)

### Multi-Output Example (If Node)

```json
{
  "If Node": {
    "main": [
      [{ "node": "True Branch Node", "type": "main", "index": 0 }],
      [{ "node": "False Branch Node", "type": "main", "index": 0 }]
    ]
  }
}
```

## Data Item Format

All data passed between nodes is an array of items:

```json
[
  {
    "json": {
      "name": "John Doe",
      "email": "john@example.com",
      "score": 85
    },
    "binary": {
      "data": {
        "mimeType": "image/png",
        "data": "base64-encoded-content",
        "fileName": "photo.png"
      }
    }
  },
  {
    "json": {
      "name": "Jane Smith",
      "email": "jane@example.com",
      "score": 92
    }
  }
]
```

- Every item has a `json` key (required) and optional `binary` key
- Since v0.166.0, Code node auto-adds the `json` wrapper if missing
- Binary data is base64-encoded

## Expression Syntax in Parameters

Expressions use double curly braces: `{{ expression }}`

```json
{
  "parameters": {
    "url": "https://api.example.com/users/{{ $json.userId }}",
    "bodyParameters": {
      "parameters": [
        {
          "name": "full_name",
          "value": "={{ $json.firstName }} {{ $json.lastName }}"
        }
      ]
    }
  }
}
```

### Prefix Rules
- `={{ expr }}` — Evaluated as expression (returns the result)
- `{{ expr }}` — Evaluated within a string (interpolation)
- No prefix — Treated as literal string

## Import/Export

### Export
- UI: Workflow menu → Download
- API: `GET /api/v1/workflows/:id`
- CLI: `n8n export:workflow --id=<id> --output=workflow.json`

### Import
- UI: Workflow menu → Import from File
- API: `POST /api/v1/workflows` with workflow JSON body
- CLI: `n8n import:workflow --input=workflow.json`

### Important Notes
- Exported JSON includes credential **references** (IDs), not actual secrets
- When importing, credentials must be re-mapped to existing credentials on the target instance
- Pin data (`pinData`) is included in exports — remove if sharing publicly
- `meta.instanceId` is instance-specific — ignored on import
