export function getElement<Tag extends keyof HTMLElementTagNameMap>(id: string, tag: Tag): HTMLElementTagNameMap[Tag] {
  const element = document.getElementById(id);
  if (!element || element.tagName.toLowerCase() !== tag) throw new Error(`Expected <${tag}> with id="${id}"`);
  return element as HTMLElementTagNameMap[Tag];
}

export function createElement<Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  className = "",
  text?: string,
): HTMLElementTagNameMap[Tag] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
