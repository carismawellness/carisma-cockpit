# n8n Node Reference

Complete catalog of n8n's 67 core nodes and key integration nodes.

## Trigger Nodes (Workflow Starters)

| Node | Type | Purpose |
|------|------|---------|
| Manual Trigger | `n8n-nodes-base.manualTrigger` | Start by clicking "Execute" |
| Schedule Trigger | `n8n-nodes-base.scheduleTrigger` | Cron-based scheduling |
| Webhook | `n8n-nodes-base.webhook` | Receive HTTP POST/GET |
| Chat Trigger | `@n8n/n8n-nodes-langchain.chatTrigger` | Start from chat messages |
| Email Trigger (IMAP) | `n8n-nodes-base.emailReadImap` | Fire on incoming emails |
| Error Trigger | `n8n-nodes-base.errorTrigger` | Run when another workflow fails |
| n8n Form Trigger | `n8n-nodes-base.formTrigger` | Start on form submissions |
| RSS Feed Trigger | `n8n-nodes-base.rssFeedReadTrigger` | Fire on new RSS items |
| Local File Trigger | `n8n-nodes-base.localFileTrigger` | Watch local file changes |
| Workflow Trigger | `n8n-nodes-base.workflowTrigger` | Called by other workflows (sub-workflow entry) |
| MCP Server Trigger | Built-in | Activate from MCP protocol events |

## Flow Logic Nodes

| Node | Type | Purpose |
|------|------|---------|
| If | `n8n-nodes-base.if` | Two-branch conditional (true/false) |
| Switch | `n8n-nodes-base.switch` | Multi-branch routing |
| Filter | `n8n-nodes-base.filter` | Remove items based on conditions |
| Loop Over Items | `n8n-nodes-base.splitInBatches` | Process items in batches |
| Merge | `n8n-nodes-base.merge` | Combine data from multiple branches |
| Split Out | `n8n-nodes-base.splitOut` | Separate grouped data into individual items |
| Wait | `n8n-nodes-base.wait` | Pause execution (timer or webhook resume) |
| Stop And Error | `n8n-nodes-base.stopAndError` | Halt workflow with error |
| No Operation | `n8n-nodes-base.noOp` | Placeholder/pass-through |

## Data Manipulation Nodes

| Node | Type | Purpose |
|------|------|---------|
| Edit Fields (Set) | `n8n-nodes-base.set` | Add/modify/remove fields |
| Aggregate | `n8n-nodes-base.aggregate` | Combine items into groups |
| Sort | `n8n-nodes-base.sort` | Order data items |
| Limit | `n8n-nodes-base.limit` | Restrict number of items |
| Remove Duplicates | `n8n-nodes-base.removeDuplicates` | Deduplicate data |
| Rename Keys | `n8n-nodes-base.renameKeys` | Rename field names |
| Compare Datasets | `n8n-nodes-base.compareDatasets` | Diff two datasets |
| Summarize | `n8n-nodes-base.summarize` | Create summaries |

## Code & Execution Nodes

| Node | Type | Purpose |
|------|------|---------|
| Code | `n8n-nodes-base.code` | Custom JavaScript or Python |
| Execute Command | `n8n-nodes-base.executeCommand` | Run shell commands |
| Execute Sub-workflow | `n8n-nodes-base.executeWorkflow` | Call another workflow |

## Communication & API Nodes

| Node | Type | Purpose |
|------|------|---------|
| HTTP Request | `n8n-nodes-base.httpRequest` | Universal REST API caller |
| GraphQL | `n8n-nodes-base.graphql` | GraphQL requests |
| Send Email | `n8n-nodes-base.sendEmail` | Send via SMTP |
| Respond to Webhook | `n8n-nodes-base.respondToWebhook` | Return HTTP responses |
| SSH | `n8n-nodes-base.ssh` | Remote commands |
| FTP | `n8n-nodes-base.ftp` | File transfer |

## File & Data Format Nodes

| Node | Type | Purpose |
|------|------|---------|
| Read/Write Files from Disk | `n8n-nodes-base.readWriteFile` | Local file access |
| Convert to File | `n8n-nodes-base.convertToFile` | Transform data to file |
| Extract From File | `n8n-nodes-base.extractFromFile` | Parse CSV, JSON, XML |
| Compression | `n8n-nodes-base.compression` | Compress/decompress |
| HTML | `n8n-nodes-base.html` | Parse/manipulate HTML |
| XML | `n8n-nodes-base.xml` | Parse/generate XML |
| Markdown | `n8n-nodes-base.markdown` | Convert to/from Markdown |

## Security & Auth Nodes

| Node | Type | Purpose |
|------|------|---------|
| Crypto | `n8n-nodes-base.crypto` | Hashing, encryption |
| JWT | `n8n-nodes-base.jwt` | JSON Web Tokens |
| TOTP | `n8n-nodes-base.totp` | Time-based OTP |

## AI / LangChain Nodes

| Node | Purpose |
|------|---------|
| AI Agent | Autonomous agent with tool use (ReAct pattern) |
| AI Transform | AI-based data transformations |
| Guardrails | Safety constraints on AI outputs (v1.119+) |
| OpenAI | GPT-4o, GPT-4, GPT-3.5 |
| Anthropic | Claude 3.5 Sonnet, Claude 3 family |
| Ollama | Local/self-hosted models |
| Vector Store (Pinecone/Qdrant/Supabase) | RAG storage |
| Embeddings | Text embeddings for vector search |
| Text Splitter | Document chunking |
| Output Parser | Structured output validation |
| Memory (Redis/Postgres/Buffer) | Conversation context |
| MCP Client | Connect to MCP servers |

## Key Integration Nodes (Carisma Stack)

| Service | Node Type | Key Operations |
|---------|-----------|----------------|
| Zoho CRM | `n8n-nodes-base.zohocrm` | Create/get/update leads, contacts, deals |
| Facebook Lead Ads | `n8n-nodes-base.facebookLeadAdsTrigger` | Trigger on new ad leads |
| Google Sheets | `n8n-nodes-base.googleSheets` | Read/write/append rows |
| Google Calendar | `n8n-nodes-base.googleCalendar` | Create/update events |
| Google Drive | `n8n-nodes-base.googleDrive` | Upload/download files |
| Gmail | `n8n-nodes-base.gmail` | Send/receive emails |
| Trello | `n8n-nodes-base.trello` | Create/update/move cards |
| WhatsApp Business | `n8n-nodes-base.whatsapp` | Send messages, media |
| Slack | `n8n-nodes-base.slack` | Send messages, manage channels |
| Telegram | `n8n-nodes-base.telegram` | Send messages, bot commands |
| PostgreSQL | `n8n-nodes-base.postgres` | SQL queries |
| Supabase | `n8n-nodes-base.supabase` | CRUD operations |
