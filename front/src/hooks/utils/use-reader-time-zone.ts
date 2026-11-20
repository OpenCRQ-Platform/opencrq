import { useState } from 'react';
import { browserTimeZone } from '../../utils/date-utils';

const FALLBACK_TIME_ZONE = 'UTC';
const MAX_RETRIES = 3;

interface ZoneQueryError {
  data?: { httpStatus?: number } | null,
}

const isRefusal = (error: ZoneQueryError | null): boolean => error?.data?.httpStatus === 400;

/**
 * The zone a query counts the reader's days in: the browser's, or UTC once the server refuses it,
 * as it does a zone its own time zone data lacks (`Factory`), rather than leave the query failed.
 * The query takes `queryOptions`, and its error goes to `fallBackOn` during render.
 */
export const useReaderTimeZone = () => {
  const [isRefused, setIsRefused] = useState(false);
  return {
    timeZone: isRefused ? FALLBACK_TIME_ZONE : browserTimeZone(),
    queryOptions: {
      retry: (failureCount: number, error: ZoneQueryError) => !isRefusal(error) && failureCount < MAX_RETRIES,
      // The refusal is answered by asking again in UTC, so it is no error to show.
      meta: { skipErrorToast: !isRefused },
    },
    fallBackOn: (error: ZoneQueryError | null) => {
      if (!isRefused && isRefusal(error)) {
        setIsRefused(true);
      }
    },
  };
};
