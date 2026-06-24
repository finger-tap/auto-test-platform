// 2026-06-10: 浏览器侧 scrcpy H.264 解码 → WebGL canvas
//
// 复用 midscene 项目 fork 来的 @yume-chan/scrcpy-decoder-webcodecs:
//   - WebGLVideoFrameRenderer: 走 WebGL,直接画到 <canvas>
//   - WebCodecsVideoDecoder:    内部包 VideoDecoder,支持 H.264 / H.265 / AV1
//
// 协议(server → client,跟 agent-mobile / local-scrcpy 保持一致):
//   第一条 text 消息:JSON metadata { type: 'metadata', codec, width, height, ... }
//   之后 binary 帧:  [1 byte type] + [N bytes payload]
//     type = 0x00 → configuration (SPS/PPS) — 只在首条
//     type = 0x01 → data (H.264 NAL unit) — 后续每帧
//
// 30 FPS 目标 — WebCodecs 内部 rAF loop 控制渲染,不需要手动节流,decoder 内部丢帧。
//
// 资源管理:canvas ref 来自父组件,decoder 在 unmount / session 切换时 dispose(),
// 释放 WebCodecs 资源。

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  WebCodecsVideoDecoder,
  WebGLVideoFrameRenderer,
} from '@yume-chan/scrcpy-decoder-webcodecs';
import { ScrcpyVideoCodecId } from '@yume-chan/scrcpy';

export interface ScrcpyMetadata {
  /** ScrcpyVideoCodecId.H264 (1748121140) / H265 / AV1 */
  codec: number;
  width: number;
  height: number;
  serial: string;
}

export type ScrcpyDecoderState =
  | { kind: 'idle' }
  | { kind: 'ready'; metadata: ScrcpyMetadata }
  | { kind: 'error'; message: string };

export interface UseScrcpyDecoderInput {
  /** 渲染目标 canvas;drawer 组件 mount 后拿到 ref 再传 */
  canvas: HTMLCanvasElement | null;
  /** scrcpy metadata(由 usePreviewSession 在收到首条 text 消息时设上) */
  metadata: ScrcpyMetadata | null;
}

export interface UseScrcpyDecoderReturn {
  state: ScrcpyDecoderState;
  /** 当前 decoder 内部累计渲染帧数(轮询刷新) */
  renderedFrames: number;
  /** decoder 丢帧数(网络/解码慢 → 30 FPS 顶不住) */
  droppedFrames: number;
  /** 写一帧到 decoder(WS binary 帧:1 字节 type + payload) */
  push: (bytes: ArrayBuffer) => void;
}

export function useScrcpyDecoder(input: UseScrcpyDecoderInput): UseScrcpyDecoderReturn {
  const { canvas, metadata } = input;
  const decoderRef = useRef<WebCodecsVideoDecoder | null>(null);
  const writerRef = useRef<WritableStreamDefaultWriter<unknown> | null>(null);
  const [state, setState] = useState<ScrcpyDecoderState>({ kind: 'idle' });
  const stateRef = useRef<ScrcpyDecoderState>({ kind: 'idle' });
  const [renderedFrames, setRenderedFrames] = useState(0);
  const [droppedFrames, setDroppedFrames] = useState(0);
  // Buffer for frames that arrive before the decoder is ready (React batching
  // gap: metadata state update → next render → useEffect → decoder created).
  // Flushed in flushPendingFrames() after decoder init, config frames first.
  const pendingFramesRef = useRef<ArrayBuffer[]>([]);

  // Sort buffered frames: configuration (0x00) first, then data (0x01).
  // Ensures the decoder receives SPS/PPS before any H.264 NAL units.
  function flushPendingFrames(writer: WritableStreamDefaultWriter<unknown>) {
    const frames = pendingFramesRef.current;
    pendingFramesRef.current = [];
    if (frames.length === 0) return;
    const configFrames: ArrayBuffer[] = [];
    const dataFrames: ArrayBuffer[] = [];
    for (const f of frames) {
      const view = new Uint8Array(f);
      if (view.length >= 1 && view[0] === 0x00) configFrames.push(f);
      else dataFrames.push(f);
    }
    const ordered = [...configFrames, ...dataFrames];
    console.log(`[use-scrcpy-decoder] flushing ${ordered.length} buffered frames (${configFrames.length} config, ${dataFrames.length} data)`);
    for (const f of ordered) {
      const view = new Uint8Array(f);
      const typeByte = view[0];
      const payload = view.subarray(1);
      const packet = typeByte === 0x00
        ? { type: 'configuration', data: payload }
        : { type: 'data', data: payload };
      void writer.write(packet).catch((e: unknown) => {
        console.log(`[use-scrcpy-decoder] flush write error: ${e instanceof Error ? e.message : String(e)}`);
      });
    }
  }

  // metadata 到位 → 准备 decoder + renderer(canvas 从 ref 读,不加依赖)
  useEffect(() => {
    const canvasEl = canvas;
    if (!metadata || !canvasEl) return;
    if (typeof window === 'undefined' || typeof globalThis.VideoDecoder === 'undefined') {
      const errState: ScrcpyDecoderState = { kind: 'error', message: '当前浏览器不支持 WebCodecs VideoDecoder API,无法解码 H.264' };
      stateRef.current = errState;
      setState(errState);
      return;
    }
    // 重建:已经存在(metadata 重发或依赖变更)→ 先清掉旧的
    if (decoderRef.current) {
      try { decoderRef.current.dispose(); } catch { /* ignore */ }
      decoderRef.current = null;
      writerRef.current = null;
    }
    try {
      const renderer = new WebGLVideoFrameRenderer(canvasEl);
      const decoder = new WebCodecsVideoDecoder({
        codec: metadata.codec as ScrcpyVideoCodecId,
        renderer,
      });
      decoderRef.current = decoder;
      // 写流的 WritableStream<ScrcpyMediaStreamPacket> 在 TS 看来是 unknown
      const writer = (decoder.writable as unknown as WritableStream<{ type: string; data: Uint8Array }>).getWriter();
      writerRef.current = writer as unknown as WritableStreamDefaultWriter<unknown>;
      setRenderedFrames(0);
      setDroppedFrames(0);
      const readyState: ScrcpyDecoderState = { kind: 'ready', metadata };
      stateRef.current = readyState;
      setState(readyState);
      console.log(`[use-scrcpy-decoder] ready codec=${metadata.codec} ${metadata.width}x${metadata.height}`);
      // Flush any frames that arrived during the React batching gap
      // (metadata state update → this effect running). Configuration frames
      // are sorted first so the decoder gets SPS/PPS before any data NALUs.
      flushPendingFrames(writer);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[use-scrcpy-decoder] init failed: ${msg}`);
      const initErr: ScrcpyDecoderState = { kind: 'error', message: `解码器初始化失败: ${msg}` };
      stateRef.current = initErr;
      setState(initErr);
    }
    return () => {
      try { decoderRef.current?.dispose(); } catch { /* ignore */ }
      decoderRef.current = null;
      writerRef.current = null;
      stateRef.current = { kind: 'idle' };
      pendingFramesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metadata]);

  // 轮询 decoder.framesRendered / framesSkipped(decoder 内部 rAF loop,只能 polling 拿)
  useEffect(() => {
    if (state.kind !== 'ready') return;
    const t = setInterval(() => {
      const d = decoderRef.current;
      if (!d) return;
      setRenderedFrames(d.framesRendered);
      setDroppedFrames(d.framesSkipped);
    }, 500);
    return () => clearInterval(t);
  }, [state.kind]);

  const push = useCallback((bytes: ArrayBuffer) => {
    const writer = writerRef.current;
    if (stateRef.current.kind !== 'ready' || !writer) {
      // Decoder not ready yet (React batching gap). Buffer the frame so
      // flushPendingFrames can replay it once the decoder initializes.
      pendingFramesRef.current.push(bytes);
      return;
    }
    const view = new Uint8Array(bytes);
    if (view.length < 1) return;
    const typeByte = view[0];
    const payload = view.subarray(1);
    const packet = typeByte === 0x00
      ? { type: 'configuration', data: payload }
      : { type: 'data', data: payload };
    void writer.write(packet).catch((e: unknown) => {
      console.log(`[use-scrcpy-decoder] frame write error: ${e instanceof Error ? e.message : String(e)}`);
    });
  }, []);

  return { state, renderedFrames, droppedFrames, push };
}
