import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { IconButton, Skeleton } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import { Link } from '@tanstack/react-router';
import type { FunctionComponent, ReactElement, ReactNode } from 'react';
import { TooltipHint, TooltipHintProvider } from '../../components/shared/tooltip-hint';
import { useHasManageSecurity } from '../../hooks/utils/use-has-manage-security';
import { useTRPC } from '../../lib';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;

/**
 * Cross-product awareness, contract v3, the same in OpenCTI, OpenAEV and OpenCRQ: in every hero, one
 * icon-only button per counterpart product (OpenCTI, then OpenAEV; OpenCRQ is this product), its
 * emblem and no text, at the size of the sibling header actions (36 px). Three states, one emblem:
 * - found: the emblem in colour, the click opens the object there, hover and focus show its facts;
 * - connected, not found: the emblem greyed, still focusable, a tooltip saying how it gets there;
 * - not connected: the emblem greyed, a teaser of what the product would show (example fields as
 *   skeletons, never figures), the connect link for a configurer, a read-only hint for the others.
 * A product the object came from is found from its source link first, the shared key second.
 * List rows carry a 16 px mark only when found, nothing otherwise.
 */

export type XtmProduct = 'opencti' | 'openaev';
export type CounterpartKind = 'ASSET' | 'ATTACK_PATTERN' | 'VULNERABILITY' | 'THREAT';
export type XtmCounterpart = RouterOutputs['xtm']['counterparts'][number];

// eslint-disable-next-line lingui/no-unlocalized-strings -- product names, never translated
const PRODUCT_NAMES: Record<XtmProduct, string> = { opencti: 'OpenCTI', openaev: 'OpenAEV' };
const PRODUCT_MARKS: Record<XtmProduct, string> = { opencti: '/img/icon-opencti.png', openaev: '/img/icon-openaev.png' };
/** The emblem order of the contract: OpenCTI, OpenAEV, OpenCRQ, this product skipped. */
export const XTM_PRODUCTS: ReadonlyArray<XtmProduct> = ['opencti', 'openaev'];

export const productName = (product: XtmProduct) => PRODUCT_NAMES[product];

const openIn = (product: XtmProduct) => {
  const name = productName(product);
  return t`Open in ${name}`;
};

/** The connections change only with the deployment: read once per session. */
export const useXtmConnections = () => {
  const trpc = useTRPC();
  return useQuery(trpc.xtm.connections.queryOptions(undefined, { staleTime: Infinity }));
};

const lookupOptions = (keys: ReadonlyArray<string | null | undefined>) => {
  const present = [...new Set(keys.filter((k): k is string => !!k))].sort();
  return { present, options: { enabled: present.length > 0, staleTime: 2 * 60 * 1000, retry: false } };
};

/** The counterparts of one or several keys, one batched call per kind; empty while not connected. */
export const useCounterparts = (kind: CounterpartKind, keys: ReadonlyArray<string | null | undefined>) => {
  const trpc = useTRPC();
  const { present, options } = lookupOptions(keys);
  const { data } = useQuery(trpc.xtm.counterparts.queryOptions({ kind, keys: present }, options));
  return data ?? [];
};

const ProductMark: FunctionComponent<{ product: XtmProduct, size?: number, muted?: boolean }> = ({ product, size, muted }) => (
  <img
    src={PRODUCT_MARKS[product]}
    alt=""
    aria-hidden
    width={size ?? 16}
    height={size ?? 16}
    // Greyed, yet legible on both themes: the OpenAEV emblem is dark, so the dark theme lifts it.
    className={muted ? 'shrink-0 opacity-60 grayscale dark:brightness-200' : 'shrink-0'}
  />
);

const FACT_LABELS = (): Record<string, string> => ({
  findings: t`Findings`,
  affected_assets: t`Affected assets`,
  simulations: t`Simulations`,
  last_simulation: t`Last simulation`,
  reports: t`Reports`,
  relationships: t`Relationships`,
});

/** The fields a product would show once connected, by their fact key: labels only, never values. */
const TEASER_FIELDS: Record<XtmProduct, ReadonlyArray<string>> = {
  opencti: ['reports', 'relationships'],
  openaev: ['simulations', 'findings'],
};

const actionIn = (product: XtmProduct) => (product === 'opencti'
  ? t`See the reports, relationships and context of this object in OpenCTI.`
  : t`See the simulations and findings of this object in OpenAEV.`);

/** How an object of `kind` gets into `product`: the key the two products share. */
const howItGetsThere = (kind: CounterpartKind, product: XtmProduct) => {
  const name = productName(product);
  switch (kind) {
    case 'ASSET':
      return t`It appears here once ${name} holds a machine with the same hostname.`;
    case 'VULNERABILITY':
      return t`It appears here once ${name} holds the same CVE.`;
    case 'THREAT':
      return t`It appears here once ${name} holds the same threat, by its STIX id.`;
    case 'ATTACK_PATTERN':
      return t`It appears here once ${name} holds the same technique, by its MITRE id.`;
  }
};

/**
 * What a found emblem opens, shown on hover and keyboard focus: the product, the object's type and
 * name in it, the key facts it answered and what can be done there.
 */
export const XtmPivotPreview: FunctionComponent<{ counterpart: XtmCounterpart }> = ({ counterpart }) => {
  const labels = FACT_LABELS();
  return (
    <div className="flex max-w-72 flex-col gap-1.5 py-1" data-testid="xtm-preview">
      <span className="flex items-center gap-2">
        <ProductMark product={counterpart.product} />
        <span className="font-semibold">{productName(counterpart.product)}</span>
        <span className="text-default-secondary">{counterpart.objectType}</span>
      </span>
      {counterpart.objectName && <span className="font-semibold">{counterpart.objectName}</span>}
      {counterpart.facts.length > 0 && (
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
          {counterpart.facts.map((f) => (
            <div key={f.key} className="contents">
              <dt className="text-default-secondary">{labels[f.key] ?? f.key}</dt>
              <dd className="m-0 font-semibold">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <span className="text-default-secondary">{actionIn(counterpart.product)}</span>
    </div>
  );
};

/** The teaser of a product not connected: what it would show, example fields as labelled skeletons. */
export const XtmConnectTeaser: FunctionComponent<{ product: XtmProduct, canConfigure: boolean }> = ({ product, canConfigure }) => {
  const name = productName(product);
  const labels = FACT_LABELS();
  return (
    <div className="flex max-w-72 flex-col gap-1.5 py-1" data-testid="xtm-teaser">
      <span className="flex items-center gap-2">
        <ProductMark product={product} muted />
        <span className="font-semibold">{t`${name} is not connected`}</span>
      </span>
      <span className="text-default-secondary">{actionIn(product)}</span>
      <dl className="m-0 grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1">
        {TEASER_FIELDS[product].map((key) => (
          <div key={key} className="contents">
            <dt className="text-default-secondary">{labels[key]}</dt>
            <dd className="m-0"><Skeleton className="h-3 w-12" /></dd>
            <dd className="m-0 text-xs text-default-secondary">{t`Example`}</dd>
          </div>
        ))}
      </dl>
      {canConfigure
        ? <span className="font-semibold">{t`Connect ${name}`}</span>
        : <span className="text-default-secondary">{t`Ask an administrator to connect ${name}.`}</span>}
    </div>
  );
};

/** The state of one product's emblem for one object. */
export type XtmEmblemState =
  | { kind: 'found', counterpart: XtmCounterpart }
  | { kind: 'not-found' }
  | { kind: 'not-connected' }
  | { kind: 'checking' }
  | { kind: 'unavailable' };

export interface XtmEmblemInput {
  /** `undefined` while the connections load. */
  connected: boolean | undefined,
  connectionsFailed: boolean,
  /** The object as its source row opens it in this product, when it came from it. */
  sourced?: XtmCounterpart,
  /** `undefined` while the lookup loads. */
  counterparts: ReadonlyArray<XtmCounterpart> | undefined,
  lookupFailed: boolean,
  hasKey: boolean,
}

/**
 * One product's emblem state. A product the object came from is found from its source link, its
 * facts taken from the lookup when that answered the same product; otherwise the lookup decides.
 */
export const xtmEmblemState = (product: XtmProduct, input: XtmEmblemInput): XtmEmblemState => {
  const match = input.counterparts?.find((c) => c.product === product);
  if (input.sourced) {
    return { kind: 'found', counterpart: match ? { ...input.sourced, facts: match.facts } : input.sourced };
  }
  if (input.connectionsFailed) {
    return { kind: 'unavailable' };
  }
  if (input.connected === undefined) {
    return { kind: 'checking' };
  }
  if (!input.connected) {
    return { kind: 'not-connected' };
  }
  if (!input.hasKey) {
    return { kind: 'not-found' };
  }
  if (input.lookupFailed) {
    return { kind: 'unavailable' };
  }
  if (input.counterparts === undefined) {
    return { kind: 'checking' };
  }
  return match ? { kind: 'found', counterpart: match } : { kind: 'not-found' };
};

interface XtmEmblemProps {
  product: XtmProduct,
  kind: CounterpartKind,
  state: XtmEmblemState,
}

const GreyHint: FunctionComponent<{ title: string, line: string }> = ({ title, line }) => (
  <div className="flex max-w-72 flex-col gap-1 py-1">
    <span className="font-semibold">{title}</span>
    <span className="text-default-secondary">{line}</span>
  </div>
);

/** The not-connected emblem: the connector link for a configurer, a disabled look and a read-only hint for the others. */
const NotConnectedEmblem: FunctionComponent<{ product: XtmProduct }> = ({ product }) => {
  const canConfigure = useHasManageSecurity();
  const name = productName(product);
  const control = canConfigure
    ? (
      <IconButton asChild priority="secondary" size="md" aria-label={t`Connect ${name}`} icon={<ProductMark product={product} size={20} muted />}>
        <Link
          from="/$tenantId/{-$organizationId}"
          to="/$tenantId/{-$organizationId}/integrations/connectors/$connectorSlug"
          params={{ connectorSlug: product }}
        />
      </IconButton>
    )
    : <IconButton priority="secondary" size="md" aria-disabled aria-label={t`${name} is not connected`} icon={<ProductMark product={product} size={20} muted />} />;
  return <TooltipHint hint={<XtmConnectTeaser product={product} canConfigure={canConfigure} />} keepOpenOnPress={!canConfigure}>{control}</TooltipHint>;
};

/** One product's icon-only hero button, 36 px like the sibling header actions, in its state. */
export const XtmEmblem: FunctionComponent<XtmEmblemProps> = ({ product, kind, state }) => {
  const name = productName(product);
  let control: ReactElement;
  let hint: ReactNode;
  if (state.kind === 'not-connected') {
    return <NotConnectedEmblem product={product} />;
  }
  if (state.kind === 'found') {
    hint = <XtmPivotPreview counterpart={state.counterpart} />;
    control = (
      <IconButton asChild priority="secondary" size="md" aria-label={openIn(product)} icon={<ProductMark product={product} size={20} />}>
        <a href={state.counterpart.objectUrl} target="_blank" rel="noreferrer noopener" />
      </IconButton>
    );
  } else {
    let title = t`Not found in ${name}`;
    let line = howItGetsThere(kind, product);
    if (state.kind === 'checking') {
      title = t`Looking in ${name}…`;
      line = t`The emblem turns active if ${name} holds this object.`;
    } else if (state.kind === 'unavailable') {
      title = t`${name} could not be reached`;
      line = t`Try again later.`;
    }
    hint = <GreyHint title={title} line={line} />;
    control = <IconButton priority="secondary" size="md" aria-disabled aria-label={title} icon={<ProductMark product={product} size={20} muted />} />;
  }
  return <TooltipHint hint={hint} keepOpenOnPress={state.kind !== 'found'}>{control}</TooltipHint>;
};

interface XtmPivotEmblemsProps {
  kind: CounterpartKind,
  /** The key the products share (hostname, CVE id, STIX id); `null` when the object has none. */
  objectKey: string | null | undefined,
  /** The object as its source opens it in a product it came from: that emblem is found, never looked up. */
  sourced?: Partial<Record<XtmProduct, XtmCounterpart>>,
}

/** Hero slot: one emblem per counterpart product, OpenCTI then OpenAEV, always drawn. */
export const XtmPivotEmblems: FunctionComponent<XtmPivotEmblemsProps> = ({ kind, objectKey, sourced }) => {
  const trpc = useTRPC();
  const connections = useXtmConnections();
  const { present, options } = lookupOptions([objectKey]);
  const lookup = useQuery(trpc.xtm.counterparts.queryOptions({ kind, keys: present }, options));
  return (
    <TooltipHintProvider>
      {XTM_PRODUCTS.map((product) => (
        <XtmEmblem
          key={product}
          product={product}
          kind={kind}
          state={xtmEmblemState(product, {
            connected: connections.data?.find((c) => c.product === product)?.connected ?? (connections.data ? false : undefined),
            connectionsFailed: connections.isError,
            sourced: sourced?.[product],
            counterparts: lookup.data,
            lookupFailed: lookup.isError,
            hasKey: present.length > 0,
          })}
        />
      ))}
    </TooltipHintProvider>
  );
};

/** List row: a 16 px product mark per counterpart found, a link to it; nothing otherwise. */
export const XtmRowMarks: FunctionComponent<{ counterparts: ReadonlyArray<XtmCounterpart> }> = ({ counterparts }): ReactElement | null => {
  if (counterparts.length === 0) {
    return null;
  }
  return (
    <TooltipHintProvider>
      <span className="inline-flex items-center">
        {counterparts.map((c) => (
          <TooltipHint key={`${c.product}-${c.objectId}`} hint={<XtmPivotPreview counterpart={c} />}>
            {/* 24 px hit area around the 16 px mark. */}
            <a
              href={c.objectUrl}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={openIn(c.product)}
              className="inline-flex h-6 w-6 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 ring-focus"
              onClick={(e) => e.stopPropagation()}
            >
              <ProductMark product={c.product} size={16} />
            </a>
          </TooltipHint>
        ))}
      </span>
    </TooltipHintProvider>
  );
};

/** The XTM products among an object's sources. */
export const xtmSourceProducts = (sources: ReadonlyArray<string | null | undefined>): Array<XtmProduct> => (
  XTM_PRODUCTS.filter((p) => sources.includes(p))
);
