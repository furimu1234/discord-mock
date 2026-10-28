import { Collection } from "discord.js";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  commandExecute,
  SlashCommandDefinition,
  slashCommands,
} from "../types.js";

export const commandsCollection = new Collection<string, commandExecute>();

export interface CommandIssue {
  file: string;
  reason:
    | "directory"
    | "import"
    | "exports"
    | "definition"
    | "duplicate"
    | "limit"
    | "register";
}

export interface LoadCommandsOptions {
  directory?: URL;
  register?: (definition: SlashCommandDefinition) => Promise<void>;
  onError?: (issue: CommandIssue) => void;
}

interface CommandModule {
  data: { toJSON(): unknown };
  execute: commandExecute;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCommand(value: unknown): value is CommandModule {
  return (
    isRecord(value) &&
    isRecord(value.data) &&
    typeof value.data.toJSON === "function" &&
    typeof value.execute === "function"
  );
}

function isDefinition(value: unknown): value is slashCommands[number] {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    !!value.name &&
    typeof value.description === "string" &&
    !!value.description &&
    (value.type === undefined || value.type === 1)
  );
}

async function commandFiles(
  directory: string,
  report: (issue: CommandIssue) => void,
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    report({ file: directory, reason: "directory" });
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const file = join(directory, entry.name);
    // 自動検出は実ファイルのみ。シンボリックリンク先の追加走査は行わない。
    if (
      entry.isDirectory() &&
      !entry.name.startsWith(".") &&
      entry.name !== "node_modules"
    ) {
      files.push(...(await commandFiles(file, report)));
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push(file);
    }
  }
  return files;
}

/** 起動ごとに TS を自動検出する。ファイル単位で検証し、失敗しても後続へ進む。 */
export async function loadCommands(
  options: LoadCommandsOptions = {},
): Promise<slashCommands> {
  commandsCollection.clear();
  const report =
    options.onError ??
    ((issue) =>
      console.warn("コマンドをスキップしました", JSON.stringify(issue)));
  const directory = fileURLToPath(
    options.directory ?? new URL("./", import.meta.url),
  );
  const ownFile = resolve(fileURLToPath(import.meta.url));
  const definitions: slashCommands = [];
  for (const file of (await commandFiles(directory, report)).sort()) {
    if (resolve(file) === ownFile) continue;
    let reason: CommandIssue["reason"] = "import";
    try {
      const command: unknown = await import(pathToFileURL(file).href);
      reason = "exports";
      if (!isCommand(command)) throw new Error();
      reason = "definition";
      const definition = await command.data.toJSON();
      if (!isDefinition(definition)) throw new Error();
      reason = "duplicate";
      if (commandsCollection.has(definition.name)) throw new Error();
      reason = "limit";
      if (definitions.length >= 100) throw new Error();
      reason = "register";
      await options.register?.(definition);
      commandsCollection.set(definition.name, command.execute);
      definitions.push(definition);
    } catch {
      // 例外の本文・スタックには TS ソースや認証情報が含まれ得るため、段階だけを記録する。
      report({ file, reason });
    }
  }
  return definitions;
}
