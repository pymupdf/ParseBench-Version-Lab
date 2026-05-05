"""Test case management for inference and evaluation."""

from parse_bench.test_cases.loader import load_test_case, load_test_cases
from parse_bench.test_cases.schema import (
    BaseTestCase,
    ExtractFieldBbox,
    ExtractFieldTestRule,
    ExtractTestCase,
    ParseTestCase,
    TestCase,
)

__all__ = [
    "BaseTestCase",
    "ExtractFieldBbox",
    "ExtractFieldTestRule",
    "ExtractTestCase",
    "ParseTestCase",
    "TestCase",
    "load_test_case",
    "load_test_cases",
]
