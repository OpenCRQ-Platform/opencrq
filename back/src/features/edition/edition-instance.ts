/*
Copyright (c) 2026 Filigran SAS

This file is part of the OpenCRQ Enterprise Edition ("EE") and is
licensed under the OpenCRQ Enterprise Edition License (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://github.com/OpenCRQ-Platform/opencrq/blob/main/LICENSE

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/

import type { DrizzleDB } from '@app/module';
import { ensureInstanceIdentity } from '../../utils/platform-identity';

interface EditionInstance {
  instanceId: string,
  /** Epoch milliseconds, `NaN` should the stored value not be a date. */
  createdAt: number,
}

/**
 * The platform's durable anonymous identity, bootstrapped first-boot-wins by
 * `ensureInstanceIdentity` and shared with the telemetry engine. XTM One knows
 * this platform by its id and an XTM license sub-licenses it by that id, which
 * is why it has to survive a database reset; its creation opens the window of
 * a `ci` license.
 */
export const ensureInstance = async (db: DrizzleDB): Promise<EditionInstance> => {
  const { instanceId, instanceCreation } = await ensureInstanceIdentity(db);
  return { instanceId, createdAt: Date.parse(instanceCreation) };
};
