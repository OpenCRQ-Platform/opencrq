/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import Markdown from 'react-markdown';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeMitreMarkdown, remarkMitreDescription, resolveMitreLink } from './mitre-description-utils';

afterEach(() => {
  cleanup();
});

describe('resolveMitreLink', () => {
  it('should resolve a technique, a sub-technique, a tactic and a mitigation to our own pages', () => {
    expect(resolveMitreLink('https://attack.mitre.org/techniques/T1557')).toEqual({ kind: 'technique', externalId: 'T1557' });
    expect(resolveMitreLink('https://attack.mitre.org/techniques/T1557/001')).toEqual({ kind: 'technique', externalId: 'T1557.001' });
    expect(resolveMitreLink('https://attack.mitre.org/tactics/TA0008/')).toEqual({ kind: 'tactic', externalId: 'TA0008' });
    expect(resolveMitreLink('https://attack.mitre.org/mitigations/M1041')).toEqual({ kind: 'mitigation', externalId: 'M1041' });
  });

  it('should keep any other address external', () => {
    expect(resolveMitreLink('https://attack.mitre.org/software/S0357')).toEqual({ kind: 'external', href: 'https://attack.mitre.org/software/S0357' });
    expect(resolveMitreLink('https://example.com/techniques/T1557')).toEqual({ kind: 'external', href: 'https://example.com/techniques/T1557' });
  });
});

describe('normalizeMitreMarkdown', () => {
  it('should turn <code> into a code span, decoding entities and keeping literal placeholders', () => {
    expect(normalizeMitreMarkdown('Run <code>chage -l <username></code> or <code>C:\\Users\\&lt;username&gt;</code>.'))
      .toBe('Run `chage -l <username>` or `C:\\Users\\<username>`.');
  });

  it('should fence a code span holding a backtick with a longer run', () => {
    expect(normalizeMitreMarkdown('<code>echo `id`</code>')).toBe('`` echo `id` ``');
  });

  it('should turn <b> into strong text and <br> into a hard break', () => {
    expect(normalizeMitreMarkdown('A <b>Direct</b> case:<br>\nnext')).toBe('A **Direct** case:\\\nnext');
  });
});

const renderDescription = (text: string) => render(
  <Markdown remarkPlugins={[remarkMitreDescription]}>{normalizeMitreMarkdown(text)}</Markdown>,
);

describe('remarkMitreDescription', () => {
  it('should number citations by first appearance and name their source', () => {
    const { container } = renderDescription('Mirroring.(Citation: AWS)(Citation: GCP) Cleartext.(Citation: AWS)');

    const citations = [...container.querySelectorAll('sup')].map((sup) => [sup.textContent, sup.getAttribute('title')]);
    expect(citations).toEqual([['[1]', 'AWS'], ['[2]', 'GCP'], ['[1]', 'AWS']]);
    expect(container.textContent).toBe('Mirroring.[1][2] Cleartext.[1]');
  });

  it('should keep a raw placeholder outside code as text', () => {
    const { container } = renderDescription('Log in as <username> on the host.');

    expect(container.textContent).toBe('Log in as <username> on the host.');
  });

  it('should keep paragraphs and list items apart', () => {
    const { container } = renderDescription('First paragraph.\n\nFor example:\n\n* <code>sekurlsa::Minidump</code>\n* Second');

    expect(container.querySelectorAll('p')).toHaveLength(2);
    expect([...container.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['sekurlsa::Minidump', 'Second']);
    expect(container.querySelector('li code')?.textContent).toBe('sekurlsa::Minidump');
  });
});
