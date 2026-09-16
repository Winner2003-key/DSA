import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Circle, Path } from 'react-native-svg';

import { AnswerStamp } from './answer-stamp';
import { AppText } from './app-text';
import { Chip } from './buttons';
import {
  METRICS,
  fitRect,
  layoutPath,
  type LayoutEdge,
  type LayoutName,
  type LayoutNode,
  type LayoutStep,
} from '@/graph/path-layout';
import { fr } from '@/i18n/fr';
import { useTheme, type Theme } from '@/theme';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Time between two steps of the reveal. */
const BEAT_MS = 950;
const LEAD_IN_MS = 350;
const CAMERA_MS = 520;
const EDGE_MS = 420;
const NODE_MS = 260;
const MIN_SCALE = 0.2;
const MAX_SCALE = 3;

export interface PathGraphProps {
  path: readonly LayoutStep[];
  /** The discovered name, drawn last with its star. */
  name?: LayoutName | null;
  /** false: everything at once, fitted (the in-game "Voir le chemin", reduced motion). */
  animate?: boolean;
  testID?: string;
}

/**
 * The path that was walked, drawn like a page of the book (GRAPH_SPECIFICATION §8).
 * The camera follows each step while its line draws, its node appears and its answer
 * is stamped; then it steps back to show the whole path, and pinch, drag, mouse
 * wheel and the zoom chips take over.
 */
export function PathGraph({ path, name = null, animate = true, testID = 'path-graph' }: PathGraphProps) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const still = !animate || reduceMotion;

  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const maxColumns = viewport.width >= 560 ? 3 : 2;
  const layout = useMemo(() => layoutPath(path, { name, maxColumns }), [path, name, maxColumns]);

  const [shown, setShown] = useState(still ? Number.POSITIVE_INFINITY : 0);
  const [interactive, setInteractive] = useState(still);
  const [replays, setReplays] = useState(0);

  const camX = useSharedValue(0);
  const camY = useSharedValue(0);
  const camS = useSharedValue(1);

  const moveCamera = useCallback(
    (target: { x: number; y: number; scale: number }, animated: boolean) => {
      if (!animated) {
        camX.value = target.x;
        camY.value = target.y;
        camS.value = target.scale;
        return;
      }
      const timing = { duration: CAMERA_MS, easing: Easing.inOut(Easing.cubic) };
      camX.value = withTiming(target.x, timing);
      camY.value = withTiming(target.y, timing);
      camS.value = withTiming(target.scale, timing);
    },
    [camS, camX, camY],
  );

  const fitAll = useCallback(
    (animated: boolean) => {
      if (viewport.width === 0) return;
      const whole = { x: 0, y: 0, width: layout.width, height: layout.height };
      moveCamera(fitRect(whole, viewport, { padding: 8, maxScale: 1.1, minScale: MIN_SCALE }), animated);
    },
    [layout, moveCamera, viewport],
  );

  // The reveal timeline. Restarts on "Rejouer l'animation" and when the viewport changes.
  useEffect(() => {
    if (viewport.width === 0) return;
    if (still) {
      setShown(Number.POSITIVE_INFINITY);
      setInteractive(true);
      fitAll(false);
      return;
    }
    setShown(0);
    setInteractive(false);
    const focusOf = (i: number) =>
      fitRect(layout.beats[i]!.focus, viewport, { padding: 56, maxScale: 1.25, minScale: 0.55 });
    if (layout.beats.length > 0) moveCamera(focusOf(0), false);

    const timers: ReturnType<typeof setTimeout>[] = [];
    layout.beats.forEach((_, i) => {
      timers.push(
        setTimeout(() => {
          moveCamera(focusOf(i), i > 0);
          setShown(i + 1);
        }, LEAD_IN_MS + i * BEAT_MS),
      );
    });
    timers.push(
      setTimeout(() => {
        fitAll(true);
        setInteractive(true);
      }, LEAD_IN_MS + layout.beats.length * BEAT_MS + 250),
    );
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replays, layout, viewport.width, viewport.height, still]);

  const beatOfNode = useMemo(() => {
    const map = new Map<string, number>();
    layout.beats.forEach((beat, i) => beat.nodeIds.forEach((id) => map.set(id, i)));
    return map;
  }, [layout]);
  const beatOfEdge = useMemo(() => {
    const map = new Map<string, number>();
    layout.beats.forEach((beat, i) => beat.edgeIds.forEach((id) => map.set(id, i)));
    return map;
  }, [layout]);

  // --- gestures: drag, pinch (touch), wheel (web) ---------------------------------
  const start = useSharedValue({ x: 0, y: 0, s: 1 });
  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(interactive)
      .minDistance(2)
      .onStart(() => {
        start.value = { x: camX.value, y: camY.value, s: camS.value };
      })
      .onUpdate((e) => {
        camX.value = start.value.x + e.translationX;
        camY.value = start.value.y + e.translationY;
      });
    const pinch = Gesture.Pinch()
      .enabled(interactive)
      .onStart(() => {
        start.value = { x: camX.value, y: camY.value, s: camS.value };
      })
      .onUpdate((e) => {
        const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, start.value.s * e.scale));
        const k = s / start.value.s;
        camX.value = e.focalX - (e.focalX - start.value.x) * k;
        camY.value = e.focalY - (e.focalY - start.value.y) * k;
        camS.value = s;
      });
    return Gesture.Simultaneous(pan, pinch);
  }, [camS, camX, camY, interactive, start]);

  const zoomBy = useCallback(
    (factor: number, focal?: { x: number; y: number }, animated = true) => {
      const fx = focal?.x ?? viewport.width / 2;
      const fy = focal?.y ?? viewport.height / 2;
      const s0 = camS.value;
      const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s0 * factor));
      const k = s / s0;
      moveCamera({ x: fx - (fx - camX.value) * k, y: fy - (fy - camY.value) * k, scale: s }, animated);
    },
    [camS, camX, camY, moveCamera, viewport],
  );

  const viewportRef = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' || !interactive) return;
    const element = viewportRef.current as unknown as HTMLElement | null;
    if (!element || typeof element.addEventListener !== 'function') return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      zoomBy(Math.exp(-event.deltaY * 0.0015), { x: event.clientX - rect.left, y: event.clientY - rect.top }, false);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [interactive, zoomBy]);

  const cameraStyle = useAnimatedStyle(() => {
    // Transforms scale about the centre of the canvas; shift so they scale about its top-left corner.
    const s = camS.value;
    return {
      transform: [
        { translateX: camX.value - ((1 - s) * layout.width) / 2 },
        { translateY: camY.value - ((1 - s) * layout.height) / 2 },
        { scale: s },
      ],
    };
  }, [layout.width, layout.height]);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (Math.abs(width - viewport.width) > 1 || Math.abs(height - viewport.height) > 1) setViewport({ width, height });
  };

  const stepCount = path.length;

  return (
    <View style={{ flex: 1, gap: theme.space.xs }}>
      <View
        ref={viewportRef}
        testID={testID}
        onLayout={onLayout}
        accessible
        accessibilityLabel={fr.graph.a11y(stepCount)}
        style={{
          flex: 1,
          minHeight: 260,
          overflow: 'hidden',
          borderRadius: theme.radius.card,
          borderWidth: 1,
          borderColor: theme.colors.line,
          backgroundColor: theme.colors.bg,
        }}
      >
        {layout.nodes.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space.lg }}>
            <AppText variant="body" tone="faint">
              {fr.graph.empty}
            </AppText>
          </View>
        ) : (
          <GestureDetector gesture={gesture}>
            <View style={{ flex: 1 }} collapsable={false}>
              <Animated.View
                style={[{ position: 'absolute', left: 0, top: 0, width: layout.width, height: layout.height }, cameraStyle]}
              >
                <Svg width={layout.width} height={layout.height} style={{ position: 'absolute', left: 0, top: 0 }}>
                  {layout.edges.map((edge) => (
                    <GraphEdge
                      key={`${replays}-${edge.id}`}
                      edge={edge}
                      visible={(beatOfEdge.get(edge.id) ?? 0) < shown}
                      animate={!still}
                      color={theme.colors.inkSoft}
                    />
                  ))}
                </Svg>
                {layout.nodes.map((node) => (
                  <GraphNode
                    key={`${replays}-${node.id}`}
                    node={node}
                    visible={(beatOfNode.get(node.id) ?? 0) < shown}
                    animate={!still}
                    theme={theme}
                  />
                ))}
                {layout.edges.map((edge) =>
                  edge.answer && edge.labelAt && (beatOfEdge.get(edge.id) ?? 0) < shown ? (
                    <View
                      key={`${replays}-tag-${edge.id}`}
                      pointerEvents="none"
                      style={{
                        position: 'absolute',
                        left: edge.labelAt.x - 70,
                        top: edge.labelAt.y - 12,
                        width: 140,
                        height: 24,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <AnswerStamp
                        style={{ alignSelf: 'center' }}
                        answerLabel={edge.answer.label}
                        stampIn={!still}
                        delayMs={still ? 0 : EDGE_MS * 0.6}
                        testID={`graph-tag-${edge.id}`}
                      />
                    </View>
                  ) : null,
                )}
              </Animated.View>
            </View>
          </GestureDetector>
        )}
        {layout.nodes.length > 0 ? (
          // Zoom controls float in the corner, for players who can't pinch or have no wheel.
          <View style={{ position: 'absolute', right: theme.space.xs, top: theme.space.xs, gap: theme.space.xs }}>
            <Chip testID="graph-zoom-in" label="+" accessibilityLabel={fr.graph.zoomIn} disabled={!interactive} onPress={() => zoomBy(1.3)} />
            <Chip testID="graph-zoom-out" label="−" accessibilityLabel={fr.graph.zoomOut} disabled={!interactive} onPress={() => zoomBy(1 / 1.3)} />
          </View>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.xs }}>
        {animate ? (
          <Chip
            testID="graph-replay"
            label={fr.graph.replay}
            disabled={reduceMotion}
            onPress={() => setReplays((n) => n + 1)}
          />
        ) : null}
        <View style={{ flex: 1 }} />
        <Chip testID="graph-fit" label={fr.graph.fit} disabled={!interactive} onPress={() => fitAll(true)} />
      </View>
    </View>
  );
}

function pathData(edge: LayoutEdge): string {
  return edge.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

function GraphEdge({ edge, visible, animate, color }: { edge: LayoutEdge; visible: boolean; animate: boolean; color: string }) {
  const progress = useSharedValue(visible && !animate ? 1 : 0);

  useEffect(() => {
    if (!visible) {
      progress.value = 0;
      return;
    }
    progress.value = animate ? withTiming(1, { duration: EDGE_MS, easing: Easing.out(Easing.quad) }) : 1;
  }, [animate, progress, visible]);

  const drawing = useAnimatedProps(() => ({
    strokeDashoffset: edge.length * (1 - progress.value),
  }));

  const end = edge.points[edge.points.length - 1]!;

  if (edge.dashed) {
    return visible ? <Path d={pathData(edge)} stroke={color} strokeWidth={2.5} strokeDasharray="7 7" fill="none" /> : null;
  }

  return (
    <>
      <AnimatedPath
        d={pathData(edge)}
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        strokeDasharray={`${edge.length} ${edge.length}`}
        animatedProps={drawing}
      />
      {edge.to === null && visible ? <Circle cx={end.x} cy={end.y} r={4} fill={color} /> : null}
    </>
  );
}

function GraphNode({ node, visible, animate, theme }: { node: LayoutNode; visible: boolean; animate: boolean; theme: Theme }) {
  const appear = useSharedValue(visible && !animate ? 1 : 0);

  useEffect(() => {
    if (!visible) {
      appear.value = 0;
      return;
    }
    appear.value = animate ? withDelay(EDGE_MS * 0.7, withTiming(1, { duration: NODE_MS })) : 1;
  }, [animate, appear, visible]);

  const motion = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [{ scale: 0.85 + 0.15 * appear.value }],
  }));

  const c = theme.colors;
  const isName = node.kind === 'NAME';
  const shape = {
    QUESTION: { backgroundColor: c.surface, borderColor: c.brass, borderWidth: 2, borderRadius: 22, borderStyle: 'solid' as const },
    SECTION: { backgroundColor: c.surfaceRaised, borderColor: c.ink, borderWidth: 2, borderRadius: 3, borderStyle: 'solid' as const },
    GROUP: { backgroundColor: c.surface, borderColor: c.inkSoft, borderWidth: 2, borderRadius: 10, borderStyle: 'dashed' as const },
    CLUE: { backgroundColor: c.surface, borderColor: c.line, borderWidth: 1.5, borderRadius: 14, borderStyle: 'solid' as const },
    NAME: { backgroundColor: c.brass, borderColor: c.brassEdge, borderWidth: 2, borderRadius: 16, borderStyle: 'solid' as const },
  }[node.kind];

  return (
    <Animated.View
      testID={`graph-node-${node.kind}`}
      style={[
        {
          position: 'absolute',
          left: node.x,
          top: node.y,
          width: node.width,
          height: node.height,
          paddingHorizontal: METRICS.padX - shape.borderWidth,
          paddingVertical: METRICS.padY - shape.borderWidth,
          justifyContent: 'center',
          ...shape,
        },
        motion,
      ]}
    >
      {node.kind === 'SECTION' ? (
        // The book draws sections as ruled boxes: a second, inner rule.
        <View
          pointerEvents="none"
          style={{ position: 'absolute', left: 3, top: 3, right: 3, bottom: 3, borderWidth: 1, borderColor: c.line, borderRadius: 1 }}
        />
      ) : null}
      <AppText
        weight={isName ? 'bold' : node.kind === 'CLUE' ? 'medium' : 'semibold'}
        style={{
          fontSize: isName ? METRICS.nameFontSize : METRICS.fontSize,
          lineHeight: isName ? METRICS.nameLineHeight : METRICS.lineHeight,
          textAlign: 'center',
          color: isName ? c.brassInk : c.ink,
        }}
      >
        {node.lines.join('\n')}
      </AppText>
      {node.descriptionLines.length > 0 ? (
        <AppText
          testID="graph-name-description"
          style={{
            marginTop: 4,
            fontSize: METRICS.descriptionFontSize,
            lineHeight: METRICS.descriptionLineHeight,
            textAlign: 'center',
            color: c.brassInk,
            opacity: 0.85,
          }}
        >
          {node.descriptionLines.join('\n')}
        </AppText>
      ) : null}
    </Animated.View>
  );
}
