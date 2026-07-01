// 2026-06-28: scrcpy 帧格式化 — server(local-scrcpy) 和 agent-mobile 共用
//
// 协议约定(跟前端 useScrcpyDecoder 对齐):
//   第一条 text 消息: JSON metadata { type, codec, width, height, serial }
//   之后 binary 帧:   [1 byte type] + [N bytes H.264 payload]
//     type = 0x00 → configuration (SPS/PPS)
//     type = 0x01 → data (H.264 NAL unit)

export const SCRCPY_FRAME_TYPE_CONFIGURATION = 0x00;
export const SCRCPY_FRAME_TYPE_DATA = 0x01;

export interface ScrcpyPacket {
  type: 'configuration' | 'data';
  data: Uint8Array;
}

/**
 * 把 @yume-chan/adb-scrcpy 读出的 packet 编码为 binary 帧(1字节 type + payload)。
 * server 端 local-scrcpy 和 agent-mobile 的 scrcpy WS 发送共用此函数。
 */
export function encodeScrcpyFrame(packet: ScrcpyPacket): Uint8Array {
  const typeByte = packet.type === 'configuration' ? SCRCPY_FRAME_TYPE_CONFIGURATION : SCRCPY_FRAME_TYPE_DATA;
  const payload = new Uint8Array(1 + packet.data.length);
  payload[0] = typeByte;
  payload.set(packet.data, 1);
  return payload;
}
