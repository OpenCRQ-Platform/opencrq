/**
 * Whether a submit event asked to save. The component library's buttons carry no `type`, which
 * inside a form means `submit`, so a table's paginator sitting in a drawer would save and close it
 * on a page change. A submission with no submitter is the Enter key, which does mean to save.
 */
export const isDeliberateSubmit = (submitter: Element | null): boolean =>
  submitter === null || submitter.getAttribute('type') === 'submit';
