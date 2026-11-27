---
applyTo: "module/src/modules/onboarding-wizards/**,back/src/features/app-router/onboarding-wizard/**,front/src/features/onboarding/**,front/src/routes/**/get-started/**"
description: 'The Get started onboarding wizard: its table, the provisioning of a new tenant, how step status and the landing redirect are decided, key files and what is left to build'
---

<!-- Generated from .agents/instructions/feature-onboarding.md by scripts/render-agent-files.mjs. Edit the source, not this file. -->

# The Get started onboarding wizard

A tenant's first quantified risk scenario depends on a handful of facts about the organization
(who it is, what it owns, what it defends, what it can lose). Get started walks a new tenant
through them, one step at a time, on a page of its own. This is the reference for whoever extends
it; read the sections your change touches.

The feature has no feature flag: every tenant created through the app, from the platform
administration or as the tenant the platform creates when it starts with none, is provisioned with
the wizard, and the read endpoint and the UI are always reachable. A tenant the platform seed created has no wizard and so no Get started page.

## 1. Scope

- A **Get started page** listing eight steps: Company, Assets, Threats, Defenses, Finances,
  Tolerance, Protect, Scenarios, all of which open.
- A **Company step** editing the name, sector, country, revenue band and employee count of the tenant's
  first risk scope, saved as the reader types (section 10).
- An **Assets step** that fills the tenant's estate from Microsoft Defender, by hand, by declaring
  orders of magnitude, or any mix of them (section 6).
- A **Threats step** that gives the tenant threats from the OpenCRQ threat set, OpenCTI, a STIX
  bundle, or any mix of them (section 7).
- A **Defenses step** that assesses the tenant's controls from Drata, by hand, or both (section 12).
- A **Protect step** choosing what the tenant protects: primary assets from six templates or by hand,
  linked to the estate (section 13).
- A **Finances step** answering the full 21-question financial profile that sizes a loss, saved as the
  reader answers (section 8).
- A **Tolerance step** setting the loss the scope accepts, saved as soon as both fields are valid
  (section 9).
- A **Scenarios step** creating the scope's first risk scenarios and computing them, then a **finish
  screen** once every step is done (section 14).
- A **navigation entry** above Home while the wizard is unfinished, with a counter and a progress bar of the
  done steps while the menu is expanded, moved to the very bottom of the menu once it is finished, with
  neither counter nor bar.
- A **landing redirect** from the tenant home to Get started (section 5).

## 2. Data

`onboarding_wizards` holds one row per risk scope: `id`, `tenant_id`, `organization_id` (not null,
unique), with a composite foreign key `(organization_id, tenant_id)` to `organizations` that
cascades on delete, so removing the scope removes its wizard. The row is the link between a wizard
and the scope it describes, stored rather than assumed as a fixed id so that a lighter wizard can
later attach to any risk scope created afterwards.

The wizard also leaves one trace in `primary_assets`: the nullable `onboarding_template`, the key of the
Protect template the asset was created from (section 13). A text column with a check constraint on the
six keys, declared once as `PRIMARY_ASSET_ONBOARDING_TEMPLATES` in
`module/src/modules/primary-assets/constants.ts` and exported through `@app/module/client`, so `back`
validates the input and `front` lists the templates from the same tuple. It is written once, at creation
(`primaryAssets.createPrimaryAsset` takes it as an option, `updatePrimaryAsset` never changes it), and
read back by `primaryAssets.getPrimaryAssets`. A scope holds at most one primary asset per template: the
partial unique index `primary_assets_organization_onboarding_template_uq` on `(organization_id,
onboarding_template)` refuses a second one, which the service raises as `DuplicatePrimaryAssetTemplateError`
and the router answers with `CONFLICT`, so two members or two tabs picking the same card cannot both create it.

There is deliberately no `kind` and no `completed_at`: both arrive with the features that need
them (lighter wizards), and a column without a reader is a column that drifts. The finish screen
reads `finished`, which is derived (section 4).

## 3. Provisioning

Every tenant created through the app is born with a risk scope named `Enterprise`, the wizard
attached to it and the OpenCRQ threat set switched off. It happens inside the tenant creation
transaction (`provisionTenant`, `module/src/modules/tenants/repository.ts`, shared by
`createTenantWithAdmin` and `createInitialTenantIfNone`), behind the option `provisionOnboarding`,
which is `false` by default and which `back` always sets.

- **Why in that transaction.** Both creation paths, the platform administration's (`createTenant`)
  and the tenant the platform creates at start when it has none (`createInitialTenant`), end
  there, so a tenant can never exist without the provisioning half-done. `organizationsService.createOrganizations` cannot be reused: it needs a tenant client
  origin, which the platform path does not have, and the organizations policy refuses the
  `platform` origin.
- **The option is `module`'s, the decision is `back`'s.** `back` passes
  `{ provisionOnboarding: true }` from `tenants-router.ts` and from `ensureInitialTenant`
  (`back/src/engines/db/initial-tenant.ts`); the
  platform seed and the integration test factories pass nothing, so a tenant they create starts
  empty.
- **The OpenCRQ threat set is written off at creation** (a `default_threats_settings` row with
  `enabled: false`, same transaction). Loading it is a Get started action, reserved to
  `MANAGE_SECURITY` like every connector setting (`defaultThreats.setEnabled`), so the scheduler
  loads nothing for a tenant until someone with that capability chooses the set; a member without
  it is told an administrator does it. A tenant without the option keeps the set on, since a
  tenant with no row reads as enabled.
- **The first tenant is no special case.** Whether the platform created it at start or the super
  administrator created it from Platform > Tenants, it is provisioned like any other. The super
  administrator is a member of no tenant and reaches it through `callerReachesTenant`, so no wizard
  read depends on a membership row.
- **The platform seed passes nothing.** A seeded tenant that is meant to start empty keeps zero
  risk scopes.
- **The scope name is data.** `ONBOARDING_RISK_SCOPE_NAME` is stored in the `organizations` row and
  is never translated, whatever the language of the person who creates the tenant. The wizard's
  step label "Company" is UI and is translated.

## 4. Step status

Status is computed from application data, never stored, and the computation lives in the module
service (`onboardingWizards.getOnboardingWizard`), never in the front.

- Company is `done` when the scope has both a sector and a country. The name stays editable but
  does not count; the revenue band is optional.
- A step is `todo`, `started` or `done`. Only Assets, Finances and Defenses can be `started`; the other
  steps stay `todo` or `done`.
- Assets is `done` when the wizard's scope answered every kind of the declared estate
  (`DECLARED_ESTATE_KIND_VALUES`, 12 kinds), and `started` when the tenant has a supporting asset,
  wherever it came from, or the scope answered some kinds but not all. A "None" is an answer: it is a row
  of `declared_estate` with bounds 0 to 0, whereas an unanswered kind has no row, so the answered kinds
  are the scope's rows (`countDeclaredEstateKinds`, one `count(*)`, the rows are never loaded). The
  scope's own Declared estate tab counts the same rows. Supporting assets alone never make the step
  `done`: they are read with a `limit 1` (`hasSupportingAsset`), only when no kind is answered.
- Threats is `done` when the tenant has at least one threat, whatever its source. The repository
  reads it with a `limit 1` (`hasThreat`): the catalogue is never counted. A retracted threat is a
  deleted row, so it stops counting. A provisioned tenant starts with the OpenCRQ set switched off,
  so the step stays to do until a source is chosen.
- Finances is `started` once the wizard's risk scope has a financial profile with at least one answered
  question, and `done` when every question of the questionnaire is answered, gates included. The
  rule is `isQuestionAnswered` / `computeProgress`
  (`module/src/modules/financial-profiles/questionnaire-progress.ts`), exported through
  `@app/module/client`: the front's questionnaire and the service apply the same one, the service to the stored
  row (`findFinancialProfile`).
- Tolerance is `done` when the wizard's risk scope has a risk tolerance.
- Defenses is `started` once a capability is assessed, and `done` when every capability of the
  catalogue is. A capability is assessed when the tenant has an assessment of it, whatever its source
  (a declared level 0 included), or the wizard's scope declares a posture on it (a row of
  `control_capability_scope_overrides`). One read counts both with a left join per table
  (`countCapabilityAssessments`): the rows are never loaded.
- Protect is `done` when the wizard's scope has a primary asset (`hasPrimaryAsset`), and never
  `started`. A risk scenario does not count.
- Scenarios is `done` when the latest simulation run of one of the wizard's scope's risk scenarios priced it,
  a run with an `ale_mean` (`hasComputedRiskScenario`, the shared `latestRunOf` lateral, as the scenarios list
  reads it): a run with no TEF or no loss estimate stores no figure and quantifies nothing, and a later
  unpriced run outdates an earlier figure, so the step and the finish screen count the same scenarios.
- Finances, Tolerance, Protect and Scenarios (and the scope half of Defenses and Assets) are read on the
  wizard's own scope, never on the tenant: a tenant with several scopes would otherwise see the step
  done by another scope's answers. `findFirstOnboardingWizard` left joins the risk tolerance on
  `organization_id`, which is unique in that table, so the join never multiplies the row. The other
  reads take the scope id and filter on it.
- `finished` is `true` when no step the backend computes is `todo`, so all eight: Company, Assets,
  Threats, Defenses, Finances, Tolerance, Protect and Scenarios, a started one included: a started step
  informs the reader of what is left and never blocks the wizard. It is derived on every read, so
  editing the scope back to an incomplete state reopens the wizard. Adding a step means adding its
  rule to the service and a key to the endpoint's output.
- **Only a done step is counted and checked** (`isStepDone`, `getCompletedStepKeys`). The overview's "x of 8
  steps done" and the menu entry's "x of 8" count the done steps, and the overview adds the started ones in the
  same sentence, "6 of 8 steps done · 2 started" (`getStartedProgress`: `completed`, `started`, `total`,
  `finished`). The wizard's end is the backend's `finished`, which a started step does not hold back: it alone
  drives the finish screen, the menu entry's move to the bottom and the overview's "What you can do now"
  button, so "x of 8" can read below 8 on a finished wizard.
- **A started step shows how far it is** (`useStepProgress`, `stepProgressFraction`): its number stays, inside a
  static ring filled to its share (`StepProgressRing`, section 10), in the stepper and on its overview row,
  where its row also shows "Started" and, under the label, what is left: Finances "x of y answered"
  (`computeProgress` on the scope's financial profile), Defenses "x of y assessed" (the tenant's assessments of
  the catalogue, as the step's header) and Assets "x of 12 kinds declared" (the scope's answered kinds, as the
  Declared estate tile counts them). The reads only run while the step is started.
- The front lists eight steps (`onboarding-steps.ts`, a thunk per label so the catalogue is read
  after the locale is active) and the backend returns all eight statuses. A step flagged
  `available: false` displays as "coming soon" whatever the backend reports (`getStepStatus`), until
  its page exists.
- **A running import never changes a status.** While a source imports behind Assets (Microsoft
  Defender `syncing`) or Threats (OpenCTI `syncing`, or catching up while its state is neither
  `failing`, `unavailable` nor `not_configured`, since a stream that cannot connect never reaches its
  live tail; else the OpenCRQ set `syncing`),
  the overview row shows a "Syncing" chip in place of its status chip, with "<source> · <n> imported"
  and, when the percentage is known, the progress line under the label. The row's mark (check or
  number) and the "x of 8" count keep following the rule above: a step that is done stays done and
  counted while it syncs. The pure `stepSync` (`onboarding-utils.ts`) picks the source, OpenCTI before
  the OpenCRQ set when both run; the overview lists no durations. The stepper of every step page and of
  the finish screen applies the same rule to ring the step's circle (section 10).
- **The Company step writes through the existing `organizations.updateOrganization`**, which
  already recomputes what depends on the firmography fields. The wizard has no mutation of its
  own, and the read endpoint needs no manual invalidation: the doorbell derives the tables a query
  reads, so changing the scope refreshes it.

The read endpoint is `onboardingWizard.getOnboardingWizard`. It answers `null` for a tenant without a wizard. It is open
to every member of the tenant, matching the risk scope policy, where any member can edit a scope:
there is no admin-only check.

## 5. The landing redirect and the "already seen" marker

The tenant home (`front/src/routes/_auth/$tenantId/{-$organizationId}/index.tsx`) sends a member to
Get started in its `beforeLoad`, only when no risk scope is selected. The checks run in this order
so that the common case costs nothing:

1. This browser already has the marker for this user and tenant: do nothing, no request.
2. Read the wizard: redirect only when one exists and is not finished.

A failing request lets the home render. The route calls `opensGetStarted`
(`features/onboarding/get-started-landing.ts`), which runs these checks over the pure decision
`shouldOpenGetStarted`.

The marker is a `localStorage` collection (`front/src/stores/onboarding-seen-collection.ts`), keyed
`<userId>:<tenantId>` and set when any Get started page mounts. It is `localStorage` rather than a
cookie because the server never needs it, and the cost of losing it (another browser, cleared
storage) is one more redirect. The collection is preloaded in `main.tsx`: an idle collection
answers `has()` with `false` whatever its storage holds, and the route reads it synchronously.
Nothing subscribes to it, so it sets `gcTime: Infinity`: the default would clear it five minutes
after the preload, and the home would redirect again. A marker the storage refuses is also kept in
memory for the page's lifetime, since the collection rolls a failed write back asynchronously.

The effect: a user lands on Get started the first time, can then land anywhere else, and keeps the
navigation entry to come back.

## 6. The Assets step

The step lists its sources as three tiles under "Asset sources" (`SourcesSection`, three columns,
`components/source-tile.tsx`): **Declared estate**, **Microsoft Defender** and **Manual creation**.
The sources add up: there is no choice to make, so a reader can use all of them. They lead to the
same status rule: an asset or a part of the declared estate starts the step, and answering the 12 kinds of
the declared estate, which is what the first tile writes, finishes it (section 4). The Declared estate tile
comes first (`AssetSourceTiles`): it is the one source that needs no connector and no asset.

- **A tile** (`SourceTile`) holds the source's icon, a state chip at the top right, its name, an optional
  line under it saying what the source is for (`description`, only the Declared estate tile has one), its own
  count in `title-sm`, a progress line when the percentage is known, and one action at the bottom.
  The counts are `supportingAssets.listSupportingAssets` reads with `limit 1` filtered by source
  (`microsoft_graph`, `user` for assets created by hand), so each tile counts its own assets and a
  tile never shows the whole estate (`hooks/use-source-reads.ts`). Counts are worded in assets,
  never in "objects" (`source-labels.ts`).
- **The header's total is the tenant's real count**, `listSupportingAssets` with no source, never
  the sum of the tiles' counters.
- **The Defender tile's chip is the connector's state**, read from `connectors.listConnectors`
  (`useConnectorCard`) and drawn by the Integrations page's own `ConnectorStateChip`, hint
  included. Its progress line is `activeRun.processedTotal / expectedTotal` (`runProgressPercent`),
  drawn only when `expectedTotal` is known: otherwise the Syncing chip stands alone.
- **The Manual tile has no chip until it holds an asset**, then an "Active" one. **Create** opens the
  existing supporting asset create sheet (`SupportingAssetCreateSheet`) on the wizard's risk scope,
  and the first asset created turns the step done.
- **The Declared estate tile** (`DeclaredEstateTile`) is the wizard's scope stating orders of
  magnitude (workstations, servers, containers, cloud resources...) without any asset, and says why: "Gives
  every scenario the size of your estate, even before your assets are imported." It counts the kinds the scope
  answered out of all of them, "x of 12 kinds declared" (the total is `DECLARED_ESTATE_KIND_VALUES.length`;
  `useDeclaredEstateKindCount`: the rows of
  `declaredEstate.get` with bounds, the count the scope's own tab shows), and has no chip until there is
  one, then "Active". Its action reads **Declare** while nothing is declared, **Edit** after, and opens
  `DeclaredEstateSourceDrawer`: a `FormDrawer` titled "Declared estate" holding the same
  `DeclaredEstateQuestionnaire` and `useDeclaredEstateForm` as the scope drawer's Declared estate tab,
  with the "Measured" line of `declaredEstate.comparison`. Nothing is saved as the reader answers: Save
  sends the changed kinds (`declaredEstate.save`, no success toast, the tile's count moving on is the
  feedback) and closes the drawer, it stays disabled until an answer changed or while a custom count is
  invalid, and closing a modified drawer asks before discarding. The header's total stays the tenant's
  supporting assets, the declared estate never adds to it.
- **Configure opens a drawer** (`DefenderSourceDrawer`, a `DisplayDrawer` titled with the source's
  name, closed by a successful save). Its body has three states, chosen by `getConnectorCardMode`
  (shared with the OpenCTI drawer, section 7) from two facts, whether the platform enabled the
  connector and whether the reader holds `MANAGE_SECURITY`:
  - *unavailable*: the platform configuration does not enable Microsoft Defender for this tenant.
    `ConnectorUnavailableBody` shows the message, one sentence naming the source ("A platform
    administrator enables <source> for this tenant: set the variables below in the platform's
    environment, then restart the platform."), the three
    `CONNECTORS__MICROSOFT_GRAPH__<tenantId>__...` variables to set (`microsoftDefenderEnvBlock`), a
    Copy button and a link to the configuration documentation
    (`MICROSOFT_DEFENDER_DOCUMENTATION_URL`). Nothing can be configured from the app. The body is
    shared with the OpenCTI drawer, which passes its own text, block and URL.
  - *configure*: the connector is enabled and the reader holds `MANAGE_SECURITY`. The drawer shows
    the configuration form, Sync now and a link to Integrations.
  - *readonly*: the connector is enabled and the reader lacks `MANAGE_SECURITY`. The drawer says
    that an administrator configures it. The Configure button stays for every reader.
- **The service account is created with the integration or picked from the existing list**
  (`ServiceAccountChoiceFields`, shared with the Integrations drawers). "Create a new service
  account" is the default when nothing is bound, prefilled "<Connector> connector": the account is
  created in the tenant's Connectors group and bound in the same transaction, so a failed save
  leaves no orphan account. Both need `MANAGE_SECURITY`, which is why a reader without it gets no
  form.
- **The configure form is the Integrations drawer's.** `useConfigureIntegration` and
  `ConfigureIntegrationFields` (`features/integrations/components/configure-integration-form.tsx`)
  hold the fields, the schedule and the two writes, and both Integrations' drawer and this one
  render them, so the two cannot drift. The drawer passes the connector's saved schedule, or none
  for a connector that has no schedule.
- **Sync now** is withheld until a service account is bound and while a run is in flight
  (`canSyncConnector`): the queue hands back the run already going, so a second click would only
  confuse.
- **Navigation** is the generic one of section 10: Assets' Back leads to Company and its Next to
  Threats. The step does not gate on its own status: leaving it undone is allowed, and the
  overview keeps showing it as to do.

## 7. The Threats step

The step lists its sources as three tiles under "Threat sources" (`SourcesSection`, three
columns): the **OpenCRQ threat set**, **OpenCTI** and a **STIX bundle**. Like the assets, they
add up, and all lead to the same status rule (any threat, section 4). No tile is preselected.

- **Each tile counts its own threats**, `threats.list` with `limit 1` and the source's kind
  (`default-threats`, `connector` for OpenCTI, `stix-import`), so OpenCTI's tile shows the threats
  it brought in, not the objects it mirrors. The header's total is `threats.list` with no kind, the
  tenant's real count, never the sum of the tiles' counters.
- **A reader OpenCTI did not answer for** is shown the Threats page's `ReaderAccessNotice` above the
  tiles, worded by the category `xtm.readerAccess` gives for the threats (`useReaderAccess`): their
  counts leave out every marked or shared threat from OpenCTI.
- **The chip** is the connector's state from `connectors.listConnectors` for the OpenCRQ set and
  OpenCTI, through `ConnectorStateChip`. A switched-off set's chip only says "Switched off." (its
  `hint`): the Integrations hint sends the reader to Configure, and the tile's action says what to
  do instead. The STIX tile shows an "Active" chip once it holds a
  threat, and none before.
- **The OpenCRQ tile's action** is chosen by `getDefaultThreatsTileAction` from
  `getDefaultThreatsCardMode` (which reads `defaultThreats.getOverview` and the connector's state)
  and `MANAGE_SECURITY`:
  - *switched off*, which is how a provisioned tenant arrives: a holder gets **Enable**
    (`defaultThreats.setEnabled({ enabled: true })`, with `skipSuccessToast`: the tile's chip and
    count moving on is the feedback); anyone else reads "An administrator enables it.".
  - *enabled, loading or loaded*: a holder gets **Disable**, which opens the Integrations'
    `DisableDefaultThreatsDialog` (the set's own threats are removed, the other sources' stay)
    before `setEnabled({ enabled: false })`; anyone else gets no button and no line.
  - *failed*: enabled, never loaded, and the connector state is `failing`: the first load ended in
    the dead-letter queue. The tile links to Integrations, for every reader; there is no retry
    button. A refresh that fails after a first load stays *loaded*.
  - *unavailable*: `datasetFileUrl` is null, the platform configuration turned the dataset off. No
    button.

  There is **no Load button**: the connector loads the set by itself once enabled, so a button
  would only race it.
- **The OpenCTI tile's Configure** opens `OpenctiSourceDrawer`, which has the Defender drawer's
  three states, chosen by the same `getConnectorCardMode`. *Unavailable* shows the two
  `CONNECTORS__OPENCTI__<tenantId>__URL=` and `__TOKEN=` variables (`openctiEnvBlock`) and the link
  to the OpenCTI section of the configuration documentation (`OPENCTI_DOCUMENTATION_URL`).
  *Configure* renders the Integrations drawer's form: `useOpenctiConfigure`,
  `OpenctiConfigureFields` and `OpenctiEnabledSwitch`
  (`features/integrations/components/opencti-configure-form.tsx`), shared with
  `OpenctiConfigureDrawer`, which keeps its own behaviour. When OpenCTI cannot list its Live
  Streams the drawer says so instead of showing the form. *Read-only* says that an administrator
  configures the connector. The form carries the same service account choice as the Assets step
  (section 6). A connection the deployment provides is usually bound already, to the
  "OpenCTI (deployment)" account and the "OpenCRQ threat feed" stream OpenCRQ manages
  (`back/src/features/deployment-integrations/`), so the drawer opens on that binding.
- **The progress line** is drawn only when the percentage is known: OpenCTI's
  `getBackfillProgress().progressPercent` while `isCatchingUp` and the stream can connect
  (`openctiImportPercent`, shared with the overview's `stepSync`), a job
  run's `processedTotal / expectedTotal` when `expectedTotal` is set (`runProgressPercent`). The
  OpenCRQ and STIX tiles never draw one. An unknown percentage leaves the Syncing chip alone.
- **The STIX tile** renders the existing `ThreatUploadButton`, open to every member. The button
  disables itself when file storage is not configured, and the tile then says so.

## 8. The Finances step

The step shows the whole financial profile questionnaire, `FinancialProfileQuestionnaireFields`, the
component the risk scope wizard and the scope's drawer render: its eight sections, each with its
"x of y" count, under the "x of 21 answered" bar. Nothing is pre-filled, by sector or by country: the
form opens on the stored profile, or on empty answers. The country the labour cost benchmark reads
is the scope's own (`organization.country`).

- **It saves as the reader answers** (section 10), through the existing
  `financialProfiles.saveFinancialProfile`, which the step's form (`useFinancialProfileForm`)
  shares with the scope drawer. The shared component has no hook point, so the step's `<form>` listens to
  `onBlur` and `onClick`, which bubble from the fields: a typed number saves when its field loses focus, a
  band or Yes/No choice when it is clicked. The write sends the whole answer set as the form holds it, so
  the answers the reader did not touch go back unchanged, and happens only when it differs from what was
  last saved (`sameAnswers`) and the schema accepts it. Writes are chained, each reading the form when its
  turn comes, so two answers in a row cannot land out of order. The mutation shows no success toast.
- **The step renders a loader until the scope and the profile have loaded, and no form when
  either read fails** (`isError` of `useFinancialProfileForm`): it then says the figures could not
  be loaded, and Next is a plain link. The form starts on its empty values, and a save before the
  stored ones land, or after a failed read, would overwrite every stored answer with an empty one.
- **The revenue band rule.** `saveFinancialProfile`
  (`module/src/modules/financial-profiles/service.ts`) rewrites the scope's revenue band only when
  the annual revenue differs from the stored one; clearing a stored amount still clears the band.
  So an answer saved without a revenue keeps the band picked on Company, which a save
  that rewrote the band from an empty revenue would erase. The band stays the Company step's to
  edit, and the first revenue typed here derives it.
- With no amount typed, the annual revenue question says which band the scope already holds
  (`Q1AnnualRevenueCard`'s `revenueBand`, read from `organizations.getOrganization`); with one, it
  shows the band the amount falls in.

## 9. The Tolerance step

The step shows the two fields of the scope's risk tolerance, `AnnualLossField` and
`MaxExceedancePercentField` (`features/risk-tolerance`), under the title "Risk tolerance" with an
info tooltip saying what the tolerance is (`titleAdornment`, section 10). They are empty until
typed: no demo values, and no pre-filling.

- **The form** is `riskToleranceFieldsSchema` with the values the scope holds
  (`organizations.getRiskTolerance`, `toFormValues`); a refetch never undoes what the reader is
  typing (`keepDirtyValues`).
- **It saves when a field loses focus and both are valid** (`saveWhenComplete`), through
  `organizations.setRiskTolerance` with the values converted by `completeTolerance`, and only when they
  differ from the stored pair. The mutation shows no success toast.
- **A partial input is not saved.** One field filled and the other empty fails the schema, nothing is
  written, and two blank fields say nothing. A neutral line under the fields, "Both values are needed to
  save the tolerance.", says why from the start.
- **A field's error shows once both fields were left at least once** (`touchedFields`), or once the
  reader tried to leave with one filled: leaving the first field of a pair the reader is still filling
  never turns the other one red.
- **Leaving with exactly one field filled asks first.** A `useBlocker` guard (`isToleranceIncomplete`,
  `withResolver`, `enableBeforeUnload`) holds every way out, the Back and Next links, the stepper, the
  menu, the browser's back and closing the tab, and opens the shared `UnsavedChangesDialog` ("Incomplete
  tolerance", "The tolerance needs both values. Leave without saving it?", Cancel / Leave without saving).
  Cancel keeps the reader on the step with the missing field's error shown; Leave without saving lets the
  navigation through and writes nothing. A blank form and a complete pair, saved or about to be, never
  ask. A saved pair with one field cleared does, since the half left is never written.
- **A tolerance can be set, never cleared**, as everywhere else in the app.

## 10. The step layout and the navigation

Every step page renders inside `OnboardingStepLayout`
(`features/onboarding/components/onboarding-step-layout.tsx`): the "Get started" title, the
`OnboardingStepper` with the step's position and the done steps, then a `Paper` with the step's
label, a "Why this step?" `Paper` (elevation 2, a `Lightbulb` in `--fds-icon-info`) and the step's
content. A Back / Next footer closes the page. A step passes its key, its "why" text and its
content. `title` replaces the step's label as the card's title and
`titleAdornment` sits right of it (the Tolerance step's info tooltip). Next is always a link,
since no step saves on leaving.

**The stepper** (`OnboardingStepper`, `components/onboarding-stepper.tsx`, also on the finish screen) is
the shared `WizardStepIndicator` with its three optional props, which leave the risk scope and risk
scenario wizards untouched when absent. It takes the `wizard` and derives the done steps (checked), the
started ones and the syncing ones itself:
- `renderStepLink(step, props)` makes every step a link, circle and label together, since the steps open
  in any order. The caller renders the router link and spreads `props` on it (`className` with the
  focus ring, `aria-current="step"` on the step on screen, which the router's own `page` replaces on the
  active route). The stepper links to `getStepLink(step.key)`.
- `syncingStepKeys` draws a ring around the circle of the listed steps: an arc in
  `--fds-color-feedback-info-primary` over a track in `--fds-color-feedback-info-secondary`, which spins
  under `motion-safe:` only, so a reader who asked for no motion sees a static ring. A visually hidden
  "Syncing" follows the label. The keys come from `stepSync` over `useStepSyncReads`, the rule of the
  overview's row.
- `stepProgress` maps the key of a step under way to `{ fraction, label }`: the step is not checked, it keeps
  its number inside a static ring (`StepProgressRing`, an SVG drawn over the circle, an arc in
  `--fds-color-feedback-alert-primary` over a track in `--fds-color-feedback-alert-secondary-transparency-30`,
  the colours of the "Started" chip, no animation) filled to `fraction`, and a visually hidden `label`
  ("Started, 20 of 21") follows the step's name. A done step never shows it and a syncing step shows its
  spinning ring instead. The overview's rows draw the same ring.

**Company, Finances and Tolerance save as the reader types**, like Defenses (section 12), with no
success toast (`skipSuccessToast`) and no step-level save on Next: a failed write keeps the global error
toast, and nothing blocks leaving the step, but Tolerance with exactly one field filled (section 9).
- Company: a select (sector, country, revenue band) writes on change; the name and the employee count
  (`NullableNumberInput`, a whole number from 0, blank meaning none) write on blur. Each write goes through
  `organizations.updateOrganization` with that field alone, and only when it differs from the scope's.
  A blank name or a decimal count fails the schema: it shows its error and nothing is written.
- Finances and Tolerance: section 8 and section 9.
- Each form keeps `keepDirtyValues`, so a doorbell refetch after a write never undoes what the reader
  is typing.

Navigation is generic. `nextStepKey` and `previousStepKey` (`onboarding-utils.ts`) skip the steps
flagged `available: false` and answer `null` past the last or before the first, which
`getStepLink` turns into the Get started overview, except that Next leaves the last step for the finish
screen once the wizard is finished (`getNextLink`, section 14). `STEP_LINKS` in `onboarding-links.ts` is where a
step's page is declared, one typed `linkOptions` entry per available step, and
`onboarding-links.test.ts` fails when an available step has none. The overview page reads the same
table for its links. **There is no Skip button**: Next never gates on a step's status, so a Skip
would only duplicate it.

**Each step links to the app page that lists its items** (`SeeAllLink`, `components/see-all-link.tsx`): a
plain in-app link in the same tab, so the reader can see everything and create more there. Assets,
Threats and Defenses pass it to `SourcesSection` (`seeAll`), beside the tenant's total, to the
tenant-wide Assets, Threat center and Controls pages. Protect and Scenarios put it in the heading row of
their list, "See all primary assets" and "See all risk scenarios", on the wizard's scope. Company and
Tolerance end with "See the risk scope", to the scope's Details overview, where the tolerance is
shown.

## 11. Key files

| Concern | File |
| --- | --- |
| Table, policy, name constant | `module/src/modules/onboarding-wizards/{schema,constants}.ts` |
| Template key on the primary asset | `onboardingTemplate` in `module/src/modules/primary-assets/schema.ts`, `PRIMARY_ASSET_ONBOARDING_TEMPLATES` in `constants.ts`, the option of `createPrimaryAsset` in `back/src/features/app-router/primary-assets/primary-assets-router.ts` |
| Status computation | `module/src/modules/onboarding-wizards/service.ts` |
| Provisioning | `module/src/modules/tenants/{repository,service}.ts` (`CreateTenantOptions`) |
| Provisioning option wiring | `back/src/features/app-router/tenants/tenants-router.ts` |
| Endpoint | `back/src/features/app-router/onboarding-wizard/onboarding-wizard-router.ts` |
| Steps, status mapping, redirect decision | `front/src/features/onboarding/{onboarding-steps,onboarding-utils}.ts` |
| Wizard query | `front/src/features/onboarding/hooks/use-onboarding-wizard.ts` |
| Pages | `front/src/features/onboarding/components/{get-started-page,get-started-done,company-step,assets-step,threats-step,defenses-step,finances-step,tolerance-step,protect-step,scenarios-step}.tsx`, routes under `front/src/routes/_auth/$tenantId/{-$organizationId}/get-started/` |
| Step layout and navigation | `front/src/features/onboarding/components/{onboarding-step-layout,onboarding-stepper}.tsx`, `front/src/features/onboarding/onboarding-links.ts` (`STEP_LINKS`), `nextStepKey` and `previousStepKey` in `onboarding-utils.ts` |
| Landing redirect | `front/src/features/onboarding/get-started-landing.ts` (`opensGetStarted`) |
| Company form | `front/src/features/onboarding/company-form.ts` |
| Finances and Tolerance forms | `front/src/features/financial-profiles/{use-financial-profile-form.ts,financial-profile-questionnaire-fields.tsx}`, `front/src/features/risk-tolerance/{risk-tolerance-fields.tsx,risk-tolerance-utils.ts}` |
| Revenue band rule | `module/src/modules/financial-profiles/service.ts` (`saveFinancialProfile`) |
| Source tiles and their section | `front/src/features/onboarding/components/{source-tile,asset-source-tiles,threat-source-tiles,see-all-link}.tsx`, the reads in `hooks/use-source-reads.ts`, the wording in `source-labels.ts` |
| Declared estate tile and drawer | `DeclaredEstateTile` and `AssetSourceTiles` (the order) in `front/src/features/onboarding/components/asset-source-tiles.tsx`, `declared-estate-source-drawer.tsx`, over `front/src/features/declared-estate/{declared-estate-questionnaire.tsx,use-declared-estate-form.ts}`, `useDeclaredEstateKindCount` in `hooks/use-source-reads.ts` |
| Defender drawer | `front/src/features/onboarding/components/defender-source-drawer.tsx`, a thin wrapper of `scheduled-source-drawer.tsx`, with its modes and the environment block in `onboarding-utils.ts` |
| Defenses tiles, drawers and logic | `front/src/features/onboarding/components/{defense-source-tiles,drata-source-drawer,self-assessment-drawer}.tsx`, `defenses-utils.ts`, `useControlCapabilities` in `hooks/use-source-reads.ts` |
| Protect templates, graph and logic | `front/src/features/onboarding/components/{protect-templates,protect-assets-graph}.tsx`, `protect-utils.ts` (templates, "Added" by key, the merge of the graphs and the filters), `protect-labels.ts` (translated names) |
| Scenarios step, cards and logic | `front/src/features/onboarding/components/{scenarios-step,scenario-cards}.tsx`, `scenarios-utils.ts` (suggestions, outcome keys, readiness link), `scenarios-labels.ts` (translated names), `useCompatibleCategoryIds` in `hooks/use-source-reads.ts` |
| Pending computation read | `crqIndicators.getPendingComputation` in `back/src/features/app-router/crq-indicators/crq-indicators-router.ts`, over `hasActiveComputationForScenario` in `module/src/modules/jobs/{repository,service}.ts` |
| Finish screen | `front/src/features/onboarding/components/get-started-done.tsx`, route `get-started/done`, `getNextLink` and `GET_STARTED_DONE_LINK` in `onboarding-links.ts` |
| Unavailable connector body | `front/src/features/onboarding/components/connector-unavailable-body.tsx` |
| OpenCTI drawer and OpenCRQ set action | `front/src/features/onboarding/components/opencti-source-drawer.tsx`, with `getDefaultThreatsCardMode`, `getDefaultThreatsTileAction`, the progress functions and the OpenCTI environment block in `onboarding-utils.ts` |
| Overview row while a source imports | `front/src/features/onboarding/components/get-started-page.tsx`, `stepSync` in `onboarding-utils.ts`, `useStepSyncReads` and `useImportedCount` in `hooks/use-source-reads.ts`, `SourceProgressLine` from `source-tile.tsx` |
| Status reads | `module/src/modules/onboarding-wizards/repository.ts` (`hasSupportingAsset`, `countDeclaredEstateKinds`, `hasThreat`, `countCapabilityAssessments`, `findFinancialProfile`, `hasPrimaryAsset`, `hasComputedRiskScenario`, and the join of `findFirstOnboardingWizard` for Tolerance), with the questionnaire's rule in `module/src/modules/financial-profiles/questionnaire-progress.ts` |
| Configure forms shared with the Integrations drawers | `front/src/features/integrations/components/{configure-integration-form,configure-integration-drawer}.tsx` (Defender), `front/src/features/integrations/components/{opencti-configure-form,opencti-configure-drawer}.tsx` (OpenCTI), `front/src/features/integrations/components/service-account-choice-fields.tsx` and `front/src/features/integrations/service-account-choice-utils.ts` (the service account choice both carry) |
| Seen marker | `front/src/stores/onboarding-seen-collection.ts` |
| Navigation entry | `front/src/components/layout/main-layout/fds-navbar/{nav-model,nav-items,fds-navbar}.tsx` |
| Shared pieces this feature extended | `front/src/components/shared/wizard-step-indicator.tsx` (`completedStepKeys`, `renderStepLink`, `syncingStepKeys`, `stepProgress`, wraps when its steps overflow) with `step-progress-ring.tsx`, `front/src/components/shared/unsaved-changes-dialog.tsx` (`title`, `description`, `discardLabel`, defaults unchanged), `front/src/features/organizations/components/revenue-band-select.tsx`, `front/src/features/integrations` (`ConnectorStateChip`, `DisableDefaultThreatsDialog`), `front/src/features/controls/capability/ui/strength-info.tsx` (the rung descriptions, shared with the Controls edit drawer) |
| Integration tests | `integration-tests/src/tests/service/onboarding-wizards.test.ts`, `integration-tests/src/tests/http/onboarding-wizard.test.ts`, `integration-tests/src/tests/service/jobs/pending-computation.test.ts`, `integration-tests/src/tests/http/crq-pending-computation.test.ts` |

The navigation code imports the hook and the utils by their own paths, not through the feature's
barrel: the barrel exports the pages, which import the layout, and the cycle breaks at load.

## 12. The Defenses step

The step lists its sources as two tiles under "Defense sources" (`SourcesSection`, two columns):
**Drata** and **Assess yourself**. Like the other steps they add up and lead to the same status rule
(`started` once a control is assessed, `done` when all are, section 4). The header's total is the catalogue's real count,
"N of 51 capabilities assessed", from `controlCapabilities.getControlCapabilities` (the 51 is
`capabilities.length`, never written in the code, and "assessed" is any assessment row, a declared
level 0 included).

- **The Drata tile** has the Defender tile's shape: the connector's state chip, the run's progress
  line when its percentage is known, and Configure. It carries **no count**: no read tells which
  assessments Drata fed (the source sits in `control_capability_assessment_sources`, exposed only by
  a control's own detail, and `lastAssessedConnector` says `derivation` for any derived write), and a
  tile never shows the whole catalogue as its own.
- **Configure opens `DrataSourceDrawer`**, the Defender drawer's generalisation:
  `ScheduledSourceDrawer` (`source`, unavailable message, environment block, documentation URL) holds
  the three states of section 6, and both drawers are thin wrappers of it. *Unavailable* shows
  `CONNECTORS__DRATA__<tenantId>__API_KEY=`, the one required variable (`drataEnvBlock`), and the
  Drata section of the configuration documentation (`DRATA_DOCUMENTATION_URL`). *Configure* renders
  the Integrations drawer's form (`useConfigureIntegration`) and Sync now, with the same
  `canSyncConnector` rule.
- **The Assess yourself tile** counts the capabilities assessed by hand (`countAssessedByHand`: an
  assessment with at least one axis in manual mode, so a capability both axes of which a connector or a
  published framework derives is not counted) and shows an "Active" chip once there is one. Assess opens
  `SelfAssessmentDrawer`, a wide `DisplayDrawer`.
- **The drawer lists every capability**, in collapsible sections by domain (`groupCapabilitiesByDomain`,
  the catalogue's domain order and position order, the first section open), each titled with its "x of y
  assessed" count. A row holds the two questions of the Controls edit drawer, with the existing strength
  and coverage labels and their info tooltips; the strength tooltip reads the control's rung descriptions
  (`getControlCapability`) only once it opens. An axis a connector or a framework derives wears an
  "Auto" chip; picking a level there declares it by hand.
- **Each pick is saved at once**, without a toast, through `controlCapabilities.upsertAssessment`, which
  writes the **tenant's** assessment: the step never writes a scope override, and it does not reuse the
  Controls edit drawer, which picks the scope form from the URL's `organizationId`. A first declaration
  names both axes (the backend refuses one), so the first pick on an unassessed capability waits as a
  local draft with "Answer both questions to assess this control." and the second pick saves both
  (`planRowPick`). A capability that holds an assessment saves a pick on its axis alone.

## 13. The Protect step

The page is titled "What you protect" and reads as two numbered sections: **1. Choose what you protect**
(the template cards and Add your own, with the count of the scope's primary assets and "See all primary
assets" in its heading row) and **2. Link the assets that support it** (the graph and its controls, drawn
once the scope holds a primary asset). A risk scenario always targets primary assets, so there is no choice
to make first. Protect is done on the data alone, a primary asset on the scope (section 4).

- **Six template cards**: **Customer data** and **HR data**
  (Personal data), **Payments and treasury** (Own funds and payment authority), **Production and
  operations** and **Email and collaboration** (Operations and services), **Intellectual property**
  (Proprietary information), then **Add your own**. `PROTECT_TEMPLATES` pairs the template
  keys of `PRIMARY_ASSET_ONBOARDING_TEMPLATES` (`@app/module/client`) with the business value category `code`; the name on the card is translated by
  `protectTemplateName`, never stored as a key.
- **A click creates the primary asset** on the wizard's scope (`primaryAssets.createPrimaryAsset`,
  `skipSuccessToast`: the card turning "Added" is the feedback), named in the reader's language,
  holding the template's category and sending the template's key as `onboardingTemplate`. The category id
  is read from `businessValueCategories.getBusinessValueCategories` (open to every member) and matched by
  `code`, so no id is written in `front`; a card stays disabled until the categories have loaded.
- **The data rule: the template is stored on the asset.** `primaryAssets.createPrimaryAsset` accepts the
  template key as `onboardingTemplate` and the list read returns it, so a primary asset records which
  template created it, whatever its name becomes afterwards or the language it was named in (section 2).
  A primary asset created by hand carries none.
- **"Added" is detected by key**: a template is added when the scope holds a primary asset whose
  `onboardingTemplate` is the template's key (`findTemplateAsset`), read from `primaryAssets.getPrimaryAssets`
  on the scope. A renamed asset still counts, a reader who switches language is not offered the templates
  again, and a primary asset created by hand under a template's name does not count. The list refreshes
  through the doorbell a moment after the write, so each clicked card stays disabled, with an "Adding…" chip,
  until it shows an asset of its key, while the other cards can be clicked meanwhile; a failed create releases
  its card. The unique index of section 2 refuses a duplicate the client cannot see, from another member or tab.
- **An added card offers Link assets and Remove.** Link assets opens `ManagePrimaryAssetDependenciesDrawer`
  (the primary asset's dependencies drawer, unchanged) for the asset of the key. Remove asks the primary
  assets list's own confirmation ("Delete primary asset", "This will permanently delete this primary asset and
  everything attached to it. This action cannot be undone.") and calls `primaryAssets.deletePrimaryAssets`
  with its toast "Primary asset deleted successfully."; once the list drops the asset the card is offered again.
  The graph stops reading the asset as soon as the deletion is sent (`useMutationState` on
  `deletePrimaryAssets`): the list drops it only on the doorbell, and its graph's read meanwhile answers
  `NOT_FOUND`.
  **Add your own** opens `PrimaryAssetCreateSheet`, the primary assets page's own sheet, with its own success
  toast.
- **One graph draws every primary asset of the scope.** `ProtectAssetsGraph` reads
  `getPrimaryAssetDependencyGraph` for each primary asset (`useQueries`, one read each, hidden or not, so a
  filter never waits on a read), merges the graphs of the shown ones (`mergeDependencyGraphs`) and builds the
  model the way `PrimaryAssetDependenciesTab` does it, drawn by `DependencyGraphCard` with a depth select. The
  memo is kept for the same reason: the graph's simulation owns the node objects, and the reads are combined
  so that an unchanged read keeps its identity.
- **The merge rule**: a supporting asset or a link met in several graphs is drawn once, by id. A fold of an asset's
  providers (`truncated`) survives only when every graph holding the asset folds it, with the fewest providers
  left out; the count of assets left out is the largest of the graphs' and 0 once no fold remains, since the
  distinct assets two graphs leave out cannot be told from their counts. A primary asset with no link is a node
  of its own, even in a scope where nothing is linked yet (`drawsUnlinkedNodes` on `DependencyGraphCard`). When
  something is linked, `ColumnGraph` pins such a node under the lowest linked node (`pinUnlinkedBelow`): the
  repulsion would otherwise push it away for the whole simulation and the fitted view shrink the drawing.
- **The filters**: the primary assets are toggle buttons above the graph, all shown by default
  (`aria-pressed`). Hiding one (`toggleHiddenId`, `visiblePrimaryAssets`) takes its node and every supporting asset
  only it reaches off the graph, since the shown graphs alone are merged: a supporting asset another shown primary
  asset also reaches stays. Hiding every one leaves the card's empty state.
- **Link assets on the graph** opens the same drawer for the primary asset picked in a select next to it (the
  first until the reader picks, `resolveSelectedAsset`; no select when the scope holds one), so assets the
  reader created by hand are linked too. A link saved in the drawer refreshes the graph through the doorbell; a
  failing graph read says so in place of the card.

## 14. The Scenarios step and the finish screen

The page is titled "Your first scenarios". It works on the wizard's risk scope and shows, from top to
bottom, the scope's scenarios (`riskScenarios.getRiskScenariosOverview` on the scope), the suggestions
and a **Create and compute** button.

- **Suggestions** are built by the pure `buildScenarioSuggestions`: one card per attack outcome that
  reaches at least one of the scope's primary assets, holding all of those assets (an asset is reached
  when one of its business value categories is among the outcome's, from
  `lossDrivers.getCompatibleBusinessValueCategoryIds`, one read per outcome). A card is titled with the
  outcome and subtitled with the assets; the scenario it creates is named "<outcome> · <assets>"
  (`suggestionName`), in the reader's language. A suggestion is offered only while the scope holds no
  scenario of that attack outcome, whatever its primary assets: a primary asset added later, or a
  scenario edited elsewhere, never brings the outcome back. **While the scope holds no primary
  asset** the step offers nothing to create: it says "Scenarios need a primary asset" with a link to the
  Protect step (`NoPrimaryAssetNotice`), and still lists the scope's existing scenarios.
- **Outcomes are identified by their catalogue id**, never by name. A tenant's outcome row id is
  `deriveSeedId(tenantId, catalogue id)` and its name is an editable label, so `resolveOutcomeKey`
  finds the key (`ransomware`, `data-theft-extortion`...) by deriving the seven ids for the tenant of
  the page (`useParams`), which is why `module/src/client.ts` exports the seven ids and `deriveSeedId`.
  The key picks the translated name (`outcomeLabel`, an outcome of no known key keeps the tenant's own
  name) and the default checks: Ransomware, Data Theft Extortion, Financial Fraud & Funds Theft and
  Service Disruption. The cards are ordered by the catalogue.
- **Create and compute** creates each checked card (`riskScenarios.createRiskScenario`,
  `skipSuccessToast`: the cards updating is the feedback) with its primary assets. It asks no
  simulation: a creation books its first one through its recompute, and a second ask would run the
  scenario twice. A card shows "Creating…" until the scope's scenarios list holds its scenario, which
  also removes the suggestion; a failed call releases the card.
- **A created scenario's row** shows its expected annual loss with its p10 to p90 band
  (`ScenarioAleCell`) once a run priced it (`hasScenarioFigure`: not retired by a scope that maps
  nothing, and a run with an `aleMean`). Without a figure it shows "Computing…" while
  `crqIndicators.getPendingComputation` says a computation is pending for the scenario (its financial
  estimates recompute, a tenant-wide one, its simulation, or a tenant's attacker mixture or price
  recompute: on a fresh tenant the simulation booked at creation waits in the queue until the
  outcome's mixture exists, and the price recompute may price the scenario first) or has not
  answered, else the scenario's
  readiness badge (`ScenarioReadinessBadge`) and, when the wizard can fix it (`readinessStepKey`), a link
  to the step: no mapped asset to Assets, a missing threat event frequency to Threats, a missing
  financial impact to Finances.
- **Next** leads to the finish screen when the wizard is finished, else to the overview (`getNextLink`).

**The finish screen** is the route `get-started/done` (`GetStartedDone`). It reads "Your platform is set
up", the number of the scope's scenarios whose latest run priced them (`countComputedScenarios`, the rule of
the Scenarios status), a primary "See your risk scenarios" button to the scope's list, and "What you
can do now": Risk scenarios, Assets, Treatment plans, Budget reviews and Compliance, each a line and a
link on the scope. A reader who opens it while the wizard is not finished is sent back to the overview.
The overview's primary button reads "What you can do now" and leads there once the wizard is finished.

## 15. What remains

- **Finances and Tolerance, deferred**: pre-filling the answers from the sector and the country,
  and assigning a question to a colleague.
- **Assets, deferred**: a live list of the assets as the import brings them in, in place of the
  count.
- **Threats, deferred**: a live list of the threats as an import brings them in, in place of the
  OpenCTI count, like the Assets one.
- **Lighter wizards** for risk scopes created after the first one. They attach to the scope through
  the same table, which is where a `kind` column would be added.
- Not planned yet: an AI assistance button and "learn more" links, which wait for documentation to
  point to.
