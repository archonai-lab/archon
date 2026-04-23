import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { compileContractToml } from "./compiler.js";
import type { CanonicalContractSchema } from "./types.js";
import { getArchonHome } from "../setup.js";

const contractsDir = dirname(fileURLToPath(import.meta.url));

export type ContractSourceKind = "runtime" | "default";

export interface ContractLoadSource {
  kind: ContractSourceKind;
  dir: string;
  required?: boolean;
}

export interface LoadedContract {
  contract: CanonicalContractSchema;
  source: ContractSourceKind;
  filePath: string;
}

export interface ContractLoadDiagnostic {
  source: ContractSourceKind;
  filePath?: string;
  message: string;
}

export interface ContractLoadResult {
  contracts: LoadedContract[];
  diagnostics: ContractLoadDiagnostic[];
}

export function getUserContractsDir(archonHome = getArchonHome()): string {
  return resolve(archonHome, "contracts");
}

export function getDefaultContractsDir(): string {
  return resolve(contractsDir, "..", "..", "defaults", "contracts");
}

function listTomlFiles(dir: string): string[] {
  return readdirSync(dir)
    .map((entry) => join(dir, entry))
    .filter((entryPath) => statSync(entryPath).isFile())
    .filter((entryPath) => entryPath.endsWith(".toml"))
    .sort();
}

export function loadContractsFromSources(sources: ContractLoadSource[]): ContractLoadResult {
  const contracts: LoadedContract[] = [];
  const diagnostics: ContractLoadDiagnostic[] = [];
  const seenIds = new Map<string, { loaded: LoadedContract; index: number }>();

  for (const source of sources) {
    if (!existsSync(source.dir)) {
      if (source.required) {
        diagnostics.push({
          source: source.kind,
          message: `contracts directory not found: ${source.dir}`,
        });
      }
      continue;
    }

    for (const filePath of listTomlFiles(source.dir)) {
      try {
        const contract = compileContractToml(readFileSync(filePath, "utf-8"));
        const existing = seenIds.get(contract.id);
        if (existing && existing.loaded.source === source.kind) {
          diagnostics.push({
            source: source.kind,
            filePath,
            message: `duplicate contract id "${contract.id}" already loaded from ${existing.loaded.filePath}`,
          });
          continue;
        }

        const loaded = { contract, source: source.kind, filePath };
        if (existing) {
          // Precedence is per contract id: a runtime override replaces only the
          // matching built-in contract and leaves unrelated defaults intact.
          contracts[existing.index] = loaded;
          seenIds.set(contract.id, { loaded, index: existing.index });
          continue;
        }

        seenIds.set(contract.id, { loaded, index: contracts.length });
        contracts.push(loaded);
      } catch (error) {
        diagnostics.push({
          source: source.kind,
          filePath,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return { contracts, diagnostics };
}

export function loadContracts(options: {
  archonHome?: string;
} = {}): ContractLoadResult {
  const runtimeDir = getUserContractsDir(options.archonHome);
  return loadContractsFromSources([
    {
      kind: "default",
      dir: getDefaultContractsDir(),
      required: true,
    },
    {
      kind: "runtime",
      dir: runtimeDir,
    },
  ]);
}
