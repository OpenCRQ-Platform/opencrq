import type { FunctionComponent, SVGProps } from 'react';

/*
 * The top-bar glyphs OpenCTI and OpenAEV render, so the right group of the three headers is the same
 * picture: OpenCTI draws them with `@mui/icons-material` Outlined icons at `fontSize="medium"`, a 24px
 * box (opencti-front src/private/components/nav/TopBar.tsx, CtemCommandCenterButton.tsx). The design
 * system's Lucide equivalents (`bell`, `circle-user`, `radar`) are other drawings with a 2px stroke, so
 * they read larger than OpenCTI's at the same box size.
 *
 * Path data from @mui/icons-material 7.3.5 (MIT), drawn from Google's Material Icons (Apache-2.0).
 * Each glyph paints `currentColor`, so the IconButton that holds it keeps choosing the colour.
 */
type TopBarIconProps = Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'children'>;

const TOP_BAR_ICON_SIZE = 24;

const glyph = (paths: ReadonlyArray<string>): FunctionComponent<TopBarIconProps> => {
  const Glyph: FunctionComponent<TopBarIconProps> = (props) => (
    <svg
      width={TOP_BAR_ICON_SIZE}
      height={TOP_BAR_ICON_SIZE}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      focusable="false"
      {...props}
    >
      {paths.map((d) => <path key={d} d={d} />)}
    </svg>
  );
  return Glyph;
};

/** MUI `NotificationsOutlined`. */
export const NotificationsOutlinedIcon = glyph([
  'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2m6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1zm-2 1H8v-6c0-2.48 1.51-4.5 4-4.5s4 2.02 4 4.5z',
]);

/** MUI `AccountCircleOutlined`. */
export const AccountCircleOutlinedIcon = glyph([
  'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2M7.35 18.5C8.66 17.56 10.26 17 12 17s3.34.56 4.65 1.5c-1.31.94-2.91 1.5-4.65 1.5s-3.34-.56-4.65-1.5m10.79-1.38C16.45 15.8 14.32 15 12 15s-4.45.8-6.14 2.12C4.7 15.73 4 13.95 4 12c0-4.42 3.58-8 8-8s8 3.58 8 8c0 1.95-.7 3.73-1.86 5.12',
  'M12 6c-1.93 0-3.5 1.57-3.5 3.5S10.07 13 12 13s3.5-1.57 3.5-3.5S13.93 6 12 6m0 5c-.83 0-1.5-.67-1.5-1.5S11.17 8 12 8s1.5.67 1.5 1.5S12.83 11 12 11',
]);

/** MUI `RadarOutlined`. */
export const RadarOutlinedIcon = glyph([
  'M19.74 18.33C21.15 16.6 22 14.4 22 12c0-5.52-4.48-10-10-10S2 6.48 2 12s4.48 10 10 10c2.4 0 4.6-.85 6.33-2.26.27-.22.53-.46.78-.71.03-.03.05-.06.07-.08.2-.2.39-.41.56-.62M12 20c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8c0 1.85-.63 3.54-1.69 4.9l-1.43-1.43c.69-.98 1.1-2.17 1.1-3.46 0-3.31-2.69-6-6-6s-6 2.69-6 6 2.69 6 6 6c1.3 0 2.51-.42 3.49-1.13l1.42 1.42C15.54 19.37 13.85 20 12 20m1.92-7.49c.17-.66.02-1.38-.49-1.9l-.02-.02c-.77-.77-2-.78-2.78-.04-.01.01-.03.02-.05.04-.78.78-.78 2.05 0 2.83l.02.02c.52.51 1.25.67 1.91.49l1.51 1.51c-.6.36-1.29.58-2.04.58-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4c0 .73-.21 1.41-.56 2z',
]);
