import type { MockEnvironment } from "./environment.js";
import { createUser, DEFAULT_CHANNEL_ID, DEFAULT_USER_ID } from "./fixtures.js";
import { readJsonBody, sendError, sendJson, type RouteContext } from "./http.js";

export async function handleAdminRoute(
  { request, response, method, path }: RouteContext,
  environment: MockEnvironment,
  adminSecret: string,
): Promise<void> {
  const resultPath = path.match(/^\/_mock\/interactions\/(\d+)$/);
  const isKnownRoute =
    (method === "GET" && (path === "/_mock/state" || resultPath)) ||
    (method === "POST" && ["/_mock/dispatch", "/_mock/interaction"].includes(path));

  if (!isKnownRoute) {
    sendError(response, 404, "Unknown mock route");
    return;
  }
  if (request.headers["x-discord-mock-secret"] !== adminSecret) {
    sendError(response, 403, "Invalid mock admin secret");
    return;
  }
  if (path === "/_mock/state") {
    sendJson(response, 200, environment.state);
    return;
  }
  if (resultPath) {
    const interaction = environment.interactions.get(resultPath[1]);
    if (!interaction) {
      sendError(response, 404, "Unknown interaction");
      return;
    }
    sendJson(response, 200, {
      replied: !!interaction.response,
      response: interaction.response ?? null,
    });
    return;
  }

  const body = await readJsonBody(request);
  if (path === "/_mock/dispatch") {
    if (typeof body.event !== "string" || !/^[A-Z_]{1,80}$/.test(body.event)) {
      sendError(response, 400, "Invalid event");
      return;
    }
    environment.dispatch(body.event, body.data ?? {});
    sendJson(response, 200, { dispatched: body.event });
    return;
  }

  const userId = typeof body.user_id === "string" && /^\d{17,20}$/.test(body.user_id)
    ? body.user_id
    : DEFAULT_USER_ID;
  const channelId = typeof body.channel_id === "string" &&
    environment.state.guild.channels.some((channel) => channel.id === body.channel_id)
    ? body.channel_id
    : DEFAULT_CHANNEL_ID;
  const customId = typeof body.custom_id === "string" ? body.custom_id : undefined;
  const commandName = typeof body.name === "string" && /^[\w-]{1,32}$/.test(body.name)
    ? body.name
    : "mock";

  if (customId && customId.length > 100) {
    sendError(response, 400, "Invalid custom ID");
    return;
  }
  const interaction = environment.createInteraction({
    actor: createUser(userId, "MockUser"),
    channelId,
    commandName,
    customId,
  });
  sendJson(response, 200, { id: interaction.id, data: interaction });
}
