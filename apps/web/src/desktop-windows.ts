import { createElement, getElement } from "./dom.js";
import type { WindowId, WindowLayoutSettings } from "../../desktop/src/window-types.js";

export interface WindowSettingsBridge {
  windowSettings(): Promise<WindowLayoutSettings>;
  saveWindowSettings(value: Record<WindowId, string>): Promise<WindowLayoutSettings>;
  moveWindow(id: WindowId, display: string): Promise<void>;
}

export async function initializeWindowSettings(bridge: WindowSettingsBridge): Promise<void> {
  const section = getElement("desktop-window-settings", "section");
  const selects = { mock: getElement("window-mock-display", "select"), terminal: getElement("window-terminal-display", "select") };
  const moves = { mock: getElement("window-mock-move", "button"), terminal: getElement("window-terminal-move", "button") };
  const save = getElement("window-settings-save", "button");
  const refresh = getElement("window-settings-refresh", "button");
  const status = getElement("window-settings-status", "p");
  const note = getElement("window-position-note", "p");
  let supported = true;
  section.classList.remove("hidden");
  const busy = (value: boolean) => {
    save.disabled = refresh.disabled = value;
    for (const id of ["mock", "terminal"] as const) { selects[id].disabled = value; moves[id].disabled = value || !supported; }
  };
  const render = (settings: WindowLayoutSettings) => {
    supported = settings.positionSupported;
    note.textContent = supported
      ? "位置・サイズ・最大化状態をディスプレイごとに自動保存します。未接続の起動先は、利用可能なディスプレイへ切り替えます。"
      : "Waylandでは位置の指定・復元ができません。X11で起動すると、ディスプレイごとの位置を保存できます。";
    for (const id of ["mock", "terminal"] as const) {
      const select = selects[id];
      const selected = settings.windows[id].startupDisplay;
      const options: Array<[string, string]> = [["last", "最後に使ったディスプレイ"], ["primary", "メインディスプレイ"]];
      for (const display of settings.displays)
        options.push([display.id, `${display.label}${display.primary ? "（メイン）" : ""} · ${display.workArea.width} × ${display.workArea.height}`]);
      if (!options.some(([value]) => value === selected)) options.push([selected, `未接続のディスプレイ (${selected})`]);
      select.replaceChildren(...options.map(([value, text]) => { const option = createElement("option", "", text); option.value = value; return option; }));
      select.value = selected;
    }
  };
  const run = async (action: () => Promise<void>) => {
    busy(true); status.textContent = "";
    try { await action(); }
    catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
    finally { busy(false); }
  };
  save.onclick = () => void run(async () => {
    render(await bridge.saveWindowSettings({ mock: selects.mock.value, terminal: selects.terminal.value }));
    status.textContent = "起動先を保存しました。次回起動時に反映します。";
  });
  refresh.onclick = () => void run(async () => { render(await bridge.windowSettings()); status.textContent = "ディスプレイ一覧を更新しました。"; });
  for (const id of ["mock", "terminal"] as const) moves[id].onclick = () => void run(async () => {
    await bridge.moveWindow(id, selects[id].value);
    status.textContent = `${id === "mock" ? "Mock画面" : "ターミナル"}を移動しました。`;
  });
  await run(async () => render(await bridge.windowSettings()));
}
