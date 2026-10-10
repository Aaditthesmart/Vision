import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExecutionContext, KnowledgeBase } from "../types/index.js";

const execFileAsync = promisify(execFile);

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Perplexity Sonar Web Search ─────────────────────────────

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY ?? "";
const PERPLEXITY_ENDPOINT = "https://api.perplexity.ai/chat/completions";

interface PerplexityResponse {
  choices: { message: { content: string } }[];
  citations?: string[];
}

/**
 * Create a web search tool powered by Perplexity Sonar.
 * Returns empty array if PERPLEXITY_API_KEY is not set.
 */
export function createSearchTools(): DynamicStructuredTool[] {
  if (!PERPLEXITY_API_KEY) return [];

  const webSearch = new DynamicStructuredTool({
    name: "web_search",
    description:
      "Search the web for real-time information using Perplexity Sonar. Returns a grounded answer with source citations. Use this INSTEAD of navigating to Google. Best for: product comparisons, prices, reviews, news, factual questions, 'best X for Y' queries.",
    schema: z.object({
      query: z
        .string()
        .describe("The search query, e.g. 'best wireless headphones under 50 dollars 2026'"),
      search_recency: z
        .enum(["hour", "day", "week", "month"])
        .describe("How recent the results should be")
        .default("week"),
    }),
    func: async (input: any) => {
      try {
        const startTime = Date.now();
        console.log(`[web_search] Starting query="${input.query}" recency=${input.search_recency ?? "week"}`);
        const res = await fetch(PERPLEXITY_ENDPOINT, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "sonar",
            messages: [
              {
                role: "system",
                content:
                  "You are a search assistant. Provide accurate, concise answers with specific details like prices, ratings, and product names. Focus on the most relevant results.",
              },
              { role: "user", content: input.query },
            ],
            max_tokens: 1024,
            temperature: 0.2,
            search_recency_filter: input.search_recency ?? "week",
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          console.error(`[web_search] Perplexity API error ${res.status}: ${errText}`);
          return JSON.stringify({ success: false, error: `Search API error: ${res.status}` });
        }

        const data = (await res.json()) as PerplexityResponse;
        const answer = data.choices?.[0]?.message?.content ?? "";
        const citations = data.citations ?? [];

        console.log(`[web_search] query="${input.query}" citations=${citations.length} answerLen=${answer.length} elapsed=${Date.now() - startTime}ms`);

        return JSON.stringify({
          success: true,
          answer,
          citations,
        });
      } catch (err) {
        console.error("[web_search] error:", err);
        return JSON.stringify({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  });

  return [webSearch];
}

/**
 * Create LangChain tools that wrap the Stagehand ExecutionContext.
 * These tools let agents control the browser via natural language.
 *
 * Note: func casts input to `any` to work around zod v4 / @langchain/core type mismatch.
 */
export function createBrowserTools(ctx: ExecutionContext) {
  const navigateToUrl = new DynamicStructuredTool({
    name: "navigate_to_url",
    description:
      "Navigate the browser to a URL. Use for going to websites like amazon.com, google.com, etc.",
    schema: z.object({
      url: z.string().describe("The full URL to navigate to, e.g. https://amazon.com"),
    }),
    func: async (input: any) => {
      const result = await ctx.navigate(input.url);
      return JSON.stringify(result);
    },
  });

  const clickElement = new DynamicStructuredTool({
    name: "click_element",
    description:
      "Click, type, scroll, or interact with an element on the page. Describe the action naturally, e.g. 'Click the Add to Cart button' or 'Type wireless headphones in the search box'.",
    schema: z.object({
      instruction: z
        .string()
        .describe(
          "Natural language action, e.g. 'Click the Add to Cart button'",
        ),
    }),
    func: async (input: any) => {
      // Observe before act — caches element location for faster, more reliable action
      const observed = await ctx.observe(input.instruction);
      if (observed.success) {
        console.log(`[tools] observe before act: found ${observed.actions.length} matching elements`);
      }
      const result = await ctx.act(input.instruction);
      return JSON.stringify(result);
    },
  });

  const extractData = new DynamicStructuredTool({
    name: "extract_data",
    description:
      "Extract structured information from the current page. Describe what data you want.",
    schema: z.object({
      instruction: z
        .string()
        .describe("What to extract, e.g. 'Extract the first 3 product names, prices, and ratings'"),
    }),
    func: async (input: any) => {
      const result = await ctx.extract(input.instruction);
      return JSON.stringify(result);
    },
  });

  const observePage = new DynamicStructuredTool({
    name: "observe_page",
    description:
      "Discover what actions are available on the current page. Returns interactive elements.",
    schema: z.object({
      instruction: z
        .string()
        .describe("Optional focus, e.g. 'Find filter buttons'")
        .default(""),
    }),
    func: async (input: any) => {
      const result = await ctx.observe(input.instruction || undefined);
      return JSON.stringify(result);
    },
  });

  return [navigateToUrl, clickElement, extractData, observePage];
}

/**
 * Create LangChain tools for querying the Elasticsearch knowledge base.
 * Returns empty array if KB is null.
 */
export function createKnowledgeTools(
  kb: KnowledgeBase | null,
  sessionId?: string,
) {
  if (!kb || !kb.isAvailable()) return [];

  const searchBrowsingHistory = new DynamicStructuredTool({
    name: "search_browsing_history",
    description:
      "Search previously visited web pages by semantic meaning. Use when the user references something they browsed earlier, e.g. 'find that article about...' or 'what was that page I visited?'",
    schema: z.object({
      query: z
        .string()
        .describe("Semantic search query, e.g. 'cold medicine reviews'"),
    }),
    func: async (input: any) => {
      console.log(`[KB] search_browsing_history query="${input.query}"`);
      const results = await kb.searchBrowsingHistory(
        input.query,
        sessionId,
        5,
      );
      if (results.length === 0) {
        return JSON.stringify({ results: [], message: "No matching pages found in browsing history." });
      }
      return JSON.stringify({
        results: results.map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.content?.slice(0, 200),
          visitedAt: r.timestamp,
        })),
      });
    },
  });

  const searchProductsViewed = new DynamicStructuredTool({
    name: "search_products_viewed",
    description:
      "Search previously viewed products by semantic meaning. Use when the user references products they looked at earlier, e.g. 'find those headphones I was comparing' or 'what was the cheapest option?'",
    schema: z.object({
      query: z
        .string()
        .describe("Semantic search query, e.g. 'wireless headphones under 50'"),
    }),
    func: async (input: any) => {
      console.log(`[KB] search_products_viewed query="${input.query}"`);
      const results = await kb.searchProductsViewed(
        input.query,
        sessionId,
        5,
      );
      if (results.length === 0) {
        return JSON.stringify({ results: [], message: "No matching products found in viewing history." });
      }
      return JSON.stringify({
        results: results.map((r) => ({
          name: r.name,
          price: r.price,
          rating: r.rating,
          store: r.store,
          url: r.url,
          viewedAt: r.timestamp,
        })),
      });
    },
  });

  const searchConversationHistory = new DynamicStructuredTool({
    name: "search_conversation_history",
    description:
      "Search past conversations with the user. Use when user says 'what did I say about...', 'remember when we talked about...', or references something from an earlier conversation.",
    schema: z.object({
      query: z
        .string()
        .describe("Semantic search query about the conversation topic"),
    }),
    func: async (input: any) => {
      console.log(`[KB] search_conversation_history query="${input.query}"`);
      const results = await kb.searchConversationHistory(
        input.query,
        sessionId,
        5,
      );
      if (results.length === 0) {
        return JSON.stringify({ results: [], message: "No matching conversations found." });
      }
      return JSON.stringify({
        results: results.map((r) => ({
          role: r.role,
          text: r.text?.slice(0, 200),
          timestamp: r.timestamp,
        })),
      });
    },
  });

  return [searchBrowsingHistory, searchProductsViewed, searchConversationHistory];
}

// ── Coding Tools ────────────────────────────────────────────

/**
 * Resolve a file path safely within the workspace root.
 * Prevents path traversal attacks (e.g. ../../etc/passwd).
 */
function resolveSafe(workspacePath: string, filePath: string): string {
  const resolved = path.resolve(workspacePath, filePath);
  if (!resolved.startsWith(workspacePath)) {
    throw new Error(`Path traversal blocked: ${filePath}`);
  }
  return resolved;
}

/**
 * Create LangChain tools for file I/O and shell commands.
 * All file operations are sandboxed to the workspace directory.
 */
export function createCodingTools(workspacePath: string): DynamicStructuredTool[] {
  const readFile = new DynamicStructuredTool({
    name: "read_file",
    description:
      "Read the contents of a file with line numbers. Use this to understand code before making edits.",
    schema: z.object({
      path: z.string().describe("File path relative to the workspace root"),
      startLine: z.number().optional().describe("First line to read (1-based). Omit to start from beginning."),
      endLine: z.number().optional().describe("Last line to read (1-based). Omit to read to end."),
    }),
    func: async (input: any) => {
      try {
        const fullPath = resolveSafe(workspacePath, input.path);
        const raw = await fs.readFile(fullPath, "utf-8");
        const lines = raw.split("\n");
        const start = Math.max(1, input.startLine ?? 1);
        const end = Math.min(lines.length, input.endLine ?? lines.length);
        const slice = lines.slice(start - 1, end);
        const numbered = slice.map((line, i) => `${start + i}: ${line}`).join("\n");
        const truncated = numbered.length > 10_000
          ? numbered.slice(0, 10_000) + "\n... (truncated)"
          : numbered;
        return JSON.stringify({
          success: true,
          path: input.path,
          totalLines: lines.length,
          startLine: start,
          endLine: end,
          content: truncated,
        });
      } catch (err) {
        return JSON.stringify({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  });

  const writeFile = new DynamicStructuredTool({
    name: "write_file",
    description:
      "Create or overwrite a file with the given content. Creates parent directories if needed.",
    schema: z.object({
      path: z.string().describe("File path relative to the workspace root"),
      content: z.string().describe("The full file content to write"),
    }),
    func: async (input: any) => {
      try {
        const fullPath = resolveSafe(workspacePath, input.path);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, input.content, "utf-8");
        return JSON.stringify({ success: true, path: input.path });
      } catch (err) {
        return JSON.stringify({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  });

  const editFile = new DynamicStructuredTool({
    name: "edit_file",
    description:
      "Replace the first occurrence of oldText with newText in a file. Read the file first to get the exact text to match.",
    schema: z.object({
      path: z.string().describe("File path relative to the workspace root"),
      oldText: z.string().describe("The exact text to find (must match file contents exactly)"),
      newText: z.string().describe("The replacement text"),
    }),
    func: async (input: any) => {
      try {
        const fullPath = resolveSafe(workspacePath, input.path);
        const content = await fs.readFile(fullPath, "utf-8");
        if (!content.includes(input.oldText)) {
          return JSON.stringify({
            success: false,
            error: "oldText not found in file. Read the file first to get the exact text.",
          });
        }
        const updated = content.replace(input.oldText, input.newText);
        await fs.writeFile(fullPath, updated, "utf-8");
        return JSON.stringify({ success: true, path: input.path });
      } catch (err) {
        return JSON.stringify({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  });

  const runCommand = new DynamicStructuredTool({
    name: "run_command",
    description:
      "Execute a shell command. Use for running tests, builds, git commands, linters, etc. Returns stdout and stderr.",
    schema: z.object({
      command: z.string().describe("The shell command to execute"),
      cwd: z.string().optional().describe("Working directory relative to workspace root. Defaults to workspace root."),
    }),
    func: async (input: any) => {
      try {
        const cwd = input.cwd
          ? resolveSafe(workspacePath, input.cwd)
          : workspacePath;
        const { stdout, stderr } = await execFileAsync(
          "/bin/bash",
          ["-c", input.command],
          { cwd, timeout: 30_000, maxBuffer: 512 * 1024 },
        );
        let output = "";
        if (stdout) output += stdout;
        if (stderr) output += (output ? "\n" : "") + stderr;
        if (output.length > 8_000) {
          output = output.slice(0, 8_000) + "\n... (truncated)";
        }
        return JSON.stringify({ success: true, output: output || "(no output)" });
      } catch (err: any) {
        // Command failed but may still have useful stdout/stderr
        let output = "";
        if (err.stdout) output += err.stdout;
        if (err.stderr) output += (output ? "\n" : "") + err.stderr;
        if (output.length > 8_000) {
          output = output.slice(0, 8_000) + "\n... (truncated)";
        }
        return JSON.stringify({
          success: false,
          exitCode: err.code ?? null,
          output: output || (err instanceof Error ? err.message : String(err)),
        });
      }
    },
  });

  const listDirectory = new DynamicStructuredTool({
    name: "list_directory",
    description:
      "List files and directories. Use recursive mode to explore project structure.",
    schema: z.object({
      path: z.string().describe("Directory path relative to workspace root").default("."),
      recursive: z.boolean().optional().describe("If true, list recursively (excludes node_modules, .git, dist). Defaults to false."),
    }),
    func: async (input: any) => {
      try {
        const fullPath = resolveSafe(workspacePath, input.path || ".");
        if (input.recursive) {
          const { stdout } = await execFileAsync(
            "/usr/bin/find",
            [fullPath, "-maxdepth", "4",
             "-not", "-path", "*/node_modules/*",
             "-not", "-path", "*/.git/*",
             "-not", "-path", "*/dist/*",
             "-not", "-path", "*/.next/*"],
            { timeout: 10_000, maxBuffer: 256 * 1024 },
          );
          const entries = stdout.trim().split("\n")
            .map(p => path.relative(workspacePath, p))
            .filter(Boolean)
            .slice(0, 200);
          return JSON.stringify({ success: true, entries, count: entries.length });
        }
        const entries = await fs.readdir(fullPath, { withFileTypes: true });
        const items = entries.map(e => ({
          name: e.name,
          type: e.isDirectory() ? "directory" : "file",
        }));
        return JSON.stringify({ success: true, entries: items, count: items.length });
      } catch (err) {
        return JSON.stringify({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  });

  const searchCode = new DynamicStructuredTool({
    name: "search_code",
    description:
      "Search for a pattern in the codebase using grep. Returns matching lines with file paths and line numbers.",
    schema: z.object({
      pattern: z.string().describe("The text or regex pattern to search for"),
      path: z.string().optional().describe("Directory to search in, relative to workspace root. Defaults to workspace root."),
      fileGlob: z.string().optional().describe("File glob to filter, e.g. '*.ts' or '*.py'"),
    }),
    func: async (input: any) => {
      try {
        const searchPath = input.path
          ? resolveSafe(workspacePath, input.path)
          : workspacePath;
        const args = ["-rn", "-I", "--color=never"];
        if (input.fileGlob) {
          args.push("--include", input.fileGlob);
        }
        args.push(
          "--exclude-dir=node_modules",
          "--exclude-dir=.git",
          "--exclude-dir=dist",
          "--exclude-dir=.next",
          input.pattern,
          searchPath,
        );
        const { stdout } = await execFileAsync("/usr/bin/grep", args, {
          timeout: 10_000,
          maxBuffer: 256 * 1024,
        });
        const lines = stdout.trim().split("\n").filter(Boolean);
        const results = lines.slice(0, 50).map(line => {
          const rel = line.replace(workspacePath + "/", "");
          return rel;
        });
        return JSON.stringify({
          success: true,
          matches: results,
          count: results.length,
          totalMatches: lines.length,
        });
      } catch (err: any) {
        // grep exit code 1 means no matches — not an error
        if (err.code === 1) {
          return JSON.stringify({ success: true, matches: [], count: 0, totalMatches: 0 });
        }
        return JSON.stringify({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  });

  return [readFile, writeFile, editFile, runCommand, listDirectory, searchCode];
}
