import { IconButton } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { LocateFixed, Maximize, Minimize, Scan, ZoomIn, ZoomOut } from 'lucide-react';
import type { MouseEvent, PointerEvent, ReactElement, ReactNode, RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import type { ForceGraphMethods, LinkObject, NodeObject } from 'react-force-graph-2d';
import type { Box, Curve, Point } from './column-graph-geometry';
import { boxContains, distanceToCurve, edgeCurve } from './column-graph-geometry';
import { MIN_ZOOM, NODE_RADIUS } from './column-graph-paint';
import { pinUnlinkedBelow, spreadPeersOnce } from './column-graph-utils';

/** Along the chain, so it has to clear a label of its own width rather than a node's diameter. */
export const LEVEL_DISTANCE = 260;
const CHARGE_STRENGTH = -350;
const LINK_DISTANCE = 90;
/**
 * Solved before the first paint, so the reader never watches the drawing settle: only the cooldown
 * after it is animated, and it has little left to move.
 */
const WARMUP_TICKS = 160;
const COOLDOWN_TICKS = 40;
/** Between a node's outline and the line touching it, so neither runs under the other's ink. */
const LINK_GAP = 3;
/** Screen pixels either side of a curve a click still lands on, for a link whose pill is hidden. */
const EDGE_HIT_PX = 5;
const COLUMN_TOLERANCE = 20;
const COLUMN_SPACING_STRENGTH = 0.5;
/** Enough for one frame to settle a column, so the spacing does not depend on how long the loop runs. */
const COLUMN_SPACING_PASSES = 12;
/** The first frame settles the columns the warm-up left, so the drawing appears already spread. */
const FIRST_FRAME_SPACING_PASSES = 200;
/** How many frames the view is framed and the columns spread, before it is left to the reader. */
const FIT_FRAMES = 90;
/** Wide enough for the outermost labels, which the fit itself measures nothing of. */
const FIT_PADDING = 70;
/** A short chain would otherwise be fitted to fill the card, blowing every glyph up. */
const MAX_FIT_ZOOM = 1.2;
const ZOOM_STEP = 1.35;
const WHEEL_ZOOM_STEP = 1.2;
const ZOOM_MS = 220;
/** Screen pixels a node must sit inside the canvas edge to count as in view, its label included. */
const FOLLOW_MARGIN = 60;
const MAX_ZOOM = 6;
/** force-graph shows a node's `name` in a tooltip of its own by default. */
const NO_LABEL = (): string => '';
/** Screen pixels between a hovered node's top and its tooltip. */
const TOOLTIP_GAP = 6;

export interface ColumnGraphNode {
  id: string,
  /** The column, left to right from 0. */
  level: number,
  /** Pins the node at this height, in graph units, instead of leaving it to the forces. */
  pinnedY?: number,
}

export interface ColumnGraphLink {
  id: string,
  source: string,
  target: string,
}

export type PlacedNode<N extends ColumnGraphNode> = N & { x?: number, y?: number, fx?: number, fy?: number };

interface PlacedLink<N extends ColumnGraphNode, L extends ColumnGraphLink> {
  id: string,
  source: string | PlacedNode<N>,
  target: string | PlacedNode<N>,
  link: L,
}

interface DrawnLink<L extends ColumnGraphLink> {
  link: L,
  /** `null` while an end is not placed yet, or when the two ends are too close for a line between them. */
  curve: Curve | null,
}

/** What the overlay painter reads: the placed nodes, each link along its curve, and the screen's own frame. */
export interface ColumnGraphView<N extends ColumnGraphNode, L extends ColumnGraphLink> {
  nodes: ReadonlyArray<PlacedNode<N>>,
  links: ReadonlyArray<DrawnLink<L>>,
  screenToGraph: (x: number, y: number) => Point,
}

/** A box painted over the drawing that selects a link when clicked. */
export interface ColumnGraphLinkTarget {
  linkId: string,
  box: Box,
}

interface ColumnGraphProps<N extends ColumnGraphNode, L extends ColumnGraphLink> {
  /** Their identity is the drawing's: a new array with the same signatures keeps everything as drawn. */
  nodes: Array<N>,
  links: Array<L>,
  /**
   * Everything the painters read from the node objects, not the shape alone: a change repaints with
   * each node kept where it was, while a change of the ids lays the graph out again.
   */
  signature: string,
  /** The signature whose change lays the graph out again; the node and link ids by default. */
  shapeSignature?: string,
  /** Graph units two nodes of one column are kept apart by. */
  columnGap: number,
  /** How far a node's ink reaches from its centre, which is where a line touching it stops and a click on it lands. */
  nodeReach: (node: PlacedNode<N>) => number,
  paintNode: (node: PlacedNode<N>, ctx: CanvasRenderingContext2D, globalScale: number, hoveredNodeId: string | null) => void,
  paintLink: (link: L, curve: Curve, ctx: CanvasRenderingContext2D, globalScale: number) => void,
  /** Painted after the nodes; returns the boxes a click on selects their link. */
  paintOverlay?: (ctx: CanvasRenderingContext2D, globalScale: number, view: ColumnGraphView<N, L>) => Array<ColumnGraphLinkTarget>,
  /** Whether a click near the link's curve selects it. */
  isSelectableLink?: (link: L) => boolean,
  /** Whether the pointer over the node shows it can be clicked and hovers it; every node by default. */
  isInteractiveNode?: (node: PlacedNode<N>) => boolean,
  /** `undefined` for a click on the background. */
  onNodeClick: (node: PlacedNode<N> | undefined) => void,
  onLinkClick?: (link: L) => void,
  /** Shown above the hovered node; the hovered node is also handed to `paintNode`. */
  nodeTooltip?: (node: PlacedNode<N>) => ReactNode,
  /** A node selected from outside the canvas, which the view follows when it is out of sight. */
  followedNodeId?: string | null,
  /** Bumped by the caller; every new value refits the view to the whole drawing. */
  fitSignal: number,
  isFullScreen: boolean,
  onToggleFullScreen: () => void,
  /** Left out when the container sizes the graph itself, which is what full screen does. */
  height?: number,
  /** The node the page is about, reachable from the controls, since the layout can put it anywhere. */
  markedNodeId?: string,
  /** Screen pixels on the left the controls cover, which the framing then keeps the drawing clear of. */
  controlsInset?: number,
  centreOnMarkedLabel?: string,
  /**
   * What the canvas draws, said in words. A canvas has no nodes to focus and no relations to announce,
   * so the same actions are offered from a list that only a keyboard or a reader reaches.
   */
  accessibleLabel: string,
  accessibleItems: ReactNode,
}

/** What react-kapsule's imperative handle exposes, spelled as the library's own `ref` prop types it. */
type GraphHandle<N extends ColumnGraphNode, L extends ColumnGraphLink> =
  ForceGraphMethods<NodeObject<PlacedNode<N>>, LinkObject<PlacedNode<N>, PlacedLink<N, L>>>;

interface Hover {
  id: string,
  x: number,
  y: number,
}

type CanvasHit<N extends ColumnGraphNode, L extends ColumnGraphLink> = { kind: 'node', node: PlacedNode<N> } | { kind: 'link', link: L };

const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

type Framed = Pick<ForceGraphMethods, 'getGraphBbox' | 'zoom' | 'centerAt'>;

/** Fits the drawing into the canvas short of `inset` on its left, never past the reading scale. */
const fitClearOf = (graph: Framed, width: number, height: number, inset: number, ms: number): void => {
  const box = graph.getGraphBbox();
  const spanX = Math.max(1, box.x[1] - box.x[0]);
  const spanY = Math.max(1, box.y[1] - box.y[0]);
  const zoom = clampZoom(Math.min(MAX_FIT_ZOOM, (width - inset - FIT_PADDING * 2) / spanX, (height - FIT_PADDING * 2) / spanY));
  graph.zoom(zoom, ms);
  graph.centerAt((box.x[0] + box.x[1]) / 2 - inset / (2 * zoom), (box.y[0] + box.y[1]) / 2, ms);
};

const idsSignature = (nodes: ReadonlyArray<ColumnGraphNode>, links: ReadonlyArray<ColumnGraphLink>): string =>
  `${nodes.map((node) => node.id).sort().join()}|${links.map((link) => link.id).sort().join()}`;

/**
 * Each node is pinned to its column rather than left to force-graph's DAG mode, which lays a cycle
 * out nowhere: the columns come with the nodes.
 */
const toGraphData = <N extends ColumnGraphNode, L extends ColumnGraphLink>(
  nodes: ReadonlyArray<N>,
  links: ReadonlyArray<L>,
  settled: ReadonlyArray<PlacedNode<N>>,
) => {
  const placed = new Map(settled.map((node) => [node.id, node]));
  const lastColumn = Math.max(0, ...nodes.map((node) => node.level));
  return {
    nodes: nodes.map((node): PlacedNode<N> => {
      const previous = placed.get(node.id);
      const fx = (node.level - lastColumn / 2) * LEVEL_DISTANCE;
      const pinned = node.pinnedY === undefined ? { fx } : { fx, fy: node.pinnedY };
      return previous === undefined ? { ...node, ...pinned } : { ...node, ...pinned, x: previous.x, y: previous.y };
    }),
    links: links.map((link): PlacedLink<N, L> => ({ id: link.id, source: link.source, target: link.target, link })),
  };
};

/**
 * A graph read left to right in columns, on a canvas: the caller places each node in a column and
 * paints nodes, links and what goes over them, and this frames the drawing, spreads each column,
 * resolves clicks and hovers, and carries the zoom controls and the text equivalent.
 */
export const ColumnGraph = <N extends ColumnGraphNode, L extends ColumnGraphLink>({
  nodes,
  links,
  signature,
  shapeSignature,
  columnGap,
  nodeReach,
  paintNode,
  paintLink,
  paintOverlay,
  isSelectableLink,
  isInteractiveNode,
  onNodeClick,
  onLinkClick,
  nodeTooltip,
  followedNodeId,
  fitSignal,
  isFullScreen,
  onToggleFullScreen,
  height,
  markedNodeId,
  controlsInset,
  centreOnMarkedLabel,
  accessibleLabel,
  accessibleItems,
}: ColumnGraphProps<N, L>): ReactElement => {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<GraphHandle<N, L> | undefined>(undefined);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hover, setHover] = useState<Hover | null>(null);
  const shape = shapeSignature ?? idsSignature(nodes, links);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    let frame: number | null = null;
    const measure = (): void => {
      frame = null;
      setSize({ width: container.clientWidth, height: container.clientHeight });
    };
    measure();
    const observer = new ResizeObserver(() => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(measure);
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, []);

  /**
   * State, not a memo: force-graph writes each node's settled position onto these objects, so their
   * identity is the layout, and the React Compiler re-derives a manual memo's dependencies, leaving
   * the component reading an array the simulation is not moving.
   */
  const [graphData, setGraphData] = useState(() => toGraphData(nodes, links, []));
  /**
   * Off until the first frame spread and framed a new layout: the frame before it shows the raw
   * warm-up at the previous zoom, and every node would visibly jump to its place.
   */
  const [isRevealed, setIsRevealed] = useState(false);
  const builtSignatureRef = useRef(signature);
  const builtShapeRef = useRef(shape);
  useEffect(() => {
    if (builtSignatureRef.current === signature) {
      return;
    }
    const laidOutAgain = builtShapeRef.current !== shape;
    builtSignatureRef.current = signature;
    builtShapeRef.current = shape;
    // A node that stays keeps the place the simulation settled it in, so a rename repaints without
    // throwing the whole drawing back at the reader.
    setGraphData((previous) => toGraphData(nodes, links, laidOutAgain ? [] : previous.nodes));
    if (laidOutAgain) {
      setIsRevealed(false);
    }
  }, [nodes, links, signature, shape]);

  /** Raised by a zoom of the reader's, which the framing loop would otherwise undo every frame. */
  const zoomedByHandRef = useRef(false);
  const framedRef = useRef<{ graphData: typeof graphData | null, fitSignal: number }>({ graphData: null, fitSignal });

  /**
   * The wheel is driven here rather than left to d3-zoom, which multiplies a delta by ten when Ctrl
   * is held, reading it as a trackpad pinch: two notches would then cross the whole zoom range. The
   * event is swallowed only while the modifier is held, so without it the wheel keeps its default
   * action and the page scrolls under the cursor.
   */
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const zoomOnWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      event.preventDefault();
      const graph = graphRef.current;
      if (graph === undefined) {
        return;
      }
      zoomedByHandRef.current = true;
      setHover(null);
      graph.zoom(clampZoom(graph.zoom() * (event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP)));
    };
    container.addEventListener('wheel', zoomOnWheel, { passive: false });
    return () => container.removeEventListener('wheel', zoomOnWheel);
  }, []);

  /**
   * Each node's column is pinned and its height left to the forces, whose defaults spread a
   * column by a few pixels, so siblings land on top of each other. The tuning below runs while the
   * engine still has cooldown ticks to burn: a `d3ReheatSimulation` would leave that counter where
   * it was and drive the engine for ever.
   *
   * Both the framing and the column spacing run on an animation frame of our own: `onEngineStop` is
   * one of the props `react-force-graph-2d` does not forward, and a force added through `d3Force`
   * under a name of ours is initialised and then never called.
   */
  useEffect(() => {
    const graph = graphRef.current;
    if (graph === undefined) {
      return;
    }
    graph.d3Force('charge')?.strength(CHARGE_STRENGTH);
    graph.d3Force('link')?.distance(LINK_DISTANCE);

    // A resize alone leaves the view where the reader put it: only a new drawing or an explicit
    // recentre hands it back to the framing.
    const reframed = framedRef.current.graphData !== graphData || framedRef.current.fitSignal !== fitSignal;
    framedRef.current = { graphData, fitSignal };
    if (reframed) {
      zoomedByHandRef.current = false;
    }
    const linkedIds = new Set(graphData.links.flatMap((link) => [link.source, link.target])
      .map((end) => (typeof end === 'string' ? end : end.id)));
    let framesLeft = FIT_FRAMES;
    let frame = 0;
    const follow = (): void => {
      // force-graph runs its warm-up in a deferred digest, which may land after this frame.
      if (graphData.nodes.some((node) => node.x === undefined)) {
        frame = requestAnimationFrame(follow);
        return;
      }
      const isFirstFrame = framesLeft === FIT_FRAMES;
      const passes = isFirstFrame ? FIRST_FRAME_SPACING_PASSES : COLUMN_SPACING_PASSES;
      for (let pass = 0; pass < passes; pass += 1) {
        spreadPeersOnce(graphData.nodes, 'y', columnGap, COLUMN_TOLERANCE, COLUMN_SPACING_STRENGTH);
      }
      if (isFirstFrame) {
        pinUnlinkedBelow(graphData.nodes, linkedIds, columnGap);
      }
      const current = graphRef.current;
      if (!zoomedByHandRef.current) {
        if (current !== undefined && controlsInset !== undefined) {
          fitClearOf(current, size.width, size.height, controlsInset, 0);
        } else {
          current?.zoomToFit(0, FIT_PADDING);
          if (current !== undefined && current.zoom() > MAX_FIT_ZOOM) {
            current.zoom(MAX_FIT_ZOOM);
          }
        }
      }
      if (isFirstFrame) {
        setIsRevealed(true);
      }
      framesLeft -= 1;
      frame = framesLeft > 0 ? requestAnimationFrame(follow) : 0;
    };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
    // The measured size is a dependency because the graph mounts only once measured: without it this
    // runs once, on the render before there is anything to tune.
  }, [graphData, fitSignal, size, columnGap, controlsInset]);

  /**
   * A selection can come from outside the canvas and land on a node the reader panned out of view:
   * the view then follows it, and only then, so a click on the canvas never moves it.
   */
  useEffect(() => {
    const graph = graphRef.current;
    const container = containerRef.current;
    const node = graphData.nodes.find((candidate) => candidate.id === followedNodeId);
    if (graph === undefined || container === null || node === undefined) {
      return;
    }
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const onScreen = graph.graph2ScreenCoords(x, y);
    const inView = onScreen.x >= FOLLOW_MARGIN && onScreen.x <= container.clientWidth - FOLLOW_MARGIN
      && onScreen.y >= FOLLOW_MARGIN && onScreen.y <= container.clientHeight - FOLLOW_MARGIN;
    if (!inView) {
      zoomedByHandRef.current = true;
      graph.centerAt(x, y, ZOOM_MS);
    }
  }, [followedNodeId, graphData]);

  const currentLinks = new Map(links.map((link) => [link.id, link]));
  const linkOf = (placed: PlacedLink<N, L>): L => currentLinks.get(placed.id) ?? placed.link;

  /** Filled by the last frame painted, which is the only place a target's size in graph units is known. */
  const targetsRef = useRef<Array<ColumnGraphLinkTarget>>([]);

  const curveOf = (placed: PlacedLink<N, L>): Curve | null => {
    const { source, target } = placed;
    if (typeof source === 'string' || typeof target === 'string') {
      return null;
    }
    return edgeCurve(
      { x: source.x ?? 0, y: source.y ?? 0, reach: nodeReach(source) + LINK_GAP },
      { x: target.x ?? 0, y: target.y ?? 0, reach: nodeReach(target) + LINK_GAP },
      COLUMN_TOLERANCE,
    );
  };

  /**
   * Drawn here rather than by the library's own link renderer, which runs a line from centre to
   * centre: a node is painted over it, so the line shows through whatever the node's own opacity
   * leaves translucent. Trimming both ends against `nodeReach` is what keeps one off the other.
   */
  const paintPlacedLink = (placed: PlacedLink<N, L>, ctx: CanvasRenderingContext2D, globalScale: number): void => {
    const curve = curveOf(placed);
    if (curve !== null) {
      paintLink(linkOf(placed), curve, ctx, globalScale);
    }
  };

  const hoveredNodeId = hover?.id ?? null;
  const paintPlacedNode = (node: PlacedNode<N>, ctx: CanvasRenderingContext2D, globalScale: number): void =>
    paintNode(node, ctx, globalScale, hoveredNodeId);

  const screenToGraph = (x: number, y: number): Point => graphRef.current?.screen2GraphCoords(x, y) ?? { x, y };

  const paintAbove = (ctx: CanvasRenderingContext2D, globalScale: number): void => {
    if (paintOverlay === undefined) {
      return;
    }
    targetsRef.current = paintOverlay(ctx, globalScale, {
      nodes: graphData.nodes,
      links: graphData.links.map((placed) => ({ link: linkOf(placed), curve: curveOf(placed) })),
      screenToGraph,
    });
  };

  /**
   * Selection is resolved here rather than through `onNodeClick`, which never fires for a graph
   * painted with `nodeCanvasObject`: force-graph hit-tests against a shadow canvas the custom
   * painter is not linked to, and `nodePointerAreaPaint`, the prop meant to fill it, is declared
   * but read nowhere in `force-graph@1.51`. The node positions are on `graphData`, which the
   * simulation keeps current, so the same answer costs one distance test.
   */
  const attachGraph = (instance: GraphHandle<N, L> | null): void => {
    graphRef.current = instance ?? undefined;
  };

  const hitAt = (event: MouseEvent<HTMLDivElement> | PointerEvent<HTMLDivElement>): CanvasHit<N, L> | null => {
    const graph = graphRef.current;
    if (graph === undefined) {
      return null;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = graph.screen2GraphCoords(event.clientX - bounds.left, event.clientY - bounds.top);
    const node = graphData.nodes.find(
      (candidate) => Math.hypot((candidate.x ?? 0) - point.x, (candidate.y ?? 0) - point.y) <= nodeReach(candidate) + 2,
    );
    if (node !== undefined) {
      return { kind: 'node', node };
    }
    const target = targetsRef.current.find((candidate) => boxContains(candidate.box, point));
    const targetLink = target === undefined ? undefined : currentLinks.get(target.linkId);
    if (targetLink !== undefined) {
      return { kind: 'link', link: targetLink };
    }
    if (isSelectableLink === undefined) {
      return null;
    }
    const reach = EDGE_HIT_PX / graph.zoom();
    let nearest: { link: L, distance: number } | null = null;
    for (const placed of graphData.links) {
      const link = linkOf(placed);
      const curve = isSelectableLink(link) ? curveOf(placed) : null;
      const distance = curve === null ? Number.POSITIVE_INFINITY : distanceToCurve(curve, point);
      if (distance <= reach && (nearest === null || distance < nearest.distance)) {
        nearest = { link, distance };
      }
    }
    return nearest === null ? null : { kind: 'link', link: nearest.link };
  };

  const selectAt = (event: MouseEvent<HTMLDivElement>): void => {
    const hit = hitAt(event);
    if (hit?.kind === 'link') {
      onLinkClick?.(hit.link);
    } else {
      onNodeClick(hit?.node);
    }
  };

  /** On the canvas itself, whose own cursor rule an ancestor's would not override. */
  const pointAt = (event: PointerEvent<HTMLDivElement>): void => {
    const canvas = containerRef.current?.querySelector('canvas');
    if (canvas === null || canvas === undefined) {
      return;
    }
    const anyHit = hitAt(event);
    const hit = anyHit?.kind === 'node' && isInteractiveNode?.(anyHit.node) === false ? null : anyHit;
    canvas.style.cursor = hit === null ? '' : 'pointer';
    if (nodeTooltip === undefined) {
      return;
    }
    const graph = graphRef.current;
    if (hit?.kind !== 'node' || graph === undefined) {
      setHover(null);
      return;
    }
    const onScreen = graph.graph2ScreenCoords(hit.node.x ?? 0, hit.node.y ?? 0);
    const next = { id: hit.node.id, x: onScreen.x, y: onScreen.y - nodeReach(hit.node) * graph.zoom() - TOOLTIP_GAP };
    setHover((previous) => (previous?.id === next.id && previous.x === next.x && previous.y === next.y ? previous : next));
  };

  const stepZoom = (factor: number): void => {
    const graph = graphRef.current;
    if (graph === undefined) {
      return;
    }
    zoomedByHandRef.current = true;
    graph.zoom(clampZoom(graph.zoom() * factor), ZOOM_MS);
  };

  const markedNode = graphData.nodes.find((node) => node.id === markedNodeId);
  const centreOnMarked = (): void => {
    const graph = graphRef.current;
    if (graph === undefined || markedNode === undefined) {
      return;
    }
    zoomedByHandRef.current = true;
    graph.centerAt(markedNode.x ?? 0, markedNode.y ?? 0, ZOOM_MS);
    graph.zoom(Math.max(graph.zoom(), MAX_FIT_ZOOM), ZOOM_MS);
  };

  const hoveredNode = hover === null ? undefined : graphData.nodes.find((node) => node.id === hover.id);
  const tooltip = hoveredNode === undefined || nodeTooltip === undefined ? null : nodeTooltip(hoveredNode);

  return (
    <>
      <ul className="sr-only" aria-label={accessibleLabel}>
        {accessibleItems}
      </ul>
      <div
        ref={containerRef}
        className={`relative w-full ${height === undefined ? 'min-h-0 flex-1' : ''}`}
        style={height === undefined ? undefined : { height }}
        onClick={selectAt}
        onPointerMove={pointAt}
        onPointerLeave={() => setHover(null)}
        // Captured, because d3-zoom stops the propagation of the press that starts a pan: the
        // framing loop would otherwise pull the view back under the reader's hand every frame.
        onPointerDownCapture={() => {
          zoomedByHandRef.current = true;
        }}
      >
        {size.width > 0 && size.height > 0 && (
          <div
            className="transition-opacity motion-reduce:transition-none"
            style={{ opacity: isRevealed ? 1 : 0 }}
          >
            <ForceGraph2D
            // A callback ref, not the ref object: react-kapsule's imperative handle never reaches an
            // object ref here, so every call through `graphRef.current?.` would be a silent no-op. The
            // cast is what lets one through, since the library types this prop as an object ref alone.
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- see above: a callback ref is what works, and the prop's declared type admits only an object ref
              ref={attachGraph as unknown as RefObject<GraphHandle<N, L> | undefined>}
              graphData={graphData}
              width={size.width}
              height={size.height}
              backgroundColor="transparent"
              warmupTicks={WARMUP_TICKS}
              cooldownTicks={COOLDOWN_TICKS}
              d3VelocityDecay={0.35}
              nodeRelSize={NODE_RADIUS}
              nodeCanvasObject={paintPlacedNode}
              linkCanvasObject={paintPlacedLink}
              onRenderFramePost={paintAbove}
              enableNodeDrag={false}
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              enableZoomInteraction={false}
              nodeLabel={NO_LABEL}
            />
          </div>
        )}
        {tooltip !== null && hover !== null && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-sm border border-elevation-subtle bg-[var(--fds-bg-elevation-default-layer-2)] px-2 py-1 text-content-caption text-default-primary shadow-md"
            style={{ left: hover.x, top: hover.y }}
          >
            {tooltip}
          </div>
        )}
        <div
          className="absolute left-3 top-1/2 flex -translate-y-1/2 flex-col gap-0.5 rounded-md border border-elevation-subtle-soft bg-[var(--fds-bg-elevation-default-layer-1)] p-1 shadow-sm"
          onClick={(event) => event.stopPropagation()}
          onPointerMove={(event) => event.stopPropagation()}
          onPointerEnter={() => setHover(null)}
        >
          {markedNode !== undefined && centreOnMarkedLabel !== undefined && (
            <IconButton
              priority="tertiary"
              aria-label={centreOnMarkedLabel}
              icon={<LocateFixed className="size-4" aria-hidden />}
              onClick={centreOnMarked}
            />
          )}
          <IconButton
            priority="tertiary"
            aria-label={t`Recentre the graph`}
            icon={<Scan className="size-4" aria-hidden />}
            onClick={() => {
              zoomedByHandRef.current = false;
              const graph = graphRef.current;
              if (graph !== undefined && controlsInset !== undefined) {
                fitClearOf(graph, size.width, size.height, controlsInset, ZOOM_MS);
              } else {
                graph?.zoomToFit(ZOOM_MS, FIT_PADDING);
              }
            }}
          />
          <IconButton
            priority="tertiary"
            aria-label={t`Zoom in`}
            icon={<ZoomIn className="size-4" aria-hidden />}
            onClick={() => stepZoom(ZOOM_STEP)}
          />
          <IconButton
            priority="tertiary"
            aria-label={t`Zoom out`}
            icon={<ZoomOut className="size-4" aria-hidden />}
            onClick={() => stepZoom(1 / ZOOM_STEP)}
          />
          <span aria-hidden className="mx-1 my-0.5 border-t border-elevation-subtle-soft" />
          <IconButton
            priority="tertiary"
            aria-label={isFullScreen ? t`Leave full screen` : t`Show the graph full screen`}
            icon={isFullScreen
              ? <Minimize className="size-4" aria-hidden />
              : <Maximize className="size-4" aria-hidden />}
            onClick={onToggleFullScreen}
          />
        </div>
      </div>
    </>
  );
};
