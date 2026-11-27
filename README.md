<a href="https://filigran.io/products/opencrq"><img src="./.github/img/readme/banner.svg" width="100%" alt="OpenCRQ by Filigran"></a>

<p align="center">
  <a href="https://github.com/OpenCRQ-Platform/opencrq/stargazers"><img src="https://img.shields.io/github/stars/OpenCRQ-Platform/opencrq?style=flat-square&labelColor=0A0C1C&logo=github&logoColor=white&color=001BDA" alt="stars"></a>
  <a href="https://github.com/OpenCRQ-Platform/opencrq/releases/latest"><img src="https://img.shields.io/github/v/release/OpenCRQ-Platform/opencrq?style=flat-square&labelColor=0A0C1C&color=001BDA" alt="release"></a>
  <a href="https://hub.docker.com/r/filigran/opencrq"><img src="https://img.shields.io/docker/pulls/filigran/opencrq?style=flat-square&labelColor=0A0C1C&logo=docker&logoColor=white&color=001BDA" alt="docker pulls"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0%20%2B%20EE-001BDA?style=flat-square&labelColor=0A0C1C" alt="license"></a>
  <a href="https://github.com/OpenCRQ-Platform/opencrq/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/OpenCRQ-Platform/opencrq/ci.yml?branch=main&label=CI&style=flat-square&labelColor=0A0C1C&logo=githubactions&logoColor=white&color=001BDA" alt="CI"></a>
  <a href="https://filigran.io/docs/opencrq/"><img src="https://img.shields.io/badge/docs-read-001BDA?style=flat-square&labelColor=0A0C1C" alt="docs"></a>
  <a href="https://community.filigran.io"><img src="https://img.shields.io/badge/community-slack-001BDA?style=flat-square&labelColor=0A0C1C&logo=slack&logoColor=white" alt="community"></a>
</p>

<p align="center"><b>Threat-informed cyber risk quantification: know what each exposure would cost you, and fix what removes the most loss.</b></p>

OpenCRQ turns the threats you know in [OpenCTI](https://github.com/OpenCTI-Platform/opencti), the defenses you prove in [OpenAEV](https://github.com/OpenAEV-Platform/openaev) and the assets and controls you run into the financial loss to expect, risk scenario by risk scenario. It is the prioritization stage of CTEM in the XTM Platform: one number per risk, with its range and its causes, so the next control, patch or budget line goes where it removes the most loss, and [XTM One](https://github.com/XTM-One-Platform/xtm-one) gets the fix done.

**Documentation.** Using, deploying and configuring OpenCRQ is documented on the XTM documentation site, **[filigran.io/docs](https://filigran.io/docs/opencrq/)**, beside XTM One, OpenCTI and OpenAEV: start with [how OpenCRQ quantifies risk](https://filigran.io/docs/opencrq/concepts/how-risk-is-quantified/), [install it](https://filigran.io/docs/deploy/install/opencrq/), or look up its [configuration](https://filigran.io/docs/reference/opencrq/configuration/) and [API](https://filigran.io/docs/reference/opencrq/api/). The site's sources are mirrored on GitHub in [FiligranHQ/xtm-docs](https://github.com/FiligranHQ/xtm-docs). Something missing or wrong on a page? Click **Give us feedback** on it, or [open an issue](https://github.com/FiligranHQ/xtm-docs/issues/new/choose) there: the documentation team takes corrections as issues, not pull requests.

<p align="center">If OpenCRQ helps your security program, <a href="https://github.com/OpenCRQ-Platform/opencrq/stargazers">give it a star</a>: it is how the project grows.</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./.github/img/readme/hero-dark.webp">
  <source media="(prefers-color-scheme: light)" srcset="./.github/img/readme/hero-light.webp">
  <img alt="The OpenCRQ home dashboard: the risk scope with its tenant, scopes and scenarios, and the controls that would reduce the annual loss exposure most, each priced (synthetic data)" src="./.github/img/readme/hero-light.webp" width="100%">
</picture>

## Table of contents

- [Why OpenCRQ](#why-opencrq)
- [Capabilities](#capabilities)
- [Gallery](#gallery)
- [How it works](#how-it-works)
- [Part of the XTM Platform](#part-of-the-xtm-platform)
- [Use cases by security role](#use-cases-by-security-role)
- [Quick start](#quick-start)
- [Editions](#editions)
- [Integrations and ecosystem](#integrations-and-ecosystem)
- [Community](#community)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)
- [About Filigran](#about-filigran)

## Why OpenCRQ

A CTEM program finds more exposures than any team can fix. Severity scores rank them by how bad a flaw is in general, not by what it would cost your organization.

- **Threat-informed and evidence-based.** Each risk scenario starts from the actors that target your sector and geography, and control effectiveness comes from what your attack simulations blocked or detected.
- **Financial.** Results are an annualized loss exposure with its range, split by loss driver, so they read in the language of a board and a budget.
- **Actionable.** Every result names the control, the finding or the technique that would reduce it most, priced in the same currency.

## Capabilities

| CTEM stage | What OpenCRQ gives your team |
|---|---|
| **Scoping** | Risk scopes per legal entity or business line, primary assets that carry the loss and the organization's financial profile, sector and countries. |
| **Discovery** | Supporting assets with their dependencies, consolidated across sources, CVE and technique findings, and the threats relevant to each tenant. |
| **Prioritization** | A risk scenario per attack outcome quantified by Monte Carlo: annualized loss exposure with p10, mean and p90 and a loss exceedance curve against your tolerance. |
| **Validation** | Controls mapped to MITRE ATT&CK techniques with their prevention and detection coverage, their effectiveness taken from OpenAEV simulation results. |
| **Mobilization** | Risk treatment recommendations, treatment plans, budget reviews and a remediation pace dashboard of new findings against closing capacity. |

## Gallery

<table>
  <tr>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="./.github/img/readme/g1-dark.webp">
        <source media="(prefers-color-scheme: light)" srcset="./.github/img/readme/g1-light.webp">
        <img alt="Risk scenarios of a fictitious bank: each scenario with its annual loss exposure, its p10 to p90 range, its attack outcome, its targets and its owner" src="./.github/img/readme/g1-light.webp" width="100%">
      </picture>
      <p><b>Risk scenarios.</b> Every risk you carry, priced and ranked, with its range, outcome and owner.</p>
    </td>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="./.github/img/readme/g2-dark.webp">
        <source media="(prefers-color-scheme: light)" srcset="./.github/img/readme/g2-light.webp">
        <img alt="Quantification of a data breach scenario: attack run outcomes, loss event frequency and annualized loss expectancy with p10, mean and p90" src="./.github/img/readme/g2-light.webp" width="100%">
      </picture>
      <p><b>Quantification.</b> How attacks end against your defenses and what a loss event costs.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="./.github/img/readme/g3-dark.webp">
        <source media="(prefers-color-scheme: light)" srcset="./.github/img/readme/g3-light.webp">
        <img alt="Budget reviews of a fictitious bank: scenarios outside tolerance, loss avoided per year, build return and spend, with one review per period" src="./.github/img/readme/g3-light.webp" width="100%">
      </picture>
      <p><b>Budget reviews.</b> What the security budget spent and the loss it avoided, scope by scope.</p>
    </td>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="./.github/img/readme/g4-dark.webp">
        <source media="(prefers-color-scheme: light)" srcset="./.github/img/readme/g4-light.webp">
        <img alt="Risk exposure flow: a Sankey diagram of annual loss expectancy from threat actors to attack outcomes, technique chokepoints and loss drivers" src="./.github/img/readme/g4-light.webp" width="100%">
      </picture>
      <p><b>Exposure flow.</b> Where the annual loss comes from, down to the technique that would stop it.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="./.github/img/readme/g5-dark.webp">
        <source media="(prefers-color-scheme: light)" srcset="./.github/img/readme/g5-light.webp">
        <img alt="Controls grouped by domain with their strength, ATT&CK coverage and measured effectiveness" src="./.github/img/readme/g5-light.webp" width="100%">
      </picture>
      <p><b>Controls.</b> Each control's strength, coverage and measured effectiveness, and what it protects.</p>
    </td>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="./.github/img/readme/g6-dark.webp">
        <source media="(prefers-color-scheme: light)" srcset="./.github/img/readme/g6-light.webp">
        <img alt="Threats read from OpenCTI: active threats, their match with the tenant's attack outcomes, observed activity, CVEs and techniques" src="./.github/img/readme/g6-light.webp" width="100%">
      </picture>
      <p><b>Threats.</b> The actors and campaigns that match your attack outcomes, with their CVEs and techniques.</p>
    </td>
  </tr>
</table>

**Walkthrough.** From the home dashboard to a risk scenario, its quantification and the control that cuts it, in 15 seconds.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./.github/img/readme/walkthrough-dark.webp">
  <source media="(prefers-color-scheme: light)" srcset="./.github/img/readme/walkthrough-light.webp">
  <img alt="Animated walkthrough: the OpenCRQ home dashboard, a risk scenario, its Monte Carlo quantification and the treatment that reduces it" src="./.github/img/readme/walkthrough-light.webp" width="100%">
</picture>

## How it works

OpenCRQ reads threats from an OpenCTI live stream and assets, verdicts and CVEs from OpenAEV, builds one risk scenario per attack outcome on a primary asset and runs a Monte Carlo simulation: threat event frequency, attack runs across the supporting assets, loss priced through the loss drivers, and what-ifs on the same simulated worlds so the value of each lever carries no sampling noise.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./.github/img/readme/flow-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./.github/img/readme/flow-light.svg">
  <img alt="How OpenCRQ works: OpenCTI threats, OpenAEV verdicts, assets, controls and the financial profile flow into risk scenarios and the quantification engine, which produces financial risk, prioritized remediation and executive reporting" src="./.github/img/readme/flow-light.svg" width="100%">
</picture>

## Part of the XTM Platform

OpenCRQ is one of the five products of the [XTM Platform](https://filigran.io), the open platform for Agentic CTEM. Each product owns stages of the CTEM loop; XTM One runs the loop across them.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./.github/img/readme/xtm-platform-ctem-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./.github/img/readme/xtm-platform-ctem-light.svg">
  <img alt="The XTM Platform and the CTEM loop: XTM One at the core, OpenCTI, OpenCRQ and OpenAEV as modules, XTM Hub as the library, around the five stages scoping, discovery, prioritization, validation and mobilization" src="./.github/img/readme/xtm-platform-ctem-light.svg" width="100%">
</picture>

| | Product | Role in CTEM | Repository | Product page |
|---|---|---|---|---|
| <picture><source media="(prefers-color-scheme: dark)" srcset="./.github/img/readme/mark-xtm-one-dark.svg"><img src="./.github/img/readme/mark-xtm-one-light.svg" width="24" alt=""></picture> | **XTM One** | Core and agentic layer: runs CTEM across the modules and gets the fix done | [XTM-One-Platform/xtm-one](https://github.com/XTM-One-Platform/xtm-one) | [filigran.io/products/xtm-one](https://filigran.io/products/xtm-one) |
| <picture><source media="(prefers-color-scheme: dark)" srcset="./.github/img/readme/mark-opencti-dark.svg"><img src="./.github/img/readme/mark-opencti-light.svg" width="24" alt=""></picture> | **OpenCTI** | Scoping and Discovery: know the adversary and the threats that target you | [OpenCTI-Platform/opencti](https://github.com/OpenCTI-Platform/opencti) | [filigran.io/products/opencti](https://filigran.io/products/opencti) |
| <picture><source media="(prefers-color-scheme: dark)" srcset="./.github/img/readme/mark-opencrq-dark.svg"><img src="./.github/img/readme/mark-opencrq-light.svg" width="24" alt=""></picture> | **OpenCRQ** | Prioritization: turn exposure into financial risk | [OpenCRQ-Platform/opencrq](https://github.com/OpenCRQ-Platform/opencrq) | [filigran.io/products/opencrq](https://filigran.io/products/opencrq) |
| <picture><source media="(prefers-color-scheme: dark)" srcset="./.github/img/readme/mark-openaev-dark.svg"><img src="./.github/img/readme/mark-openaev-light.svg" width="24" alt=""></picture> | **OpenAEV** | Validation: prove your defenses against real attacker techniques | [OpenAEV-Platform/openaev](https://github.com/OpenAEV-Platform/openaev) | [filigran.io/products/openaev](https://filigran.io/products/openaev) |
| <picture><source media="(prefers-color-scheme: dark)" srcset="./.github/img/readme/mark-xtm-hub-dark.svg"><img src="./.github/img/readme/mark-xtm-hub-light.svg" width="24" alt=""></picture> | **XTM Hub** | Tradecraft library and gateway: integrations, dashboards and scenarios for every product | [XTM-Hub/xtm-hub](https://github.com/XTM-Hub/xtm-hub) | [filigran.io/platforms/xtm-hub](https://filigran.io/platforms/xtm-hub/) |

## Use cases by security role

| Role | What OpenCRQ does for it |
|---|---|
| **CTI** | The actors and campaigns that drive the loss, and the techniques that are the chokepoints. |
| **SOC** | The techniques where a detection removes the most loss, from OpenAEV verdicts priced in the same currency. |
| **Detection engineering** | A ranking of undetected techniques by the loss a detection would remove. |
| **Red and purple team** | Attack simulation results turned into control effectiveness and a priced risk reduction. |
| **Vulnerability and exposure management** | Findings ranked by the loss they carry on your estate, not by a generic severity score. |
| **Risk and CISO** | The annual loss exposure for the board, a tolerance and its trend, treatment plans and the spend justified by the loss it avoids. |

## Quick start

OpenCRQ runs with Docker in the [XTM Docker bundle](https://github.com/FiligranHQ/xtm-docker), beside XTM One, OpenCTI and OpenAEV. Requirements: Docker with Docker Compose v2, and the memory and disk the bundle's README asks for.

```bash
git clone https://github.com/FiligranHQ/xtm-docker.git && cd xtm-docker
cp .env.sample .env      # replace every ChangeMe and changeme value, and every value marked [MANDATORY]
docker compose up -d
```

Open http://localhost:8082 and sign in with XTM One: OpenCTI and OpenAEV are already connected.

- **Docker**: [`filigran/opencrq`](https://hub.docker.com/r/filigran/opencrq), one tag per [release](https://github.com/OpenCRQ-Platform/opencrq/releases).
- **Docs**: [installation](https://filigran.io/docs/deploy/install/opencrq/), [configuration](https://filigran.io/docs/deploy/configure/opencrq/) and the [configuration reference](https://filigran.io/docs/reference/opencrq/configuration/).

## Editions

| | Community Edition | Enterprise Edition |
|---|---|---|
| License | [Apache 2.0](LICENSE) | [OpenCRQ Enterprise Edition License](LICENSE) |
| Risk scenarios, quantification, controls, dashboards | Yes | Yes |
| Multi-tenancy and the Filigran license | | Yes |
| The XTM One assistant | | Yes |

A source file without a license header belongs to the Community Edition; see [LICENSE](LICENSE).

## Integrations and ecosystem

- **XTM Platform:** OpenCTI threats through a [Live Stream](https://filigran.io/docs/opencrq/use/sources/opencti/), OpenAEV assets and verdicts through its [connector](https://filigran.io/docs/opencrq/use/sources/openaev/), XTM One for Ariane and sign-in.
- **[XTM Hub](https://hub.filigran.io):** integrations, dashboards and scenarios for the XTM Platform.
- **Vulnerability data:** NIST NVD, CISA known exploited vulnerabilities and FIRST EPSS.
- **Estate and compliance:** [Microsoft Defender for Endpoint](https://filigran.io/docs/opencrq/use/sources/microsoft-defender/), Entra ID and Intune through Microsoft Graph, and [Drata](https://filigran.io/docs/opencrq/use/sources/drata/) for NIST CSF 2.0 evidence.

## Community

Star OpenCRQ to follow it and to help other security teams find it.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./.github/img/readme/stars-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./.github/img/readme/stars-light.svg">
  <img alt="GitHub stars of OpenCRQ over time" src="./.github/img/readme/stars-light.svg" width="100%">
</picture>

- **Questions and discussion**: the Filigran [community Slack](https://community.filigran.io).
- **Bugs and feature requests**: [GitHub issues](https://github.com/OpenCRQ-Platform/opencrq/issues).
- **Learn**: free courses on [Filigran Academy](https://academy.filigran.io).

## Contributing

Read the [contributing guide](CONTRIBUTING.md) to set up a development environment and propose a change. OpenCRQ has adopted a [Code of Conduct](CODE_OF_CONDUCT.md). First contribution: the [good first issues](https://github.com/OpenCRQ-Platform/opencrq/labels/good%20first%20issue).

## Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), never in a public issue.

## License

OpenCRQ is open source under the [Apache 2.0 license](LICENSE); the Enterprise Edition features are under the OpenCRQ Enterprise Edition License, as stated in [LICENSE](LICENSE) and in each source file header.

## About Filigran

OpenCRQ is designed and developed by [Filigran](https://filigran.io), the company behind the [XTM Platform](https://filigran.io) for Agentic CTEM.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./.github/img/readme/filigran-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./.github/img/readme/filigran-light.svg">
  <img alt="Filigran" src="./.github/img/readme/filigran-light.svg" width="240">
</picture>
