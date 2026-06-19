# n8n AI & LLM Integration Guide

## Overview

n8n has deep AI integration through the LangChain JavaScript framework. 75% of n8n customers use AI features. The platform has 70+ dedicated AI nodes.

## Supported LLM Providers

| Provider | Node | Models |
|----------|------|--------|
| OpenAI | `@n8n/n8n-nodes-langchain.lmChatOpenAi` | GPT-4o, GPT-4, GPT-3.5-turbo |
| Anthropic | `@n8n/n8n-nodes-langchain.lmChatAnthropic` | Claude 3.5 Sonnet, Claude 3 Opus/Sonnet/Haiku |
| Google | `@n8n/n8n-nodes-langchain.lmChatGoogleGemini` | Gemini models |
| Ollama | `@n8n/n8n-nodes-langchain.lmChatOllama` | Any local model |
| HuggingFace | `@n8n/n8n-nodes-langchain.lmChatHuggingFaceInference` | Inference API models |

## AI Node Categories

### Agent Nodes
Autonomous AI agents with tool use (ReAct pattern):
- Define available tools (HTTP Request, Code, database queries)
- Agent decides which tools to call and in what order
- Supports multi-step reasoning

### Chain Nodes
Sequential LLM processing pipelines:
- LLM Chain: Simple prompt → response
- Summarization Chain: Long text → summary
- QA Chain: Question + context → answer

### Memory Nodes
Conversation context persistence:
- **Buffer Memory** — In-memory (lost on restart)
- **Redis Memory** — Persistent across sessions
- **Postgres Memory** — Database-backed persistence
- **Motorhead Memory** — Long-term memory service

### Vector Store Nodes
For RAG (Retrieval Augmented Generation):
- Pinecone, Qdrant, Supabase, Chroma, Weaviate
- Store and retrieve document embeddings

### Embedding Nodes
Text embeddings for vector search:
- OpenAI Embeddings
- Cohere Embeddings
- HuggingFace Embeddings

### Text Splitter Nodes
Document chunking for RAG:
- Character splitter
- Token splitter
- Recursive character splitter

### Output Parser Nodes
Structured output validation:
- JSON schema validation
- Structured output with retries

## RAG Workflow Pattern

### Ingestion Pipeline
```
Document Source → Text Splitter → Embedding Model → Vector Store (Upsert)
```

### Query Pipeline
```
User Question → Embedding → Vector Store (Similarity Search) → LLM (with context) → Response
```

## AI Agent Guardrails (v1.119+)

### Available Guardrails
- Keyword filtering
- PII detection
- Secret key detection
- Jailbreak detection

### Safety Pattern
```
User Input → Input Guardrails → AI Agent → Output Guardrails → Validation → Action
```

**Critical rule:** Never pass raw AI output directly to consequential actions.

### Best Practices
1. **generate → validate → act** pattern always
2. Scope each agent to minimum necessary tools
3. Require structured JSON output with schema validation
4. Human-in-the-loop gates for irreversible or costly actions
5. Deploy kill switch and rate limits per agent workflow
6. Pin specific model versions explicitly
7. Version prompts separately from workflow logic

## Carisma AI Use Cases

### Lead Qualification Agent
- Receives new lead data from CRM webhook
- Uses Claude/GPT to score using BANT framework
- Returns structured JSON: `{ budget: 22, authority: 18, need: 25, timeline: 15, total: 80, tier: "hot" }`
- Routes to appropriate sales workflow

### WhatsApp Booking Agent
- Conversational AI for appointment scheduling
- Tools: Check availability, book appointment, get service list
- Memory: Redis for conversation persistence per phone number
- Handoff to human for complex requests

### Content Categorization
- Classifies incoming form submissions by brand/service
- Routes to correct CRM and email sequence
- Tags for reporting
