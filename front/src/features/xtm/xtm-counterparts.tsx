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
 * icon-only button per counterpart product, its emblem and no text, at the size of the sibling header
 * actions (36 px). The emblem group comes first in the action row, before this product's own actions,
 * ordered XTM One, OpenCTI, OpenAEV (OpenCRQ is this product; Sam, 23 Nov 2026). XTM One's CTEM
 * inventory holds assets only, so its emblem is drawn on assets alone. Three states, one emblem:
 * - found: the emblem in colour, the click opens the object there, hover and focus show its facts;
 * - connected, not found: the emblem greyed, still focusable, a tooltip saying how it gets there;
 * - not connected: the emblem greyed, a teaser of what the product would show (example fields as
 *   skeletons, never figures), the connect link for a configurer, a read-only hint for the others.
 * A product the object came from is found from its source link first, the shared key second.
 * List rows carry a 16 px mark only when found, nothing otherwise.
 */

/** The sibling products an object can come from (its sources). */
export type XtmProduct = 'opencti' | 'openaev';
/** Every product an object is looked up in: XTM One and the siblings. */
export type CounterpartProduct = 'xtmone' | XtmProduct;
export type CounterpartKind = 'ASSET' | 'ATTACK_PATTERN' | 'VULNERABILITY' | 'THREAT';
export type XtmCounterpart = RouterOutputs['xtm']['counterparts'][number];

// eslint-disable-next-line lingui/no-unlocalized-strings -- product names, never translated
const PRODUCT_NAMES: Record<CounterpartProduct, string> = { xtmone: 'XTM One', opencti: 'OpenCTI', openaev: 'OpenAEV' };
// The product glyphs of the design system's product switcher (filigran-design-system
// product-logos.generated.tsx, its fill-highlight group), monochrome, painted through a CSS mask.
const PRODUCT_MARKS: Record<CounterpartProduct, string> = {
  xtmone: '/img/xtm-mark-xtmone.svg',
  opencti: '/img/xtm-mark-opencti.svg',
  openaev: '/img/xtm-mark-openaev.svg',
};
/** The sibling products in the emblem order: OpenCTI, OpenAEV, OpenCRQ, this product skipped. */
export const XTM_PRODUCTS: ReadonlyArray<XtmProduct> = ['opencti', 'openaev'];

/**
 * The emblems of one kind, in the order of the contract: XTM One first, then the siblings. XTM One's
 * inventory holds assets only.
 */
export const emblemProducts = (kind: CounterpartKind): ReadonlyArray<CounterpartProduct> => (
  kind === 'ASSET' ? ['xtmone', ...XTM_PRODUCTS] : XTM_PRODUCTS
);

export const productName = (product: CounterpartProduct) => PRODUCT_NAMES[product];

const openIn = (product: CounterpartProduct) => {
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

/**
 * Two colours, the same for every sibling product (Sam, 22 Nov 2026): found = the design system's
 * highlight ink (--icon-highlight, the brand primary of the theme, the colour of the product switcher
 * marks); not found or not connected = its disabled ink (--icon-disabled). The one exception (Sam,
 * 23 Nov 2026): a found XTM One emblem is the canonical XTM One purple, the design system's
 * --color-filigran-ia-primary (--purple-500 #651fe5 light, --purple-300 #a47af0 dark,
 * filigran-design-system src/tokens/theme.css; the brand mark xtm-one-logo-light.svg fills #651FE5).
 */
const foundInk = (product: CounterpartProduct) => (product === 'xtmone' ? 'text-filigran-ia-primary' : 'text-icon-highlight');

const ProductMark: FunctionComponent<{ product: CounterpartProduct, size?: number, muted?: boolean }> = ({ product, size, muted }) => {
  const px = size ?? 16;
  // eslint-disable-next-line lingui/no-unlocalized-strings -- CSS mask value, not copy
  const mask = `url("${PRODUCT_MARKS[product]}") center / contain no-repeat`;
  return (
    <span
      aria-hidden
      data-testid="xtm-mark"
      data-muted={muted ? 'true' : 'false'}
      className={`inline-block shrink-0 bg-current ${muted ? 'text-icon-disabled' : foundInk(product)}`}
      style={{ width: px, height: px, mask, WebkitMask: mask }}
    />
  );
};

const FACT_LABELS = (): Record<string, string> => ({
  findings: t`Findings`,
  affected_assets: t`Affected assets`,
  simulations: t`Simulations`,
  last_simulation: t`Last simulation`,
  reports: t`Reports`,
  relationships: t`Relationships`,
  criticality: t`Criticality`,
  category: t`Category`,
});

/**
 * A fact value as a person reads it. XTM One answers its inventory enums (`very_high`,
 * `generic_asset`): a criticality takes this product's label, any other enum is sentence-cased.
 */
export const factValueLabel = (key: string, value: string): string => {
  if (key === 'criticality') {
    switch (value) {
      case 'low': return t`Low`;
      case 'medium': return t`Medium`;
      case 'high': return t`High`;
      case 'very_high': return t`Very High`;
      case 'critical': return t`Critical`;
    }
  }
  if (key === 'criticality' || key === 'category') {
    const words = value.replace(/_/g, ' ').trim().toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  return value;
};

/** The fields a product would show once connected, by their fact key: labels only, never values. */
const TEASER_FIELDS: Record<CounterpartProduct, ReadonlyArray<string>> = {
  xtmone: ['criticality', 'category'],
  opencti: ['reports', 'relationships'],
  openaev: ['simulations', 'findings'],
};

const actionIn = (product: CounterpartProduct) => {
  switch (product) {
    case 'xtmone': return t`See this asset in the XTM One CTEM inventory, with every source that reports it.`;
    case 'opencti': return t`See the reports, relationships and context of this object in OpenCTI.`;
    case 'openaev': return t`See the simulations and findings of this object in OpenAEV.`;
  }
};

/** How an object of `kind` gets into `product`: the key the two products share. */
const howItGetsThere = (kind: CounterpartKind, product: CounterpartProduct) => {
  const name = productName(product);
  if (product === 'xtmone') {
    return t`It appears here once a source of the XTM One inventory reports a machine with the same hostname.`;
  }
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
              <dd className="m-0 font-semibold">{factValueLabel(f.key, f.value)}</dd>
            </div>
          ))}
        </dl>
      )}
      <span className="text-default-secondary">{actionIn(counterpart.product)}</span>
    </div>
  );
};

/** The teaser of a product not connected: what it would show, example fields as labelled skeletons. */
export const XtmConnectTeaser: FunctionComponent<{ product: CounterpartProduct, canConfigure: boolean }> = ({ product, canConfigure }) => {
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
export const xtmEmblemState = (product: CounterpartProduct, input: XtmEmblemInput): XtmEmblemState => {
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
  product: CounterpartProduct,
  kind: CounterpartKind,
  state: XtmEmblemState,
}

const GreyHint: FunctionComponent<{ title: string, line: string }> = ({ title, line }) => (
  <div className="flex max-w-72 flex-col gap-1 py-1">
    <span className="font-semibold">{title}</span>
    <span className="text-default-secondary">{line}</span>
  </div>
);

/**
 * The not-connected emblem: the connector link for a configurer, a disabled look and a read-only hint
 * for the others. XTM One is deployment configuration (`XTM_ONE__URL`), never a connector page: its
 * emblem takes the read-only hint for everyone.
 */
const NotConnectedEmblem: FunctionComponent<{ product: CounterpartProduct }> = ({ product }) => {
  const canManageSecurity = useHasManageSecurity();
  const canConfigure = canManageSecurity && product !== 'xtmone';
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

/** Hero slot, first in the action row: one emblem per counterpart product, XTM One (assets), OpenCTI, OpenAEV, always drawn. */
export const XtmPivotEmblems: FunctionComponent<XtmPivotEmblemsProps> = ({ kind, objectKey, sourced }) => {
  const trpc = useTRPC();
  const connections = useXtmConnections();
  const { present, options } = lookupOptions([objectKey]);
  const lookup = useQuery(trpc.xtm.counterparts.queryOptions({ kind, keys: present }, options));
  return (
    <TooltipHintProvider>
      {emblemProducts(kind).map((product) => (
        <XtmEmblem
          key={product}
          product={product}
          kind={kind}
          state={xtmEmblemState(product, {
            connected: connections.data?.find((c) => c.product === product)?.connected ?? (connections.data ? false : undefined),
            connectionsFailed: connections.isError,
            sourced: product === 'xtmone' ? undefined : sourced?.[product],
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
