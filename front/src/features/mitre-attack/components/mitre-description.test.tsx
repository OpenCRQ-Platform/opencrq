/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MitreDescription } from './mitre-description';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ params, children }: { params: (previous: Record<string, string>) => Record<string, string>, children: ReactNode }) => (
    <a data-internal-technique={params({}).techniqueExternalId}>{children}</a>
  ),
}));

afterEach(() => {
  cleanup();
});

// The descriptions below are MITRE's own text, exactly as the Default Threats dataset carries them.
const CAMPAIGN_WITH_TECHNIQUE_LINK = 'The [Salesforce Data Exfiltration](https://attack.mitre.org/campaigns/C0059) campaign began in October 2024 with financially-motivated threat actor UNC6040 using [Spearphishing Voice](https://attack.mitre.org/techniques/T1598/004) (vishing) to compromise corporate Salesforce instances for large-scale data theft and extortion. Following the initial data theft, victim organizations received extortion demands from a separate threat actor, UNC6240, who claimed to be the “ShinyHunters” group. The observed infrastructure and TTPs used during the [Salesforce Data Exfiltration](https://attack.mitre.org/campaigns/C0059) campaign overlap with those used by threat groups with suspected ties to the broader collective known as "The Com.” These overlaps could plausibly be the result of associated actors operating within the same communities and are not necessarily an indication of a direct operational relationship.(Citation: FBI Salesforce Data Theft SEP 2025)(Citation: Google Salesforce JUN 2025)';

const GROUP_WITH_TWO_PARAGRAPHS = '[Moses Staff](https://attack.mitre.org/groups/G1009) is a suspected Iranian threat group that has primarily targeted Israeli companies since at least September 2021. [Moses Staff](https://attack.mitre.org/groups/G1009) openly stated their motivation in attacking Israeli companies is to cause damage by leaking stolen sensitive data and encrypting the victim\'s networks without a ransom demand.(Citation: Checkpoint MosesStaff Nov 2021) \n\nSecurity researchers assess [Moses Staff](https://attack.mitre.org/groups/G1009) is politically motivated, and has targeted government, finance, travel, energy, manufacturing, and utility companies outside of Israel as well, including those in Italy, India, Germany, Chile, Turkey, the UAE, and the US.(Citation: Cybereason StrifeWater Feb 2022)';

const CAMPAIGN_WITH_CODE_TAGS = ' Quad7 Activity, also known as CovertNetwork-1658 or the 7777 Botnet, is a network of compromised small office/home office (SOHO) routers. (Citation: Bitsight 7777 Botnet) (Citation: Microsoft Storm-0940) The botnet was initially composed primarily of TP-Link routers and was named Quad7 due to compromised devices exposing TCP port 7777 with the distinctive banner <code>xlogin</code>. Later activity showed a significant increase in compromised Asus routers and the addition of new ports and banners, including TCP port 63256 displaying <code>alogin</code>. Quad7 infrastructure functions as a collection of egress IPs that various China-affiliated threat actors have used to conduct password-spraying and brute-force operations. (Citation: Bitsight 7777 Botnet)(Citation: Medium 777-Botnet) Microsoft has reported that Storm-0940 leveraged credentials obtained through Quad7 Activity to target organizations in North America and Europe, including government agencies, non-governmental organizations, think tanks, law firms, energy firms, IT providers, and defense industrial base entities. (Citation: Microsoft Storm-0940)';

const MARKUP_LEFT_AS_TEXT = ['](', '(Citation:', '<code>', '</code>'];

describe('MitreDescription on the dataset\'s descriptions', () => {
  it('should draw a markdown link as a link, an external one opening in a new tab and a technique one to our own page', () => {
    const { container } = render(<MitreDescription text={CAMPAIGN_WITH_TECHNIQUE_LINK} />);

    const external = [...container.querySelectorAll('a[href]')];
    expect(external.map((anchor) => [anchor.textContent, anchor.getAttribute('href')])).toEqual([
      ['Salesforce Data Exfiltration', 'https://attack.mitre.org/campaigns/C0059'],
      ['Salesforce Data Exfiltration', 'https://attack.mitre.org/campaigns/C0059'],
    ]);
    expect(external.every((anchor) => anchor.getAttribute('target') === '_blank' && anchor.getAttribute('rel')?.includes('noopener'))).toBe(true);
    const internal = container.querySelector('a[data-internal-technique]');
    expect(internal?.getAttribute('data-internal-technique')).toBe('T1598.004');
    expect(internal?.textContent).toBe('Spearphishing Voice');
  });

  it('should draw a citation as a numbered superscript naming its source, and leave no marker in the text', () => {
    const { container } = render(<MitreDescription text={CAMPAIGN_WITH_TECHNIQUE_LINK} />);

    expect([...container.querySelectorAll('sup')].map((sup) => [sup.textContent, sup.getAttribute('title')])).toEqual([
      ['[1]', 'FBI Salesforce Data Theft SEP 2025'],
      ['[2]', 'Google Salesforce JUN 2025'],
    ]);
    for (const marker of MARKUP_LEFT_AS_TEXT) {
      expect(container.textContent).not.toContain(marker);
    }
  });

  it('should keep two paragraphs apart', () => {
    const { container } = render(<MitreDescription text={GROUP_WITH_TWO_PARAGRAPHS} />);

    expect(container.querySelectorAll('p')).toHaveLength(2);
    expect(container.querySelectorAll('a[href]')).toHaveLength(3);
  });

  it('should draw a <code> tag as code, and number a source once however often it is cited', () => {
    const { container } = render(<MitreDescription text={CAMPAIGN_WITH_CODE_TAGS} />);

    expect([...container.querySelectorAll('code')].map((code) => code.textContent)).toEqual(['xlogin', 'alogin']);
    expect([...container.querySelectorAll('sup')].map((sup) => sup.textContent)).toEqual(['[1]', '[2]', '[1]', '[3]', '[2]']);
    for (const marker of MARKUP_LEFT_AS_TEXT) {
      expect(container.textContent).not.toContain(marker);
    }
  });
});
