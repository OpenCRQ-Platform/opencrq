/*
Copyright (c) 2026 Filigran SAS

This file is part of the OpenCRQ Enterprise Edition ("EE") and is
licensed under the OpenCRQ Enterprise Edition License (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://github.com/OpenCRQ-Platform/opencrq/blob/main/LICENSE

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/

import type { ChatMode } from '@filigran/chatbot';
import type { FunctionComponent, PropsWithChildren } from 'react';
import { createContext, useContext, useState } from 'react';

/** The chatbot's own default sidebar width, until it reports the one it restored. */
const DEFAULT_SIDEBAR_WIDTH = 400;

/** Space between the page and the docked panel, as in OpenAEV. */
export const ASK_ARIANE_SIDEBAR_GAP = 6;

interface AskArianeLayoutState {
  /** The panel's mode, `null` while it is closed. */
  mode: ChatMode | null,
  sidebarWidth: number,
  isResizing: boolean,
  setMode: (mode: ChatMode | null) => void,
  setSidebarWidth: (width: number) => void,
  setIsResizing: (isResizing: boolean) => void,
}

const AskArianeLayoutContext = createContext<AskArianeLayoutState | null>(null);

/**
 * Holds where the Ask Ariane panel is, so the layout makes room for it: docked
 * on the right, it pushes the page instead of covering it, as in OpenCTI and
 * OpenAEV. The panel reports its width while it is resized.
 */
export const AskArianeLayoutProvider: FunctionComponent<PropsWithChildren> = ({ children }) => {
  const [mode, setMode] = useState<ChatMode | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  return (
    <AskArianeLayoutContext value={{ mode, sidebarWidth, isResizing, setMode, setSidebarWidth, setIsResizing }}>
      {children}
    </AskArianeLayoutContext>
  );
};

/** Outside the layout (a test, a bare route) the panel keeps its own state. */
export const useAskArianeLayout = (): AskArianeLayoutState | null => useContext(AskArianeLayoutContext);

/** Room the page leaves on its right for the docked panel, in pixels. */
export const askArianeContentMargin = (state: Pick<AskArianeLayoutState, 'mode' | 'sidebarWidth'> | null): number =>
  (state?.mode === 'sidebar' ? state.sidebarWidth + ASK_ARIANE_SIDEBAR_GAP : 0);

/**
 * The area the panel pushes: its right margin, animated as the panel opens and
 * closes, and followed without delay while it is dragged.
 */
export const useAskArianeContentPush = (): { marginRight: number, animate: boolean } => {
  const state = useAskArianeLayout();
  return { marginRight: askArianeContentMargin(state), animate: !state?.isResizing };
};
