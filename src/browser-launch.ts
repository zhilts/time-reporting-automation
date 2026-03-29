import path from "node:path";
import { loadConfig } from "./config.ts";

type LaunchBrowserOptions = {
  rootDir: string;
  configPath?: string;
  privateConfigPath?: string;
  urlOverride?: string;
};

type LaunchBrowserSummary = {
  provider: "playwright";
  channel: string;
  headless: boolean;
  user_data_dir: string;
  profile_directory: string | null;
  target_url: string;
  executable_path: string | null;
  args: string[];
  warning: string | null;
};

export async function launchConfiguredBrowser({
  rootDir,
  configPath = "./config/mapping.json",
  privateConfigPath = "./config/private.mapping.json",
  urlOverride
}: LaunchBrowserOptions): Promise<LaunchBrowserSummary> {
  const config = loadConfig(rootDir, configPath, privateConfigPath);
  const browserLaunch = config.browser_launch;

  if (!browserLaunch?.enabled) {
    throw new Error("Browser launch is disabled. Set browser_launch.enabled=true in config.");
  }

  const provider = browserLaunch.provider ?? "playwright";
  if (provider !== "playwright") {
    throw new Error(`Unsupported browser launch provider: ${provider}`);
  }

  const userDataDir = browserLaunch.user_data_dir;
  if (!userDataDir) {
    throw new Error("browser_launch.user_data_dir is required.");
  }

  const targetUrl = urlOverride ?? browserLaunch.target_url ?? config.upload?.target_page_url;
  if (!targetUrl) {
    throw new Error("No browser launch target URL configured.");
  }

  let playwrightModule: typeof import("playwright");
  try {
    playwrightModule = await import("playwright");
  } catch {
    throw new Error("The `playwright` package is not installed. Run `npm install playwright` in the project.");
  }

  const channel = browserLaunch.channel ?? "chrome";
  const headless = browserLaunch.headless ?? false;
  const profileDirectory = browserLaunch.profile_directory ?? null;
  const extraArgs = browserLaunch.args ?? [];
  const args = profileDirectory ? [`--profile-directory=${profileDirectory}`, ...extraArgs] : extraArgs;
  const executablePath = browserLaunch.executable_path ?? undefined;

  const warning = path.basename(userDataDir) === "Chrome"
    ? "Chrome main User Data is configured. Playwright docs warn that automating the primary Chrome profile can break due to policy changes. Prefer a dedicated automation copy when possible."
    : null;

  const context = await playwrightModule.chromium.launchPersistentContext(userDataDir, {
    channel,
    headless,
    executablePath,
    args
  });

  const page = context.pages().find((candidate) => candidate.url().includes(targetUrl))
    ?? context.pages().find((candidate) => candidate.url() !== "about:blank")
    ?? context.pages()[0]
    ?? (await context.newPage());

  if (!page.url() || page.url() === "about:blank") {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  }

  return {
    provider,
    channel,
    headless,
    user_data_dir: userDataDir,
    profile_directory: profileDirectory,
    target_url: targetUrl,
    executable_path: executablePath ?? null,
    args,
    warning
  };
}
