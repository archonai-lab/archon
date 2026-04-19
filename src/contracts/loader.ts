import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import { compileContractToml } from "./compiler.js";
import type { CanonicalContractSchema } from "./types.js";

export type ContractSourceKind = "runtime";

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

export function getUserContractsDir(archonHome = resolve(homedir(), ".archon")): string {
  return resolve(archonHome, "contracts");
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
  const seenIds = new Map<string, LoadedContract>();

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
        if (existing) {
          diagnostics.push({
            source: source.kind,
            filePath,
            message: `duplicate contract id "${contract.id}" already loaded from ${existing.filePath}`,
          });
          continue;
        }

        const loaded = { contract, source: source.kind, filePath };
        seenIds.set(contract.id, loaded);
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
  return loadContractsFromSources([
    {
      kind: "runtime",
      dir: getUserContractsDir(options.archonHome),
    },
  ]);
}
