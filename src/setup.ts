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

// One level up from src/ (dev) or dist/ (prod) — always the project root defaults/
const DEFAULTS_DIR = resolve(__dirname, "../defaults");

export function getArchonHome(): string {
  return resolve(homedir(), ".archon");
}

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

  const archonHome = getArchonHome();

  const created = !existsSync(archonHome);
  if (created) {
    mkdirSync(archonHome, { recursive: true });
  }

  let agentsCopied = 0;
  let methodsCopied = 0;
  let contractsCopied = 0;

  try {
    // Copy default agents
    agentsCopied = copyMissing(
      join(DEFAULTS_DIR, "agents"),
      join(archonHome, "agents")
    );

    // Copy default methodologies
    methodsCopied = copyMissing(
      join(DEFAULTS_DIR, "methodologies"),
      join(archonHome, "methodologies")
    );

    contractsCopied = copyMissing(
      join(DEFAULTS_DIR, "contracts"),
      join(archonHome, "contracts")
    );
  } catch (err) {
    logger.fatal({ err }, "Failed to copy defaults to ~/.archon/ — check permissions and disk space");
    throw err;
  }

  // Version tracking: stamp ~/.archon/.version on first run; warn on mismatch
  const defaultsVersion = readVersion(join(DEFAULTS_DIR, ".version"));
  const runtimeVersion = readVersion(join(archonHome, ".version"));

  if (defaultsVersion !== null) {
    if (runtimeVersion === null) {
      // First run — write version stamp
      writeFileSync(join(archonHome, ".version"), defaultsVersion);
    } else if (runtimeVersion !== defaultsVersion) {
      logger.warn(
        { runtimeVersion, defaultsVersion },
        "Archon defaults version mismatch — defaults are seeded once; manually compare ~/.archon defaults with package defaults before copying updates"
      );
    }
  }

  if (created || agentsCopied > 0 || methodsCopied > 0 || contractsCopied > 0) {
    logger.info(
      { archonHome, agentsCopied, methodsCopied, contractsCopied, firstRun: created },
      "Runtime directory initialized"
    );
  }
}
