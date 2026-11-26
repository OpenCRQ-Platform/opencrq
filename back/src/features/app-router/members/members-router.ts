import type { AccessNoticeRequest, DrizzleDB, MemberAccount } from '@app/module';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { AuthUser } from '../../../trpc';
import type { XtmOneSettings } from '../../xtm-one/xtm-one-config';
import type { DirectoryPerson } from '../../xtm-one/xtm-one-members';
import type { PlatformSecurityProcedure, TenantSecurityProcedure } from '../app-router-router';
import { router } from '../../../trpc';
import { buildXtmOneHeaders } from '../../xtm-one/xtm-one-headers';
import { getXtmOneSettings } from '../../xtm-one/xtm-one-config';
import { DIRECTORY_QUERY_MIN_LENGTH, searchXtmOneDirectory, sendXtmOneAccessNotice } from '../../xtm-one/xtm-one-members';
import { userSessionOnly } from '../user-session-only';

/** Each person added is a notice XTM One sends, whose own limit is five notices an hour per person. */
const MEMBERS_PER_ADD_MAX = 50;

/** The longest email address (RFC 5321), so any typed email can still be picked. */
const DIRECTORY_INPUT_MAX_LENGTH = 254;

const DirectoryInputSchema = z.object({ query: z.string().trim().min(DIRECTORY_QUERY_MIN_LENGTH).max(DIRECTORY_INPUT_MAX_LENGTH) });

const DirectorySchema = z.object({
  people: z.array(z.object({ id: z.string(), fullName: z.string(), email: z.string(), alreadyMember: z.boolean() })),
  /** The query itself when it is an email no person found has: XTM One may invite it. */
  typedEmail: z.object({ email: z.string(), alreadyMember: z.boolean() }).nullable(),
});

const MemberToAddSchema = z.object({
  email: z.email(),
  xtmUserId: z.string().min(1).max(64).nullable().optional(),
  fullName: z.string().max(200).nullable().optional(),
});

const AddMembersResultSchema = z.object({
  scopeName: z.string(),
  /** The link to send by hand when XTM One sent no email to someone it did not invite. */
  accessLink: z.string(),
  results: z.array(z.object({
    email: z.string(),
    added: z.boolean(),
    emailSent: z.boolean(),
    invited: z.boolean(),
    /** The link to send by hand when XTM One could not email this person's invitation: XTM One's own, else their join link. */
    invitationLink: z.string().nullable(),
    refusal: z.enum(['not-addable', 'invitation-pending', 'unavailable', 'super-administrator']).nullable(),
  })),
});

const requireSettings = (): XtmOneSettings => {
  const settings = getXtmOneSettings();
  if (!settings) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'XTM One is not configured' });
  }
  return settings;
};

const requireUser = (user: AuthUser | null | undefined): AuthUser => {
  if (!user) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Adding members requires a user session' });
  }
  return user;
};

/** The calls to XTM One go as the acting administrator, whom XTM One names as the sender and holds to its own invitation rule. */
const xtmOneAs = async (db: DrizzleDB, user: AuthUser) => {
  const settings = requireSettings();
  const headers = await buildXtmOneHeaders(settings, db, { id: user.id, email: user.email, name: user.name });
  return {
    settings,
    search: (query: string) => searchXtmOneDirectory(settings, headers, query),
    send: (request: AccessNoticeRequest) => sendXtmOneAccessNotice(settings, headers, request),
    linkTo: (path: string) => `${settings.platformUrl}${path}`,
  };
};

const isEmail = (value: string): boolean => z.email().safeParse(value).success;

/** Marks the people found, and the typed email, that already belong to the scope. */
const markMembers = (query: string, people: Array<DirectoryPerson>, members: Array<MemberAccount>): z.infer<typeof DirectorySchema> => {
  const memberEmails = new Set(members.map(({ email }) => email.toLowerCase()));
  const memberSubjects = new Set(members.flatMap(({ xtmSubject }) => (xtmSubject ? [xtmSubject] : [])));
  const typed = query.toLowerCase();
  return {
    people: people.map((person) => ({ ...person, alreadyMember: memberSubjects.has(person.id) || memberEmails.has(person.email.toLowerCase()) })),
    typedEmail: isEmail(typed) && !people.some(({ email }) => email.toLowerCase() === typed)
      ? { email: typed, alreadyMember: memberEmails.has(typed) }
      : null,
  };
};

const lookupsOf = (query: string, people: Array<DirectoryPerson>) => ({
  emails: [...people.map(({ email }) => email), ...(isEmail(query) ? [query] : [])],
  xtmSubjects: people.map(({ id }) => id),
});

/** Adding people to the tenant on the origin, by email, through XTM One. */
export const membersRouter = (securityProcedure: TenantSecurityProcedure, db: DrizzleDB) => router({
  // bounded-by: XTM One's directory answers at most DIRECTORY_LIMIT people
  searchDirectory: securityProcedure
    .use(userSessionOnly)
    .input(DirectoryInputSchema)
    .output(DirectorySchema)
    .query(async ({ input, ctx: { services, origin, user } }) => {
      const people = await (await xtmOneAs(db, requireUser(user))).search(input.query);
      const { emails, xtmSubjects } = lookupsOf(input.query, people);
      return markMembers(input.query, people, await services.withOrigin(origin).members.findTenantMembersAmong(emails, xtmSubjects));
    }),
  addMembers: securityProcedure
    .use(userSessionOnly)
    .input(z.object({ members: z.array(MemberToAddSchema).min(1).max(MEMBERS_PER_ADD_MAX), groupIds: z.array(z.uuid()) }))
    .output(AddMembersResultSchema)
    .mutation(async ({ input, ctx: { services, origin, user } }) => {
      const xtmOne = await xtmOneAs(db, requireUser(user));
      const added = await services.withOrigin(origin).members.addTenantMembers(input.members, input.groupIds, xtmOne.send);
      return { scopeName: added.scopeName, accessLink: xtmOne.linkTo(added.scopePath), results: added.results };
    }),
});

/** Giving people platform groups, by email, through XTM One: an account with no tenant for whoever has none. */
export const platformMembersRouter = (securityProcedure: PlatformSecurityProcedure, db: DrizzleDB) => router({
  // bounded-by: XTM One's directory answers at most DIRECTORY_LIMIT people
  searchDirectory: securityProcedure
    .use(userSessionOnly)
    .input(DirectoryInputSchema)
    .output(DirectorySchema)
    .query(async ({ input, ctx: { services, origin, user } }) => {
      const people = await (await xtmOneAs(db, requireUser(user))).search(input.query);
      const { emails, xtmSubjects } = lookupsOf(input.query, people);
      return markMembers(input.query, people, await services.withOrigin(origin).members.findPlatformMembersAmong(emails, xtmSubjects));
    }),
  addMembers: securityProcedure
    .use(userSessionOnly)
    .input(z.object({ members: z.array(MemberToAddSchema).min(1).max(MEMBERS_PER_ADD_MAX), platformGroupIds: z.array(z.uuid()).min(1) }))
    .output(AddMembersResultSchema)
    .mutation(async ({ input, ctx: { services, origin, user } }) => {
      const xtmOne = await xtmOneAs(db, requireUser(user));
      const added = await services.withOrigin(origin).members.addPlatformMembers(input.members, input.platformGroupIds, xtmOne.send);
      return { scopeName: added.scopeName, accessLink: xtmOne.linkTo(added.scopePath), results: added.results };
    }),
});
