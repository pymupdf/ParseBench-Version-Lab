import pytest

from parse_bench.evaluation.metrics.parse.rules_formatting import LatexRule


@pytest.mark.parametrize(
    ("expected", "actual"),
    [
        # Arrow length is presentation: chemistry writes the same reaction with
        # either arrow, and the page renders both as an arrow.
        (r"A \longrightarrow B", r"A \rightarrow B"),
        (r"A \rightarrow B", r"A \longrightarrow B"),
        (r"A \to B", r"A \rightarrow B"),
        (r"A \longleftarrow B", r"A \leftarrow B"),
        (r"A \Longrightarrow B", r"A \Rightarrow B"),
        (
            r"\text{CuFeS}_2 + 4.25\text{O}_2 \longrightarrow \text{Cu}^{2+}",
            r"CuFeS_2 + 4.25O_2 \rightarrow Cu^{2+}",
        ),
    ],
)
def test_arrow_length_is_ignored(expected, actual):
    for left, right in [(expected, actual), (actual, expected)]:
        assert LatexRule({"type": "is_latex", "formula": left}).run("$" + right + "$")[0]


@pytest.mark.parametrize(
    ("expected", "actual"),
    [
        # Direction still matters, and so does the arrow being a different
        # relation entirely.
        (r"A \rightarrow B", r"A \leftarrow B"),
        (r"A \rightarrow B", r"A \leftrightarrow B"),
        (r"A \Rightarrow B", r"A \rightarrow B"),
        (r"A \rightarrow B", r"A \mapsto B"),
    ],
)
def test_direction_and_relation_still_distinguish(expected, actual):
    assert not LatexRule({"type": "is_latex", "formula": expected}).run("$" + actual + "$")[0]


def test_command_named_to_is_not_rewritten_inside_another_command():
    # \top must not become \rightarrowp via a careless \to substitution.
    assert LatexRule({"type": "is_latex", "formula": r"x^\top y"}).run(r"$x^\top y$")[0]


@pytest.mark.parametrize(
    ("expected", "actual"),
    [
        # The rewrite must fire before a digit or `_` too, or a spaced `\to 0`
        # would normalize while an unspaced `\to0` would not, and the two would
        # stop comparing equal — a regression against main, which normalized
        # neither.
        (r"\lim_{x\to0} f(x)", r"\lim_{x \to 0} f(x)"),
        (r"\lim_{x \to 0} f(x)", r"\lim_{x\to0} f(x)"),
        (r"\lim_{n\to\infty} a_n", r"\lim_{n \rightarrow \infty} a_n"),
        (r"f: A\to B", r"f: A \rightarrow B"),
    ],
)
def test_arrow_rewrite_fires_before_digits_and_underscores(expected, actual):
    assert LatexRule({"type": "is_latex", "formula": expected}).run("$" + actual + "$")[0]


@pytest.mark.parametrize(
    "formula",
    [
        # Commands that merely start with "to" keep their own meaning.
        r"x^\top y",
        r"A^\top B^\top",
    ],
)
def test_commands_beginning_with_to_are_untouched(formula):
    assert LatexRule({"type": "is_latex", "formula": formula}).run("$" + formula + "$")[0]
