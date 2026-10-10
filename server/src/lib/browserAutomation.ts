import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { existsSync } from "fs";
import type {
  PageContext,
  AccessibleElement,
  HeadingItem,
  LandmarkItem,
  FormItem,
} from "../types/accessibility.js";

export class BrowserAutomation {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private isHeadless: boolean;

  constructor(headless = false) {
    this.isHeadless = headless;
  }

  private findSystemBrowser(): { executablePath?: string; channel?: string } {
    // Windows Edge check
    const edgePaths = [
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    ];
    for (const p of edgePaths) {
      if (existsSync(p)) return { executablePath: p };
    }

    // Windows Chrome check
    const chromePaths = [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ];
    for (const p of chromePaths) {
      if (existsSync(p)) return { executablePath: p };
    }

    return { channel: "msedge" };
  }

  public async init(): Promise<void> {
    if (this.browser && this.page) return;

    try {
      const browserConfig = this.findSystemBrowser();
      console.log("[BrowserAutomation] Launching browser:", browserConfig);

      this.browser = await chromium.launch({
        headless: this.isHeadless,
        ...browserConfig,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--start-maximized",
        ],
      });

      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 VisionOS/1.0",
      });

      this.page = await this.context.newPage();
      console.log("[BrowserAutomation] Browser instance successfully initialized");
    } catch (err) {
      console.warn(
        "[BrowserAutomation] Failed to launch with system browser path, falling back to default chromium:",
        err,
      );
      this.browser = await chromium.launch({
        headless: this.isHeadless,
      });
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 800 },
      });
      this.page = await this.context.newPage();
    }
  }

  public getPage(): Page | null {
    return this.page;
  }

  public async navigate(url: string): Promise<{ success: boolean; url: string; title: string; error?: string }> {
    await this.init();
    if (!this.page) throw new Error("Browser page not initialized");

    try {
      console.log(`[BrowserAutomation] Navigating to: ${url}`);
      await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await this.page.waitForTimeout(500); // Allow dynamic scripts to settle
      const title = await this.page.title();
      const currentUrl = this.page.url();
      return { success: true, url: currentUrl, title };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[BrowserAutomation] Navigation failed for ${url}:`, errorMsg);
      return {
        success: false,
        url: this.page.url(),
        title: "",
        error: errorMsg,
      };
    }
  }

  /**
   * Extract high-level accessible context from the active browser page.
   */
  public async extractPageContext(includeScreenshot = false): Promise<PageContext> {
    await this.init();
    if (!this.page) throw new Error("Browser page not initialized");

    const page = this.page;
    const url = page.url();
    const title = await page.title();

    // Evaluate in-page accessible extraction script
    const data = await page.evaluate(() => {
      // 1. Headings
      const headings: HeadingItem[] = [];
      document.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((el) => {
        const text = (el.textContent || "").trim();
        if (text) {
          headings.push({
            level: parseInt(el.tagName.substring(1), 10),
            text,
            id: el.id || undefined,
          });
        }
      });

      // 2. Landmarks
      const landmarks: LandmarkItem[] = [];
      const landmarkSelectors = [
        { role: "navigation", sel: "nav, [role='navigation']" },
        { role: "main", sel: "main, [role='main']" },
        { role: "search", sel: "[role='search'], form[role='search']" },
        { role: "banner", sel: "header, [role='banner']" },
        { role: "contentinfo", sel: "footer, [role='contentinfo']" },
        { role: "complementary", sel: "aside, [role='complementary']" },
      ];

      landmarkSelectors.forEach(({ role, sel }) => {
        document.querySelectorAll(sel).forEach((el) => {
          const label = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || "";
          landmarks.push({
            role,
            label: label.trim() || undefined,
            selector: el.id ? `#${el.id}` : sel.split(",")[0],
          });
        });
      });

      // 3. Interactive Elements
      const interactiveElements: AccessibleElement[] = [];
      const interactiveNodes = document.querySelectorAll(
        "button, a[href], input, select, textarea, [role='button'], [role='link'], [role='checkbox'], [role='radio'], [tabindex='0']",
      );

      interactiveNodes.forEach((node, idx) => {
        const el = node as HTMLElement;
        const rect = el.getBoundingClientRect();
        const isVisible =
          rect.width > 0 &&
          rect.height > 0 &&
          window.getComputedStyle(el).visibility !== "hidden" &&
          window.getComputedStyle(el).display !== "none";

        if (!isVisible) return;

        // Compute accessible name
        let name = el.getAttribute("aria-label") || "";
        if (!name && el.getAttribute("aria-labelledby")) {
          const labelledBy = document.getElementById(el.getAttribute("aria-labelledby") || "");
          if (labelledBy) name = (labelledBy.textContent || "").trim();
        }
        if (!name && el.tagName === "INPUT") {
          const input = el as HTMLInputElement;
          if (input.labels && input.labels.length > 0) {
            name = (input.labels[0].textContent || "").trim();
          }
          if (!name) name = input.placeholder || input.name || "";
        }
        if (!name) {
          name = (el.innerText || el.textContent || "").trim();
        }

        // Generate clean unique selector
        let selector = "";
        if (el.id) {
          selector = `#${el.id}`;
        } else if (el.getAttribute("name")) {
          selector = `${el.tagName.toLowerCase()}[name="${el.getAttribute("name")}"]`;
        } else if (el.getAttribute("data-testid")) {
          selector = `[data-testid="${el.getAttribute("data-testid")}"]`;
        } else if (el.classList.length > 0) {
          selector = `${el.tagName.toLowerCase()}.${Array.from(el.classList).slice(0, 2).join(".")}`;
        } else {
          selector = `${el.tagName.toLowerCase()}:nth-of-type(${idx + 1})`;
        }

        const role = el.getAttribute("role") || el.tagName.toLowerCase();

        interactiveElements.push({
          id: el.id || `elem-${idx}`,
          role,
          name: name.slice(0, 100),
          tagName: el.tagName.toLowerCase(),
          text: (el.innerText || "").slice(0, 100),
          value: (el as HTMLInputElement).value || undefined,
          placeholder: (el as HTMLInputElement).placeholder || undefined,
          href: (el as HTMLAnchorElement).href || undefined,
          selector,
          type: (el as HTMLInputElement).type || undefined,
          disabled: (el as HTMLInputElement).disabled || false,
          checked: (el as HTMLInputElement).checked || false,
          focused: document.activeElement === el,
          isVisible: true,
          location: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        });
      });

      // 4. Forms
      const forms: FormItem[] = [];
      document.querySelectorAll("form").forEach((form, fIdx) => {
        const fields: FormItem["fields"] = [];
        form.querySelectorAll("input, select, textarea").forEach((field) => {
          const f = field as HTMLInputElement;
          let label = "";
          if (f.labels && f.labels.length > 0) {
            label = (f.labels[0].textContent || "").trim();
          }
          if (!label) label = f.getAttribute("aria-label") || f.placeholder || f.name || "";

          let fSelector = "";
          if (f.id) fSelector = `#${f.id}`;
          else if (f.name) fSelector = `input[name="${f.name}"]`;
          else fSelector = `form:nth-of-type(${fIdx + 1}) ${f.tagName.toLowerCase()}`;

          fields.push({
            role: f.tagName.toLowerCase(),
            label,
            type: f.type || "text",
            name: f.name || undefined,
            value: f.value || undefined,
            placeholder: f.placeholder || undefined,
            required: f.required || false,
            selector: fSelector,
          });
        });

        forms.push({
          id: form.id || `form-${fIdx}`,
          name: form.name || undefined,
          label: form.getAttribute("aria-label") || undefined,
          fields,
        });
      });

      // 5. Main text content (concise summary)
      const mainEl = document.querySelector("main") || document.querySelector("article") || document.body;
      const paragraphs = Array.from(mainEl.querySelectorAll("p"))
        .map((p) => (p.textContent || "").trim())
        .filter((t) => t.length > 20)
        .slice(0, 5)
        .join(" ");

      // 6. Alerts
      const alerts: string[] = [];
      document.querySelectorAll("[role='alert'], .error, .alert, .error-message").forEach((a) => {
        const text = (a.textContent || "").trim();
        if (text) alerts.push(text);
      });

      return {
        headings,
        landmarks,
        interactiveElements: interactiveElements.slice(0, 50),
        forms,
        mainTextSummary: paragraphs.slice(0, 1000),
        alerts,
      };
    });

    let screenshotBase64: string | undefined;
    if (includeScreenshot) {
      try {
        const buffer = await page.screenshot({ type: "png" });
        screenshotBase64 = buffer.toString("base64");
      } catch {
        // Screenshot failure is non-fatal
      }
    }

    return {
      url,
      title,
      ...data,
      screenshotBase64,
    };
  }

  /**
   * Locate an element and move accessibility & visual focus to it with a highlight indicator.
   */
  public async locateAndFocus(selector: string): Promise<{ success: boolean; evidence?: string; error?: string }> {
    if (!this.page) throw new Error("Browser page not initialized");

    try {
      const locator = this.page.locator(selector).first();
      await locator.waitFor({ state: "visible", timeout: 5000 });
      await locator.scrollIntoViewIfNeeded({ timeout: 3000 });
      await locator.focus();

      // Visual focus indicator overlay for accessibility verification
      await this.page.evaluate((sel) => {
        const el = document.querySelector(sel) as HTMLElement;
        if (el) {
          el.style.outline = "4px solid #3b82f6";
          el.style.outlineOffset = "3px";
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, selector);

      return {
        success: true,
        evidence: `Element "${selector}" focused and highlighted`,
      };
    } catch (err) {
      return {
        success: false,
        error: `Could not locate/focus element with selector "${selector}": ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Click an element safely.
   */
  public async clickElement(selector: string): Promise<{ success: boolean; evidence?: string; error?: string }> {
    if (!this.page) throw new Error("Browser page not initialized");

    try {
      const locator = this.page.locator(selector).first();
      await locator.waitFor({ state: "visible", timeout: 5000 });
      await locator.click({ timeout: 5000 });
      await this.page.waitForTimeout(300);

      return {
        success: true,
        evidence: `Clicked element "${selector}"`,
      };
    } catch (err) {
      return {
        success: false,
        error: `Click failed on "${selector}": ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Fill a form field safely.
   */
  public async fillField(selector: string, value: string): Promise<{ success: boolean; evidence?: string; error?: string }> {
    if (!this.page) throw new Error("Browser page not initialized");

    try {
      const locator = this.page.locator(selector).first();
      await locator.waitFor({ state: "visible", timeout: 5000 });
      await locator.fill(value);

      const actualValue = await locator.inputValue();
      return {
        success: actualValue === value,
        evidence: `Field "${selector}" filled with value "${value}"`,
      };
    } catch (err) {
      return {
        success: false,
        error: `Fill field failed on "${selector}": ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Select a dropdown option.
   */
  public async selectOption(selector: string, value: string): Promise<{ success: boolean; evidence?: string; error?: string }> {
    if (!this.page) throw new Error("Browser page not initialized");

    try {
      const locator = this.page.locator(selector).first();
      await locator.waitFor({ state: "visible", timeout: 5000 });
      await locator.selectOption(value);

      return {
        success: true,
        evidence: `Selected option "${value}" in "${selector}"`,
      };
    } catch (err) {
      return {
        success: false,
        error: `Select option failed on "${selector}": ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Verify postcondition state in the browser.
   */
  public async verifyState(
    method: "url_change" | "element_focused" | "value_matched" | "content_present" | "element_visible" | "page_loaded" | "none",
    expected: string,
    selector?: string,
  ): Promise<{ verified: boolean; evidence: string }> {
    if (!this.page) return { verified: false, evidence: "Browser not running" };

    try {
      switch (method) {
        case "element_focused": {
          if (!selector) return { verified: true, evidence: "No selector specified for focus check" };
          const isFocused = await this.page.evaluate((sel) => {
            const el = document.querySelector(sel);
            return document.activeElement === el;
          }, selector);
          return {
            verified: isFocused,
            evidence: isFocused
              ? `Confirmed: active element matches "${selector}"`
              : `Verification failed: active element is not "${selector}"`,
          };
        }

        case "value_matched": {
          if (!selector) return { verified: true, evidence: "No selector for value check" };
          const val = await this.page.locator(selector).first().inputValue();
          const matched = val === expected;
          return {
            verified: matched,
            evidence: matched
              ? `Confirmed: field "${selector}" contains "${val}"`
              : `Verification failed: expected "${expected}", observed "${val}"`,
          };
        }

        case "url_change": {
          const currentUrl = this.page.url();
          const matched = currentUrl.includes(expected);
          return {
            verified: matched,
            evidence: matched
              ? `Confirmed: current URL contains "${expected}" (${currentUrl})`
              : `Verification failed: URL is "${currentUrl}", does not match "${expected}"`,
          };
        }

        case "element_visible": {
          if (!selector) return { verified: true, evidence: "No selector specified" };
          const visible = await this.page.locator(selector).first().isVisible();
          return {
            verified: visible,
            evidence: visible
              ? `Confirmed: element "${selector}" is visible`
              : `Verification failed: element "${selector}" is not visible`,
          };
        }

        case "content_present": {
          const content = await this.page.content();
          const found = content.toLowerCase().includes(expected.toLowerCase());
          return {
            verified: found,
            evidence: found
              ? `Confirmed: page contains content "${expected}"`
              : `Verification failed: expected content "${expected}" not found on page`,
          };
        }

        default:
          return { verified: true, evidence: "Step completed" };
      }
    } catch (err) {
      return {
        verified: false,
        evidence: `Verification check error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  public async close(): Promise<void> {
    try {
      if (this.context) await this.context.close();
      if (this.browser) await this.browser.close();
    } catch {
      // Best-effort cleanup
    } finally {
      this.page = null;
      this.context = null;
      this.browser = null;
    }
  }
}

export const browserAutomation = new BrowserAutomation(false);
