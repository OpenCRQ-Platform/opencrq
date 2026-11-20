import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@filigran/ui';
import type { FunctionComponent } from 'react';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../../../lib';
import { truncateDescription } from '../../../utils';
import { getDwellSensitivityLabel } from '../loss-driver-labels';

interface LossDriver {
  id: string,
  name: string,
  description: string | null,
  lossCategoryId: string,
  lossCategoryName: string,
  lossCategoryDisplayOrder: number,
  dwellSensitivity: string,
}

interface LossCategoryGroup {
  id: string,
  name: string,
  displayOrder: number,
  drivers: Array<LossDriver>,
}

const groupByLossCategory = (drivers: Array<LossDriver>): Array<LossCategoryGroup> => {
  const grouped = new Map<string, LossCategoryGroup>();
  for (const driver of drivers) {
    const existing = grouped.get(driver.lossCategoryId);
    if (existing) {
      existing.drivers.push(driver);
    } else {
      grouped.set(driver.lossCategoryId, {
        id: driver.lossCategoryId,
        name: driver.lossCategoryName,
        displayOrder: driver.lossCategoryDisplayOrder,
        drivers: [driver],
      });
    }
  }
  return [...grouped.values()].sort((a, b) => a.displayOrder - b.displayOrder);
};

interface LossDriversDataTableProps {
  onSelectDriver: (id: string) => void,
}

/** Row navigation is the caller's concern: the catalog is embedded under more than one route. */
export const LossDriversDataTable: FunctionComponent<LossDriversDataTableProps> = ({ onSelectDriver }) => {
  const trpc = useTRPC();
  const { data, isLoading } = useQuery(trpc.lossDrivers.getLossDrivers.queryOptions());

  const categories = groupByLossCategory(data ?? []);

  return (
    <>
      <div>
        <h1>{t`Loss Drivers`}</h1>
        <p className="txt-sub-content text-muted-foreground">
          {t`Browse the reference catalog of loss drivers, grouped by loss category.`}
        </p>
      </div>

      <div className="mt-4">
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg border bg-muted" />
            ))}
          </div>
        )}

        {!isLoading && categories.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <p className="text-muted-foreground">{t`No loss drivers yet.`}</p>
          </div>
        )}

        {!isLoading && categories.length > 0 && (
          <Accordion
            type="multiple"
            defaultValue={[]}
            className="space-y-2"
          >
            {categories.map((category) => (
              <AccordionItem
                key={category.id}
                value={category.id}
                className="overflow-hidden rounded-lg border"
              >
                <AccordionTrigger className="px-4 py-3 hover:no-underline">
                  <span className="txt-category">{category.name}</span>
                </AccordionTrigger>

                <AccordionContent className="px-0 pb-0">
                  <Table className="w-full table-fixed">
                    <colgroup>
                      <col className="w-[30%]" />
                      <col />
                      <col className="w-[15%]" />
                    </colgroup>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t`Name`}</TableHead>
                        <TableHead>{t`Description`}</TableHead>
                        <TableHead>{t`Dwell sensitivity`}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {category.drivers.map((driver) => (
                        <TableRow
                          key={driver.id}
                          className="cursor-pointer"
                          onClick={() => onSelectDriver(driver.id)}
                        >
                          <TableCell className="overflow-hidden truncate font-medium">
                            {/* The row reacts to a pointer; the name is what a keyboard reaches. */}
                            <button
                              type="button"
                              className="max-w-full cursor-pointer truncate text-left underline-offset-2 hover:underline focus-visible:underline"
                              onClick={(event) => {
                                event.stopPropagation();
                                onSelectDriver(driver.id);
                              }}
                            >
                              {driver.name}
                            </button>
                          </TableCell>
                          <TableCell className="overflow-hidden truncate text-muted-foreground">
                            {truncateDescription(driver.description)}
                          </TableCell>
                          <TableCell className="overflow-hidden truncate">
                            {getDwellSensitivityLabel(driver.dwellSensitivity)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </div>
    </>
  );
};
