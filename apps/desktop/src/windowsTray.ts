import type { BrowserWindow, Menu, MenuItemConstructorOptions, MessageBoxOptions, MessageBoxReturnValue, Tray } from 'electron';

type TrayOptions = {
  createTray: () => Tray;
  buildMenu: (items: MenuItemConstructorOptions[]) => Menu;
  getWindow: () => BrowserWindow | null;
  restoreWindow: () => Promise<void>;
  isQuitting: () => boolean;
  isChinese: () => boolean;
  showDialog: (owner: BrowserWindow, options: MessageBoxOptions) => Promise<MessageBoxReturnValue>;
  quit: () => void;
  reportError: (error: unknown) => void;
};

/** Windows-only. Keep the Tray referenced for the entire background lifetime. */
export function createWindowsTray(options: TrayOptions) {
  let tray: Tray | null = null;
  let confirming = false;
  let disposed = false;
  const available = () => tray !== null && !tray.isDestroyed();

  async function open() {
    if (disposed || options.isQuitting()) return;
    try { await options.restoreWindow(); }
    catch (error) { options.reportError(error); }
  }

  async function requestQuit() {
    if (disposed || confirming || options.isQuitting()) return;
    confirming = true;
    try {
      // The native dialog is owned by the restored main window, so it remains
      // reachable even when the renderer is unresponsive or was hidden.
      await options.restoreWindow();
      const owner = options.getWindow();
      if (!owner || owner.isDestroyed() || options.isQuitting() || disposed) return;
      const zh = options.isChinese();
      const { response } = await options.showDialog(owner, {
        type: 'question', title: 'PilotDeck',
        message: zh ? '是否要退出 PilotDeck？' : 'Quit PilotDeck?',
        detail: zh
          ? '退出后，后台服务和正在运行的任务将停止。关闭主窗口可以继续在后台运行。'
          : 'Quitting stops background services and running tasks. Close the main window to keep running in the background.',
        buttons: zh ? ['取消', '退出程序'] : ['Cancel', 'Quit'],
        defaultId: 0, cancelId: 0, noLink: true,
      });
      if (response === 1 && !options.isQuitting() && !disposed) options.quit();
    } catch (error) {
      options.reportError(error);
    } finally {
      confirming = false;
    }
  }

  function refreshMenu() {
    if (!available()) return;
    const zh = options.isChinese();
    tray!.setContextMenu(options.buildMenu([
      { label: zh ? '打开主界面' : 'Open main window', click: () => { void open(); } },
      { type: 'separator' },
      { label: zh ? '退出程序' : 'Quit', click: () => { void requestQuit(); } },
    ]));
  }

  function dispose() {
    disposed = true;
    if (available()) tray!.destroy();
    tray = null;
  }

  try {
    tray = options.createTray();
    tray.setToolTip('PilotDeck');
    tray.on('click', () => { void open(); });
    tray.on('double-click', () => { void open(); });
    refreshMenu();
  } catch (error) {
    // Never hide the only window when the notification icon could not be made.
    if (available()) tray!.destroy();
    tray = null;
    options.reportError(error);
  }

  return {
    available, open, requestQuit, refreshMenu, dispose,
    attachWindow(window: BrowserWindow) {
      window.on('close', event => {
        if (options.isQuitting() || !available()) return;
        event.preventDefault();
        // Do not hide the parent out from under an outstanding quit dialog.
        if (!confirming) window.hide();
      });
    },
  };
}
