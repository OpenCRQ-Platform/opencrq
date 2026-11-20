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

import { dbEngine } from '../../engines/db';
import { httpServerEngine } from '../../engines/http-server';
import { registerFeature } from '../features-manager';
import { editionRootRouter } from './edition-router';

const EDITION_STATUS_FEATURE_KEY = 'edition-status';

/**
 * Mounts the `edition` router (status, installed Filigran license) on its own feature rather than
 * `edition-feature.ts`: that module is deliberately free of any HTTP import
 * so every process, including one that never binds the API port, can
 * activate it without a second listener racing for the port.
 */
const activateEditionStatus = (): void => {
  httpServerEngine.registerRouter(({ protectedProcedure }) => editionRootRouter(protectedProcedure, dbEngine.db));
};

registerFeature({
  key: EDITION_STATUS_FEATURE_KEY,
  activate: activateEditionStatus,
});
