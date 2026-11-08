"""catalog/plugin.yaml must name the package the way Hermes Desktop reads it.

Desktop's installer takes the package name from a `name:` line at the start of a line
(apps/desktop/electron/desktop-plugin-install.ts, detectPluginComponents). A JSON
manifest has no such line, so Desktop fell back to the folder name and installed the
desktop half as `desktop-plugins/catalog` (#1).
"""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DESKTOP_NAME = re.compile(r"""^name:\s*['"]?([^'"\n]+)['"]?\s*$""", re.M)


def parse_flat_yaml(text):
    """The manifest is flat: one `key: value` per line, each value a JSON scalar or []."""
    out = {}
    for line in text.splitlines():
        if not line.strip():
            continue
        key, sep, value = line.partition(": ")
        assert sep and key == key.strip() and key.isidentifier(), line
        out[key] = json.loads(value)
    return out


class CatalogManifest(unittest.TestCase):
    def setUp(self):
        self.text = (ROOT / "catalog" / "plugin.yaml").read_text(encoding="utf-8")
        self.config = json.loads((ROOT / "catalog-package.json").read_text(encoding="utf-8"))

    def test_desktop_reads_the_package_name(self):
        match = DESKTOP_NAME.search(self.text)
        self.assertIsNotNone(match, "Desktop finds no name: line and falls back to the folder name")
        self.assertEqual(match.group(1).strip(), self.config["name"])

    def test_manifest_fields(self):
        manifest = parse_flat_yaml(self.text)
        self.assertEqual(manifest["name"], self.config["name"])
        self.assertEqual(manifest["version"], self.config["version"])
        self.assertEqual(manifest["description"], self.config["description"])
        self.assertEqual(manifest["manifest_version"], 1)
        self.assertEqual(manifest["kind"], "standalone")
        for key in ("provides_tools", "provides_hooks", "provides_middleware", "requires_env"):
            self.assertEqual(manifest[key], [])


if __name__ == "__main__":
    unittest.main()
