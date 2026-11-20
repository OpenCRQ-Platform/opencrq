import type { OutgoingHttpHeaders } from 'node:http';
import type { FastifyInstance } from 'fastify';

/**
 * Manages cookies between requests via server.inject() to simulate a browser session.
 */
export const createTrpcTestClient = (server: FastifyInstance) => {
  let cookies: Array<string> = [];

  const extractCookies = (headers: OutgoingHttpHeaders) => {
    const setCookie = headers['set-cookie'];
    if (!setCookie) {
      return;
    }
    const values = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const value of values) {
      const name = value.split('=')[0];
      // Remove old cookie with same name, add new one
      cookies = cookies.filter((c) => !c.startsWith(`${name}=`));
      // Only keep if it's not an expired/cleared cookie
      if (!value.includes('Max-Age=0') && !value.includes('Expires=Thu, 01 Jan 1970')) {
        cookies.push(value.split(';')[0]);
      }
    }
  };

  const query = async (path: string, input?: unknown, options?: { tenantId?: string }) => {
    const url = input
      ? `/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`
      : `/trpc/${path}`;

    const res = await server.inject({
      method: 'GET',
      url,
      headers: {
        ...(cookies.length > 0 ? { cookie: cookies.join('; ') } : {}),
        ...(options?.tenantId ? { 'x-tenant-id': options.tenantId } : {}),
      },
    });

    extractCookies(res.headers);
    return {
      status: res.statusCode,
      json: JSON.parse(res.body),
      headers: res.headers,
    };
  };

  const mutation = async (path: string, input?: unknown, options?: { tenantId?: string }) => {
    const res = await server.inject({
      method: 'POST',
      url: `/trpc/${path}`,
      headers: {
        'content-type': 'application/json',
        ...(cookies.length > 0 ? { cookie: cookies.join('; ') } : {}),
        ...(options?.tenantId ? { 'x-tenant-id': options.tenantId } : {}),
      },
      body: input !== undefined ? JSON.stringify(input) : undefined,
    });

    extractCookies(res.headers);
    return {
      status: res.statusCode,
      json: JSON.parse(res.body),
      headers: res.headers,
    };
  };

  return {
    query,
    mutation,
    getCookies: () => [...cookies],
    setCookies: (c: Array<string>) => {
      cookies = c;
    },
    clearCookies: () => {
      cookies = [];
    },
  };
};
