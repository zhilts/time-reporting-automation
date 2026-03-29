import type { BrowserContext, Page } from "playwright";
import { loadConfig } from "./config.ts";

type InspectBrowserOptions = {
  rootDir: string;
  configPath?: string;
  privateConfigPath?: string;
  urlOverride?: string;
};

type BrowserLaunchConfig = NonNullable<ReturnType<typeof loadConfig>["browser_launch"]>;

function normalizeTargetUrl(targetUrl: string): string {
  try {
    const url = new URL(targetUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return targetUrl;
  }
}

async function openConfiguredContext(config: BrowserLaunchConfig): Promise<BrowserContext> {
  let playwrightModule: typeof import("playwright");
  try {
    playwrightModule = await import("playwright");
  } catch {
    throw new Error("The `playwright` package is not installed. Run `npm install playwright` in the project.");
  }

  const userDataDir = config.user_data_dir;
  if (!userDataDir) {
    throw new Error("browser_launch.user_data_dir is required.");
  }

  return playwrightModule.chromium.launchPersistentContext(userDataDir, {
    channel: config.channel ?? "chrome",
    headless: config.headless ?? false,
    executablePath: config.executable_path ?? undefined,
    args: config.profile_directory
      ? [`--profile-directory=${config.profile_directory}`, ...(config.args ?? [])]
      : (config.args ?? [])
  });
}

async function resolveTargetPage(context: BrowserContext, targetUrl: string): Promise<Page> {
  const normalizedTarget = normalizeTargetUrl(targetUrl);

  for (const page of context.pages()) {
    const currentUrl = page.url();
    if (currentUrl && normalizeTargetUrl(currentUrl) === normalizedTarget) {
      return page;
    }
  }

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  return page;
}

export async function inspectConfiguredBrowser({
  rootDir,
  configPath = "./config/mapping.json",
  privateConfigPath = "./config/private.mapping.json",
  urlOverride
}: InspectBrowserOptions): Promise<unknown> {
  console.error("[inspect] loading config");
  const config = loadConfig(rootDir, configPath, privateConfigPath);
  const browserLaunch = config.browser_launch;

  if (!browserLaunch?.enabled) {
    throw new Error("Browser launch is disabled. Set browser_launch.enabled=true in config.");
  }

  const targetUrl = urlOverride ?? browserLaunch.target_url ?? config.upload?.target_page_url;
  if (!targetUrl) {
    throw new Error("No browser launch target URL configured.");
  }

  console.error("[inspect] launching persistent context");
  const context = await openConfiguredContext(browserLaunch);

  try {
    console.error("[inspect] resolving target page");
    const page = await resolveTargetPage(context, targetUrl);
    console.error(`[inspect] target page ${page.url() || "<empty>"}`);
    await page.bringToFront({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(2_000);

    console.error("[inspect] evaluating page");
    const addNewLink = page.locator("[title='Add new record']").first();
    if (await addNewLink.count()) {
      await addNewLink.click().catch(() => {});
      await page.waitForTimeout(2_000);
    }

    const collectTaskOptionsForProject = async (projectLabel: string) => {
      const projectSelect = page.locator("#listBoxProjectUuid");
      const taskSelect = page.locator("#listBoxIssueCode");
      if (!(await projectSelect.count()) || !(await taskSelect.count())) {
        return { project: projectLabel, options: [] as Array<{ value: string; label: string }> };
      }

      await projectSelect.selectOption({ label: projectLabel }).catch(() => {});
      await page.waitForTimeout(2_000);

      const options = await taskSelect.evaluate((node) =>
        Array.from((node as HTMLSelectElement).options).map((option) => ({
          value: option.value,
          label: option.textContent?.replace(/\s+/g, " ").trim() ?? ""
        }))
      ).catch(() => []);

      return { project: projectLabel, options };
    };

    const projectTaskOptions = [
      await collectTaskOptionsForProject("HDAA"),
      await collectTaskOptionsForProject("COM")
    ];

    const snapshot = await page.evaluate(() => {
      const takeTexts = (selector: string, limit: number) =>
        Array.from(document.querySelectorAll(selector))
          .map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .slice(0, limit);

      const interestingTexts = [
        "Syncs/Dailies",
        "HD-1726",
        "Code review",
        "Communication",
        "Data Transformation Pod Standup"
      ];

      const findRecordContainers = () => {
        const results: Array<{
          needle: string;
          text: string;
          links: Array<{ label: string; href: string | null; title: string | null }>;
        }> = [];

        for (const needle of interestingTexts) {
          const matchingNodes = Array.from(document.querySelectorAll("body *"))
            .filter((node) => (node.textContent ?? "").includes(needle))
            .slice(0, 3);

          for (const node of matchingNodes) {
            let container: Element | null = node;
            while (container && !["TR", "LI", "DIV", "FORM"].includes(container.tagName)) {
              container = container.parentElement;
            }

            if (!container) {
              continue;
            }

            const text = (container.textContent ?? "").replace(/\s+/g, " ").trim();
            if (!text || text.length > 400 || !/\b\d{2}\.\d{2}\.\d{4}\b/.test(text)) {
              continue;
            }

            const links = Array.from(container.querySelectorAll("a, button, input[type='submit'], input[type='button']"))
              .map((child) => {
                const label = (child.textContent ?? "").replace(/\s+/g, " ").trim()
                  || (child instanceof HTMLInputElement ? child.value : "");
                return {
                  label,
                  href: child instanceof HTMLAnchorElement ? child.href : null,
                  title: child.getAttribute("title")
                };
              })
              .filter((value) => value.label || value.href || value.title);

            results.push({ needle, text, links });
          }
        }

        return results.slice(0, 20);
      };

      const inputs = Array.from(document.querySelectorAll("input, textarea, select"))
        .map((node) => {
          const element = node as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
          return {
            tag: element.tagName.toLowerCase(),
            name: element.getAttribute("name"),
            id: element.id || null,
            placeholder: element.getAttribute("placeholder"),
            type: "type" in element ? element.type : null,
            value: "value" in element ? element.value : null
          };
        })
        .slice(0, 30);

      const actionControls = Array.from(document.querySelectorAll("input[type='submit'], input[type='button'], button, a"))
        .map((node) => {
          const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
          const inputValue = node instanceof HTMLInputElement ? node.value : null;
          const label = text || inputValue || "";
          if (!label) {
            return null;
          }

          return {
            tag: node.tagName.toLowerCase(),
            id: node.id || null,
            name: node.getAttribute("name"),
            href: node instanceof HTMLAnchorElement ? node.href : null,
            label
          };
        })
        .filter((value) => Boolean(value))
        .slice(0, 50);

      const actionHints = Array.from(document.querySelectorAll("[title], a, button, input"))
        .map((node) => {
          const html = node.outerHTML.replace(/\s+/g, " ").trim();
          const title = node.getAttribute("title");
          const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
          const value = node instanceof HTMLInputElement ? node.value : "";
          const haystack = `${html} ${title ?? ""} ${text} ${value}`.toLowerCase();
          if (!["delete", "remove", "edit", "update", "save", "add new time report"].some((needle) => haystack.includes(needle))) {
            return null;
          }

          return {
            title,
            text,
            value,
            html: html.slice(0, 500)
          };
        })
        .filter((value) => Boolean(value))
        .slice(0, 30);

      const existingRecords = Array.from(document.querySelectorAll("[title='Delete record']"))
        .map((node) => {
          const onclick = node.getAttribute("onclick") ?? "";
          const match = onclick.match(/doDelete\('([^']+)'\)/);
          const recordId = match ? match[1] : null;

          let container: Element | null = node;
          while (container && container.tagName !== "TR") {
            container = container.parentElement;
          }

          const fallbackContainer = container ?? node.parentElement?.parentElement ?? node.parentElement ?? node;
          const text = (fallbackContainer?.textContent ?? "").replace(/\s+/g, " ").trim();

          return {
            record_id: recordId,
            text: text.slice(0, 400)
          };
        })
        .filter((record) => record.record_id)
        .slice(0, 30);

      const addFormInputs = Array.from(document.querySelectorAll("input, textarea, select"))
        .map((node) => {
          const element = node as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
          const hidden = element instanceof HTMLInputElement && element.type === "hidden";
          const style = window.getComputedStyle(element);
          const visible = style.display !== "none" && style.visibility !== "hidden";
          return {
            tag: element.tagName.toLowerCase(),
            name: element.getAttribute("name"),
            id: element.id || null,
            type: "type" in element ? element.type : null,
            value: "value" in element ? element.value : null,
            hidden,
            visible
          };
        })
        .filter((item) => !item.hidden && item.visible)
        .slice(0, 60);

      const addFormOptions = ["listBoxProjectUuid", "listBoxIssueCode"].map((id) => {
        const select = document.getElementById(id) as HTMLSelectElement | null;
        return {
          id,
          value: select?.value ?? null,
          options: select
            ? Array.from(select.options).map((option) => ({
                value: option.value,
                label: option.textContent?.replace(/\s+/g, " ").trim() ?? ""
              })).slice(0, 60)
            : []
        };
      });

      return {
        title: document.title,
        url: window.location.href,
        headings: takeTexts("h1, h2, h3", 12),
        buttons: takeTexts("button, [role='button']", 20),
        links: takeTexts("a", 20),
        record_containers: findRecordContainers(),
        inputs,
        action_controls: actionControls,
        action_hints: actionHints,
        existing_records: existingRecords,
        add_form_inputs: addFormInputs,
        add_form_options: addFormOptions
      };
    });

    return {
      ...snapshot,
      project_task_options: projectTaskOptions
    };
    
    console.error("[inspect] snapshot ready");
  } finally {
    console.error("[inspect] closing context");
    void context.close().catch(() => {});
  }
}
