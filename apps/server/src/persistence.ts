import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createInitialState } from "./fixtures.js";
import { restoreCommands } from "./commands.js";
import type { LoadedMockState, MockState } from "./models.js";
import { isRecord } from "./models.js";
import { validateResources } from "./resource-validation.js";
import { parseEmbeds } from "./message-content.js";

function isId(value: unknown): boolean {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

function isMessageUser(value: unknown): boolean {
  return isRecord(value) && isId(value.id) && typeof value.username === "string" &&
    value.username.length > 0 && value.username.length <= 100 &&
    typeof value.discriminator === "string" && value.avatar === null && typeof value.bot === "boolean";
}

/** Old messages may omit attribution; malformed new fields must fail at startup. */
function validateMessageMetadata(messages: MockState["messages"]): void {
  for (const list of Object.values(messages)) {
    if (!Array.isArray(list)) throw new Error("Invalid saved messages");
    for (const message of list) {
      if (!isRecord(message)) throw new Error("Invalid saved message");
      message.embeds = parseEmbeds(message.embeds);
      const interaction = message.interaction;
      const metadata = message.interaction_metadata;
      if (interaction !== undefined && (!isRecord(interaction) || interaction.type !== 2 || !isId(interaction.id) ||
        typeof interaction.name !== "string" || !interaction.name || Array.from(interaction.name).length > 32 ||
        !isMessageUser(interaction.user))) throw new Error("Invalid saved command attribution");
      if (metadata !== undefined && (!isRecord(metadata) || metadata.type !== 2 || !isId(metadata.id) ||
        !isMessageUser(metadata.user) || !isRecord(metadata.authorizing_integration_owners) ||
        !Object.values(metadata.authorizing_integration_owners).every(isId))) throw new Error("Invalid saved interaction metadata");
      if ((interaction !== undefined || metadata !== undefined) && !isId(message.application_id)) {
        throw new Error("Invalid saved message application ID");
      }
    }
  }
}

export async function loadState(dataPath: string | null): Promise<LoadedMockState> {
  let state: MockState = createInitialState();

  if (dataPath) {
    try {
      // Preserve the existing state format and its basic startup validation.
      const parsed = JSON.parse(await readFile(dataPath, "utf8")) as MockState;
      if (
        !parsed?.user?.id ||
        !parsed?.guild?.id ||
        !Array.isArray(parsed.guild.channels) ||
        !parsed.messages ||
        typeof parsed.messages !== "object"
      ) {
        throw new Error("Invalid mock state");
      }
      state = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  return restoreState(state);
}

export function restoreState(input: MockState): LoadedMockState {
  const state = structuredClone(input);
  if (state.version !== undefined && state.version !== 1) throw new Error("未対応の状態 JSON バージョンです");
  validateMessageMetadata(state.messages);
  const users = state.users ?? createInitialState().users;
  const members = state.members ?? [state.user, ...users].map((user) => ({
    user, roles: [], joined_at: "2026-01-01T00:00:00.000Z", deaf: false, mute: false, flags: 0,
  }));
  const loaded: LoadedMockState = { ...state, version: 1, users, members, commands: restoreCommands(state.commands, state.guild.id) };
  validateResources(loaded);
  return loaded;
}

export async function saveState(dataPath: string | null, state: MockState): Promise<void> {
  if (!dataPath) return;

  await mkdir(dirname(dataPath), { recursive: true });
  const temporaryPath = `${dataPath}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(state, null, 2), { mode: 0o600 });
  await rename(temporaryPath, dataPath);
}
