import { useEffect, useLayoutEffect, useRef } from "react";

import { useT } from "../lib/i18n.ts";
import { useIsDark } from "../lib/settings.ts";
import { dark, frameVars, light } from "../lib/theme.ts";
import { FrameController } from "./frameController.ts";

/** The sandboxed card iframe. The controller lives as long as the component. */
export function CardFrame(props: { onController(c: FrameController | null): void; className?: string; testId?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const ctl = useRef<FrameController | null>(null);
  const isDark = useIsDark();
  const t = useT();
  const { onController } = props;

  useLayoutEffect(() => {
    const c = new FrameController(ref.current!);
    ctl.current = c;
    onController(c);
    return () => {
      c.dispose();
      ctl.current = null;
      onController(null);
    };
  }, [onController]);

  useEffect(() => {
    ctl.current?.setTheme({ dark: isDark, vars: frameVars(isDark ? dark : light) });
  }, [isDark]);

  return (
    <iframe
      ref={ref}
      className={`card-frame ${props.className ?? ""}`}
      title={t("editor.preview")}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      allow="camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'; usb 'none'; clipboard-read 'none'; clipboard-write 'none'"
      data-testid={props.testId ?? "card-frame"}
    />
  );
}
