import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { Button, Chip, IconButton, Paper, Separator, Skeleton } from '@filigran/design-system';
import { Popover, PopoverContent, PopoverTrigger } from '@filigran/ui';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import { Link } from '@tanstack/react-router';
import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import type { FunctionComponent, ReactElement } from 'react';
import type { ReaderAccessIssue } from './use-reader-access';
import { TooltipHint, TooltipHintProvider } from '../../components/shared/tooltip-hint';
import { useHasManageSecurity } from '../../hooks/utils/use-has-manage-security';
import { useTRPC } from '../../lib';
import { useReaderAccess } from './use-reader-access';

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
export type XtmCounterpart = RouterOutputs['xtm']['counterparts']['counterparts'][number];

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
  return data?.counterparts ?? [];
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

/**
 * The outline of the single XTM One emblem button: the XTM One purple in every state, found or not,
 * hover and focus included (Sam, 24 Nov 2026), the same token in OpenCTI, OpenAEV and OpenCRQ. The
 * design system's hover fill and focus ring are kept.
 */
export const EMBLEM_OUTLINE = 'var(--color-filigran-ia-primary)';

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
export const howItGetsThere = (kind: CounterpartKind, product: CounterpartProduct) => {
  const name = productName(product);
  if (product === 'xtmone') {
    return t`It appears here once a source of the XTM One inventory reports the same OpenAEV asset, name, hostname, URL or address.`;
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
  | { kind: 'unavailable' }
  /** The product is connected but cannot be read as the reader: a link to make, or an account to create. */
  | { kind: 'no-access', issue: Exclude<ReaderAccessIssue, 'unavailable'> };

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
  /** Why the reader cannot be read as themselves in this product, when they cannot. */
  readerIssue?: ReaderAccessIssue | null,
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
  if (input.readerIssue === 'unavailable') {
    return { kind: 'unavailable' };
  }
  if (input.readerIssue) {
    return { kind: 'no-access', issue: input.readerIssue };
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

interface XtmPivotEmblemsProps {
  kind: CounterpartKind,
  /** The key the products share (hostname, CVE id, STIX id); `null` when the object has none. */
  objectKey: string | null | undefined,
  /** More keys of the same object, looked up with `objectKey` in one call: an asset's source references, name, addresses. */
  objectKeys?: ReadonlyArray<string>,
  /** The object as its source opens it in a product it came from: that emblem is found, never looked up. */
  sourced?: Partial<Record<XtmProduct, XtmCounterpart>>,
}

/** One section of the cross-product surface: a product and its state. */
export interface XtmSurfaceSection {
  product: CounterpartProduct,
  state: XtmEmblemState,
}

/**
 * The sections the surface shows, in the emblem order: found, not found and unavailable always; not
 * connected only to a user who can connect the product (XTM One, deployment configuration, never);
 * checking never (the slot fills once the answer is known).
 */
export const visibleSurfaceSections = (
  sections: ReadonlyArray<XtmSurfaceSection>,
  canConfigure: boolean,
): Array<XtmSurfaceSection> => sections.filter(({ product, state }) => {
  if (state.kind === 'checking') {
    return false;
  }
  if (state.kind === 'not-connected') {
    return canConfigure && product !== 'xtmone';
  }
  return true;
});

const noAccessText = (issue: Exclude<ReaderAccessIssue, 'unavailable'>, name: string) => (
  issue === 'not_linked'
    ? t`${name} is not linked to this platform's XTM One, so OpenCRQ cannot look this object up there as you. Ask an administrator to link it.`
    : t`${name} has no account for your email, so OpenCRQ cannot look this object up there as you. Ask a ${name} administrator to create one.`
);

const SurfaceSection: FunctionComponent<XtmSurfaceSection & { kind: CounterpartKind }> = ({ product, state, kind }) => {
  const name = productName(product);
  const labels = FACT_LABELS();
  let chip: ReactElement;
  switch (state.kind) {
    case 'found': chip = <Chip severity="info" label={t`Found`} />; break;
    case 'not-found': chip = <Chip label={t`Not found`} />; break;
    case 'unavailable': chip = <Chip severity="medium" label={t`Unavailable`} />; break;
    case 'no-access': chip = <Chip severity="medium" label={t`No access`} />; break;
    case 'checking':
    case 'not-connected': chip = <Chip label={t`Not connected`} />; break;
  }
  return (
    <section aria-label={name} data-testid={`xtm-section-${product}`} data-status={state.kind} className="flex flex-col gap-2">
      <span className="flex items-center gap-2">
        <ProductMark product={product} muted={state.kind !== 'found'} />
        <span className="flex-1 font-semibold">{name}</span>
        {chip}
      </span>
      {state.kind === 'found' && (
        <>
          {(state.counterpart.objectType || state.counterpart.objectName) && (
            <span className="flex min-w-0 items-center gap-2">
              {state.counterpart.objectType && <Chip label={state.counterpart.objectType} />}
              {state.counterpart.objectName && <CutName value={state.counterpart.objectName} />}
            </span>
          )}
          {state.counterpart.facts.length > 0 && (
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
              {state.counterpart.facts.map((f) => (
                <div key={f.key} className="contents">
                  <dt className="text-default-secondary">{labels[f.key] ?? f.key}</dt>
                  <dd className="m-0 font-semibold">{factValueLabel(f.key, f.value)}</dd>
                </div>
              ))}
            </dl>
          )}
          {safeCounterpartUrl(state.counterpart.objectUrl) && (
            <span>
              <Button asChild priority="secondary" size="sm">
                <a href={safeCounterpartUrl(state.counterpart.objectUrl)} target="_blank" rel="noreferrer noopener">{openIn(product)}</a>
              </Button>
            </span>
          )}
        </>
      )}
      {state.kind === 'not-found' && <span className="text-default-secondary">{howItGetsThere(kind, product)}</span>}
      {state.kind === 'unavailable' && <span className="text-default-secondary">{t`${name} could not be reached. Try again later.`}</span>}
      {state.kind === 'no-access' && <span className="text-default-secondary">{noAccessText(state.issue, name)}</span>}
      {state.kind === 'not-connected' && (
        <span>
          <Button asChild priority="secondary" size="sm">
            <Link
              from="/$tenantId/{-$organizationId}"
              to="/$tenantId/{-$organizationId}/integrations/connectors/$connectorSlug"
              params={{ connectorSlug: product }}
            >
              {t`Connect ${name}`}
            </Link>
          </Button>
        </span>
      )}
    </section>
  );
};

/**
 * The object's name on one line, cut with an ellipsis when wider than the surface; only a cut name
 * carries the shared tooltip with the name in full.
 */
const CutName: FunctionComponent<{ value: string }> = ({ value }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    setCut(element !== null && element.scrollWidth > element.clientWidth);
  }, [value]);
  const name = <span ref={ref} className="min-w-0 truncate" data-testid="xtm-object-name" data-cut={cut}>{value}</span>;
  return cut ? <TooltipHint hint={value}>{name}</TooltipHint> : name;
};

/** A counterpart link is followed only when it is an http(s) address. */
export const safeCounterpartUrl = (url: string | null | undefined): string | undefined => {
  if (!url) {
    return undefined;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The single XTM One emblem and its anchored surface, from the sections; tests drive every state
 * through it. Purple when at least one product holds the object, grey otherwise; nothing to show
 * draws no emblem.
 */
export const XtmSurface: FunctionComponent<{ kind: CounterpartKind, sections: ReadonlyArray<XtmSurfaceSection> }> = ({ kind, sections }) => {
  const [open, setOpen] = useState(false);
  if (sections.length === 0) {
    return null;
  }
  const found = sections.filter((s) => s.state.kind === 'found').length;
  const label = found > 0 ? t`Across the XTM Platform` : t`Not found across the XTM Platform`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipHintProvider>
        <TooltipHint hint={label}>
          <PopoverTrigger asChild>
            <IconButton
              priority="secondary"
              size="md"
              aria-label={label}
              data-testid="xtm-emblem"
              data-found={found}
              style={{ borderColor: EMBLEM_OUTLINE }}
              icon={<ProductMark product="xtmone" size={20} muted={found === 0} />}
            />
          </PopoverTrigger>
        </TooltipHint>
      </TooltipHintProvider>
      {/* The popover only positions the surface: the design system Paper draws it (no shadow, the elevation's surface and border), as OpenCTI #20153. */}
      <PopoverContent align="end" className="w-auto border-0 bg-transparent p-0 shadow-none" aria-label={t`Across the XTM Platform`} data-testid="xtm-surface">
        <Paper elevation={2} padding={16} data-testid="xtm-surface-paper">
          <TooltipHintProvider>
            <div className="flex w-80 flex-col gap-4">
              <span className="flex items-center gap-2">
                <ProductMark product="xtmone" muted={found === 0} />
                <span className="font-semibold">{t`Across the XTM Platform`}</span>
              </span>
              {sections.map((section, index) => (
                <Fragment key={section.product}>
                  {index > 0 && <Separator data-testid="xtm-surface-separator" />}
                  <SurfaceSection {...section} kind={kind} />
                </Fragment>
              ))}
            </div>
          </TooltipHintProvider>
        </Paper>
      </PopoverContent>
    </Popover>
  );
};

/**
 * Hero slot, first in the action row: the single XTM One emblem (Sam, 23 Nov 2026; parity with
 * OpenCTI-Platform/opencti#20153), its surface listing XTM One (assets), OpenCTI and OpenAEV. No
 * feature flag in OpenCRQ: its authentication mechanism differs, and a sibling that does not answer
 * (a 404 included) is shown unavailable or left out, never an error.
 */
export const XtmPivotEmblems: FunctionComponent<XtmPivotEmblemsProps> = ({ kind, objectKey, objectKeys, sourced }) => {
  const trpc = useTRPC();
  const connections = useXtmConnections();
  const { counterparts: readerAccess } = useReaderAccess();
  const canManageSecurity = useHasManageSecurity();
  const { present, options } = lookupOptions([objectKey, ...(objectKeys ?? [])]);
  const lookup = useQuery(trpc.xtm.counterparts.queryOptions({ kind, keys: present }, options));
  const sections = emblemProducts(kind).map((product) => ({
    product,
    state: xtmEmblemState(product, {
      connected: connections.data?.find((c) => c.product === product)?.connected ?? (connections.data ? false : undefined),
      connectionsFailed: connections.isError,
      sourced: product === 'xtmone' ? undefined : sourced?.[product],
      counterparts: lookup.data?.counterparts,
      lookupFailed: lookup.isError || (lookup.data?.unavailable.includes(product) ?? false),
      hasKey: present.length > 0,
      readerIssue: product === 'xtmone' ? null : readerAccess[product],
    }),
  }));
  return <XtmSurface kind={kind} sections={visibleSurfaceSections(sections, canManageSecurity)} />;
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
