---
name: drawer
description: Build or change a drawer, the right-side sliding panel used to create, edit and view data. Use before creating or modifying a drawer panel, a FormDrawer, a DisplayDrawer or an EditEntityDrawer.
---

# Drawer Components

The right-side sliding panel used for creating, editing, and viewing data is called a **Drawer**. It wraps `@filigran/ui` Sheet primitives behind generic, opinionated components defined in `src/components/shared/`.

## Component Hierarchy

| Component | Purpose | When to use |
|---|---|---|
| `FormDrawer` | Drawer with dirty-change protection (unsaved changes dialog) | Create / edit forms |
| `DisplayDrawer` | Read-only drawer without dirty tracking | Viewing data (e.g. event details) |
| `EditEntityDrawer` | Shortcut: `FormDrawer` + `Suspense` wrapper, always open, takes `entityName` | Route-based edit drawers |

## Sub-components (used inside drawers)

| Component | Purpose |
|---|---|
| `DrawerForm` | A `DrawerFormColumn`: `children` scroll in a `DrawerFormBody`, the `footer` prop sits below it. Auto-registers dirty tracking via `useFormDrawerDirtyCheck` |
| `DrawerFormColumn` | The `<form>` of a drawer: a column that fills the sheet, with `noValidate`. `DrawerForm` renders it; a custom form uses it directly |
| `DrawerFormBody` | The scrolling part of a form, between the header and the footer. `DrawerForm` renders it; a custom form composes it itself |
| `DrawerFormActions` | Footer with Cancel / Submit buttons (and optional destructive action) |
| `DrawerFormFooter` | Footer container: on the drawer header's background, edge to edge, below the scrolling body |
| `DrawerFormHeader` | Header with optional category + title |
| `DrawerContent` | Styled `SheetContent` wrapper (width, flex layout) |

## Hooks

| Hook | Purpose |
|---|---|
| `useFormDrawerContext()` | Returns `{ closeDrawer }` — call to programmatically close the drawer after a successful mutation |
| `useFormDrawerDirtyCheck(form)` | Registers a lazy dirty check for `FormDrawer`'s unsaved-changes dialog. Called automatically by `DrawerForm`. |
| `useDrawerOpenState({ open, onClose })` | Internal hook managing controlled/uncontrolled open state. Used by `FormDrawer` and `DisplayDrawer`. |

## Rules

1. **Always use generic wrappers** — never import `Sheet`, `SheetContent`, `SheetTrigger`, `SheetHeader`, `SheetTitle`, or `SheetFooter` from `@filigran/ui` in feature code. An ESLint `no-restricted-imports` rule enforces this.

2. **Only `src/components/shared/` may use raw Sheet primitives** — the ESLint rule whitelists only the wrapper files.

3. **When creating a new drawer variant**, add it in `src/components/shared/` and re-export from `index.ts`. Never inline raw Sheet usage in feature components.

4. **Challenge the need** — before creating a custom drawer, verify that `FormDrawer`, `DisplayDrawer`, or `EditEntityDrawer` can't serve the need. Most CRUD panels fit one of these three.

5. **A form drawer is a column, not a page that scrolls.** The form is a `DrawerFormColumn`, its body scrolls (`DrawerFormBody`) and its footer is a sibling below it, so the buttons stay in view and the scrollbar stops above them. The footer takes the header's background and reaches both edges of the drawer, so `DrawerFormFooter` bleeds over the sheet's side padding. `DrawerForm` does this; a custom form uses `DrawerFormColumn` and composes the body and the footer itself. A form with tabs makes `Tabs` the `min-h-0 flex-1` column and puts only the `TabsContent`s in the body, so the tab list stays in view; the panels share that one scroller, so a tab change scrolls it back to the top (a ref on the body, `scrollTo` when the tab differs). `h-full` resolves only through plain blocks up to the sheet: a wrapper element between `FormDrawer` and the form must itself be `flex h-full flex-col` and give the form `h-auto flex-1`, or the form falls back to growing with its content inside the sheet's own scroller.

## Form fields

Form fields inside drawers use `@filigran/design-system` components (`Input`, `Textarea`,
`Select`, `Checkbox`, `Switch`, `Combobox`), which carry their own `label`, required
asterisk, `helperText` and `error`. They bind to react-hook-form through its own
`Controller`, whose `fieldState` supplies the error message:

- No `@filigran/ui` form wrappers around a design-system field: `FormItem`, `FormLabel`,
  `FormControl` and `FormMessage` are replaced by the field's own props, and `FormControl`
  is a Slot that would re-inject props the field already manages.
- `FormField` from `@filigran/ui` is replaced by `Controller` from `react-hook-form` with
  an explicit `control={form.control}`.
- `error` takes `fieldState.error?.message` (a string, never a boolean).
- `label` is a string: use the `t` macro, not `<Trans>`.
- A field that the zod schema makes mandatory carries `required` so the label shows the
  asterisk.
- `Select` is a compound: the root renders no DOM and takes `error` as a boolean
  (`fieldState.invalid`), the asterisk comes from `SelectLabel required` (the root's own
  `required` is HTML5 semantics only), the message goes in `SelectHelperText`, and the
  trigger takes `ref={field.ref}`, `onBlur={field.onBlur}` and `className="w-full"` (its
  base is `w-fit`). Wrap the whole field in a `<div>` so label, trigger and helper stay one
  item of the form column.
- A reusable select component (`CountrySelect`, `ServiceAccountSelect`) owns its
  `SelectLabel`/`SelectHelperText`, since they must live inside the `Select` root: it takes
  `label`, `required`, `error`, `onBlur` and `triggerRef` props and the `Controller` feeds
  them (`triggerRef={field.ref}` is what lets `handleSubmit` focus the field when invalid).
- `Combobox` is the searchable field, and its multiple form is the multi-select. It is a
  compound: `ComboboxLabel`, then `ComboboxField` holding `ComboboxChips` (multiple only),
  `ComboboxInput` and a `ComboboxControls` pair of `ComboboxClear` + `ComboboxTrigger`, then
  `ComboboxContent` and `ComboboxHelperText`. The root takes `error` as a boolean, the
  asterisk comes from `ComboboxLabel required`, and `field.ref` / `field.onBlur` go on
  `ComboboxInput`, whose imperative handle is the `<input>` itself. Four defaults are English
  literals a call site must translate: `ComboboxContent`'s `emptyMessage` and `listAriaLabel`,
  and the `aria-label` of `ComboboxClear` and `ComboboxTrigger`.
- `SingleSelectField` and `MultiSelectField` (`src/components/shared/select-field.tsx`) are
  that compound bound to an id-valued form field over `{ label, value }` options: they own the
  markup, the translated copy and the `string` / `string[]` conversion, and take `label`,
  `required`, `error`, `helperText`, `placeholder`, `emptyMessage`, `onBlur` and `inputRef`.
  A field whose options are not that shape composes `Combobox` itself: see
  `attach-cve-drawer.tsx`, which drives the panel off a server search through
  `inputValue` / `onInputChange` and an identity `filterOptions`.
- The `Combobox` panel renders in a Radix portal, which cuts both ways. A wheel event inside
  it never reaches the drawer's scroll container, so no `onWheel` stopper is needed around the
  field. But it is a NON-modal Popover portalled to `<body>`, where the modal drawer sets
  `pointer-events: none`, so without the `fds-patches.css` rule restoring it the panel paints
  over the drawer and every click falls through to the form underneath.
- `Checkbox` and `Switch` carry their own `label` inside a native `<label>`, drawn to the
  RIGHT of the control: a legacy sibling `<span>` on that side folds into the prop and its
  flex wrapper goes with it, which also makes the text clickable. A control with no visible
  text needs `aria-label` — every design-system field warns in dev when it has no
  accessible name.
- `className` on `Input` and `Textarea` lands on the outer wrapper (`flex w-full flex-col
  gap-2`), never on the `<input>`/`<textarea>`: width and flex classes still work, a
  typography, padding or border class is inert and must be dropped rather than carried over.
  Nothing reaches the control itself, so its font, padding and resize behaviour are the
  design system's to decide.
- `aria-invalid` from a call site is overwritten by the component, so `error` is the only
  way into the error state and it always renders a message. A rule that spans several
  fields (min ≤ likely ≤ max) therefore keeps its own single message and leaves the fields
  untoned; splitting the message across them would print it once per field.
- A search or filter field uses the design-system `SearchField`, not `Input`. In controlled
  mode `onClear` is what makes the clear cross exist at all, `clearLabel` needs translating
  (the built-in default is an English literal), and the base width is `w-55` where the
  legacy `Input` was `w-full` — a call site that only capped the width (`max-w-sm`) must
  restate `w-full` or the field silently shrinks to 220px.
- `NullableInput`, `NullableTextarea`, `NullableNumberInput` and `NumberFormInput`
  (`src/components/shared/`) bridge a `null`/`undefined` form value to the DOM and forward
  the field props through, so a nullable field keeps them instead of inlining the bridge.
- A `<form>` that is not a `DrawerFormColumn` carries its own `noValidate`: `required` sets the native
  attribute, and the browser's bubble would otherwise pre-empt zod.
- `DrawerContent` carries the FDS `layer-2` elevation context class. Design-system fields
  read their resting fill from the elevation tokens, and without it an `Input` at rest is
  invisible: layer-0 highlight is the exact colour of the legacy sheet background.

## Typical usage pattern

```tsx
// Feature create drawer
import { Input } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Controller } from 'react-hook-form';
import { FormDrawer, DrawerForm, DrawerFormActions, useFormDrawerContext } from '../../../components/shared';

const MyCreateForm = () => {
  const { closeDrawer } = useFormDrawerContext();
  // ... form setup ...
  const onSubmit = (data) => {
    createMutation.mutate(data);
    closeDrawer();
  };
  return (
    <DrawerForm
      form={form}
      onSubmit={onSubmit}
      footer={<DrawerFormActions isPending={createMutation.isPending} submitLabel="Create" />}
    >
      <Controller
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <Input {...field} label={t`Name`} required error={fieldState.error?.message} />
        )}
      />
    </DrawerForm>
  );
};

export const MyCreateDrawer = () => (
  <FormDrawer trigger={<Button>Create</Button>} title="Create item">
    <MyCreateForm />
  </FormDrawer>
);
```
