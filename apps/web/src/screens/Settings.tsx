import { agentTag } from "../agent/run.ts";
import { reasonText } from "../card/prepare.ts";
import { agentName, forgetAgents, useAgents } from "../lib/agents.ts";
import { useApp } from "../lib/app.tsx";
import { formatDateTime, formatNumber } from "../lib/format.ts";
import { useLang, useT } from "../lib/i18n.ts";
import { updateSettings, useSettings, type LangPref, type NoteTypeMode, type ThemePref } from "../lib/settings.ts";
import { Icon } from "../ui/Icon.tsx";

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

export function Settings() {
  const s = useSettings();
  const t = useT();
  const lang = useLang();
  const { noteTypes, analysis, info, openExport } = useApp();
  const n = (v: number) => formatNumber(v, lang);

  return (
    <div className="page page-settings">
      <header className="page-head">
        <h1 className="page-title">{t("settings.title")}</h1>
      </header>

      <section className="set-section">
        <h2 className="section-title">{t("settings.appearance")}</h2>
        <div className="set-row">
          <span className="set-label">{t("settings.theme")}</span>
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
        </div>
        <div className="set-row">
          <span className="set-label">{t("settings.language")}</span>
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
        </div>
      </section>

      <section className="set-section">
        <h2 className="section-title">{t("settings.cards")}</h2>
        <fieldset className="fieldset">
          <legend className="set-label">{t("settings.render")}</legend>
          <label className="check">
            <input type="radio" name="render" checked={s.renderDefault === "auto"} onChange={() => updateSettings({ renderDefault: "auto" })} />
            <span>
              {t("settings.render.auto")}
              <small>{t("settings.render.autoHint")}</small>
            </span>
          </label>
          <label className="check">
            <input type="radio" name="render" checked={s.renderDefault === "original"} onChange={() => updateSettings({ renderDefault: "original" })} />
            <span>
              {t("settings.render.original")}
              <small>{t("settings.render.originalHint")}</small>
            </span>
          </label>
        </fieldset>
        <label className="check">
          <input type="checkbox" checked={s.autoplay} onChange={(e) => updateSettings({ autoplay: e.target.checked })} />
          <span>{t("settings.autoplay")}</span>
        </label>

        {noteTypes.length > 0 && (
          <div className="nt-list">
            <h3 className="set-label">{t("settings.noteTypes")}</h3>
            <p className="muted small">{t("settings.noteTypesHint")}</p>
            <ul>
              {noteTypes.map((nt) => {
                const a = analysis(nt.id);
                const mode = s.noteTypeModes[String(nt.id)] ?? "auto";
                return (
                  <li key={nt.id} className="nt-row" data-testid="nt-row">
                    <div className="nt-info">
                      <span className="nt-name">{nt.name}</span>
                      <span className={`small ${a.safe ? "muted" : "warn-text"}`}>
                        {a.safe ? t("settings.nt.safe") : t("settings.nt.unsafe", { reason: a.reasons.map((r) => reasonText(r, t)).join("; ") })}
                      </span>
                    </div>
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
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      <AgentSection />

      <section className="set-section">
        <h2 className="section-title">{t("settings.data")}</h2>
        <p>{t("settings.storage", { storage: info.storage })}</p>
        <p className="muted">
          {t("settings.counts", { notes: n(info.counts.knowledgePoints), cards: n(info.counts.reviewItems), reviews: n(info.counts.reviewLog), media: n(info.counts.media) })}
        </p>
        <div className="set-row">
          <span className="muted small">{t("settings.exportHint")}</span>
          <button type="button" className="btn btn-ghost" onClick={() => openExport()}>
            <Icon name="export" /> {t("nav.export")}
          </button>
        </div>
        <p className="muted small">{t("settings.version", { sqlite: info.sqliteVersion, schema: info.schemaVersion })}</p>
      </section>
    </div>
  );
}

/** Shell-quotes one argument (POSIX; Windows paths rarely need it). */
const quote = (a: string) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);

function AgentSection() {
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
        <p className="muted">{t("settings.agents.desktopOnly")}</p>
      ) : (
        <>
          <label className="check">
            <input type="checkbox" data-testid="agent-access" checked={s.agentAccess} onChange={(e) => updateSettings({ agentAccess: e.target.checked })} />
            <span>
              {t("settings.agents.allow")}
              <small>{t("settings.agents.allowHint")}</small>
            </span>
          </label>
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
