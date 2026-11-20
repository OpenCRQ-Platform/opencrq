export type MemberRefusal = 'not-addable' | 'invitation-pending' | 'unavailable' | 'super-administrator';

/** A person picked in the drawer: from XTM One's directory (with their XTM One id), or a typed email. */
export interface PickedPerson {
  email: string,
  xtmUserId: string | null,
  fullName: string | null,
}

export interface DirectoryPerson {
  id: string,
  fullName: string,
  email: string,
  alreadyMember: boolean,
}

export interface DirectoryAnswer {
  people: Array<DirectoryPerson>,
  typedEmail: { email: string, alreadyMember: boolean } | null,
}

/** A person the drawer offers: found in XTM One's directory, or a typed email no one has, whom XTM One will invite. */
export interface PersonOption extends PickedPerson {
  alreadyMember: boolean,
}

const sameEmail = (first: string, second: string): boolean => first.toLowerCase() === second.toLowerCase();

export const samePerson = (first: PickedPerson, second: PickedPerson): boolean => sameEmail(first.email, second.email);

/** The people a search found, then the typed email when none of them has it. */
export const directoryOptions = (answer: DirectoryAnswer | undefined): Array<PersonOption> => {
  const found: Array<PersonOption> = (answer?.people ?? []).map((person) => ({
    email: person.email,
    xtmUserId: person.id,
    fullName: person.fullName || null,
    alreadyMember: person.alreadyMember,
  }));
  const typed = answer?.typedEmail;
  return typed ? [...found, { email: typed.email, xtmUserId: null, fullName: null, alreadyMember: typed.alreadyMember }] : found;
};

export interface MemberAddResult {
  email: string,
  added: boolean,
  emailSent: boolean,
  /** XTM One invited them, having no XTM One account: only their invitation leads them in. */
  invited: boolean,
  /** Their invitation's own link, or their join link, when XTM One could not email it. */
  invitationLink: string | null,
  refusal: MemberRefusal | null,
}

/**
 * What the drawer shows after "Add": the people added, how many people XTM One knows but could not
 * email (the access link is for them alone), the invitations XTM One could not email (each with its
 * own link, when XTM One gave it), and each refusal.
 */
export interface AddOutcome {
  addedCount: number,
  emailsSent: boolean,
  accessLinkCount: number,
  invitationsNotSent: Array<{ email: string, invitationLink: string | null }>,
  refusals: Array<{ email: string, refusal: MemberRefusal }>,
}

export const addOutcome = (results: Array<MemberAddResult>): AddOutcome => {
  const added = results.filter((result) => result.added);
  const notEmailed = added.filter((result) => !result.emailSent);
  return {
    addedCount: added.length,
    emailsSent: notEmailed.length === 0,
    accessLinkCount: notEmailed.filter((result) => !result.invited).length,
    invitationsNotSent: notEmailed.flatMap(({ email, invited, invitationLink }) => (invited ? [{ email, invitationLink }] : [])),
    refusals: results.flatMap(({ email, refusal, added: wasAdded }) => (!wasAdded && refusal !== null ? [{ email, refusal }] : [])),
  };
};

/** The people to keep picked after "Add": those not added, so they can be retried or removed. */
export const notAddedPicks = <T extends PickedPerson>(picked: Array<T>, results: Array<MemberAddResult>): Array<T> => (
  picked.filter((person) => results.some((result) => !result.added && sameEmail(result.email, person.email)))
);
