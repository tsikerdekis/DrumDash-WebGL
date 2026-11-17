"""Every published page must be reachable from the nav or the footer.

WHY THIS EXISTS
---------------
`translate.html` (the chart converter) shipped and was in the generated
sitemap, so it was indexable, but nothing linked to it: not the nav, not the
footer, not any other page. A user could only reach it by typing the URL. That
is invisible in any build or smoke test — the page builds fine and returns 200.

The test is deliberately source-level and dependency-free (stdlib only): it reads
the Liquid includes, so it works before a build and does not need Jekyll, Docker
or a running server.

Run:  python3 -m pytest tests/test_pages_reachable.py -v
"""

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
INCLUDES = ROOT / "_includes"
LAYOUTS = ROOT / "_layouts"

# Pages that are intentionally not linked from the chrome.
UNLINKED_OK = {
    "404.html",   # served by the host on a missing path
}


def _published_pages():
    """Root-level pages Jekyll will publish (front matter present, not a partial)."""
    pages = []
    for path in sorted(ROOT.glob("*.html")):
        text = path.read_text(encoding="utf-8", errors="replace")
        if text.lstrip().startswith("---"):
            pages.append(path.name)
    return pages


def _hrefs():
    """Every href in the shared chrome, normalised to a bare page name."""
    found = set()
    for folder in (INCLUDES, LAYOUTS):
        for path in folder.glob("*.html"):
            text = path.read_text(encoding="utf-8", errors="replace")
            for href in re.findall(r'href="([^"]+)"', text):
                href = href.split("?")[0].split("#")[0]
                # Strip the Liquid baseurl prefix, e.g. {{ site.baseurl }}/x.html
                href = re.sub(r"\{\{[^}]*\}\}", "", href).lstrip("/")
                if href.endswith(".html"):
                    found.add(href.lstrip("/"))
    return found


def test_every_page_is_linked_from_nav_or_footer():
    linked = _hrefs()
    orphans = [p for p in _published_pages() if p not in linked and p not in UNLINKED_OK]
    assert not orphans, (
        "These pages exist but nothing in the nav/footer links to them, so a "
        "visitor can only reach them by typing the URL: " + ", ".join(orphans)
    )


def test_converter_is_linked():
    """Regression: the chart converter shipped with zero inbound links."""
    linked = _hrefs()
    assert "translate.html" in linked


def test_transcription_is_linked():
    linked = _hrefs()
    assert "transcription.html" in linked


def test_every_internal_nav_link_resolves_to_a_page():
    """The inverse mistake: a link to a page that does not exist is a 404."""
    pages = set(_published_pages())
    broken = []
    for href in _hrefs():
        if href in pages:
            continue
        # blog/index.html and friends live in subdirectories.
        if (ROOT / href).exists():
            continue
        broken.append(href)
    assert not broken, "Nav/footer links to pages that do not exist: " + ", ".join(sorted(broken))
