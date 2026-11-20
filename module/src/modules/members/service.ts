import { newError } from '@app/utils';
import { uuidv7 } from 'uuidv7';
import type { InferRepository } from '../../registry';
import type { AccessNoticeAnswer, MemberAddResult, MemberRefusal, MemberToAdd, SendAccessNotice } from './access-notice';
import type { MemberAccount } from './repository';
import { originUserId, requireClientTenantId } from '../../security';
import { defineService } from '../../registry';
import { capabilitiesService } from '../capabilities/service';
import { notificationsService } from '../notifications';
import { PlatformCapability_ManageUsers } from '../platform-capabilities';
import { platformCapabilitiesService } from '../platform-capabilities/service';
import { hashJoinToken, joinPath, newJoinToken } from './join-token';
import { membersRepository } from './repository';

type Repo = InferRepository<typeof membersRepository>;

export const MEMBER_ADDED_NOTIFICATION = 'member-added';
/** Where a platform member lands once signed in. */
export const PLATFORM_SCOPE_PATH = '/platform/security/tenants';

/** XTM One's notices go out a few at a time: one after the other, a slow XTM One held the add open for minutes. */
const NOTICE_CONCURRENCY = 5;

interface Delivery {
  emailSent: boolean,
  invited: boolean,
  invitationLink: string | null,
}

type Placement =
  | Delivery & { userId: string, joinTokenHash: string | null }
  | { refusal: MemberRefusal };

/** The account placed, and whether it is still pending: one that only its own `/join/` link can tie to XTM One. */
interface Placed {
  id: string,
  pending: boolean,
}

/** Who XTM One said this person is: their account by that id, else the pending account holding the email, else a new one. */
const placeNotified = async (
  repo: Repo,
  member: MemberToAdd & { email: string },
  byEmail: MemberAccount | null,
  xtmUserId: string,
): Promise<Placed | null> => {
  const linked = await repo.findAccountByXtmSubject(xtmUserId);
  if (linked) {
    return { id: linked.id, pending: false };
  }
  if (byEmail) {
    // A pending account only ever gets its XTM One id from its own `/join/` link, never from here.
    return byEmail.xtmSubject === null ? { id: byEmail.id, pending: true } : null;
  }
  const id = uuidv7();
  if (await repo.insertAccount({ id, email: member.email, xtmSubject: xtmUserId, name: member.fullName?.trim() || null, joinTokenHash: null })) {
    return { id, pending: false };
  }
  const raced = await repo.findAccountByXtmSubject(xtmUserId);
  return raced ? { id: raced.id, pending: false } : null;
};

const placePending = async (repo: Repo, email: string, byEmail: MemberAccount | null): Promise<string | null> => {
  if (byEmail) {
    return byEmail.xtmSubject === null ? byEmail.id : null;
  }
  const id = uuidv7();
  if (await repo.insertAccount({ id, email, xtmSubject: null, name: null, joinTokenHash: null })) {
    return id;
  }
  const raced = await repo.findAccountByEmail(email);
  return raced && raced.xtmSubject === null ? raced.id : null;
};

/**
 * What one answer of XTM One makes of one person. XTM One is asked before anything is written, and
 * a notice it could not send never undoes the add of someone OpenCRQ already ties to the email.
 * A pending account is reached only through its join link, so whoever has one is told as an
 * invitation is, whatever XTM One answered: the generic access link would end on a conflict.
 */
const place = async (
  repo: Repo,
  member: MemberToAdd & { email: string },
  byEmail: MemberAccount | null,
  joinToken: string | null,
  answer: AccessNoticeAnswer,
  linkTo: (path: string) => string,
): Promise<Placement> => {
  const rotated = joinToken === null ? null : hashJoinToken(joinToken);
  const joinLink = joinToken === null ? null : linkTo(joinPath(joinToken));
  const placed = (account: Placed | null, emailSent: boolean): Placement => {
    if (account === null) {
      return { refusal: 'not-addable' };
    }
    return account.pending
      ? { userId: account.id, joinTokenHash: rotated, emailSent, invited: true, invitationLink: emailSent ? null : joinLink }
      : { userId: account.id, joinTokenHash: rotated, emailSent, invited: false, invitationLink: null };
  };
  switch (answer.outcome) {
    case 'notified':
      return placed(await placeNotified(repo, member, byEmail, answer.xtmUserId), answer.emailSent);
    case 'invited': {
      const userId = await placePending(repo, member.email, byEmail);
      return userId === null
        ? { refusal: 'not-addable' }
        : { userId, joinTokenHash: rotated, emailSent: answer.emailSent, invited: true, invitationLink: answer.emailSent ? null : (answer.link ?? joinLink) };
    }
    case 'refused':
      return { refusal: 'not-addable' };
    case 'invitation-pending':
      return { refusal: 'invitation-pending' };
    case 'not-found':
    case 'not-sent': {
      // XTM One confirmed nothing: only the XTM One id OpenCRQ already holds for the email stands, never one the caller sent.
      const knownId = byEmail?.xtmSubject ?? null;
      if (knownId === null) {
        return { refusal: answer.outcome === 'not-found' ? 'not-addable' : 'unavailable' };
      }
      return placed(await placeNotified(repo, member, byEmail, knownId), false);
    }
  }
};

/** One entry per email, lowercased as XTM One stores it. */
const normalized = (members: Array<MemberToAdd>): Array<MemberToAdd & { email: string }> => [
  ...new Map(members.map((member) => {
    const email = member.email.trim().toLowerCase();
    return [email, { ...member, email }] as const;
  })).values(),
];

interface AddedMember {
  result: MemberAddResult,
  /** The account added, which the in-app notification goes to. */
  userId: string | null,
}

interface Scope {
  /** The place opened to them, as XTM One's email names it. */
  noticeName: string,
  path: string,
  join: (repo: Repo, userId: string) => Promise<void>,
}

type Atomic = <T>(callback: (ctx: { repo: Repo }) => Promise<T>) => Promise<T>;

const notAdded = (email: string, refusal: MemberRefusal): AddedMember => ({
  userId: null,
  result: { email, added: false, emailSent: false, invited: false, invitationLink: null, refusal },
});

const addMember = async (
  { repo, atomic }: { repo: Repo, atomic: Atomic },
  member: MemberToAdd & { email: string },
  scope: Scope,
  sendAccessNotice: SendAccessNotice,
  linkTo: (path: string) => string,
): Promise<AddedMember> => {
  const byEmail = await repo.findAccountByEmail(member.email);
  const known = member.xtmUserId ? await repo.findAccountByXtmSubject(member.xtmUserId) : null;
  // They hold every right from XTM One's claim: a membership written here would outlive it.
  if (byEmail?.isSuperAdmin || known?.isSuperAdmin) {
    return notAdded(member.email, 'super-administrator');
  }
  // A person picked from the directory whose email another XTM One user's account holds: refused
  // before XTM One would tell them of a scope they never join.
  if (member.xtmUserId && !known && byEmail?.xtmSubject && byEmail.xtmSubject !== member.xtmUserId) {
    return notAdded(member.email, 'not-addable');
  }
  const mayBeInvited = !known && byEmail?.xtmSubject == null;
  const joinToken = mayBeInvited ? newJoinToken() : null;
  const answer = await sendAccessNotice({ email: member.email, path: joinToken ? joinPath(joinToken) : scope.path, scopeName: scope.noticeName });
  const placement = await atomic(async ({ repo: tx }) => {
    const where = await place(tx, member, byEmail, joinToken, answer, linkTo);
    if ('userId' in where) {
      if (where.joinTokenHash !== null) {
        await tx.setJoinTokenHash(where.userId, where.joinTokenHash);
      }
      await scope.join(tx, where.userId);
    }
    return where;
  });
  if (!('userId' in placement)) {
    return notAdded(member.email, placement.refusal);
  }
  const { userId, emailSent, invited, invitationLink } = placement;
  return { userId, result: { email: member.email, added: true, emailSent, invited, invitationLink, refusal: null } };
};

/**
 * Adds each person and tells each through XTM One, a few at a time, the results in the order given.
 * Someone who may be invited (no account tied to an XTM One id yet) gets a fresh single-use
 * `/join/<token>` link, of which only the hash is kept: XTM One reissues its invitation on each
 * call, so the link it held before stops working anyway.
 */
const addMembers = async (
  context: { repo: Repo, atomic: Atomic },
  members: Array<MemberToAdd>,
  scope: Scope,
  sendAccessNotice: SendAccessNotice,
  linkTo: (path: string) => string,
): Promise<Array<AddedMember>> => {
  const people = normalized(members);
  const added: Array<AddedMember> = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < people.length) {
      const index = next;
      next += 1;
      added[index] = await addMember(context, people[index], scope, sendAccessNotice, linkTo);
    }
  };
  await Promise.all(Array.from({ length: Math.min(NOTICE_CONCURRENCY, people.length) }, worker));
  return added;
};

export const membersService = defineService(
  'members',
  membersRepository,
).dependsOn(() => [capabilitiesService, notificationsService, platformCapabilitiesService]).implement({
  /** The tenant's name, its members among these people, for the directory to mark them. */
  findTenantMembersAmong: async ({ repo, eventOrigin }, emails: Array<string>, xtmSubjects: Array<string>) =>
    await repo.findTenantMembersAmong(requireClientTenantId(eventOrigin), emails, xtmSubjects),
  findPlatformMembersAmong: async ({ repo }, emails: Array<string>, xtmSubjects: Array<string>) =>
    await repo.findPlatformMembersAmong(emails, xtmSubjects),

  addTenantMembers: async (
    { repo, atomic, deps, eventOrigin },
    members: Array<MemberToAdd>,
    groupIds: Array<string>,
    sendAccessNotice: SendAccessNotice,
    linkTo: (path: string) => string,
  ) => {
    const tenantId = requireClientTenantId(eventOrigin);
    // Before XTM One is asked anything: a refused write would come only after the person was told.
    if (!await deps.capabilities.hasManageSecurity()) {
      throw newError('Adding members requires the MANAGE_SECURITY capability', { tenantId });
    }
    const tenantName = await repo.findTenantName(tenantId);
    if (tenantName === null) {
      throw newError('Tenant not found', { tenantId });
    }
    const uniqueGroupIds = [...new Set(groupIds)];
    if (await repo.countTenantGroups(tenantId, uniqueGroupIds) !== uniqueGroupIds.length) {
      throw newError('A group is not one of this tenant', { tenantId });
    }
    const added = await addMembers({ repo, atomic }, members, {
      noticeName: tenantName,
      path: `/${tenantId}`,
      join: async (tx, userId) => {
        await tx.addTenantMembership(tenantId, userId);
        await tx.addGroupMemberships(uniqueGroupIds, userId);
      },
    }, sendAccessNotice, linkTo);
    const actor = await repo.findActorName(originUserId(eventOrigin) ?? '') ?? '';
    for (const { userId } of added) {
      if (userId !== null) {
        await deps.notifications.createNotification({
          userId,
          type: MEMBER_ADDED_NOTIFICATION,
          title: `${actor} added you to ${tenantName}`,
          message: `You can now open ${tenantName}.`,
          data: { tenantId, tenantName, addedBy: actor },
        });
      }
    }
    return { scopeName: tenantName, scopePath: `/${tenantId}`, results: added.map(({ result }) => result) };
  },

  addPlatformMembers: async (
    { repo, atomic, deps, eventOrigin },
    members: Array<MemberToAdd>,
    platformGroupIds: Array<string>,
    sendAccessNotice: SendAccessNotice,
    linkTo: (path: string) => string,
  ) => {
    if (!await deps.platformCapabilities.hasPlatformCapability(PlatformCapability_ManageUsers)) {
      throw newError('Adding platform members requires the MANAGE_USERS platform capability');
    }
    const uniqueGroupIds = [...new Set(platformGroupIds)];
    const groupNames = await repo.findPlatformGroupNames(uniqueGroupIds);
    if (uniqueGroupIds.length === 0 || groupNames.length !== uniqueGroupIds.length) {
      throw newError('Platform members are added to one or more platform groups');
    }
    // A tenant has groups of the same names ("Admin"), so the platform administration is named around them.
    const noticeName = `Platform administration (${groupNames.join(', ')})`;
    const added = await addMembers({ repo, atomic }, members, {
      noticeName,
      path: PLATFORM_SCOPE_PATH,
      join: (tx, userId) => tx.addPlatformGroupMemberships(uniqueGroupIds, userId),
    }, sendAccessNotice, linkTo);
    const actor = await repo.findActorName(originUserId(eventOrigin) ?? '') ?? '';
    for (const { userId } of added) {
      if (userId !== null) {
        await deps.notifications.createNotification({
          userId,
          type: MEMBER_ADDED_NOTIFICATION,
          title: `${actor} added you to the platform administration (${groupNames.join(', ')})`,
          message: 'You can now open the platform administration.',
          data: { platformGroupIds: uniqueGroupIds, platformGroupNames: groupNames, addedBy: actor },
        });
      }
    }
    return { scopeName: groupNames.join(', '), scopePath: PLATFORM_SCOPE_PATH, results: added.map(({ result }) => result) };
  },
});
