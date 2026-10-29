interface ActivationWindow {
  on(event: string, listener: () => void): unknown;
  removeListener(event: string, listener: () => void): unknown;
  isDestroyed(): boolean;
  isFocused(): boolean;
  isVisible(): boolean;
  isMinimized(): boolean;
  getTitle(): string;
  moveTop(): void;
}

/** 両画面を前面に揃え、選択した画面の入力フォーカスを維持する。 */
export function linkWindowActivation(
  first: ActivationWindow,
  second: ActivationWindow,
  raisePair: (active: ActivationWindow, peer: ActivationWindow) => void = (active, peer) => {
    peer.moveTop(); active.moveTop();
  },
): () => void {
  let disposed = false;
  let raising = false;
  const raise = (active: ActivationWindow, peer: ActivationWindow) => {
    if (disposed || raising || active.isDestroyed() || peer.isDestroyed() || !active.isFocused() || !peer.isVisible() || peer.isMinimized()) return;
    raising = true;
    try {
      raisePair(active, peer);
    } finally { raising = false; }
  };
  const firstFocused = () => raise(first, second);
  const secondFocused = () => raise(second, first);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    first.removeListener("focus", firstFocused);
    second.removeListener("focus", secondFocused);
    first.removeListener("closed", dispose);
    second.removeListener("closed", dispose);
  };
  first.on("focus", firstFocused);
  second.on("focus", secondFocused);
  first.on("closed", dispose);
  second.on("closed", dispose);
  return dispose;
}
