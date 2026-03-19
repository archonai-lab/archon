/**
 * First-run setup — copies defaults to ~/.archon/ if they don't exist.
 * Idempotent and additive: copies missing files, never overwrites existing ones.
 */

import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, readFileSync, writeFileSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { logger } from "./utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ARCHON_HOME = resolve(homedir(), ".archon");
// One level up from src/ (dev) or dist/ (prod) — always the project root defaults/
const DEFAULTS_DIR = resolve(__dirname, "../defaults");

/**
 * Recursively copy files from src to dest, skipping files that already exist.
 */
function copyMissing(src: string, dest: string): number {
  if (!existsSync(src)) return 0;

  let copied = 0;

  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }

  for (const entry of readdirSync(src)) {
    if (entry.startsWith(".")) continue; // skip dotfiles like .version

    const srcPath = join(src, entry);
    const destPath = join(dest, entry);

    if (statSync(srcPath).isDirectory()) {
      copied += copyMissing(srcPath, destPath);
    } else if (!existsSync(destPath)) {
      copyFileSync(srcPath, destPath);
      copied++;
    }
  }

  return copied;
}

/**
 * Read a version string from a file, returning null if missing or unreadable.
 */
function readVersion(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf-8").trim();
  } catch {
    return null;
  }
}

export function ensureArchonHome(): void {
  if (!existsSync(DEFAULTS_DIR)) {
    logger.fatal({ defaultsDir: DEFAULTS_DIR }, "defaults/ directory not found — build may be incomplete");
    throw new Error(`defaults/ directory not found at ${DEFAULTS_DIR}`);
  }

  const created = !existsSync(ARCHON_HOME);
  if (created) {
    mkdirSync(ARCHON_HOME, { recursive: true });
  }

  let agentsCopied = 0;
  let methodsCopied = 0;

  try {
    // Copy default agents
    agentsCopied = copyMissing(
      join(DEFAULTS_DIR, "agents"),
      join(ARCHON_HOME, "agents")
    );

    // Copy default methodologies
    methodsCopied = copyMissing(
      join(DEFAULTS_DIR, "methodologies"),
      join(ARCHON_HOME, "methodologies")
    );
  } catch (err) {
    logger.fatal({ err }, "Failed to copy defaults to ~/.archon/ — check permissions and disk space");
    throw err;
  }

  // Version tracking: stamp ~/.archon/.version on first run; warn on mismatch
  const defaultsVersion = readVersion(join(DEFAULTS_DIR, ".version"));
  const runtimeVersion = readVersion(join(ARCHON_HOME, ".version"));

  if (defaultsVersion !== null) {
    if (runtimeVersion === null) {
      // First run — write version stamp
      writeFileSync(join(ARCHON_HOME, ".version"), defaultsVersion);
    } else if (runtimeVersion !== defaultsVersion) {
      logger.warn(
        { runtimeVersion, defaultsVersion },
        "Archon defaults version mismatch — run `archon update` to sync unmodified defaults"
      );
    }
  }

  if (created || agentsCopied > 0 || methodsCopied > 0) {
    logger.info(
      { archonHome: ARCHON_HOME, agentsCopied, methodsCopied, firstRun: created },
      "Runtime directory initialized"
    );
  }
}
