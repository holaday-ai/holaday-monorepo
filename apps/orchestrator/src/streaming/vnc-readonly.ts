/** Strict RFB 3.8 / no-auth client reader. Do not forward keyboard, pointer,
 * clipboard, resize or unknown extensions without a per-action policy adapter.
 * Parse complete protocol messages, independent of WebSocket chunk boundaries. */
export class VncReadOnlyFilter {
  private buffer = Buffer.alloc(0);
  private phase: 'version' | 'security' | 'init' | 'messages' = 'version';
  receive(chunk: Buffer): Buffer {
    if (this.buffer.length + chunk.length > 65536) throw new Error('browser_vnc_read_only');
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const output: Buffer[] = [];
    while (this.buffer.length) {
      let size = 0;
      if (this.phase === 'version') {
        size = 12;
        if (this.buffer.length < size) break;
        if (this.buffer.subarray(0, 12).toString() !== 'RFB 003.008\n')
          throw new Error('browser_vnc_read_only');
        this.phase = 'security';
      } else if (this.phase === 'security') {
        size = 1;
        if (this.buffer[0] !== 1) throw new Error('browser_vnc_read_only');
        this.phase = 'init';
      } else if (this.phase === 'init') {
        size = 1;
        this.phase = 'messages';
      } else {
        const type = this.buffer[0];
        if (type === 0)
          size = 20; // SetPixelFormat
        else if (type === 2) {
          if (this.buffer.length < 4) break;
          size = 4 + 4 * this.buffer.readUInt16BE(2);
        } else if (type === 3 || type === 150)
          size = 10; // framebuffer request / continuous updates
        else if (type === 248) {
          if (this.buffer.length < 9) break;
          size = 9 + this.buffer.readUInt8(8);
        } // fence
        else throw new Error('browser_vnc_read_only');
        if (size > 65536) throw new Error('browser_vnc_read_only');
        if (this.buffer.length < size) break;
      }
      output.push(this.buffer.subarray(0, size));
      this.buffer = this.buffer.subarray(size);
    }
    return Buffer.concat(output);
  }
}
