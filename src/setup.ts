/**
 * First-run setup — copies defaults to ~/.archon/ if they don't exist.
 * Idempotent and additive: copies missing files, never overwrites existing ones.
 */

import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { logger } from "./utils/logger.js";

const ARCHON_HOME = resolve(homedir(), ".archon");
const DEFAULTS_DIR = resolve(process.cwd(), "defaults");

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

export function ensureArchonHome(): void {
  if (!existsSync(DEFAULTS_DIR)) {
    logger.debug("No defaults/ directory found, skipping setup");
    return;
  }

  const created = !existsSync(ARCHON_HOME);
  if (created) {
    mkdirSync(ARCHON_HOME, { recursive: true });
  }

  // Copy default agents
  const agentsCopied = copyMissing(
    join(DEFAULTS_DIR, "agents"),
    join(ARCHON_HOME, "agents")
  );

  // Copy default methodologies
  const methodsCopied = copyMissing(
    join(DEFAULTS_DIR, "methodologies"),
    join(ARCHON_HOME, "methodologies")
  );

  if (created || agentsCopied > 0 || methodsCopied > 0) {
    logger.info(
      { archonHome: ARCHON_HOME, agentsCopied, methodsCopied, firstRun: created },
      "Runtime directory initialized"
    );
  }
}
