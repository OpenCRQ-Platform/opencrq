/**
 * Keeps the Enterprise Edition license header on exactly the files `EE_FILES` lists: the header
 * text lives here once, and a file carrying it outside the list, or listed without it, fails.
 * Run with `yarn test:scripts`.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'scripts/ee-header.test.mjs';
const MARKER = 'part of the OpenCRQ Enterprise Edition';

const EE_HEADER = `/*
Copyright (c) 2026 Filigran SAS

This file is part of the OpenCRQ Enterprise Edition ("EE") and is
licensed under the OpenCRQ Enterprise Edition License (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://github.com/OpenCRQ-Platform/opencrq/blob/main/LICENSE

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/`;

const EE_FILES = [
  'back/src/features/xtm-one/xtm-one-http.ts',
  'back/src/features/xtm-one/xtm-one-approvals.ts',
  'back/src/features/xtm-one/xtm-one-client.ts',
  'back/src/features/app-router/tenants/tenants-router.ts',
  'front/src/features/xtm-one/components/ask-ariane.tsx',
  'front/src/components/layout/scope-slot.tsx',
  'front/src/features/tenants/components/tenant-card.tsx',
  'front/src/features/tenants/components/tenant-rename-drawer.tsx',
  'front/src/features/tenants/components/tenants-data-table.tsx',
  'front/src/features/tenants/tenants-list-search.ts',
  'front/src/routes/_auth/platform/security/tenants/index.tsx',
  'front/src/routes/_auth/platform/security/tenants/route.tsx',
  'front/src/routes/_auth/$tenantId/{-$organizationId}/settings/security/tenants/index.tsx',
  'front/src/routes/_auth/$tenantId/{-$organizationId}/settings/security/tenants/route.tsx',
  'back/src/features/edition/edition-feature.ts',
  'back/src/features/edition/edition-gate.ts',
  'back/src/features/edition/edition-instance.ts',
  'back/src/features/edition/edition-license.ts',
  'back/src/features/edition/edition-router.ts',
  'back/src/features/edition/edition-service.ts',
  'back/src/features/edition/edition-state.ts',
  'back/src/features/edition/edition-status-feature.ts',
  'back/src/features/edition/entitlement-ipc.ts',
  'back/src/features/edition/index.ts',
  'back/src/features/edition/xtm-ca.ts',
  'back/src/features/edition/xtm-license.ts',
  'back/src/features/app-router/tenant-edition-utils.ts',
  'front/src/features/edition/components/filigran-license-card.tsx',
  'front/src/features/edition/components/xtm-one-card.tsx',
  'front/src/features/edition/filigran-license-utils.ts',
  'front/src/features/edition/hooks/use-edition-status.ts',
  'front/src/features/edition/hooks/use-enterprise-edition.ts',
  'front/src/features/edition/hooks/use-refetch-tenants-on-edition-change.ts',
  'front/src/features/edition/index.ts',
  'front/src/features/edition/license-expiry-utils.ts',
  'front/src/features/edition/xtm-one-check-utils.ts',
  'front/src/features/edition/xtm-one-outage-consequence.ts',
];

const read = (file) => {
  try {
    return fs.readFileSync(path.join(ROOT, file), 'utf8');
  } catch {
    return null;
  }
};

const trackedFiles = () => execFileSync('git', ['-C', ROOT, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
}).split('\0').filter(Boolean);

describe('Enterprise Edition license header', () => {
  it('starts every EE file, followed by a blank line', () => {
    const wrong = EE_FILES.filter((file) => !read(file)?.startsWith(`${EE_HEADER}\n\n`));
    assert.deepEqual(wrong, [], `Missing, unreadable or altered header in:\n${wrong.join('\n')}`);
  });

  it('marks exactly the files of EE_FILES', () => {
    const marked = trackedFiles()
      .filter((file) => file !== 'AGENTS.md' && file !== SELF)
      .filter((file) => read(file)?.includes(MARKER))
      .sort();
    const expected = [...EE_FILES].sort();
    const outside = marked.filter((file) => !expected.includes(file));
    const missing = expected.filter((file) => !marked.includes(file));
    assert.deepEqual(outside, [], `Carry the EE marker but are not in EE_FILES:\n${outside.join('\n')}`);
    assert.deepEqual(missing, [], `Listed in EE_FILES but carry no EE marker:\n${missing.join('\n')}`);
  });

  it('never lists a test file or a test helper', () => {
    const isTestCode = (file) => {
      const segments = file.split('/');
      return file.includes('.test.')
        || /-(fixtures|harness)\.[^/]+$/.test(file)
        || segments[0] === 'integration-tests'
        || segments.includes('tests')
        || segments.includes('__fixtures__');
    };
    const tests = EE_FILES.filter(isTestCode);
    assert.deepEqual(tests, [], `Tests and their helpers must not carry the header:\n${tests.join('\n')}`);
  });

  it('is quoted word for word in AGENTS.md', () => {
    assert.ok(read('AGENTS.md')?.includes(EE_HEADER), 'AGENTS.md does not contain EE_HEADER verbatim');
  });
});
