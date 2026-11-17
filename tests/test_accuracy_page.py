"""The published accuracy page must exist, be linked, and quote the real numbers.

WHY THIS EXISTS
---------------
`accuracy.html` is the page the homepage CTA "See the Transcription Accuracy" points
at. It is the only place the project publishes measured note-detection, tempo and
difficulty scores, so two mistakes are worth failing a build over:

1. **The page is orphaned again.** The previous version of this content lived on
   `transcription.html`, and was silently overwritten when that page became the upload
   form. The CTA kept pointing at "accuracy" while the destination showed a file picker.
   `test_pages_reachable.py` cannot catch this, because it only checks that *some* page
   is linked — it does not know which page has to contain what.

2. **A number drifts away from the source of truth.** Every figure has a written
   source in the worker repo. A typo in a percentage is invisible in a build; it is
   just a slightly wrong marketing claim on a page whose entire purpose is credibility.

Run:  python3 -m pytest tests/test_accuracy_page.py -v
"""

import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = ROOT / "accuracy.html"
FOOTER = ROOT / "_includes" / "footer.html"
HOMEPAGE = ROOT / "index.html"


@pytest.fixture(scope="module")
def page_text():
    assert PAGE.exists(), (
        "accuracy.html is missing. The homepage CTA 'See the Transcription Accuracy' "
        "points at it."
    )
    return PAGE.read_text(encoding="utf-8", errors="replace")


def test_page_has_front_matter_and_layout(page_text):
    """Without front matter Jekyll copies the file verbatim and no layout is applied."""
    assert page_text.lstrip().startswith("---"), "accuracy.html has no Liquid front matter"
    assert re.search(r"^layout:\s*default\s*$", page_text, re.MULTILINE)


def test_page_loads_its_stylesheet(page_text):
    """The bars have width:0 until JS fills them, so the stylesheet is not optional."""
    assert "accuracy.css" in page_text, (
        "accuracy.html does not list accuracy.css in custom_css, so the score bars, "
        "table and difficulty cards would render unstyled"
    )
    assert (ROOT / "assets" / "css" / "accuracy.css").exists(), (
        "assets/css/accuracy.css is referenced but does not exist"
    )


def test_homepage_cta_points_at_this_page():
    """Regression: the CTA said 'See the Transcription Accuracy' but went to a file picker."""
    text = HOMEPAGE.read_text(encoding="utf-8", errors="replace")
    assert "See the Transcription Accuracy" in text, "the homepage accuracy CTA is gone"
    cta = re.search(r'<a href="([^"]+)"[^>]*>See the Transcription Accuracy', text)
    assert cta, "could not locate the accuracy CTA anchor"
    assert cta.group(1) == "accuracy.html", (
        "the accuracy CTA must go to accuracy.html, not " + cta.group(1)
    )


def test_page_is_linked_from_the_footer():
    text = FOOTER.read_text(encoding="utf-8", errors="replace")
    assert "accuracy.html" in text, "accuracy.html is not linked from the footer"


# ── The published figures, each traceable to the worker documentation ──
#
# Source of note-detection scores:
#   DrumDash/note_detection_v2/drum_transcription_prod/TRANSCRIPTION_F1_SCORES.md
#   (R188 deployment table = the checkpoints actually served).
# Source of tempo scores:
#   DrumDash/bpm-detect/README.md ("The song BPM and the precision fit").
# Source of difficulty scores:
#   DrumDash/drum-convert-v2/*_rich_features.json (`val_threshold_f1`) and
#   `keep_rate`; see also md/ML_DIFFICULTY_GENERATION.md.

# name on the page -> percentage as it must appear in the bar markup
NOTE_SCORES = {
    "Kick": 91,
    "Snare": 90,
    "Hi-Hat": 81,
    "Ride": 79,
    "Crash": 78,
    "Floor Tom": 67,
    "Mid Tom": 59,
    "High Tom": 56,
}


def _bar_scores(page_text):
    """Map each labelled bar to its data-score and its printed value.

    A `.tp-bar` holds only spans, so it closes with a single `</div>`; every block
    therefore runs from one `tp-bar` marker up to the next.
    """
    found = {}
    blocks = re.split(r'<div class="tp-bar">', page_text)[1:]
    for block in blocks:
        name = re.search(r'tp-bar-name">([^<]+)', block)
        score = re.search(r'data-score="(\d+)"', block)
        value = re.search(r'tp-bar-value">(\d+)%', block)
        if name and score and value:
            found[name.group(1).strip()] = (int(score.group(1)), int(value.group(1)))
    return found


def test_every_drum_part_is_present_with_the_documented_score(page_text):
    found = _bar_scores(page_text)
    missing = sorted(set(NOTE_SCORES) - set(found))
    assert not missing, f"note-detection bars missing for: {missing}"

    wrong = {
        name: {"bar": found[name][0], "printed": found[name][1], "expected": expected}
        for name, expected in NOTE_SCORES.items()
        if found[name][0] != expected or found[name][1] != expected
    }
    assert not wrong, (
        "a bar's animated width and its printed percentage must both equal the "
        f"documented score, and they do not: {wrong}"
    )


def test_detection_footnote_states_the_matching_tolerance(page_text):
    """An F1 without its tolerance is not a reproducible claim."""
    assert re.search(r"100\s*(?:&nbsp;|\s)*ms", page_text), (
        "the note-detection footnote must state the ±100 ms matching tolerance"
    )


def test_jargon_is_defined_in_plain_english(page_text):
    """F1 is invisible to a drummer reading this as a product page.

    The figures must stay technical, but the *first* explanation a visitor meets has
    to be in plain language: a score out of 100 for each drum part. The acronym is
    still named, deliberately, in a secondary note for readers who know the field.
    """
    assert "What a score out of 100 actually means" in page_text, (
        "the page must explain the scores in plain English before using any acronym"
    )
    assert re.search(r"<strong>F1</strong>", page_text), (
        "F1 should still be named for technical readers, just not assumed"
    )
    # The plain-English block must explain both failure modes, since that is what makes
    # the number trustworthy rather than a black box.
    assert "miss a hit" in page_text and "invent one that is not" in page_text, (
        "the explainer must say a detection score counts both missed and invented hits"
    )


def test_headline_labels_avoid_bare_acronyms(page_text):
    """The four headline stat labels are the most-read text on the page."""
    labels = re.findall(r'tp-score-label">([^<]+)<', page_text)
    assert len(labels) == 4, f"expected 4 headline stats, found {len(labels)}"
    jargon = [l.strip() for l in labels if "F1" in l or "micro" in l.lower()]
    assert not jargon, (
        "headline stat labels must be readable by a non-specialist, found: "
        + ", ".join(jargon)
    )


def test_tempo_metrics_are_present(page_text):
    for label in (
        "Songs at the exact tempo",
        "Songs at the right tempo, allowing half/double time",
        "Notes within 25",
    ):
        assert label in page_text, f"tempo table row missing: {label}"

    # The headline pair, as printed. 0.686/0.678 -> 69%/68%.
    assert re.search(r"Songs at the exact tempo</td>\s*<td class=\"num\">69%", page_text), (
        "exact-tempo validation must read 69% (0.686 in bpm-detect/README.md)"
    )
    assert re.search(r"<td class=\"num\">68%</td>\s*</tr>", page_text), (
        "exact-tempo test must read 68% (0.678 in bpm-detect/README.md)"
    )


def test_tempo_section_admits_the_octave_limit(page_text):
    """The README is explicit that ~18% of songs land at half/double time.

    Publishing 69% without that caveat would make the number look like a defect
    rather than a known, measured property, and it is the one thing a reader is
    most likely to notice when their own song comes out at half tempo.
    """
    assert re.search(r"half or double time", page_text), (
        "the tempo section must explain the half/double-time (octave) error"
    )
    assert "82%" in page_text and "85%" in page_text, (
        "the correct-octave row must publish both splits (0.824 / 0.847)"
    )


DIFFICULTY_F1 = {"Easy": 85, "Medium": 86, "Hard": 85}
DIFFICULTY_KEEP = {"Easy": 38, "Medium": 55, "Hard": 79}


def test_difficulty_cards_publish_f1_and_retention(page_text):
    for name, expected_f1 in DIFFICULTY_F1.items():
        block = re.search(
            r'<span class="tp-diff-name">' + name + r'</span>(.*?)</div>\s*</div>',
            page_text,
            re.DOTALL,
        )
        assert block, f"difficulty card missing for {name}"
        assert f'data-score="{expected_f1}"' in block.group(1), (
            f"{name} card must animate to its documented val_threshold_f1 ({expected_f1}%)"
        )
        assert f"about {DIFFICULTY_KEEP[name]}% of Expert" in page_text, (
            f"{name} card must state the documented keep_rate ({DIFFICULTY_KEEP[name]}%)"
        )


def test_difficulty_scores_are_labelled_as_validation():
    """`val_threshold_f1` is a validation-split number; calling it a test score would lie."""
    text = PAGE.read_text(encoding="utf-8", errors="replace")
    assert re.search(r"validation split", text), (
        "the difficulty footnote must say the scores are validation, because "
        "val_threshold_f1 is what the sidecar files record"
    )


def test_no_placeholder_numbers_remain(page_text):
    """Guards against shipping a template value left over from drafting."""
    for placeholder in ("XX%", "TODO", "lorem", "??%"):
        assert placeholder.lower() not in page_text.lower(), (
            f"accuracy.html still contains the placeholder {placeholder!r}"
        )
