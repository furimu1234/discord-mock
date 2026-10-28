import type { MockEnvironment } from "./environment.js";
import { APPLICATION_ID } from "./fixtures.js";
import { readJsonBody, sendError, sendJson, type RouteContext } from "./http.js";
import { isRecord } from "./models.js";
import { handleCommandRoute } from "./command-routes.js";
import { parseMessageContent } from "./message-content.js";
import { readCreateMessage } from "./message-upload.js";

async function handleInteractionCallback(
  { request, response, url }: RouteContext,
  environment: MockEnvironment,
  interactionId: string,
  interactionToken: string,
): Promise<void> {
  const interaction = environment.interactions.get(interactionId);
  if (!interaction || interaction.token !== interactionToken) {
    sendError(response, 404, "Unknown interaction");
    return;
  }

  const reply = await readJsonBody(request);
  if (typeof reply.type !== "number" || !Number.isInteger(reply.type) || ![4, 5, 6, 7, 9].includes(reply.type)) {
    sendError(response, 400, "Unsupported interaction response type");
    return;
  }

  const data = isRecord(reply.data) ? reply.data : undefined;
  const flags = data?.flags;
  if (flags !== undefined && (typeof flags !== "number" || !Number.isSafeInteger(flags) || flags < 0 || (flags & 64) !== 0)) {
    sendError(response, 400, "Ephemeral or invalid response flags are not supported");
    return;
  }
  // Claim the initial response synchronously before saving or dispatching a message.
  // Multiple SDK connections can otherwise acknowledge the same interaction at once.
  if (interaction.response !== undefined) {
    sendJson(response, 400, { message: "Interaction has already been acknowledged", code: 40060 });
    return;
  }
  const message = reply.type === 4 ? parseMessageContent(data) : undefined;
  interaction.response = reply;
  if (message && interaction.channelId) {
    await environment.postMessage(interaction.channelId, message, environment.state.user, interaction.command);
  }

  if (url.searchParams.get("with_response") === "true") {
    sendJson(response, 200, {
      interaction: { id: interactionId, type: reply.type, response_message_id: null },
      resource: null,
    });
  } else {
    response.writeHead(204, { "cache-control": "no-store" });
    response.end();
  }
}

export async function handleRestRoute(
  context: RouteContext,
  environment: MockEnvironment,
  token: string,
  gatewayUrl: string,
): Promise<void> {
  const { request, response, method, path } = context;
  const attachment = path.match(/^\/mock-attachments\/(\d+)$/);
  if (method === "GET" && attachment) {
    const file = environment.uploadedFile(attachment[1]);
    if (!file) {
      sendError(response, 404, "Unknown Attachment");
      return;
    }
    response.writeHead(200, {
      "content-type": file.contentType,
      "content-length": String(file.bytes.length),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    response.end(file.bytes);
    return;
  }
  const callback = path.match(/^\/interactions\/(\d+)\/([^/]+)\/callback$/);

  // SDK callbacks omit Bot authorization and authenticate using the URL token.
  if (request.headers.authorization !== `Bot ${token}` && !(method === "POST" && callback)) {
    sendError(response, 401, "Use the synthetic token printed by discord-mock");
    return;
  }
  if (method === "POST" && callback) {
    await handleInteractionCallback(context, environment, callback[1], callback[2]);
    return;
  }
  if (/^\/applications\/\d+(?:\/guilds\/\d+)?\/commands$/.test(path)) {
    await handleCommandRoute(context, environment);
    return;
  }

  const { state } = environment;
  if (method === "GET") {
    switch (path) {
      case "/gateway":
        sendJson(response, 200, { url: gatewayUrl });
        return;
      case "/gateway/bot":
        sendJson(response, 200, {
          url: gatewayUrl,
          shards: 1,
          session_start_limit: {
            total: 1000,
            remaining: 1000,
            reset_after: 86_400_000,
            max_concurrency: 1,
          },
        });
        return;
      case "/users/@me":
        sendJson(response, 200, state.user);
        return;
      case "/oauth2/applications/@me":
        sendJson(response, 200, {
          id: APPLICATION_ID,
          name: "MockBot",
          bot: state.user,
          icon: null,
          owner: state.users[0],
          team: null,
          rpc_origins: [],
          bot_public: true,
          bot_require_code_grant: false,
          verify_key: "0".repeat(64),
          flags: 0,
          description: "",
        });
        return;
      case "/users/@me/guilds":
        sendJson(response, 200, [state.guild]);
        return;
      case `/guilds/${state.guild.id}`:
        sendJson(response, 200, environment.guildPayload());
        return;
      case `/guilds/${state.guild.id}/channels`:
        sendJson(response, 200, state.guild.channels);
        return;
    }

    const channelPath = path.match(/^\/channels\/(\d+)$/);
    if (channelPath) {
      const channel = state.guild.channels.find((channel) => channel.id === channelPath[1]);
      if (channel) sendJson(response, 200, channel);
      else sendError(response, 404, "Unknown Channel");
      return;
    }
  }

  const singleMessagePath = path.match(/^\/channels\/(\d+)\/messages\/(\d+)$/);
  if (method === "GET" && singleMessagePath) {
    const channelId = singleMessagePath[1];
    const messageId = singleMessagePath[2];
    const message = state.messages[channelId]?.find((item) => item.id === messageId);
    if (message) sendJson(response, 200, message);
    else sendError(response, 404, "Unknown Message");
    return;
  }

  const messagesPath = path.match(/^\/channels\/(\d+)\/messages$/);
  const channelId = messagesPath?.[1];
  if (channelId && state.guild.channels.some((channel) => channel.id === channelId)) {
    if (method === "GET") {
      sendJson(response, 200, [...(state.messages[channelId] ?? [])].reverse());
      return;
    }
    if (method === "POST") {
      const body = await readCreateMessage(request, environment);
      const message = await environment.postMessage(channelId, body, state.user);
      sendJson(response, 200, message);
      return;
    }
  }

  sendError(response, 404, "Not implemented in discord-mock");
}
