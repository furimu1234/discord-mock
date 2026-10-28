/** 再接続中の SDK が待機し続けても、CLI の終了とロック解放を完了させる。 */
export async function shutdownBot(
  close: () => Promise<void>,
  release: () => Promise<void>,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(close),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 3000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    await release();
  }
}
