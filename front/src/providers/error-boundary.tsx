import { Button } from '@filigran/design-system';
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { t } from '@lingui/core/macro';
import { ErrorPage } from '../components';
import { clientReportQueue } from '../stores';

interface ErrorBoundaryProps {
  children: ReactNode,
}

interface ErrorBoundaryState {
  error: Error | null,
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    clientReportQueue.reportClientError(error, 'render', errorInfo.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <ErrorPage>
          <h1 className="mb-m">{t`Something went wrong`}</h1>
          <p>{t`A critical error occurred. Please reload the page.`}</p>
          <Button priority="secondary" className="mt-l" onClick={() => window.location.reload()}>
            {t`Reload`}
          </Button>
        </ErrorPage>
      );
    }

    return this.props.children;
  }
}
