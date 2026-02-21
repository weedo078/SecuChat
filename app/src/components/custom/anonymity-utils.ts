// Helper to determine anonymity level from connection info
export function getAnonymityLevel(
  i2pConnected: boolean,
  connectionType?: 'i2p' | 'webrtc-lan' | 'webrtc-internet'
): 'green' | 'yellow' | 'red' {
  if (i2pConnected && connectionType === 'i2p') {
    return 'green';
  }
  if (connectionType === 'webrtc-lan') {
    return 'yellow';
  }
  return 'red';
}
