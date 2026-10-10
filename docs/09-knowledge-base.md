# Knowledge Base — User Profile & Semantic Memory

> The memory. Currently a hardcoded JSON seed profile loaded at startup. Migrating to Elasticsearch + JINA embeddings in Phase 5 for semantic browsing memory and knowledge retrieval.

---

## Responsibilities

1. Store and retrieve user profiles (preferences, accessibility settings)
2. Provide user context to supervisor and agents (budget, preferred stores, etc.)
3. (Phase 5) Index every page visited for semantic browsing memory
4. (Phase 5) Semantic search via JINA embeddings ("find that article I read earlier")
5. (Phase 5) Store and query drug interactions, medical data
6. (Phase 5) SQLite as offline fallback only

---

## Current State (Phase 4): Hardcoded JSON

The user profile is loaded from `server/data/seed-user-profile.json` at server startup and injected into every supervisor call:

```typescript
// server/src/index.ts
import seedProfile from "../data/seed-user-profile.json";

// On each user:message, pass to supervisor:
const result = await runSupervisor({
  userInput: text,
  conversationHistory: session.history,
  userProfile: seedProfile,
  pageSnapshot: session.currentPage,
});
```

### Seed Profile

```json
{
  "name": "Alex",
  "preferences": {
    "budget": "500",
    "currency": "USD",
    "preferredStores": "Amazon, Best Buy",
    "language": "en"
  },
  "accessibility": {
    "screenReader": true,
    "voiceOnly": true
  }
}
```

### TypeScript Interface

```typescript
interface UserProfile {
  name: string;
  preferences: Record<string, string>;
  accessibility: { screenReader: boolean; voiceOnly: boolean };
}
```

---

## Planned State (Phase 5): Elasticsearch + JINA

### Architecture

```
┌───────────────┐     ┌──────────────────────────────┐
│  Stagehand    │     │  Elastic Cloud                │
│  (Browser)    │────▶│                               │
│               │     │  ┌─────────────────────────┐  │
│  Every page   │     │  │ browsing-history index   │  │
│  extraction   │     │  │  semantic_text field     │  │
│  auto-indexed │     │  │  (JINA auto-embeds)      │  │
│               │     │  └─────────────────────────┘  │
└───────────────┘     │                               │
                      │  ┌─────────────────────────┐  │
┌───────────────┐     │  │ products-viewed index    │  │
│  Agents       │────▶│  │  price, rating, category │  │
│  (query)      │     │  └─────────────────────────┘  │
│               │     │                               │
│  "find that   │     │  ┌─────────────────────────┐  │
│   article"    │     │  │ user-profile index       │  │
│               │     │  │  preferences, medical    │  │
└───────────────┘     │  └─────────────────────────┘  │
                      │                               │
                      │  ┌─────────────────────────┐  │
                      │  │ JINA inference endpoint  │  │
                      │  │  10M free tokens         │  │
                      │  │  (~13k page chunks)      │  │
                      │  └─────────────────────────┘  │
                      └──────────────────────────────┘
```

### KnowledgeBase Interface (Phase 5)

```typescript
interface KnowledgeBase {
  getProfile: (sessionId: string) => Promise<UserProfile>;
  updatePreference: (sessionId: string, key: string, value: unknown) => Promise<void>;
  indexPageVisit: (data: {
    url: string;
    title: string;
    content: string;
    sessionId: string;
    userQuery?: string;
  }) => Promise<void>;
  searchBrowsingHistory: (query: string, limit?: number) => Promise<PageVisit[]>;
}
```

### Elasticsearch Indices

**browsing-history** — Semantic search over visited pages:
```json
{
  "mappings": {
    "properties": {
      "url": { "type": "keyword" },
      "title": { "type": "text" },
      "content": { "type": "text" },
      "semantic_text": {
        "type": "semantic_text",
        "inference_id": "jina-embeddings"
      },
      "sessionId": { "type": "keyword" },
      "userQuery": { "type": "text" },
      "visitedAt": { "type": "date" }
    }
  }
}
```

The `semantic_text` field type auto-embeds content via the JINA inference endpoint — no manual embedding calls needed.

**products-viewed** — Structured product data:
```json
{
  "mappings": {
    "properties": {
      "name": { "type": "text" },
      "price": { "type": "float" },
      "currency": { "type": "keyword" },
      "rating": { "type": "float" },
      "store": { "type": "keyword" },
      "category": { "type": "keyword" },
      "url": { "type": "keyword" },
      "viewedAt": { "type": "date" }
    }
  }
}
```

**user-profile** — User preferences and medical data:
```json
{
  "mappings": {
    "properties": {
      "name": { "type": "text" },
      "preferences": { "type": "object" },
      "accessibility": { "type": "object" },
      "conditions": { "type": "nested" },
      "medications": { "type": "nested" },
      "allergies": { "type": "nested" }
    }
  }
}
```

### JINA Inference Endpoint Setup

```json
PUT _inference/text_embedding/jina-embeddings
{
  "service": "jinaai",
  "service_settings": {
    "model_id": "jina-embeddings-v3",
    "api_key": "..."
  }
}
```

JINA free tier: 10M tokens (~13k page chunks). The `semantic_text` field type uses this endpoint automatically when documents are indexed.

### Auto-Indexing Flow

Every page visited via Stagehand gets automatically indexed:

```
Stagehand extract() → page content
  → kb.indexPageVisit({ url, title, content, sessionId })
  → Elasticsearch indexes document
  → JINA auto-embeds via semantic_text field
  → Available for semantic search immediately
```

### Semantic Search Example

```typescript
// "find that cold medicine I was looking at earlier"
const results = await kb.searchBrowsingHistory("cold medicine");

// Uses JINA embeddings for semantic matching, not keyword matching
// Returns pages where the user browsed cold medicine products
// even if the exact phrase "cold medicine" doesn't appear
```

---

## SQLite Fallback (Offline Only)

SQLite serves as a local cache when Elastic Cloud is unreachable:

```typescript
import Database from "better-sqlite3";

// Minimal local store for:
// - User profile cache
// - Recent browsing history (last 100 pages)
// - Drug interaction lookup (hardcoded dataset)
//
// NOT the primary data store — Elasticsearch is authoritative
```

---

## Elastic Prize Track Requirements

The Elastic prize ($2k/$1k) requires demonstrating:

1. **Elastic Cloud deployment** with JINA inference endpoint
2. **Multiple indices**: browsing-history, products-viewed, user-profile
3. **semantic_text auto-embedding**: JINA embeds content at index time
4. **Elastic Agent Builder**: Kibana-based agent with browsing history search + medical lookup tools
5. **Elastic Workflows**: Auto-trigger drug safety check when health product pages are indexed

### Demo: "Find that article I read earlier"

```
User: "Find that cold medicine I was looking at earlier"
  → General Agent calls kb.searchBrowsingHistory("cold medicine")
  → Elasticsearch semantic search via JINA embeddings
  → Returns: "You visited CVS.com and looked at Coricidin HBP ($9.99)
     and DayQuil ($12.49) about 20 minutes ago. Want me to go back?"
```

---

## File Structure

```
/server
  /data
    seed-user-profile.json      # Demo user profile (current — hardcoded)
  /src/lib
    elasticsearch.ts            # Phase 5: Elastic Cloud + JINA client (not yet created)
```

---

## Interaction with Other Layers

| Layer | Interaction | Details |
|-------|-------------|---------|
| **Server Layer** | Profile loaded at startup | Seed JSON loaded, passed to supervisor |
| **LangGraph Supervisor** | User profile injected | Preferences inform classification context |
| **Commerce Agent** | Budget, preferred stores | Budget checking, store selection |
| **General Agent** | User preferences, medical data | Verbosity, condition-aware browsing |
| **Execution Layer** | Auto-index page visits | Every Stagehand extraction triggers indexing (Phase 5) |

---

## Migration Path

```
Phase 4 (current): seed-user-profile.json → loaded at startup → in-memory
Phase 5 (next):    Elasticsearch + JINA → cloud-hosted → semantic search
                   SQLite → local fallback only
Phase 6 (agents):  Agents query KB directly for browsing history, product recall
```

---

## Dependencies

**Current (Phase 4):** None — JSON file loaded with `fs.readFileSync`.

**Phase 5:**
```json
{
  "@elastic/elasticsearch": "^8.x"
}
```

JINA is accessed through Elastic's inference endpoint (no separate JINA SDK needed).
