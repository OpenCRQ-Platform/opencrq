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

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DrizzleDB } from '@app/module';
import { newError } from '@app/utils';
import type { MultipartFile } from '@fastify/multipart';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { XtmOneSettings } from './xtm-one-config';
import { resolveRequestAuth } from '../../trpc';
import { createLogger } from '../../utils/logger';
import { requireEnterpriseEdition } from '../edition';
import { parseApprovalRequest } from './xtm-one-approvals';
import { XTM_ONE_SESSION_ID } from './xtm-one-auth';
import { buildXtmOneHeaders } from './xtm-one-headers';
import { getXtmOneSettings } from './xtm-one-config';
import { buildJwks, ensureSigningKey } from './xtm-one-keys';

const { logTrace, logFromError } = createLogger({ feature: 'xtm-one' });

const CHAT_BASE = '/api/xtm-one/chat';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UPSTREAM_TIMEOUT_MS = 60_000;
/** What an answer can make besides a file, and how long XTM One may take to export one. */
const ARTIFACT_KINDS = new Set(['presentation', 'report', 'video']);
const ARTIFACT_EXPORT_TIMEOUT_MS = 5 * 60_000;
const artifactDownloadSchema = z.object({ format: z.string().regex(/^[a-z0-9_]{1,20}$/) });
/** Agent runs can stream for several minutes - no timeout, abort on client close. */
const SSE_ERROR_EVENT = (content: string): string => `data: ${JSON.stringify({ type: 'error', content })}\n\n`;
const CHAT_UNAVAILABLE = 'Unable to connect to the AI assistant. Please try again.';
/** XTM One's error body: a 422 names its invalid fields in an array, not a sentence. */
const upstreamRefusalSchema = z.object({ detail: z.string().trim().min(1) });

/** Why XTM One refused a request, when it said so in a sentence the user can read. */
const refusalReason = async (response: Response): Promise<string | undefined> => {
  if (response.status < 400 || response.status >= 500) {
    return undefined;
  }
  try {
    const parsed = upstreamRefusalSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.detail : undefined;
  } catch {
    return undefined;
  }
};

interface ChatContext {
  settings: XtmOneSettings,
  headers: Record<string, string>,
}

/**
 * One uploaded file as a multipart/form-data body for XTM One. `onProgress` is
 * called before every chunk XTM One takes. A file cut at the upload size limit
 * fails the body before its closing boundary.
 */
const multipartFileBody = async function* (
  part: MultipartFile,
  boundary: string,
  onProgress: () => void,
): AsyncGenerator<Uint8Array, void, undefined> {
  // The escapes of the HTML form-data encoding: a quote or a line break would end the header.
  const filename = (part.filename || 'upload.bin').replace(/["\r\n]/g, (char) => encodeURIComponent(char));
  const type = (part.mimetype || 'application/octet-stream').replace(/[\r\n]/g, '');
  onProgress();
  yield Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`,
  );
  // Not destroyed when XTM One stops reading early: the caller returns this
  // generator and drains the rest, so the next part of the request is reached.
  const chunks: AsyncIterable<unknown> = part.file.iterator({ destroyOnReturn: false });
  for await (const chunk of chunks) {
    if (!(chunk instanceof Uint8Array)) {
      throw new TypeError('The uploaded file stream yielded a non-binary chunk');
    }
    onProgress();
    yield chunk;
  }
  if (part.file.truncated) {
    throw newError('The uploaded file exceeds the upload size limit');
  }
  onProgress();
  yield Buffer.from(`\r\n--${boundary}--\r\n`);
};

/** A file XTM One answered, with the headers a download needs and none of the others. */
const sendFile = (reply: FastifyReply, response: Response): FastifyReply => {
  reply.header('Content-Type', response.headers.get('content-type') ?? 'application/octet-stream');
  for (const name of ['content-disposition', 'cache-control']) {
    const value = response.headers.get(name);
    if (value) {
      reply.header(name, value);
    }
  }
  // fetch decodes a compressed body but keeps the length of the encoded one.
  const contentLength = response.headers.get('content-length');
  if (contentLength && !response.headers.has('content-encoding')) {
    reply.header('Content-Length', contentLength);
  }
  return reply.send(response.body ?? Buffer.alloc(0));
};

/**
 * Register the XTM One HTTP surface:
 *
 * - `GET /xtm/auth/jwks` - public Ed25519 JWKS so XTM One can verify the
 *   per-user JWTs this platform mints (and this platform's users can be
 *   authenticated back by XTM One agents through `resolveRequestAuth`).
 * - `/api/xtm-one/chat/*` - the embedded "Ask Ariane" chat proxy. The
 *   browser authenticates with the OpenCRQ session cookie; every handler
 *   mints a fresh short-lived user JWT and forwards to the XTM One
 *   platform chat API (SSE piped through for streaming responses).
 */
export const registerXtmOneRoutes = (server: FastifyInstance, db: DrizzleDB): void => {
  // -- Public JWKS ---------------------------------------------------------
  server.get('/xtm/auth/jwks', async (_req, reply) => {
    const material = await ensureSigningKey(db);
    reply.header('Cache-Control', 'public, max-age=3600');
    return buildJwks(material);
  });

  const resolveAuth = resolveRequestAuth(db);

  /**
   * Session-cookie auth + config + Enterprise Edition gate shared by every
   * chat proxy route. The AI assistant is an EE feature - same gating as
   * OpenCTI's chatbot proxy license check and OpenAEV's
   * `@AccessControl(isEnterpriseEdition = true)` chat endpoints. The
   * entitlement is platform-wide (see features/edition).
   */
  const chatContext = async (
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<ChatContext | null> => {
    const settings = getXtmOneSettings();
    if (!settings) {
      reply.code(400).send({ error: 'XTM One is not configured' });
      return null;
    }
    await resolveAuth(req, reply);
    const user = req.authUser;
    // Browser-only surface: require a real cookie session. XTM One bearer
    // JWTs (synthetic session) must not reach the chat proxy - agents have
    // no business calling the chat back, and allowing it would mint a fresh
    // outbound JWT from an inbound one.
    if (!user || !req.authSession || req.authSession.id === XTM_ONE_SESSION_ID) {
      reply.code(401).send({ error: 'Unauthorized' });
      return null;
    }
    if (!(await requireEnterpriseEdition())) {
      reply.code(403).send({ error: 'The AI assistant requires an Enterprise Edition license' });
      return null;
    }
    const headers = await buildXtmOneHeaders(settings, db, {
      id: user.id,
      email: user.email,
      name: user.name,
    });
    return { settings, headers };
  };

  /**
   * Routes return the reply this sends, as they return `sendFile`'s: when an async handler resolves
   * before a compressed or streamed body is written, Fastify sends an empty body instead.
   */
  const forwardJson = async (
    reply: FastifyReply,
    ctx: ChatContext,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<FastifyReply> => {
    try {
      const response = await fetch(`${ctx.settings.url}${path}`, {
        method,
        headers: { ...ctx.headers, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      const text = await response.text();
      return reply.code(response.status)
        .header('Content-Type', response.headers.get('content-type') ?? 'application/json')
        .send(text);
    } catch (error) {
      logFromError(error, 'XTM One proxy request failed', { path });
      return reply.code(502).send({ error: 'Unable to reach the AI assistant service' });
    }
  };

  // -- Agents (intent catalog, vertical = crq) -----------------------------
  const intentCatalogAgentSchema = z.object({
    agent_id: z.string().optional(),
    agent_name: z.string().optional(),
    agent_slug: z.string().nullable().optional(),
    agent_description: z.string().nullable().optional(),
    priority: z.number().optional(),
  });
  const intentCatalogSchema = z.array(z.object({ agents: z.array(intentCatalogAgentSchema).optional() }));
  const chatUploadResponseSchema = z.object({ file_id: z.string().optional(), id: z.string().optional() });

  server.get(`${CHAT_BASE}/agents`, async (req, reply) => {
    const ctx = await chatContext(req, reply);
    if (!ctx) {
      return;
    }
    try {
      const response = await fetch(
        `${ctx.settings.url}/api/v1/intents/catalog?vertical=crq&intent=${encodeURIComponent('global.assistant')}`,
        { headers: ctx.headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) },
      );
      if (!response.ok) {
        reply.code(response.status).send({ error: 'Unable to list agents' });
        return;
      }
      const catalog = intentCatalogSchema.parse(await response.json());
      // The ChatPanel contract is `{ id, name, slug, description }` (same
      // mapping as OpenCTI's chatbot proxy) and it defaults to the FIRST
      // agent of the list - sort by binding priority (highest first, e.g.
      // the CTEM assistant) so the default agent is deterministic even if
      // the upstream catalog ordering changes.
      const agents = (Array.isArray(catalog) ? catalog : [])
        .flatMap((entry) => (Array.isArray(entry.agents) ? entry.agents : []))
        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
        .map((agent) => ({
          id: agent.agent_id,
          name: agent.agent_name,
          slug: agent.agent_slug ?? null,
          description: agent.agent_description ?? null,
        }));
      if (agents.length === 0) {
        reply.code(404).send({ error: 'No agents available' });
        return;
      }
      return reply.send(agents);
    } catch (error) {
      logFromError(error, 'XTM One agent catalog fetch failed');
      reply.code(502).send({ error: 'Unable to reach the AI assistant service' });
    }
  });

  // -- Sessions -------------------------------------------------------------
  server.post(`${CHAT_BASE}/sessions`, async (req, reply) => {
    const ctx = await chatContext(req, reply);
    if (!ctx) {
      return;
    }
    return forwardJson(reply, ctx, 'POST', '/api/v1/platform/chat/sessions', req.body ?? {});
  });

  server.get(`${CHAT_BASE}/sessions`, async (req, reply) => {
    const ctx = await chatContext(req, reply);
    if (!ctx) {
      return;
    }
    return forwardJson(reply, ctx, 'GET', '/api/v1/platform/chat/sessions');
  });

  server.delete(`${CHAT_BASE}/sessions/:conversationId`, async (req, reply) => {
    const ctx = await chatContext(req, reply);
    if (!ctx) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Fastify route params; type guaranteed by route pattern
    const { conversationId } = req.params as { conversationId: string };
    if (!UUID_RE.test(conversationId)) {
      reply.code(400).send({ error: 'Invalid conversation id' });
      return;
    }
    return forwardJson(reply, ctx, 'DELETE', `/api/v1/platform/chat/sessions/${conversationId}`);
  });

  // -- Composer: prompt picker and credits indicator ------------------------
  // Read-only, as OpenCTI and OpenAEV proxy them: the panel hides the picker
  // or the indicator when its route fails or has nothing to show.
  server.get(`${CHAT_BASE}/prompts`, async (req, reply) => {
    const ctx = await chatContext(req, reply);
    if (!ctx) {
      return;
    }
    return forwardJson(reply, ctx, 'GET', '/api/v1/platform/chat/prompts');
  });

  server.get(`${CHAT_BASE}/quota`, async (req, reply) => {
    const ctx = await chatContext(req, reply);
    if (!ctx) {
      return;
    }
    return forwardJson(reply, ctx, 'GET', '/api/v1/platform/chat/quota');
  });

  // -- Steering (mid-run user message) --------------------------------------
  server.post(`${CHAT_BASE}/messages/steer`, async (req, reply) => {
    const ctx = await chatContext(req, reply);
    if (!ctx) {
      return;
    }
    return forwardJson(reply, ctx, 'POST', '/api/v1/platform/chat/messages/steer', req.body ?? {});
  });

  // -- Tool approval (human-in-the-loop) ------------------------------------
  // Same shape as steering - a POST into a turn that is already streaming -
  // answering a turn XTM One paused because the agent proposed a gated tool
  // call. Upstream statuses pass through untouched: the panel tells 409
  // (nothing is waiting any more) from a transport failure, and keeps the
  // prompt on screen with the controls re-armed on anything else.
  server.post(`${CHAT_BASE}/messages/approve`, async (req, reply) => {
    const ctx = await chatContext(req, reply);
    if (!ctx) {
      return;
    }
    const decisions = parseApprovalRequest(req.body);
    if (!decisions || !UUID_RE.test(decisions.conversation_id)) {
      // Logged because the turn stays paused: a payload this proxy keeps
      // refusing reads from the panel as a decision that will not send, with
      // nothing on the server side to explain why.
      logTrace('XTM One tool approval payload rejected');
      reply.code(400).send({ error: 'Invalid approval decisions' });
      return;
    }
    return forwardJson(reply, ctx, 'POST', '/api/v1/platform/chat/messages/approve', decisions);
  });

  // Reload recovery: `approval_required` is a single event on the SSE stream,
  // so a refresh loses the prompt - including the `tool_call_id`s a decision
  // has to name - while the turn goes on waiting. The panel re-reads this on
  // mount and polls it after answering a recovered prompt; reaching it also
  // tells XTM One a client is still present, which is what keeps a displayed
  // prompt from being discarded as abandoned.
  server.get(`${CHAT_BASE}/conversations/:conversationId/pending-approvals`, async (req, reply) => {
    const ctx = await chatContext(req, reply);
    if (!ctx) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Fastify route params; type guaranteed by route pattern
    const { conversationId } = req.params as { conversationId: string };
    if (!UUID_RE.test(conversationId)) {
      reply.code(400).send({ error: 'Invalid conversation id' });
      return;
    }
    return forwardJson(
      reply,
      ctx,
      'GET',
      `/api/v1/platform/chat/conversations/${conversationId}/pending-approvals`,
    );
  });

  // -- Messages (SSE stream piped through) -----------------------------------
  server.post(`${CHAT_BASE}/messages`, async (req, reply) => {
    const ctx = await chatContext(req, reply);
    if (!ctx) {
      return;
    }

    // Take over the raw socket - Fastify must not try to serialize a
    // response of its own once SSE bytes start flowing.
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.flushHeaders?.();

    const abort = new AbortController();
    req.raw.on('close', () => abort.abort());
    const refusalRead = new AbortController();

    try {
      const upstream = await fetch(`${ctx.settings.url}/api/v1/platform/chat/messages`, {
        method: 'POST',
        headers: { ...ctx.headers, 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify(req.body ?? {}),
        signal: AbortSignal.any([abort.signal, refusalRead.signal]),
      });
      if (!upstream.ok || !upstream.body) {
        // Only the refusal body is bounded: a stalled one would otherwise hold the panel forever.
        const timer = setTimeout(() => refusalRead.abort(), UPSTREAM_TIMEOUT_MS);
        // An agent switched off or a conversation gone: the panel says why rather than suggesting a retry.
        const reason = await refusalReason(upstream).finally(() => clearTimeout(timer));
        const detail = upstream.status === 429
          ? `Quota exceeded - ${reason ?? 'please try again later.'}`
          : reason ?? CHAT_UNAVAILABLE;
        reply.raw.write(SSE_ERROR_EVENT(detail));
        reply.raw.end();
        return;
      }
      for await (const chunk of upstream.body) {
        reply.raw.write(chunk);
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        logFromError(error, 'XTM One chat stream failed');
        try {
          reply.raw.write(SSE_ERROR_EVENT(CHAT_UNAVAILABLE));
        } catch {
          // Socket already gone - nothing left to signal.
        }
      }
    } finally {
      reply.raw.end();
    }
  });

  // -- File upload (multipart -> XTM One conversation upload) ----------------
  server.post(`${CHAT_BASE}/upload`, async (req, reply) => {
    const ctx = await chatContext(req, reply);
    if (!ctx) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Fastify route params; type guaranteed by route pattern
    const { conversation_id: queryConversationId } = req.query as { conversation_id?: string };
    if (queryConversationId !== undefined && !UUID_RE.test(queryConversationId)) {
      reply.code(400).send({ error: 'conversation_id is required' });
      return;
    }
    if (!req.isMultipart?.()) {
      reply.code(400).send({ error: 'Multipart body expected' });
      return;
    }
    // The id comes as a query parameter, or as a form field sent before the
    // files (@filigran/chatbot). The query wins, then the first field.
    let conversationId = queryConversationId;
    // Set once a file arrived without a valid id: a field sent after that file
    // must not let the next file through.
    let conversationIdMissing = false;
    const hasValidId = (): boolean => !conversationIdMissing && !!conversationId && UUID_RE.test(conversationId);
    let filesSeen = 0;
    const fileIds: Array<string> = [];
    let rejectedStatus: number | undefined;
    try {
      for await (const part of req.parts()) {
        if (part.type === 'field') {
          if (part.fieldname === 'conversation_id' && conversationId === undefined) {
            conversationId = typeof part.value === 'string' ? part.value : '';
          }
          continue;
        }
        filesSeen += 1;
        if (!hasValidId()) {
          // Nothing goes to XTM One without a valid id: read the file to its
          // end so the request completes, and answer 400 once it has.
          conversationIdMissing = true;
          part.file.resume();
          continue;
        }
        // The file goes to XTM One as it arrives (see multipartFileBody), so the
        // timeout counts from the last chunk XTM One took, not from the start:
        // a large file on a slow link keeps moving, a stalled upload is cut.
        const upstream = new AbortController();
        let idle: ReturnType<typeof setTimeout> | undefined;
        const onProgress = (): void => {
          clearTimeout(idle);
          idle = setTimeout(() => upstream.abort(newError('XTM One chat upload timed out')), UPSTREAM_TIMEOUT_MS);
        };
        const boundary = `opencrq-${randomUUID()}`;
        const body = multipartFileBody(part, boundary, onProgress);
        try {
          const response = await fetch(
            `${ctx.settings.url}/api/v1/chat/conversations/${conversationId}/upload?create_message=false`,
            {
              method: 'POST',
              headers: { ...ctx.headers, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
              body,
              duplex: 'half',
              signal: upstream.signal,
            },
          );
          if (response.ok) {
            const payload = chatUploadResponseSchema.parse(await response.json());
            const fileId = payload.file_id ?? payload.id;
            if (fileId) {
              fileIds.push(fileId);
            }
          } else {
            rejectedStatus = response.status;
            logTrace('XTM One chat upload rejected a file', { status: response.status });
          }
        } finally {
          clearTimeout(idle);
          // XTM One may answer before it has read the whole file. The suspended
          // generator keeps a 'readable' listener on the file stream, which makes
          // resume() a no-op: end the generator first, then drain the rest, or the
          // next part of the request is never reached.
          await body.return(undefined).catch(() => undefined);
          part.file.resume();
        }
      }
    } catch (error) {
      if (conversationIdMissing) {
        // The missing id is the first thing wrong, even when draining the file
        // then hit the upload size limit.
        reply.code(400).send({ error: 'conversation_id is required' });
        return;
      }
      logFromError(error, 'XTM One chat upload failed');
      reply.code(502).send({ error: 'Unable to upload files to the AI assistant' });
      return;
    }
    if (!hasValidId()) {
      reply.code(400).send({ error: 'conversation_id is required' });
      return;
    }
    if (filesSeen === 0) {
      reply.code(400).send({ error: 'No file in the request' });
      return;
    }
    if (fileIds.length === 0) {
      reply.code(rejectedStatus ?? 500).send({ error: 'No file could be uploaded' });
      return;
    }
    reply.send({ file_ids: fileIds });
  });

  // -- Agent-generated file download ------------------------------------------
  server.get(`${CHAT_BASE}/files/:fileId/download`, async (req, reply) => {
    const ctx = await chatContext(req, reply);
    if (!ctx) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Fastify route params; type guaranteed by route pattern
    const { fileId } = req.params as { fileId: string };
    if (!UUID_RE.test(fileId)) {
      reply.code(400).send({ error: 'Invalid file id' });
      return;
    }
    try {
      const response = await fetch(
        `${ctx.settings.url}/api/v1/chat/files/${fileId}/download`,
        { headers: ctx.headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) },
      );
      if (!response.ok) {
        reply.code(response.status).send({ error: 'Unable to download the file' });
        return;
      }
      return sendFile(reply, response);
    } catch (error) {
      logFromError(error, 'XTM One chat file download failed');
      reply.code(502).send({ error: 'Unable to reach the AI assistant service' });
    }
  });

  // -- Decks, reports and videos an answer made -------------------------------
  // XTM One describes them in the chat answer (`artifacts`); the panel's cards
  // follow a video's render and download them through these two routes.
  const artifactTarget = (req: FastifyRequest): { kind: string, artifactId: string } | null => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Fastify route params; type guaranteed by route pattern
    const { kind, artifactId } = req.params as { kind: string, artifactId: string };
    return ARTIFACT_KINDS.has(kind) && UUID_RE.test(artifactId) ? { kind, artifactId } : null;
  };

  server.get(`${CHAT_BASE}/artifacts/:kind/:artifactId`, async (req, reply) => {
    const ctx = await chatContext(req, reply);
    if (!ctx) {
      return;
    }
    const target = artifactTarget(req);
    if (!target) {
      reply.code(400).send({ error: 'Invalid artifact' });
      return;
    }
    return forwardJson(reply, ctx, 'GET', `/api/v1/platform/chat/artifacts/${target.kind}/${target.artifactId}`);
  });

  server.post(`${CHAT_BASE}/artifacts/:kind/:artifactId/download`, async (req, reply) => {
    const ctx = await chatContext(req, reply);
    if (!ctx) {
      return;
    }
    const target = artifactTarget(req);
    const parsed = artifactDownloadSchema.safeParse(req.body);
    if (!target || !parsed.success) {
      reply.code(400).send({ error: 'Invalid artifact download' });
      return;
    }
    // XTM One renders a deck or a report before the first byte; a video can
    // then take long to stream, so only the wait for the answer is bounded.
    // The browser leaving is told by the response's `close`: the request's
    // fired as soon as Fastify had read the JSON body.
    const exportTimeout = new AbortController();
    const timer = setTimeout(() => exportTimeout.abort(), ARTIFACT_EXPORT_TIMEOUT_MS);
    const browserGone = new AbortController();
    reply.raw.once('close', () => {
      if (!reply.raw.writableEnded) {
        browserGone.abort();
      }
    });
    // A browser that left while `chatContext` resolved closed the response before this listener.
    if (reply.raw.destroyed) {
      browserGone.abort();
    }
    try {
      const response = await fetch(
        `${ctx.settings.url}/api/v1/platform/chat/artifacts/${target.kind}/${target.artifactId}/download`,
        {
          method: 'POST',
          headers: { ...ctx.headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ format: parsed.data.format }),
          signal: AbortSignal.any([exportTimeout.signal, browserGone.signal]),
        },
      );
      if (!response.ok) {
        const refusal = await response.text();
        return reply.code(response.status)
          .header('Content-Type', response.headers.get('content-type') ?? 'application/json')
          .send(refusal);
      }
      return sendFile(reply, response);
    } catch (error) {
      if (browserGone.signal.aborted) {
        return;
      }
      logFromError(error, 'XTM One chat artifact download failed', { kind: target.kind });
      return reply.code(502).send({ error: 'Unable to reach the AI assistant service' });
    } finally {
      clearTimeout(timer);
    }
  });
};
