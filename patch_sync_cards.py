#!/usr/bin/env python3
"""
Patch the existing Union Arena Rugia scraper so image-based keywords survive
HTML parsing as [[UAIMG:URL]] tokens.

Run from the repository root:
    python patch_sync_cards.py

It edits scripts/sync_cards.py in place. Make a backup first if desired.
"""

from pathlib import Path
import re
import shutil

TARGET = Path("scripts/sync_cards.py")
if not TARGET.exists():
    raise SystemExit("ERROR: scripts/sync_cards.py was not found. Run this from your repo root.")

src = TARGET.read_text(encoding="utf-8")
backup = TARGET.with_suffix(".py.before-image-fix")
if not backup.exists():
    shutil.copy2(TARGET, backup)

new_image_fn = r