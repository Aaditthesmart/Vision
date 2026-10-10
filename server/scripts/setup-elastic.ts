/**
 * One-time Elasticsearch provisioning script.
 * Run: npx tsx server/scripts/setup-elastic.ts
 *
 * Creates:
 * 1. JINA inference endpoint (jina-embeddings-v3)
 * 2. browsing-history index (semantic_text content field)
 * 3. products-viewed index (semantic_text content field)
 * 4. user-profile index (structured mappings)
 * 5. drug-safety-pipeline (flags drug interaction keywords)
 * 6. Agent Builder agent via Kibana API (if KIBANA_URL set)
 */

import "dotenv/config";
import { Client } from "@elastic/elasticsearch";

const cloudId = process.env.ELASTIC_CLOUD_ID;
const apiKey = process.env.ELASTIC_API_KEY;
const jinaApiKey = process.env.JINA_API_KEY;
const kibanaUrl = process.env.KIBANA_URL;

if (!cloudId || !apiKey) {
  console.error("ELASTIC_CLOUD_ID and ELASTIC_API_KEY are required.");
  process.exit(1);
}

const client = new Client({ cloud: { id: cloudId }, auth: { apiKey } });

async function setup() {
  const info = await client.info();
  console.log(`Connected to: ${info.cluster_name} (v${info.version.number})`);

  // ── 1. JINA inference endpoint ──────────────────────────────
  if (jinaApiKey) {
    console.log("\n1. Creating JINA inference endpoint...");
    try {
      await client.inference.put({
        inference_id: "jina-embeddings-v3",
        task_type: "text_embedding",
        inference_config: {
          service: "jinaai",
          service_settings: {
            model_id: "jina-embeddings-v3",
            api_key: jinaApiKey,
          },
          task_settings: {
            task: "text_embedding",
          },
        } as Record<string, unknown>,
      });
      console.log("   JINA inference endpoint created.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists") || msg.includes("resource_already_exists")) {
        console.log("   JINA inference endpoint already exists — skipping.");
      } else {
        console.warn("   Warning:", msg);
      }
    }
  } else {
    console.log("\n1. JINA_API_KEY not set — skipping inference endpoint (semantic_text will need one).");
  }

  // ── 2. browsing-history index ───────────────────────────────
  console.log("\n2. Creating browsing-history index...");
  try {
    await client.indices.create({
      index: "browsing-history",
      mappings: {
        properties: {
          url: { type: "keyword" },
          title: { type: "text" },
          content: {
            type: "semantic_text",
            inference_id: "jina-embeddings-v3",
          },
          sessionId: { type: "keyword" },
          userQuery: { type: "text" },
          agentCategory: { type: "keyword" },
          timestamp: { type: "date" },
          drug_safety_flag: { type: "boolean" },
        },
      },
    });
    console.log("   browsing-history index created.");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("already exists") || msg.includes("resource_already_exists")) {
      console.log("   browsing-history index already exists — skipping.");
    } else {
      console.warn("   Warning:", msg);
    }
  }

  // ── 3. products-viewed index ────────────────────────────────
  console.log("\n3. Creating products-viewed index...");
  try {
    await client.indices.create({
      index: "products-viewed",
      mappings: {
        properties: {
          url: { type: "keyword" },
          title: { type: "text" },
          name: { type: "text" },
          price: { type: "keyword" },
          rating: { type: "keyword" },
          store: { type: "keyword" },
          content: {
            type: "semantic_text",
            inference_id: "jina-embeddings-v3",
          },
          sessionId: { type: "keyword" },
          timestamp: { type: "date" },
        },
      },
    });
    console.log("   products-viewed index created.");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("already exists") || msg.includes("resource_already_exists")) {
      console.log("   products-viewed index already exists — skipping.");
    } else {
      console.warn("   Warning:", msg);
    }
  }

  // ── 4. user-profile index ──────────────────────────────────
  console.log("\n4. Creating user-profile index...");
  try {
    await client.indices.create({
      index: "user-profile",
      mappings: {
        properties: {
          sessionId: { type: "keyword" },
          name: { type: "text" },
          preferences: {
            properties: {
              budget: { type: "keyword" },
              currency: { type: "keyword" },
              preferredStores: { type: "text" },
              language: { type: "keyword" },
            },
          },
          accessibility: {
            properties: {
              screenReader: { type: "boolean" },
              voiceOnly: { type: "boolean" },
            },
          },
        },
      },
    });
    console.log("   user-profile index created.");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("already exists") || msg.includes("resource_already_exists")) {
      console.log("   user-profile index already exists — skipping.");
    } else {
      console.warn("   Warning:", msg);
    }
  }

  // ── 5. drug-safety-pipeline ────────────────────────────────
  console.log("\n5. Creating drug-safety-pipeline...");
  try {
    await client.ingest.putPipeline({
      id: "drug-safety-pipeline",
      description: "Flags documents mentioning drug interaction keywords",
      processors: [
        {
          set: {
            field: "drug_safety_flag",
            value: false,
          },
        },
        {
          script: {
            source: `
              def content = ctx.content?.toLowerCase() ?: '';
              def title = ctx.title?.toLowerCase() ?: '';
              def text = content + ' ' + title;
              def keywords = [
                'drug interaction', 'contraindication', 'side effect',
                'adverse reaction', 'overdose', 'warning', 'precaution',
                'do not take', 'consult your doctor', 'allergic reaction',
                'medication guide', 'black box warning', 'pregnancy category',
                'controlled substance', 'prescription required'
              ];
              for (kw in keywords) {
                if (text.contains(kw)) {
                  ctx.drug_safety_flag = true;
                  break;
                }
              }
            `.trim(),
          },
        },
      ],
    });
    console.log("   drug-safety-pipeline created.");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("   Warning:", msg);
  }

  // ── 6. conversation-history index ─────────────────────────
  console.log("\n6. Creating conversation-history index...");
  try {
    await client.indices.create({
      index: "conversation-history",
      mappings: {
        properties: {
          sessionId: { type: "keyword" },
          role: { type: "keyword" },
          text: {
            type: "semantic_text",
            inference_id: "jina-embeddings-v3",
          },
          agentCategory: { type: "keyword" },
          timestamp: { type: "date" },
        },
      },
    });
    console.log("   conversation-history index created.");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("already exists") || msg.includes("resource_already_exists")) {
      console.log("   conversation-history index already exists — skipping.");
    } else {
      console.warn("   Warning:", msg);
    }
  }

  // ── 7. Agent Builder agent (Kibana) ────────────────────────
  if (kibanaUrl) {
    console.log("\n6. Creating Agent Builder agent in Kibana...");
    try {
      const response = await fetch(`${kibanaUrl}/api/security_ai_assistant/knowledge_base/entries/_bulk_action`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "kbn-xsrf": "true",
          Authorization: `ApiKey ${apiKey}`,
        },
        body: JSON.stringify({
          create: [
            {
              type: "index",
              name: "Browsing History",
              namespace: "default",
              index: "browsing-history",
              field: "content",
              description: "Pages visited by the voice browser assistant",
              queryDescription: "Use this to search for previously visited web pages, articles, and content the user has browsed.",
            },
            {
              type: "index",
              name: "Products Viewed",
              namespace: "default",
              index: "products-viewed",
              field: "content",
              description: "Products the user has looked at during shopping sessions",
              queryDescription: "Use this to search for products the user has previously viewed, compared, or considered purchasing.",
            },
            {
              type: "index",
              name: "Conversation History",
              namespace: "default",
              index: "conversation-history",
              field: "text",
              description: "Past conversations between the user and the voice assistant",
              queryDescription: "Use this to search past conversations, questions the user asked, and assistant responses.",
            },
          ],
        }),
      });
      if (response.ok) {
        console.log("   Agent Builder knowledge sources created.");
      } else {
        console.warn(`   Kibana responded: ${response.status} ${response.statusText}`);
      }
    } catch (err: unknown) {
      console.warn("   Agent Builder setup failed:", err instanceof Error ? err.message : err);
    }
  } else {
    console.log("\n6. KIBANA_URL not set — skipping Agent Builder setup.");
  }

  console.log("\nSetup complete!");
}

setup().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
