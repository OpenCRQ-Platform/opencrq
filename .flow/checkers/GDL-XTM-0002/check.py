# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml>=6", "fonttools>=4.47", "brotli>=1.1"]
# ///
"""The checker of GDL-XTM-0002: every dependency of a repository carries a license of `licenses.yaml`.

It reads the exact packages each lock file of the repository names - npm, Yarn, Poetry, uv, Cargo - and, without
a lock file, what `uv pip compile` resolves for a Python project and `mvn dependency:list` for a Maven one; it asks
each package's license of its public registry (npm, PyPI, Maven Central's POMs, `cargo metadata`), and checks it
against the authorized licenses (FEP-0001 3.7; the guideline's GDL-XTM-0002-R001 to GDL-XTM-0002-R006); it also asks the license of each
package's latest version, and reports a package that moved to another license and has to be replaced (GDL-XTM-0002-R003):

    uv run check.py [REPO]                       # every violation: the state of the default branch
    uv run check.py [REPO] --base <commit>       # only those a pull request adds, compared with its base
    uv run check.py [REPO] --notices             # writes THIRD_PARTY_NOTICES, in the build of a release (GDL-XTM-0002-R007)

It exits 1 when it reports a violation, 0 otherwise; with --notices, 1 only when it could not write the notices,
so that a release builds while CI reports the violations. A stack it cannot read is a violation, never skipped (GDL-XTM-0002-R004).
In GitHub Actions, each violation is an annotation and the job summary lists them.
"""
from __future__ import annotations

import argparse
import concurrent.futures as futures
import email.utils
import fnmatch
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import struct
import time
import tomllib
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field, replace
from datetime import date, timedelta
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "target", "dist", "build", ".yarn", "__pycache__", ".tox"}
UNREAD_STACKS = {          # manifests of stacks the checker does not read yet: each one is a violation (GDL-XTM-0002-R004)
    "pnpm-lock.yaml": "pnpm", "go.mod": "Go", "build.gradle": "Gradle", "build.gradle.kts": "Gradle",
    "Gemfile": "Ruby", "composer.json": "PHP", "Pipfile": "Pipenv", "packages.config": "NuGet", "pubspec.yaml": "Dart",
    "deno.json": "Deno", "deno.jsonc": "Deno", "build.sbt": "sbt", "vcpkg.json": "vcpkg", "conanfile.txt": "Conan",
    "conanfile.py": "Conan", "Package.swift": "Swift",
}
UNREAD_SUFFIXES = {".csproj": ".NET", ".fsproj": ".NET", ".vbproj": ".NET"}
SEEN_DOT_DIRS = {".github", ".docker"}       # the folders starting with a dot that hold builds


def is_dockerfile(name: str) -> bool:
    """A Dockerfile or a Containerfile, whatever its case and its suffix: Dockerfile.prod, Dockerfile-prod, prod.dockerfile."""
    n = name.lower()
    return n in {"dockerfile", "containerfile"} or n.startswith(("dockerfile.", "dockerfile-", "dockerfile_", "containerfile.",
                                                                 "containerfile-")) or n.endswith((".dockerfile", ".containerfile"))


# --- Licenses -------------------------------------------------------------------------------------------------

# Names that are not SPDX identifiers but name one license without doubt, normalized by `norm`: the names packages
# write in their metadata, PyPI's trove classifiers and the license names of Maven POMs. Anything else is a license
# the checker cannot read, which fails unless `identified` lists the package (GDL-XTM-0002-R002, GDL-XTM-0002-R005). A name that leaves a
# doubt stays out, PyPI's "BSD License" classifier among them, which does not say which BSD: each such package is
# identified from its license text (owner, 2026-10-28).
NAMES = {
    "mit": "MIT", "mit license": "MIT", "the mit license": "MIT", "mit licence": "MIT", "expat": "MIT",
    "apache 2": "Apache-2.0", "apache 2.0": "Apache-2.0", "apache-2": "Apache-2.0", "apache license 2.0": "Apache-2.0",
    "apache license, version 2.0": "Apache-2.0", "apache license version 2.0": "Apache-2.0",
    "the apache license, version 2.0": "Apache-2.0", "the apache software license, version 2.0": "Apache-2.0",
    "apache software license": "Apache-2.0", "apache software license 2.0": "Apache-2.0", "asl 2.0": "Apache-2.0",
    "apache license": "Apache-2.0", "apache": "Apache-2.0",
    "bsd 2-clause": "BSD-2-Clause", "bsd-2-clause license": "BSD-2-Clause", "simplified bsd": "BSD-2-Clause",
    "bsd 3-clause": "BSD-3-Clause", "bsd-3-clause license": "BSD-3-Clause", "new bsd license": "BSD-3-Clause",
    "the bsd 3-clause license": "BSD-3-Clause", "the new bsd license": "BSD-3-Clause", "bsd license 3": "BSD-3-Clause", "revised bsd license": "BSD-3-Clause",
    "isc license": "ISC", "isc license (iscl)": "ISC", "iscl": "ISC",
    "the unlicense": "Unlicense", "the unlicense (unlicense)": "Unlicense", "cc0": "CC0-1.0",
    "cc0 1.0 universal": "CC0-1.0", "public domain (cc0-1.0)": "CC0-1.0", "public domain, per creative commons cc0": "CC0-1.0",
    "python software foundation license": "PSF-2.0", "psf": "PSF-2.0", "psfl": "PSF-2.0",
    "mozilla public license 2.0": "MPL-2.0", "mozilla public license 2.0 (mpl 2.0)": "MPL-2.0", "mpl 2.0": "MPL-2.0",
    "eclipse public license 2.0": "EPL-2.0", "eclipse public license - v 2.0": "EPL-2.0", "epl 2.0": "EPL-2.0",
    "eclipse public license 1.0": "EPL-1.0", "eclipse public license - v 1.0": "EPL-1.0", "epl 1.0": "EPL-1.0",
    "gnu lesser general public license v3 (lgplv3)": "LGPL-3.0-only",
    "gnu lesser general public license v3 or later (lgplv3+)": "LGPL-3.0-or-later",
    "gnu lesser general public license v2 (lgplv2)": "LGPL-2.0-only",
    "gnu lesser general public license v2 or later (lgplv2+)": "LGPL-2.0-or-later",
    "gnu general public license v2 (gplv2)": "GPL-2.0-only", "gnu general public license v2 or later (gplv2+)": "GPL-2.0-or-later",
    "gnu general public license v3 (gplv3)": "GPL-3.0-only", "gnu general public license v3 or later (gplv3+)": "GPL-3.0-or-later",
    "gnu affero general public license v3": "AGPL-3.0-only", "gnu affero general public license v3 or later (agplv3+)": "AGPL-3.0-or-later",
    "historical permission notice and disclaimer (hpnd)": "HPND", "zero-clause bsd (0bsd)": "0BSD",
    "cddl + gplv2 with classpath exception": "CDDL-1.1 OR GPL-2.0-only WITH Classpath-exception-2.0",
}
URLS = {   # a POM's license URL, when its name says nothing
    "apache.org/licenses/license-2.0": "Apache-2.0", "opensource.org/licenses/mit": "MIT",
    "opensource.org/licenses/bsd-3-clause": "BSD-3-Clause", "opensource.org/licenses/bsd-2-clause": "BSD-2-Clause",
    "eclipse.org/legal/epl-2.0": "EPL-2.0", "eclipse.org/legal/epl-v20": "EPL-2.0", "mozilla.org/mpl/2.0": "MPL-2.0",
}
CLASSIFIER = re.compile(r"^License :: (?:OSI Approved :: )?(.+)$")
ID = re.compile(r"^(?:LicenseRef-[A-Za-z0-9.-]+|[A-Za-z0-9][A-Za-z0-9.+-]*)$")


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().strip(".").lower())


def spdx(raw: str | None) -> str | None:
    """The SPDX expression a license string names, or None when the checker cannot read it."""
    if not raw or not raw.strip():
        return None
    text = raw.strip()
    if norm(text) in {"unknown", "none", "n/a", "noassertion"}:
        return None                                  # a placeholder of the metadata, no license
    if len(text) > 200 or "\n" in text or text.upper().startswith("SEE LICENSE IN"):
        return None                                  # a license text, or a file: a person reads it (GDL-XTM-0002-R002)
    if norm(text) in NAMES:
        return NAMES[norm(text)]
    if re.fullmatch(r"[A-Za-z0-9.+-]+(?:\s*/\s*[A-Za-z0-9.+-]+)+", text):
        text = " OR ".join(p.strip() for p in text.split("/"))        # Cargo's legacy "MIT/Apache-2.0"
    try:
        parse(tokens(text))
    except ValueError:
        return None
    return text


def tokens(text: str) -> list[str]:
    return re.findall(r"\(|\)|[^\s()]+", text)


def parse(toks: list[str]):
    """An SPDX expression as a tree: ("OR", a, b), ("AND", a, b), or a license identifier, `WITH` included."""
    pos = 0

    def peek() -> str | None:
        return toks[pos] if pos < len(toks) else None

    def take() -> str:
        nonlocal pos
        if pos >= len(toks):
            raise ValueError("unexpected end")
        pos += 1
        return toks[pos - 1]

    def atom():
        tok = take()
        if tok == "(":
            node = either()
            if take() != ")":
                raise ValueError("unbalanced")
            return node
        if not ID.match(tok) or tok.upper() in {"AND", "OR", "WITH"}:
            raise ValueError(f"not an identifier: {tok}")
        if (peek() or "").upper() == "WITH":
            take()
            exception = take()
            if not ID.match(exception):
                raise ValueError("bad exception")
            return f"{tok} WITH {exception}"
        return tok

    def both():
        node = atom()
        while (peek() or "").upper() == "AND":
            take()
            node = ("AND", node, atom())
        return node

    def either():
        node = both()
        while (peek() or "").upper() == "OR":
            take()
            node = ("OR", node, both())
        return node

    tree = either()
    if pos != len(toks):
        raise ValueError("trailing tokens")
    return tree


def canonical(license_id: str) -> str:
    lid = license_id.strip()
    if lid.endswith("+") and "WITH" not in lid:
        lid = lid[:-1] + "-or-later"                 # the deprecated "LGPL-3.0+"
    return lid.lower()


def ids(expression: str) -> list[str]:
    """The license identifiers of an expression, its exceptions left out."""
    out = []

    def walk_tree(node):
        if isinstance(node, tuple):
            walk_tree(node[1]), walk_tree(node[2])
        else:
            out.append(node.split(" WITH ")[0])
    walk_tree(parse(tokens(expression)))
    return out


def spdx_list(cache: dict) -> set[str] | None:
    """The identifiers of the SPDX License List, lowercase, read once and cached; None when it cannot be read."""
    if "spdx:list" not in cache:
        try:
            data = fetch("https://spdx.org/licenses/licenses.json") or {}
            cache["spdx:list"] = sorted(x["licenseId"].lower() for x in data.get("licenses", []))
        except ConnectionError:
            return None
    return set(cache["spdx:list"]) or None


def allowed(expression: str, authorized: set[str]) -> bool:
    """A choice passes when one of its licenses is authorized, a combination only when each is (GDL-XTM-0002-R005)."""
    def ok(node) -> bool:
        if isinstance(node, tuple):
            op, a, b = node
            return (ok(a) or ok(b)) if op == "OR" else (ok(a) and ok(b))
        return canonical(node) in authorized
    return ok(parse(tokens(expression)))


def only_weak(expression: str, authorized: set[str], weak: set[str]) -> bool:
    """An expression that passes, and only through a weak copyleft of the list: `MIT AND MPL-2.0` is one, `MIT OR
    MPL-2.0` is not, used under the MIT (GDL-XTM-0002-R010, R017)."""
    return allowed(expression, authorized) and not allowed(expression, authorized - weak)


@dataclass
class Licenses:
    authorized: set[str]
    identified: dict[tuple[str, str, str], str]       # (ecosystem or "*", normalized name, version)
    path: Path
    sha256: str
    weak: set[str] = field(default_factory=set)        # the weak copyleft: their notices give the source's address

    def identified_as(self, p: "Package") -> str | None:
        """The license a package is identified under by hand: for its ecosystem, or for any when the entry names none."""
        name = re.sub(r"[-_.]+", "-", p.name).lower() if p.ecosystem == "pypi" else p.name.lower()
        return self.identified.get((p.ecosystem, name, p.version)) or self.identified.get(("*", name, p.version))

    @classmethod
    def load(cls, path: Path) -> "Licenses":
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        authorized = {canonical(x) for group in (data.get("authorized") or {}).values() for x in group}
        identified = {}
        for e in data.get("identified") or []:
            eco = str(e.get("ecosystem") or "*")
            name = re.sub(r"[-_.]+", "-", str(e["package"])).lower() if eco == "pypi" else str(e["package"]).lower()
            identified[(eco, name, str(e["version"]))] = str(e["license"])
        # Absolute: CI passes `.flow/licenses.yaml`, which is compared with the repository's own folders (GDL-XTM-0002-R006).
        weak = {canonical(x) for x in (data.get("authorized") or {}).get("weak-copyleft") or []}
        return cls(authorized, identified, path.resolve(), hashlib.sha256(path.read_bytes()).hexdigest(), weak)


# --- The packages of a repository ---------------------------------------------------------------------------------

@dataclass(frozen=True)
class Package:
    ecosystem: str          # npm, pypi, cargo, maven
    name: str
    version: str
    file: str               # the lock file or manifest that names it, relative to the repository
    line: int = 1
    license: str | None = None      # what its registry or its metadata says, when already known
    private: bool = False           # from a private registry or Git: its license is the one its lock file gives (GDL-XTM-0002-R004)


@dataclass
class Violation:
    rule: str
    file: str
    line: int
    message: str
    key: tuple                  # what a pull request is compared on: the package, or the stack's file
    due: str = ""               # the day it fails the default branch from, when it waits (GDL-XTM-0002-R003)

    def as_dict(self) -> dict:
        return {"rule": self.rule, "file": self.file, "line": self.line, "message": self.message, **({"due": self.due} if self.due else {})}


@dataclass
class Inventory:
    packages: list[Package] = field(default_factory=list)
    problems: list[Violation] = field(default_factory=list)        # stacks it cannot read (GDL-XTM-0002-R004)
    own: set[tuple[str, str]] = field(default_factory=set)         # the repository's own packages, left out


def walk(root: Path):
    """Every file of the repository outside dependencies and build output."""
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".") or d in SEEN_DOT_DIRS)
        for name in sorted(filenames):
            yield Path(dirpath) / name


def rel(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def line_of(text: str, needle: str) -> int:
    i = text.find(needle)
    return text.count("\n", 0, i) + 1 if i >= 0 else 1


def ancestors(path: Path, root: Path) -> list[Path]:
    """The folders from the file's own up to the repository's root."""
    return [d for d in [path.parent, *path.parent.parents] if d == root or root in d.parents]


def has_lock_above(path: Path, root: Path, names: tuple[str, ...]) -> bool:
    return any((d / n).exists() for d in ancestors(path, root) for n in names)


def npm_outside(path: Path, root: Path) -> str | None:
    """The folder of the lock file a package.json sits under without being one of its workspaces - its packages are
    in no lock file -, or None (GDL-XTM-0002-R004)."""
    top = next((d for d in ancestors(path, root) if any((d / n).exists() for n in NPM_LOCKS)), None)
    if top is None or top == path.parent:
        return None
    try:
        data = json.loads((top / "package.json").read_text(encoding="utf-8") or "{}") if (top / "package.json").exists() else {}
    except json.JSONDecodeError:
        return None                                    # its own parse error is reported on it
    spaces = data.get("workspaces") or []
    spaces = spaces.get("packages") or [] if isinstance(spaces, dict) else spaces
    folder = path.parent.relative_to(top).as_posix()
    if any(fnmatch.fnmatch(folder, str(w).rstrip("/")) for w in spaces):
        return None
    return rel(root, top) if top != root else "."


def profile_modules(path: Path) -> list[tuple[str, str]]:
    """The modules a pom.xml declares only in a profile, as (profile, module): the default build, which the checker
    reads, leaves them out (GDL-XTM-0002-R004)."""
    try:
        tree = ET.parse(path).getroot()
    except ET.ParseError:
        return []
    default = {m.text.strip() for m in tree.findall(f"{MAVEN}modules/{MAVEN}module") if m.text}
    return [(pom_text(p, "id") or "?", m.text.strip()) for p in tree.findall(f"{MAVEN}profiles/{MAVEN}profile")
            for m in p.findall(f"{MAVEN}modules/{MAVEN}module") if m.text and m.text.strip() not in default]


def cargo_locked(path: Path, root: Path) -> bool:
    """A Cargo workspace's root keeps its own Cargo.lock - a lock above it is another workspace's -; a member's
    is its workspace's, above it."""
    try:
        workspace = "workspace" in tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError):
        workspace = False
    return (path.parent / "Cargo.lock").exists() if workspace else has_lock_above(path, root, ("Cargo.lock",))


NPM_LOCKS = ("package-lock.json", "npm-shrinkwrap.json", "yarn.lock")
# The npm registry, where the checker reads licenses and archives: a package resolved elsewhere - Git, a tarball's
# URL, a private registry - may share a name and a version with an unrelated one there (GDL-XTM-0002-R004).
NPM_REGISTRIES = ("https://registry.npmjs.org/", "https://registry.yarnpkg.com/")
# An archive kept in the repository is a third party's code, not the repository's own: it comes from no registry.
ARCHIVES = (".tgz", ".tar.gz", ".tar.bz2", ".zip", ".whl", ".crate", ".jar")


def public_npm(url: str) -> bool:
    """Whether a registry's URL is the npm registry itself - its origin, not a name that starts like it."""
    return url.rstrip("/") + "/" in NPM_REGISTRIES


def npm_registries(root: Path, path: Path) -> tuple[str | None, dict[str, str]]:
    """The registries other than npm's a lock file's project resolves from: the default one, and one per scope -
    `registry=` and `@scope:registry=` of an .npmrc, `npmRegistryServer` and `npmScopes` of a .yarnrc.yml."""
    default, scopes = None, {}
    for folder in reversed(ancestors(path, root)):            # the root first: a folder nearer the lock file wins
        npmrc = folder / ".npmrc"
        if npmrc.exists():
            for line in npmrc.read_text(encoding="utf-8", errors="replace").splitlines():
                key, _, value = line.strip().partition("=")
                key, value = key.strip(), value.strip()
                if key == "registry":
                    default = None if public_npm(value) else value
                elif key.startswith("@") and key.endswith(":registry"):
                    scope = key[: -len(":registry")]
                    if public_npm(value):
                        scopes.pop(scope, None)
                    else:
                        scopes[scope] = value
        rc = folder / ".yarnrc.yml"
        if rc.exists():
            data = yaml.safe_load(rc.read_text(encoding="utf-8")) or {}
            if server := str(data.get("npmRegistryServer") or ""):
                default = None if public_npm(server) else server
            for scope, conf in (data.get("npmScopes") or {}).items():
                server = str((conf or {}).get("npmRegistryServer") or "")
                if server and not public_npm(server):
                    scopes[f"@{scope}"] = server
    return default, scopes


def npm_private(name: str, registries: tuple[str | None, dict[str, str]]) -> str | None:
    """The private registry a package without a resolved URL comes from, by its scope or the default one."""
    default, scopes = registries
    scope = name.split("/", 1)[0] if name.startswith("@") else None
    return scopes.get(scope) if scope in scopes else default


def private(inv: Inventory, ecosystem: str, name: str, version: str, where: str, line: int, license: str | None) -> None:
    """A package from a private registry or Git - Filigran's own, which their repositories check -: its license is the
    one its lock file gives, which the list must hold, `LicenseRef-Filigran-Enterprise` included (GDL-XTM-0002-R014)."""
    inv.packages.append(Package(ecosystem, name, version or "", where, line, license or "", True))


def npm_elsewhere(inv: Inventory, where: str, line: int, name: str, source: str) -> None:
    inv.problems.append(Violation("GDL-XTM-0002-R004", where, line, f"{name} comes from {source[:120]}, not the npm registry: the checker reads licenses there only",
                                  ("stack", where, name)))


def npm_lock(root: Path, path: Path, inv: Inventory) -> None:
    text = path.read_text(encoding="utf-8")
    where = rel(root, path)
    registries = npm_registries(root, path)
    if path.name != "yarn.lock":
        data = json.loads(text)
        for key, entry in (data.get("packages") or {}).items():
            # A key without node_modules/ is a workspace of the repository - its own; its dependencies are listed apart.
            if "node_modules/" not in key or entry.get("link") or not entry.get("version"):
                continue
            resolved = str(entry.get("resolved") or "")
            name = entry.get("name") or key.rsplit("node_modules/", 1)[-1]
            line = line_of(text, f'"{key}"')
            if resolved.startswith("file:"):
                if resolved.lower().endswith(ARCHIVES):   # an archive kept in the repository: a third party's
                    npm_elsewhere(inv, where, line, name, resolved)
                continue                              # a folder of the repository: its own
            if (resolved and not resolved.startswith(NPM_REGISTRIES)) or (not resolved and npm_private(name, registries)):
                private(inv, "npm", name, entry["version"], where, line, entry.get("license"))
                continue
            # The license its registry gives, not the one the lock file writes: a lock file is edited by hand too.
            inv.packages.append(Package("npm", name, entry["version"], where, line))
        if not data.get("packages") and data.get("dependencies"):
            inv.problems.append(Violation("GDL-XTM-0002-R004", where, 1, "a lockfileVersion 1 lock file: regenerate it with npm 7 or later, so that the checker reads it", ("stack", where)))
        return
    if "__metadata:" in text:                        # Yarn 2 and later
        for spec, entry in (yaml.safe_load(text) or {}).items():
            if spec == "__metadata" or not isinstance(entry, dict):
                continue
            resolution = str(entry.get("resolution", ""))
            m = re.match(r"^(@?[^@]+)@npm:(.+)$", resolution)
            if m and npm_private(m.group(1), registries):
                private(inv, "npm", m.group(1), m.group(2), where, line_of(text, f'resolution: "{resolution}"'), None)
            elif m:
                inv.packages.append(Package("npm", m.group(1), m.group(2), where, line_of(text, f'resolution: "{resolution}"')))
            elif "@workspace:" in resolution or "@link:" in resolution or "@portal:" in resolution:
                inv.own.add(("npm", resolution.split("@workspace:")[0].split("@link:")[0].split("@portal:")[0]))
            elif "@patch:" not in resolution and (named := re.match(r"^(@?[^@]+)@", resolution)):
                private(inv, "npm", named.group(1), str(entry.get("version") or ""), where, line_of(text, resolution), None)
        return
    # Yarn 1: each entry a header line, then its fields indented, `resolved` among them.
    for m in re.finditer(r'^("?)(@?[^@\s"]+)@[^\n]*:\n((?:  [^\n]*\n?)*)', text, re.MULTILINE):
        header = m.group(0).split("\n", 1)[0]
        version = re.search(r'^  version "([^"]+)"', m.group(3), re.MULTILINE)
        resolved = re.search(r'^  resolved "([^"]+)"', m.group(3), re.MULTILINE)
        line = text.count("\n", 0, m.start()) + 1
        source = resolved.group(1) if resolved else ""
        if any(s in header for s in ("file:", "link:", "workspace:")):
            if source.lower().split("#")[0].endswith(ARCHIVES) or re.search(r"file:[^\s\",]*(\.tgz|\.tar\.gz|\.zip)", header):
                npm_elsewhere(inv, where, line, m.group(2), source or header)
            continue
        if not version:
            continue
        # The name the registry knows it by - an alias `name@npm:other@range` installs `other` -, from its URL.
        real = re.match(r"https://registry\.(?:yarnpkg\.com|npmjs\.org)/(.+?)/-/", source)
        name = urllib.parse.unquote(real.group(1)) if real else m.group(2)
        if aliased := re.search(r"@npm:(@?[^@\s\",]+)@", header):
            name = real and name or aliased.group(1)
        if ((source and not source.startswith(NPM_REGISTRIES)) or (not source and npm_private(name, registries))
                or re.search(r"@(git[+:]|github:|https?:)", header)):
            private(inv, "npm", name, version.group(1), where, line, None)
            continue
        inv.packages.append(Package("npm", name, version.group(1), where, line))


PY_LOCKS = ("poetry.lock", "uv.lock")
REQUIREMENTS = re.compile(r"(^|[-_.])requirements([-_.][^/]*)?\.txt$")


def requirements_file(path: Path) -> bool:
    """A pip requirements file: requirements*.txt, or any .txt of a folder named requirements."""
    return bool(REQUIREMENTS.search(path.name)) or (path.parent.name == "requirements" and path.suffix == ".txt")


def static_dependencies(folder: Path) -> bool:
    """Whether the folder's pyproject.toml says its dependencies itself - not `dynamic`, not left to setup.py."""
    try:
        project = tomllib.loads((folder / "pyproject.toml").read_text(encoding="utf-8")).get("project") or {}
    except (OSError, tomllib.TOMLDecodeError):
        return False
    return "dependencies" in project and "dependencies" not in (project.get("dynamic") or [])


def uv_workspace_locked(path: Path, root: Path) -> bool:
    """Whether a pyproject.toml is a member of a uv workspace whose root holds uv.lock: the lock holds it."""
    for folder in ancestors(path, root)[1:]:
        if not (folder / "uv.lock").exists() or not (folder / "pyproject.toml").exists():
            continue
        try:
            ws = ((tomllib.loads((folder / "pyproject.toml").read_text(encoding="utf-8")).get("tool") or {}).get("uv") or {}).get("workspace") or {}
        except tomllib.TOMLDecodeError:
            continue
        member = path.parent.relative_to(folder).as_posix()
        if any(fnmatch.fnmatch(member, g) for g in ws.get("members") or []) and not any(fnmatch.fnmatch(member, g) for g in ws.get("exclude") or []):
            return True
    return False


def py_names(path: Path) -> set[str]:
    """The names a Python project of the repository publishes: its own packages."""
    names = set()
    try:
        if path.name == "pyproject.toml":
            data = tomllib.loads(path.read_text(encoding="utf-8"))
            for n in ((data.get("project") or {}).get("name"), ((data.get("tool") or {}).get("poetry") or {}).get("name")):
                if n:
                    names.add(n)
        elif path.name == "setup.cfg":
            m = re.search(r"^\s*name\s*=\s*(\S+)", path.read_text(encoding="utf-8"), re.MULTILINE)
            if m:
                names.add(m.group(1))
    except (OSError, tomllib.TOMLDecodeError):
        pass
    return {re.sub(r"[-_.]+", "-", n).lower() for n in names}


# The index the checker reads licenses and archives on: a package of another index may share a name and a version
# with an unrelated one of PyPI (GDL-XTM-0002-R004).
PYPI = {"https://pypi.org/simple", "https://pypi.python.org/simple"}


def py_lock(root: Path, path: Path, inv: Inventory) -> None:
    text = path.read_text(encoding="utf-8")
    where = rel(root, path)
    for pkg in tomllib.loads(text).get("package") or []:
        source = pkg.get("source") or {}
        poetry = path.name == "poetry.lock"
        kind = source.get("type") if poetry else next(iter(source), "registry")
        index = str((source.get("url") if poetry else source.get("registry")) or "").rstrip("/")
        if kind in {"directory", "editable", "virtual", "workspace"}:
            inv.own.add(("pypi", re.sub(r"[-_.]+", "-", pkg["name"]).lower()))
        elif kind in {None, "registry", "legacy"} and (not index or index in PYPI) and pkg.get("version"):
            inv.packages.append(Package("pypi", pkg["name"], pkg["version"], where, line_of(text, f'name = "{pkg["name"]}"')))
        elif kind == "file":                          # an archive kept in the repository: a third party's (GDL-XTM-0002-R004)
            inv.problems.append(Violation("GDL-XTM-0002-R004", where, line_of(text, f'name = "{pkg["name"]}"'), f"{pkg['name']} is an archive kept in the repository: the checker cannot read its license", ("stack", where, pkg["name"])))
        else:                                         # a private index, a URL or Git: its lock file gives no license
            private(inv, "pypi", pkg["name"], str(pkg.get("version") or ""), where, line_of(text, f'name = "{pkg["name"]}"'), None)


INCLUDE_OPTION = re.compile(r"^\s*(?:-r|-c|--requirement|--constraint)(?:\s+|=)(\S+)", re.MULTILINE)
INDEX_OPTION = re.compile(r"^\s*(?:-i|--index-url|--extra-index-url|-f|--find-links)(?:\s+|=)(\S+)", re.MULTILINE)


def py_indexes(path: Path, seen: set[Path] | None = None) -> list[str]:
    """The indexes other than PyPI a Python project resolves from: a requirements file's options, the
    `[tool.uv]` of its pyproject.toml, or a uv.toml beside it."""
    seen = {path.resolve()} if seen is None else seen
    out = []
    text = path.read_text(encoding="utf-8", errors="replace")
    if path.suffix == ".txt" or path.name.endswith(".in"):
        out += INDEX_OPTION.findall(text)
        # The files it includes - `-r`, `-c` - name indexes too, which uv honours.
        for included in INCLUDE_OPTION.findall(text):
            target = (path.parent / included).resolve()
            if target.is_file() and target != path.resolve() and seen is not None and target not in seen:
                seen.add(target)
                out += py_indexes(target, seen)
    configs = []
    if path.name == "pyproject.toml":
        configs.append(((tomllib.loads(text).get("tool") or {}).get("uv") or {}))
    if (path.parent / "uv.toml").exists():
        configs.append(tomllib.loads((path.parent / "uv.toml").read_text(encoding="utf-8")))
    for c in configs:
        out += [str(c[k]) for k in ("index-url", "extra-index-url") if isinstance(c.get(k), str)]
        out += [str(u) for k in ("extra-index-url", "find-links") if isinstance(c.get(k), list) for u in c[k]]
        out += [str(i.get("url", "")) for i in c.get("index") or [] if isinstance(i, dict)]
    return [u for u in out if u.rstrip("/") not in PYPI]


def py_inputs(path: Path) -> list[str] | None:
    """Everything a pyproject.toml asks to install - its dependencies, its extras, its dependency groups and what
    builds it - as requirement lines; None when it is Poetry's own format, which only its lock file reads."""
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    project = data.get("project") or {}
    poetry = (data.get("tool") or {}).get("poetry") or {}
    if not project and (poetry.get("dependencies") or poetry.get("group")):
        return None
    lines = list(project.get("dependencies") or [])
    lines += [d for extra in (project.get("optional-dependencies") or {}).values() for d in extra]
    lines += [d for group in (data.get("dependency-groups") or {}).values() for d in group if isinstance(d, str)]
    lines += list((data.get("build-system") or {}).get("requires") or [])
    own = re.sub(r"[-_.]+", "-", str(project.get("name", ""))).lower()
    # An extra that names the project itself - `app[extra]` - is the project: left out.
    return [d for d in lines if re.sub(r"[-_.]+", "-", re.split(r"[\s\[<>=!~;@]", d.strip(), maxsplit=1)[0]).lower() != own]


def py_sources(path: Path) -> dict[str, str]:
    """The packages a pyproject.toml takes from elsewhere than PyPI through `[tool.uv.sources]` - Git, a URL, an
    archive of the repository -, with where; a folder of the repository or a workspace member is its own, and a
    named index is read with the indexes."""
    sources = (((tomllib.loads(path.read_text(encoding="utf-8")).get("tool") or {}).get("uv") or {}).get("sources") or {})
    out = {}
    for name, spec in sources.items():
        for one in spec if isinstance(spec, list) else [spec]:
            if not isinstance(one, dict):
                continue
            where = one.get("git") or one.get("url") or (one.get("path") if str(one.get("path", "")).lower().endswith(ARCHIVES) else None)
            if where:
                out[re.sub(r"[-_.]+", "-", name).lower()] = str(where)
    return out


def py_resolve(root: Path, path: Path, inv: Inventory, only_build: bool = False) -> None:
    """A Python project without a lock file: the packages `uv pip compile` resolves for it - for a pyproject.toml,
    everything it asks to install; with `only_build`, what builds a locked project, which its lock file leaves out."""
    where = rel(root, path)
    if indexes := py_indexes(path):
        inv.problems.append(Violation("GDL-XTM-0002-R004", where, 1, f"it resolves from {indexes[0][:120]}, not PyPI: the checker reads licenses on PyPI only", ("stack", where)))
        return
    source = path.name
    tmp = None
    if path.name == "pyproject.toml":
        if only_build:
            lines = list((tomllib.loads(path.read_text(encoding="utf-8")).get("build-system") or {}).get("requires") or [])
        elif (lines := py_inputs(path)) is None:
            inv.problems.append(Violation("GDL-XTM-0002-R004", where, 1, "a Poetry project without poetry.lock: the checker cannot read the exact packages it installs", ("stack", where)))
            return
        else:
            # A package `[tool.uv.sources]` takes from Git, a URL or an archive: no registry says its license, and
            # the temporary requirements below would resolve it from PyPI instead.
            elsewhere = py_sources(path)
            for name, origin in elsewhere.items():
                inv.problems.append(Violation("GDL-XTM-0002-R004", where, 1, f"{name} comes from {origin[:120]}, no registry: the checker cannot read its license", ("stack", where, name)))
            lines = [d for d in lines if re.sub(r"[-_.]+", "-", re.split(r"[\s\[<>=!~;@]", d.strip(), maxsplit=1)[0]).lower() not in elsewhere]
        if not lines:
            return
        tmp = tempfile.NamedTemporaryFile("w", suffix=".in", prefix=".flow-requirements-", dir=path.parent, delete=False, encoding="utf-8")
        tmp.write("\n".join(lines) + "\n")
        tmp.close()
        source = Path(tmp.name).name
    uv = shutil.which("uv")
    try:
        if not uv:
            inv.problems.append(Violation("GDL-XTM-0002-R004", where, 1, "uv is not installed: the checker cannot resolve this Python project", ("tool", where)))
            return
        out = subprocess.run([uv, "pip", "compile", source, "--universal", "--no-header", "--no-annotate", "--quiet",
                              "--index-url", "https://pypi.org/simple"],
                             cwd=path.parent, capture_output=True, text=True, timeout=600)
    finally:
        if tmp:
            Path(tmp.name).unlink(missing_ok=True)
    if out.returncode:
        reason = (out.stderr.strip().splitlines() or ["unknown error"])[-1][:200]
        inv.problems.append(Violation("GDL-XTM-0002-R004", where, 1, f"uv cannot resolve it ({reason}): the checker cannot read its dependencies", ("tool", where)))
        return
    manifest = path.read_text(encoding="utf-8", errors="replace")
    for line in out.stdout.splitlines():
        line = line.split(";")[0].strip()
        if (line.startswith("-e ") or " @ file:" in line) and not line.split("#")[0].lower().endswith(ARCHIVES):
            continue                                  # a folder of the repository: its own
        if " @ " in line:                             # a URL or a Git repository: no registry says its license
            name, url = (x.strip() for x in line.split(" @ ", 1))
            inv.problems.append(Violation("GDL-XTM-0002-R004", where, 1, f"{name} comes from {url[:120]}, no registry: the checker cannot read its license", ("stack", where, name)))
            continue
        m = re.match(r"^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?==([^\s]+)$", line)
        if m:
            direct = re.search(rf"^\s*{re.escape(m.group(1))}\b", manifest, re.IGNORECASE | re.MULTILINE)
            inv.packages.append(Package("pypi", m.group(1), m.group(2), where, manifest.count("\n", 0, direct.start()) + 1 if direct else 1))


# The sources of crates.io's crates: a crate from Git or another registry is not the crate crates.io names (GDL-XTM-0002-R004).
CRATES_IO = {"registry+https://github.com/rust-lang/crates.io-index", "sparse+https://index.crates.io/"}


def cargo_shipped(data: dict) -> set[str] | None:
    """The packages a build links into what it ships: those the workspace's members reach through normal
    dependencies, never through a development or a build one (GDL-XTM-0002's Scope); None without the resolved graph."""
    nodes = {n["id"]: n for n in (data.get("resolve") or {}).get("nodes") or []}
    if not nodes:
        return None
    shipped, todo = set(), list(data.get("workspace_members") or [])
    while todo:
        pid = todo.pop()
        if pid in shipped or pid not in nodes:
            continue
        shipped.add(pid)
        for dep in nodes[pid].get("deps") or []:
            if any(k.get("kind") is None for k in dep.get("dep_kinds") or [{"kind": None}]):
                todo.append(dep["pkg"])
    return shipped


def cargo(root: Path, path: Path, inv: Inventory, with_licenses: bool) -> None:
    where = rel(root, path)

    def elsewhere(name: str, version: str, license: str | None = None) -> None:
        private(inv, "cargo", name, version, where, line_of(text, f'name = "{name}"\nversion = "{version}"'), license)
    text = path.read_text(encoding="utf-8")
    exe = shutil.which("cargo")
    if with_licenses and exe:
        out = subprocess.run([exe, "metadata", "--format-version", "1", "--locked"], cwd=path.parent,
                             capture_output=True, text=True, timeout=900)
        if out.returncode == 0:
            data = json.loads(out.stdout)
            shipped = cargo_shipped(data)
            for pkg in data["packages"]:
                if shipped is not None and pkg["id"] not in shipped:
                    continue                          # a development or build dependency only: never shipped (GDL-XTM-0002's Scope)
                if pkg.get("source") is None:
                    inv.own.add(("cargo", pkg["name"]))
                elif pkg["source"] not in CRATES_IO:
                    elsewhere(pkg["name"], pkg["version"], pkg.get("license"))
                else:
                    inv.packages.append(Package("cargo", pkg["name"], pkg["version"], where,
                                                line_of(text, f'name = "{pkg["name"]}"\nversion = "{pkg["version"]}"'),
                                                pkg.get("license") or ""))
            return
        reason = (out.stderr.strip().splitlines() or ["unknown error"])[-1][:200]
        inv.problems.append(Violation("GDL-XTM-0002-R004", where, 1, f"cargo metadata fails ({reason}): the checker cannot read its licenses", ("tool", where)))
        return
    if with_licenses:
        inv.problems.append(Violation("GDL-XTM-0002-R004", where, 1, "cargo is not installed: the checker cannot read the licenses of this Rust project", ("tool", where)))
        return
    for pkg in tomllib.loads(text).get("package") or []:
        if pkg.get("source") in CRATES_IO:
            inv.packages.append(Package("cargo", pkg["name"], pkg["version"], where))
        elif pkg.get("source"):
            elsewhere(pkg["name"], pkg["version"])


MAVEN = "{http://maven.apache.org/POM/4.0.0}"


def pom_text(el: ET.Element | None, tag: str) -> str:
    if el is None:
        return ""
    found = el.find(MAVEN + tag)
    if found is None:
        found = el.find(tag)
    return (found.text or "").strip() if found is not None and found.text else ""


def maven(root: Path, path: Path, inv: Inventory, with_licenses: bool, offline: bool) -> None:
    where = rel(root, path)
    exe = shutil.which("mvn")
    if not exe:
        inv.problems.append(Violation("GDL-XTM-0002-R004", where, 1, "Maven is not installed: the checker cannot resolve this Maven project", ("tool", where)))
        return
    with tempfile.TemporaryDirectory() as tmp:
        listing = Path(tmp) / "deps.txt"
        cmd = [exe, "-q", "-B", "dependency:list", f"-DoutputFile={listing}", "-DappendOutput=true",
               "-DoutputAbsoluteArtifactFilename=true"]
        out = subprocess.run(cmd + (["-o"] if offline else []), cwd=path.parent, capture_output=True, text=True, timeout=1800)
        if out.returncode or not listing.exists():
            reason = next((l for l in out.stdout.splitlines() if "[ERROR]" in l), "unknown error")[:200]
            inv.problems.append(Violation("GDL-XTM-0002-R004", where, 1, f"mvn dependency:list fails ({reason}): the checker cannot read its dependencies", ("tool", where)))
            return
        seen = set()
        for line in listing.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^\s+([^:\s]+):([^:\s]+):([^:\s]+)(?::[^:\s]+)?:([^:\s]+):([a-z]+)(?::(\S+))?", line)
            if not m or (m.group(1), m.group(2), m.group(4)) in seen:
                continue
            seen.add((m.group(1), m.group(2), m.group(4)))
            if m.group(5) == "test":
                continue                              # a test dependency: never shipped (GDL-XTM-0002's Scope)
            name = f"{m.group(1)}:{m.group(2)}"
            if ("maven", name) in inv.own:
                continue
            license = maven_license(Path(m.group(6)) if m.group(6) else None, m.group(1), m.group(2), m.group(4)) if with_licenses else ""
            inv.packages.append(Package("maven", name, m.group(4), where, 1, license))


def m2() -> Path:
    return Path(os.environ.get("MAVEN_REPOSITORY", Path.home() / ".m2" / "repository"))


def maven_license(artifact: Path | None, group: str, name: str, version: str, depth: int = 0) -> str:
    """The license a POM declares, its parents' when it declares none; "" when none does."""
    # A classified artifact - name-version-tests.jar - shares the POM of its artifact, name-version.pom.
    folder = artifact.parent if artifact else m2() / group.replace(".", "/") / name / version
    pom = folder / f"{name}-{version}.pom"
    if not pom.exists() or depth > 8:
        return ""
    try:
        tree = ET.parse(pom).getroot()
    except ET.ParseError:
        return ""
    names = []
    for lic in tree.iter(MAVEN + "license"):
        label, url = pom_text(lic, "name"), pom_text(lic, "url").lower()
        mapped = NAMES.get(norm(label)) or next((v for k, v in URLS.items() if k in url), None) or spdx(label)
        names.append(mapped or f"LicenseRef-unread-{re.sub(r'[^A-Za-z0-9.-]+', '-', label)[:40] or 'none'}")
    if names:
        return " OR ".join(names) if len(names) > 1 else names[0]
    parent = tree.find(MAVEN + "parent")
    if parent is not None:
        return maven_license(None, pom_text(parent, "groupId"), pom_text(parent, "artifactId"), pom_text(parent, "version"), depth + 1)
    return ""


def reactor(root: Path) -> set[tuple[str, str]]:
    own = set()
    for path in walk(root):
        if path.name == "pom.xml":
            try:
                tree = ET.parse(path).getroot()
            except ET.ParseError:
                continue
            group = pom_text(tree, "groupId") or pom_text(tree.find(MAVEN + "parent"), "groupId")
            own.add(("maven", f"{group}:{pom_text(tree, 'artifactId')}"))
    return own


def inventory(root: Path, with_licenses: bool = True, offline: bool = False) -> Inventory:
    """Every package the repository depends on, and the stacks the checker cannot read."""
    inv = Inventory()
    files = list(walk(root))
    inv.own |= reactor(root)
    for path in files:
        if path.name in {"pyproject.toml", "setup.cfg"}:
            inv.own |= {("pypi", n) for n in py_names(path)}
    locked_py = {p.parent for p in files if p.name in PY_LOCKS}
    for path in files:
        try:
            read_one(root, path, inv, locked_py, with_licenses, offline)
        except (json.JSONDecodeError, tomllib.TOMLDecodeError, yaml.YAMLError, UnicodeDecodeError, ValueError, KeyError) as e:
            where = rel(root, path)
            inv.problems.append(Violation("GDL-XTM-0002-R004", where, 1, f"it cannot be parsed ({type(e).__name__}): the checker cannot read its dependencies", ("stack", where)))
        except subprocess.TimeoutExpired as e:            # cargo, Maven or uv took too long: a tool's failure
            where = rel(root, path)
            inv.problems.append(Violation("GDL-XTM-0002-R004", where, 1, f"{Path(str(e.cmd[0])).name} took more than {int(e.timeout)} s: the checker cannot read its dependencies", ("tool", where)))
    return inv


def read_one(root: Path, path: Path, inv: Inventory, locked_py: set[Path], with_licenses: bool, offline: bool) -> None:
    """One file of the repository: a lock file or a manifest of a stack, read into the inventory."""
    where = rel(root, path)
    if path.name in NPM_LOCKS:
        npm_lock(root, path, inv)
    elif path.name == "package.json":
        data = json.loads(path.read_text(encoding="utf-8") or "{}")
        if any(data.get(k) for k in ("dependencies", "devDependencies", "optionalDependencies")):
            if not has_lock_above(path, root, NPM_LOCKS):
                inv.problems.append(Violation("GDL-XTM-0002-R004", where, 1, "no lock file: the checker cannot read the exact packages it installs", ("stack", where)))
            elif (top := npm_outside(path, root)) is not None:
                inv.problems.append(Violation("GDL-XTM-0002-R004", where, 1, f"it is under the lock file of {top}, which does not list it as a workspace: "
                                              "no lock file holds the packages it installs", ("stack", where)))
    elif path.name in PY_LOCKS:
        py_lock(root, path, inv)
    elif path.name == "pyproject.toml":
        # Everything it asks to install - its lock file, or its uv workspace's, holds all but what builds it.
        py_resolve(root, path, inv, only_build=path.parent in locked_py or uv_workspace_locked(path, root))
    elif path.parent not in locked_py and requirements_file(path):
        py_resolve(root, path, inv)
    elif path.parent not in locked_py and (path.name == "setup.py" or (path.name == "setup.cfg" and not (path.parent / "setup.py").exists()
                                                                      and "install_requires" in path.read_text(encoding="utf-8", errors="replace"))):
        if static_dependencies(path.parent) or any(requirements_file(p) for p in path.parent.iterdir()):
            return                                # its pyproject.toml or its requirements files say them
        py_resolve(root, path, inv)
    elif path.name == "Cargo.lock":
        cargo(root, path, inv, with_licenses)
    elif path.name == "Cargo.toml" and not cargo_locked(path, root):
        inv.problems.append(Violation("GDL-XTM-0002-R004", where, 1, "no Cargo.lock: the checker cannot read the exact crates it builds", ("stack", where)))
    elif path.name == "pom.xml":
        for profile, module in profile_modules(path):
            inv.problems.append(Violation("GDL-XTM-0002-R004", where, 1, f"its module {module} is declared only in the profile {profile}: the checker reads "
                                          "the default build, without it - declare it under <modules>", ("stack", where, module)))
        if not any((d / "pom.xml").exists() for d in ancestors(path, root)[1:]):
            maven(root, path, inv, with_licenses, offline)
    elif path.name in UNREAD_STACKS or path.suffix in UNREAD_SUFFIXES or (
            path.name in {"environment.yml", "environment.yaml"} and re.search(r"^dependencies:", path.read_text(encoding="utf-8", errors="replace"), re.MULTILINE)):
        stack = UNREAD_STACKS.get(path.name) or UNREAD_SUFFIXES.get(path.suffix) or "conda"
        inv.problems.append(Violation("GDL-XTM-0002-R004", where, 1, f"{stack}: a stack the checker does not read yet", ("stack", where)))


# --- Registries ---------------------------------------------------------------------------------------------------

def fetch(url: str) -> dict | None:
    for attempt in range(3):
        wait = 1 + attempt * 2
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "filigran-flow-gdl-checker"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code == 429:                         # a registry that limits the rate says how long to wait
                retry = (e.headers or {}).get("Retry-After") or ""
                wait = max(wait, min(int(retry) if retry.isdigit() else 10, 60))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            pass
        time.sleep(wait)
    raise ConnectionError(url)


def npm_license(name: str, version: str) -> str:
    data = fetch(f"https://registry.npmjs.org/{urllib.parse.quote(name, safe='@')}/{urllib.parse.quote(version)}")
    return npm_declared(data) if data is not None else ""


def npm_declared(data: dict) -> str:
    """The license an npm version's metadata declares."""
    lic = data.get("license")
    if isinstance(lic, dict):
        lic = lic.get("type")
    if not lic and isinstance(data.get("licenses"), list):
        kinds = [x.get("type") if isinstance(x, dict) else str(x) for x in data["licenses"]]
        lic = " OR ".join(k for k in kinds if k)
    return str(lic or "")


def pypi_license(name: str, version: str) -> str:
    data = fetch(f"https://pypi.org/pypi/{urllib.parse.quote(name)}/{urllib.parse.quote(version)}/json")
    if data is None:
        return ""
    info = data.get("info") or {}
    if info.get("license_expression"):
        return info["license_expression"]
    text = (info.get("license") or "").strip()
    if text and spdx(text):
        return text
    found = []
    for c in info.get("classifiers") or []:
        m = CLASSIFIER.match(c)
        if m:
            label = m.group(1)
            inner = re.search(r"\(([A-Za-z0-9.+-]+)\)\s*$", label)
            found.append(NAMES.get(norm(label)) or (inner.group(1) if inner and ID.match(inner.group(1)) else None) or f"LicenseRef-unread-{re.sub(r'[^A-Za-z0-9.-]+', '-', label)[:40]}")
    return " OR ".join(found) if found else text


def licenses_of(packages: list[Package], cache_path: Path | None, cache: dict) -> dict[Package, str]:
    """Each package's license string, from the lock file, `cargo metadata`, a POM, or its registry - cached."""
    if cache_path and cache_path.exists():
        cache.update(json.loads(cache_path.read_text(encoding="utf-8")))
    found: dict[Package, str] = {}
    todo = []
    for p in packages:
        key = f"{p.ecosystem}:{p.name}@{p.version}"
        if p.license is not None:
            found[p] = p.license
        elif key in cache:
            found[p] = cache[key]
        else:
            todo.append(p)
    unique = {(p.ecosystem, p.name, p.version) for p in todo}
    errors: dict[tuple, str] = {}

    def one(item):
        eco, name, version = item
        if eco not in {"npm", "pypi"}:
            return item, ""                           # Cargo and Maven give theirs with the package
        try:
            return item, (npm_license if eco == "npm" else pypi_license)(name, version)
        except ConnectionError as e:
            errors[item] = str(e)
            return item, None

    with futures.ThreadPoolExecutor(max_workers=24) as pool:
        got = dict(pool.map(one, unique))
    for p in todo:
        value = got.get((p.ecosystem, p.name, p.version))
        if value is not None:
            found[p] = value
            cache[f"{p.ecosystem}:{p.name}@{p.version}"] = value
    spdx_list(cache)
    if cache_path:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(cache, sort_keys=True), encoding="utf-8")
    return found


def latest_license(ecosystem: str, name: str) -> tuple[str, str] | None:
    """The latest stable version of a package and its license, as its registry gives them; None when it gives none."""
    if ecosystem == "npm":
        data = fetch(f"https://registry.npmjs.org/{urllib.parse.quote(name, safe='@')}/latest")
        return (data["version"], npm_license(name, data["version"])) if data and data.get("version") else None
    if ecosystem == "pypi":
        data = fetch(f"https://pypi.org/pypi/{urllib.parse.quote(name)}/json")
        version = ((data or {}).get("info") or {}).get("version")
        return (version, pypi_license(name, version)) if version else None
    if ecosystem == "cargo":
        data = fetch(f"https://crates.io/api/v1/crates/{urllib.parse.quote(name)}")
        version = ((data or {}).get("crate") or {}).get("max_stable_version")
        found = next((v for v in (data or {}).get("versions") or [] if v.get("num") == version), None)
        return (version, found.get("license") or "") if found else None
    if ecosystem == "maven":
        group, artifact = name.split(":", 1)
        meta = central(f"{group.replace('.', '/')}/{artifact}/maven-metadata.xml")
        # The last stable version it lists: a pre-release, such as an alpha, does not count.
        listed = [v.text or "" for v in meta.iter("version")] if meta is not None else []
        stable = [v for v in listed if v and not re.search(r"(?i)alpha|beta|\brc|[.-]cr\d|-m\d|milestone|snapshot|preview|[.-]ea\b", v)]
        version = stable[-1] if stable else ""
        found = central_license(group, artifact, version) if version else ""
        return (version, found) if found else None
    return None


def published_on(ecosystem: str, name: str, version: str) -> str:
    """The day a version was published, as its registry gives it (YYYY-MM-DD); "" when it gives none: the 30 days of
    GDL-XTM-0002-R003 count from it."""
    try:
        if ecosystem == "npm":
            data = fetch(f"https://registry.npmjs.org/{urllib.parse.quote(name, safe='@')}")
            return str(((data or {}).get("time") or {}).get(version) or "")[:10]
        if ecosystem == "pypi":
            data = fetch(f"https://pypi.org/pypi/{urllib.parse.quote(name)}/{urllib.parse.quote(version)}/json")
            times = [u.get("upload_time_iso_8601") or u.get("upload_time") or "" for u in (data or {}).get("urls") or []]
            return min((t for t in times if t), default="")[:10]
        if ecosystem == "cargo":
            data = fetch(f"https://crates.io/api/v1/crates/{urllib.parse.quote(name)}/{urllib.parse.quote(version)}")
            return str(((data or {}).get("version") or {}).get("created_at") or "")[:10]
        if ecosystem == "maven":
            group, artifact = name.split(":", 1)
            req = urllib.request.Request(f"https://repo1.maven.org/maven2/{group.replace('.', '/')}/{artifact}/{version}/{artifact}-{version}.pom",
                                         method="HEAD", headers={"User-Agent": "filigran-flow-gdl-checker"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                modified = resp.headers.get("Last-Modified")
            return email.utils.parsedate_to_datetime(modified).date().isoformat() if modified else ""
    except (ConnectionError, urllib.error.URLError, TimeoutError, ValueError, TypeError):
        return ""
    return ""


def left_on(ecosystem: str, name: str, version: str, passes) -> str:
    """The day a package left the list after the version in use: the publication of the first version of the last run
    of stable versions whose license does not pass (YYYY-MM-DD) - a release published since does not move it; "" when
    the registry does not give each version's license at once, as npm and crates.io do (GDL-XTM-0002-R003)."""
    try:
        if ecosystem == "npm":
            data = fetch(f"https://registry.npmjs.org/{urllib.parse.quote(name, safe='@')}") or {}
            times = data.get("time") or {}
            history = [(str(times.get(v) or ""), v, npm_declared(m)) for v, m in (data.get("versions") or {}).items()
                       if isinstance(m, dict)]
        elif ecosystem == "cargo":
            data = fetch(f"https://crates.io/api/v1/crates/{urllib.parse.quote(name)}") or {}
            history = [(str(v.get("created_at") or ""), str(v.get("num") or ""), v.get("license") or "")
                       for v in data.get("versions") or [] if not v.get("yanked")]
        else:
            return ""
    except ConnectionError:
        return ""
    since = next((day for day, v, _ in history if v == version), "")
    first = ""
    for day, v, raw in sorted(h for h in history if h[0] and h[0] > since and "-" not in h[1]):
        first = "" if passes(v, raw) else (first or day)
    return first[:10]


def central(path: str) -> ET.Element | None:
    """An XML file of Maven Central, parsed; None when it has none."""
    try:
        req = urllib.request.Request(f"https://repo1.maven.org/maven2/{path}", headers={"User-Agent": "filigran-flow-gdl-checker"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            return ET.fromstring(resp.read())
    except (urllib.error.URLError, TimeoutError, ET.ParseError):
        return None


def central_license(group: str, artifact: str, version: str, depth: int = 0) -> str:
    """The license a POM of Maven Central declares, its parents' when it declares none; "" when none does or one
    cannot be read."""
    pom = central(f"{group.replace('.', '/')}/{artifact}/{version}/{artifact}-{version}.pom") if depth <= 8 else None
    if pom is None:
        return ""
    names = [NAMES.get(norm(pom_text(lic, "name"))) or next((v for k, v in URLS.items() if k in pom_text(lic, "url").lower()), None)
             or spdx(pom_text(lic, "name")) for lic in pom.iter(MAVEN + "license")]
    if names:
        return " OR ".join(names) if all(names) else ""
    parent = pom.find(MAVEN + "parent")
    if parent is None:
        return ""
    return central_license(pom_text(parent, "groupId"), pom_text(parent, "artifactId"), pom_text(parent, "version"), depth + 1)


def latest_licenses(packages: list[Package], cache: dict) -> dict[tuple[str, str], tuple[str, str] | None]:
    """The latest version and license of each package, read once a day: a license a new version moves to (GDL-XTM-0002-R003);
    None for a package whose registry did not answer, which is not kept: the next run asks again."""
    today = time.strftime("%Y-%m-%d")
    out: dict[tuple[str, str], tuple[str, str]] = {}
    todo = []
    for item in {(p.ecosystem, p.name) for p in packages}:
        key = f"latest:{item[0]}:{item[1]}:{today}"
        if key in cache:
            if cache[key]:
                out[item] = tuple(cache[key])
        else:
            todo.append(item)

    def one(item):
        try:
            return item, latest_license(*item), True
        except ConnectionError:
            return item, None, False                  # unread: reported, and asked again on the next run (GDL-XTM-0002-R003)
    with futures.ThreadPoolExecutor(max_workers=24) as pool:
        for item, got, answered in pool.map(one, todo):
            if not answered:
                out[item] = None
                continue
            cache[f"latest:{item[0]}:{item[1]}:{today}"] = list(got) if got else None
            if got:
                out[item] = got
    return out


# --- The notices a release ships (GDL-XTM-0002-R007) ---------------------------------------------------------------------------

NOTICES = "THIRD_PARTY_NOTICES"
NOTICE_NAMES = ("LICENSE", "LICENCE", "COPYING", "NOTICE", "COPYRIGHT")
RULE = "=" * 100


def download(url: str) -> bytes | None:
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "filigran-flow-gdl-checker"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
        except (urllib.error.URLError, TimeoutError):
            pass
        time.sleep(1 + attempt * 2)
    raise ConnectionError(url)


def is_notice(name: str) -> bool:
    return name.upper().startswith(NOTICE_NAMES)


def archive_notices(data: bytes, kind: str, folder) -> list[tuple[str, str]]:
    """The license, notice and copyright files of a package's archive, in the folders `folder` accepts."""
    def wanted(path: str) -> bool:
        parts = path.strip("/").split("/")
        return is_notice(parts[-1]) and folder(parts[:-1])
    out = []
    if kind == "zip":
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            for m in z.infolist():
                if not m.is_dir() and m.file_size < 500_000 and wanted(m.filename):
                    out.append((m.filename.rsplit("/", 1)[-1], z.read(m).decode("utf-8", errors="replace")))
    else:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
            for m in tar.getmembers():
                if m.isfile() and m.size < 500_000 and wanted(m.name):
                    out.append((m.name.rsplit("/", 1)[-1], tar.extractfile(m).read().decode("utf-8", errors="replace")))
    return sorted(out)


def package_notices(p: Package) -> list[tuple[str, str]]:
    """The license, notice and copyright files a package ships, read from its archive in its registry."""
    if p.ecosystem == "npm":
        meta = fetch(f"https://registry.npmjs.org/{urllib.parse.quote(p.name, safe='@')}/{urllib.parse.quote(p.version)}")
        url = ((meta or {}).get("dist") or {}).get("tarball")
        data = download(url) if url else None
        return archive_notices(data, "tgz", lambda d: len(d) == 1) if data else []
    if p.ecosystem == "pypi":
        meta = fetch(f"https://pypi.org/pypi/{urllib.parse.quote(p.name)}/{urllib.parse.quote(p.version)}/json") or {}
        files = meta.get("urls") or []
        wheel = next((f for f in files if f.get("packagetype") == "bdist_wheel"), None)
        sdist = next((f for f in files if f.get("packagetype") == "sdist" and f.get("url", "").endswith(".tar.gz")), None)
        if wheel and (data := download(wheel["url"])):
            found = archive_notices(data, "zip", lambda d: bool(d) and d[0].endswith(".dist-info"))
            if found:
                return found
        if sdist and (data := download(sdist["url"])):
            return archive_notices(data, "tgz", lambda d: len(d) == 1)
        return []
    if p.ecosystem == "cargo":
        data = download(f"https://static.crates.io/crates/{p.name}/{p.name}-{p.version}.crate")
        return archive_notices(data, "tgz", lambda d: len(d) == 1) if data else []
    if p.ecosystem == "maven":
        group, artifact = p.name.split(":", 1)
        # The artifact Maven resolved - from whatever repository it came -, else Central's.
        local = m2() / group.replace(".", "/") / artifact / p.version / f"{artifact}-{p.version}.jar"
        data = local.read_bytes() if local.exists() else download(f"https://repo1.maven.org/maven2/{group.replace('.', '/')}/{artifact}/{p.version}/{artifact}-{p.version}.jar")
        return archive_notices(data, "zip", lambda d: d == ["META-INF"]) if data else []
    return []


def standard_text(license_id: str, cache: dict) -> str | None:
    """The text of a license as the SPDX License List gives it."""
    key = f"spdx-text:{license_id.lower()}"
    if key not in cache:
        data = fetch(f"https://spdx.org/licenses/{urllib.parse.quote(license_id)}.json")
        cache[key] = (data or {}).get("licenseText")
    return cache[key]


def notices_of(packages: list[Package], licenses: dict[Package, str], cache: dict) -> dict[Package, list[tuple[str, str]]]:
    """Each package's notices: the files it ships, else the standard text of its license, which then carries no
    copyright of its own; an empty list when neither is found. Read once per version, which never changes."""
    out: dict[Package, list[tuple[str, str]]] = {}
    todo = []
    for p in packages:
        key = f"notices:{p.ecosystem}:{p.name}@{p.version}"
        if cache.get(key):                            # none found is read again: its license may be identified since
            out[p] = [tuple(x) for x in cache[key]]
        else:
            todo.append(p)

    def one(p):
        try:
            return p, package_notices(p)
        except (ConnectionError, tarfile.TarError, zipfile.BadZipFile, OSError):
            return p, None                            # unread: the next run reads it again
    with futures.ThreadPoolExecutor(max_workers=24) as pool:
        for p, got in pool.map(one, todo):
            if got is None:
                continue
            if not got:
                expression = spdx(licenses.get(p) or "")
                try:
                    texts = [(f"{i} (the package ships no license file: the standard text of its license)", standard_text(i, cache))
                             for i in (ids(expression) if expression else [])]
                except ConnectionError:
                    continue
                got = [(name, text) for name, text in texts if text] if texts and all(t for _, t in texts) else []
            out[p] = got
            cache[f"notices:{p.ecosystem}:{p.name}@{p.version}"] = [list(x) for x in got]
    return out


def source_url(p: Package) -> str:
    """Where the source code of a package's version is: its registry's archive of it."""
    if p.ecosystem == "cargo":
        return f"https://static.crates.io/crates/{p.name}/{p.name}-{p.version}.crate"
    if p.ecosystem == "npm":
        return f"https://registry.npmjs.org/{p.name}/-/{p.name.rsplit('/', 1)[-1]}-{p.version}.tgz"
    if p.ecosystem == "pypi":
        return f"https://pypi.org/project/{p.name}/{p.version}/#files"
    group, artifact = p.name.split(":", 1) if ":" in p.name else ("", p.name)
    return f"https://repo1.maven.org/maven2/{group.replace('.', '/')}/{artifact}/{p.version}/{artifact}-{p.version}-sources.jar"


def notices_text(packages: list[Package], licenses: dict[Package, str], notices: dict[Package, list[tuple[str, str]]],
                 weak: set[str] = frozenset(), authorized: set[str] | None = None) -> str:
    """THIRD_PARTY_NOTICES: each third-party package, its license and the notices it ships, in a stable order; for one
    under a weak copyleft of the list, where its source code is, which those licenses ask (GDL-XTM-0002-R017)."""
    lines = ["Third-party notices", "",
             "The third-party packages this repository uses, with their licenses and the notices they ship.",
             "Generated from the lock files by the checker of GDL-XTM-0002 (GDL-XTM-0002-R007): do not edit it,",
             "run `check.py --notices` again.", ""]
    # A text several packages ship word for word - the same license, the same copyright - is written once.
    first: dict[str, str] = {}
    once = {(p.ecosystem, normal(p).lower(), p.version): p for p in packages}     # a package several lock files name
    for p in sorted(once.values(), key=lambda p: (p.ecosystem, p.name.lower(), p.version)):
        label = f"{p.name} {p.version} ({p.ecosystem})"
        expression = spdx(licenses.get(p) or "")
        lines += [RULE, f"{label} - {expression or (licenses.get(p) or 'no license found').strip()}", RULE]
        # Under a weak copyleft: its expression passes only through a license of that category (GDL-XTM-0002-R010, R017).
        weak_source = only_weak(expression, authorized, weak) if expression and authorized \
            else bool(expression) and any(canonical(i) in weak for i in ids(expression))
        if expression and not p.private and weak_source:
            lines += ["", f"Its source code, under its license, is at {source_url(p)}"]
        for name, text in notices.get(p) or []:
            text = text.replace("\r\n", "\n").replace("\r", "\n").strip()
            if text in first:
                lines += ["", f"--- {name}: the same text as {first[text]}"]
            else:
                first[text] = f"{label}, {name}"
                lines += ["", f"--- {name}", "", text]
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


# --- The check ----------------------------------------------------------------------------------------------------

def published(path: Path) -> bool:
    """A package manifest of something the repository publishes: an npm package not marked private, a Python project,
    a crate not marked `publish = false`."""
    text = path.read_text(encoding="utf-8", errors="replace")
    try:
        if path.name == "package.json":
            return not json.loads(text).get("private", False)
        data = tomllib.loads(text)
    except (json.JSONDecodeError, tomllib.TOMLDecodeError, AttributeError):
        return False
    if path.name == "pyproject.toml":
        return "project" in data
    return "package" in data and data["package"].get("publish", True) is not False


# The checker run as a command - at the start of one, after `;`, `&&`, `|`, or by uv or Python -, with --notices:
# not a word of a string or of a comment.
GENERATES = re.compile(r"(?:^|[;&|(]\s*|\b(?:uv\s+run|python3?|exec)\s+(?:-\S+\s+)*)(?:\S*/)?check\.py\b[^;&|#\n]*\s--notices\b")


def command_writes(command: str) -> bool:
    """Whether a shell command runs the checker with --notices: its comments left out, and the text in quotes - an
    argument such as `echo "uv run check.py --notices"`, not a command."""
    for line in command.splitlines():
        line = re.sub(r"(^|\s)#.*$", "", line)
        line = re.sub(r"\"(?:[^\"\\]|\\.)*\"|'[^']*'", " ", line)
        if GENERATES.search(line.strip()):
            return True
    return False


def instructions(text: str) -> list[tuple[str, str]]:
    """A Dockerfile's instructions, each its keyword and its arguments on one line: comments left out - inside a
    continued instruction too -, continued lines joined, as Docker reads them (its default escape, `\\`)."""
    out: list[tuple[str, str]] = []
    current = ""
    escape = "\\"
    lines = text.splitlines()
    for raw in lines:                                 # parser directives come first: `# escape=``
        if m := re.match(r"^\s*#\s*escape\s*=\s*(\S)\s*$", raw, re.IGNORECASE):
            escape = m.group(1)
        elif not re.match(r"^\s*#\s*\w+\s*=", raw):
            break

    def add(instruction: str) -> None:
        keyword, args = (re.split(r"\s+", instruction, maxsplit=1) + [""])[:2]   # any whitespace: a tab too
        args = args.strip()
        if args.startswith("["):                      # the exec form: RUN ["uv", "run", "check.py", "--notices"]
            try:
                args = " ".join(str(a) for a in json.loads(args))
            except json.JSONDecodeError:
                pass
        out.append((keyword.upper(), args))
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        current = f"{current} {line}" if current else line
        if current.endswith(escape):
            current = current[:-1].rstrip()
            continue
        add(current)
        current = ""
    if current:
        add(current)
    return out


def image_misses(text: str) -> str | None:
    """What a Dockerfile misses to ship the notices, or None: its last stage - the image it ships -, or a stage it
    is built from, copies THIRD_PARTY_NOTICES from a stage that runs the checker with `--notices`, or runs it
    itself (GDL-XTM-0002-R007, GDL-XTM-0002-R009)."""
    stages: list[dict] = []
    for keyword, args in instructions(text):
        if keyword == "FROM":
            words = [w for w in args.split() if not w.startswith("--")]
            name = words[2].lower() if len(words) >= 3 and words[1].upper() == "AS" else ""
            stages.append({"base": words[0].lower() if words else "", "name": name, "steps": []})
        elif stages:
            stages[-1]["steps"].append((keyword, args))
    if not stages:
        return "has no FROM instruction the checker can read: no image it can tell ships the notices"
    named = {s["name"]: s for s in stages if s["name"]} | {str(i): s for i, s in enumerate(stages)}

    def chain(stage: dict) -> list[dict]:
        out: list[dict] = []
        while stage is not None and all(stage is not s for s in out):
            out.append(stage)
            stage = named.get(stage["base"])
        return out

    def writes(stage: dict) -> bool:
        return any(k == "RUN" and command_writes(a) for s in chain(stage) for k, a in s["steps"])
    if writes(stages[-1]):
        return None                                   # the image it ships writes them itself
    copies = [a for s in chain(stages[-1]) for k, a in s["steps"] if k in {"COPY", "ADD"} and NOTICES in a]
    for args in copies:
        source = re.search(r"--from=(\S+)", args)
        stage = named.get(source.group(1).lower()) if source else None
        if stage is not None and writes(stage):
            return None
    if copies:
        return f"copies {NOTICES} from no stage that runs the checker with --notices"
    return f"does not copy {NOTICES} into the image it ships, its last stage"


def workflow_writes(path: Path) -> bool:
    """Whether a workflow runs the checker with `--notices` in a step's command - not in a comment, a name or
    another key."""
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8", errors="replace")) or {}
    except yaml.YAMLError:
        return False
    for job in (data.get("jobs") or {}).values() if isinstance(data, dict) else []:
        for step in (job or {}).get("steps") or [] if isinstance(job, dict) else []:
            command = step.get("run") if isinstance(step, dict) else None
            if isinstance(command, str) and command_writes(command.replace("\\\n", " ")):
                return True
    return False


# Release builds without a Dockerfile, which the checker does not read: each one is a violation (GDL-XTM-0002-R009), never skipped.
UNREAD_BUILDS = {
    "pom.xml": ("jib-maven-plugin", "Jib"),
    "build.gradle": ("com.google.cloud.tools.jib", "Jib"),
    "build.gradle.kts": ("com.google.cloud.tools.jib", "Jib"),
    ".ko.yaml": ("", "ko"),
    "project.toml": ("[_.buildpack]", "buildpacks"),
}


def unread_build(path: Path) -> str | None:
    """The tool of a release build the checker does not read, or None."""
    needle, tool = UNREAD_BUILDS.get(path.name, (None, ""))
    if needle is None:
        return None
    return tool if not needle or needle in path.read_text(encoding="utf-8", errors="replace") else None


def shipping(root: Path) -> list[Violation]:
    """Each build of a release writes the notices and ships them (GDL-XTM-0002-R007, GDL-XTM-0002-R009): a Dockerfile runs the checker
    with `--notices` and copies THIRD_PARTY_NOTICES into the image; a published package names the file, and a
    workflow of the repository - not a checker's own - writes it."""
    workflows = root / ".github" / "workflows"
    written = workflows.is_dir() and any(workflow_writes(f) for f in workflows.iterdir()
                                         if f.suffix in {".yml", ".yaml"} and not f.name.startswith("flow-"))
    out = []
    for f in walk(root):
        if tool := unread_build(f):
            where = rel(root, f)
            out.append(Violation("GDL-XTM-0002-R009", where, 1, f"it builds an image with {tool}, which the checker does not read: build the image "
                                 f"from a Dockerfile that ships {NOTICES}", ("stack", where)))
            continue
        image = is_dockerfile(f.name)
        package = f.name in {"package.json", "pyproject.toml", "Cargo.toml"} and published(f)
        if not (image or package):
            continue
        text = f.read_text(encoding="utf-8", errors="replace")
        where = rel(root, f)
        if image:
            if missing := image_misses(text):
                # Notices copied from no stage that writes them are not the checker's (GDL-XTM-0002-R007); none copied, not shipped (R009).
                rule = "GDL-XTM-0002-R007" if missing.startswith("copies ") else "GDL-XTM-0002-R009"
                out.append(Violation(rule, where, 1, f"the image it builds {missing}", ("stack", where)))
        elif NOTICES not in text:
            out.append(Violation("GDL-XTM-0002-R009", where, 1, f"the package it publishes does not ship {NOTICES}: name it in the manifest", ("stack", where)))
        elif not written:
            out.append(Violation("GDL-XTM-0002-R007", where, 1, f"no workflow of the repository writes the {NOTICES} the package it publishes ships: "
                                 "run the checker's --notices in the workflow that publishes it", ("stack", where)))
    return out


# --- What a repository copies from outside, its fonts and its images (GDL-XTM-0002-R013, R015, R016) ------------

PROJECTS = {"package.json", "pyproject.toml", "setup.py", "Cargo.toml", "pom.xml", "build.gradle", "build.gradle.kts", "go.mod"}
THIRD_LICENSE = re.compile(r"^(LICEN[CS]E|COPYING|NOTICE|OFL)([-_][\w.-]*)?(\.(txt|md|rst))?$", re.I)
CODE_FILES = {".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".java", ".kt", ".rs", ".go", ".css", ".scss", ".less",
              ".sh", ".rb", ".php", ".c", ".h", ".cpp", ".cs", ".swift", ".vue", ".svelte"}
FONT_FILES = {".ttf", ".otf", ".woff", ".woff2", ".eot", ".ttc", ".otc", ".pfb", ".pfa"}
IMAGE_FILES = {".svg", ".png", ".jpg", ".jpeg"}
DATA_FILES = {".json", ".jsonl", ".ndjson", ".geojson", ".yaml", ".yml", ".csv", ".tsv", ".xml", ".parquet", ".txt"}


def license_file(name: str) -> bool:
    """A license file, whatever its suffix - LICENSE-MIT, COPYING.LESSER, NOTICE.txt -, never a code file named after
    licenses, such as license-expiry-utils.ts."""
    return bool(THIRD_LICENSE.match(name)) and Path(name).suffix.lower() not in CODE_FILES


def content(folder: Path) -> str | None:
    """What a folder that holds no code holds beside its license file: "data" - a third party's dataset, schema or
    bundle, which GDL-XTM-0002-R019 reads -, "asset" - fonts or images, which their metadata license
    (GDL-XTM-0002-R015, GDL-XTM-0002-R016) -, or None: a folder with code, whose third-party license marks a copy."""
    files = [p for p in folder.iterdir() if p.is_file() and not license_file(p.name)]
    suffixes = {p.suffix.lower() for p in files}
    if not files or suffixes & CODE_FILES:
        return None
    if suffixes & DATA_FILES:
        return "data"
    return "asset" if suffixes & (FONT_FILES | IMAGE_FILES) else None
FOREIGN_COPYRIGHT = re.compile(r"(?i)\b(?:copyright|\(c\)|©)[\s(c)©]*\d{4}")
BANNER = re.compile(r"^\s*/\*!.{0,400}?(@license|\(c\)|©|copyright)", re.I | re.S)
OURS = re.compile(r"(?i)filigran")
DEADLINE = "2027-03-31"          # GDL-XTM-0002-R008
REPLACE_WITHIN = 30              # days from a version's publication to replace a dependency it moved out of the list (GDL-XTM-0002-R003)


def copied(root: Path) -> list[Violation]:
    """Nothing is copied from outside (GDL-XTM-0002-R013): the traces a copy leaves - a SOURCE file, a third party's
    license file in a folder that is no project of the repository, a header that names another's copyright, a
    minified file, a license banner. A copy that leaves none is a known limit."""
    out = []

    def copy(path: Path, why: str) -> None:
        where = rel(root, path)
        out.append(Violation("GDL-XTM-0002-R013", where, 1, f"{where} {why}: take it as a dependency of its ecosystem", ("stack", where)))
    for f in walk(root):
        suffix = f.suffix.lower()
        if f.name == "SOURCE":
            copy(f.parent, "was copied from outside - its SOURCE file says from where")
        elif license_file(f.name) and f.parent != root and not any((f.parent / m).exists() for m in PROJECTS):
            if content(f.parent):
                continue                              # data, fonts or images under their own license: no copy of code
            if not OURS.search(f.read_text(encoding="utf-8", errors="replace")[:4000]):
                copy(f, "is a third party's license, in a folder that is no project of the repository")
        elif suffix in CODE_FILES:
            if f.name.endswith((".min.js", ".min.css")):
                copy(f, "is a minified file, copied from a library")
                continue
            try:
                head = "\n".join(f.read_text(encoding="utf-8", errors="replace").splitlines()[:30])
            except OSError:
                continue
            if OURS.search(head):
                continue
            if BANNER.search(head):
                copy(f, "opens with a third party's license banner")
            elif FOREIGN_COPYRIGHT.search(head):
                copy(f, "opens with a copyright that is not Filigran's")
    return out


def license_in(text: str) -> str | None:
    """The license a font's or an image's metadata declares, as an SPDX identifier; None when it names none."""
    t = text.lower()
    if "open font license" in t or "openfontlicense.org" in t or "scripts.sil.org/ofl" in t:
        return "OFL-1.1"
    if "apache license" in t and "2.0" in t or "apache.org/licenses/license-2.0" in t:
        return "Apache-2.0"
    if "creativecommons.org/publicdomain/zero" in t or re.search(r"\bcc0\b", t):
        return "CC0-1.0"
    if m := re.search(r"creativecommons\.org/licenses/(by(?:-[a-z]+)*)/(\d\.\d)", t):
        return f"CC-{m.group(1).upper()}-{m.group(2)}"
    if "community data license agreement" in t and "permissive" in t:
        return "CDLA-Permissive-2.0" if "2.0" in t else "CDLA-Permissive-1.0"
    if "mit license" in t or "permission is hereby granted, free of charge" in t:
        return "MIT"
    if m := re.search(r"\b(CC-BY(?:-[A-Z]+)*-\d\.\d|OFL-1\.1|Apache-2\.0|MIT|BSD-[23]-Clause|CC0-1\.0)\b", text):
        return m.group(1)
    return None


def font_license(path: Path) -> tuple[str | None, str]:
    """A font's license, read in its `name` table - its license (13), else its license URL (14), else its copyright
    (0) -, and what it says; an `.eot` or a font that cannot be read gives none."""
    try:
        from fontTools.ttLib import TTFont
        name = TTFont(str(path), lazy=True)["name"]
    except Exception as e:  # noqa: BLE001 - any font the reader cannot open is one whose license is not read
        return None, f"cannot be read ({type(e).__name__})"
    said = " ".join(str(name.getDebugName(n) or "") for n in (13, 14, 0)).strip()
    return license_in(said), said[:120] or "no license in its metadata"


SVG_RIGHTS = re.compile(r"(?is)<(dc:rights|cc:license|xmpRights:\w+)\b([^>]*?)(?:/>|>(.*?)</\1>)")


def image_rights(path: Path) -> str | None:
    """The rights an image declares: an SVG's metadata or comment, a PNG's Copyright or XMP text, a JPEG's EXIF
    Copyright or XMP - never an ICC color profile, whose copyright is its maker's, not the image's."""
    data = path.read_bytes()
    suffix = path.suffix.lower()
    if suffix == ".svg":
        # Only the elements that declare rights - an editor's default metadata, its format and its type, declares none.
        text = data[:262144].decode("utf-8", "replace")
        found = [" ".join(m[1:]) for meta in re.findall(r"(?is)<metadata\b.*?</metadata>", text) for m in SVG_RIGHTS.findall(meta)]
        found += re.findall(r"(?is)<!--(?:(?!-->).){0,500}?(?:license|copyright)(?:(?!-->).){0,500}-->", text)
        found = [" ".join(f.split()) for f in found if f.strip()]
        return " ".join(found)[:600] if found else None
    if suffix == ".png" and data[:8] == b"\x89PNG\r\n\x1a\n":
        i, found = 8, []
        while i + 8 <= len(data):
            length, kind = struct.unpack(">I4s", data[i:i + 8])
            body = data[i + 8:i + 8 + length]
            if kind == b"tEXt" and body.split(b"\0", 1)[0].lower() in (b"copyright", b"license", b"disclaimer"):
                found.append(body.split(b"\0", 1)[-1].decode("latin-1", "replace"))
            elif kind == b"iTXt" and body.startswith(b"XML:com.adobe.xmp\0"):
                found.append(xmp_rights(body.decode("utf-8", "replace")) or "")
            elif kind == b"IEND":
                break
            i += 12 + length
        found = [f for f in found if f]
        return " ".join(found)[:600] if found else None
    if suffix in {".jpg", ".jpeg"} and data[:2] == b"\xff\xd8":
        i, found = 2, []
        while i + 4 <= len(data) and data[i] == 0xFF:
            marker, length = data[i + 1], struct.unpack(">H", data[i + 2:i + 4])[0]
            body = data[i + 4:i + 2 + length]
            if marker == 0xE1 and body.startswith(b"Exif\0\0"):
                found.append(exif_copyright(body[6:]) or "")
            elif marker == 0xE1 and body.startswith(b"http://ns.adobe.com/xap/1.0/\0"):
                found.append(xmp_rights(body.decode("utf-8", "replace")) or "")
            if marker == 0xDA:                        # the image itself starts: no more metadata
                break
            i += 2 + length
        found = [f for f in found if f]
        return " ".join(found)[:600] if found else None
    return None


def exif_copyright(tiff: bytes) -> str | None:
    """The Copyright tag (0x8298) of an EXIF block's first image directory."""
    try:
        order = "<" if tiff[:2] == b"II" else ">"
        offset = struct.unpack(order + "I", tiff[4:8])[0]
        count = struct.unpack(order + "H", tiff[offset:offset + 2])[0]
        for n in range(count):
            entry = tiff[offset + 2 + 12 * n:offset + 14 + 12 * n]
            tag, _, size, value = struct.unpack(order + "HHII", entry)
            if tag == 0x8298:
                raw = entry[8:8 + size] if size <= 4 else tiff[value:value + size]
                return raw.rstrip(b"\0").decode("latin-1", "replace").strip() or None
    except (struct.error, IndexError):
        return None
    return None


def xmp_rights(xml: str) -> str | None:
    """What an XMP packet says of its rights: dc:rights, xmpRights, cc:license."""
    found = re.findall(r"(?is)<(dc:rights|xmpRights:\w+|cc:license)\b[^>]*?(?:/>|>(.*?)</\1>)", xml)
    attrs = re.findall(r'(?i)(?:xmpRights:WebStatement|cc:license|rdf:resource)="([^"]+)"', xml)
    text = " ".join(re.sub(r"<[^>]+>", " ", body) for _, body in found) + " " + " ".join(attrs)
    return " ".join(text.split()) or None


def assets(root: Path, authorized: set[str]) -> list[Violation]:
    """A font declares in its metadata a license of the list (GDL-XTM-0002-R015); an image that declares its rights
    declares a license of the list, unless they are Filigran's (GDL-XTM-0002-R016)."""
    out = []
    for f in walk(root):
        suffix, where = f.suffix.lower(), rel(root, f)
        if suffix in FONT_FILES:
            spdx_id, said = font_license(f)
            if spdx_id is None or not allowed(spdx_id, authorized):
                why = f"declares {spdx_id}, not a license of the list" if spdx_id else f"declares no license the checker reads ({said})"
                out.append(Violation("GDL-XTM-0002-R015", where, 1, f"the font {where} {why} - take one under a license of the list", ("stack", where)))
        elif license_file(f.name) and f.parent != root and content(f.parent) == "data":
            text = f.read_text(encoding="utf-8", errors="replace")[:20000]
            if OURS.search(text[:4000]):
                continue
            spdx_id = license_in(text)
            if spdx_id is None or not allowed(spdx_id, authorized):
                why = f"under {spdx_id}, not a license of the list" if spdx_id else "under no license the checker reads"
                out.append(Violation("GDL-XTM-0002-R019", where, 1, f"the third party's data beside {where} is {why} - take it under a license of the list", ("stack", where)))
        elif suffix in IMAGE_FILES:
            rights = image_rights(f)
            if not rights or OURS.search(rights):
                continue
            spdx_id = license_in(rights)
            if spdx_id is None or not allowed(spdx_id, authorized):
                why = f"declares {spdx_id}, not a license of the list" if spdx_id else f"declares rights with no license of the list ({' '.join(rights.split())[:80]})"
                out.append(Violation("GDL-XTM-0002-R016", where, 1, f"the image {where} {why} - replace it, or take it under a license of the list", ("stack", where)))
    return out


YARN_PATCH = re.compile(r'resolution: "(?:@[^@/"]+/)?[^@"]+@patch:((?:@[^@/"]+/)?[^@"]+)@')
PATCH_FILE = re.compile(r"^((?:@[^+]+\+)?[^+]+)\+\d[^+]*\.patch$")


def patches(root: Path) -> list[tuple[str, str, str, int]]:
    """The dependencies a repository's manifests patch, as (ecosystem, name, file, line): a Yarn `patch:` resolution,
    a patch-package file `patches/<name>+<version>.patch`, a Cargo `[patch]` or `[replace]` (GDL-XTM-0002-R010)."""
    out = []
    for f in walk(root):
        where = rel(root, f)
        if f.name == "yarn.lock":
            text = f.read_text(encoding="utf-8", errors="replace")
            for m in YARN_PATCH.finditer(text):
                out.append(("npm", m.group(1), where, text.count("\n", 0, m.start()) + 1))
        elif f.parent.name == "patches" and (m := PATCH_FILE.match(f.name)):
            out.append(("npm", m.group(1).replace("+", "/", 1) if m.group(1).startswith("@") else m.group(1), where, 1))
        elif f.name == "Cargo.toml":
            text = f.read_text(encoding="utf-8", errors="replace")
            try:
                data = tomllib.loads(text)
            except tomllib.TOMLDecodeError:
                continue
            crates = [(k, v) for table in (data.get("patch") or {}).values() if isinstance(table, dict) for k, v in table.items()]
            crates += [(k.split(":")[0], v) for k, v in (data.get("replace") or {}).items()]
            for key, spec in crates:
                name = spec.get("package", key) if isinstance(spec, dict) else key
                out.append(("cargo", name, where, line_of(text, key)))
    return out


def filigran(license: str | None) -> bool:
    """A license of Filigran's own, which only its own packages carry: they leave the third parties' notices."""
    return (license or "").startswith("LicenseRef-Filigran-")


def committed(root: Path) -> list[Violation]:
    """The notices a build writes are never committed (GDL-XTM-0002-R011): a THIRD_PARTY_NOTICES the repository tracks. A file
    the build just wrote is not tracked; outside a Git repository, or without Git, nothing tells, and nothing is reported."""
    exe = shutil.which("git")
    if exe is None:                                   # a build's stage without Git: the build writes the notices
        return []
    out = subprocess.run([exe, "-C", str(root), "ls-files", "--", NOTICES, f"*/{NOTICES}"], capture_output=True, text=True)
    return [Violation("GDL-XTM-0002-R011", f, 1, f"{f} is committed: the build of a release writes it with --notices (GDL-XTM-0002-R007) - remove it from the repository",
                      ("stack", f)) for f in out.stdout.split()] if out.returncode == 0 else []


def violations(root: Path, licenses: Licenses, cache: Path | None, write_notices: bool = False) -> list[Violation]:
    inv = inventory(root)
    out = list(inv.problems)
    packages = [p for p in dict.fromkeys(inv.packages) if (p.ecosystem, normal(p)) not in inv.own]
    cache_data: dict = {}
    found = licenses_of(packages, cache, cache_data)
    known = spdx_list(cache_data)
    public = [p for p in packages if not p.private]
    latest = latest_licenses(public, cache_data)
    # A package identified by hand gives its notice the standard text of the license it is identified under.
    named = {p: licenses.identified_as(p) or found.get(p, "") for p in packages}
    notices = notices_of(public, named, cache_data)
    # A private package gives the standard text of its license; never Filigran's own, which are no third party's, nor
    # one whose license its lock file does not give, which GDL-XTM-0002-R005 reports. One whose text could not be
    # fetched is unread, as a public package whose registry did not answer: the notices are not written without it.
    unread_private = []
    for p in packages:
        expression = spdx(named[p]) if p.private and not filigran(named[p]) else None
        if expression:
            try:
                texts = [(i, standard_text(i, cache_data)) for i in ids(expression)]
            except ConnectionError:
                unread_private.append(p)
                continue
            notices[p] = texts if texts and all(t for _, t in texts) else []
    if cache:
        cache.write_text(json.dumps(cache_data, sort_keys=True), encoding="utf-8")
    # The notices every release ships, read on each run, written by the build of a release with --notices (GDL-XTM-0002-R007).
    for p in packages:
        if p in notices and not notices[p]:
            out.append(Violation("GDL-XTM-0002-R012", p.file, p.line, f"{p.name}@{p.version} ({p.ecosystem}): no license text found in its archive nor for its license - replace it, or identify it in licenses.yaml", (p.ecosystem, normal(p).lower(), p.version)))
    unread = [p for p in packages if p not in notices and not p.private] + unread_private
    if unread:
        out.append(Violation("GDL-XTM-0002-R007", NOTICES, 1, f"the notices of {len(unread)} package(s) could not be read from their registries: the next run reads them again", ("notices",)))
    elif write_notices and inv.problems:
        # A stack the checker cannot read leaves its packages out: the notices it would write are incomplete (GDL-XTM-0002-R004).
        out.append(Violation("GDL-XTM-0002-R007", NOTICES, 1, f"{NOTICES} is not written while a stack cannot be read (GDL-XTM-0002-R004): it would leave packages out", ("notices",)))
    elif write_notices:
        (root / NOTICES).write_text(notices_text([p for p in packages if p in notices], named, notices, licenses.weak, licenses.authorized), encoding="utf-8")
    # A registry that did not answer for a latest version: GDL-XTM-0002-R003 cannot say whether the package left the list.
    unanswered = sorted(f"{e}:{n}" for (e, n), got in latest.items() if got is None)
    if unanswered:
        out.append(Violation("GDL-XTM-0002-R003", NOTICES, 1, f"the latest version of {len(unanswered)} package(s) could not be read from their registries "
                             f"({', '.join(unanswered[:5])}{', …' if len(unanswered) > 5 else ''}): the next run reads them again", ("latest",)))
    out += shipping(root)
    out += committed(root)
    # A weak-copyleft package from a private registry or Git: no public address gives its source, which the notices
    # must say (GDL-XTM-0002-R017).
    for p in packages:
        expression = spdx(named[p]) if p.private else None
        if expression and only_weak(expression, licenses.authorized, licenses.weak):
            out.append(Violation("GDL-XTM-0002-R017", p.file, p.line, f"{p.name}@{p.version} ({p.ecosystem}) is under {expression} and comes from a private "
                                 "registry or Git: the notices can give no public address of its source - take it from its public registry",
                                 (p.ecosystem, normal(p).lower(), p.version)))

    def unreadable(expression: str | None) -> bool:
        return expression is None or any(i.startswith("LicenseRef-unread") or (known and canonical(i) not in known
                                         and canonical(i) not in licenses.authorized) for i in ids(expression))

    def passes(p: Package, version: str, raw: str) -> bool:
        """Whether a version of a package is under an authorized license: one the checker reads, or the one
        licenses.yaml identifies it under (GDL-XTM-0002-R002) - a license it cannot read is not authorized."""
        named = licenses.identified_as(replace(p, version=version))
        if named is not None:
            return canonical(named) in licenses.authorized
        expression = spdx(raw)
        return not unreadable(expression) and allowed(expression, licenses.authorized)

    def moved(p: Package, where: str, key: tuple) -> None:
        """Its latest version moved to a license outside the list, or to one the checker cannot read: it is replaced,
        not kept on this one, within 30 days of the day it left the list - the first version of the run its latest
        version ends -, at once when its registry gives no date (GDL-XTM-0002-R003)."""
        version, raw = latest.get((p.ecosystem, p.name)) or (p.version, "")
        if version == p.version or passes(p, version, raw):
            return
        day = left_on(p.ecosystem, p.name, p.version, lambda v, r: passes(p, v, r)) or published_on(p.ecosystem, p.name, version)
        due = (date.fromisoformat(day) + timedelta(days=REPLACE_WITHIN)).isoformat() if day else ""
        when = f"replace the package by {due}, {REPLACE_WITHIN} days after it left the list on {day}" if due else "replace the package"
        later = spdx(raw)
        if unreadable(later):
            shown = (raw or "").strip().splitlines()[0][:60].replace("LicenseRef-unread-", "") if (raw or "").strip() else "none"
            message = (f"{where}: its latest version, {version}, is under a license the checker cannot read ({shown}) - {when}, "
                       f"or identify {version} in licenses.yaml if its license text grants one of the list")
        else:
            message = f"{where}: its latest version, {version}, is under {later}, not an authorized license - {when}"
        out.append(Violation("GDL-XTM-0002-R003", p.file, p.line, message, key, due))

    for p in packages:
        key = (p.ecosystem, normal(p).lower(), p.version)
        where = f"{p.name}@{p.version} ({p.ecosystem})"
        identified = licenses.identified_as(p)
        if identified is not None:
            read = spdx(found.get(p))                   # an identification stands only for a license it cannot read (GDL-XTM-0002-R002)
            if canonical(identified) not in licenses.authorized:    # and names an authorized one (GDL-XTM-0002-R020)
                out.append(Violation("GDL-XTM-0002-R020", p.file, p.line, f"{where} is identified under {identified}, which is not authorized", key))
            elif read and not unreadable(read):
                out.append(Violation("GDL-XTM-0002-R002", p.file, p.line, f"{where} is identified under {identified}, but its registry gives {read}: "
                                     "only a license the checker cannot read is identified - remove the entry", key))
            else:
                moved(p, where, key)
            continue
        if p not in found:
            out.append(Violation("GDL-XTM-0002-R004", p.file, p.line, f"{where}: its registry did not answer - the checker could not read its license", key))
            continue
        raw = found[p]
        expression = spdx(raw)
        if expression is not None and allowed(expression, licenses.authorized):
            moved(p, where, key)
            continue                                  # a choice with one authorized license passes, whatever the others
        if unreadable(expression) and p.private and not (raw or "").strip():
            out.append(Violation("GDL-XTM-0002-R014", p.file, p.line, f"{where}: it comes from a private registry or Git, and its lock file gives no license - declare it in its "
                                 "manifest, or identify it in licenses.yaml", key))
        elif unreadable(expression):
            shown = (raw or "").strip().splitlines()[0][:60].replace("LicenseRef-unread-", "") if raw and raw.strip() else "none"
            out.append(Violation("GDL-XTM-0002-R005", p.file, p.line, f"{where}: its license cannot be read ({shown}) - replace it, or identify it in licenses.yaml from its license text", key))
        else:
            out.append(Violation("GDL-XTM-0002-R001", p.file, p.line, f"{where} is under {expression}, not an authorized license", key))
    out += copied(root)
    out += assets(root, licenses.authorized)
    # A weak-copyleft dependency ships as its project publishes it: a patch of one is reported (GDL-XTM-0002-R010). Its license is
    # the one the repository uses, else its registry's for its latest version.
    patched = patches(root)
    by_name = {(p.ecosystem, p.name): named.get(p, "") for p in packages}
    unknown = [Package(e, n, "", f) for e, n, f, _ in patched if (e, n) not in by_name]
    latest_of = latest_licenses(unknown, cache_data) if unknown else {}
    for ecosystem, name, file, line in patched:
        expression = spdx(by_name.get((ecosystem, name)) or (latest_of.get((ecosystem, name)) or ("", ""))[1])
        if expression and only_weak(expression, licenses.authorized, licenses.weak):
            out.append(Violation("GDL-XTM-0002-R010", file, line, f"{name} is patched, under {expression}: a weak-copyleft dependency ships as its "
                                 "project publishes it - submit the change to its project", ("stack", file, name)))
    sidecar = HERE / "distributed.json"
    distributed_copy = (root / ".flow") in licenses.path.parents
    if distributed_copy and not sidecar.exists():
        out.append(Violation("GDL-XTM-0002-R006", rel(root, licenses.path), 1, f"{rel(root, HERE) if root in HERE.parents else HERE}/distributed.json is missing: "
                             "the copy cannot be told from an edit - distribute it again", ("copy",)))
    elif sidecar.exists():
        expected = json.loads(sidecar.read_text(encoding="utf-8")).get("licenses_sha256")
        if expected and expected != licenses.sha256:
            out.append(Violation("GDL-XTM-0002-R006", rel(root, licenses.path) if root in licenses.path.parents else str(licenses.path), 1,
                                 "the copy of licenses.yaml differs from the distributed one: a change goes to its source", ("copy",)))
    return sorted(out, key=lambda v: (v.file, v.line, v.rule, v.message))


def normal(p: Package) -> str:
    return re.sub(r"[-_.]+", "-", p.name).lower() if p.ecosystem == "pypi" else p.name


# The files a stack's tool reads to resolve its dependencies: a pull request that changes one owns the tool's failure.
RESOLVES = re.compile(r"(^|/)(Cargo\.toml|Cargo\.lock|rust-toolchain(\.toml)?|\.cargo/config(\.toml)?|pom\.xml|settings\.xml|\.mvn/.+|"
                      r"pyproject\.toml|setup\.py|setup\.cfg|uv\.toml|[^/]*requirements[^/]*\.txt|requirements/[^/]+\.txt|"
                      r"[^/]*constraints[^/]*\.txt|poetry\.lock|uv\.lock|\.npmrc|\.yarnrc\.yml)$")


def at_base(root: Path, base: str, authorized: set[str]) -> tuple[set[tuple], set[str], set[tuple], set[str]]:
    """The packages, the files and the violations of the repository's structure at the base commit, and the files
    the pull request changes: what it is compared with. The base resolves its own dependencies - Maven's online -,
    so that a runner without them does not lay the base's packages on the pull request. A font, an image or a third
    party's data counts only for the violation its base has, read against the pull request's list: one whose license
    a pull request changes to one off the list is the pull request's."""
    tmp = Path(tempfile.mkdtemp(prefix="flow-base-"))
    try:
        subprocess.run(["git", "-C", str(root), "worktree", "add", "--detach", "--quiet", str(tmp / "base"), base], check=True, capture_output=True)
        base_root = tmp / "base"
        inv = inventory(base_root, with_licenses=False, offline=False)
        packages = {(p.ecosystem, normal(p).lower(), p.version) for p in inv.packages}
        files = {rel(base_root, p) for p in walk(base_root)}
        structure = ({(v.rule, v.key) for v in [*inv.problems, *shipping(base_root), *copied(base_root), *committed(base_root),
                                                *assets(base_root, authorized)]
                      if v.key[0] == "stack"}
                     | {("GDL-XTM-0002-R010", ("stack", f, n)) for _, n, f, _ in patches(base_root)})
        diff = subprocess.run(["git", "-C", str(root), "diff", "--name-only", base], capture_output=True, text=True)
        untracked = subprocess.run(["git", "-C", str(root), "ls-files", "--others", "--exclude-standard"], capture_output=True, text=True)
        changed = set((diff.stdout + untracked.stdout).split())
        return packages, files, structure, changed
    finally:
        subprocess.run(["git", "-C", str(root), "worktree", "remove", "--force", str(tmp / "base")], capture_output=True)
        shutil.rmtree(tmp, ignore_errors=True)


def edited(root: Path, touched: list[str]) -> list[str]:
    """The distributed files a pull request changes that are not as a distribution wrote them: one whose SHA-256 is not
    the one a checker's distributed.json records, one no record names, one removed while a record still names it.
    The distribution's pull request passes in its branch and in a merge queue alike, whatever its branch's name; the
    records themselves and the gate, flow-checkers.yml, which is Flow's and no guideline's, are not compared."""
    recorded: dict[str, str] = {}
    records = set()
    for sidecar in sorted(root.glob(".flow/checkers/*/distributed.json")):
        records.add(rel(root, sidecar))
        try:
            files = json.loads(sidecar.read_text(encoding="utf-8")).get("files")
        except (ValueError, AttributeError):
            continue
        recorded.update(files if isinstance(files, dict) else {})
    out = []
    for path in touched:
        f = root / path
        if path in records or path == ".github/workflows/flow-checkers.yml":
            continue
        if f.is_file() and recorded.get(path) != hashlib.sha256(f.read_bytes()).hexdigest():
            out.append(path)
        elif not f.exists() and path in recorded:
            out.append(path)
    return out


def added(found: list[Violation], base_packages: set[tuple], base_files: set[str], base_structure: set[tuple],
          changed: set[str] = frozenset()) -> list[Violation]:
    """The violations a pull request adds: on a package its base does not have at that version; on the
    repository's structure - a lock file removed, a notices' copy taken out of a Dockerfile -, one its base does
    not have; a tool that fails on a file the pull request adds, or in a project whose manifests or lock files it
    changes - else the default branch's red, not the pull request's. A registry that did not answer for the
    notices or for a latest version is no pull request's."""
    out = []
    for v in found:
        if v.key in {("notices",), ("latest",)}:
            continue
        if v.key == ("copy",):
            out.append(v)
        elif v.key[0] == "stack":
            if (v.rule, v.key) not in base_structure:
                out.append(v)
        elif v.key[0] == "tool":
            folder = v.file.rsplit("/", 1)[0] + "/" if "/" in v.file else ""
            if v.file not in base_files or any(c.startswith(folder) and RESOLVES.search(c) for c in changed):
                out.append(v)
        elif v.key not in base_packages:
            out.append(v)
    return out


# The rules its guideline gives the checker - each whose Checked by names it -, which it declares (FEP-0010 3.2).
RULES = {
    "GDL-XTM-0002-R001": "Every dependency carries a license of the list",
    "GDL-XTM-0002-R002": "Only a package whose license cannot be read is identified",
    "GDL-XTM-0002-R003": "A dependency whose latest version left the list is replaced",
    "GDL-XTM-0002-R004": "A dependency the checker does not read fails the check",
    "GDL-XTM-0002-R005": "A dependency's license passes as an SPDX expression does",
    "GDL-XTM-0002-R006": "The distributed copy of the list is never edited",
    "GDL-XTM-0002-R007": "The build of a release writes its notices with the checker",
    "GDL-XTM-0002-R008": "The default branch reports no violation by the cleanup deadline",
    "GDL-XTM-0002-R009": "Every release artifact ships its notices",
    "GDL-XTM-0002-R010": "A weak-copyleft dependency never ships changed",
    "GDL-XTM-0002-R011": "THIRD_PARTY_NOTICES is never committed",
    "GDL-XTM-0002-R012": "The notices give each package's license texts",
    "GDL-XTM-0002-R013": "No code, text or skill is copied into a repository from outside",
    "GDL-XTM-0002-R014": "A private package declares its license",
    "GDL-XTM-0002-R015": "A font declares a license of the list",
    "GDL-XTM-0002-R016": "An image that declares its rights declares a license of the list",
    "GDL-XTM-0002-R017": "The notices give the source of each weak-copyleft package",
    "GDL-XTM-0002-R019": "A third party's data carries a license of the list",
    "GDL-XTM-0002-R020": "An identification names a license of the list",
}


def sarif(found: list[Violation], pull_request: bool, waiting: list[Violation] = ()) -> dict:
    """The violations in Flow's profile of SARIF 2.1.0 (FEP-0010 3.2): the rules the checker declares, each violation
    with its rule, its place and its key as a fingerprint; on a pull request, each is one it adds."""
    sidecar = HERE / "distributed.json"
    version = json.loads(sidecar.read_text(encoding="utf-8")).get("source", "") if sidecar.exists() else ""
    results = [{"ruleId": v.rule, "level": "warning" if v in waiting else "error", "message": {"text": v.message},
                "locations": [{"physicalLocation": {"artifactLocation": {"uri": v.file}, "region": {"startLine": max(1, v.line)}}}],
                "partialFingerprints": {"flow/v1": "|".join([v.rule, *map(str, v.key)])},
                **({"baselineState": "new"} if pull_request else {})} for v in found]
    return {"$schema": "https://json.schemastore.org/sarif-2.1.0.json", "version": "2.1.0", "runs": [{
        "tool": {"driver": {"name": "GDL-XTM-0002", "version": version or "unreleased",
                            "rules": [{"id": r, "shortDescription": {"text": t}} for r, t in RULES.items()]}},
        "invocations": [{"executionSuccessful": True}],
        "results": results}]}


def report(found: list[Violation], mode: str, waiting: list[Violation] = (), standing: list[Violation] = ()) -> None:
    """The violations, then, on a pull request, those the default branch already has: shown, so that the pull request
    that brings the checker shows what the default branch will report, but none fails it."""
    for v in found:
        print(f"{v.rule} {v.file}:{v.line}: {v.message}")
    print(f"\n{len(found)} violation(s) of GDL-XTM-0002 ({mode})" + (f", {len(waiting)} not due yet" if waiting else ""))
    if standing:
        print(f"\n{len(standing)} more the default branch already has - they fail the default branch, not this pull request:")
        for v in standing:
            print(f"  {v.rule} {v.file}:{v.line}: {v.message}")
    if os.environ.get("GITHUB_ACTIONS") == "true":
        for v in found[:50]:
            msg = v.message.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
            print(f"::{'warning' if v in waiting else 'error'} file={v.file},line={v.line},title={v.rule}::{msg}")
        summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary:
            lines = [f"### GDL-XTM-0002 — {len(found)} violation(s) ({mode})", ""]
            if found:
                lines += ["| Rule | File | Violation |", "|---|---|---|"]
                lines += [f"| {v.rule} | `{v.file}:{v.line}` | {v.message.replace('|', '¦')} |" for v in found[:500]]
            if standing:
                lines += ["", f"<details><summary>{len(standing)} more the default branch already has - they fail the default branch, "
                          "not this pull request</summary>", "", "| Rule | File | Violation |", "|---|---|---|"]
                lines += [f"| {v.rule} | `{v.file}:{v.line}` | {v.message.replace('|', '¦')} |" for v in standing[:500]]
                lines += ["", "</details>"]
            with open(summary, "a", encoding="utf-8") as fh:
                fh.write("\n".join(lines) + "\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("repo", nargs="?", default=".", help="the repository to check (default: the current directory)")
    parser.add_argument("--base", help="a pull request's base commit: report only the violations it adds")
    parser.add_argument("--licenses", help="licenses.yaml (default: .flow/licenses.yaml, else suite/licenses.yaml, else the one next to the checker)")
    parser.add_argument("--cache", help="a JSON file that keeps the licenses read from the registries between runs")
    parser.add_argument("--json", dest="json_out", help="also write the violations to this JSON file")
    parser.add_argument("--sarif", help="also write the violations to this file, in Flow's profile of SARIF 2.1.0 (FEP-0010 3.2)")
    parser.add_argument("--describe", action="store_true", help="print the rules it verifies, in Flow's profile of SARIF, and read nothing")
    parser.add_argument("--notices", action="store_true", help=f"write {NOTICES}, the notices the lock files make, in the build of a release (GDL-XTM-0002-R007): it exits 1 only when it cannot write them")
    args = parser.parse_args(argv)
    if args.describe:
        print(json.dumps(sarif([], False), indent=2))
        return 0
    root = Path(args.repo).resolve()
    candidates = [Path(args.licenses)] if args.licenses else [root / ".flow/licenses.yaml", root / "suite/licenses.yaml", HERE / "licenses.yaml", HERE.parents[2] / "suite/licenses.yaml"]
    path = next((p for p in candidates if p.exists()), None)
    if path is None:
        print("licenses.yaml not found: pass --licenses", file=sys.stderr)
        return 2
    notices = root / NOTICES
    before = notices.stat().st_mtime_ns if notices.exists() else None
    licenses = Licenses.load(path)
    found = violations(root, licenses, Path(args.cache) if args.cache else None, args.notices)
    mode = "every violation"
    standing: list[Violation] = []
    if args.base:
        base = at_base(root, args.base, licenses.authorized)
        every, found = found, added(found, *base)
        standing = [v for v in every if v not in found and v.key not in {("notices",), ("latest",)}]
        mode = f"added since {args.base[:12]}"
        # The distributed copy changes only as the distribution writes it: a change goes to its source.
        touched = sorted(c for c in base[3] if c.startswith(".flow/") or c.startswith(".github/workflows/flow-"))
        if changed := edited(root, touched):
            found.append(Violation("GDL-XTM-0002-R006", changed[0], 1, f"the pull request changes {len(changed)} distributed file(s) of the checker or its data: "
                                   "a change goes to the central repository, and reaches here through the distribution's pull request", ("copy",)))
    # On the default branch, a dependency to replace fails it once its 30 days have passed; a pull request that adds one
    # fails at once (GDL-XTM-0002-R003).
    today = time.strftime("%Y-%m-%d")
    waiting = [] if args.base else [v for v in found if v.due and v.due > today]
    failing = [v for v in found if v not in waiting]
    if not args.base and failing and today >= DEADLINE:
        # The default branch past the cleanup deadline: what remains breaks it too (GDL-XTM-0002-R008).
        failing.append(Violation("GDL-XTM-0002-R008", failing[0].file, failing[0].line, f"{len(failing)} violation(s) remain past {DEADLINE}, "
                                 "the date by which the default branch reports none", ("deadline",)))
        found.append(failing[-1])
    report(found, mode, waiting, standing)
    if args.json_out:
        Path(args.json_out).write_text(json.dumps([v.as_dict() for v in found], indent=2), encoding="utf-8")
    if args.sarif:
        Path(args.sarif).write_text(json.dumps(sarif(found, bool(args.base), waiting), indent=2), encoding="utf-8")
    if args.notices:
        # A release's build: it fails only without its notices; CI reports the violations.
        written = notices.exists() and notices.stat().st_mtime_ns != before
        if not written:
            print(f"{NOTICES} could not be written: see GDL-XTM-0002-R004 and GDL-XTM-0002-R007 above", file=sys.stderr)
        return 0 if written else 1
    return 1 if failing else 0


if __name__ == "__main__":
    sys.exit(main())
