import { useState } from "react";
import { routeHash, useApp } from "../lib/app.tsx";
import { useT } from "../lib/i18n.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { Icon } from "../ui/Icon.tsx";
import { AgentSection } from "./Settings.tsx";

export function Welcome() {
  const { openImport } = useApp();
  const t = useT();
  const [setup, setSetup] = useState(false);
  const hasAgent = !!window.wenguDesktop?.agent;
  return (
    <div className="welcome" data-testid="welcome">
      <div className="welcome-inner">
        <h1 className="welcome-title">{t("welcome.title")}</h1>
        <div className="welcome-options">
          <section className="welcome-option">
            <Icon name="import" size={28} />
            <h2>{t("welcome.import")}</h2>
            <p>{t("welcome.importHint")}</p>
            <button type="button" className="btn btn-ghost" onClick={() => openImport()}>{t("welcome.pick")}</button>
          </section>
          <section className="welcome-option">
            <Icon name="edit" size={28} />
            <h2>{t("welcome.make")}</h2>
            <p>{t(hasAgent ? "welcome.agentHint" : "welcome.makeHint")}</p>
            <div className="welcome-actions">
              {hasAgent && <button type="button" className="btn btn-primary" onClick={() => setSetup(true)}>{t("welcome.connect")}</button>}
              <a className={hasAgent ? "btn btn-ghost" : "btn btn-primary"} href={routeHash({ name: "make", deckId: null })}>{t("welcome.manual")}</a>
            </div>
          </section>
        </div>
      </div>
      <Dialog open={setup} title={t("welcome.connect")} onClose={() => setSetup(false)}>
        <AgentSection />
      </Dialog>
    </div>
  );
}
