/**
 * Hook for the desktop shell (apps/desktop). Its preload script exposes `window.wenguDesktop` to the app's own page;
 * in a browser it does not exist and nothing here does anything.
 *
 * The shell sends commands from its native menu and from the OS (a `.apkg` opened with the app, dropped on its icon or
 * passed on the command line). The shell reads the file itself (native open dialog) and sends its bytes.
 */
import { useEffect } from "react";

export type DesktopCommand = { type: "import"; file?: { name: string; bytes: Uint8Array } } | { type: "export" };

export interface WenguDesktop {
  readonly platform: string;
  /** Subscribes to shell commands (and tells the shell the app is ready for them); returns an unsubscribe function. */
  onCommand(cb: (command: DesktopCommand) => void): () => void;
}

declare global {
  interface Window {
    wenguDesktop?: WenguDesktop;
  }
}

export function useDesktopCommands(onImport: (file?: File) => void, onExport: () => void): void {
  useEffect(() => {
    const desktop = window.wenguDesktop;
    if (!desktop) return;
    return desktop.onCommand((c) => {
      if (c.type === "import") onImport(c.file ? new File([c.file.bytes as BlobPart], c.file.name) : undefined);
      else if (c.type === "export") onExport();
    });
  }, [onImport, onExport]);
}
