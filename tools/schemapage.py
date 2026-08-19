#!/usr/bin/env python3
"""Dress docs/schema/erd.md as a page you can open in a browser.

    python3 tools/schemapage.py     # writes docs/schema/erd.html

The markdown is what `go generate ./tools/schemagen` writes out of the same Go
data the migration comes from; this only adds a stylesheet and a table of
contents, so there is nothing here to keep in step with the schema. Re-run it
after regenerating, and republish the file if the page is being hosted.

Python because it is presentation and nothing depends on it — the same reason
build/appicon.py is Python. Nothing in the Go build calls this.
"""
import html
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "docs" / "schema" / "erd.md"
OUT = ROOT / "docs" / "schema" / "erd.html"

text = SRC.read_text()

# The diagram's own palette. Dark ink on white cards, one grey for the lines —
# the same values the page's light tokens use, so a plate reads as a printed
# figure rather than as a widget from somewhere else.
MERMAID_THEME = (
    "{'theme':'base','themeVariables':{"
    "'fontFamily':'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',"
    "'fontSize':'13px',"
    "'primaryColor':'#ffffff',"          # entity header fill
    "'primaryTextColor':'#14171d',"      # entity header text
    "'primaryBorderColor':'#aab3bf',"
    "'secondaryColor':'#f4f6f8',"
    "'tertiaryColor':'#ffffff',"
    "'lineColor':'#7c8493',"             # relationship lines
    "'textColor':'#14171d',"             # relationship labels
    "'nodeBorder':'#aab3bf',"
    "'mainBkg':'#ffffff',"
    "'attributeBackgroundColorOdd':'#ffffff',"
    "'attributeBackgroundColorEven':'#f4f6f8'"
    "}}"
)


# --- parse -------------------------------------------------------------
# Everything before the first "## " is the preamble; after it, one section per
# heading: prose, then exactly one fenced mermaid block.
body = text.split("\n", 2)[2] if text.startswith("<!--") else text
body = re.sub(r"^<!--.*?-->\n", "", text, flags=re.S)

parts = re.split(r"^## ", body, flags=re.M)
preamble = parts[0]
sections = []
for chunk in parts[1:]:
    title, rest = chunk.split("\n", 1)
    m = re.search(r"```mermaid\n(.*?)```", rest, flags=re.S)
    diagram = m.group(1).rstrip()
    # Every colour spelled out, because inheriting was the bug: the host
    # renders mermaid in its own theme, so `theme: neutral` came out as dark
    # fills with dark text — unreadable. `base` plus themeVariables is the
    # documented way to own the palette outright. No `background`, so the
    # plate below shows through and the diagram sits on paper in both themes.
    diagram = "%%{init: " + MERMAID_THEME + "}%%\n" + diagram
    prose = rest[: m.start()].strip()
    sections.append((title.strip(), prose, diagram))

# Drop the title line and the "три страницы про одно" pointer block from the
# preamble: the page has its own masthead, and the pointers become a footer.
preamble = re.sub(r"^# .*?\n", "", preamble, flags=re.M, count=1).strip()
# The "read it in words over there" paragraph becomes the footer, so it does not
# also open the page.
preamble = "\n\n".join(
    para for para in re.split(r"\n\s*\n", preamble)
    if not para.lstrip().startswith("Читается это словами")
)



def inline(s: str) -> str:
    """`code` and **bold** into HTML, everything else escaped."""
    s = html.escape(s)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    return s


def paragraphs(block: str) -> str:
    out = []
    for para in re.split(r"\n\s*\n", block.strip()):
        para = para.strip()
        if not para:
            continue
        if para.startswith("- "):
            items = "".join(
                f"<li>{inline(i[2:].strip())}</li>"
                for i in re.split(r"\n(?=- )", para)
            )
            out.append(f"<ul>{items}</ul>")
        else:
            out.append(f"<p>{inline(' '.join(para.split()))}</p>")
    return "\n".join(out)


def counts(diagram: str):
    tables = len(re.findall(r"^    [a-z_]+ \{", diagram, flags=re.M))
    keys = len(re.findall(r"\|\|--o\{", diagram))
    return tables, keys


def slug(title: str, i: int) -> str:
    return f"g{i}"


total_tables = sum(counts(d)[0] for _, _, d in sections)
total_keys = sum(counts(d)[1] for _, _, d in sections)
cascades = len(re.findall(r"CASCADE", text))

# --- render ------------------------------------------------------------
nav, main = [], []
for i, (title, prose, diagram) in enumerate(sections):
    t, k = counts(diagram)
    sid = slug(title, i)
    keylabel = f" · {k} " + ("ключ" if k == 1 else "ключа" if k < 5 else "ключей") if k else ""
    nav.append(
        f'<li><a href="#{sid}"><span class="nav-name">{html.escape(title)}</span>'
        f'<span class="nav-count">{t}</span></a></li>'
    )
    main.append(f"""      <section class="group" id="{sid}">
        <p class="eyebrow">{t} таблиц{keylabel}</p>
        <h2>{html.escape(title)}</h2>
        <div class="prose">{paragraphs(prose)}</div>
        <figure class="plate">
          <pre class="mermaid">{html.escape(diagram)}</pre>
        </figure>
      </section>""")

page = f"""<title>Схема базы XCIII</title>
<style>
  :root {{
    --ground:  #f4f6f8;
    --surface: #ffffff;
    --ink:     #14171d;
    --muted:   #5b6472;
    --faint:   #8c94a1;
    --line:    #dfe4ea;
    --line-2:  #eef1f5;
    --accent:  #a2540b;
    --accent-soft: #fdf3e3;
    --plate:   #fcfcfd;
    --plate-line: #dfe4ea;
    --shadow: 0 1px 2px rgba(20, 23, 29, .05), 0 8px 24px -16px rgba(20, 23, 29, .3);

    --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }}
  @media (prefers-color-scheme: dark) {{
    :root:not([data-theme="light"]) {{
      --ground:  #0f1217;
      --surface: #161a21;
      --ink:     #e6e9ee;
      --muted:   #949daa;
      --faint:   #6e7784;
      --line:    #252b34;
      --line-2:  #1d222a;
      --accent:  #efa945;
      --accent-soft: #2a2113;
      --plate:   #e8ebef;
      --plate-line: #2b313b;
      --shadow: 0 1px 2px rgba(0, 0, 0, .4), 0 10px 30px -18px rgba(0, 0, 0, .9);
    }}
  }}
  :root[data-theme="dark"] {{
    --ground:  #0f1217;
    --surface: #161a21;
    --ink:     #e6e9ee;
    --muted:   #949daa;
    --faint:   #6e7784;
    --line:    #252b34;
    --line-2:  #1d222a;
    --accent:  #efa945;
    --accent-soft: #2a2113;
    --plate:   #e8ebef;
    --plate-line: #2b313b;
    --shadow: 0 1px 2px rgba(0, 0, 0, .4), 0 10px 30px -18px rgba(0, 0, 0, .9);
  }}

  * {{ box-sizing: border-box; }}

  body {{
    margin: 0;
    background: var(--ground);
    color: var(--ink);
    font-family: var(--sans);
    font-size: 16px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }}

  code {{
    font-family: var(--mono);
    font-size: .88em;
    background: var(--line-2);
    border: 1px solid var(--line);
    border-radius: 3px;
    padding: .05em .32em;
    white-space: nowrap;
  }}

  a {{ color: var(--accent); text-decoration-thickness: 1px; text-underline-offset: 2px; }}
  a:focus-visible, summary:focus-visible {{ outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 2px; }}

  /* ---- masthead ---- */
  .masthead {{
    border-bottom: 1px solid var(--line);
    background: var(--surface);
  }}
  .masthead-inner {{
    max-width: 1240px;
    margin: 0 auto;
    padding: 40px 28px 30px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }}
  .kicker {{
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: .14em;
    text-transform: uppercase;
    color: var(--faint);
    margin: 0;
  }}
  h1 {{
    font-family: var(--mono);
    font-size: clamp(28px, 4.4vw, 42px);
    font-weight: 600;
    letter-spacing: -.02em;
    line-height: 1.1;
    margin: 0;
    text-wrap: balance;
  }}
  h1 .dot {{ color: var(--accent); }}
  .standfirst {{
    max-width: 62ch;
    margin: 0;
    color: var(--muted);
    font-size: 16.5px;
  }}
  .standfirst code {{ background: transparent; border-color: transparent; padding: 0; color: var(--ink); }}

  .stats {{
    display: flex;
    flex-wrap: wrap;
    gap: 0;
    border: 1px solid var(--line);
    border-radius: 6px;
    overflow: hidden;
    align-self: flex-start;
  }}
  .stat {{
    padding: 12px 22px 11px;
    border-right: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: 1px;
  }}
  .stat:last-child {{ border-right: 0; }}
  .stat b {{
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
    font-size: 22px;
    font-weight: 600;
    line-height: 1.15;
  }}
  .stat span {{
    font-family: var(--mono);
    font-size: 10.5px;
    letter-spacing: .1em;
    text-transform: uppercase;
    color: var(--faint);
  }}

  /* ---- shell ---- */
  .shell {{
    max-width: 1240px;
    margin: 0 auto;
    padding: 0 28px 96px;
    display: grid;
    grid-template-columns: 210px minmax(0, 1fr);
    gap: 56px;
    align-items: start;
  }}

  nav {{
    position: sticky;
    top: 0;
    padding: 40px 0;
    font-family: var(--mono);
    font-size: 13px;
  }}
  nav p {{
    margin: 0 0 12px;
    font-size: 10.5px;
    letter-spacing: .12em;
    text-transform: uppercase;
    color: var(--faint);
  }}
  nav ul {{ list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }}
  nav a {{
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    padding: 6px 0;
    color: var(--muted);
    text-decoration: none;
    border-bottom: 1px solid var(--line-2);
  }}
  nav a:hover {{ color: var(--ink); }}
  nav a:hover .nav-count {{ color: var(--accent); }}
  .nav-count {{ font-variant-numeric: tabular-nums; color: var(--faint); font-size: 12px; }}

  main {{ padding: 40px 0 0; min-width: 0; }}

  .preamble {{
    border-left: 2px solid var(--accent);
    padding: 2px 0 2px 20px;
    margin: 0 0 56px;
    max-width: 66ch;
  }}
  .preamble p {{ margin: 0 0 .85em; color: var(--muted); }}
  .preamble p:last-child {{ margin-bottom: 0; }}

  .group {{ margin: 0 0 68px; scroll-margin-top: 24px; }}
  .eyebrow {{
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: .12em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 6px;
    font-variant-numeric: tabular-nums;
  }}
  h2 {{
    font-family: var(--mono);
    font-size: 24px;
    font-weight: 600;
    letter-spacing: -.01em;
    margin: 0 0 14px;
  }}
  .prose {{ max-width: 66ch; }}
  .prose p {{ margin: 0 0 .9em; }}
  .prose p:last-child {{ margin-bottom: 0; }}

  /* Diagrams are printed plates: a paper surface in both themes. The diagram
     spells out its own palette (MERMAID_THEME) instead of inheriting one —
     inheriting is what made them dark-on-dark and unreadable. */
  .plate {{
    margin: 24px 0 0;
    padding: 20px;
    background: var(--plate);
    border: 1px solid var(--plate-line);
    border-radius: 8px;
    box-shadow: var(--shadow);
    overflow-x: auto;
  }}
  .plate .mermaid {{ margin: 0; }}
  .plate svg {{ max-width: none; height: auto; }}

  footer {{
    border-top: 1px solid var(--line);
    max-width: 1240px;
    margin: 0 auto;
    padding: 28px;
    color: var(--muted);
    font-size: 14px;
  }}
  footer ul {{ margin: 10px 0 0; padding-left: 18px; }}
  footer li {{ margin-bottom: 4px; }}

  @media (max-width: 900px) {{
    .shell {{ grid-template-columns: minmax(0, 1fr); gap: 0; }}
    nav {{ position: static; padding: 32px 0 0; }}
    nav ul {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0 20px; }}
    main {{ padding-top: 32px; }}
  }}
  @media (prefers-reduced-motion: reduce) {{
    * {{ animation: none !important; transition: none !important; }}
  }}
</style>

<header class="masthead">
  <div class="masthead-inner">
    <p class="kicker">xciii · один файл, {total_tables} таблиц</p>
    <h1>Схема базы<span class="dot">.</span></h1>
    <p class="standfirst">Всё, что знает приложение, — про карточку или доску, а карточка это строка
      в <code>blocks</code>. Поэтому база одна: доска (форк Focalboard) и наши таблицы рядом, с настоящими
      внешними ключами между ними.</p>
    <div class="stats">
      <div class="stat"><b>{total_tables}</b><span>таблиц</span></div>
      <div class="stat"><b>{total_keys}</b><span>внешних ключей</span></div>
      <div class="stat"><b>{cascades}</b><span>из них CASCADE</span></div>
      <div class="stat"><b>1</b><span>шаг миграции</span></div>
      <div class="stat"><b>3</b><span>диалекта</span></div>
    </div>
  </div>
</header>

<div class="shell">
  <nav>
    <p>Группы</p>
    <ul>
{chr(10).join("      " + n for n in nav)}
    </ul>
  </nav>

  <main>
    <div class="preamble">{paragraphs(preamble)}</div>

{chr(10).join(main)}
  </main>
</div>

<footer>
  Страница собрана из <code>docs/schema/erd.md</code>, который пишет
  <code>go generate ./tools/schemagen</code> из той же Go-схемы, что и миграцию, — устареть ей негде.
  Остальное про модель:
  <ul>
    <li><code>docs/db-erd.md</code> — что где лежит, чем что адресуется и почему так.</li>
    <li><code>docs/db-schema-review.md</code> — разбор решений.</li>
    <li><code>docs/schema/app.hcl</code> — та же схема как Atlas HCL.</li>
  </ul>
</footer>
"""

OUT.write_text(page)
print(f"wrote {OUT} — {len(sections)} groups, {total_tables} tables, {total_keys} keys")
