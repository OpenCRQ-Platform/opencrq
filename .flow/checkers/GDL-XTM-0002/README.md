# The checker of GDL-XTM-0002

It verifies the rules of [GDL-XTM-0002](../../GDL-XTM-0002-dependency-licenses.md) in a product repository: every
dependency carries a license of `licenses.yaml` (FEP-0001 3.7).

## What it reads

For each stack of the repository, the exact packages and their licenses, with nothing to install:

| Stack | Packages | License |
|---|---|---|
| npm, Yarn 1 and Yarn 2+ | `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock` | the lock file, else the npm registry |
| Python, locked | `poetry.lock`, `uv.lock` | PyPI: `license_expression`, else `license`, else the trove classifiers |
| Python, not locked | what `uv pip compile` resolves for each `requirements*.txt`, else `pyproject.toml` or `setup.py` | PyPI |
| Rust | `cargo metadata --locked`, each workspace with its own `Cargo.lock`, but a crate reached only through a development or build dependency | `cargo metadata` |
| Maven | `mvn dependency:list` from the top `pom.xml`, but a `test` dependency | the POM, else its parents' |

It leaves out only what an ecosystem marks as never shipped - a Rust development or build dependency, a Maven test
dependency (GDL-XTM-0002's Scope) -: an npm or Python development dependency counts, since a front end may bundle it.

A stack it does not read (pnpm, Go, Gradle, Ruby, PHP, Pipenv, .NET, Dart, Deno, sbt, vcpkg, Conan, Swift, conda), a
manifest without a lock file - a Cargo workspace without its own -, a manifest it cannot parse, or a tool that fails
is a violation (GDL-XTM-0002-R004): never skipped. So are an archive kept in the repository, and a Python project that a requirements
file, `[tool.uv]`, `[tool.uv.sources]` or a `uv.toml` resolves from elsewhere than PyPI. A package an npm or Cargo lock
file takes from Git, a URL or a private registry - named by the lock file, an `.npmrc` or a `.yarnrc.yml` - is Filigran's own: its
license is the one the lock file gives - `package-lock.json`, `cargo metadata` -, which the list must hold,
`LicenseRef-Filigran-Enterprise` included, and one whose lock file gives none - Yarn's - is reported until
it is identified (GDL-XTM-0002-R014); one under a weak copyleft is reported, its source having no public address
(GDL-XTM-0002-R017); Filigran's own packages leave the third parties' notices. So are a `package.json` under another project's lock file that does not list it as a workspace, and a
Maven module only a profile declares: no lock file, or no default build, holds their packages. It reads every dependency a `pyproject.toml` asks for - its dependencies, extras, dependency groups and
build requirements -, and a `setup.py` or `setup.cfg` when the `pyproject.toml` does not say them; the licenses come
from the registries, never from what a lock file writes. On a pull request, a tool's failure is the pull request's when it changes a manifest or a lock file the tool
reads, else the default branch's. A license that is neither an SPDX expression
nor a name of the table in `check.py` cannot be read, and fails unless `licenses.yaml` identifies the package
(GDL-XTM-0002-R002, GDL-XTM-0002-R005) under a license of the list (GDL-XTM-0002-R020). A name that leaves a doubt stays out of the table: PyPI's "BSD License" classifier, which does not
say which BSD, makes each such package identified from its license text (owner, 2026-10-28). The repository's own packages - npm workspaces, Python projects, Cargo path crates, Maven
reactor modules - are left out.

It also asks each registry - npm, PyPI, crates.io, Maven Central - the license of the package's latest stable
version, once a day, and reports a package whose latest version moved to a license outside the list, or to one it
cannot read - such as ApexCharts' `SEE LICENSE IN LICENSE.md` -, unless `licenses.yaml` identifies that version: it is
replaced, not kept on its last authorized version, within 30 days of the day it left the list (GDL-XTM-0002-R003,
owner, 2026-10-28, 2026-10-30, 2026-11-09). That day is the publication of the first version of the last run of
versions outside the list, which npm and crates.io give with each version's license - a release published since does
not move it -; for PyPI and Maven Central, which give a version's license only one by one, the latest version's. On
the default branch, such a package is reported as not due yet - a warning - until its 30 days have passed, then fails
the check; it fails at once when its registry gives no date, and on a pull request that adds it or changes its version.
A package `licenses.yaml` identifies is checked the same way. A latest version its registry did not give - a rate limit,
an outage - is reported and never kept as an answer: the next run asks again; it fails the default branch, not a pull
request.

It writes `THIRD_PARTY_NOTICES` with `--notices`: each third-party package with its license and the `LICENSE`,
`NOTICE`, `COPYING` and `COPYRIGHT` files of its archive in its registry - the npm tarball, the wheel's
`.dist-info` or the sdist, the `.crate`, the jar's `META-INF` -, else the standard text of its license from the SPDX
License List; a text several packages ship word for word is written once. Each version is read once and cached:
a published version never changes. The build of each release runs it with `--notices` and ships the file; nobody
writes it by hand, and a `THIRD_PARTY_NOTICES` the repository tracks is a violation (GDL-XTM-0002-R011). With `--notices` it exits
1 only when it cannot write the notices - a stack it cannot read (GDL-XTM-0002-R004) would leave packages out -, so that a
release builds while CI reports the violations. Each run of CI reads the notices without writing them, and reports a
package whose license text it finds nowhere (GDL-XTM-0002-R012, owner, 2026-10-28).

It reads each build of a release and reports one that does not write `THIRD_PARTY_NOTICES` with the checker
(GDL-XTM-0002-R007) or does not ship it (GDL-XTM-0002-R009): the
last stage of a `Dockerfile` or a `Containerfile`, whatever its name's case or suffix - the image it ships -, or a
stage it is built from, copies the file from a stage that runs the checker with `--notices`, or runs it itself. It
reads the Dockerfile's instructions as Docker does - comments out, continued lines joined, its escape directive, the
exec form - and counts the checker only as a command, not as a word of a comment or a string; the manifest of a published package
(an npm package not private, a Python project, a crate not marked `publish = false`) names the file, and a workflow of
the repository - not a checker's own - writes it with `--notices`. A Dockerfile writes it in a stage of its own:

```dockerfile
FROM ghcr.io/astral-sh/uv:python3.13-bookworm AS notices
COPY . /src
RUN cd /src && uv run .flow/checkers/GDL-XTM-0002/check.py . --licenses .flow/licenses.yaml --notices
FROM <runtime>
COPY --from=notices /src/THIRD_PARTY_NOTICES /opt/<product>/
```

An image built without a Dockerfile - Jib in a `pom.xml` or a Gradle build, a `.ko.yaml`, a buildpacks `project.toml`
- is a violation (GDL-XTM-0002-R009): the checker does not read those builds, and never skips one.

It reads the patches a repository's manifests apply - a Yarn `patch:` resolution, a patch-package file
`patches/<name>+<version>.patch`, a Cargo `[patch]` or `[replace]` - and reports one of a dependency under a
weak-copyleft license of the list (GDL-XTM-0002-R010): its license is the one the repository uses, else its registry's. A patch
of a dependency under another license passes.

The stage needs the network, and the tool of each stack it reads - `cargo` for Rust, Maven for Java. Nothing is copied from outside (GDL-XTM-0002-R013): it reports the traces a copy leaves - a folder holding a
`SOURCE` file, a third party's `LICENSE`, `COPYING`, `NOTICE` or `OFL` file in a folder that is no project of the
repository, a header whose copyright is not Filigran's, a `*.min.js` or `*.min.css`, a `/*! … */` license banner. It
reads each font's license in its name table - `.ttf`, `.otf`, `.woff`, `.woff2` with fontTools and Brotli - and reports
one whose license is not in the list, or a font it cannot read: `.eot`, `.ttc`, `.otc`, `.pfb`, `.pfa` (GDL-XTM-0002-R015); it
reads the rights an SVG, a PNG or a JPEG declares - an SVG's `dc:rights`, `cc:license` or XMP rights in its metadata, or a
comment that names a license or a copyright, a PNG's Copyright text, a JPEG's EXIF Copyright, XMP rights, never a color
profile's, nor an editor's default metadata - and reports
one that declares a license outside the list, Filigran's own aside (GDL-XTM-0002-R016). In a folder that holds data -
`.json`, `.yaml`, `.csv`, `.xml` and the like - and no code, it reads the third party's license file and reports one
outside the list (GDL-XTM-0002-R019); such a folder, or one that holds only fonts or images, is no copy under
GDL-XTM-0002-R013. On the default branch, from
2027-03-31, it also reports the violations that remain under GDL-XTM-0002-R008.

## How to run it

```bash
uv run check.py <repository> --licenses <licenses.yaml>              # every violation
uv run check.py <repository> --licenses <licenses.yaml> --base <sha> # those a pull request adds, its base read too
uv run check.py <repository> --licenses <licenses.yaml> --notices    # writes THIRD_PARTY_NOTICES, in a release's build
uv run check.py <repository> --licenses <licenses.yaml> --sarif <file> # also the report, in Flow's profile of SARIF
uv run check.py --describe                                           # the rules it verifies, in that profile, reading nothing
uv run --with pytest --with pyyaml --with fonttools --with brotli pytest tests   # its tests, without the network
```

It exits 1 on a violation. With `--base`, it exits 1 only on a violation the pull request adds, and lists after them
those the default branch already has, which fail the default branch: the pull request that brings the checker shows
what the default branch will report once merged. In GitHub Actions each violation is an annotation, and the job summary lists them; the
job keeps the report, in Flow's profile of SARIF 2.1.0, as the artifact `flow-gdl-xtm-0002` (FEP-0010 3.2).
`--cache` keeps what the registries answered between runs; `--json` writes the violations for the Flow app.

## In a product repository

The distribution of FEP-0003 3.3 copies `check.py` to `.flow/checkers/GDL-XTM-0002/`, with a
`distributed.json` that holds the SHA-256 of each distributed file (GDL-XTM-0002-R006), `suite/licenses.yaml` to
`.flow/licenses.yaml`, and `workflow.yml` to `.github/workflows/flow-gdl-xtm-0002.yml`. The ruleset of the
default branch requires its job, `GDL-XTM-0002`. A pull request that changes a distributed file passes only with the
file as its `distributed.json` records it - the distribution's pull request in its branch and in a merge queue alike.

It reads the lock files; it may read a CycloneDX SBOM of the repository instead, through an amendment of the guideline (CTO, 2026-10-28).

## What it does not see

- A release built with `--target` an earlier stage than the last.
- A notices stage that reads part of the repository - `COPY backend /src` - while the image ships more.
- A pull request that edits the checker or its workflow and removes the check: the job runs the pull request's own
  copy. It reports a change of the distributed files (GDL-XTM-0002-R006), not one that rewrites their SHA-256 in
  `distributed.json` with them: the defence is the default branch's ruleset - an
  organization's required workflow, which runs from the central repository - and the Flow app, which reports a copy
  that differs from the distributed one.
- Whether a published package's own packaging rules keep the notices: it reads that its manifest names the file, not
  npm's `files`, Cargo's `include` and `exclude`, nor Python's `license-files` (to come).
- In a pull request, which workspace a tool's failure belongs to: it attributes it by folder, not by Cargo, npm or uv
  workspace, nor by a configuration a folder inherits from its parents, such as a root `.cargo/config.toml` (to come).
- A project, a font, an image or a copy under a folder named `build`, `dist`, `target` or `venv`, which the walk leaves
  to build output.
- A folder whose name starts with a dot, but `.github` and `.docker`.
- A manifest of an ecosystem outside its lists - Elixir, Clojure, R, Bazel, and others.
- A `pom.xml` under another that does not declare it, and a `Cargo.toml` under another's `Cargo.lock` that is not its
  member.
- A third-party package kept as a local path package - a Cargo path crate, an npm `file:` folder, a Python editable -,
  which it counts as the repository's own.
- A Maven artifact or an archive a release publishes; a Dockerfile under `build/`, `dist/`, `target/` or a dot folder;
  a published package whose own workflow does not write the notices while another workflow does.
- A patch in `.cargo/config.toml`, or in a patch-package folder other than `patches/`.
- A public package installed through a private mirror of its registry, which it takes for a private package.
- A weak-copyleft package forked and taken from Git or a private registry (GDL-XTM-0002-R010 reads only patches).
- The latest version of a Maven package whose POM's license it cannot read (GDL-XTM-0002-R003 then reports nothing).
- The day a PyPI or Maven package left the list: its 30 days run from its latest version's publication, which each
  release moves (GDL-XTM-0002-R003).
- A Maven package from a private repository, which it does not tell from Maven Central's (GDL-XTM-0002-R014).
- A copy that leaves no trace, such as a snippet pasted without its header; a copyright header outside a code file or
  without a year; a library copied with its own manifest, which it takes for a project of the repository.
- A third party's data file with no license file in its folder, or in a folder that also holds code.
- An image in a format other than SVG, PNG and JPEG; a PNG's rights in a `zTXt`, a non-XMP `iTXt` or an `eXIf` chunk;
  an SVG's metadata past its first 256 KiB.
- A font in a format other than those it reads, or embedded in a stylesheet.
- An image built by a tool other than Jib, ko and buildpacks without a Dockerfile, such as Nix, Bazel's `rules_oci`,
  apko or a Compose `dockerfile_inline`.
- A patch applied by a script - an npm `postinstall`, a Dockerfile's `RUN patch` or `sed` -, and a patch of a Python or
  a Maven dependency.
- A notice file below the top of a package's archive, named otherwise - `ThirdPartyNotices.txt`, `AUTHORS` - or larger
  than 500 KB: the notices then give the standard text of its license without the package's own copyright.
- A source address of a weak-copyleft package with no source behind it, such as a PyPI release with wheels only or a
  Maven artifact without its sources jar.
- The latest version of a package from a private registry or Git.

The guideline accepts these limits for now, since none of Filigran's repositories has them (CTO, 2026-10-29,
2026-10-30). This list is the only one: the guideline points to it, and a repository that meets a new case adds it
here or extends the checker. No review searches the code to grow it.

