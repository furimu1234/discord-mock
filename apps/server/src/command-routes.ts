import { CommandValidationError, parseCommand, parseCommandList } from "./commands.js";
import type { MockEnvironment } from "./environment.js";
import { APPLICATION_ID } from "./fixtures.js";
import { readJsonValue, sendJson, type RouteContext } from "./http.js";

export async function handleCommandRoute(context: RouteContext, environment: MockEnvironment): Promise<void> {
  const { request, response, method, path } = context;
  const route = /^\/applications\/(\d+)(?:\/guilds\/(\d+))?\/commands$/.exec(path);
  if (!route) {
    sendJson(response, 404, { message: "Unknown command route", code: 10063 });
    return;
  }
  const [, applicationId, guildId] = route;
  if (applicationId !== APPLICATION_ID) {
    sendJson(response, 404, { message: "Unknown Application", code: 10002 });
    return;
  }
  if (guildId && guildId !== environment.state.guild.id) {
    sendJson(response, 404, { message: "Unknown Guild", code: 10004 });
    return;
  }
  if (method === "GET") {
    sendJson(response, 200, environment.commandsForScope(guildId));
    return;
  }
  if (method !== "PUT" && method !== "POST") {
    sendJson(response, 404, { message: "Command route not implemented", code: 0 });
    return;
  }
  try {
    const body = await readJsonValue(request);
    if (method === "PUT") {
      const commands = await environment.registerCommands(parseCommandList(body), guildId);
      sendJson(response, 200, commands);
    } else {
      const input = parseCommand(body);
      const exists = environment.commandsForScope(guildId).some((command) => command.name === input.name);
      const commands = await environment.registerCommands([input], guildId, false);
      sendJson(response, exists ? 200 : 201, commands[0]);
    }
  } catch (error) {
    if (!(error instanceof CommandValidationError)) throw error;
    sendJson(response, 400, { message: error.message, code: 50035 });
  }
}
