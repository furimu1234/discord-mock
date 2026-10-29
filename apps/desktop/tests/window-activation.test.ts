import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { linkWindowActivation } from "../src/window-activation.ts";

class Desktop {
  stack: Window[] = [];
  focused: Window | undefined;
  ignoreMoveTop = false;
}
class Window extends EventEmitter {
  visible = true;
  minimized = false;
  destroyed = false;
  emitFocusOnRaise = false;
  desktop: Desktop;
  constructor(desktop: Desktop) { super(); this.desktop = desktop; desktop.stack.push(this); }
  isDestroyed() { return this.destroyed; }
  isFocused() { return this.desktop.focused === this; }
  isVisible() { return this.visible; }
  isMinimized() { return this.minimized; }
  getTitle() { return "Test window"; }
  moveTop() {
    if (!this.desktop.ignoreMoveTop) this.desktop.stack = [...this.desktop.stack.filter(window => window !== this), this];
    if (this.emitFocusOnRaise) this.emit("focus");
  }
  showInactive() { this.visible = true; }
  focus() {
    if (this.isFocused()) return;
    this.desktop.focused = this;
    this.desktop.stack = [...this.desktop.stack.filter(window => window !== this), this];
    this.emit("focus");
  }
  close() { this.destroyed = true; this.visible = false; this.emit("closed"); }
}
function fixture() {
  const desktop = new Desktop();
  const mock = new Window(desktop);
  const terminal = new Window(desktop);
  const otherApp = new Window(desktop);
  const dispose = linkWindowActivation(mock, terminal);
  otherApp.focus();
  return { desktop, mock, terminal, otherApp, dispose };
}

for (const selected of ["mock", "terminal"] as const) {
  test(`${selected}を選ぶと両画面が手前になり、入力フォーカスは選んだ画面に残る`, () => {
    const { desktop, mock, terminal, otherApp } = fixture();
    const active = selected === "mock" ? mock : terminal;
    const peer = selected === "mock" ? terminal : mock;
    active.focus();
    assert.deepEqual(desktop.stack, [otherApp, peer, active]);
    assert.equal(desktop.focused, active);
    assert.equal(peer.visible, true);
    // 他アプリを選んだ後は、そのアプリを前面で使える。
    otherApp.focus();
    assert.equal(desktop.stack.at(-1), otherApp);
    assert.equal(desktop.focused, otherApp);
  });
}

test("前面化でフォーカスイベントが再入しても画面間でフォーカスを往復しない", () => {
  const { desktop, mock, terminal } = fixture();
  mock.emitFocusOnRaise = true;
  terminal.emitFocusOnRaise = true;
  mock.focus();
  assert.equal(desktop.focused, mock);
  assert.deepEqual(desktop.stack.slice(-2), [terminal, mock]);
});

test("最小化・非表示にした相手の状態を維持する", () => {
  const { desktop, mock, terminal, otherApp } = fixture();
  terminal.visible = false;
  mock.focus();
  assert.equal(terminal.visible, false);
  assert.equal(desktop.focused, mock);
  assert.deepEqual(desktop.stack, [terminal, otherApp, mock]);
});

test("OSがvisibleを返す最小化画面も前面化しない", () => {
  const { desktop, mock, terminal, otherApp } = fixture();
  terminal.minimized = true;
  mock.focus();
  assert.equal(terminal.minimized, true);
  assert.deepEqual(desktop.stack, [terminal, otherApp, mock]);
});

test("相手をユーザーが復帰して選んだら、その画面の選択を維持する", () => {
  const { desktop, mock, terminal } = fixture();
  terminal.visible = false;
  mock.focus();
  terminal.visible = true;
  terminal.focus();
  assert.equal(desktop.focused, terminal);
  assert.deepEqual(desktop.stack.slice(-2), [mock, terminal]);
});

test("他アプリへ切り替えた後の画面選択も奪わない", () => {
  const { desktop, mock, terminal, otherApp } = fixture();
  terminal.visible = false;
  mock.focus();
  otherApp.focus();
  terminal.visible = true;
  terminal.focus();
  assert.equal(desktop.focused, terminal);
  assert.deepEqual(desktop.stack.slice(-2), [mock, terminal]);
  mock.focus();
  assert.equal(desktop.focused, mock);
  assert.deepEqual(desktop.stack.slice(-2), [terminal, mock]);
});

test("閉じた相手を再表示せず、残った画面を通常どおり使える", () => {
  const { desktop, mock, terminal } = fixture();
  terminal.close();
  mock.focus();
  assert.equal(terminal.visible, false);
  assert.equal(desktop.focused, mock);
  assert.equal(mock.listenerCount("focus"), 0);
});

test("終了処理で連動を解除すると片方だけが前面になる", () => {
  const { desktop, mock, terminal, otherApp, dispose } = fixture();
  dispose(); dispose();
  mock.focus();
  assert.deepEqual(desktop.stack, [terminal, otherApp, mock]);
  assert.equal(mock.listenerCount("focus"), 0);
  assert.equal(terminal.listenerCount("focus"), 0);
  assert.equal(mock.listenerCount("closed"), 0);
  assert.equal(terminal.listenerCount("closed"), 0);
});

test("WSLgがmoveTopを無視する場合はホスト用の配置処理で2画面を揃える", () => {
  const desktop = new Desktop();
  desktop.ignoreMoveTop = true;
  const mock = new Window(desktop);
  const terminal = new Window(desktop);
  const otherApp = new Window(desktop);
  const dispose = linkWindowActivation(mock, terminal, (active, peer) => {
    desktop.stack = [...desktop.stack.filter(window => window !== active && window !== peer), peer as Window, active as Window];
  });
  otherApp.focus(); mock.focus();
  assert.deepEqual(desktop.stack, [otherApp, terminal, mock]);
  assert.equal(desktop.focused, mock);
  otherApp.focus(); terminal.focus();
  assert.deepEqual(desktop.stack, [otherApp, mock, terminal]);
  assert.equal(desktop.focused, terminal);
  dispose();
});
