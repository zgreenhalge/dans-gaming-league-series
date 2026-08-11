import { cache } from 'react';
import { getServerSession } from 'next-auth';
import { authOptions } from './authOptions';

/**
 * `getServerSession()`, deduped per request via React's `cache()`. Server components that need the
 * session independently of one another within the same request tree (e.g. `/admin`'s layout gate
 * and the page it wraps) would otherwise each pay their own round trip for an identical result.
 */
export const getSession = cache(() => getServerSession(authOptions));
