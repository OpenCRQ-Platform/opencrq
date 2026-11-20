---
applyTo: "back/src/features/xtm-sign-in/**,back/src/features/xtm-one/xtm-one-members.ts,back/src/features/app-router/members/**,module/src/modules/members/**,front/src/features/members/**,front/src/routes/join/**,back/src/features/auth-service/**,back/src/features/xtm-one/xtm-one-auth.ts,module/src/modules/auth/**,module/src/modules/capabilities/repository.ts,module/src/modules/platform-capabilities/**,module/src/security/policies/**,front/src/features/auth/**,front/src/routes/login.tsx,front/src/routes/_auth/route.tsx,front/src/routes/_auth/index.tsx"
description: 'Sign-in through XTM One: accounts by XTM One id, members added by email through XTM One, the super administrator bypass in the security predicates, no password, one-hour sessions and where people land'
---

# Sign-in through XTM One

XTM One says who someone is; OpenCRQ decides what they can do, except for XTM One's own platform
administrator, whom OpenCRQ takes as its super administrator.

## Accounts

- An account is the XTM One user it was created for: `users.xtm_subject` holds the ID token's
  `sub`, and the sign-in (`xtm-sign-in-routes.ts`, `decideSignIn`) and XTM One's per-user JWTs
  (`xtm-one-auth.ts`) both look an account up by it, never by email alone: the one other way in is
  a pending account's own join link (below).
- An XTM One user OpenCRQ does not know gets an account at their first sign-in, with no password
  and no tenant (`auth.createXtmAccount`). One whose email another account holds, whatever its
  case, is refused with `conflict`.
- Every sign-in applies what XTM One says (`auth.applyXtmSignIn`): `is_super_admin`, set and
  cleared, the full name (`name`), the title (`xtm_title`, or `GET /api/v1/auth/me` with the per-user
  JWT when the claim is absent, `fetchXtmOneTitle`), `last_signed_in_at`, and the email unless
  another account holds it. A claim XTM One does not send leaves the stored value as it is; a
  `null` one clears it.
- The scopes are `openid email profile xtm_role`. `xtm_role` is asked only because it is the scope
  carrying `xtm_super_admin`: its own claim gives nothing, and no sign-in changes a platform group.
- `users.updateUser` writes preferences only; the global profile is read-only in the UI, with the
  per-tenant name and title override (`tenant_users.name`, `title`) unchanged.

## Members added by email

"Add members" (one FDS `Drawer`, `add-members-drawer.tsx`, for a tenant's groups or the platform
groups) searches XTM One's directory (`GET /api/v1/users/directory`, never past the 100 characters
its `q` takes, while the typed email, up to 254, is still offered) and adds people by email
(`members.addMembers`, `platformMembers.addMembers`). The search is the FDS `Combobox` in `multiple`
mode, debounced, its options the people XTM One found and the typed email, the members among them
disabled ("Already a member"); a pick keeps the search. For each person, five at a time, OpenCRQ
asks XTM One, as the acting administrator (`buildXtmOneHeaders`), to tell them (`POST
/api/v1/platform/access-notices`, `xtm-one-members.ts`), then writes what XTM One answered
(`membersService`):

| XTM One answers | OpenCRQ |
|---|---|
| `notified`, an XTM One id | the account of that id, else the pending account holding the email, else a new one tied to that id |
| `invited` | a pending account: the email, no `xtm_subject`, no password; when XTM One could not email the invitation, the drawer shows its own registration `link` to send ("Copy the invitation link"), else the person's join link, never the access link, which leads nowhere without an XTM One account |
| 403, or 404 for a typed email | nothing for that email: `not-addable`, "cannot be added here" |
| 409: an invitation no platform made (an XTM One administrator's own) is pending for the email | nothing for that email, and XTM One leaves that invitation as it is: "an XTM One invitation is already pending" |
| 404, 429, an outage, for an email whose account is already tied to an XTM One id | added by that id, the email marked not sent ("Copy the access link"); the XTM One id the caller sent is never trusted, so anyone else is refused |

Whoever ends on a pending account is told as an invitation is, whatever XTM One answered: a pending
account is reached only through its join link, so when no email went out the drawer gives that
link, and the generic access link would end on a conflict. XTM One's super administrators are marked
"Already a member" in both scopes and left out by the service, with no notice and no row: they hold
every right from the claim, and a membership written here would outlive it. An email whose account
is tied to another XTM One user is refused as `not-addable` too, the code XTM One's refusal to
invite gets, so the answer never tells a caller that an account they cannot see holds the email; a
person picked from the directory is refused so before XTM One is asked, a typed email once it has
answered. On the platform, the
scope is named "Platform administration (<groups>)", in the drawer, the notification and XTM One's
email, since a tenant has groups of the same names.

The capability (`MANAGE_SECURITY`, `MANAGE_USERS`) is checked before XTM One is asked anything, so a
refused caller never makes XTM One email anyone; the policies on `tenant_users`, `group_users` and
`platform_group_users` stay the floor. The in-app notification (`member-added`) follows the commit;
its stored title is English, and the front renders it from its `data` in the reader's language, a
tenant's linking to that tenant.

A pending account is linked by its join link only. Whenever the person may be invited (no account
tied to an XTM One id holds the email), the notice's `path` is `/join/<token>`, a fresh random token
of which `users.join_token_hash` keeps the SHA-256: XTM One sends the person there after
registration, and links there in its access email. `/join/<token>` (front) goes to
`/api/auth/xtm/login?join=<token>`, which carries the token in the flow cookie through XTM One. At
the callback, after the `sub` lookup, `auth.linkPendingAccount` gives the `sub` to the account whose
hash matches, which has no `xtm_subject` and whose email is the ID token's (case-insensitive), and
clears the hash, in one conditional update; when it links nothing, the `sub` is looked up again
(`findLinkedAccount`), so two callbacks of one link both sign in to the account. Never the email alone: XTM One lets a user change their
own email unverified, so a match on it would let anyone take a pending account. A token that matches
nothing is ignored, and the sign-in goes on as without one. Neither the token nor the path is
logged.

## The super administrator bypass

`xtm_super_admin: true` (XTM One's `ADMIN_EMAIL` account) makes `users.is_super_admin` true; any
other value, or no claim, makes it false. The super administrator reads and writes every tenant and
holds every tenant and platform capability with no `tenant_users` row and no group. The bypass
lives in the security predicates only, never in a router:

| Predicate | File | What it opens |
|---|---|---|
| `callerReachesTenant` (`userIsSuperAdmin` or `callerIsMember`) | `tenant-policies.ts` | every tenant-isolated and parent-scoped table, for a `client` origin |
| `tenantMembershipRule` | `tenant-policies.ts` | the `tenants` table: tenant list, picker, landing |
| `usersReadRule` (client, connector and job arms) | `tenant-policies.ts` | the `users` rows of the origin's tenant's members, and of every super administrator, for a caller reaching the tenant |
| `capabilityHeldInTenant` (client arm) | `capability-policies.ts` | every tenant capability, so `tenant_users` writes and `manageSecurityPolicy` too |
| `platformCapabilityHeld`, `hasManageUsers` | `platform-policies.ts` | every platform capability, the platform tables' writes, every `users` and `tenant_users` row on the platform surface |

A super administrator's `users` row reads in every tenant (`usersReadRule`, `is_super_admin` being the
row's own column), so their name shows wherever they wrote. A group holds members only: the user
pickers read the tenant's members (`tenants.getTenantUsers`) and leave them out, `groups.addUserToGroup`
refuses a non-member as not found, and removing a row stays limited to members (`tenantUsersRule`). `tenants.listTenantUsers` and
`getTenantUserNamesByIds` add them, with `isSuperAdmin`, which the screens show as a "Super
Administrator" tag beside the groups (`withSuperAdministratorTag`), never as a group; the profile of
one offers no "Manage". `users.getUser` and the caller's own preferences (`getUserLocale`,
`getUserTheme`, `getUserHomeDashboard`) read the caller's own row from their `platform` origin, whose
rule shows it, so a user with no membership still finds his own profile in a tenant.

A router that checks a client-supplied tenant (`assertOriginAuthorizedForTenant`,
`isOriginAuthorizedForItsTenant` in `back/src/features/app-router/tenant-access-utils.ts`, and the
`events.onDataChanged` subscription, whose tenant is an input, from the user's `platform` origin) asks
`tenants.callerReachesTenant`, which reads `views.tenants` and so the policy above, never the
caller's `tenant_users` row: a membership check the routers spell out themselves refuses the
super administrator the policies let in.

`userIsSuperAdmin(userId)` (`super-admin-policies.ts`) is an `exists` on the caller's own row,
naming no column of the row being filtered, so Postgres evaluates it once per statement. It is
ORed beside a membership or capability check, never inside one: correlated to the row, it would
run per row and keep a tenant-wide read from going parallel.

Two places answer the capability questions the UI asks, and they agree with the policies:
`capabilities/repository.ts` (`hasCapability` through `capabilityHeldInTenant`, and
`findUserCapabilities` ORing `userIsSuperAdmin`), and `platform-capabilities/repository.ts`
(`hasPlatformCapability`, `findUserPlatformCapabilities` through `platformCapabilityHeld`). A new
membership or capability check takes the bypass the same way, or the UI shows the super
administrator a button the policy refuses, or the reverse.

The two effective-permissions reads (`getUserEffectivePermissions`,
`getUserPlatformEffectivePermissions`) return, beside the group → role rows, one row per capability
with `grantedBy: 'super_administrator'` and null group and role (`withGrantProvenance`), which the
profile shows as "Super administrator (XTM One)", with no role to edit.

What the bypass leaves alone:

- A connector, a job or another user: the predicate reads the acting user's own row only.
- The last-administrator guard: `platformCapabilityHasHolder` counts platform group holders only,
  since the status comes and goes with XTM One's claim.
- Membership: the super administrator is a member of no tenant and no group, and a tenant it
  creates gets no member (`createTenantWithAdmin`). The platform users list shows its tag with "All
  tenants".

`integration-tests/src/tests/service/super-admin.test.ts` proves both sides: everything granted,
everything gone once cleared, and nothing gained by anyone else.

## Sessions

A session opened through XTM One lasts an hour (`XTM_SESSION_DURATION_MS`): renewing it goes
through XTM One, which refuses a disabled account and sends the claims again. The browser renews on
a navigation within ten minutes of the end (`renewsSessionNow`, in the `_auth` route), so a
redirect never interrupts a form being edited, and a call refused with `UNAUTHORIZED` goes back
through the sign-in to the page it came from. The session's end reaches the browser as a duration
(`isLoggedIn.sessionExpiresInMs`), read on its own clock, so a browser whose clock runs ahead does
not renew on every page.

A renewal that goes through ends the session it renews. Once its flow cookie proves the browser
started the flow, the callback (`refuse`, in `xtm-sign-in-routes.ts`) ends the session the browser
holds when XTM One refused (`denied`, `conflict`), so the login page shows why; a transient failure
leaves it, and the login page sends the still signed-in browser back to its page with no renewal
until the page reloads (`deferRenewal`), so a failing XTM One is not asked on every page. Either way
the login page carries the flow's `redirect`, and a callback the browser did not start never signs it
out.

## No password

OpenCRQ keeps no password and offers no other way in, development builds included: no procedure
takes an email and a password, and `users.password_hash` is always empty. `xtm_one` is required in
every build, and the sign-in routes are always mounted.

A browser with no session sees OpenCRQ's logo and "Sign in with XTM One" (`front/src/routes/login.tsx`,
`signInPage`) while `authStatus.xtmSignIn` says XTM One can sign people in (a sign-in client
answered, and XTM One serving its OpenID discovery: `xtm-one-live-probe.ts`, 2 s timeout, answer
kept 15 s; `authStatus` gives the last answer at once and asks again behind it, the start route
waits for a fresh one), else "XTM One is unavailable". The registration heartbeat, which keeps XTM
One reachable for ten minutes after it stopped, decides the status and the toasts only. A sign-in
that did not go through says why. The page goes to XTM One on its own once, and only when a session
of this browser ended (`xtmSessionCollection`, set while signed in, cleared at sign-out and by that
redirect): never on a first visit nor after a sign-out, since XTM One's session outlives a sign-out
from OpenCRQ, which has no way to end it, and would sign the person straight back in.

A fresh install has no account until XTM One's administrator signs in as super administrator, but it
starts with its initial tenant (`initial_tenant`), which has no member. Integration tests start from
`signInAsFirstAdmin` or `signInAs` (`integration-tests/src/helpers/sign-in.ts`), which open a session
directly, and the image boot check (`scripts/ci/boot-image.sh`) authenticates with the service
account token the platform seed fixes.

## Where people land

`_auth/index.tsx`: the first tenant, else Platform › Tenants with platform access (the super
administrator included, on a platform whose tenants were all deleted since its last boot), else the
page "You don't have access to OpenCRQ yet", which keeps the session.

## Key files

- `back/src/features/xtm-sign-in/xtm-sign-in.ts`, `xtm-sign-in-routes.ts`
- `back/src/features/xtm-one/xtm-one-auth.ts`
- `module/src/modules/auth/`, `module/src/modules/members/`
- `back/src/features/xtm-one/xtm-one-members.ts`, `back/src/features/app-router/members/`
- `module/src/security/policies/super-admin-policies.ts` and the policies above
- `front/src/routes/_auth/route.tsx`, `_auth/index.tsx`, `front/src/routes/join/$token.tsx`, `front/src/features/auth/`, `front/src/features/members/`
