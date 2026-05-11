#!/usr/bin/env python3
"""
Builds the compact dictionary.sqlite that the plugin ships.

Source: entries.parquet from MattDodsonEnglish/english-dictionary v1.0.0
(167,585 English entries swept from dictionaryapi.dev, themselves derived
from Wiktionary, licensed CC BY-SA 3.0).

We keep only the first meaning / first definition of each word's first
entry, plus a phonetic if available — enough to render a Lexophile note
without the synonym/antonym/audio/license overhead of the full schema.

Usage:
    pip install duckdb pyarrow
    python3 scripts/build-dictionary.py [--output dictionary.sqlite]

The output file is intended to ship as a release asset and is downloaded
by the plugin at first run — too large (~23MB) to bundle in main.js.
"""

import argparse
import json
import os
import sqlite3
import sys
import urllib.request

PARQUET_URL = (
    "https://github.com/MattDodsonEnglish/english-dictionary/"
    "releases/download/v1.0.0/entries.parquet"
)


def download_parquet(dest: str) -> None:
    print(f"Downloading {PARQUET_URL} -> {dest}")
    urllib.request.urlretrieve(PARQUET_URL, dest)
    print(f"  {os.path.getsize(dest) / 1024 / 1024:.1f}MB")


def convert(parquet_path: str, sqlite_path: str) -> None:
    import duckdb  # imported here so --help works without the dep

    if os.path.exists(sqlite_path):
        os.remove(sqlite_path)

    sq = sqlite3.connect(sqlite_path)
    sq.execute(
        """
        CREATE TABLE entries (
            word TEXT PRIMARY KEY,
            part_of_speech TEXT,
            definition TEXT NOT NULL,
            example TEXT,
            phonetic TEXT
        )
        """
    )
    sq.execute("CREATE INDEX idx_word_lower ON entries(LOWER(word))")

    con = duckdb.connect(":memory:")
    rows = con.execute(
        f"SELECT word, entries FROM '{parquet_path}'"
    ).fetchall()

    inserted = 0
    skipped = 0
    for word, entries_raw in rows:
        try:
            entries = (
                entries_raw
                if isinstance(entries_raw, list)
                else json.loads(entries_raw)
            )
            if not entries:
                skipped += 1
                continue
            first = entries[0]
            meanings = first.get("meanings") or []
            if not meanings:
                skipped += 1
                continue
            m = meanings[0]
            defs = m.get("definitions") or []
            if not defs:
                skipped += 1
                continue
            d = defs[0]
            phonetic = first.get("phonetic") or ""
            if not phonetic:
                for p in first.get("phonetics") or []:
                    if p.get("text"):
                        phonetic = p["text"]
                        break
            sq.execute(
                "INSERT OR IGNORE INTO entries "
                "(word, part_of_speech, definition, example, phonetic) "
                "VALUES (?, ?, ?, ?, ?)",
                (
                    word,
                    m.get("partOfSpeech", ""),
                    d.get("definition", ""),
                    d.get("example", ""),
                    phonetic,
                ),
            )
            inserted += 1
        except Exception as e:
            print(f"  skipped {word!r}: {e}", file=sys.stderr)
            skipped += 1

    sq.commit()
    sq.execute("VACUUM")
    sq.close()

    size_mb = os.path.getsize(sqlite_path) / 1024 / 1024
    print(f"Inserted {inserted:,} entries (skipped {skipped:,}); "
          f"{sqlite_path} = {size_mb:.1f}MB")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        default="dictionary.sqlite",
        help="Output SQLite path (default: dictionary.sqlite)",
    )
    parser.add_argument(
        "--parquet",
        default=None,
        help="Path to entries.parquet (downloaded if omitted)",
    )
    args = parser.parse_args()

    parquet_path = args.parquet
    cleanup_parquet = False
    if not parquet_path:
        parquet_path = "/tmp/lexophile-entries.parquet"
        if not os.path.exists(parquet_path):
            download_parquet(parquet_path)
            cleanup_parquet = True

    convert(parquet_path, args.output)

    if cleanup_parquet:
        os.remove(parquet_path)


if __name__ == "__main__":
    main()
