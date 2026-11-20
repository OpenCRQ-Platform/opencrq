import { useId, useLayoutEffect, useRef, useState } from 'react';
import { t } from '@lingui/core/macro';

interface ExpandableTextProps {
  text: string,
  className?: string,
  lineClamp?: number,
}

export const ExpandableText = ({ text, className: classNameProp, lineClamp: lineClampProp }: ExpandableTextProps) => {
  const className = classNameProp ?? '';
  const lineClamp = lineClampProp ?? 2;
  const [isExpanded, setIsExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const textId = useId();

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) {
      return;
    }

    const checkOverflow = () => {
      if (!isExpanded) {
        const isTruncated = el.scrollHeight > el.clientHeight;
        setCanExpand(isTruncated);
      }
    };

    checkOverflow();
    const observer = new ResizeObserver(checkOverflow);
    observer.observe(el);

    return () => observer.disconnect();
  }, [text, isExpanded]);

  return (
    <div className="w-full txt-default">
      <div
        id={textId}
        ref={textRef}
        className={`${className}`}
        style={{
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: isExpanded ? 'unset' : lineClamp,
          overflow: 'hidden',
        }}
      >
        {text}
      </div>
      {canExpand && (
        <div className="flex justify-end mt-1">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            aria-expanded={isExpanded}
            aria-controls={textId}
            className="txt-sub-content text-foreground hover:underline"
          >
            {isExpanded ? t`Read less` : t`Read more`}
          </button>
        </div>
      )}
    </div>
  );
};
