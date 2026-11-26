import type { AccessNoticeAnswer, AccessNoticeRequest, EventOrigin, MemberToAdd, SendAccessNotice } from '@app/module';
import { Capability_ManageSecurity } from '@app/module';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenant, createTenantWithAdmin, createUser, grantCapability } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

type Row = { id: string, email: string, name: string | null, xtm_subject: string | null, password_hash: string | null };

const accountByEmail = async (email: string): Promise<Row | undefined> => (
  await db.execute<Row>(sql`SELECT id, email, name, xtm_subject, password_hash FROM users WHERE lower(email) = lower(${email})`)
).rows[0];

const isTenantMember = async (tenantId: string, userId: string): Promise<boolean> => (
  await db.execute(sql`SELECT 1 FROM tenant_users WHERE tenant_id = ${tenantId} AND user_id = ${userId}`)
).rows.length > 0;

const groupIdsOf = async (userId: string): Promise<Array<string>> => (
  await db.execute<{ group_id: string }>(sql`SELECT group_id FROM group_users WHERE user_id = ${userId}`)
).rows.map(({ group_id: groupId }) => groupId);

const platformGroupIdsOf = async (userId: string): Promise<Array<string>> => (
  await db.execute<{ platform_group_id: string }>(sql`SELECT platform_group_id FROM platform_group_users WHERE user_id = ${userId}`)
).rows.map(({ platform_group_id: groupId }) => groupId);

const notificationsOf = async (userId: string) => (
  await db.execute<{ type: string, title: string }>(sql`SELECT type, title FROM notifications WHERE user_id = ${userId}`)
).rows;

/** A tenant `userId` created, with one group, and then left, so the tenant is one they hold no right in. */
const anotherTenant = async (userId: string) => {
  const tenantId = await createTenant(services, userId);
  const groupId = uuidv7();
  await services.withOrigin({ type: 'client', userId, tenantId }).groups.createGroup({ id: groupId, name: 'Elsewhere' });
  await db.execute(sql`DELETE FROM group_users WHERE user_id = ${userId} AND group_id IN (SELECT id FROM groups WHERE tenant_id = ${tenantId})`);
  await db.execute(sql`DELETE FROM tenant_users WHERE user_id = ${userId} AND tenant_id = ${tenantId}`);
  return { tenantId, groupId };
};

const countUsers = async (): Promise<number> => Number((await db.execute<{ count: string }>(sql`SELECT count(*) AS count FROM users`)).rows[0].count);

/** XTM One as the notice route answers, per email; every request it got is kept, `requestTo` finding one whatever the order they went out in. */
const xtmOneAnswering = (answers: Record<string, AccessNoticeAnswer>) => {
  const requests: Array<AccessNoticeRequest> = [];
  const send = vi.fn<SendAccessNotice>((request) => {
    requests.push(request);
    return Promise.resolve(answers[request.email] ?? { outcome: 'not-found' });
  });
  const requestTo = (email: string): AccessNoticeRequest => {
    const request = requests.find((sent) => sent.email === email);
    if (!request) {
      throw new Error(`No notice sent to ${email}`);
    }
    return request;
  };
  return { send, requests, requestTo };
};

describe('Members from XTM One', () => {
  let adminOrigin: Extract<EventOrigin, { type: 'client' }>;
  let tenantId: string;
  let groupId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    groupId = uuidv7();
    await services.withOrigin(adminOrigin).groups.createGroup({ id: groupId, name: 'Risk analysts' });
  });

  const addToTenant = (members: Array<MemberToAdd>, send: SendAccessNotice, origin: EventOrigin = adminOrigin) => (
    services.withOrigin(origin).members.addTenantMembers(members, [groupId], send)
  );

  describe('adding to a tenant', () => {
    it('should make a person XTM One notified a member with the groups, their account created by their XTM One id', async () => {
      const xtmOne = xtmOneAnswering({ 'jane@acme.com': { outcome: 'notified', xtmUserId: 'xtm-jane', emailSent: true } });

      const added = await addToTenant([{ email: 'Jane@Acme.com', xtmUserId: 'xtm-jane', fullName: 'Jane Martin' }], xtmOne.send);

      expect(added.results).toEqual([{ email: 'jane@acme.com', added: true, emailSent: true, invited: false, invitationLink: null, refusal: null }]);
      expect(added.scopePath).toBe(`/${tenantId}`);
      expect(xtmOne.requests).toEqual([{ email: 'jane@acme.com', path: `/${tenantId}`, scopeName: added.scopeName }]);
      const account = await accountByEmail('jane@acme.com');
      expect(account).toMatchObject({ xtm_subject: 'xtm-jane', name: 'Jane Martin', password_hash: null });
      expect(await isTenantMember(tenantId, account!.id)).toBe(true);
      expect(await groupIdsOf(account!.id)).toEqual([groupId]);
    });

    it('should reuse the account of an XTM One id it already knows, and link to the tenant', async () => {
      const { userId } = await createUser(db, 'jane.old@acme.com');
      await db.execute(sql`UPDATE users SET xtm_subject = 'xtm-jane' WHERE id = ${userId}`);
      const xtmOne = xtmOneAnswering({ 'jane@acme.com': { outcome: 'notified', xtmUserId: 'xtm-jane', emailSent: true } });

      await addToTenant([{ email: 'jane@acme.com', xtmUserId: 'xtm-jane' }], xtmOne.send);

      expect(xtmOne.requests[0].path).toBe(`/${tenantId}`);
      expect(await countUsers()).toBe(2);
      expect(await isTenantMember(tenantId, userId)).toBe(true);
    });

    it('should give a person XTM One invited a pending account: the email, no XTM One id, no password', async () => {
      const xtmOne = xtmOneAnswering({ 'jane@acme.com': { outcome: 'invited', emailSent: true, link: null } });

      const added = await addToTenant([{ email: 'jane@acme.com' }], xtmOne.send);

      expect(added.results[0]).toMatchObject({ added: true, emailSent: true, invited: true });
      expect(xtmOne.requests[0].path).toBe(`/${tenantId}`);
      const account = await accountByEmail('jane@acme.com');
      expect(account).toMatchObject({ xtm_subject: null, password_hash: null });
      expect(await isTenantMember(tenantId, account!.id)).toBe(true);
      expect(await groupIdsOf(account!.id)).toEqual([groupId]);
    });

    it('should give the invitation link XTM One could not email for this person, and none once it emailed it or gave none', async () => {
      const link = 'https://xtm-one.example.com/register?invitation=abc';
      const xtmOne = xtmOneAnswering({
        'jane@acme.com': { outcome: 'invited', emailSent: false, link },
        'paul@acme.com': { outcome: 'invited', emailSent: true, link: null },
        'anna@acme.com': { outcome: 'invited', emailSent: false, link: null },
      });

      const added = await addToTenant([{ email: 'jane@acme.com' }, { email: 'paul@acme.com' }, { email: 'anna@acme.com' }], xtmOne.send);

      expect(added.results).toEqual([
        { email: 'jane@acme.com', added: true, emailSent: false, invited: true, invitationLink: link, refusal: null },
        { email: 'paul@acme.com', added: true, emailSent: true, invited: true, invitationLink: null, refusal: null },
        { email: 'anna@acme.com', added: true, emailSent: false, invited: true, invitationLink: null, refusal: null },
      ]);
    });

    it('should keep one pending account for a person invited twice', async () => {
      const xtmOne = xtmOneAnswering({ 'jane@acme.com': { outcome: 'invited', emailSent: true, link: null } });
      await addToTenant([{ email: 'jane@acme.com' }], xtmOne.send);
      const first = await accountByEmail('jane@acme.com');

      await addToTenant([{ email: 'jane@acme.com' }], xtmOne.send);

      const second = await accountByEmail('jane@acme.com');
      expect(second!.id).toBe(first!.id);
      expect(await countUsers()).toBe(2);
    });

    it('should keep one account for an email another case of which an account took meanwhile', async () => {
      const xtmOne = xtmOneAnswering({ 'jane@acme.com': { outcome: 'invited', emailSent: true, link: null } });
      const send = vi.fn<SendAccessNotice>(async (request) => {
        await createUser(db, 'Jane@Acme.com');
        return xtmOne.send(request);
      });

      const added = await addToTenant([{ email: 'jane@acme.com' }], send);

      expect(added.results[0]).toMatchObject({ added: true, refusal: null });
      expect(await countUsers()).toBe(2);
      expect(await isTenantMember(tenantId, (await accountByEmail('jane@acme.com'))!.id)).toBe(true);
    });

    it('should tie the pending account that took the email meanwhile to the XTM One id XTM One names', async () => {
      const xtmOne = xtmOneAnswering({ 'jane@acme.com': { outcome: 'notified', xtmUserId: 'xtm-jane', emailSent: true } });
      let pendingId = '';
      const send = vi.fn<SendAccessNotice>(async (request) => {
        pendingId = (await createUser(db, 'Jane@Acme.com')).userId;
        return xtmOne.send(request);
      });

      const added = await addToTenant([{ email: 'jane@acme.com', xtmUserId: 'xtm-jane' }], send);

      expect(added.results[0]).toMatchObject({ added: true, refusal: null });
      expect(await accountByEmail('jane@acme.com')).toMatchObject({ id: pendingId, xtm_subject: 'xtm-jane' });
      expect(await countUsers()).toBe(2);
      expect(await isTenantMember(tenantId, pendingId)).toBe(true);
    });

    it('should give a pending account the XTM One id XTM One names for its email', async () => {
      const invite = xtmOneAnswering({ 'jane@acme.com': { outcome: 'invited', emailSent: true, link: null } });
      await addToTenant([{ email: 'jane@acme.com' }], invite.send);
      const pendingId = (await accountByEmail('jane@acme.com'))!.id;
      const notify = xtmOneAnswering({ 'jane@acme.com': { outcome: 'notified', xtmUserId: 'xtm-jane', emailSent: true } });

      const added = await addToTenant([{ email: 'jane@acme.com' }], notify.send);

      expect(added.results[0]).toEqual({ email: 'jane@acme.com', added: true, emailSent: true, invited: false, invitationLink: null, refusal: null });
      expect(await accountByEmail('jane@acme.com')).toMatchObject({ id: pendingId, xtm_subject: 'xtm-jane' });
      expect(notify.requests[0].path).toBe(`/${tenantId}`);
    });

    it('should place the person again, without a second notice, when the XTM One id went to another account meanwhile', async () => {
      const invite = xtmOneAnswering({ 'jane@acme.com': { outcome: 'invited', emailSent: true, link: null } });
      await addToTenant([{ email: 'jane@acme.com' }], invite.send);
      const notify = xtmOneAnswering({ 'jane@acme.com': { outcome: 'notified', xtmUserId: 'xtm-jane', emailSent: true } });
      try {
        // A sequence, since its value outlives the rollback: the first link collides, the retry goes through.
        await db.execute(sql.raw('CREATE SEQUENCE test_members_link_once'));
        await db.execute(sql.raw(`CREATE OR REPLACE FUNCTION test_members_link_collides() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF NEW.xtm_subject IS DISTINCT FROM OLD.xtm_subject AND nextval('test_members_link_once') = 1 THEN
            RAISE EXCEPTION 'taken' USING ERRCODE = 'unique_violation', CONSTRAINT = 'users_xtm_subject_unique';
          END IF;
          RETURN NEW;
        END $$`));
        await db.execute(sql.raw('CREATE TRIGGER test_members_link_collides BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION test_members_link_collides()'));

        const added = await addToTenant([{ email: 'jane@acme.com' }], notify.send);

        expect(added.results[0]).toMatchObject({ added: true, refusal: null });
        expect(notify.send).toHaveBeenCalledTimes(1);
        expect((await accountByEmail('jane@acme.com'))!.xtm_subject).toBe('xtm-jane');
      } finally {
        await db.execute(sql.raw('DROP TRIGGER IF EXISTS test_members_link_collides ON users'));
        await db.execute(sql.raw('DROP FUNCTION IF EXISTS test_members_link_collides()'));
        await db.execute(sql.raw('DROP SEQUENCE IF EXISTS test_members_link_once'));
      }
    });

    it('should create nothing for an email XTM One refuses to invite (403), and still add the others', async () => {
      const xtmOne = xtmOneAnswering({
        'jane@acme.com': { outcome: 'refused' },
        'marc@acme.com': { outcome: 'notified', xtmUserId: 'xtm-marc', emailSent: true },
      });

      const added = await addToTenant([{ email: 'jane@acme.com' }, { email: 'marc@acme.com', xtmUserId: 'xtm-marc' }], xtmOne.send);

      expect(added.results).toEqual([
        { email: 'jane@acme.com', added: false, emailSent: false, invited: false, invitationLink: null, refusal: 'not-addable' },
        { email: 'marc@acme.com', added: true, emailSent: true, invited: false, invitationLink: null, refusal: null },
      ]);
      expect(await accountByEmail('jane@acme.com')).toBeUndefined();
      expect(await accountByEmail('marc@acme.com')).toBeDefined();
    });

    it('should create nothing for an email whose invitation XTM One already holds (409), and still add the others', async () => {
      const xtmOne = xtmOneAnswering({
        'jane@acme.com': { outcome: 'invitation-pending' },
        'marc@acme.com': { outcome: 'notified', xtmUserId: 'xtm-marc', emailSent: true },
      });

      const added = await addToTenant([{ email: 'jane@acme.com' }, { email: 'marc@acme.com', xtmUserId: 'xtm-marc' }], xtmOne.send);

      expect(added.results).toEqual([
        { email: 'jane@acme.com', added: false, emailSent: false, invited: false, invitationLink: null, refusal: 'invitation-pending' },
        { email: 'marc@acme.com', added: true, emailSent: true, invited: false, invitationLink: null, refusal: null },
      ]);
      expect(await accountByEmail('jane@acme.com')).toBeUndefined();
      expect(await accountByEmail('marc@acme.com')).toBeDefined();
    });

    it('should create nothing for an unknown email XTM One answers 404 for', async () => {
      const xtmOne = xtmOneAnswering({ 'jane@acme.com': { outcome: 'not-found' } });

      const added = await addToTenant([{ email: 'jane@acme.com' }], xtmOne.send);

      expect(added.results[0]).toEqual({ email: 'jane@acme.com', added: false, emailSent: false, invited: false, invitationLink: null, refusal: 'not-addable' });
      expect(await accountByEmail('jane@acme.com')).toBeUndefined();
    });

    it('should still add a person whose account holds the email when XTM One has no notice route (404), with no email sent', async () => {
      const { userId } = await createUser(db, 'jane@acme.com');
      await db.execute(sql`UPDATE users SET xtm_subject = 'xtm-jane' WHERE id = ${userId}`);
      const xtmOne = xtmOneAnswering({ 'jane@acme.com': { outcome: 'not-found' } });

      const added = await addToTenant([{ email: 'jane@acme.com', xtmUserId: 'xtm-jane', fullName: 'Jane Martin' }], xtmOne.send);

      expect(added.results[0]).toEqual({ email: 'jane@acme.com', added: true, emailSent: false, invited: false, invitationLink: null, refusal: null });
      expect(await isTenantMember(tenantId, userId)).toBe(true);
    });

    it('should never create an account from an XTM One id XTM One did not confirm (404), whatever the caller sent', async () => {
      const xtmOne = xtmOneAnswering({ 'jane@acme.com': { outcome: 'not-found' } });

      const added = await addToTenant([{ email: 'jane@acme.com', xtmUserId: 'xtm-made-up', fullName: 'Jane Martin' }], xtmOne.send);

      expect(added.results[0]).toEqual({ email: 'jane@acme.com', added: false, emailSent: false, invited: false, invitationLink: null, refusal: 'not-addable' });
      expect(await accountByEmail('jane@acme.com')).toBeUndefined();
    });

    it('should refuse a person picked from the directory whose email another XTM One user\'s account holds, before asking XTM One', async () => {
      const { userId } = await createUser(db, 'jane@acme.com');
      await db.execute(sql`UPDATE users SET xtm_subject = 'xtm-other' WHERE id = ${userId}`);
      const xtmOne = xtmOneAnswering({ 'jane@acme.com': { outcome: 'notified', xtmUserId: 'xtm-jane', emailSent: true } });

      const added = await addToTenant([{ email: 'jane@acme.com', xtmUserId: 'xtm-jane' }], xtmOne.send);

      expect(added.results[0]).toEqual({ email: 'jane@acme.com', added: false, emailSent: false, invited: false, invitationLink: null, refusal: 'not-addable' });
      expect(xtmOne.requests).toEqual([]);
      expect(await isTenantMember(tenantId, userId)).toBe(false);
    });

    it('should answer a typed email another XTM One user\'s account holds as an email XTM One refuses, never naming the account', async () => {
      const { userId } = await createUser(db, 'jane@acme.com');
      await db.execute(sql`UPDATE users SET xtm_subject = 'xtm-other' WHERE id = ${userId}`);
      const xtmOne = xtmOneAnswering({
        'jane@acme.com': { outcome: 'notified', xtmUserId: 'xtm-jane', emailSent: true },
        'paul@acme.com': { outcome: 'refused' },
      });

      const added = await addToTenant([{ email: 'jane@acme.com' }, { email: 'paul@acme.com' }], xtmOne.send);

      expect(added.results.map(({ refusal }) => refusal)).toEqual(['not-addable', 'not-addable']);
      expect(await isTenantMember(tenantId, userId)).toBe(false);
    });

    it('should tie a pending account XTM One knows but could not email, for the access link to sign them in', async () => {
      const invite = xtmOneAnswering({ 'jane@acme.com': { outcome: 'invited', emailSent: true, link: null } });
      await addToTenant([{ email: 'jane@acme.com' }], invite.send);
      const notify = xtmOneAnswering({ 'jane@acme.com': { outcome: 'notified', xtmUserId: 'xtm-jane', emailSent: false } });

      const added = await addToTenant([{ email: 'jane@acme.com' }], notify.send);

      expect(added.results[0]).toEqual({ email: 'jane@acme.com', added: true, emailSent: false, invited: false, invitationLink: null, refusal: null });
      expect((await accountByEmail('jane@acme.com'))!.xtm_subject).toBe('xtm-jane');
    });

    it('should add a known person refused by a rate limit (429) with no email sent, and an unknown one not at all', async () => {
      const { userId } = await createUser(db, 'jane@acme.com');
      await db.execute(sql`UPDATE users SET xtm_subject = 'xtm-jane' WHERE id = ${userId}`);
      const xtmOne = xtmOneAnswering({ 'jane@acme.com': { outcome: 'not-sent' }, 'paul@acme.com': { outcome: 'not-sent' } });

      const added = await addToTenant([{ email: 'jane@acme.com', xtmUserId: 'xtm-jane' }, { email: 'paul@acme.com', xtmUserId: 'xtm-paul' }], xtmOne.send);

      expect(added.results).toEqual([
        { email: 'jane@acme.com', added: true, emailSent: false, invited: false, invitationLink: null, refusal: null },
        { email: 'paul@acme.com', added: false, emailSent: false, invited: false, invitationLink: null, refusal: 'unavailable' },
      ]);
      expect(await accountByEmail('paul@acme.com')).toBeUndefined();
    });

    it('should report an email XTM One could not send, the person added still', async () => {
      const xtmOne = xtmOneAnswering({ 'jane@acme.com': { outcome: 'notified', xtmUserId: 'xtm-jane', emailSent: false } });

      const added = await addToTenant([{ email: 'jane@acme.com', xtmUserId: 'xtm-jane' }], xtmOne.send);

      expect(added.results[0]).toEqual({ email: 'jane@acme.com', added: true, emailSent: false, invited: false, invitationLink: null, refusal: null });
    });

    it('should tell each person added in the app, after the add', async () => {
      const xtmOne = xtmOneAnswering({ 'jane@acme.com': { outcome: 'invited', emailSent: true, link: null } });

      const added = await addToTenant([{ email: 'jane@acme.com' }], xtmOne.send);

      const account = await accountByEmail('jane@acme.com');
      const notifications = await notificationsOf(account!.id);
      expect(notifications).toHaveLength(1);
      expect(notifications[0].type).toBe('member-added');
      expect(notifications[0].title.endsWith(`added you to ${added.scopeName}`)).toBe(true);
    });

    it('should name the super administrator, a member of no tenant, in the notification', async () => {
      const { userId } = await createUser(db, 'claire@acme.com');
      await db.execute(sql`UPDATE users SET is_super_admin = true, name = 'Claire Dubois' WHERE id = ${userId}`);
      const xtmOne = xtmOneAnswering({ 'jane@acme.com': { outcome: 'notified', xtmUserId: 'xtm-jane', emailSent: true } });

      const added = await addToTenant([{ email: 'jane@acme.com', xtmUserId: 'xtm-jane' }], xtmOne.send, { type: 'client', userId, tenantId });

      const account = await accountByEmail('jane@acme.com');
      expect((await notificationsOf(account!.id))[0].title).toBe(`Claire Dubois added you to ${added.scopeName}`);
    });

    it('should leave out a super administrator, who holds every right already, without asking XTM One', async () => {
      const { userId } = await createUser(db, 'claire@acme.com');
      await db.execute(sql`UPDATE users SET is_super_admin = true, xtm_subject = 'xtm-claire' WHERE id = ${userId}`);
      const xtmOne = xtmOneAnswering({ 'claire@acme.com': { outcome: 'notified', xtmUserId: 'xtm-claire', emailSent: true } });

      const added = await addToTenant([{ email: 'claire@acme.com', xtmUserId: 'xtm-claire' }], xtmOne.send, { type: 'client', userId, tenantId });

      expect(added.results[0]).toEqual({ email: 'claire@acme.com', added: false, emailSent: false, invited: false, invitationLink: null, refusal: 'super-administrator' });
      expect(xtmOne.requests).toEqual([]);
      expect(await isTenantMember(tenantId, userId)).toBe(false);
      expect(await notificationsOf(userId)).toEqual([]);
    });

    it('should send XTM One several notices at once, and keep the results in the order given', async () => {
      let inFlight = 0;
      let mostInFlight = 0;
      const send: SendAccessNotice = async (request) => {
        inFlight += 1;
        mostInFlight = Math.max(mostInFlight, inFlight);
        await new Promise((resolve) => {
          setTimeout(resolve, 20);
        });
        inFlight -= 1;
        return { outcome: 'notified', xtmUserId: `xtm-${request.email}`, emailSent: true };
      };
      const emails = Array.from({ length: 8 }, (_, index) => `person-${index}@acme.com`);

      const added = await addToTenant(emails.map((email) => ({ email })), send);

      expect(mostInFlight).toBeGreaterThan(1);
      expect(added.results.map(({ email }) => email)).toEqual(emails);
    });

    it('should refuse a group of another tenant before asking XTM One anything', async () => {
      const other = await anotherTenant(adminOrigin.userId);
      const xtmOne = xtmOneAnswering({});

      await expect(services.withOrigin(adminOrigin).members.addTenantMembers([{ email: 'jane@acme.com' }], [other.groupId], xtmOne.send)).rejects.toThrow();

      expect(xtmOne.send).not.toHaveBeenCalled();
    });
  });

  describe('policies', () => {
    it('should refuse a tenant administrator adding to another tenant, before asking XTM One', async () => {
      const other = await anotherTenant(adminOrigin.userId);
      const xtmOne = xtmOneAnswering({ 'jane@acme.com': { outcome: 'invited', emailSent: true, link: null } });

      await expect(services.withOrigin({ ...adminOrigin, tenantId: other.tenantId }).members.addTenantMembers([{ email: 'jane@acme.com' }], [], xtmOne.send)).rejects.toThrow();

      expect(xtmOne.send).not.toHaveBeenCalled();
      expect(await accountByEmail('jane@acme.com')).toBeUndefined();
    });

    it('should refuse a tenant administrator adding to the platform, before asking XTM One', async () => {
      const { userId } = await createUser(db);
      await services.withOrigin(adminOrigin).tenants.addTenantUser(tenantId, userId);
      await grantCapability(services, adminOrigin, userId, Capability_ManageSecurity);
      const platformGroupId = uuidv7();
      await services.withOrigin({ type: 'platform', userId: adminOrigin.userId }).platformGroups.createPlatformGroup({ id: platformGroupId, name: 'Platform administrators' });
      const xtmOne = xtmOneAnswering({ 'jane@acme.com': { outcome: 'invited', emailSent: true, link: null } });

      await expect(services.withOrigin({ type: 'platform', userId }).members.addPlatformMembers([{ email: 'jane@acme.com' }], [platformGroupId], xtmOne.send)).rejects.toThrow();

      expect(xtmOne.send).not.toHaveBeenCalled();
      expect(await accountByEmail('jane@acme.com')).toBeUndefined();
    });

    it('should refuse a member without MANAGE_SECURITY, before asking XTM One', async () => {
      const { userId } = await createUser(db);
      await services.withOrigin(adminOrigin).tenants.addTenantUser(tenantId, userId);
      const xtmOne = xtmOneAnswering({});

      await expect(addToTenant([{ email: 'jane@acme.com' }], xtmOne.send, { type: 'client', userId, tenantId })).rejects.toThrow();

      expect(xtmOne.send).not.toHaveBeenCalled();
    });
  });

  describe('adding to the platform', () => {
    it('should give each person the platform groups, with an account and no tenant, the notice linking to the platform area', async () => {
      const platformOrigin: EventOrigin = { type: 'platform', userId: adminOrigin.userId };
      const platformGroupId = uuidv7();
      await services.withOrigin(platformOrigin).platformGroups.createPlatformGroup({ id: platformGroupId, name: 'Platform administrators' });
      const { userId: paulId } = await createUser(db, 'paul@acme.com');
      await db.execute(sql`UPDATE users SET xtm_subject = 'xtm-paul' WHERE id = ${paulId}`);
      const xtmOne = xtmOneAnswering({
        'paul@acme.com': { outcome: 'notified', xtmUserId: 'xtm-paul', emailSent: true },
        'jane@acme.com': { outcome: 'invited', emailSent: true, link: null },
      });

      const added = await services.withOrigin(platformOrigin).members.addPlatformMembers(
        [{ email: 'paul@acme.com', xtmUserId: 'xtm-paul' }, { email: 'jane@acme.com' }],
        [platformGroupId],
        xtmOne.send,
      );

      expect(added.scopeName).toBe('Platform administrators');
      expect(xtmOne.requests.map(({ scopeName }) => scopeName)).toEqual(['Platform administration (Platform administrators)', 'Platform administration (Platform administrators)']);
      expect(added.results.every(({ added: wasAdded }) => wasAdded)).toBe(true);
      for (const email of ['paul@acme.com', 'jane@acme.com']) {
        const account = await accountByEmail(email);
        expect(await platformGroupIdsOf(account!.id)).toEqual([platformGroupId]);
        expect((await db.execute(sql`SELECT 1 FROM tenant_users WHERE user_id = ${account!.id}`)).rows).toHaveLength(0);
      }
      expect(xtmOne.requestTo('paul@acme.com').path).toBe('/platform/security/tenants');
      expect(xtmOne.requestTo('jane@acme.com').path).toBe('/platform/security/tenants');
    });

    it('should list the accounts with no tenant on the platform users list', async () => {
      const platformOrigin: EventOrigin = { type: 'platform', userId: adminOrigin.userId };
      const { userId } = await createUser(db, 'loner@acme.com');

      const listed = await services.withOrigin(platformOrigin).users.listPlatformUsers();

      expect(listed.find(({ id }) => id === userId)).toMatchObject({ email: 'loner@acme.com', tenants: [] });
    });
  });

  describe('directory marks', () => {
    it('should name the members of the tenant among the people a search found, by XTM One id or email', async () => {
      const { userId } = await createUser(db, 'jean@acme.com');
      await db.execute(sql`UPDATE users SET xtm_subject = 'xtm-jean' WHERE id = ${userId}`);
      await services.withOrigin(adminOrigin).tenants.addTenantUser(tenantId, userId);
      await createUser(db, 'outsider@acme.com');

      const members = await services.withOrigin(adminOrigin).members.findTenantMembersAmong(['outsider@acme.com', 'nobody@acme.com'], ['xtm-jean']);

      expect(members.map(({ email }) => email)).toEqual(['jean@acme.com']);
    });

    it('should name the super administrator among the people already in the tenant, a member of none', async () => {
      const { userId } = await createUser(db, 'claire@acme.com');
      await db.execute(sql`UPDATE users SET is_super_admin = true WHERE id = ${userId}`);

      const members = await services.withOrigin(adminOrigin).members.findTenantMembersAmong(['claire@acme.com'], []);

      expect(members.map(({ email }) => email)).toEqual(['claire@acme.com']);
    });
  });
});
