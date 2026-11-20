import type { FunctionComponent, ReactNode } from 'react';
import { Suspense } from 'react';
import { Loader } from '../ui/loader';
import { FormDrawer } from './form-drawer';

interface EditEntityDrawerProps {
  title: string,
  entityName: string,
  onClose?: () => void,
  children: ReactNode,
}

export const EditEntityDrawer: FunctionComponent<EditEntityDrawerProps> = ({
  title,
  entityName,
  onClose,
  children,
}) => (
  <FormDrawer title={title} open onClose={onClose}>
    {entityName && (
      <Suspense fallback={<Loader />}>
        {children}
      </Suspense>
    )}
  </FormDrawer>
);
