import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import {
  DrawerFormActions,
  DrawerFormBody,
  DrawerFormColumn,
  FormDrawer,
  isDeliberateSubmit,
  useFormDrawerContext,
  useFormDrawerDirtyState,
} from '../../../components/shared';
import { Loader } from '../../../components/ui/loader';
import { useTRPC } from '../../../lib';
import { DeclaredEstateQuestionnaire, useDeclaredEstateForm } from '../../declared-estate';

const DeclaredEstateBody: FunctionComponent<{ organizationId: string }> = ({ organizationId }) => {
  const trpc = useTRPC();
  const { closeDrawer } = useFormDrawerContext();
  const estate = useDeclaredEstateForm(organizationId);
  const { data: comparison } = useQuery(trpc.declaredEstate.comparison.queryOptions({ organizationId }));
  useFormDrawerDirtyState(estate.isDirty);

  // The drafts start empty and take the stored rows only when they land: a save before then
  // would not know what the reader changed.
  if (estate.isLoading) {
    return <Loader />;
  }

  return (
    <DrawerFormColumn
      onSubmit={(event) => {
        event.preventDefault();
        if (!isDeliberateSubmit(event.nativeEvent.submitter) || estate.hasErrors) {
          return;
        }
        // The write raises its own error toast; catching here only keeps the rejection handled.
        void estate.save().then(closeDrawer).catch(() => undefined);
      }}
    >
      <DrawerFormBody>
        <DeclaredEstateQuestionnaire
          drafts={estate.drafts}
          onChange={estate.setDraft}
          measured={comparison === undefined ? undefined : new Map(comparison.kinds.map((entry) => [entry.kind, entry.measured]))}
        />
      </DrawerFormBody>
      <DrawerFormActions isPending={estate.isSaving} disabled={!estate.isDirty || estate.hasErrors} submitLabel={t`Save`} />
    </DrawerFormColumn>
  );
};

interface DeclaredEstateSourceDrawerProps {
  organizationId: string,
  open: boolean,
  onClose: () => void,
}

/** The scope's declared estate, saved the way the scope drawer's Declared estate tab saves it. */
export const DeclaredEstateSourceDrawer: FunctionComponent<DeclaredEstateSourceDrawerProps> = ({ organizationId, open, onClose }) => (
  <FormDrawer
    open={open}
    onClose={onClose}
    title={t`Declared estate`}
    // The design system's lg drawer width, capped to the viewport as its Drawer is; through the minimum width, since fds.css ships the legacy drawer's w-[30vw] unlayered.
    className="min-w-[min(var(--fds-width-overlay-lg),calc(100vw-var(--fds-spacing)*8))]"
  >
    {open && <DeclaredEstateBody organizationId={organizationId} />}
  </FormDrawer>
);
