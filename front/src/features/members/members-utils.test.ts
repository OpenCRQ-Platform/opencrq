import { describe, expect, it } from 'vitest';
import type { DirectoryAnswer, MemberAddResult, PickedPerson } from './members-utils';
import { addOutcome, directoryOptions, notAddedPicks, samePerson } from './members-utils';

const jane: PickedPerson = { email: 'jane.martin@acme.com', xtmUserId: 'u-jane', fullName: 'Jane Martin' };
const answer: DirectoryAnswer = {
  people: [
    { id: 'u-jane', fullName: 'Jane Martin', email: 'jane.martin@acme.com', alreadyMember: false },
    { id: 'u-jean', fullName: 'Jean Bernard', email: 'jean.bernard@acme.com', alreadyMember: true },
  ],
  typedEmail: null,
};

describe('directoryOptions', () => {
  it('offers the people found by their XTM One id, the members among them marked', () => {
    expect(directoryOptions(answer)).toEqual([
      { ...jane, alreadyMember: false },
      { email: 'jean.bernard@acme.com', xtmUserId: 'u-jean', fullName: 'Jean Bernard', alreadyMember: true },
    ]);
  });

  it('offers a typed email no one found last, with no XTM One id, as someone XTM One will invite', () => {
    const options = directoryOptions({ people: answer.people, typedEmail: { email: 'paul@acme.com', alreadyMember: false } });

    expect(options.at(-1)).toEqual({ email: 'paul@acme.com', xtmUserId: null, fullName: null, alreadyMember: false });
  });

  it('marks the typed email of a member, such as the caller\'s own, as already a member', () => {
    const [option] = directoryOptions({ people: [], typedEmail: { email: 'claire@acme.com', alreadyMember: true } });

    expect(option.alreadyMember).toBe(true);
  });

  it('offers no one before a search answered', () => {
    expect(directoryOptions(undefined)).toEqual([]);
  });
});

describe('samePerson', () => {
  it('matches a person whatever the case of their email', () => {
    expect(samePerson(jane, { ...jane, email: 'JANE.MARTIN@acme.com' })).toBe(true);
    expect(samePerson(jane, { ...jane, email: 'jean.bernard@acme.com' })).toBe(false);
  });
});

describe('addOutcome', () => {
  const result = (email: string, fields: Partial<MemberAddResult> = {}): MemberAddResult => ({
    email, added: true, emailSent: true, invited: false, invitationLink: null, refusal: null, ...fields,
  });

  it('counts the people added, all their emails sent', () => {
    expect(addOutcome([result('a@acme.com'), result('b@acme.com', { invited: true })]))
      .toEqual({ addedCount: 2, emailsSent: true, accessLinkCount: 0, invitationsNotSent: [], refusals: [] });
  });

  it('asks for the access link as soon as a person XTM One knows was not emailed', () => {
    expect(addOutcome([result('a@acme.com'), result('b@acme.com', { emailSent: false })])).toMatchObject({
      emailsSent: false, accessLinkCount: 1, invitationsNotSent: [],
    });
  });

  it('gives each invitation XTM One could not email its own link, never the access link', () => {
    const link = 'https://xtm-one.example.com/register?invitation=abc';

    expect(addOutcome([
      result('jane@acme.com', { emailSent: false, invited: true, invitationLink: link }),
      result('anna@acme.com', { emailSent: false, invited: true }),
      result('paul@acme.com', { invited: true }),
    ])).toMatchObject({
      emailsSent: false,
      accessLinkCount: 0,
      invitationsNotSent: [{ email: 'jane@acme.com', invitationLink: link }, { email: 'anna@acme.com', invitationLink: null }],
    });
  });

  it('counts for the access link only the people XTM One knows, the invitations not emailed apart', () => {
    const link = 'https://xtm-one.example.com/register?invitation=abc';

    expect(addOutcome([
      result('marc@acme.com', { emailSent: false }),
      result('paul@acme.com', { emailSent: false }),
      result('jane@acme.com', { emailSent: false, invited: true, invitationLink: link }),
    ])).toMatchObject({
      emailsSent: false,
      accessLinkCount: 2,
      invitationsNotSent: [{ email: 'jane@acme.com', invitationLink: link }],
    });
  });

  it('reports each person not added, the others added still', () => {
    expect(addOutcome([
      result('a@acme.com'),
      result('jane@acme.com', { added: false, emailSent: false, refusal: 'not-addable' }),
    ])).toMatchObject({ addedCount: 1, emailsSent: true, refusals: [{ email: 'jane@acme.com', refusal: 'not-addable' }] });
  });

  it('reports an invitation already pending in XTM One as a refusal of its own', () => {
    expect(addOutcome([result('jane@acme.com', { added: false, emailSent: false, refusal: 'invitation-pending' })])).toEqual({
      addedCount: 0, emailsSent: true, accessLinkCount: 0, invitationsNotSent: [], refusals: [{ email: 'jane@acme.com', refusal: 'invitation-pending' }],
    });
  });

  it('adds no one when every person was refused', () => {
    expect(addOutcome([result('jane@acme.com', { added: false, emailSent: false, refusal: 'unavailable' })]).addedCount).toBe(0);
  });
});

describe('notAddedPicks', () => {
  it('keeps picked the people not added only', () => {
    const typed: PickedPerson = { email: 'jane@acme.com', xtmUserId: null, fullName: null };

    expect(notAddedPicks([jane, typed], [
      { email: 'jane.martin@acme.com', added: true, emailSent: true, invited: false, invitationLink: null, refusal: null },
      { email: 'jane@acme.com', added: false, emailSent: false, invited: false, invitationLink: null, refusal: 'not-addable' },
    ])).toEqual([typed]);
  });
});
