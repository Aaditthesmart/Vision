import { Client } from "@elastic/elasticsearch";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type {
  UserProfile,
  PageVisit,
  ProductViewed,
  ConversationEntry,
  KnowledgeBase,
} from "../types/index.js";

let client: Client | null = null;

// Load seed profile for fallback
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
let seedProfile: UserProfile | null = null;
try {
  const profilePath = join(__dirname, "../../data/seed-user-profile.json");
  seedProfile = JSON.parse(readFileSync(profilePath, "utf-8"));
} catch {
  // seed file missing — getProfile will return null
}

/**
 * Initialize the Elasticsearch client.
 * Requires ELASTIC_CLOUD_ID + ELASTIC_API_KEY env vars.
 * Returns true if connected, false if skipped/failed.
 */
export async function initElasticsearch(): Promise<boolean> {
  const cloudId = process.env.ELASTIC_CLOUD_ID;
  const apiKey = process.env.ELASTIC_API_KEY;

  if (!cloudId || !apiKey) {
    console.log(
      "[Elasticsearch] ELASTIC_CLOUD_ID or ELASTIC_API_KEY not set — knowledge base DISABLED",
    );
    return false;
  }

  try {
    client = new Client({ cloud: { id: cloudId }, auth: { apiKey } });
    const info = await client.info();
    console.log(
      `[Elasticsearch] Connected to cluster: ${info.cluster_name} (v${info.version.number})`,
    );
    return true;
  } catch (err) {
    console.warn(
      "[Elasticsearch] Connection failed — knowledge base DISABLED:",
      err instanceof Error ? err.message : err,
    );
    client = null;
    return false;
  }
}

/** Get the raw ES client (or null). */
export function getElasticClient(): Client | null {
  return client;
}

/**
 * Create a KnowledgeBase instance backed by Elasticsearch.
 * If ES is unavailable, all methods gracefully degrade (return defaults / no-op).
 */
export function createKnowledgeBase(): KnowledgeBase {
  return {
    isAvailable(): boolean {
      return client !== null;
    },

    async getProfile(sessionId: string): Promise<UserProfile | null> {
      if (!client) return seedProfile;

      try {
        const result = await client.search({
          index: "user-profile",
          query: { term: { sessionId } },
          size: 1,
        });

        const hit = result.hits.hits.length > 0;
        console.log(`[Elasticsearch] getProfile sessionId=${sessionId} ${hit ? "HIT" : "MISS (using seed)"}`);
        if (hit) {
          return result.hits.hits[0]._source as unknown as UserProfile;
        }
      } catch {
        // index doesn't exist or query failed
      }

      return seedProfile;
    },

    async updatePreference(
      sessionId: string,
      key: string,
      value: string,
    ): Promise<void> {
      if (!client) return;

      console.log(`[Elasticsearch] updatePreference sessionId=${sessionId} key=${key} value=${value}`);
      try {
        await client.updateByQuery({
          index: "user-profile",
          query: { term: { sessionId } },
          script: {
            source: `ctx._source.preferences.${key} = params.value`,
            params: { value },
          },
        });
      } catch {
        // best-effort
      }
    },

    async indexPageVisit(data: PageVisit): Promise<void> {
      if (!client) return;

      console.log(`[Elasticsearch] indexPageVisit url=${data.url} title="${data.title}"`);
      try {
        await client.index({
          index: "browsing-history",
          document: data,
          pipeline: "drug-safety-pipeline",
        });
      } catch {
        // fire-and-forget
      }
    },

    async indexProductViewed(data: ProductViewed): Promise<void> {
      if (!client) return;

      console.log(`[Elasticsearch] indexProductViewed name="${data.name}" store=${data.store ?? "unknown"}`);
      try {
        await client.index({
          index: "products-viewed",
          document: data,
        });
      } catch {
        // fire-and-forget
      }
    },

    async searchBrowsingHistory(
      query: string,
      sessionId?: string,
      limit = 5,
    ): Promise<PageVisit[]> {
      if (!client) return [];

      console.log(`[Elasticsearch] searchBrowsingHistory query="${query}" sessionId=${sessionId} limit=${limit}`);
      try {
        const filter = sessionId ? [{ term: { sessionId } }] : [];
        const result = await client.search({
          index: "browsing-history",
          size: limit,
          sub_searches: [
            { query: { bool: { must: [{ semantic: { field: "content", query } }], filter } } },
            { query: { bool: { must: [{ multi_match: { query, fields: ["content", "title", "userQuery"], fuzziness: "AUTO" } }], filter } } },
          ],
          rank: { rrf: { window_size: 50, rank_constant: 20 } },
        } as any);

        const hits = result.hits.hits.map(
          (hit) => hit._source as unknown as PageVisit,
        );
        console.log(`[Elasticsearch] searchBrowsingHistory results=${hits.length}`);
        return hits;
      } catch {
        // Fallback: semantic-only (ES version may not support RRF)
        try {
          const must: Record<string, unknown>[] = [
            { semantic: { field: "content", query } },
          ];
          if (sessionId) must.push({ term: { sessionId } });

          const result = await client.search({
            index: "browsing-history",
            query: { bool: { must } },
            size: limit,
          });
          const hits = result.hits.hits.map(
            (hit) => hit._source as unknown as PageVisit,
          );
          console.log(`[Elasticsearch] searchBrowsingHistory (fallback) results=${hits.length}`);
          return hits;
        } catch {
          return [];
        }
      }
    },

    async searchProductsViewed(
      query: string,
      sessionId?: string,
      limit = 5,
    ): Promise<ProductViewed[]> {
      if (!client) return [];

      console.log(`[Elasticsearch] searchProductsViewed query="${query}" sessionId=${sessionId} limit=${limit}`);
      try {
        const filter = sessionId ? [{ term: { sessionId } }] : [];
        const result = await client.search({
          index: "products-viewed",
          size: limit,
          sub_searches: [
            { query: { bool: { must: [{ semantic: { field: "content", query } }], filter } } },
            { query: { bool: { must: [{ multi_match: { query, fields: ["content", "name", "title", "store"], fuzziness: "AUTO" } }], filter } } },
          ],
          rank: { rrf: { window_size: 50, rank_constant: 20 } },
        } as any);

        const hits = result.hits.hits.map(
          (hit) => hit._source as unknown as ProductViewed,
        );
        console.log(`[Elasticsearch] searchProductsViewed results=${hits.length}`);
        return hits;
      } catch {
        // Fallback: semantic-only
        try {
          const must: Record<string, unknown>[] = [
            { semantic: { field: "content", query } },
          ];
          if (sessionId) must.push({ term: { sessionId } });

          const result = await client.search({
            index: "products-viewed",
            query: { bool: { must } },
            size: limit,
          });
          const hits = result.hits.hits.map(
            (hit) => hit._source as unknown as ProductViewed,
          );
          console.log(`[Elasticsearch] searchProductsViewed (fallback) results=${hits.length}`);
          return hits;
        } catch {
          return [];
        }
      }
    },

    async fetchMemoryContext(
      query: string,
      sessionId?: string,
    ): Promise<string> {
      if (!client) return "";

      try {
        const [pages, products, conversations] = await Promise.all([
          this.searchBrowsingHistory(query, sessionId, 3),
          this.searchProductsViewed(query, sessionId, 3),
          this.searchConversationHistory(query, sessionId, 3),
        ]);

        console.log(`[Elasticsearch] fetchMemoryContext query="${query}" pages=${pages.length} products=${products.length} conversations=${conversations.length}`);
        const parts: string[] = [];

        if (pages.length > 0) {
          const summaries = pages.map((p) => `"${p.title}" (${p.url})`).join(", ");
          parts.push(`Previously visited pages: ${summaries}`);
        }

        if (products.length > 0) {
          const summaries = products
            .map((p) => `${p.name}${p.price ? ` ($${p.price})` : ""}${p.store ? ` at ${p.store}` : ""}`)
            .join(", ");
          parts.push(`Previously viewed products: ${summaries}`);
        }

        if (conversations.length > 0) {
          const summaries = conversations
            .map((c) => `${c.role}: "${c.text.slice(0, 100)}"`)
            .join("; ");
          parts.push(`Related earlier conversation: ${summaries}`);
        }

        return parts.join(". ");
      } catch {
        return "";
      }
    },

    async indexConversation(entry: ConversationEntry): Promise<void> {
      if (!client) return;

      console.log(`[Elasticsearch] indexConversation role=${entry.role} text="${entry.text.slice(0, 80)}"`);
      try {
        await client.index({
          index: "conversation-history",
          document: entry,
        });
      } catch {
        // fire-and-forget
      }
    },

    async searchConversationHistory(
      query: string,
      sessionId?: string,
      limit = 5,
    ): Promise<ConversationEntry[]> {
      if (!client) return [];

      console.log(`[Elasticsearch] searchConversationHistory query="${query}" sessionId=${sessionId} limit=${limit}`);
      try {
        const filter = sessionId ? [{ term: { sessionId } }] : [];
        const result = await client.search({
          index: "conversation-history",
          size: limit,
          sub_searches: [
            { query: { bool: { must: [{ semantic: { field: "text", query } }], filter } } },
            { query: { bool: { must: [{ multi_match: { query, fields: ["text"], fuzziness: "AUTO" } }], filter } } },
          ],
          rank: { rrf: { window_size: 50, rank_constant: 20 } },
        } as any);

        const hits = result.hits.hits.map(
          (hit) => hit._source as unknown as ConversationEntry,
        );
        console.log(`[Elasticsearch] searchConversationHistory results=${hits.length}`);
        return hits;
      } catch {
        // Fallback: semantic-only
        try {
          const must: Record<string, unknown>[] = [
            { semantic: { field: "text", query } },
          ];
          if (sessionId) must.push({ term: { sessionId } });

          const result = await client.search({
            index: "conversation-history",
            query: { bool: { must } },
            size: limit,
          });
          const hits = result.hits.hits.map(
            (hit) => hit._source as unknown as ConversationEntry,
          );
          console.log(`[Elasticsearch] searchConversationHistory (fallback) results=${hits.length}`);
          return hits;
        } catch {
          return [];
        }
      }
    },

    async restoreConversation(
      sessionId: string,
      limit = 50,
    ): Promise<ConversationEntry[]> {
      if (!client) return [];

      console.log(`[Elasticsearch] restoreConversation sessionId=${sessionId} limit=${limit}`);
      try {
        const result = await client.search({
          index: "conversation-history",
          query: { term: { sessionId } },
          sort: [{ timestamp: { order: "asc" } }],
          size: limit,
        });

        const hits = result.hits.hits.map(
          (hit) => hit._source as unknown as ConversationEntry,
        );
        console.log(`[Elasticsearch] restoreConversation results=${hits.length}`);
        return hits;
      } catch {
        return [];
      }
    },
  };
}
