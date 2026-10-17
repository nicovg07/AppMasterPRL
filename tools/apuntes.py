"""Genera los apuntes visuales de cada tema: apuntes/<tema>-resumen.html|pdf y apuntes/<tema>-memorizar.html|pdf.

Fuentes: apuntes/src/<tema>-<tipo>.html, solo con el contenido (secciones). La primera línea es un comentario
JSON con lo que no sale del seed: <!--{"pags": "3–13", "ud": 1}--> (páginas impresas que cubre y número de unidad
didáctica). El código, el título y la asignatura se leen de data/seed.json.

Uso (desde la carpeta del proyecto):
  python tools/apuntes.py            # solo HTML
  python tools/apuntes.py --pdf      # HTML y PDF (con Chrome o Edge en modo headless)
  python tools/apuntes.py t1 --pdf   # solo los de un tema
"""
import html, json, os, re, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC, OUT = ROOT / "apuntes" / "src", ROOT / "apuntes"
KINDS = {"resumen": ("Resumen", "📘", ""), "memorizar": ("Para memorizar", "🧠", " mem")}
BROWSERS = [r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "google-chrome", "chromium"]

SHELL = """<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{code} · {kind} · {title}</title>
<script>try{{var q=location.search,m=q.match(/[?&]theme=(light|dark)/);if(m)document.documentElement.dataset.theme=m[1];if(/[?&]embed=1/.test(q))document.documentElement.classList.add("embed")}}catch(e){{}}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Schibsted+Grotesk:wght@400;500;600;700;800&display=swap">
<link rel="stylesheet" href="apuntes.css">
<style>@page{{@bottom-left{{content:"{code} · {kind} · {title_css}";font:8pt "Schibsted Grotesk",sans-serif;color:#8a93a3}}@bottom-right{{content:counter(page) " / " counter(pages);font:8pt "IBM Plex Mono",monospace;color:#8a93a3}}}}</style>
</head>
<body>
<header class="head">
  <div class="tags"><span class="code">{code}</span><span class="kind{cls}">{emoji} {kind}</span></div>
  <h1>{title}</h1>
  <p class="meta">{subject} · En tus apuntes: págs. {pags}</p>
</header>
{body}
<footer class="foot">{foot}</footer>
</body>
</html>
"""


def browser():
    for b in BROWSERS:
        if os.path.isfile(b): return b
        try:
            subprocess.run([b, "--version"], capture_output=True, check=True); return b
        except Exception: pass
    sys.exit("No encuentro Chrome ni Edge para sacar los PDF.")


def build(tid, kind, topic, pdf):
    src = SRC / f"{tid}-{kind}.html"
    if not src.exists(): return None
    text = src.read_text(encoding="utf-8")
    meta = json.loads(re.match(r"\s*<!--(.*?)-->", text, re.S).group(1))
    body = re.sub(r"^\s*<!--.*?-->\s*", "", text, count=1, flags=re.S).strip()
    name, emoji, cls = KINDS[kind]
    foot = (f"{'Resumen' if kind == 'resumen' else 'Lo que hay que saberse'} de la Unidad Didáctica {meta['ud']} "
            f"de los apuntes de la Universidad Nebrija. «pág.» es el número impreso al pie de tus apuntes.")
    page = SHELL.format(code=html.escape(topic["code"]), kind=name, title=html.escape(topic["title"]),
                        title_css=topic["title"].replace('"', "'"), cls=cls, emoji=emoji,
                        subject=html.escape(topic.get("subjectShort", "")), pags=html.escape(meta["pags"]),
                        body=body, foot=foot)
    out = OUT / f"{tid}-{kind}.html"
    out.write_text(page, encoding="utf-8", newline="\n")
    if pdf:
        target = OUT / f"{tid}-{kind}.pdf"
        with tempfile.TemporaryDirectory() as prof:
            subprocess.run([browser(), "--headless=new", "--disable-gpu", "--no-first-run", f"--user-data-dir={prof}",
                            "--no-pdf-header-footer", "--print-to-pdf-no-header", "--virtual-time-budget=15000",
                            f"--print-to-pdf={target}", out.as_uri()], capture_output=True, timeout=180)
        if not target.exists(): sys.exit(f"No se ha generado {target.name}")
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    pdf = "--pdf" in sys.argv
    seed = json.loads((ROOT / "data" / "seed.json").read_text(encoding="utf-8"))
    for tid, topic in seed["topics"].items():
        if args and tid not in args: continue
        for kind in KINDS:
            out = build(tid, kind, topic, pdf)
            if out: print("ok", out.name, "+ pdf" if pdf else "")


if __name__ == "__main__":
    main()
