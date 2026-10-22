import os

import pytest


def pytest_configure(config):
    config.addinivalue_line("markers", "image: needs the real model and espeak-ng (the test image)")


def pytest_collection_modifyitems(config, items):
    if os.path.isdir(os.environ.get("WHISPER_MODEL_DIR", "/nonexistent")):
        return
    skip = pytest.mark.skip(reason="the real model is only in the test image")
    for item in items:
        if "image" in item.keywords:
            item.add_marker(skip)
