import { useApp } from "../lib/app.tsx";
import { useT } from "../lib/i18n.ts";
import { Icon } from "../ui/Icon.tsx";

/** First run: one clear thing to do. */
export function Welcome() {
  const { openImport } = useApp();
  const t = useT();
  return (
    <div className="welcome" data-testid="welcome">
      <div className="welcome-inner">
        <p className="eyebrow">温故而知新</p>
        <h1 className="welcome-title">{t("welcome.title")}</h1>
        <p className="lede">{t("welcome.body")}</p>
        <button type="button" className="dropbox" onClick={() => openImport()}>
          <span className="dropbox-icon" aria-hidden="true">
            <Icon name="import" size={26} />
          </span>
          <span className="dropbox-title">{t("welcome.drop")}</span>
          <span className="dropbox-sub">
            {t("welcome.or")} <span className="link-like">{t("welcome.pick")}</span>
          </span>
          <span className="dropbox-types">.apkg · .colpkg</span>
        </button>
        <ul className="facts">
          <li>{t("welcome.points.local")}</li>
          <li>{t("welcome.points.history")}</li>
          <li>{t("welcome.points.export")}</li>
        </ul>
      </div>
    </div>
  );
}
