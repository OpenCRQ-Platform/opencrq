import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { Button } from '@filigran/design-system';
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
 * Cross-product awareness, the OpenCRQ side of the pattern OpenCTI and OpenAEV share, kept discreet:
 * an "Open in <product>" action in the hero (a mark on a list row) when a connected XTM product holds
 * the same object, its key facts in the hover and focus preview, and a "Connect" call to action in
 * the hero where the product is not connected. A connected product that does not hold the object
 * renders nothing, and a product the object came from is never queried: its source row is the pivot.
 * No overview card, no reserved slot. Same marks, wording and states in the three products.
 */

export type XtmProduct = 'opencti' | 'openaev';
export type CounterpartKind = 'ASSET' | 'ATTACK_PATTERN' | 'VULNERABILITY' | 'THREAT';
export type XtmCounterpart = RouterOutputs['xtm']['counterparts'][number];

// eslint-disable-next-line lingui/no-unlocalized-strings -- product names, never translated
const PRODUCT_NAMES: Record<XtmProduct, string> = { opencti: 'OpenCTI', openaev: 'OpenAEV' };
const PRODUCT_MARKS: Record<XtmProduct, string> = { opencti: '/img/icon-opencti.png', openaev: '/img/icon-openaev.png' };
const ALL_PRODUCTS: ReadonlyArray<XtmProduct> = ['opencti', 'openaev'];

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

/** The counterparts of one or several keys, one batched call per kind; empty while not connected. */
export const useCounterparts = (kind: CounterpartKind, keys: ReadonlyArray<string | null | undefined>) => {
  const trpc = useTRPC();
  const present = [...new Set(keys.filter((k): k is string => !!k))].sort();
  const { data } = useQuery(trpc.xtm.counterparts.queryOptions(
    { kind, keys: present },
    { enabled: present.length > 0, staleTime: 2 * 60 * 1000, retry: false },
  ));
  return data ?? [];
};

const ProductMark: FunctionComponent<{ product: XtmProduct, size?: number }> = ({ product, size }) => (
  <img src={PRODUCT_MARKS[product]} alt="" aria-hidden width={size ?? 16} height={size ?? 16} className="shrink-0" />
);

// eslint-disable-next-line lingui/no-unlocalized-strings -- Tailwind class list, not copy
const COMPACT_CLASS = 'h-9 w-9 justify-center p-0';

const FACT_LABELS = (): Record<string, string> => ({
  findings: t`Findings`,
  affected_assets: t`Affected assets`,
  simulations: t`Simulations`,
  last_simulation: t`Last simulation`,
  reports: t`Reports`,
});

const actionIn = (product: XtmProduct) => (product === 'opencti'
  ? t`See the reports, relationships and context of this object in OpenCTI.`
  : t`See the simulations and findings of this object in OpenAEV.`);

/**
 * What a pivot opens, shown on hover and keyboard focus: the product, the object's type and name in
 * it, the key facts it answered and what can be done there. The page itself carries only the mark.
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

interface XtmPivotButtonProps {
  product: XtmProduct,
  href: string,
  /** The object's name in the other product, added to the hint when known. */
  objectName?: string | null,
  /** The counterpart as answered: its preview replaces the plain hint. */
  counterpart?: XtmCounterpart,
  /** A crowded hero (below 1280 px): the product mark alone, 36x36, named by aria-label and the hint. */
  compact?: boolean,
}

/** Hero action: "Open in <product>" for one object, with its text or, compact, as an icon button. */
export const XtmPivotButton: FunctionComponent<XtmPivotButtonProps> = ({ product, href, objectName, counterpart, compact }) => {
  const label = openIn(product);
  let hint: ReactNode = objectName ? `${label}: ${objectName}` : label;
  if (counterpart) {
    hint = <XtmPivotPreview counterpart={counterpart} />;
  }
  return (
    <TooltipHintProvider>
      <TooltipHint hint={hint}>
        <Button asChild priority="secondary" className={compact ? COMPACT_CLASS : undefined}>
          <a href={href} target="_blank" rel="noreferrer noopener" aria-label={compact ? label : undefined}>
            <ProductMark product={product} />
            {compact ? null : label}
          </a>
        </Button>
      </TooltipHint>
    </TooltipHintProvider>
  );
};

/** Hero actions: "Open in <product>", one per connected product holding the object, its preview on hover and focus. */
export const XtmPivotButtons: FunctionComponent<{ counterparts: ReadonlyArray<XtmCounterpart>, compact?: boolean }> = ({ counterparts, compact }) => (
  <>
    {counterparts.map((c) => (
      <XtmPivotButton key={`${c.product}-${c.objectId}`} product={c.product} href={c.objectUrl} counterpart={c} compact={compact} />
    ))}
  </>
);

/** List row: the product mark, a link to the counterpart, nothing when none. */
export const XtmRowMarks: FunctionComponent<{ counterparts: ReadonlyArray<XtmCounterpart> }> = ({ counterparts }): ReactElement | null => {
  if (counterparts.length === 0) {
    return null;
  }
  return (
    <TooltipHintProvider>
      <span className="inline-flex items-center">
        {counterparts.map((c) => (
          <TooltipHint key={`${c.product}-${c.objectId}`} hint={<XtmPivotPreview counterpart={c} />}>
            {/* 24 px hit area around the 14 px mark. */}
            <a
              href={c.objectUrl}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={openIn(c.product)}
              className="inline-flex h-6 w-6 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 ring-focus"
              onClick={(e) => e.stopPropagation()}
            >
              <ProductMark product={c.product} size={14} />
            </a>
          </TooltipHint>
        ))}
      </span>
    </TooltipHintProvider>
  );
};

/**
 * The "Connect <product>" hero action: the connector settings link for a configurer; for a reader
 * who cannot configure, the same button disabled with a read-only hint (as OpenCTI and OpenAEV do).
 */
export const XtmConnectCta: FunctionComponent<{ product: XtmProduct, compact?: boolean }> = ({ product, compact }) => {
  const canConfigure = useHasManageSecurity();
  const name = productName(product);
  const label = t`Connect ${name}`;
  if (!canConfigure) {
    const hint = t`${name} is not connected. Ask an administrator to connect it to see this object there.`;
    return (
      // A disabled button fires no pointer event, so the hint hangs on a focusable wrapper.
      <TooltipHintProvider>
        <TooltipHint hint={hint}>
          <span tabIndex={0} className="inline-flex focus-visible:outline-none focus-visible:ring-2 ring-focus">
            <Button priority="secondary" disabled className={compact ? COMPACT_CLASS : undefined} aria-label={compact ? label : undefined}>
              <ProductMark product={product} />
              {compact ? null : label}
            </Button>
            <span className="sr-only">{hint}</span>
          </span>
        </TooltipHint>
      </TooltipHintProvider>
    );
  }
  const link = (
    <Button asChild priority="secondary" className={compact ? COMPACT_CLASS : undefined}>
      <Link
        from="/$tenantId/{-$organizationId}"
        to="/$tenantId/{-$organizationId}/integrations/connectors/$connectorSlug"
        params={{ connectorSlug: product }}
        aria-label={compact ? label : undefined}
      >
        <ProductMark product={product} />
        {compact ? null : label}
      </Link>
    </Button>
  );
  if (!compact) {
    return link;
  }
  return (
    <TooltipHintProvider>
      <TooltipHint hint={label}>{link}</TooltipHint>
    </TooltipHintProvider>
  );
};

/** Hero actions: one "Connect <product>" per product of the list that is not connected. */
export const XtmConnectActions: FunctionComponent<{ products?: ReadonlyArray<XtmProduct>, compact?: boolean }> = ({ products, compact }): ReactElement | null => {
  const { data: connections } = useXtmConnections();
  const missing = (products ?? ALL_PRODUCTS).filter((p) => connections?.find((c) => c.product === p)?.connected === false);
  if (missing.length === 0) {
    return null;
  }
  return <>{missing.map((p) => <XtmConnectCta key={p} product={p} compact={compact} />)}</>;
};

/** The XTM products an object came from: their source row already opens it there, so no pivot is drawn for them. */
export const xtmSourceProducts = (sources: ReadonlyArray<string | null | undefined>): Array<XtmProduct> => (
  ALL_PRODUCTS.filter((p) => sources.includes(p))
);

interface XtmCounterpartPivotsProps {
  kind: CounterpartKind,
  objectKey: string | null | undefined,
  /** Products never queried as a counterpart: the object's own sources, which carry the pivot themselves. */
  skip?: ReadonlyArray<XtmProduct>,
  compact?: boolean,
}

/**
 * Hero actions for one object: "Open in <product>" for each connected product that holds it, its
 * facts in the hover and focus preview. Nothing at all when a connected product does not hold it, while
 * a product is not connected (the connect call to action covers it), for an object with no shared key
 * or while the lookup loads or fails.
 */
export const XtmCounterpartPivots: FunctionComponent<XtmCounterpartPivotsProps> = ({ kind, objectKey, skip, compact }): ReactElement | null => {
  const { data: connections } = useXtmConnections();
  const counterparts = useCounterparts(kind, [objectKey]);
  const shown = counterparts.filter((c) => (
    !skip?.includes(c.product) && connections?.find((x) => x.product === c.product)?.connected === true
  ));
  if (!objectKey || shown.length === 0) {
    return null;
  }
  return <XtmPivotButtons counterparts={shown} compact={compact} />;
};
