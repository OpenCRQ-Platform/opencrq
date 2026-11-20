import { describeProcedures, procedureManifestFingerprint } from '@app/back/src/features/app-router/procedure-manifest';
import type { ServedProcedureManifest } from '@app/back/src/features/app-router/procedure-manifest';
import { registerWithXtmOne } from '@app/back/src/features/xtm-one/xtm-one-client';
import { initTRPC } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { FakeXtmOne } from '../../helpers/fake-xtm-one';
import { startFakeXtmOne } from '../../helpers/fake-xtm-one';
import { db } from '../../setup/db';
import { truncateAllTables } from '../../setup/test-context';

const t = initTRPC.create();

// Described from a real router, as the process does, rather than written by hand.
const manifestOf = (field: string): ServedProcedureManifest => {
  const manifest = describeProcedures(t.router({
    things: t.router({ save: t.procedure.input(z.object({ [field]: z.string() })).mutation(() => null) }),
  }));
  return { ...manifest, fingerprint: procedureManifestFingerprint(manifest) };
};

// The real client, socket and instance identity against a stand-in XTM One that keeps the last manifest it was handed.
describe('Procedure manifest in the XTM One registration (HTTP)', () => {
  let xtmOne: FakeXtmOne | undefined;
  let held: string | undefined;

  const register = async (manifest: ServedProcedureManifest | null) => {
    const result = await registerWithXtmOne({ url: xtmOne?.url ?? '', token: 'registration-token', platformUrl: 'https://opencrq.test' }, db, () => manifest);
    // The answer arrived and parsed: a body left unsent would prove nothing.
    expect(result).not.toBeNull();
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    held = undefined;
    xtmOne = await startFakeXtmOne((_platformId, body) => {
      if (typeof body.procedure_manifest_fingerprint === 'string' && body.procedure_manifest !== undefined) {
        held = body.procedure_manifest_fingerprint;
      }
      return { status: 'active', procedure_manifest_wanted: typeof body.procedure_manifest_fingerprint === 'string' && body.procedure_manifest_fingerprint !== held };
    });
  });

  afterEach(async () => {
    await xtmOne?.close();
  });

  it('should hand the manifest over on the first registration, in a second request', async () => {
    const manifest = manifestOf('name');

    await register(manifest);

    expect(xtmOne?.requests).toHaveLength(2);
    expect(xtmOne?.requests[0]).toMatchObject({ procedure_manifest_fingerprint: manifest.fingerprint });
    expect(xtmOne?.requests[0]).not.toHaveProperty('procedure_manifest');
    expect(xtmOne?.requests[1]).toMatchObject({
      procedure_manifest_fingerprint: manifest.fingerprint,
      procedure_manifest: { formatVersion: 1, procedures: manifest.procedures },
    });
    expect(held).toBe(manifest.fingerprint);
  });

  it('should send the fingerprint alone on the next heartbeat, once XTM One holds the manifest', async () => {
    const manifest = manifestOf('name');
    await register(manifest);
    const before = xtmOne?.requests.length ?? 0;

    await register(manifest);

    expect(xtmOne?.requests).toHaveLength(before + 1);
  });

  it('should hand a changed manifest over again', async () => {
    await register(manifestOf('name'));
    const changed = manifestOf('title');

    await register(changed);

    expect(held).toBe(changed.fingerprint);
  });

  it('should register without any fingerprint while no manifest is available', async () => {
    await register(null);

    expect(xtmOne?.requests).toHaveLength(1);
    expect(xtmOne?.requests[0]).not.toHaveProperty('procedure_manifest_fingerprint');
  });
});
