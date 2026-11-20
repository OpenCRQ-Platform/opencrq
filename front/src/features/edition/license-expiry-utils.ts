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

const DAY_MS = 86_400_000;

/** Whole days left before a license lapses, rounded up so a few remaining hours still count as a day; floored at zero to absorb clock skew against the server. */
export const licenseDaysRemaining = (validUntil: string | Date, now: Date = new Date()): number =>
  Math.max(0, Math.ceil((new Date(validUntil).getTime() - now.getTime()) / DAY_MS));
