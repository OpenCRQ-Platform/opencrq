import {
  Alert,
  Button,
  Chip,
  Combobox,
  ComboboxChips,
  ComboboxClear,
  ComboboxControls,
  ComboboxField,
  ComboboxInput,
  ComboboxLabel,
  ComboboxTrigger,
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTrigger,
  Input,
  Text,
} from '@filigran/design-system';
import { i18n } from '@lingui/core';
import { plural, t } from '@lingui/core/macro';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import type { FunctionComponent, ReactElement } from 'react';
import { useState } from 'react';
import { useDebounce } from 'use-debounce';
import type { AddOutcome, MemberAddResult, MemberRefusal, PersonOption } from '../members-utils';
import { ComboboxPanel, MultiSelectField } from '../../../components/shared';
import { useCopyToClipboard } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { cn } from '../../../utils';
import { addOutcome, directoryOptions, notAddedPicks, samePerson } from '../members-utils';

/** A tenant's members and groups, or the platform's groups: one drawer, the group field changing with the scope. */
export type MembersScope = 'tenant' | 'platform';

const DIRECTORY_QUERY_MIN_LENGTH = 2;
const DIRECTORY_SEARCH_DELAY_MS = 300;

interface AddResponse {
  scopeName: string,
  accessLink: string,
  results: Array<MemberAddResult>,
}

const refusalDescription = (refusal: MemberRefusal): string => {
  switch (refusal) {
    case 'not-addable':
      return t`This email cannot be added here. Check it, or, if they have no XTM One account yet, ask an XTM One administrator to invite them.`;
    case 'invitation-pending':
      return t`An XTM One invitation is already pending for this email. Add them here once they have created their XTM One account.`;
    case 'unavailable':
      return t`XTM One could not be reached. Try again in a few minutes.`;
    case 'super-administrator':
      return t`They are an XTM One super administrator, who already reaches every tenant and the platform administration.`;
  }
};

const Refusals: FunctionComponent<{ refusals: AddOutcome['refusals'] }> = ({ refusals }) => (
  <>
    {refusals.map(({ email, refusal }) => (
      <Alert
        key={email}
        severity="error"
        elevation={1}
        title={i18n._({ id: '{email} was not added', message: '{email} was not added', values: { email } })}
        description={refusalDescription(refusal)}
      />
    ))}
  </>
);

/** A person's row in the list; the Combobox draws the row itself, its checkbox and its state. */
const PersonRow: FunctionComponent<{ person: PersonOption }> = ({ person }) => {
  const label = person.fullName ?? person.email;
  const { alreadyMember } = person;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="flex min-w-0 flex-1 flex-col">
        <Text as="span" variant="content-base-bold" className="truncate">{label}</Text>
        <Text as="span" variant="content-caption" className={cn('truncate', !alreadyMember && 'text-default-secondary')}>
          {person.xtmUserId === null && !alreadyMember ? t`No XTM One account yet: XTM One will invite them` : person.email}
        </Text>
      </span>
      {alreadyMember && <Chip label={t`Already a member`} disabled />}
    </span>
  );
};

const CopyableLink: FunctionComponent<{ label: string, copyLabel: string, link: string }> = ({ label, copyLabel, link }) => {
  const { copied, copy } = useCopyToClipboard();
  return (
    <>
      <Input label={label} value={link} readOnly />
      <div>
        <Button
          priority="secondary"
          startIcon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          onClick={() => void copy(link)}
        >
          {copied ? t`Copied` : copyLabel}
        </Button>
      </div>
    </>
  );
};

/** An invitation XTM One could not email: its own link to send, or, from an XTM One that gives none, the fact alone. */
const InvitationNotSent: FunctionComponent<{ email: string, invitationLink: string | null }> = ({ email, invitationLink }) => (
  <div className="flex flex-col gap-4">
    <Alert
      severity="warning"
      elevation={1}
      title={i18n._({ id: 'XTM One could not email the invitation to {email}', message: 'XTM One could not email the invitation to {email}', values: { email } })}
      description={invitationLink
        ? t`Send them this invitation link instead: it lets them create their XTM One account, then opens OpenCRQ.`
        : t`Add them again later to have XTM One send a new invitation.`}
    />
    {invitationLink && <CopyableLink label={t`Invitation link`} copyLabel={t`Copy the invitation link`} link={invitationLink} />}
  </div>
);

const AddedSummary: FunctionComponent<{ scope: MembersScope, response: AddResponse, outcome: AddOutcome }> = ({ scope, response, outcome }) => {
  const { scopeName, accessLink } = response;
  const { addedCount, accessLinkCount } = outcome;
  // A tenant has groups of the same names ("Admin"), so the platform administration is named around them.
  const title = scope === 'tenant'
    ? plural(addedCount, {
      one: `# member was added to ${scopeName}`,
      other: `# members were added to ${scopeName}`,
    })
    : plural(addedCount, {
      one: `# member was added to the platform administration (${scopeName})`,
      other: `# members were added to the platform administration (${scopeName})`,
    });
  const accessLinkDescription = plural(accessLinkCount, {
    one: 'XTM One could not email # person who already has an XTM One account. Send them this link instead.',
    other: 'XTM One could not email # people who already have an XTM One account. Send them this link instead.',
  });
  return (
    <div className="flex flex-col gap-4">
      {accessLinkCount > 0 ? (
        <>
          <Alert severity="success" elevation={1} title={title} description={accessLinkDescription} />
          <CopyableLink label={t`Access link`} copyLabel={t`Copy the access link`} link={accessLink} />
        </>
      ) : (
        <Alert severity="success" elevation={1} title={title} description={outcome.emailsSent ? t`Each of them will get an email to sign in.` : undefined} />
      )}
      {outcome.invitationsNotSent.map(({ email, invitationLink }) => (
        <InvitationNotSent key={email} email={email} invitationLink={invitationLink} />
      ))}
      <Refusals refusals={outcome.refusals} />
    </div>
  );
};

/**
 * "Add members", in a tenant (its groups) or in the platform area (the platform groups): people
 * found in XTM One's directory or any typed email, several at once, the groups given to all of them.
 * XTM One then tells each person, inviting whoever has no XTM One account.
 */
export const AddMembersDrawer: FunctionComponent<{ scope: MembersScope }> = ({ scope }) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [query] = useDebounce(draft.trim(), DIRECTORY_SEARCH_DELAY_MS);
  const [picked, setPicked] = useState<Array<PersonOption>>([]);
  const [groupIds, setGroupIds] = useState<Array<string>>([]);
  const [response, setResponse] = useState<AddResponse | null>(null);

  const trpc = useTRPC();
  const searching = open && query.length >= DIRECTORY_QUERY_MIN_LENGTH;
  const tenantDirectory = useQuery(trpc.members.searchDirectory.queryOptions(
    { query },
    { enabled: searching && scope === 'tenant', placeholderData: keepPreviousData },
  ));
  const platformDirectory = useQuery(trpc.platformMembers.searchDirectory.queryOptions(
    { query },
    { enabled: searching && scope === 'platform', placeholderData: keepPreviousData },
  ));
  const tenantGroups = useQuery(trpc.groups.getGroups.queryOptions(undefined, { enabled: open && scope === 'tenant' }));
  const platformGroups = useQuery(trpc.platformGroups.getPlatformGroups.queryOptions(undefined, { enabled: open && scope === 'platform' }));

  const onAdded = (added: AddResponse) => {
    setResponse(added);
    setPicked((current) => notAddedPicks(current, added.results));
  };
  const addToTenant = useMutation(trpc.members.addMembers.mutationOptions({ meta: { skipSuccessToast: true }, onSuccess: onAdded }));
  const addToPlatform = useMutation(trpc.platformMembers.addMembers.mutationOptions({ meta: { skipSuccessToast: true }, onSuccess: onAdded }));
  const isPending = addToTenant.isPending || addToPlatform.isPending;

  const directory = scope === 'tenant' ? tenantDirectory : platformDirectory;
  const options = searching ? directoryOptions(directory.data) : [];
  const awaitingSearch = draft.trim().length >= DIRECTORY_QUERY_MIN_LENGTH && (draft.trim() !== query || directory.isFetching);
  const groups = (scope === 'tenant' ? tenantGroups.data : platformGroups.data) ?? [];
  const groupOptions = groups.map((group) => ({ label: group.name, value: group.id }));
  const outcome = response ? addOutcome(response.results) : null;
  const showsSummary = outcome !== null && outcome.addedCount > 0;
  const canAdd = picked.length > 0 && (scope === 'tenant' || groupIds.length > 0);

  const reset = () => {
    setDraft('');
    setPicked([]);
    setGroupIds([]);
    setResponse(null);
  };

  const submit = () => {
    const members = picked.map(({ email, xtmUserId, fullName }) => ({ email, xtmUserId, fullName }));
    setResponse(null);
    if (scope === 'tenant') {
      addToTenant.mutate({ members, groupIds });
    } else {
      addToPlatform.mutate({ members, platformGroupIds: groupIds });
    }
  };

  const searchForm = (): ReactElement => (
    <DrawerBody asChild>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (canAdd && !isPending) {
            submit();
          }
        }}
      >
        {outcome && <Refusals refusals={outcome.refusals} />}
        <Combobox
          multiple
          options={options}
          value={picked}
          onValueChange={(next) => setPicked(Array.isArray(next) ? next : [])}
          inputValue={draft}
          // A pick keeps the search, so several people can be picked among the same results.
          onInputChange={(next, meta) => {
            if (meta.cause !== 'select') {
              setDraft(next);
            }
          }}
          // XTM One's directory already searched on the query.
          filterOptions={(found) => found}
          loading={awaitingSearch}
          getOptionLabel={(person) => person.fullName ?? person.email}
          isOptionEqualToValue={samePerson}
          isOptionDisabled={(person) => person.alreadyMember}
          renderOption={(person) => <PersonRow person={person} />}
          isOptionTwoLine={() => true}
          keepInputOnBlur
        >
          <ComboboxLabel>{t`Find a person`}</ComboboxLabel>
          <ComboboxField>
            <ComboboxChips />
            <ComboboxInput placeholder={t`Name or email`} />
            <ComboboxControls>
              <ComboboxClear aria-label={t`Clear the selection`} />
              <ComboboxTrigger aria-label={t`Toggle the options`} />
            </ComboboxControls>
          </ComboboxField>
          <ComboboxPanel
            listAriaLabel={t`People found`}
            loadingMessage={t`Searching XTM One…`}
            emptyMessage={draft.trim().length < DIRECTORY_QUERY_MIN_LENGTH ? t`Type at least two characters of a name or an email` : t`No one found`}
          />
        </Combobox>
        <MultiSelectField
          options={groupOptions}
          value={groupIds}
          onChange={setGroupIds}
          label={scope === 'tenant' ? t`Assign to groups` : t`Assign to platform groups`}
          required={scope === 'platform'}
          placeholder={t`Select groups`}
          emptyMessage={t`No groups found`}
        />
        <DrawerFooter>
          <DrawerClose asChild>
            <Button priority="secondary">{t`Cancel`}</Button>
          </DrawerClose>
          <Button type="submit" disabled={!canAdd} loading={isPending}>
            {i18n._({ id: 'Add ({count})', message: 'Add ({count})', values: { count: picked.length } })}
          </Button>
        </DrawerFooter>
      </form>
    </DrawerBody>
  );

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          reset();
        }
      }}
    >
      <DrawerTrigger asChild>
        <Button>{t`Add members`}</Button>
      </DrawerTrigger>
      <DrawerContent size="sm" busy={isPending}>
        <DrawerHeader title={t`Add members`} closeLabel={t`Close`} />
        {showsSummary && response ? (
          <DrawerBody>
            <AddedSummary scope={scope} response={response} outcome={outcome} />
            <DrawerFooter>
              <Button priority="secondary" onClick={() => setResponse(null)}>{t`Add more members`}</Button>
              <DrawerClose asChild>
                <Button>{t`Close`}</Button>
              </DrawerClose>
            </DrawerFooter>
          </DrawerBody>
        ) : searchForm()}
      </DrawerContent>
    </Drawer>
  );
};
