import { IconButton } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import type { ProofClaim } from './claim-item';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { useOpenCtiBaseUrl } from '../../../hooks';
import { buildOpenCtiObjectLink } from '../../supporting-assets/connectors-utils';
import { ClaimItem } from './claim-item';
import { CLAIM_PAGE_SIZES, resolveClaimPage } from './relevance-proof-utils';

interface ClaimListProps<T extends ProofClaim> {
  claims: Array<T>,
  renderStatement: (claim: T) => ReactNode,
  /** Rendered directly under every claim's statement, e.g. the technique's full name. */
  caption?: ReactNode,
  unstatedConfidence: number,
  pageSize: number,
  onPageSizeChange: (pageSize: number) => void,
  /** Feeds the panel's single shared `aria-live` region rather than announcing from this list itself. */
  onAnnounce: (message: string) => void,
}

const claimRangeMessage = (from: number, to: number, total: number): string => t`Claims ${from} to ${to} of ${total}`;

export const ClaimList = <T extends ProofClaim>({
  claims,
  renderStatement,
  caption,
  unstatedConfidence,
  pageSize,
  onPageSizeChange,
  onAnnounce,
}: ClaimListProps<T>): ReactElement => {
  const openctiUrl = useOpenCtiBaseUrl();
  const [requestedPageIndex, setRequestedPageIndex] = useState(0);
  const page = resolveClaimPage(claims.length, pageSize, requestedPageIndex);
  const visible = claims.slice(page.pageIndex * pageSize, page.pageIndex * pageSize + pageSize);
  const isFirstPage = page.pageIndex === 0;
  const isLastPage = page.pageIndex >= page.pageCount - 1;
  const { from, to, total } = page;

  // Announced from the gesture, never from an effect: every list in the panel mounts at once,
  // collapsed sections included, and they all share one live region and one page size.
  const announcePage = (nextPageSize: number, nextPageIndex: number) => {
    const nextPage = resolveClaimPage(claims.length, nextPageSize, nextPageIndex);
    onAnnounce(claimRangeMessage(nextPage.from, nextPage.to, nextPage.total));
  };

  const goToPage = (nextPageIndex: number) => {
    setRequestedPageIndex(nextPageIndex);
    announcePage(pageSize, nextPageIndex);
  };

  const changePageSize = (nextPageSize: number) => {
    onPageSizeChange(nextPageSize);
    announcePage(nextPageSize, page.pageIndex);
  };

  if (total === 0) {
    return (
      <p className="txt-body2 text-muted-foreground">
        <Trans>No claim was read here.</Trans>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-m">
      <ul className="flex flex-col gap-m">
        {visible.map((claim) => (
          <ClaimItem
            key={claim.stixRelationId}
            claim={claim}
            statement={renderStatement(claim)}
            caption={caption}
            unstatedConfidence={unstatedConfidence}
            href={buildOpenCtiObjectLink(openctiUrl, claim.openctiStixRelationId)}
          />
        ))}
      </ul>
      {page.hasControl && (
        <div className="flex flex-wrap items-center gap-s">
          {/* `aria-disabled` rather than `disabled`: moving focus onto a disabled element is how a
              keyboard reader gets stranded inside a dialog. */}
          <IconButton
            priority="tertiary"
            aria-disabled={isFirstPage}
            aria-label={t`Previous claims`}
            icon={<ChevronLeft className="size-4" />}
            onClick={() => !isFirstPage && goToPage(page.pageIndex - 1)}
          />
          <IconButton
            priority="tertiary"
            aria-disabled={isLastPage}
            aria-label={t`Next claims`}
            icon={<ChevronRight className="size-4" />}
            onClick={() => !isLastPage && goToPage(page.pageIndex + 1)}
          />
          <span className="txt-body2 text-muted-foreground">
            <Trans>Claims {from} to {to} of {total}</Trans>
          </span>
          <Select value={String(pageSize)} onValueChange={(value) => changePageSize(Number(value))}>
            <SelectTrigger aria-label={t`Claims per page`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLAIM_PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>{size}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
};
