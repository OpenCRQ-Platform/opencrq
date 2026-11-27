/** What OpenCRQ asks XTM One for each person added: tell them where to sign in, or invite them. */
export interface AccessNoticeRequest {
  email: string,
  /** A path on this platform, which the email links to. */
  path: string,
  /** The place opened to them, as the email names it: a tenant, or the platform groups. */
  scopeName: string,
}

/**
 * XTM One's answer: `invited` carries the registration link of an invitation XTM One could not
 * email, which leads to the `path` once the person has registered (null when the email went out, or
 * from an XTM One that does not give it). `refused` for a 403 (the acting user may not invite),
 * `not-found` for a 404 (an unknown email to an XTM One without invitations, or a deactivated
 * account), `invitation-pending` for a 409 (an invitation XTM One holds for that email and no
 * platform made, which it leaves untouched), `not-sent` for anything that never reached an answer
 * (a rate limit, an outage).
 */
export type AccessNoticeAnswer =
  | { outcome: 'notified', xtmUserId: string, emailSent: boolean }
  | { outcome: 'invited', emailSent: boolean, link: string | null }
  | { outcome: 'refused' }
  | { outcome: 'not-found' }
  | { outcome: 'invitation-pending' }
  | { outcome: 'not-sent' };

export type SendAccessNotice = (request: AccessNoticeRequest) => Promise<AccessNoticeAnswer>;

export interface MemberToAdd {
  email: string,
  /** The XTM One id of a person picked from the directory, which finds their account; a hint only, never written as theirs. */
  xtmUserId?: string | null,
  fullName?: string | null,
}

/**
 * Why a person was not added: they cannot be added here (XTM One refused to invite them, or their
 * email belongs to an OpenCRQ account tied to another XTM One user, one code for both so the answer
 * never tells that such an account exists), an invitation no platform made is already pending for
 * them in XTM One, XTM One could not be asked, or they are a super administrator, who holds every
 * right already.
 */
export type MemberRefusal = 'not-addable' | 'invitation-pending' | 'unavailable' | 'super-administrator';

export interface MemberAddResult {
  email: string,
  added: boolean,
  emailSent: boolean,
  /** XTM One invited them, having no XTM One account: they sign in once they created it. */
  invited: boolean,
  /** The invitation's own link, for the administrator to send when XTM One could not email it. */
  invitationLink: string | null,
  refusal: MemberRefusal | null,
}
