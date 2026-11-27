# Contributing to OpenCRQ

Thank you for considering making a contribution to OpenCRQ. Any contribution that
helps us improve is valuable and much appreciated.

Do not hesitate to reach out by [email](mailto:contact@filigran.io) or on our
[Slack channel](https://community.filigran.io). We will answer as soon as
possible.

## Why contribute?

OpenCRQ is an open source platform allowing organizations to quantify their
cyber risk: for each risk scenario, it estimates the financial loss to expect
from the threats the organization faces, given the assets at stake and the
controls in place (if you want to know more about OpenCRQ, you can read the
[documentation](https://filigran.io/docs/opencrq/) or try it by
[installing it](https://filigran.io/docs/deploy/install/opencrq/)).

Whether you are an organisation or an individual working or studying in the
field of cybersecurity and cyber risk, or simply an individual looking for a
technical challenge, contributing to the OpenCRQ project may represent a great
opportunity for you.

* You can help grow the community and a tool focused on measuring cyber risk in
  terms an organisation can decide on, and therefore on better protecting our
  organisations and societies;

* You will be able to adapt the tool to your core interests and methods of work
  by developing features or fixing bugs you are most interested in;

* OpenCRQ is also an interesting opportunity for developers to work on modern
  technologies such as a TypeScript backend on Fastify, tRPC and PostgreSQL, and
  a React frontend.

## Code of Conduct

OpenCRQ has adopted a [Code of Conduct](CODE_OF_CONDUCT.md) that we expect every
participant to follow. Please read it so that you know which actions will and
will not be tolerated.

## How can you contribute?

Many contributions don't imply coding. Contributions can range from a suggestion
for improving documentation, requesting a new feature, reporting a bug, to
developing features or fixing bugs yourself.

* To report a bug or request a feature, open an issue using the provided
  templates.
* To report a missing or wrong page of the
  [documentation](https://filigran.io/docs/opencrq/), click **Give us
  feedback** on it, or open an issue in
  [FiligranHQ/xtm-docs](https://github.com/FiligranHQ/xtm-docs/issues/new/choose),
  the site's mirror.
* You can look through opened issues and help triage them (ask for more
  information, suggest workarounds, suggest labels, etc.).
* If you are interested in contributing code, fork the repository, create a
  branch, and open a pull request. The
  [developer guide](docs/development/development.md) explains how to run the
  stack and the tests.

## Pull requests

* Say in the pull request's description how to test the change.
* Never reference or link an issue from a private repository in a public pull
  request; link the public pull request from the private issue instead.

<!-- filigran-conventions:start -->
## Commit, pull request & issue conventions

To keep the backlog consistent and searchable across all Filigran projects, this
repository follows a shared title and label convention. The full taxonomy lives
in [`.github/LABELS.md`](.github/LABELS.md). In short:

* **Titles** — All commit, pull request and issue titles follow the
  [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
  specification with a GitHub issue reference:
  `type(scope?)!?: description (#issue)` (e.g.
  `feat(api): add bulk export endpoint (#1234)`). The description starts with a
  lowercase letter and has no trailing period; preserve acronyms and proper
  nouns. Types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `perf`,
  `test`, `build`, `ci`, `revert`.

* **No more bracket prefixes** — The old `[backend]` / `[frontend]` /
  `[component]` prefixes are **discontinued**; use a Conventional Commits scope
  instead (e.g. `fix(backend): ...`).

* **GitHub reference** — Pull request titles **must** end with the related issue
  reference, e.g. `(#1234)` (the PR title becomes the squash-merge commit). Every
  pull request must be linked to an issue. Enforcement is preventive and applied
  at the organization level; **Renovate** pull requests are exempt.

* **Signed commits** — All commits must be signed. See the
  [GitHub documentation on signing commits](https://docs.github.com/en/authentication/managing-commit-signature-verification/signing-commits).

* **Labels** — Every **issue** carries one primary type label matching its title
  prefix (`feature` for `feat:`, `bug` for `fix:`, `documentation` for `docs:`)
  plus optional area labels, and its GitHub **Type** (Feature / Bug / Task) set
  to match. **Pull requests carry a restricted label set** — exactly one
  ownership label (`filigran team` or `community`), optionally `vibe-coded` (an
  AI-assisted change the author reviews first), and the automatic language /
  `dependencies` labels. Type, area/scope and workflow labels are issue-only. Do
  not use the deprecated `enhancement` / `feature request` labels — use
  `feature`. See [`.github/LABELS.md`](.github/LABELS.md) for the shared palette
  ([`.github/labels.yml`](.github/labels.yml)).
<!-- filigran-conventions:end -->

## License

The Community Edition is licensed under the Apache License 2.0 and the Enterprise Edition under its own license, see [LICENSE](LICENSE). A source file without a license header belongs to the Community Edition.

## How can you get in touch for other questions?

If you need support or wish to engage a discussion about the project, feel free
to join us on our [Slack channel](https://community.filigran.io). You can also
send us an [email](mailto:contact@filigran.io).
