import { t } from '@lingui/core/macro';
import { z } from 'zod';

export const requiredNameSchema = () => z.string().trim().min(1, { error: t`Enter a name.` });
