import { agentTag } from "../agent/run.ts";
import { reasonText } from "../card/prepare.ts";
import { agentName, forgetAgents, useAgents } from "../lib/agents.ts";
import { useApp } from "../lib/app.tsx";
import { formatDateTime, formatNumber } from "../lib/format.ts";
import { useLang, useT } from "../lib/i18n.ts";
import { updateSettings, useSettings, type LangPref, type NoteTypeMode, type ThemePref } from "../lib/settings.ts";
import { Icon } from "../ui/Icon.tsx";
import { PageHead } from "../ui/PageHead.tsx";

function Segmented<T extends string>(props: { label: string; value: T; options: { value: T; label: string }[]; onChange(v: T): void; testId?: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={props.label} data-testid={props.testId}>
      {props.options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={props.value === o.value} className={props.value === o.value ? "is-on" : ""} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** One setting: its name and a line of explanation on the left, the control on the right. */
function Row(props: { label: string; hint?: string; children?: React.ReactNode; testId?: string }) {
  return (
    <div className="set-row" data-testid={props.testId}>
      <div className="set-text">
        <span className="set-name">{props.label}</span>
        {props.hint && <span className="set-hint">{props.hint}</span>}
      </div>
      {props.children && <div className="set-control">{props.children}</div>}
    </div>
  );
}

/** An on/off setting: a checkbox drawn as a switch. */
export function Switch(props: { label: string; checked: boolean; onChange(v: boolean): void; testId?: string }) {
  return (
    <input type="checkbox" role="switch" className="switch" aria-label={props.label} checked={props.checked} data-testid={props.testId} onChange={(e) => props.onChange(e.target.checked)} />
  );
}

export function Settings() {
  const s = useSettings();
  const t = useT();
  const lang = useLang();
  const { noteTypes, analysis, info, openImport, openExport } = useApp();
  const n = (v: number) => formatNumber(v, lang);

  return (
    <div className="page page-settings">
      <PageHead title={t("settings.title")} />

      <section className="set-section">
        <h2 className="section-title">{t("settings.appearance")}</h2>
        <Row label={t("settings.theme")}>
          <Segmented<ThemePref>
            label={t("settings.theme")}
            value={s.theme}
            testId="theme-setting"
            onChange={(theme) => updateSettings({ theme })}
            options={[
              { value: "system", label: t("settings.theme.system") },
              { value: "light", label: t("settings.theme.light") },
              { value: "dark", label: t("settings.theme.dark") },
            ]}
          />
        </Row>
        <Row label={t("settings.language")}>
          <Segmented<LangPref>
            label={t("settings.language")}
            value={s.lang}
            testId="lang-setting"
            onChange={(l) => updateSettings({ lang: l })}
            options={[
              { value: "system", label: t("settings.language.system") },
              { value: "zh", label: "中文" },
              { value: "en", label: "English" },
            ]}
          />
        </Row>
      </section>

      <section className="set-section">
        <h2 className="section-title">{t("settings.review")}</h2>
        <Row label={t("settings.render")} hint={t(s.renderDefault === "auto" ? "settings.render.autoHint" : "settings.render.originalHint")}>
          <Segmented<"auto" | "original">
            label={t("settings.render")}
            value={s.renderDefault}
            testId="render-setting"
            onChange={(renderDefault) => updateSettings({ renderDefault })}
            options={[
              { value: "auto", label: t("settings.render.wenguShort") },
              { value: "original", label: t("settings.render.originalShort") },
            ]}
          />
        </Row>
        <Row label={t("settings.autoplay")} hint={t("settings.autoplayHint")}>
          <Switch label={t("settings.autoplay")} checked={s.autoplay} testId="autoplay-setting" onChange={(autoplay) => updateSettings({ autoplay })} />
        </Row>
      </section>

      {noteTypes.length > 0 && (
        <section className="set-section">
          <h2 className="section-title">{t("settings.noteTypesTitle")}</h2>
          <p className="set-intro">{t("settings.noteTypesHint")}</p>
          <ul className="nt-list">
            {noteTypes.map((nt) => {
              const a = analysis(nt.id);
              const mode = s.noteTypeModes[String(nt.id)] ?? "auto";
              return (
                <li key={nt.id} className="set-row nt-row" data-testid="nt-row">
                  <div className="set-text">
                    <span className="set-name">{nt.name}</span>
                    <span className={`set-hint ${a.safe ? "" : "warn-text"}`}>
                      {a.safe ? t("settings.nt.safe") : t("settings.nt.unsafe", { reason: a.reasons.map((r) => reasonText(r, t)).join("; ") })}
                    </span>
                  </div>
                  <div className="set-control">
                    <Segmented<NoteTypeMode>
                      label={nt.name}
                      value={mode}
                      onChange={(m) =>
                        updateSettings((cur) => {
                          const next = { ...cur.noteTypeModes };
                          if (m === "auto") delete next[String(nt.id)];
                          else next[String(nt.id)] = m;
                          return { noteTypeModes: next };
                        })
                      }
                      options={[
                        { value: "auto", label: t("settings.nt.auto") },
                        { value: "wengu", label: t("settings.nt.wengu") },
                        { value: "original", label: t("settings.nt.original") },
                      ]}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <AgentSection />

      <section className="set-section">
        <h2 className="section-title">{t("settings.data")}</h2>
        <Row label={t("settings.transfer")} hint={t("settings.exportHint")}>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => openImport()}>
            <Icon name="import" /> {t("nav.import")}
          </button>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => openExport()}>
            <Icon name="export" /> {t("nav.export")}
          </button>
        </Row>
        <Row
          label={t("settings.storageTitle")}
          hint={`${t("settings.storage", { storage: info.storage })} ${t("settings.counts", { notes: n(info.counts.knowledgePoints), cards: n(info.counts.reviewItems), reviews: n(info.counts.reviewLog), media: n(info.counts.media) })}`}
        />
      </section>

      <p className="set-foot">{t("settings.version", { sqlite: info.sqliteVersion, schema: info.schemaVersion })}</p>
    </div>
  );
}

/** Shell-quotes one argument (POSIX; Windows paths rarely need it). */
const quote = (a: string) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);

export function AgentSection() {
  const t = useT();
  const lang = useLang();
  const s = useSettings();
  const agents = useAgents();
  const bridge = window.wenguDesktop?.agent;
  const [exe = "", ...args] = bridge?.command ?? [];
  const config = JSON.stringify({ mcpServers: { wengu: { command: exe, args } } }, null, 2);
  const claude = ["claude", "mcp", "add", "--scope", "user", "wengu", "--", exe, ...args].map(quote).join(" ");

  return (
    <section className="set-section" data-testid="agent-settings">
      <h2 className="section-title">{t("settings.agents")}</h2>
      {!bridge ? (
        <p className="set-intro">{t("settings.agents.desktopOnly")}</p>
      ) : (
        <>
          <Row label={t("settings.agents.allow")} hint={t("settings.agents.allowHint")}>
            <Switch label={t("settings.agents.allow")} checked={s.agentAccess} testId="agent-access" onChange={(agentAccess) => updateSettings({ agentAccess })} />
          </Row>
          {s.agentAccess && (
            <div className="agent-setup">
              <p className="small">{t("settings.agents.claude")}</p>
              <pre className="code-block" data-testid="agent-claude-command">{claude}</pre>
              <p className="small">{t("settings.agents.json")}</p>
              <pre className="code-block" data-testid="agent-config">{config}</pre>
            </div>
          )}
          {agents.length > 0 && (
            <div className="agent-list">
              <h3 className="set-label">{t("settings.agents.seen")}</h3>
              <ul>
                {agents.map((a) => (
                  <li key={a.name} className="agent-row" data-testid="agent-row">
                    <div className="nt-info">
                      <span className="nt-name">
                        {agentName(a)}
                        {a.version && <span className="muted small"> {a.version}</span>}
                      </span>
                      <span className="small muted">
                        {t("settings.agents.activity", { time: formatDateTime(a.lastSeen, lang), added: formatNumber(a.notesAdded, lang), updated: formatNumber(a.notesUpdated, lang) })}
                      </span>
                    </div>
                    <code className="small">{agentTag(a)}</code>
                  </li>
                ))}
              </ul>
              <button type="button" className="btn btn-ghost btn-small" onClick={forgetAgents}>
                {t("settings.agents.forget")}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
