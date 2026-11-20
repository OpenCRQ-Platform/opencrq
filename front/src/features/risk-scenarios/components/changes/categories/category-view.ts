import type { ChangeEvent, ChangeGroup } from '@app/module/client';

export interface CategoryView {
  label: () => string,
  itemName: (item: ChangeEvent['item']) => string,
  /** A `text` value the client translates, such as an enumerated setting; the raw value otherwise. */
  textValue?: (item: ChangeEvent['item'], value: string) => string,
  /** The row's text for a sentence key other than `value-changed`, which reads as the item's name. */
  sentence?: (event: ChangeEvent) => string,
  groupSentence?: (group: ChangeGroup) => { headline: string, breakdown: string },
}
