import type { BrowserMessage } from "./types.js";
import { createElement } from "./dom.js";

export function renderMessage(message: BrowserMessage): HTMLElement {
  const item = createElement("article", "message");
  const initial = (message.author.username || "?").slice(0, 1).toUpperCase();
  const avatarClass = message.author.bot ? "avatar bot" : "avatar";
  const avatar = createElement("div", avatarClass, initial);
  const body = createElement("div", "message-body");
  const meta = createElement("div", "meta");

  meta.append(createElement("strong", "", message.author.username));
  if (message.author.bot) meta.append(createElement("span", "badge", "BOT"));
  const time = new Date(message.timestamp).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });
  meta.append(createElement("time", "", time));
  body.append(meta, createElement("div", "content", message.content));
  for (const embed of message.embeds ?? []) {
    const card = createElement("section", "message-embed");
    if (embed.color !== undefined)
      card.style.borderLeftColor = `#${embed.color.toString(16).padStart(6, "0")}`;
    if (embed.title)
      card.append(createElement("h3", "embed-title", embed.title));
    if (embed.description)
      card.append(createElement("p", "embed-description", embed.description));
    if (embed.fields?.length) {
      const fields = createElement("div", "embed-fields");
      for (const field of embed.fields) {
        const item = createElement(
          "div",
          field.inline ? "embed-field inline" : "embed-field",
        );
        item.append(
          createElement("strong", "", field.name),
          createElement("div", "", field.value),
        );
        fields.append(item);
      }
      card.append(fields);
    }
    if (embed.footer)
      card.append(createElement("p", "embed-footer", embed.footer.text));
    body.append(card);
  }
  if (message.interaction?.type === 2) {
    const invocation = createElement("div", "command-invocation");
    const user = message.interaction.user;
    invocation.append(
      createElement(
        "span",
        "invocation-avatar",
        user.username.slice(0, 1).toUpperCase(),
      ),
    );
    invocation.append(
      createElement("strong", "invocation-user", user.username),
    );
    invocation.append(createElement("span", "", "さんが"));
    invocation.append(
      createElement(
        "span",
        "invocation-command",
        `/${message.interaction.name}`,
      ),
    );
    invocation.append(createElement("span", "", "を使用しました"));
    item.classList.toggle("has-invocation", true);
    item.append(invocation);
  }
  item.append(avatar, body);
  return item;
}
