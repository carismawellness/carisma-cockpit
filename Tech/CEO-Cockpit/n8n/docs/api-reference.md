# n8n REST API Reference

Base URL: `http://localhost:5678/api/v1` (or your n8n instance URL)

## Authentication

All endpoints require API key authentication.
- Generate keys in n8n Settings → API
- Header: `X-N8N-API-KEY: your-api-key`

## Workflow Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/workflows` | List all workflows (with filtering/pagination) |
| `POST` | `/workflows` | Create new workflow |
| `GET` | `/workflows/:id` | Get specific workflow |
| `PUT` | `/workflows/:id` | Update workflow (auto-republishes if active) |
| `DELETE` | `/workflows/:id` | Delete workflow |
| `POST` | `/workflows/:id/activate` | Publish/activate |
| `POST` | `/workflows/:id/deactivate` | Stop workflow |

## Execution Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/executions` | List executions (with filters) |
| `GET` | `/executions/:id` | Get specific execution |
| `DELETE` | `/executions/:id` | Delete execution |

## Credential Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/credentials` | List credentials |
| `POST` | `/credentials` | Create credential |
| `GET` | `/credentials/:id` | Get credential |
| `PUT` | `/credentials/:id` | Update credential |
| `DELETE` | `/credentials/:id` | Delete credential |
| `GET` | `/credentials/schema/:type` | Get credential schema |

## User Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/users` | List users |
| `GET` | `/users/:id` | Get user |

## Tag Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/tags` | List tags |
| `POST` | `/tags` | Create tag |
| `PUT` | `/tags/:id` | Update tag |
| `DELETE` | `/tags/:id` | Delete tag |

## Variable Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/variables` | List variables |
| `POST` | `/variables` | Create variable |
| `PUT` | `/variables/:id` | Update variable |
| `DELETE` | `/variables/:id` | Delete variable |

## Example: Create Workflow via API

```bash
curl -X POST http://localhost:5678/api/v1/workflows \
  -H "X-N8N-API-KEY: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Workflow",
    "nodes": [
      {
        "id": "1",
        "name": "Start",
        "type": "n8n-nodes-base.manualTrigger",
        "typeVersion": 1,
        "position": [250, 300],
        "parameters": {}
      }
    ],
    "connections": {},
    "active": false,
    "settings": {}
  }'
```

## Example: Activate Workflow

```bash
curl -X POST http://localhost:5678/api/v1/workflows/abc123/activate \
  -H "X-N8N-API-KEY: your-api-key"
```

## Example: List Executions (with filters)

```bash
curl "http://localhost:5678/api/v1/executions?workflowId=abc123&status=error&limit=10" \
  -H "X-N8N-API-KEY: your-api-key"
```

## Full API Documentation

OpenAPI 3.0 spec: [docs.n8n.io/api/api-reference/](https://docs.n8n.io/api/api-reference/)
