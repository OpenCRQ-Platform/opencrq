import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { Button, Paper, Text } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import { Link } from '@tanstack/react-router';
import { ExternalLink } from 'lucide-react';
import type { FunctionComponent, ReactElement } from 'react';
import { TooltipHint, TooltipHintProvider } from '../../components/shared/tooltip-hint';
import { useHasManageSecurity } from '../../hooks/utils/use-has-manage-security';
import { useTRPC } from '../../lib';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;

/**
 * Cross-product awareness, the OpenCRQ side of the pattern OpenCTI and OpenAEV share: a pivot to
 * the same object in a connected XTM product, its key facts on an overview card, and a "Connect"
 * call to action in the hero where the product is not connected. Same marks, wording and placement
 * in the three products: no card while a product is not connected, the call to action in the hero.
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

interface XtmPivotButtonProps {
  product: XtmProduct,
  href: string,
  /** The object's name in the other product, added to the hint when known. */
  objectName?: string | null,
  /** A crowded hero (below 1280 px): the product mark alone, 36x36, named by aria-label and the hint. */
  compact?: boolean,
}

/** Hero action: "Open in <product>" for one object, with its text or, compact, as an icon button. */
export const XtmPivotButton: FunctionComponent<XtmPivotButtonProps> = ({ product, href, objectName, compact }) => {
  const label = openIn(product);
  return (
    <TooltipHintProvider>
      <TooltipHint hint={objectName ? `${label}: ${objectName}` : label}>
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

/** Hero actions: "Open in <product>", one per connected product holding the object. */
export const XtmPivotButtons: FunctionComponent<{ counterparts: ReadonlyArray<XtmCounterpart>, compact?: boolean }> = ({ counterparts, compact }) => (
  <>
    {counterparts.map((c) => (
      <XtmPivotButton key={`${c.product}-${c.objectId}`} product={c.product} href={c.objectUrl} objectName={c.objectName} compact={compact} />
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
          <TooltipHint key={`${c.product}-${c.objectId}`} hint={openIn(c.product)}>
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

const FACT_LABELS = (): Record<string, string> => ({
  findings: t`Findings`,
  affected_assets: t`Affected assets`,
  simulations: t`Simulations`,
  last_simulation: t`Last simulation`,
});

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

interface XtmCounterpartCardProps {
  product: XtmProduct,
  kind: CounterpartKind,
  objectKey: string | null | undefined,
}

/** Hero actions: one "Connect <product>" per product of the list that is not connected. */
export const XtmConnectActions: FunctionComponent<{ products?: ReadonlyArray<XtmProduct>, compact?: boolean }> = ({ products, compact }): ReactElement | null => {
  const { data: connections } = useXtmConnections();
  const missing = (products ?? ALL_PRODUCTS).filter((p) => connections?.find((c) => c.product === p)?.connected === false);
  if (missing.length === 0) {
    return null;
  }
  return <>{missing.map((p) => <XtmConnectCta key={p} product={p} compact={compact} />)}</>;
};

/**
 * Overview card "In <product>": the counterpart with its key facts, or "Not found in <product>" when
 * the connected product does not hold it. Renders nothing while the product is not connected (the
 * hero carries the connect call to action), for an object with no key the products share, or while
 * the connections load.
 */
export const XtmCounterpartCard: FunctionComponent<XtmCounterpartCardProps> = ({ product, kind, objectKey }): ReactElement | null => {
  const { data: connections } = useXtmConnections();
  const counterparts = useCounterparts(kind, [objectKey]);
  const connection = connections?.find((c) => c.product === product);
  if (!objectKey || !connection?.connected) {
    return null;
  }
  const name = productName(product);
  const match = counterparts.find((c) => c.product === product);
  const labels = FACT_LABELS();
  return (
    <Paper padding={16} className="flex flex-col gap-2">
      <span className="flex items-center gap-2">
        <ProductMark product={product} />
        <Text as="h3" variant="content-base-bold" className="m-0">{t`In ${name}`}</Text>
      </span>
      {!match && (
        <Text as="p" variant="content-compact" className="m-0 text-default-secondary">
          <Trans>Not found in {name}.</Trans>
        </Text>
      )}
      {match && (
        <>
          <a href={match.objectUrl} target="_blank" rel="noreferrer noopener" className="flex items-center gap-1.5 text-primary underline-offset-4 hover:underline">
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            {match.objectName ?? match.key}
          </a>
          {match.facts.length > 0 && (
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              {match.facts.map((f) => (
                <div key={f.key} className="contents">
                  <dt><Text as="span" variant="content-compact" className="text-default-secondary">{labels[f.key] ?? f.key}</Text></dt>
                  <dd className="m-0"><Text as="span" variant="content-compact">{f.value}</Text></dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
    </Paper>
  );
};

/** The cards of the connected products, for an object both other products may hold; nothing when none is connected. */
export const XtmCounterpartCards: FunctionComponent<{ kind: CounterpartKind, objectKey: string | null | undefined, products?: ReadonlyArray<XtmProduct> }> = ({ kind, objectKey, products }): ReactElement | null => {
  const { data: connections } = useXtmConnections();
  const connected = (products ?? ALL_PRODUCTS).filter((p) => connections?.find((c) => c.product === p)?.connected === true);
  if (!objectKey || connected.length === 0) {
    return null;
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {connected.map((p) => <XtmCounterpartCard key={p} product={p} kind={kind} objectKey={objectKey} />)}
    </div>
  );
};
