import type { EventOrigin } from '@app/module';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createUser } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);
const authOrigin: EventOrigin = { type: 'auth' };
const auth = () => services.withOrigin(authOrigin).auth;

const emailOf = async (userId: string): Promise<string> => (
  (await db.execute<{ email: string }>(sql`SELECT email FROM users WHERE id = ${userId}`)).rows[0].email
);

// An account is the XTM One user (`sub`) it is tied to; the email finds only a pending account, one tied to nobody.
describe('Auth Service: XTM One accounts', () => {
  beforeEach(async () => {
    await truncateAllTables(db);
  });

  it('should tell an email another account holds, whatever its case', async () => {
    await createUser(db, 'Jane.Doe@Example.com');

    expect(await auth().isEmailTaken('jane.doe@example.com')).toBe(true);
    expect(await auth().isEmailTaken('john@example.com')).toBe(false);
  });

  it('should create an account for an XTM One user, then find it by that user alone', async () => {
    const id = uuidv7();

    expect(await auth().createXtmAccount({ id, xtmSubject: 'xtm-user-1', email: 'jane@example.com', name: 'Jane', title: null })).toBe(id);
    expect(await auth().getUserIdByXtmSubject('xtm-user-1')).toBe(id);
    expect(await auth().getUserByXtmSubject('xtm-user-1')).toMatchObject({ id, email: 'jane@example.com', xtmSubject: 'xtm-user-1' });
    expect(await auth().getUserByXtmSubject('xtm-user-2')).toBeNull();
  });

  // Two first sign-ins of one XTM One user at once: both end on the account the first created.
  it('should end a second creation for the same XTM One user on the first account', async () => {
    const first = uuidv7();
    await auth().createXtmAccount({ id: first, xtmSubject: 'xtm-user-1', email: 'jane@example.com', name: null, title: null });

    expect(await auth().createXtmAccount({ id: uuidv7(), xtmSubject: 'xtm-user-1', email: 'jane@example.com', name: null, title: null })).toBe(first);
  });

  it('should create nothing when another account took the email meanwhile', async () => {
    await createUser(db, 'jane@example.com');

    expect(await auth().createXtmAccount({ id: uuidv7(), xtmSubject: 'xtm-user-1', email: 'jane@example.com', name: null, title: null })).toBeNull();
    expect(await auth().getUserIdByXtmSubject('xtm-user-1')).toBeNull();
  });

  it('should create nothing when another account took the email meanwhile in another case', async () => {
    await createUser(db, 'Jane@Example.com');

    expect(await auth().createXtmAccount({ id: uuidv7(), xtmSubject: 'xtm-user-1', email: 'jane@example.com', name: null, title: null })).toBeNull();
    expect(await auth().getUserIdByXtmSubject('xtm-user-1')).toBeNull();
  });

  it('should give a pending account to the first XTM One user signing in with its email, whatever its case, and to no later one', async () => {
    const { userId } = await createUser(db, 'Jane@Example.com');

    expect(await auth().linkPendingAccount('xtm-user-1', 'jane@example.com')).toBe(userId);
    expect(await auth().getUserIdByXtmSubject('xtm-user-1')).toBe(userId);
    expect(await auth().linkPendingAccount('xtm-user-2', 'jane@example.com')).toBeNull();
    expect(await auth().getUserIdByXtmSubject('xtm-user-2')).toBeNull();
  });

  it('should give a pending account to one of two XTM One users racing for it', async () => {
    const { userId } = await createUser(db, 'jane@example.com');

    const linked = await Promise.all([auth().linkPendingAccount('xtm-user-1', 'jane@example.com'), auth().linkPendingAccount('xtm-user-2', 'jane@example.com')]);

    expect(linked.filter((id) => id !== null)).toEqual([userId]);
  });

  it('should link nothing for an XTM One user who already has an account', async () => {
    await auth().createXtmAccount({ id: uuidv7(), xtmSubject: 'xtm-user-1', email: 'marc@example.com', name: null, title: null });
    const { userId } = await createUser(db, 'jane@example.com');

    expect(await auth().linkPendingAccount('xtm-user-1', 'jane@example.com')).toBeNull();
    expect((await db.execute<{ xtm_subject: string | null }>(sql`SELECT xtm_subject FROM users WHERE id = ${userId}`)).rows[0].xtm_subject).toBeNull();
  });

  it('should throw any other database error', async () => {
    await expect(auth().createXtmAccount({ id: 'not-a-uuid', xtmSubject: 'xtm-user-1', email: 'jane@example.com', name: null, title: null })).rejects.toThrow();
  });

  it('should follow the email XTM One sends unless another account holds it', async () => {
    const id = uuidv7();
    await auth().createXtmAccount({ id, xtmSubject: 'xtm-user-1', email: 'jane@example.com', name: null, title: null });
    await createUser(db, 'taken@example.com');

    await auth().applyXtmSignIn(id, 'TAKEN@example.com', { isSuperAdmin: false });
    expect(await emailOf(id)).toBe('jane@example.com');

    await auth().applyXtmSignIn(id, 'jane.new@example.com', { isSuperAdmin: false });
    expect(await emailOf(id)).toBe('jane.new@example.com');
  });

  it('should leave the name and title XTM One did not send', async () => {
    const id = uuidv7();
    await auth().createXtmAccount({ id, xtmSubject: 'xtm-user-1', email: 'jane@example.com', name: 'Jane', title: 'CISO' });

    await auth().applyXtmSignIn(id, 'jane@example.com', { isSuperAdmin: true });

    const [row] = (await db.execute<{ name: string, title: string, is_super_admin: boolean }>(sql`SELECT name, title, is_super_admin FROM users WHERE id = ${id}`)).rows;
    expect(row).toEqual({ name: 'Jane', title: 'CISO', is_super_admin: true });
  });
});
